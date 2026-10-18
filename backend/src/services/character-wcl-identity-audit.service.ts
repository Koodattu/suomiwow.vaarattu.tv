import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import { CCG_FEATURE_ENABLED } from "../config/ccg";
import Character, { ICharacter } from "../models/Character";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterAchievementFetchQueue from "../models/CharacterAchievementFetchQueue";
import CharacterMediaFetchQueue from "../models/CharacterMediaFetchQueue";
import CharacterWclIdentityAudit, {
  CharacterWclIdentityAuditOutcome,
  CharacterWclIdentityAuditStatus,
  ICharacterWclIdentityAudit,
} from "../models/CharacterWclIdentityAudit";
import { normalizeRealmSlug } from "../utils/realm";
import logger from "../utils/logger";
import cacheService from "./cache.service";
import characterAchievementService from "./character-achievement.service";
import characterContinuityService from "./character-continuity.service";
import characterMediaService from "./character-media.service";
import mythicPlusService from "./mythic-plus.service";
import rateLimitService from "./rate-limit.service";
import taskTracker from "./task-tracker.service";
import wclService from "./warcraftlogs.service";

const TASK_NAME = "Audit WCL Character Identities";
const QUEUE_TASK_NAME = "Queue Unchecked WCL Character Identities";
const ESTIMATED_POINTS_PER_LOOKUP = 1;
const PROCESS_LOG_INTERVAL = 50;
const DEFAULT_NIGHTLY_CANDIDATE_LIMIT = 1000;
const IDENTITY_RECHECK_MS = 24 * 60 * 60 * 1000;
const RECENT_RAIDER_WINDOW_MS = 48 * 60 * 60 * 1000;

interface WclIdentityCharacter {
  id?: unknown;
  canonicalID?: unknown;
  name?: string | null;
  classID?: unknown;
  hidden?: boolean | null;
  server?: {
    slug?: string | null;
    region?: {
      slug?: string | null;
    } | null;
  } | null;
}

interface WclIdentityResponse {
  characterData?: {
    character?: WclIdentityCharacter | null;
  };
}

interface CandidateRow {
  _id: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  classID: number;
  name: string;
  realm: string;
  region: string;
  lastReportSeenAt?: Date | null;
  auditLastActivityAt?: Date;
  auditStatus?: CharacterWclIdentityAuditStatus;
}

type AuditItemSummary = {
  id: string;
  characterId: string;
  expectedWclCanonicalCharacterId: number;
  expectedClassID: number;
  sourceName: string;
  sourceRealm: string;
  sourceRegion: string;
  status: CharacterWclIdentityAuditStatus;
  outcome?: CharacterWclIdentityAuditOutcome | null;
  identityChanged: boolean;
  attempts: number;
  maxAttempts: number;
  wclCharacterId?: number | null;
  wclCanonicalCharacterId?: number | null;
  resolvedName?: string | null;
  resolvedRealm?: string | null;
  resolvedRegion?: string | null;
  resolvedClassID?: number | null;
  completionReason?: string | null;
  lastError?: string | null;
  lastErrorAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastActivityAt: Date;
};

export interface CharacterWclIdentityAuditStatusResponse {
  processor: {
    isRunning: boolean;
    isWaitingForRateLimit: boolean;
    currentItem: AuditItemSummary | null;
    lastMessage: string | null;
  };
  queue: {
    pending: number;
    inProgress: number;
    completed: number;
    skipped: number;
    failed: number;
    total: number;
    resolved: number;
    hidden: number;
    notFound: number;
    classMismatch: number;
    invalidResponse: number;
    identitiesChanged: number;
  };
  recentIssues: AuditItemSummary[];
  updatedAt: Date;
}

export interface CharacterWclIdentityAuditEnqueueResult {
  candidates: number;
  queued: number;
  existing: number;
  requeued: number;
  limit: number | null;
}

