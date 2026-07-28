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
  CCG_INITIAL_PACKS,
  CCG_PACK_BALANCE_VERSION,
  CCG_PACK_RECHARGE_INTERVAL_HOURS,
  CCG_PACK_RULE_VERSION,
  CCG_PACK_STORAGE_CAPS,
  CCG_TIME_ZONE,
  CCG_TIER_GRADES,
  CcgArtVariant,
  CcgFinish,
  CcgMode,
  CcgTierGrade,
  getCcgPackFinishOrder,
  getCcgRedeemFinishOrder,
} from "../config/ccg";
import CcgCard, { ICcgCard } from "../models/CcgCard";
import CcgAlternativeArt from "../models/CcgAlternativeArt";
import CcgAnalyticsDaily from "../models/CcgAnalyticsDaily";
import CcgAnalyticsDailyParticipant from "../models/CcgAnalyticsDailyParticipant";
import CcgAnalyticsParticipant from "../models/CcgAnalyticsParticipant";
import CcgAnalyticsSummary from "../models/CcgAnalyticsSummary";
import CcgDailyAllowance from "../models/CcgDailyAllowance";
import CcgGuest, { ICcgGuest } from "../models/CcgGuest";
import CcgJobLock from "../models/CcgJobLock";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgOwnership, { CcgOwnerType } from "../models/CcgOwnership";
import CcgPackBalance, { ICcgPackBalance } from "../models/CcgPackBalance";
import CcgPackCredit from "../models/CcgPackCredit";
import CcgPackOpening, { ICcgPackOpening, ICcgPackResult } from "../models/CcgPackOpening";
import CcgPackPool from "../models/CcgPackPool";
import CcgQualityProgress, { ICcgQualityProgress } from "../models/CcgQualityProgress";
import CcgRedeemClaim from "../models/CcgRedeemClaim";
import CcgRedeemCode, { ICcgRedeemCode } from "../models/CcgRedeemCode";
import CcgRollover from "../models/CcgRollover";
import CcgShare, { ICcgShare } from "../models/CcgShare";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import CcgSet, { ICcgSet } from "../models/CcgSet";
import Character from "../models/Character";
import Raid from "../models/Raid";
import User from "../models/User";
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
import { CcgFinishPity, emptyFinishPity, finishChanceForCounter, rollArtVariant, rollOwnedFinish, rollProtectedFinish } from "../utils/ccg-random";
import { planPackSelections, selectCommunityCard, shufflePackResults } from "../utils/ccg-pack";
import { resolveCollectorKey } from "../utils/ccg-identity";
import { getTransferableGuestPacks, resolveGuestClaimOpeningId, verifyGuestLibrary } from "../utils/ccg-guest-library";
import { CCG_REDEEM_PACK_GRANT_MAX, normalizeCcgRedeemCode } from "../utils/ccg-redeem";
import { applyPackRecharge, getNextPackRechargeAt, getRechargeTickStart } from "../utils/ccg-recharge";
import { applyCcgPackRollover } from "../utils/ccg-rollover";
import { buildCcgCardSearchCandidates, CcgCardSearchCandidate } from "../utils/ccg-card-search";
import { getHelsinkiDateKey, getNextHelsinkiReset } from "../utils/helsinki-time";
import logger from "../utils/logger";
import { isMongoWriteConflict, retryMongoWriteConflict } from "../utils/mongo-retry";
import { normalizeSearchText, scoreSearchCandidate } from "../utils/search";
import ccgPublisherService from "./ccg-publisher.service";
import discordService from "./discord.service";

const CCG_ANALYTICS_KEY = "global";
const CCG_ANALYTICS_SCHEMA_VERSION = 1;
const CCG_ANALYTICS_DETAILED_SCHEMA_VERSION = 1;
const CCG_ANALYTICS_INITIALIZATION_LOCK = "ccg-analytics-initialize-v2";
const CCG_ANALYTICS_INITIALIZATION_TIMEOUT_MS = 30_000;
const CCG_UNIQUE_FINISH_FILTER = "unique";
const CCG_PREVIOUS_GUEST_INITIAL_PACKS: Readonly<Record<CcgMode, number>> = { current: 5, legacy: 5 };
const CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS = 60_000;
const CCG_GUEST_LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;
const CCG_TRANSACTION_WRITE_CONFLICT_MAX_ATTEMPTS = 5;
const CCG_PUBLIC_SET_FIELDS = "_id slug zoneId raidName expansionName state kind enabledAt themeKey theme customFinish backgroundPath packArtOffsetX cardCount publicationWave lastPublishedAt";

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
  expiresAt?: Date;
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

type CcgPackOpenState = {
  packs: Record<CcgMode, { regularRemaining: number; bonusRemaining: number; totalRemaining: number }>;
  qualityProtection: CcgFinishPity;
  qualityChances: Record<string, number>;
  customQualityProtection: Array<{ setSlug: string; counter: number; nextChance: number }>;
  ownedFinishesDelta: number;
  ownedCardsBySetDelta: Record<string, number>;
};

