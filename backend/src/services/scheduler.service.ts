import cron from "node-cron";
import mongoose from "mongoose";
import Guild, { IGuild } from "../models/Guild";
import guildService from "./guild.service";
import twitchService, { StreamStatus } from "./twitch.service";
import tierListService from "./tierlist.service";
import characterService from "./character.service";
import characterMechanicsService from "./character-mechanics.service";
import characterTierListService from "./character-tierlist.service";
import raidAnalyticsService from "./raid-analytics.service";
import guildNetworkService from "./guild-network.service";
import guildProfileHighlightsService from "./guild-profile-highlights.service";
import cacheService from "./cache.service";
import cacheWarmerService from "./cache-warmer.service";
import taskTracker from "./task-tracker.service";
import fightVodService from "./fight-vod.service";
import characterAchievementService from "./character-achievement.service";
import mythicPlusService from "./mythic-plus.service";
import characterMediaService from "./character-media.service";
import ccgPublisherService from "./ccg-publisher.service";
import ccgService from "./ccg.service";
import { CURRENT_RAID_IDS } from "../config/guilds";
import { CCG_FEATURE_ENABLED } from "../config/ccg";
import logger from "../utils/logger";

// Polling intervals from environment (in minutes), with sensible defaults
const POLLING_ACTIVE_GUILDS_MS = parseInt(process.env.POLLING_ACTIVE_GUILDS_MINUTES || "5", 10) * 60 * 1000;
const POLLING_RAIDING_GUILDS_MS = parseInt(process.env.POLLING_RAIDING_GUILDS_MINUTES || "3", 10) * 60 * 1000;
const POLLING_KNOWN_SCHEDULE_NOT_TODAY_MS = 30 * 60 * 1000; // 30 minutes
const POLLING_OFF_HOURS_ACTIVE_MS = 60 * 60 * 1000; // 1 hour
const POLLING_TWITCH_MS = 15 * 60 * 1000; // 15 minutes
const POLLING_FIGHT_VODS_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_STATUS_ACTIVE_DAYS = 14;
const SCHEDULE_POLLING_WINDOW_BEFORE_HOURS = 1;
const SCHEDULE_POLLING_WINDOW_AFTER_HOURS = 1;
const HOURS_PER_WEEK = 7 * 24;

const HELSINKI_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Helsinki",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/**
 * Yield to the event loop to prevent blocking.
 * Use this in loops to allow request handling.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Add a delay between operations to reduce CPU pressure.
 * @param ms - Milliseconds to wait
 */
function throttleDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateStreamerStatusFields(guildId: mongoose.Types.ObjectId, channelName: string, statusFields: Record<string, unknown>): Promise<void> {
  const setFields: Record<string, unknown> = {};
  const unsetFields: Record<string, ""> = {};

  for (const [field, value] of Object.entries(statusFields)) {
    const path = `streamers.$[streamer].${field}`;
    if (value === undefined) {
      unsetFields[path] = "";
    } else {
      setFields[path] = value;
    }
  }

  await Guild.updateOne(
    { _id: guildId, "streamers.channelName": channelName },
    {
      $set: setFields,
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
    },
    { arrayFilters: [{ "streamer.channelName": channelName }] },
  );
}

/** Minimum interval between cache warming operations (in ms) */
const CACHE_WARM_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const HOME_CACHE_REFRESH_MS = parseInt(process.env.HOME_CACHE_REFRESH_MINUTES || "4", 10) * 60 * 1000;

interface GuildBatchUpdateStats {
  attempted: number;
  skipped: number;
  succeeded: number;
  failed: number;
  withNewData: number;
  raidingStatusChanged: number;
}

interface HotActiveGuildBuckets {
  scheduledWindow: IGuild[];
  scheduledWindowDeferred: IGuild[];
  scheduledTodayOutsideWindowDue: IGuild[];
  scheduledTodayOutsideWindowDeferred: IGuild[];
  unknownSchedule: IGuild[];
  unknownScheduleDeferred: IGuild[];
  knownScheduleNotTodayDue: IGuild[];
  knownScheduleNotTodayDeferred: IGuild[];
}

class UpdateScheduler {
  private hotHoursActiveInterval: NodeJS.Timeout | null = null;
  private hotHoursRaidingInterval: NodeJS.Timeout | null = null;
  private hotHoursTwitchInterval: NodeJS.Timeout | null = null;
  private fightVodResolverInterval: NodeJS.Timeout | null = null;
  private homeCacheRefreshInterval: NodeJS.Timeout | null = null;
  private offHoursActiveInterval: NodeJS.Timeout | null = null;
  private offHoursDailyInterval: NodeJS.Timeout | null = null;
  private isUpdatingHotActive: boolean = false;
  private isUpdatingHotRaiding: boolean = false;
  private isUpdatingTwitchStreams: boolean = false;
  private isResolvingFightVodLinks: boolean = false;
  private isRefreshingHomeCache: boolean = false;
  private isBackfillingFightVodLinks: boolean = false;
  private isCleaningFightVodLinks: boolean = false;
  private isUpdatingOffActive: boolean = false;
  private isUpdatingOffInactive: boolean = false;
  private isUpdatingNightlyWorldRanks: boolean = false;
  private isUpdatingGuildCrests: boolean = false;
  private isUpdatingRefetchRecentReports: boolean = false;
  private isUpdatingTierLists: boolean = false;
  private isUpdatingCharacterRankings: boolean = false;
  private isUpdatingCharacterMechanics: boolean = false;
  private isRebuildingCharacterTierLists: boolean = false;
  private characterMechanicsRebuildPending: boolean = false;
  private isQueueingDeathEventBackfill: boolean = false;
  private isQueueingReportCharacterBackfill: boolean = false;
  private isQueueingCharacterAchievementBackfill: boolean = false;
  private isUpdatingCharacterRaidParticipations: boolean = false;
  private isRebuildingGuildNetworkSnapshot: boolean = false;
  private isRebuildingGuildProfileHighlights: boolean = false;
  private isUpdatingRaidAnalytics: boolean = false;
  private isCheckingHiatus: boolean = false;
  private isUpdatingRaiderIOGuilds: boolean = false;
  private isUpdatingMythicPlusCurrentSeason: boolean = false;
  private isRepairingMythicPlusHistoricalScores: boolean = false;
  private isCleaningCcgGuests: boolean = false;
  private isDiscoveringCcgMedia: boolean = false;
  private isRefreshingCcgMedia: boolean = false;
  private isRecoveringCcgMedia: boolean = false;
  private isBuildingCcgSnapshot: boolean = false;
  private isPublishingCcgWave: boolean = false;
  private lastCacheWarmTime: number = 0;

  private getBlockingDatabaseMaintenanceJob(): string | null {
    if (this.isUpdatingCharacterRaidParticipations) return "character raid participation rebuild";
    if (this.isRebuildingGuildNetworkSnapshot) return "guild network snapshot rebuild";
    if (this.isUpdatingCharacterRankings) return "character rankings refresh";
    if (this.isUpdatingCharacterMechanics) return "character mechanics leaderboard rebuild";
    return null;
  }

  private async updateGuildProgressBatch(guilds: IGuild[], logPrefix: string, throttleMs: number, yieldEvery: number = 1): Promise<GuildBatchUpdateStats> {
    const stats: GuildBatchUpdateStats = {
      attempted: 0,
      skipped: 0,
      succeeded: 0,
      failed: 0,
      withNewData: 0,
      raidingStatusChanged: 0,
    };

    for (let i = 0; i < guilds.length; i++) {
      const blockingJob = this.getBlockingDatabaseMaintenanceJob();
      if (blockingJob) {
        stats.skipped = guilds.length - i;
        logger.info(`${logPrefix} Deferring ${stats.skipped} guild(s) while ${blockingJob} is running`);
        break;
      }

      const guild = guilds[i];
      logger.info(`${logPrefix} Guild ${i + 1}/${guilds.length}: ${guild.name}`);
      stats.attempted++;

      try {
        const result = await guildService.updateGuildProgress((guild._id as mongoose.Types.ObjectId).toString());

        if (!result) {
          stats.failed++;
        } else {
          stats.succeeded++;
          if (result.hasNewData) stats.withNewData++;
          if (result.raidingStatusChanged) stats.raidingStatusChanged++;
        }
      } catch (error) {
        stats.failed++;
        logger.error(`${logPrefix} Guild ${guild.name} failed:`, error);
      }

      if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) {
        await yieldToEventLoop();
      }

      if (i < guilds.length - 1 && throttleMs > 0) {
        await throttleDelay(throttleMs);
      }
    }