interface ProcessOutcome {
  status: "completed" | "skipped";
  outcome: CharacterWclIdentityAuditOutcome;
  reason: string;
  identityChanged: boolean;
  wclCharacterId?: number | null;
  wclCanonicalCharacterId?: number | null;
  resolvedName?: string | null;
  resolvedRealm?: string | null;
  resolvedRegion?: string | null;
  resolvedClassID?: number | null;
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

export function getWclIdentityAuditRetryStatus(attempts: number, maxAttempts: number): "pending" | "failed" {
  return attempts >= maxAttempts ? "failed" : "pending";
}

export function buildUncheckedWclIdentityAuditPipeline(
  auditCollectionName: string,
  achievementQueueCollectionName: string,
  mediaQueueCollectionName: string,
  maxCandidates?: number,
): mongoose.PipelineStage[] {
  const limit = Number.isInteger(maxCandidates) && Number(maxCandidates) > 0 ? Number(maxCandidates) : null;
  return [
    {
      $match: {
        wclCanonicalCharacterId: { $type: "number", $gt: 0 },
        classID: { $type: "number", $gt: 0 },
      },
    },
    {
      $lookup: {
        from: auditCollectionName,
        localField: "_id",
        foreignField: "characterId",
        as: "identityAudit",
      },
    },
    { $match: { "identityAudit.0": { $exists: false } } },
    {
      $lookup: {
        from: achievementQueueCollectionName,
        localField: "_id",
        foreignField: "characterId",
        as: "achievementQueue",
      },
    },
    {
      $lookup: {
        from: mediaQueueCollectionName,
        localField: "_id",
        foreignField: "characterId",
        as: "mediaQueue",
      },
    },
    {
      $match: {
        $or: [
          {
            achievementQueue: {
              $elemMatch: {
                signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
                status: "not_found",
              },
            },
          },
          { mediaQueue: { $elemMatch: { status: "not_found" } } },
        ],
      },
    },
    { $sort: { lastReportSeenAt: -1, _id: 1 } },
    ...(limit ? ([{ $limit: limit }] as mongoose.PipelineStage[]) : []),
    {
      $project: {
        _id: 1,
        wclCanonicalCharacterId: 1,
        classID: 1,
        name: 1,
        realm: 1,
        region: 1,
        lastReportSeenAt: 1,
      },
    },
  ];
}

export function buildRecentRaiderIdentityAuditPipeline(
  auditCollectionName: string,
  characterIds: mongoose.Types.ObjectId[],
  now: Date,
  maxCandidates: number,
): mongoose.PipelineStage[] {
  return [
    { $match: { _id: { $in: characterIds }, wclCanonicalCharacterId: { $gt: 0 }, classID: { $gt: 0 } } },
    { $lookup: { from: auditCollectionName, localField: "_id", foreignField: "characterId", as: "identityAudit" } },
    {
      $match: {
        $or: [
          { "identityAudit.0": { $exists: false } },
          { identityAudit: { $elemMatch: {
            status: { $in: ["completed", "skipped", "failed"] },
            lastActivityAt: { $lte: new Date(now.getTime() - IDENTITY_RECHECK_MS) },
          } } },
        ],
        // Once a redirect and its downstream work completed, only its current
        // character needs checking. Failed/interrupted repairs remain retryable.
        $expr: { $not: [{ $and: [
          { $eq: [{ $arrayElemAt: ["$identityAudit.status", 0] }, "completed"] },
          { $eq: [{ $arrayElemAt: ["$identityAudit.identityChanged", 0] }, true] },
          { $ne: [{ $arrayElemAt: ["$identityAudit.wclCanonicalCharacterId", 0] }, "$wclCanonicalCharacterId"] },
        ] }] },
      },
    },
    { $sort: { "identityAudit.lastActivityAt": 1, lastReportSeenAt: -1, _id: 1 } },
    { $limit: maxCandidates },
    { $project: {
      _id: 1, wclCanonicalCharacterId: 1, classID: 1, name: 1, realm: 1, region: 1, lastReportSeenAt: 1,
      auditLastActivityAt: { $arrayElemAt: ["$identityAudit.lastActivityAt", 0] },
      auditStatus: { $arrayElemAt: ["$identityAudit.status", 0] },
    } },
  ];
}

export function classifyCanonicalWclIdentityResult(
  expected: { classID: number; region: string },
  character: WclIdentityCharacter | null | undefined,
): CharacterWclIdentityAuditOutcome {
  if (!character) return "not_found";

  const classID = toPositiveInteger(character.classID);
  if (classID !== null && classID !== expected.classID) return "class_mismatch";

  const canonicalID = toPositiveInteger(character.canonicalID);
  const characterID = toPositiveInteger(character.id);
  const name = character.name?.trim();
  const realm = character.server?.slug?.trim();
  const region = character.server?.region?.slug?.trim();
  if (classID === null || canonicalID === null || characterID === null || !name || !realm || !region) return "invalid_response";
  if (normalizedText(region) !== normalizedText(expected.region)) return "invalid_response";

  return character.hidden === true ? "hidden" : "resolved";
}

function summarizeItem(item: ICharacterWclIdentityAudit): AuditItemSummary {
  return {
    id: String(item._id),
    characterId: String(item.characterId),
    expectedWclCanonicalCharacterId: item.expectedWclCanonicalCharacterId,
    expectedClassID: item.expectedClassID,
    sourceName: item.sourceName,
    sourceRealm: item.sourceRealm,
    sourceRegion: item.sourceRegion,
    status: item.status,
    outcome: item.outcome,
    identityChanged: item.identityChanged,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    wclCharacterId: item.wclCharacterId,
    wclCanonicalCharacterId: item.wclCanonicalCharacterId,
    resolvedName: item.resolvedName,
    resolvedRealm: item.resolvedRealm,
    resolvedRegion: item.resolvedRegion,
    resolvedClassID: item.resolvedClassID,
    completionReason: item.completionReason,
    lastError: item.lastError,
    lastErrorAt: item.lastErrorAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    lastActivityAt: item.lastActivityAt,
  };
}

export class CharacterWclIdentityAuditService {
  private isRunning = false;
  private isWaitingForRateLimit = false;
  private achievementProcessingNeeded = false;
  private currentItem: AuditItemSummary | null = null;
  private lastMessage: string | null = null;

