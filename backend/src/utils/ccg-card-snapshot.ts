import { CCG_CARD_NOT_FOUND_CONFIRMATION_MS, CcgRegularTierGrade, CcgTierGrade } from "../config/ccg";
import type { CcgCardAvailabilityStatus } from "../models/CcgCard";

export type CcgSnapshotPreviewCandidate = {
  characterId: string;
  tierGrade: CcgRegularTierGrade;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  metric: "dps" | "hps";
  mythicPlusScore: number | null;
  hasMedia: boolean;
};

type CcgSnapshotIdentity = Pick<CcgSnapshotPreviewCandidate, "tierGrade" | "classID" | "specName" | "role" | "mythicPlusScore">;
type ExistingCcgSnapshotIdentity = {
  tierGrade: CcgTierGrade;
  classID?: number | null;
  specName?: string | null;
  role?: "dps" | "healer" | "tank" | null;
  metric?: "dps" | "hps" | null;
  mythicPlusScore?: number | null;
};

export type CcgSnapshotPreviewSummary = {
  eligibleCharacters: number;
  projectedSnapshots: number;
  newCharacters: number;
  rarityChanges: number;
  identityChanges: number;
  mythicPlusScoreAdds: number;
  unchangedCharacters: number;
  blockedByMissingMedia: number;
  mediaReady: number;
  missingMedia: number;
  gradeDistribution: Record<CcgRegularTierGrade, number>;
};

export type CcgSnapshotPreviewDisposition =
  | "new_character"
  | "rarity_change"
  | "identity_change"
  | "mythic_plus_score_added"
  | "unchanged"
  | "blocked_new_character"
  | "blocked_rarity_change"
  | "blocked_identity_change"
  | "blocked_mythic_plus_score_added";

type CcgCardAvailabilitySnapshot = {
  availabilityStatus?: CcgCardAvailabilityStatus | null;
  availabilityFirstNotFoundAt?: Date | null;
  availabilityLastNotFoundAt?: Date | null;
  availabilityChangedAt?: Date | null;
};

export type CcgAvailabilityPreviewDisposition = "archive_if_not_found" | "return_if_available";

export function getCcgAvailabilityPreviewDisposition(
  card: CcgCardAvailabilitySnapshot,
  calculatedAt: Date,
): CcgAvailabilityPreviewDisposition | null {
  if (card.availabilityStatus === "archived") return "return_if_available";
  if (
    card.availabilityStatus === "verification_pending"
    && card.availabilityFirstNotFoundAt
    && card.availabilityLastNotFoundAt
    && card.availabilityFirstNotFoundAt.getTime() <= calculatedAt.getTime() - CCG_CARD_NOT_FOUND_CONFIRMATION_MS
  ) return "archive_if_not_found";
  return null;
}

export function inheritCcgCardAvailability(
  latestCard: CcgCardAvailabilitySnapshot | null | undefined,
): Required<CcgCardAvailabilitySnapshot> {
  return {
    availabilityStatus: latestCard?.availabilityStatus ?? "active",
    availabilityFirstNotFoundAt: latestCard?.availabilityFirstNotFoundAt ?? null,
    availabilityLastNotFoundAt: latestCard?.availabilityLastNotFoundAt ?? null,
    availabilityChangedAt: latestCard?.availabilityChangedAt ?? null,
  };
}

export function combineCcgCardAvailability(
  cards: readonly CcgCardAvailabilitySnapshot[],
): Required<CcgCardAvailabilitySnapshot> | null {
  if (cards.length === 0) return null;
  const snapshots = cards.map(inheritCcgCardAvailability);
  return {
    availabilityStatus: snapshots.some((card) => card.availabilityStatus === "archived")
      ? "archived"
      : snapshots.some((card) => card.availabilityStatus === "verification_pending") ? "verification_pending" : "active",
    availabilityFirstNotFoundAt: snapshots.reduce<Date | null>((earliest, card) => (
      card.availabilityFirstNotFoundAt && (!earliest || card.availabilityFirstNotFoundAt < earliest)
        ? card.availabilityFirstNotFoundAt
        : earliest
    ), null),
    availabilityLastNotFoundAt: snapshots.reduce<Date | null>((latest, card) => (
      card.availabilityLastNotFoundAt && (!latest || card.availabilityLastNotFoundAt > latest)
        ? card.availabilityLastNotFoundAt
        : latest
    ), null),
    availabilityChangedAt: snapshots.reduce<Date | null>((latest, card) => (
      card.availabilityChangedAt && (!latest || card.availabilityChangedAt > latest)
        ? card.availabilityChangedAt
        : latest
    ), null),
  };
}

