import type { IBossProgress } from "../models/Guild";

type RaceBossProgress = Pick<IBossProgress, "bossId" | "kills" | "pullCount" | "bestPercent" | "bestPullPhase" | "firstKillTime">;

// WCL can append encounters outside progression order (Nymrissa follows Ula'tek in raid 53).
const RACE_BOSS_OVERRIDES: Partial<Record<number, { penultimate: number; final: number }>> = {
  53: { penultimate: 3429, final: 3492 }, // The Coiled Altar, Ula'tek
};

export function getPenultimateBossSummary(raidId: number, raidBosses: { id: number; name: string }[], bosses: RaceBossProgress[] = []) {
  const override = RACE_BOSS_OVERRIDES[raidId];
  const targetId = override?.penultimate ?? raidBosses[raidBosses.length - 2]?.id;
  const finalBossId = override?.final ?? raidBosses[raidBosses.length - 1]?.id;
  const target = raidBosses.find((entry) => entry.id === targetId);
  if (!target) return undefined;

  const boss = bosses.find((entry) => entry.bossId === target.id);
  const hasReachedBoss = Boolean(boss && (boss.kills > 0 || boss.pullCount > 0));
  const precedingBosses = raidBosses.filter((entry) => entry.id !== target.id && entry.id !== finalBossId);
  const precedingBossesKilled = precedingBosses.every((preceding) => bosses.some((entry) => entry.bossId === preceding.id && entry.kills > 0));

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
