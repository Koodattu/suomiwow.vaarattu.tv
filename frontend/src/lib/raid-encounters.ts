/** Unconfigured raids keep every boss; lair classification alone does not decide scoring. */
export function characterScoringBosses<T extends { countsForCharacterScore?: boolean }>(bosses: readonly T[]): T[] {
  return bosses.filter(boss => boss.countsForCharacterScore !== false);
}