export function shouldPublishCcgCardSnapshot(
  latestCard: ExistingCcgSnapshotIdentity | null | undefined,
  next: CcgSnapshotIdentity,
): boolean {
  return !latestCard
    || latestCard.tierGrade !== next.tierGrade
    || !hasSameSnapshotIdentity(latestCard, next)
    || hasGainedMythicPlusScore(latestCard, next);
}

export function nextCcgCardSnapshotVersion(latestCard: { snapshotVersion?: number | null } | null | undefined): number {
  const current = latestCard?.snapshotVersion;
  return Number.isInteger(current) && (current as number) > 0 ? (current as number) + 1 : latestCard ? 2 : 1;
}

export function getCcgSnapshotPreviewDisposition(
  latestCard: ExistingCcgSnapshotIdentity | null | undefined,
  next: CcgSnapshotIdentity,
  hasMedia: boolean,
): CcgSnapshotPreviewDisposition {
  if (!shouldPublishCcgCardSnapshot(latestCard, next)) return "unchanged";
  if (!latestCard) return hasMedia ? "new_character" : "blocked_new_character";
  if (latestCard.tierGrade !== next.tierGrade) return hasMedia ? "rarity_change" : "blocked_rarity_change";
  if (!hasSameSnapshotIdentity(latestCard, next)) return hasMedia ? "identity_change" : "blocked_identity_change";
  return hasMedia ? "mythic_plus_score_added" : "blocked_mythic_plus_score_added";
}

export function summarizeCcgSnapshotPreview(
  candidates: readonly CcgSnapshotPreviewCandidate[],
  latestCards: readonly (ExistingCcgSnapshotIdentity & { characterId: string })[],
): CcgSnapshotPreviewSummary {
  const latestCardByCharacter = new Map(latestCards.map((card) => [card.characterId, card]));
  const gradeDistribution: Record<CcgRegularTierGrade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  let projectedSnapshots = 0;
  let newCharacters = 0;
  let rarityChanges = 0;
  let identityChanges = 0;
  let mythicPlusScoreAdds = 0;
  let unchangedCharacters = 0;
  let blockedByMissingMedia = 0;
  let mediaReady = 0;

  for (const candidate of candidates) {
    gradeDistribution[candidate.tierGrade] += 1;
    if (candidate.hasMedia) mediaReady += 1;

    const disposition = getCcgSnapshotPreviewDisposition(
      latestCardByCharacter.get(candidate.characterId),
      candidate,
      candidate.hasMedia,
    );
    if (disposition === "unchanged") unchangedCharacters += 1;
    if (disposition.startsWith("blocked_")) blockedByMissingMedia += 1;
    if (
      disposition === "new_character"
      || disposition === "rarity_change"
      || disposition === "identity_change"
      || disposition === "mythic_plus_score_added"
    ) projectedSnapshots += 1;
    if (disposition === "new_character") newCharacters += 1;
    if (disposition === "rarity_change") rarityChanges += 1;
    if (disposition === "identity_change") identityChanges += 1;
    if (disposition === "mythic_plus_score_added") mythicPlusScoreAdds += 1;
  }

  return {
    eligibleCharacters: candidates.length,
    projectedSnapshots,
    newCharacters,
    rarityChanges,
    identityChanges,
    mythicPlusScoreAdds,
    unchangedCharacters,
    blockedByMissingMedia,
    mediaReady,
    missingMedia: candidates.length - mediaReady,
    gradeDistribution,
  };
}

function hasSameSnapshotIdentity(latest: ExistingCcgSnapshotIdentity, next: CcgSnapshotIdentity): boolean {
  return latest.classID === next.classID
    && normalizeSpecName(latest.specName) === normalizeSpecName(next.specName)
    && latest.role === next.role;
}

function hasGainedMythicPlusScore(latest: ExistingCcgSnapshotIdentity, next: CcgSnapshotIdentity): boolean {
  return !isActualMythicPlusScore(latest.mythicPlusScore) && isActualMythicPlusScore(next.mythicPlusScore);
}

function isActualMythicPlusScore(score: number | null | undefined): boolean {
  return typeof score === "number" && Number.isFinite(score) && score > 0;
}

function normalizeSpecName(specName: string | null | undefined): string {
  return (specName ?? "").trim().toLowerCase();
}
