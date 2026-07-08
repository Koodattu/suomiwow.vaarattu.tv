import Guild, { IGuild } from "../models/Guild";
import Report, { IReportFightSequenceEntry } from "../models/Report";
import Fight from "../models/Fight";
import GuildProcessingQueue, { IGuildProcessingQueue, ProcessingStatus, JobType } from "../models/GuildProcessingQueue";
import wclService from "./warcraftlogs.service";
import rateLimitService from "./rate-limit.service";
import guildService from "./guild.service";
import cacheService from "./cache.service";
import cacheWarmerService from "./cache-warmer.service";
import { TRACKED_RAIDS, CURRENT_RAID_IDS } from "../config/guilds";
import Character from "../models/Character";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import ProcessorState from "../models/ProcessorState";
import Raid from "../models/Raid";
import logger, { getGuildLogger } from "../utils/logger";
import mongoose from "mongoose";
import { classifyError, ErrorType } from "../utils/error-classifier";
import characterService from "./character.service";
import taskTracker from "./task-tracker.service";

/**
 * Queue processing configuration
 */
interface ProcessorConfig {
  // Interval to check queue when idle (ms)
  idleCheckInterval: number;
  // Interval to check queue when processing (ms)
  activeCheckInterval: number;
  // Delay between report fetches (ms)
  fetchDelay: number;
  // Maximum pages to fetch per guild (safety limit)
  maxPages: number;
  // Reports per page
  reportsPerPage: number;
}

/**
 * Queue statistics for API responses
 */
export interface QueueStatistics {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  paused: number;
  totalReportsFetched: number;
  totalFightsSaved: number;
}

/**
 * Queue item summary for API responses
 */
export interface QueueItemSummary {
  id: string;
  guildId: string;
  guildName: string;
  guildRealm: string;
  guildRegion: string;
  jobType: JobType;
  status: ProcessingStatus;
  priority: number;
  progress: {
    percentComplete: number;
    reportsFetched: number;
    totalReportsEstimate: number;
    fightsSaved: number;
    currentPage: number;
  };
  errorCount: number;
  lastError?: string;
  lastErrorAt?: Date;
  errorType?: string;
  isPermanentError?: boolean;
  failureReason?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastActivityAt: Date;
}

/**
 * Background Guild Processor Service
 *
 * Manages a queue of guilds that need their initial report data fetched.
 * Respects global rate limits and pauses when approaching the limit.
 * Runs as a background process separate from the main scheduler.
 */
class BackgroundGuildProcessor {
  private readonly processorStateKey = "guild-processing";
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private currentGuildQueue: IGuildProcessingQueue | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private fetchDeathEvents: boolean = process.env.FETCH_DEATH_EVENTS === "true";

  private config: ProcessorConfig = {
    idleCheckInterval: 30 * 1000, // Check every 30 seconds when idle
    activeCheckInterval: 1000, // Check every 1 second when processing
    fetchDelay: 200, // 200ms between requests
    maxPages: 500, // Max 5000 reports
    reportsPerPage: 10,
  };

  // Cache for valid boss IDs
  private validBossIdsCache: Set<number> | null = null;

  // Track when global rankings were last calculated
  private lastGlobalRankingsUpdate: Date | null = null;

  private characterAppearanceIndexesSynced: boolean = false;
  private deathRescanIndexesCreated: boolean = false;

  /**
   * Start the background processor
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("[BackgroundProcessor] Already running");
      return;
    }

    this.isRunning = true;
    logger.info("[BackgroundProcessor] Starting background guild processor");

    // Register rate limit callbacks
    rateLimitService.onPause(() => this.onRateLimitPause());
    rateLimitService.onResume(() => this.onRateLimitResume());

    // Start the processing loop
    this.scheduleNextCheck(this.config.idleCheckInterval);
  }

  private async ensureDeathRescanIndexes(): Promise<void> {
    if (this.deathRescanIndexesCreated) return;

    await Fight.collection.createIndex({ guildId: 1, deathEventsFetchStatus: 1, reportEndTime: 1, reportCode: 1 });
    await Fight.collection.createIndex(
      { deathEventsFetchStatus: 1, reportEndTime: 1, guildId: 1 },
      { name: "death_backfill_queue_lookup" },
    );

    this.deathRescanIndexesCreated = true;
  }

  private isArchivedReportError(errorMessage: string): boolean {
    return errorMessage.includes("This report has been archived") && errorMessage.includes("/user API endpoint");
  }

  private async isQueueItemStillPresent(queueItem: IGuildProcessingQueue): Promise<boolean> {
    const existing = await GuildProcessingQueue.exists({ _id: queueItem._id });
    return existing !== null;
  }

  /**
   * Stop the background processor
   */
  stop(): void {
    this.isRunning = false;

    if (this.checkInterval) {
      clearTimeout(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info("[BackgroundProcessor] Stopped");
  }

  /**
   * Schedule the next queue check
   */
  private scheduleNextCheck(delay: number): void {
    if (!this.isRunning) return;

    this.checkInterval = setTimeout(async () => {
      await this.processQueue();
    }, delay);
  }

  /**
   * Main processing loop - check queue and process next item
   */
  private async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.refreshProcessorPauseState();
      await rateLimitService.refreshSharedState();

      // Check if we should pause due to rate limits
      if (!rateLimitService.canProceedBackground()) {
        logger.debug("[BackgroundProcessor] Rate limit near threshold, waiting...");
        this.scheduleNextCheck(this.config.idleCheckInterval);
        return;
      }

      // Check for manual pause
      if (this.isPaused) {
        logger.debug("[BackgroundProcessor] Manually paused, waiting...");
        this.scheduleNextCheck(this.config.idleCheckInterval);
        return;
      }

      // Get next item from queue
      const queueItem = await GuildProcessingQueue.getNextToProcess();

      if (!queueItem) {
        // No items to process - check if we should recalculate global rankings
        await this.checkAndUpdateGlobalRankings();
        this.scheduleNextCheck(this.config.idleCheckInterval);
        return;
      }

      this.currentGuildQueue = queueItem;

      logger.info(`[BackgroundProcessor] Processing guild: ${queueItem.guildName}-${queueItem.guildRealm} (ID: ${queueItem.guildId}, job: ${queueItem.jobType})`);

      const taskId = await taskTracker.start(`Process Guild Queue: ${queueItem.jobType}`, {
        guildId: queueItem.guildId,
        guildName: queueItem.guildName,
        guildRealm: queueItem.guildRealm,
        guildRegion: queueItem.guildRegion,
        jobType: queueItem.jobType,
      });

      try {
        // Route to appropriate processing method based on job type
        switch (queueItem.jobType) {
          case "rescan_deaths":
            await this.processGuildDeathRescan(queueItem);
            break;
          case "rescan_characters":
            await this.processGuildCharacterRescan(queueItem);
            break;
          case "backfill_report_characters":
            await this.processGuildReportCharacterBackfill(queueItem);
            break;
          case "recalculate_stats":
            await this.processGuildStatsRecalculation(queueItem);
            break;
          case "full_rescan":
          default:
            await this.processGuild(queueItem);
            break;
        }

        const finishedItem = await GuildProcessingQueue.findById(queueItem._id).lean<Pick<IGuildProcessingQueue, "status" | "lastError" | "failureReason" | "progress">>();
        const metadata = {
          guildId: queueItem.guildId,
          guildName: queueItem.guildName,
          guildRealm: queueItem.guildRealm,
          jobType: queueItem.jobType,
          status: finishedItem?.status,
          progress: finishedItem?.progress,
        };

        if (finishedItem?.status === "failed") {
          await taskTracker.fail(taskId, finishedItem.failureReason || finishedItem.lastError || "Queue item failed");
        } else {
          await taskTracker.complete(taskId, metadata);
        }
      } catch (error) {
        await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        this.currentGuildQueue = null;
      }

      // Check for next item immediately
      this.scheduleNextCheck(this.config.activeCheckInterval);
    } catch (error) {
      logger.error("[BackgroundProcessor] Error in queue processing:", error);
      this.scheduleNextCheck(this.config.idleCheckInterval);
    }
  }

