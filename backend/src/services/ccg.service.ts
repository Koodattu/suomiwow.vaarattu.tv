import { createHash, randomBytes, randomInt } from "crypto";
import { Request, Response } from "express";
import mongoose, { ClientSession, PipelineStage } from "mongoose";
import {
  CCG_CARDS_PER_PACK,
  CCG_BASE_FINISH_ORDER,
  CCG_CUSTOM_FINISHES,
  CCG_FEATURE_ENABLED,
  CCG_FINISH_ORDER,
  CCG_FINISH_PITY_LIMITS,
  CCG_GUEST_COOKIE,
  CCG_GUEST_COOKIE_MAX_AGE_MS,
  CCG_INITIAL_PACKS,
  CCG_LEADERBOARD_REFRESH_INTERVAL_SECONDS,
  CCG_PACK_BALANCE_VERSION,
  CCG_PACK_RECHARGE_INTERVAL_MINUTES,
  CCG_PACK_RULE_VERSION,
  CCG_PACK_STORAGE_CAP,
  CCG_TIME_ZONE,
  CCG_TIER_GRADES,
  CCG_CONFIGURED_SETS,
  CCG_WEEKLY_AUTOMATION_ENABLED,
  CCG_WEEKLY_PUBLICATION_SCHEDULE,
  CCG_WEEKLY_SNAPSHOT_SCHEDULE,
  CcgArtVariant,
  CcgFinish,
  CcgHistoricalPackMode,
  CcgPackSelectionType,
  CcgTierGrade,
  getCcgPackFinishOrder,
  getCcgRedeemFinishOrder,
} from "../config/ccg";
import {
  MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
  MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
} from "../config/character-eligibility";
import CcgCard, { ICcgCard } from "../models/CcgCard";
import CcgAlternativeArt from "../models/CcgAlternativeArt";
import CcgCommunityCharacter from "../models/CcgCommunityCharacter";
import CcgAnalyticsDaily from "../models/CcgAnalyticsDaily";
import CcgAnalyticsDailyParticipant from "../models/CcgAnalyticsDailyParticipant";
import CcgAnalyticsParticipant from "../models/CcgAnalyticsParticipant";
import CcgAnalyticsSummary from "../models/CcgAnalyticsSummary";
import CcgCollectorProfile, { ICcgShowcaseCard } from "../models/CcgCollectorProfile";
import CcgGuest, { ICcgGuest } from "../models/CcgGuest";
import CcgJobLock from "../models/CcgJobLock";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import { ICcgLeaderboardEntry } from "../models/CcgLeaderboardEntry";
import CcgOwnership, { CcgOwnerType } from "../models/CcgOwnership";
import CcgPackBalance, { ICcgPackBalance } from "../models/CcgPackBalance";
import CcgPackCredit from "../models/CcgPackCredit";
import CcgPackOpening, { ICcgPackOpening, ICcgPackResult } from "../models/CcgPackOpening";
import CcgPackPool from "../models/CcgPackPool";
import CcgQualityProgress, { ICcgQualityProgress } from "../models/CcgQualityProgress";
import CcgRedeemClaim, { ICcgRedeemClaim } from "../models/CcgRedeemClaim";
import CcgRedeemCode, { ICcgRedeemCode } from "../models/CcgRedeemCode";
import CcgShare, { ICcgShare } from "../models/CcgShare";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import CcgSet, { ICcgSet } from "../models/CcgSet";
import Character from "../models/Character";
import CharacterMedia from "../models/CharacterMedia";
import CharacterMechanicsLeaderboard from "../models/CharacterMechanicsLeaderboard";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import Raid from "../models/Raid";
import User from "../models/User";
import TwitchCcgRedemption, { ITwitchCcgRedemption } from "../models/TwitchCcgRedemption";
import {
  CcgAlternativeArtDefinition,
  hasApplicableAlternativeArt,
  normalizeAlternativeArtFilename,
  normalizeQuipAudioFilename,
  normalizeQuipText,
  serializeAlternativeArt,
  serializeQuip,
  serializeOwnershipRows,
} from "../utils/ccg-alternative-art";
import { CcgFinishPity, emptyFinishPity, rollArtVariant, rollOwnedFinish } from "../utils/ccg-random";
import { createCcgShareShortId, resolveCcgShareLookup } from "../utils/ccg-share-id";
import {
  planPackSelections,
  resolveMissingCardNudge,
  selectCommunityCardCandidates,
  shufflePackResults,
  type CcgPackCardPlan,
} from "../utils/ccg-pack";
import { resolveCollectorKey } from "../utils/ccg-identity";
import { getTransferableGuestPacks, resolveGuestClaimOpeningId, verifyGuestLibrary } from "../utils/ccg-guest-library";
import { getCcgLeaderboardScoringRules } from "../utils/ccg-leaderboard";
import { CCG_REDEEM_PACK_GRANT_MAX, normalizeCcgRedeemCode } from "../utils/ccg-redeem";
import { applyPackRecharge, getNextPackRechargeAt, getRechargeTickStart } from "../utils/ccg-recharge";
import { resolveCcgCharacterMechanicsStatus, type CcgCharacterMechanicsRow } from "../utils/ccg-character-check";
import { buildCcgCardSearchCandidates, CcgCardSearchCandidate } from "../utils/ccg-card-search";
import { getHelsinkiDateKey, getNextHelsinkiReset } from "../utils/helsinki-time";
import logger from "../utils/logger";
import { isMongoWriteConflict, retryMongoWriteConflict } from "../utils/mongo-retry";
import { normalizeSearchText, scoreSearchCandidate } from "../utils/search";
import { normalizeRealmSlug } from "../utils/realm";
import {
  buildCcgCollectionReadModel,
  CCG_COLLECTION_READ_MODEL_MISSING_FINISH,
  CCG_COLLECTION_READ_MODEL_VERSION,
  CcgCollectionReadModelCard,
  compareCcgCollectionCards,
  createCcgSeriesKey,
  selectCcgCollectionCard,
} from "./ccg-collection-read-model.service";
import ccgLeaderboardService from "./ccg-leaderboard.service";
import ccgPublisherService from "./ccg-publisher.service";
import characterContinuityService from "./character-continuity.service";
import discordService from "./discord.service";

const CCG_ANALYTICS_KEY = "global";
const CCG_ANALYTICS_SCHEMA_VERSION = 1;
const CCG_ANALYTICS_DETAILED_SCHEMA_VERSION = 1;
const CCG_ANALYTICS_INITIALIZATION_LOCK = "ccg-analytics-initialize-v2";
const CCG_ANALYTICS_INITIALIZATION_TIMEOUT_MS = 30_000;
const CCG_UNIQUE_FINISH_FILTER = "unique";
const CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS = 60_000;
const CCG_COLLECTION_CHARACTER_REFRESH_CHECK_MS = 5_000;
const CCG_ACTIVE_CATALOG_CACHE_MS = 30_000;
const CCG_GUEST_LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;
const CCG_TRANSACTION_WRITE_CONFLICT_MAX_ATTEMPTS = 5;
const CCG_PUBLIC_SET_FIELDS = "_id slug zoneId raidName expansionName state kind enabledAt themeKey theme customFinish backgroundPath packArtOffsetX cardCount publicationWave lastPublishedAt";
const CCG_ACTIVITY_DEFAULT_LIMIT = 20;
const CCG_ACTIVITY_MAX_LIMIT = 40;
const CCG_SHOWCASE_CARD_LIMIT = 3;
const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

export const CCG_ACTIVITY_FILTERS = ["all", "packs", "codes", "twitch"] as const;
export type CcgActivityFilter = (typeof CCG_ACTIVITY_FILTERS)[number];
type CcgActivityKind = "pack" | "code" | "twitch";

const CCG_ACTIVITY_KIND_RANK: Readonly<Record<CcgActivityKind, number>> = {
  pack: 3,
  code: 2,
  twitch: 1,
};

type CcgActivityCursor = {
  occurredAt: Date;
  kind: CcgActivityKind;
  sourceId: mongoose.Types.ObjectId;
};

type CcgActivityPackRecord = Pick<
  ICcgPackOpening,
  "mode" | "selectionType" | "targetSetId" | "sourceSetIds" | "results" | "duplicateRewards" | "createdAt"
> & { _id: mongoose.Types.ObjectId };

type CcgActivityCodeRecord = Pick<
  ICcgRedeemClaim,
  "rewardType" | "packs" | "currentPacks" | "legacyPacks" | "cardId" | "finish" | "artVariant" | "redeemedAt"
> & { _id: mongoose.Types.ObjectId };

type CcgActivityTwitchRecord = Pick<
  ITwitchCcgRedemption,
  "broadcasterLogin" | "rewardTitle" | "rewardKind" | "assignedCard" | "redeemedAt"
> & { _id: mongoose.Types.ObjectId };

type CcgActivityCandidate =
  | { kind: "pack"; sourceId: mongoose.Types.ObjectId; occurredAt: Date; record: CcgActivityPackRecord }
  | { kind: "code"; sourceId: mongoose.Types.ObjectId; occurredAt: Date; record: CcgActivityCodeRecord }
  | { kind: "twitch"; sourceId: mongoose.Types.ObjectId; occurredAt: Date; record: CcgActivityTwitchRecord };

type CcgActivityCardRecord = Pick<
  ICcgCard,
  "_id" | "setId" | "characterId" | "collectorKey" | "name" | "realm" | "classID" | "avatarUrl" | "renderUrl" | "renderFit" | "availabilityStatus" | "tierGrade"
>;
type CcgActivitySetRecord = Pick<
  ICcgSet,
  "_id" | "slug" | "raidName" | "theme" | "backgroundPath" | "packArtOffsetX"
>;

type CcgActivityPackSummaryRow = {
  _id: { selectionType: CcgPackSelectionType; setId: mongoose.Types.ObjectId | null };
  count: number;
};

type CcgActivityFinishSummaryRow = {
  _id: CcgFinish;
  count: number;
};

type CcgShowcaseInput = {
  cardId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
};

export const CCG_COLLECTION_SORTS = [
  "duplicates_desc",
  "rarity_desc",
  "rarity_asc",
  "quality_desc",
  "quality_asc",
  "alphabetical",
  "reverse_alphabetical",
  "damage_desc",
  "damage_asc",
  "mechanics_desc",
  "mechanics_asc",
  "combined_desc",
  "combined_asc",
  "mythic_plus_desc",
  "mythic_plus_asc",
] as const;

export type CcgCollectionSort = (typeof CCG_COLLECTION_SORTS)[number];

type CcgCollectionSortPaths = {
  grade: string;
  name: string;
  realm: string;
  setNumber: string;
  id: string;
};

type CcgCollectionSortExpressions = {
  duplicates: unknown;
  quality: unknown;
  damage: unknown;
  mechanics: unknown;
  combined: unknown;
  mythicPlus: unknown;
};

export function resolveCcgCollectionSort(value: unknown): CcgCollectionSort | null {
  return CCG_COLLECTION_SORTS.includes(value as CcgCollectionSort) ? (value as CcgCollectionSort) : null;
}

export function buildCcgCollectionQualityRank(finishExpression: string): unknown {
  return {
    $switch: {
      branches: [
        { case: { $in: [finishExpression, [...CCG_CUSTOM_FINISHES]] }, then: 5 },
        { case: { $eq: [finishExpression, "negative"] }, then: 6 },
        { case: { $eq: [finishExpression, "astral"] }, then: 7 },
      ],
      default: { $indexOfArray: [[...CCG_BASE_FINISH_ORDER], finishExpression] },
    },
  };
}

export function buildCcgCollectionSortStages(
  sort: CcgCollectionSort,
  paths: CcgCollectionSortPaths,
  expressions: CcgCollectionSortExpressions,
): PipelineStage[] {
  const fallbackSort = { [paths.name]: 1, [paths.realm]: 1, [paths.setNumber]: 1, [paths.id]: 1 } as const;
  if (sort === "alphabetical" || sort === "reverse_alphabetical") {
    const direction = sort === "alphabetical" ? 1 : -1;
    return [{
      $sort: {
        [paths.name]: direction,
        [paths.realm]: direction,
        [paths.setNumber]: 1,
        [paths.id]: 1,
      },
    } as PipelineStage.Sort];
  }

  let sortValue: unknown;
  let direction: 1 | -1;
  switch (sort) {
    case "duplicates_desc":
      sortValue = expressions.duplicates;
      direction = -1;
      break;
    case "rarity_desc":
    case "rarity_asc":
      sortValue = { $indexOfArray: [[...CCG_TIER_GRADES], `$${paths.grade}`] };
      direction = sort === "rarity_desc" ? 1 : -1;
      break;
    case "quality_desc":
    case "quality_asc":
      sortValue = expressions.quality;
      direction = sort === "quality_desc" ? -1 : 1;
      break;
    case "damage_desc":
    case "damage_asc":
      sortValue = expressions.damage;
      direction = sort === "damage_desc" ? -1 : 1;
      break;
    case "mechanics_desc":
    case "mechanics_asc":
      sortValue = expressions.mechanics;
      direction = sort === "mechanics_desc" ? -1 : 1;
      break;
    case "combined_desc":
    case "combined_asc":
      sortValue = expressions.combined;
      direction = sort === "combined_desc" ? -1 : 1;
      break;
    case "mythic_plus_desc":
    case "mythic_plus_asc":
      sortValue = expressions.mythicPlus;
      direction = sort === "mythic_plus_desc" ? -1 : 1;
      break;
  }

  return [
    { $set: { sortValue } },
    { $set: { sortMissing: { $cond: [{ $eq: [{ $ifNull: ["$sortValue", null] }, null] }, 1, 0] } } },
    { $sort: { sortMissing: 1, sortValue: direction, ...fallbackSort } } as PipelineStage.Sort,
    { $unset: ["sortMissing", "sortValue"] },
  ];
}

type CcgOwner = {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  dateKey: string;
};

type CcgPackCardCandidate = {
  cardId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  tierGrade: CcgTierGrade;
};

type CcgPackCardSelection = CcgPackCardCandidate & {
  missingCardAlternatives: CcgPackCardCandidate[];
};

type SelectedResult = {
  cardId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  snapshotVersion: number;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  tierGrade: CcgTierGrade;
  isDuplicate: boolean;
  isNewCard: boolean;
  isNewFinish: boolean;
  isNewSnapshot: boolean;
};

export type CcgExternalCardAward = Pick<
  SelectedResult,
  "cardId" | "setId" | "characterId" | "snapshotVersion" | "finish" | "artVariant" | "tierGrade"
> & { poolVersion: string };

type CcgSeriesRef = {
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
};

type CcgCardOwnershipState = {
  seriesOwned: boolean;
  snapshotOwned: boolean;
};

type CcgCollectionFinishRow = {
  finish: CcgFinish;
  quantity: number;
  alternativeQuantity?: number;
};

type CcgCollectionRow = {
  _id: { setId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId };
  totalQuantity: number;
  finishes: CcgCollectionFinishRow[];
  card: ICcgCard;
  accessibleCards: ICcgCard[];
};

type CcgCollectionRows = {
  items: CcgCollectionRow[];
  count: Array<{ total: number }>;
};

type CcgCollectionReadSeriesRow = {
  _id: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  unlockedSnapshotVersions: number[];
  collectionCardId: mongoose.Types.ObjectId;
};

type CcgPackOpenState = {
  packs: { regularRemaining: number; bonusRemaining: number; totalRemaining: number };
  qualityProtection: CcgFinishPity;
  customQualityProtection: Array<{ setSlug: string; counter: number }>;
  ownedFinishesDelta: number;
  ownedCardsBySetDelta: Record<string, number>;
};

type CcgCompletedCardRewards = {
  total: number;
  rewardedSeriesKeys: Set<string>;
};

type RedeemedCodeSnapshot = {
  code: string;
  rewardType: "packs" | "card";
  packs: number;
  cardId: mongoose.Types.ObjectId | null;
  finish: CcgFinish | null;
  artVariant: CcgArtVariant | null;
};

type CcgCollectionCharacterSearchCandidate = Pick<
  CcgCardSearchCandidate,
  "collectorKey" | "characterId" | "name" | "realm" | "classID" | "publishedAt" | "characterSearchText"
>;

export class CcgServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcgServiceError";
  }
}

function requireFeature(): void {
  if (!CCG_FEATURE_ENABLED) throw new CcgServiceError(404, "feature_disabled", "SuomiWoW CCG is not available");
}

function validateObjectId(value: string, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new CcgServiceError(400, "invalid_id", `Invalid ${label}`);
  return new mongoose.Types.ObjectId(value);
}

function validateFinish(value: unknown): CcgFinish {
  if (typeof value !== "string" || !CCG_FINISH_ORDER.includes(value as CcgFinish)) {
    throw new CcgServiceError(400, "invalid_finish", "Choose a valid card finish");
  }
  return value as CcgFinish;
}

function resolveCollectionFinishMatch(value: unknown): CcgFinish | { $in: CcgFinish[] } | null {
  if (value === CCG_UNIQUE_FINISH_FILTER) return { $in: [...CCG_CUSTOM_FINISHES] };
  return CCG_FINISH_ORDER.includes(value as CcgFinish) ? (value as CcgFinish) : null;
}

function validateArtVariant(value: unknown): CcgArtVariant {
  if (value !== "standard" && value !== "alternative") {
    throw new CcgServiceError(400, "invalid_art_variant", "Choose valid card artwork");
  }
  return value;
}

function validateShareLookup(value: string): { shortId: string } | { publicId: string } {
  const lookup = resolveCcgShareLookup(value);
  if (!lookup) {
    throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
  }
  return lookup;
}

type CcgShareWithShortId = ICcgShare & { shortId: string };

function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 120 || !/^[a-zA-Z0-9:_-]+$/.test(value)) {
    throw new CcgServiceError(400, "invalid_idempotency_key", "A valid idempotency key is required");
  }
  return value;
}

function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getAnalyticsOwnerKey(ownerType: CcgOwnerType, ownerId: mongoose.Types.ObjectId): string {
  return `${ownerType}:${ownerId}`;
}

function getSeriesKey(series: CcgSeriesRef): string {
  return `${series.setId}:${series.characterId}`;
}

function scoreCollectionCharacterNameMatch(search: string, searchText: string[]): number {
  const names = new Set(searchText.map((text) => text.split(" ", 1)[0]).filter(Boolean));
  if (names.has(search)) return 100;
  if ([...names].some((name) => name.startsWith(search))) return 90;
  if ([...names].some((name) => name.includes(search))) return 80;
  return 0;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Transaction numbers are only allowed|replica set|does not support retryable writes/i.test(message);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}

function validatePackGrant(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > CCG_REDEEM_PACK_GRANT_MAX) {
    throw new CcgServiceError(400, "invalid_pack_grant", `${label} packs must be a whole number from 0 to ${CCG_REDEEM_PACK_GRANT_MAX}`);
  }
  return parsed;
}

function getRedeemPackCount(value: { packs?: number; currentPacks?: number; legacyPacks?: number }): number {
  return value.packs ?? (value.currentPacks ?? 0) + (value.legacyPacks ?? 0);
}

export function resolveCcgActivityFilter(value: unknown): CcgActivityFilter | null {
  if (value === undefined || value === null || value === "") return "all";
  return CCG_ACTIVITY_FILTERS.includes(value as CcgActivityFilter) ? value as CcgActivityFilter : null;
}

function validateCcgActivityLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return CCG_ACTIVITY_DEFAULT_LIMIT;
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > CCG_ACTIVITY_MAX_LIMIT) {
    throw new CcgServiceError(400, "invalid_activity_limit", `Activity limit must be a whole number from 1 to ${CCG_ACTIVITY_MAX_LIMIT}`);
  }
  return parsed;
}

function decodeCcgActivityCursor(value: unknown): CcgActivityCursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CcgServiceError(400, "invalid_activity_cursor", "Activity cursor is invalid");
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      version?: unknown;
      occurredAt?: unknown;
      kind?: unknown;
      sourceId?: unknown;
    };
    const occurredAt = typeof parsed.occurredAt === "string" ? new Date(parsed.occurredAt) : null;
    if (
      parsed.version !== 1
      || !occurredAt
      || !Number.isFinite(occurredAt.getTime())
      || !Object.prototype.hasOwnProperty.call(CCG_ACTIVITY_KIND_RANK, String(parsed.kind))
      || typeof parsed.sourceId !== "string"
      || !mongoose.Types.ObjectId.isValid(parsed.sourceId)
    ) {
      throw new Error("Invalid activity cursor payload");
    }
    return {
      occurredAt,
      kind: parsed.kind as CcgActivityKind,
      sourceId: new mongoose.Types.ObjectId(parsed.sourceId),
    };
  } catch {
    throw new CcgServiceError(400, "invalid_activity_cursor", "Activity cursor is invalid");
  }
}

function encodeCcgActivityCursor(candidate: CcgActivityCandidate): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    occurredAt: candidate.occurredAt.toISOString(),
    kind: candidate.kind,
    sourceId: String(candidate.sourceId),
  })).toString("base64url");
}

function buildCcgActivityCursorFilter(
  field: "createdAt" | "redeemedAt",
  kind: CcgActivityKind,
  cursor: CcgActivityCursor | null,
): Record<string, unknown> {
  if (!cursor) return {};
  const clauses: Record<string, unknown>[] = [{ [field]: { $lt: cursor.occurredAt } }];
  const rank = CCG_ACTIVITY_KIND_RANK[kind];
  const cursorRank = CCG_ACTIVITY_KIND_RANK[cursor.kind];
  if (rank < cursorRank) clauses.push({ [field]: cursor.occurredAt });
  if (rank === cursorRank) clauses.push({ [field]: cursor.occurredAt, _id: { $lt: cursor.sourceId } });
  return { $or: clauses };
}

function compareCcgActivityCandidates(left: CcgActivityCandidate, right: CcgActivityCandidate): number {
  return right.occurredAt.getTime() - left.occurredAt.getTime()
    || CCG_ACTIVITY_KIND_RANK[right.kind] - CCG_ACTIVITY_KIND_RANK[left.kind]
    || String(right.sourceId).localeCompare(String(left.sourceId));
}

export function resolveCcgActivityPackSetId(
  selectionType: CcgPackSelectionType | undefined,
  targetSetId: mongoose.Types.ObjectId | null | undefined,
  sourceSetIds: readonly mongoose.Types.ObjectId[],
): mongoose.Types.ObjectId | null {
  if (targetSetId) return targetSetId;
  if (selectionType === "all") return null;
  if (selectionType === "raid") return sourceSetIds[0] ?? null;
  return null;
}

function resolveCcgActivityPackSelectionType(
  selectionType: CcgPackSelectionType | undefined,
  targetSetId: mongoose.Types.ObjectId | null | undefined,
): CcgPackSelectionType {
  return selectionType ?? (targetSetId ? "raid" : "all");
}

class CcgService {
  private analyticsInitialization: Promise<void> | null = null;
  private analyticsReady = false;
  private analyticsDailyBucketKey: string | null = null;
  private packAnalyticsQueue: Promise<void> = Promise.resolve();

  private adminCardSearchCache: {
    expiresAt: number;
    candidates: CcgCardSearchCandidate[];
  } | null = null;

  private collectionCharacterSearchCache: {
    version: string;
    versionCheckedUntil: number;
    candidates: CcgCollectionCharacterSearchCandidate[];
  } | null = null;
  private collectionCharacterSearchPromise: Promise<CcgCollectionCharacterSearchCandidate[]> | null = null;

  private collectionGuildsCache: {
    version: string;
    versionCheckedUntil: number;
    guilds: Array<{ id: string; name: string; realm: string; setIds: string[] }>;
    setIdBySlug: Map<string, string>;
  } | null = null;
  private collectionGuildsPromise: Promise<NonNullable<CcgService["collectionGuildsCache"]>> | null = null;
  private activeCatalogCardIdsCache = new Map<string, { expiresAt: number; cardIds: mongoose.Types.ObjectId[] }>();

  invalidateCardAvailabilityCaches(): void {
    this.activeCatalogCardIdsCache.clear();
  }

  private raidIconCache: { expiresAt: number; iconByZone: Map<number, string | null> } | null = null;
  private raidIconPromise: Promise<Map<number, string | null>> | null = null;

