import type { IBossProgress } from "../models/Guild";

type RaceBossProgress = Pick<IBossProgress, "bossId" | "kills" | "pullCount" | "bestPercent" | "bestPullPhase" | "firstKillTime">;

// Raid metadata defines encounter order; guild boss arrays may be incomplete or reordered.
export function getPenultimateBossSummary(raidBosses: { id: number; name: string }[], bosses: RaceBossProgress[] = []) {
  const targetIndex = raidBosses.length - 2;
  const target = raidBosses[targetIndex];
  if (!target) return undefined;

  const boss = bosses.find((entry) => entry.bossId === target.id);
  const hasReachedBoss = Boolean(boss && (boss.kills > 0 || boss.pullCount > 0));
  const precedingBossesKilled = raidBosses.slice(0, targetIndex).every((preceding) => bosses.some((entry) => entry.bossId === preceding.id && entry.kills > 0));

  return {
    bossId: target.id,
    bossName: target.name,
    eligible: hasReachedBoss || precedingBossesKilled,
    kills: boss?.kills ?? 0,
    pullCount: boss?.pullCount ?? 0,
    bestPercent: boss?.bestPercent ?? 100,
    bestPullPhase: boss?.bestPullPhase,
    firstKillTime: boss?.firstKillTime,
  };
}