    return stats;
  }

  private shouldWarmCachesAfterUpdate(stats: GuildBatchUpdateStats): boolean {
    return stats.withNewData > 0 || stats.raidingStatusChanged > 0;
  }

  private getHelsinkiTime(): { weekday: string; hour: number } {
    const parts = HELSINKI_TIME_FORMATTER.formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hours = parseInt(values.hour, 10) % 24;
    const minutes = parseInt(values.minute, 10);

    return {
      weekday: values.weekday,
      hour: hours + minutes / 60,
    };
  }

  private hasKnownSchedule(guild: IGuild): boolean {
    return (guild.raidSchedule?.days?.length ?? 0) > 0;
  }

  private isScheduledOnDay(guild: IGuild, dayName: string): boolean {
    return guild.raidSchedule?.days?.some((day) => day.day === dayName) ?? false;
  }

  private isWithinSchedulePollingWindow(guild: IGuild, weekday: string, hour: number): boolean {
    const currentDayIndex = WEEKDAY_INDEX[weekday];
    if (currentDayIndex === undefined) return false;

    const currentHourOfWeek = currentDayIndex * 24 + hour;

    return (
      guild.raidSchedule?.days?.some((day) => {
        const scheduleDayIndex = WEEKDAY_INDEX[day.day];
        if (scheduleDayIndex === undefined) return false;

        const scheduleDayStart = scheduleDayIndex * 24;
        const windowStart = scheduleDayStart + day.startHour - SCHEDULE_POLLING_WINDOW_BEFORE_HOURS;
        let windowEnd = scheduleDayStart + day.endHour;
        if (day.endHour < day.startHour) {
          windowEnd += 24;
        }
        windowEnd += SCHEDULE_POLLING_WINDOW_AFTER_HOURS;

        return [currentHourOfWeek, currentHourOfWeek + HOURS_PER_WEEK, currentHourOfWeek - HOURS_PER_WEEK].some((candidateHour) => candidateHour >= windowStart && candidateHour <= windowEnd);
      }) ?? false
    );
  }

  private isDueForUpdate(guild: IGuild, intervalMs: number): boolean {
    if (!guild.lastFetched) return true;
    return guild.lastFetched.getTime() <= Date.now() - intervalMs;
  }

  private bucketHotActiveGuilds(guilds: IGuild[], currentTime: { weekday: string; hour: number }): HotActiveGuildBuckets {
    const buckets: HotActiveGuildBuckets = {
      scheduledWindow: [],
      scheduledWindowDeferred: [],
      scheduledTodayOutsideWindowDue: [],
      scheduledTodayOutsideWindowDeferred: [],
      unknownSchedule: [],
      unknownScheduleDeferred: [],
      knownScheduleNotTodayDue: [],
      knownScheduleNotTodayDeferred: [],
    };

    for (const guild of guilds) {
      if (!this.hasKnownSchedule(guild)) {
        if (this.isDueForUpdate(guild, POLLING_ACTIVE_GUILDS_MS)) {
          buckets.unknownSchedule.push(guild);
        } else {
          buckets.unknownScheduleDeferred.push(guild);
        }
        continue;
      }

      if (this.isWithinSchedulePollingWindow(guild, currentTime.weekday, currentTime.hour)) {
        if (this.isDueForUpdate(guild, POLLING_ACTIVE_GUILDS_MS)) {
          buckets.scheduledWindow.push(guild);
        } else {
          buckets.scheduledWindowDeferred.push(guild);
        }
        continue;
      }

      if (this.isScheduledOnDay(guild, currentTime.weekday)) {
        if (this.isDueForUpdate(guild, POLLING_KNOWN_SCHEDULE_NOT_TODAY_MS)) {
          buckets.scheduledTodayOutsideWindowDue.push(guild);
        } else {
          buckets.scheduledTodayOutsideWindowDeferred.push(guild);
        }
        continue;
      }

      if (this.isDueForUpdate(guild, POLLING_KNOWN_SCHEDULE_NOT_TODAY_MS)) {
        buckets.knownScheduleNotTodayDue.push(guild);
      } else {
        buckets.knownScheduleNotTodayDeferred.push(guild);
      }
    }

    return buckets;
  }

  // Finnish timezone offset check
  private isHotHours(): boolean {
    // Finnish time is EET (UTC+2) or EEST (UTC+3) in summer
    // Hot hours: 16:00 - 01:00 (4 PM - 1 AM Finnish time)
    const now = new Date();

    // Convert to Finnish time (using Europe/Helsinki timezone)
    const finnishTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Helsinki" }));

    const hour = finnishTime.getHours();

    // Hot hours: 16:00 (4 PM) to 01:00 (1 AM)
    // This means: hour >= 16 OR hour < 1
    return hour >= 16 || hour < 1;
  }

  // Start the background update process
  start(): void {
    logger.info("Starting intelligent background update scheduler...");
    logger.info("Finnish time hot hours: 16:00 - 01:00 (4 PM - 1 AM)");
    logger.info("Off hours: 01:00 - 16:00 (1 AM - 4 PM)");

    // HOT HOURS - Active guilds: Check at configured interval
    this.hotHoursActiveInterval = setInterval(async () => {
      if (!this.isHotHours()) return; // Skip if not hot hours

      if (this.isUpdatingHotActive) {
        logger.info("[Hot/Active] Previous update still in progress, skipping...");
        return;
      }
      await this.updateActiveGuilds();
    }, POLLING_ACTIVE_GUILDS_MS);

    // HOT HOURS - Currently raiding guilds: Check at configured interval
    this.hotHoursRaidingInterval = setInterval(async () => {
      if (!this.isHotHours()) return; // Skip if not hot hours

      if (this.isUpdatingHotRaiding) {
        logger.info("[Hot/Raiding] Previous update still in progress, skipping...");
        return;
      }
      await this.updateRaidingGuilds();
    }, POLLING_RAIDING_GUILDS_MS);

    // HOT HOURS - Twitch stream status: Check every 15 minutes
    this.hotHoursTwitchInterval = setInterval(async () => {
      if (!this.isHotHours()) {
        // Outside hot hours, set all streams to offline
        await this.setAllStreamsOffline();
        return;
      }

      if (this.isUpdatingTwitchStreams) {
        logger.info("[Hot/Twitch] Previous update still in progress, skipping...");
        return;
      }
      await this.updateTwitchStreamStatus();
    }, POLLING_TWITCH_MS);

    this.fightVodResolverInterval = setInterval(async () => {
      if (this.isResolvingFightVodLinks) {
        logger.info("[FightVOD] Previous resolver run still in progress, skipping...");
        return;
      }
      await this.resolveFightVodLinks();
    }, POLLING_FIGHT_VODS_MS);

    this.homeCacheRefreshInterval = setInterval(async () => {
      const blockingJob = this.getBlockingDatabaseMaintenanceJob();
      if (blockingJob) {
        logger.info(`[HomeCache] Skipping refresh while ${blockingJob} is running`);
        return;
      }

      if (this.isRefreshingHomeCache) {
        logger.info("[HomeCache] Previous refresh still in progress, skipping...");
        return;
      }

      this.isRefreshingHomeCache = true;
      const taskId = await taskTracker.start("Refresh Home Cache");
      try {
        await cacheWarmerService.warmHomeCacheData();
        await taskTracker.complete(taskId);
      } catch (error) {
        logger.error("[HomeCache] Error refreshing home cache:", error);
        await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      } finally {
        this.isRefreshingHomeCache = false;
      }
    }, HOME_CACHE_REFRESH_MS);

    // OFF HOURS - Active guilds: Check every hour
    this.offHoursActiveInterval = setInterval(async () => {
      if (this.isHotHours()) return; // Skip if hot hours

      if (this.isUpdatingOffActive) {
        logger.info("[Off/Active] Previous update still in progress, skipping...");
        return;
      }
      await this.updateActiveGuildsOffHours();
    }, POLLING_OFF_HOURS_ACTIVE_MS);

    // OFF HOURS - Inactive guilds: Check once per day (at 10 AM Finnish time)
    cron.schedule(
      "0 10 * * *",
      async () => {
        if (this.isUpdatingOffInactive) {
          logger.info("[Daily/Inactive] Previous update still in progress, skipping...");
          return;
        }
        await this.updateInactiveGuilds();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Queue death event backfill (at 00:30 Finnish time)
    // The queued jobs skip fights already marked deathEventsFetchStatus="fetched".
    // Uses lower priority than report-character backfill so later maintenance can overtake it.
    cron.schedule(
      "30 0 * * *",
      async () => {
        if (this.isQueueingDeathEventBackfill) {
          logger.info("[Nightly/DeathEventBackfill] Previous queueing run still in progress, skipping...");
          return;
        }
        await this.queueDeathEventBackfill();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Queue report-level character backfill (at 1 AM Finnish time)
    // The queued jobs skip reports already marked charactersFetchStatus="fetched".
    cron.schedule(
      "0 1 * * *",
      async () => {
        if (this.isQueueingReportCharacterBackfill) {
          logger.info("[Nightly/ReportCharacterBackfill] Previous queueing run still in progress, skipping...");
          return;
        }
        await this.queueReportCharacterBackfill();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    if (CCG_FEATURE_ENABLED) {
      cron.schedule(
        "15 0 * * *",
        async () => {
          if (!this.isCleaningCcgGuests) await this.cleanupCcgGuests();
        },
        { timezone: "Europe/Helsinki" },
      );

      cron.schedule(
        "30 1 * * *",
        async () => {
          if (!this.isDiscoveringCcgMedia) await this.discoverCcgMedia();
        },
        { timezone: "Europe/Helsinki" },
      );

      cron.schedule(
        "50 1 * * *",
        async () => {
          if (!this.isRefreshingCcgMedia) await this.refreshCcgMedia();
        },
        { timezone: "Europe/Helsinki" },
      );

      cron.schedule(
        "*/15 * * * *",
        async () => {
          if (!this.isRecoveringCcgMedia) await this.recoverCcgMedia();
        },
        { timezone: "Europe/Helsinki" },
      );

      cron.schedule(
        "0 3 * * 3",
        async () => {
          if (!this.isBuildingCcgSnapshot) await this.buildWeeklyCcgSnapshot();
        },
        { timezone: "Europe/Helsinki" },
      );

      cron.schedule(
        "30 4 * * 3",
        async () => {
          if (!this.isPublishingCcgWave) await this.publishWeeklyCcgWave();
        },
        { timezone: "Europe/Helsinki" },
      );
    }

    // NIGHTLY: Queue character achievement fingerprints for account matching (at 1:30 AM Finnish time)
    cron.schedule(
      "30 1 * * *",
      async () => {
        if (this.isQueueingCharacterAchievementBackfill) {
          logger.info("[Nightly/CharacterAchievementBackfill] Previous queueing run still in progress, skipping...");
          return;
        }
        await this.queueCharacterAchievementBackfill();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Refresh current-season Mythic+ scores and dungeon runs for active/stale characters (at 2 AM Finnish time)
    cron.schedule(
      "0 2 * * *",
      async () => {
        if (this.isUpdatingMythicPlusCurrentSeason || mythicPlusService.isProcessing()) {
          logger.info("[Nightly/MythicPlus] Previous crawler run still in progress, skipping...");
          return;
        }
        await this.refreshMythicPlusCurrentSeason();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Repair missing historical Mythic+ score rows before the weekly CCG snapshot (at 00:45 Finnish time)
    cron.schedule(
      "45 0 * * *",
      async () => {
        if (this.isRepairingMythicPlusHistoricalScores || mythicPlusService.isProcessing()) {
          logger.info("[Nightly/MythicPlusRepair] Mythic+ crawler is still running, skipping historical score repair...");
          return;
        }
        await this.repairMythicPlusHistoricalScores();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Update all guilds' world ranks for current raid (at 4 AM Finnish time)
    // WCL sometimes updates world ranks with a delay, so this ensures we catch those updates
    cron.schedule(
      "0 4 * * *",
      async () => {
        if (this.isUpdatingNightlyWorldRanks) {
          logger.info("[Nightly/WorldRanks] Previous update still in progress, skipping...");
          return;
        }
        await this.updateAllGuildsWorldRanks();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Refetch 3 most recent reports for all active guilds (at 3 AM Finnish time)
    // This catches any fights that might have been missed during live polling or uploaded late
    cron.schedule(
      "0 3 * * *",
      async () => {
        if (this.isUpdatingRefetchRecentReports) {
          logger.info("[Nightly/RefetchReports] Previous update still in progress, skipping...");
          return;
        }
        await this.refetchRecentReportsForAllActiveGuilds();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Remove stale Twitch VOD references before normal reporting jobs.
    cron.schedule(
      "30 2 * * *",
      async () => {
        if (this.isCleaningFightVodLinks) {
          logger.info("[Nightly/FightVODCleanup] Previous cleanup still in progress, skipping...");
          return;
        }
        await this.cleanupExpiredFightVodLinks();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Update Raider.IO-only guilds (at 5 AM Finnish time)
    // Fetches raid progress from Raider.IO for guilds not found on WarcraftLogs
    // Runs before tier lists and analytics so RIO guild data is included in calculations
    cron.schedule(
      "0 5 * * *",
      async () => {
        if (this.isUpdatingRaiderIOGuilds) {
          logger.info("[Nightly/RaiderIO] Previous update still in progress, skipping...");
          return;
        }
        await this.updateRaiderIOGuilds();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Calculate tier lists (at 6 AM Finnish time)
    // Runs after world ranks + RIO updates so tier lists use all fresh data
    cron.schedule(
      "0 6 * * *",
      async () => {
        if (this.isUpdatingTierLists) {
          logger.info("[Nightly/TierLists] Previous update still in progress, skipping...");
          return;
        }
        await this.calculateTierLists();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Calculate raid analytics (at 7 AM Finnish time, after tier lists)
    // Provides aggregated statistics across all guilds for each raid
    cron.schedule(
      "0 7 * * *",
      async () => {
        if (this.isUpdatingRaidAnalytics) {
          logger.info("[Nightly/RaidAnalytics] Previous update still in progress, skipping...");
          return;
        }
        await this.calculateRaidAnalytics();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Rebuild materialized character raid participation data (at 8 AM Finnish time)
    cron.schedule(
      "0 8 * * *",
      async () => {
        if (this.isUpdatingCharacterRaidParticipations) {
          logger.info("[Nightly/CharacterRaidParticipation] Previous rebuild still in progress, skipping...");
          return;
        }
        await this.rebuildCharacterRaidParticipations().catch(() => undefined);
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Refresh character rankings (at 08:30 Finnish time)
    // Updates zone rankings and encounter rankings for eligible tracked characters
    // Then rebuilds the materialized leaderboard after character identities have been repaired.
    cron.schedule(
      "30 8 * * *",
      async () => {
        if (this.isUpdatingCharacterRankings) {
          logger.info("[Nightly/CharacterRankings] Previous update still in progress, skipping...");
          return;
        }
        await this.refreshCharacterRankings();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Rebuild mechanics leaderboard after death backfill and character rankings are done (at 09:15 Finnish time)
    cron.schedule(
      "15 9 * * *",
      async () => {
        if (this.isUpdatingCharacterMechanics) {
          logger.info("[Nightly/CharacterMechanics] Previous rebuild still in progress, skipping...");
          return;
        }
        await this.refreshCharacterMechanicsLeaderboards();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // Retry the mechanics rebuild during off-hours if rankings finished before the death queue.
    cron.schedule(
      "*/30 9-15 * * *",
      async () => {
        if (!this.characterMechanicsRebuildPending) return;
        await this.refreshCharacterMechanicsLeaderboards();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Update all guild crests (at 9:30 AM Finnish time)
    // Guild crests can be changed by guilds or sometimes fail to fetch initially
    // Independent of other data; keep it off the 08:00 maintenance window.
    cron.schedule(
      "30 9 * * *",
      async () => {
        if (this.isUpdatingGuildCrests) {
          logger.info("[Nightly/GuildCrests] Previous update still in progress, skipping...");
          return;
        }
        await this.updateAllGuildCrests();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Check for hiatus events (at 9 AM Finnish time)
    // Detects guilds that have stopped raiding for 7, 14, or 30 days
    cron.schedule(
      "0 9 * * *",
      async () => {
        if (this.isCheckingHiatus) {
          logger.info("[Nightly/Hiatus] Previous check still in progress, skipping...");
          return;
        }
        await this.checkHiatusEvents();
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    // NIGHTLY: Full cache warmup at 11:00 Finnish time (after all other nightly jobs)
    // Runs last to ensure all caches are warmed with the freshest data
    cron.schedule(
      "0 11 * * *",
      async () => {
        const taskId = await taskTracker.start("Nightly Cache Warmup");
        logger.info("[Nightly/CacheWarmup] Starting full cache warm-up...");
        try {
          await cacheWarmerService.warmAllCaches();
          logger.info("[Nightly/CacheWarmup] Full cache warm-up completed");
          await taskTracker.complete(taskId);
        } catch (error) {
          logger.error("[Nightly/CacheWarmup] Error:", error);
          await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
        }
      },
      {
        timezone: "Europe/Helsinki",
      },
    );

    logger.info("Background scheduler started:");
    logger.info("  - Hot hours (16:00-01:00):");
    logger.info(`    * Active guilds: every ${POLLING_ACTIVE_GUILDS_MS / 60000} minutes`);
    logger.info(`    * Raiding guilds: every ${POLLING_RAIDING_GUILDS_MS / 60000} minutes`);
    logger.info(`    * Known schedule, not today: every ${POLLING_KNOWN_SCHEDULE_NOT_TODAY_MS / 60000} minutes`);
    logger.info("    * Twitch streams: every 15 minutes");
    logger.info("  - Off hours (01:00-16:00):");
    logger.info("    * Active guilds: every 60 minutes");
    logger.info("    * Inactive guilds: once daily at 10:00");
    logger.info("    * Twitch streams: all marked offline");
    logger.info("  - Fight VOD resolver: every 30 minutes");
    logger.info("  - Nightly jobs (Europe/Helsinki):");
    logger.info("    * Report character backfill queue: daily at 01:00");
    logger.info("    * Character achievement account matching backfill: daily at 01:30");
    logger.info("    * Mythic+ current season refresh: daily at 02:00");
    logger.info("    * Mythic+ historical score repair: daily at 00:45");
    logger.info("    * Fight VOD cleanup: daily at 02:30");
    logger.info("    * Refetch recent reports: daily at 03:00");
    logger.info("    * World ranks update: daily at 04:00");
    logger.info("    * Raider.IO guilds update: daily at 05:00");
    logger.info("    * Tier lists calculation: daily at 06:00");
    logger.info("    * Raid analytics calculation: daily at 07:00");
    logger.info("    * Character raid participation rebuild: daily at 08:00");
    logger.info("    * Guild crests update: daily at 09:30");
    logger.info("    * Character rankings refresh + leaderboard rebuild: daily at 08:30");
    logger.info("    * Character mechanics leaderboard rebuild: daily at 09:15");
    logger.info("    * Character mechanics pending retry: every 30 minutes from 09:00-15:30");
    logger.info("    * Hiatus event check: daily at 09:00");
    logger.info("    * Full cache warmup: daily at 11:00");
    if (CCG_FEATURE_ENABLED) {
      logger.info("  - SuomiWoW CCG jobs (Europe/Helsinki):");
      logger.info("    * Guest expiry reconciliation: daily at 00:15");
      logger.info("    * New-character media discovery: daily at 01:30");
      logger.info("    * Active-character media refresh: daily at 01:50");
      logger.info("    * Media queue recovery: every 15 minutes");
      logger.info("    * Current snapshot: Wednesday at 03:00");
      logger.info("    * Current publication: Wednesday at 04:30");
      characterMediaService.startProcessing();
    }

    characterAchievementService
      .resumeInterruptedBackfill()
      .then((started) => {
        if (started) {
          logger.info("[CharacterAchievementBackfill] Startup resume started processor");
        }
      })
      .catch((error) => logger.error("[CharacterAchievementBackfill] Startup resume failed:", error));

    // Do an initial update based on current time
    if (this.isHotHours()) {
      logger.info("Currently HOT HOURS - starting initial active guild check");
      this.updateActiveGuilds();
    } else {
      logger.info("Currently OFF HOURS - starting initial active guild check");
      this.updateActiveGuildsOffHours();
    }
  }

  // Check Twitch stream status on startup (if enabled)
  async checkStreamsOnStartup(): Promise<void> {
    if (!twitchService.isEnabled()) {
      logger.info("Twitch integration is disabled, skipping startup stream check");
      return;
    }

    logger.info("Checking Twitch stream status on startup...");
    if (this.isHotHours()) {
      await this.updateTwitchStreamStatus();
    } else {
      await this.setAllStreamsOffline();
    }
    logger.info("Startup stream check completed");
  }

  // Update inactive guilds on startup (if enabled)
  async updateInactiveGuildsOnStartup(): Promise<void> {
    logger.info("Updating inactive guilds on startup...");
    await this.updateInactiveGuilds();
    logger.info("Startup inactive guilds update completed");
  }

  // Update world ranks on startup (if enabled)
  async updateWorldRanksOnStartup(): Promise<void> {
    logger.info("Updating world ranks on startup...");
    await this.updateAllGuildsWorldRanks();
    logger.info("Startup world ranks update completed");
  }

  // Update guild crests on startup (if enabled)
  async updateGuildCrestsOnStartup(): Promise<void> {
    logger.info("Updating guild crests on startup...");
    await this.updateAllGuildCrests();
    logger.info("Startup guild crests update completed");
  }

  // Refetch recent reports on startup (if enabled)
  async refetchRecentReportsOnStartup(): Promise<void> {
    logger.info("Refetching recent reports on startup...");
    await this.refetchRecentReportsForAllActiveGuilds();
    logger.info("Startup recent reports refetch completed");
  }

  // Refresh character rankings on startup (if enabled)
  async refreshCharacterRankingsOnStartup(): Promise<void> {
    logger.info("Refreshing character rankings on startup...");
    await this.refreshCharacterRankings();
    logger.info("Startup character rankings refresh completed");
  }

  // Trigger Raider.IO guilds update from admin panel (returns false if already running)
  triggerRaiderIOGuildsUpdate(): boolean {
    if (this.isUpdatingRaiderIOGuilds) {
      return false;
    }
    this.updateRaiderIOGuilds()
      .then(() => logger.info("[Admin] Raider.IO guilds update completed"))
      .catch((err) => logger.error("[Admin] Raider.IO guilds update failed:", err));
    return true;
  }

  // Trigger character rankings refresh from admin panel (returns false if already running)
  triggerCharacterRankingsRefresh(): boolean {
    if (this.isUpdatingCharacterRankings) {
      return false;
    }
    this.refreshCharacterRankings()
      .then(() => logger.info("[Admin] Character rankings refresh completed"))
      .catch((err) => logger.error("[Admin] Character rankings refresh failed:", err));
    return true;
  }

  private async cleanupCcgGuests(): Promise<void> {
    this.isCleaningCcgGuests = true;
    const taskId = await taskTracker.start("CCG Guest Expiry Reconciliation");
    try {
      const result = await ccgService.cleanupExpiredGuestData();
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[CCG/GuestCleanup] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isCleaningCcgGuests = false;
    }
  }

  private async discoverCcgMedia(): Promise<void> {
    this.isDiscoveringCcgMedia = true;
    const taskId = await taskTracker.start("CCG Character Media Discovery");
    try {
      const result = await characterMediaService.enqueueMissing();
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[CCG/MediaDiscovery] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isDiscoveringCcgMedia = false;
    }
  }

  private async refreshCcgMedia(): Promise<void> {
    this.isRefreshingCcgMedia = true;
    const taskId = await taskTracker.start("CCG Active Character Media Refresh");
    try {
      const result = await characterMediaService.enqueueActiveCurrent();
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[CCG/MediaRefresh] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isRefreshingCcgMedia = false;
    }
  }

  private async recoverCcgMedia(): Promise<void> {
    this.isRecoveringCcgMedia = true;
    try {
      const recovered = await characterMediaService.recoverStaleProcessing();
      if (recovered > 0) logger.info(`[CCG/MediaRecovery] Recovered ${recovered} stale item(s)`);
    } catch (error) {
      logger.error("[CCG/MediaRecovery] Error:", error);
    } finally {
      this.isRecoveringCcgMedia = false;
    }
  }

  private async buildWeeklyCcgSnapshot(): Promise<void> {
    this.isBuildingCcgSnapshot = true;
    const taskId = await taskTracker.start("CCG Weekly Current Snapshot");
    try {
      const sets = await ccgPublisherService.getEnabledCurrentSets();
      const results = [];
      for (const set of sets) results.push({ zoneId: set.zoneId, slug: set.slug, ...(await ccgPublisherService.buildSnapshot(set.zoneId)) });
      await taskTracker.complete(taskId, { sets: results });
    } catch (error) {
      logger.error("[CCG/Snapshot] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isBuildingCcgSnapshot = false;
    }
  }

  private async publishWeeklyCcgWave(): Promise<void> {
    this.isPublishingCcgWave = true;
    const taskId = await taskTracker.start("CCG Weekly Current Publication");
    try {
      const sets = await ccgPublisherService.getEnabledCurrentSets();
      const results = [];
      for (const set of sets) results.push({ zoneId: set.zoneId, slug: set.slug, ...(await ccgPublisherService.publishLatestWave(set.slug)) });
      await taskTracker.complete(taskId, { sets: results });
    } catch (error) {
      logger.error("[CCG/Publication] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isPublishingCcgWave = false;
    }
  }

  triggerCharacterMechanicsLeaderboardRefresh(): boolean {
    if (this.isUpdatingCharacterMechanics) {
      return false;
    }
    this.refreshCharacterMechanicsLeaderboards()
      .then(() => logger.info("[Admin] Character mechanics leaderboard rebuild completed"))
      .catch((err) => logger.error("[Admin] Character mechanics leaderboard rebuild failed:", err));
    return true;
  }

  async queueReportCharacterBackfill(): Promise<void> {
    this.isQueueingReportCharacterBackfill = true;
    const taskId = await taskTracker.start("Queue Report Character Backfill");

    try {
      const result = await guildService.queueAllGuildsForReportCharacterBackfill();
      logger.info(`[Nightly/ReportCharacterBackfill] Queued ${result.queued} guild(s), skipped ${result.skipped}`);
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[Nightly/ReportCharacterBackfill] Error queueing jobs:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isQueueingReportCharacterBackfill = false;
    }
  }

  async queueDeathEventBackfill(): Promise<void> {
    this.isQueueingDeathEventBackfill = true;
    const taskId = await taskTracker.start("Queue Death Event Backfill");

    try {
      const result = await guildService.queueAllGuildsForDeathRescan(25);
      logger.info(`[Nightly/DeathEventBackfill] Queued ${result.queued} guild(s), skipped ${result.skipped}`);
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[Nightly/DeathEventBackfill] Error queueing jobs:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isQueueingDeathEventBackfill = false;
    }
  }

  async queueCharacterAchievementBackfill(): Promise<void> {
    this.isQueueingCharacterAchievementBackfill = true;
    const taskId = await taskTracker.start("Schedule Character Achievement Backfill");

    try {
      const result = await characterAchievementService.triggerBackfill();
      logger.info(
        `[Nightly/CharacterAchievementBackfill] Queued ${result.enqueue.queued} new character(s), updated ${result.enqueue.updated}, existing ${result.enqueue.existing}, processorStarted=${result.started}`,
      );
      await taskTracker.complete(taskId, {
        queued: result.enqueue.queued,
        updated: result.enqueue.updated,
        existing: result.enqueue.existing,
        skippedWithFingerprint: result.enqueue.skippedWithFingerprint,
        processorStarted: result.started,
      });
    } catch (error) {
      logger.error("[Nightly/CharacterAchievementBackfill] Error queueing jobs:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isQueueingCharacterAchievementBackfill = false;
    }
  }

  async refreshMythicPlusCurrentSeason(): Promise<void> {
    if (mythicPlusService.isProcessing()) {
      logger.info("[Nightly/MythicPlus] Mythic+ crawler is already running, skipping current-season refresh");
      return;
    }

    this.isUpdatingMythicPlusCurrentSeason = true;
    const taskId = await taskTracker.start("Refresh Mythic+ Current Season");

    try {
      const result = await mythicPlusService.triggerCurrentSeasonCrawl();
      logger.info(
        `[Nightly/MythicPlus] Current season refresh queued for ${result.enqueue.currentSeason ?? "unknown season"}: ${result.enqueue.profileJobs.candidates} profile candidate(s), ${result.enqueue.detailJobs.candidates} dungeon candidate(s), processorStarted=${result.started}`,
      );
      await taskTracker.complete(taskId, {
        currentSeason: result.enqueue.currentSeason,
        candidates: result.enqueue.candidates,
        profileJobs: result.enqueue.profileJobs,
        detailJobs: result.enqueue.detailJobs,
        processorStarted: result.started,
      });
    } catch (error) {
      logger.error("[Nightly/MythicPlus] Error queueing current-season refresh:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingMythicPlusCurrentSeason = false;
    }
  }

  async repairMythicPlusHistoricalScores(): Promise<void> {
    if (mythicPlusService.isProcessing()) {
      logger.info("[Nightly/MythicPlusRepair] Mythic+ crawler is already running, skipping historical score repair");
      return;
    }

    this.isRepairingMythicPlusHistoricalScores = true;
    const taskId = await taskTracker.start("Repair Mythic+ Historical Scores");

    try {
      const result = await mythicPlusService.triggerHistoricalScoreRepair();
      logger.info(
        `[Nightly/MythicPlusRepair] Queued ${result.enqueue.queued} character(s) covering ${result.enqueue.missingSeasonPairs} missing character-season score row(s); processorStarted=${result.started}`,
      );
      await taskTracker.complete(taskId, {
        candidates: result.enqueue.candidates,
        queued: result.enqueue.queued,
        missingSeasonPairs: result.enqueue.missingSeasonPairs,
        processorStarted: result.started,
      });
    } catch (error) {
      logger.error("[Nightly/MythicPlusRepair] Error queueing historical score repair:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isRepairingMythicPlusHistoricalScores = false;
    }
  }

  // Trigger character raid participation rebuild from admin panel (returns false if already running)
  triggerCharacterRaidParticipationRebuild(): boolean {
    if (this.isUpdatingCharacterRaidParticipations) {
      return false;
    }
    this.rebuildCharacterRaidParticipations()
      .then(() => logger.info("[Admin] Character raid participation rebuild completed"))
      .catch((err) => logger.error("[Admin] Character raid participation rebuild failed:", err));
    return true;
  }

  triggerGuildNetworkSnapshotRebuild(): boolean {
    if (this.isRebuildingGuildNetworkSnapshot) {
      return false;
    }
    this.rebuildGuildNetworkSnapshot()
      .then(() => logger.info("[Admin] Guild network snapshot rebuild completed"))
      .catch((err) => logger.error("[Admin] Guild network snapshot rebuild failed:", err));
    return true;
  }

  async ensureGuildNetworkSnapshotOnStartup(): Promise<void> {
    const existing = await guildNetworkService.getActiveMeta();
    if (existing?.movementReady) {
      logger.info(`[GuildNetwork] Active snapshot already exists (${existing.characterCount} characters, generated ${existing.generatedAt.toISOString()})`);
      return;
    }

    logger.info(existing ? "[GuildNetwork] Active snapshot has no movement data; rebuilding" : "[GuildNetwork] No active snapshot found; building initial snapshot");
    await this.rebuildGuildNetworkSnapshot();
  }

  // Calculate tier lists on startup (if enabled)
  async calculateTierListsOnStartup(): Promise<void> {
    logger.info("Calculating tier lists on startup...");
    await this.calculateTierLists();
    logger.info("Startup tier lists calculation completed");
  }

  // Calculate raid analytics on startup (if enabled)
  async calculateRaidAnalyticsOnStartup(): Promise<void> {
    logger.info("Calculating raid analytics on startup...");
    await this.calculateRaidAnalytics();
    logger.info("Startup raid analytics calculation completed");
  }

  // NIGHTLY: Calculate tier lists
  async calculateTierLists(raidId?: number): Promise<void> {
    this.isUpdatingTierLists = true;
    const taskId = await taskTracker.start("Calculate Tier Lists", raidId ? { raidId } : undefined);

    try {
      if (raidId) {
        logger.info(`[Admin/TierLists] Starting tier list calculation for raid ${raidId}...`);
      } else {
        logger.info("[Nightly/TierLists] Starting tier list calculation...");
      }
      // Tier lists are always calculated for all raids since the overall ranking depends on all data.
      // The raidId parameter is logged for context but the full recalculation runs regardless.
      await tierListService.calculateTierLists();

      // Invalidate tier list caches and warm them with fresh data
      await cacheService.invalidateTierListCaches();
      await cacheWarmerService.warmTierListCaches();

      logger.info("[Nightly/TierLists] Tier list calculation completed");
      await taskTracker.complete(taskId);
    } catch (error) {
      logger.error("[Nightly/TierLists] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingTierLists = false;
    }
  }

  // NIGHTLY: Calculate raid analytics
  async calculateRaidAnalytics(raidId?: number): Promise<void> {
    this.isUpdatingRaidAnalytics = true;
    const taskId = await taskTracker.start("Calculate Raid Analytics", raidId ? { raidId } : undefined);

    try {
      if (raidId) {
        logger.info(`[Admin/RaidAnalytics] Starting raid analytics calculation for raid ${raidId}...`);
        await raidAnalyticsService.calculateRaidAnalytics(raidId);
      } else {
        logger.info("[Nightly/RaidAnalytics] Starting raid analytics calculation...");
        await raidAnalyticsService.calculateAllRaidAnalytics();
      }

      // Invalidate raid analytics caches and warm them with fresh data
      await cacheService.invalidateRaidAnalyticsCaches();
      await cacheWarmerService.warmRaidAnalyticsCaches();

      logger.info("[Nightly/RaidAnalytics] Raid analytics calculation completed");
      await taskTracker.complete(taskId);
    } catch (error) {
      logger.error("[Nightly/RaidAnalytics] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingRaidAnalytics = false;
    }
  }

  // NIGHTLY: Check for hiatus events
  async checkHiatusEvents(): Promise<void> {
    this.isCheckingHiatus = true;
    const taskId = await taskTracker.start("Check Hiatus Events");

    try {
      logger.info("[Nightly/Hiatus] Starting hiatus event check...");
      await guildService.checkForHiatusEvents();
      logger.info("[Nightly/Hiatus] Hiatus event check completed");
      await taskTracker.complete(taskId);
    } catch (error) {
      logger.error("[Nightly/Hiatus] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isCheckingHiatus = false;
    }
  }

  // Stop the background process
  stop(): void {
    if (this.hotHoursActiveInterval) {
      clearInterval(this.hotHoursActiveInterval);
      this.hotHoursActiveInterval = null;
    }
    if (this.hotHoursRaidingInterval) {
      clearInterval(this.hotHoursRaidingInterval);
      this.hotHoursRaidingInterval = null;
    }
    if (this.hotHoursTwitchInterval) {
      clearInterval(this.hotHoursTwitchInterval);
      this.hotHoursTwitchInterval = null;
    }
    if (this.fightVodResolverInterval) {
      clearInterval(this.fightVodResolverInterval);
      this.fightVodResolverInterval = null;
    }
    if (this.homeCacheRefreshInterval) {
      clearInterval(this.homeCacheRefreshInterval);
      this.homeCacheRefreshInterval = null;
    }
    if (this.offHoursActiveInterval) {
      clearInterval(this.offHoursActiveInterval);
      this.offHoursActiveInterval = null;
    }
    logger.info("Background scheduler stopped");
  }

  // Update activity status for all guilds based on their last log time
  // Guilds with recent Raider.IO current-tier progress are also considered active
  private async updateGuildActivityStatus(): Promise<void> {
    try {
      const activeCutoff = new Date();
      activeCutoff.setDate(activeCutoff.getDate() - ACTIVITY_STATUS_ACTIVE_DAYS);

      // Mark guilds as inactive if no WCL logs within the active cutoff
      // Exclude guilds that are RIO-only (wclStatus=not_found) with active RIO status -
      // those are managed by updateRaiderIOGuilds instead
      await Guild.updateMany(
        {
          wclStatus: { $ne: "not_found" },
          $or: [{ lastLogEndTime: { $lt: activeCutoff } }, { lastLogEndTime: { $exists: false } }],
        },
        { $set: { activityStatus: "inactive" } },
      );

      // Mark guilds as active if they have WCL logs within the active cutoff
      await Guild.updateMany({ lastLogEndTime: { $gte: activeCutoff } }, { $set: { activityStatus: "active" } });
    } catch (error) {
      logger.error("[Activity Status] Error updating guild activity status:", error);
    }
  }

  // HOT HOURS: Update active guilds at the configured interval during 16:00-01:00
  async updateActiveGuilds(): Promise<void> {
    const blockingJob = this.getBlockingDatabaseMaintenanceJob();
    if (blockingJob) {
      logger.info(`[Hot/Active] Skipping active guild update while ${blockingJob} is running`);
      return;
    }

    this.isUpdatingHotActive = true;
    const taskId = await taskTracker.start("Update Active Guilds (Hot Hours)");

    try {
      // First, update activity statuses
      await this.updateGuildActivityStatus();

      // Get active guilds that are NOT currently raiding (raiding guilds handled separately)
      // Skip guilds marked as not found on WarcraftLogs
      const activeGuilds = await Guild.find({
        activityStatus: "active",
        isCurrentlyRaiding: { $ne: true },
        wclStatus: { $ne: "not_found" },
        excludedRaidIds: { $nin: CURRENT_RAID_IDS },
      });

      if (activeGuilds.length === 0) {
        logger.info("[Hot/Active] No active guilds to update");
        await taskTracker.complete(taskId, { guildsUpdated: 0 });
        return;
      }

      const currentTime = this.getHelsinkiTime();
      const buckets = this.bucketHotActiveGuilds(activeGuilds, currentTime);
      const guilds = [...buckets.scheduledWindow, ...buckets.unknownSchedule, ...buckets.scheduledTodayOutsideWindowDue, ...buckets.knownScheduleNotTodayDue];

      if (guilds.length === 0) {
        logger.info(
          `[Hot/Active] No active guilds due for update (${activeGuilds.length} active; deferred: ${buckets.scheduledWindowDeferred.length} in schedule window, ${buckets.unknownScheduleDeferred.length} unknown schedule, ${buckets.scheduledTodayOutsideWindowDeferred.length} scheduled today outside window, ${buckets.knownScheduleNotTodayDeferred.length} known schedule not today; now=${currentTime.weekday} ${currentTime.hour.toFixed(2)})`,
        );
        await taskTracker.complete(taskId, {
          guildsUpdated: 0,
          activeGuilds: activeGuilds.length,
          scheduledWindowDeferred: buckets.scheduledWindowDeferred.length,
          unknownScheduleDeferred: buckets.unknownScheduleDeferred.length,
          scheduledTodayOutsideWindowDeferred: buckets.scheduledTodayOutsideWindowDeferred.length,
          knownScheduleNotTodayDeferred: buckets.knownScheduleNotTodayDeferred.length,
        });
        return;
      }

      logger.info(
        `[Hot/Active] Updating ${guilds.length}/${activeGuilds.length} due active guild(s): ${buckets.scheduledWindow.length} in schedule window, ${buckets.unknownSchedule.length} unknown schedule, ${buckets.scheduledTodayOutsideWindowDue.length} scheduled today outside window, ${buckets.knownScheduleNotTodayDue.length} known schedule not today (deferred: ${buckets.scheduledWindowDeferred.length} in schedule window, ${buckets.unknownScheduleDeferred.length} unknown schedule, ${buckets.scheduledTodayOutsideWindowDeferred.length} scheduled today outside window, ${buckets.knownScheduleNotTodayDeferred.length} known schedule not today; now=${currentTime.weekday} ${currentTime.hour.toFixed(2)})`,
      );

      const stats = await this.updateGuildProgressBatch(guilds, "[Hot/Active]", 100);

      logger.info(
        `[Hot/Active] Completed updating ${stats.succeeded}/${stats.attempted} guild(s), failed ${stats.failed}, skipped ${stats.skipped}, new data ${stats.withNewData}, raiding changes ${stats.raidingStatusChanged}`,
      );

      // Warm current raid caches with fresh data (stale-while-revalidate handles serving old data)
      if (this.shouldWarmCachesAfterUpdate(stats)) {
        await this.debouncedWarmCurrentRaidCaches();
      }
      await taskTracker.complete(taskId, { guildsUpdated: stats.succeeded, guildsFailed: stats.failed, guildsSkipped: stats.skipped, withNewData: stats.withNewData, raidingStatusChanged: stats.raidingStatusChanged });
    } catch (error) {
      logger.error("[Hot/Active] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingHotActive = false;
    }
  }

  // HOT HOURS: Update currently raiding guilds at the configured interval during 16:00-01:00
  private async updateRaidingGuilds(): Promise<void> {
    const blockingJob = this.getBlockingDatabaseMaintenanceJob();
    if (blockingJob) {
      logger.info(`[Hot/Raiding] Skipping raiding guild update while ${blockingJob} is running`);
      return;
    }

    this.isUpdatingHotRaiding = true;
    const taskId = await taskTracker.start("Update Raiding Guilds (Hot Hours)");

    try {
      // Get guilds that are currently raiding (excluding guilds not found on WCL)
      const allRaidingGuilds = await guildService.getGuildsCurrentlyRaiding();
      const raidingGuilds = allRaidingGuilds.filter((guild) => guild.wclStatus !== "not_found");

      if (raidingGuilds.length === 0) {
        // No raiding guilds, nothing to do
        await taskTracker.complete(taskId, { guildsUpdated: 0 });
        return;
      }

      logger.info(`[Hot/Raiding] Updating ${raidingGuilds.length} actively raiding guild(s)...`);

      const stats = await this.updateGuildProgressBatch(raidingGuilds, "[Hot/Raiding]", 100);

      logger.info(
        `[Hot/Raiding] Completed updating ${stats.succeeded}/${stats.attempted} guild(s), failed ${stats.failed}, skipped ${stats.skipped}, new data ${stats.withNewData}, raiding changes ${stats.raidingStatusChanged}`,
      );

      // Warm current raid caches with fresh data (stale-while-revalidate handles serving old data)
      if (this.shouldWarmCachesAfterUpdate(stats)) {
        await this.debouncedWarmCurrentRaidCaches();
      }
      await taskTracker.complete(taskId, { guildsUpdated: stats.succeeded, guildsFailed: stats.failed, guildsSkipped: stats.skipped, withNewData: stats.withNewData, raidingStatusChanged: stats.raidingStatusChanged });
    } catch (error) {
      logger.error("[Hot/Raiding] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingHotRaiding = false;
    }
  }

  // OFF HOURS: Update active guilds (every hour during 01:00-16:00)
  private async updateActiveGuildsOffHours(): Promise<void> {
    const blockingJob = this.getBlockingDatabaseMaintenanceJob();
    if (blockingJob) {
      logger.info(`[Off/Active] Skipping active guild update while ${blockingJob} is running`);
      return;
    }

    this.isUpdatingOffActive = true;
    const taskId = await taskTracker.start("Update Active Guilds (Off Hours)");

    try {
      // First, update activity statuses
      await this.updateGuildActivityStatus();

      // Get active guilds (not currently raiding during off hours is unlikely, but check anyway)
      // Skip guilds marked as not found on WarcraftLogs
      const guilds = await Guild.find({
        activityStatus: "active",
        isCurrentlyRaiding: { $ne: true },
        wclStatus: { $ne: "not_found" },
      });

      if (guilds.length === 0) {
        logger.info("[Off/Active] No active guilds to update");
        await taskTracker.complete(taskId, { guildsUpdated: 0 });
        return;
      }

      logger.info(`[Off/Active] Updating ${guilds.length} active guild(s)...`);

      const stats = await this.updateGuildProgressBatch(guilds, "[Off/Active]", 100);

      logger.info(
        `[Off/Active] Completed updating ${stats.succeeded}/${stats.attempted} guild(s), failed ${stats.failed}, skipped ${stats.skipped}, new data ${stats.withNewData}, raiding changes ${stats.raidingStatusChanged}`,
      );

      // Warm current raid caches with fresh data (stale-while-revalidate handles serving old data)
      if (this.shouldWarmCachesAfterUpdate(stats)) {
        await this.debouncedWarmCurrentRaidCaches();
      }
      await taskTracker.complete(taskId, { guildsUpdated: stats.succeeded, guildsFailed: stats.failed, guildsSkipped: stats.skipped, withNewData: stats.withNewData, raidingStatusChanged: stats.raidingStatusChanged });
    } catch (error) {
      logger.error("[Off/Active] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingOffActive = false;
    }
  }

  // OFF HOURS: Update inactive guilds (once daily at 10:00)
  async updateInactiveGuilds(): Promise<void> {
    const blockingJob = this.getBlockingDatabaseMaintenanceJob();
    if (blockingJob) {
      logger.info(`[Daily/Inactive] Skipping inactive guild update while ${blockingJob} is running`);
      return;
    }

    this.isUpdatingOffInactive = true;
    const taskId = await taskTracker.start("Update Inactive Guilds (Daily)");

    try {
      // First, update activity statuses
      await this.updateGuildActivityStatus();

      // Get inactive guilds (excluding guilds not found on WCL)
      const guilds = await Guild.find({
        activityStatus: "inactive",
        wclStatus: { $ne: "not_found" },
      });

      if (guilds.length === 0) {
        logger.info("[Daily/Inactive] No inactive guilds to update");
        await taskTracker.complete(taskId, { guildsUpdated: 0 });
        return;
      }

      logger.info(`[Daily/Inactive] Updating ${guilds.length} inactive guild(s)...`);

      const stats = await this.updateGuildProgressBatch(guilds, "[Daily/Inactive]", 2000, 5);

      logger.info(
        `[Daily/Inactive] Completed updating ${stats.succeeded}/${stats.attempted} guild(s), failed ${stats.failed}, skipped ${stats.skipped}, new data ${stats.withNewData}, raiding changes ${stats.raidingStatusChanged}`,
      );

      // Warm current raid caches with fresh data (stale-while-revalidate handles serving old data)
      if (this.shouldWarmCachesAfterUpdate(stats)) {
        await this.debouncedWarmCurrentRaidCaches();
      }
      await taskTracker.complete(taskId, { guildsUpdated: stats.succeeded, guildsFailed: stats.failed, guildsSkipped: stats.skipped, withNewData: stats.withNewData, raidingStatusChanged: stats.raidingStatusChanged });
    } catch (error) {
      logger.error("[Daily/Inactive] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingOffInactive = false;
    }
  }

  // Manually trigger update of all guilds
  async updateAllGuilds(): Promise<void> {
    const taskId = await taskTracker.start("Update All Guilds");
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    logger.info("Starting full update of all guilds...");
    try {
      const guilds = await Guild.find({ wclStatus: { $ne: "not_found" } });

      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        attempted++;
        logger.info(`Updating ${i + 1}/${guilds.length}: ${guild.name}`);

        try {
          await guildService.updateGuildProgress((guild._id as mongoose.Types.ObjectId).toString());
          succeeded++;

          // Yield to event loop periodically (every 5 guilds) to allow request handling
          if ((i + 1) % 5 === 0) {
            await yieldToEventLoop();
          }

          // Small delay between guilds to avoid rate limiting
          await throttleDelay(2000);
        } catch (error) {
          failed++;
          logger.error(`Failed to update ${guild.name}:`, error);
        }
      }

      logger.info("Full update completed");
      await taskTracker.complete(taskId, { attempted, succeeded, failed });
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  // NIGHTLY: Update guilds that only have Raider.IO data (no WarcraftLogs)
  // Fetches raid progress and world rankings from Raider.IO for guilds marked as not_found on WCL
  async updateRaiderIOGuilds(): Promise<void> {
    this.isUpdatingRaiderIOGuilds = true;
    const taskId = await taskTracker.start("Update Raider.IO Guilds");

    try {
      // Get guilds that are not found on WCL and have completed initial fetch
      // (initialFetchCompleted ensures the guild was already attempted on WCL)
      const guilds = await Guild.find({
        wclStatus: "not_found",
        initialFetchCompleted: true,
      });

      if (guilds.length === 0) {
        logger.info("[Nightly/RaiderIO] No RIO-only guilds to update");
        await taskTracker.complete(taskId, { guildsUpdated: 0 });
        return;
      }

      logger.info(`[Nightly/RaiderIO] Updating ${guilds.length} RIO-only guild(s)...`);

      let updatedCount = 0;
      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        logger.info(`[Nightly/RaiderIO] Guild ${i + 1}/${guilds.length}: ${guild.name} (${guild.realm})`);

        try {
          const hasProgress = await guildService.updateGuildFromRaiderIO((guild._id as mongoose.Types.ObjectId).toString());
          if (hasProgress) updatedCount++;
        } catch (error) {
          logger.error(`[Nightly/RaiderIO] Failed to update ${guild.name}:`, error instanceof Error ? error.message : "Unknown");
        }

        // Yield to event loop periodically
        if ((i + 1) % 5 === 0) {
          await yieldToEventLoop();
        }

        // 2 second delay between guilds to respect RIO rate limits
        if (i < guilds.length - 1) {
          await throttleDelay(2000);
        }
      }

      // Recalculate guild rankings for current raids after all RIO updates
      logger.info("[Nightly/RaiderIO] Recalculating guild rankings for current raids...");
      for (const raidId of CURRENT_RAID_IDS) {
        await guildService.calculateGuildRankingsForRaid(raidId);
      }

      // Warm caches with updated data
      await this.debouncedWarmCurrentRaidCaches();

      logger.info(`[Nightly/RaiderIO] Completed: ${updatedCount}/${guilds.length} guilds have current-tier progress`);
      await taskTracker.complete(taskId, { guildsUpdated: guilds.length, withProgress: updatedCount });
    } catch (error) {
      logger.error("[Nightly/RaiderIO] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingRaiderIOGuilds = false;
    }
  }

  // NIGHTLY: Update world ranks for all guilds for the current raid (at 4 AM European time)
  // WCL sometimes updates world ranks with a delay, so this ensures we catch those updates
  async updateAllGuildsWorldRanks(raidId?: number): Promise<void> {
    const targetRaidIds = raidId ? [raidId] : CURRENT_RAID_IDS;
    await this.updateWorldRanksForRaids(targetRaidIds, { refreshCompleted: true });
  }

  // Update world ranks for all guilds for specific raid IDs
  async updateWorldRanksForRaids(raidIds: number[], options: { refreshCompleted?: boolean } = {}): Promise<void> {
    this.isUpdatingNightlyWorldRanks = true;
    const taskId = await taskTracker.start("Update World Ranks", { raidIds });

    try {
      // Get all guilds. WCL-not-found guilds still may have Raider.IO rankings to refresh.
      const guilds = await Guild.find();

      if (guilds.length === 0) {
        logger.info("[Nightly/WorldRanks] No guilds to update");
        this.isUpdatingNightlyWorldRanks = false;
        return;
      }

      logger.info(`[Nightly/WorldRanks] Updating world ranks for raid(s) [${raidIds.join(", ")}] for ${guilds.length} guild(s)...`);

      // Update world ranks for all guilds sequentially with a small delay between each
      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        logger.info(`[Nightly/WorldRanks] Guild ${i + 1}/${guilds.length}: ${guild.name}`);

        try {
          await guildService.updateWorldRankingForRaids((guild._id as mongoose.Types.ObjectId).toString(), raidIds, options);

          // Yield to event loop periodically (every 5 guilds) to allow request handling
          if ((i + 1) % 5 === 0) {
            await yieldToEventLoop();
          }

          // Small delay to avoid overwhelming the API (3 seconds between guilds)
          if (i < guilds.length - 1) {
            await throttleDelay(3000);
          }
        } catch (error) {
          logger.error(`[Nightly/WorldRanks] Failed to update world rank for ${guild.name}:`, error);
          // Continue with next guild even if one fails
        }
      }

      // Recalculate guild rankings after all world ranks are updated
      logger.info(`[Nightly/WorldRanks] Recalculating guild rankings for target raids...`);
      for (const id of raidIds) {
        await guildService.calculateGuildRankingsForRaid(id);
      }

      logger.info(`[Nightly/WorldRanks] Completed updating world ranks for ${guilds.length} guild(s)`);
      await taskTracker.complete(taskId, { guildsUpdated: guilds.length });
    } catch (error) {
      logger.error("[Nightly/WorldRanks] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingNightlyWorldRanks = false;
    }
  }

  // NIGHTLY: Update all guild crests (at 4 AM Finnish time)
  // Guild crests can be changed by guilds or sometimes fail to fetch initially
  async updateAllGuildCrests(): Promise<void> {
    this.isUpdatingGuildCrests = true;
    const taskId = await taskTracker.start("Update Guild Crests");

    try {
      logger.info("[Nightly/GuildCrests] Starting guild crest update...");
      await guildService.updateAllGuildCrests();
      logger.info("[Nightly/GuildCrests] Guild crest update completed");
      await taskTracker.complete(taskId);
    } catch (error) {
      logger.error("[Nightly/GuildCrests] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingGuildCrests = false;
    }
  }

  // NIGHTLY: Refetch 3 most recent reports for all active guilds (at 3 AM Finnish time)
  // This catches any fights that might have been missed during live polling or uploaded late
  async refetchRecentReportsForAllActiveGuilds(): Promise<void> {
    this.isUpdatingRefetchRecentReports = true;
    const taskId = await taskTracker.start("Refetch Recent Reports");

    try {
      await guildService.refetchRecentReportsForAllActiveGuilds();
      await taskTracker.complete(taskId);
    } catch (error) {
      logger.error("[Nightly/RefetchReports] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingRefetchRecentReports = false;
    }
  }

  // Refresh character rankings (at 08:30 Finnish time)
  // Updates zone rankings and encounter rankings for eligible tracked characters
  // Then rebuilds the materialized leaderboard collection for fast queries
  private async refreshCharacterRankings(): Promise<void> {
    this.isUpdatingCharacterRankings = true;
    const taskId = await taskTracker.start("Refresh Character Rankings");

    try {
      await guildService.refreshRaidPartitions();
      await characterService.checkAndRefreshCharacterRankings();
      await characterService.buildCharacterLeaderboards();
      await taskTracker.complete(taskId);
      await this.refreshCharacterMechanicsLeaderboards({ invokedAfterRankings: true }).catch((error) => {
        logger.error("[Nightly/CharacterMechanics] Rebuild after character rankings failed:", error);
      });
    } catch (error) {
      logger.error("[Nightly/CharacterRankings] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingCharacterRankings = false;
    }
  }

  private async refreshCharacterMechanicsLeaderboards(options: { invokedAfterRankings?: boolean } = {}): Promise<void> {
    if (this.isUpdatingCharacterMechanics) {
      logger.info("[Nightly/CharacterMechanics] Previous rebuild still in progress, skipping...");
      this.characterMechanicsRebuildPending = true;
      return;
    }

    if (!options.invokedAfterRankings && this.isUpdatingCharacterRankings) {
      logger.info("[Nightly/CharacterMechanics] Character rankings refresh is still running, skipping...");
      this.characterMechanicsRebuildPending = true;
      return;
    }

    const deathBackfillUnfinished = await characterMechanicsService.hasUnfinishedDeathEventBackfill();
    if (deathBackfillUnfinished) {
      logger.info("[Nightly/CharacterMechanics] Death event backfill queue is not finished yet, skipping mechanics rebuild");
      this.characterMechanicsRebuildPending = true;
      return;
    }

    this.isUpdatingCharacterMechanics = true;
    const taskId = await taskTracker.start("Rebuild Character Mechanics Leaderboard");

    try {
      const result = await characterMechanicsService.buildCurrentRaidMechanicsLeaderboards();
      this.characterMechanicsRebuildPending = false;
      await taskTracker.complete(taskId, result);
      await this.rebuildCharacterTierLists(result.zones.map((zone) => zone.zoneId)).catch((error) => {
        logger.error("[CharacterTierLists] Rebuild after character mechanics failed:", error);
      });
      await this.rebuildGuildProfileHighlights().catch((error) => {
        logger.error("[GuildProfileHighlights] Rebuild after character mechanics failed:", error);
      });
    } catch (error) {
      logger.error("[Nightly/CharacterMechanics] Error:", error);
      this.characterMechanicsRebuildPending = true;
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isUpdatingCharacterMechanics = false;
    }
  }

  private async rebuildCharacterRaidParticipations(): Promise<void> {
    this.isUpdatingCharacterRaidParticipations = true;
    const taskId = await taskTracker.start("Rebuild Character Raid Participations");
    let participationRebuildCompleted = false;

    try {
      const result = await characterService.rebuildCharacterRaidParticipations();
      await taskTracker.complete(taskId, result);
      participationRebuildCompleted = true;
    } catch (error) {
      logger.error("[CharacterRaidParticipation] Rebuild error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isUpdatingCharacterRaidParticipations = false;
    }

    if (participationRebuildCompleted) {
      try {
        await this.rebuildGuildNetworkSnapshot();
      } catch {
        // rebuildGuildNetworkSnapshot records its own task failure; keep the
        // participation rebuild status independent.
      }
    }
  }

  private async rebuildGuildNetworkSnapshot(): Promise<void> {
    this.isRebuildingGuildNetworkSnapshot = true;
    const taskId = await taskTracker.start("Rebuild Guild Network Snapshot");

    try {
      const result = await guildNetworkService.rebuildSnapshot();
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[GuildNetwork] Snapshot rebuild error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isRebuildingGuildNetworkSnapshot = false;
    }
  }

  private async rebuildGuildProfileHighlights(): Promise<void> {
    if (this.isRebuildingGuildProfileHighlights) {
      logger.info("[GuildProfileHighlights] Previous rebuild still in progress, skipping...");
      return;
    }

    this.isRebuildingGuildProfileHighlights = true;
    const taskId = await taskTracker.start("Rebuild Guild Profile Highlights");

    try {
      const result = await guildProfileHighlightsService.rebuildHighlights();
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[GuildProfileHighlights] Rebuild error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isRebuildingGuildProfileHighlights = false;
    }
  }

  async rebuildCharacterTierLists(zoneIds: number[] = CURRENT_RAID_IDS): Promise<void> {
    if (this.isRebuildingCharacterTierLists) {
      logger.info("[CharacterTierLists] Previous rebuild still in progress, skipping...");
      return;
    }

    this.isRebuildingCharacterTierLists = true;
    const taskId = await taskTracker.start("Rebuild Character Tier Lists", { zoneIds });

    try {
      const result = await characterTierListService.rebuildCharacterTierLists(zoneIds);
      await cacheService.invalidateCharacterTierListCaches();
      await taskTracker.complete(taskId, result);
    } catch (error) {
      logger.error("[CharacterTierLists] Rebuild error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isRebuildingCharacterTierLists = false;
    }
  }

  triggerGuildProfileHighlightsRebuild(): boolean {
    if (this.isRebuildingGuildProfileHighlights) {
      return false;
    }
    this.rebuildGuildProfileHighlights()
      .then(() => logger.info("[Admin] Guild profile highlights rebuild completed"))
      .catch((err) => logger.error("[Admin] Guild profile highlights rebuild failed:", err));
    return true;
  }

  triggerCharacterTierListsRebuild(zoneIds: number[] = CURRENT_RAID_IDS): boolean {
    if (this.isRebuildingCharacterTierLists) {
      return false;
    }
    this.rebuildCharacterTierLists(zoneIds)
      .then(() => logger.info("[Admin] Character tier list rebuild completed"))
      .catch((err) => logger.error("[Admin] Character tier list rebuild failed:", err));
    return true;
  }

  async resolveFightVodLinks(): Promise<void> {
    this.isResolvingFightVodLinks = true;
    const taskId = await taskTracker.start("Resolve Fight VOD Links");

    try {
      const result = await fightVodService.resolvePendingLinks();
      if (result.checked > 0) {
        logger.info(`[FightVOD] Checked ${result.checked} pending link(s), resolved ${result.resolved}, marked unavailable ${result.unavailable}`);
      }
      if (result.resolved > 0) {
        await cacheService.invalidatePattern(/^progress:/);
      }
      await taskTracker.complete(taskId, { ...result });
    } catch (error) {
      logger.error("[FightVOD] Resolver error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isResolvingFightVodLinks = false;
    }
  }

  async backfillFightVodLinks(): Promise<void> {
    if (this.isBackfillingFightVodLinks) {
      logger.info("[FightVOD Backfill] Previous backfill still in progress, skipping...");
      return;
    }

    this.isBackfillingFightVodLinks = true;
    const taskId = await taskTracker.start("Backfill Fight VOD Links");

    try {
      const result = await fightVodService.backfillRecentBestPullLinks();
      logger.info(
        `[FightVOD Backfill] Checked ${result.guildsChecked} guild(s), ${result.streamersChecked} streamer(s), considered ${result.fightsConsidered} fight-streamer pair(s), matched ${result.matched}, existing ${result.skippedExisting}, ambiguous ${result.ambiguous}, no match ${result.noVodMatch}, expired ${result.expired}, errors ${result.errors}`,
      );
      if (result.matched > 0) {
        await cacheService.invalidatePattern(/^progress:/);
      }
      await taskTracker.complete(taskId, { ...result });
    } catch (error) {
      logger.error("[FightVOD Backfill] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isBackfillingFightVodLinks = false;
    }
  }

  async cleanupExpiredFightVodLinks(): Promise<void> {
    this.isCleaningFightVodLinks = true;
    const taskId = await taskTracker.start("Cleanup Fight VOD Links");

    try {
      const result = await fightVodService.cleanupExpiredLinks();
      logger.info(
        `[FightVOD] Availability checked ${result.availability.checked} link(s), still available ${result.availability.stillAvailable}, unavailable ${result.availability.unavailable}, deleted ${result.deleted} stale link(s)`,
      );
      if (result.deleted > 0 || result.availability.unavailable > 0 || result.availability.stillAvailable > 0) {
        await cacheService.invalidatePattern(/^progress:/);
      }
      await taskTracker.complete(taskId, {
        deleted: result.deleted,
        availabilityChecked: result.availability.checked,
        availabilityStillAvailable: result.availability.stillAvailable,
        availabilityUnavailable: result.availability.unavailable,
        availabilityErrors: result.availability.errors,
      });
    } catch (error) {
      logger.error("[FightVOD] Cleanup error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isCleaningFightVodLinks = false;
    }
  }

  // HOT HOURS: Update Twitch stream status (every 15 minutes during 16:00-01:00)
  async updateTwitchStreamStatus(): Promise<void> {
    this.isUpdatingTwitchStreams = true;
    const taskId = await taskTracker.start("Update Twitch Streams");

    try {
      if (!twitchService.isEnabled()) {
        this.isUpdatingTwitchStreams = false;
        await taskTracker.complete(taskId, { skipped: true, reason: "Twitch disabled" });
        return;
      }

      // Get all guilds that have streamers
      const guilds = await Guild.find({
        streamers: { $exists: true, $ne: [] },
      });

      if (guilds.length === 0) {
        this.isUpdatingTwitchStreams = false;
        return;
      }

      // Collect all unique channel names
      const allChannelNames = new Set<string>();
      guilds.forEach((guild) => {
        guild.streamers?.forEach((streamer) => {
          allChannelNames.add(streamer.channelName.toLowerCase());
        });
      });

      if (allChannelNames.size === 0) {
        this.isUpdatingTwitchStreams = false;
        return;
      }

      logger.info(`[Hot/Twitch] Checking status for ${allChannelNames.size} streamer(s)...`);

      // Get stream status from Twitch
      const streamStatus = await twitchService.getStreamStatus(Array.from(allChannelNames));

      // Update each guild's streamers
      const now = new Date();
      const changedGuildSummaries: Array<{ realm: string; name: string }> = [];
      for (const guild of guilds) {
        if (!guild.streamers || guild.streamers.length === 0) continue;

        let hasChanges = false;
        const updatedStreamers = guild.streamers.map((streamer) => {
          const channelName = streamer.channelName.toLowerCase();
          const status: StreamStatus = streamStatus.get(channelName) || {
            isLive: false,
            isPlayingWoW: false,
          };
          const streamStartedAt = status.startedAt ? new Date(status.startedAt) : undefined;
          const twitchUserId = status.twitchUserId || streamer.twitchUserId;
          const currentStreamId = status.isLive ? status.streamId : undefined;
          const wasLive = streamer.isLive;
          const lastStreamId = status.isLive ? status.streamId || streamer.lastStreamId : streamer.lastStreamId || streamer.currentStreamId;
          const lastStreamStartedAt = status.isLive ? streamStartedAt || streamer.lastStreamStartedAt : streamer.lastStreamStartedAt || streamer.streamStartedAt;
          const lastStreamEndedAt = status.isLive ? undefined : wasLive ? now : streamer.lastStreamEndedAt;
          const lastLiveAt = status.isLive ? now : streamer.lastLiveAt;

          if (
            streamer.isLive !== status.isLive ||
            streamer.isPlayingWoW !== status.isPlayingWoW ||
            streamer.twitchUserId !== twitchUserId ||
            streamer.currentStreamId !== currentStreamId ||
            (streamer.streamStartedAt?.getTime() || 0) !== (streamStartedAt?.getTime() || 0)
          ) {
            hasChanges = true;
            logger.info(
              `  [${guild.name}] ${streamer.channelName}: ${streamer.isLive ? "live" : "offline"} → ${status.isLive ? "live" : "offline"}${
                status.isLive ? ` (${status.gameName || "unknown game"})` : ""
              }`,
            );
          }

          return {
            channelName: streamer.channelName,
            isLive: status.isLive,
            isPlayingWoW: status.isPlayingWoW,
            gameName: status.gameName,
            twitchUserId,
            currentStreamId,
            streamStartedAt,
            lastStreamId,
            lastStreamStartedAt,
            lastStreamEndedAt,
            lastLiveAt,
            lastChecked: now,
          };
        });

        if (hasChanges) {
          await Promise.all(
            updatedStreamers.map((updatedStreamer) =>
              updateStreamerStatusFields(guild._id, updatedStreamer.channelName, {
                isLive: updatedStreamer.isLive,
                isPlayingWoW: updatedStreamer.isPlayingWoW,
                gameName: updatedStreamer.gameName,
                twitchUserId: updatedStreamer.twitchUserId,
                currentStreamId: updatedStreamer.currentStreamId,
                streamStartedAt: updatedStreamer.streamStartedAt,
                lastStreamId: updatedStreamer.lastStreamId,
                lastStreamStartedAt: updatedStreamer.lastStreamStartedAt,
                lastStreamEndedAt: updatedStreamer.lastStreamEndedAt,
                lastLiveAt: updatedStreamer.lastLiveAt,
                lastChecked: updatedStreamer.lastChecked,
              }),
            ),
          );
          changedGuildSummaries.push({ realm: guild.realm, name: guild.name });
        }
      }

      // Invalidate streamer caches so the next request reflects the updated statuses immediately.
      // Without this, stale "live" data would persist in cache for up to 2 minutes after DB update.
      await cacheService.invalidate(cacheService.getLiveStreamersKey());
      await cacheService.invalidate(cacheService.getHomeKey());
      await Promise.all(
        changedGuildSummaries.map((guild) => cacheService.invalidate(cacheService.getGuildSummaryKey(guild.realm, guild.name))),
      );

      logger.info(`[Hot/Twitch] Completed stream status update`);
      await taskTracker.complete(taskId);
    } catch (error) {
      logger.error("[Hot/Twitch] Error:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isUpdatingTwitchStreams = false;
    }
  }

  // OFF HOURS: Set all streams to offline
  private async setAllStreamsOffline(): Promise<void> {
    try {
      // Get all guilds that have streamers
      const guilds = await Guild.find({
        streamers: { $exists: true, $ne: [] },
      });

      if (guilds.length === 0) {
        return;
      }

      // Check if any streams are currently marked as live
      const hasLiveStreams = guilds.some((guild) => guild.streamers?.some((s) => s.isLive));

      if (!hasLiveStreams) {
        // All streams already offline, nothing to do
        return;
      }

      logger.info("[Off/Twitch] Setting all streams to offline (outside hot hours)...");

      // Update all streamers to offline
      const now = new Date();
      const changedGuildSummaries: Array<{ realm: string; name: string }> = [];
      for (const guild of guilds) {
        if (!guild.streamers || guild.streamers.length === 0) continue;

        const hasLive = guild.streamers.some((s) => s.isLive);
        if (!hasLive) continue; // Skip if already all offline

        const updatedStreamers = guild.streamers.map((streamer) => ({
          channelName: streamer.channelName,
          isLive: false,
          isPlayingWoW: false,
          gameName: undefined,
          twitchUserId: streamer.twitchUserId,
          currentStreamId: undefined,
          streamStartedAt: undefined,
          lastStreamId: streamer.lastStreamId || streamer.currentStreamId,
          lastStreamStartedAt: streamer.lastStreamStartedAt || streamer.streamStartedAt,
          lastStreamEndedAt: streamer.isLive ? now : streamer.lastStreamEndedAt,
          lastLiveAt: streamer.lastLiveAt,
          lastChecked: now,
        }));

        await Promise.all(
          updatedStreamers.map((updatedStreamer) =>
            updateStreamerStatusFields(guild._id, updatedStreamer.channelName, {
              isLive: updatedStreamer.isLive,
              isPlayingWoW: updatedStreamer.isPlayingWoW,
              gameName: updatedStreamer.gameName,
              twitchUserId: updatedStreamer.twitchUserId,
              currentStreamId: updatedStreamer.currentStreamId,
              streamStartedAt: updatedStreamer.streamStartedAt,
              lastStreamId: updatedStreamer.lastStreamId,
              lastStreamStartedAt: updatedStreamer.lastStreamStartedAt,
              lastStreamEndedAt: updatedStreamer.lastStreamEndedAt,
              lastLiveAt: updatedStreamer.lastLiveAt,
              lastChecked: updatedStreamer.lastChecked,
            }),
          ),
        );
        changedGuildSummaries.push({ realm: guild.realm, name: guild.name });
      }

      // Invalidate streamer caches so clients immediately see all streams as offline.
      await cacheService.invalidate(cacheService.getLiveStreamersKey());
      await cacheService.invalidate(cacheService.getHomeKey());
      await Promise.all(
        changedGuildSummaries.map((guild) => cacheService.invalidate(cacheService.getGuildSummaryKey(guild.realm, guild.name))),
      );

      logger.info("[Off/Twitch] All streams marked as offline");
    } catch (error) {
      logger.error("[Off/Twitch] Error setting streams offline:", error);
    }
  }

  /**
   * Debounced cache warming for current raid caches.
   * Prevents multiple cache warm operations from running in quick succession.
   * Uses stale-while-revalidate pattern - old data is served while warming.
   */
  private async debouncedWarmCurrentRaidCaches(): Promise<void> {
    const now = Date.now();
    const timeSinceLastWarm = now - this.lastCacheWarmTime;

    if (timeSinceLastWarm < CACHE_WARM_DEBOUNCE_MS) {
      logger.info(`[CacheWarm] Skipping cache warm - last warm was ${Math.round(timeSinceLastWarm / 1000)}s ago (debounce: ${CACHE_WARM_DEBOUNCE_MS / 1000}s)`);
      return;
    }

    this.lastCacheWarmTime = now;
    logger.info("[CacheWarm] Warming current raid caches...");

    try {
      await cacheWarmerService.warmCurrentRaidCaches();
      logger.info("[CacheWarm] Current raid caches warmed successfully");
    } catch (error) {
      logger.error("[CacheWarm] Error warming current raid caches:", error);
    }
  }
}

export default new UpdateScheduler();