  async triggerBackfill(options: { maxCandidates?: number; reprocessFailed?: boolean } = {}): Promise<{
    started: boolean;
    enqueue: CharacterWclIdentityAuditEnqueueResult;
    status: CharacterWclIdentityAuditStatusResponse;
  }> {
    await CharacterWclIdentityAudit.createIndexes();
    const enqueue = await this.enqueueUnchecked(options.maxCandidates);

    if (options.reprocessFailed === true) {
      const result = await CharacterWclIdentityAudit.updateMany(
        { status: "failed" },
        {
          $set: {
            status: "pending",
            outcome: null,
            identityChanged: false,
            attempts: 0,
            wclCharacterId: null,
            wclCanonicalCharacterId: null,
            resolvedName: null,
            resolvedRealm: null,
            resolvedRegion: null,
            resolvedClassID: null,
            completionReason: "Failed audit manually queued again",
            completedAt: null,
            lastError: null,
            lastErrorAt: null,
            lastActivityAt: new Date(),
          },
        },
      );
      enqueue.requeued = result.modifiedCount ?? 0;
    }

    const pending = await CharacterWclIdentityAudit.countDocuments({ status: "pending" });
    const started = pending > 0 ? this.startProcessing() : false;
    if (pending === 0) this.lastMessage = "No pending WCL character identity audits";
    return { started, enqueue, status: await this.getStatus() };
  }

  async triggerNightly(): Promise<{
    started: boolean;
    enqueue: CharacterWclIdentityAuditEnqueueResult;
    status: CharacterWclIdentityAuditStatusResponse;
  }> {
    await CharacterWclIdentityAudit.createIndexes();
    const enqueue = await this.enqueueRecentRaiders();
    const pending = await CharacterWclIdentityAudit.countDocuments({ status: "pending" });
    const started = pending > 0 ? this.startProcessing() : false;
    return { started, enqueue, status: await this.getStatus() };
  }

  async enqueueRecentRaiders(maxCandidates = DEFAULT_NIGHTLY_CANDIDATE_LIMIT, now = new Date()): Promise<CharacterWclIdentityAuditEnqueueResult> {
    const limit = Number.isInteger(maxCandidates) && maxCandidates > 0 ? maxCandidates : DEFAULT_NIGHTLY_CANDIDATE_LIMIT;
    // lastReportSeenAt is indexed. Narrow the population before any joins;
    // historical Armory failures belong to the explicit backfill, not this job.
    const recent = await Character.find({ lastReportSeenAt: { $gte: new Date(now.getTime() - RECENT_RAIDER_WINDOW_MS) } })
      .select("_id classID region")
      .lean();
    if (recent.length === 0) return { candidates: 0, queued: 0, existing: 0, requeued: 0, limit };

    const recentById = new Map(recent.map((character) => [String(character._id), character]));
    const candidateIds = new Set(recentById.keys());
    const groups = await CharacterAccountGroup.find({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      characterIds: { $in: recent.map((character) => character._id) },
    }).select("characterIds members.characterId members.classID members.region").lean();
    for (const group of groups) {
      const activeClasses = new Set(group.characterIds.flatMap((id) => {
        const character = recentById.get(String(id));
        return character ? [`${character.classID}:${normalizedText(character.region)}`] : [];
      }));
      for (const member of group.members) {
        if (activeClasses.has(`${member.classID}:${normalizedText(member.region)}`)) {
          candidateIds.add(String(member.characterId));
        }
      }
    }
    // Account membership selects possible old names only. The WCL canonical
    // redirect and continuity checks remain the authority for combining them.
    return this.enqueueCandidates(buildRecentRaiderIdentityAuditPipeline(
      CharacterWclIdentityAudit.collection.name,
      [...candidateIds].map((id) => new mongoose.Types.ObjectId(id)),
      now,
      limit,
    ), limit, "Queue Recent Raider WCL Identities");
  }

