import mongoose from "mongoose";
import { TRACKED_RAIDS } from "../config/guilds";
import CharacterIdentityLink from "../models/CharacterIdentityLink";
import CharacterIdentityResolution, {
  CharacterIdentityResolutionOutcome,
  CharacterIdentityResolutionStatus,
  ICharacterIdentityResolution,
} from "../models/CharacterIdentityResolution";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import { createCharacterIdentityAliasKey } from "../utils/character-identity-link";
import logger from "../utils/logger";
import characterService from "./character.service";
import rateLimitService from "./rate-limit.service";
import taskTracker from "./task-tracker.service";
import wclService from "./warcraftlogs.service";

const TASK_NAME = "Resolve Historical WCL Character Identities";
const ESTIMATED_POINTS_PER_LOOKUP = 1;
const PROCESS_LOG_INTERVAL = 50;

type WclIdentityResolutionOutcome = Exclude<CharacterIdentityResolutionOutcome, "manual_link">;

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
  sourceIdentityKey: string;
  sourceName: string;
  sourceRealm: string;
  sourceRegion: string;
  sourceClassID: number;
  appearanceCount: number;
  reportCount: number;
  guildCount: number;
  zoneIds: number[];
  firstSeenAt?: Date;
  lastSeenAt?: Date;
}

