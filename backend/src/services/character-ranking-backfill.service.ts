import mongoose from "mongoose";
import { TRACKED_RAIDS } from "../config/guilds";
import { ROLE_BY_CLASS_AND_SPEC, Role } from "../config/specs";
import Character from "../models/Character";
import CharacterLeaderboard from "../models/CharacterLeaderboard";
import CharacterRankingBackfill, { CharacterRankingBackfillStatus, ICharacterRankingBackfill } from "../models/CharacterRankingBackfill";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import Raid from "../models/Raid";
import Ranking from "../models/Ranking";
import logger from "../utils/logger";
import { resolveRole, slugifySpecName } from "../utils/spec";
import cacheService from "./cache.service";
import { getPrimaryCharacterRaidGuilds } from "./character-raid-guild.service";
import rateLimitService from "./rate-limit.service";
import taskTracker from "./task-tracker.service";
import wclService from "./warcraftlogs.service";

const TASK_NAME = "Character Ranking Backfill";
const LEADERBOARD_REBUILD_TASK_NAME = "Rebuild Character Ranking Tables";
const MYTHIC_DIFFICULTY = 5;
const ALL_PARTITIONS = -1;
const ESTIMATED_POINTS_PER_RANKING_ALIAS = 5;
const PROCESS_LOG_INTERVAL = 25;

type RankingMetric = "dps" | "hps";

interface WclAllStars {
  partition?: unknown;
  spec?: string | null;
  points?: unknown;
  possiblePoints?: unknown;
  rankPercent?: unknown;
  total?: unknown;
}

interface WclRanking {
  encounter?: {
    id?: unknown;
    name?: string | null;
  } | null;
  rankPercent?: unknown;
  medianPercent?: unknown;
  lockedIn?: boolean | null;
  totalKills?: unknown;
  allStars?: WclAllStars | null;
  spec?: string | null;
  bestSpec?: string | null;
  bestAmount?: unknown;
  bestRank?: {
    ilvl?: unknown;
  } | null;
}

interface WclZoneRankings {
  partition?: unknown;
  rankings?: WclRanking[] | null;
  allStars?: WclAllStars[] | null;
  error?: unknown;
}

interface WclCharacter {
  id?: number;
  canonicalID?: number;
  name?: string;
  classID?: number;
  hidden?: boolean;
  [alias: string]: unknown;
}

interface WclCharacterRankingsResponse {
  characterData?: {
    character?: WclCharacter | null;
  };
}

interface CandidateAggregateRow {
  characterId?: mongoose.Types.ObjectId | null;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  zoneId: number;
  appearanceCount: number;
  reportCount: number;
  mythicFightCount: number;
  mythicKillCount: number;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  observedSpecNameLists?: string[][];
}

interface SpecQuery {
  alias: string;
  metric: RankingMetric;
  specSlug: string;
  wclName: string;
  role: Role;
  source: "observed" | "fallback";
}

