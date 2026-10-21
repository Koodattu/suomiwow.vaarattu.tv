import type { CcgOpening, CcgSession, CcgSet } from "../types";

type OpeningUpdates = NonNullable<CcgOpening["cacheUpdates"]>;

export function updateCcgSessionAfterOpening(session: CcgSession, updates: OpeningUpdates): CcgSession {
  const customUpdates = new Map(updates.customQualityProtection.map((row) => [row.setSlug, row]));
  return {
    ...session,
    packs: updates.packs,
    qualityProtection: updates.qualityProtection,
    customQualityProtection: session.customQualityProtection.map((row) => {
      const update = customUpdates.get(row.setSlug);
      return update ? { ...row, counter: update.counter } : row;
    }),
    ownedFinishes: session.ownedFinishes + updates.ownedFinishesDelta,
  };
}

export function updateCcgSetsAfterOpening(sets: CcgSet[], updates: OpeningUpdates): CcgSet[] {
  return sets.map((set) => ({ ...set, ownedCards: set.ownedCards + (updates.ownedCardsBySetDelta[set.id] ?? 0) }));
}