type ResolutionItemSummary = {
  id: string;
  sourceIdentityKey: string;
  sourceName: string;
  sourceRealm: string;
  sourceRegion: string;
  sourceClassID: number;
  status: CharacterIdentityResolutionStatus;
  outcome?: CharacterIdentityResolutionOutcome | null;
  attempts: number;
  maxAttempts: number;
  appearanceCount: number;
  reportCount: number;
  guildCount: number;
  zoneIds: number[];
  targetCharacterId?: string | null;
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

export interface CharacterIdentityResolutionStatusResponse {
  processor: {
    isRunning: boolean;
    isWaitingForRateLimit: boolean;
    currentItem: ResolutionItemSummary | null;
    lastMessage: string | null;
  };
  queue: {
    pending: number;
    inProgress: number;
    completed: number;
    skipped: number;
    failed: number;
    active: number;
    terminal: number;
    total: number;
    resolved: number;
    manualLink: number;
    hidden: number;
    notFound: number;
    classMismatch: number;
    invalidResponse: number;
    resolvedAppearances: number;
  };
  recentIssues: ResolutionItemSummary[];
  updatedAt: Date;
}

export interface CharacterIdentityResolutionEnqueueResult {
  candidates: number;
  queued: number;
  existing: number;
  updated: number;
  requeued: number;
  discoverySkipped: boolean;
}

interface ProcessOutcome {
  status: "completed" | "skipped";
  outcome: CharacterIdentityResolutionOutcome;
  reason: string;
  targetCharacterId?: mongoose.Types.ObjectId | null;
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

export function classifyWclIdentityResult(
  expected: { classID: number; region: string },
  character: WclIdentityCharacter | null | undefined,
): WclIdentityResolutionOutcome {
  if (!character) return "not_found";
  if (character.hidden === true) return "hidden";

  const classID = toPositiveInteger(character.classID);
  if (classID !== null && classID !== expected.classID) return "class_mismatch";
  if (classID === null || toPositiveInteger(character.canonicalID) === null) return "invalid_response";

  const returnedRegion = character.server?.region?.slug?.trim().toLowerCase();
  if (returnedRegion && returnedRegion !== expected.region.trim().toLowerCase()) return "invalid_response";

  return "resolved";
}

function summarizeItem(item: ICharacterIdentityResolution): ResolutionItemSummary {
  return {
    id: String(item._id),
    sourceIdentityKey: item.sourceIdentityKey,
    sourceName: item.sourceName,
    sourceRealm: item.sourceRealm,
    sourceRegion: item.sourceRegion,
    sourceClassID: item.sourceClassID,
    status: item.status,
    outcome: item.outcome,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    appearanceCount: item.evidence.appearanceCount,
    reportCount: item.evidence.reportCount,
    guildCount: item.evidence.guildCount,
    zoneIds: item.evidence.zoneIds ?? [],
    targetCharacterId: item.targetCharacterId ? String(item.targetCharacterId) : null,
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

class CharacterIdentityResolutionService {
  private isRunning = false;
  private isWaitingForRateLimit = false;
  private currentItem: ResolutionItemSummary | null = null;
  private lastMessage: string | null = null;

  async trigger(options: { refreshCandidates?: boolean; reprocessSkipped?: boolean } = {}): Promise<{
    started: boolean;
    enqueue: CharacterIdentityResolutionEnqueueResult;
    status: CharacterIdentityResolutionStatusResponse;
  }> {
    await CharacterIdentityResolution.createIndexes();
    const existingItems = await CharacterIdentityResolution.countDocuments({});
    let enqueue: CharacterIdentityResolutionEnqueueResult;

    if (existingItems > 0 && options.refreshCandidates !== true) {
      enqueue = {
        candidates: 0,
        queued: 0,
        existing: existingItems,
        updated: 0,
        requeued: 0,
        discoverySkipped: true,
      };
    } else {
      const taskId = await taskTracker.start("Queue Historical WCL Character Identity Resolution", {
        refreshCandidates: options.refreshCandidates === true,
      });
      try {
        enqueue = await this.enqueueCandidates();
        await taskTracker.complete(taskId, { ...enqueue });
      } catch (error) {
        await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }

    if (options.reprocessSkipped === true) {
      const now = new Date();
      const result = await CharacterIdentityResolution.updateMany(
        { status: { $in: ["skipped", "failed"] } },
        {
          $set: {
            status: "pending",
            outcome: null,
            attempts: 0,
            targetCharacterId: null,
            wclCharacterId: null,
            wclCanonicalCharacterId: null,
            resolvedName: null,
            resolvedRealm: null,
            resolvedRegion: null,
            resolvedClassID: null,
            completionReason: null,
            completedAt: null,
            lastError: null,
            lastErrorAt: null,
            lastActivityAt: now,
          },
        },
      );
      enqueue.requeued = result.modifiedCount ?? 0;
    }

    let started = false;
    if (!this.isRunning) {
      await this.resetInterruptedItems();
      started = this.startProcessing();
    }

    return { started, enqueue, status: await this.getStatus() };
  }

  async enqueueCandidates(): Promise<CharacterIdentityResolutionEnqueueResult> {
    const startedAt = Date.now();
    const rows = await CharacterReportAppearance.aggregate<CandidateRow>([
      {
        $match: {
          appearanceSource: "reportRankings",
          wclCanonicalCharacterId: null,
          reportZoneId: { $in: TRACKED_RAIDS },
          hidden: { $ne: true },
          sourceIdentityKey: { $type: "string" },
        },
      },
      { $sort: { reportStartTime: 1, reportCode: 1 } },
      {
        $group: {
          _id: "$sourceIdentityKey",
          sourceName: { $last: "$characterName" },
          sourceRealm: { $last: "$characterRealm" },
          sourceRegion: { $last: "$characterRegion" },
          sourceClassID: { $last: "$classID" },
          appearanceCount: { $sum: 1 },
          reportCodes: { $addToSet: "$reportCode" },
          guildIds: { $addToSet: "$reportGuildId" },
          zoneIds: { $addToSet: "$reportZoneId" },
          firstSeenAt: { $min: "$reportStartTime" },
          lastSeenAt: { $max: "$reportStartTime" },
        },
      },
      {
        $project: {
          _id: 0,
          sourceIdentityKey: "$_id",
          sourceName: 1,
          sourceRealm: 1,
          sourceRegion: 1,
          sourceClassID: 1,
          appearanceCount: 1,
          reportCount: { $size: "$reportCodes" },
          guildCount: { $size: "$guildIds" },
          zoneIds: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
      },
    ]).allowDiskUse(true);

    logger.info(
      `[CharacterIdentityResolution] Found ${rows.length} unresolved report-ranking identities in tracked raids (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
    );

    const now = new Date();
    const operations: any[] = rows
      .filter(
        (row) =>
          typeof row.sourceIdentityKey === "string" &&
          row.sourceIdentityKey.length > 0 &&
          Boolean(row.sourceName) &&
          Boolean(row.sourceRealm) &&
          Boolean(row.sourceRegion) &&
          Number.isInteger(row.sourceClassID) &&
          row.sourceClassID > 0,
      )
      .map((row) => ({
        updateOne: {
          filter: { sourceIdentityKey: row.sourceIdentityKey },
          update: {
            $set: {
              sourceName: row.sourceName,
              sourceRealm: row.sourceRealm,
              sourceRegion: row.sourceRegion.toLowerCase(),
              sourceClassID: row.sourceClassID,
              priority: row.reportCount >= 2 ? 10 : 20,
              evidence: {
                appearanceCount: row.appearanceCount,
                reportCount: row.reportCount,
                guildCount: row.guildCount,
                zoneIds: (row.zoneIds ?? []).filter((zoneId) => Number.isInteger(zoneId)).sort((a, b) => b - a),
                firstSeenAt: row.firstSeenAt,
                lastSeenAt: row.lastSeenAt,
              },
              lastActivityAt: now,
            },
            $setOnInsert: {
              status: "pending",
              outcome: null,
              attempts: 0,
              maxAttempts: 3,
              targetCharacterId: null,
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
            },
          },
          upsert: true,
        },
      }));

    let queued = 0;
    let updated = 0;
    for (let offset = 0; offset < operations.length; offset += 1000) {
      const result = await CharacterIdentityResolution.bulkWrite(operations.slice(offset, offset + 1000), { ordered: false });
      queued += result.upsertedCount ?? 0;
      updated += result.modifiedCount ?? 0;
    }

    const existing = operations.length - queued;
    logger.info(`[CharacterIdentityResolution] Candidate enqueue complete: ${queued} new, ${existing} existing, ${updated} updated`);
    return {
      candidates: rows.length,
      queued,
      existing,
      updated,
      requeued: 0,
      discoverySkipped: false,
    };
  }

  async getStatus(): Promise<CharacterIdentityResolutionStatusResponse> {
    const [statusRows, outcomeRows, dbCurrentItem, recentIssues] = await Promise.all([
      CharacterIdentityResolution.aggregate<{ _id: CharacterIdentityResolutionStatus; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      CharacterIdentityResolution.aggregate<{
        _id: CharacterIdentityResolutionOutcome;
        count: number;
        appearances: number;
      }>([
        { $match: { outcome: { $ne: null } } },
        { $group: { _id: "$outcome", count: { $sum: 1 }, appearances: { $sum: "$evidence.appearanceCount" } } },
      ]),
      CharacterIdentityResolution.findOne({ status: "in_progress" }).sort({ lastActivityAt: -1 }).lean<ICharacterIdentityResolution>(),
      CharacterIdentityResolution.find({ status: { $in: ["skipped", "failed"] } })
        .sort({ completedAt: -1, lastErrorAt: -1 })
        .limit(10)
        .lean<ICharacterIdentityResolution[]>(),
    ]);

    const queue = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      active: 0,
      terminal: 0,
      total: 0,
      resolved: 0,
      manualLink: 0,
      hidden: 0,
      notFound: 0,
      classMismatch: 0,
      invalidResponse: 0,
      resolvedAppearances: 0,
    };

    for (const row of statusRows) {
      if (row._id === "pending") queue.pending = row.count;
      if (row._id === "in_progress") queue.inProgress = row.count;
      if (row._id === "completed") queue.completed = row.count;
      if (row._id === "skipped") queue.skipped = row.count;
      if (row._id === "failed") queue.failed = row.count;
      queue.total += row.count;
    }
    queue.active = queue.pending + queue.inProgress;
    queue.terminal = queue.completed + queue.skipped + queue.failed;

    for (const row of outcomeRows) {
      if (row._id === "resolved") {
        queue.resolved = row.count;
        queue.resolvedAppearances = row.appearances ?? 0;
      }
      if (row._id === "manual_link") queue.manualLink = row.count;
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
    this.lastMessage = "Historical WCL character identity resolver started";
    logger.info("[CharacterIdentityResolution] Processor started");

    void this.processLoop().catch((error) => {
      logger.error("[CharacterIdentityResolution] Processor crashed:", error);
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
    const reset = await CharacterIdentityResolution.updateMany(
      { status: "in_progress", lastActivityAt: { $lt: staleBefore } },
      {
        $set: {
          status: "pending",
          lastActivityAt: new Date(),
          lastError: "Reset after interrupted identity resolution run",
          lastErrorAt: new Date(),
        },
      },
    );
    if ((reset.modifiedCount ?? 0) > 0) {
      logger.warn(`[CharacterIdentityResolution] Reset ${reset.modifiedCount} stale in-progress item(s) to pending`);
    }

    const pending = await CharacterIdentityResolution.countDocuments({ status: "pending" });
    return pending > 0 ? this.startProcessing() : false;
  }

  private async resetInterruptedItems(): Promise<void> {
    const result = await CharacterIdentityResolution.updateMany(
      { status: "in_progress" },
      {
        $set: {
          status: "pending",
          lastActivityAt: new Date(),
          lastError: "Reset after interrupted identity resolution run",
          lastErrorAt: new Date(),
        },
      },
    );
    if ((result.modifiedCount ?? 0) > 0) {
      logger.warn(`[CharacterIdentityResolution] Reset ${result.modifiedCount} interrupted item(s) to pending`);
    }
  }

  private async processLoop(): Promise<void> {
    let processedThisRun = 0;
    let taskId = "";
    try {
      taskId = await taskTracker.start(TASK_NAME);
      while (this.isRunning) {
        const item = await CharacterIdentityResolution.findOneAndUpdate(
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
          { sort: { priority: 1, "evidence.reportCount": -1, createdAt: 1 }, new: true },
        );

        if (!item) {
          this.lastMessage = `Historical WCL identity resolution complete; processed ${processedThisRun} identities this run`;
          logger.info(`[CharacterIdentityResolution] No pending identities remain; processed ${processedThisRun} this run`);
          break;
        }

        this.currentItem = summarizeItem(item);
        processedThisRun += 1;

        try {
          const manualLink = await CharacterIdentityLink.findOne({
            identityKey: createCharacterIdentityAliasKey({
              name: item.sourceName,
              realm: item.sourceRealm,
              region: item.sourceRegion,
              classID: item.sourceClassID,
            }),
          })
            .select("_id")
            .lean();

          const outcome = manualLink
            ? ({ status: "completed", outcome: "manual_link", reason: "Manual identity link already controls this alias" } as ProcessOutcome)
            : await this.processItem(item);

          await CharacterIdentityResolution.findByIdAndUpdate(item._id, {
            $set: {
              status: outcome.status,
              outcome: outcome.outcome,
              targetCharacterId: outcome.targetCharacterId ?? null,
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

          logger.info(`[CharacterIdentityResolution] ${outcome.status} ${item.sourceName}-${item.sourceRealm}: ${outcome.reason}`);
        } catch (error) {
          await this.handleItemError(item, error);
        } finally {
          this.currentItem = null;
        }

        if (processedThisRun % PROCESS_LOG_INTERVAL === 0) {
          const status = await this.getStatus();
          logger.info(
            `[CharacterIdentityResolution] Progress: processed=${processedThisRun}, pending=${status.queue.pending}, resolved=${status.queue.resolved}, skipped=${status.queue.skipped}, failed=${status.queue.failed}`,
          );
        }
      }
      await taskTracker.complete(taskId, { processedThisRun });
    } catch (error) {
      if (taskId) await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isRunning = false;
      this.isWaitingForRateLimit = false;
      this.currentItem = null;
    }
  }

  private async processItem(item: ICharacterIdentityResolution): Promise<ProcessOutcome> {
    await this.waitForBackgroundCapacity(`${item.sourceName}-${item.sourceRealm}`);
    const result = await wclService.query<WclIdentityResponse>(
      this.buildWclQuery(),
      {
        characterName: item.sourceName,
        serverSlug: item.sourceRealm,
        serverRegion: item.sourceRegion.toLowerCase(),
      },
      false,
      2,
    );
    const character = result.characterData?.character;
    const outcome = classifyWclIdentityResult({ classID: item.sourceClassID, region: item.sourceRegion }, character);
    const wclCharacterId = toPositiveInteger(character?.id);
    const canonicalID = toPositiveInteger(character?.canonicalID);
    const resolvedClassID = toPositiveInteger(character?.classID);
    const resolvedName = character?.name?.trim() || item.sourceName;
    const resolvedRealm = character?.server?.slug?.trim() || item.sourceRealm;
    const resolvedRegion = character?.server?.region?.slug?.trim().toLowerCase() || item.sourceRegion.toLowerCase();

    if (outcome !== "resolved" || !canonicalID || !resolvedClassID) {
      const skippedOutcome = outcome as Exclude<WclIdentityResolutionOutcome, "resolved">;
      const reasons: Record<Exclude<WclIdentityResolutionOutcome, "resolved">, string> = {
        hidden: "WCL character profile is hidden",
        not_found: "WCL character was not found by name, realm, and region",
        class_mismatch: `WCL returned class ${resolvedClassID ?? "unknown"}; expected ${item.sourceClassID}`,
        invalid_response: "WCL returned an incomplete or inconsistent character identity",
      };
      return {
        status: "skipped",
        outcome: skippedOutcome,
        reason: reasons[skippedOutcome],
        wclCharacterId,
        wclCanonicalCharacterId: canonicalID,
        resolvedName,
        resolvedRealm,
        resolvedRegion,
        resolvedClassID,
      };
    }

    const target = await characterService.upsertCharacterFromWclIdentityResolution({
      canonicalID,
      name: resolvedName,
      realm: resolvedRealm,
      region: resolvedRegion,
      classID: resolvedClassID,
      firstReportSeenAt: item.evidence.firstSeenAt,
      lastReportSeenAt: item.evidence.lastSeenAt,
      resolvedAt: new Date(),
    });

    return {
      status: "completed",
      outcome: "resolved",
      reason: "WCL identity resolved and stored",
      targetCharacterId: target.characterId,
      wclCharacterId,
      wclCanonicalCharacterId: canonicalID,
      resolvedName,
      resolvedRealm,
      resolvedRegion,
      resolvedClassID,
    };
  }

  private buildWclQuery(): string {
    return `
      query($characterName: String!, $serverSlug: String!, $serverRegion: String!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        characterData {
          character(name: $characterName, serverSlug: $serverSlug, serverRegion: $serverRegion) {
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
      logger.info(`[CharacterIdentityResolution] ${this.lastMessage}`);
      await rateLimitService.waitForReset();
    }
  }

  private async handleItemError(item: ICharacterIdentityResolution, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = item.attempts || 1;
    const maxAttempts = item.maxAttempts || 3;
    const nextStatus: CharacterIdentityResolutionStatus = attempts >= maxAttempts ? "failed" : "pending";

    await CharacterIdentityResolution.findByIdAndUpdate(item._id, {
      $set: {
        status: nextStatus,
        lastError: message.slice(0, 2000),
        lastErrorAt: new Date(),
        lastActivityAt: new Date(),
        completionReason: nextStatus === "failed" ? `Failed after ${attempts} attempts` : `Retry queued after attempt ${attempts}`,
      },
    });

    if (nextStatus === "failed") {
      logger.error(`[CharacterIdentityResolution] Failed ${item.sourceName}-${item.sourceRealm} after ${attempts}/${maxAttempts}: ${message}`);
    } else {
      logger.warn(`[CharacterIdentityResolution] Error resolving ${item.sourceName}-${item.sourceRealm}; retrying (${attempts}/${maxAttempts}): ${message}`);
    }
  }
}

export const characterIdentityResolutionService = new CharacterIdentityResolutionService();
export default characterIdentityResolutionService;
