import {
  CCG_CARDS_PER_PACK,
  CCG_INITIAL_PACKS,
  CcgArtVariant,
  CcgFinish,
} from "../config/ccg";

type GuestLibraryResult = {
  cardId: unknown;
  seriesKey?: string;
  finish: CcgFinish;
  artVariant?: CcgArtVariant;
  isDuplicate: boolean;
};

type GuestLibraryOpening = {
  results: GuestLibraryResult[];
};

type GuestLibraryOwnership = {
  cardId: unknown;
  seriesKey?: string;
  finish: CcgFinish;
  quantity: number;
  alternativeQuantity: number;
};

export type VerifiedGuestLibrary = {
  cards: number;
  duplicates: number;
  totalCards: number;
};

export function resolveGuestClaimOpeningId(
  openingIds: readonly string[],
  requestedOpeningId: string | null,
): string | null {
  if (requestedOpeningId) return openingIds.includes(requestedOpeningId) ? requestedOpeningId : null;
  return openingIds.length > 0 ? openingIds[openingIds.length - 1] : null;
}

export function getTransferableGuestPacks(
  balance: number | null | undefined,
): number {
  if (typeof balance !== "number" || !Number.isFinite(balance)) return 0;
  return Math.min(CCG_INITIAL_PACKS.guest, Math.max(0, Math.floor(balance)));
}

function ownershipKey(cardId: unknown, finish: CcgFinish, seriesKey?: string): string {
  return `${seriesKey ?? String(cardId)}:${finish}`;
}

export function verifyGuestLibrary(
  openings: readonly GuestLibraryOpening[],
  ownership: readonly GuestLibraryOwnership[],
): VerifiedGuestLibrary | null {
  if (openings.length === 0) return null;

  let cards = 0;
  let duplicates = 0;
  const expectedOwnership = new Map<string, { quantity: number; alternativeQuantity: number }>();

  for (const opening of openings) {
    if (opening.results.length !== CCG_CARDS_PER_PACK) return null;
    cards += opening.results.length;

    for (const result of opening.results) {
      if (result.isDuplicate) duplicates += 1;
      const key = ownershipKey(result.cardId, result.finish, result.seriesKey);
      const expected = expectedOwnership.get(key) ?? { quantity: 0, alternativeQuantity: 0 };
      expected.quantity += 1;
      if ((result.artVariant ?? "standard") === "alternative") expected.alternativeQuantity = 1;
      expectedOwnership.set(key, expected);
    }
  }

  if (expectedOwnership.size !== ownership.length) return null;
  const seenOwnership = new Set<string>();
  for (const row of ownership) {
    const key = ownershipKey(row.cardId, row.finish, row.seriesKey);
    if (seenOwnership.has(key)) return null;
    seenOwnership.add(key);
    const expected = expectedOwnership.get(key);
    if (
      !expected
      || row.quantity !== expected.quantity
      || row.alternativeQuantity !== expected.alternativeQuantity
    ) {
      return null;
    }
  }

  return {
    cards,
    duplicates,
    totalCards: cards,
  };
}
