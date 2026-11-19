import { createHash } from "node:crypto";
import type { AvoidableMechanic } from "../config/avoidable-mechanics";
import { ROLE_BY_CLASS_AND_SPEC } from "../config/specs";
import AvoidableDamageFight, { IAvoidableDamageFight } from "../models/AvoidableDamageFight";
import Character from "../models/Character";
import Fight, { IFight } from "../models/Fight";
import Guild from "../models/Guild";
import type { MechanicSnapshot, MechanicSnapshotRow } from "../utils/mechanic-leaderboard";
import { resolveSpecByBlizzardSpecId, slugifySpecName, tryResolveRole } from "../utils/spec";

export type StoredMechanicSnapshot = MechanicSnapshot & { inputHash?: string };
type Roster = NonNullable<IFight["combatants"]>;
type Pull = Pick<IAvoidableDamageFight, "sourceFightId" | "guildId" | "status" | "isKill" | "fetchedAt"
  | "timestamp" | "reportCode" | "fightId" | "players">;
type Consume = (pull: Pull, guildName: string, roster: Roster, hidden: Set<number>) => void;

// Compare the actual inputs, including raw corrections and deletions. Batched point
// reads avoid two Mongo joins per pull and keep memory bounded by one batch plus the result.
async function scan(mechanic: AvoidableMechanic, consume?: Consume) {
  const [guilds, characters] = await Promise.all([
    Guild.find({ excludedRaidIds: { $ne: mechanic.zoneId } }).select("name").lean(),
    Character.find({ wclProfileHidden: true }).select("-_id wclCanonicalCharacterId").lean(),
  ]);
  const guildNames = new Map(guilds.map(guild => [String(guild._id), guild.name]));
  const hidden = new Set(characters.map(row => row.wclCanonicalCharacterId).filter((id): id is number => typeof id === "number"));
  const hash = createHash("sha256");
  hash.update(JSON.stringify([mechanic, [...hidden].sort((a, b) => a - b)]));
  const query = AvoidableDamageFight.find({ mechanicKey: mechanic.key, version: mechanic.version })
    .select("-_id sourceFightId guildId status isKill fetchedAt timestamp reportCode fightId players")
    .sort({ sourceFightId: 1 }).lean().cursor();
  async function visit(batch: Pull[]) {
    const sources = await Fight.find({ _id: { $in: batch.map(pull => pull.sourceFightId) } })
      .select("guildId combatants.name combatants.server combatants.role combatants.specID combatants.specName").lean();
    const byId = new Map(sources.map(source => [String(source._id), source]));
    for (const pull of batch) {
      const source = byId.get(String(pull.sourceFightId));
      const guildName = guildNames.get(String(pull.guildId));
      if (!source || !source.guildId?.equals(pull.guildId) || guildName === undefined) continue;
      const roster = pull.status === "fetched" ? source.combatants ?? [] : [];
      hash.update(JSON.stringify([pull, guildName, roster]));
      consume?.(pull, guildName, roster, hidden);
    }
  }
  let batch: Pull[] = [];
  try {
    for await (const pull of query) {
      batch.push(pull);
      if (batch.length === 128) { await visit(batch); batch = []; }
    }
    if (batch.length) await visit(batch);
  } finally {
    await query.close();
  }
  return hash.digest("hex");
}

const rosterKey = (name: string, realm?: string) =>
  JSON.stringify([name.toLowerCase(), (realm ?? "").toLowerCase().replace(/[\s\-'’`]/g, "")]);

export async function buildMechanicSnapshot(mechanic: AvoidableMechanic, previous?: StoredMechanicSnapshot): Promise<StoredMechanicSnapshot> {
  if (previous?.inputHash && previous.inputHash === await scan(mechanic)) return previous;
  const coverage = new Map<string, MechanicSnapshot["coverage"][number]>();
  const rows = new Map<string, MechanicSnapshotRow>();
  const inputHash = await scan(mechanic, (pull, guildName, roster, hidden) => {
    const guildId = String(pull.guildId);
    const outcome = JSON.stringify([guildId, pull.isKill, pull.status]);
    const bucket = coverage.get(outcome) ?? { guildId, isKill: pull.isKill, status: pull.status, fights: 0, updatedAt: null };
    bucket.fights++;
    const fetchedAt = pull.fetchedAt?.toISOString();
    if (fetchedAt && (!bucket.updatedAt || fetchedAt > bucket.updatedAt)) bucket.updatedAt = fetchedAt;
    coverage.set(outcome, bucket);
    if (pull.status !== "fetched") return;

    const combatants = new Map<string, Roster[number]>();
    for (const member of roster) {
      const key = rosterKey(member.name, member.server);
      if (!combatants.has(key)) combatants.set(key, member);
    }
    for (const player of pull.players ?? []) {
      if (player.canonicalCharacterId != null && hidden.has(player.canonicalCharacterId)) continue;
      const member = combatants.get(rosterKey(player.name, player.realm));
      const key = JSON.stringify([player.identity, guildId, pull.isKill, member?.role, member?.specID, member?.specName]);
      const timestamp = pull.timestamp.getTime();
      let row = rows.get(key);
      if (!row || timestamp > row.timestamp || (timestamp === row.timestamp && pull.reportCode < row.reportCode)) {
        const spec = member?.specName || (member?.specID ? resolveSpecByBlizzardSpecId(member.specID)?.specName : null);
        const specRole = tryResolveRole(player.classId, spec);
        const roles = new Set(Object.values(ROLE_BY_CLASS_AND_SPEC[player.classId] ?? {}));
        row = { key: player.identity, guildId, guildName, isKill: pull.isKill, name: player.name, realm: player.realm,
          region: player.region, classId: player.classId, role: specRole ?? member?.role ?? (roles.size === 1 ? [...roles][0] : null),
          specName: specRole && spec ? slugifySpecName(spec) : null, reportCode: pull.reportCode, fightId: pull.fightId,
          actorId: player.actorId, timestamp, damage: row?.damage ?? 0, hits: row?.hits ?? 0,
          directHits: row?.directHits ?? 0, ticks: row?.ticks ?? 0, pulls: row?.pulls ?? 0 };
        rows.set(key, row);
      }
      row.damage += player.damage ?? 0;
      row.hits += player.hits ?? 0;
      row.directHits += player.directHits ?? 0;
      row.ticks += player.ticks ?? 0;
      row.pulls++;
    }
  });
  return { mechanic, rows: [...rows.values()], coverage: [...coverage.values()], inputHash };
}
