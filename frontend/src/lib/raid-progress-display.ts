import type { RaidProgressSummary } from "@/types";

export type PullProgressDisplay = {
  pulls: number;
  bestPull: number;
  bestPullDisplay: string;
  isKilledBoss: boolean;
};

export function getPullProgressDisplay(progress: RaidProgressSummary | null): PullProgressDisplay {
  const currentBossPulls = progress?.currentBossPulls || 0;
  const bestPullPercent = progress?.bestPullPercent || 0;
  const bestPullDisplay = progress?.bestPullPhase?.displayString || "";
  const isComplete = !!progress && progress.totalBosses > 0 && progress.bossesDefeated >= progress.totalBosses;

  if (isComplete) {
    return {
      pulls: progress.totalPulls === undefined ? progress.lastKilledBossPulls || 0 : progress.totalPulls || 0,
      bestPull: 0,
      bestPullDisplay: "",
      isKilledBoss: true,
    };
  }

  const hasCurrentBossProgress = currentBossPulls > 0 || bestPullDisplay || (bestPullPercent > 0 && bestPullPercent < 100);

  if (hasCurrentBossProgress) {
    return {
      pulls: currentBossPulls,
      bestPull: bestPullPercent,
      bestPullDisplay,
      isKilledBoss: false,
    };
  }

  return {
    pulls: progress?.lastKilledBossPulls || 0,
    bestPull: 0,
    bestPullDisplay: "",
    isKilledBoss: (progress?.lastKilledBossPulls || 0) > 0,
  };
}

function hasProgressDisplayData(progress: RaidProgressSummary | null, pullDisplay: PullProgressDisplay) {
  return (
    pullDisplay.pulls > 0 ||
    pullDisplay.bestPull > 0 ||
    !!pullDisplay.bestPullDisplay ||
    (progress?.totalTimeSpent ?? 0) > 0 ||
    (progress?.totalCombatTimeSpent ?? 0) > 0 ||
    (progress?.progressRaidTimeSpent ?? 0) > 0 ||
    (progress?.totalRaidTimeSpent ?? 0) > 0
  );
}

export function getEffectivePullProgress(mythicProgress: RaidProgressSummary | null, heroicProgress: RaidProgressSummary | null) {
  const mythicPullDisplay = getPullProgressDisplay(mythicProgress);
  const heroicPullDisplay = getPullProgressDisplay(heroicProgress);
  const hasMythicData = hasProgressDisplayData(mythicProgress, mythicPullDisplay);
  const hasHeroicData = hasProgressDisplayData(heroicProgress, heroicPullDisplay);
  const useMythic = hasMythicData || (!hasHeroicData && mythicPullDisplay.isKilledBoss);

  return {
    pullDisplay: useMythic ? mythicPullDisplay : heroicPullDisplay,
    progress: useMythic ? mythicProgress : heroicProgress,
    isHeroicFallback: !useMythic && (hasHeroicData || heroicPullDisplay.isKilledBoss),
  };
}
