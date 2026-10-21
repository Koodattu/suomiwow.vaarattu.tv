/** WCL zones are source containers, not necessarily a single progression raid. */
export interface RaidEncounterDefinition {
  main: readonly number[];
  characterScoring: readonly number[];
  final: number;
  lairs: readonly { id: number; name: string; slug: string; rioSlug: string }[];
}

export const RAID_ENCOUNTERS: Readonly<Record<number, RaidEncounterDefinition>> = {
  53: {
    main: [3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492],
    // Preserve the season's original character/CCG scoring pool, including Nymrissa.
    characterScoring: [3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492, 3379],
    final: 3492,
    lairs: [
      { id: 3379, name: "Nymrissa Wavecaller", slug: "nymrissa-wavecaller", rioSlug: "the-tidebound-grotto" },
      { id: 3513, name: "Kith'ix", slug: "kith-ix", rioSlug: "the-unbinding-of-kithix" },
    ],
  },
};

export function isMainEncounter(raidId: number, encounterId: number): boolean {
  return RAID_ENCOUNTERS[raidId]?.main.includes(encounterId) ?? true;
}

export function mainEncounterFilter(raidId: number, field = "encounterID"): Record<string, { $in: readonly number[] }> {
  const definition = RAID_ENCOUNTERS[raidId];
  return definition ? { [field]: { $in: definition.main } } : {};
}

export function isCharacterScoringEncounter(raidId: number, encounterId: number): boolean {
  return RAID_ENCOUNTERS[raidId]?.characterScoring.includes(encounterId) ?? true;
}

export function characterScoringEncounterFilter(raidId: number, field = "encounterID"): Record<string, { $in: readonly number[] }> {
  const definition = RAID_ENCOUNTERS[raidId];
  return definition ? { [field]: { $in: definition.characterScoring } } : {};
}

export function mainRaidBosses<T extends { id: number }>(raidId: number, bosses: readonly T[]): T[] {
  const definition = RAID_ENCOUNTERS[raidId];
  if (!definition) return [...bosses];
  return definition.main.flatMap(id => {
    const boss = bosses.find(candidate => candidate.id === id);
    return boss ? [boss] : [];
  });
}

export function raidLairs(raidId: number) {
  return RAID_ENCOUNTERS[raidId]?.lairs ?? [];
}

/** Only a main-raid-specific provider rank may break ties for a split zone. */
export function competitiveWorldRank(progress: { raidId: number; worldRank?: number; rioWorldRank?: number }): number | undefined {
  return RAID_ENCOUNTERS[progress.raidId] ? progress.rioWorldRank : progress.worldRank;
}