type RedeemedCodeSnapshot = {
  code: string;
  rewardType: "packs" | "card";
  currentPacks: number;
  legacyPacks: number;
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

function validateMode(value: unknown): CcgMode {
  if (value !== "current" && value !== "legacy") throw new CcgServiceError(400, "invalid_mode", "Mode must be current or legacy");
  return value;
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

function validateSharePublicId(value: string): string {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) {
    throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
  }
  return value;
}

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
  private raidIconCache: { expiresAt: number; iconByZone: Map<number, string | null> } | null = null;
  private raidIconPromise: Promise<Map<number, string | null>> | null = null;

  private async buildCardSearchCandidates(cardFilter: Record<string, unknown> = {}): Promise<CcgCardSearchCandidate[]> {
    const cards = await CcgCard.find(cardFilter)
      .select("_id characterId collectorKey name realm classID guildName publishedAt")
      .lean();
    const characterIds = Array.from(new Set(cards.map((card) => String(card.characterId))))
      .map((id) => new mongoose.Types.ObjectId(id));
    const currentCharacters = await Character.find({ _id: { $in: characterIds } })
      .select("_id name")
      .lean();
    const currentNameByCharacterId = new Map(currentCharacters.map((character) => [String(character._id), character.name]));
    return buildCcgCardSearchCandidates(cards, currentNameByCharacterId);
  }

  private async getCollectionCharacterSearchCandidates(): Promise<CcgCollectionCharacterSearchCandidate[]> {
    const now = Date.now();
    if (this.collectionCharacterSearchCache && this.collectionCharacterSearchCache.versionCheckedUntil > now) {
      return this.collectionCharacterSearchCache.candidates;
    }
    if (this.collectionCharacterSearchPromise) return this.collectionCharacterSearchPromise;

    this.collectionCharacterSearchPromise = (async () => {
      let sets = await CcgSet.find({ enabledAt: { $ne: null } })
        .select("_id collectionCharactersBuiltAt")
        .sort({ _id: 1 })
        .lean();
      const setIds = sets.map((set) => set._id);
      if (sets.some((set) => !set.collectionCharactersBuiltAt)) {
        await ccgPublisherService.ensureCollectionCharactersMaterialized(setIds);
        sets = await CcgSet.find({ _id: { $in: setIds } })
          .select("_id collectionCharactersBuiltAt")
          .sort({ _id: 1 })
          .lean();
      }

      const version = sets
        .map((set) => `${set._id}:${set.collectionCharactersBuiltAt?.getTime() ?? 0}`)
        .join("|");
      if (this.collectionCharacterSearchCache?.version === version) {
        this.collectionCharacterSearchCache.versionCheckedUntil = now + CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS;
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
        versionCheckedUntil: now + CCG_COLLECTION_CHARACTER_VERSION_CHECK_MS,
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
        .select("slug raidName customFinish")
        .lean(),
    ]);
    const resetAt = getNextHelsinkiReset();
    const qualityProtection = this.readFinishPity(qualityProgress ?? undefined);
    const qualityChances = this.getQualityChances(qualityProtection);

    return {
      ownerType: owner.ownerType,
      dateKey: owner.dateKey,
      resetAt,
      packs: this.serializePackBalances(packState.balance, packState.creditBalances),
      recharge: {
        current: {
          cap: CCG_PACK_STORAGE_CAPS.current,
          intervalHours: CCG_PACK_RECHARGE_INTERVAL_HOURS.current,
          nextAt: getNextPackRechargeAt("current", now).toISOString(),
        },
        legacy: {
          cap: CCG_PACK_STORAGE_CAPS.legacy,
          intervalHours: CCG_PACK_RECHARGE_INTERVAL_HOURS.legacy,
          nextAt: getNextPackRechargeAt("legacy", now).toISOString(),
        },
      },
      qualityProtection,
      qualityChances,
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
            nextChance: finishChanceForCounter(counter + 1, hardPity),
          };
        }),
      ownedFinishes: ownershipCount,
    };
  }

  async getAnalytics(): Promise<{ uniqueUsers: number; packOpenings: number }> {
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
    const modes: Record<CcgMode, number> = { current: 0, legacy: 0 };
    let packOpenings = 0;
    for (const row of rows) {
      packOpenings += row.packOpenings;
      modes.current += row.modes?.current ?? 0;
      modes.legacy += row.modes?.legacy ?? 0;
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
        modes,
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

  async getSets(owner?: CcgOwner): Promise<Record<string, unknown>[]> {
    requireFeature();
    const visibleSets = await CcgSet.find({ enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
      .select(CCG_PUBLIC_SET_FIELDS)
      .sort({ zoneId: 1 })
      .lean();
    const [rows, iconByZone] = await Promise.all([
      owner ? CcgSeriesOwnership.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        { $match: { ownerType: owner.ownerType, ownerId: owner.ownerId } },
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
    return cardIds;
  }

  async getCatalog(
    owner: CcgOwner,
    setSlug: string | undefined,
    options: { page?: number; limit?: number; owned?: string; grade?: string; finish?: string; guildId?: string; characterId?: string; sort?: string },
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
    if (options.characterId) cardFilter.characterId = validateObjectId(options.characterId, "character ID");

    const ownershipFilter = options.owned === "owned" || options.owned === "missing" || Boolean(finishMatch);
    const includeOwned = options.owned === "owned" || Boolean(finishMatch);
    const missingSnapshotsOnly = options.owned === "missing" && !finishMatch;
    const needsFinishOwnership = Boolean(finishMatch) || (ownershipSort && !missingSnapshotsOnly);
    const needsSnapshotOwnership = ownershipFilter || ownershipSort;
    const activeCardIds = await this.getActiveCatalogCardIds(sets);
    const currentCardStages: PipelineStage[] = activeCardIds
      ? [{ $match: { _id: { $in: activeCardIds } } }]
      : [
          { $match: { setId: set ? set._id : { $in: sets.map((item) => item._id) } } },
          { $sort: { snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 } },
          { $group: { _id: { setId: "$setId", characterId: "$characterId" }, card: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$card" } },
        ];
    const catalog = await CcgCard.aggregate<{
      items: ICcgCard[];
      count: Array<{ total: number }>;
    }>([
      ...currentCardStages,
      ...(Object.keys(cardFilter).length > 0 ? [{ $match: cardFilter }] : []),
      ...(needsSnapshotOwnership ? [
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
                      { $in: ["$$snapshotVersion", "$unlockedSnapshotVersions"] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: "snapshotOwnership",
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
                { $gt: [{ $size: "$snapshotOwnership" }, 0] },
                "$seriesOwnership",
                [],
              ],
            },
          },
        },
      ] : []),
      ...(ownershipFilter ? [{
        $match: {
          [needsFinishOwnership ? "seriesOwnership.0" : "snapshotOwnership.0"]: { $exists: includeOwned },
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
      ...(needsSnapshotOwnership ? [{ $unset: ["seriesOwnership", "snapshotOwnership"] }] : []),
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
    const [ownership, snapshotOwnership, alternativeByCollector, unlockedAlternativeCollectors, ownedSeriesCount] = await Promise.all([
      seriesPairs.length > 0 && !missingSnapshotsOnly
        ? CcgOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, $or: seriesPairs }).lean()
        : Promise.resolve([]),
      seriesPairs.length > 0
        ? CcgSeriesOwnership.find({ ownerType: owner.ownerType, ownerId: owner.ownerId, $or: seriesPairs })
            .select("setId characterId unlockedSnapshotVersions -_id")
            .lean()
        : Promise.resolve([]),
      this.loadAlternativeArt(cards),
      missingSnapshotsOnly ? Promise.resolve(new Set<string>()) : this.loadAlternativeArtUnlocks(owner, cards),
      set ? CcgSeriesOwnership.countDocuments({ ownerType: owner.ownerType, ownerId: owner.ownerId, setId: set._id }) : Promise.resolve(0),
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
        const alternativeArtUnlocked = snapshotUnlocked && unlockedAlternativeCollectors.has(collectorKey)
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
    const [seriesOwnership, ownership, alternativeByCollector, unlockedAlternativeCollectors] = await Promise.all([
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
          snapshotOwned && unlockedAlternativeCollectors.has(collectorKey)
            && hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId)),
        ),
      },
    };
  }

  async getCollection(
    owner: CcgOwner,
    options: { page?: number; limit?: number; setSlug?: string; grade?: string; finish?: string; search?: string; guildId?: string; characterId?: string; sort?: string; alternativeOnly?: boolean },
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
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const communitySetIds = sets.filter((set) => set.kind === "community").map((set) => set._id);
    const guildId = options.guildId ? validateObjectId(options.guildId, "guild ID") : null;
    if (guildId) cardMatch["card.guildId"] = guildId;
    const characterId = options.characterId ? validateObjectId(options.characterId, "character ID") : null;
    if (characterId) cardMatch["card.characterId"] = characterId;
    if (options.alternativeOnly) {
      const alternativeCardIds = await CcgOwnership.distinct("cardId", {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        alternativeQuantity: { $gt: 0 },
      });
      const alternativeCards = await CcgCard.find({ _id: { $in: alternativeCardIds } }).select("characterId collectorKey").lean();
      const alternativeCollectorKeys = Array.from(new Set(alternativeCards.map(resolveCollectorKey)));
      cardMatch.$expr = {
        $in: [
          { $ifNull: ["$card.collectorKey", { $concat: ["character:", { $toString: "$card.characterId" }] }] },
          alternativeCollectorKeys,
        ],
      };
    }

    const rows = await CcgSeriesOwnership.aggregate<{
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
    ]).then((result) => (result[0] ?? { items: [], count: [] }) as unknown as {
      items: Array<{
        _id: { setId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId };
        totalQuantity: number;
        finishes: Array<{ finish: CcgFinish; quantity: number; alternativeQuantity?: number }>;
        card: ICcgCard;
        accessibleCards: ICcgCard[];
      }>;
      count: Array<{ total: number }>;
    });
    const total = rows.count[0]?.total ?? 0;
    const collectionCards = rows.items.flatMap((row) => row.accessibleCards);
    const [alternativeByCollector, unlockedAlternativeCollectors] = await Promise.all([
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
        const alternativeArtUnlocked = unlockedAlternativeCollectors.has(representativeCollectorKey)
          && hasApplicableAlternativeArt(alternative, Boolean(row.card.communityCharacterId));
        return {
          ...this.serializeCard(row.card, cardSet, alternative, { seriesOwned: true, snapshotOwned: true }),
          ownership: serializeOwnershipRows(row.finishes, alternativeArtUnlocked),
          totalQuantity: row.totalQuantity,
          variants: row.accessibleCards.map((variant) => {
            const collectorKey = resolveCollectorKey(variant);
            const alternativeArt = alternativeByCollector.get(collectorKey);
            const alternativeArtUnlocked = unlockedAlternativeCollectors.has(collectorKey)
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
    const [seriesOwnership, ownership, alternativeByCollector, unlockedAlternativeCollectors] = await Promise.all([
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
          snapshotOwned && unlockedAlternativeCollectors.has(collectorKey)
            && hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId)),
        ),
      },
    };
  }

  async rollExternalSingleCard(session: ClientSession): Promise<CcgExternalCardAward> {
    requireFeature();
    const pool = await this.selectModePackResults("current", session);
    const selected = pool.results[0];
    if (!selected) throw new CcgServiceError(409, "pool_invalid", "The current card pool is incomplete");

    const card = await CcgCard.findOne({ _id: selected.cardId, setId: selected.setId }).session(session).lean();
    if (!card) throw new CcgServiceError(409, "pool_invalid", "The current card pool references an unavailable card");
    const set = await CcgSet.findOne({ _id: card.setId, enabledAt: { $ne: null } }).session(session).lean();
    if (!set) throw new CcgServiceError(409, "pool_invalid", "The current card pool references an unavailable set");

    const customFinish = set.kind === "raid" ? set.customFinish?.key ?? null : null;
    const finishOrder = getCcgPackFinishOrder(set.kind, customFinish);
    const finish = rollProtectedFinish(
      emptyFinishPity(),
      "standard",
      randomInt,
      finishOrder,
      customFinish
        ? { ...CCG_FINISH_PITY_LIMITS, [customFinish]: set.customFinish!.hardPity }
        : CCG_FINISH_PITY_LIMITS,
    ).finish;
    const alternativeArt = (await this.loadAlternativeArt([card], session)).get(resolveCollectorKey(card));

    return {
      cardId: card._id,
      setId: card.setId,
      characterId: card.characterId,
      snapshotVersion: card.snapshotVersion,
      finish,
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
      const [alternativeByCollector, unlockedCollectors] = await Promise.all([
        this.loadAlternativeArt([card]),
        this.loadAlternativeArtUnlocks({ ownerType: "user", ownerId: userId }, [card]),
      ]);
      const collectorKey = resolveCollectorKey(card);
      if (
        !unlockedCollectors.has(collectorKey)
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
        { $set: { dateKey: null, expiresAt: null } },
      );
    }

    const share = await this.createOrGetShare(
      { kind: "pack", userId, openingId },
      { kind: "pack", userId, openingId },
    );
    return this.serializeShareLink(share);
  }

  async getShare(rawPublicId: string): Promise<Record<string, unknown>> {
    requireFeature();
    const publicId = validateSharePublicId(rawPublicId);
    const share = await CcgShare.findOne({ publicId }).lean();
    if (!share) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");
    const user = await User.findById(share.userId).select("discord.id discord.username discord.avatar").lean();
    if (!user) throw new CcgServiceError(404, "share_not_found", "Shared opening not found");

    const response = {
      id: share.publicId,
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
      { upsert: true, new: true, setDefaultsOnInsert: true },
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
        score: Math.max(...candidate.characterSearchText.map((text) => scoreSearchCandidate(normalizedSearch, text))),
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

    const currentPacks = validatePackGrant(input.rewardType === "packs" ? input.currentPacks : 0, "Current");
    const legacyPacks = validatePackGrant(input.rewardType === "packs" ? input.legacyPacks : 0, "Legacy");
    let cardId: mongoose.Types.ObjectId | null = null;
    let finish: CcgFinish | null = null;
    let artVariant: CcgArtVariant | null = null;

    if (input.rewardType === "packs") {
      if (currentPacks + legacyPacks < 1) {
        throw new CcgServiceError(400, "empty_pack_reward", "Grant at least one Current or Legacy pack");
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

      const card = await CcgCard.findById(cardId).lean();
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
        currentPacks,
        legacyPacks,
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
    const code = await CcgRedeemCode.findByIdAndUpdate(id, { $set: { active: activeValue } }, { new: true }).lean();
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
          { new: true, session },
        );
        if (!reservedCode) throw new CcgServiceError(404, "redeem_code_not_found", "That code is invalid or inactive");

        const owner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: getHelsinkiDateKey() };
        const now = new Date();
        if (reservedCode.rewardType === "packs") {
          const balance = await this.ensurePackBalance(owner, session, now);
          const updated = await CcgPackBalance.findOneAndUpdate(
            { _id: balance._id },
            {
              $inc: {
                currentRemaining: reservedCode.currentPacks,
                legacyRemaining: reservedCode.legacyPacks,
              },
              $set: {
                hasPlayed: true,
                firstPlayedAt: balance.firstPlayedAt ?? now,
              },
            },
            { new: true, session },
          );
          if (!updated) throw new CcgServiceError(409, "pack_balance_busy", "Pack balance is being updated. Try again");
        } else {
          if (!reservedCode.cardId || !reservedCode.finish || !reservedCode.artVariant) {
            throw new CcgServiceError(409, "reward_unavailable", "This code's card reward is unavailable");
          }
          const card = await CcgCard.findById(reservedCode.cardId).session(session);
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
          currentPacks: reservedCode.currentPacks,
          legacyPacks: reservedCode.legacyPacks,
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
          amount: reservedCode.rewardType === "packs" ? reservedCode.currentPacks + reservedCode.legacyPacks : 1,
          metadata: {
            codeId: String(reservedCode._id),
            rewardType: reservedCode.rewardType,
            currentPacks: reservedCode.currentPacks,
            legacyPacks: reservedCode.legacyPacks,
            cardId: reservedCode.cardId ? String(reservedCode.cardId) : null,
            finish: reservedCode.finish ?? null,
            artVariant: reservedCode.artVariant ?? null,
          },
        }], { session });

        redeemed = {
          code: reservedCode.code,
          rewardType: reservedCode.rewardType,
          currentPacks: reservedCode.currentPacks,
          legacyPacks: reservedCode.legacyPacks,
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
        reward: { type: "packs", currentPacks: reward.currentPacks, legacyPacks: reward.legacyPacks },
      };
    }
    if (!reward.cardId || !reward.finish || !reward.artVariant) {
      throw new CcgServiceError(500, "redemption_failed", "The card reward could not be recovered");
    }

    const card = await CcgCard.findById(reward.cardId).lean();
    const set = card ? await CcgSet.findById(card.setId).lean() : null;
    if (!card || !set) throw new CcgServiceError(500, "redemption_failed", "The card reward could not be recovered");
    const owner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: getHelsinkiDateKey() };
    const [ownership, alternativeByCollector, unlockedAlternativeCollectors] = await Promise.all([
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
            unlockedAlternativeCollectors.has(collectorKey)
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
    const mode = validateMode(body.mode);
    const targetSetId = body.setId === undefined || body.setId === null || body.setId === ""
      ? null
      : validateObjectId(String(body.setId), "card set ID");
    if (targetSetId && mode !== "legacy") {
      throw new CcgServiceError(400, "invalid_pack_target", "Only Legacy packs can target a specific raid");
    }
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
        const allowanceSource = await this.reservePack(owner, mode, session);
        const pool = await this.selectModePackResults(mode, session, targetSetId);
        const selected = pool.results;
        const cards = await CcgCard.find({
          _id: { $in: selected.map((result) => result.cardId) },
          setId: { $in: pool.sourceSetIds },
        }).session(session).lean();
        const sourceSets = await CcgSet.find({ _id: { $in: pool.sourceSetIds } })
          .select(CCG_PUBLIC_SET_FIELDS)
          .session(session)
          .lean();
        const setById = new Map(sourceSets.map((set) => [String(set._id), set]));
        const cardById = new Map(cards.map((card) => [String(card._id), card]));
        if (cardById.size === 0) throw new CcgServiceError(409, "pool_unavailable", "This card set has no available cards");
        const alternativeByCollector = await this.loadAlternativeArt(cards, session);
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
        const qualityProgress = await this.ensureQualityProgress(owner, session);
        let pity = this.readFinishPity(qualityProgress);
        const results: SelectedResult[] = [];
        const completedCardDuplicates: Array<Pick<SelectedResult, "cardId" | "setId" | "characterId">> = [];
        for (const result of selected) {
          const card = cardById.get(String(result.cardId));
          if (!card) continue;
          const collectorKey = resolveCollectorKey(card);
          const seriesKey = getSeriesKey(card);
          const cardSet = setById.get(String(card.setId));
          if (!cardSet) throw new CcgServiceError(409, "pool_invalid", "The pack references an unavailable card set");
          const ownedFinishes = ownedFinishesBySeries.get(seriesKey) ?? new Set<CcgFinish>();
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
          const alternativeArt = alternativeByCollector.get(collectorKey);
          const artVariant = rollArtVariant(hasApplicableAlternativeArt(alternativeArt, Boolean(card.communityCharacterId)));
          pity = this.readFinishPity(rolled.pity);
          if (customFinish) this.writeCustomFinishPity(qualityProgress, cardSet.slug, rolled.pity[customFinish] ?? 0);
          ownedFinishes.add(finish);
          ownedFinishesBySeries.set(seriesKey, ownedFinishes);
          if (rolled.isCompletedCardDuplicate) {
            completedCardDuplicates.push({ cardId: card._id, setId: card.setId, characterId: card.characterId });
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
          });
        }
        if (results.length !== CCG_CARDS_PER_PACK) throw new CcgServiceError(409, "pool_invalid", "The pack pool is incomplete");

        openingId = new mongoose.Types.ObjectId();
        const ownedCardsBySetDelta = await this.getOwnedCardDeltas(owner, cards, session);
        this.writeFinishPity(qualityProgress, pity);
        await qualityProgress.save({ session });
        await this.addOwnership(owner, results, session);
        const completionRewards = owner.ownerType === "user"
          ? await this.grantCompletedCardRewards(owner.ownerId, completedCardDuplicates, session)
          : { current: 0, legacy: 0, total: 0 };
        const duplicateRewards = completionRewards.total;
        const shuffledResults = shufflePackResults(results);
        const [opening] = await CcgPackOpening.create(
          [
            {
              _id: openingId,
              ownerType: owner.ownerType,
              ownerId: owner.ownerId,
              mode,
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
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
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
              mode,
              idempotencyKey: `pack:${idempotencyKey}`,
              amount: -1,
              metadata: {
                openingId: String(openingId),
                targetSetId: targetSetId ? String(targetSetId) : null,
                setIds: Array.from(new Set(results.map((result) => String(result.setId)))),
                allowanceSource: allowanceSource.source,
              },
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
            },
          ],
          { session },
        );
        const creditBalances = await this.getPackCreditBalances(owner, session);
        const qualityProtection = this.readFinishPity(qualityProgress);
        const customQualityProtection = sourceSets
          .filter((set) => set.customFinish?.key)
          .map((set) => {
            const counter = this.readCustomFinishPity(qualityProgress, set.slug);
            return {
              setSlug: set.slug,
              counter,
              nextChance: finishChanceForCounter(counter + 1, set.customFinish!.hardPity),
            };
          });
        cacheUpdates = {
          packs: this.serializePackBalances(allowanceSource.balance, creditBalances),
          qualityProtection,
          qualityChances: this.getQualityChances(qualityProtection),
          customQualityProtection,
          ownedFinishesDelta: results.filter((result) => !result.isDuplicate).length,
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
    const ownershipFilter = owner.ownerType === "user"
      ? {
          $or: [
            { ownerType: "user", ownerId: owner.ownerId },
            { ownerType: "guest", claimedByUserId: owner.ownerId },
          ],
        }
      : { ownerType: "guest", ownerId: owner.ownerId };
    const opening = await CcgPackOpening.findOne({ _id: id, ...ownershipFilter }).lean();
    if (!opening) throw new CcgServiceError(404, "opening_not_found", "Pack opening not found");
    if (owner.ownerType === "guest" && (opening.dateKey !== owner.dateKey || !opening.expiresAt || opening.expiresAt <= new Date())) {
      throw new CcgServiceError(410, "guest_expired", "These guest cards have expired");
    }
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
    if (!guest) return { claimed: false, alreadyClaimed: false, cards: { current: 0, legacy: 0 }, transferredPacks: { current: 0, legacy: 0 }, startingPacks: 0 };
    if (guest.claimedByUserId) {
      if (String(guest.claimedByUserId) !== String(userId)) throw new CcgServiceError(409, "guest_already_claimed", "These guest cards were already claimed");
      return { claimed: false, alreadyClaimed: true, cards: { current: 0, legacy: 0 }, transferredPacks: { current: 0, legacy: 0 }, startingPacks: 0 };
    }
    const session = await mongoose.startSession();
    let response: Record<string, unknown> | null = null;
    try {
      await session.withTransaction(async () => {
        const transactionalGuest = await CcgGuest.findOne({
          _id: guest._id,
          dateKey: getHelsinkiDateKey(),
          expiresAt: { $gt: new Date() },
        }).session(session);
        if (!transactionalGuest) throw new CcgServiceError(410, "guest_expired", "This guest pack has expired");
        if (transactionalGuest.claimedByUserId) {
          response = { claimed: false, alreadyClaimed: true, cards: { current: 0, legacy: 0 }, transferredPacks: { current: 0, legacy: 0 }, startingPacks: 0 };
          return;
        }
        const guestOpenings = await CcgPackOpening.find({
          ownerType: "guest",
          ownerId: transactionalGuest._id,
          dateKey: transactionalGuest.dateKey,
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

        const userOwner: CcgOwner = { ownerType: "user", ownerId: userId, dateKey: transactionalGuest.dateKey };
        if (await this.hasCcgActivity(userOwner, session)) {
          throw new CcgServiceError(409, "ccg_account_already_started", "This account has already started its CCG collection");
        }
        const userBalance = await this.ensurePackBalance(userOwner, session);
        const firstPlay = await CcgPackBalance.findOneAndUpdate(
          { _id: userBalance._id, hasPlayed: { $ne: true } },
          { $set: { hasPlayed: true, firstPlayedAt: new Date() } },
          { new: true, session },
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
            mode: candidate.mode,
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
        const transferredPacks = getTransferableGuestPacks(guestBalance
          ? { current: guestBalance.currentRemaining, legacy: guestBalance.legacyRemaining }
          : null);

        const conversionCredits = (["current", "legacy"] as const)
          .filter((mode) => transferredPacks[mode] > 0)
          .map((mode) => ({
            ownerId: userId,
            mode,
            source: "login_conversion" as const,
            sourceKey: `guest-conversion:${transactionalGuest._id}:${mode}`,
            remaining: transferredPacks[mode],
          }));
        if (conversionCredits.length > 0) {
          await CcgPackCredit.create(conversionCredits, { session, ordered: true });
        }

        const claimedAt = new Date();
        await CcgOwnership.updateMany(
          { ownerType: "guest", ownerId: transactionalGuest._id },
          {
            $set: {
              ownerType: "user",
              ownerId: userId,
              dateKey: null,
              expiresAt: null,
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
              expiresAt: null,
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
              expiresAt: null,
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
              expiresAt: null,
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
        await CcgDailyAllowance.deleteMany({ ownerType: "guest", ownerId: transactionalGuest._id }, { session });
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
          startingPacks: CCG_INITIAL_PACKS.user.current,
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
    return response ?? { claimed: false, alreadyClaimed: true, cards: { current: 0, legacy: 0 }, transferredPacks: { current: 0, legacy: 0 }, startingPacks: 0 };
  }

  async resolveOwner(req: Request, res: Response): Promise<CcgOwner> {
    requireFeature();
    const dateKey = getHelsinkiDateKey();
    if (req.session.userId && mongoose.Types.ObjectId.isValid(req.session.userId)) {
      const userId = new mongoose.Types.ObjectId(req.session.userId);
      if (await User.exists({ _id: userId })) return { ownerType: "user", ownerId: userId, dateKey };
    }
    const expiresAt = getNextHelsinkiReset();
    const rawCookie = typeof req.cookies?.[CCG_GUEST_COOKIE] === "string" ? req.cookies[CCG_GUEST_COOKIE] : null;
    if (rawCookie) {
      const now = new Date();
      const existing = await CcgGuest.findOne({ tokenHash: hashGuestToken(rawCookie), dateKey, expiresAt: { $gt: now }, claimedAt: null }).lean();
      if (existing) {
        if (existing.lastSeenAt.getTime() <= now.getTime() - CCG_GUEST_LAST_SEEN_WRITE_INTERVAL_MS) {
          void CcgGuest.updateOne(
            { _id: existing._id, lastSeenAt: { $lte: new Date(now.getTime() - CCG_GUEST_LAST_SEEN_WRITE_INTERVAL_MS) } },
            { $set: { lastSeenAt: now } },
          ).catch((error) => logger.error("[CCG] Failed to update guest activity:", error));
        }
        return { ownerType: "guest", ownerId: existing._id, dateKey, expiresAt: existing.expiresAt };
      }
    }
    const token = randomBytes(32).toString("base64url");
    const guest = await CcgGuest.create({
      tokenHash: hashGuestToken(token),
      dateKey,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt,
    });
    res.cookie(CCG_GUEST_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/ccg",
      expires: expiresAt,
    });
    return { ownerType: "guest", ownerId: guest._id, dateKey, expiresAt };
  }

  async cleanupExpiredGuestData(): Promise<Record<string, number>> {
    const now = new Date();
    const [ownership, seriesOwnership, balances, allowances, openings, ledgers, qualityProgress, guests] = await Promise.all([
      CcgOwnership.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgSeriesOwnership.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgPackBalance.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgDailyAllowance.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgPackOpening.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgLedgerEntry.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgQualityProgress.deleteMany({ ownerType: "guest", expiresAt: { $lte: now } }),
      CcgGuest.deleteMany({ expiresAt: { $lte: now } }),
    ]);
    return {
      ownership: ownership.deletedCount,
      seriesOwnership: seriesOwnership.deletedCount,
      balances: balances.deletedCount,
      allowances: allowances.deletedCount,
      openings: openings.deletedCount,
      ledgers: ledgers.deletedCount,
      qualityProgress: qualityProgress.deletedCount,
      guests: guests.deletedCount,
    };
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
      { upsert: true, new: true },
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
          current: { $sum: { $cond: [{ $eq: ["$mode", "current"] }, 1, 0] } },
          legacy: { $sum: { $cond: [{ $eq: ["$mode", "legacy"] }, 1, 0] } },
          updatedAt: { $max: "$createdAt" },
        },
      },
      {
        $project: {
          _id: 0,
          dateKey: "$_id",
          packOpenings: 1,
          activeUsers: { $literal: 0 },
          modes: { current: "$current", legacy: "$legacy" },
          finishes: {
            $literal: { standard: 0, foil: 0, golden: 0, prismatic: 0, holographic: 0, void: 0, toxic: 0, negative: 0 },
          },
          grades: { $literal: { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 } },
          updatedAt: 1,
        },
      },
      {
        $merge: {
          into: CcgAnalyticsDaily.collection.name,
          on: "dateKey",
          whenMatched: [{ $set: { packOpenings: "$$new.packOpenings", modes: "$$new.modes", updatedAt: "$$new.updatedAt" } }],
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
          .select("ownerType ownerId claimedByUserId mode results createdAt")
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
          [`modes.${opening.mode}`]: 1,
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
            modes: { current: 0, legacy: 0 },
            finishes: { standard: 0, foil: 0, golden: 0, prismatic: 0, holographic: 0, void: 0, toxic: 0, negative: 0 },
            grades: { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
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
    };
  }

  private getQualityChances(qualityProtection: CcgFinishPity): Record<string, number> {
    return Object.fromEntries(
      CCG_BASE_FINISH_ORDER
        .filter((finish) => finish !== "standard")
        .map((finish) => [
          finish,
          finishChanceForCounter((qualityProtection[finish] ?? 0) + 1, CCG_FINISH_PITY_LIMITS[finish]),
        ]),
    );
  }

  private serializePackBalances(
    packBalance: Pick<ICcgPackBalance, "currentRemaining" | "legacyRemaining">,
    creditBalances: Record<CcgMode, number>,
  ): Record<CcgMode, { regularRemaining: number; bonusRemaining: number; totalRemaining: number }> {
    return {
      current: {
        regularRemaining: packBalance.currentRemaining,
        bonusRemaining: creditBalances.current,
        totalRemaining: packBalance.currentRemaining + creditBalances.current,
      },
      legacy: {
        regularRemaining: packBalance.legacyRemaining,
        bonusRemaining: creditBalances.legacy,
        totalRemaining: packBalance.legacyRemaining + creditBalances.legacy,
      },
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
          expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
        },
      },
      { upsert: true, new: true, session },
    );
  }

  private async getPackCreditBalances(owner: CcgOwner, session?: ClientSession): Promise<Record<CcgMode, number>> {
    if (owner.ownerType === "guest") return { current: 0, legacy: 0 };
    const aggregate = CcgPackCredit.aggregate<{ _id: CcgMode; remaining: number }>([
      { $match: { ownerId: owner.ownerId, remaining: { $gt: 0 } } },
      { $group: { _id: "$mode", remaining: { $sum: "$remaining" } } },
    ]);
    if (session) aggregate.session(session);
    const rows = await aggregate;
    const balances: Record<CcgMode, number> = { current: 0, legacy: 0 };
    rows.forEach((row) => { balances[row._id] = row.remaining; });
    return balances;
  }

  private async getSessionPackState(
    owner: CcgOwner,
    date: Date,
  ): Promise<{
    balance: Pick<ICcgPackBalance, "currentRemaining" | "legacyRemaining">;
    creditBalances: Record<CcgMode, number>;
  }> {
    const filter = { ownerType: owner.ownerType, ownerId: owner.ownerId };
    const [balance, latestRollover, creditBalances] = await Promise.all([
      CcgPackBalance.findOne(filter).lean(),
      CcgRollover.findOne({}).select("sequence").sort({ sequence: -1 }).lean(),
      this.getPackCreditBalances(owner),
    ]);
    const activeRolloverSequence = latestRollover?.sequence ?? 0;
    if (
      balance
      && balance.grantVersion === CCG_PACK_BALANCE_VERSION
      && typeof balance.hasPlayed === "boolean"
      && (balance.lastRolloverSequence ?? 0) === activeRolloverSequence
    ) {
      const recharge = applyPackRecharge(
        { current: balance.currentRemaining, legacy: balance.legacyRemaining },
        balance.lastRechargeAt,
        date,
        creditBalances,
      );
      if (
        recharge.balances.current === balance.currentRemaining
        && recharge.balances.legacy === balance.legacyRemaining
        && recharge.lastRechargeAt.getTime() === balance.lastRechargeAt.getTime()
      ) {
        return { balance, creditBalances };
      }
    }

    const reconciledBalance = await this.ensurePackBalance(owner, undefined, date);
    return {
      balance: reconciledBalance,
      creditBalances: await this.getPackCreditBalances(owner),
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
    const latestRollover = await CcgRollover.findOne({}).select("sequence").sort({ sequence: -1 }).session(session).lean();
    const activeRolloverSequence = latestRollover?.sequence ?? 0;
    const filter = { ownerType: owner.ownerType, ownerId: owner.ownerId };
    let balance = await CcgPackBalance.findOne(filter).session(session);
    if (!balance) {
      const hasPlayed = await this.hasCcgActivity(owner, session);
      const initial = hasPlayed ? { current: 0, legacy: 0 } : CCG_INITIAL_PACKS[owner.ownerType];
      balance = await CcgPackBalance.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            currentRemaining: initial.current,
            legacyRemaining: initial.legacy,
            lastRechargeAt: getRechargeTickStart(date),
            lastRolloverSequence: activeRolloverSequence,
            grantVersion: CCG_PACK_BALANCE_VERSION,
            hasPlayed,
            firstPlayedAt: hasPlayed ? date : null,
            expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
          },
        },
        { upsert: true, new: true, session },
      );
    }
    if (!balance) throw new CcgServiceError(500, "pack_balance_unavailable", "Pack balance could not be initialized");

    if (balance.grantVersion !== CCG_PACK_BALANCE_VERSION || typeof balance.hasPlayed !== "boolean") {
      const previousGrantVersion = balance.grantVersion;
      const hasPlayed = balance.hasPlayed === true || await this.hasCcgActivity(owner, session);
      const initial = CCG_INITIAL_PACKS[owner.ownerType];
      const upgradeActiveGuestBalance = (mode: CcgMode, remaining: number): number => (
        owner.ownerType === "guest" && hasPlayed && previousGrantVersion === 2
          ? Math.min(
              CCG_PACK_STORAGE_CAPS[mode],
              Math.max(0, remaining) + CCG_INITIAL_PACKS.guest[mode] - CCG_PREVIOUS_GUEST_INITIAL_PACKS[mode],
            )
          : hasPlayed ? Math.max(0, remaining) : initial[mode]
      );
      balance.currentRemaining = upgradeActiveGuestBalance("current", balance.currentRemaining);
      balance.legacyRemaining = upgradeActiveGuestBalance("legacy", balance.legacyRemaining);
      balance.grantVersion = CCG_PACK_BALANCE_VERSION;
      balance.hasPlayed = hasPlayed;
      balance.firstPlayedAt = hasPlayed ? (balance.firstPlayedAt ?? date) : null;
    }

    const lastRolloverSequence = balance.lastRolloverSequence ?? 0;
    if (lastRolloverSequence > activeRolloverSequence) {
      throw new CcgServiceError(500, "rollover_state_invalid", "Pack rollover history is inconsistent");
    }
    if (lastRolloverSequence < activeRolloverSequence) {
      const rollovers = await CcgRollover.find({ sequence: { $gt: lastRolloverSequence, $lte: activeRolloverSequence } })
        .sort({ sequence: 1 })
        .session(session);
      let expectedSequence = lastRolloverSequence + 1;
      for (const rollover of rollovers) {
        if (rollover.sequence !== expectedSequence) {
          throw new CcgServiceError(503, "rollover_history_incomplete", "Pack rollover history is temporarily unavailable");
        }
        const creditBalances = await this.getPackCreditBalances(owner, session);
        const applied = applyCcgPackRollover(
          owner.ownerType,
          { current: balance.currentRemaining, legacy: balance.legacyRemaining },
          creditBalances,
          balance.lastRechargeAt,
          rollover.effectiveAt,
          owner.ownerType === "user" ? rollover.userCurrentPacks : rollover.guestCurrentPacks,
        );

        if (owner.ownerType === "user") {
          if (applied.regularCurrentMoved > 0) {
            await CcgPackCredit.updateOne(
              { ownerId: owner.ownerId, sourceKey: `raid-rollover:${rollover.sequence}:regular` },
              {
                $setOnInsert: {
                  mode: "legacy",
                  source: "raid_rollover",
                  remaining: applied.regularCurrentMoved,
                },
              },
              { upsert: true, session },
            );
          }
          if (applied.bonusCurrentMoved > 0) {
            await CcgPackCredit.updateMany(
              { ownerId: owner.ownerId, mode: "current", remaining: { $gt: 0 } },
              { $set: { mode: "legacy" } },
              { session },
            );
          }
        }

        balance.currentRemaining = applied.balances.current;
        balance.legacyRemaining = applied.balances.legacy;
        balance.lastRechargeAt = applied.lastRechargeAt;
        balance.lastRolloverSequence = rollover.sequence;
        await CcgLedgerEntry.updateOne(
          { ownerType: owner.ownerType, ownerId: owner.ownerId, idempotencyKey: `raid-rollover:${rollover.sequence}` },
          {
            $setOnInsert: {
              action: "raid_rollover",
              mode: null,
              amount: applied.regularCurrentMoved + applied.bonusCurrentMoved,
              metadata: {
                sequence: rollover.sequence,
                fromSetIds: rollover.fromSetIds.map(String),
                toSetId: String(rollover.toSetId),
                regularCurrentMoved: applied.regularCurrentMoved,
                bonusCurrentMoved: applied.bonusCurrentMoved,
                newCurrentPacks: applied.balances.current,
              },
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
            },
          },
          { upsert: true, session },
        );
        expectedSequence += 1;
      }
      if (expectedSequence - 1 !== activeRolloverSequence) {
        throw new CcgServiceError(503, "rollover_history_incomplete", "Pack rollover history is temporarily unavailable");
      }
    }

    const creditBalances = await this.getPackCreditBalances(owner, session);
    const recharge = applyPackRecharge(
      { current: balance.currentRemaining, legacy: balance.legacyRemaining },
      balance.lastRechargeAt,
      date,
      creditBalances,
    );
    balance.currentRemaining = recharge.balances.current;
    balance.legacyRemaining = recharge.balances.legacy;
    balance.lastRechargeAt = recharge.lastRechargeAt;
    if (balance.isModified()) await balance.save({ session });
    return balance;
  }

  private async reservePack(
    owner: CcgOwner,
    mode: CcgMode,
    session: ClientSession,
  ): Promise<{ source: "recharge" | "credit"; creditId?: mongoose.Types.ObjectId; balance: ICcgPackBalance }> {
    const balance = await this.ensurePackBalance(owner, session);
    const remainingField = mode === "current" ? "currentRemaining" : "legacyRemaining";
    const now = new Date();
    const reserved = await CcgPackBalance.findOneAndUpdate(
      { _id: balance._id, [remainingField]: { $gt: 0 } },
      {
        $inc: { [remainingField]: -1 },
        $set: {
          hasPlayed: true,
          firstPlayedAt: balance.firstPlayedAt ?? now,
        },
      },
      { new: true, session },
    );
    if (reserved) return { source: "recharge", balance: reserved };
    if (owner.ownerType === "guest") throw new CcgServiceError(409, "no_packs", `No ${mode} packs are charged`);
    const credit = await CcgPackCredit.findOneAndUpdate(
      { ownerId: owner.ownerId, mode, remaining: { $gt: 0 } },
      { $inc: { remaining: -1 } },
      { new: true, sort: { createdAt: 1 }, session },
    );
    if (!credit) throw new CcgServiceError(409, "no_packs", `No ${mode} packs remain`);
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

  private async selectModePackResults(
    mode: CcgMode,
    session: ClientSession,
    targetSetId: mongoose.Types.ObjectId | null = null,
  ): Promise<{
    results: Array<{ cardId: mongoose.Types.ObjectId; setId: mongoose.Types.ObjectId; tierGrade: CcgTierGrade }>;
    sourceSetIds: mongoose.Types.ObjectId[];
    version: string;
  }> {
    const setFilter: Record<string, unknown> = { state: mode, kind: { $ne: "community" }, enabledAt: { $ne: null }, cardCount: { $gt: 0 } };
    if (targetSetId) setFilter._id = targetSetId;
    const sets = await CcgSet.find(setFilter)
      .select("_id")
      .sort({ zoneId: 1 })
      .session(session)
      .lean();
    if (sets.length === 0) {
      if (targetSetId) throw new CcgServiceError(409, "target_set_unavailable", "That Legacy raid is not available for pack opening");
      throw new CcgServiceError(409, `${mode}_unavailable`, `The ${mode === "current" ? "Current" : "Legacy"} card pool is still being prepared`);
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
      throw new CcgServiceError(409, "pool_unavailable", `The ${mode === "current" ? "Current" : "Legacy"} card pool is incomplete`);
    }

    const plan = planPackSelections(
      summaries.map((pool) => ({
        poolId: String(pool._id),
        setId: String(pool.setId),
        version: pool.version,
        counts: pool.counts,
      })),
    );
    const selectedPoolIds = Array.from(new Set(plan.map((row) => row.poolId))).map((id) => new mongoose.Types.ObjectId(id));
    const selectedGrades = Array.from(new Set(plan.map((row) => row.tierGrade)));
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
    const baseResults = plan.map((row) => {
      const cardIds = cardsByBucket.get(`${row.poolId}:${row.tierGrade}`);
      const cardId = cardIds?.[row.bucketOffset];
      if (!cardId) throw new CcgServiceError(409, "pool_invalid", "The pack pool changed while this pack was opening");
      return { cardId, setId: new mongoose.Types.ObjectId(row.setId), tierGrade: row.tierGrade };
    });
    const communitySet = await CcgSet.findOne({ kind: "community", enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
      .select("_id")
      .session(session)
      .lean();
    const communityPool = communitySet
      ? await CcgPackPool.findOne({ setId: communitySet._id, active: true, totalCards: { $gt: 0 } }).select("version buckets").session(session).lean()
      : null;
    const communityByGrade = new Map(
      (communityPool?.buckets ?? []).map((bucket) => [bucket.grade as CcgTierGrade, bucket.cardIds as mongoose.Types.ObjectId[]]),
    );
    const normalCountByGrade = new Map<CcgTierGrade, number>();
    for (const summary of summaries) {
      for (const row of summary.counts) normalCountByGrade.set(row.grade, (normalCountByGrade.get(row.grade) ?? 0) + row.count);
    }
    const results = baseResults.map((base) => {
      const communityCards = communityByGrade.get(base.tierGrade) ?? [];
      const normalCount = normalCountByGrade.get(base.tierGrade) ?? 0;
      const communityCardId = selectCommunityCard(normalCount, communityCards, randomInt);
      if (communitySet && communityCardId) {
        return {
          cardId: communityCardId,
          setId: communitySet._id,
          tierGrade: base.tierGrade,
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
      version: `${mode}:${targetSetId ? String(targetSetId) : "random"}:${createHash("sha256").update(versionSeed).digest("hex").slice(0, 20)}`,
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
    const now = new Date();
    await CcgSeriesOwnership.bulkWrite(
      Array.from(series.values()).map((row) => ({
        updateOne: {
          filter: {
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            setId: row.setId,
            characterId: row.characterId,
          },
          update: {
            $addToSet: { unlockedSnapshotVersions: { $each: Array.from(row.snapshotVersions) } },
            $set: { lastAcquiredAt: now },
            $setOnInsert: {
              firstAcquiredAt: now,
              dateKey: owner.ownerType === "guest" ? owner.dateKey : null,
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
            },
          },
          upsert: true,
        },
      })),
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
              expiresAt: owner.ownerType === "guest" ? owner.expiresAt : null,
            },
          },
          upsert: true,
        },
      })),
      { session, ordered: true },
    );
  }

  private async getOwnedCardDeltas(
    owner: CcgOwner,
    cards: ReadonlyArray<Pick<ICcgCard, "setId" | "characterId">>,
    session: ClientSession,
  ): Promise<Record<string, number>> {
    const pairs = new Map<string, { setId: mongoose.Types.ObjectId; characterId: mongoose.Types.ObjectId }>();
    for (const card of cards) {
      const key = `${card.setId}:${card.characterId}`;
      if (!pairs.has(key)) pairs.set(key, { setId: card.setId, characterId: card.characterId });
    }
    if (pairs.size === 0) return {};

    const ownedSeries = await CcgSeriesOwnership.find({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      $or: Array.from(pairs.values()),
    }).select("setId characterId").session(session).lean();
    const alreadyOwnedPairs = new Set(ownedSeries.map(getSeriesKey));
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
  ): Promise<Record<CcgMode, number> & { total: number }> {
    const uniqueCandidates = new Map(candidates.map((candidate) => [getSeriesKey(candidate), candidate]));
    if (uniqueCandidates.size === 0) return { current: 0, legacy: 0, total: 0 };

    const sets = await CcgSet.find({
      _id: { $in: Array.from(uniqueCandidates.values(), (candidate) => candidate.setId) },
      kind: "raid",
      state: { $in: ["current", "legacy"] },
    }).select("_id state").session(session).lean();
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const rewards: Record<CcgMode, number> & { total: number } = { current: 0, legacy: 0, total: 0 };
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
      const mode = set.state;
      const seriesKey = getSeriesKey(candidate);
      const sourceKey = `completed-series:${seriesKey}`;
      if (existingSourceKeys.has(sourceKey)
        || (legacySourceKeysBySeries.get(seriesKey) ?? []).some((key) => existingSourceKeys.has(key))) {
        continue;
      }
      const credit = await CcgPackCredit.updateOne(
        { ownerId, sourceKey },
        { $setOnInsert: { mode, source: "duplicate", remaining: 1 } },
        { upsert: true, session },
      );
      if (credit.upsertedCount !== 1) continue;

      await CcgLedgerEntry.create(
        [
          {
            ownerType: "user",
            ownerId,
            action: "duplicate_reward",
            mode,
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
      rewards[mode] += 1;
      rewards.total += 1;
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
            reward: { type: "packs", currentPacks: code.currentPacks, legacyPacks: code.legacyPacks },
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
    return {
      id: String(opening._id),
      mode: opening.mode,
      targetSetId: opening.targetSetId ? String(opening.targetSetId) : null,
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
    cards: ReadonlyArray<{ collectorKey?: string | null; characterId: mongoose.Types.ObjectId | string }>,
    session?: ClientSession,
  ): Promise<Set<string>> {
    const collectorKeys = Array.from(new Set(cards.map(resolveCollectorKey)));
    if (collectorKeys.length === 0) return new Set();
    const characterIds = Array.from(new Set(cards.map((card) => String(card.characterId))));
    const relatedCardsQuery = CcgCard.find({
      $or: [
        { collectorKey: { $in: collectorKeys } },
        { characterId: { $in: characterIds } },
      ],
    }).select("_id characterId collectorKey").lean();
    if (session) relatedCardsQuery.session(session);
    const relatedCards = await relatedCardsQuery;
    const collectorByCardId = new Map(relatedCards.map((card) => [String(card._id), resolveCollectorKey(card)]));
    const unlocksQuery = CcgOwnership.find({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      cardId: { $in: relatedCards.map((card) => card._id) },
      alternativeQuantity: { $gt: 0 },
    }).select("cardId").lean();
    if (session) unlocksQuery.session(session);
    const unlocks = await unlocksQuery;
    return new Set(unlocks.map((row) => collectorByCardId.get(String(row.cardId))).filter((value): value is string => Boolean(value)));
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

  private async requireAuthenticatedUser(req: Request): Promise<mongoose.Types.ObjectId> {
    const rawUserId = req.session.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(rawUserId)) {
      throw new CcgServiceError(401, "authentication_required", "Log in to share cards and packs");
    }
    const userId = new mongoose.Types.ObjectId(rawUserId);
    if (!(await User.exists({ _id: userId }))) {
      throw new CcgServiceError(401, "authentication_required", "Log in to share cards and packs");
    }
    return userId;
  }

  private async createOrGetShare(
    filter: Record<string, unknown>,
    fields: Record<string, unknown>,
  ): Promise<ICcgShare> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const share = await CcgShare.findOneAndUpdate(
          filter,
          { $setOnInsert: { ...fields, publicId: randomBytes(16).toString("base64url") } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        if (share) return share;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const existing = await CcgShare.findOne(filter);
        if (existing) return existing;
      }
    }
    throw new CcgServiceError(503, "share_unavailable", "The share link could not be created");
  }

  private serializeShareLink(share: Pick<ICcgShare, "publicId" | "kind">): Record<string, unknown> {
    return {
      id: share.publicId,
      kind: share.kind,
      path: `/fun/ccg/share/${share.kind}/${share.publicId}`,
    };
  }

  private async findClaimableGuest(req: Request, includeClaimed = false): Promise<ICcgGuest | null> {
    const raw = typeof req.cookies?.[CCG_GUEST_COOKIE] === "string" ? req.cookies[CCG_GUEST_COOKIE] : null;
    if (!raw) return null;
    const filter: Record<string, unknown> = {
      tokenHash: hashGuestToken(raw),
      dateKey: getHelsinkiDateKey(),
      expiresAt: { $gt: new Date() },
    };
    if (!includeClaimed) filter.claimedAt = null;
    return CcgGuest.findOne(filter);
  }

}

export default new CcgService();
