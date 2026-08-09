import { TRACKED_RAIDS } from "../../../config/guilds";
import CharacterMythicPlusSeasonScore from "../../../models/CharacterMythicPlusSeasonScore";
import Event from "../../../models/Event";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import { funMythicProgressMatch, loadFunEligibleCanonicalCharacterIds } from "../fun-game.eligibility";
import type { ClosestWithoutGoingOverRound, FunGuild } from "../fun-game.types";
import { bossKey, FunRoundUnavailableError, newRoundBase, randomItem, shuffle } from "../fun-game.utils";

type BossGuildRow = {
  guildId: unknown;
  guildName: string;
  guildRealm: string;
  raidId: number;
  raidName: string;
  bossId: number;
  bossName: string;
  pullCount: number;
  timeSpent: number;
};

type KillRankRow = {
  guildId: unknown;
  guildName: string;
  guildRealm?: string;
  raidId: number;
  raidName: string;
  bossId?: number;
  bossName?: string;
  data: { killRank?: number };
};

type MythicPlusRow = {
  _id: { wclCanonicalCharacterId: number; classID: number };
  name: string;
  realm: string;
  value: number;
};

type ChallengeCandidate = {
  challenge: ClosestWithoutGoingOverRound["challenge"];
  value: number;
  population: number[];
};

