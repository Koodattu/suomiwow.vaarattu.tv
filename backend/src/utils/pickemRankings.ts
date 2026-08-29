interface PickemRaidProgress {
  raidId: number;
  difficulty: "mythic" | "heroic";
  bossesDefeated?: number | null;
  guildRank?: number | null;
}

function hasRank(progress: PickemRaidProgress | undefined): boolean {
  return typeof progress?.guildRank === "number" && Number.isFinite(progress.guildRank) && progress.guildRank > 0;
}

function hasKills(progress: PickemRaidProgress | undefined): boolean {
  return typeof progress?.bossesDefeated === "number" && progress.bossesDefeated > 0;
}

/**
 * Select the progress entry used by the unified guild ranking. The rank is
 * stored on Mythic progress once a guild has a Mythic kill, otherwise on its
 * Heroic progress.
 */
export function getPickemRankingProgress<T extends PickemRaidProgress>(progress: readonly T[] | null | undefined, raidId: number): T | undefined {
  const mythic = progress?.find((entry) => entry.raidId === raidId && entry.difficulty === "mythic");
  const heroic = progress?.find((entry) => entry.raidId === raidId && entry.difficulty === "heroic");

  if (hasRank(mythic)) return mythic;
  if (hasRank(heroic)) return heroic;
  if (hasKills(mythic)) return mythic;
  if (hasKills(heroic)) return heroic;
  return mythic ?? heroic;
}
