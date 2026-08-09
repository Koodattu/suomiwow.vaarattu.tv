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

  const eligible = Array.from(killsByBoss.entries()).filter(([key, entries]) => {
    const [raidIdText] = key.split(":");
    return raidById.has(Number(raidIdText)) && new Set(entries.map((entry) => entry.pullCount)).size >= 5;
  });
  if (eligible.length === 0) throw new FunRoundUnavailableError("No boss has five distinct guild kill totals");

  const [key, entries] = randomItem(eligible);
  const [raidIdText, bossIdText] = key.split(":");
  const raidId = Number(raidIdText);
  const bossId = Number(bossIdText);
  const raid = raidById.get(raidId);
  const boss = raid?.bosses.find((candidate) => candidate.id === bossId);
  if (!raid || !boss) throw new FunRoundUnavailableError("The selected boss metadata is unavailable");

  const entriesByPullCount = new Map<number, KillRow[]>();
  for (const entry of entries) {
    const peers = entriesByPullCount.get(entry.pullCount) ?? [];
    peers.push(entry);
    entriesByPullCount.set(entry.pullCount, peers);
  }
  const selectedPullCounts = sample(Array.from(entriesByPullCount.keys()), 5);
  const selected = selectedPullCounts.map((pullCount) => randomItem(entriesByPullCount.get(pullCount) ?? []));
  const ranking = selected
    .sort((left, right) => left.pullCount - right.pullCount)
    .map((entry) => ({
      guild: {
        id: String(entry.guildId),
        name: entry.guildName,
        realm: entry.guildRealm,
        faction: entry.faction ?? null,
        crest: entry.crest ?? null,
      },
      pullCount: entry.pullCount,
    }));

  return {
    ...newRoundBase(),
    game: "lock-it-in",
    raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
    boss: { id: boss.id, name: boss.name, iconUrl: boss.iconUrl ?? null },
    revealOrder: shuffle(ranking.map((entry) => entry.guild)),
    solution: { ranking },
  };
}