export async function generateClosestWithoutGoingOverRound(): Promise<ClosestWithoutGoingOverRound> {
  const eligibleCanonicalIds = await loadFunEligibleCanonicalCharacterIds();
  const [bossGuildRows, killRankRows, mythicPlusRows, raids] = await Promise.all([
    Guild.aggregate<BossGuildRow>([
      { $unwind: "$progress" },
      { $match: funMythicProgressMatch() },
      { $unwind: "$progress.bosses" },
      {
        $match: {
          "progress.bosses.kills": { $gte: 1 },
          "progress.bosses.pullCount": { $gt: 0 },
          "progress.bosses.timeSpent": { $gt: 0 },
        },
      },
      {
        $project: {
          _id: 0,
          guildId: "$_id",
          guildName: "$name",
          guildRealm: "$realm",
          raidId: "$progress.raidId",
          raidName: "$progress.raidName",
          bossId: "$progress.bosses.bossId",
          bossName: "$progress.bosses.bossName",
          pullCount: "$progress.bosses.pullCount",
          timeSpent: "$progress.bosses.timeSpent",
        },
      },
    ]).option({ maxTimeMS: 15_000 }),
    Event.find({
      type: "boss_kill",
      difficulty: "mythic",
      raidId: { $in: TRACKED_RAIDS },
      "data.killRank": { $gt: 0 },
    }).select("guildId guildName guildRealm raidId raidName bossId bossName data.killRank -_id").lean<KillRankRow[]>(),
    CharacterMythicPlusSeasonScore.aggregate<MythicPlusRow>([
      { $match: { wclCanonicalCharacterId: { $in: eligibleCanonicalIds }, identityStatus: "current", scoreStatus: "available", "scores.all": { $gt: 0 } } },
      { $sort: { fetchedAt: -1 } },
      {
        $group: {
          _id: { wclCanonicalCharacterId: "$wclCanonicalCharacterId", classID: "$classID" },
          name: { $first: "$name" },
          realm: { $first: "$realm" },
          value: { $first: "$scores.all" },
        },
      },
      { $limit: 400 },
    ]).option({ maxTimeMS: 15_000 }),
    Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl bosses.id bosses.name bosses.iconUrl -_id").lean(),
  ]);

  const raidById = new Map(raids.map((raid) => [raid.id, raid]));
  const guildIds = Array.from(new Set([
    ...bossGuildRows.map((row) => String(row.guildId)),
    ...killRankRows.map((row) => String(row.guildId)),
  ]));
  const guildDocuments = await Guild.find({ _id: { $in: guildIds } }).select("_id name realm faction crest").lean();
  const guildDocumentById = new Map(guildDocuments.map((guild) => [String(guild._id), guild]));
  const toFunGuild = (id: unknown, name: string, realm: string): FunGuild => {
    const guild = guildDocumentById.get(String(id));
    return {
      id: String(id),
      name: guild?.name ?? name,
      realm: guild?.realm ?? realm,
      faction: guild?.faction ?? null,
      crest: guild?.crest ?? null,
    };
  };
  const candidates: ChallengeCandidate[] = [];
  const bossRowsByKey = new Map<string, BossGuildRow[]>();
  for (const row of bossGuildRows) {
    const key = bossKey(row.raidId, row.bossId);
    const rows = bossRowsByKey.get(key) ?? [];
    rows.push(row);
    bossRowsByKey.set(key, rows);
  }
  for (const rows of bossRowsByKey.values()) {
    if (rows.length < 5) continue;
    const row = randomItem(rows);
    const raid = raidById.get(row.raidId);
    const boss = raid?.bosses.find((candidate) => candidate.id === row.bossId);
    if (!raid || !boss) continue;
    candidates.push({
      challenge: {
        kind: "guild-boss-pulls",
        unit: "pulls",
        subject: row.guildName,
        detail: `${row.bossName} · ${row.raidName}`,
        raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
        boss: { id: boss.id, name: boss.name, iconUrl: boss.iconUrl ?? null },
        guild: toFunGuild(row.guildId, row.guildName, row.guildRealm),
        characterClassID: null,
      },
      value: row.pullCount,
      population: rows.map((entry) => entry.pullCount),
    });
    candidates.push({
      challenge: {
        kind: "guild-boss-minutes",
        unit: "minutes",
        subject: row.guildName,
        detail: `${row.bossName} · ${row.raidName}`,
        raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
        boss: { id: boss.id, name: boss.name, iconUrl: boss.iconUrl ?? null },
        guild: toFunGuild(row.guildId, row.guildName, row.guildRealm),
        characterClassID: null,
      },
      value: Math.max(1, Math.round(row.timeSpent / 60)),
      population: rows.map((entry) => Math.max(1, Math.round(entry.timeSpent / 60))),
    });
  }

  const killRanksByBoss = new Map<string, KillRankRow[]>();
  for (const row of killRankRows) {
    if (typeof row.bossId !== "number" || typeof row.data.killRank !== "number") continue;
    const key = bossKey(row.raidId, row.bossId);
    const rows = killRanksByBoss.get(key) ?? [];
    rows.push(row);
    killRanksByBoss.set(key, rows);
  }
  for (const rows of killRanksByBoss.values()) {
    if (rows.length < 5) continue;
    const row = randomItem(rows);
    const raid = raidById.get(row.raidId);
    const boss = raid?.bosses.find((candidate) => candidate.id === row.bossId);
    if (!raid || !boss) continue;
    candidates.push({
      challenge: {
        kind: "guild-kill-rank",
        unit: "rank",
        subject: row.guildName,
        detail: `${row.bossName ?? "Boss kill"} · ${row.raidName}`,
        raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
        boss: { id: boss.id, name: boss.name, iconUrl: boss.iconUrl ?? null },
        guild: toFunGuild(row.guildId, row.guildName, row.guildRealm ?? ""),
        characterClassID: null,
      },
      value: row.data.killRank!,
      population: rows.map((entry) => entry.data.killRank!).filter((value) => Number.isFinite(value)),
    });
  }

  if (mythicPlusRows.length >= 20) {
    const row = randomItem(mythicPlusRows);
    candidates.push({
      challenge: { kind: "mythic-plus-score", unit: "score", subject: row.name, detail: row.realm, raid: null, boss: null, guild: null, characterClassID: row._id.classID },
      value: Math.round(row.value),
      population: mythicPlusRows.map((entry) => Math.round(entry.value)),
    });
  }

  if (candidates.length === 0) throw new FunRoundUnavailableError("No numeric challenge has enough comparison data");
  const selected = randomItem(candidates);
  const values = shuffle(selected.population).slice(0, 160).sort((left, right) => left - right);
  return {
    ...newRoundBase(),
    game: "closest-without-going-over",
    challenge: selected.challenge,
    distribution: { min: values[0], median: median(values), max: values[values.length - 1], values },
    solution: { value: selected.value },
  };
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? Math.round((values[middle - 1] + values[middle]) / 2) : values[middle];
}