  private async buildCardSearchCandidates(cardFilter: Record<string, unknown> = {}): Promise<CcgCardSearchCandidate[]> {
    const cards = await CcgCard.find(cardFilter)
      .select("_id characterId collectorKey name realm classID guildName publishedAt")
      .lean();
    const continuityGraph = await characterContinuityService.getGraph();
    const canonicalCharacterIdByCharacterId = new Map<string, mongoose.Types.ObjectId>();
    for (const card of cards) {
      canonicalCharacterIdByCharacterId.set(
        String(card.characterId),
        new mongoose.Types.ObjectId(continuityGraph.resolveRoot(card.characterId)),
      );
    }
    const rootCharacterIds = [...new Map(
      [...canonicalCharacterIdByCharacterId.values()].map((id) => [String(id), id]),
    ).values()];
    const currentCharacters = await Character.find({ _id: { $in: rootCharacterIds } })
      .select("_id name")
      .lean();
    const currentNameByRootId = new Map(currentCharacters.map((character) => [String(character._id), character.name]));
    const currentNameByCharacterId = new Map<string, string>();
    for (const [characterId, rootId] of canonicalCharacterIdByCharacterId) {
      const currentName = currentNameByRootId.get(String(rootId));
      if (currentName) currentNameByCharacterId.set(characterId, currentName);
    }
    return buildCcgCardSearchCandidates(cards, currentNameByCharacterId, canonicalCharacterIdByCharacterId);
  }

  private async resolveCollectionCharacterIds(rawCharacterId: string): Promise<mongoose.Types.ObjectId[]> {
    const characterId = validateObjectId(rawCharacterId, "character ID");
    const continuityGraph = await characterContinuityService.getGraph();
    const memberIds = continuityGraph.getMemberIds(characterId).map((id) => new mongoose.Types.ObjectId(id));
    const communityCharacters = await CcgCommunityCharacter.find({ linkedCharacterId: { $in: memberIds } })
      .select("_id")
      .lean();
    return [...new Map([
      ...memberIds,
      ...communityCharacters.map((community) => community._id),
    ].map((id) => [String(id), id])).values()];
  }

  private async resolveCollectionCharacterNameIds(rawSearch: string): Promise<mongoose.Types.ObjectId[]> {
    const normalizedSearch = normalizeSearchText(rawSearch.trim().slice(0, 100));
    if (normalizedSearch.length < 2) return [];
    const candidates = await this.getCollectionCharacterSearchCandidates();
    const matchingCharacterIds = candidates
      .filter((candidate) => scoreCollectionCharacterNameMatch(normalizedSearch, candidate.characterSearchText) > 0)
      .map((candidate) => candidate.characterId);
    if (matchingCharacterIds.length === 0) return [];

    const continuityGraph = await characterContinuityService.getGraph();
    const memberIds = [...new Map(matchingCharacterIds.flatMap((characterId) => (
      continuityGraph.getMemberIds(characterId).map((id) => new mongoose.Types.ObjectId(id))
    )).map((id) => [String(id), id])).values()];
    const communityCharacters = await CcgCommunityCharacter.find({ linkedCharacterId: { $in: memberIds } })
      .select("_id")
      .lean();
    return [...new Map([
      ...memberIds,
      ...communityCharacters.map((community) => community._id),
    ].map((id) => [String(id), id])).values()];
  }

  private async getCollectionCharacterSearchCandidates(): Promise<CcgCollectionCharacterSearchCandidate[]> {
    const now = Date.now();
    if (this.collectionCharacterSearchCache && this.collectionCharacterSearchCache.versionCheckedUntil > now) {
      return this.collectionCharacterSearchCache.candidates;
    }
    if (this.collectionCharacterSearchPromise) return this.collectionCharacterSearchPromise;

    this.collectionCharacterSearchPromise = (async () => {
      const sets = await CcgSet.find({ enabledAt: { $ne: null } })
        .select("_id collectionCharactersBuiltAt")
        .sort({ _id: 1 })
        .lean();
      const setIds = sets.map((set) => set._id);
      const materializationPending = sets.some((set) => !set.collectionCharactersBuiltAt);
      if (materializationPending) {
        void ccgPublisherService.ensureCollectionCharactersMaterialized(setIds).catch((error) => {
          logger.error(`[CCG] Failed to refresh collection character search data: ${error instanceof Error ? error.message : String(error)}`);
        });
      }

      const version = sets
        .map((set) => `${set._id}:${set.collectionCharactersBuiltAt?.getTime() ?? 0}`)
        .join("|");
      if (this.collectionCharacterSearchCache?.version === version) {
        this.collectionCharacterSearchCache.versionCheckedUntil = now + (materializationPending
          ? CCG_COLLECTION_CHARACTER_REFRESH_CHECK_MS
          : CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS);
        return this.collectionCharacterSearchCache.candidates;
      }

      const materializedSets = await CcgSet.find({ _id: { $in: setIds } }).select("collectionCharacters").lean();
      const candidatesByCollector = new Map<string, Omit<CcgCollectionCharacterSearchCandidate, "characterSearchText"> & {
        characterSearchText: Set<string>;
      }>();
      for (const set of materializedSets) {
        for (const candidate of set.collectionCharacters ?? []) {
          const existing = candidatesByCollector.get(candidate.collectorKey);
          if (!existing) {
            candidatesByCollector.set(candidate.collectorKey, {
              collectorKey: candidate.collectorKey,
              characterId: candidate.characterId,
              name: candidate.name,
              realm: candidate.realm,
              classID: candidate.classID,
              publishedAt: candidate.publishedAt,
              characterSearchText: new Set(candidate.searchText),
            });
            continue;
          }
          candidate.searchText.forEach((text) => existing.characterSearchText.add(text));
          if (candidate.publishedAt.getTime() > existing.publishedAt.getTime()) {
            existing.characterId = candidate.characterId;
            existing.name = candidate.name;
            existing.realm = candidate.realm;
            existing.classID = candidate.classID;
            existing.publishedAt = candidate.publishedAt;
          }
        }
      }
      const candidates = Array.from(candidatesByCollector.values(), (candidate) => ({
        ...candidate,
        characterSearchText: Array.from(candidate.characterSearchText),
      }));
      this.collectionCharacterSearchCache = {
        version,
        versionCheckedUntil: now + (materializationPending
          ? CCG_COLLECTION_CHARACTER_REFRESH_CHECK_MS
          : CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS),
        candidates,
      };
      return candidates;
    })().finally(() => {
      this.collectionCharacterSearchPromise = null;
    });

    return this.collectionCharacterSearchPromise;
  }

  async getSession(req: Request, res: Response): Promise<Record<string, unknown>> {
    requireFeature();
    const owner = await this.resolveOwner(req, res);
    return this.buildSession(owner);
  }

  async getBootstrap(req: Request, res: Response): Promise<Record<string, unknown>> {
    requireFeature();
    const owner = await this.resolveOwner(req, res);
    const [session, sets] = await Promise.all([
      this.buildSession(owner),
      this.getSets(owner),
    ]);
    return { session, sets };
  }