  /**
   * Process a single guild - fetch all their reports
   */
  private async processGuild(queueItem: IGuildProcessingQueue): Promise<void> {
    const guildLog = getGuildLogger(queueItem.guildName, queueItem.guildRealm);

    try {
      // Get the guild from database
      const guild = await Guild.findById(queueItem.guildId);
      if (!guild) {
        const errorMessage = "Guild not found in database";
        guildLog.error(errorMessage);
        const classifiedError = classifyError(errorMessage);
        await queueItem.markFailed(errorMessage, classifiedError.type, classifiedError.isPermanent, classifiedError.userMessage);
        return;
      }

      // Get valid boss encounter IDs
      const validBossIds = await this.getValidBossEncounterIds();
      guildLog.info(`Tracking ${validBossIds.size} boss encounters across ${TRACKED_RAIDS.length} raids`);

      // Fetch WarcraftLogs guild ID if not present
      if (!guild.warcraftlogsId) {
        guildLog.info("Fetching WarcraftLogs guild ID...");
        try {
          const guildDetails = await wclService.getGuildDetails(guild.name, guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.region.toLowerCase());

          if (guildDetails.guildData?.guild?.id) {
            guild.warcraftlogsId = guildDetails.guildData.guild.id;
            guildLog.info(`WarcraftLogs guild ID: ${guild.warcraftlogsId}`);

            if (guildDetails.guildData.guild.faction?.name && !guild.faction) {
              guild.faction = guildDetails.guildData.guild.faction.name;
            }

            await guild.save();
          }
        } catch (error) {
          guildLog.error("Error fetching WarcraftLogs guild ID:", error instanceof Error ? error.message : "Unknown");
        }
      }

      // Start fetching reports
      let page = queueItem.progress.currentPage || 1;
      let totalReportsFetched = queueItem.progress.reportsFetched;
      let totalFightsSaved = queueItem.progress.fightsSaved;
      let consecutiveEmptyPages = 0;

      while (page <= this.config.maxPages) {
        // Check rate limit before each page
        if (!rateLimitService.canProceedBackground()) {
          guildLog.info(`Rate limit threshold reached at page ${page}, pausing...`);
          await queueItem.updateProgress(totalReportsFetched, totalFightsSaved, page);
          await queueItem.pause();

          // Wait for rate limit to reset
          await rateLimitService.waitForReset();

          // Resume
          await queueItem.resume();
          guildLog.info("Resuming after rate limit reset");
        }

        // Check for manual pause
        if (this.isPaused) {
          guildLog.info(`Manually paused at page ${page}`);
          await queueItem.updateProgress(totalReportsFetched, totalFightsSaved, page);
          await queueItem.pause();
          return;
        }

        // Fetch page of reports
        try {
          const data = await wclService.getGuildReportsWithFights(
            guild.name,
            guild.realm.toLowerCase().replace(/\s+/g, "-"),
            guild.region.toLowerCase(),
            this.config.reportsPerPage,
            page,
            true, // retry on gateway timeout
          );

          if (!data.reportData?.reports?.data || data.reportData.reports.data.length === 0) {
            consecutiveEmptyPages++;
            if (consecutiveEmptyPages >= 2) {
              guildLog.info(`No more reports found after page ${page}`);
              break;
            }
            page++;
            continue;
          }

          consecutiveEmptyPages = 0;

          // Update guild faction if available
          if (page === 1 && data.guildData?.guild?.faction?.name) {
            guild.faction = data.guildData.guild.faction.name;
            await guild.save();
          }

          const pageReports = data.reportData.reports.data;
          guildLog.info(`Page ${page}: fetched ${pageReports.length} reports`);

          // Process each report
          for (const report of pageReports) {
            const fightsSavedInReport = await this.processReport(report, guild, validBossIds);
            totalFightsSaved += fightsSavedInReport;
            totalReportsFetched++;
          }

          // Update progress every page
          await queueItem.updateProgress(totalReportsFetched, totalFightsSaved, page);

          // Check if we've reached the end
          if (pageReports.length < this.config.reportsPerPage) {
            guildLog.info(`Reached last page at page ${page}`);
            break;
          }

          page++;

          // Delay between page fetches
          await new Promise((resolve) => setTimeout(resolve, this.config.fetchDelay));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          guildLog.error(`Error fetching page ${page}: ${errorMessage}`);

          // Classify the error for better handling
          const classifiedError = classifyError(errorMessage);

          // Update guild wclStatus if guild not found on WCL
          if (classifiedError.type === ErrorType.GUILD_NOT_FOUND) {
            await Guild.findByIdAndUpdate(queueItem.guildId, {
              wclStatus: "not_found",
              wclStatusUpdatedAt: new Date(),
              initialFetchCompleted: true,
              initialFetchCompletedAt: new Date(),
              $inc: { wclNotFoundCount: 1 },
            });

            // Fall back to Raider.IO for progress data
            guildLog.info("Guild not found on WCL, falling back to Raider.IO...");
            try {
              await guildService.updateGuildFromRaiderIO(queueItem.guildId.toString());
            } catch (rioError) {
              guildLog.warn("Raider.IO fallback also failed:", rioError instanceof Error ? rioError.message : "Unknown");
            }
          }

          // Save progress and mark as failed
          await queueItem.updateProgress(totalReportsFetched, totalFightsSaved, page);
          await queueItem.markFailed(errorMessage, classifiedError.type, classifiedError.isPermanent, classifiedError.userMessage);
          return;
        }
      }

      // Update the guild's lastLogEndTime
      const mostRecentReport = await Report.findOne({ guildId: guild._id }).sort({ endTime: -1 }).limit(1);
      if (mostRecentReport && mostRecentReport.endTime) {
        guild.lastLogEndTime = new Date(mostRecentReport.endTime);
        guild.lastFetched = new Date();
        await guild.save();
      }

      // Reset guild's wclStatus to active on successful processing and mark initial fetch as complete
      // This flag ensures guilds with no WCL reports won't be re-queued on startup
      await Guild.findByIdAndUpdate(queueItem.guildId, {
        wclStatus: "active",
        wclStatusUpdatedAt: new Date(),
        wclNotFoundCount: 0,
        initialFetchCompleted: true,
        initialFetchCompletedAt: new Date(),
      });

      // Update world ranks for the guild first
      guildLog.info("Updating world ranks for newly fetched guild");
      try {
        await guildService.updateGuildWorldRankings(guild._id.toString());
        guildLog.info("World ranks update complete");
      } catch (rankError) {
        guildLog.error("Failed to update world ranks:", rankError instanceof Error ? rankError.message : "Unknown");
        // Don't fail the queue item for world ranks failure
      }

      // Trigger statistics calculation for the newly fetched guild
      guildLog.info("Triggering statistics recalculation for newly fetched guild");
      try {
        await guildService.calculateGuildStatistics(guild, null, { createEvents: false }); // null = all raids
        await guild.save();
        guildLog.info("Statistics recalculation complete");
      } catch (statsError) {
        guildLog.error("Failed to recalculate statistics:", statsError instanceof Error ? statsError.message : "Unknown");
        // Don't fail the queue item for stats calculation failure
      }

      // Mark as completed
      await queueItem.markCompleted();

      // Invalidate ALL guild-related caches after new guild is processed
      // This is correct here because a NEW guild needs to appear in:
      // - Guild list
      // - All progress pages (including older raids)
      // - Home page
      // Then warm all caches immediately so they're ready for users
      try {
        await cacheService.invalidateAllGuildCaches();
        guildLog.info("All guild caches invalidated after initial fetch, warming caches...");
        await cacheWarmerService.warmAllCaches();
        guildLog.info("All caches warmed after new guild processing");
      } catch (cacheError) {
        guildLog.error("Failed to invalidate/warm caches:", cacheError instanceof Error ? cacheError.message : "Unknown");
      }

      guildLog.info(`✅ Initial fetch completed: ${totalReportsFetched} reports, ${totalFightsSaved} fights across ${page} pages`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      guildLog.error(`Fatal error processing guild: ${errorMessage}`);

      // Classify the error for better handling
      const classifiedError = classifyError(errorMessage);

      // Update guild wclStatus if guild not found on WCL
      if (classifiedError.type === ErrorType.GUILD_NOT_FOUND) {
        await Guild.findByIdAndUpdate(queueItem.guildId, {
          wclStatus: "not_found",
          wclStatusUpdatedAt: new Date(),
          initialFetchCompleted: true,
          initialFetchCompletedAt: new Date(),
          $inc: { wclNotFoundCount: 1 },
        });

        // Fall back to Raider.IO for progress data
        const fatalGuildLog = getGuildLogger(queueItem.guildName, queueItem.guildRealm);
        fatalGuildLog.info("Guild not found on WCL (fatal), falling back to Raider.IO...");
        try {
          await guildService.updateGuildFromRaiderIO(queueItem.guildId.toString());
        } catch (rioError) {
          fatalGuildLog.warn("Raider.IO fallback also failed:", rioError instanceof Error ? rioError.message : "Unknown");
        }
      }

      await queueItem.markFailed(errorMessage, classifiedError.type, classifiedError.isPermanent, classifiedError.userMessage);
    }
  }

  /**
   * Process a single report - save fights to database
   */
  private buildReportFightSequence(report: any): IReportFightSequenceEntry[] {
    if (!Array.isArray(report.fights)) {
      return [];
    }

    return report.fights
      .map((fight: any): IReportFightSequenceEntry | null => {
        const fightId = Number(fight.id ?? fight.fightId);
        const startTime = Number(fight.startTime);
        const endTime = Number(fight.endTime);

        if (!Number.isFinite(fightId) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
          return null;
        }

        return {
          fightId,
          encounterID: Number(fight.encounterID) || 0,
          difficulty: Number(fight.difficulty) || 0,
          startTime,
          endTime,
          name: typeof fight.name === "string" ? fight.name : undefined,
        };
      })
      .filter((fight: IReportFightSequenceEntry | null): fight is IReportFightSequenceEntry => fight !== null)
      .sort((a: IReportFightSequenceEntry, b: IReportFightSequenceEntry) => a.startTime - b.startTime || a.endTime - b.endTime || a.fightId - b.fightId);
  }

  private async processReport(report: any, guild: IGuild, validBossIds: Set<number>): Promise<number> {
    let fightsSaved = 0;
    const zoneId = report.zone?.id;
    const isOngoing = !report.endTime || report.endTime === 0;

    // Save report metadata
    await Report.findOneAndUpdate(
      { code: report.code },
      {
        code: report.code,
        guildId: guild._id,
        zoneId: zoneId || 0,
        startTime: report.startTime,
        endTime: report.endTime,
        isOngoing,
        fightCount: report.fights?.length || 0,
        fightSequence: this.buildReportFightSequence(report),
        lastProcessed: new Date(),
      },
      { upsert: true, new: true },
    );

    // Process fights
    if (report.fights && report.fights.length > 0) {
      const encounterPhases = report.phases || [];

      // Get fight IDs for tracked raid bosses only
      const trackedFightIds: number[] = [];
      for (const fight of report.fights) {
        if (validBossIds.has(fight.encounterID)) {
          trackedFightIds.push(fight.id);
        }
      }

      // Fetch death events if enabled
      let deathsByFight = new Map<number, any[]>();
      let deathEventsFetchedAt: Date | null = null;
      if (this.fetchDeathEvents && trackedFightIds.length > 0) {
        try {
          const deathData = await wclService.getDeathEventsForReport(report.code, trackedFightIds);
          if (deathData.reportData?.report) {
            const actors = deathData.reportData.report.masterData?.actors || [];
            deathsByFight = wclService.parseDeathEventsByFight(deathData.reportData.report, actors, report.fights);
            deathEventsFetchedAt = new Date();
          }
        } catch (error: any) {
          // Non-fatal, continue without death data
          logger.debug(`Failed to fetch deaths for report ${report.code}: ${error.message}`);
        }
      }

      for (const fight of report.fights) {
        const encounterId = fight.encounterID;

        // Only save fights for tracked raid bosses
        if (!validBossIds.has(encounterId)) {
          continue;
        }

        const bossPercent = fight.bossPercentage || 0;
        const fightPercent = fight.fightPercentage || 0;
        const duration = fight.endTime - fight.startTime;
        const difficulty = fight.difficulty;

        // Determine phase information
        const phaseInfo = wclService.determinePhaseInfo(fight, encounterPhases);

        // Get deaths for this fight
        const deaths = deathsByFight.get(fight.id) || [];
        const deathEventsFetchUpdate =
          deathEventsFetchedAt !== null
            ? {
                deaths,
                deathEventsFetchStatus: "fetched",
                deathEventsFetchedAt,
              }
            : {};

        // Save fight to database
        const fightTimestamp = new Date(report.startTime + fight.startTime);
        await Fight.findOneAndUpdate(
          { reportCode: report.code, fightId: fight.id },
          {
            reportCode: report.code,
            guildId: guild._id,
            fightId: fight.id,
            zoneId: zoneId || 0,
            encounterID: encounterId,
            encounterName: fight.name || `Boss ${encounterId}`,
            difficulty: difficulty,
            isKill: fight.kill === true,
            bossPercentage: bossPercent,
            fightPercentage: fightPercent,
            lastPhaseId: phaseInfo.lastPhase?.phaseId,
            lastPhaseName: phaseInfo.lastPhase?.phaseName,
            phaseTransitions: fight.phaseTransitions?.map((pt: any) => ({
              id: pt.id,
              startTime: pt.startTime,
              name: encounterPhases.find((ep: any) => ep.encounterID === encounterId)?.phases?.find((p: any) => p.id === pt.id)?.name,
            })),
            progressDisplay: phaseInfo.progressDisplay,
            ...deathEventsFetchUpdate,
            reportStartTime: report.startTime,
            reportEndTime: report.endTime || 0,
            fightStartTime: fight.startTime,
            fightEndTime: fight.endTime,
            duration: duration,
            timestamp: fightTimestamp,
          },
          { upsert: true, new: true },
        );

        fightsSaved++;
      }
    }

    return fightsSaved;
  }

  /**
   * Process a guild's death event rescan — fetch death events for all existing fights
   * without a successful death event fetch marker, grouped by report for efficiency.
   */
  private async processGuildDeathRescan(queueItem: IGuildProcessingQueue): Promise<void> {
    const guildLog = getGuildLogger(queueItem.guildName, queueItem.guildRealm);

    try {
      const guild = await Guild.findById(queueItem.guildId);
      if (!guild) {
        await queueItem.markFailed("Guild not found in database", "unknown", true, "Guild not found");
        return;
      }

      await this.ensureDeathRescanIndexes();

      const jobStartedAt = new Date();
      const deathStatusFilters: any[] = [
        { deathEventsFetchStatus: "pending" },
        { deathEventsFetchStatus: { $exists: false } },
        { deathEventsFetchStatus: "failed", deathEventsFetchFailedAt: { $lt: jobStartedAt } },
        { deathEventsFetchStatus: "failed", deathEventsFetchFailedAt: { $exists: false } },
      ];

      const pendingFightQuery = {
        guildId: guild._id,
        reportEndTime: { $gt: 0 },
        $or: deathStatusFilters,
      };

      const reportCodes = (await Fight.distinct("reportCode", pendingFightQuery)).filter((code): code is string => typeof code === "string" && code.length > 0);
      const totalReports = reportCodes.length;

      guildLog.info(`[DeathRescan] Found ${totalReports} reports needing death event fetch`);

      if (totalReports === 0) {
        await queueItem.markCompleted();
        return;
      }

      await queueItem.updateProgress(0, 0, 0, totalReports);

      let reportsProcessed = 0;
      let fightsUpdated = 0;
      let deathEventsSaved = 0;

      for (const reportCode of reportCodes) {
        if (!(await this.isQueueItemStillPresent(queueItem))) {
          guildLog.info("[DeathRescan] Queue entry removed, stopping rescan");
          return;
        }

        await this.refreshProcessorPauseState();
        await rateLimitService.refreshSharedState();

        // Check rate limit before each API call
        if (!rateLimitService.canProceedBackground()) {
          guildLog.info(`[DeathRescan] Rate limit threshold reached, pausing...`);
          await queueItem.updateProgress(reportsProcessed, fightsUpdated, reportsProcessed);
          await queueItem.pause();
          await rateLimitService.waitForReset();
          await queueItem.resume();
          guildLog.info("[DeathRescan] Resuming after rate limit reset");
        }

        if (this.isPaused) {
          guildLog.info(`[DeathRescan] Manually paused at report ${reportsProcessed}/${totalReports}`);
          await queueItem.updateProgress(reportsProcessed, fightsUpdated, reportsProcessed);
          await queueItem.pause();
          return;
        }

        try {
          const fights = await Fight.find({
            ...pendingFightQuery,
            reportCode,
          })
            .select("_id reportCode fightId fightStartTime")
            .sort({ fightId: 1 })
            .lean();

          if (fights.length === 0) {
            reportsProcessed++;
            await queueItem.updateProgress(reportsProcessed, fightsUpdated, reportsProcessed, totalReports);
            continue;
          }

          const fightIds = fights.map((f) => f.fightId);
          const deathData = await wclService.getDeathEventsForReport(reportCode, fightIds);

          if (deathData.reportData?.report) {
            const actors = deathData.reportData.report.masterData?.actors || [];
            const fightInfos = fights.map((f) => ({
              id: f.fightId,
              startTime: f.fightStartTime ?? 0,
            }));

            const deathsByFight = wclService.parseDeathEventsByFight(deathData.reportData.report, actors, fightInfos);

            const fetchedAt = new Date();
            const operations = fights.map((fight) => {
              const deaths = deathsByFight.get(fight.fightId) || [];
              deathEventsSaved += deaths.length;
              return {
                updateOne: {
                  filter: { _id: fight._id },
                  update: {
                    $set: {
                      deaths,
                      deathEventsFetchStatus: "fetched" as const,
                      deathEventsFetchedAt: fetchedAt,
                    },
                    $unset: {
                      deathEventsFetchFailedAt: 1 as const,
                      deathEventsFetchError: 1 as const,
                    },
                  },
                },
              };
            });

            if (operations.length > 0) {
              await Fight.bulkWrite(operations);
              fightsUpdated += operations.length;
            }
          } else {
            throw new Error("WCL report not found or inaccessible");
          }

          reportsProcessed++;
          await queueItem.updateProgress(reportsProcessed, fightsUpdated, reportsProcessed, totalReports);

          // Delay between API calls
          await new Promise((resolve) => setTimeout(resolve, this.config.fetchDelay));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          const isArchivedReport = this.isArchivedReportError(errorMessage);
          guildLog.error(`[DeathRescan] Failed to process report ${reportCode}: ${errorMessage}`);

          await Fight.updateMany(
            {
              ...pendingFightQuery,
              reportCode,
            },
            {
              $set: {
                deathEventsFetchStatus: isArchivedReport ? "archived" : "failed",
                deathEventsFetchFailedAt: new Date(),
                deathEventsFetchError: errorMessage,
              },
            },
          );

          // Continue with next report — non-fatal per-report error
          reportsProcessed++;
          await queueItem.updateProgress(reportsProcessed, fightsUpdated, reportsProcessed, totalReports);
        }
      }

      await queueItem.markCompleted();
      guildLog.info(`[DeathRescan] Completed: ${reportsProcessed} reports processed, ${fightsUpdated} fights marked fetched, ${deathEventsSaved} death events saved`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      guildLog.error(`[DeathRescan] Fatal error: ${errorMessage}`);
      const classifiedError = classifyError(errorMessage);
      await queueItem.markFailed(errorMessage, classifiedError.type, classifiedError.isPermanent, classifiedError.userMessage);
    }
  }

  /**
   * Process a guild's character rescan — fetch characters for all Mythic kills
   * in CURRENT_RAID_IDS and upsert them to the Character model.
   */
  private async processGuildCharacterRescan(queueItem: IGuildProcessingQueue): Promise<void> {
    const guildLog = getGuildLogger(queueItem.guildName, queueItem.guildRealm);

    try {
      const guild = await Guild.findById(queueItem.guildId);
      if (!guild) {
        await queueItem.markFailed("Guild not found in database", "unknown", true, "Guild not found");
        return;
      }

      // Find all Mythic kills for this guild in current raids
      const mythicKills = await Fight.find({
        guildId: guild._id,
        difficulty: 5,
        isKill: true,
        zoneId: { $in: CURRENT_RAID_IDS },
      }).lean();

      guildLog.info(`[CharacterRescan] Found ${mythicKills.length} Mythic kills to process`);

      if (mythicKills.length === 0) {
        await queueItem.markCompleted();
        return;
      }

      const totalFights = mythicKills.length;
      await queueItem.updateProgress(0, 0, 0, totalFights);

      let fightsProcessed = 0;
      const seenCanonicalIDs = new Set<string>();

      for (const fight of mythicKills) {
        // Check rate limit before each API call
        if (!rateLimitService.canProceedBackground()) {
          guildLog.info(`[CharacterRescan] Rate limit threshold reached, pausing...`);
          await queueItem.updateProgress(fightsProcessed, seenCanonicalIDs.size, fightsProcessed);
          await queueItem.pause();
          await rateLimitService.waitForReset();
          await queueItem.resume();
          guildLog.info("[CharacterRescan] Resuming after rate limit reset");
        }

        if (this.isPaused) {
          guildLog.info(`[CharacterRescan] Manually paused at fight ${fightsProcessed}/${totalFights}`);
          await queueItem.updateProgress(fightsProcessed, seenCanonicalIDs.size, fightsProcessed);
          await queueItem.pause();
          return;
        }

        try {
          const charData = await wclService.getFightCharacters(fight.reportCode, fight.fightId);
          const rankedChars = charData?.reportData?.report?.rankedCharacters || [];

          for (const char of rankedChars) {
            const { guildName, guildRealm } = wclService.getPrimaryGuildInfo(char);
            await characterService.upsertCharacterFromReport({
              canonicalID: char.canonicalID,
              name: char.name,
              serverSlug: char.server.slug,
              serverRegion: char.server.region.slug,
              classID: char.classID,
              hidden: char.hidden,
              guildName,
              guildRealm,
            });
            seenCanonicalIDs.add(char.canonicalID);
          }

          fightsProcessed++;
          await queueItem.updateProgress(fightsProcessed, seenCanonicalIDs.size, fightsProcessed, totalFights);

          // Delay between API calls
          await new Promise((resolve) => setTimeout(resolve, this.config.fetchDelay));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          guildLog.error(`[CharacterRescan] Failed for fight ${fight.fightId} in report ${fight.reportCode}: ${errorMessage}`);
          // Continue with next fight — non-fatal per-fight error
          fightsProcessed++;
        }
      }

      await queueItem.markCompleted();
      guildLog.info(`[CharacterRescan] Completed: ${fightsProcessed} fights processed, ${seenCanonicalIDs.size} unique characters saved`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      guildLog.error(`[CharacterRescan] Fatal error: ${errorMessage}`);
      const classifiedError = classifyError(errorMessage);
      await queueItem.markFailed(errorMessage, classifiedError.type, classifiedError.isPermanent, classifiedError.userMessage);
    }
  }

  /**
   * Process a guild's report-level character backfill.
   * Fetches each stored report once, stores report rankedCharacters as appearances,
   * and marks the report so future runs skip already-fetched reports.
   */
  private async processGuildReportCharacterBackfill(queueItem: IGuildProcessingQueue): Promise<void> {
    const guildLog = getGuildLogger(queueItem.guildName, queueItem.guildRealm);

    try {
      const guild = await Guild.findById(queueItem.guildId);
      if (!guild) {
        await queueItem.markFailed("Guild not found in database", "unknown", true, "Guild not found");
        return;
      }

      if (!this.characterAppearanceIndexesSynced) {
        await CharacterReportAppearance.syncIndexes();
        this.characterAppearanceIndexesSynced = true;
      }

      const jobStartedAt = new Date();
      const pendingReportQuery = {
        guildId: guild._id,
        isOngoing: { $ne: true },
        endTime: { $gt: 0 },
        $or: [
          { charactersFetchStatus: "pending" },
          { charactersFetchStatus: { $exists: false } },
          { charactersFetchStatus: "failed", charactersFetchFailedAt: { $lt: jobStartedAt } },
          { charactersFetchStatus: "fetched", rankingsFetchedAt: { $exists: false } },
        ],
      };

      const totalReports = await Report.countDocuments(pendingReportQuery);
      guildLog.info(`[ReportCharacterBackfill] Found ${totalReports} reports needing character fetch`);

      if (totalReports === 0) {
        await queueItem.markCompleted();
        return;
      }

      await queueItem.updateProgress(0, 0, 0, totalReports);

      let reportsProcessed = 0;
      let appearancesSaved = 0;

      while (true) {
        const report = await Report.findOne(pendingReportQuery)
          .sort({ startTime: 1 })
          .select("code zoneId startTime endTime charactersFetchStatus rankedCharacterCount rankingsCharacterCount rankingsFetchedAt characterAppearanceCount charactersFetchSource")
          .lean();
        if (!report) {
          break;
        }

        await this.refreshProcessorPauseState();
        await rateLimitService.refreshSharedState();

        if (!rateLimitService.canProceedBackground()) {
          guildLog.info(`[ReportCharacterBackfill] Rate limit threshold reached, pausing...`);
          await queueItem.updateProgress(reportsProcessed, appearancesSaved, reportsProcessed, totalReports);
          await queueItem.pause();
          await rateLimitService.waitForReset();
          await queueItem.resume();
          guildLog.info("[ReportCharacterBackfill] Resuming after rate limit reset");
        }

        if (this.isPaused) {
          guildLog.info(`[ReportCharacterBackfill] Manually paused at ${reportsProcessed}/${totalReports} reports`);
          await queueItem.updateProgress(reportsProcessed, appearancesSaved, reportsProcessed, totalReports);
          await queueItem.pause();
          return;
        }

        try {
          const isRankingsOnlyRetry = report.charactersFetchStatus === "fetched" && !report.rankingsFetchedAt;

          let wclReport: any = null;
          let rankedCharacters: any[] = [];
          let rankedResult: { processed: number; skipped: number } = { processed: 0, skipped: 0 };
          let canonicalMatches = isRankingsOnlyRetry ? await characterService.getCanonicalMatchesFromReportAppearances(report.code) : [];

          if (!isRankingsOnlyRetry) {
            const reportData = await wclService.getReportByCodeAllDifficulties(report.code, { includeRankedCharacters: true });
            wclReport = reportData.reportData?.report;

            if (!wclReport) {
              throw new Error("WCL report not found or inaccessible");
            }

            rankedCharacters = Array.isArray(wclReport.rankedCharacters) ? wclReport.rankedCharacters : [];
            const reportActors = Array.isArray(wclReport.masterData?.actors) ? wclReport.masterData.actors : [];
            canonicalMatches = characterService.buildCanonicalMatchesFromRankedCharacters(rankedCharacters);
            rankedResult = await characterService.upsertCharactersFromReportAppearances({
              reportCode: wclReport.code,
              reportStartTime: wclReport.startTime || report.startTime,
              reportZoneId: report.zoneId,
              reportGuildId: guild._id as mongoose.Types.ObjectId,
              reportGuildName: guild.name,
              reportGuildRealm: guild.realm,
              rankedCharacters,
              reportActors,
            });
          }

          let rankingsCharacterCount = 0;
          let fallbackResult: { processed: number; skipped: number; matched: number; unmatched: number } | null = null;
          let charactersFetchSource: "rankedCharacters" | "reportRankings" | "none" = rankedResult.processed > 0 ? "rankedCharacters" : report.charactersFetchSource || "none";

          // report.rankings carries the historical class/spec for the report. rankedCharacters can resolve
          // a reused WCL canonical ID to the wrong current class, so use rankings when it is available.
          await this.refreshProcessorPauseState();
          await rateLimitService.refreshSharedState();

          if (!rateLimitService.canProceedBackground()) {
            guildLog.info(`[ReportCharacterBackfill] Rate limit threshold reached before report rankings fallback, pausing...`);
            await queueItem.updateProgress(reportsProcessed, appearancesSaved, reportsProcessed, totalReports);
            await queueItem.pause();
            await rateLimitService.waitForReset();
            await queueItem.resume();
            guildLog.info("[ReportCharacterBackfill] Resuming report rankings fallback after rate limit reset");
          }

          if (this.isPaused) {
            guildLog.info(`[ReportCharacterBackfill] Manually paused before report rankings fallback at ${reportsProcessed}/${totalReports} reports`);
            await queueItem.updateProgress(reportsProcessed, appearancesSaved, reportsProcessed, totalReports);
            await queueItem.pause();
            return;
          }

          try {
            const rankingCharacters = await wclService.getReportRankingsCharacters(report.code, 5);
            rankingsCharacterCount = rankingCharacters.length;
            fallbackResult = await characterService.upsertCharactersFromReportRankingAppearances({
              reportCode: wclReport?.code || report.code,
              reportStartTime: wclReport?.startTime || report.startTime,
              reportZoneId: report.zoneId,
              reportGuildId: guild._id as mongoose.Types.ObjectId,
              reportGuildName: guild.name,
              reportGuildRealm: guild.realm,
              rankingCharacters,
              canonicalMatches,
            });
            charactersFetchSource = fallbackResult.processed > 0 ? "reportRankings" : rankedResult.processed > 0 || (report.rankedCharacterCount ?? 0) > 0 ? "rankedCharacters" : "none";
          } catch (error) {
            const rankingsErrorMessage = error instanceof Error ? error.message || error.name : String(error);
            guildLog.warn(`[ReportCharacterBackfill] Report rankings fallback failed for ${report.code}; continuing without rankings data: ${rankingsErrorMessage}`);
            charactersFetchSource = rankedResult.processed > 0 || (report.rankedCharacterCount ?? 0) > 0 ? "rankedCharacters" : charactersFetchSource;
          }

          const processedAppearances = rankedResult.processed + (fallbackResult?.processed ?? 0);
          const storedAppearanceCount = await CharacterReportAppearance.countDocuments({ reportCode: report.code });
          const reportUpdateSet: Record<string, unknown> = {
            charactersFetchStatus: "fetched",
            charactersFetchedAt: new Date(),
            rankedCharacterCount: rankedCharacters.length || report.rankedCharacterCount || 0,
            rankingsCharacterCount,
            rankingsFetchedAt: new Date(),
            characterAppearanceCount: storedAppearanceCount,
            charactersFetchSource,
            lastProcessed: new Date(),
          };

          if (wclReport) {
            reportUpdateSet.startTime = wclReport.startTime || report.startTime;
            reportUpdateSet.endTime = wclReport.endTime || 0;
            reportUpdateSet.fightCount = wclReport.fights?.length || 0;
            reportUpdateSet.fightSequence = this.buildReportFightSequence(wclReport);
          }

          await Report.updateOne(
            { _id: report._id },
            {
              $set: reportUpdateSet,
              $unset: {
                charactersFetchFailedAt: "",
                charactersFetchError: "",
              },
            },
          );

          reportsProcessed++;
          appearancesSaved += processedAppearances;
          await queueItem.updateProgress(reportsProcessed, appearancesSaved, reportsProcessed, totalReports);
          guildLog.info(
            `[ReportCharacterBackfill] ${report.code}: saved ${processedAppearances} appearances (rankedCharacters=${rankedResult.processed}/${rankedCharacters.length || report.rankedCharacterCount || 0}, reportRankings=${fallbackResult?.processed ?? 0}/${rankingsCharacterCount}, matched=${fallbackResult?.matched ?? 0}, unmatched=${fallbackResult?.unmatched ?? 0})`,
          );

          await new Promise((resolve) => setTimeout(resolve, this.config.fetchDelay));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          guildLog.error(`[ReportCharacterBackfill] Failed for report ${report.code}: ${errorMessage}`);

          await Report.updateOne(
            { _id: report._id },
            {
              $set: {
                charactersFetchStatus: "failed",
                charactersFetchFailedAt: new Date(),
                charactersFetchError: errorMessage,
              },
            },
          );

          reportsProcessed++;
          await queueItem.updateProgress(reportsProcessed, appearancesSaved, reportsProcessed, totalReports);
        }
      }

      await queueItem.markCompleted();
      guildLog.info(`[ReportCharacterBackfill] Completed: ${reportsProcessed} reports processed, ${appearancesSaved} appearances saved`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      guildLog.error(`[ReportCharacterBackfill] Fatal error: ${errorMessage}`);
      const classifiedError = classifyError(errorMessage);
      await queueItem.markFailed(errorMessage, classifiedError.type, classifiedError.isPermanent, classifiedError.userMessage);
    }
  }

  /**
   * Recalculate statistics for a guild.
   * Used when admin triggers stats recalculation — runs in the worker process
   * instead of blocking the API.
   */
  private async processGuildStatsRecalculation(queueItem: IGuildProcessingQueue): Promise<void> {
    const guildLog = getGuildLogger(queueItem.guildName, queueItem.guildRealm);

    try {
      const guild = await Guild.findById(queueItem.guildId);
      if (!guild) {
        guildLog.error("[StatsRecalc] Guild not found in database");
        await queueItem.markFailed("Guild not found", "unknown", true, "Guild no longer exists");
        return;
      }

      guildLog.info("[StatsRecalc] Starting statistics recalculation");
      await queueItem.updateProgress(0, 0, 0, 1);

      await guildService.calculateGuildStatistics(guild, null, { createEvents: false });
      await guild.save();

      guildLog.info("[StatsRecalc] Statistics recalculated, warming caches");
      await cacheService.invalidateAllGuildCaches();
      await cacheWarmerService.warmAllCaches();

      await queueItem.markCompleted();
      guildLog.info("[StatsRecalc] Completed");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      guildLog.error(`[StatsRecalc] Fatal error: ${errorMessage}`);
      const classifiedError = classifyError(errorMessage);
      await queueItem.markFailed(errorMessage, classifiedError.type, classifiedError.isPermanent, classifiedError.userMessage);
    }
  }

  /**
   * Get valid boss encounter IDs from tracked raids
   */
  private async getValidBossEncounterIds(): Promise<Set<number>> {
    if (this.validBossIdsCache) {
      return this.validBossIdsCache;
    }

    const validBossIds = new Set<number>();

    for (const raidId of TRACKED_RAIDS) {
      const raid = await Raid.findOne({ id: raidId });
      if (raid && raid.bosses) {
        for (const boss of raid.bosses) {
          validBossIds.add(boss.id);
        }
      }
    }

    this.validBossIdsCache = validBossIds;
    return validBossIds;
  }

  /**
   * Add a guild to the processing queue
   */
  async queueGuild(guild: IGuild, priority: number = 10, jobType: JobType = "full_rescan"): Promise<IGuildProcessingQueue> {
    // Don't queue guilds that are marked as not found on WarcraftLogs (except for rescan jobs on existing data)
    if (guild.wclStatus === "not_found" && jobType === "full_rescan") {
      logger.warn(`[BackgroundProcessor] Skipping guild ${guild.name}-${guild.realm}: marked as not found on WarcraftLogs`);
      throw new Error(`Guild ${guild.name}-${guild.realm} is marked as not found on WarcraftLogs and cannot be queued`);
    }

    // Check if already in queue with the same job type
    const existing = await GuildProcessingQueue.findOne({
      guildId: guild._id,
      jobType,
    });

    if (existing) {
      // If failed or completed, allow re-queue
      if (existing.status === "failed" || existing.status === "completed") {
        existing.status = "pending";
        existing.errorCount = 0;
        existing.retryCount = 0;
        existing.lastError = undefined;
        existing.priority = priority;
        existing.progress = {
          totalReportsEstimate: 0,
          reportsFetched: 0,
          fightsSaved: 0,
          currentPage: 0,
          percentComplete: 0,
        };
        await existing.save();
        logger.info(`[BackgroundProcessor] Re-queued guild: ${guild.name}-${guild.realm} (job: ${jobType})`);
        return existing;
      }

      logger.info(`[BackgroundProcessor] Guild already in queue: ${guild.name}-${guild.realm} (status: ${existing.status}, job: ${jobType})`);
      return existing;
    }

    // Create new queue entry
    const queueItem = await GuildProcessingQueue.create({
      guildId: guild._id,
      guildName: guild.name,
      guildRealm: guild.realm,
      guildRegion: guild.region,
      jobType,
      priority,
      status: "pending",
      progress: {
        totalReportsEstimate: 0,
        reportsFetched: 0,
        fightsSaved: 0,
        currentPage: 0,
        percentComplete: 0,
      },
      errorCount: 0,
      retryCount: 0,
      maxRetries: 3,
    });

    logger.info(`[BackgroundProcessor] Queued guild: ${guild.name}-${guild.realm} (priority: ${priority}, job: ${jobType})`);
    return queueItem;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStatistics> {
    const stats = await GuildProcessingQueue.getQueueStats();

    return {
      pending: stats.pending?.count || 0,
      inProgress: stats.in_progress?.count || 0,
      completed: stats.completed?.count || 0,
      failed: stats.failed?.count || 0,
      paused: stats.paused?.count || 0,
      totalReportsFetched: Object.values(stats).reduce((sum, s) => sum + (s.totalReports || 0), 0),
      totalFightsSaved: Object.values(stats).reduce((sum, s) => sum + (s.totalFights || 0), 0),
    };
  }

  /**
   * Get all queue items (paginated)
   */
  async getQueueItems(page: number = 1, limit: number = 20, status?: ProcessingStatus): Promise<{ items: QueueItemSummary[]; total: number }> {
    const query: any = {};
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      GuildProcessingQueue.find(query).sort({ priority: 1, createdAt: 1 }).skip(skip).limit(limit).lean(),
      GuildProcessingQueue.countDocuments(query),
    ]);

    return {
      items: items.map((item) => ({
        id: item._id.toString(),
        guildId: item.guildId.toString(),
        guildName: item.guildName,
        guildRealm: item.guildRealm,
        guildRegion: item.guildRegion,
        jobType: item.jobType,
        status: item.status,
        priority: item.priority,
        progress: {
          percentComplete: item.progress.percentComplete,
          reportsFetched: item.progress.reportsFetched,
          totalReportsEstimate: item.progress.totalReportsEstimate,
          fightsSaved: item.progress.fightsSaved,
          currentPage: item.progress.currentPage,
        },
        errorCount: item.errorCount,
        lastError: item.lastError,
        lastErrorAt: item.lastErrorAt,
        errorType: item.errorType,
        isPermanentError: item.isPermanentError,
        failureReason: item.failureReason,
        createdAt: item.createdAt,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        lastActivityAt: item.lastActivityAt,
      })),
      total,
    };
  }

  /**
   * Pause a specific guild's processing
   */
  async pauseGuild(guildId: string): Promise<boolean> {
    const queueItem = await GuildProcessingQueue.findOne({
      guildId: new mongoose.Types.ObjectId(guildId),
    });

    if (!queueItem) {
      return false;
    }

    if (queueItem.status === "in_progress" || queueItem.status === "pending") {
      await queueItem.pause();
      return true;
    }

    return false;
  }

  /**
   * Resume a specific guild's processing
   */
  async resumeGuild(guildId: string): Promise<boolean> {
    const queueItem = await GuildProcessingQueue.findOne({
      guildId: new mongoose.Types.ObjectId(guildId),
    });

    if (!queueItem) {
      return false;
    }

    if (queueItem.status === "paused" || queueItem.status === "failed") {
      await queueItem.resume();
      return true;
    }

    return false;
  }

  /**
   * Retry a failed guild
   */
  async retryGuild(guildId: string): Promise<boolean> {
    const queueItem = await GuildProcessingQueue.findOne({
      guildId: new mongoose.Types.ObjectId(guildId),
    });

    if (!queueItem) {
      return false;
    }

    if (queueItem.status === "failed") {
      queueItem.status = "pending";
      queueItem.retryCount = 0;
      queueItem.errorCount = 0;
      queueItem.lastError = undefined;
      await queueItem.save();
      return true;
    }

    return false;
  }

  /**
   * Remove a guild from the queue
   */
  async removeFromQueue(guildId: string): Promise<boolean> {
    const result = await GuildProcessingQueue.deleteOne({
      guildId: new mongoose.Types.ObjectId(guildId),
    });

    return result.deletedCount > 0;
  }

  private async refreshProcessorPauseState(): Promise<void> {
    const state = await ProcessorState.findOne({ key: this.processorStateKey }).lean();
    if (state) {
      this.isPaused = state.isPaused === true;
    }
  }

  /**
   * Pause all background processing
   */
  async pauseAll(): Promise<void> {
    this.isPaused = true;
    await ProcessorState.updateOne(
      { key: this.processorStateKey },
      {
        $set: {
          isPaused: true,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    logger.info("[BackgroundProcessor] All background processing paused");
  }

  /**
   * Resume all background processing
   */
  async resumeAll(): Promise<void> {
    this.isPaused = false;
    await ProcessorState.updateOne(
      { key: this.processorStateKey },
      {
        $set: {
          isPaused: false,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    logger.info("[BackgroundProcessor] All background processing resumed");
  }

  /**
   * Get processor status
   */
  getStatus(): {
    isRunning: boolean;
    isPaused: boolean;
    currentGuild: string | null;
  } {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentGuild: this.currentGuildQueue ? `${this.currentGuildQueue.guildName}-${this.currentGuildQueue.guildRealm}` : null,
    };
  }

  /**
   * Check if we should update global rankings and do so if needed
   */
  private async checkAndUpdateGlobalRankings(): Promise<void> {
    try {
      // Check if there are truly no more items to process
      const stats = await GuildProcessingQueue.getQueueStats();
      const hasActiveItems = (stats.pending?.count || 0) > 0 || (stats.in_progress?.count || 0) > 0 || (stats.paused?.count || 0) > 0;

      if (hasActiveItems) {
        return; // Still have items to process
      }

      // Check if we have any completed guilds since last update
      const completedCount = stats.completed?.count || 0;
      if (completedCount === 0) {
        return; // No work has been done since last rankings update
      }

      // Check if we recently updated (within last 5 minutes) - safety debounce
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (this.lastGlobalRankingsUpdate && this.lastGlobalRankingsUpdate > fiveMinutesAgo) {
        return; // Already updated recently
      }

      logger.info(`[BackgroundProcessor] All guilds processed (${completedCount} completed), recalculating global rankings`);

      try {
        await guildService.calculateGuildRankingsForAllRaids();
        this.lastGlobalRankingsUpdate = new Date();
        logger.info("[BackgroundProcessor] Global rankings recalculation complete");

        // Clear completed queue entries to prevent re-triggering rankings
        // This ensures rankings are only recalculated when NEW guilds are processed
        const deleteResult = await GuildProcessingQueue.deleteMany({
          status: "completed",
        });
        logger.info(`[BackgroundProcessor] Cleared ${deleteResult.deletedCount} completed queue entries`);
      } catch (globalRankError) {
        logger.error("[BackgroundProcessor] Failed to recalculate global rankings:", globalRankError instanceof Error ? globalRankError.message : "Unknown");
        // Don't throw - this is a non-critical operation
      }
    } catch (error) {
      logger.error("[BackgroundProcessor] Error checking for global rankings update:", error instanceof Error ? error.message : "Unknown");
    }
  }

  /**
   * Handle rate limit pause event
   */
  private onRateLimitPause(): void {
    logger.info("[BackgroundProcessor] Rate limit pause received");
    // The processing loop will check rate limits before each operation
  }

  /**
   * Handle rate limit resume event
   */
  private onRateLimitResume(): void {
    logger.info("[BackgroundProcessor] Rate limit resume received");
    // The processing loop will automatically resume
  }
}

// Export singleton instance
export const backgroundGuildProcessor = new BackgroundGuildProcessor();
export default backgroundGuildProcessor;
