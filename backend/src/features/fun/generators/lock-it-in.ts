import { TRACKED_RAIDS } from "../../../config/guilds";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import { funMythicProgressMatch } from "../fun-game.eligibility";
import type { LockItInRound } from "../fun-game.types";
import { bossKey, FunRoundUnavailableError, newRoundBase, randomItem, sample, shuffle } from "../fun-game.utils";

type KillRow = {
  guildId: unknown;
  guildName: string;
  guildRealm: string;
  faction?: string;
  crest?: import("../../../models/Guild").IGuildCrest;
  raidId: number;
  bossId: number;
  pullCount: number;
  firstKillTime?: Date | null;
};

export async function generateLockItInRound(): Promise<LockItInRound> {
  const [kills, raids] = await Promise.all([
    Guild.aggregate<KillRow>([
      { $unwind: "$progress" },
      {
        $match: {
          ...funMythicProgressMatch(),
        },
      },
      { $unwind: "$progress.bosses" },
      {
        $match: {
          "progress.bosses.kills": { $gte: 1 },
          "progress.bosses.pullCount": { $gt: 0 },
        },
      },
      {
        $project: {
          _id: 0,
          guildId: "$_id",
          guildName: "$name",
          guildRealm: "$realm",
          faction: "$faction",
          crest: "$crest",
          raidId: "$progress.raidId",
          bossId: "$progress.bosses.bossId",
          pullCount: "$progress.bosses.pullCount",
          firstKillTime: "$progress.bosses.firstKillTime",
        },
      },
    ]).option({ maxTimeMS: 15_000 }),
    Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl bosses -_id").lean(),
  ]);

  const raidById = new Map(raids.map((raid) => [raid.id, raid]));
  const killsByBoss = new Map<string, KillRow[]>();
  for (const kill of kills) {
    const key = bossKey(kill.raidId, kill.bossId);
    const entries = killsByBoss.get(key) ?? [];
    entries.push(kill);
    killsByBoss.set(key, entries);
  }

  const bossGroups = Array.from(killsByBoss.entries());
  const hasRaidMetadata = ([key]: [string, KillRow[]]) => {
    const [raidIdText] = key.split(":");
    return raidById.has(Number(raidIdText));
  };
  const allModePools: Array<{ mode: LockItInRound["mode"]; bosses: Array<[string, KillRow[]]> }> = [
    {
      mode: "pulls",
      bosses: bossGroups.filter((group) => hasRaidMetadata(group) && new Set(group[1].map((entry) => entry.pullCount)).size >= 5),
    },
    {
      mode: "kill-order",
      bosses: bossGroups.filter((group) => hasRaidMetadata(group) && new Set(group[1].flatMap((entry) => entry.firstKillTime ? [entry.firstKillTime.getTime()] : [])).size >= 5),
    },
  ];
  const modePools = allModePools.filter((pool) => pool.bosses.length > 0);
  if (modePools.length === 0) throw new FunRoundUnavailableError("No boss has five distinct guild results");

  const { mode, bosses } = randomItem(modePools);
  const [key, entries] = randomItem(bosses);
  const [raidIdText, bossIdText] = key.split(":");
  const raidId = Number(raidIdText);
  const bossId = Number(bossIdText);
  const raid = raidById.get(raidId);
  const boss = raid?.bosses.find((candidate) => candidate.id === bossId);
  if (!raid || !boss) throw new FunRoundUnavailableError("The selected boss metadata is unavailable");

  const entriesByMetric = new Map<number, KillRow[]>();
  for (const entry of entries) {
    const metric = mode === "pulls" ? entry.pullCount : entry.firstKillTime?.getTime();
    if (metric === undefined) continue;
    const peers = entriesByMetric.get(metric) ?? [];
    peers.push(entry);
    entriesByMetric.set(metric, peers);
  }
  const selectedMetrics = sample(Array.from(entriesByMetric.keys()), 5);
  const selected = selectedMetrics.map((metric) => randomItem(entriesByMetric.get(metric) ?? []));
  const ranking = selected
    .sort((left, right) => {
      if (mode === "pulls") return left.pullCount - right.pullCount;
      return (left.firstKillTime?.getTime() ?? Number.POSITIVE_INFINITY) - (right.firstKillTime?.getTime() ?? Number.POSITIVE_INFINITY);
    })
    .map((entry) => ({
      guild: {
        id: String(entry.guildId),
        name: entry.guildName,
        realm: entry.guildRealm,
        faction: entry.faction ?? null,
        crest: entry.crest ?? null,
      },
      pullCount: entry.pullCount,
      killedAt: entry.firstKillTime?.toISOString() ?? null,
    }));

  return {
    ...newRoundBase(),
    game: "lock-it-in",
    mode,
    raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
    boss: { id: boss.id, name: boss.name, iconUrl: boss.iconUrl ?? null },
    revealOrder: shuffle(ranking.map((entry) => entry.guild)),
    solution: { ranking },
  };
}
