import { CcgTierGrade } from "../config/ccg";

export type CcgSnapshotPreviewCandidate = {
  characterId: string;
  tierGrade: CcgTierGrade;
  hasMedia: boolean;
};

export type CcgSnapshotPreviewSummary = {
  eligibleCharacters: number;
  projectedSnapshots: number;
  newCharacters: number;
  rarityChanges: number;
  unchangedCharacters: number;
  blockedByMissingMedia: number;
  mediaReady: number;
  missingMedia: number;
  gradeDistribution: Record<CcgTierGrade, number>;
};

export type CcgSnapshotPreviewDisposition =
  | "new_character"
  | "rarity_change"
  | "unchanged"
  | "blocked_new_character"
  | "blocked_rarity_change";

export function shouldPublishCcgCardSnapshot(
  latestCard: { tierGrade: CcgTierGrade } | null | undefined,
  nextGrade: CcgTierGrade,
): boolean {
  return !latestCard || latestCard.tierGrade !== nextGrade;
}

export function nextCcgCardSnapshotVersion(latestCard: { snapshotVersion?: number | null } | null | undefined): number {
  const current = latestCard?.snapshotVersion;
  return Number.isInteger(current) && (current as number) > 0 ? (current as number) + 1 : latestCard ? 2 : 1;
}

export function getCcgSnapshotPreviewDisposition(
  latestCard: { tierGrade: CcgTierGrade } | null | undefined,
  nextGrade: CcgTierGrade,
  hasMedia: boolean,
): CcgSnapshotPreviewDisposition {
  if (!shouldPublishCcgCardSnapshot(latestCard, nextGrade)) return "unchanged";
  if (!hasMedia) return latestCard ? "blocked_rarity_change" : "blocked_new_character";
  return latestCard ? "rarity_change" : "new_character";
}

export function summarizeCcgSnapshotPreview(
  candidates: readonly CcgSnapshotPreviewCandidate[],
  latestCards: readonly { characterId: string; tierGrade: CcgTierGrade }[],
): CcgSnapshotPreviewSummary {
  const latestCardByCharacter = new Map(latestCards.map((card) => [card.characterId, card]));
  const gradeDistribution: Record<CcgTierGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  let projectedSnapshots = 0;
  let newCharacters = 0;
  let rarityChanges = 0;
  let unchangedCharacters = 0;
  let blockedByMissingMedia = 0;
  let mediaReady = 0;

  for (const candidate of candidates) {
    gradeDistribution[candidate.tierGrade] += 1;
    if (candidate.hasMedia) mediaReady += 1;

    const disposition = getCcgSnapshotPreviewDisposition(
      latestCardByCharacter.get(candidate.characterId),
      candidate.tierGrade,
      candidate.hasMedia,
    );
    if (disposition === "unchanged") unchangedCharacters += 1;
    if (disposition === "blocked_new_character" || disposition === "blocked_rarity_change") blockedByMissingMedia += 1;
    if (disposition === "new_character" || disposition === "rarity_change") projectedSnapshots += 1;
    if (disposition === "new_character") newCharacters += 1;
    if (disposition === "rarity_change") rarityChanges += 1;
  }

  return {
    eligibleCharacters: candidates.length,
    projectedSnapshots,
    newCharacters,
    rarityChanges,
    unchangedCharacters,
    blockedByMissingMedia,
    mediaReady,
    missingMedia: candidates.length - mediaReady,
    gradeDistribution,
  };
}
