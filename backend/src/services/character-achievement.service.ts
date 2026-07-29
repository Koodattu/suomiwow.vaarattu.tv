import fetch, { Response } from "node-fetch";
import mongoose from "mongoose";
import { createHash } from "crypto";
import { CHARACTER_ACCOUNT_SIGNAL_ACHIEVEMENT_ID_SET, CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import { Achievement, AuthToken } from "../models/Achievement";
import Character, { ICharacter } from "../models/Character";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterAccountManualEdge from "../models/CharacterAccountManualEdge";
import CharacterContinuityLink from "../models/CharacterContinuityLink";
import CharacterAccountMatch, { CharacterAccountMatchConfidence } from "../models/CharacterAccountMatch";
import CharacterAchievementFetchQueue, { CharacterAchievementFetchStatus, ICharacterAchievementFetchQueue } from "../models/CharacterAchievementFetchQueue";
import CharacterAchievementFingerprint, { ICharacterAchievementFingerprint, ICharacterAchievementSignal } from "../models/CharacterAchievementFingerprint";
import CharacterAchievementToken from "../models/CharacterAchievementToken";
import CharacterRaidAchievementSummary, {
  CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
  ICharacterRaidAchievementSummary,
} from "../models/CharacterRaidAchievementSummary";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import {
  buildFeaturedAchievementTargets,
  countFeaturedAchievements,
  extractCompletedFeaturedAchievements,
  FeaturedAchievementTarget,
} from "../utils/featured-achievements";
import logger from "../utils/logger";
import { normalizeRealmSlug } from "../utils/realm";
import { resolveBlizzardCharacterIdentity } from "../utils/character-identity";
import { createCharacterAccountPairKey, orderCharacterAccountPairIds } from "../utils/character-account-manual-edge";
import { buildCharacterContinuityGraph } from "../utils/character-continuity";
import cacheService from "./cache.service";
import taskTracker from "./task-tracker.service";

const TASK_NAME = "Character Achievement Backfill";
const PROCESS_LOG_INTERVAL = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_PRIORITY = 10;
const DEFAULT_MAX_CALLS_PER_HOUR = 30000;
const DEFAULT_COMMON_TOKEN_MAX_CHARACTER_COUNT = 25;
const HIGH_CONFIDENCE_MIN_EXACT_MATCHES = 50;
const HIGH_CONFIDENCE_MIN_EXACT_RATE = 0.5;
const MEDIUM_CONFIDENCE_MIN_EXACT_MATCHES = 20;
const MEDIUM_CONFIDENCE_MIN_EXACT_RATE = 0.35;
const MATCH_SAMPLE_LIMIT = 20;

interface BlizzardTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface BlizzardAchievementSummaryAchievement {
  id?: unknown;
  completed_timestamp?: unknown;
}

interface BlizzardAchievementSummaryResponse {
  total_points?: unknown;
  total_quantity?: unknown;
  achievements?: BlizzardAchievementSummaryAchievement[];
}

interface CharacterAchievementQueueItemSummary {
  id: string;
  characterId: string;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  signalVersion: string;
  status: CharacterAchievementFetchStatus;
  attempts: number;
  maxAttempts: number;
  httpStatus?: number | null;
  errorCode?: string | null;
  isPermanentError: boolean;
  completionReason?: string | null;
  lastError?: string | null;
  lastErrorAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  nextAttemptAt: Date;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CharacterAchievementBackfillStatusResponse {
  processor: {
    isRunning: boolean;
    isWaitingForRateLimit: boolean;
    currentItem: CharacterAchievementQueueItemSummary | null;
    lastMessage: string | null;
    startedAt: Date | null;
  };
  queue: {
    pending: number;
    inProgress: number;
    completed: number;
    notFound: number;
    skipped: number;
    failed: number;
    total: number;
    terminal: number;
  };
  fingerprints: number;
  tokens: number;
  matches: {
    high: number;
    medium: number;
    total: number;
  };
  groups: number;
  signalVersion: string;
  signalAchievementCount: number;
  raidAchievementSummaryVersion: string;
  raidAchievementTargetCount: number;
  raidAchievementSummaries: number;
  recentFailures: CharacterAchievementQueueItemSummary[];
  updatedAt: Date;
}

export interface CharacterAchievementBackfillEnqueueResult {
  candidates: number;
  queued: number;
  existing: number;
  updated: number;
  skippedWithFingerprint: number;
  skippedWithRaidAchievementSummary: number;
  missingRaidAchievementSummary: number;
}

export interface CharacterAchievementTargetedEnqueueResult {
  candidates: number;
  scheduled: number;
  queued: number;
  updated: number;
  skippedActive: number;
}

export function buildCharacterAchievementSnapshotKey(
  character: Pick<ICharacter, "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID">,
): string {
  return [character.wclCanonicalCharacterId, character.classID, character.region.toLowerCase(), character.realm.toLowerCase(), character.name.toLowerCase()].join(":");
}

export interface CharacterAchievementBackfillTriggerResult {
  started: boolean;
  enqueue: CharacterAchievementBackfillEnqueueResult;
  status: CharacterAchievementBackfillStatusResponse;
}

export interface CharacterAccountGroupRebuildResult {
  groups: number;
  matchedCharacters: number;
  highConfidenceEdges: number;
  manualEdges: number;
}

interface ProcessOutcome {
  status: "completed" | "not_found" | "failed";
  reason: string;
  httpStatus?: number | null;
  errorCode?: string | null;
  isPermanentError: boolean;
}

class BlizzardApiError extends Error {
  status: number | null;
  errorCode: string;
  retryable: boolean;
  permanent: boolean;

  constructor(message: string, options: { status?: number | null; errorCode: string; retryable: boolean; permanent: boolean }) {
    super(message);
    this.name = "BlizzardApiError";
    this.status = options.status ?? null;
    this.errorCode = options.errorCode;
    this.retryable = options.retryable;
    this.permanent = options.permanent;
  }
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function summarizeQueueItem(item: ICharacterAchievementFetchQueue): CharacterAchievementQueueItemSummary {
  return {
    id: String(item._id),
    characterId: String(item.characterId),
    wclCanonicalCharacterId: item.wclCanonicalCharacterId,
    name: item.name,
    realm: item.realm,
    region: item.region,
    classID: item.classID,
    signalVersion: item.signalVersion,
    status: item.status,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    httpStatus: item.httpStatus,
    errorCode: item.errorCode,
    isPermanentError: item.isPermanentError,
    completionReason: item.completionReason,
    lastError: item.lastError,
    lastErrorAt: item.lastErrorAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    nextAttemptAt: item.nextAttemptAt,
    lastActivityAt: item.lastActivityAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

class CharacterAchievementService {
  private isRunning = false;
  private isWaitingForRateLimit = false;
  private currentItem: CharacterAchievementQueueItemSummary | null = null;
  private lastMessage: string | null = null;
  private startedAt: Date | null = null;
  private lastBlizzardRequestAt = 0;
  private featuredAchievementTargets: FeaturedAchievementTarget[] | null = null;
  private readonly oauthUrl = "https://oauth.battle.net/token";
  private readonly regionApiUrls: Record<string, string> = {
    us: "https://us.api.blizzard.com",
    eu: "https://eu.api.blizzard.com",
    kr: "https://kr.api.blizzard.com",
    tw: "https://tw.api.blizzard.com",
  };

  async triggerBackfill(options: { refreshCandidates?: boolean; refreshAll?: boolean } = {}): Promise<CharacterAchievementBackfillTriggerResult> {
    this.featuredAchievementTargets = null;
    const taskId = await taskTracker.start("Queue Character Achievement Backfill", {
      refreshCandidates: options.refreshCandidates === true,
      refreshAll: options.refreshAll === true,
    });
    let enqueue: CharacterAchievementBackfillEnqueueResult;
    try {
      enqueue = await this.enqueueMissingItems({
        refreshExistingQueue: options.refreshCandidates === true,
        refreshAll: options.refreshAll === true,
      });
      await taskTracker.complete(taskId, { ...enqueue });
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    }
    let started = false;

    if (!this.isRunning) {
      await this.resetInterruptedItems();
      started = this.startProcessing();
    }

    return {
      started,
      enqueue,
      status: await this.getStatus(),
    };
  }

  startProcessing(): boolean {
    if (this.isRunning) return false;

    this.isRunning = true;
    this.isWaitingForRateLimit = false;
    this.startedAt = new Date();
    this.lastMessage = "Character achievement backfill processor started";
    logger.info("[CharacterAchievementBackfill] Processor started");

    void this.processLoop().catch((error) => {
      logger.error("[CharacterAchievementBackfill] Processor crashed:", error);
      this.isRunning = false;
      this.isWaitingForRateLimit = false;
      this.currentItem = null;
      this.lastMessage = `Processor crashed: ${error instanceof Error ? error.message : "Unknown error"}`;
    });

    return true;
  }

  async resumeInterruptedBackfill(): Promise<boolean> {
    if (this.isRunning) return false;

    await this.resetInterruptedItems();
    const pendingItems = await CharacterAchievementFetchQueue.countDocuments({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      status: "pending",
    });

    if (pendingItems === 0) {
      this.lastMessage = "No pending character achievement backfill items to resume";
      return false;
    }

    logger.info(`[CharacterAchievementBackfill] Resuming ${pendingItems} pending item(s) after startup`);
    return this.startProcessing();
  }

  async enqueueCharacters(
    characterIds: readonly mongoose.Types.ObjectId[],
    priority = DEFAULT_PRIORITY,
  ): Promise<CharacterAchievementTargetedEnqueueResult> {
    const uniqueIds = [...new Map(characterIds.map((id) => [String(id), id])).values()];
    if (uniqueIds.length === 0) return { candidates: 0, scheduled: 0, queued: 0, updated: 0, skippedActive: 0 };

    const [characterRows, latestParticipationRows, queueRows] = await Promise.all([
      Character.find({ _id: { $in: uniqueIds } })
        .select("_id wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
        .lean<Array<Pick<ICharacter, "_id" | "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "blizzardIdentityOverride">>>(),
      CharacterRaidParticipation.aggregate<{
        _id: mongoose.Types.ObjectId;
        name: string;
        realm: string;
        region: string;
        observedAt: Date;
      }>([
        { $match: { characterId: { $in: uniqueIds } } },
        { $sort: { lastSeenAt: -1, zoneId: -1, _id: -1 } },
        {
          $group: {
            _id: "$characterId",
            name: { $first: "$characterName" },
            realm: { $first: "$characterRealm" },
            region: { $first: "$characterRegion" },
            observedAt: { $first: "$lastSeenAt" },
          },
        },
      ]).allowDiskUse(true),
      CharacterAchievementFetchQueue.find({
        characterId: { $in: uniqueIds },
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      })
        .select("characterId status")
        .lean<Array<Pick<ICharacterAchievementFetchQueue, "characterId" | "status">>>(),
    ]);

    const latestParticipationByCharacterId = new Map(latestParticipationRows.map((row) => [String(row._id), row]));
    const queueByCharacterId = new Map(queueRows.map((row) => [String(row.characterId), row]));
    const now = new Date();
    const operations: any[] = [];
    let skippedActive = 0;

    for (const characterRow of characterRows) {
      const queueRow = queueByCharacterId.get(String(characterRow._id));
      if (queueRow?.status === "in_progress") {
        skippedActive += 1;
        continue;
      }

      const character = {
        ...characterRow,
        ...resolveBlizzardCharacterIdentity(characterRow, latestParticipationByCharacterId.get(String(characterRow._id))),
      };
      operations.push({
        updateOne: {
          filter: {
            characterId: character._id,
            signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
            ...(queueRow ? { status: { $ne: "in_progress" } } : {}),
          },
          update: {
            $set: {
              wclCanonicalCharacterId: character.wclCanonicalCharacterId,
              name: character.name,
              realm: character.realm,
              region: character.region,
              classID: character.classID,
              snapshotKey: buildCharacterAchievementSnapshotKey(character),
              status: "pending",
              priority,
              attempts: 0,
              maxAttempts: DEFAULT_MAX_ATTEMPTS,
              nextAttemptAt: now,
              httpStatus: null,
              errorCode: null,
              isPermanentError: false,
              completionReason: null,
              lastError: null,
              lastErrorAt: null,
              startedAt: null,
              completedAt: null,
              lastActivityAt: now,
            },
            $setOnInsert: {
              characterId: character._id,
              signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
            },
          },
          upsert: !queueRow,
        },
      });
    }

    let queued = 0;
    let updated = 0;
    for (let index = 0; index < operations.length; index += 1000) {
      const result = await CharacterAchievementFetchQueue.bulkWrite(operations.slice(index, index + 1000), { ordered: false });
      queued += result.upsertedCount ?? 0;
      updated += result.modifiedCount ?? 0;
    }

    return {
      candidates: characterRows.length,
      scheduled: operations.length,
      queued,
      updated,
      skippedActive,
    };
  }

  async enqueueMissingItems(options: { refreshExistingQueue?: boolean; refreshAll?: boolean } = {}): Promise<CharacterAchievementBackfillEnqueueResult> {
    const [characterRows, latestParticipationRows] = await Promise.all([
      Character.find({})
        .select("_id wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
        .lean<Array<Pick<ICharacter, "_id" | "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "blizzardIdentityOverride">>>(),
      CharacterRaidParticipation.aggregate<{
        _id: mongoose.Types.ObjectId;
        name: string;
        realm: string;
        region: string;
        observedAt: Date;
      }>([
        { $sort: { lastSeenAt: -1, zoneId: -1, _id: -1 } },
        {
          $group: {
            _id: "$characterId",
            name: { $first: "$characterName" },
            realm: { $first: "$characterRealm" },
            region: { $first: "$characterRegion" },
            observedAt: { $first: "$lastSeenAt" },
          },
        },
      ]).allowDiskUse(true),
    ]);
    const latestParticipationByCharacterId = new Map(latestParticipationRows.map((row) => [String(row._id), row]));
    const characters = characterRows.map((character) => ({
      ...character,
      ...resolveBlizzardCharacterIdentity(character, latestParticipationByCharacterId.get(String(character._id))),
    }));

    const characterIds = characters.map((character) => character._id);
    const [fingerprints, raidAchievementSummaries, queueItems] = await Promise.all([
      CharacterAchievementFingerprint.find({
        characterId: { $in: characterIds },
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      })
        .select("characterId")
        .lean<Array<Pick<ICharacterAchievementFingerprint, "characterId">>>(),
      CharacterRaidAchievementSummary.find({
        characterId: { $in: characterIds },
        version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
      })
        .select("characterId")
        .lean<Array<Pick<ICharacterRaidAchievementSummary, "characterId">>>(),
      CharacterAchievementFetchQueue.find({
        characterId: { $in: characterIds },
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      })
        .select("characterId snapshotKey status")
        .lean<Array<Pick<ICharacterAchievementFetchQueue, "characterId" | "snapshotKey" | "status">>>(),
    ]);

    const fingerprintCharacterIds = new Set(fingerprints.map((fingerprint) => String(fingerprint.characterId)));
    const raidAchievementSummaryCharacterIds = new Set(raidAchievementSummaries.map((summary) => String(summary.characterId)));
    const queueByCharacterId = new Map(queueItems.map((item) => [String(item.characterId), item]));
    const operations: any[] = [];
    let skippedWithFingerprint = 0;
    let skippedWithRaidAchievementSummary = 0;
    let missingRaidAchievementSummary = 0;

    for (const character of characters) {
      const characterId = String(character._id);
      const hasFingerprint = fingerprintCharacterIds.has(characterId);
      const hasRaidAchievementSummary = raidAchievementSummaryCharacterIds.has(characterId);
      if (!hasRaidAchievementSummary) {
        missingRaidAchievementSummary += 1;
      }

      const existingQueueItem = queueByCharacterId.get(characterId);
      const snapshotKey = buildCharacterAchievementSnapshotKey(character);
      const snapshotChanged = Boolean(existingQueueItem && existingQueueItem.snapshotKey !== snapshotKey);
      const isActiveQueueItem = existingQueueItem?.status === "in_progress";
      const missingRequiredData = !hasFingerprint || !hasRaidAchievementSummary;
      const shouldQueueMissingRaidSummary = hasFingerprint && !hasRaidAchievementSummary;
      const shouldQueueNewMissingFingerprint = !hasFingerprint && !existingQueueItem;
      const shouldQueueCompletedButIncomplete = existingQueueItem?.status === "completed" && missingRequiredData;
      const shouldRefreshExistingMissingItem =
        options.refreshExistingQueue === true && missingRequiredData && existingQueueItem?.status !== "pending" && existingQueueItem?.status !== "in_progress";
      const shouldResetExisting =
        !isActiveQueueItem &&
        (options.refreshAll === true || snapshotChanged || shouldQueueMissingRaidSummary || shouldQueueNewMissingFingerprint || shouldQueueCompletedButIncomplete || shouldRefreshExistingMissingItem);

      if (!shouldResetExisting) {
        if (hasFingerprint) {
          skippedWithFingerprint += 1;
        }
        if (hasRaidAchievementSummary) {
          skippedWithRaidAchievementSummary += 1;
        }
        continue;
      }

      operations.push({
        updateOne: {
          filter: {
            characterId: character._id,
            signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
          },
          update: {
            $set: {
              wclCanonicalCharacterId: character.wclCanonicalCharacterId,
              name: character.name,
              realm: character.realm,
              region: character.region,
              classID: character.classID,
              snapshotKey,
              status: "pending",
              priority: DEFAULT_PRIORITY,
              attempts: 0,
              maxAttempts: DEFAULT_MAX_ATTEMPTS,
              nextAttemptAt: new Date(),
              httpStatus: null,
              errorCode: null,
              isPermanentError: false,
              completionReason: null,
              lastError: null,
              lastErrorAt: null,
              startedAt: null,
              completedAt: null,
              lastActivityAt: new Date(),
            },
            $setOnInsert: {
              characterId: character._id,
              signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
            },
          },
          upsert: true,
        },
      });
    }

    const scheduled = operations.length;
    let queued = 0;
    let updated = 0;
    const batchSize = 1000;
    for (let index = 0; index < operations.length; index += batchSize) {
      const result = await CharacterAchievementFetchQueue.bulkWrite(operations.slice(index, index + batchSize), { ordered: false });
      queued += result.upsertedCount ?? 0;
      updated += result.modifiedCount ?? 0;
    }

    const existing = characters.length - scheduled;
    logger.info(
      `[CharacterAchievementBackfill] Enqueue complete: candidates=${characters.length}, queued=${queued}, existing=${existing}, updated=${updated}, skippedWithFingerprint=${skippedWithFingerprint}, skippedWithRaidAchievementSummary=${skippedWithRaidAchievementSummary}, missingRaidAchievementSummary=${missingRaidAchievementSummary}, refreshAll=${options.refreshAll === true}`,
    );

    return {
      candidates: characters.length,
      queued,
      existing,
      updated,
      skippedWithFingerprint,
      skippedWithRaidAchievementSummary,
      missingRaidAchievementSummary,
    };
  }

  async getStatus(): Promise<CharacterAchievementBackfillStatusResponse> {
    const [queueRows, recentFailures, dbCurrentItem, fingerprintCount, raidAchievementSummaryCount, raidAchievementTargets, tokenCount, matchRows, groupCount] = await Promise.all([
      CharacterAchievementFetchQueue.aggregate<{ _id: CharacterAchievementFetchStatus; count: number }>([
        { $match: { signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      CharacterAchievementFetchQueue.find({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        status: { $in: ["failed", "not_found"] },
      })
        .sort({ lastErrorAt: -1, completedAt: -1 })
        .limit(10)
        .lean<ICharacterAchievementFetchQueue[]>(),
      CharacterAchievementFetchQueue.findOne({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        status: "in_progress",
      })
        .sort({ lastActivityAt: -1 })
        .lean<ICharacterAchievementFetchQueue>(),
      CharacterAchievementFingerprint.countDocuments({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION }),
      CharacterRaidAchievementSummary.countDocuments({ version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION }),
      this.getFeaturedAchievementTargets(),
      CharacterAchievementToken.countDocuments({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION }),
      CharacterAccountMatch.aggregate<{ _id: CharacterAccountMatchConfidence; count: number }>([
        { $match: { signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION } },
        { $group: { _id: "$confidence", count: { $sum: 1 } } },
      ]),
      CharacterAccountGroup.countDocuments({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION }),
    ]);

    const queue = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      notFound: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      terminal: 0,
    };

    for (const row of queueRows) {
      if (row._id === "pending") queue.pending = row.count;
      if (row._id === "in_progress") queue.inProgress = row.count;
      if (row._id === "completed") queue.completed = row.count;
      if (row._id === "not_found") queue.notFound = row.count;
      if (row._id === "skipped") queue.skipped = row.count;
      if (row._id === "failed") queue.failed = row.count;
      queue.total += row.count;
    }
    queue.terminal = queue.completed + queue.notFound + queue.skipped + queue.failed;

    const matches = {
      high: 0,
      medium: 0,
      total: 0,
    };
    for (const row of matchRows) {
      if (row._id === "high") matches.high = row.count;
      if (row._id === "medium") matches.medium = row.count;
      matches.total += row.count;
    }

    return {
      processor: {
        isRunning: this.isRunning,
        isWaitingForRateLimit: this.isWaitingForRateLimit,
        currentItem: this.currentItem ?? (this.isRunning && dbCurrentItem ? summarizeQueueItem(dbCurrentItem) : null),
        lastMessage: this.lastMessage,
        startedAt: this.startedAt,
      },
      queue,
      fingerprints: fingerprintCount,
      tokens: tokenCount,
      matches,
      groups: groupCount,
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      signalAchievementCount: CHARACTER_ACCOUNT_SIGNAL_ACHIEVEMENT_ID_SET.size,
      raidAchievementSummaryVersion: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
      raidAchievementTargetCount: raidAchievementTargets.length,
      raidAchievementSummaries: raidAchievementSummaryCount,
      recentFailures: recentFailures.map((item) => summarizeQueueItem(item)),
      updatedAt: new Date(),
    };
  }

  async rebuildAccountGroups(): Promise<CharacterAccountGroupRebuildResult> {
    const [highConfidenceEdges, manualEdges, continuityLinks] = await Promise.all([
      CharacterAccountMatch.find({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        confidence: "high",
      })
        .select("characterAId characterBId score")
        .lean<Array<{ characterAId: mongoose.Types.ObjectId; characterBId: mongoose.Types.ObjectId; score: number }>>(),
      CharacterAccountManualEdge.find({})
        .select("characterAId characterBId")
        .lean<Array<{ characterAId: mongoose.Types.ObjectId; characterBId: mongoose.Types.ObjectId }>>(),
      CharacterContinuityLink.find({})
        .select("sourceCharacterId targetCharacterId")
        .lean<Array<{ sourceCharacterId: mongoose.Types.ObjectId; targetCharacterId: mongoose.Types.ObjectId }>>(),
    ]);
    const continuityGraph = buildCharacterContinuityGraph(continuityLinks);

    const parent = new Map<string, string>();
    const find = (id: string): string => {
      const current = parent.get(id);
      if (!current) {
        parent.set(id, id);
        return id;
      }
      if (current === id) return id;
      const root = find(current);
      parent.set(id, root);
      return root;
    };
    const union = (a: string, b: string) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootB, rootA);
    };

    for (const edge of highConfidenceEdges) {
      union(continuityGraph.resolveRoot(edge.characterAId), continuityGraph.resolveRoot(edge.characterBId));
    }
    for (const edge of manualEdges) {
      union(continuityGraph.resolveRoot(edge.characterAId), continuityGraph.resolveRoot(edge.characterBId));
    }

    const components = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const root = find(id);
      const component = components.get(root) ?? [];
      component.push(id);
      components.set(root, component);
    }

    const groupedComponents = [...components.values()].filter((ids) => ids.length > 1);
    const groupedCharacterIds = [...new Set(groupedComponents.flat())];
    const characters =
      groupedCharacterIds.length > 0
        ? await Character.find({ _id: { $in: groupedCharacterIds } })
            .select("_id name realm region classID guildName guildRealm lastMythicSeenAt")
            .lean<Array<Pick<ICharacter, "_id" | "name" | "realm" | "region" | "classID" | "guildName" | "guildRealm" | "lastMythicSeenAt">>>()
        : [];
    const reportSourceCharacterIds = [
      ...new Set(groupedCharacterIds.flatMap((characterId) => continuityGraph.getMemberIds(characterId))),
    ];
    const reportCountRows =
      groupedCharacterIds.length > 0
        ? await CharacterRaidParticipation.aggregate<{ _id: mongoose.Types.ObjectId; reportCount: number }>([
            { $match: { characterId: { $in: reportSourceCharacterIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
            { $group: { _id: "$characterId", reportCount: { $sum: "$reportCount" } } },
          ])
        : [];

    const characterById = new Map(characters.map((character) => [String(character._id), character]));
    const reportCountByCharacterId = new Map<string, number>();
    for (const row of reportCountRows) {
      const rootId = continuityGraph.resolveRoot(row._id);
      reportCountByCharacterId.set(rootId, (reportCountByCharacterId.get(rootId) ?? 0) + row.reportCount);
    }
    const edgeScoresByPair = new Map<string, number>();
    for (const edge of highConfidenceEdges) {
      const characterAId = continuityGraph.resolveRoot(edge.characterAId);
      const characterBId = continuityGraph.resolveRoot(edge.characterBId);
      if (characterAId === characterBId) continue;
      const key = createCharacterAccountPairKey(characterAId, characterBId);
      edgeScoresByPair.set(key, edge.score);
    }
    const manualEdgePairs = new Set(
      manualEdges
        .map((edge) => [continuityGraph.resolveRoot(edge.characterAId), continuityGraph.resolveRoot(edge.characterBId)] as const)
        .filter(([characterAId, characterBId]) => characterAId !== characterBId)
        .map(([characterAId, characterBId]) => createCharacterAccountPairKey(characterAId, characterBId)),
    );

    const operations: any[] = [];
    const activeGroupKeys: string[] = [];
    let matchedCharacters = 0;

    for (const component of groupedComponents) {
      const sortedIds = [...component].sort();
      const members = sortedIds
        .map((id) => characterById.get(id))
        .filter((character): character is NonNullable<typeof character> => Boolean(character))
        .sort((a, b) => {
          const lastSeenA = a.lastMythicSeenAt ? new Date(a.lastMythicSeenAt).getTime() : 0;
          const lastSeenB = b.lastMythicSeenAt ? new Date(b.lastMythicSeenAt).getTime() : 0;
          return lastSeenB - lastSeenA || a.name.localeCompare(b.name);
        });

      if (members.length <= 1) continue;

      const memberIds = members.map((member) => String(member._id));
      const scores: number[] = [];
      let edgeCount = 0;
      for (let i = 0; i < memberIds.length; i++) {
        for (let j = i + 1; j < memberIds.length; j++) {
          const pairKey = createCharacterAccountPairKey(memberIds[i], memberIds[j]);
          const score = edgeScoresByPair.get(pairKey);
          if (typeof score === "number") scores.push(score);
          if (typeof score === "number" || manualEdgePairs.has(pairKey)) edgeCount += 1;
        }
      }

      const groupKey = sortedIds.join(":");
      const primaryMember = [...members].sort((a, b) => {
        const reportDiff = (reportCountByCharacterId.get(String(b._id)) ?? 0) - (reportCountByCharacterId.get(String(a._id)) ?? 0);
        if (reportDiff !== 0) return reportDiff;
        const lastSeenA = a.lastMythicSeenAt ? new Date(a.lastMythicSeenAt).getTime() : 0;
        const lastSeenB = b.lastMythicSeenAt ? new Date(b.lastMythicSeenAt).getTime() : 0;
        return lastSeenB - lastSeenA || a.name.localeCompare(b.name);
      })[0];
      const totalReportCount = members.reduce((total, member) => total + (reportCountByCharacterId.get(String(member._id)) ?? 0), 0);
      activeGroupKeys.push(groupKey);
      matchedCharacters += members.length;

      operations.push({
        updateOne: {
          filter: {
            signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
            groupKey,
          },
          update: {
            $set: {
              slug: primaryMember ? this.buildAccountSlug(primaryMember.name, groupKey) : this.buildAccountSlug("account", groupKey),
              displayName: primaryMember?.name ?? "Account",
              primaryCharacterId: primaryMember?._id ?? null,
              characterIds: members.map((member) => member._id),
              members: members.map((member) => ({
                characterId: member._id,
                name: member.name,
                realm: member.realm,
                region: member.region,
                classID: member.classID,
                guildName: member.guildName ?? null,
                guildRealm: member.guildRealm ?? null,
                lastMythicSeenAt: member.lastMythicSeenAt ?? null,
                reportCount: reportCountByCharacterId.get(String(member._id)) ?? 0,
              })),
              edgeCount,
              totalReportCount,
              minScore: scores.length > 0 ? Math.min(...scores) : 0,
              maxScore: scores.length > 0 ? Math.max(...scores) : 0,
              avgScore: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
              generatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      await CharacterAccountGroup.bulkWrite(operations, { ordered: false });
      await CharacterAccountGroup.deleteMany({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        groupKey: { $nin: activeGroupKeys },
      });
    } else {
      await CharacterAccountGroup.deleteMany({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION });
    }

    await Promise.all([cacheService.invalidatePattern(/^characters:profile:/), cacheService.invalidatePattern(/^accounts:/)]);
    logger.info(
      `[CharacterAchievementBackfill] Rebuilt account groups: groups=${operations.length}, matchedCharacters=${matchedCharacters}, highConfidenceEdges=${highConfidenceEdges.length}, manualEdges=${manualEdges.length}`,
    );

    return {
      groups: operations.length,
      matchedCharacters,
      highConfidenceEdges: highConfidenceEdges.length,
      manualEdges: manualEdges.length,
    };
  }

  private async processLoop(): Promise<void> {
    let processedThisRun = 0;
    let taskId = "";

    try {
      taskId = await taskTracker.start(TASK_NAME, { signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION });

      while (this.isRunning) {
        const item = await CharacterAchievementFetchQueue.findOneAndUpdate(
          {
            signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
            status: "pending",
            nextAttemptAt: { $lte: new Date() },
          },
          {
            $set: {
              status: "in_progress",
              startedAt: new Date(),
              lastActivityAt: new Date(),
              completionReason: null,
            },
            $inc: { attempts: 1 },
          },
          {
            sort: { priority: 1, nextAttemptAt: 1, createdAt: 1 },
            new: true,
          },
        );

        if (!item) {
          const nextPendingItem = await CharacterAchievementFetchQueue.findOne({
            signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
            status: "pending",
          })
            .sort({ nextAttemptAt: 1 })
            .select("nextAttemptAt")
            .lean<Pick<ICharacterAchievementFetchQueue, "nextAttemptAt">>();

          if (nextPendingItem) {
            const waitMs = Math.max(1000, Math.min(60000, nextPendingItem.nextAttemptAt.getTime() - Date.now()));
            this.lastMessage = `No due achievement fetches; next retry is due at ${nextPendingItem.nextAttemptAt.toISOString()}`;
            await this.sleep(waitMs);
            continue;
          }

          this.lastMessage = `Character achievement backfill complete; processed ${processedThisRun} items this run`;
          logger.info(`[CharacterAchievementBackfill] No pending items remain; processed ${processedThisRun} items this run`);
          await this.rebuildAccountGroups();
          break;
        }

        this.currentItem = summarizeQueueItem(item);
        processedThisRun += 1;

        try {
          logger.info(`[CharacterAchievementBackfill] Processing ${item.name}-${item.realm}, attempt ${item.attempts}/${item.maxAttempts}`);
          const outcome = await this.processItem(item);

          await CharacterAchievementFetchQueue.findByIdAndUpdate(item._id, {
            $set: {
              status: outcome.status,
              httpStatus: outcome.httpStatus ?? null,
              errorCode: outcome.errorCode ?? null,
              isPermanentError: outcome.isPermanentError,
              completionReason: outcome.reason,
              completedAt: new Date(),
              lastActivityAt: new Date(),
              lastError: outcome.status === "completed" ? null : outcome.reason,
              lastErrorAt: outcome.status === "completed" ? null : new Date(),
            },
          });

          logger.info(`[CharacterAchievementBackfill] ${outcome.status} ${item.name}-${item.realm}: ${outcome.reason}`);
        } catch (error) {
          await this.handleItemError(item, error);
        } finally {
          this.currentItem = null;
        }

        if (processedThisRun % PROCESS_LOG_INTERVAL === 0) {
          const status = await this.getStatus();
          logger.info(
            `[CharacterAchievementBackfill] Progress: runProcessed=${processedThisRun}, pending=${status.queue.pending}, completed=${status.queue.completed}, notFound=${status.queue.notFound}, failed=${status.queue.failed}, groups=${status.groups}`,
          );
        }
      }

      await taskTracker.complete(taskId, { processedThisRun });
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isRunning = false;
      this.isWaitingForRateLimit = false;
      this.currentItem = null;
    }
  }

  private async processItem(item: ICharacterAchievementFetchQueue): Promise<ProcessOutcome> {
    await this.waitForRateSlot();
    const summary = await this.fetchAchievementSummary(item.region, item.realm, item.name);
    const fingerprint = this.extractFingerprintSignals(summary);
    const featuredAchievementTargets = await this.getFeaturedAchievementTargets();
    const raidAchievements = extractCompletedFeaturedAchievements(summary, featuredAchievementTargets);
    const raidAchievementCounts = countFeaturedAchievements(raidAchievements);
    const signalTokens = fingerprint.signals.map((signal) => this.toToken(signal));
    const oldFingerprint = await CharacterAchievementFingerprint.findOne({
      characterId: item.characterId,
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
    }).lean<ICharacterAchievementFingerprint>();

    await CharacterAchievementFingerprint.findOneAndUpdate(
      {
        characterId: item.characterId,
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      },
      {
        $set: {
          wclCanonicalCharacterId: item.wclCanonicalCharacterId,
          name: item.name,
          realm: item.realm,
          region: item.region,
          classID: item.classID,
          achievementPoints: fingerprint.achievementPoints,
          totalQuantity: fingerprint.totalQuantity,
          signals: fingerprint.signals,
          signalTokens,
          signalCount: signalTokens.length,
          fetchedAt: new Date(),
        },
        $setOnInsert: {
          characterId: item.characterId,
          signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        },
      },
      { upsert: true },
    );

    await CharacterRaidAchievementSummary.findOneAndUpdate(
      {
        characterId: item.characterId,
        version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
      },
      {
        $set: {
          wclCanonicalCharacterId: item.wclCanonicalCharacterId,
          name: item.name,
          realm: item.realm,
          region: item.region,
          classID: item.classID,
          achievementPoints: fingerprint.achievementPoints,
          totalQuantity: fingerprint.totalQuantity,
          achievements: raidAchievements,
          cuttingEdgeCount: raidAchievementCounts.cuttingEdgeCount,
          aheadOfTheCurveCount: raidAchievementCounts.aheadOfTheCurveCount,
          fetchedAt: new Date(),
        },
        $setOnInsert: {
          characterId: item.characterId,
          version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
        },
      },
      { upsert: true },
    );

    await this.updateTokenIndex(item.characterId, oldFingerprint?.signalTokens ?? [], signalTokens);
    await this.updateMatchesForCharacter(item.characterId, signalTokens, fingerprint.signals);

    return {
      status: "completed",
      reason: `Stored ${signalTokens.length}/${CHARACTER_ACCOUNT_SIGNAL_ACHIEVEMENT_ID_SET.size} signal achievements and ${raidAchievementCounts.totalCount}/${featuredAchievementTargets.length} raid achievements`,
      httpStatus: 200,
      errorCode: null,
      isPermanentError: false,
    };
  }

  private async handleItemError(item: ICharacterAchievementFetchQueue, error: unknown): Promise<void> {
    const apiError =
      error instanceof BlizzardApiError
        ? error
        : new BlizzardApiError(error instanceof Error ? error.message : String(error), {
            status: null,
            errorCode: "unexpected_error",
            retryable: true,
            permanent: false,
          });
    const attempts = item.attempts || 1;
    const maxAttempts = item.maxAttempts || DEFAULT_MAX_ATTEMPTS;

    if (apiError.status === 404) {
      await CharacterAchievementFetchQueue.findByIdAndUpdate(item._id, {
        $set: {
          status: "not_found",
          httpStatus: apiError.status,
          errorCode: apiError.errorCode,
          isPermanentError: true,
          completionReason: "Character achievements not found; character may have been renamed, transferred, or deleted",
          lastError: apiError.message.slice(0, 2000),
          lastErrorAt: new Date(),
          completedAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
      logger.warn(`[CharacterAchievementBackfill] Character not found for ${item.name}-${item.realm}: ${apiError.message}`);
      return;
    }

    if (apiError.permanent || !apiError.retryable || attempts >= maxAttempts) {
      await CharacterAchievementFetchQueue.findByIdAndUpdate(item._id, {
        $set: {
          status: "failed",
          httpStatus: apiError.status,
          errorCode: apiError.errorCode,
          isPermanentError: apiError.permanent,
          completionReason: apiError.permanent ? "Permanent Blizzard API failure" : `Failed after ${attempts} attempts`,
          lastError: apiError.message.slice(0, 2000),
          lastErrorAt: new Date(),
          completedAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
      logger.error(`[CharacterAchievementBackfill] Failed ${item.name}-${item.realm} after ${attempts}/${maxAttempts}: ${apiError.message}`);
      return;
    }

    const retryAt = new Date(Date.now() + this.getRetryDelayMs(attempts));
    await CharacterAchievementFetchQueue.findByIdAndUpdate(item._id, {
      $set: {
        status: "pending",
        httpStatus: apiError.status,
        errorCode: apiError.errorCode,
        isPermanentError: false,
        completionReason: `Retry queued after attempt ${attempts}`,
        lastError: apiError.message.slice(0, 2000),
        lastErrorAt: new Date(),
        nextAttemptAt: retryAt,
        lastActivityAt: new Date(),
      },
    });
    logger.warn(`[CharacterAchievementBackfill] Error processing ${item.name}-${item.realm}; retrying at ${retryAt.toISOString()}: ${apiError.message}`);
  }

  private async fetchAchievementSummary(region: string, realm: string, name: string, retryUnauthorized = true): Promise<BlizzardAchievementSummaryResponse> {
    const token = await this.getAccessToken();
    const normalizedRegion = region.toLowerCase();
    const baseUrl = this.regionApiUrls[normalizedRegion];
    if (!baseUrl) {
      throw new BlizzardApiError(`Unsupported Blizzard region: ${region}`, {
        status: null,
        errorCode: "unsupported_region",
        retryable: false,
        permanent: true,
      });
    }

    const realmSlug = normalizeRealmSlug(realm);
    const characterName = encodeURIComponent(name.toLowerCase());
    const namespace = `profile-${normalizedRegion}`;
    const url = `${baseUrl}/profile/wow/character/${encodeURIComponent(realmSlug)}/${characterName}/achievements?namespace=${encodeURIComponent(namespace)}&locale=en_US`;

    logger.info(`[API REQUEST] CharacterAchievementBackfill - GET ${baseUrl}/profile/wow/character/${realmSlug}/${name.toLowerCase()}/achievements`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 && retryUnauthorized) {
      await AuthToken.deleteOne({ service: "blizzard" }).catch(() => undefined);
      logger.warn("[CharacterAchievementBackfill] Blizzard token was rejected; refreshing token and retrying request once");
      return this.fetchAchievementSummary(region, realm, name, false);
    }

    if (!response.ok) {
      throw await this.toBlizzardApiError(response);
    }

    return (await response.json()) as BlizzardAchievementSummaryResponse;
  }

  private async getFeaturedAchievementTargets(): Promise<FeaturedAchievementTarget[]> {
    if (this.featuredAchievementTargets) {
      return this.featuredAchievementTargets;
    }

    const achievements = await Achievement.find({})
      .select("id name -_id")
      .lean<Array<{ id: number; name: string }>>();
    this.featuredAchievementTargets = buildFeaturedAchievementTargets(achievements);

    if (this.featuredAchievementTargets.length === 0) {
      logger.warn("[CharacterAchievementBackfill] No Cutting Edge or Ahead of the Curve achievements found in the Blizzard achievement catalog");
    }

    return this.featuredAchievementTargets;
  }

  private extractFingerprintSignals(summary: BlizzardAchievementSummaryResponse): {
    achievementPoints: number;
    totalQuantity: number;
    signals: ICharacterAchievementSignal[];
  } {
    const signals: ICharacterAchievementSignal[] = [];

    for (const achievement of summary.achievements ?? []) {
      const achievementId = toFiniteNumber(achievement.id, 0);
      const completedTimestamp = toFiniteNumber(achievement.completed_timestamp, 0);
      if (!CHARACTER_ACCOUNT_SIGNAL_ACHIEVEMENT_ID_SET.has(achievementId) || completedTimestamp <= 0) {
        continue;
      }
      signals.push({ achievementId, completedTimestamp });
    }

    signals.sort((a, b) => a.achievementId - b.achievementId);

    return {
      achievementPoints: toFiniteNumber(summary.total_points, 0),
      totalQuantity: toFiniteNumber(summary.total_quantity, 0),
      signals,
    };
  }

  private async updateTokenIndex(characterId: mongoose.Types.ObjectId, oldTokens: string[], newTokens: string[]): Promise<void> {
    const oldTokenSet = new Set(oldTokens);
    const newTokenSet = new Set(newTokens);
    const tokensToRemove = [...oldTokenSet].filter((token) => !newTokenSet.has(token));
    const affectedTokens = [...new Set([...tokensToRemove, ...newTokenSet])];

    const operations: any[] = [];
    for (const token of tokensToRemove) {
      operations.push({
        updateOne: {
          filter: { signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION, token },
          update: {
            $pull: { characterIds: characterId },
          },
        },
      });
    }

    for (const token of newTokenSet) {
      const parsed = this.parseToken(token);
      operations.push({
        updateOne: {
          filter: { signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION, token },
          update: {
            $setOnInsert: {
              signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
              token,
              achievementId: parsed.achievementId,
              completedTimestamp: parsed.completedTimestamp,
              characterCount: 0,
            },
            $addToSet: { characterIds: characterId },
          },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      await CharacterAchievementToken.bulkWrite(operations, { ordered: false });
    }

    if (affectedTokens.length > 0) {
      await this.repairTokenCounts(affectedTokens);
      await CharacterAchievementToken.deleteMany({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        token: { $in: affectedTokens },
        characterCount: { $lte: 0 },
      });
    }
  }

  private async repairTokenCounts(tokens: string[]): Promise<void> {
    const tokenDocs = await CharacterAchievementToken.find({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      token: { $in: tokens },
    })
      .select("_id characterIds")
      .lean<Array<{ _id: mongoose.Types.ObjectId; characterIds: mongoose.Types.ObjectId[] }>>();

    if (tokenDocs.length === 0) return;

    await CharacterAchievementToken.bulkWrite(
      tokenDocs.map((tokenDoc) => ({
        updateOne: {
          filter: { _id: tokenDoc._id },
          update: { $set: { characterCount: tokenDoc.characterIds.length } },
        },
      })),
      { ordered: false },
    );
  }

  private async updateMatchesForCharacter(characterId: mongoose.Types.ObjectId, signalTokens: string[], signals: ICharacterAchievementSignal[]): Promise<void> {
    const commonTokenMaxCharacterCount = this.getCommonTokenMaxCharacterCount();
    const tokenDocs = await CharacterAchievementToken.find({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      token: { $in: signalTokens },
      characterCount: { $lte: commonTokenMaxCharacterCount },
    })
      .select("token characterIds")
      .lean<Array<{ token: string; characterIds: mongoose.Types.ObjectId[] }>>();

    const characterIdString = String(characterId);
    const exactTokensByCandidate = new Map<string, Set<string>>();

    for (const tokenDoc of tokenDocs) {
      for (const candidateId of tokenDoc.characterIds ?? []) {
        const candidateIdString = String(candidateId);
        if (candidateIdString === characterIdString) continue;
        const tokenSet = exactTokensByCandidate.get(candidateIdString) ?? new Set<string>();
        tokenSet.add(tokenDoc.token);
        exactTokensByCandidate.set(candidateIdString, tokenSet);
      }
    }

    if (exactTokensByCandidate.size === 0) {
      await CharacterAccountMatch.deleteMany({
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
        $or: [{ characterAId: characterId }, { characterBId: characterId }],
      });
      return;
    }

    const candidateIds = [...exactTokensByCandidate.keys()];
    const candidateFingerprints = await CharacterAchievementFingerprint.find({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      characterId: { $in: candidateIds },
    })
      .select("characterId signals signalTokens")
      .lean<Array<Pick<ICharacterAchievementFingerprint, "characterId" | "signals" | "signalTokens">>>();

    const ownAchievementIds = new Set(signals.map((signal) => signal.achievementId));
    const keepMatchIds = new Set<string>();
    const operations: any[] = [];

    for (const candidate of candidateFingerprints) {
      const candidateId = String(candidate.characterId);
      const exactTokens = exactTokensByCandidate.get(candidateId);
      if (!exactTokens || exactTokens.size === 0) continue;

      const candidateAchievementIds = new Set((candidate.signals ?? []).map((signal) => signal.achievementId));
      const comparableSignals = [...ownAchievementIds].filter((achievementId) => candidateAchievementIds.has(achievementId)).length;
      const exactTokenMatches = exactTokens.size;
      const exactRate = comparableSignals > 0 ? exactTokenMatches / comparableSignals : 0;
      const confidence = this.getMatchConfidence(exactTokenMatches, exactRate);

      if (!confidence) {
        continue;
      }

      const [characterAId, characterBId] = orderCharacterAccountPairIds(characterIdString, candidateId);
      const pairKey = createCharacterAccountPairKey(characterAId, characterBId);
      keepMatchIds.add(pairKey);

      const score = Math.min(100, exactRate * 60 + Math.min(40, exactTokenMatches * 2));
      operations.push({
        updateOne: {
          filter: {
            signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
            characterAId,
            characterBId,
          },
          update: {
            $set: {
              score,
              confidence,
              exactTokenMatches,
              comparableSignals,
              exactRate,
              matchedTokenSamples: [...exactTokens].slice(0, MATCH_SAMPLE_LIMIT),
              evaluatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      await CharacterAccountMatch.bulkWrite(operations, { ordered: false });
    }

    const existingMatches = await CharacterAccountMatch.find({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      $or: [{ characterAId: characterId }, { characterBId: characterId }],
    })
      .select("_id characterAId characterBId")
      .lean<Array<{ _id: mongoose.Types.ObjectId; characterAId: mongoose.Types.ObjectId; characterBId: mongoose.Types.ObjectId }>>();

    const staleMatchIds = existingMatches
      .filter((match) => !keepMatchIds.has(createCharacterAccountPairKey(String(match.characterAId), String(match.characterBId))))
      .map((match) => match._id);

    if (staleMatchIds.length > 0) {
      await CharacterAccountMatch.deleteMany({ _id: { $in: staleMatchIds } });
    }
  }

  private async resetInterruptedItems(): Promise<number> {
    const result = await CharacterAchievementFetchQueue.updateMany(
      { signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION, status: "in_progress" },
      {
        $set: {
          status: "pending",
          lastActivityAt: new Date(),
          lastError: "Reset after interrupted achievement backfill run",
          lastErrorAt: new Date(),
        },
      },
    );

    if ((result.modifiedCount ?? 0) > 0) {
      logger.warn(`[CharacterAchievementBackfill] Reset ${result.modifiedCount} interrupted in-progress items back to pending`);
    }

    return result.modifiedCount ?? 0;
  }

  private async getAccessToken(): Promise<string> {
    const existingToken = await AuthToken.findOne({ service: "blizzard" });
    if (existingToken && existingToken.expiresAt > new Date()) {
      return existingToken.accessToken;
    }

    const clientId = process.env.BLIZZARD_CLIENT_ID;
    const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new BlizzardApiError("Blizzard API credentials not found in environment variables", {
        status: null,
        errorCode: "missing_credentials",
        retryable: false,
        permanent: true,
      });
    }

    logger.info("[CharacterAchievementBackfill] Fetching new Blizzard OAuth token");
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(this.oauthUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      throw await this.toBlizzardApiError(response);
    }

    const data = (await response.json()) as BlizzardTokenResponse;
    const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);
    await AuthToken.findOneAndUpdate(
      { service: "blizzard" },
      {
        service: "blizzard",
        accessToken: data.access_token,
        tokenType: data.token_type,
        expiresAt,
      },
      { upsert: true },
    );

    return data.access_token;
  }

  private async toBlizzardApiError(response: Response): Promise<BlizzardApiError> {
    const body = await response.text().catch(() => "");
    const message = `Blizzard API request failed with status ${response.status}: ${response.statusText}${body ? ` - ${body.slice(0, 500)}` : ""}`;

    if (response.status === 404) {
      return new BlizzardApiError(message, { status: response.status, errorCode: "not_found", retryable: false, permanent: true });
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return new BlizzardApiError(message, { status: response.status, errorCode: `http_${response.status}`, retryable: false, permanent: true });
    }
    if (response.status === 429 || response.status >= 500) {
      return new BlizzardApiError(message, { status: response.status, errorCode: `http_${response.status}`, retryable: true, permanent: false });
    }
    return new BlizzardApiError(message, { status: response.status, errorCode: `http_${response.status}`, retryable: true, permanent: false });
  }

  private async waitForRateSlot(): Promise<void> {
    const maxCallsPerHour = this.getMaxCallsPerHour();
    const minIntervalMs = Math.ceil(3600000 / maxCallsPerHour);
    const elapsedMs = Date.now() - this.lastBlizzardRequestAt;
    const waitMs = Math.max(0, minIntervalMs - elapsedMs);

    if (waitMs > 0) {
      this.isWaitingForRateLimit = true;
      this.lastMessage = `Waiting ${waitMs}ms to stay under ${maxCallsPerHour}/hour Blizzard API rate`;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.isWaitingForRateLimit = false;
    this.lastBlizzardRequestAt = Date.now();
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getMaxCallsPerHour(): number {
    const parsed = parseInt(process.env.BLIZZARD_CHARACTER_ACHIEVEMENT_MAX_PER_HOUR || `${DEFAULT_MAX_CALLS_PER_HOUR}`, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, DEFAULT_MAX_CALLS_PER_HOUR) : DEFAULT_MAX_CALLS_PER_HOUR;
  }

  private getCommonTokenMaxCharacterCount(): number {
    const parsed = parseInt(process.env.CHARACTER_ACCOUNT_COMMON_TOKEN_MAX_CHARACTER_COUNT || `${DEFAULT_COMMON_TOKEN_MAX_CHARACTER_COUNT}`, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COMMON_TOKEN_MAX_CHARACTER_COUNT;
  }

  private getRetryDelayMs(attempts: number): number {
    const minutes = Math.min(60, Math.pow(2, Math.max(0, attempts - 1)) * 5);
    return minutes * 60 * 1000;
  }

  private buildAccountSlug(displayName: string, groupKey: string): string {
    const namePart = displayName
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const hash = createHash("sha1").update(groupKey).digest("hex").slice(0, 8);
    return `${namePart || "account"}-${hash}`;
  }

  private toToken(signal: ICharacterAchievementSignal): string {
    return `${signal.achievementId}:${signal.completedTimestamp}`;
  }

  private parseToken(token: string): ICharacterAchievementSignal {
    const [achievementId, completedTimestamp] = token.split(":").map((part) => parseInt(part, 10));
    return { achievementId, completedTimestamp };
  }

  private getMatchConfidence(exactTokenMatches: number, exactRate: number): CharacterAccountMatchConfidence | null {
    if (exactTokenMatches >= HIGH_CONFIDENCE_MIN_EXACT_MATCHES && exactRate >= HIGH_CONFIDENCE_MIN_EXACT_RATE) return "high";
    if (exactTokenMatches >= MEDIUM_CONFIDENCE_MIN_EXACT_MATCHES && exactRate >= MEDIUM_CONFIDENCE_MIN_EXACT_RATE) return "medium";
    return null;
  }

}

const characterAchievementService = new CharacterAchievementService();
export default characterAchievementService;