interface BackfillItemSummary {
  id: string;
  characterId: string;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  zoneId: number;
  raidName?: string | null;
  status: CharacterRankingBackfillStatus;
  attempts: number;
  maxAttempts: number;
  aliasesQueried: number;
  specQuerySource?: "observed" | "fallback" | null;
  specsQueried: string[];
  rankingsWritten: number;
  leaderboardEntriesWritten: number;
  completionReason?: string | null;
  lastError?: string | null;
  lastErrorAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CharacterRankingBackfillStatusResponse {
  processor: {
    isRunning: boolean;
    isWaitingForRateLimit: boolean;
    stopRequested: boolean;
    currentItem: BackfillItemSummary | null;
    lastMessage: string | null;
  };
  leaderboardRebuild: {
    isRunning: boolean;
    startedAt: Date | null;
    completedAt: Date | null;
    totalPairs: number;
    processedPairs: number;
    writtenEntries: number;
    lastMessage: string | null;
    lastError: string | null;
  };
  queue: {
    pending: number;
    inProgress: number;
    completed: number;
    skipped: number;
    failed: number;
    total: number;
    terminal: number;
    aliasesQueried: number;
    observedSpecItems: number;
    fallbackSpecItems: number;
    rankingsWritten: number;
    leaderboardEntriesWritten: number;
  };
  recentFailures: BackfillItemSummary[];
  updatedAt: Date;
}

export interface CharacterRankingBackfillEnqueueResult {
  candidates: number;
  queued: number;
  existing: number;
  updated: number;
  skippedWithoutCharacter: number;
  discoverySkipped: boolean;
  requeued: number;
}

export interface CharacterRankingBackfillTriggerResult {
  started: boolean;
  enqueue: CharacterRankingBackfillEnqueueResult;
  status: CharacterRankingBackfillStatusResponse;
}

export interface CharacterRankingLeaderboardRebuildTriggerResult {
  started: boolean;
  message: string;
  status: CharacterRankingBackfillStatusResponse;
}

export interface CharacterRankingMythicEvidenceCleanupResult {
  invalidPairs: number;
  rankingsDeleted: number;
  leaderboardEntriesDeleted: number;
  backfillItemsDeleted: number;
}

interface ProcessOutcome {
  status: "completed" | "skipped";
  reason: string;
  aliasesQueried: number;
  specQuerySource: "observed" | "fallback" | null;
  specsQueried: string[];
  rankingsWritten: number;
  leaderboardEntriesWritten: number;
}

class RankingBackfillStopRequestedError extends Error {
  constructor() {
    super("Character ranking backfill stop requested");
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

function isFinitePositive(value: unknown): boolean {
  return toFiniteNumber(value, 0) > 0;
}

function toWclSpecName(specSlug: string): string {
  return specSlug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function toSpecAlias(specSlug: string, metric: RankingMetric): string {
  const parts = specSlug.split(/[^a-z0-9]+/).filter(Boolean);
  const base =
    parts.length > 0
      ? parts[0] +
        parts
          .slice(1)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("")
      : "spec";
  const metricSuffix = metric.charAt(0).toUpperCase() + metric.slice(1);
  return `${base}${metricSuffix}Rankings`;
}

function normalizeObservedSpecSlug(specName: string, classSpecMap: Record<string, Role>): string | null {
  const slug = slugifySpecName(specName).replace(/^-+|-+$/g, "");
  if (!slug) return null;
  if (classSpecMap[slug]) return slug;

  const matchingClassSpec = Object.keys(classSpecMap).find((classSpec) => slug.startsWith(`${classSpec}-`) || slug.endsWith(`-${classSpec}`));
  return matchingClassSpec ?? null;
}

function summarizeItem(item: ICharacterRankingBackfill): BackfillItemSummary {
  return {
    id: String(item._id),
    characterId: String(item.characterId),
    wclCanonicalCharacterId: item.wclCanonicalCharacterId,
    name: item.name,
    realm: item.realm,
    region: item.region,
    classID: item.classID,
    zoneId: item.zoneId,
    raidName: item.raidName,
    status: item.status,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    aliasesQueried: item.aliasesQueried,
    specQuerySource: item.specQuerySource,
    specsQueried: item.specsQueried ?? [],
    rankingsWritten: item.rankingsWritten,
    leaderboardEntriesWritten: item.leaderboardEntriesWritten,
    completionReason: item.completionReason,
    lastError: item.lastError,
    lastErrorAt: item.lastErrorAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    lastActivityAt: item.lastActivityAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

class CharacterRankingBackfillService {
  private isRunning = false;
  private isWaitingForRateLimit = false;
  private stopRequested = false;
  private readonly stopListeners = new Set<() => void>();
  private currentItem: BackfillItemSummary | null = null;
  private lastMessage: string | null = null;
  private leaderboardRebuild = {
    isRunning: false,
    startedAt: null as Date | null,
    completedAt: null as Date | null,
    totalPairs: 0,
    processedPairs: 0,
    writtenEntries: 0,
    lastMessage: null as string | null,
    lastError: null as string | null,
  };

  async triggerBackfill(
    options: { refreshCandidates?: boolean; reprocessCompleted?: boolean; reprocessAll?: boolean; zoneIds?: number[] } = {},
  ): Promise<CharacterRankingBackfillTriggerResult> {
    if (options.reprocessAll === true && (this.isRunning || this.leaderboardRebuild.isRunning)) {
      throw new Error("Character ranking maintenance is still running; wait for it to stop before resetting the queue");
    }

    const existingQueueItems = await CharacterRankingBackfill.countDocuments({});
    let enqueue: CharacterRankingBackfillEnqueueResult;
    if (existingQueueItems > 0 && options.refreshCandidates !== true) {
      enqueue = {
        candidates: 0,
        queued: 0,
        existing: existingQueueItems,
        updated: 0,
        skippedWithoutCharacter: 0,
        discoverySkipped: true,
        requeued: 0,
      };
    } else {
      const taskId = await taskTracker.start("Queue Character Ranking Backfill", { refreshCandidates: options.refreshCandidates === true });
      try {
        enqueue = await this.enqueueMissingItems();
        await taskTracker.complete(taskId, { ...enqueue });
      } catch (error) {
        await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }

    if (options.reprocessAll === true) {
      const result = await CharacterRankingBackfill.updateMany(
        options.zoneIds?.length ? { zoneId: { $in: options.zoneIds } } : {},
        {
          $set: {
            status: "pending",
            attempts: 0,
            aliasesQueried: 0,
            specQuerySource: null,
            specsQueried: [],
            rankingsWritten: 0,
            leaderboardEntriesWritten: 0,
            completionReason: null,
            startedAt: null,
            completedAt: null,
            lastError: null,
            lastErrorAt: null,
            lastActivityAt: new Date(),
          },
        },
      );
      enqueue.requeued = result.modifiedCount ?? 0;
      logger.info(`[CharacterRankingBackfill] Reset ${enqueue.requeued} queue item(s) for a fresh all-spec ranking run`);
    } else if (options.reprocessCompleted === true) {
      const result = await CharacterRankingBackfill.updateMany(
        {
          status: { $in: ["completed", "skipped", "failed"] },
          ...(options.zoneIds?.length ? { zoneId: { $in: options.zoneIds } } : {}),
        },
        {
          $set: {
            status: "pending",
            attempts: 0,
            aliasesQueried: 0,
            specsQueried: [],
            rankingsWritten: 0,
            leaderboardEntriesWritten: 0,
            completionReason: null,
            completedAt: null,
            lastError: null,
            lastErrorAt: null,
            lastActivityAt: new Date(),
          },
        },
      );
      enqueue.requeued = result.modifiedCount ?? 0;
      logger.info(`[CharacterRankingBackfill] Requeued ${enqueue.requeued} completed item(s) to refresh all class specs`);
    }

    if (enqueue.discoverySkipped) {
      logger.info(`[CharacterRankingBackfill] Candidate discovery skipped; ${enqueue.existing} persistent queue items already exist`);
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

  async triggerLeaderboardRebuildFromRankings(): Promise<CharacterRankingLeaderboardRebuildTriggerResult> {
    if (this.leaderboardRebuild.isRunning) {
      return {
        started: false,
        message: "Character leaderboard rebuild is already running",
        status: await this.getStatus(),
      };
    }

    if (this.isRunning) {
      return {
        started: false,
        message: "Character ranking backfill is running; wait for it to finish before rebuilding leaderboards",
        status: await this.getStatus(),
      };
    }

    void this.runLeaderboardRebuildFromRankings().catch((error) => {
      logger.error("[CharacterRankingBackfill] Character leaderboard rebuild crashed:", error);
      this.leaderboardRebuild.isRunning = false;
      this.leaderboardRebuild.completedAt = new Date();
      this.leaderboardRebuild.lastError = error instanceof Error ? error.message : String(error);
      this.leaderboardRebuild.lastMessage = `Rebuild crashed: ${this.leaderboardRebuild.lastError}`;
    });

    return {
      started: true,
      message: "Character leaderboard rebuild started in background",
      status: await this.getStatus(),
    };
  }

  async pruneRankingsWithoutMythicEvidence(): Promise<CharacterRankingMythicEvidenceCleanupResult> {
    if (this.isRunning) {
      throw new Error("Character ranking backfill is running; wait for it to finish before pruning rankings");
    }
    if (this.leaderboardRebuild.isRunning) {
      throw new Error("Character leaderboard rebuild is running; wait for it to finish before pruning rankings");
    }

    logger.info("[CharacterRankingBackfill] Pruning rankings without stored Mythic report ranking evidence");

    const invalidPairs = await this.findPairsWithoutMythicEvidence();
    if (invalidPairs.length === 0) {
      return {
        invalidPairs: 0,
        rankingsDeleted: 0,
        leaderboardEntriesDeleted: 0,
        backfillItemsDeleted: 0,
      };
    }

    let rankingsDeleted = 0;
    let leaderboardEntriesDeleted = 0;
    let backfillItemsDeleted = 0;
    const batchSize = 250;

    for (let index = 0; index < invalidPairs.length; index += batchSize) {
      const batch = invalidPairs.slice(index, index + batchSize);
      const pairConditions = batch.map((pair) => ({
        wclCanonicalCharacterId: pair.wclCanonicalCharacterId,
        classID: pair.classID,
        zoneId: pair.zoneId,
      }));

      const [rankingResult, leaderboardResult, backfillResult] = await Promise.all([
        Ranking.deleteMany({ difficulty: MYTHIC_DIFFICULTY, $or: pairConditions }),
        CharacterLeaderboard.deleteMany({ difficulty: MYTHIC_DIFFICULTY, $or: pairConditions }),
        CharacterRankingBackfill.deleteMany({ $or: pairConditions }),
      ]);

      rankingsDeleted += rankingResult.deletedCount ?? 0;
      leaderboardEntriesDeleted += leaderboardResult.deletedCount ?? 0;
      backfillItemsDeleted += backfillResult.deletedCount ?? 0;
    }

    await Promise.all([cacheService.invalidate(cacheService.getCharacterRankingsOptionsKey()), cacheService.invalidatePattern(/^characters:profile:/)]);

    logger.info(
      `[CharacterRankingBackfill] Pruned ${invalidPairs.length} invalid pairs: ${rankingsDeleted} rankings, ${leaderboardEntriesDeleted} leaderboard entries, ${backfillItemsDeleted} backfill items`,
    );

    return {
      invalidPairs: invalidPairs.length,
      rankingsDeleted,
      leaderboardEntriesDeleted,
      backfillItemsDeleted,
    };
  }

  startProcessing(): boolean {
    if (this.isRunning) {
      return false;
    }

    this.isRunning = true;
    this.isWaitingForRateLimit = false;
    this.stopRequested = false;
    this.lastMessage = "Character ranking backfill processor started";
    logger.info("[CharacterRankingBackfill] Processor started");

    void this.processLoop().catch((error) => {
      logger.error("[CharacterRankingBackfill] Processor crashed:", error);
      this.isRunning = false;
      this.isWaitingForRateLimit = false;
      this.currentItem = null;
      this.lastMessage = `Processor crashed: ${error instanceof Error ? error.message : "Unknown error"}`;
    });

    return true;
  }

  requestStop(): boolean {
    if (!this.isRunning) return false;

    this.stopRequested = true;
    this.lastMessage = "Stopping character ranking backfill after the current WCL request";
    for (const listener of this.stopListeners) listener();
    this.stopListeners.clear();
    logger.warn("[CharacterRankingBackfill] Cooperative stop requested");
    return true;
  }

  async resumeInterruptedBackfill(staleAfterMs = 15 * 60 * 1000): Promise<boolean> {
    if (this.isRunning) return false;

    const staleBefore = new Date(Date.now() - staleAfterMs);
    const reset = await CharacterRankingBackfill.updateMany(
      { status: "in_progress", lastActivityAt: { $lt: staleBefore } },
      {
        $set: {
          status: "pending",
          lastActivityAt: new Date(),
          lastError: "Reset after interrupted backfill run",
          lastErrorAt: new Date(),
        },
      },
    );
    if ((reset.modifiedCount ?? 0) > 0) {
      logger.warn(`[CharacterRankingBackfill] Reset ${reset.modifiedCount} stale in-progress item(s) back to pending`);
    }

    const pending = await CharacterRankingBackfill.countDocuments({ status: "pending" });
    return pending > 0 ? this.startProcessing() : false;
  }

  async enqueueMissingItems(): Promise<CharacterRankingBackfillEnqueueResult> {
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    logger.info("[CharacterRankingBackfill] Discovering character/raid candidates from stored Mythic report ranking appearances");

    const raids = await Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name -_id").lean();
    const raidNameById = new Map(raids.map((raid) => [raid.id, raid.name]));

    const rows = await CharacterReportAppearance.aggregate<CandidateAggregateRow>([
      {
        $match: {
          wclCanonicalCharacterId: { $type: "number" },
          reportZoneId: { $in: TRACKED_RAIDS },
          characterId: { $ne: null },
          hidden: { $ne: true },
          appearanceSource: "reportRankings",
          rankingFightIds: { $exists: true, $ne: [] },
        },
      },
      { $sort: { reportStartTime: 1 } },
      {
        $group: {
          _id: {
            wclCanonicalCharacterId: "$wclCanonicalCharacterId",
            classID: "$classID",
            zoneId: "$reportZoneId",
          },
          characterId: { $last: "$characterId" },
          wclCanonicalCharacterId: { $last: "$wclCanonicalCharacterId" },
          name: { $last: "$characterName" },
          realm: { $last: "$characterRealm" },
          region: { $last: "$characterRegion" },
          classID: { $last: "$classID" },
          zoneId: { $last: "$reportZoneId" },
          appearanceCount: { $sum: 1 },
          reportCodes: { $addToSet: "$reportCode" },
          rankingFightIdLists: { $push: "$rankingFightIds" },
          firstSeenAt: { $min: "$reportStartTime" },
          lastSeenAt: { $max: "$reportStartTime" },
        },
      },
      {
        $project: {
          _id: 0,
          characterId: 1,
          wclCanonicalCharacterId: 1,
          name: 1,
          realm: 1,
          region: 1,
          classID: 1,
          zoneId: 1,
          appearanceCount: 1,
          reportCount: { $size: "$reportCodes" },
          mythicFightCount: {
            $sum: {
              $map: {
                input: "$rankingFightIdLists",
                as: "fightIds",
                in: { $size: { $ifNull: ["$$fightIds", []] } },
              },
            },
          },
          mythicKillCount: { $literal: 0 },
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
      },
    ]).allowDiskUse(true);

    logger.info(`[CharacterRankingBackfill] Candidate discovery found ${rows.length} canonical Mythic character/raid pairs (${elapsed()})`);

    const observedSpecRows = await CharacterReportAppearance.aggregate<{
      _id: { wclCanonicalCharacterId: number; classID: number; zoneId: number };
      observedSpecNameLists: string[][];
      reportRankingAppearanceCount: number;
      rankingFightIdCount: number;
    }>([
      {
        $match: {
          wclCanonicalCharacterId: { $type: "number" },
          reportZoneId: { $in: TRACKED_RAIDS },
          hidden: { $ne: true },
          appearanceSource: "reportRankings",
          rankingFightIds: { $exists: true, $ne: [] },
        },
      },
      {
        $group: {
          _id: {
            wclCanonicalCharacterId: "$wclCanonicalCharacterId",
            classID: "$classID",
            zoneId: "$reportZoneId",
          },
          observedSpecNameLists: { $addToSet: "$specNames" },
          reportRankingAppearanceCount: { $sum: { $cond: [{ $eq: ["$appearanceSource", "reportRankings"] }, 1, 0] } },
          rankingFightIdCount: { $sum: { $size: { $ifNull: ["$rankingFightIds", []] } } },
        },
      },
    ]).allowDiskUse(true);
    const observedSpecByKey = new Map(observedSpecRows.map((row) => [`${row._id.wclCanonicalCharacterId}:${row._id.classID}:${row._id.zoneId}`, row]));
    logger.info(`[CharacterRankingBackfill] Loaded observed spec evidence for ${observedSpecRows.length} character/raid pairs (${elapsed()})`);

    const canonicalIds = [...new Set(rows.map((row) => row.wclCanonicalCharacterId))];
    const classIds = [...new Set(rows.map((row) => row.classID))];
    const characters = await Character.find({
      wclCanonicalCharacterId: { $in: canonicalIds },
      classID: { $in: classIds },
    })
      .select("_id wclCanonicalCharacterId name realm region classID")
      .lean();

    const characterByKey = new Map<string, (typeof characters)[number]>();
    for (const character of characters) {
      characterByKey.set(`${character.wclCanonicalCharacterId}:${character.classID}`, character);
    }

    const operations: any[] = [];
    let skippedWithoutCharacter = 0;

    for (const row of rows) {
      const character = characterByKey.get(`${row.wclCanonicalCharacterId}:${row.classID}`);
      if (!character) {
        skippedWithoutCharacter += 1;
        continue;
      }

      const observedSpecEvidence = observedSpecByKey.get(`${row.wclCanonicalCharacterId}:${row.classID}:${row.zoneId}`);
      const observedSpecNames = this.flattenObservedSpecNames(observedSpecEvidence?.observedSpecNameLists);
      operations.push({
        updateOne: {
          filter: {
            wclCanonicalCharacterId: row.wclCanonicalCharacterId,
            classID: row.classID,
            zoneId: row.zoneId,
          },
          update: {
            $set: {
              characterId: character._id,
              name: character.name,
              realm: character.realm,
              region: character.region,
              classID: character.classID,
              raidName: raidNameById.get(row.zoneId) ?? null,
              source: "raid_participation",
              observedSpecNames,
              evidence: {
                appearanceCount: row.appearanceCount,
                reportCount: row.reportCount,
                mythicFightCount: observedSpecEvidence?.rankingFightIdCount ?? 0,
                mythicKillCount: 0,
                firstSeenAt: row.firstSeenAt,
                lastSeenAt: row.lastSeenAt,
              },
              lastActivityAt: new Date(),
            },
            $setOnInsert: {
              wclCanonicalCharacterId: row.wclCanonicalCharacterId,
              zoneId: row.zoneId,
              status: "pending",
              priority: 20,
              attempts: 0,
              maxAttempts: 3,
              aliasesQueried: 0,
              specQuerySource: null,
              specsQueried: [],
              rankingsWritten: 0,
              leaderboardEntriesWritten: 0,
              completionReason: null,
              lastError: null,
              lastErrorAt: null,
              startedAt: null,
              completedAt: null,
            },
          },
          upsert: true,
        },
      });
    }

    let queued = 0;
    let updated = 0;
    const batchSize = 1000;
    for (let index = 0; index < operations.length; index += batchSize) {
      const result = await CharacterRankingBackfill.bulkWrite(operations.slice(index, index + batchSize), { ordered: false });
      queued += result.upsertedCount ?? 0;
      updated += result.modifiedCount ?? 0;
    }

    const existing = operations.length - queued;
    logger.info(
      `[CharacterRankingBackfill] Enqueue complete: ${queued} new, ${existing} existing, ${updated} updated, ${skippedWithoutCharacter} skipped without Character document (${elapsed()})`,
    );

    return {
      candidates: rows.length,
      queued,
      existing,
      updated,
      skippedWithoutCharacter,
      discoverySkipped: false,
      requeued: 0,
    };
  }

  async getStatus(): Promise<CharacterRankingBackfillStatusResponse> {
    const stats = await CharacterRankingBackfill.aggregate<{
      _id: CharacterRankingBackfillStatus;
      count: number;
      aliasesQueried: number;
      rankingsWritten: number;
      leaderboardEntriesWritten: number;
    }>([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          aliasesQueried: { $sum: "$aliasesQueried" },
          rankingsWritten: { $sum: "$rankingsWritten" },
          leaderboardEntriesWritten: { $sum: "$leaderboardEntriesWritten" },
        },
      },
    ]);

    const queue = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      terminal: 0,
      aliasesQueried: 0,
      observedSpecItems: 0,
      fallbackSpecItems: 0,
      rankingsWritten: 0,
      leaderboardEntriesWritten: 0,
    };

    for (const row of stats) {
      const count = row.count ?? 0;
      if (row._id === "pending") queue.pending = count;
      if (row._id === "in_progress") queue.inProgress = count;
      if (row._id === "completed") queue.completed = count;
      if (row._id === "skipped") queue.skipped = count;
      if (row._id === "failed") queue.failed = count;
      queue.total += count;
      queue.aliasesQueried += row.aliasesQueried ?? 0;
      queue.rankingsWritten += row.rankingsWritten ?? 0;
      queue.leaderboardEntriesWritten += row.leaderboardEntriesWritten ?? 0;
    }
    queue.terminal = queue.completed + queue.skipped + queue.failed;

    const [dbCurrentItem, recentFailures, specSelectionRows] = await Promise.all([
      CharacterRankingBackfill.findOne({ status: "in_progress" }).sort({ lastActivityAt: -1 }).lean<ICharacterRankingBackfill>(),
      CharacterRankingBackfill.find({ status: "failed" }).sort({ lastErrorAt: -1 }).limit(5).lean<ICharacterRankingBackfill[]>(),
      CharacterRankingBackfill.aggregate<{ _id: "observed" | "fallback"; count: number }>([
        { $match: { specQuerySource: { $in: ["observed", "fallback"] } } },
        { $group: { _id: "$specQuerySource", count: { $sum: 1 } } },
      ]),
    ]);

    for (const row of specSelectionRows) {
      if (row._id === "observed") queue.observedSpecItems = row.count;
      if (row._id === "fallback") queue.fallbackSpecItems = row.count;
    }

    return {
      processor: {
        isRunning: this.isRunning,
        isWaitingForRateLimit: this.isWaitingForRateLimit,
        stopRequested: this.stopRequested,
        currentItem: this.currentItem ?? (dbCurrentItem ? summarizeItem(dbCurrentItem) : null),
        lastMessage: this.lastMessage,
      },
      leaderboardRebuild: { ...this.leaderboardRebuild },
      queue,
      recentFailures: recentFailures.map((item) => summarizeItem(item)),
      updatedAt: new Date(),
    };
  }

  private async runLeaderboardRebuildFromRankings(): Promise<void> {
    this.leaderboardRebuild = {
      isRunning: true,
      startedAt: new Date(),
      completedAt: null,
      totalPairs: 0,
      processedPairs: 0,
      writtenEntries: 0,
      lastMessage: "Discovering character/raid ranking pairs",
      lastError: null,
    };

    logger.info("[CharacterRankingBackfill] Rebuilding character leaderboards from stored rankings");
    const taskId = await taskTracker.start(LEADERBOARD_REBUILD_TASK_NAME);

    try {
      const pairs = await Ranking.aggregate<{ _id: { characterId: mongoose.Types.ObjectId; zoneId: number } }>([
        {
          $group: {
            _id: {
              characterId: "$characterId",
              zoneId: "$zoneId",
            },
          },
        },
        { $sort: { "_id.zoneId": -1 } },
      ]).allowDiskUse(true);

      this.leaderboardRebuild.totalPairs = pairs.length;
      this.leaderboardRebuild.lastMessage = `Rebuilding ${pairs.length} character/raid leaderboard pairs`;
      logger.info(`[CharacterRankingBackfill] Character leaderboard rebuild found ${pairs.length} character/raid pairs`);

      for (const pair of pairs) {
        const count = await this.rebuildLeaderboardForCharacterZone(pair._id.characterId, pair._id.zoneId, false);
        this.leaderboardRebuild.processedPairs += 1;
        this.leaderboardRebuild.writtenEntries += count;

        if (this.leaderboardRebuild.processedPairs % 100 === 0 || this.leaderboardRebuild.processedPairs === pairs.length) {
          this.leaderboardRebuild.lastMessage = `Rebuilt ${this.leaderboardRebuild.processedPairs}/${pairs.length} character/raid pairs`;
          logger.info(
            `[CharacterRankingBackfill] Character leaderboard rebuild progress ${this.leaderboardRebuild.processedPairs}/${pairs.length}, entries=${this.leaderboardRebuild.writtenEntries}`,
          );
        }
      }

      await cacheService.invalidate(cacheService.getCharacterRankingsOptionsKey());

      this.leaderboardRebuild.isRunning = false;
      this.leaderboardRebuild.completedAt = new Date();
      this.leaderboardRebuild.lastMessage = `Rebuild complete: ${this.leaderboardRebuild.processedPairs} pairs, ${this.leaderboardRebuild.writtenEntries} leaderboard entries`;
      logger.info(`[CharacterRankingBackfill] ${this.leaderboardRebuild.lastMessage}`);
      await taskTracker.complete(taskId, {
        totalPairs: this.leaderboardRebuild.totalPairs,
        processedPairs: this.leaderboardRebuild.processedPairs,
        writtenEntries: this.leaderboardRebuild.writtenEntries,
      });
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async findPairsWithoutMythicEvidence(): Promise<Array<{ wclCanonicalCharacterId: number; classID: number; zoneId: number }>> {
    const byKey = new Map<string, { wclCanonicalCharacterId: number; classID: number; zoneId: number }>();
    const rankingPairs = await Ranking.aggregate<{ wclCanonicalCharacterId: number; classID: number; zoneId: number }>(
      this.buildPairsWithoutMythicEvidencePipeline({
        difficulty: MYTHIC_DIFFICULTY,
        zoneId: { $in: TRACKED_RAIDS },
        wclCanonicalCharacterId: { $type: "number" },
      }),
    ).allowDiskUse(true);
    const leaderboardPairs = await CharacterLeaderboard.aggregate<{ wclCanonicalCharacterId: number; classID: number; zoneId: number }>(
      this.buildPairsWithoutMythicEvidencePipeline({
        difficulty: MYTHIC_DIFFICULTY,
        zoneId: { $in: TRACKED_RAIDS },
        wclCanonicalCharacterId: { $type: "number" },
      }),
    ).allowDiskUse(true);
    const backfillPairs = await CharacterRankingBackfill.aggregate<{ wclCanonicalCharacterId: number; classID: number; zoneId: number }>(
      this.buildPairsWithoutMythicEvidencePipeline({
        zoneId: { $in: TRACKED_RAIDS },
        wclCanonicalCharacterId: { $type: "number" },
      }),
    ).allowDiskUse(true);

    for (const pair of [...rankingPairs, ...leaderboardPairs, ...backfillPairs]) {
      byKey.set(`${pair.wclCanonicalCharacterId}:${pair.classID}:${pair.zoneId}`, pair);
    }

    return [...byKey.values()];
  }

  private buildPairsWithoutMythicEvidencePipeline(match: Record<string, unknown>): any[] {
    return [
      { $match: match },
      {
        $group: {
          _id: {
            wclCanonicalCharacterId: "$wclCanonicalCharacterId",
            classID: "$classID",
            zoneId: "$zoneId",
          },
        },
      },
      {
        $lookup: {
          from: "characterreportappearances",
          let: {
            canonicalId: "$_id.wclCanonicalCharacterId",
            classId: "$_id.classID",
            zoneId: "$_id.zoneId",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$wclCanonicalCharacterId", "$$canonicalId"] },
                    { $eq: ["$classID", "$$classId"] },
                    { $eq: ["$reportZoneId", "$$zoneId"] },
                    { $eq: ["$appearanceSource", "reportRankings"] },
                    { $ne: ["$hidden", true] },
                    { $gt: [{ $size: { $ifNull: ["$rankingFightIds", []] } }, 0] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "mythicEvidence",
        },
      },
      { $match: { mythicEvidence: { $size: 0 } } },
      {
        $project: {
          _id: 0,
          wclCanonicalCharacterId: "$_id.wclCanonicalCharacterId",
          classID: "$_id.classID",
          zoneId: "$_id.zoneId",
        },
      },
    ];
  }

  private async resetInterruptedItems(): Promise<void> {
    const result = await CharacterRankingBackfill.updateMany(
      { status: "in_progress" },
      {
        $set: {
          status: "pending",
          lastActivityAt: new Date(),
          lastError: "Reset after interrupted backfill run",
          lastErrorAt: new Date(),
        },
      },
    );

    if ((result.modifiedCount ?? 0) > 0) {
      logger.warn(`[CharacterRankingBackfill] Reset ${result.modifiedCount} interrupted in-progress items back to pending`);
    }
  }

  private async processLoop(): Promise<void> {
    let processedThisRun = 0;
    let taskId = "";
    try {
      taskId = await taskTracker.start(TASK_NAME);

      while (this.isRunning && !this.stopRequested) {
        const item = await CharacterRankingBackfill.findOneAndUpdate(
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
          {
            sort: { priority: 1, createdAt: 1 },
            new: true,
          },
        );

        if (!item) {
          this.lastMessage = `Character ranking backfill complete; processed ${processedThisRun} items this run`;
          logger.info(`[CharacterRankingBackfill] No pending items remain; processed ${processedThisRun} items this run`);
          break;
        }

        this.currentItem = summarizeItem(item);
        processedThisRun += 1;

        try {
          const specQueries = this.buildSpecQueries(item);
          const estimatedPoints = specQueries.length > 0 ? Math.max(ESTIMATED_POINTS_PER_RANKING_ALIAS, specQueries.length * ESTIMATED_POINTS_PER_RANKING_ALIAS) : 0;

          logger.info(
            `[CharacterRankingBackfill] Processing ${item.name}-${item.realm} zone ${item.zoneId} (${item.raidName ?? "unknown raid"}), attempt ${item.attempts}/${item.maxAttempts}, aliases=${specQueries.length}, specs=${this.describeSpecQueries(specQueries)}`,
          );

          if (estimatedPoints > 0) {
            await this.waitForBackgroundCapacity(estimatedPoints, `${item.name}-${item.realm} zone ${item.zoneId}`);
          }
          const outcome = await this.processItem(item, specQueries);

          await CharacterRankingBackfill.findByIdAndUpdate(item._id, {
            $set: {
              status: outcome.status,
              aliasesQueried: outcome.aliasesQueried,
              specQuerySource: outcome.specQuerySource,
              specsQueried: outcome.specsQueried,
              rankingsWritten: outcome.rankingsWritten,
              leaderboardEntriesWritten: outcome.leaderboardEntriesWritten,
              completionReason: outcome.reason,
              completedAt: new Date(),
              lastActivityAt: new Date(),
              lastError: null,
              lastErrorAt: null,
            },
          });

          logger.info(
            `[CharacterRankingBackfill] ${outcome.status === "completed" ? "Completed" : "Skipped"} ${item.name}-${item.realm} zone ${item.zoneId}: ${outcome.reason}, rankings=${outcome.rankingsWritten}, leaderboardEntries=${outcome.leaderboardEntriesWritten}`,
          );
        } catch (error) {
          if (error instanceof RankingBackfillStopRequestedError) {
            await CharacterRankingBackfill.findByIdAndUpdate(item._id, {
              $set: {
                status: "pending",
                startedAt: null,
                lastActivityAt: new Date(),
                completionReason: "Returned to pending after a cooperative stop",
              },
              $inc: { attempts: -1 },
            });
            this.lastMessage = "Character ranking backfill stopped; the claimed item was returned to pending";
            break;
          }
          await this.handleItemError(item, error);
        } finally {
          this.currentItem = null;
        }

        if (processedThisRun % PROCESS_LOG_INTERVAL === 0) {
          const status = await this.getStatus();
          logger.info(
            `[CharacterRankingBackfill] Progress: runProcessed=${processedThisRun}, pending=${status.queue.pending}, inProgress=${status.queue.inProgress}, completed=${status.queue.completed}, skipped=${status.queue.skipped}, failed=${status.queue.failed}, rankingsWritten=${status.queue.rankingsWritten}`,
          );
        }
      }
      await taskTracker.complete(taskId, { processedThisRun, stopped: this.stopRequested });
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      const stopped = this.stopRequested;
      this.isRunning = false;
      this.isWaitingForRateLimit = false;
      this.currentItem = null;
      this.stopRequested = false;
      if (stopped) this.lastMessage = `Character ranking backfill stopped after processing ${processedThisRun} item(s) this run`;
    }
  }

  private async waitForBackgroundCapacity(estimatedPoints: number, label: string): Promise<void> {
    while (true) {
      if (this.stopRequested) throw new RankingBackfillStopRequestedError();
      await rateLimitService.refreshSharedState();
      const capacity = rateLimitService.getBackgroundCapacity();
      if (rateLimitService.canProceedBackground() && capacity >= estimatedPoints) {
        this.isWaitingForRateLimit = false;
        return;
      }

      const status = await rateLimitService.getSharedStatus();
      this.isWaitingForRateLimit = true;
      this.lastMessage = `Waiting for WCL rate limit reset before ${label}; background capacity ${Math.floor(capacity)} points, need ${estimatedPoints}, reset in ${status.resetInSeconds}s`;
      logger.info(`[CharacterRankingBackfill] ${this.lastMessage}`);
      const resetCompleted = await this.waitForRateLimitResetOrStop();
      if (!resetCompleted) throw new RankingBackfillStopRequestedError();
    }
  }

  private async waitForRateLimitResetOrStop(): Promise<boolean> {
    if (this.stopRequested) return false;

    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        this.stopListeners.delete(onStop);
        resolve(value);
      };
      const onStop = () => finish(false);
      this.stopListeners.add(onStop);

      void rateLimitService.waitForReset().then(
        () => finish(true),
        (error) => {
          if (settled) return;
          settled = true;
          this.stopListeners.delete(onStop);
          reject(error);
        },
      );
    });
  }

  private async processItem(item: ICharacterRankingBackfill, specQueries: SpecQuery[]): Promise<ProcessOutcome> {
    const specQuerySource = specQueries[0]?.source ?? null;
    const specsQueried = Array.from(new Set(specQueries.map((query) => query.specSlug))).sort((a, b) => a.localeCompare(b));

    if (specQueries.length === 0) {
      return {
        status: "skipped",
        reason: "No known specs for character class",
        aliasesQueried: 0,
        specQuerySource,
        specsQueried,
        rankingsWritten: 0,
        leaderboardEntriesWritten: 0,
      };
    }

    const query = this.buildWclQuery(specQueries);
    const result = await wclService.query<WclCharacterRankingsResponse>(
      query,
      {
        characterId: item.wclCanonicalCharacterId,
        zoneID: item.zoneId,
      },
      false,
      2,
    );

    const character = result.characterData?.character;
    if (!character) {
      return {
        status: "skipped",
        reason: "WCL character not found by canonical ID",
        aliasesQueried: specQueries.length,
        specQuerySource,
        specsQueried,
        rankingsWritten: 0,
        leaderboardEntriesWritten: 0,
      };
    }

    if (character.hidden) {
      await Character.findByIdAndUpdate(item.characterId, { wclProfileHidden: true }).catch(() => undefined);
      return {
        status: "skipped",
        reason: "WCL character profile is hidden",
        aliasesQueried: specQueries.length,
        specQuerySource,
        specsQueried,
        rankingsWritten: 0,
        leaderboardEntriesWritten: 0,
      };
    }

    const operations: any[] = [];

    for (const specQuery of specQueries) {
      const zoneRankings = character[specQuery.alias] as WclZoneRankings | null | undefined;
      if (!zoneRankings || zoneRankings.error) {
        continue;
      }

      for (const ranking of zoneRankings.rankings ?? []) {
        if (!this.isMeaningfulRanking(ranking)) {
          continue;
        }

        const encounterId = toFiniteNumber(ranking.encounter?.id, 0);
        if (encounterId <= 0) {
          continue;
        }

        const rankingSpecSlug = ranking.spec ? slugifySpecName(ranking.spec) : specQuery.specSlug;
        const bestSpecName = ranking.bestSpec ? slugifySpecName(ranking.bestSpec) : rankingSpecSlug;
        const role = resolveRole(item.classID, rankingSpecSlug);
        const partition = this.resolveRankingPartition(ranking, zoneRankings);
        const canonicalId = typeof character.canonicalID === "number" ? character.canonicalID : item.wclCanonicalCharacterId;

        operations.push({
          updateOne: {
            filter: {
              characterId: item.characterId,
              zoneId: item.zoneId,
              difficulty: MYTHIC_DIFFICULTY,
              partition,
              "encounter.id": encounterId,
              specName: rankingSpecSlug,
              metric: specQuery.metric,
            },
            update: {
              $set: {
                characterId: item.characterId,
                wclCanonicalCharacterId: canonicalId,
                name: item.name,
                realm: item.realm,
                region: item.region,
                classID: item.classID,
                zoneId: item.zoneId,
                difficulty: MYTHIC_DIFFICULTY,
                partition,
                encounter: {
                  id: encounterId,
                  name: ranking.encounter?.name || `Encounter ${encounterId}`,
                },
                specName: rankingSpecSlug,
                role,
                bestSpecName,
                metric: specQuery.metric,
                rankPercent: toFiniteNumber(ranking.rankPercent, 0),
                medianPercent: toFiniteNumber(ranking.medianPercent, 0),
                lockedIn: ranking.lockedIn === true,
                totalKills: toFiniteNumber(ranking.totalKills, 0),
                bestAmount: toFiniteNumber(ranking.bestAmount, 0),
                allStars: {
                  points: toFiniteNumber(ranking.allStars?.points, 0),
                  possiblePoints: toFiniteNumber(ranking.allStars?.possiblePoints, 0),
                },
                ilvl: isFinitePositive(ranking.bestRank?.ilvl) ? toFiniteNumber(ranking.bestRank?.ilvl, 0) : undefined,
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (operations.length === 0) {
      return {
        status: "skipped",
        reason: "No meaningful mythic rankings returned",
        aliasesQueried: specQueries.length,
        specQuerySource,
        specsQueried,
        rankingsWritten: 0,
        leaderboardEntriesWritten: 0,
      };
    }

    await Ranking.bulkWrite(operations, { ordered: false });
    const leaderboardEntriesWritten = await this.rebuildLeaderboardForCharacterZone(item.characterId, item.zoneId);

    return {
      status: "completed",
      reason: "Rankings fetched and stored",
      aliasesQueried: specQueries.length,
      specQuerySource,
      specsQueried,
      rankingsWritten: operations.length,
      leaderboardEntriesWritten,
    };
  }

  private async handleItemError(item: ICharacterRankingBackfill, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = item.attempts || 1;
    const maxAttempts = item.maxAttempts || 3;
    const nextStatus: CharacterRankingBackfillStatus = attempts >= maxAttempts ? "failed" : "pending";

    await CharacterRankingBackfill.findByIdAndUpdate(item._id, {
      $set: {
        status: nextStatus,
        lastError: message.slice(0, 2000),
        lastErrorAt: new Date(),
        lastActivityAt: new Date(),
        completionReason: nextStatus === "failed" ? `Failed after ${attempts} attempts` : `Retry queued after attempt ${attempts}`,
      },
    });

    if (nextStatus === "failed") {
      logger.error(`[CharacterRankingBackfill] Failed ${item.name}-${item.realm} zone ${item.zoneId} after ${attempts}/${maxAttempts} attempts: ${message}`);
    } else {
      logger.warn(`[CharacterRankingBackfill] Error processing ${item.name}-${item.realm} zone ${item.zoneId}; retrying (${attempts}/${maxAttempts}): ${message}`);
    }
  }

  private buildSpecQueries(item: ICharacterRankingBackfill): SpecQuery[] {
    const specsByWclName = new Map<string, { specSlug: string; wclName: string; role: Role; source: SpecQuery["source"] }>();
    const classSpecMap = ROLE_BY_CLASS_AND_SPEC[item.classID] ?? {};
    const observedSpecSlugs = new Set<string>();

    for (const observedSpecName of item.observedSpecNames ?? []) {
      const specSlug = normalizeObservedSpecSlug(observedSpecName, classSpecMap);
      if (!specSlug) continue;
      observedSpecSlugs.add(specSlug);
      const wclName = toWclSpecName(specSlug);
      if (!wclName) continue;
      specsByWclName.set(wclName.toLowerCase(), {
        specSlug,
        wclName,
        role: classSpecMap[specSlug] ?? resolveRole(item.classID, specSlug),
        source: "observed",
      });
    }

    for (const [specSlug, role] of Object.entries(classSpecMap)) {
      const wclName = toWclSpecName(specSlug);
      specsByWclName.set(wclName.toLowerCase(), {
        specSlug,
        wclName,
        role,
        source: observedSpecSlugs.has(specSlug) ? "observed" : "fallback",
      });
    }

    const queries: SpecQuery[] = [];
    for (const spec of specsByWclName.values()) {
      queries.push({
        ...spec,
        metric: "dps",
        alias: toSpecAlias(spec.specSlug, "dps"),
      });
      if (spec.role === "healer") {
        queries.push({
          ...spec,
          metric: "hps",
          alias: toSpecAlias(spec.specSlug, "hps"),
        });
      }
    }

    return queries;
  }

  private describeSpecQueries(specQueries: SpecQuery[]): string {
    if (specQueries.length === 0) return "none";

    const bySpec = new Map<string, { source: SpecQuery["source"]; metrics: RankingMetric[] }>();
    for (const specQuery of specQueries) {
      const existing = bySpec.get(specQuery.specSlug) ?? { source: specQuery.source, metrics: [] };
      existing.metrics.push(specQuery.metric);
      bySpec.set(specQuery.specSlug, existing);
    }

    return Array.from(bySpec.entries())
      .map(([spec, entry]) => `${spec}:${entry.metrics.join("+")}@${entry.source}`)
      .join(",");
  }

  private buildWclQuery(specQueries: SpecQuery[]): string {
    const specAliasFields = specQueries.map((specQuery) => {
      return `${specQuery.alias}: zoneRankings(zoneID: $zoneID, difficulty: ${MYTHIC_DIFFICULTY}, metric: ${specQuery.metric}, compare: Rankings, timeframe: Historical, partition: ${ALL_PARTITIONS}, specName: "${specQuery.wclName}")`;
    });

    return `
      query($characterId: Int!, $zoneID: Int!) {
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
            ${specAliasFields.join("\n            ")}
          }
        }
      }
    `;
  }

  private isMeaningfulRanking(ranking: WclRanking): boolean {
    return (
      isFinitePositive(ranking.bestAmount) ||
      isFinitePositive(ranking.rankPercent) ||
      isFinitePositive(ranking.medianPercent) ||
      isFinitePositive(ranking.totalKills) ||
      isFinitePositive(ranking.allStars?.points)
    );
  }

  private resolveRankingPartition(ranking: WclRanking, zoneRankings: WclZoneRankings): number {
    const allStarsPartition = toFiniteNumber(ranking.allStars?.partition, 0);
    if (allStarsPartition > 0) return allStarsPartition;

    const payloadPartition = toFiniteNumber(zoneRankings.partition, 0);
    if (payloadPartition > 0) return payloadPartition;

    return 1;
  }

  private flattenObservedSpecNames(specNameLists?: string[][]): string[] {
    const unique = new Set<string>();
    for (const list of specNameLists ?? []) {
      for (const specName of list ?? []) {
        const trimmed = String(specName || "").trim();
        if (trimmed) unique.add(trimmed);
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }

  private async rebuildLeaderboardForCharacterZone(characterId: mongoose.Types.ObjectId, zoneId: number, invalidateOptions = true): Promise<number> {
    const characterObjectId = new mongoose.Types.ObjectId(String(characterId));
    const guild = (await getPrimaryCharacterRaidGuilds(zoneId, [characterObjectId])).get(String(characterObjectId));
    const guildName = guild?.name ?? null;
    const guildRealm = guild?.realm ?? null;

    const baseMatch = {
      characterId: characterObjectId,
      zoneId,
      difficulty: MYTHIC_DIFFICULTY,
      metric: { $ne: null },
    };

    const [bossByPartition, bossAllPartitions, allStarsByPartition, allStarsAllPartitions] = await Promise.all([
      Ranking.aggregate([
        { $match: { ...baseMatch, bestAmount: { $gt: 0 } } },
        { $sort: { bestAmount: -1, rankPercent: -1, totalKills: -1, partition: -1 } },
        {
          $group: {
            _id: { encounterId: "$encounter.id", partition: "$partition", metric: "$metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            bestSpecName: { $first: "$bestSpecName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            ilvl: { $first: "$ilvl" },
            bestAmount: { $first: "$bestAmount" },
            encounterName: { $first: "$encounter.name" },
            rankPercent: { $first: "$rankPercent" },
            medianPercent: { $first: "$medianPercent" },
            lockedIn: { $first: "$lockedIn" },
            totalKills: { $first: "$totalKills" },
            partition: { $first: "$partition" },
            updatedAt: { $first: "$updatedAt" },
          },
        },
      ]),
      Ranking.aggregate([
        { $match: { ...baseMatch, bestAmount: { $gt: 0 } } },
        { $sort: { bestAmount: -1, rankPercent: -1, totalKills: -1, partition: -1 } },
        {
          $group: {
            _id: { encounterId: "$encounter.id", metric: "$metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            bestSpecName: { $first: "$bestSpecName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            ilvl: { $first: "$ilvl" },
            bestAmount: { $first: "$bestAmount" },
            encounterName: { $first: "$encounter.name" },
            rankPercent: { $first: "$rankPercent" },
            medianPercent: { $first: "$medianPercent" },
            lockedIn: { $first: "$lockedIn" },
            totalKills: { $first: "$totalKills" },
            partition: { $first: "$partition" },
            updatedAt: { $first: "$updatedAt" },
          },
        },
      ]),
      Ranking.aggregate([
        {
          $match: {
            ...baseMatch,
            $or: [{ "allStars.points": { $gt: 0 } }, { bestAmount: { $gt: 0 } }, { rankPercent: { $gt: 0 } }, { totalKills: { $gt: 0 } }],
          },
        },
        { $sort: { "allStars.points": -1, rankPercent: -1, bestAmount: -1, totalKills: -1, partition: -1 } },
        {
          $group: {
            _id: { encounterId: "$encounter.id", partition: "$partition", metric: "$metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            points: { $first: "$allStars.points" },
            possiblePoints: { $first: "$allStars.possiblePoints" },
            ilvl: { $first: "$ilvl" },
            rankPercent: { $first: "$rankPercent" },
            medianPercent: { $first: "$medianPercent" },
            partition: { $first: "$partition" },
            updatedAt: { $first: "$updatedAt" },
          },
        },
        {
          $group: {
            _id: { partition: "$_id.partition", metric: "$_id.metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            points: { $sum: "$points" },
            possiblePoints: { $sum: "$possiblePoints" },
            ilvl: { $first: "$ilvl" },
            rankPercent: { $max: "$rankPercent" },
            medianPercent: { $max: "$medianPercent" },
            partition: { $first: "$partition" },
            updatedAt: { $max: "$updatedAt" },
            bossScores: {
              $push: {
                encounterId: "$_id.encounterId",
                points: "$points",
                rankPercent: "$rankPercent",
                specName: "$specName",
              },
            },
          },
        },
        { $match: { points: { $gt: 0 } } },
      ]),
      Ranking.aggregate([
        {
          $match: {
            ...baseMatch,
            $or: [{ "allStars.points": { $gt: 0 } }, { bestAmount: { $gt: 0 } }, { rankPercent: { $gt: 0 } }, { totalKills: { $gt: 0 } }],
          },
        },
        { $sort: { "allStars.points": -1, rankPercent: -1, bestAmount: -1, totalKills: -1, partition: -1 } },
        {
          $group: {
            _id: { encounterId: "$encounter.id", metric: "$metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            points: { $first: "$allStars.points" },
            possiblePoints: { $first: "$allStars.possiblePoints" },
            ilvl: { $first: "$ilvl" },
            rankPercent: { $first: "$rankPercent" },
            medianPercent: { $first: "$medianPercent" },
            updatedAt: { $first: "$updatedAt" },
          },
        },
        {
          $group: {
            _id: { metric: "$_id.metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            points: { $sum: "$points" },
            possiblePoints: { $sum: "$possiblePoints" },
            ilvl: { $first: "$ilvl" },
            rankPercent: { $max: "$rankPercent" },
            medianPercent: { $max: "$medianPercent" },
            updatedAt: { $max: "$updatedAt" },
            bossScores: {
              $push: {
                encounterId: "$_id.encounterId",
                points: "$points",
                rankPercent: "$rankPercent",
                specName: "$specName",
              },
            },
          },
        },
        { $match: { points: { $gt: 0 } } },
      ]),
    ]);

    const entries: any[] = [];

    for (const row of bossByPartition) {
      entries.push(this.toBossLeaderboardEntry(row, zoneId, row.partition, row.partition, guildName, guildRealm));
    }

    for (const row of bossAllPartitions) {
      entries.push(this.toBossLeaderboardEntry(row, zoneId, null, row.partition, guildName, guildRealm));
    }

    for (const row of allStarsByPartition) {
      entries.push(this.toAllStarsLeaderboardEntry(row, zoneId, row.partition, row.partition, guildName, guildRealm));
    }

    for (const row of allStarsAllPartitions) {
      entries.push(this.toAllStarsLeaderboardEntry(row, zoneId, null, 0, guildName, guildRealm));
    }

    const deduped = new Map<string, any>();
    for (const entry of entries) {
      const key = `${entry.zoneId}|${entry.difficulty}|${entry.type}|${entry.encounterId}|${entry.partition}|${entry.metric}|${entry.characterId}`;
      const existing = deduped.get(key);
      if (!existing || entry.score > existing.score) {
        deduped.set(key, entry);
      }
    }

    const dedupedEntries = [...deduped.values()];
    await CharacterLeaderboard.deleteMany({
      characterId: characterObjectId,
      zoneId,
      difficulty: MYTHIC_DIFFICULTY,
    });

    if (dedupedEntries.length > 0) {
      await CharacterLeaderboard.bulkWrite(
        dedupedEntries.map((entry) => ({
          replaceOne: {
            filter: this.toLeaderboardUniqueFilter(entry),
            replacement: entry,
            upsert: true,
          },
        })),
        { ordered: false },
      );
      if (invalidateOptions) {
        await cacheService.invalidate(cacheService.getCharacterRankingsOptionsKey());
      }
    }

    return dedupedEntries.length;
  }

  private toLeaderboardUniqueFilter(entry: any): Record<string, unknown> {
    return {
      zoneId: entry.zoneId,
      difficulty: entry.difficulty,
      type: entry.type,
      encounterId: entry.encounterId,
      partition: entry.partition,
      metric: entry.metric,
      characterId: entry.characterId,
    };
  }

  private toBossLeaderboardEntry(row: any, zoneId: number, partition: number | null, sourcePartition: number, guildName: string | null, guildRealm: string | null): any {
    return {
      zoneId,
      difficulty: MYTHIC_DIFFICULTY,
      type: "boss",
      encounterId: row._id.encounterId,
      partition,
      metric: row.metric ?? "dps",
      characterId: row.characterId,
      wclCanonicalCharacterId: row.wclCanonicalCharacterId,
      name: row.name,
      realm: row.realm,
      region: row.region,
      classID: row.classID,
      specName: row.specName,
      bestSpecName: row.bestSpecName,
      role: row.role,
      ilvl: row.ilvl ?? 0,
      score: row.bestAmount,
      encounterName: row.encounterName,
      rankPercent: row.rankPercent,
      medianPercent: row.medianPercent,
      lockedIn: row.lockedIn,
      totalKills: row.totalKills,
      bestAmount: row.bestAmount,
      allStarsPoints: 0,
      allStarsPossiblePoints: 0,
      bossScores: [],
      guildName,
      guildRealm,
      sourcePartition,
      updatedAt: row.updatedAt ?? new Date(),
    };
  }

  private toAllStarsLeaderboardEntry(row: any, zoneId: number, partition: number | null, sourcePartition: number, guildName: string | null, guildRealm: string | null): any {
    return {
      zoneId,
      difficulty: MYTHIC_DIFFICULTY,
      type: "allstars",
      encounterId: null,
      partition,
      metric: row.metric ?? "dps",
      characterId: row.characterId,
      wclCanonicalCharacterId: row.wclCanonicalCharacterId,
      name: row.name,
      realm: row.realm,
      region: row.region,
      classID: row.classID,
      specName: row.specName,
      bestSpecName: "",
      role: row.role,
      ilvl: row.ilvl ?? 0,
      score: row.points,
      encounterName: "",
      rankPercent: row.rankPercent,
      medianPercent: row.medianPercent,
      lockedIn: false,
      totalKills: 0,
      bestAmount: 0,
      allStarsPoints: row.points,
      allStarsPossiblePoints: row.possiblePoints,
      bossScores: row.bossScores ?? [],
      guildName,
      guildRealm,
      sourcePartition,
      updatedAt: row.updatedAt ?? new Date(),
    };
  }
}

export const characterRankingBackfillService = new CharacterRankingBackfillService();
export default characterRankingBackfillService;
