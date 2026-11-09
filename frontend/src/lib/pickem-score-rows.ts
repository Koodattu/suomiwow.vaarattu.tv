import type { LeaderboardEntry, PickemDetails } from "../types/index.ts";

export type PickemScoringRuleset = Pick<PickemDetails, "scoringConfig" | "streakConfig" | "type" | "guildCount" | "scoreOutOfRangeGuilds" | "finalized" | "rankingsPending">;

export function getPickemScoreRows(entry: LeaderboardEntry, pickem: PickemScoringRuleset) {
  if (pickem.rankingsPending || (pickem.type === "rwf" && !pickem.finalized) || !pickem.streakConfig) return null;

  const rows = [...entry.predictions].sort((a, b) => a.predictedRank - b.predictedRank).map((prediction) => ({ prediction, streakBonus: 0, total: 0 }));
  const config = pickem.streakConfig;
  if (config.enabled && config.rule === "exact-consecutive-v1") {
    let length = 0;
    let previousRank = 0;
    for (const row of rows) {
      const { predictedRank, actualRank } = row.prediction;
      const eligible = actualRank !== null && (pickem.type === "rwf" || pickem.scoreOutOfRangeGuilds || actualRank <= (pickem.guildCount || 10));
      if (!eligible || actualRank !== predictedRank) {
        length = 0;
      } else {
        length = predictedRank === previousRank + 1 ? length + 1 : 1;
        if (length >= Math.max(2, config.minStreak)) row.streakBonus = config.bonusPerGuild;
      }
      previousRank = predictedRank;
    }
  } else if (config.enabled) {
    // Match the backend's relative-order runs; unscored guilds are skipped, not streak breaks.
    const eligible = rows.filter(({ prediction }) => prediction.actualRank !== null &&
      (pickem.type === "rwf" || pickem.scoreOutOfRangeGuilds || prediction.actualRank <= (pickem.guildCount || 10)));
    let start = 0;
    for (let end = 1; end <= eligible.length; end++) {
      if (end < eligible.length && eligible[end].prediction.actualRank! > eligible[end - 1].prediction.actualRank!) continue;
      if (end - start >= config.minStreak) {
        for (let index = start; index < end; index++) eligible[index].streakBonus = config.bonusPerGuild;
      }
      start = end;
    }
  }

  let total = 0;
  let streakBonus = 0;
  for (const row of rows) {
    streakBonus += row.streakBonus;
    total += row.prediction.points + row.streakBonus;
    row.total = total;
  }
  // Never present a derived breakdown that disagrees with the authoritative backend score.
  if (total !== entry.totalPoints || streakBonus !== entry.streakBonus) return null;
  return rows;
}
