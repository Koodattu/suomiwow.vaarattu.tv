import { TRACKED_RAIDS } from "../../../config/guilds";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import { resolveFightProgress } from "../../../utils/fight-progress";
import type { IGuildCrest } from "../../../models/Guild";
import { funMythicProgressMatch } from "../fun-game.eligibility";
import type { WipeprintBossOption, WipeprintRound } from "../fun-game.types";
import { bossKey, FunRoundUnavailableError, newRoundBase, shuffle } from "../fun-game.utils";

type PullRow = {
  pullNumber: number;
  fightPercentage?: number;
  bossPercentage?: number;
  phase?: string;
  isKill: boolean;
  duration?: number;
};

type WipeCandidate = {
  guildId: unknown;
  guildName: string;
  guildRealm: string;
  faction?: string;
  crest?: IGuildCrest;
  raidId: number;
  bossId: number;
  bossName: string;
  pullHistory: PullRow[];
};

export async function generateWipeprintRound(): Promise<WipeprintRound> {
  const [candidates, raids] = await Promise.all([
    Guild.aggregate<WipeCandidate>([
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
          "progress.bosses.pullHistory.19": { $exists: true },
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
          bossName: "$progress.bosses.bossName",
          pullHistory: "$progress.bosses.pullHistory",
        },
      },
    ]).option({ maxTimeMS: 15_000 }),
    Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl bosses -_id").lean(),
  ]);

  const allBossOptions: WipeprintBossOption[] = raids.flatMap((raid) =>
    raid.bosses.map((boss, index) => ({
      key: bossKey(raid.id, boss.id),
      raidId: raid.id,
      raidName: raid.name,
      expansion: raid.expansion,
      bossId: boss.id,
      bossName: boss.name,
      bossIconUrl: boss.iconUrl ?? null,
      raidIconUrl: raid.iconUrl ?? null,
      bossIndex: index + 1,
      bossCount: raid.bosses.length,
    })),
  );
  const optionByKey = new Map(allBossOptions.map((option) => [option.key, option]));
  const eligibleBossKeys = new Set(candidates.map((candidate) => bossKey(candidate.raidId, candidate.bossId)));

  for (const candidate of shuffle(candidates)) {
    const boss = optionByKey.get(bossKey(candidate.raidId, candidate.bossId));
    if (!boss) continue;
    const pulls = [...candidate.pullHistory]
      .sort((left, right) => left.pullNumber - right.pullNumber)
      .map((pull) => ({
        pullNumber: pull.pullNumber,
        progressPercentage: resolveFightProgress(pull).percentage,
        phase: pull.phase ?? null,
        duration: typeof pull.duration === "number" && Number.isFinite(pull.duration) ? pull.duration : null,
        isKill: pull.isKill === true,
      }));
    if (pulls.filter((pull) => pull.progressPercentage !== null).length < 20 || !pulls.some((pull) => pull.isKill)) continue;
    const bossOptions = allBossOptions
      .filter((option) => option.expansion === boss.expansion && eligibleBossKeys.has(option.key))
      .sort((left, right) => left.bossName.localeCompare(right.bossName) || left.raidName.localeCompare(right.raidName));
    if (bossOptions.length < 2) continue;

    return {
      ...newRoundBase(),
      game: "wipeprint",
      pulls,
      bossOptions,
      solution: {
        boss,
        sourceGuild: {
          id: String(candidate.guildId),
          name: candidate.guildName,
          realm: candidate.guildRealm,
          faction: candidate.faction ?? null,
          crest: candidate.crest ?? null,
        },
      },
    };
  }

  throw new FunRoundUnavailableError("No completed boss has a usable pull fingerprint");
}