  private async buildSession(owner: CcgOwner): Promise<Record<string, unknown>> {
    const now = new Date();
    const [packState, qualityProgress, ownershipCount, sets] = await Promise.all([
      this.getSessionPackState(owner, now),
      CcgQualityProgress.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId }).lean(),
      CcgOwnership.countDocuments({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        setId: { $type: "objectId" },
        characterId: { $type: "objectId" },
      }),
      CcgSet.find({ enabledAt: { $ne: null }, cardCount: { $gt: 0 }, "customFinish.key": { $exists: true } })
        .select("slug raidName customFinish enabledAt cardCount")
        .lean(),
    ]);
    const resetAt = getNextHelsinkiReset();
    const qualityProtection = this.readFinishPity(qualityProgress ?? undefined);

    return {
      ownerType: owner.ownerType,
      dateKey: owner.dateKey,
      resetAt,
      packs: this.serializePackBalances(packState.balance, packState.creditBalances),
      recharge: {
        cap: CCG_PACK_STORAGE_CAP,
        intervalMinutes: CCG_PACK_RECHARGE_INTERVAL_MINUTES,
        nextAt: getNextPackRechargeAt(now).toISOString(),
      },
      qualityProtection,
      customQualityProtection: sets
        .filter((set) => set.enabledAt && set.cardCount > 0 && set.customFinish?.key)
        .map((set) => {
          const counter = this.readCustomFinishPity(qualityProgress ?? undefined, set.slug);
          const hardPity = set.customFinish!.hardPity;
          return {
            setSlug: set.slug,
            raidName: set.raidName,
            finish: set.customFinish!.key,
            counter,
            hardPity,
          };
        }),
      ownedFinishes: ownershipCount,
    };
  }

  async getAnalytics(): Promise<{ uniqueUsers: number; packOpenings: number; cardsRevealed: number }> {
    requireFeature();
    await this.ensureAnalyticsInitialized();
    const summary = await CcgAnalyticsSummary.findOne({
      key: CCG_ANALYTICS_KEY,
      schemaVersion: CCG_ANALYTICS_SCHEMA_VERSION,
    }).lean();
    if (!summary) throw new CcgServiceError(503, "analytics_unavailable", "Vault activity is temporarily unavailable");
    return {
      uniqueUsers: summary.uniqueUsers,
      packOpenings: summary.packOpenings,
      cardsRevealed: summary.packOpenings * CCG_CARDS_PER_PACK,
    };
  }

  async getAnalyticsForAdmin(rawDays: unknown): Promise<Record<string, unknown>> {
    requireFeature();
    const days = rawDays === undefined ? 30 : Number(rawDays);
    if (![7, 30, 90].includes(days)) {
      throw new CcgServiceError(400, "invalid_analytics_range", "Analytics range must be 7, 30, or 90 days");
    }
    await this.ensureAnalyticsInitialized();

    const endDateKey = getHelsinkiDateKey();
    const startDateKey = shiftDateKey(endDateKey, -(days - 1));
    const rows = await CcgAnalyticsDaily.find({ dateKey: { $gte: startDateKey, $lte: endDateKey } })
      .sort({ dateKey: 1 })
      .lean();
    const rowByDate = new Map(rows.map((row) => [row.dateKey, row]));
    const series = Array.from({ length: days }, (_, index) => {
      const dateKey = shiftDateKey(startDateKey, index);
      const row = rowByDate.get(dateKey);
      return {
        date: dateKey,
        packOpenings: row?.packOpenings ?? 0,
        activeUsers: row?.activeUsers ?? 0,
      };
    });

    const finishes = Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, 0])) as Record<CcgFinish, number>;
    const grades = Object.fromEntries(CCG_TIER_GRADES.map((grade) => [grade, 0])) as Record<CcgTierGrade, number>;
    let packOpenings = 0;
    for (const row of rows) {
      packOpenings += row.packOpenings;
      CCG_FINISH_ORDER.forEach((finish) => { finishes[finish] += row.finishes?.[finish] ?? 0; });
      CCG_TIER_GRADES.forEach((grade) => { grades[grade] += row.grades?.[grade] ?? 0; });
    }
    const cardsRevealed = Object.values(finishes).reduce((total, count) => total + count, 0);

    return {
      rangeDays: days,
      series,
      totals: {
        packOpenings,
        cardsRevealed,
        activeUsersToday: series[series.length - 1]?.activeUsers ?? 0,
        averageDailyOpenings: packOpenings / days,
      },
      qualities: CCG_FINISH_ORDER.map((finish) => ({
        key: finish,
        count: finishes[finish],
        rate: cardsRevealed > 0 ? finishes[finish] / cardsRevealed : 0,
      })),
      rarities: CCG_TIER_GRADES.map((grade) => ({
        key: grade,
        count: grades[grade],
        rate: cardsRevealed > 0 ? grades[grade] / cardsRevealed : 0,
      })),
    };
  }

  async getLeaderboard(): Promise<Record<string, unknown>> {
    requireFeature();
    const entries = await ccgLeaderboardService.list(100);
    const showcases = await this.loadLeaderboardShowcases(entries.map((entry) => entry.userId));
    return {
      scoreVersion: getCcgLeaderboardScoringRules().version,
      calculatedAt: entries[0]?.calculatedAt ?? null,
      refreshIntervalSeconds: CCG_LEADERBOARD_REFRESH_INTERVAL_SECONDS,
      scoring: getCcgLeaderboardScoringRules(),
      entries: entries.map((entry) => this.serializeLeaderboardEntry(entry, showcases.get(String(entry.userId)) ?? [])),
    };
  }

  async getLeaderboardRecords(): Promise<Record<string, unknown>> {
    requireFeature();
    const records = await ccgLeaderboardService.listRecords();
    return {
      scoreVersion: getCcgLeaderboardScoringRules().version,
      calculatedAt: records.calculatedAt,
      refreshIntervalSeconds: CCG_LEADERBOARD_REFRESH_INTERVAL_SECONDS,
      boards: records.boards,
    };
  }

  async getLeaderboardMe(req: Request): Promise<Record<string, unknown>> {
    requireFeature();
    const userId = await this.requireAuthenticatedUser(req, "Log in to join the collection leaderboard");
    const [entry, showcases] = await Promise.all([
      ccgLeaderboardService.getUserIfReady(userId),
      this.loadLeaderboardShowcases([userId]),
    ]);
    const showcase = showcases.get(String(userId)) ?? [];
    return {
      entry: entry ? this.serializeLeaderboardEntry(entry, showcase) : null,
      showcase,
    };
  }

  async updateLeaderboardShowcase(req: Request, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    const userId = await this.requireAuthenticatedUser(req, "Log in to choose showcase cards");
    const showcase = this.validateShowcase(body.cards);
    if (showcase.length > 0) {
      const cardIds = showcase.map((item) => item.cardId);
      const cards = await CcgCard.find({ _id: { $in: cardIds } }).lean();
      if (cards.length !== showcase.length) {
        throw new CcgServiceError(400, "invalid_showcase", "Every showcase card must exist");
      }
      const enabledSetIds = new Set((await CcgSet.find({
        _id: { $in: cards.map((card) => card.setId) },
        enabledAt: { $ne: null },
      }).select("_id").lean()).map((set) => String(set._id)));
      if (cards.some((card) => !enabledSetIds.has(String(card.setId)))) {
        throw new CcgServiceError(400, "invalid_showcase", "Every showcase card must be from an enabled set");
      }

      const cardById = new Map(cards.map((card) => [String(card._id), card]));
      const seriesPairs = cards.map((card) => ({ setId: card.setId, characterId: card.characterId }));
      const [seriesRows, finishRows, alternativeByCollector, alternativeSeries] = await Promise.all([
        CcgSeriesOwnership.find({ ownerType: "user", ownerId: userId, $or: seriesPairs })
          .select("setId characterId unlockedSnapshotVersions")
          .lean(),
        CcgOwnership.find({
          ownerType: "user",
          ownerId: userId,
          $or: showcase.map((item) => {
            const card = cardById.get(String(item.cardId))!;
            return { setId: card.setId, characterId: card.characterId, finish: item.finish, quantity: { $gt: 0 } };
          }),
        }).select("setId characterId finish").lean(),
        this.loadAlternativeArt(cards),
        this.loadAlternativeArtUnlocks({ ownerType: "user", ownerId: userId }, cards),
      ]);
      const unlockedVersionsBySeries = new Map(seriesRows.map((row) => [getSeriesKey(row), new Set(row.unlockedSnapshotVersions)]));
      const ownedFinishes = new Set(finishRows.map((row) => `${getSeriesKey(row)}:${row.finish}`));
      for (const item of showcase) {
        const card = cardById.get(String(item.cardId))!;
        const seriesKey = getSeriesKey(card);
        if (!unlockedVersionsBySeries.get(seriesKey)?.has(card.snapshotVersion) || !ownedFinishes.has(`${seriesKey}:${item.finish}`)) {
          throw new CcgServiceError(403, "showcase_card_not_owned", "Only cards in your collection can be showcased");
        }
        if (item.artVariant === "alternative") {
          const collectorKey = resolveCollectorKey(card);
          if (
            !alternativeSeries.has(seriesKey)
            || !hasApplicableAlternativeArt(alternativeByCollector.get(collectorKey), Boolean(card.communityCharacterId))
          ) {
            throw new CcgServiceError(403, "showcase_card_not_owned", "Only cards in your collection can be showcased");
          }
        }
      }
    }

    await CcgCollectorProfile.findOneAndUpdate(
      { userId },
      { $set: { showcase } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    return this.getLeaderboardMe(req);
  }

  async refreshLeaderboard(mode: "full" | "incremental" = "full") {
    requireFeature();
    return ccgLeaderboardService.refresh(mode);
  }

  async getSets(owner?: CcgOwner): Promise<Record<string, unknown>[]> {
    requireFeature();
    const visibleSets = await CcgSet.find({ enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
      .select(CCG_PUBLIC_SET_FIELDS)
      .sort({ zoneId: 1 })
      .lean();
    const [rows, iconByZone] = await Promise.all([
      owner ? CcgSeriesOwnership.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        { $match: { ownerType: owner.ownerType, ownerId: owner.ownerId } },
        {
          $lookup: {
            from: CcgCard.collection.name,
            let: { setId: "$setId", characterId: "$characterId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$setId", "$$setId"] },
                      { $eq: ["$characterId", "$$characterId"] },
                    ],
                  },
                },
              },
              { $sort: { snapshotVersion: -1, publishedAt: -1, _id: -1 } },
              { $limit: 1 },
              { $project: { _id: 0, availabilityStatus: { $ifNull: ["$availabilityStatus", "active"] } } },
            ],
            as: "cardAvailability",
          },
        },
        { $match: { "cardAvailability.availabilityStatus": { $ne: "archived" } } },
        { $group: { _id: "$setId", count: { $sum: 1 } } },
      ]) : Promise.resolve([]),
      this.getRaidIconByZone(visibleSets.map((set) => set.zoneId)),
    ]);
    const ownedBySet = new Map(rows.map((row) => [String(row._id), row.count]));
    return visibleSets.map((set) => ({
      ...this.serializeSet(set, ownedBySet.get(String(set._id)) ?? 0),
      iconUrl: iconByZone.get(set.zoneId) ?? null,
    }));
  }

  async checkCharacter(rawName: unknown, rawRealm: unknown): Promise<Record<string, unknown>> {
    requireFeature();
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 50) : "";
    const realm = typeof rawRealm === "string" ? normalizeRealmSlug(rawRealm).slice(0, 80) : "";
    if (name.length < 2 || realm.length < 2) {
      throw new CcgServiceError(400, "invalid_character", "Enter a character name and realm");
    }

    const character = await Character.findOne({
      region: "eu",
      $or: [
        { name, realm },
        { "blizzardIdentityOverride.name": name, "blizzardIdentityOverride.realm": realm },
      ],
    })
      .collation(CASE_INSENSITIVE_COLLATION)
      .sort({ lastReportSeenAt: -1, updatedAt: -1 })
      .select("_id name realm region classID guildName lastReportSeenAt")
      .lean();

    if (!character) {
      return {
        found: false,
        query: { name, realm },
      };
    }

    const continuityGraph = await characterContinuityService.getGraph();
    const rootCharacterId = continuityGraph.resolveRoot(character._id);
    const memberCharacterIds = continuityGraph.getMemberIds(character._id).map((characterId) => new mongoose.Types.ObjectId(characterId));
    const clusterCharacters = await Character.find({ _id: { $in: memberCharacterIds } })
      .select("_id name realm region classID guildName lastReportSeenAt")
      .lean();
    const rootCharacter = clusterCharacters.find((candidate) => String(candidate._id) === rootCharacterId) ?? character;
    const lastRaidedAt = clusterCharacters.reduce<Date | null>((latest, candidate) => {
      if (!candidate.lastReportSeenAt) return latest;
      return !latest || candidate.lastReportSeenAt > latest ? candidate.lastReportSeenAt : latest;
    }, null);

    const zoneIds = CCG_CONFIGURED_SETS.map((set) => set.zoneId);
    const [entries, mechanicsRows, participationRows, mediaRows, cards, sets] = await Promise.all([
      CharacterTierListEntry.find({
        characterId: { $in: memberCharacterIds },
        scope: "global",
        zoneId: { $in: zoneIds },
      }).lean(),
      CharacterMechanicsLeaderboard.find({
        characterId: { $in: memberCharacterIds },
        zoneId: { $in: zoneIds },
        difficulty: 5,
        type: "overall",
        encounterId: null,
      })
        .select("zoneId pulls score parseScore survivalScore")
        .lean(),
      CharacterRaidParticipation.find({
        characterId: { $in: memberCharacterIds },
        zoneId: { $in: zoneIds },
      })
        .select("zoneId reportCount mythicReportCount")
        .lean(),
      CharacterMedia.find({ characterId: { $in: memberCharacterIds } })
        .select("characterId status avatarUrl renderAssetId renderAssetExpiresAt lastErrorCode")
        .lean(),
      CcgCard.find({ characterId: { $in: memberCharacterIds } })
        .sort({ publishedAt: -1, snapshotVersion: -1 })
        .select("_id setId tierGrade snapshotVersion publishedAt")
        .lean(),
      CcgSet.find().select("_id slug zoneId raidName state kind enabledAt cardCount").lean(),
    ]);

    const rootMedia = mediaRows.find((row) => String(row.characterId) === rootCharacterId);
    const now = new Date();
    const hasStoredRender = (row: (typeof mediaRows)[number] | null | undefined) => Boolean(
      row?.status === "available"
      && row.renderAssetId
      && row.renderAssetExpiresAt
      && row.renderAssetExpiresAt > now,
    );
    const availableMedia = mediaRows.find(hasStoredRender);
    const media = hasStoredRender(rootMedia)
      ? rootMedia
      : availableMedia ?? rootMedia ?? mediaRows[0] ?? null;

    const entryByZone = new Map<number, (typeof entries)[number]>();
    for (const entry of entries) {
      const current = entryByZone.get(entry.zoneId);
      const entryScoresReady = [entry.score, entry.parseScore, entry.survivalScore].every((score) => typeof score === "number" && Number.isFinite(score));
      const currentScoresReady = current
        ? [current.score, current.parseScore, current.survivalScore].every((score) => typeof score === "number" && Number.isFinite(score))
        : false;
      if (
        !current
        || (entryScoresReady && !currentScoresReady)
        || (entryScoresReady === currentScoresReady && (entry.pulls > current.pulls || (entry.pulls === current.pulls && entry.score > current.score)))
      ) {
        entryByZone.set(entry.zoneId, entry);
      }
    }
    const mechanicsByZone = new Map<number, CcgCharacterMechanicsRow[]>();
    for (const row of mechanicsRows) {
      const zoneRows = mechanicsByZone.get(row.zoneId) ?? [];
      zoneRows.push(row);
      mechanicsByZone.set(row.zoneId, zoneRows);
    }
    const participationByZone = new Map<number, { reportCount: number; mythicReportCount: number }>();
    for (const row of participationRows) {
      const aggregate = participationByZone.get(row.zoneId) ?? { reportCount: 0, mythicReportCount: 0 };
      aggregate.reportCount += Math.max(0, row.reportCount ?? 0);
      aggregate.mythicReportCount += Math.max(0, row.mythicReportCount ?? 0);
      participationByZone.set(row.zoneId, aggregate);
    }

    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const cardsBySet = new Map<string, typeof cards>();
    for (const card of cards) {
      const setId = String(card.setId);
      const setCards = cardsBySet.get(setId) ?? [];
      setCards.push(card);
      cardsBySet.set(setId, setCards);
    }
    const existingCards = Array.from(cardsBySet.entries()).flatMap(([setId, setCards]) => {
      const set = setById.get(setId);
      const latest = setCards[0];
      if (!set || !latest) return [];
      return [{
        id: String(latest._id),
        characterId: rootCharacterId,
        setSlug: set.slug,
        raidName: set.raidName,
        kind: set.kind,
        state: set.state,
        tierGrade: latest.tierGrade,
        snapshotCount: setCards.length,
        publishedAt: latest.publishedAt,
      }];
    });

    const cardZoneIds = new Set(
      existingCards.flatMap((card) => {
        const set = sets.find((candidate) => candidate.slug === card.setSlug);
        return set?.kind === "raid" ? [set.zoneId] : [];
      }),
    );
    const relevantZoneIds = new Set([
      ...entries.map((entry) => entry.zoneId),
      ...mechanicsRows.map((row) => row.zoneId),
      ...participationRows.map((row) => row.zoneId),
      ...cardZoneIds,
    ]);
    const mediaStatus = !media
      ? "untracked"
      : media.status === "available" && !hasStoredRender(media)
        ? "render_missing"
        : media.status;
    const mediaReady = mediaStatus === "available";
    const raidSetByZone = new Map(
      sets.filter((set) => set.kind === "raid").map((set) => [set.zoneId, set]),
    );
    const raids = CCG_CONFIGURED_SETS
      .filter((set) => relevantZoneIds.has(set.zoneId))
      .map((set) => {
        const storedSet = raidSetByZone.get(set.zoneId);
        const entry = entryByZone.get(set.zoneId);
        const participation = participationByZone.get(set.zoneId);
        const mythicReports = participation?.mythicReportCount ?? 0;
        const mechanicsStatus = resolveCcgCharacterMechanicsStatus(mechanicsByZone.get(set.zoneId) ?? [], entry);
        const { pulls, scoresReady } = mechanicsStatus;
        const eligible = mythicReports >= MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY
          && mechanicsStatus.eligible;
        const hasCard = Boolean(storedSet && cardsBySet.has(String(storedSet._id)));
        const weeklyPublicationEnabled = Boolean(
          CCG_WEEKLY_AUTOMATION_ENABLED
          && storedSet
          && storedSet.enabledAt
          && storedSet.cardCount > 0
          && (storedSet.state === "current" || storedSet.state === "legacy"),
        );
        const blockers = [
          ...(mythicReports < MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY ? ["mythic_reports" as const] : []),
          ...(pulls < MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY ? ["mythic_pulls" as const] : []),
          ...(!scoresReady ? ["scores" as const] : []),
          ...(!mediaReady ? ["media" as const] : []),
        ];
        return {
          zoneId: set.zoneId,
          raidName: set.raidName,
          state: set.state,
          eligible,
          ready: eligible && mediaReady,
          hasCard,
          publicationEstimate: eligible && mediaReady && !hasCard && weeklyPublicationEnabled
            ? {
                snapshotTime: CCG_WEEKLY_SNAPSHOT_SCHEDULE.localTime,
                publicationTime: CCG_WEEKLY_PUBLICATION_SCHEDULE.localTime,
                timeZone: CCG_TIME_ZONE,
              }
            : null,
          blockers,
          mythicReports,
          pulls,
          scoresReady,
        };
      })
      .sort((left, right) => right.zoneId - left.zoneId);

    return {
      found: true,
      query: { name, realm },
      character: {
        id: rootCharacterId,
        name: rootCharacter.name,
        realm: rootCharacter.realm,
        region: rootCharacter.region,
        classID: rootCharacter.classID,
        guildName: rootCharacter.guildName ?? null,
        avatarUrl: media?.avatarUrl ?? null,
        lastRaidedAt,
      },
      eligible: raids.some((raid) => raid.eligible),
      ready: raids.some((raid) => raid.ready),
      media: {
        status: mediaStatus,
        ready: mediaReady,
        lastErrorCode: media?.lastErrorCode ?? null,
      },
      thresholds: {
        mythicReports: MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
        pulls: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
      },
      raids,
      cards: existingCards.sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime()),
    };
  }

  private async getRaidIconByZone(zoneIds: number[]): Promise<Map<number, string | null>> {
    if (this.raidIconCache && this.raidIconCache.expiresAt > Date.now()) return this.raidIconCache.iconByZone;
    if (this.raidIconPromise) return this.raidIconPromise;
    this.raidIconPromise = Raid.find({ id: { $in: zoneIds } })
      .select("id iconUrl -_id")
      .lean()
      .then((raids) => {
        const iconByZone = new Map(raids.map((raid) => [raid.id, raid.iconUrl ?? null]));
        this.raidIconCache = { expiresAt: Date.now() + 24 * 60 * 60 * 1000, iconByZone };
        return iconByZone;
      })
      .finally(() => {
        this.raidIconPromise = null;
      });
    return this.raidIconPromise;
  }

  async getCollectionGuilds(setSlug?: string): Promise<Record<string, unknown>> {
    requireFeature();
    const cache = await this.getCollectionGuildCache();
    const requestedSetId = setSlug ? cache.setIdBySlug.get(setSlug) : null;
    if (setSlug && !requestedSetId) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    return {
      guilds: requestedSetId
        ? cache.guilds.filter((guild) => guild.setIds.includes(requestedSetId))
        : cache.guilds,
    };
  }

  private async getCollectionGuildCache(): Promise<NonNullable<CcgService["collectionGuildsCache"]>> {
    const now = Date.now();
    if (this.collectionGuildsCache && this.collectionGuildsCache.versionCheckedUntil > now) {
      return this.collectionGuildsCache;
    }
    if (this.collectionGuildsPromise) return this.collectionGuildsPromise;

    this.collectionGuildsPromise = (async () => {
      let sets = await CcgSet.find({ enabledAt: { $ne: null } })
        .select("_id slug collectionGuilds collectionGuildsBuiltAt")
        .sort({ _id: 1 })
        .lean();
      const missingSetIds = sets.filter((set) => !set.collectionGuildsBuiltAt).map((set) => set._id);
      if (missingSetIds.length > 0) {
        await ccgPublisherService.ensureCollectionGuildsMaterialized(missingSetIds);
        sets = await CcgSet.find({ enabledAt: { $ne: null } })
          .select("_id slug collectionGuilds collectionGuildsBuiltAt")
          .sort({ _id: 1 })
          .lean();
      }

      const version = sets.map((set) => `${set._id}:${set.collectionGuildsBuiltAt?.getTime() ?? 0}`).join("|");
      if (this.collectionGuildsCache?.version === version) {
        this.collectionGuildsCache.versionCheckedUntil = now + CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS;
        return this.collectionGuildsCache;
      }

      const guildsById = new Map<string, { id: string; name: string; realm: string; setIds: Set<string> }>();
      const setIdBySlug = new Map<string, string>();
      for (const set of sets) {
        const setId = String(set._id);
        setIdBySlug.set(set.slug, setId);
        for (const guild of set.collectionGuilds ?? []) {
          const id = String(guild.guildId);
          const existing = guildsById.get(id);
          if (existing) {
            existing.setIds.add(setId);
          } else {
            guildsById.set(id, { id, name: guild.name, realm: guild.realm, setIds: new Set([setId]) });
          }
        }
      }
      this.collectionGuildsCache = {
        version,
        versionCheckedUntil: now + CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS,
        guilds: Array.from(guildsById.values(), (guild) => ({ ...guild, setIds: [...guild.setIds] }))
          .sort((left, right) => left.name.localeCompare(right.name) || left.realm.localeCompare(right.realm)),
        setIdBySlug,
      };
      return this.collectionGuildsCache;
    })().finally(() => {
      this.collectionGuildsPromise = null;
    });
    return this.collectionGuildsPromise;
  }

  private async getActiveCatalogCardIds(
    sets: ReadonlyArray<Pick<ICcgSet, "_id" | "cardCount"> | Record<string, any>>,
  ): Promise<mongoose.Types.ObjectId[] | null> {
    const cacheKey = sets
      .map((set) => `${String(set._id)}:${set.cardCount}`)
      .sort()
      .join("|");
    const cached = this.activeCatalogCardIdsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.cardIds;

    const pools = await CcgPackPool.find({ setId: { $in: sets.map((set) => set._id) }, active: true })
      .select("setId buckets.cardIds totalCards updatedAt")
      .sort({ updatedAt: -1 })
      .lean();
    const poolBySet = new Map<string, (typeof pools)[number]>();
    for (const pool of pools) {
      const setId = String(pool.setId);
      if (!poolBySet.has(setId)) poolBySet.set(setId, pool);
    }
    const cardIds: mongoose.Types.ObjectId[] = [];
    for (const set of sets) {
      const pool = poolBySet.get(String(set._id));
      if (!pool || pool.totalCards !== set.cardCount) return null;
      const setCardIds = pool.buckets.flatMap((bucket) => bucket.cardIds);
      if (setCardIds.length !== pool.totalCards) return null;
      cardIds.push(...setCardIds);
    }
    if (this.activeCatalogCardIdsCache.size >= 20) this.activeCatalogCardIdsCache.clear();
    this.activeCatalogCardIdsCache.set(cacheKey, {
      expiresAt: Date.now() + CCG_ACTIVE_CATALOG_CACHE_MS,
      cardIds,
    });
    return cardIds;
  }

  async getCatalog(
    owner: CcgOwner,
    setSlug: string | undefined,
    options: { page?: number; limit?: number; owned?: string; grade?: string; finish?: string; guildId?: string; characterId?: string; characterName?: string; sort?: string },
  ): Promise<Record<string, unknown>> {
    const requestedSet = setSlug
      ? await CcgSet.findOne({ slug: setSlug, enabledAt: { $ne: null } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .lean()
      : null;
    if (setSlug && !requestedSet) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    const sets = requestedSet
      ? [requestedSet]
      : await CcgSet.find({ enabledAt: { $ne: null } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .lean();
    if (sets.length === 0) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    const set = requestedSet ?? undefined;
    const setById = new Map(sets.map((item) => [String(item._id), item]));
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(45, Math.max(1, Math.floor(options.limit ?? 9)));
    const grade = CCG_TIER_GRADES.includes(options.grade as CcgTierGrade) ? (options.grade as CcgTierGrade) : null;
    const sort = resolveCcgCollectionSort(options.sort);
    const qualitySort = sort === "quality_desc" || sort === "quality_asc";
    const ownershipSort = qualitySort || sort === "duplicates_desc";
    const communitySetIds = sets.filter((item) => item.kind === "community").map((item) => item._id);
    const finishMatch = resolveCollectionFinishMatch(options.finish);
    const cardFilter: Record<string, unknown> = {};
    if (grade) cardFilter.tierGrade = grade;
    if (options.guildId) cardFilter.guildId = validateObjectId(options.guildId, "guild ID");
    if (options.characterId) cardFilter.characterId = { $in: await this.resolveCollectionCharacterIds(options.characterId) };
    else if (options.characterName) cardFilter.characterId = { $in: await this.resolveCollectionCharacterNameIds(options.characterName) };

    const ownershipFilter = options.owned === "owned" || options.owned === "missing" || Boolean(finishMatch);
    const includeOwned = options.owned === "owned" || Boolean(finishMatch);
    const missingSeriesOnly = options.owned === "missing" && !finishMatch;
    const needsFinishOwnership = Boolean(finishMatch) || (ownershipSort && !missingSeriesOnly);
    const needsCatalogOwnership = ownershipFilter || ownershipSort;
    const characterFilter = cardFilter.characterId;
    const remainingCardFilter = { ...cardFilter };
    delete remainingCardFilter.characterId;
    const activeCardIds = await this.getActiveCatalogCardIds(sets);
    const currentCardStages: PipelineStage[] = activeCardIds
      ? [{ $match: { _id: { $in: activeCardIds }, ...(characterFilter ? { characterId: characterFilter } : {}) } }]
      : [
          {
            $match: {
              setId: set ? set._id : { $in: sets.map((item) => item._id) },
              availabilityStatus: { $ne: "archived" },
              ...(characterFilter ? { characterId: characterFilter } : {}),
            },
          },
          { $sort: { snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 } },
          { $group: { _id: { setId: "$setId", characterId: "$characterId" }, card: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$card" } },
        ];
    const catalog = await CcgCard.aggregate<{
      items: ICcgCard[];
      count: Array<{ total: number }>;
    }>([
      ...currentCardStages,
      ...(Object.keys(remainingCardFilter).length > 0 ? [{ $match: remainingCardFilter }] : []),
      ...(needsCatalogOwnership ? [
        {
          $lookup: {
            from: "ccgseriesownerships",
            let: { setId: "$setId", characterId: "$characterId", snapshotVersion: "$snapshotVersion" },
            pipeline: [
              {
                $match: {
                  ownerType: owner.ownerType,
                  ownerId: owner.ownerId,
                  $expr: {
                    $and: [
                      { $eq: ["$setId", "$$setId"] },
                      { $eq: ["$characterId", "$$characterId"] },
                      ...(missingSeriesOnly ? [] : [{ $in: ["$$snapshotVersion", "$unlockedSnapshotVersions"] }]),
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: "catalogOwnership",
          },
        },
      ] : []),
      ...(needsFinishOwnership ? [
        {
          $lookup: {
            from: "ccgownerships",
            let: { setId: "$setId", characterId: "$characterId" },
            pipeline: [
              {
                $match: {
                  ownerType: owner.ownerType,
                  ownerId: owner.ownerId,
                  ...(finishMatch ? { finish: finishMatch } : {}),
                  $expr: {
                    $and: [
                      { $eq: ["$setId", "$$setId"] },
                      { $eq: ["$characterId", "$$characterId"] },
                    ],
                  },
                },
              },
              { $project: { _id: 0, finish: 1, quantity: 1 } },
            ],
            as: "seriesOwnership",
          },
        },
        {
          $set: {
            seriesOwnership: {
              $cond: [
                { $gt: [{ $size: "$catalogOwnership" }, 0] },
                "$seriesOwnership",
                [],
              ],
            },
          },
        },
      ] : []),
      ...(ownershipFilter ? [{
        $match: {
          [needsFinishOwnership ? "seriesOwnership.0" : "catalogOwnership.0"]: { $exists: includeOwned },
        },
      }] : []),
      ...(sort
        ? buildCcgCollectionSortStages(sort, {
            grade: "tierGrade",
            name: "name",
            realm: "realm",
            setNumber: "setNumber",
            id: "_id",
          }, {
            duplicates: { $sum: "$seriesOwnership.quantity" },
            quality: {
              $max: {
                $map: {
                  input: "$seriesOwnership",
                  as: "owned",
                  in: buildCcgCollectionQualityRank("$$owned.finish"),
                },
              },
            },
            damage: { $cond: [{ $in: ["$setId", communitySetIds] }, "$communityScores.performance", "$parseScore"] },
            mechanics: { $cond: [{ $in: ["$setId", communitySetIds] }, "$communityScores.mechanics", "$survivalScore"] },
            combined: { $cond: [{ $in: ["$setId", communitySetIds] }, "$communityScores.combined", "$combinedScore"] },
            mythicPlus: { $cond: [{ $in: ["$setId", communitySetIds] }, "$communityScores.mythicPlus", "$mythicPlusScore"] },
          })
        : set
        ? [{ $sort: { setNumber: 1 as const } }]
        : [
            { $set: { sortGrade: { $indexOfArray: [[...CCG_TIER_GRADES], "$tierGrade"] } } },
            { $sort: { sortGrade: 1 as const, setNumber: 1 as const, name: 1 as const, _id: 1 as const } },
          ]),
      ...(needsCatalogOwnership ? [{ $unset: ["seriesOwnership", "catalogOwnership"] }] : []),
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          count: [{ $count: "total" }],
        },
      },
    ]).then((result) => result[0] ?? { items: [], count: [] });
    const cards = catalog.items;
    const total = catalog.count[0]?.total ?? 0;
    const seriesPairs = cards.map((card) => ({ setId: card.setId, characterId: card.characterId }));
    const [ownership, snapshotOwnership, alternativeByCollector, unlockedAlternativeSeries, ownedSeriesCount] = await Promise.all([
      seriesPairs.length > 0 && !missingSeriesOnly
        ? CcgOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, $or: seriesPairs }).lean()
        : Promise.resolve([]),
      seriesPairs.length > 0
        ? CcgSeriesOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, $or: seriesPairs })
            .select("setId characterId unlockedSnapshotVersions -_id")
            .lean()
        : Promise.resolve([]),
      this.loadAlternativeArt(cards),
      missingSeriesOnly ? Promise.resolve(new Set<string>()) : this.loadAlternativeArtUnlocks(owner, cards),
      set ? this.countActiveOwnedSeries(owner, [set._id]) : Promise.resolve(0),
    ]);
    const ownershipBySeries = new Map<string, Array<{ finish: CcgFinish; quantity: number; alternativeQuantity?: number }>>();
    for (const row of ownership) {
      const key = getSeriesKey(row);
      const list = ownershipBySeries.get(key) ?? [];
      list.push({ finish: row.finish, quantity: row.quantity, alternativeQuantity: row.alternativeQuantity });
      ownershipBySeries.set(key, list);
    }
    const unlockedVersionsBySeries = new Map(
      snapshotOwnership.map((row) => [getSeriesKey(row), new Set(row.unlockedSnapshotVersions)]),
    );

    const responseSets = set
      ? [{ ...this.serializeSet(set, ownedSeriesCount) }]
      : Array.from(new Set(cards.map((card) => String(card.setId))))
          .flatMap((setId) => {
            const cardSet = setById.get(setId);
            return cardSet ? [this.serializeSet(cardSet)] : [];
          });
    return {
      sets: responseSets,
      cards: cards.map((card) => {
        const cardSet = setById.get(String(card.setId));
        if (!cardSet) throw new CcgServiceError(500, "set_not_found", "Card set not found");
        const collectorKey = resolveCollectorKey(card);
        const alternativeArt = alternativeByCollector.get(collectorKey);
        const unlockedVersions = unlockedVersionsBySeries.get(getSeriesKey(card));
        const snapshotUnlocked = unlockedVersions?.has(card.snapshotVersion) ?? false;
        const alternativeArtUnlocked = snapshotUnlocked && unlockedAlternativeSeries.has(getSeriesKey(card))
          && hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId));
        return {
          ...this.serializeCard(card, cardSet, alternativeArt, {
            seriesOwned: Boolean(unlockedVersions),
            snapshotOwned: snapshotUnlocked,
          }),
          ownership: serializeOwnershipRows(
            snapshotUnlocked ? ownershipBySeries.get(getSeriesKey(card)) ?? [] : [],
            alternativeArtUnlocked,
          ),
        };
      }),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async getFeaturedCard(owner: CcgOwner, setSlug: string): Promise<Record<string, unknown>> {
    const set = await CcgSet.findOne({ slug: setSlug, enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
      .select(CCG_PUBLIC_SET_FIELDS)
      .lean();
    if (!set) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    const pool = await CcgPackPool.findOne({ setId: set._id, active: true, totalCards: { $gt: 0 } })
      .select("buckets")
      .sort({ updatedAt: -1 })
      .lean();
    const cardIds = pool?.buckets.find((bucket) => bucket.grade === "S")?.cardIds ?? [];
    if (cardIds.length === 0) return { sets: [this.serializeSet(set)], card: null };

    const hourlyIndex = Math.floor(Date.now() / (60 * 60 * 1000)) % cardIds.length;
    const card = await CcgCard.findById(cardIds[hourlyIndex]).lean();
    if (!card) return { sets: [this.serializeSet(set)], card: null };
    const [seriesOwnership, ownership, alternativeByCollector, unlockedAlternativeSeries] = await Promise.all([
      CcgSeriesOwnership.findOne({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        setId: card.setId,
        characterId: card.characterId,
      }).select("unlockedSnapshotVersions").lean(),
      CcgOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, setId: card.setId, characterId: card.characterId })
        .select("finish quantity alternativeQuantity -_id")
        .lean(),
      this.loadAlternativeArt([card]),
      this.loadAlternativeArtUnlocks(owner, [card]),
    ]);
    const collectorKey = resolveCollectorKey(card);
    const alternativeArt = alternativeByCollector.get(collectorKey);
    const snapshotOwned = seriesOwnership?.unlockedSnapshotVersions.includes(card.snapshotVersion) ?? false;
    return {
      sets: [this.serializeSet(set)],
      card: {
        ...this.serializeCard(card, set, alternativeArt, {
          seriesOwned: Boolean(seriesOwnership),
          snapshotOwned,
        }),
        ownership: serializeOwnershipRows(
          snapshotOwned ? ownership : [],
          snapshotOwned && unlockedAlternativeSeries.has(getSeriesKey(card))
            && hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId)),
        ),
      },
    };
  }

  private async getDefaultCollectionRows(
    owner: CcgOwner,
    enabledSetIds: mongoose.Types.ObjectId[],
    page: number,
    limit: number,
    characterIds: mongoose.Types.ObjectId[] | null = null,
  ): Promise<CcgCollectionRows | null> {
    const match = {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      setId: { $in: enabledSetIds },
      ...(characterIds ? { characterId: { $in: characterIds } } : {}),
      collectionReadModelVersion: CCG_COLLECTION_READ_MODEL_VERSION,
    };
    const [seriesRows, total, unmaterialized] = await Promise.all([
      CcgSeriesOwnership.find(match)
        .sort({
          collectionSortGrade: 1,
          collectionSortSetNumber: 1,
          collectionSortName: 1,
          setId: 1,
          characterId: 1,
        })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("setId characterId unlockedSnapshotVersions collectionCardId")
        .lean<CcgCollectionReadSeriesRow[]>(),
      CcgSeriesOwnership.countDocuments(match),
      CcgSeriesOwnership.exists({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        setId: { $in: enabledSetIds },
        ...(characterIds ? { characterId: { $in: characterIds } } : {}),
        collectionReadModelVersion: { $ne: CCG_COLLECTION_READ_MODEL_VERSION },
        collectionReadModelIssue: { $ne: CCG_COLLECTION_READ_MODEL_MISSING_FINISH },
      }),
    ]);
    if (unmaterialized) return null;
    if (seriesRows.length === 0) return { items: [], count: total > 0 ? [{ total }] : [] };

    const seriesFilters = seriesRows.map((row) => ({ setId: row.setId, characterId: row.characterId }));
    const cardFilters = seriesRows.map((row) => ({
      setId: row.setId,
      characterId: row.characterId,
      snapshotVersion: { $in: row.unlockedSnapshotVersions },
    }));
    const [finishes, cards] = await Promise.all([
      CcgOwnership.find({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        quantity: { $gt: 0 },
        $or: seriesFilters,
      })
        .select("setId characterId finish quantity alternativeQuantity -_id")
        .lean(),
      CcgCard.find({ $or: cardFilters })
        .sort({ snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 })
        .lean(),
    ]);
    const finishesBySeries = new Map<string, CcgCollectionFinishRow[]>();
    for (const finish of finishes) {
      const key = getSeriesKey(finish);
      const current = finishesBySeries.get(key);
      const serialized = {
        finish: finish.finish,
        quantity: finish.quantity,
        alternativeQuantity: finish.alternativeQuantity ?? 0,
      };
      if (current) current.push(serialized);
      else finishesBySeries.set(key, [serialized]);
    }
    const cardsBySeries = new Map<string, ICcgCard[]>();
    const cardById = new Map<string, ICcgCard>();
    for (const card of cards) {
      const key = getSeriesKey(card);
      const current = cardsBySeries.get(key);
      if (current) current.push(card);
      else cardsBySeries.set(key, [card]);
      cardById.set(String(card._id), card);
    }

    const items: CcgCollectionRow[] = [];
    for (const row of seriesRows) {
      const key = getSeriesKey(row);
      const ownedFinishes = finishesBySeries.get(key) ?? [];
      const accessibleCards = cardsBySeries.get(key) ?? [];
      const card = cardById.get(String(row.collectionCardId));
      if (!card || ownedFinishes.length === 0 || accessibleCards.length === 0) return null;
      ownedFinishes.sort((left, right) => left.finish.localeCompare(right.finish));
      accessibleCards.sort((left, right) => compareCcgCollectionCards(
        left as unknown as CcgCollectionReadModelCard,
        right as unknown as CcgCollectionReadModelCard,
      ));
      items.push({
        _id: { setId: row.setId, characterId: row.characterId },
        totalQuantity: ownedFinishes.reduce((sum, finish) => sum + finish.quantity, 0),
        finishes: ownedFinishes,
        card,
        accessibleCards,
      });
    }
    return { items, count: [{ total }] };
  }

  async getCollection(
    owner: CcgOwner,
    options: { page?: number; limit?: number; setSlug?: string; grade?: string; finish?: string; search?: string; guildId?: string; characterId?: string; characterName?: string; sort?: string; alternativeOnly?: boolean; favoriteOnly?: boolean },
  ): Promise<Record<string, unknown>> {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(45, Math.max(1, Math.floor(options.limit ?? 18)));
    const match: Record<string, unknown> = { ownerType: owner.ownerType, ownerId: owner.ownerId };
    const finishMatch = resolveCollectionFinishMatch(options.finish);
    const sort = resolveCcgCollectionSort(options.sort);
    const cardMatch: Record<string, unknown> = {};
    const grade = CCG_TIER_GRADES.includes(options.grade as CcgTierGrade) ? (options.grade as CcgTierGrade) : null;
    if (grade) cardMatch["card.tierGrade"] = grade;
    if (options.search?.trim()) cardMatch["card.name"] = { $regex: options.search.trim().slice(0, 60), $options: "i" };
    const requestedSet = options.setSlug
      ? await CcgSet.findOne({ slug: options.setSlug, enabledAt: { $ne: null } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .lean()
      : null;
    if (options.setSlug && !requestedSet) throw new CcgServiceError(404, "set_not_found", "Card set not found");
    const sets = requestedSet
      ? [requestedSet]
      : await CcgSet.find({ enabledAt: { $ne: null } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .lean();
    match.setId = requestedSet?._id ?? { $in: sets.map((set) => set._id) };
    if (options.favoriteOnly) {
      const profile = owner.ownerType === "user"
        ? await CcgCollectorProfile.findOne({ userId: owner.ownerId }).select("showcase.cardId -_id").lean()
        : null;
      const favoriteCardIds = (profile?.showcase ?? []).map((item) => item.cardId);
      const favoriteCards = favoriteCardIds.length > 0
        ? await CcgCard.find({ _id: { $in: favoriteCardIds } }).select("setId characterId -_id").lean()
        : [];
      const favoriteSeries = new Map(favoriteCards.map((card) => [
        `${card.setId}:${card.characterId}`,
        { setId: card.setId, characterId: card.characterId },
      ]));
      if (favoriteSeries.size > 0) match.$or = Array.from(favoriteSeries.values());
      else match.characterId = { $in: [] };
    }
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const communitySetIds = sets.filter((set) => set.kind === "community").map((set) => set._id);
    const guildId = options.guildId ? validateObjectId(options.guildId, "guild ID") : null;
    if (guildId) cardMatch["card.guildId"] = guildId;
    const characterIds = options.characterId
      ? await this.resolveCollectionCharacterIds(options.characterId)
      : options.characterName
        ? await this.resolveCollectionCharacterNameIds(options.characterName)
        : null;
    if (characterIds) match.characterId = { $in: characterIds };
    if (options.alternativeOnly) {
      const alternativeSeries = await CcgOwnership.find({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        alternativeQuantity: { $gt: 0 },
      }).select("setId characterId -_id").lean();
      const unlockedSeries = Array.from(new Map(alternativeSeries.map((row) => [
        getSeriesKey(row),
        { setId: row.setId, characterId: row.characterId },
      ])).values());
      const alternativeConstraint = unlockedSeries.length > 0
        ? { $or: unlockedSeries }
        : { characterId: { $in: [] } };
      match.$and = [...(Array.isArray(match.$and) ? match.$and : []), alternativeConstraint];
    }

    const canUseDefaultReadModel = !options.setSlug
      && !finishMatch
      && !sort
      && Object.keys(cardMatch).length === 0
      && !options.alternativeOnly
      && !options.favoriteOnly;
    const defaultRows = canUseDefaultReadModel
      ? await this.getDefaultCollectionRows(owner, sets.map((set) => set._id), page, limit, characterIds)
      : null;
    let rows = defaultRows;
    if (!rows) rows = await CcgSeriesOwnership.aggregate<{
      _id: { setId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId };
      totalQuantity: number;
      finishes: Array<{ finish: CcgFinish; quantity: number; alternativeQuantity?: number }>;
      card: ICcgCard;
      accessibleCards: ICcgCard[];
    }>([
      { $match: match },
      {
        $lookup: {
          from: "ccgownerships",
          let: { setId: "$setId", characterId: "$characterId" },
          pipeline: [
            {
              $match: {
                ownerType: owner.ownerType,
                ownerId: owner.ownerId,
                setId: { $type: "objectId" },
                characterId: { $type: "objectId" },
                ...(finishMatch ? { finish: finishMatch } : {}),
                $expr: {
                  $and: [
                    { $eq: ["$setId", "$$setId"] },
                    { $eq: ["$characterId", "$$characterId"] },
                  ],
                },
              },
            },
            { $project: { _id: 0, finish: 1, quantity: 1, alternativeQuantity: { $ifNull: ["$alternativeQuantity", 0] } } },
          ],
          as: "finishes",
        },
      },
      { $match: { "finishes.0": { $exists: true } } },
      {
        $lookup: {
          from: "ccgcards",
          let: {
            setId: "$setId",
            characterId: "$characterId",
            unlockedSnapshotVersions: "$unlockedSnapshotVersions",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$setId", "$$setId"] },
                    { $eq: ["$characterId", "$$characterId"] },
                    { $in: ["$snapshotVersion", "$$unlockedSnapshotVersions"] },
                  ],
                },
              },
            },
            { $sort: { snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 } },
          ],
          as: "accessibleCards",
        },
      },
      {
        $set: {
          _id: { setId: "$setId", characterId: "$characterId" },
          card: { $arrayElemAt: ["$accessibleCards", 0] },
          totalQuantity: { $sum: "$finishes.quantity" },
        },
      },
      { $match: { card: { $ne: null } } },
      ...(Object.keys(cardMatch).length > 0 ? [{ $match: cardMatch }] : []),
      ...(sort
        ? buildCcgCollectionSortStages(sort, {
            grade: "card.tierGrade",
            name: "card.name",
            realm: "card.realm",
            setNumber: "card.setNumber",
            id: "card._id",
          }, {
            duplicates: "$totalQuantity",
            quality: {
              $max: {
                $map: {
                  input: "$finishes",
                  as: "owned",
                  in: buildCcgCollectionQualityRank("$$owned.finish"),
                },
              },
            },
            damage: { $cond: [{ $in: ["$card.setId", communitySetIds] }, "$card.communityScores.performance", "$card.parseScore"] },
            mechanics: { $cond: [{ $in: ["$card.setId", communitySetIds] }, "$card.communityScores.mechanics", "$card.survivalScore"] },
            combined: { $cond: [{ $in: ["$card.setId", communitySetIds] }, "$card.communityScores.combined", "$card.combinedScore"] },
            mythicPlus: { $cond: [{ $in: ["$card.setId", communitySetIds] }, "$card.communityScores.mythicPlus", "$card.mythicPlusScore"] },
          })
        : [
            { $set: { sortGrade: { $indexOfArray: [[...CCG_TIER_GRADES], "$card.tierGrade"] } } },
            { $sort: { sortGrade: 1 as const, "card.setNumber": 1 as const, "card.name": 1 as const, _id: 1 as const } },
          ]),
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          count: [{ $count: "total" }],
        },
      },
    ]).then((result) => (result[0] ?? { items: [], count: [] }) as unknown as CcgCollectionRows);
    if (!rows) throw new Error("CCG collection query did not return a result");
    const total = rows.count[0]?.total ?? 0;
    const collectionCards = rows.items.flatMap((row) => row.accessibleCards);
    const [alternativeByCollector, unlockedAlternativeSeries] = await Promise.all([
      this.loadAlternativeArt(collectionCards),
      this.loadAlternativeArtUnlocks(owner, collectionCards),
    ]);
    const responseSetIds = new Set(rows.items.map((row) => String(row.card.setId)));
    return {
      sets: Array.from(responseSetIds).flatMap((setId) => {
        const cardSet = setById.get(setId);
        return cardSet ? [this.serializeSet(cardSet)] : [];
      }),
      cards: rows.items.map((row) => {
        const cardSet = setById.get(String(row.card.setId));
        if (!cardSet) throw new CcgServiceError(500, "set_not_found", "Card set not found");
        const representativeCollectorKey = resolveCollectorKey(row.card);
        const alternative = alternativeByCollector.get(representativeCollectorKey);
        const alternativeArtUnlocked = unlockedAlternativeSeries.has(getSeriesKey(row.card))
          && hasApplicableAlternativeArt(alternative, Boolean(row.card.communityCharacterId));
        return {
          ...this.serializeCard(row.card, cardSet, alternative, { seriesOwned: true, snapshotOwned: true }),
          ownership: serializeOwnershipRows(row.finishes, alternativeArtUnlocked),
          totalQuantity: row.totalQuantity,
          variants: row.accessibleCards.map((variant) => {
            const collectorKey = resolveCollectorKey(variant);
            const alternativeArt = alternativeByCollector.get(collectorKey);
            const alternativeArtUnlocked = unlockedAlternativeSeries.has(getSeriesKey(variant))
              && hasApplicableAlternativeArt(alternativeArt, Boolean(variant.communityCharacterId));
            return {
              card: this.serializeCard(variant, cardSet, alternativeArt, { seriesOwned: true, snapshotOwned: true }),
              ownership: serializeOwnershipRows(row.finishes, alternativeArtUnlocked),
              totalQuantity: row.totalQuantity,
            };
          }),
        };
      }),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async getCard(
    cardId: string,
    owner?: CcgOwner,
  ): Promise<{ sets: Record<string, unknown>[]; card: Record<string, unknown> }> {
    const id = validateObjectId(cardId, "card ID");
    const card = await CcgCard.findById(id).lean();
    if (!card) throw new CcgServiceError(404, "card_not_found", "Card not found");
    const set = await CcgSet.findOne({ _id: card.setId, enabledAt: { $ne: null } }).select(CCG_PUBLIC_SET_FIELDS).lean();
    if (!set) throw new CcgServiceError(404, "card_not_found", "Card not found");
    const [seriesOwnership, ownership, alternativeByCollector, unlockedAlternativeSeries] = await Promise.all([
      owner
        ? CcgSeriesOwnership.findOne({
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            setId: card.setId,
            characterId: card.characterId,
          }).select("unlockedSnapshotVersions").lean()
        : null,
      owner
        ? CcgOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, setId: card.setId, characterId: card.characterId })
            .select("finish quantity alternativeQuantity -_id")
            .lean()
        : [],
      this.loadAlternativeArt([card]),
      owner ? this.loadAlternativeArtUnlocks(owner, [card]) : new Set<string>(),
    ]);
    const collectorKey = resolveCollectorKey(card);
    const alternativeArt = alternativeByCollector.get(collectorKey);
    const snapshotOwned = seriesOwnership?.unlockedSnapshotVersions.includes(card.snapshotVersion) ?? false;
    return {
      sets: [this.serializeSet(set)],
      card: {
        ...this.serializeCard(card, set, alternativeArt, {
          seriesOwned: Boolean(seriesOwnership),
          snapshotOwned,
        }),
        ownership: serializeOwnershipRows(
          snapshotOwned ? ownership : [],
          snapshotOwned && unlockedAlternativeSeries.has(getSeriesKey(card))
            && hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId)),
        ),
      },
    };
  }

  async getActivity(
    req: Request,
    query: { filter?: unknown; cursor?: unknown; limit?: unknown },
  ): Promise<Record<string, unknown>> {
    requireFeature();
    const userId = await this.requireAuthenticatedUser(req, "Log in to view your collection activity");
    const filter = resolveCcgActivityFilter(query.filter);
    if (!filter) throw new CcgServiceError(400, "invalid_activity_filter", "Choose a valid activity filter");
    const limit = validateCcgActivityLimit(query.limit);
    const cursor = decodeCcgActivityCursor(query.cursor);
    const rowLimit = limit + 1;

    const packCursorFilter = buildCcgActivityCursorFilter("createdAt", "pack", cursor);
    const packOwnerFilter: mongoose.QueryFilter<ICcgPackOpening> = {
      $or: [
        { ownerType: "user", ownerId: userId },
        { ownerType: "guest", claimedByUserId: userId },
      ],
    };
    const packFilter: mongoose.QueryFilter<ICcgPackOpening> = Object.keys(packCursorFilter).length > 0
      ? {
          state: "committed",
          $and: [packOwnerFilter, packCursorFilter as mongoose.QueryFilter<ICcgPackOpening>],
        }
      : { state: "committed", ...packOwnerFilter };

    const [openingRows, codeRows, twitchRows, summaryRows] = await Promise.all([
      filter === "all" || filter === "packs"
        ? CcgPackOpening.find(packFilter)
            .select("_id mode selectionType targetSetId sourceSetIds results duplicateRewards createdAt")
            .sort({ createdAt: -1, _id: -1 })
            .limit(rowLimit)
            .lean<CcgActivityPackRecord[]>()
        : Promise.resolve([] as CcgActivityPackRecord[]),
      filter === "all" || filter === "codes"
        ? CcgRedeemClaim.find({
            userId,
            ...buildCcgActivityCursorFilter("redeemedAt", "code", cursor),
          })
            .select("_id rewardType packs currentPacks legacyPacks cardId finish artVariant redeemedAt")
            .sort({ redeemedAt: -1, _id: -1 })
            .limit(rowLimit)
            .lean<CcgActivityCodeRecord[]>()
        : Promise.resolve([] as CcgActivityCodeRecord[]),
      filter === "all" || filter === "twitch"
        ? TwitchCcgRedemption.find({
            grantedUserId: userId,
            grantStatus: "granted",
            ...buildCcgActivityCursorFilter("redeemedAt", "twitch", cursor),
          })
            .select("_id broadcasterLogin rewardTitle rewardKind assignedCard redeemedAt")
            .sort({ redeemedAt: -1, _id: -1 })
            .limit(rowLimit)
            .lean<CcgActivityTwitchRecord[]>()
        : Promise.resolve([] as CcgActivityTwitchRecord[]),
      cursor
        ? Promise.resolve(null)
        : Promise.all([
            CcgPackOpening.aggregate<CcgActivityPackSummaryRow>([
              { $match: { state: "committed", ...packOwnerFilter } },
              {
                $project: {
                  selectionType: {
                    $ifNull: [
                      "$selectionType",
                      {
                        $cond: [
                          { $ne: [{ $ifNull: ["$targetSetId", null] }, null] },
                          "raid",
                          "all",
                        ],
                      },
                    ],
                  },
                  packSetId: {
                    $cond: [
                      { $ne: [{ $ifNull: ["$targetSetId", null] }, null] },
                      "$targetSetId",
                      null,
                    ],
                  },
                },
              },
              { $group: { _id: { selectionType: "$selectionType", setId: "$packSetId" }, count: { $sum: 1 } } },
              { $sort: { count: -1, "_id.selectionType": 1 } },
            ]),
            CcgOwnership.aggregate<CcgActivityFinishSummaryRow>([
              { $match: { ownerType: "user", ownerId: userId } },
              { $group: { _id: "$finish", count: { $sum: "$quantity" } } },
            ]),
            CcgSeriesOwnership.countDocuments({ ownerType: "user", ownerId: userId }),
          ]).then(([packs, finishes, uniqueCards]) => ({ packs, finishes, uniqueCards })),
    ]);

    const candidates: CcgActivityCandidate[] = [
      ...openingRows.map((record) => ({ kind: "pack" as const, sourceId: record._id, occurredAt: record.createdAt, record })),
      ...codeRows.map((record) => ({ kind: "code" as const, sourceId: record._id, occurredAt: record.redeemedAt, record })),
      ...twitchRows.map((record) => ({ kind: "twitch" as const, sourceId: record._id, occurredAt: record.redeemedAt, record })),
    ].sort(compareCcgActivityCandidates);
    const hasMore = candidates.length > limit;
    const pageCandidates = candidates.slice(0, limit);

    const cardIds = new Set<string>();
    const rewardCardIds = new Set<string>();
    const setIds = new Set<string>();
    pageCandidates.forEach((candidate) => {
      if (candidate.kind === "pack") {
        candidate.record.sourceSetIds.forEach((setId) => setIds.add(String(setId)));
        if (candidate.record.targetSetId) setIds.add(String(candidate.record.targetSetId));
        candidate.record.results.forEach((result) => {
          cardIds.add(String(result.cardId));
          setIds.add(String(result.setId));
        });
        return;
      }
      const cardId = candidate.kind === "code" ? candidate.record.cardId : candidate.record.assignedCard?.cardId;
      if (cardId) {
        cardIds.add(String(cardId));
        rewardCardIds.add(String(cardId));
      }
    });
    summaryRows?.packs.forEach((row) => {
      if (row._id.setId) setIds.add(String(row._id.setId));
    });

    const needsCurrentPackArt = pageCandidates.some((candidate) => (
      candidate.kind === "code"
        ? candidate.record.rewardType === "packs" && getRedeemPackCount(candidate.record) > 0
        : candidate.kind === "twitch" && candidate.record.rewardKind !== "card_reveal"
    ));
    const [cards, currentPackSet] = await Promise.all([
      cardIds.size > 0
        ? CcgCard.find({ _id: { $in: Array.from(cardIds, (id) => new mongoose.Types.ObjectId(id)) } })
            .lean<CcgActivityCardRecord[]>()
        : Promise.resolve([] as CcgActivityCardRecord[]),
      needsCurrentPackArt
        ? CcgSet.findOne({ state: "current", enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
            .select(CCG_PUBLIC_SET_FIELDS)
            .sort({ enabledAt: -1, _id: -1 })
            .lean<CcgActivitySetRecord>()
        : Promise.resolve(null),
    ]);
    cards.forEach((card) => setIds.add(String(card.setId)));
    if (currentPackSet) setIds.add(String(currentPackSet._id));
    const sets = setIds.size > 0
      ? await CcgSet.find({ _id: { $in: Array.from(setIds, (id) => new mongoose.Types.ObjectId(id)) } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .lean<CcgActivitySetRecord[]>()
      : [];
    const cardById = new Map(cards.map((card) => [String(card._id), card]));
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const rewardCards = cards.filter((card) => rewardCardIds.has(String(card._id)));
    const alternativeByCollector = await this.loadAlternativeArt(rewardCards);

    const serializeActivityPackArt = (set: CcgActivitySetRecord | null | undefined) => set
      ? {
          slug: set.slug,
          raidName: set.raidName,
          theme: set.theme,
          backgroundPath: set.backgroundPath,
          packArtOffsetX: set.packArtOffsetX,
        }
      : null;

    const serializeActivityCard = (
      cardId: mongoose.Types.ObjectId | null | undefined,
    ): Record<string, unknown> | null => {
      if (!cardId) return null;
      const card = cardById.get(String(cardId));
      if (!card) return null;
      const set = setById.get(String(card.setId));
      if (!set) return null;
      return {
        ...this.serializeCard(
          card as unknown as Record<string, any>,
          set as unknown as Record<string, any>,
          alternativeByCollector.get(resolveCollectorKey(card)),
          { seriesOwned: true, snapshotOwned: true },
        ),
        set: this.serializeSet(set as unknown as Record<string, any>),
      };
    };

    const summary = summaryRows
      ? (() => {
          const finishes = Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, 0])) as Record<CcgFinish, number>;
          summaryRows.finishes.forEach((row) => {
            if (CCG_FINISH_ORDER.includes(row._id)) finishes[row._id] = row.count;
          });
          return {
            packsTotal: summaryRows.packs.reduce((total, row) => total + row.count, 0),
            cardsTotal: Object.values(finishes).reduce((total, count) => total + count, 0),
            uniqueCards: summaryRows.uniqueCards,
            raidPacks: summaryRows.packs
              .map((row) => ({
                selectionType: row._id.selectionType,
                count: row.count,
                packArt: serializeActivityPackArt(row._id.setId ? setById.get(String(row._id.setId)) : null),
              }))
              .sort((left, right) => right.count - left.count
                || (left.packArt?.raidName ?? "").localeCompare(right.packArt?.raidName ?? "")),
            finishes,
          };
        })()
      : null;

    const items = pageCandidates.map((candidate) => {
      const base = {
        id: `${candidate.kind}:${candidate.sourceId}`,
        kind: candidate.kind,
        occurredAt: candidate.occurredAt,
      };
      if (candidate.kind === "pack") {
        const packSetId = resolveCcgActivityPackSetId(
          candidate.record.selectionType,
          candidate.record.targetSetId,
          candidate.record.sourceSetIds,
        );
        const packSet = packSetId ? setById.get(String(packSetId)) : undefined;
        return {
          ...base,
          openingId: String(candidate.record._id),
          selectionType: resolveCcgActivityPackSelectionType(
            candidate.record.selectionType,
            candidate.record.targetSetId,
          ),
          packArt: serializeActivityPackArt(packSet),
          cards: candidate.record.results.flatMap((result) => {
            const card = cardById.get(String(result.cardId));
            return card ? [{
              name: card.name,
              realm: card.realm,
              classID: card.classID,
              tierGrade: card.tierGrade,
              finish: result.finish,
            }] : [];
          }),
          newCards: candidate.record.results.filter((result) => !result.isDuplicate).length,
          duplicates: candidate.record.results.filter((result) => result.isDuplicate).length,
          bonusPacks: candidate.record.duplicateRewards,
        };
      }
      if (candidate.kind === "code") {
        return {
          ...base,
          reward: candidate.record.rewardType === "packs"
            ? {
                type: "packs",
                packs: getRedeemPackCount(candidate.record),
                packArt: serializeActivityPackArt(currentPackSet),
              }
            : {
                type: "card",
                finish: candidate.record.finish ?? null,
                artVariant: candidate.record.artVariant ?? null,
                card: serializeActivityCard(candidate.record.cardId),
              },
        };
      }
      return {
        ...base,
        broadcasterLogin: candidate.record.broadcasterLogin,
        rewardTitle: candidate.record.rewardTitle,
        reward: candidate.record.rewardKind !== "card_reveal"
          ? {
              type: "packs",
              packs: candidate.record.rewardKind === "packs_10" ? 20 : 2,
              packArt: serializeActivityPackArt(currentPackSet),
            }
          : {
              type: "card",
              finish: candidate.record.assignedCard?.finish ?? null,
              artVariant: candidate.record.assignedCard?.artVariant ?? null,
              card: serializeActivityCard(candidate.record.assignedCard?.cardId),
            },
      };
    });

    return {
      items,
      summary,
      nextCursor: hasMore && pageCandidates.length > 0
        ? encodeCcgActivityCursor(pageCandidates[pageCandidates.length - 1])
        : null,
    };
  }

  async rollExternalSingleCard(
    session: ClientSession,
    userId?: mongoose.Types.ObjectId,
  ): Promise<CcgExternalCardAward> {
    requireFeature();
    const pool = await this.selectPackResults(session, null, false, false);
    const selected = pool.results[0];
    if (!selected) throw new CcgServiceError(409, "pool_invalid", "The raid card pool is incomplete");

    const card = await CcgCard.findOne({ _id: selected.cardId, setId: selected.setId }).session(session).lean();
    if (!card) throw new CcgServiceError(409, "pool_invalid", "The raid card pool references an unavailable card");
    const set = await CcgSet.findOne({ _id: card.setId, enabledAt: { $ne: null } }).session(session).lean();
    if (!set) throw new CcgServiceError(409, "pool_invalid", "The raid card pool references an unavailable set");

    const customFinish = set.kind === "raid" ? set.customFinish?.key ?? null : null;
    const finishOrder = getCcgPackFinishOrder(set.kind, customFinish);
    const owner = userId ? { ownerType: "user" as const, ownerId: userId, dateKey: getHelsinkiDateKey() } : null;
    const [ownedRows, qualityProgress] = owner
      ? await Promise.all([
          CcgOwnership.find({
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            setId: card.setId,
            characterId: card.characterId,
          }).select("finish").session(session).lean(),
          this.ensureQualityProgress(owner, session),
        ])
      : [[], null] as const;
    const activePity = qualityProgress ? this.readFinishPity(qualityProgress) : emptyFinishPity();
    if (qualityProgress && customFinish) {
      activePity[customFinish] = this.readCustomFinishPity(qualityProgress, set.slug);
    }
    const rolled = rollOwnedFinish(
      activePity,
      new Set<CcgFinish>(ownedRows.map((row) => row.finish)),
      randomInt,
      finishOrder,
      customFinish
        ? { ...CCG_FINISH_PITY_LIMITS, [customFinish]: set.customFinish!.hardPity }
        : CCG_FINISH_PITY_LIMITS,
    );
    if (qualityProgress) {
      this.writeFinishPity(qualityProgress, this.readFinishPity(rolled.pity));
      if (customFinish) this.writeCustomFinishPity(qualityProgress, set.slug, rolled.pity[customFinish] ?? 0);
      await qualityProgress.save({ session });
    }
    const alternativeArt = (await this.loadAlternativeArt([card], session)).get(resolveCollectorKey(card));

    return {
      cardId: card._id,
      setId: card.setId,
      characterId: card.characterId,
      snapshotVersion: card.snapshotVersion,
      finish: rolled.finish,
      artVariant: rollArtVariant(hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId))),
      tierGrade: card.tierGrade,
      poolVersion: pool.version,
    };
  }

  async grantExternalCard(
    userId: mongoose.Types.ObjectId,
    award: CcgExternalCardAward,
    session: ClientSession,
  ): Promise<void> {
    await this.addOwnership(
      { ownerType: "user", ownerId: userId, dateKey: getHelsinkiDateKey() },
      [award],
      session,
    );
  }

  async createCardShare(req: Request, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    const userId = await this.requireAuthenticatedUser(req);
    const cardId = validateObjectId(String(body.cardId ?? ""), "card ID");
    const finish = validateFinish(body.finish);
    const artVariant = validateArtVariant(body.artVariant);
    const card = await CcgCard.findById(cardId)
      .select("_id setId characterId snapshotVersion collectorKey communityCharacterId")
      .lean();
    if (!card || !(await CcgSet.exists({ _id: card.setId, enabledAt: { $ne: null } }))) {
      throw new CcgServiceError(404, "card_not_found", "Card not found");
    }
    const [seriesOwnership, finishOwnership] = await Promise.all([
      CcgSeriesOwnership.findOne({
        ownerType: "user",
        ownerId: userId,
        setId: card.setId,
        characterId: card.characterId,
        unlockedSnapshotVersions: card.snapshotVersion,
      }).select("_id").lean(),
      CcgOwnership.findOne({
        ownerType: "user",
        ownerId: userId,
        setId: card.setId,
        characterId: card.characterId,
        finish,
        quantity: { $gt: 0 },
      }).select("_id").lean(),
    ]);
    if (!seriesOwnership || !finishOwnership) {
      throw new CcgServiceError(403, "card_not_owned", "Only cards in your collection can be shared");
    }
    if (artVariant === "alternative") {
      const [alternativeByCollector, unlockedAlternativeSeries] = await Promise.all([
        this.loadAlternativeArt([card]),
        this.loadAlternativeArtUnlocks({ ownerType: "user", ownerId: userId }, [card]),
      ]);
      const collectorKey = resolveCollectorKey(card);
      if (
        !unlockedAlternativeSeries.has(getSeriesKey(card))
        || !hasApplicableAlternativeArt(alternativeByCollector.get(collectorKey), Boolean(card.communityCharacterId))
      ) {
        throw new CcgServiceError(403, "card_not_owned", "Only cards in your collection can be shared");
      }
    }

    const share = await this.createOrGetShare(
      { kind: "card", userId, cardId, finish, artVariant },
      { kind: "card", userId, cardId, finish, artVariant },
    );
    return this.serializeShareLink(share);
  }

  async createPackShare(req: Request, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    const userId = await this.requireAuthenticatedUser(req);
    const openingId = validateObjectId(String(body.openingId ?? ""), "pack opening ID");
    const opening = await CcgPackOpening.findOne({
      _id: openingId,
      state: "committed",
      $or: [
        { ownerType: "user", ownerId: userId },
        { claimedByUserId: userId },
      ],
    }).lean();
    if (!opening) throw new CcgServiceError(404, "opening_not_found", "Pack opening not found");

    if (opening.ownerType === "guest") {
      await CcgPackOpening.updateOne(
        { _id: opening._id, claimedByUserId: userId },
        { $set: { dateKey: null } },
      );
    }

    const share = await this.createOrGetShare(
      { kind: "pack", userId, openingId },
      { kind: "pack", userId, openingId },
    );
    return this.serializeShareLink(share);
  }

  async getShare(rawShareId: string): Promise<Record<string, unknown>> {
    requireFeature();
    const lookup = validateShareLookup(rawShareId);
    const foundShare = await CcgShare.findOne(lookup);
    const share = foundShare ? await this.ensureShareShortId(foundShare) : null;
    if (!share) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
    const user = await User.findById(share.userId).select("discord.id discord.username discord.avatar").lean();
    if (!user) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");

    const response = {
      id: share.shortId,
      kind: share.kind,
      createdAt: share.createdAt,
      unboxedBy: {
        username: user.discord.username,
        avatarUrl: discordService.getAvatarUrl(user.discord.id, user.discord.avatar),
      },
    };

    if (share.kind === "card") {
      if (!share.cardId || !share.finish || !share.artVariant) {
        throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
      }
      const card = await CcgCard.findById(share.cardId).lean();
      if (!card) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
      const set = await CcgSet.findOne({ _id: card.setId, enabledAt: { $ne: null } }).select(CCG_PUBLIC_SET_FIELDS).lean();
      if (!set) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
      const alternativeByCollector = await this.loadAlternativeArt([card]);
      return {
        ...response,
        sets: [this.serializeSet(set)],
        card: {
          card: this.serializeCard(card, set, alternativeByCollector.get(resolveCollectorKey(card))),
          finish: share.finish,
          artVariant: share.artVariant,
        },
      };
    }

    if (!share.openingId) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
    const opening = await CcgPackOpening.findOne({ _id: share.openingId, state: "committed" }).lean();
    if (!opening) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
    return { ...response, pack: await this.serializeOpening(opening) };
  }

  async updateAlternativeArtForAdmin(cardId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = validateObjectId(cardId, "card ID");
    const card = await CcgCard.findById(id).select("_id characterId collectorKey").lean();
    if (!card) throw new CcgServiceError(404, "card_not_found", "Card not found");

    let characterArtFilename: string | null;
    let backgroundArtFilename: string | null;
    let quipText: string | null;
    let quipAudioFilename: string | null;
    try {
      characterArtFilename = normalizeAlternativeArtFilename(input.characterArtFilename);
      backgroundArtFilename = normalizeAlternativeArtFilename(input.backgroundArtFilename);
    } catch (error) {
      throw new CcgServiceError(400, "invalid_art_filename", error instanceof Error ? error.message : "Invalid artwork filename");
    }
    try {
      quipText = normalizeQuipText(input.quipText);
      quipAudioFilename = normalizeQuipAudioFilename(input.quipAudioFilename);
    } catch (error) {
      throw new CcgServiceError(400, "invalid_quip", error instanceof Error ? error.message : "Invalid quip");
    }
    if (typeof input.characterArtEnabled !== "boolean" || typeof input.backgroundArtEnabled !== "boolean") {
      throw new CcgServiceError(400, "invalid_art_state", "Artwork enabled state must be true or false");
    }
    if (input.characterArtEnabled && !characterArtFilename) {
      throw new CcgServiceError(400, "character_art_filename_required", "Choose a character artwork filename before enabling it");
    }

    const collectorKey = resolveCollectorKey(card);
    const hasCommunityVariant = Boolean(await CcgCard.exists({
      ...(card.collectorKey ? { collectorKey } : { characterId: card.characterId }),
      communityCharacterId: { $ne: null },
    }));
    if ((input.backgroundArtEnabled || backgroundArtFilename) && !hasCommunityVariant) {
      throw new CcgServiceError(400, "community_background_only", "Alternative backgrounds are only available to Community characters");
    }
    if (input.backgroundArtEnabled && !backgroundArtFilename) {
      throw new CcgServiceError(400, "background_art_filename_required", "Choose a background artwork filename before enabling it");
    }

    if (!characterArtFilename && !backgroundArtFilename && !input.characterArtEnabled && !input.backgroundArtEnabled && !quipText && !quipAudioFilename) {
      await CcgAlternativeArt.deleteOne({ collectorKey });
      return { alternativeArt: null, quip: null, hasCommunityVariant };
    }

    const alternativeArt = await CcgAlternativeArt.findOneAndUpdate(
      { collectorKey },
      {
        $set: {
          characterArtFilename,
          characterArtEnabled: input.characterArtEnabled,
          backgroundArtFilename,
          backgroundArtEnabled: input.backgroundArtEnabled,
          quipText,
          quipAudioFilename,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean();
    return {
      alternativeArt: serializeAlternativeArt(alternativeArt ?? undefined),
      quip: serializeQuip(alternativeArt ?? undefined),
      hasCommunityVariant,
    };
  }

  async searchCollectionCharacters(rawSearch: unknown, rawLimit: unknown): Promise<Record<string, unknown>> {
    requireFeature();
    const search = typeof rawSearch === "string" ? rawSearch.trim().slice(0, 100) : "";
    const normalizedSearch = normalizeSearchText(search);
    const requestedLimit = typeof rawLimit === "string" ? Number(rawLimit) : Number(rawLimit ?? 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(10, Math.max(1, requestedLimit)) : 10;
    if (normalizedSearch.length < 2) return { search, characters: [] };

    const candidates = await this.getCollectionCharacterSearchCandidates();
    const selectedCandidates = candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreCollectionCharacterNameMatch(normalizedSearch, candidate.characterSearchText),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime() || a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm))
      .slice(0, limit);
    return {
      search,
      characters: selectedCandidates.map((candidate) => ({
        id: String(candidate.characterId),
        name: candidate.name,
        realm: candidate.realm,
        classID: candidate.classID,
      })),
    };
  }

  async searchCardsForAdmin(rawSearch: unknown, rawLimit: unknown): Promise<Record<string, unknown>> {
    const search = typeof rawSearch === "string" ? rawSearch.trim().slice(0, 100) : "";
    const normalizedSearch = normalizeSearchText(search);
    const requestedLimit = typeof rawLimit === "string" ? Number(rawLimit) : Number(rawLimit ?? 24);
    const limit = Number.isInteger(requestedLimit) ? Math.min(40, Math.max(1, requestedLimit)) : 24;
    if (normalizedSearch.length < 2) return { search, sets: [], cards: [] };

    if (!this.adminCardSearchCache || this.adminCardSearchCache.expiresAt <= Date.now()) {
      this.adminCardSearchCache = {
        expiresAt: Date.now() + 2 * 60 * 1000,
        candidates: await this.buildCardSearchCandidates(),
      };
    }

    const selectedCandidates = this.adminCardSearchCache.candidates
      .map((candidate) => ({
        ...candidate,
        score: Math.max(...candidate.searchText.map((text) => scoreSearchCandidate(normalizedSearch, text))),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime() || a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm))
      .slice(0, limit);
    const matchingCards = await CcgCard.find({ _id: { $in: selectedCandidates.flatMap((candidate) => candidate.cardIds) } })
      .sort({ performanceSnapshotAt: -1, publishedAt: -1 })
      .lean();
    const cardById = new Map(matchingCards.map((card) => [String(card._id), card]));
    const setIds = Array.from(new Set(matchingCards.map((card) => String(card.setId))));
    const sets = await CcgSet.find({ _id: { $in: setIds } }).lean();
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const alternativeByCollector = await this.loadAlternativeArt(matchingCards);
    return {
      search,
      sets: sets.map((set) => this.serializeSet(set)),
      cards: selectedCandidates.flatMap((candidate) => {
        const variants = candidate.cardIds
          .flatMap((id) => {
            const card = cardById.get(String(id));
            const set = card ? setById.get(String(card.setId)) : null;
            return card && set ? [{ card, set }] : [];
          })
          .sort((a, b) => b.card.performanceSnapshotAt.getTime() - a.card.performanceSnapshotAt.getTime() || b.card.publishedAt.getTime() - a.card.publishedAt.getTime());
        const representative = variants[0];
        return representative ? [{
          ...this.serializeCard(representative.card, representative.set, alternativeByCollector.get(resolveCollectorKey(representative.card))),
          name: candidate.name,
          variants: variants.map((variant) => ({
            card: this.serializeCard(variant.card, variant.set, alternativeByCollector.get(resolveCollectorKey(variant.card))),
            ownership: [],
            totalQuantity: 0,
          })),
        }] : [];
      }),
    };
  }

  async getRedeemCodesForAdmin(): Promise<Record<string, unknown>> {
    const codes = await CcgRedeemCode.find({}).sort({ createdAt: -1 }).lean();
    return this.serializeRedeemCodes(codes);
  }

  async createRedeemCodeForAdmin(input: Record<string, unknown>, createdBy: mongoose.Types.ObjectId): Promise<Record<string, unknown>> {
    const code = normalizeCcgRedeemCode(input.code);
    if (!code) {
      throw new CcgServiceError(400, "invalid_redeem_code", "Use 3–64 letters, numbers, hyphens, or underscores");
    }
    if (input.rewardType !== "packs" && input.rewardType !== "card") {
      throw new CcgServiceError(400, "invalid_reward_type", "Choose either packs or one card");
    }

    const packs = validatePackGrant(input.rewardType === "packs" ? input.packs : 0, "Pack reward");
    let cardId: mongoose.Types.ObjectId | null = null;
    let finish: CcgFinish | null = null;
    let artVariant: CcgArtVariant | null = null;

    if (input.rewardType === "packs") {
      if (packs < 1) {
        throw new CcgServiceError(400, "empty_pack_reward", "Grant at least one pack");
      }
    } else {
      cardId = validateObjectId(String(input.cardId ?? ""), "reward card ID");
      if (typeof input.finish !== "string" || !CCG_FINISH_ORDER.includes(input.finish as CcgFinish)) {
        throw new CcgServiceError(400, "invalid_card_finish", "Choose a valid card quality");
      }
      if (input.artVariant !== "standard" && input.artVariant !== "alternative") {
        throw new CcgServiceError(400, "invalid_art_variant", "Choose regular or custom artwork");
      }
      finish = input.finish as CcgFinish;
      artVariant = input.artVariant;

      const card = await CcgCard.findOne({ _id: cardId, availabilityStatus: { $ne: "archived" } }).lean();
      const cardSet = card ? await CcgSet.findById(card.setId).lean() : null;
      if (!card || !cardSet) {
        throw new CcgServiceError(404, "card_not_found", "The selected published card no longer exists");
      }
      if (!getCcgRedeemFinishOrder(cardSet.kind, cardSet.customFinish?.key).includes(finish)) {
        throw new CcgServiceError(400, "finish_unavailable_for_set", "That quality is not available for this card");
      }
      if (artVariant === "alternative") {
        const alternativeArt = (await this.loadAlternativeArt([card])).get(resolveCollectorKey(card));
        if (!hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId))) {
          throw new CcgServiceError(400, "alternative_art_unavailable", "This card does not have enabled custom artwork");
        }
      }
    }

    try {
      const created = await CcgRedeemCode.create({
        code,
        rewardType: input.rewardType,
        packs,
        cardId,
        finish,
        artVariant,
        active: true,
        createdBy,
      });
      const serialized = await this.serializeRedeemCodes([created.toObject()]);
      return { code: serialized.codes[0], sets: serialized.sets };
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new CcgServiceError(409, "redeem_code_exists", "That redeem code already exists");
      throw error;
    }
  }

  async setRedeemCodeActiveForAdmin(codeId: string, activeValue: unknown): Promise<Record<string, unknown>> {
    const id = validateObjectId(codeId, "redeem code ID");
    if (typeof activeValue !== "boolean") throw new CcgServiceError(400, "invalid_active_state", "Active state must be true or false");
    const code = await CcgRedeemCode.findByIdAndUpdate(id, { $set: { active: activeValue } }, { returnDocument: "after" }).lean();
    if (!code) throw new CcgServiceError(404, "redeem_code_not_found", "Redeem code not found");
    const serialized = await this.serializeRedeemCodes([code]);
    return { code: serialized.codes[0], sets: serialized.sets };
  }

  async redeemCode(req: Request, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    if (!req.session.userId || !mongoose.Types.ObjectId.isValid(req.session.userId)) {
      throw new CcgServiceError(401, "authentication_required", "Log in to redeem codes");
    }
    const userId = new mongoose.Types.ObjectId(req.session.userId);
    if (!await User.exists({ _id: userId })) throw new CcgServiceError(401, "authentication_required", "Log in to redeem codes");
    const normalizedCode = normalizeCcgRedeemCode(input.code);
    if (!normalizedCode) throw new CcgServiceError(400, "invalid_redeem_code", "Enter a valid redeem code");

    const session = await mongoose.startSession();
    let redeemed: RedeemedCodeSnapshot | null = null;
    try {
      await session.withTransaction(async () => {
        redeemed = null;
        const code = await CcgRedeemCode.findOne({ code: normalizedCode, active: true }).session(session);
        if (!code) throw new CcgServiceError(404, "redeem_code_not_found", "That code is invalid or inactive");
        if (await CcgRedeemClaim.exists({ codeId: code._id, userId }).session(session)) {
          throw new CcgServiceError(409, "redeem_code_already_used", "You have already redeemed this code");
        }

        const reservedCode = await CcgRedeemCode.findOneAndUpdate(
          { _id: code._id, active: true },
          { $inc: { redemptionCount: 1 } },
          { returnDocument: "after", session },
        );
        if (!reservedCode) throw new CcgServiceError(404, "redeem_code_not_found", "That code is invalid or inactive");

        const owner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: getHelsinkiDateKey() };
        const now = new Date();
        if (reservedCode.rewardType === "packs") {
          const packs = getRedeemPackCount(reservedCode);
          const balance = await this.ensurePackBalance(owner, session, now);
          const updated = await CcgPackBalance.findOneAndUpdate(
            { _id: balance._id },
            {
              $inc: { remaining: packs },
              $set: {
                hasPlayed: true,
                firstPlayedAt: balance.firstPlayedAt ?? now,
              },
            },
            { returnDocument: "after", session },
          );
          if (!updated) throw new CcgServiceError(409, "pack_balance_busy", "Pack balance is being updated. Try again");
        } else {
          if (!reservedCode.cardId || !reservedCode.finish || !reservedCode.artVariant) {
            throw new CcgServiceError(409, "reward_unavailable", "This code's card reward is unavailable");
          }
          const card = await CcgCard.findOne({
            _id: reservedCode.cardId,
            availabilityStatus: { $ne: "archived" },
          }).session(session);
          const cardSet = card ? await CcgSet.findById(card.setId).session(session) : null;
          if (!card || !cardSet || !getCcgRedeemFinishOrder(cardSet.kind, cardSet.customFinish?.key).includes(reservedCode.finish)) {
            throw new CcgServiceError(409, "reward_unavailable", "This code's card reward is unavailable");
          }
          if (reservedCode.artVariant === "alternative") {
            const alternativeArt = (await this.loadAlternativeArt([card], session)).get(resolveCollectorKey(card));
            if (!hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId))) {
              throw new CcgServiceError(409, "reward_unavailable", "This code's custom artwork is unavailable");
            }
          }
          await this.addOwnership(owner, [{
            cardId: card._id,
            setId: card.setId,
            characterId: card.characterId,
            snapshotVersion: card.snapshotVersion,
            finish: reservedCode.finish,
            artVariant: reservedCode.artVariant,
          }], session);
        }

        await CcgRedeemClaim.create([{
          codeId: reservedCode._id,
          userId,
          rewardType: reservedCode.rewardType,
          packs: getRedeemPackCount(reservedCode),
          cardId: reservedCode.cardId ?? null,
          finish: reservedCode.finish ?? null,
          artVariant: reservedCode.artVariant ?? null,
          redeemedAt: now,
        }], { session });
        await CcgLedgerEntry.create([{
          ownerType: "user",
          ownerId: userId,
          action: "redeem_code",
          mode: null,
          idempotencyKey: `redeem-code:${reservedCode._id}`,
          amount: reservedCode.rewardType === "packs" ? getRedeemPackCount(reservedCode) : 1,
          metadata: {
            codeId: String(reservedCode._id),
            rewardType: reservedCode.rewardType,
            packs: getRedeemPackCount(reservedCode),
            cardId: reservedCode.cardId ? String(reservedCode.cardId) : null,
            finish: reservedCode.finish ?? null,
            artVariant: reservedCode.artVariant ?? null,
          },
        }], { session });

        redeemed = {
          code: reservedCode.code,
          rewardType: reservedCode.rewardType,
          packs: getRedeemPackCount(reservedCode),
          cardId: reservedCode.cardId ?? null,
          finish: reservedCode.finish ?? null,
          artVariant: reservedCode.artVariant ?? null,
        };
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        throw new CcgServiceError(503, "transactions_unavailable", "Code redemption is temporarily unavailable while collection storage is starting");
      }
      if (isDuplicateKeyError(error)) throw new CcgServiceError(409, "redeem_code_already_used", "You have already redeemed this code");
      throw error;
    } finally {
      await session.endSession();
    }

    const reward = redeemed as RedeemedCodeSnapshot | null;
    if (!reward) throw new CcgServiceError(500, "redemption_failed", "Code redemption did not complete");
    if (reward.rewardType === "packs") {
      return {
        code: reward.code,
        sets: [],
        reward: { type: "packs", packs: reward.packs },
      };
    }
    if (!reward.cardId || !reward.finish || !reward.artVariant) {
      throw new CcgServiceError(500, "redemption_failed", "The card reward could not be recovered");
    }

    const card = await CcgCard.findById(reward.cardId).lean();
    const set = card ? await CcgSet.findById(card.setId).lean() : null;
    if (!card || !set) throw new CcgServiceError(500, "redemption_failed", "The card reward could not be recovered");
    const owner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: getHelsinkiDateKey() };
    const [ownership, alternativeByCollector, unlockedAlternativeSeries] = await Promise.all([
      CcgOwnership.find({ ownerType: "user", ownerId: userId, setId: card.setId, characterId: card.characterId })
        .select("finish quantity alternativeQuantity -_id")
        .lean(),
      this.loadAlternativeArt([card]),
      this.loadAlternativeArtUnlocks(owner, [card]),
    ]);
    const collectorKey = resolveCollectorKey(card);
    const alternativeArt = alternativeByCollector.get(collectorKey);
    return {
      code: reward.code,
      sets: [this.serializeSet(set)],
      reward: {
        type: "card",
        finish: reward.finish,
        artVariant: reward.artVariant,
        card: {
          ...this.serializeCard(card, set, alternativeArt, { seriesOwned: true, snapshotOwned: true }),
          ownership: serializeOwnershipRows(
            ownership,
            unlockedAlternativeSeries.has(getSeriesKey(card))
              && hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId)),
          ),
          totalQuantity: ownership.reduce((total, row) => total + row.quantity, 0),
        },
      },
    };
  }

  async openPack(req: Request, res: Response, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    const owner = await this.resolveOwner(req, res);
    const targetSetId = body.setId === undefined || body.setId === null || body.setId === ""
      ? null
      : validateObjectId(String(body.setId), "card set ID");
    const selectionType: CcgPackSelectionType = targetSetId ? "raid" : "all";
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const existing = await CcgPackOpening.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey }).lean();
    if (existing) {
      this.enqueuePackOpeningAnalytics(existing._id);
      return this.serializeOpening(existing);
    }
    const session = await mongoose.startSession();
    let openingId: mongoose.Types.ObjectId | null = null;
    let committedOpening: ICcgPackOpening | null = null;
    let committedCards: ICcgCard[] = [];
    let committedSets: ICcgSet[] = [];
    let committedAlternativeArt = new Map<string, CcgAlternativeArtDefinition>();
    let cacheUpdates: CcgPackOpenState | null = null;

    try {
      await retryMongoWriteConflict(() => session.withTransaction(async () => {
        openingId = null;
        committedOpening = null;
        committedCards = [];
        committedSets = [];
        committedAlternativeArt = new Map();
        cacheUpdates = null;
        const duplicateOpening = await CcgPackOpening.findOne({ ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey }).session(session);
        if (duplicateOpening) {
          openingId = duplicateOpening._id;
          return;
        }
        const allowanceSource = await this.reservePack(owner, session);
        const pool = await this.selectPackResults(session, targetSetId, true, true, owner);
        const candidateSelections = pool.results;
        const candidateIds = candidateSelections.flatMap((result) => [
          result.cardId,
          ...result.missingCardAlternatives.map((alternative) => alternative.cardId),
        ]);
        const candidateCards = await CcgCard.find({
          _id: { $in: candidateIds },
          setId: { $in: pool.sourceSetIds },
        }).session(session).lean();
        const sourceSets = await CcgSet.find({ _id: { $in: pool.sourceSetIds } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .session(session)
          .lean();
        const setById = new Map(sourceSets.map((set) => [String(set._id), set]));
        const candidateCardById = new Map(candidateCards.map((card) => [String(card._id), card]));
        if (candidateCardById.size === 0) throw new CcgServiceError(409, "pool_unavailable", "This card set has no available cards");
        const candidateSeriesPairs = Array.from(new Map(candidateCards.map((card) => [getSeriesKey(card), {
          setId: card.setId,
          characterId: card.characterId,
        }])).values());
        const seriesOwnershipRows = await CcgSeriesOwnership.find({
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          $or: candidateSeriesPairs,
        }).select("setId characterId unlockedSnapshotVersions").session(session).lean();
        const ownedSnapshotVersionsBySeries = new Map(
          seriesOwnershipRows.map((row) => [getSeriesKey(row), new Set(row.unlockedSnapshotVersions)]),
        );
        const alreadyOwnedSeriesKeys = new Set(ownedSnapshotVersionsBySeries.keys());
        const selectionOwnedSeriesKeys = new Set(alreadyOwnedSeriesKeys);
        const selected = candidateSelections.map((selection) => {
          const primary = candidateCardById.get(String(selection.cardId));
          if (!primary) throw new CcgServiceError(409, "pool_invalid", "The pack pool changed while this pack was opening");
          const missingCardAlternatives = selection.missingCardAlternatives.flatMap((alternative) => {
            const card = candidateCardById.get(String(alternative.cardId));
            return card ? [card] : [];
          });
          const card = resolveMissingCardNudge(
            primary,
            missingCardAlternatives,
            (candidate) => selectionOwnedSeriesKeys.has(getSeriesKey(candidate)),
          );
          selectionOwnedSeriesKeys.add(getSeriesKey(card));
          return { cardId: card._id, setId: card.setId, tierGrade: card.tierGrade };
        });
        const cards = selected.flatMap((result) => {
          const card = candidateCardById.get(String(result.cardId));
          return card ? [card] : [];
        });
        if (cards.length !== CCG_CARDS_PER_PACK) throw new CcgServiceError(409, "pool_invalid", "The pack pool is incomplete");
        const cardById = new Map(cards.map((card) => [String(card._id), card]));
        const seriesPairs = Array.from(new Map(cards.map((card) => [getSeriesKey(card), {
          setId: card.setId,
          characterId: card.characterId,
        }])).values());
        const ownershipRows = await CcgOwnership.find({
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          $or: seriesPairs,
        }).session(session).lean();
        const ownedFinishesBySeries = new Map<string, Set<CcgFinish>>();
        for (const row of ownershipRows) {
          const seriesKey = getSeriesKey(row);
          const finishes = ownedFinishesBySeries.get(seriesKey) ?? new Set<CcgFinish>();
          finishes.add(row.finish);
          ownedFinishesBySeries.set(seriesKey, finishes);
        }
        const alternativeByCollector = await this.loadAlternativeArt(cards, session);
        const qualityProgress = await this.ensureQualityProgress(owner, session);
        let pity = this.readFinishPity(qualityProgress);
        const results: SelectedResult[] = [];
        const completedCardDuplicates: Array<Pick<SelectedResult, "cardId" | "setId" | "characterId"> & { resultIndex: number }> = [];
        for (const result of selected) {
          const card = cardById.get(String(result.cardId));
          if (!card) continue;
          const collectorKey = resolveCollectorKey(card);
          const seriesKey = getSeriesKey(card);
          const cardSet = setById.get(String(card.setId));
          if (!cardSet) throw new CcgServiceError(409, "pool_invalid", "The pack references an unavailable card set");
          const ownedFinishes = ownedFinishesBySeries.get(seriesKey) ?? new Set<CcgFinish>();
          const isNewCard = !ownedSnapshotVersionsBySeries.has(seriesKey);
          const ownedSnapshotVersions = ownedSnapshotVersionsBySeries.get(seriesKey) ?? new Set<number>();
          const customFinish = cardSet.kind === "raid" ? cardSet.customFinish?.key ?? null : null;
          const finishOrder = getCcgPackFinishOrder(cardSet.kind, customFinish);
          const activePity: CcgFinishPity = { ...pity };
          if (customFinish) activePity[customFinish] = this.readCustomFinishPity(qualityProgress, cardSet.slug);
          const rolled = rollOwnedFinish(
            activePity,
            ownedFinishes,
            randomInt,
            finishOrder,
            customFinish
              ? { ...CCG_FINISH_PITY_LIMITS, [customFinish]: cardSet.customFinish!.hardPity }
              : CCG_FINISH_PITY_LIMITS,
          );
          const finish = rolled.finish;
          const isNewFinish = !ownedFinishes.has(finish);
          const isNewSnapshot = !ownedSnapshotVersions.has(card.snapshotVersion);
          const alternativeArt = alternativeByCollector.get(collectorKey);
          const artVariant = rollArtVariant(hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId)));
          pity = this.readFinishPity(rolled.pity);
          if (customFinish) this.writeCustomFinishPity(qualityProgress, cardSet.slug, rolled.pity[customFinish] ?? 0);
          ownedFinishes.add(finish);
          ownedFinishesBySeries.set(seriesKey, ownedFinishes);
          ownedSnapshotVersions.add(card.snapshotVersion);
          ownedSnapshotVersionsBySeries.set(seriesKey, ownedSnapshotVersions);
          if (rolled.isCompletedCardDuplicate) {
            completedCardDuplicates.push({
              cardId: card._id,
              setId: card.setId,
              characterId: card.characterId,
              resultIndex: results.length,
            });
          }
          results.push({
            cardId: card._id,
            setId: card.setId,
            characterId: card.characterId,
            snapshotVersion: card.snapshotVersion,
            finish,
            artVariant,
            tierGrade: card.tierGrade,
            isDuplicate: rolled.isDuplicate,
            isNewCard,
            isNewFinish,
            isNewSnapshot,
          });
        }
        if (results.length !== CCG_CARDS_PER_PACK) throw new CcgServiceError(409, "pool_invalid", "The pack pool is incomplete");

        openingId = new mongoose.Types.ObjectId();
        const ownedCardsBySetDelta = this.getOwnedCardDeltas(cards, alreadyOwnedSeriesKeys);
        this.writeFinishPity(qualityProgress, pity);
        await qualityProgress.save({ session });
        await this.addOwnership(owner, results, session);
        const completionRewards = owner.ownerType === "user"
          ? await this.grantCompletedCardRewards(owner.ownerId, completedCardDuplicates, session)
          : { total: 0, rewardedSeriesKeys: new Set<string>() };
        const duplicateRewards = completionRewards.total;
        const pendingRewardSeriesKeys = new Set(completionRewards.rewardedSeriesKeys);
        const rewardedResultIndexes = new Set<number>();
        for (const candidate of completedCardDuplicates) {
          if (pendingRewardSeriesKeys.delete(getSeriesKey(candidate))) rewardedResultIndexes.add(candidate.resultIndex);
        }
        const shuffledResults = shufflePackResults(results.map((result, index) => ({
          ...result,
          bonusPackReward: rewardedResultIndexes.has(index),
        })));
        const [opening] = await CcgPackOpening.create(
          [
            {
              _id: openingId,
              ownerType: owner.ownerType,
              ownerId: owner.ownerId,
              selectionType,
              targetSetId,
              sourceSetIds: pool.sourceSetIds,
              allowanceSource: allowanceSource.source,
              creditId: allowanceSource.creditId ?? null,
              idempotencyKey,
              poolVersion: pool.version,
              packRuleVersion: CCG_PACK_RULE_VERSION,
              results: shuffledResults,
              duplicateRewards,
              state: "committed",
              analyticsPending: true,
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
            },
          ],
          { session },
        );
        await CcgLedgerEntry.create(
          [
            {
              ownerType: owner.ownerType,
              ownerId: owner.ownerId,
              action: "pack_open",
              idempotencyKey: `pack:${idempotencyKey}`,
              amount: -1,
              metadata: {
                openingId: String(openingId),
                selectionType,
                targetSetId: targetSetId ? String(targetSetId) : null,
                setIds: Array.from(new Set(results.map((result) => String(result.setId)))),
                allowanceSource: allowanceSource.source,
              },
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
            },
          ],
          { session },
        );
        const creditBalance = await this.getPackCreditBalance(owner, session);
        const qualityProtection = this.readFinishPity(qualityProgress);
        const customQualityProtection = sourceSets
          .filter((set) => set.customFinish?.key)
          .map((set) => {
            const counter = this.readCustomFinishPity(qualityProgress, set.slug);
            return {
              setSlug: set.slug,
              counter,
            };
          });
        cacheUpdates = {
          packs: this.serializePackBalances(allowanceSource.balance, creditBalance),
          qualityProtection,
          customQualityProtection,
          ownedFinishesDelta: results.filter((result) => result.isNewFinish).length,
          ownedCardsBySetDelta,
        };
        committedOpening = opening;
        committedCards = cards as ICcgCard[];
        const resultSetIds = new Set(results.map((result) => String(result.setId)));
        committedSets = sourceSets.filter((set) => resultSetIds.has(String(set._id))) as ICcgSet[];
        committedAlternativeArt = alternativeByCollector;
      }), {
        maxAttempts: CCG_TRANSACTION_WRITE_CONFLICT_MAX_ATTEMPTS,
        onRetry: (_error, failedAttempt, delayMs) => {
          logger.warn(`[CCG] Pack opening hit a MongoDB write conflict; retrying transaction in ${delayMs}ms (attempt ${failedAttempt + 1}/${CCG_TRANSACTION_WRITE_CONFLICT_MAX_ATTEMPTS})`);
        },
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        throw new CcgServiceError(503, "transactions_unavailable", "Pack opening is temporarily unavailable while collection storage is starting");
      }
      if (isMongoWriteConflict(error)) {
        throw new CcgServiceError(503, "pack_open_busy", "Another pack opening is being completed. Try again");
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (!openingId) throw new CcgServiceError(500, "opening_failed", "Pack opening did not complete");
    this.enqueuePackOpeningAnalytics(openingId);
    if (committedOpening) {
      return {
        ...this.serializeOpeningFromEntities(
          committedOpening,
          committedCards,
          committedSets,
          committedAlternativeArt,
        ),
        ...(cacheUpdates ? { cacheUpdates } : {}),
      };
    }
    const opening = await CcgPackOpening.findById(openingId).lean();
    if (!opening) throw new CcgServiceError(500, "opening_failed", "Pack opening could not be recovered");
    return this.serializeOpening(opening);
  }

  async getOpening(owner: CcgOwner, openingId: string): Promise<Record<string, unknown>> {
    const id = validateObjectId(openingId, "opening ID");
    const ownershipFilter: mongoose.QueryFilter<ICcgPackOpening> = owner.ownerType === "user"
      ? {
          $or: [
            { ownerType: "user", ownerId: owner.ownerId },
            { ownerType: "guest", claimedByUserId: owner.ownerId },
          ],
        }
      : { ownerType: "guest", ownerId: owner.ownerId };
    const opening = await CcgPackOpening.findOne({ _id: id, ...ownershipFilter }).lean();
    if (!opening) throw new CcgServiceError(404, "opening_not_found", "Pack opening not found");
    return this.serializeOpening(opening);
  }

  async claimGuest(req: Request, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    requireFeature();
    await this.ensureAnalyticsInitialized();
    if (!req.session.userId) throw new CcgServiceError(401, "authentication_required", "Log in to keep this pack");
    const userId = validateObjectId(req.session.userId, "user session");
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const requestedOpeningId = body.openingId === undefined
      ? null
      : validateObjectId(String(body.openingId), "guest pack opening");
    const guest = await this.findClaimableGuest(req, true);
    if (!guest) return { claimed: false, alreadyClaimed: false, cards: 0, duplicates: 0, transferredPacks: 0, startingPacks: 0 };
    if (guest.claimedByUserId) {
      if (String(guest.claimedByUserId) !== String(userId)) throw new CcgServiceError(409, "guest_already_claimed", "These guest cards were already claimed");
      return { claimed: false, alreadyClaimed: true, cards: 0, duplicates: 0, transferredPacks: 0, startingPacks: 0 };
    }
    const session = await mongoose.startSession();
    let response: Record<string, unknown> | null = null;
    try {
      await session.withTransaction(async () => {
        const transactionalGuest = await CcgGuest.findOne({
          _id: guest._id,
        }).session(session);
        if (!transactionalGuest) throw new CcgServiceError(404, "guest_not_found", "This guest collection was not found");
        if (transactionalGuest.claimedByUserId) {
          response = { claimed: false, alreadyClaimed: true, cards: 0, duplicates: 0, transferredPacks: 0, startingPacks: 0 };
          return;
        }
        const guestOpenings = await CcgPackOpening.find({
          ownerType: "guest",
          ownerId: transactionalGuest._id,
          claimedAt: null,
          state: "committed",
        }).sort({ createdAt: 1, _id: 1 }).session(session);
        const openingId = resolveGuestClaimOpeningId(
          guestOpenings.map((candidate) => String(candidate._id)),
          requestedOpeningId ? String(requestedOpeningId) : null,
        );
        const opening = openingId
          ? guestOpenings.find((candidate) => String(candidate._id) === openingId)
          : null;
        if (!opening) {
          throw new CcgServiceError(404, "guest_opening_not_found", "This guest pack cannot be claimed");
        }

        const userOwner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: getHelsinkiDateKey() };
        if (await this.hasCcgActivity(userOwner, session)) {
          throw new CcgServiceError(409, "ccg_account_already_started", "This account has already started its CCG collection");
        }
        const userBalance = await this.ensurePackBalance(userOwner, session);
        const firstPlay = await CcgPackBalance.findOneAndUpdate(
          { _id: userBalance._id, hasPlayed: { $ne: true } },
          { $set: { hasPlayed: true, firstPlayedAt: new Date() } },
          { returnDocument: "after", session },
        );
        if (!firstPlay) {
          throw new CcgServiceError(409, "ccg_account_already_started", "This account has already started its CCG collection");
        }

        const guestOwnership = await CcgOwnership.find({
          ownerType: "guest",
          ownerId: transactionalGuest._id,
        }).session(session);
        const guestCardIds = Array.from(new Set([
          ...guestOpenings.flatMap((candidate) => candidate.results.map((result) => String(result.cardId))),
          ...guestOwnership.map((row) => String(row.cardId)),
        ])).map((cardId) => new mongoose.Types.ObjectId(cardId));
        const guestCards = await CcgCard.find({ _id: { $in: guestCardIds } })
          .select("_id setId characterId")
          .session(session)
          .lean();
        const seriesByCardId = new Map(guestCards.map((card) => [String(card._id), getSeriesKey(card)]));
        const guestBalance = await CcgPackBalance.findOne({
          ownerType: "guest",
          ownerId: transactionalGuest._id,
        }).session(session);
        const verifiedLibrary = verifyGuestLibrary(
          guestOpenings.map((candidate) => ({
            results: candidate.results.map((result) => ({
              cardId: result.cardId,
              seriesKey: seriesByCardId.get(String(result.cardId)),
              finish: result.finish,
              artVariant: result.artVariant,
              isDuplicate: result.isDuplicate,
            })),
          })),
          guestOwnership.map((row) => ({
            cardId: row.cardId,
            seriesKey: getSeriesKey(row),
            finish: row.finish,
            quantity: row.quantity,
            alternativeQuantity: row.alternativeQuantity,
          })),
        );
        if (!verifiedLibrary) {
          throw new CcgServiceError(409, "guest_library_invalid", "This guest collection could not be verified");
        }
        const transferredPacks = getTransferableGuestPacks(guestBalance?.remaining);
        if (transferredPacks > 0) {
          await CcgPackCredit.create([{
            ownerId: userId,
            source: "login_conversion",
            sourceKey: `guest-conversion:${transactionalGuest._id}`,
            remaining: transferredPacks,
          }], { session, ordered: true });
        }

        const claimedAt = new Date();
        await CcgOwnership.updateMany(
          { ownerType: "guest", ownerId: transactionalGuest._id },
          {
            $set: {
              ownerType: "user",
              ownerId: userId,
              dateKey: null,
              lastAcquiredAt: claimedAt,
            },
          },
          { session },
        );
        await CcgSeriesOwnership.updateMany(
          { ownerType: "guest", ownerId: transactionalGuest._id },
          {
            $set: {
              ownerType: "user",
              ownerId: userId,
              dateKey: null,
              lastAcquiredAt: claimedAt,
            },
          },
          { session },
        );
        await CcgQualityProgress.updateMany(
          { ownerType: "guest", ownerId: transactionalGuest._id },
          {
            $set: {
              ownerType: "user",
              ownerId: userId,
            },
          },
          { session },
        );
        await CcgPackOpening.updateMany(
          {
            ownerType: "guest",
            ownerId: transactionalGuest._id,
            claimedAt: null,
          },
          {
            $set: {
              claimedByUserId: userId,
              claimedAt,
              dateKey: null,
            },
          },
          { session },
        );
        await CcgGuest.updateOne(
          { _id: transactionalGuest._id, claimedAt: null },
          { $set: { claimedByUserId: userId, claimedAt } },
          { session },
        );
        await CcgAnalyticsParticipant.updateOne(
          { ownerKey: getAnalyticsOwnerKey("guest", transactionalGuest._id) },
          {
            $set: {
              ownerKey: getAnalyticsOwnerKey("user", userId),
              ownerType: "user",
              ownerId: userId,
            },
          },
          { session },
        );
        await CcgAnalyticsDailyParticipant.updateMany(
          { ownerKey: getAnalyticsOwnerKey("guest", transactionalGuest._id) },
          {
            $set: {
              ownerKey: getAnalyticsOwnerKey("user", userId),
              ownerType: "user",
              ownerId: userId,
            },
          },
          { session },
        );
        await CcgPackBalance.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
        await CcgLedgerEntry.create(
          [
            {
              ownerType: "user",
              ownerId: userId,
              action: "guest_claim",
              idempotencyKey: `guest-claim:${transactionalGuest._id}`,
              amount: verifiedLibrary.totalCards,
              metadata: {
                requestIdempotencyKey: idempotencyKey,
                guestId: String(transactionalGuest._id),
                openingId: String(opening._id),
                openingIds: guestOpenings.map((guestOpening) => String(guestOpening._id)),
                pulls: verifiedLibrary.cards,
                duplicates: verifiedLibrary.duplicates,
                transferredPacks,
                startingPacks: CCG_INITIAL_PACKS.user,
              },
            },
          ],
          { session },
        );
        response = {
          claimed: true,
          alreadyClaimed: false,
          cards: verifiedLibrary.cards,
          duplicates: verifiedLibrary.duplicates,
          transferredPacks,
          startingPacks: CCG_INITIAL_PACKS.user,
        };
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new CcgServiceError(409, "ccg_account_already_started", "This account has already started its CCG collection");
      }
      if (isTransactionUnsupported(error)) {
        throw new CcgServiceError(503, "transactions_unavailable", "Card claiming is temporarily unavailable while collection storage is starting");
      }
      throw error;
    } finally {
      await session.endSession();
    }
    return response ?? { claimed: false, alreadyClaimed: true, cards: 0, duplicates: 0, transferredPacks: 0, startingPacks: 0 };
  }

  async resolveOwner(req: Request, res: Response): Promise<CcgOwner> {
    requireFeature();
    const dateKey = getHelsinkiDateKey();
    if (req.session.userId && mongoose.Types.ObjectId.isValid(req.session.userId)) {
      const userId = new mongoose.Types.ObjectId(req.session.userId);
      if (await User.exists({ _id: userId })) return { ownerType: "user", ownerId: userId, dateKey };
    }
    const rawCookie = typeof req.cookies?.[CCG_GUEST_COOKIE] === "string" ? req.cookies[CCG_GUEST_COOKIE] : null;
    if (rawCookie) {
      const now = new Date();
      const existing = await CcgGuest.findOne({ tokenHash: hashGuestToken(rawCookie), claimedAt: null }).lean();
      if (existing) {
        if (existing.lastSeenAt.getTime() <= now.getTime() - CCG_GUEST_LAST_SEEN_WRITE_INTERVAL_MS) {
          void CcgGuest.updateOne(
            { _id: existing._id, lastSeenAt: { $lte: new Date(now.getTime() - CCG_GUEST_LAST_SEEN_WRITE_INTERVAL_MS) } },
            { $set: { lastSeenAt: now } },
          ).catch((error) => logger.error("[CCG] Failed to update guest activity:", error));
        }
        this.setGuestCookie(res, rawCookie);
        return { ownerType: "guest", ownerId: existing._id, dateKey };
      }
    }
    const token = randomBytes(32).toString("base64url");
    const guest = await CcgGuest.create({
      tokenHash: hashGuestToken(token),
      dateKey,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    this.setGuestCookie(res, token);
    return { ownerType: "guest", ownerId: guest._id, dateKey };
  }

  private setGuestCookie(res: Response, token: string): void {
    res.cookie(CCG_GUEST_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/ccg",
      maxAge: CCG_GUEST_COOKIE_MAX_AGE_MS,
      expires: new Date(Date.now() + CCG_GUEST_COOKIE_MAX_AGE_MS),
    });
  }

  private async ensureAnalyticsInitialized(): Promise<void> {
    if (this.analyticsReady) return;
    const ready = await CcgAnalyticsSummary.exists({
      key: CCG_ANALYTICS_KEY,
      schemaVersion: CCG_ANALYTICS_SCHEMA_VERSION,
      detailedSchemaVersion: CCG_ANALYTICS_DETAILED_SCHEMA_VERSION,
    });
    if (ready) {
      this.analyticsReady = true;
      return;
    }

    if (!this.analyticsInitialization) {
      this.analyticsInitialization = this.initializeAnalytics().finally(() => {
        this.analyticsInitialization = null;
      });
    }
    await this.analyticsInitialization;
    this.analyticsReady = true;
  }

  private async initializeAnalytics(): Promise<void> {
    const lockOwner = randomBytes(16).toString("hex");
    const startedAt = Date.now();
    const now = new Date(startedAt);
    await CcgJobLock.deleteOne({ key: CCG_ANALYTICS_INITIALIZATION_LOCK, expiresAt: { $lte: now } });

    let acquired = false;
    try {
      await CcgJobLock.create({
        key: CCG_ANALYTICS_INITIALIZATION_LOCK,
        owner: lockOwner,
        expiresAt: new Date(startedAt + CCG_ANALYTICS_INITIALIZATION_TIMEOUT_MS),
      });
      acquired = true;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }

    if (!acquired) {
      while (Date.now() - startedAt < CCG_ANALYTICS_INITIALIZATION_TIMEOUT_MS) {
        const ready = await CcgAnalyticsSummary.exists({
          key: CCG_ANALYTICS_KEY,
          schemaVersion: CCG_ANALYTICS_SCHEMA_VERSION,
          detailedSchemaVersion: CCG_ANALYTICS_DETAILED_SCHEMA_VERSION,
        });
        if (ready) return;
        await wait(100);
      }
      throw new CcgServiceError(503, "analytics_initializing", "Vault activity is still being prepared");
    }

    try {
      const ready = await CcgAnalyticsSummary.exists({
        key: CCG_ANALYTICS_KEY,
        schemaVersion: CCG_ANALYTICS_SCHEMA_VERSION,
        detailedSchemaVersion: CCG_ANALYTICS_DETAILED_SCHEMA_VERSION,
      });
      if (ready) return;

      await Promise.all([
        CcgAnalyticsDaily.init(),
        CcgAnalyticsDailyParticipant.init(),
        CcgAnalyticsParticipant.init(),
        CcgAnalyticsSummary.init(),
      ]);
      const summary = await CcgAnalyticsSummary.findOne({ key: CCG_ANALYTICS_KEY }).lean();
      if (summary?.schemaVersion !== CCG_ANALYTICS_SCHEMA_VERSION) {
        await this.initializeAnalyticsParticipants();
      }
      if (summary?.detailedSchemaVersion !== CCG_ANALYTICS_DETAILED_SCHEMA_VERSION) {
        await this.initializeDetailedAnalytics();
      }
    } finally {
      await CcgJobLock.deleteOne({ key: CCG_ANALYTICS_INITIALIZATION_LOCK, owner: lockOwner })
        .catch((error) => logger.error("[CCG] Failed to release the analytics initialization lock:", error));
    }
  }

  private async initializeAnalyticsParticipants(): Promise<void> {
    await CcgPackOpening.aggregate([
        { $match: { state: "committed", analyticsPending: { $ne: true } } },
        {
          $lookup: {
            from: CcgGuest.collection.name,
            localField: "ownerId",
            foreignField: "_id",
            as: "guest",
          },
        },
        {
          $set: {
            effectiveUserId: {
              $ifNull: [
                "$claimedByUserId",
                { $arrayElemAt: ["$guest.claimedByUserId", 0] },
              ],
            },
          },
        },
        {
          $project: {
            effectiveOwnerType: {
              $cond: [
                { $ne: [{ $ifNull: ["$effectiveUserId", null] }, null] },
                "user",
                "$ownerType",
              ],
            },
            effectiveOwnerId: { $ifNull: ["$effectiveUserId", "$ownerId"] },
            createdAt: 1,
          },
        },
        {
          $group: {
            _id: {
              ownerType: "$effectiveOwnerType",
              ownerId: "$effectiveOwnerId",
            },
            packOpenings: { $sum: 1 },
            firstOpenedAt: { $min: "$createdAt" },
            lastOpenedAt: { $max: "$createdAt" },
          },
        },
        {
          $project: {
            _id: 0,
            ownerKey: {
              $concat: ["$_id.ownerType", ":", { $toString: "$_id.ownerId" }],
            },
            ownerType: "$_id.ownerType",
            ownerId: "$_id.ownerId",
            packOpenings: 1,
            firstOpenedAt: 1,
            lastOpenedAt: 1,
          },
        },
        {
          $merge: {
            into: CcgAnalyticsParticipant.collection.name,
            on: "ownerKey",
            whenMatched: [
              {
                $set: {
                  ownerType: "$$new.ownerType",
                  ownerId: "$$new.ownerId",
                  packOpenings: "$$new.packOpenings",
                  firstOpenedAt: "$$new.firstOpenedAt",
                  lastOpenedAt: "$$new.lastOpenedAt",
                },
              },
            ],
            whenNotMatched: "insert",
          },
        },
    ]);

    const [totals] = await CcgAnalyticsParticipant.aggregate<{
      uniqueUsers: number;
      packOpenings: number;
    }>([
      {
        $group: {
          _id: null,
          uniqueUsers: { $sum: 1 },
          packOpenings: { $sum: "$packOpenings" },
        },
      },
    ]);
    await CcgAnalyticsSummary.findOneAndUpdate(
      { key: CCG_ANALYTICS_KEY },
      {
        $set: {
          schemaVersion: CCG_ANALYTICS_SCHEMA_VERSION,
          uniqueUsers: totals?.uniqueUsers ?? 0,
          packOpenings: totals?.packOpenings ?? 0,
          updatedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  }

  private async initializeDetailedAnalytics(): Promise<void> {
    const dateKeyExpression = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: CCG_TIME_ZONE } };
    await CcgPackOpening.aggregate([
      { $match: { state: "committed", analyticsPending: { $ne: true } } },
      {
        $group: {
          _id: dateKeyExpression,
          packOpenings: { $sum: 1 },
          updatedAt: { $max: "$createdAt" },
        },
      },
      {
        $project: {
          _id: 0,
          dateKey: "$_id",
          packOpenings: 1,
          activeUsers: { $literal: 0 },
          finishes: {
            $literal: Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, 0])),
          },
          grades: { $literal: { H: 0, S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 } },
          updatedAt: 1,
        },
      },
      {
        $merge: {
          into: CcgAnalyticsDaily.collection.name,
          on: "dateKey",
          whenMatched: [{ $set: { packOpenings: "$$new.packOpenings", updatedAt: "$$new.updatedAt" } }],
          whenNotMatched: "insert",
        },
      },
    ]);

    const finishSums = Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [
      finish,
      { $sum: { $cond: [{ $eq: ["$results.finish", finish] }, 1, 0] } },
    ]));
    const gradeSums = Object.fromEntries(CCG_TIER_GRADES.map((grade) => [
      grade,
      { $sum: { $cond: [{ $eq: ["$results.tierGrade", grade] }, 1, 0] } },
    ]));
    await CcgPackOpening.aggregate([
      { $match: { state: "committed", analyticsPending: { $ne: true } } },
      { $unwind: "$results" },
      { $group: { _id: dateKeyExpression, ...finishSums, ...gradeSums } },
      {
        $project: {
          _id: 0,
          dateKey: "$_id",
          finishes: Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, `$${finish}`])),
          grades: Object.fromEntries(CCG_TIER_GRADES.map((grade) => [grade, `$${grade}`])),
        },
      },
      {
        $merge: {
          into: CcgAnalyticsDaily.collection.name,
          on: "dateKey",
          whenMatched: [{ $set: { finishes: "$$new.finishes", grades: "$$new.grades" } }],
          whenNotMatched: "discard",
        },
      },
    ]);

    await CcgPackOpening.aggregate([
      { $match: { state: "committed", analyticsPending: { $ne: true } } },
      {
        $lookup: {
          from: CcgGuest.collection.name,
          localField: "ownerId",
          foreignField: "_id",
          as: "guest",
        },
      },
      {
        $set: {
          effectiveUserId: {
            $ifNull: ["$claimedByUserId", { $arrayElemAt: ["$guest.claimedByUserId", 0] }],
          },
        },
      },
      {
        $project: {
          dateKey: dateKeyExpression,
          effectiveOwnerType: {
            $cond: [{ $ne: [{ $ifNull: ["$effectiveUserId", null] }, null] }, "user", "$ownerType"],
          },
          effectiveOwnerId: { $ifNull: ["$effectiveUserId", "$ownerId"] },
          createdAt: 1,
        },
      },
      {
        $group: {
          _id: { dateKey: "$dateKey", ownerType: "$effectiveOwnerType", ownerId: "$effectiveOwnerId" },
          firstOpenedAt: { $min: "$createdAt" },
          lastOpenedAt: { $max: "$createdAt" },
        },
      },
      {
        $project: {
          _id: 0,
          dateKey: "$_id.dateKey",
          ownerKey: { $concat: ["$_id.ownerType", ":", { $toString: "$_id.ownerId" }] },
          ownerType: "$_id.ownerType",
          ownerId: "$_id.ownerId",
          firstOpenedAt: 1,
          lastOpenedAt: 1,
        },
      },
      {
        $merge: {
          into: CcgAnalyticsDailyParticipant.collection.name,
          on: ["dateKey", "ownerKey"],
          whenMatched: [{ $set: { ownerType: "$$new.ownerType", ownerId: "$$new.ownerId", firstOpenedAt: "$$new.firstOpenedAt", lastOpenedAt: "$$new.lastOpenedAt" } }],
          whenNotMatched: "insert",
        },
      },
    ]);
    await CcgAnalyticsDailyParticipant.aggregate([
      { $group: { _id: "$dateKey", activeUsers: { $sum: 1 } } },
      { $project: { _id: 0, dateKey: "$_id", activeUsers: 1 } },
      {
        $merge: {
          into: CcgAnalyticsDaily.collection.name,
          on: "dateKey",
          whenMatched: [{ $set: { activeUsers: "$$new.activeUsers" } }],
          whenNotMatched: "discard",
        },
      },
    ]);
    await CcgAnalyticsSummary.updateOne(
      { key: CCG_ANALYTICS_KEY, schemaVersion: CCG_ANALYTICS_SCHEMA_VERSION },
      { $set: { detailedSchemaVersion: CCG_ANALYTICS_DETAILED_SCHEMA_VERSION } },
    );
  }

  private queuePackOpeningAnalytics(openingId: mongoose.Types.ObjectId): Promise<boolean> {
    const queued = this.packAnalyticsQueue
      .catch(() => undefined)
      .then(() => this.recordPackOpeningAnalytics(openingId));
    this.packAnalyticsQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private enqueuePackOpeningAnalytics(openingId: mongoose.Types.ObjectId): void {
    void this.queuePackOpeningAnalytics(openingId).catch((error) => {
      logger.error(`[CCG] Failed to record analytics for opening ${openingId}:`, error);
    });
  }

  async processPendingPackOpeningAnalytics(limit = 100): Promise<number> {
    requireFeature();
    const openings = await CcgPackOpening.find({ analyticsPending: true })
      .select("_id")
      .sort({ createdAt: 1 })
      .limit(Math.max(1, Math.min(500, Math.floor(limit))))
      .lean();
    let processed = 0;
    for (const opening of openings) {
      if (await this.queuePackOpeningAnalytics(opening._id)) processed += 1;
    }
    return processed;
  }

  private async recordPackOpeningAnalytics(openingId: mongoose.Types.ObjectId): Promise<boolean> {
    const pending = await CcgPackOpening.findOne({ _id: openingId, analyticsPending: true })
      .select("createdAt")
      .lean();
    if (!pending) return false;

    await this.ensureAnalyticsInitialized();
    const dateKey = getHelsinkiDateKey(pending.createdAt);
    await this.ensureAnalyticsDailyBucket(dateKey);
    const session = await mongoose.startSession();
    let processed = false;
    try {
      await retryMongoWriteConflict(() => session.withTransaction(async () => {
        processed = false;
        const opening = await CcgPackOpening.findOne({ _id: openingId, analyticsPending: true })
          .select("ownerType ownerId claimedByUserId results createdAt")
          .session(session)
          .lean();
        if (!opening) return;

        const ownerType: CcgOwnerType = opening.claimedByUserId ? "user" : opening.ownerType;
        const ownerId = opening.claimedByUserId ?? opening.ownerId;
        const ownerKey = getAnalyticsOwnerKey(ownerType, ownerId);
        const openedAt = opening.createdAt;
        const participant = await CcgAnalyticsParticipant.updateOne(
          { ownerKey },
          {
            $setOnInsert: { ownerKey, ownerType, ownerId, firstOpenedAt: openedAt },
            $set: { lastOpenedAt: openedAt },
            $inc: { packOpenings: 1 },
          },
          { upsert: true, session },
        );
        const dailyParticipant = await CcgAnalyticsDailyParticipant.updateOne(
          { dateKey, ownerKey },
          {
            $setOnInsert: { dateKey, ownerKey, ownerType, ownerId, firstOpenedAt: openedAt },
            $set: { lastOpenedAt: openedAt },
          },
          { upsert: true, session },
        );
        const dailyIncrements: Record<string, number> = {
          packOpenings: 1,
          activeUsers: dailyParticipant.upsertedCount,
        };
        opening.results.forEach((result) => {
          dailyIncrements[`finishes.${result.finish}`] = (dailyIncrements[`finishes.${result.finish}`] ?? 0) + 1;
          dailyIncrements[`grades.${result.tierGrade}`] = (dailyIncrements[`grades.${result.tierGrade}`] ?? 0) + 1;
        });
        const daily = await CcgAnalyticsDaily.updateOne(
          { dateKey },
          { $set: { updatedAt: openedAt }, $inc: dailyIncrements },
          { session },
        );
        const summary = await CcgAnalyticsSummary.updateOne(
          {
            key: CCG_ANALYTICS_KEY,
            schemaVersion: CCG_ANALYTICS_SCHEMA_VERSION,
            detailedSchemaVersion: CCG_ANALYTICS_DETAILED_SCHEMA_VERSION,
          },
          {
            $inc: { uniqueUsers: participant.upsertedCount, packOpenings: 1 },
            $set: { updatedAt: openedAt },
          },
          { session },
        );
        if (daily.matchedCount !== 1 || summary.matchedCount !== 1) {
          this.analyticsReady = false;
          this.analyticsDailyBucketKey = null;
          throw new CcgServiceError(503, "analytics_unavailable", "Vault activity is temporarily unavailable");
        }
        await CcgPackOpening.updateOne(
          { _id: opening._id, analyticsPending: true },
          { $set: { analyticsPending: false, analyticsRecordedAt: new Date() } },
          { session },
        );
        processed = true;
      }), {
        maxAttempts: CCG_TRANSACTION_WRITE_CONFLICT_MAX_ATTEMPTS,
        onRetry: (_error, failedAttempt, delayMs) => {
          logger.warn(`[CCG] Pack analytics hit a MongoDB write conflict; retrying transaction in ${delayMs}ms (attempt ${failedAttempt + 1}/${CCG_TRANSACTION_WRITE_CONFLICT_MAX_ATTEMPTS})`);
        },
      });
    } finally {
      await session.endSession();
    }
    return processed;
  }

  private async ensureAnalyticsDailyBucket(dateKey: string): Promise<void> {
    if (this.analyticsDailyBucketKey === dateKey) return;
    try {
      await CcgAnalyticsDaily.updateOne(
        { dateKey },
        {
          $setOnInsert: {
            dateKey,
            packOpenings: 0,
            activeUsers: 0,
            finishes: Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, 0])),
            grades: { H: 0, S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
            updatedAt: new Date(),
          },
        },
        { upsert: true, setDefaultsOnInsert: false },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    this.analyticsDailyBucketKey = dateKey;
  }

  private readFinishPity(row?: Partial<ICcgQualityProgress> | null): CcgFinishPity {
    return {
      foil: row?.foil ?? 0,
      golden: row?.golden ?? 0,
      prismatic: row?.prismatic ?? 0,
      holographic: row?.holographic ?? 0,
      negative: row?.negative ?? 0,
      astral: row?.astral ?? 0,
    };
  }

  private serializePackBalances(
    packBalance: Pick<ICcgPackBalance, "remaining">,
    creditBalance: number,
  ): { regularRemaining: number; bonusRemaining: number; totalRemaining: number } {
    return {
      regularRemaining: packBalance.remaining,
      bonusRemaining: creditBalance,
      totalRemaining: packBalance.remaining + creditBalance,
    };
  }

  private readCustomFinishPity(row: Partial<ICcgQualityProgress> | null | undefined, setSlug: string): number {
    const custom = row?.custom;
    const value = custom instanceof Map
      ? custom.get(setSlug)
      : custom && typeof custom === "object"
        ? (custom as unknown as Record<string, number>)[setSlug]
        : 0;
    return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
  }

  private writeFinishPity(row: ICcgQualityProgress, pity: CcgFinishPity): void {
    row.foil = pity.foil;
    row.golden = pity.golden;
    row.prismatic = pity.prismatic;
    row.holographic = pity.holographic;
    row.negative = pity.negative;
    row.astral = pity.astral;
  }

  private writeCustomFinishPity(row: ICcgQualityProgress, setSlug: string, counter: number): void {
    if (!row.custom) row.custom = new Map();
    row.custom.set(setSlug, counter);
  }

  private async ensureQualityProgress(owner: CcgOwner, session: ClientSession): Promise<ICcgQualityProgress> {
    return CcgQualityProgress.findOneAndUpdate(
      { ownerType: owner.ownerType, ownerId: owner.ownerId },
      {
        $setOnInsert: {
          ...emptyFinishPity(),
          custom: {},
        },
      },
      { upsert: true, returnDocument: "after", session },
    );
  }

  private async getPackCreditBalance(owner: CcgOwner, session?: ClientSession): Promise<number> {
    if (owner.ownerType === "guest") return 0;
    const aggregate = CcgPackCredit.aggregate<{ _id: null; remaining: number }>([
      { $match: { ownerId: owner.ownerId, remaining: { $gt: 0 } } },
      { $group: { _id: null, remaining: { $sum: "$remaining" } } },
    ]);
    if (session) aggregate.session(session);
    const rows = await aggregate;
    return rows[0]?.remaining ?? 0;
  }

  private async getSessionPackState(
    owner: CcgOwner,
    date: Date,
  ): Promise<{
    balance: Pick<ICcgPackBalance, "remaining">;
    creditBalances: number;
  }> {
    const filter = { ownerType: owner.ownerType, ownerId: owner.ownerId };
    const [balance, creditBalance] = await Promise.all([
      CcgPackBalance.findOne(filter).lean(),
      this.getPackCreditBalance(owner),
    ]);
    if (
      balance
      && balance.grantVersion === CCG_PACK_BALANCE_VERSION
      && typeof balance.hasPlayed === "boolean"
    ) {
      const recharge = applyPackRecharge(
        balance.remaining,
        balance.lastRechargeAt,
        date,
        creditBalance,
      );
      if (
        recharge.balance === balance.remaining
        && recharge.lastRechargeAt.getTime() === balance.lastRechargeAt.getTime()
      ) {
        return { balance, creditBalances: creditBalance };
      }
    }

    const reconciledBalance = await this.ensurePackBalance(owner, undefined, date);
    return {
      balance: reconciledBalance,
      creditBalances: await this.getPackCreditBalance(owner),
    };
  }

  private async ensurePackBalance(
    owner: CcgOwner,
    session?: ClientSession,
    date: Date = new Date(),
  ): Promise<ICcgPackBalance> {
    if (session) return this.ensurePackBalanceInSession(owner, session, date);

    const ownedSession = await mongoose.startSession();
    let resolvedBalance: ICcgPackBalance | null = null;
    try {
      await ownedSession.withTransaction(async () => {
        resolvedBalance = await this.ensurePackBalanceInSession(owner, ownedSession, date);
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        throw new CcgServiceError(503, "transactions_unavailable", "Pack balances are temporarily unavailable while collection storage is starting");
      }
      throw error;
    } finally {
      await ownedSession.endSession();
    }
    if (!resolvedBalance) throw new CcgServiceError(500, "pack_balance_unavailable", "Pack balance could not be initialized");
    return resolvedBalance;
  }

  private async ensurePackBalanceInSession(owner: CcgOwner, session: ClientSession, date: Date): Promise<ICcgPackBalance> {
    const filter = { ownerType: owner.ownerType, ownerId: owner.ownerId };
    let balance = await CcgPackBalance.findOne(filter).session(session);
    if (!balance) {
      const hasPlayed = await this.hasCcgActivity(owner, session);
      const initial = hasPlayed ? 0 : CCG_INITIAL_PACKS[owner.ownerType];
      balance = await CcgPackBalance.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            remaining: initial,
            lastRechargeAt: getRechargeTickStart(date),
            grantVersion: CCG_PACK_BALANCE_VERSION,
            hasPlayed,
            firstPlayedAt: hasPlayed ? date : null,
          },
        },
        { upsert: true, returnDocument: "after", session },
      );
    }
    if (!balance) throw new CcgServiceError(500, "pack_balance_unavailable", "Pack balance could not be initialized");

    if (balance.grantVersion !== CCG_PACK_BALANCE_VERSION || !Number.isFinite(balance.remaining)) {
      throw new CcgServiceError(503, "pack_migration_required", "Pack balances are being upgraded. Try again shortly");
    }

    const creditBalance = await this.getPackCreditBalance(owner, session);
    const recharge = applyPackRecharge(
      balance.remaining,
      balance.lastRechargeAt,
      date,
      creditBalance,
    );
    balance.remaining = recharge.balance;
    balance.lastRechargeAt = recharge.lastRechargeAt;
    if (balance.isModified()) await balance.save({ session });
    return balance;
  }

  private async reservePack(
    owner: CcgOwner,
    session: ClientSession,
  ): Promise<{ source: "recharge" | "credit"; creditId?: mongoose.Types.ObjectId; balance: ICcgPackBalance }> {
    const balance = await this.ensurePackBalance(owner, session);
    const now = new Date();
    const reserved = await CcgPackBalance.findOneAndUpdate(
      { _id: balance._id, remaining: { $gt: 0 } },
      {
        $inc: { remaining: -1 },
        $set: {
          hasPlayed: true,
          firstPlayedAt: balance.firstPlayedAt ?? now,
        },
      },
      { returnDocument: "after", session },
    );
    if (reserved) return { source: "recharge", balance: reserved };
    if (owner.ownerType === "guest") throw new CcgServiceError(409, "no_packs", "No packs are charged");
    const credit = await CcgPackCredit.findOneAndUpdate(
      { ownerId: owner.ownerId, remaining: { $gt: 0 } },
      { $inc: { remaining: -1 } },
      { returnDocument: "after", sort: { createdAt: 1 }, session },
    );
    if (!credit) throw new CcgServiceError(409, "no_packs", "No packs remain");
    await CcgPackBalance.updateOne(
      { _id: balance._id },
      {
        $set: {
          hasPlayed: true,
          firstPlayedAt: balance.firstPlayedAt ?? now,
        },
      },
      { session },
    );
    balance.hasPlayed = true;
    balance.firstPlayedAt = balance.firstPlayedAt ?? now;
    return { source: "credit", creditId: credit._id, balance };
  }

  private async hasCcgActivity(owner: CcgOwner, session?: ClientSession): Promise<boolean> {
    const [ownership, seriesOwnership] = await Promise.all([
      CcgOwnership.exists({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        setId: { $type: "objectId" },
        characterId: { $type: "objectId" },
      }).session(session ?? null),
      CcgSeriesOwnership.exists({ ownerType: owner.ownerType, ownerId: owner.ownerId }).session(session ?? null),
    ]);
    if (ownership || seriesOwnership) return true;
    const opening = await CcgPackOpening.exists({ ownerType: owner.ownerType, ownerId: owner.ownerId, state: "committed" }).session(session ?? null);
    return Boolean(opening);
  }

  private async countActiveOwnedSeries(
    owner: Pick<CcgOwner, "ownerType" | "ownerId">,
    setIds: mongoose.Types.ObjectId[],
    session?: ClientSession,
  ): Promise<number> {
    const aggregation = CcgSeriesOwnership.aggregate<{ count: number }>([
      { $match: { ownerType: owner.ownerType, ownerId: owner.ownerId, setId: { $in: setIds } } },
      {
        $lookup: {
          from: CcgCard.collection.name,
          let: { setId: "$setId", characterId: "$characterId" },
          pipeline: [
            {
              $match: {
                availabilityStatus: { $ne: "archived" },
                $expr: {
                  $and: [
                    { $eq: ["$setId", "$$setId"] },
                    { $eq: ["$characterId", "$$characterId"] },
                  ],
                },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: "activeCards",
        },
      },
      { $match: { "activeCards.0": { $exists: true } } },
      { $count: "count" },
    ]);
    if (session) aggregation.session(session);
    return (await aggregation)[0]?.count ?? 0;
  }

  private async selectPackResults(
    session: ClientSession,
    targetSetId: mongoose.Types.ObjectId | null = null,
    includeCommunity = true,
    includeMissingCardAlternatives = true,
    missingCardOwner: Pick<CcgOwner, "ownerType" | "ownerId"> | null = null,
  ): Promise<{
    results: CcgPackCardSelection[];
    sourceSetIds: mongoose.Types.ObjectId[];
    version: string;
  }> {
    const setFilter: Record<string, unknown> = {
      state: { $in: ["current", "legacy"] },
      kind: "raid",
      enabledAt: { $ne: null },
      cardCount: { $gt: 0 },
    };
    if (targetSetId) setFilter._id = targetSetId;
    const sets = await CcgSet.find(setFilter)
      .select("_id cardCount")
      .sort({ zoneId: 1 })
      .session(session)
      .lean();
    if (sets.length === 0) {
      if (targetSetId) throw new CcgServiceError(409, "target_set_unavailable", "That raid is not available for pack opening");
      throw new CcgServiceError(409, "pack_pool_unavailable", "The raid card pool is still being prepared");
    }
    const normalSetIds = sets.map((set) => set._id);
    const summaries = await CcgPackPool.aggregate<{
      _id: mongoose.Types.ObjectId;
      setId: mongoose.Types.ObjectId;
      version: string;
      counts: Array<{ grade: CcgTierGrade; count: number }>;
    }>([
      { $match: { setId: { $in: normalSetIds }, active: true, totalCards: { $gt: 0 } } },
      {
        $project: {
          setId: 1,
          version: 1,
          counts: {
            $map: {
              input: "$buckets",
              as: "bucket",
              in: { grade: "$$bucket.grade", count: { $size: "$$bucket.cardIds" } },
            },
          },
        },
      },
      { $sort: { setId: 1, updatedAt: -1 } },
    ]).session(session);
    const poolSetIds = new Set(summaries.map((pool) => String(pool.setId)));
    if (summaries.length !== sets.length || normalSetIds.some((setId) => !poolSetIds.has(String(setId)))) {
      throw new CcgServiceError(
        409,
        "pool_unavailable",
        targetSetId ? "That raid's card pool is incomplete" : "The raid card pool is incomplete",
      );
    }

    const eligibleCardCount = sets.reduce((total, set) => total + set.cardCount, 0);
    const ownedSeriesCount = includeMissingCardAlternatives && missingCardOwner
      ? await this.countActiveOwnedSeries(missingCardOwner, normalSetIds, session)
      : 0;
    const completionRatio = eligibleCardCount > 0
      ? Math.min(ownedSeriesCount, eligibleCardCount) / eligibleCardCount
      : 0;

    const plan = planPackSelections(
      summaries.map((pool) => ({
        poolId: String(pool._id),
        setId: String(pool.setId),
        version: pool.version,
        counts: pool.counts,
      })),
      randomInt,
      includeMissingCardAlternatives,
      completionRatio,
    );
    const plannedCards = plan.flatMap((row) => [
      row,
      ...row.missingCardAlternatives,
    ]);
    const selectedPoolIds = Array.from(new Set(plannedCards.map((row) => row.poolId))).map((id) => new mongoose.Types.ObjectId(id));
    const selectedGrades = Array.from(new Set(plannedCards.map((row) => row.tierGrade)));
    const bucketRows = await CcgPackPool.aggregate<{
      _id: mongoose.Types.ObjectId;
      buckets: Array<{ grade: CcgTierGrade; cardIds: mongoose.Types.ObjectId[] }>;
    }>([
      { $match: { _id: { $in: selectedPoolIds }, active: true } },
      {
        $project: {
          buckets: {
            $filter: {
              input: "$buckets",
              as: "bucket",
              cond: { $in: ["$$bucket.grade", selectedGrades] },
            },
          },
        },
      },
    ]).session(session);
    const cardsByBucket = new Map<string, mongoose.Types.ObjectId[]>();
    for (const row of bucketRows) {
      for (const bucket of row.buckets) cardsByBucket.set(`${row._id}:${bucket.grade}`, bucket.cardIds);
    }
    const resolvePlan = (row: CcgPackCardPlan): CcgPackCardCandidate => {
      const cardIds = cardsByBucket.get(`${row.poolId}:${row.tierGrade}`);
      const cardId = cardIds?.[row.bucketOffset];
      if (!cardId) throw new CcgServiceError(409, "pool_invalid", "The pack pool changed while this pack was opening");
      return { cardId, setId: new mongoose.Types.ObjectId(row.setId), tierGrade: row.tierGrade };
    };
    const baseResults = plan.map((row): CcgPackCardSelection => {
      const primary = resolvePlan(row);
      return {
        ...primary,
        missingCardAlternatives: row.missingCardAlternatives.map(resolvePlan),
      };
    });
    const communitySet = includeCommunity
      ? await CcgSet.findOne({ kind: "community", enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
          .select("_id")
          .session(session)
          .lean()
      : null;
    const communityPool = communitySet
      ? await CcgPackPool.findOne({ setId: communitySet._id, active: true, totalCards: { $gt: 0 } }).select("version buckets").session(session).lean()
      : null;
    const communityCards = (communityPool?.buckets ?? []).flatMap((bucket) => (
      (bucket.cardIds as mongoose.Types.ObjectId[]).map((cardId) => ({
        cardId,
        tierGrade: bucket.grade as CcgTierGrade,
      }))
    ));
    const results = baseResults.map((base): CcgPackCardSelection => {
      const communitySelection = selectCommunityCardCandidates(communityCards, randomInt, includeMissingCardAlternatives);
      if (communitySet && communitySelection) {
        const primary = communitySelection.primary;
        return {
          cardId: primary.cardId,
          setId: communitySet._id,
          tierGrade: primary.tierGrade,
          missingCardAlternatives: communitySelection.missingCardAlternatives.map((alternative) => ({
            cardId: alternative.cardId,
            setId: communitySet._id,
            tierGrade: alternative.tierGrade,
          })),
        };
      }
      return base;
    });
    const sourceSetIds = [...normalSetIds, ...(communitySet && communityPool ? [communitySet._id] : [])];
    const versionSeed = [...summaries.map((pool) => `${pool.setId}:${pool.version}`), ...(communitySet && communityPool ? [`${communitySet._id}:${communityPool.version}`] : [])]
      .sort()
      .join("|");
    return {
      results,
      sourceSetIds,
      version: `${targetSetId ? "raid" : "all"}:${targetSetId ? String(targetSetId) : "random"}:${createHash("sha256").update(versionSeed).digest("hex").slice(0, 20)}`,
    };
  }

  private async addOwnership(
    owner: CcgOwner,
    results: Array<Pick<SelectedResult, "cardId" | "setId" | "characterId" | "snapshotVersion" | "finish" | "artVariant">>,
    session: ClientSession,
  ): Promise<void> {
    const quantities = new Map<string, {
      cardId: mongoose.Types.ObjectId;
      setId: mongoose.Types.ObjectId;
      characterId: mongoose.Types.ObjectId;
      finish: CcgFinish;
      quantity: number;
      alternativeUnlocked: boolean;
    }>();
    const series = new Map<string, {
      setId: mongoose.Types.ObjectId;
      characterId: mongoose.Types.ObjectId;
      snapshotVersions: Set<number>;
    }>();
    for (const result of results) {
      const seriesKey = getSeriesKey(result);
      const key = `${seriesKey}:${result.finish}`;
      const currentSeries = series.get(seriesKey);
      if (currentSeries) currentSeries.snapshotVersions.add(result.snapshotVersion);
      else series.set(seriesKey, {
        setId: result.setId,
        characterId: result.characterId,
        snapshotVersions: new Set([result.snapshotVersion]),
      });
      const current = quantities.get(key);
      if (current) {
        current.quantity += 1;
        if (result.artVariant === "alternative") current.alternativeUnlocked = true;
      } else {
        quantities.set(key, {
          cardId: result.cardId,
          setId: result.setId,
          characterId: result.characterId,
          finish: result.finish,
          quantity: 1,
          alternativeUnlocked: result.artVariant === "alternative",
        });
      }
    }
    const seriesRows = Array.from(series.values());
    const existingSeries = await CcgSeriesOwnership.find({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      $or: seriesRows.map((row) => ({ setId: row.setId, characterId: row.characterId })),
    })
      .select("setId characterId unlockedSnapshotVersions")
      .session(session)
      .lean();
    for (const existing of existingSeries) {
      const target = series.get(getSeriesKey(existing));
      if (!target) continue;
      for (const version of existing.unlockedSnapshotVersions) target.snapshotVersions.add(version);
    }
    const cards = await CcgCard.find({
      $or: seriesRows.map((row) => ({
        setId: row.setId,
        characterId: row.characterId,
        snapshotVersion: { $in: Array.from(row.snapshotVersions) },
      })),
    })
      .select("_id setId characterId snapshotVersion tierGrade setNumber name performanceSnapshotAt publishedAt")
      .session(session)
      .lean<CcgCollectionReadModelCard[]>();
    const cardsBySeries = new Map<string, CcgCollectionReadModelCard[]>();
    for (const card of cards) {
      const key = createCcgSeriesKey(card);
      const current = cardsBySeries.get(key);
      if (current) current.push(card);
      else cardsBySeries.set(key, [card]);
    }
    const now = new Date();
    await CcgSeriesOwnership.bulkWrite(
      seriesRows.map((row) => {
        const representative = selectCcgCollectionCard(
          cardsBySeries.get(createCcgSeriesKey(row)) ?? [],
          Array.from(row.snapshotVersions),
        );
        if (!representative) {
          throw new Error(`Cannot grant CCG series ${createCcgSeriesKey(row)} without an explicitly unlocked card snapshot`);
        }
        return {
          updateOne: {
            filter: {
              ownerType: owner.ownerType,
              ownerId: owner.ownerId,
              setId: row.setId,
              characterId: row.characterId,
            },
            update: {
              $addToSet: { unlockedSnapshotVersions: { $each: Array.from(row.snapshotVersions) } },
              $set: {
                lastAcquiredAt: now,
                ...buildCcgCollectionReadModel(representative),
              },
              $setOnInsert: {
                firstAcquiredAt: now,
                dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
              },
              $unset: { collectionReadModelIssue: "" },
            },
            upsert: true,
          },
        };
      }),
      { session, ordered: true },
    );
    await CcgOwnership.bulkWrite(
      Array.from(quantities.values()).map((row) => ({
        updateOne: {
          filter: {
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            setId: row.setId,
            characterId: row.characterId,
            finish: row.finish,
          },
          update: {
            $inc: { quantity: row.quantity },
            ...(row.alternativeUnlocked ? { $max: { alternativeQuantity: 1 } } : {}),
            $set: { lastAcquiredAt: now },
            $setOnInsert: {
              setId: row.setId,
              characterId: row.characterId,
              cardId: row.cardId,
              firstAcquiredAt: now,
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
            },
          },
          upsert: true,
        },
      })),
      { session, ordered: true },
    );
  }

  private getOwnedCardDeltas(
    cards: ReadonlyArray<Pick<ICcgCard, "setId" | "characterId">>,
    alreadyOwnedPairs: ReadonlySet<string>,
  ): Record<string, number> {
    const pairs = new Map<string, { setId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId }>();
    for (const card of cards) {
      const key = `${card.setId}:${card.characterId}`;
      if (!pairs.has(key)) pairs.set(key, { setId: card.setId, characterId: card.characterId });
    }
    if (pairs.size === 0) return {};

    const deltas: Record<string, number> = {};
    for (const [key, pair] of pairs) {
      if (alreadyOwnedPairs.has(key)) continue;
      const setId = String(pair.setId);
      deltas[setId] = (deltas[setId] ?? 0) + 1;
    }
    return deltas;
  }

  private async grantCompletedCardRewards(
    ownerId: mongoose.Types.ObjectId,
    candidates: ReadonlyArray<Pick<SelectedResult, "cardId" | "setId" | "characterId">>,
    session: ClientSession,
  ): Promise<CcgCompletedCardRewards> {
    const rewardedSeriesKeys = new Set<string>();
    const uniqueCandidates = new Map(candidates.map((candidate) => [getSeriesKey(candidate), candidate]));
    if (uniqueCandidates.size === 0) return { total: 0, rewardedSeriesKeys };

    const sets = await CcgSet.find({
      _id: { $in: Array.from(uniqueCandidates.values(), (candidate) => candidate.setId) },
      kind: "raid",
      state: { $in: ["current", "legacy"] },
    }).select("_id state").session(session).lean();
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const rewards: CcgCompletedCardRewards = { total: 0, rewardedSeriesKeys };
    const seriesCards = await CcgCard.find({
      $or: Array.from(uniqueCandidates.values(), (candidate) => ({
        setId: candidate.setId,
        characterId: candidate.characterId,
      })),
    }).select("_id setId characterId").session(session).lean();
    const legacySourceKeysBySeries = new Map<string, string[]>();
    for (const card of seriesCards) {
      const key = getSeriesKey(card);
      const sourceKeys = legacySourceKeysBySeries.get(key) ?? [];
      sourceKeys.push(`completed-card:${card._id}`);
      legacySourceKeysBySeries.set(key, sourceKeys);
    }
    const possibleSourceKeys = Array.from(uniqueCandidates.values()).flatMap((candidate) => [
      `completed-series:${getSeriesKey(candidate)}`,
      ...(legacySourceKeysBySeries.get(getSeriesKey(candidate)) ?? []),
    ]);
    const existingSourceKeys = new Set(await CcgPackCredit.distinct("sourceKey", {
      ownerId,
      sourceKey: { $in: possibleSourceKeys },
    }).session(session));

    for (const candidate of uniqueCandidates.values()) {
      const set = setById.get(String(candidate.setId));
      if (!set || (set.state !== "current" && set.state !== "legacy")) continue;
      const seriesKey = getSeriesKey(candidate);
      const sourceKey = `completed-series:${seriesKey}`;
      if (existingSourceKeys.has(sourceKey)
        || (legacySourceKeysBySeries.get(seriesKey) ?? []).some((key) => existingSourceKeys.has(key))) {
        continue;
      }
      const credit = await CcgPackCredit.updateOne(
        { ownerId, sourceKey },
        { $setOnInsert: { source: "duplicate", remaining: 1 } },
        { upsert: true, session },
      );
      if (credit.upsertedCount !== 1) continue;

      await CcgLedgerEntry.create(
        [
          {
            ownerType: "user",
            ownerId,
            action: "duplicate_reward",
            idempotencyKey: `duplicate-reward:${sourceKey}`,
            amount: 1,
            metadata: {
              cardId: String(candidate.cardId),
              setId: String(candidate.setId),
              characterId: String(candidate.characterId),
              sourceKey,
            },
          },
        ],
        { session },
      );
      rewards.total += 1;
      rewards.rewardedSeriesKeys.add(seriesKey);
    }
    return rewards;
  }

  private async serializeRedeemCodes(
    codes: ReadonlyArray<ICcgRedeemCode | Record<string, any>>,
  ): Promise<{ codes: Record<string, unknown>[]; sets: Record<string, unknown>[] }> {
    const cardIds = codes.flatMap((code) => code.rewardType === "card" && code.cardId ? [code.cardId] : []);
    const cards = cardIds.length > 0 ? await CcgCard.find({ _id: { $in: cardIds } }).lean() : [];
    const sets = cards.length > 0
      ? await CcgSet.find({ _id: { $in: Array.from(new Set(cards.map((card) => String(card.setId)))) } }).lean()
      : [];
    const cardById = new Map(cards.map((card) => [String(card._id), card]));
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const alternativeByCollector = await this.loadAlternativeArt(cards);

    return {
      sets: sets.map((set) => this.serializeSet(set)),
      codes: codes.map((code) => {
        const base = {
          id: String(code._id),
          code: code.code,
          active: code.active,
          redemptionCount: code.redemptionCount ?? 0,
          createdAt: code.createdAt,
          updatedAt: code.updatedAt,
        };
        if (code.rewardType === "packs") {
          return {
            ...base,
            reward: { type: "packs", packs: getRedeemPackCount(code) },
          };
        }

        const card = code.cardId ? cardById.get(String(code.cardId)) : null;
        const set = card ? setById.get(String(card.setId)) : null;
        return {
          ...base,
          reward: {
            type: "card",
            cardId: code.cardId ? String(code.cardId) : null,
            finish: code.finish ?? null,
            artVariant: code.artVariant ?? null,
            card: card && set
              ? this.serializeCard(card, set, alternativeByCollector.get(resolveCollectorKey(card)))
              : null,
          },
        };
      }),
    };
  }

  private async serializeOpening(opening: ICcgPackOpening | Record<string, any>): Promise<Record<string, unknown>> {
    const results = opening.results as ICcgPackResult[];
    const cards = await CcgCard.find({ _id: { $in: results.map((result) => result.cardId) } }).lean();
    const sets = await CcgSet.find({ _id: { $in: Array.from(new Set(cards.map((card) => String(card.setId)))) } })
      .select(CCG_PUBLIC_SET_FIELDS)
      .lean();
    const alternativeByCollector = await this.loadAlternativeArt(cards);
    return this.serializeOpeningFromEntities(opening, cards, sets, alternativeByCollector);
  }

  private serializeOpeningFromEntities(
    opening: ICcgPackOpening | Record<string, any>,
    cards: ReadonlyArray<ICcgCard | Record<string, any>>,
    sets: ReadonlyArray<ICcgSet | Record<string, any>>,
    alternativeByCollector: ReadonlyMap<string, CcgAlternativeArtDefinition>,
  ): Record<string, unknown> {
    const results = opening.results as ICcgPackResult[];
    const cardById = new Map(cards.map((card) => [String(card._id), card]));
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const selectionType = resolveCcgActivityPackSelectionType(
      opening.selectionType,
      opening.targetSetId,
    );
    const selectionSetId = resolveCcgActivityPackSetId(
      opening.selectionType,
      opening.targetSetId,
      opening.sourceSetIds ?? [],
    );
    return {
      id: String(opening._id),
      selection: selectionType === "raid" && selectionSetId
        ? { type: "raid", setId: String(selectionSetId) }
        : { type: "all" },
      sets: sets.map((set) => this.serializeSet(set)),
      allowanceSource: opening.allowanceSource,
      duplicateRewards: opening.duplicateRewards,
      createdAt: opening.createdAt,
      results: results.map((result, index) => {
        const card = cardById.get(String(result.cardId));
        const set = card ? setById.get(String(card.setId)) : null;
        return {
          position: index + 1,
          finish: result.finish,
          artVariant: result.artVariant ?? "standard",
          isDuplicate: result.isDuplicate,
          isNewCard: result.isNewCard,
          isNewFinish: result.isNewFinish,
          isNewSnapshot: result.isNewSnapshot,
          bonusPackReward: Boolean(result.bonusPackReward),
          card: card && set
            ? this.serializeCard(
                card,
                set,
                alternativeByCollector.get(resolveCollectorKey(card as ICcgCard)),
                { seriesOwned: true, snapshotOwned: true },
              )
            : null,
        };
      }),
    };
  }

  private validateShowcase(rawShowcase: unknown): CcgShowcaseInput[] {
    if (!Array.isArray(rawShowcase)) {
      throw new CcgServiceError(400, "invalid_showcase", "Showcase cards must be an array");
    }
    if (rawShowcase.length > CCG_SHOWCASE_CARD_LIMIT) {
      throw new CcgServiceError(400, "invalid_showcase", `Choose up to ${CCG_SHOWCASE_CARD_LIMIT} showcase cards`);
    }
    const showcase = rawShowcase.map((raw): CcgShowcaseInput => {
      if (!raw || typeof raw !== "object") {
        throw new CcgServiceError(400, "invalid_showcase", "Each showcase card is invalid");
      }
      const item = raw as Record<string, unknown>;
      if (typeof item.cardId !== "string" || !mongoose.Types.ObjectId.isValid(item.cardId)) {
        throw new CcgServiceError(400, "invalid_showcase", "Each showcase card needs a valid card ID");
      }
      if (!CCG_FINISH_ORDER.includes(item.finish as CcgFinish)) {
        throw new CcgServiceError(400, "invalid_showcase", "Each showcase card needs a valid finish");
      }
      if (item.artVariant !== "standard" && item.artVariant !== "alternative") {
        throw new CcgServiceError(400, "invalid_showcase", "Each showcase card needs a valid artwork");
      }
      return {
        cardId: new mongoose.Types.ObjectId(item.cardId),
        finish: item.finish as CcgFinish,
        artVariant: item.artVariant,
      };
    });
    if (new Set(showcase.map((item) => String(item.cardId))).size !== showcase.length) {
      throw new CcgServiceError(400, "invalid_showcase", "A card can only appear once in your showcase");
    }
    return showcase;
  }

  private async loadLeaderboardShowcases(
    userIds: mongoose.Types.ObjectId[],
  ): Promise<Map<string, Array<Record<string, unknown>>>> {
    if (userIds.length === 0) return new Map();
    const profiles = await CcgCollectorProfile.find({ userId: { $in: userIds } })
      .select("userId showcase -_id")
      .lean();
    const showcaseItems = profiles.flatMap((profile) => profile.showcase ?? []);
    const cards = showcaseItems.length > 0
      ? await CcgCard.find({ _id: { $in: showcaseItems.map((item) => item.cardId) } }).lean()
      : [];
    const sets = cards.length > 0
      ? await CcgSet.find({ _id: { $in: cards.map((card) => card.setId) }, enabledAt: { $ne: null } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .lean()
      : [];
    const cardById = new Map(cards.map((card) => [String(card._id), card]));
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const alternativeByCollector = await this.loadAlternativeArt(cards);
    return new Map(profiles.map((profile) => [
      String(profile.userId),
      (profile.showcase ?? []).flatMap((item: ICcgShowcaseCard) => {
        const card = cardById.get(String(item.cardId));
        const set = card ? setById.get(String(card.setId)) : null;
        if (!card || !set) return [];
        return [{
          card: {
            ...this.serializeCard(card, set, alternativeByCollector.get(resolveCollectorKey(card))),
            set: this.serializeSet(set),
          },
          finish: item.finish,
          artVariant: item.artVariant,
        }];
      }),
    ]));
  }

  private serializeLeaderboardEntry(
    entry: ICcgLeaderboardEntry,
    showcase: Array<Record<string, unknown>>,
  ): Record<string, unknown> {
    return {
      rank: entry.rank,
      username: entry.username,
      avatarUrl: entry.avatarUrl,
      score: entry.score,
      cardsOwned: entry.cardsOwned,
      snapshotsOwned: entry.snapshotsOwned,
      finishesOwned: entry.finishesOwned,
      premiumFinishesOwned: entry.premiumFinishesOwned,
      completedCards: entry.completedCards,
      completedSets: entry.completedSets,
      breakdown: entry.breakdown,
      showcase,
    };
  }

  private serializeSet(set: ICcgSet | Record<string, any>, ownedCards = 0): Record<string, unknown> {
    return {
      id: String(set._id),
      slug: set.slug,
      zoneId: set.zoneId,
      raidName: set.raidName,
      expansionName: set.expansionName,
      state: set.state,
      kind: set.kind ?? "raid",
      enabledAt: set.enabledAt ?? null,
      themeKey: set.themeKey,
      theme: set.theme,
      customFinish: set.customFinish?.key
        ? { key: set.customFinish.key, hardPity: set.customFinish.hardPity }
        : null,
      backgroundPath: set.backgroundPath,
      packArtOffsetX: set.packArtOffsetX ?? 50,
      cardCount: set.cardCount,
      ownedCards,
      publicationWave: set.publicationWave,
      lastPublishedAt: set.lastPublishedAt ?? null,
    };
  }

  private async loadAlternativeArt(
    cards: ReadonlyArray<{ collectorKey?: string | null; characterId: mongoose.Types.ObjectId | string }>,
    session?: ClientSession,
  ): Promise<Map<string, CcgAlternativeArtDefinition>> {
    const collectorKeys = Array.from(new Set(cards.map(resolveCollectorKey)));
    if (collectorKeys.length === 0) return new Map();
    const query = CcgAlternativeArt.find({ collectorKey: { $in: collectorKeys } }).lean();
    if (session) query.session(session);
    const rows = await query;
    return new Map(rows.map((row) => [row.collectorKey, row]));
  }

  private async loadAlternativeArtUnlocks(
    owner: Pick<CcgOwner, "ownerType" | "ownerId">,
    cards: ReadonlyArray<{
      setId: mongoose.Types.ObjectId;
      characterId: mongoose.Types.ObjectId;
    }>,
    session?: ClientSession,
  ): Promise<Set<string>> {
    const seriesPairs = Array.from(new Map(cards.map((card) => [
      getSeriesKey(card),
      { setId: card.setId, characterId: card.characterId },
    ])).values());
    if (seriesPairs.length === 0) return new Set();
    const unlocksQuery = CcgOwnership.find({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      $or: seriesPairs,
      alternativeQuantity: { $gt: 0 },
    }).select("setId characterId -_id").lean();
    if (session) unlocksQuery.session(session);
    const unlocks = await unlocksQuery;
    return new Set(unlocks.map(getSeriesKey));
  }

  private serializeCard(
    card: ICcgCard | Record<string, any>,
    set: ICcgSet | Record<string, any>,
    alternativeArt?: CcgAlternativeArtDefinition,
    ownershipState?: CcgCardOwnershipState,
  ): Record<string, unknown> {
    return {
      id: String(card._id),
      characterId: String(card.characterId),
      setNumber: card.setNumber,
      snapshotVersion: card.snapshotVersion ?? 1,
      snapshotKey: card.snapshotKey ?? null,
      name: card.name,
      realm: card.realm,
      region: card.region,
      guildId: card.guildId ? String(card.guildId) : null,
      guildName: card.guildName ?? null,
      guildRealm: card.guildRealm ?? null,
      classID: card.classID,
      specName: card.specName,
      role: card.role,
      metric: card.metric,
      itemLevel: card.itemLevel,
      scores: {
        performance: set.kind === "community" ? card.communityScores?.performance ?? null : card.parseScore,
        mechanics: set.kind === "community" ? card.communityScores?.mechanics ?? null : card.survivalScore,
        combined: set.kind === "community" ? card.communityScores?.combined ?? null : card.combinedScore,
        mythicPlus: set.kind === "community"
          ? card.communityScores?.mythicPlus ?? null
          : typeof card.mythicPlusScore === "number" && card.mythicPlusScore > 0 ? card.mythicPlusScore : null,
      },
      tierGrade: card.tierGrade,
      avatarUrl: card.avatarUrl ?? null,
      renderUrl: card.renderUrl ?? null,
      renderFit: card.renderFit ?? null,
      availabilityStatus: card.availabilityStatus ?? "active",
      alternativeArt: serializeAlternativeArt(alternativeArt),
      quip: serializeQuip(alternativeArt),
      backgroundCrop: card.backgroundCrop,
      performanceSnapshotAt: card.performanceSnapshotAt,
      mediaCapturedAt: card.mediaCapturedAt ?? null,
      publicationWave: card.publicationWave,
      publishedAt: card.publishedAt,
      setId: String(set._id),
      ...(ownershipState ?? {}),
    };
  }

  private async requireAuthenticatedUser(req: Request, message = "Log in to share cards and packs"): Promise<mongoose.Types.ObjectId> {
    const rawUserId = req.session.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(rawUserId)) {
      throw new CcgServiceError(401, "authentication_required", message);
    }
    const userId = new mongoose.Types.ObjectId(rawUserId);
    if (!(await User.exists({ _id: userId }))) {
      throw new CcgServiceError(401, "authentication_required", message);
    }
    return userId;
  }

  private async createOrGetShare(
    filter: Record<string, unknown>,
    fields: Record<string, unknown>,
  ): Promise<CcgShareWithShortId> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const share = await CcgShare.findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              ...fields,
              publicId: randomBytes(16).toString("base64url"),
              shortId: createCcgShareShortId(),
            },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        );
        if (share) return this.ensureShareShortId(share);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const existing = await CcgShare.findOne(filter);
        if (existing) return this.ensureShareShortId(existing);
      }
    }
    throw new CcgServiceError(503, "share_unavailable", "The share link could not be created");
  }

  private async ensureShareShortId(share: ICcgShare): Promise<CcgShareWithShortId> {
    if (share.shortId) return share as CcgShareWithShortId;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const updated = await CcgShare.findOneAndUpdate(
          {
            _id: share._id,
            $or: [
              { shortId: { $exists: false } },
              { shortId: null },
            ],
          },
          { $set: { shortId: createCcgShareShortId() } },
          { returnDocument: "after" },
        );
        if (updated?.shortId) return updated as CcgShareWithShortId;

        const concurrentlyUpdated = await CcgShare.findById(share._id);
        if (concurrentlyUpdated?.shortId) return concurrentlyUpdated as CcgShareWithShortId;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }

    throw new CcgServiceError(503, "share_unavailable", "The share link could not be created");
  }

  private serializeShareLink(share: Pick<CcgShareWithShortId, "shortId" | "kind">): Record<string, unknown> {
    return {
      id: share.shortId,
      kind: share.kind,
      path: `/ccg/share/${share.shortId}`,
    };
  }

  private async findClaimableGuest(req: Request, includeClaimed = false): Promise<ICcgGuest | null> {
    const raw = typeof req.cookies?.[CCG_GUEST_COOKIE] === "string" ? req.cookies[CCG_GUEST_COOKIE] : null;
    if (!raw) return null;
    const filter: Record<string, unknown> = {
      tokenHash: hashGuestToken(raw),
    };
    if (!includeClaimed) filter.claimedAt = null;
    return CcgGuest.findOne(filter);
  }

}

export default new CcgService();