  async enqueueUnchecked(maxCandidates?: number): Promise<CharacterWclIdentityAuditEnqueueResult> {
    const limit = Number.isInteger(maxCandidates) && Number(maxCandidates) > 0 ? Number(maxCandidates) : null;
    return this.enqueueCandidates(buildUncheckedWclIdentityAuditPipeline(
      CharacterWclIdentityAudit.collection.name,
      CharacterAchievementFetchQueue.collection.name,
      CharacterMediaFetchQueue.collection.name,
      limit ?? undefined,
    ), limit, QUEUE_TASK_NAME);
  }

  private async enqueueCandidates(pipeline: mongoose.PipelineStage[], limit: number | null, taskName: string): Promise<CharacterWclIdentityAuditEnqueueResult> {
    const taskId = await taskTracker.start(taskName, { limit });
    try {
      const rows = await Character.aggregate<CandidateRow>(pipeline).allowDiskUse(true);
      const now = new Date();
      const operations: any[] = rows.map((row) => ({
        updateOne: {
          filter: {
            characterId: row._id,
            ...(row.auditStatus ? { status: row.auditStatus, lastActivityAt: row.auditLastActivityAt } : {}),
          },
          update: {
            [row.auditStatus ? "$set" : "$setOnInsert"]: {
              characterId: row._id,
              expectedWclCanonicalCharacterId: row.wclCanonicalCharacterId,
              expectedClassID: row.classID,
              sourceName: row.name,
              sourceRealm: row.realm,
              sourceRegion: row.region.toLowerCase(),
              status: "pending",
              outcome: null,
              priority: row.lastReportSeenAt ? 10 : 20,
              identityChanged: false,
              attempts: 0,
              maxAttempts: 3,
              wclCharacterId: null,
              wclCanonicalCharacterId: null,
              resolvedName: null,
              resolvedRealm: null,
              resolvedRegion: null,
              resolvedClassID: null,
              completionReason: null,
              lastError: null,
              lastErrorAt: null,
              startedAt: null,
              completedAt: null,
              lastActivityAt: now,
            },
          },
          upsert: !row.auditStatus,
        },
      }));

      let queued = 0;
      let requeued = 0;
      for (let offset = 0; offset < operations.length; offset += 1000) {
        const result = await CharacterWclIdentityAudit.bulkWrite(operations.slice(offset, offset + 1000), { ordered: false });
        queued += result.upsertedCount ?? 0;
        requeued += result.modifiedCount ?? 0;
      }
      const result = { candidates: rows.length, queued, existing: rows.length - queued - requeued, requeued, limit };
      await taskTracker.complete(taskId, result);
      logger.info(`[CharacterWclIdentityAudit] Queued ${queued} new and ${requeued} recurring character check(s); ${result.existing} raced with an existing audit row`);
      return result;
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async getStatus(): Promise<CharacterWclIdentityAuditStatusResponse> {
    const [statusRows, outcomeRows, changedCount, dbCurrentItem, recentIssues] = await Promise.all([
      CharacterWclIdentityAudit.aggregate<{ _id: CharacterWclIdentityAuditStatus; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      CharacterWclIdentityAudit.aggregate<{ _id: CharacterWclIdentityAuditOutcome; count: number }>([
        { $match: { outcome: { $ne: null } } },
        { $group: { _id: "$outcome", count: { $sum: 1 } } },
      ]),
      CharacterWclIdentityAudit.countDocuments({ identityChanged: true }),
      CharacterWclIdentityAudit.findOne({ status: "in_progress" }).sort({ lastActivityAt: -1 }).lean<ICharacterWclIdentityAudit>(),
      CharacterWclIdentityAudit.find({ status: { $in: ["skipped", "failed"] } })
        .sort({ completedAt: -1, lastErrorAt: -1 })
        .limit(10)
        .lean<ICharacterWclIdentityAudit[]>(),
    ]);

    const queue = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      resolved: 0,
      hidden: 0,
      notFound: 0,
      classMismatch: 0,
      invalidResponse: 0,
      identitiesChanged: changedCount,
    };
    for (const row of statusRows) {
      if (row._id === "pending") queue.pending = row.count;
      if (row._id === "in_progress") queue.inProgress = row.count;
      if (row._id === "completed") queue.completed = row.count;
      if (row._id === "skipped") queue.skipped = row.count;
      if (row._id === "failed") queue.failed = row.count;
      queue.total += row.count;
    }
    for (const row of outcomeRows) {
      if (row._id === "resolved") queue.resolved = row.count;
      if (row._id === "hidden") queue.hidden = row.count;
      if (row._id === "not_found") queue.notFound = row.count;
      if (row._id === "class_mismatch") queue.classMismatch = row.count;
      if (row._id === "invalid_response") queue.invalidResponse = row.count;
    }

    return {
      processor: {
        isRunning: this.isRunning,
        isWaitingForRateLimit: this.isWaitingForRateLimit,
        currentItem: this.currentItem ?? (dbCurrentItem ? summarizeItem(dbCurrentItem) : null),
        lastMessage: this.lastMessage,
      },
      queue,
      recentIssues: recentIssues.map(summarizeItem),
      updatedAt: new Date(),
    };
  }

  startProcessing(): boolean {
    if (this.isRunning) return false;
    this.isRunning = true;
    this.isWaitingForRateLimit = false;
    this.lastMessage = "WCL character identity audit started";
    logger.info("[CharacterWclIdentityAudit] Processor started");

    void this.processLoop().catch((error) => {
      logger.error("[CharacterWclIdentityAudit] Processor crashed:", error);
      this.isRunning = false;
      this.isWaitingForRateLimit = false;
      this.currentItem = null;
      this.lastMessage = `Processor crashed: ${error instanceof Error ? error.message : String(error)}`;
    });
    return true;
  }

  async resumeInterrupted(staleAfterMs = 15 * 60 * 1000): Promise<boolean> {
    if (this.isRunning) return false;
    const staleBefore = new Date(Date.now() - staleAfterMs);
    const reset = await CharacterWclIdentityAudit.updateMany(
      { status: "in_progress", lastActivityAt: { $lt: staleBefore } },
      {
        $set: {
          status: "pending",
          lastActivityAt: new Date(),
          lastError: "Reset after interrupted WCL identity audit",
          lastErrorAt: new Date(),
        },
      },
    );
    if ((reset.modifiedCount ?? 0) > 0) {
      logger.warn(`[CharacterWclIdentityAudit] Reset ${reset.modifiedCount} stale in-progress item(s) to pending`);
    }
    const pending = await CharacterWclIdentityAudit.countDocuments({ status: "pending" });
    return pending > 0 ? this.startProcessing() : false;
  }

  async waitUntilIdle(pollIntervalMs = 1000): Promise<CharacterWclIdentityAuditStatusResponse> {
    while (this.isRunning) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return this.getStatus();
  }

  private async processLoop(): Promise<void> {
    let processedThisRun = 0;
    let taskId = "";
    try {
      taskId = await taskTracker.start(TASK_NAME);
      while (this.isRunning) {
        const item = await CharacterWclIdentityAudit.findOneAndUpdate(
          { status: "pending" },
          {
            $set: {
              status: "in_progress",
              startedAt: new Date(),
              lastActivityAt: new Date(),
              completionReason: null,
            },
            $inc: { attempts: 1 },
          },
          { sort: { priority: 1, createdAt: 1 }, returnDocument: "after" },
        );

        if (!item) {
          this.lastMessage = `WCL character identity audit complete; processed ${processedThisRun} character(s) this run`;
          logger.info(`[CharacterWclIdentityAudit] No pending characters remain; processed ${processedThisRun} this run`);
          break;
        }

        this.currentItem = summarizeItem(item);
        processedThisRun += 1;
        try {
          const outcome = await this.processItem(item);
          await CharacterWclIdentityAudit.findByIdAndUpdate(item._id, {
            $set: {
              status: outcome.status,
              outcome: outcome.outcome,
              identityChanged: outcome.identityChanged,
              wclCharacterId: outcome.wclCharacterId ?? null,
              wclCanonicalCharacterId: outcome.wclCanonicalCharacterId ?? null,
              resolvedName: outcome.resolvedName ?? null,
              resolvedRealm: outcome.resolvedRealm ?? null,
              resolvedRegion: outcome.resolvedRegion ?? null,
              resolvedClassID: outcome.resolvedClassID ?? null,
              completionReason: outcome.reason,
              completedAt: new Date(),
              lastActivityAt: new Date(),
              lastError: null,
              lastErrorAt: null,
            },
          });
          logger.info(`[CharacterWclIdentityAudit] ${outcome.status} ${item.sourceName}-${item.sourceRealm}: ${outcome.reason}`);
        } catch (error) {
          await this.handleItemError(item, error);
        } finally {
          this.currentItem = null;
        }

        if (processedThisRun % PROCESS_LOG_INTERVAL === 0) {
          const status = await this.getStatus();
          logger.info(
            `[CharacterWclIdentityAudit] Progress: processed=${processedThisRun}, pending=${status.queue.pending}, changed=${status.queue.identitiesChanged}, classMismatch=${status.queue.classMismatch}, failed=${status.queue.failed}`,
          );
        }
      }
      await taskTracker.complete(taskId, { processedThisRun });
    } catch (error) {
      if (taskId) await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      const startAchievementProcessing = this.achievementProcessingNeeded;
      this.achievementProcessingNeeded = false;
      this.isRunning = false;
      this.isWaitingForRateLimit = false;
      this.currentItem = null;
      if (startAchievementProcessing) characterAchievementService.startProcessing();
    }
  }

  private async processItem(item: ICharacterWclIdentityAudit): Promise<ProcessOutcome> {
    await this.waitForBackgroundCapacity(`${item.sourceName}-${item.sourceRealm}`);
    const result = await wclService.query<WclIdentityResponse>(
      this.buildWclQuery(),
      { characterId: item.expectedWclCanonicalCharacterId },
      false,
      2,
      { estimatedPoints: ESTIMATED_POINTS_PER_LOOKUP, sampleRateLimit: true },
    );
    const character = result.characterData?.character;
    const outcome = classifyCanonicalWclIdentityResult(
      { classID: item.expectedClassID, region: item.sourceRegion },
      character,
    );
    const wclCharacterId = toPositiveInteger(character?.id);
    const canonicalID = toPositiveInteger(character?.canonicalID);
    const resolvedClassID = toPositiveInteger(character?.classID);
    const resolvedName = character?.name?.trim() || null;
    const resolvedRealm = character?.server?.slug?.trim() || null;
    const resolvedRegion = character?.server?.region?.slug?.trim().toLowerCase() || null;

    if (outcome !== "resolved" && outcome !== "hidden") {
      const reasons: Record<Exclude<CharacterWclIdentityAuditOutcome, "resolved" | "hidden">, string> = {
        not_found: "WCL character was not found by canonical ID",
        class_mismatch: `WCL returned class ${resolvedClassID ?? "unknown"}; expected WCL class ${item.expectedClassID}`,
        invalid_response: "WCL returned an incomplete or inconsistent character identity",
      };
      return {
        status: "skipped",
        outcome,
        reason: reasons[outcome],
        identityChanged: false,
        wclCharacterId,
        wclCanonicalCharacterId: canonicalID,
        resolvedName,
        resolvedRealm,
        resolvedRegion,
        resolvedClassID,
      };
    }

    if (!resolvedName || !resolvedRealm || !resolvedRegion || !canonicalID || !resolvedClassID) {
      throw new Error("Validated WCL identity was incomplete before application");
    }
    if (canonicalID !== item.expectedWclCanonicalCharacterId) {
      return this.resolveCanonicalRedirect(item, character!);
    }
    const identityChanged = await this.applyResolvedIdentity(
      item,
      { name: resolvedName, realm: resolvedRealm, region: resolvedRegion },
      outcome === "hidden",
    );
    return {
      status: "completed",
      outcome,
      reason: identityChanged
        ? `WCL identity updated to ${resolvedName}-${resolvedRealm}`
        : `WCL identity verified as ${resolvedName}-${resolvedRealm}`,
      identityChanged,
      wclCharacterId,
      wclCanonicalCharacterId: canonicalID,
      resolvedName,
      resolvedRealm,
      resolvedRegion,
      resolvedClassID,
    };
  }

  private async resolveCanonicalRedirect(item: ICharacterWclIdentityAudit, alias: WclIdentityCharacter): Promise<ProcessOutcome> {
    const skipped = (reason: string): ProcessOutcome => ({
      status: "skipped", outcome: "invalid_response", reason, identityChanged: false,
      wclCharacterId: toPositiveInteger(alias.id),
      wclCanonicalCharacterId: toPositiveInteger(alias.canonicalID),
    });
    if (alias.hidden) return skipped("Hidden WCL aliases are not automatically combined");

    // An alias retains its old name. Fetch the canonical profile before choosing
    // a destination; never apply the alias's name to the current character.
    await this.waitForBackgroundCapacity(`canonical redirect for ${item.sourceName}`);
    const response = await wclService.query<WclIdentityResponse>(
      this.buildWclQuery(), { characterId: alias.canonicalID }, false, 2,
      { estimatedPoints: ESTIMATED_POINTS_PER_LOOKUP, sampleRateLimit: true },
    );
    const current = response.characterData?.character;
    if (
      !current || classifyCanonicalWclIdentityResult({ classID: item.expectedClassID, region: item.sourceRegion }, current) !== "resolved"
      || current.id !== alias.canonicalID || current.canonicalID !== alias.canonicalID
    ) return skipped("WCL canonical redirect destination could not be verified");
    const canonicalID = Number(current.canonicalID);
    const identity = {
      name: current.name!.trim(), realm: normalizeRealmSlug(current.server!.slug!),
      region: current.server!.region!.slug!.trim().toLowerCase(),
    };

    const source = await Character.findOne({
      _id: item.characterId,
      wclCanonicalCharacterId: item.expectedWclCanonicalCharacterId,
      classID: item.expectedClassID,
    }).select("name realm region firstReportSeenAt lastReportSeenAt").lean();
    if (!source) throw new Error("Character identity changed while its WCL redirect was pending");

    const target = await Character.findOneAndUpdate(
      { wclCanonicalCharacterId: canonicalID, classID: item.expectedClassID },
      { $setOnInsert: {
        ...identity,
        identityObservedAt: new Date(),
        firstReportSeenAt: source.firstReportSeenAt,
        lastReportSeenAt: source.lastReportSeenAt,
      } },
      { upsert: true, returnDocument: "after" },
    );
    if (!target) throw new Error("Could not store WCL canonical redirect destination");
    if (normalizedText(target.region) !== normalizedText(item.sourceRegion)) {
      return skipped("Stored canonical destination has a conflicting region");
    }
    const preview = await characterContinuityService.preview(String(target._id), source);
    if (preview.source.id !== String(item.characterId)) return skipped("Historical character name is ambiguous");
    const alreadyCombined = preview.blockers.includes("alreadyCombined");
    if (!alreadyCombined && (!preview.eligible || preview.target.id !== String(target._id))) {
      return skipped(`WCL redirect continuity blocked: ${preview.blockers.join(", ") || "destination already combined"}`);
    }
    if (!alreadyCombined) {
      await characterContinuityService.create(String(target._id), source, "wcl-canonical-redirect");
    }
    await this.applyResolvedIdentity(
      { characterId: target._id as mongoose.Types.ObjectId, expectedWclCanonicalCharacterId: canonicalID, expectedClassID: item.expectedClassID },
      identity,
      false,
    );
    // Repeat downstream work on retries, including when the link was committed
    // before an interrupted run. The source records and report IDs stay intact.
    await cacheService.invalidatePattern(/^characters:profile:/);
    if (CCG_FEATURE_ENABLED) {
      const { default: ccgIdentityService } = await import("./ccg-character-identity.service");
      await ccgIdentityService.reconcileAll();
    }
    await characterAchievementService.rebuildAccountGroups();
    await cacheService.invalidatePattern(/^accounts:/);
    return {
      status: "completed", outcome: "resolved", identityChanged: true,
      reason: `WCL canonical redirect combined ${item.sourceName} into ${identity.name}`,
      wclCharacterId: Number(alias.id), wclCanonicalCharacterId: canonicalID,
      resolvedName: identity.name, resolvedRealm: identity.realm,
      resolvedRegion: identity.region, resolvedClassID: item.expectedClassID,
    };
  }

  private async applyResolvedIdentity(
    item: Pick<ICharacterWclIdentityAudit, "characterId" | "expectedWclCanonicalCharacterId" | "expectedClassID">,
    identity: { name: string; realm: string; region: string },
    hidden: boolean,
  ): Promise<boolean> {
    const character = await Character.findOne({
      _id: item.characterId,
      wclCanonicalCharacterId: item.expectedWclCanonicalCharacterId,
      classID: item.expectedClassID,
    })
      .select("_id name realm region wclProfileHidden")
      .lean<Pick<ICharacter, "_id" | "name" | "realm" | "region" | "wclProfileHidden">>();
    if (!character) throw new Error("Character identity changed while its WCL audit was pending");

    const normalizedRealm = normalizeRealmSlug(identity.realm);
    const normalizedRegion = identity.region.toLowerCase();
    const identityChanged =
      normalizedText(character.name) !== normalizedText(identity.name) ||
      normalizeRealmSlug(character.realm) !== normalizedRealm ||
      normalizedText(character.region) !== normalizedRegion;
    const stateChanged = identityChanged || character.wclProfileHidden !== hidden;
    const resolvedAt = new Date();
    const update = await Character.updateOne(
      {
        _id: item.characterId,
        wclCanonicalCharacterId: item.expectedWclCanonicalCharacterId,
        classID: item.expectedClassID,
      },
      {
        $set: {
          name: identity.name,
          realm: normalizedRealm,
          region: normalizedRegion,
          identityObservedAt: resolvedAt,
          wclProfileHidden: hidden,
        },
      },
    );
    if (update.matchedCount !== 1) throw new Error("Character identity changed during its WCL audit update");

    if (identityChanged) {
      const [, achievementEnqueue] = await Promise.all([
        characterMediaService.enqueueCharacter(String(item.characterId), 200, true),
        characterAchievementService.enqueueCharacters([item.characterId], 1),
        mythicPlusService.reconcileCharacterIdentities({ characterIds: [item.characterId], limit: 1 }),
      ]);
      if (CCG_FEATURE_ENABLED) characterMediaService.startProcessing();
      if (achievementEnqueue.scheduled > 0) this.achievementProcessingNeeded = true;
    }
    if (stateChanged) {
      await Promise.all([
        cacheService.invalidatePattern(/^characters:profile:/),
        cacheService.invalidatePattern(/^accounts:/),
      ]);
    }
    return identityChanged;
  }

  private buildWclQuery(): string {
    return `
      query($characterId: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        characterData {
          character(id: $characterId) {
            id
            canonicalID
            name
            classID
            hidden
            server {
              slug
              region {
                slug
              }
            }
          }
        }
      }
    `;
  }

  private async waitForBackgroundCapacity(label: string): Promise<void> {
    while (true) {
      await rateLimitService.refreshSharedState();
      const capacity = rateLimitService.getBackgroundCapacity();
      if (rateLimitService.canProceedBackground() && capacity >= ESTIMATED_POINTS_PER_LOOKUP) {
        this.isWaitingForRateLimit = false;
        return;
      }
      const status = await rateLimitService.getSharedStatus();
      this.isWaitingForRateLimit = true;
      this.lastMessage = `Waiting for WCL rate limit reset before ${label}; background capacity ${Math.floor(capacity)} points, reset in ${status.resetInSeconds}s`;
      logger.info(`[CharacterWclIdentityAudit] ${this.lastMessage}`);
      await rateLimitService.waitForReset();
    }
  }

  private async handleItemError(item: ICharacterWclIdentityAudit, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = item.attempts || 1;
    const maxAttempts = item.maxAttempts || 3;
    const nextStatus: CharacterWclIdentityAuditStatus = getWclIdentityAuditRetryStatus(attempts, maxAttempts);
    await CharacterWclIdentityAudit.findByIdAndUpdate(item._id, {
      $set: {
        status: nextStatus,
        lastError: message.slice(0, 2000),
        lastErrorAt: new Date(),
        lastActivityAt: new Date(),
        completionReason: nextStatus === "failed" ? `Failed after ${attempts} attempts` : `Retry queued after attempt ${attempts}`,
      },
    });
    if (nextStatus === "failed") {
      logger.error(`[CharacterWclIdentityAudit] Failed ${item.sourceName}-${item.sourceRealm} after ${attempts}/${maxAttempts}: ${message}`);
    } else {
      logger.warn(`[CharacterWclIdentityAudit] Error auditing ${item.sourceName}-${item.sourceRealm}; retrying (${attempts}/${maxAttempts}): ${message}`);
    }
  }
}

const characterWclIdentityAuditService = new CharacterWclIdentityAuditService();
export default characterWclIdentityAuditService;
