import Guild, { IGuild, IRaidProgress, IBossProgress, IOfficialRaidProgress } from "../models/Guild";
import GuildLogSource, { IGuildLogSource } from "../models/GuildLogSource";
import type { IStreamer } from "../models/Streamer";
import Event from "../models/Event";
import Raid, { IRaid } from "../models/Raid";
import Report, { IReportFightSequenceEntry } from "../models/Report";
import Fight from "../models/Fight";
import FightVodLink from "../models/FightVodLink";
import TierList from "../models/TierList";
import GuildProcessingQueue from "../models/GuildProcessingQueue";
import WorldRankHistory from "../models/WorldRankHistory";
import { BossIcon } from "../models/Achievement";
import wclService, { type FightRosterResult } from "./warcraftlogs.service";
import blizzardService from "./blizzard.service";
import raiderIOService from "./raiderio.service";
import type { RaiderIORaidDifficultyRankings } from "./raiderio.service";
import cacheService from "./cache.service";
import backgroundGuildProcessor from "./background-guild-processor.service";
import taskTracker from "./task-tracker.service";
import { GUILDS_DEV, TRACKED_RAIDS, CURRENT_RAID_IDS, PRIMARY_RAID_ID, DIFFICULTIES, GUILDS_PROD, MANUAL_RAID_DATES, RAID_RIO_SLUG_OVERRIDES } from "../config/guilds";
import { filterUniqueGuilds } from "../utils/filterUniqueGuilds";
import mongoose from "mongoose";
import logger, { getGuildLogger, releaseGuildLogger } from "../utils/logger";
import Character from "../models/Character";
import characterService from "./character.service";
import fightVodService from "./fight-vod.service";
import guildProfileHighlightsService from "./guild-profile-highlights.service";
import guildLogSourceService, { getGuildLogSourceSnapshot } from "./guild-log-source.service";
import { yieldToEventLoop } from "../utils/yield";
import { findDuplicateFight } from "../utils/fight-deduplication";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

interface GuildRaidingTodayItem {
  _id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  crest?: IGuild["crest"];
  parent_guild?: string;
  raidTime: {
    day: string;
    startHour: number;
    endHour: number;
  };
}

interface FightVodTarget {
  reportCode: string;
  fightId: number;
}

interface RaidTimeInterval {
  startMs: number;
  endMs: number;
}

interface StatisticsFight {
  reportCode: string;
  guildId: mongoose.Types.ObjectId;
  fightId: number;
  zoneId: number;
  encounterID: number;
  encounterName: string;
  difficulty: number;
  isKill: boolean;
  bossPercentage: number;
  fightPercentage: number;
  reportStartTime: number;
  reportEndTime?: number;
  fightStartTime: number;
  fightEndTime: number;
  duration: number;
  timestamp: Date;
  lastPhaseId?: number;
  lastPhaseName?: string;
  progressDisplay?: string;
}

const STATISTICS_FIGHT_PROJECTION = [
  "reportCode",
  "guildId",
  "fightId",
  "zoneId",
  "encounterID",
  "encounterName",
  "difficulty",
  "isKill",
  "bossPercentage",
  "fightPercentage",
  "reportStartTime",
  "reportEndTime",
  "fightStartTime",
  "fightEndTime",
  "duration",
  "timestamp",
  "lastPhaseId",
  "lastPhaseName",
  "progressDisplay",
].join(" ");

interface GuildProgressUpdateResult {
  guild: IGuild;
  hasNewData: boolean;
  raidingStatusChanged: boolean;
  isInitialFetch: boolean;
}

interface CalculateGuildStatisticsOptions {
  recalculateSchedule?: boolean;
  createEvents?: boolean;
}

type GuildReportImportErrorCode = "guild_not_found" | "report_conflict" | "report_not_found" | "invalid_report" | "no_tracked_fights" | "wcl_fetch_failed";

export class GuildReportImportError extends Error {
  statusCode: number;
  code: GuildReportImportErrorCode;

  constructor(statusCode: number, code: GuildReportImportErrorCode, message: string) {
    super(message);
    this.name = "GuildReportImportError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface GuildReportImportResult {
  guildId: string;
  guildName: string;
  reportId: string;
  reportCode: string;
  alreadyImported: boolean;
  totalFightCount: number;
  trackedFightCount: number;
  affectedRaidIds: number[];
}

type LatestReportDifficulty = "mythic" | "heroic" | "normal" | "lfr" | "unknown";

interface LatestReportBossSummary {
  encounterID: number;
  name: string;
  iconUrl?: string;
  pulls: number;
  kills: number;
  wipes: number;
  difficulties: LatestReportDifficultySummary[];
}

interface LatestReportDifficultySummary {
  difficultyId: number;
  difficulty: LatestReportDifficulty;
  pulls: number;
  kills: number;
  wipes: number;
}

interface LatestReportSummary {
  code: string;
  url: string;
  raidId?: number;
  raidName: string;
  raidIconUrl?: string;
  startTime: number;
  endTime?: number;
  durationSeconds?: number;
  isOngoing: boolean;
  fightCount: number;
  kills: number;
  wipes: number;
  difficulties: LatestReportDifficultySummary[];
  bosses: LatestReportBossSummary[];
}

interface LatestReportLink {
  code: string;
  url: string;
  startTime: number;
  isOngoing: boolean;
}

interface LatestReportFightAggregation {
  _id: {
    reportCode: string;
    zoneId: number;
    encounterID: number;
    encounterName: string;
    difficulty: number;
  };
  pulls: number;
  kills: number;
  wipes: number;
}

interface LeanReportSummaryDocument {
  _id: mongoose.Types.ObjectId;
  code: string;
  guildId: mongoose.Types.ObjectId;
  zoneId: number;
  startTime: number;
  endTime?: number;
  isOngoing?: boolean;
  fightCount?: number;
}

interface LatestReportLinkAggregation {
  _id: mongoose.Types.ObjectId;
  code: string;
  startTime: number;
  isOngoing?: boolean;
}

class GuildService {
  // Configuration for death events fetching
  private fetchDeathEvents: boolean = process.env.FETCH_DEATH_EVENTS === "true";
  private existingGuildStatisticsRecalculationRunning = false;
  private deathBackfillIndexesCreated = false;

  isExistingGuildStatisticsRecalculationRunning(): boolean {
    return this.existingGuildStatisticsRecalculationRunning;
  }

  private formatMemoryUsage(): string {
    const memory = process.memoryUsage();
    return `rss=${Math.round(memory.rss / 1024 / 1024)}MB heapUsed=${Math.round(memory.heapUsed / 1024 / 1024)}MB heapTotal=${Math.round(memory.heapTotal / 1024 / 1024)}MB external=${Math.round(
      memory.external / 1024 / 1024,
    )}MB`;
  }

  private logMemoryUsage(context: string): void {
    logger.info(`[Memory] ${context}: ${this.formatMemoryUsage()}`);
  }

  private async ensureDeathBackfillIndexes(): Promise<void> {
    if (this.deathBackfillIndexesCreated) return;

    await Fight.collection.createIndex({ guildId: 1, deathEventsFetchStatus: 1, reportEndTime: 1, reportCode: 1 });
    await Fight.collection.createIndex(
      { deathEventsFetchStatus: 1, reportEndTime: 1, guildId: 1 },
      { name: "death_backfill_queue_lookup" },
    );
    await Fight.collection.createIndex(
      { combatantInfoFetchStatus: 1, reportEndTime: 1, guildId: 1 },
      { name: "combatant_info_backfill_queue_lookup" },
    );

    this.deathBackfillIndexesCreated = true;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

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

  private getStoredFightKey(fight: { reportCode: string; fightId: number }): string {
    return `${fight.reportCode}:${fight.fightId}`;
  }

  private getReportFightKey(reportCode: string, fightId: number): string {
    return `${reportCode}:${fightId}`;
  }

  private getValidFightChainIntervals(reportCode: string, reportStartTime: number, fightSequence: IReportFightSequenceEntry[], validFightKeys: Set<string>): RaidTimeInterval[] {
    const intervals: RaidTimeInterval[] = [];
    let currentInterval: RaidTimeInterval | null = null;

    for (const fight of fightSequence) {
      const isValidFight = validFightKeys.has(this.getReportFightKey(reportCode, fight.fightId));

      if (!isValidFight) {
        if (currentInterval) {
          intervals.push(currentInterval);
          currentInterval = null;
        }
        continue;
      }

      const startMs = reportStartTime + fight.startTime;
      const endMs = reportStartTime + fight.endTime;

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        continue;
      }

      if (!currentInterval) {
        currentInterval = { startMs, endMs };
      } else {
        currentInterval.endMs = Math.max(currentInterval.endMs, endMs);
      }
    }

    if (currentInterval) {
      intervals.push(currentInterval);
    }

    return intervals;
  }

  private getFallbackReportInterval(fights: Array<{ reportStartTime: number; fightStartTime: number; fightEndTime: number }>): RaidTimeInterval | null {
    let startMs = Number.MAX_SAFE_INTEGER;
    let endMs = 0;

    for (const fight of fights) {
      startMs = Math.min(startMs, fight.reportStartTime + fight.fightStartTime);
      endMs = Math.max(endMs, fight.reportStartTime + fight.fightEndTime);
    }

    if (startMs === Number.MAX_SAFE_INTEGER || endMs <= startMs) {
      return null;
    }

    return { startMs, endMs };
  }

  private sumMergedIntervalsSeconds(intervals: RaidTimeInterval[]): number {
    if (intervals.length === 0) {
      return 0;
    }

    const sortedIntervals = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    let totalMs = 0;
    let currentStart = sortedIntervals[0].startMs;
    let currentEnd = sortedIntervals[0].endMs;

    for (let i = 1; i < sortedIntervals.length; i++) {
      const interval = sortedIntervals[i];

      if (interval.startMs <= currentEnd) {
        currentEnd = Math.max(currentEnd, interval.endMs);
        continue;
      }

      totalMs += currentEnd - currentStart;
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    }

    totalMs += currentEnd - currentStart;
    return totalMs / 1000;
  }

  private async calculateRaidTimeSpentFromFightChains(guildId: mongoose.Types.ObjectId, fights: any[]): Promise<number> {
    if (fights.length === 0) {
      return 0;
    }

    const fightsByReport = new Map<string, any[]>();
    const validFightKeys = new Set<string>();

    for (const fight of fights) {
      if (!fight.reportCode || fight.fightId == null) continue;

      validFightKeys.add(this.getStoredFightKey(fight));

      const reportFights = fightsByReport.get(fight.reportCode) || [];
      reportFights.push(fight);
      fightsByReport.set(fight.reportCode, reportFights);
    }

    const reportCodes = Array.from(fightsByReport.keys());
    if (reportCodes.length === 0) {
      return 0;
    }

    const reports = (await Report.find({ guildId, code: { $in: reportCodes } })
      .select("code startTime fightSequence")
      .lean()) as Array<{ code: string; startTime: number; fightSequence?: IReportFightSequenceEntry[] }>;
    const reportsByCode = new Map(reports.map((report) => [report.code, report]));
    const intervals: RaidTimeInterval[] = [];

    for (const reportCode of reportCodes) {
      const report = reportsByCode.get(reportCode);

      if (report?.fightSequence?.length) {
        intervals.push(...this.getValidFightChainIntervals(reportCode, report.startTime, report.fightSequence, validFightKeys));
        continue;
      }

      const fallbackInterval = this.getFallbackReportInterval(fightsByReport.get(reportCode) || []);
      if (fallbackInterval) {
        intervals.push(fallbackInterval);
      }
    }

    return this.sumMergedIntervalsSeconds(intervals);
  }

  private getReportDifficultyLabel(difficultyId: number): LatestReportDifficulty {
    switch (difficultyId) {
      case 5:
        return "mythic";
      case 4:
        return "heroic";
      case 3:
        return "normal";
      case 2:
        return "lfr";
      default:
        return "unknown";
    }
  }

  private getReportDifficultySortValue(difficultyId: number): number {
    switch (difficultyId) {
      case 5:
        return 0;
      case 4:
        return 1;
      case 3:
        return 2;
      case 2:
        return 3;
      default:
        return 4;
    }
  }

  private formatConfigStreamers(streamers: string[] = []): IStreamer[] {
    return streamers
      .map((channelName) => channelName.trim().toLowerCase())
      .filter(Boolean)
      .map((channelName) => ({
        channelName,
        adminManaged: true,
        isLive: false,
        isPlayingWoW: false,
        gameName: undefined,
        lastChecked: undefined,
      }));
  }

  async refreshRaidPartitions(raidIds: number[] = CURRENT_RAID_IDS): Promise<void> {
    if (raidIds.length === 0) return;

    for (const raidId of raidIds) {
      try {
        const detailResult = await wclService.getZone(raidId);
        const zoneData = detailResult.worldData?.zone;
        if (!zoneData?.partitions) {
          logger.warn(`[Raids] No partitions returned for raid ${raidId}`);
          continue;
        }

        const partitions = zoneData.partitions.map((partition: any) => ({
          id: partition.id,
          name: partition.name,
        }));

        await Raid.updateOne({ id: raidId }, { $set: { partitions } });

        logger.info(`[Raids] Refreshed partitions for raid ${raidId} (${partitions.length} entries)`);
      } catch (error) {
        logger.error(`[Raids] Failed to refresh partitions for raid ${raidId}:`, error);
      }
    }
  }

  // Sync raid information from WarcraftLogs to database
  async syncRaidsFromWCL(forceFullFetch = false): Promise<void> {
    logger.info("Syncing raid data from WarcraftLogs...");

    try {
      // Check if we have any raids in the database
      const existingRaidCount = await Raid.countDocuments();
      logger.info(`Found ${existingRaidCount} raids in database`);

      // If we have existing raids, check if all tracked raids are present
      let needsFullFetch = forceFullFetch || existingRaidCount === 0;

      if (!needsFullFetch) {
        // Check if all TRACKED_RAIDS exist in our database
        const existingTrackedRaids = await Raid.find({
          id: { $in: TRACKED_RAIDS },
        }).select("id");

        const existingTrackedIds = new Set(existingTrackedRaids.map((r) => r.id));
        const missingRaidIds = TRACKED_RAIDS.filter((id) => !existingTrackedIds.has(id));

        if (missingRaidIds.length > 0) {
          logger.info(`Missing tracked raid IDs in database: ${missingRaidIds.join(", ")}`);
          logger.info("Triggering full zone refetch...");
          needsFullFetch = true;
        } else {
          logger.info("All tracked raids already exist in database, skipping zone fetch");
          await this.refreshRaidPartitions();
          await this.ensureRaidRioSlugs();
          return;
        }
      } else {
        logger.info(forceFullFetch ? "Force raid sync requested, fetching all zones" : "Database is empty, fetching all zones for initial setup");
      }

      // Only fetch zones if needed (first time or missing tracked raids)
      if (needsFullFetch) {
        // Fetch achievements from Blizzard API (same trigger as zones)
        logger.info("Fetching achievements from Blizzard API...");
        await blizzardService.updateAchievements();

        // Fetch all zones from WarcraftLogs
        const result = await wclService.getZones();
        const zones = result.worldData?.zones;

        if (!zones || zones.length === 0) {
          logger.warn("No zones data returned from WarcraftLogs");
          return;
        }

        logger.info(`Found ${zones.length} zones from WarcraftLogs`);

        // Collect all raid and boss names for batch icon fetching
        const allRaidNames: string[] = [];
        const allBossNames: string[] = [];
        const zoneDataCache = new Map<number, any>(); // Cache zone data to avoid refetching

        // Sync all zones to database
        for (const zone of zones) {
          try {
            // Get detailed zone info with encounters
            const detailResult = await wclService.getZone(zone.id);
            const zoneData = detailResult.worldData?.zone;

            if (!zoneData) {
              logger.warn(`No detailed data found for zone ${zone.id} (${zone.name})`);
              continue;
            }

            logger.info(`Zone ${zone.id} data:`, JSON.stringify(zoneData, null, 2));

            // Check if encounters exist
            if (!zoneData.encounters || zoneData.encounters.length === 0) {
              logger.warn(`Zone ${zone.id} (${zoneData.name}) has no encounters, skipping...`);
              continue;
            }

            // Cache the zone data for later use
            zoneDataCache.set(zone.id, zoneData);

            // Get expansion name from the zone data
            const expansionName = zoneData.expansion?.name || "Unknown";

            // Convert encounters to bosses format
            const bosses = (zoneData.encounters || []).map((enc: any) => ({
              id: enc.id,
              name: enc.name,
              slug: enc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            }));

            const partitions = (zoneData.partitions || []).map((partition: any) => ({
              id: partition.id,
              name: partition.name,
            }));

            // Collect names for batch fetching
            allRaidNames.push(zoneData.name);
            const bossNames = bosses.map((b: any) => b.name);
            allBossNames.push(...bossNames);

            logger.info(`Syncing zone ${zone.id} (${expansionName}) with ${bosses.length} encounters`);

            // Update or create raid in database (without icons first)
            await Raid.findOneAndUpdate(
              { id: zone.id },
              {
                $set: {
                  name: zoneData.name,
                  slug: zoneData.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                  expansion: expansionName,
                  bosses,
                  partitions,
                },
                $setOnInsert: {
                  id: zone.id,
                },
              },
              { upsert: true, new: true },
            );

            logger.info(`Synced raid: ${zoneData.name} (${expansionName}, ${bosses.length} bosses)`);
          } catch (error) {
            logger.error(`Error syncing zone ${zone.id}:`, error);
          }
        }

        // Batch fetch all raid and boss icons from Blizzard
        logger.info("Fetching raid and boss icons from Blizzard API...");
        const raidIconMap = await blizzardService.getRaidIconUrls(allRaidNames);
        const bossIconMap = await blizzardService.getBossIconUrls(allBossNames);

        // Fetch raid dates from Raider.IO
        logger.info("Fetching raid start/end dates from Raider.IO API...");
        const raidDatesMap = await raiderIOService.fetchAllRaidDates();

        // Update raids with icons and dates using cached zone data
        logger.info("Updating raids with icon URLs and start/end dates...");
        for (const [zoneId, zoneData] of zoneDataCache.entries()) {
          try {
            // Get raid icon
            const raidIconUrl = raidIconMap.get(zoneData.name) || undefined;

            // Get boss icons from the cached zone data
            const bossesWithIcons = (zoneData.encounters || []).map((enc: any) => ({
              id: enc.id,
              name: enc.name,
              slug: enc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              iconUrl: bossIconMap.get(enc.name) || undefined,
            }));

            // Find matching Raider.IO data
            const raidSlug = zoneData.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const rioSlugOverride = RAID_RIO_SLUG_OVERRIDES[zoneId];
            const raiderIOMatch = rioSlugOverride ? raidDatesMap.get(rioSlugOverride.toLowerCase()) : raiderIOService.findRaidMatch(raidDatesMap, zoneData.name, raidSlug);

            if (rioSlugOverride && !raiderIOMatch) {
              logger.warn(`[RIO Slugs] Configured override "${rioSlugOverride}" for ${zoneData.name} was not found in Raider.IO static data`);
            }

            // Prepare update object with icons
            const updateData: any = {
              iconUrl: raidIconUrl,
              bosses: bossesWithIcons,
              partitions: (zoneData.partitions || []).map((partition: any) => ({
                id: partition.id,
                name: partition.name,
              })),
            };

            // Add start/end dates if we found a match
            if (raiderIOMatch) {
              logger.info(`✅ Found Raider.IO dates for: ${zoneData.name}`);
              updateData.rioSlug = raiderIOMatch.slug;

              // Convert string dates to Date objects
              updateData.starts = {
                us: raiderIOMatch.starts.us ? new Date(raiderIOMatch.starts.us) : undefined,
                eu: raiderIOMatch.starts.eu ? new Date(raiderIOMatch.starts.eu) : undefined,
                tw: raiderIOMatch.starts.tw ? new Date(raiderIOMatch.starts.tw) : undefined,
                kr: raiderIOMatch.starts.kr ? new Date(raiderIOMatch.starts.kr) : undefined,
                cn: raiderIOMatch.starts.cn ? new Date(raiderIOMatch.starts.cn) : undefined,
              };

              updateData.ends = {
                us: raiderIOMatch.ends.us ? new Date(raiderIOMatch.ends.us) : undefined,
                eu: raiderIOMatch.ends.eu ? new Date(raiderIOMatch.ends.eu) : undefined,
                tw: raiderIOMatch.ends.tw ? new Date(raiderIOMatch.ends.tw) : undefined,
                kr: raiderIOMatch.ends.kr ? new Date(raiderIOMatch.ends.kr) : undefined,
                cn: raiderIOMatch.ends.cn ? new Date(raiderIOMatch.ends.cn) : undefined,
              };
            } else {
              // Check if we have manual dates for this raid
              const manualRaidData = MANUAL_RAID_DATES.find((r) => r.id === zoneId);

              if (manualRaidData) {
                logger.info(`✅ Using manual dates for: ${zoneData.name}`);

                // Apply manual EU dates
                updateData.starts = {
                  eu: new Date(manualRaidData.euStartDate),
                };

                updateData.ends = {
                  eu: new Date(manualRaidData.euEndDate),
                };
              } else {
                logger.info(`⚠️  No Raider.IO or manual dates found for: ${zoneData.name}`);
              }
            }

            // Update raid with icons and dates
            await Raid.findOneAndUpdate(
              { id: zoneId },
              {
                $set: updateData,
              },
            );

            const hasManualDates = MANUAL_RAID_DATES.some((r) => r.id === zoneId);
            const datesSource = raiderIOMatch ? "Raider.IO" : hasManualDates ? "Manual" : "None";
            logger.info(`Updated raid: ${zoneData.name} (icon: ${raidIconUrl ? "✅" : "❌"}, dates: ${datesSource})`);
          } catch (error) {
            logger.error(`Error updating raid data for zone ${zoneId}:`, error);
          }
        }

        logger.info("Raid sync completed");
      }

      // Always ensure tracked raids have rioSlug populated (handles the case
      // where raids already existed in DB before rioSlug was introduced)
      await this.ensureRaidRioSlugs();
    } catch (error) {
      logger.error("Error syncing raids from WarcraftLogs:", error);
    }
  }

  /**
   * Ensure all tracked raids have their rioSlug field populated.
   * Fetches RIO static data only if needed and updates Raid documents in-place.
   * This handles the case where Raid documents were created before rioSlug support was added.
   */
  private async ensureRaidRioSlugs(): Promise<void> {
    const trackedRaids = await Raid.find({ id: { $in: TRACKED_RAIDS } });
    const missingRioSlug = trackedRaids.filter((r) => !r.rioSlug);

    if (missingRioSlug.length === 0) {
      logger.info("[RIO Slugs] All tracked raids have rioSlug populated");
      return;
    }

    logger.info(`[RIO Slugs] ${missingRioSlug.length} tracked raid(s) missing rioSlug, fetching RIO static data...`);

    try {
      const rioRaidMap = await raiderIOService.fetchAllRaidDates();

      for (const raid of missingRioSlug) {
        const raidSlug = raid.slug || raid.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const rioSlugOverride = RAID_RIO_SLUG_OVERRIDES[raid.id];
        const rioMatch = rioSlugOverride ? rioRaidMap.get(rioSlugOverride.toLowerCase()) : raiderIOService.findRaidMatch(rioRaidMap, raid.name, raidSlug);

        if (rioMatch) {
          raid.rioSlug = rioMatch.slug;
          await raid.save();
          logger.info(`[RIO Slugs] Set rioSlug for "${raid.name}": ${rioMatch.slug}`);
        } else if (rioSlugOverride) {
          logger.warn(`[RIO Slugs] Override "${rioSlugOverride}" for tracked raid "${raid.name}" was not found in RIO static data`);
        } else {
          logger.warn(`[RIO Slugs] No RIO match found for tracked raid "${raid.name}" (slug: ${raidSlug})`);
        }
      }
    } catch (error) {
      logger.error("[RIO Slugs] Failed to fetch RIO static data for slug resolution:", error);
    }
  }

  // Get raid data from database
  async getRaidData(zoneId: number): Promise<IRaid | null> {
    return await Raid.findOne({ id: zoneId });
  }

  // Find matching Raider.IO raid rankings by DB slug/name with fuzzy matching
  private findRaiderIORaidRankings(
    rioRankings: Record<string, RaiderIORaidDifficultyRankings>,
    dbSlug: string,
    dbName: string,
    rioSlug?: string,
  ): RaiderIORaidDifficultyRankings | null {
    // Try stored RaiderIO slug first (most reliable)
    if (rioSlug && rioRankings[rioSlug]) {
      return rioRankings[rioSlug];
    }

    const slugLower = dbSlug.toLowerCase();
    const nameLower = dbName.toLowerCase();

    // Try exact slug match first
    if (rioRankings[slugLower]) {
      return rioRankings[slugLower];
    }

    // Try partial/contains match against all RaiderIO keys
    for (const rioSlug of Object.keys(rioRankings)) {
      if (rioSlug.includes(slugLower) || slugLower.includes(rioSlug)) {
        return rioRankings[rioSlug];
      }
      const nameSlug = nameLower.replace(/[^a-z0-9]+/g, "-");
      if (rioSlug.includes(nameSlug) || nameSlug.includes(rioSlug)) {
        return rioRankings[rioSlug];
      }
    }

    return null;
  }

  // Get all valid boss encounter IDs from tracked raids
  // This is used to filter out dungeon bosses and other non-raid content
  private async getValidBossEncounterIds(): Promise<Set<number>> {
    const validBossIds = new Set<number>();

    for (const raidId of TRACKED_RAIDS) {
      const raid = await this.getRaidData(raidId);
      if (raid && raid.bosses) {
        for (const boss of raid.bosses) {
          validBossIds.add(boss.id);
        }
      }
    }

    logger.info(`Loaded ${validBossIds.size} valid boss encounter IDs from ${TRACKED_RAIDS.length} tracked raids`);
    return validBossIds;
  }

  // Get valid boss encounter IDs for a specific raid
  private async getValidBossEncounterIdsForRaid(raidId: number): Promise<Set<number>> {
    const validBossIds = new Set<number>();

    const raid = await this.getRaidData(raidId);
    if (raid && raid.bosses) {
      for (const boss of raid.bosses) {
        validBossIds.add(boss.id);
      }
    }

    return validBossIds;
  }

  // Get valid boss encounter IDs for all current raids
  private async getValidBossEncounterIdsForCurrentRaids(): Promise<Set<number>> {
    const validBossIds = new Set<number>();

    for (const raidId of CURRENT_RAID_IDS) {
      const raid = await this.getRaidData(raidId);
      if (raid && raid.bosses) {
        for (const boss of raid.bosses) {
          validBossIds.add(boss.id);
        }
      }
    }

    return validBossIds;
  }

  private async getCurrentRaidIdByEncounterId(): Promise<Map<number, number>> {
    const raidIdByEncounterId = new Map<number, number>();

    for (const raidId of CURRENT_RAID_IDS) {
      const raid = await this.getRaidData(raidId);
      if (!raid?.bosses) continue;

      for (const boss of raid.bosses) {
        raidIdByEncounterId.set(boss.id, raidId);
      }
    }

    return raidIdByEncounterId;
  }

  private async getTrackedRaidIdByEncounterId(): Promise<Map<number, number>> {
    const raidIdByEncounterId = new Map<number, number>();

    for (const raidId of TRACKED_RAIDS) {
      const raid = await this.getRaidData(raidId);
      if (!raid?.bosses) continue;

      for (const boss of raid.bosses) {
        raidIdByEncounterId.set(boss.id, raidId);
      }
    }

    return raidIdByEncounterId;
  }

  private inferReportZoneIdFromTrackedFights(report: any, raidIdByEncounterId: Map<number, number>): number {
    if (!Array.isArray(report.fights)) {
      return 0;
    }

    const pullsByRaidId = new Map<number, number>();
    for (const fight of report.fights) {
      const encounterId = Number(fight.encounterID);
      const raidId = raidIdByEncounterId.get(encounterId);
      if (!raidId) continue;

      pullsByRaidId.set(raidId, (pullsByRaidId.get(raidId) || 0) + 1);
    }

    const [dominantRaidId] =
      Array.from(pullsByRaidId.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return b[0] - a[0];
      })[0] || [];

    return dominantRaidId || 0;
  }

  // Initialize all guilds from config
  // New guilds are queued for background processing instead of blocking
  async initializeGuilds(): Promise<void> {
    logger.info("Initializing guilds from config...");

    const rawGuilds = process.env.NODE_ENV === "production" ? GUILDS_PROD : GUILDS_DEV;
    const guildsToTrack = filterUniqueGuilds(rawGuilds);
    logger.info(`Environment: ${process.env.NODE_ENV}, Tracking ${guildsToTrack.length} unique guilds (from ${rawGuilds.length} total)`);

    let newGuildsCount = 0;
    let existingGuildsCount = 0;

    for (const guildConfig of guildsToTrack) {
      const existing = await Guild.findOne({
        name: guildConfig.name,
        realm: guildConfig.realm,
        region: guildConfig.region,
      });

      if (!existing) {
        const existingLogSource = await GuildLogSource.findOne({
          name: guildConfig.name,
          realm: guildConfig.realm,
          region: guildConfig.region,
        }).collation(CASE_INSENSITIVE_COLLATION);
        if (existingLogSource) {
          logger.info(
            `Skipping config guild ${guildConfig.name}-${guildConfig.realm}: it is already a Warcraft Logs source for guild ${existingLogSource.guildId.toString()}`,
          );
          existingGuildsCount++;
          continue;
        }

        // Fetch guild crest data from Blizzard API
        // Use parent_guild name if it exists, as that's the actual guild in Blizzard's system
        const blizzardGuildName = guildConfig.parent_guild || guildConfig.name;
        logger.info(`Fetching crest data for: ${blizzardGuildName} - ${guildConfig.realm}${guildConfig.parent_guild ? ` (parent guild for ${guildConfig.name})` : ""}`);
        let crestData = undefined;
        let faction = undefined;

        try {
          const guildData = await blizzardService.getGuildData(blizzardGuildName, guildConfig.realm.toLowerCase(), guildConfig.region);
          if (guildData) {
            crestData = guildData.crest;
            faction = guildData.faction;
            logger.info(`✅ Retrieved crest data for: ${blizzardGuildName}`);
          } else {
            logger.warn(`⚠️  Could not fetch crest data for: ${blizzardGuildName}`);
          }
        } catch (error) {
          logger.error(`Error fetching crest data for ${blizzardGuildName}:`, error instanceof Error ? error.message : "Unknown error");
        }

        const newGuild = await Guild.create({
          name: guildConfig.name,
          realm: guildConfig.realm,
          region: guildConfig.region,
          faction,
          crest: crestData,
          parent_guild: guildConfig.parent_guild,
          streamers: this.formatConfigStreamers(guildConfig.streamers),
          progress: [],
        });
        logger.info(`Created guild: ${guildConfig.name} - ${guildConfig.realm}`);

        // Queue for background processing instead of immediate blocking fetch
        try {
          await backgroundGuildProcessor.queueGuild(newGuild, 10);
          logger.info(`Queued guild for background processing: ${guildConfig.name} - ${guildConfig.realm}`);
          newGuildsCount++;
        } catch (error) {
          logger.error(`Error queueing guild for processing: ${guildConfig.name} - ${guildConfig.realm}:`, error instanceof Error ? error.message : "Unknown error");
        }
      } else {
        existingGuildsCount++;

        // Check if this existing guild needs to be queued for initial fetch
        // (i.e., it exists in DB but has no reports - maybe a previous fetch failed)
        const hasReports = await Report.exists({ guildId: existing._id });
        if (!hasReports) {
          // Skip guilds that don't exist on WarcraftLogs (marked as not_found)
          if (existing.wclStatus === "not_found") {
            logger.debug(`Skipping guild ${existing.name} - marked as not found on WarcraftLogs`);
            continue;
          }

          // Skip guilds that already completed their initial fetch (they just have no reports on WCL)
          if (existing.initialFetchCompleted) {
            logger.debug(`Skipping guild ${existing.name} - initial fetch already completed (no reports on WCL)`);
            continue;
          }

          // Check if already in queue
          const inQueue = await GuildProcessingQueue.findOne({
            guildId: existing._id,
          });
          if (!inQueue || inQueue.status === "failed") {
            logger.info(`Existing guild ${existing.name} has no reports, queueing for background fetch`);
            await backgroundGuildProcessor.queueGuild(existing, 10);
          }
        }
      }
    }

    logger.info(`Guild initialization complete: ${newGuildsCount} new guilds queued, ${existingGuildsCount} existing guilds`);
  }

  // Sync guild config data from config to database.
  // Streamers are only seeded when a guild is first created; after that, the
  // database/admin panel owns the streamer list.
  async syncGuildConfigData(): Promise<void> {
    logger.info("Syncing guild config data (parent_guild only; existing streamers are preserved)...");

    const rawGuilds = process.env.NODE_ENV === "production" ? GUILDS_PROD : GUILDS_DEV;
    const guildsToTrack = filterUniqueGuilds(rawGuilds);

    for (const guildConfig of guildsToTrack) {
      try {
        const guild = await Guild.findOne({
          name: guildConfig.name,
          realm: guildConfig.realm,
          region: guildConfig.region,
        });

        if (!guild) {
          // Guild doesn't exist yet, will be created by initializeGuilds
          continue;
        }

        // Check if we need to update parent_guild
        const needsParentUpdate = guild.parent_guild !== guildConfig.parent_guild;

        // Update if needed
        if (needsParentUpdate) {
          const updates: any = {};

          updates.parent_guild = guildConfig.parent_guild;
          logger.info(`  ${guild.name}: Updating parent_guild to "${guildConfig.parent_guild || "none"}"`);

          await Guild.updateOne(
            {
              name: guildConfig.name,
              realm: guildConfig.realm,
              region: guildConfig.region,
            },
            { $set: updates },
          );
        }
      } catch (error) {
        logger.error(`Error syncing config for ${guildConfig.name}:`, error instanceof Error ? error.message : "Unknown error");
      }
    }

    logger.info("Guild config sync completed");
  }

  // Recalculate statistics for existing guilds on startup
  // This is used when CALCULATE_GUILD_STATISTICS_ON_STARTUP is set to true
  async recalculateExistingGuildStatistics(currentTierOnly: boolean = true, raidIds?: number[]): Promise<void> {
    if (this.existingGuildStatisticsRecalculationRunning) {
      logger.warn("Statistics recalculation is already running, skipping duplicate request");
      return;
    }

    this.existingGuildStatisticsRecalculationRunning = true;
    const taskId = await taskTracker.start("Recalculate Guild Statistics", { currentTierOnly, raidIds });
    let totalGuilds = 0;
    let processedGuilds = 0;
    let recalculatedGuilds = 0;
    let skippedGuilds = 0;
    let failedGuilds = 0;

    logger.info("Recalculating statistics for existing guilds...");
    if (raidIds) {
      logger.info(`Mode: Specific raids [${raidIds.join(", ")}]`);
    } else {
      logger.info(`Mode: ${currentTierOnly ? "Current tier only" : "All tracked raids"}`);
    }
    this.logMemoryUsage("statistics recalculation start");

    try {
      totalGuilds = await Guild.countDocuments();

      if (totalGuilds === 0) {
        logger.info("No guilds found in database, skipping statistics recalculation");
        await taskTracker.complete(taskId, { totalGuilds, processedGuilds, recalculatedGuilds, skippedGuilds, failedGuilds });
        return;
      }

      logger.info(`Found ${totalGuilds} guilds to recalculate statistics for`);

      const guildCursor = Guild.find().cursor({ batchSize: 1 });

      // Process each guild without keeping all guild documents in memory.
      for await (const guild of guildCursor) {
        processedGuilds++;
        // Yield to event loop between guilds so HTTP requests can be served
        await yieldToEventLoop();
        try {
          // Check if guild has any reports (i.e., has already been initialized with data)
          const hasReports = await Report.exists({ guildId: guild._id });

          if (!hasReports) {
            getGuildLogger(guild.name, guild.realm).info("No reports found, skipping statistics recalculation");
            skippedGuilds++;
            continue;
          }

          getGuildLogger(guild.name, guild.realm).info("Recalculating statistics...");

          // Recalculate statistics based on the mode
          const targetRaidIds = raidIds || (currentTierOnly ? CURRENT_RAID_IDS : null);
          if (targetRaidIds) {
            for (const raidId of targetRaidIds) {
              await this.calculateGuildStatistics(guild, raidId, { createEvents: false });
            }
          } else {
            // Recalculate for all tracked raids
            await this.calculateGuildStatistics(guild, null, { createEvents: false });
          }

          // Save the guild with updated statistics
          await guild.save();
          recalculatedGuilds++;
          getGuildLogger(guild.name, guild.realm).info("Statistics recalculation complete and saved");
        } catch (error) {
          failedGuilds++;
          getGuildLogger(guild.name, guild.realm).error("Error recalculating statistics:", error instanceof Error ? error.message : "Unknown error");
          // Continue with next guild even if one fails
        } finally {
          releaseGuildLogger(guild.name, guild.realm);
          if (processedGuilds % 10 === 0 || processedGuilds === totalGuilds) {
            this.logMemoryUsage(`statistics recalculation progress ${processedGuilds}/${totalGuilds}`);
          }
        }
      }

      // Recalculate guild rankings after statistics are updated
      const rankingRaidIds = raidIds || (currentTierOnly ? CURRENT_RAID_IDS : TRACKED_RAIDS);
      logger.info(`Recalculating guild rankings for ${rankingRaidIds.length} raid(s)...`);
      for (const raidId of rankingRaidIds) {
        await this.calculateGuildRankingsForRaid(raidId);
      }

      logger.info("Finished recalculating statistics and rankings for all guilds");
      await taskTracker.complete(taskId, { totalGuilds, processedGuilds, recalculatedGuilds, skippedGuilds, failedGuilds });
    } catch (error) {
      logger.error("Error in recalculateExistingGuildStatistics:", error);
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.logMemoryUsage("statistics recalculation finish");
      this.existingGuildStatisticsRecalculationRunning = false;
    }
  }

  // Migrate existing guilds to add WarcraftLogs guild ID
  // This checks all guilds and fetches the WCL guild ID for any that are missing it
  async migrateGuildsWarcraftLogsId(): Promise<void> {
    logger.info("Migrating guilds to add WarcraftLogs guild ID...");

    try {
      // Find all guilds that don't have a warcraftlogsId
      const guildsWithoutWclId = await Guild.find({
        $or: [{ warcraftlogsId: { $exists: false } }, { warcraftlogsId: null }],
      });

      if (guildsWithoutWclId.length === 0) {
        logger.info("All guilds already have WarcraftLogs guild ID, no migration needed");
        return;
      }

      logger.info(`Found ${guildsWithoutWclId.length} guilds missing WarcraftLogs guild ID`);

      // Process each guild
      for (const guild of guildsWithoutWclId) {
        try {
          getGuildLogger(guild.name, guild.realm).info("Fetching WarcraftLogs guild ID...");

          const guildDetails = await wclService.getGuildDetails(guild.name, guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.region.toLowerCase());

          if (guildDetails.guildData?.guild?.id) {
            guild.warcraftlogsId = guildDetails.guildData.guild.id;
            getGuildLogger(guild.name, guild.realm).info(`✅ WarcraftLogs guild ID: ${guild.warcraftlogsId}`);

            // Also update faction if available and not already set
            if (guildDetails.guildData.guild.faction?.name && !guild.faction) {
              guild.faction = guildDetails.guildData.guild.faction.name;
              getGuildLogger(guild.name, guild.realm).info(`Updated faction: ${guild.faction}`);
            }

            // Save the guild with the updated ID
            await guild.save();
            getGuildLogger(guild.name, guild.realm).info("Saved successfully");
          } else {
            getGuildLogger(guild.name, guild.realm).warn("⚠️  Could not fetch WarcraftLogs guild ID from API");
          }
        } catch (error) {
          getGuildLogger(guild.name, guild.realm).error("Error fetching WarcraftLogs guild ID:", error instanceof Error ? error.message : "Unknown error");
          // Continue with next guild even if one fails
        }
      }

      logger.info("Finished migrating guilds WarcraftLogs guild IDs");
    } catch (error) {
      logger.error("Error in migrateGuildsWarcraftLogsId:", error);
      throw error;
    }
  }

  // Fetch and update a single guild's progress
  async updateGuildProgress(guildId: string): Promise<GuildProgressUpdateResult | null> {
    const lockToken = new mongoose.Types.ObjectId().toHexString();
    const now = new Date();
    const staleUpdateLock = new Date(now.getTime() - 60 * 60 * 1000);
    const staleMigrationLock = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const guild = await Guild.findOneAndUpdate(
      {
        _id: guildId,
        $and: [
          {
            $or: [
              { wclUpdateLockToken: { $exists: false } },
              { wclUpdateStartedAt: { $lt: staleUpdateLock } },
            ],
          },
          {
            $or: [
              { logSourceMigrationLockToken: { $exists: false } },
              { logSourceMigrationLockedAt: { $lt: staleMigrationLock } },
            ],
          },
        ],
      },
      { $set: { wclUpdateLockToken: lockToken, wclUpdateStartedAt: now } },
      { new: true },
    );
    if (!guild) {
      logger.info(`Guild ${guildId} was not updated because it is missing or already locked for processing`);
      return null;
    }

    getGuildLogger(guild.name, guild.realm).info("Updating guild progress");

    try {
      const wasCurrentlyRaiding = guild.isCurrentlyRaiding;
      const primarySource = await guildLogSourceService.ensurePrimarySource(guild);

      // Determine if this is an initial fetch by checking if guild has any reports at all
      const hasAnyReports = await Report.exists({ guildId: guild._id });
      const isInitialFetch = !hasAnyReports;

      // Fetch reports and process - scope depends on whether initial or update
      // Note: performUpdate now handles raiding status internally
      const hasNewData = await this.fetchAndProcessReports(guild, primarySource, isInitialFetch);

      // For initial fetch, ensure raiding status is set to false and mark as completed
      if (isInitialFetch) {
        guild.isCurrentlyRaiding = false;
        guild.initialFetchCompleted = true;
        guild.initialFetchCompletedAt = new Date();
      }

      guild.lastFetched = new Date();
      await guild.save();
      await guildLogSourceService.setSourceFetchSucceeded(primarySource, {
        warcraftlogsId: guild.warcraftlogsId,
        lastLogEndTime: guild.lastLogEndTime,
      });

      const raidingStatusChanged = wasCurrentlyRaiding !== guild.isCurrentlyRaiding;
      if (hasNewData || raidingStatusChanged) {
        const invalidations = [cacheService.invalidateGuildSpecificCaches(guild.realm, guild.name)];
        if (raidingStatusChanged) {
          invalidations.push(cacheService.invalidate(cacheService.getGuildListKey()));
        }
        await Promise.all(invalidations);
      }

      // Update world rankings only if there was new data and only for current raid
      if (hasNewData && isInitialFetch) {
        // Initial fetch: update ranks for all raids with progress, then calculate guild rankings
        await this.updateGuildWorldRankings(guildId);
        await this.calculateGuildRankingsForAllRaids();
      } else if (hasNewData && !isInitialFetch) {
        // Update: only update rank for current raids if not completed
        await this.updateCurrentRaidsWorldRanking(guildId);
        for (const raidId of CURRENT_RAID_IDS) {
          await this.calculateGuildRankingsForRaid(raidId);
        }
      }

      // Update official progression from Raider.IO (reflects in-game kills, works for private logs)
      await this.updateOfficialProgress(guildId);

      getGuildLogger(guild.name, guild.realm).info("Successfully updated guild progress");
      return { guild, hasNewData, raidingStatusChanged, isInitialFetch };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message || error.name : "Unknown error";
      getGuildLogger(guild.name, guild.realm).error("Error updating guild:", error);

      // Classify the error for better handling
      const { classifyError, ErrorType } = require("../utils/error-classifier");
      const classifiedError = classifyError(errorMessage);

      // If guild not found on WarcraftLogs, mark it and don't retry automatically
      if (classifiedError.type === ErrorType.GUILD_NOT_FOUND) {
        getGuildLogger(guild.name, guild.realm).warn("Guild not found on WarcraftLogs, marking as not_found");
        const primarySource = await guildLogSourceService.ensurePrimarySource(guild);
        await guildLogSourceService.setSourceFetchFailed(primarySource._id as mongoose.Types.ObjectId, true);
        await Guild.findByIdAndUpdate(guild._id, {
          wclStatus: "not_found",
          wclStatusUpdatedAt: new Date(),
          $inc: { wclNotFoundCount: 1 },
        });
      }

      return null;
    } finally {
      await Guild.updateOne(
        { _id: guild._id, wclUpdateLockToken: lockToken },
        { $unset: { wclUpdateLockToken: 1, wclUpdateStartedAt: 1 } },
      );
    }
  }

  // Fetch and log guild zone rankings for debugging
  async fetchGuildZoneRankings(guildId: string, zoneId?: number): Promise<void> {
    const guild = await Guild.findById(guildId);
    if (!guild) {
      logger.error(`Guild not found: ${guildId}`);
      return;
    }

    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info(`\n========== FETCHING ZONE RANKINGS ==========`);

    // If no zoneId specified, use the primary current raid
    const targetZoneId = zoneId || PRIMARY_RAID_ID;

    try {
      // Get raid info
      const raid = await this.getRaidData(targetZoneId);
      if (!raid) {
        logger.error(`Raid not found for zone ID: ${targetZoneId}`);
        return;
      }

      guildLog.info(`Raid: ${raid.name} (Zone ID: ${targetZoneId})`);
      guildLog.info(`Bosses: ${raid.bosses?.length || 0}\n`);

      try {
        const result = await wclService.getGuildZoneRanking(guild.name, guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.region.toLowerCase(), targetZoneId);

        // Debug: Log the entire result structure
        guildLog.info(`Full API Response:`);
        guildLog.info(JSON.stringify(result, null, 2));

        // Access the ranking data
        const zoneRanking = result.guildData?.guild?.zoneRanking;

        if (zoneRanking?.progress?.worldRank) {
          const worldRank = zoneRanking.progress.worldRank;
          guildLog.info(`\n✅ World Progress Rank: #${worldRank.number} (${worldRank.color})`);
        } else {
          guildLog.info(`\n⚠️  No world rank data found`);
        }
      } catch (error) {
        guildLog.error(`Error fetching rankings:`, error);
      }

      guildLog.info(`\n========== END ZONE RANKINGS ==========\n`);
    } catch (error) {
      guildLog.error(`Error in fetchGuildZoneRankings:`, error);
    }
  }

  // Record a world rank snapshot if the rank has changed from the most recent entry.
  // Only records for current raid tier to avoid unbounded growth.
  private async recordWorldRankSnapshot(guildId: mongoose.Types.ObjectId, raidId: number, progress: IRaidProgress): Promise<void> {
    if (!CURRENT_RAID_IDS.includes(raidId)) return;
    if (progress.worldRank == null) return;

    const latest = await WorldRankHistory.findOne({ guildId, raidId }, { worldRank: 1, wclWorldRank: 1, rioWorldRank: 1 }, { sort: { recordedAt: -1 }, lean: true });

    // Skip if nothing changed
    if (
      latest &&
      latest.worldRank === progress.worldRank &&
      latest.wclWorldRank === (progress.wclWorldRank ?? undefined) &&
      latest.rioWorldRank === (progress.rioWorldRank ?? undefined)
    ) {
      return;
    }

    await WorldRankHistory.create({
      guildId,
      raidId,
      worldRank: progress.worldRank,
      wclWorldRank: progress.wclWorldRank,
      rioWorldRank: progress.rioWorldRank,
      recordedAt: new Date(),
    });
  }

  // Get world rank history for a guild and raid
  async getWorldRankHistory(guildId: mongoose.Types.ObjectId, raidId: number): Promise<{ worldRank: number; wclWorldRank?: number; rioWorldRank?: number; recordedAt: Date }[]> {
    const entries = await WorldRankHistory.find(
      { guildId, raidId },
      { worldRank: 1, wclWorldRank: 1, rioWorldRank: 1, recordedAt: 1, _id: 0 },
      { sort: { recordedAt: 1 }, lean: true },
    );
    return entries;
  }

  // Compute the best (lowest) world rank from WCL and RaiderIO sources, and set the display fields
  private computeBestWorldRank(progress: IRaidProgress): void {
    const wclRank = progress.wclWorldRank;
    const rioRank = progress.rioWorldRank;

    if (wclRank && rioRank) {
      // Both exist: use the lower (better) rank
      if (wclRank <= rioRank) {
        progress.worldRank = wclRank;
        progress.worldRankColor = progress.wclWorldRankColor;
      } else {
        progress.worldRank = rioRank;
        progress.worldRankColor = undefined; // RaiderIO doesn't provide color classes
      }
    } else if (wclRank) {
      progress.worldRank = wclRank;
      progress.worldRankColor = progress.wclWorldRankColor;
    } else if (rioRank) {
      progress.worldRank = rioRank;
      progress.worldRankColor = undefined;
    } else {
      progress.worldRank = undefined;
      progress.worldRankColor = undefined;
    }
  }

  // Update world rankings for all raids the guild has progress in
  // Fetches from BOTH WarcraftLogs and Raider.IO, stores each separately, and picks the best
  async updateGuildWorldRankings(guildId: string): Promise<void> {
    const guild = await Guild.findById(guildId);
    if (!guild) {
      logger.error(`Guild not found: ${guildId}`);
      return;
    }

    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info("Updating world rankings (WCL + Raider.IO)...");

    // Only update rankings for raids where the guild has made progress
    const raidsWithProgress = guild.progress.filter((p) => (p.difficulty === "mythic" || p.difficulty === "heroic") && p.bossesDefeated > 0);

    if (raidsWithProgress.length === 0) {
      guildLog.info("No raids with progress, skipping world rank update");
      return;
    }

    // Group by raidId to avoid duplicate API calls for the same raid
    const raidIds = [...new Set(raidsWithProgress.map((p) => p.raidId))];

    if (guild.wclStatus === "not_found") {
      guildLog.info("Skipping WCL world ranks because guild is marked not_found on WarcraftLogs");
    } else {
      // --- WarcraftLogs: fetch world rank per raid ---
      for (const raidId of raidIds) {
        try {
          const raidEntries = raidsWithProgress.filter((p) => p.raidId === raidId);
          const raidName = raidEntries[0].raidName;
          guildLog.info(`Fetching WCL world rank for ${raidName}...`);

          const result = await wclService.getGuildZoneRanking(guild.name, guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.region.toLowerCase(), raidId);
          const worldRank = result.guildData?.guild?.zoneRanking?.progress?.worldRank;

          if (worldRank?.number) {
            for (const raidProgress of raidEntries) {
              raidProgress.wclWorldRank = worldRank.number;
              raidProgress.wclWorldRankColor = worldRank.color;
            }
            guildLog.info(`${raidName}: WCL World Rank #${worldRank.number} (${worldRank.color})`);
          } else {
            guildLog.info(`${raidName}: No WCL world rank data`);
          }
        } catch (error) {
          guildLog.error(`Error fetching WCL world rank for raidId ${raidId}:`, error);
        }
      }
    }

    // --- Raider.IO: fetch world rank for all raids in one call ---
    try {
      guildLog.info("Fetching Raider.IO world ranks...");
      const rioRankings = await raiderIOService.fetchGuildRaidRankings(guild.region.toLowerCase(), guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.name);

      if (rioRankings) {
        for (const raidId of raidIds) {
          const raidData = await this.getRaidData(raidId);
          if (!raidData) continue;

          const raidEntries = raidsWithProgress.filter((p) => p.raidId === raidId);
          const diffRankings = this.findRaiderIORaidRankings(rioRankings, raidData.slug, raidData.name, raidData.rioSlug || RAID_RIO_SLUG_OVERRIDES[raidData.id]);
          if (!diffRankings) {
            guildLog.info(`${raidData.name}: No matching Raider.IO rankings found`);
            continue;
          }

          const rank = diffRankings.mythic?.world || diffRankings.heroic?.world;
          if (rank) {
            for (const raidProgress of raidEntries) {
              raidProgress.rioWorldRank = rank;
            }
            guildLog.info(`${raidData.name}: Raider.IO World Rank #${rank}`);
          } else {
            guildLog.info(`${raidData.name}: Raider.IO returned no valid world rank`);
          }
        }
      } else {
        guildLog.warn("Raider.IO returned no ranking data");
      }
    } catch (error) {
      guildLog.error("Error fetching Raider.IO world ranks:", error);
    }

    // --- Compute the best world rank for each progress entry ---
    for (const raidProgress of raidsWithProgress) {
      this.computeBestWorldRank(raidProgress);
    }

    await guild.save();

    // Record rank snapshots for current raid tier (after save so guild._id is available)
    for (const raidProgress of raidsWithProgress) {
      await this.recordWorldRankSnapshot(guild._id as mongoose.Types.ObjectId, raidProgress.raidId, raidProgress);
    }

    guildLog.info("World rankings updated and saved");
  }

  // Update world rankings for all current raids
  // By default, completed raids with full rank data are skipped unless the caller forces a refresh.
  // Updates both mythic and heroic progress entries with world rank data
  async updateCurrentRaidsWorldRanking(guildId: string): Promise<void> {
    await this.updateWorldRankingForRaids(guildId, CURRENT_RAID_IDS);
  }

  // Update world rankings for specific raids
  // Fetches from BOTH WarcraftLogs and Raider.IO, stores each separately, and picks the best
  async updateWorldRankingForRaids(guildId: string, raidIds: number[], options: { refreshCompleted?: boolean } = {}): Promise<void> {
    const guild = await Guild.findById(guildId);
    if (!guild) {
      logger.error(`Guild not found: ${guildId}`);
      return;
    }

    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info(`Updating world ranks for raids [${raidIds.join(", ")}] (WCL + Raider.IO)...`);

    // Collect raids that actually need updating
    const raidsToUpdate: { raidId: number; raidData: IRaid; mythicProgress: IRaidProgress | undefined; heroicProgress: IRaidProgress | undefined; raidName: string }[] = [];

    for (const raidId of raidIds) {
      const raidData = await this.getRaidData(raidId);
      if (!raidData) {
        guildLog.warn(`Raid data not found (ID: ${raidId}), skipping world rank update`);
        continue;
      }

      const mythicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "mythic");
      const heroicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "heroic");

      if (!mythicProgress && !heroicProgress) {
        guildLog.info(`No progress for raid ${raidId}, skipping world rank update`);
        continue;
      }

      const hasCompletedMythic = mythicProgress && mythicProgress.bossesDefeated >= raidData.bosses.length;
      const hasExistingWorldRank = Boolean(
        mythicProgress?.worldRank ||
        mythicProgress?.wclWorldRank ||
        mythicProgress?.rioWorldRank ||
        heroicProgress?.worldRank ||
        heroicProgress?.wclWorldRank ||
        heroicProgress?.rioWorldRank,
      );
      const hasWclWorldRank = Boolean(mythicProgress?.wclWorldRank || heroicProgress?.wclWorldRank);
      const hasRioWorldRank = Boolean(mythicProgress?.rioWorldRank || heroicProgress?.rioWorldRank);
      const rioSupported = Boolean(raidData.rioSlug || RAID_RIO_SLUG_OVERRIDES[raidData.id]);
      const missingSupportedSourceRank = !hasWclWorldRank || (rioSupported && !hasRioWorldRank);

      if (!options.refreshCompleted && hasCompletedMythic && hasExistingWorldRank && !missingSupportedSourceRank) {
        guildLog.info(`Has completed raid ${raidId} mythic (${mythicProgress.bossesDefeated}/${raidData.bosses.length}), world rank is final - skipping update`);
        continue;
      }

      const raidName = mythicProgress?.raidName || heroicProgress?.raidName || `Raid ${raidId}`;
      raidsToUpdate.push({ raidId, raidData, mythicProgress, heroicProgress, raidName });
    }

    if (raidsToUpdate.length === 0) {
      guildLog.info("No raids to update world ranks for");
      return;
    }

    if (guild.wclStatus === "not_found") {
      guildLog.info("Skipping WCL world ranks because guild is marked not_found on WarcraftLogs");
    } else {
      // --- WarcraftLogs: fetch world rank per raid ---
      for (const { raidId, mythicProgress, heroicProgress, raidName } of raidsToUpdate) {
        try {
          guildLog.info(`Fetching WCL world rank for ${raidName}...`);
          const result = await wclService.getGuildZoneRanking(guild.name, guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.region.toLowerCase(), raidId);
          const worldRank = result.guildData?.guild?.zoneRanking?.progress?.worldRank;

          if (worldRank?.number) {
            if (mythicProgress) {
              mythicProgress.wclWorldRank = worldRank.number;
              mythicProgress.wclWorldRankColor = worldRank.color;
            }
            if (heroicProgress) {
              heroicProgress.wclWorldRank = worldRank.number;
              heroicProgress.wclWorldRankColor = worldRank.color;
            }
            guildLog.info(`${raidName}: WCL World Rank #${worldRank.number} (${worldRank.color})`);
          } else {
            guildLog.info(`${raidName}: No WCL world rank data`);
          }
        } catch (error) {
          guildLog.error(`Error fetching WCL world rank for raid ${raidId}:`, error);
        }
      }
    }

    // --- Raider.IO: fetch world rank for all raids in one call ---
    try {
      guildLog.info("Fetching Raider.IO world ranks...");
      const rioRankings = await raiderIOService.fetchGuildRaidRankings(guild.region.toLowerCase(), guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.name);

      if (rioRankings) {
        for (const { raidData, mythicProgress, heroicProgress, raidName } of raidsToUpdate) {
          const diffRankings = this.findRaiderIORaidRankings(rioRankings, raidData.slug, raidData.name, raidData.rioSlug || RAID_RIO_SLUG_OVERRIDES[raidData.id]);
          if (!diffRankings) {
            guildLog.info(`${raidName}: No matching Raider.IO rankings found`);
            continue;
          }

          const rank = diffRankings.mythic?.world || diffRankings.heroic?.world;
          if (rank) {
            if (mythicProgress) {
              mythicProgress.rioWorldRank = rank;
            }
            if (heroicProgress) {
              heroicProgress.rioWorldRank = rank;
            }
            guildLog.info(`${raidName}: Raider.IO World Rank #${rank}`);
          } else {
            guildLog.info(`${raidName}: Raider.IO returned no valid world rank`);
          }
        }
      } else {
        guildLog.warn("Raider.IO returned no ranking data");
      }
    } catch (error) {
      guildLog.error("Error fetching Raider.IO world ranks:", error);
    }

    // --- Compute the best world rank for each progress entry ---
    for (const { mythicProgress, heroicProgress } of raidsToUpdate) {
      if (mythicProgress) this.computeBestWorldRank(mythicProgress);
      if (heroicProgress) this.computeBestWorldRank(heroicProgress);
    }

    await guild.save();

    // Record rank snapshots for current raid tier (after save so guild._id is available)
    for (const { raidId, mythicProgress, heroicProgress } of raidsToUpdate) {
      // Use mythic progress preferentially since both have the same worldRank
      const progressForSnapshot = mythicProgress || heroicProgress;
      if (progressForSnapshot) {
        await this.recordWorldRankSnapshot(guild._id as mongoose.Types.ObjectId, raidId, progressForSnapshot);
      }
    }

    guildLog.info("World ranks updated for target raids");
  }

  // Calculate guild rankings for all tracked raids
  async calculateGuildRankingsForAllRaids(): Promise<void> {
    logger.info("Calculating guild rankings for all tracked raids...");

    for (const raidId of TRACKED_RAIDS) {
      await this.calculateGuildRankingsForRaid(raidId);
    }

    logger.info("Guild rankings calculation complete for all raids");
  }

  // Fetch official raid progression from Raider.IO and store it
  // This reflects Blizzard's in-game kill tracking, independent of WCL log visibility
  async updateOfficialProgress(guildId: string): Promise<void> {
    const guild = await Guild.findById(guildId);
    if (!guild) {
      logger.error(`Guild not found: ${guildId}`);
      return;
    }

    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info("Fetching official raid progression from Raider.IO...");

    try {
      const profile = await raiderIOService.fetchGuildRaidProgression(guild.region.toLowerCase(), guild.realm.toLowerCase().replace(/\s+/g, "-"), guild.name);

      if (!profile || !profile.raid_progression) {
        guildLog.info("No raid progression data from Raider.IO");
        return;
      }

      const updatedEntries = Object.entries(profile.raid_progression).map(([tierSlug, tierData]) => ({
        raidTierSlug: tierSlug,
        summary: tierData.summary,
        totalBosses: tierData.total_bosses,
        normalBossesKilled: tierData.normal_bosses_killed,
        heroicBossesKilled: tierData.heroic_bosses_killed,
        mythicBossesKilled: tierData.mythic_bosses_killed,
        lastUpdated: new Date(),
      }));

      guild.officialProgress = updatedEntries;

      // Ensure synthetic progress entries exist for tracked raids where RIO reports kills
      // but no WCL progress entry exists (e.g. guild stopped logging but still raids)
      const trackedRaids = await Raid.find({ id: { $in: TRACKED_RAIDS } }).lean();
      let progressModified = false;

      for (const entry of updatedEntries) {
        const matchedRaid = this.findRaidForRIOTierSlug(entry.raidTierSlug, trackedRaids);
        if (!matchedRaid) continue;

        // Normalize RIO tier slug to WCL slug so downstream consumers can match
        entry.raidTierSlug = matchedRaid.slug;

        if (entry.mythicBossesKilled > 0) {
          this.upsertSyntheticProgress(guild, matchedRaid, "mythic", entry.mythicBossesKilled, entry.totalBosses);
          progressModified = true;
        }
        if (entry.heroicBossesKilled > 0) {
          this.upsertSyntheticProgress(guild, matchedRaid, "heroic", entry.heroicBossesKilled, entry.totalBosses);
          progressModified = true;
        }
      }

      if (progressModified) {
        guild.markModified("progress");
      }

      await guild.save();

      for (const entry of updatedEntries) {
        guildLog.info(`Official progress (${entry.raidTierSlug}): ${entry.summary}`);
      }
    } catch (error) {
      guildLog.error("Error fetching official progress from Raider.IO:", error);
    }
  }

  // Update guild data exclusively from Raider.IO when WCL data is unavailable.
  // Creates/updates synthetic progress entries, official progress, and world rankings.
  // Returns true if the guild has current-tier progress (should be considered active).
  async updateGuildFromRaiderIO(guildId: string): Promise<boolean> {
    const guild = await Guild.findById(guildId);
    if (!guild) {
      logger.error(`Guild not found for RIO update: ${guildId}`);
      return false;
    }

    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info("Updating guild data from Raider.IO (WCL unavailable)...");

    try {
      // Single API call to get both progression and rankings
      const { progression, rankings, faction } = await raiderIOService.fetchGuildProgressionAndRankings(
        guild.region.toLowerCase(),
        guild.realm.toLowerCase().replace(/\s+/g, "-"),
        guild.name,
      );

      if (!progression) {
        guildLog.info("Guild not found on Raider.IO or no progression data");
        guild.rioStatus = "not_found";
        guild.lastRioUpdate = new Date();
        await guild.save();
        return false;
      }

      // Update faction if we got it and don't have it yet
      if (faction && !guild.faction) {
        guild.faction = faction;
      }

      // Update official progress from progression data
      const updatedOfficialEntries = Object.entries(progression).map(([tierSlug, tierData]) => ({
        raidTierSlug: tierSlug,
        summary: tierData.summary,
        totalBosses: tierData.total_bosses,
        normalBossesKilled: tierData.normal_bosses_killed,
        heroicBossesKilled: tierData.heroic_bosses_killed,
        mythicBossesKilled: tierData.mythic_bosses_killed,
        lastUpdated: new Date(),
      }));
      guild.officialProgress = updatedOfficialEntries;

      // Load all tracked raids from DB to map RIO tier slugs to our internal raid IDs
      const trackedRaids = await Raid.find({ id: { $in: TRACKED_RAIDS } }).lean();

      let hasCurrentTierProgress = false;

      // Create/update synthetic progress entries for each RIO tier with kills
      for (const [tierSlug, tierData] of Object.entries(progression)) {
        // Find matching raid in our DB by slug
        const matchedRaid = this.findRaidForRIOTierSlug(tierSlug, trackedRaids);
        if (!matchedRaid) {
          guildLog.info(`RIO tier "${tierSlug}" has no matching tracked raid, skipping`);
          continue;
        }

        // Normalize RIO tier slug to WCL slug in officialProgress so downstream consumers can match
        const officialEntry = updatedOfficialEntries.find((e) => e.raidTierSlug === tierSlug);
        if (officialEntry) officialEntry.raidTierSlug = matchedRaid.slug;

        // Check if this is a current raid
        const isCurrentRaid = CURRENT_RAID_IDS.includes(matchedRaid.id);

        // Create synthetic progress for Mythic if kills exist
        if (tierData.mythic_bosses_killed > 0) {
          this.upsertSyntheticProgress(guild, matchedRaid, "mythic", tierData.mythic_bosses_killed, tierData.total_bosses);
          if (isCurrentRaid) hasCurrentTierProgress = true;
        }

        // Create synthetic progress for Heroic if kills exist
        if (tierData.heroic_bosses_killed > 0) {
          this.upsertSyntheticProgress(guild, matchedRaid, "heroic", tierData.heroic_bosses_killed, tierData.total_bosses);
          if (isCurrentRaid) hasCurrentTierProgress = true;
        }
      }

      // Update world rankings from RIO rankings data
      if (rankings) {
        for (const raidProgress of guild.progress) {
          const raidData = trackedRaids.find((r) => r.id === raidProgress.raidId);
          if (!raidData) continue;

          const diffRankings = this.findRaiderIORaidRankings(rankings, raidData.slug, raidData.name, raidData.rioSlug || RAID_RIO_SLUG_OVERRIDES[raidData.id]);
          if (!diffRankings) continue;

          const rank = raidProgress.difficulty === "mythic" ? diffRankings.mythic?.world : diffRankings.heroic?.world;
          if (rank) {
            raidProgress.rioWorldRank = rank;
            this.computeBestWorldRank(raidProgress);
            guildLog.info(`${raidData.name} (${raidProgress.difficulty}): Raider.IO World Rank #${rank}`);
          }
        }
      }

      // Update activity status based on current tier progress
      if (hasCurrentTierProgress) {
        guild.activityStatus = "active";
      }

      guild.rioStatus = "active";
      guild.lastRioUpdate = new Date();
      guild.lastFetched = new Date();
      guild.markModified("progress");
      await guild.save();

      guildLog.info(`RIO update complete: ${hasCurrentTierProgress ? "active" : "no"} current-tier progress`);
      return hasCurrentTierProgress;
    } catch (error) {
      guildLog.error("Error updating guild from Raider.IO:", error);
      guild.lastRioUpdate = new Date();
      await guild.save();
      return false;
    }
  }

  // Match a Raider.IO tier slug (e.g., "tier-mn-1") to a Raid document
  private findRaidForRIOTierSlug(tierSlug: string, raids: IRaid[]): IRaid | undefined {
    const normalized = tierSlug.toLowerCase();

    // Explicit WCL zone ID -> RIO slug mapping handles known provider naming differences.
    let match = raids.find((r) => RAID_RIO_SLUG_OVERRIDES[r.id]?.toLowerCase() === normalized);
    if (match) return match;

    // Check stored rioSlug first (most reliable after raid sync/backfill)
    match = raids.find((r) => r.rioSlug?.toLowerCase() === normalized);
    if (match) return match;

    // Exact WCL slug match
    match = raids.find((r) => r.slug.toLowerCase() === normalized);
    if (match) return match;

    // Partial/contains match (handle slight differences between RIO and WCL slugs)
    match = raids.find((r) => {
      const rSlug = r.slug.toLowerCase();
      const rName = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return rSlug.includes(normalized) || normalized.includes(rSlug) || rName.includes(normalized) || normalized.includes(rName);
    });
    return match;
  }

  // Create or update a synthetic IRaidProgress entry from Raider.IO data.
  // Only updates bossesDefeated/totalBosses; preserves any existing boss-level detail from WCL.
  private upsertSyntheticProgress(guild: IGuild, raid: IRaid, difficulty: "mythic" | "heroic", bossesDefeated: number, totalBosses: number): void {
    let existing = guild.progress.find((p) => p.raidId === raid.id && p.difficulty === difficulty);

    if (existing) {
      // If WCL already has more kills tracked, don't overwrite
      if (existing.bossesDefeated >= bossesDefeated) return;
      existing.bossesDefeated = bossesDefeated;
      existing.totalBosses = totalBosses;
      existing.lastUpdated = new Date();
    } else {
      guild.progress.push({
        raidId: raid.id,
        raidName: raid.name,
        difficulty,
        bossesDefeated,
        totalBosses,
        totalTimeSpent: 0,
        totalCombatTimeSpent: 0,
        progressRaidTimeSpent: 0,
        totalRaidTimeSpent: 0,
        bosses: [],
        lastUpdated: new Date(),
      } as IRaidProgress);
    }
  }

  // Calculate guild rankings for a specific raid
  // Rankings are calculated per difficulty (mythic and heroic separately)
  async calculateGuildRankingsForRaid(raidId: number): Promise<void> {
    logger.info(`Calculating guild rankings for raid ${raidId}...`);

    // Exclude guilds that have this raid in their excludedRaidIds
    const guilds = await Guild.find({ excludedRaidIds: { $ne: raidId } });

    if (guilds.length === 0) {
      logger.info("No guilds found, skipping ranking calculation");
      return;
    }

    // Also clear guildRank for guilds excluded from this raid. Use targeted
    // updates instead of saving full guild documents so concurrent progress
    // updates do not trip Mongoose version conflicts.
    await Guild.updateMany(
      { excludedRaidIds: raidId, "progress.raidId": raidId },
      { $set: { "progress.$[progress].guildRank": null } },
      { arrayFilters: [{ "progress.raidId": raidId }] },
    );

    // Look up raid slug for matching official progress from Raider.IO
    const raid = await Raid.findOne({ id: raidId }).lean();
    const raidSlug = raid?.slug || "";
    const raidRioSlug = raid?.rioSlug?.toLowerCase() || "";

    // Helper: find matching official progress entry for this raid
    // Checks both WCL slug and RIO slug since officialProgress may store either format
    const findOfficialProgress = (guild: IGuild): IOfficialRaidProgress | undefined => {
      if (!guild.officialProgress?.length || !raidSlug) return undefined;
      const normalized = raidSlug.toLowerCase();
      return guild.officialProgress.find((op) => {
        const tierSlug = op.raidTierSlug.toLowerCase();
        return tierSlug === normalized || tierSlug.includes(normalized) || normalized.includes(tierSlug) || (raidRioSlug && tierSlug === raidRioSlug);
      });
    };

    // Unified ranking: rank all guilds together across both difficulties.
    // Each guild gets ONE guildRank stored on its highest-difficulty progress entry.
    // Mythic progress always outranks heroic-only progress.
    type RankEntry = {
      guild: IGuild;
      progress: IRaidProgress; // The progress entry where guildRank will be stored
      effectiveKills: number; // Combined effective kills for ranking
      difficulty: "mythic" | "heroic"; // Which difficulty this guild is ranked by
    };

    const rankEntries: RankEntry[] = [];

    for (const guild of guilds) {
      const mythicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "mythic");
      const heroicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "heroic");
      const official = findOfficialProgress(guild);

      const mythicOfficialKills = official?.mythicBossesKilled ?? 0;
      const mythicLogKills = mythicProgress?.bossesDefeated ?? 0;
      const effectiveMythicKills = Math.max(mythicLogKills, mythicOfficialKills);

      const heroicOfficialKills = official?.heroicBossesKilled ?? 0;
      const heroicLogKills = heroicProgress?.bossesDefeated ?? 0;
      const effectiveHeroicKills = Math.max(heroicLogKills, heroicOfficialKills);

      if (effectiveMythicKills > 0 && mythicProgress) {
        // Guild has mythic progress — rank by mythic, store guildRank on mythic entry
        rankEntries.push({ guild, progress: mythicProgress, effectiveKills: effectiveMythicKills, difficulty: "mythic" });
      } else if (effectiveHeroicKills > 0 && heroicProgress) {
        // Guild is heroic-only — rank by heroic, store guildRank on heroic entry
        rankEntries.push({ guild, progress: heroicProgress, effectiveKills: effectiveHeroicKills, difficulty: "heroic" });
      }
    }

    // Clear stale guildRank from progress entries that won't receive a new rank.
    // This covers: heroic entries of mythic-ranked guilds, mythic entries of heroic-only guilds
    // with old stale ranks, and guilds that dropped out of ranking entirely.
    const rankedGuildIds = new Set(rankEntries.map((e) => e.guild._id.toString()));
    const clearRankOperations: mongoose.mongo.AnyBulkWriteOperation[] = [];
    for (const guild of guilds) {
      for (const progress of guild.progress) {
        if (progress.raidId !== raidId) continue;
        const isRankedEntry =
          rankedGuildIds.has(guild._id.toString()) && rankEntries.some((e) => e.guild._id.toString() === guild._id.toString() && e.progress.difficulty === progress.difficulty);
        if (!isRankedEntry && progress.guildRank != null) {
          clearRankOperations.push({
            updateOne: {
              filter: { _id: guild._id },
              update: { $set: { "progress.$[progress].guildRank": null } },
              arrayFilters: [{ "progress.raidId": raidId, "progress.difficulty": progress.difficulty }],
            },
          });
        }
      }
    }

    if (clearRankOperations.length > 0) {
      await Guild.bulkWrite(clearRankOperations, { ordered: false });
    }

    if (rankEntries.length === 0) {
      logger.info(`No guilds with progress for raid ${raidId}, skipping ranking`);
      return;
    }

    // Sort all guilds together in a single unified ranking.
    // Mythic guilds always rank above heroic-only guilds.
    const isComplete = (entry: RankEntry) => entry.progress.totalBosses > 0 && entry.effectiveKills >= entry.progress.totalBosses;
    const getClearTime = (entry: RankEntry): number => {
      const lastKilledBoss = this.getLastKilledBossForSummary(entry.progress.bosses);
      const clearTime = lastKilledBoss?.firstKillTime ? new Date(lastKilledBoss.firstKillTime).getTime() : Infinity;
      return Number.isFinite(clearTime) ? clearTime : Infinity;
    };

    const sortedEntries = rankEntries.sort((a, b) => {
      // Rule 0: Mythic always beats heroic-only
      if (a.difficulty !== b.difficulty) {
        return a.difficulty === "mythic" ? -1 : 1;
      }

      // Rule 1: Most effective boss kills first (max of WCL logs and Raider.IO official)
      if (a.effectiveKills !== b.effectiveKills) {
        return b.effectiveKills - a.effectiveKills; // Higher is better
      }

      // Rule 2: Fully cleared guilds with the same kills are ordered by clear time.
      // Completed raids do not have a current boss, so without this fallback they
      // can collapse to alphabetical order when historical world ranks are missing.
      const aIsComplete = isComplete(a);
      const bIsComplete = isComplete(b);
      if (aIsComplete && bIsComplete) {
        const aClearTime = getClearTime(a);
        const bClearTime = getClearTime(b);
        if (aClearTime !== bClearTime) {
          return aClearTime - bClearTime; // Earlier clear is better
        }
      }

      // Rule 3: Best pull progress on current (next unkilled) boss
      // This takes priority over world rank because world rank reflects the rank
      // at the time of the LAST kill, not current progression on the next boss.
      // Use effectiveKills to find the current boss — when RaiderIO shows more kills
      // than WCL logs, the "next boss" is at index effectiveKills, not the first
      // WCL-unkilled boss.
      const aCurrentBoss = a.progress.bosses[a.effectiveKills] ?? a.progress.bosses.find((boss) => boss.kills === 0);
      const bCurrentBoss = b.progress.bosses[b.effectiveKills] ?? b.progress.bosses.find((boss) => boss.kills === 0);

      // Only compare pull progress when both guilds have meaningful pull data (pullCount > 0).
      // If a guild has no WCL pull data on the current boss (e.g. progress is from RaiderIO only),
      // skip this rule and fall through to world rank comparison.
      const aHasPullData = aCurrentBoss && aCurrentBoss.pullCount > 0;
      const bHasPullData = bCurrentBoss && bCurrentBoss.pullCount > 0;

      if (aHasPullData && bHasPullData) {
        const aFightCompletion = aCurrentBoss.bestPullPhase?.fightCompletion ?? aCurrentBoss.bestPercent ?? 100;
        const bFightCompletion = bCurrentBoss.bestPullPhase?.fightCompletion ?? bCurrentBoss.bestPercent ?? 100;

        if (aFightCompletion !== bFightCompletion) {
          return aFightCompletion - bFightCompletion; // Lower is better
        }

        const aBossHealth = aCurrentBoss.bestPullPhase?.bossHealth ?? aCurrentBoss.bestPercent ?? 100;
        const bBossHealth = bCurrentBoss.bestPullPhase?.bossHealth ?? bCurrentBoss.bestPercent ?? 100;

        if (aBossHealth !== bBossHealth) {
          return aBossHealth - bBossHealth; // Lower is better
        }
      } else if (aHasPullData !== bHasPullData) {
        // Guild with pull data on the current boss ranks higher than one without
        return aHasPullData ? -1 : 1;
      }

      // Rule 4: World rank (from WCL API or Raider.IO fallback)
      const aWorldRank = a.progress.worldRank ?? Infinity;
      const bWorldRank = b.progress.worldRank ?? Infinity;
      if (aWorldRank !== bWorldRank) {
        return aWorldRank - bWorldRank; // Lower is better
      }

      // Final tiebreaker: alphabetically by guild name
      return a.guild.name.localeCompare(b.guild.name);
    });

    // Assign unified ranks (1-based, continuous across all guilds)
    sortedEntries.forEach((entry, index) => {
      entry.progress.guildRank = index + 1;
    });

    // Save rank fields with targeted updates. This preserves the existing
    // ranking logic but avoids saving stale full guild documents while guild
    // progress updates are running concurrently.
    const rankOperations: mongoose.mongo.AnyBulkWriteOperation[] = sortedEntries.map((entry, index) => ({
      updateOne: {
        filter: { _id: entry.guild._id },
        update: { $set: { "progress.$[progress].guildRank": index + 1 } },
        arrayFilters: [{ "progress.raidId": raidId, "progress.difficulty": entry.progress.difficulty }],
      },
    }));

    for (let i = 0; i < rankOperations.length; i += 100) {
      await yieldToEventLoop();
      await Guild.bulkWrite(rankOperations.slice(i, i + 100), { ordered: false });
    }

    const mythicCount = sortedEntries.filter((e) => e.difficulty === "mythic").length;
    const heroicCount = sortedEntries.filter((e) => e.difficulty === "heroic").length;
    logger.info(`Ranked ${sortedEntries.length} guilds for raid ${raidId} (${mythicCount} mythic, ${heroicCount} heroic-only)`);
  }

  // Fetch reports for a guild and process both Mythic and Heroic from the same data
  // Returns true if new data was found and processed
  private async fetchAndProcessReports(guild: IGuild, source: IGuildLogSource, isInitialFetch: boolean): Promise<boolean> {
    let hasNewData = false;

    if (isInitialFetch) {
      // Initial fetch: Get ALL reports across all content, filter by tracked raid bosses
      getGuildLogger(guild.name, guild.realm).info("INITIAL FETCH - fetching all historical reports");
      hasNewData = await this.performInitialFetch(guild, source);

      // Calculate statistics from database fights for ALL tracked raids (initial setup)
      await this.calculateGuildStatistics(guild, null, { createEvents: false });
    } else {
      // Update: Only check the current raids for new reports
      getGuildLogger(guild.name, guild.realm).info(`UPDATE - checking only current raids (IDs: ${CURRENT_RAID_IDS.join(", ")})`);
      hasNewData = await this.performUpdate(guild, source);

      // Only recalculate statistics for the current raids if we found new data
      if (hasNewData) {
        for (const raidId of CURRENT_RAID_IDS) {
          await this.calculateGuildStatistics(guild, raidId, { recalculateSchedule: false });
        }
      } else {
        getGuildLogger(guild.name, guild.realm).info("No new data for current raids, skipping statistics recalculation");
      }
    }

    return hasNewData;
  }

  // Initial fetch: Get ALL reports for guild (no zone filter), save to DB
  // Returns true if any data was found and saved
  private async performInitialFetch(guild: IGuild, source: IGuildLogSource): Promise<boolean> {
    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info("Performing initial fetch of all reports");

    // Fetch WarcraftLogs guild ID (only during initial fetch)
    if (!source.warcraftlogsId) {
      guildLog.info("Fetching WarcraftLogs guild ID...");
      try {
        const guildDetails = await wclService.getGuildDetails(source.name, source.realm.toLowerCase().replace(/\s+/g, "-"), source.region.toLowerCase());

        if (guildDetails.guildData?.guild?.id) {
          source.warcraftlogsId = guildDetails.guildData.guild.id;
          guild.warcraftlogsId = source.warcraftlogsId;
          await source.save();
          guildLog.info(`WarcraftLogs guild ID: ${guild.warcraftlogsId}`);

          // Also update faction if available
          if (guildDetails.guildData.guild.faction?.name && !guild.faction) {
            guild.faction = guildDetails.guildData.guild.faction.name;
            guildLog.info(`Updated faction: ${guild.faction}`);
          }
        } else {
          guildLog.warn("Could not fetch WarcraftLogs guild ID");
        }
      } catch (error) {
        guildLog.error("Error fetching WarcraftLogs guild ID:", error instanceof Error ? error.message : "Unknown error");
      }
    }

    // Get valid boss encounter IDs from all tracked raids
    const validBossIds = await this.getValidBossEncounterIds();
    guildLog.info(`Tracking ${validBossIds.size} boss encounters across ${TRACKED_RAIDS.length} raids`);

    const reportsPerPage = 10;
    let page = 1;
    const maxPages = 500; // Fetch up to 5000 reports maximum
    let totalReportsFetched = 0;
    let totalFightsSaved = 0;

    while (page <= maxPages) {
      const data = await wclService.getGuildReportsWithFights(source.name, source.realm.toLowerCase().replace(/\s+/g, "-"), source.region.toLowerCase(), reportsPerPage, page, true);

      if (!data.reportData?.reports?.data || data.reportData.reports.data.length === 0) {
        guildLog.info(`No more reports found at page ${page}`);
        break;
      }

      // Update guild faction if available (only on first page)
      if (page === 1 && data.guildData?.guild?.faction?.name) {
        guild.faction = data.guildData.guild.faction.name;
      }

      const pageReports = data.reportData.reports.data;
      guildLog.info(`Page ${page}: fetched ${pageReports.length} reports`);

      // Process each report
      for (const report of pageReports) {
        const zoneId = report.zone?.id;

        // Save report metadata
        const isOngoing = !report.endTime || report.endTime === 0;
        await Report.findOneAndUpdate(
          { code: report.code },
          {
            code: report.code,
            guildId: guild._id,
            warcraftLogsSourceId: source._id,
            sourceGuildSnapshot: getGuildLogSourceSnapshot(source),
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

        totalReportsFetched++;

        // Process fights in this report
        if (report.fights && report.fights.length > 0) {
          const encounterPhases = report.phases || [];

          // Get fight IDs for tracked raid bosses only
          const trackedFightIds: number[] = [];
          for (const fight of report.fights) {
            if (validBossIds.has(fight.encounterID)) {
              trackedFightIds.push(fight.id);
            }
          }

          const fightDetailFightIds = this.fetchDeathEvents
            ? trackedFightIds
            : report.fights.filter((fight: any) => validBossIds.has(fight.encounterID) && fight.difficulty === 5).map((fight: any) => fight.id);

          let deathsByFight = new Map<number, any[]>();
          let combatantsByFight = new Map<number, any[]>();
          let rostersByFight = new Map<number, FightRosterResult>();
          let deathEventsFetchedAt: Date | null = null;
          let combatantInfoFetchedAt: Date | null = null;
          let discoverReportCharacters = false;
          if (fightDetailFightIds.length > 0) {
            try {
              const deathData = await wclService.getDeathEventsForReport(report.code, fightDetailFightIds, {
                includeCombatantInfo: true,
                includeDeathEvents: this.fetchDeathEvents,
              });
              if (deathData.reportData?.report) {
                const actors = deathData.reportData.report.masterData?.actors || [];
                if (this.fetchDeathEvents && Array.isArray(deathData.reportData.report.events?.data)) {
                  deathsByFight = wclService.parseDeathEventsByFight(deathData.reportData.report, actors, report.fights);
                  deathEventsFetchedAt = new Date();
                }
                rostersByFight = wclService.parseFightRostersByFight(deathData.reportData.report, actors);
                combatantsByFight = new Map(Array.from(rostersByFight, ([fightId, roster]) => [fightId, roster.participants]));
                combatantInfoFetchedAt = new Date();
              }
            } catch (error: any) {
              guildLog.warn(`Failed to fetch fight details for report ${report.code}: ${error.message}`);
            }
          }

          for (const fight of report.fights) {
            const encounterId = fight.encounterID;

            // CRITICAL: Only save fights for tracked raid bosses
            if (!validBossIds.has(encounterId)) {
              continue; // Skip dungeon bosses and other non-tracked content
            }

            const bossPercent = fight.bossPercentage || 0;
            const fightPercent = fight.fightPercentage || 0;
            const duration = fight.endTime - fight.startTime;
            const difficulty = fight.difficulty;

            // Determine phase information
            const phaseInfo = wclService.determinePhaseInfo(fight, encounterPhases);

            // Get deaths for this fight
            const deaths = deathsByFight.get(fight.id) || [];
            const combatants = combatantsByFight.get(fight.id) || [];
            const roster = rostersByFight.get(fight.id);
            const fightDetailsFetchUpdate = {
              ...(deathEventsFetchedAt !== null
                ? { deaths, deathEventsFetchStatus: "fetched", deathEventsFetchedAt }
                : {}),
              ...(combatantInfoFetchedAt !== null && roster?.rosterComplete
                ? {
                    combatants,
                    combatantInfoFetchStatus: roster.status,
                    combatantInfoFetchedAt,
                    combatantInfoSource: roster.source,
                    combatantInfoRosterComplete: true,
                    combatantInfoKnownSpecCount: roster.knownSpecCount,
                  }
                : {}),
            };

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
                ...fightDetailsFetchUpdate,
                reportStartTime: report.startTime,
                reportEndTime: report.endTime || 0,
                fightStartTime: fight.startTime,
                fightEndTime: fight.endTime,
                duration: duration,
                timestamp: fightTimestamp,
              },
              { upsert: true, new: true },
            );

            // ADD CHARACTER DISCOVERY: Fetch characters for Mythic kills in current raids
            if (fight.kill && difficulty === 5 && CURRENT_RAID_IDS.includes(zoneId || 0)) {
              discoverReportCharacters = true;
            }

            totalFightsSaved++;
          }

          if (discoverReportCharacters) {
            try {
              const charData = await wclService.getReportCharacters(report.code);
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
              }

              guildLog.info(`Saved ${rankedChars.length} characters from report ${report.code}`);
            } catch (error) {
              guildLog.error(`Failed to fetch characters for report ${report.code}:`, error);
            }
          }
        }
      }

      if (pageReports.length < reportsPerPage) {
        guildLog.info(`Reached last page at page ${page}`);
        break;
      }

      page++;
    }

    // Update the guild's lastLogEndTime from the database (find most recent report)
    const mostRecentReport = await Report.findOne({ guildId: guild._id }).sort({ endTime: -1 }).limit(1);

    if (mostRecentReport && mostRecentReport.endTime) {
      guild.lastLogEndTime = new Date(mostRecentReport.endTime);
      guildLog.info(`Set lastLogEndTime to ${guild.lastLogEndTime.toISOString()}`);
    }

    guildLog.info(`Initial fetch complete: ${totalReportsFetched} reports, ${totalFightsSaved} fights saved`);
    return totalFightsSaved > 0;
  }

  // Thoroughly refetch the 3 newest reports to ensure all fights are captured
  // This is called when a guild stops raiding to catch any fights that were missed during live polling
  private async thoroughlyRefetchNewestReports(guild: IGuild, source: IGuildLogSource): Promise<number> {
    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info("⚠️  THOROUGHLY REFETCHING 3 newest reports to ensure completeness...");

    let totalNewFights = 0;

    // Get the 3 most recent reports WITHOUT filtering by zone
    // This is critical because WCL might tag a report with a different zone than we expect
    const checkData = await wclService.getRecentReports(source.name, source.realm.toLowerCase().replace(/\s+/g, "-"), source.region.toLowerCase(), 3);

    if (!checkData.reportData?.reports?.data || checkData.reportData.reports.data.length === 0) {
      guildLog.info("No reports found");
      return 0;
    }

    const recentReports = checkData.reportData.reports.data;
    guildLog.info(`Thoroughly refetching ${recentReports.length} reports...`);

    // Get valid boss encounter IDs for all current raids
    const raidIdByEncounterId = await this.getCurrentRaidIdByEncounterId();
    const validBossIds = new Set(raidIdByEncounterId.keys());

    for (const reportSummary of recentReports) {
      const code = reportSummary.code;

      // Fetch the full report with all fights
      const reportData = await wclService.getReportByCodeAllDifficulties(code);

      if (!reportData.reportData?.report) {
        guildLog.info(`Failed to fetch report ${code}`);
        continue;
      }

      const report = reportData.reportData.report;
      const currentTime = Date.now();
      const reportEndTime = report.endTime || 0;
      const THIRTY_MINUTES_MS = 30 * 60 * 1000;
      const isLive = reportEndTime && currentTime - reportEndTime < THIRTY_MINUTES_MS;

      // Get existing fights for this report
      const existingFights = await Fight.find({
        reportCode: report.code,
        guildId: guild._id,
      })
        .select("fightId")
        .lean();

      const existingFightIds = new Set(existingFights.map((f) => f.fightId));
      const totalFightsInReport = report.fights?.length || 0;

      guildLog.info(`Report ${code}: ${existingFightIds.size} fights in DB, ${totalFightsInReport} fights in report`);

      // Determine the zone/raid ID from the fights in the report
      // We'll use the first boss encounter we find to determine the zone
      let reportZoneId = 0;
      if (report.fights && report.fights.length > 0) {
        for (const fight of report.fights) {
          const raidIdForEncounter = raidIdByEncounterId.get(fight.encounterID);
          if (raidIdForEncounter) {
            reportZoneId = raidIdForEncounter;
            if (reportZoneId) break;
          }
        }
      }

      // Update report metadata with accurate fight count
      await Report.findOneAndUpdate(
        { code: report.code },
        {
          code: report.code,
          guildId: guild._id,
          warcraftLogsSourceId: source._id,
          sourceGuildSnapshot: getGuildLogSourceSnapshot(source),
          zoneId: reportZoneId, // Use the zone we detected from fights
          startTime: report.startTime,
          endTime: reportEndTime,
          isOngoing: isLive,
          fightCount: totalFightsInReport,
          fightSequence: this.buildReportFightSequence(report),
          lastProcessed: new Date(),
        },
        { upsert: true, new: true },
      );

      // Process all fights from the report
      if (report.fights && report.fights.length > 0) {
        const encounterPhases = report.phases || [];
        let newFightsInThisReport = 0;

        // Get fight IDs for tracked raid bosses only
        const trackedFightIds: number[] = [];
        for (const fight of report.fights) {
          if (validBossIds.has(fight.encounterID)) {
            trackedFightIds.push(fight.id);
          }
        }

        const fightDetailFightIds = this.fetchDeathEvents
          ? trackedFightIds
          : report.fights.filter((fight: any) => validBossIds.has(fight.encounterID) && fight.difficulty === 5).map((fight: any) => fight.id);

        let deathsByFight = new Map<number, any[]>();
        let combatantsByFight = new Map<number, any[]>();
        let rostersByFight = new Map<number, FightRosterResult>();
        let deathEventsFetchedAt: Date | null = null;
        let combatantInfoFetchedAt: Date | null = null;
        if (fightDetailFightIds.length > 0) {
          try {
            const deathData = await wclService.getDeathEventsForReport(report.code, fightDetailFightIds, {
              includeCombatantInfo: true,
              includeDeathEvents: this.fetchDeathEvents,
            });
            if (deathData.reportData?.report) {
              const actors = deathData.reportData.report.masterData?.actors || [];
              if (this.fetchDeathEvents && Array.isArray(deathData.reportData.report.events?.data)) {
                deathsByFight = wclService.parseDeathEventsByFight(deathData.reportData.report, actors, report.fights);
                deathEventsFetchedAt = new Date();
              }
              rostersByFight = wclService.parseFightRostersByFight(deathData.reportData.report, actors);
              combatantsByFight = new Map(Array.from(rostersByFight, ([fightId, roster]) => [fightId, roster.participants]));
              combatantInfoFetchedAt = new Date();
            }
          } catch (error: any) {
            guildLog.warn(`Failed to fetch fight details for report ${report.code}: ${error.message}`);
          }
        }

        const fightWrites: any[] = [];

        for (const fight of report.fights) {
          const encounterId = fight.encounterID;

          // Only save fights for current raid bosses
          if (!validBossIds.has(encounterId)) {
            continue;
          }

          // Determine which raid this fight belongs to
          const fightZoneId = raidIdByEncounterId.get(encounterId) || 0;

          if (!fightZoneId) {
            continue; // Skip if we can't determine the zone
          }

          // Skip if we already have this fight
          if (existingFightIds.has(fight.id)) {
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
          const combatants = combatantsByFight.get(fight.id) || [];
          const roster = rostersByFight.get(fight.id);
          const fightDetailsFetchUpdate = {
            ...(deathEventsFetchedAt !== null
              ? { deaths, deathEventsFetchStatus: "fetched", deathEventsFetchedAt }
              : {}),
            ...(combatantInfoFetchedAt !== null && roster?.rosterComplete
              ? {
                  combatants,
                  combatantInfoFetchStatus: roster.status,
                  combatantInfoFetchedAt,
                  combatantInfoSource: roster.source,
                  combatantInfoRosterComplete: true,
                  combatantInfoKnownSpecCount: roster.knownSpecCount,
                }
              : {}),
          };

          // Queue fight write; batching avoids one MongoDB round trip per recovered pull.
          const fightTimestamp = new Date(report.startTime + fight.startTime);
          fightWrites.push({
            updateOne: {
              filter: { reportCode: report.code, fightId: fight.id },
              update: {
                $set: {
                  reportCode: report.code,
                  guildId: guild._id,
                  fightId: fight.id,
                  zoneId: fightZoneId, // Use the zone we detected for this specific fight
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
                  ...fightDetailsFetchUpdate,
                  reportStartTime: report.startTime,
                  reportEndTime: reportEndTime,
                  fightStartTime: fight.startTime,
                  fightEndTime: fight.endTime,
                  duration: duration,
                  timestamp: fightTimestamp,
                },
              },
              upsert: true,
            },
          });

          newFightsInThisReport++;
          totalNewFights++;
        }

        if (fightWrites.length > 0) {
          await Fight.bulkWrite(fightWrites, { ordered: false });
        }

        if (newFightsInThisReport > 0) {
          guildLog.info(`Report ${code}: saved ${newFightsInThisReport} NEW fights that were previously missing`);
        }
      }
    }

    guildLog.info(`Thorough refetch complete: ${totalNewFights} total new fights recovered`);

    // Always recalculate statistics to ensure accuracy, even if no new fights were found
    guildLog.info("Recalculating statistics for all current raids...");
    for (const raidId of CURRENT_RAID_IDS) {
      await this.calculateGuildStatistics(guild, raidId, { createEvents: totalNewFights > 0 });
    }
    guildLog.info("Statistics recalculated");

    return totalNewFights;
  }

  // Refetch recent reports for all active guilds in current raid tiers
  // This is useful to catch any fights that might have been missed during live polling
  async refetchRecentReportsForAllActiveGuilds(): Promise<void> {
    logger.info("[Refetch/Recent] Starting refetch of recent reports for all active guilds...");

    try {
      // Get all active guilds (excluding guilds not found on WCL)
      const guilds = await Guild.find({
        activityStatus: "active",
        wclStatus: { $ne: "not_found" },
      });

      if (guilds.length === 0) {
        logger.info("[Refetch/Recent] No active guilds found");
        return;
      }

      logger.info(`[Refetch/Recent] Refetching recent reports for ${guilds.length} active guild(s)...`);

      let totalRecoveredFights = 0;

      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        const guildLog = getGuildLogger(guild.name, guild.realm);
        logger.info(`[Refetch/Recent] Guild ${i + 1}/${guilds.length}: ${guild.name}`);

        try {
          const primarySource = await guildLogSourceService.ensurePrimarySource(guild);
          const recoveredFights = await this.thoroughlyRefetchNewestReports(guild, primarySource);

          if (recoveredFights > 0) {
            guildLog.info(`✅ Recovered ${recoveredFights} missing fights`);
            totalRecoveredFights += recoveredFights;
          } else {
            guildLog.info("No missing fights found (statistics still recalculated)");
          }

          // Small delay to avoid overwhelming the API
          if (i < guilds.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        } catch (error) {
          guildLog.error(`Failed to refetch recent reports:`, error);
          // Continue with next guild even if one fails
        }
      }

      logger.info(`[Refetch/Recent] Completed: ${totalRecoveredFights} total fights recovered across all guilds`);
    } catch (error) {
      logger.error("[Refetch/Recent] Error:", error);
    }
  }

  // Update: Check only the current raids for new reports
  // Returns true if new data was found and saved
  private async performUpdate(guild: IGuild, source: IGuildLogSource): Promise<boolean> {
    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info("Checking for updates...");

    // Get valid boss encounter IDs for all current raids
    const raidIdByEncounterId = await this.getCurrentRaidIdByEncounterId();
    const validBossIds = new Set(raidIdByEncounterId.keys());
    guildLog.info(`Current raids have ${validBossIds.size} total bosses to track`);

    let hasLiveLog = false;
    const allReportsToFetch: Array<{ code: string }> = [];
    const currentTime = Date.now();
    const THIRTY_MINUTES_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

    // Get the 3 most recent reports WITHOUT filtering by zone
    // This is critical because WCL might tag a report with a different zone than we expect
    const checkData = await wclService.getRecentReports(source.name, source.realm.toLowerCase().replace(/\s+/g, "-"), source.region.toLowerCase(), 3);

    if (!checkData.reportData?.reports?.data || checkData.reportData.reports.data.length === 0) {
      guildLog.info("No reports found");
      return false;
    }

    const recentReports = checkData.reportData.reports.data;

    // Determine which reports are "live" (endTime within 30 minutes) or new
    for (const report of recentReports) {
      const reportCode = report.code;
      const endTime = report.endTime;
      const startTime = report.startTime;

      // Check if we already have this report in our database
      const existingReport = await Report.findOne({
        code: reportCode,
        guildId: guild._id,
      }).lean();

      // If endTime is within 30 minutes of now, it's a live log
      const isLive = endTime && currentTime - endTime < THIRTY_MINUTES_MS;

      if (isLive) {
        hasLiveLog = true;
        guildLog.info(`Report ${reportCode} is LIVE (endTime: ${new Date(endTime).toISOString()}, ${Math.round((currentTime - endTime) / 1000)}s ago)`);
        allReportsToFetch.push({ code: reportCode });
      } else if (!existingReport) {
        // New report we haven't seen before
        guildLog.info(`Report ${reportCode} is NEW (not in database)`);
        allReportsToFetch.push({ code: reportCode });
      } else if (existingReport) {
        // For existing reports, check multiple conditions that might indicate new data:
        let shouldRefetch = false;
        let reason = "";

        // 1. Check if endTime has changed (report was extended)
        const lastKnownEndTime = existingReport.endTime || 0;
        if (endTime && endTime > lastKnownEndTime) {
          shouldRefetch = true;
          reason = `endTime changed from ${new Date(lastKnownEndTime).toISOString()} to ${new Date(endTime).toISOString()}`;
        }

        // 2. Check if we might be missing fights by comparing stored count with actual fights in DB
        // This catches cases where we fetched a live report before all fights were uploaded
        if (!shouldRefetch && existingReport.fightCount) {
          const actualFightsInDb = await Fight.countDocuments({
            reportCode: reportCode,
            guildId: guild._id,
            encounterID: { $in: Array.from(validBossIds) }, // Only count fights for current raids
          });

          // If we have fewer fights in DB than the report claimed to have, refetch
          // Allow a small margin (fights from other content might be filtered out)
          if (actualFightsInDb < existingReport.fightCount - 5) {
            shouldRefetch = true;
            reason = `possible missing fights (${actualFightsInDb} in DB vs ${existingReport.fightCount} reported)`;
          }
        }

        if (shouldRefetch) {
          guildLog.info(`Report ${reportCode} needs REFETCH: ${reason}`);
          allReportsToFetch.push({ code: reportCode });
        }
      }
    }

    // Update guild raiding status based on whether we found a live log
    const wasRaiding = guild.isCurrentlyRaiding;
    guild.isCurrentlyRaiding = hasLiveLog;
    if (wasRaiding !== guild.isCurrentlyRaiding) {
      guildLog.info(`Raiding status changed: ${guild.isCurrentlyRaiding ? "STARTED" : "STOPPED"} raiding`);

      // CRITICAL FIX: When guild stops raiding, do a thorough refetch of the 3 newest reports
      // This ensures we catch any fights that were missed during live polling
      if (!guild.isCurrentlyRaiding && wasRaiding) {
        guildLog.info("⚠️  Guild just STOPPED raiding - performing thorough refetch of newest reports...");

        // Capture progress state BEFORE refetch/recalculation for regress detection
        const preRaidProgress = guild.progress.filter((p) => CURRENT_RAID_IDS.includes(p.raidId)).map((p) => JSON.parse(JSON.stringify(p))) as IRaidProgress[];

        const recoveredFights = await this.thoroughlyRefetchNewestReports(guild, source);

        // Check for regress events (no improvement during the raid night)
        try {
          await this.checkForRegressEvents(guild, preRaidProgress);
        } catch (error) {
          guildLog.error("Error checking for regress events:", error);
        }

        if (recoveredFights > 0) {
          guildLog.info(`✅ Recovered ${recoveredFights} missing fights (statistics already recalculated)`);
          return true; // We found and processed new data
        } else {
          guildLog.info("No missing fights found (statistics already recalculated)");
        }
      }
    }

    if (allReportsToFetch.length === 0) {
      guildLog.info("No new or live reports to process");
      return false;
    }

    guildLog.info(`Found ${allReportsToFetch.length} reports to process`);

    let totalFightsSaved = 0;

    // Fetch and save each report
    for (const { code } of allReportsToFetch) {
      const reportData = await wclService.getReportByCodeAllDifficulties(code);

      if (!reportData.reportData?.report) {
        guildLog.info(`Failed to fetch report ${code}`);
        continue;
      }

      const report = reportData.reportData.report;
      const reportEndTime = report.endTime || 0;
      const isLive = reportEndTime && currentTime - reportEndTime < THIRTY_MINUTES_MS;

      // Get existing fights for this report to avoid duplicates
      const existingFights = await Fight.find({
        reportCode: report.code,
        guildId: guild._id,
      })
        .select("fightId")
        .lean();

      const existingFightIds = new Set(existingFights.map((f) => f.fightId));

      const totalFightsInReport = report.fights?.length || 0;
      guildLog.info(`Report ${code}: ${existingFightIds.size} fights already in database, ${totalFightsInReport} fights in report`);

      // Determine the zone/raid ID from the fights in the report
      let reportZoneId = 0;
      if (report.fights && report.fights.length > 0) {
        for (const fight of report.fights) {
          const raidIdForEncounter = raidIdByEncounterId.get(fight.encounterID);
          if (raidIdForEncounter) {
            reportZoneId = raidIdForEncounter;
            if (reportZoneId) break;
          }
        }
      }

      // Save report metadata with accurate fight count for later comparison
      await Report.findOneAndUpdate(
        { code: report.code },
        {
          code: report.code,
          guildId: guild._id,
          warcraftLogsSourceId: source._id,
          sourceGuildSnapshot: getGuildLogSourceSnapshot(source),
          zoneId: reportZoneId, // Use the zone we detected from fights
          startTime: report.startTime,
          endTime: reportEndTime,
          isOngoing: isLive,
          fightCount: totalFightsInReport, // Store total fight count to detect missing fights later
          fightSequence: this.buildReportFightSequence(report),
          lastProcessed: new Date(),
        },
        { upsert: true, new: true },
      );

      // Process fights
      if (report.fights && report.fights.length > 0) {
        const encounterPhases = report.phases || [];
        let newFightsInThisReport = 0;

        // Get fight IDs for tracked raid bosses only
        const trackedFightIds: number[] = [];
        for (const fight of report.fights) {
          if (validBossIds.has(fight.encounterID)) {
            trackedFightIds.push(fight.id);
          }
        }

        const fightDetailFightIds = this.fetchDeathEvents
          ? trackedFightIds
          : report.fights.filter((fight: any) => validBossIds.has(fight.encounterID) && fight.difficulty === 5).map((fight: any) => fight.id);

        let deathsByFight = new Map<number, any[]>();
        let combatantsByFight = new Map<number, any[]>();
        let rostersByFight = new Map<number, FightRosterResult>();
        let deathEventsFetchedAt: Date | null = null;
        let combatantInfoFetchedAt: Date | null = null;
        if (fightDetailFightIds.length > 0) {
          try {
            const deathData = await wclService.getDeathEventsForReport(report.code, fightDetailFightIds, {
              includeCombatantInfo: true,
              includeDeathEvents: this.fetchDeathEvents,
            });
            if (deathData.reportData?.report) {
              const actors = deathData.reportData.report.masterData?.actors || [];
              if (this.fetchDeathEvents && Array.isArray(deathData.reportData.report.events?.data)) {
                deathsByFight = wclService.parseDeathEventsByFight(deathData.reportData.report, actors, report.fights);
                deathEventsFetchedAt = new Date();
              }
              rostersByFight = wclService.parseFightRostersByFight(deathData.reportData.report, actors);
              combatantsByFight = new Map(Array.from(rostersByFight, ([fightId, roster]) => [fightId, roster.participants]));
              combatantInfoFetchedAt = new Date();
            }
          } catch (error: any) {
            guildLog.warn(`Failed to fetch fight details for report ${report.code}: ${error.message}`);
          }
        }

        const fightWrites: any[] = [];
        let discoverReportCharacters = false;

        for (const fight of report.fights) {
          const encounterId = fight.encounterID;

          // Only save fights for current raid bosses
          if (!validBossIds.has(encounterId)) {
            continue;
          }

          // Determine which raid this fight belongs to
          const fightZoneId = raidIdByEncounterId.get(encounterId) || 0;

          if (!fightZoneId) {
            continue; // Skip if we can't determine the zone
          }

          // Skip if we already have this fight
          if (existingFightIds.has(fight.id)) {
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
          const combatants = combatantsByFight.get(fight.id) || [];
          const roster = rostersByFight.get(fight.id);
          const fightDetailsFetchUpdate = {
            ...(deathEventsFetchedAt !== null
              ? { deaths, deathEventsFetchStatus: "fetched", deathEventsFetchedAt }
              : {}),
            ...(combatantInfoFetchedAt !== null && roster?.rosterComplete
              ? {
                  combatants,
                  combatantInfoFetchStatus: roster.status,
                  combatantInfoFetchedAt,
                  combatantInfoSource: roster.source,
                  combatantInfoRosterComplete: true,
                  combatantInfoKnownSpecCount: roster.knownSpecCount,
                }
              : {}),
          };

          // Queue fight write; batching avoids one MongoDB round trip per pull.
          const fightTimestamp = new Date(report.startTime + fight.startTime);
          fightWrites.push({
            updateOne: {
              filter: { reportCode: report.code, fightId: fight.id },
              update: {
                $set: {
                  reportCode: report.code,
                  guildId: guild._id,
                  fightId: fight.id,
                  zoneId: fightZoneId, // Use the zone we detected for this specific fight
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
                  ...fightDetailsFetchUpdate,
                  reportStartTime: report.startTime,
                  reportEndTime: reportEndTime,
                  fightStartTime: fight.startTime,
                  fightEndTime: fight.endTime,
                  duration: duration,
                  timestamp: fightTimestamp,
                },
              },
              upsert: true,
            },
          });

          // Existing ranking-discovery path: keep this scoped to new current-tier Mythic kills.
          if (fight.kill && difficulty === 5 && CURRENT_RAID_IDS.includes(fightZoneId || 0)) {
            discoverReportCharacters = true;
          }

          newFightsInThisReport++;
          totalFightsSaved++;
        }

        if (fightWrites.length > 0) {
          await Fight.bulkWrite(fightWrites, { ordered: false });
        }

        if (discoverReportCharacters) {
          try {
            const charData = await wclService.getReportCharacters(report.code);
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
            }

            guildLog.info(`Saved ${rankedChars.length} ranking-discovery characters from report ${report.code}`);
          } catch (error) {
            guildLog.error(`Failed to fetch ranking-discovery characters for report ${report.code}:`, error);
          }
        }

        guildLog.info(`Report ${code}: saved ${newFightsInThisReport} new fights`);
      }
    }

    // Update the guild's lastLogEndTime with the most recent report's end time across all raids
    const mostRecentReport = await Report.findOne({ guildId: guild._id }).sort({ endTime: -1 }).limit(1).lean();

    if (mostRecentReport && mostRecentReport.endTime) {
      const newLastLogEndTime = new Date(mostRecentReport.endTime);

      // Only update if it's newer than what we have
      if (!guild.lastLogEndTime || newLastLogEndTime > guild.lastLogEndTime) {
        guild.lastLogEndTime = newLastLogEndTime;
        guildLog.info(`Updated lastLogEndTime to ${newLastLogEndTime.toISOString()}`);
      }
    }

    guildLog.info(`Update complete: ${allReportsToFetch.length} reports processed, ${totalFightsSaved} new fights saved`);
    return totalFightsSaved > 0;
  }

  private getManualImportUserObjectId(importedByUserId?: mongoose.Types.ObjectId | string): mongoose.Types.ObjectId | undefined {
    if (!importedByUserId) {
      return undefined;
    }

    if (importedByUserId instanceof mongoose.Types.ObjectId) {
      return importedByUserId;
    }

    return mongoose.Types.ObjectId.isValid(importedByUserId) ? new mongoose.Types.ObjectId(importedByUserId) : undefined;
  }

  private async persistManualReportForGuild(params: {
    guild: IGuild;
    source: IGuildLogSource;
    report: any;
    raidIdByEncounterId: Map<number, number>;
    importedByUserId?: mongoose.Types.ObjectId | string;
  }): Promise<Omit<GuildReportImportResult, "guildId" | "guildName" | "alreadyImported">> {
    const { guild, source, report, raidIdByEncounterId } = params;
    const guildLog = getGuildLogger(guild.name, guild.realm);
    const guildObjectId = guild._id as mongoose.Types.ObjectId;
    const reportCode = typeof report?.code === "string" ? report.code.trim() : "";
    const fights = Array.isArray(report?.fights) ? report.fights : [];

    if (!reportCode) {
      throw new GuildReportImportError(400, "invalid_report", "Warcraft Logs returned a report without a code");
    }

    const reportStartTime = Number(report.startTime);
    if (!Number.isFinite(reportStartTime) || reportStartTime <= 0) {
      throw new GuildReportImportError(400, "invalid_report", "Warcraft Logs returned a report without a valid start time");
    }

    const trackedFights = fights.filter((fight: any) => raidIdByEncounterId.has(Number(fight.encounterID)));
    if (trackedFights.length === 0) {
      throw new GuildReportImportError(400, "no_tracked_fights", "Report does not contain any tracked raid boss fights");
    }

    const conflictingFight = await Fight.findOne({
      reportCode,
      guildId: { $ne: guildObjectId },
    })
      .select("guildId fightId")
      .lean();

    if (conflictingFight) {
      throw new GuildReportImportError(409, "report_conflict", "Report fights are already stored for another guild");
    }

    const reportZoneId = this.inferReportZoneIdFromTrackedFights(report, raidIdByEncounterId);
    const reportEndTimeValue = Number(report.endTime || 0);
    const reportEndTime = Number.isFinite(reportEndTimeValue) && reportEndTimeValue > 0 ? reportEndTimeValue : 0;
    const thirtyMinutesMs = 30 * 60 * 1000;
    const isOngoing = !reportEndTime || Date.now() - reportEndTime < thirtyMinutesMs;
    const manualImportedByUserId = this.getManualImportUserObjectId(params.importedByUserId);

    const reportUpdateSet: Record<string, unknown> = {
      code: reportCode,
      guildId: guildObjectId,
      warcraftLogsSourceId: source._id,
      sourceGuildSnapshot: getGuildLogSourceSnapshot(source),
      zoneId: reportZoneId,
      startTime: reportStartTime,
      endTime: reportEndTime,
      isOngoing,
      fightCount: fights.length,
      fightSequence: this.buildReportFightSequence(report),
      lastProcessed: new Date(),
      importSource: "manual_admin",
      manualImportedAt: new Date(),
    };

    if (manualImportedByUserId) {
      reportUpdateSet.manualImportedByUserId = manualImportedByUserId;
    }

    const trackedFightIds = Array.from(
      new Set<number>(
        trackedFights
          .map((fight: any) => Number(fight.id ?? fight.fightId))
          .filter((fightId: number): fightId is number => Number.isFinite(fightId)),
      ),
    ).sort((a, b) => a - b);

    let deathsByFight = new Map<number, any[]>();
    let combatantsByFight = new Map<number, any[]>();
    let rostersByFight = new Map<number, FightRosterResult>();
    let deathEventsFetchedAt: Date | null = null;
    let combatantInfoFetchedAt: Date | null = null;
    const fightDetailFightIds = this.fetchDeathEvents
      ? trackedFightIds
      : trackedFights
          .filter((fight: any) => Number(fight.difficulty) === 5)
          .map((fight: any) => Number(fight.id ?? fight.fightId))
          .filter((fightId: number): fightId is number => Number.isFinite(fightId));
    if (fightDetailFightIds.length > 0) {
      try {
        const deathData = await wclService.getDeathEventsForReport(reportCode, fightDetailFightIds, {
          includeCombatantInfo: true,
          includeDeathEvents: this.fetchDeathEvents,
        });
        if (deathData.reportData?.report) {
          const actors = deathData.reportData.report.masterData?.actors || [];
          if (this.fetchDeathEvents && Array.isArray(deathData.reportData.report.events?.data)) {
            deathsByFight = wclService.parseDeathEventsByFight(deathData.reportData.report, actors, fights);
            deathEventsFetchedAt = new Date();
          }
          rostersByFight = wclService.parseFightRostersByFight(deathData.reportData.report, actors);
          combatantsByFight = new Map(Array.from(rostersByFight, ([fightId, roster]) => [fightId, roster.participants]));
          combatantInfoFetchedAt = new Date();
        }
      } catch (error) {
        guildLog.warn(`Failed to fetch fight details for manually imported report ${reportCode}:`, error instanceof Error ? error.message : "Unknown error");
      }
    }

    const affectedRaidIds = new Set<number>();
    const fightWrites: any[] = [];
    const encounterPhases = Array.isArray(report.phases) ? report.phases : [];

    for (const fight of trackedFights) {
      const fightId = Number(fight.id ?? fight.fightId);
      const encounterId = Number(fight.encounterID);
      const fightZoneId = raidIdByEncounterId.get(encounterId) || reportZoneId;
      const fightStartTime = Number(fight.startTime);
      const fightEndTime = Number(fight.endTime);

      if (!Number.isFinite(fightId) || !Number.isFinite(encounterId) || !fightZoneId || !Number.isFinite(fightStartTime) || !Number.isFinite(fightEndTime) || fightEndTime < fightStartTime) {
        continue;
      }

      const difficulty = Number(fight.difficulty) || 0;
      const bossPercent = Number(fight.bossPercentage || 0);
      const fightPercent = Number(fight.fightPercentage || 0);
      const duration = fightEndTime - fightStartTime;
      const phaseInfo = wclService.determinePhaseInfo(fight, encounterPhases);
      const deaths = deathsByFight.get(fightId) || [];
      const combatants = combatantsByFight.get(fightId) || [];
      const roster = rostersByFight.get(fightId);
      const fightDetailsFetchUpdate = {
        ...(deathEventsFetchedAt !== null
          ? { deaths, deathEventsFetchStatus: "fetched", deathEventsFetchedAt }
          : {}),
        ...(combatantInfoFetchedAt !== null && roster?.rosterComplete
          ? {
              combatants,
              combatantInfoFetchStatus: roster.status,
              combatantInfoFetchedAt,
              combatantInfoSource: roster.source,
              combatantInfoRosterComplete: true,
              combatantInfoKnownSpecCount: roster.knownSpecCount,
            }
          : {}),
      };

      affectedRaidIds.add(fightZoneId);

      fightWrites.push({
        updateOne: {
          filter: { reportCode, fightId },
          update: {
            $set: {
              reportCode,
              guildId: guildObjectId,
              fightId,
              zoneId: fightZoneId,
              encounterID: encounterId,
              encounterName: fight.name || `Boss ${encounterId}`,
              difficulty,
              isKill: fight.kill === true,
              bossPercentage: Number.isFinite(bossPercent) ? bossPercent : 0,
              fightPercentage: Number.isFinite(fightPercent) ? fightPercent : 0,
              lastPhaseId: phaseInfo.lastPhase?.phaseId,
              lastPhaseName: phaseInfo.lastPhase?.phaseName,
              phaseTransitions: Array.isArray(fight.phaseTransitions)
                ? fight.phaseTransitions.map((pt: any) => ({
                    id: pt.id,
                    startTime: pt.startTime,
                    name: encounterPhases.find((ep: any) => ep.encounterID === encounterId)?.phases?.find((p: any) => p.id === pt.id)?.name,
                  }))
                : undefined,
              progressDisplay: phaseInfo.progressDisplay,
              ...fightDetailsFetchUpdate,
              reportStartTime,
              reportEndTime,
              fightStartTime,
              fightEndTime,
              duration,
              timestamp: new Date(reportStartTime + fightStartTime),
            },
          },
          upsert: true,
        },
      });
    }

    if (fightWrites.length === 0) {
      throw new GuildReportImportError(400, "no_tracked_fights", "Report does not contain any valid tracked raid boss fights");
    }

    const storedReport = await Report.findOneAndUpdate(
      { code: reportCode },
      {
        $set: reportUpdateSet,
        $setOnInsert: {
          charactersFetchStatus: "pending",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (!storedReport) {
      throw new GuildReportImportError(500, "invalid_report", "Failed to store report metadata");
    }

    await Fight.bulkWrite(fightWrites, { ordered: false });

    return {
      reportId: (storedReport._id as mongoose.Types.ObjectId).toString(),
      reportCode,
      totalFightCount: fights.length,
      trackedFightCount: fightWrites.length,
      affectedRaidIds: Array.from(affectedRaidIds).sort((a, b) => a - b),
    };
  }

  async importSpecificReportForGuild(
    guildId: string,
    reportCode: string,
    importedByUserId?: mongoose.Types.ObjectId | string,
    guildLogSourceId?: string,
  ): Promise<GuildReportImportResult> {
    const trimmedReportCode = reportCode.trim();
    const guild = await Guild.findById(guildId);

    if (!guild) {
      throw new GuildReportImportError(404, "guild_not_found", "Guild not found");
    }
    if (
      guild.logSourceMigrationLockToken &&
      guild.logSourceMigrationLockedAt &&
      guild.logSourceMigrationLockedAt.getTime() >= Date.now() - 2 * 60 * 60 * 1000
    ) {
      throw new GuildReportImportError(409, "report_conflict", "Guild log sources are currently being migrated. Try again after the migration finishes.");
    }

    const guildObjectId = guild._id as mongoose.Types.ObjectId;
    const guildIdString = guildObjectId.toString();
    if (guildLogSourceId && !mongoose.Types.ObjectId.isValid(guildLogSourceId)) {
      throw new GuildReportImportError(400, "invalid_report", "Choose a valid Warcraft Logs source for this guild");
    }
    const reportSource = guildLogSourceId
      ? await GuildLogSource.findOne({ _id: guildLogSourceId, guildId: guildObjectId })
      : await guildLogSourceService.ensurePrimarySource(guild);
    if (!reportSource) {
      throw new GuildReportImportError(400, "invalid_report", "Choose a valid Warcraft Logs source for this guild");
    }
    const existingReport = await Report.findOne({ code: trimmedReportCode }).select("_id code guildId fightCount").lean();

    if (existingReport) {
      const existingGuildId = existingReport.guildId?.toString();
      if (existingGuildId && existingGuildId !== guildIdString) {
        throw new GuildReportImportError(409, "report_conflict", "Report is already attributed to another guild");
      }

      const existingFightCount = await Fight.countDocuments({
        reportCode: trimmedReportCode,
        guildId: guildObjectId,
      });

      if (existingFightCount > 0) {
        return {
          guildId: guildIdString,
          guildName: guild.name,
          reportId: existingReport._id.toString(),
          reportCode: trimmedReportCode,
          alreadyImported: true,
          totalFightCount: existingReport.fightCount || existingFightCount,
          trackedFightCount: existingFightCount,
          affectedRaidIds: [],
        };
      }
    }

    let wclReport: any = null;
    try {
      const reportData = await wclService.getReportByCodeAllDifficulties(trimmedReportCode);
      wclReport = reportData.reportData?.report;

      if (!wclReport && (await wclService.hasUserAuthConnected())) {
        const userReportData = await wclService.getReportByCodeAllDifficulties(trimmedReportCode, { forceUserEndpoint: true });
        wclReport = userReportData.reportData?.report;
      }
    } catch (error) {
      getGuildLogger(guild.name, guild.realm).warn(`Failed to fetch manually imported report ${trimmedReportCode}:`, error instanceof Error ? error.message : "Unknown error");
      throw new GuildReportImportError(502, "wcl_fetch_failed", "Failed to fetch Warcraft Logs report");
    }

    if (!wclReport) {
      throw new GuildReportImportError(404, "report_not_found", "Warcraft Logs report was not found or is not accessible");
    }

    const canonicalReportCode = typeof wclReport.code === "string" ? wclReport.code.trim() : trimmedReportCode;
    if (canonicalReportCode !== trimmedReportCode) {
      const canonicalExistingReport = await Report.findOne({ code: canonicalReportCode }).select("_id guildId").lean();
      const canonicalGuildId = canonicalExistingReport?.guildId?.toString();
      if (canonicalExistingReport && canonicalGuildId !== guildIdString) {
        throw new GuildReportImportError(409, "report_conflict", "Report is already attributed to another guild");
      }
    }

    const raidIdByEncounterId = await this.getTrackedRaidIdByEncounterId();
    const persisted = await this.persistManualReportForGuild({
      guild,
      source: reportSource,
      report: wclReport,
      raidIdByEncounterId,
      importedByUserId,
    });

    for (const raidId of persisted.affectedRaidIds) {
      await this.calculateGuildStatistics(guild, raidId, { createEvents: false });
    }

    if (wclReport.endTime) {
      const importedReportEnd = new Date(Number(wclReport.endTime));
      if (!Number.isNaN(importedReportEnd.getTime()) && (!guild.lastLogEndTime || importedReportEnd > guild.lastLogEndTime)) {
        guild.lastLogEndTime = importedReportEnd;
      }
    }

    guild.lastFetched = new Date();
    await guild.save();

    for (const raidId of persisted.affectedRaidIds) {
      await this.calculateGuildRankingsForRaid(raidId);
    }

    await Promise.all([
      cacheService.invalidateGuildSpecificCaches(guild.realm, guild.name),
      cacheService.invalidate(cacheService.getGuildListKey()),
      ...persisted.affectedRaidIds.map((raidId) => cacheService.invalidateRaidCaches(raidId)),
    ]);

    return {
      guildId: guildIdString,
      guildName: guild.name,
      alreadyImported: false,
      ...persisted,
    };
  }

  // Calculate guild statistics from database fights
  // If raidId is provided, only calculate for that raid (used during updates)
  // If raidId is null, calculate for all tracked raids (used during initial fetch)
  async calculateGuildStatistics(guild: IGuild, raidId: number | null, options: CalculateGuildStatisticsOptions = {}): Promise<void> {
    const recalculateSchedule = options.recalculateSchedule ?? true;
    const createEvents = options.createEvents ?? true;
    const guildLog = getGuildLogger(guild.name, guild.realm);
    if (raidId !== null) {
      guildLog.info(`Calculating statistics for current raid only (ID: ${raidId})`);

      const raidData = await this.getRaidData(raidId);
      if (!raidData) {
        guildLog.warn(`Raid data not found for zone ${raidId}, skipping`);
        return;
      }

      // Calculate for both difficulties
      await this.calculateRaidStatistics(guild, raidData, "mythic", createEvents);
      await this.calculateRaidStatistics(guild, raidData, "heroic", createEvents);
    } else {
      guildLog.info("Calculating statistics from database fights for all tracked raids");

      // Process each tracked raid
      for (const trackedRaidId of TRACKED_RAIDS) {
        const raidData = await this.getRaidData(trackedRaidId);
        if (!raidData) {
          guildLog.warn(`Raid data not found for zone ${trackedRaidId}, skipping`);
          continue;
        }

        // Calculate for both difficulties
        await this.calculateRaidStatistics(guild, raidData, "mythic", createEvents);
        await this.calculateRaidStatistics(guild, raidData, "heroic", createEvents);
      }
    }

    guildLog.info("Statistics calculation complete");

    // Calculate raiding schedule only when working with the current raid tier
    // For initial fetch (raidId === null), we calculate for all current raids after all stats
    // For updates (raidId in CURRENT_RAID_IDS), we calculate after current raid stats
    // This ensures schedules are always updated but only for the current tier
    const isCurrentRaid = raidId !== null && CURRENT_RAID_IDS.includes(raidId);
    if (recalculateSchedule && (raidId === null || isCurrentRaid)) {
      await this.calculateRaidingSchedule(guild, PRIMARY_RAID_ID);
    }
  }

  // Calculate the guild's raiding schedule (days and hours) for the current raid tier
  private async calculateRaidingSchedule(guild: IGuild, raidId: number): Promise<void> {
    const guildLog = getGuildLogger(guild.name, guild.realm);
    guildLog.info(`Calculating raiding schedule for raid ID: ${raidId}`);

    try {
      // Get raid data to get the boss encounter IDs and date range
      const raidData = await this.getRaidData(raidId);
      if (!raidData) {
        guildLog.warn(`Raid data not found for zone ${raidId}, skipping schedule calculation`);
        return;
      }

      // Get valid boss encounter IDs for this raid
      const validBossIds = await this.getValidBossEncounterIdsForRaid(raidData.id);

      // Get the raid's date range for the guild's region
      const guildRegion = guild.region.toLowerCase();
      const raidStartDate = raidData.starts?.[guildRegion as keyof typeof raidData.starts];
      const raidEndDate = raidData.ends?.[guildRegion as keyof typeof raidData.ends];

      if (!raidStartDate && !raidEndDate) {
        guildLog.info(`No date range available for ${raidData.name}, skipping schedule calculation`);
        return;
      }

      // Get all fights for this raid's bosses only
      const fights = await Fight.find({
        guildId: guild._id as mongoose.Types.ObjectId,
        zoneId: raidData.id,
        encounterID: { $in: Array.from(validBossIds) },
      })
        .sort({ timestamp: 1 })
        .lean();

      if (fights.length === 0) {
        guildLog.info(`No fights found for ${raidData.name}, clearing stale schedule`);
        guild.raidSchedule = { days: [], lastCalculated: new Date() };
        guild.markModified("raidSchedule");
        return;
      }

      // Filter fights by date range
      let filteredFights = fights.filter((fight) => {
        const fightTimestamp = fight.timestamp;
        if (raidStartDate && fightTimestamp < raidStartDate) return false;
        if (raidEndDate && fightTimestamp > raidEndDate) return false;
        return true;
      });

      if (filteredFights.length === 0) {
        guildLog.info(`No fights in date range for ${raidData.name}, clearing stale schedule`);
        guild.raidSchedule = { days: [], lastCalculated: new Date() };
        guild.markModified("raidSchedule");
        return;
      }

      guildLog.info(`Processing ${filteredFights.length} fights for schedule calculation`);

      // Group fights by report to calculate accurate raid session times
      const reportSessions = new Map<
        string,
        {
          reportCode: string;
          reportStartTime: number;
          fights: typeof filteredFights;
        }
      >();

      for (const fight of filteredFights) {
        if (!reportSessions.has(fight.reportCode)) {
          reportSessions.set(fight.reportCode, {
            reportCode: fight.reportCode,
            reportStartTime: fight.reportStartTime,
            fights: [],
          });
        }
        reportSessions.get(fight.reportCode)!.fights.push(fight);
      }

      guildLog.info(`Found ${reportSessions.size} unique raid sessions (reports)`);

      // Helper function to convert UTC Date to Helsinki timezone components
      // Returns { hours, minutes, day } in Helsinki time
      const getHelsinkiTimeComponents = (date: Date): { hours: number; minutes: number; day: number } => {
        // Format the date in Helsinki timezone
        const helsinkiDateString = date.toLocaleString("en-US", {
          timeZone: "Europe/Helsinki",
          hour: "2-digit",
          minute: "2-digit",
          weekday: "short",
          hour12: false,
        });

        // Parse the formatted string to extract components
        // Format will be like "Thu, 19:00" or "Mon, 16:30"
        const parts = helsinkiDateString.split(" ");
        const dayName = parts[0]; // "Thu", "Mon", etc.
        const timeParts = parts[1].split(":");
        const hours = parseInt(timeParts[0], 10);
        const minutes = parseInt(timeParts[1], 10);

        // Convert day name to day number (0 = Sunday, 1 = Monday, etc.)
        const dayMap: { [key: string]: number } = {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        };
        const day = dayMap[dayName];

        return { hours, minutes, day };
      };

      // Helper function to round time to nearest half hour in Helsinki timezone
      const roundToNearestHalfHour = (date: Date): number => {
        const { hours, minutes } = getHelsinkiTimeComponents(date);

        // Convert to decimal hours (e.g., 18:45 = 18.75)
        const decimalHours = hours + minutes / 60;

        // Round to nearest 0.5
        const rounded = Math.round(decimalHours * 2) / 2;

        return rounded;
      };

      // Calculate actual start and end times for each report
      interface RaidSession {
        startTime: Date;
        endTime: Date;
        day: string;
        startHour: number;
        endHour: number;
      }

      const raidSessions: RaidSession[] = [];

      for (const [reportCode, session] of reportSessions.entries()) {
        // Find earliest fightStartTime and latest fightEndTime in this report
        let earliestFightStart = Number.MAX_SAFE_INTEGER;
        let latestFightEnd = 0;

        for (const fight of session.fights) {
          if (fight.fightStartTime < earliestFightStart) {
            earliestFightStart = fight.fightStartTime;
          }
          if (fight.fightEndTime > latestFightEnd) {
            latestFightEnd = fight.fightEndTime;
          }
        }

        // Calculate actual start and end times
        // reportStartTime is in unix milliseconds
        // fightStartTime and fightEndTime are in milliseconds relative to report start
        const actualStartTime = new Date(session.reportStartTime + earliestFightStart);
        const actualEndTime = new Date(session.reportStartTime + latestFightEnd);

        // Get day of week and round hours to nearest half hour (in Helsinki timezone)
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const { day: dayIndex } = getHelsinkiTimeComponents(actualStartTime);
        const day = dayNames[dayIndex];
        const startHour = roundToNearestHalfHour(actualStartTime);
        const endHour = roundToNearestHalfHour(actualEndTime);

        raidSessions.push({
          startTime: actualStartTime,
          endTime: actualEndTime,
          day,
          startHour,
          endHour,
        });

        // Format hours for display (e.g., 18.5 -> "18:30", 19 -> "19:00")
        const formatHour = (hour: number): string => {
          const h = Math.floor(hour);
          const m = (hour % 1) * 60;
          return `${h}:${m.toString().padStart(2, "0")}`;
        };

        guildLog.info(`Report ${reportCode}: ${day} ${formatHour(startHour)}-${formatHour(endHour)} (${actualStartTime.toISOString()} to ${actualEndTime.toISOString()})`);
      }

      // Analyze raiding patterns - find most common day/time combinations
      interface DayTimeSlot {
        day: string;
        startHour: number;
        endHour: number;
        count: number;
      }

      const dayTimeMap = new Map<string, DayTimeSlot>();

      for (const session of raidSessions) {
        // Create a key for this day/time combination
        const key = `${session.day}:${session.startHour}:${session.endHour}`;

        if (!dayTimeMap.has(key)) {
          dayTimeMap.set(key, {
            day: session.day,
            startHour: session.startHour,
            endHour: session.endHour,
            count: 0,
          });
        }

        dayTimeMap.get(key)!.count++;
      }

      // Convert to array and sort by count (most common first)
      const allDayTimeSlots = Array.from(dayTimeMap.values()).sort((a, b) => b.count - a.count);

      guildLog.info(`Found ${allDayTimeSlots.length} unique day/time patterns:`);
      allDayTimeSlots.forEach((slot) => {
        const formatHour = (hour: number): string => {
          const h = Math.floor(hour);
          const m = (hour % 1) * 60;
          return `${h}:${m.toString().padStart(2, "0")}`;
        };
        guildLog.info(`  ${slot.day} ${formatHour(slot.startHour)}-${formatHour(slot.endHour)} (${slot.count} occurrences)`);
      });

      // Filter to get only the most likely days (no duplicates)
      // Keep only the most common time slot for each unique day
      const seenDays = new Set<string>();
      const mostLikelyDays: DayTimeSlot[] = [];

      for (const slot of allDayTimeSlots) {
        if (!seenDays.has(slot.day)) {
          seenDays.add(slot.day);
          mostLikelyDays.push(slot);
        }
      }

      guildLog.info(`Most likely raiding days (${mostLikelyDays.length} unique days):`);
      mostLikelyDays.forEach((slot) => {
        const formatHour = (hour: number): string => {
          const h = Math.floor(hour);
          const m = (hour % 1) * 60;
          return `${h}:${m.toString().padStart(2, "0")}`;
        };
        guildLog.info(`  ${slot.day} ${formatHour(slot.startHour)}-${formatHour(slot.endHour)} (${slot.count} occurrences)`);
      });

      // Filter out outliers based on relative raid count
      // Days with significantly fewer raids compared to the top days should be excluded
      let filteredDays = mostLikelyDays;

      if (mostLikelyDays.length > 0) {
        const maxRaidCount = mostLikelyDays[0].count; // Highest raid count (already sorted)

        // Calculate a threshold: keep days that have at least 40% of the max raid count
        // This helps filter out one-off or infrequent raid days
        const threshold = maxRaidCount * 0.4;

        const beforeFilterCount = mostLikelyDays.length;
        filteredDays = mostLikelyDays.filter((slot) => slot.count >= threshold);

        if (filteredDays.length < beforeFilterCount) {
          guildLog.info(
            `Filtered out ${beforeFilterCount - filteredDays.length} outlier day(s) with raid count < ${threshold.toFixed(1)} (${((threshold / maxRaidCount) * 100).toFixed(
              0,
            )}% of max ${maxRaidCount})`,
          );
          guildLog.info("Final raiding days after outlier filtering:");
          filteredDays.forEach((slot) => {
            const formatHour = (hour: number): string => {
              const h = Math.floor(hour);
              const m = (hour % 1) * 60;
              return `${h}:${m.toString().padStart(2, "0")}`;
            };
            guildLog.info(`  ${slot.day} ${formatHour(slot.startHour)}-${formatHour(slot.endHour)} (${slot.count} occurrences)`);
          });
        } else {
          guildLog.info("No outliers detected - all days have similar raid counts");
        }
      }

      // Additional filter: remove days with very low absolute raid counts (< 2)
      // This helps filter out guilds with irregular schedules that don't have a consistent raiding pattern
      const beforeAbsoluteFilterCount = filteredDays.length;
      filteredDays = filteredDays.filter((slot) => slot.count >= 2);

      if (filteredDays.length < beforeAbsoluteFilterCount) {
        guildLog.info(`Filtered out ${beforeAbsoluteFilterCount - filteredDays.length} day(s) with absolute raid count < 2 (irregular schedule)`);
        if (filteredDays.length === 0) {
          guildLog.info("No consistent raiding schedule detected - guild raids irregularly");
        } else {
          guildLog.info("Final raiding days after absolute count filtering:");
          filteredDays.forEach((slot) => {
            const formatHour = (hour: number): string => {
              const h = Math.floor(hour);
              const m = (hour % 1) * 60;
              return `${h}:${m.toString().padStart(2, "0")}`;
            };
            guildLog.info(`  ${slot.day} ${formatHour(slot.startHour)}-${formatHour(slot.endHour)} (${slot.count} occurrences)`);
          });
        }
      }

      // Save the raiding schedule (only most likely days, no duplicates, no outliers)
      guild.raidSchedule = {
        days: filteredDays.map((slot) => ({
          day: slot.day,
          startHour: slot.startHour,
          endHour: slot.endHour,
          raidCount: slot.count,
        })),
        lastCalculated: new Date(),
      };

      guild.markModified("raidSchedule");

      guildLog.info(`Raiding schedule calculated: ${filteredDays.length} unique days from ${raidSessions.length} raid sessions`);
    } catch (error) {
      guildLog.error("Error calculating raiding schedule:", error);
    }
  }

  // Calculate statistics for a specific raid and difficulty from database fights
  // IMPORTANT: This method now properly filters fights by the raid's boss encounter IDs
  // to prevent unrelated bosses from being included in the statistics
  private async calculateRaidStatistics(guild: IGuild, raidData: IRaid, difficulty: "mythic" | "heroic", createEvents: boolean): Promise<void> {
    const guildLog = getGuildLogger(guild.name, guild.realm);
    const difficultyId = difficulty === "mythic" ? DIFFICULTIES.MYTHIC : DIFFICULTIES.HEROIC;

    // Get valid boss encounter IDs for this specific raid
    const validBossIds = await this.getValidBossEncounterIdsForRaid(raidData.id);
    guildLog.info(`Valid boss IDs for ${raidData.name}: ${Array.from(validBossIds).join(", ")}`);

    // Get all fights from database for this guild, raid, and difficulty
    // IMPORTANT: Also filter by encounterID to ensure we only get bosses that belong to this raid
    const fights = (await Fight.find({
      guildId: guild._id as mongoose.Types.ObjectId,
      zoneId: raidData.id,
      difficulty: difficultyId,
      encounterID: { $in: Array.from(validBossIds) }, // Only include fights for bosses in this raid
    })
      .select(STATISTICS_FIGHT_PROJECTION)
      .sort({ timestamp: 1 })
      .lean()) as StatisticsFight[]; // Sort by timestamp (oldest first) for proper kill order tracking

    if (fights.length === 0) {
      guildLog.info(`No ${difficulty} fights found for ${raidData.name}`);
      // Clear existing progress for this raid/difficulty if it exists
      const existingProgress = guild.progress.find((p) => p.raidId === raidData.id && p.difficulty === difficulty);
      if (
        existingProgress &&
        (existingProgress.bossesDefeated > 0 ||
          existingProgress.bosses.length > 0 ||
          (existingProgress.totalCombatTimeSpent ?? 0) > 0 ||
          (existingProgress.progressRaidTimeSpent ?? 0) > 0 ||
          (existingProgress.totalRaidTimeSpent ?? 0) > 0)
      ) {
        guildLog.info(
          `Clearing stale ${difficulty} progress for ${raidData.name} (had ${existingProgress.bossesDefeated} defeated, ${existingProgress.bosses.length} bosses tracked)`,
        );
        existingProgress.bosses = [];
        existingProgress.bossesDefeated = 0;
        existingProgress.totalTimeSpent = 0;
        existingProgress.totalCombatTimeSpent = 0;
        existingProgress.progressRaidTimeSpent = 0;
        existingProgress.totalRaidTimeSpent = 0;
        existingProgress.lastUpdated = new Date();
        guild.markModified("progress");
      }
      return;
    }

    guildLog.info(`Calculating ${difficulty} statistics from ${fights.length} fights for ${raidData.name}`);

    // Filter fights by raid's "current content" date range for the guild's region
    const guildRegion = guild.region.toLowerCase();
    let raidStartDate = raidData.starts?.[guildRegion as keyof typeof raidData.starts];
    let raidEndDate = raidData.ends?.[guildRegion as keyof typeof raidData.ends];

    // For older raids (pre-Legion) that don't have start/end dates in Raider.IO,
    // use very permissive dates so all fights are included
    if (!raidStartDate && !raidEndDate) {
      raidStartDate = new Date("1970-01-01T00:00:00Z"); // Very old date
      raidEndDate = new Date("2100-12-31T23:59:59Z"); // Very far future date
      guildLog.info(`No dates available for ${raidData.name} - using permissive date range (all fights included)`);
    }

    let filteredFights = fights;
    let dateFilteredCount = 0;

    if (raidStartDate || raidEndDate) {
      const beforeFilterCount = fights.length;

      filteredFights = fights.filter((fight) => {
        const fightTimestamp = fight.timestamp;

        // Check if fight is after raid start (if start date exists)
        if (raidStartDate && fightTimestamp < raidStartDate) {
          return false;
        }

        // Check if fight is before raid end (if end date exists)
        if (raidEndDate && fightTimestamp > raidEndDate) {
          return false;
        }

        return true;
      });

      dateFilteredCount = beforeFilterCount - filteredFights.length;

      if (dateFilteredCount > 0) {
        guildLog.info(
          `Filtered out ${dateFilteredCount} ${difficulty} fights outside raid's current content window (${raidStartDate?.toISOString() || "no start"} to ${
            raidEndDate?.toISOString() || "no end"
          }) for region ${guildRegion}`,
        );
      }
    }

    if (filteredFights.length === 0) {
      guildLog.info(`No ${difficulty} fights remaining after date filtering for ${raidData.name}`);
      // Clear existing progress for this raid/difficulty if it exists
      const existingProgress = guild.progress.find((p) => p.raidId === raidData.id && p.difficulty === difficulty);
      if (
        existingProgress &&
        (existingProgress.bossesDefeated > 0 ||
          existingProgress.bosses.length > 0 ||
          (existingProgress.totalCombatTimeSpent ?? 0) > 0 ||
          (existingProgress.progressRaidTimeSpent ?? 0) > 0 ||
          (existingProgress.totalRaidTimeSpent ?? 0) > 0)
      ) {
        guildLog.info(`Clearing stale ${difficulty} progress for ${raidData.name} after date filtering`);
        existingProgress.bosses = [];
        existingProgress.bossesDefeated = 0;
        existingProgress.totalTimeSpent = 0;
        existingProgress.totalCombatTimeSpent = 0;
        existingProgress.progressRaidTimeSpent = 0;
        existingProgress.totalRaidTimeSpent = 0;
        existingProgress.lastUpdated = new Date();
        guild.markModified("progress");
      }
      return;
    }

    guildLog.info(`Processing ${filteredFights.length} ${difficulty} fights (after date filtering) for ${raidData.name}`);

    // Aggregate boss data from database fights
    const bossDataMap = new Map<
      number,
      {
        encounterID: number;
        name: string;
        kills: number;
        pulls: number;
        bestPercent: number;
        totalTime: number;
        firstKillTime?: Date;
        firstKillReportCode?: string;
        firstKillFightId?: number;
        bestPullPhase?: {
          phaseId: number;
          phaseName: string;
          bossHealth: number;
          fightCompletion: number;
          displayString: string;
        };
        bestPullReportCode?: string;
        bestPullFightId?: number;
        pullHistory: Array<{
          pullNumber: number;
          fightPercentage: number;
          phase?: string;
          isKill: boolean;
          reportCode?: string;
          fightId?: number;
          url?: string;
          timestamp?: Date;
          duration?: number;
          bossPercentage?: number;
          progressDisplay?: string;
        }>;
      }
    >();

    // Track kill order - which boss was killed first, second, etc.
    const killOrderTracker: Array<{ encounterId: number; killTime: Date }> = [];
    const vodCandidateFightsByBoss = new Map<number, StatisticsFight[]>();

    // FIRST PASS: Filter out duplicate fights
    // Create a map to track seen fight characteristics
    const seenFights = new Map<string, any>();
    const uniqueFights: StatisticsFight[] = [];
    let duplicateCount = 0;

    for (const fight of filteredFights) {
      const duplicateFight = findDuplicateFight(fight, seenFights);

      if (duplicateFight) {
        duplicateCount++;
        continue;
      }

      uniqueFights.push(fight);
    }

    if (filteredFights !== fights) filteredFights.length = 0;
    fights.length = 0;

    if (duplicateCount > 0) {
      guildLog.info(`Filtered out ${duplicateCount} duplicate ${difficulty} fights for ${raidData.name}`);
    }

    guildLog.info(`Processing ${uniqueFights.length} unique ${difficulty} fights for ${raidData.name}`);

    // SECOND PASS: Identify first kill times for each boss
    const firstKillTimes = new Map<number, Date>();

    for (const fight of uniqueFights) {
      if (fight.isKill && !firstKillTimes.has(fight.encounterID)) {
        firstKillTimes.set(fight.encounterID, fight.timestamp);
      }
    }

    guildLog.info(
      `First kill times identified for ${difficulty}:`,
      Array.from(firstKillTimes.entries()).map(([id, time]) => `Boss ${id}: ${time.toISOString()}`),
    );

    // THIRD PASS: Process all unique fights and build statistics
    let totalCombatTime = 0;
    const progressionFights: StatisticsFight[] = [];
    for (let i = 0; i < uniqueFights.length; i++) {
      // Yield every 50 fights to let the event loop process HTTP requests
      if (i % 50 === 0 && i > 0) await yieldToEventLoop();

      const fight = uniqueFights[i];
      const encounterId = fight.encounterID;
      const isKill = fight.isKill;
      const bossPercent = fight.bossPercentage || 0;
      const fightPercent = fight.fightPercentage || 0;
      const duration = fight.duration / 1000; // Convert ms to seconds
      totalCombatTime += duration;

      if (!bossDataMap.has(encounterId)) {
        bossDataMap.set(encounterId, {
          encounterID: encounterId,
          name: fight.encounterName,
          kills: 0,
          pulls: 0,
          bestPercent: 100, // Start at 100 (worst), track lowest (best)
          totalTime: 0,
          firstKillTime: undefined,
          firstKillReportCode: undefined,
          firstKillFightId: undefined,
          bestPullPhase: undefined,
          bestPullReportCode: undefined,
          bestPullFightId: undefined,
          pullHistory: [],
        });
      }

      const bossData = bossDataMap.get(encounterId)!;

      // Only count pulls and time up to (and including) the first kill
      const firstKillTime = firstKillTimes.get(encounterId);
      const shouldCountPull = !firstKillTime || fight.timestamp <= firstKillTime;

      if (shouldCountPull) {
        progressionFights.push(fight);
        bossData.pulls++;
        bossData.totalTime += duration;

        // Add to pull history for progress chart
        // Convert phase name to short format (e.g., "Stage Three" -> "P3", "Intermission One" -> "I1")
        let phaseShort: string | undefined;
        if (fight.lastPhaseName) {
          const phaseName = fight.lastPhaseName.toLowerCase();

          // Helper to convert word numbers to digits
          const wordToNumber: { [key: string]: string } = {
            one: "1",
            two: "2",
            three: "3",
            four: "4",
            five: "5",
            six: "6",
            seven: "7",
            eight: "8",
            nine: "9",
            ten: "10",
          };

          // Extract number from phase name (supports both "Stage 3" and "Stage Three")
          const extractNumber = (name: string): string => {
            // First try numeric match
            const numMatch = name.match(/\b(\d+)\b/);
            if (numMatch) return numMatch[1];

            // Then try word match
            for (const [word, num] of Object.entries(wordToNumber)) {
              if (name.includes(word)) return num;
            }
            return "1"; // Default to 1 if no number found
          };

          if (phaseName.includes("intermission")) {
            phaseShort = `I${extractNumber(phaseName)}`;
          } else if (phaseName.includes("stage") || phaseName.includes("phase")) {
            phaseShort = `P${extractNumber(phaseName)}`;
          } else {
            // Fallback: try to extract any number, treat as phase
            phaseShort = `P${extractNumber(phaseName)}`;
          }
        }

        bossData.pullHistory.push({
          pullNumber: bossData.pulls,
          fightPercentage: isKill ? 0 : fightPercent,
          phase: phaseShort,
          isKill: isKill,
          reportCode: fight.reportCode,
          fightId: fight.fightId,
          url: this.getKillLogUrl(fight.reportCode, fight.fightId),
          timestamp: fight.timestamp,
          duration: Math.round(duration),
          bossPercentage: bossPercent,
          progressDisplay: fight.progressDisplay,
        });

        const vodCandidates = vodCandidateFightsByBoss.get(encounterId) || [];
        vodCandidates.push(fight);
        vodCandidates.sort((a, b) => {
          const aProgress = a.isKill ? 0 : a.fightPercentage || 0;
          const bProgress = b.isKill ? 0 : b.fightPercentage || 0;
          if (aProgress !== bProgress) return aProgress - bProgress;
          return b.timestamp.getTime() - a.timestamp.getTime();
        });
        if (vodCandidates.length > 5) vodCandidates.length = 5;
        vodCandidateFightsByBoss.set(encounterId, vodCandidates);
      }

      if (isKill) {
        bossData.kills++;
        // Track first kill time and report/fight info
        if (!bossData.firstKillTime) {
          bossData.firstKillTime = fight.timestamp;
          bossData.firstKillReportCode = fight.reportCode;
          bossData.firstKillFightId = fight.fightId;

          // Add to kill order tracker
          killOrderTracker.push({ encounterId, killTime: fight.timestamp });
        }
      } else {
        // Track best pull percentage for non-kills
        // Use fightPercentage as it's more accurate
        // Only track best percent for pulls before first kill
        if (shouldCountPull && fightPercent < bossData.bestPercent) {
          bossData.bestPercent = fightPercent;
          // Store the report code and fight ID for the best pull
          bossData.bestPullReportCode = fight.reportCode;
          bossData.bestPullFightId = fight.fightId;

          // Store best pull phase info
          if (fight.lastPhaseId && fight.lastPhaseName) {
            bossData.bestPullPhase = {
              phaseId: fight.lastPhaseId,
              phaseName: fight.lastPhaseName,
              bossHealth: bossPercent,
              fightCompletion: fightPercent,
              displayString: fight.progressDisplay || `${bossPercent.toFixed(1)}%`,
            };
          }
        }
      }
    }

    const progressRaidTimeSpent = await this.calculateRaidTimeSpentFromFightChains(guild._id as mongoose.Types.ObjectId, progressionFights);
    progressionFights.length = 0;
    const totalRaidTimeSpent = await this.calculateRaidTimeSpentFromFightChains(guild._id as mongoose.Types.ObjectId, uniqueFights);
    uniqueFights.length = 0;
    seenFights.clear();

    // Sort kill order by time and assign order numbers
    killOrderTracker.sort((a, b) => a.killTime.getTime() - b.killTime.getTime());
    const killOrderMap = new Map<number, number>();
    killOrderTracker.forEach((entry, index) => {
      killOrderMap.set(entry.encounterId, index + 1);
    });

    // If no boss data found for this difficulty, skip
    if (bossDataMap.size === 0) {
      guildLog.info(`No ${difficulty} encounters found - bossDataMap is empty`);
      return;
    }

    guildLog.info(
      `Found ${bossDataMap.size} unique bosses for ${difficulty}:`,
      Array.from(bossDataMap.keys()).map((id) => {
        const boss = bossDataMap.get(id)!;
        return `${boss.name} (${boss.kills} kills, ${boss.pulls} pulls)`;
      }),
    );

    // Update or create raid progress entry
    let raidProgress = guild.progress.find((p) => p.raidId === raidData.id && p.difficulty === difficulty);

    if (!raidProgress) {
      // Create a new progress entry
      guild.progress.push({
        raidId: raidData.id,
        raidName: raidData.name,
        difficulty,
        bossesDefeated: 0,
        totalBosses: raidData.bosses.length,
        totalTimeSpent: 0,
        totalCombatTimeSpent: 0,
        progressRaidTimeSpent: 0,
        totalRaidTimeSpent: 0,
        bosses: [],
        lastUpdated: new Date(),
      } as IRaidProgress);

      raidProgress = guild.progress[guild.progress.length - 1];
      guildLog.info(`Created new ${difficulty} progress entry for ${raidData.name}`);
    }

    // First, remove any bosses that don't belong to this raid (cleanup old invalid data)
    const initialBossCount = raidProgress.bosses.length;
    raidProgress.bosses = raidProgress.bosses.filter((b) => validBossIds.has(b.bossId));
    if (raidProgress.bosses.length < initialBossCount) {
      guildLog.info(`Removed ${initialBossCount - raidProgress.bosses.length} invalid boss(es) that don't belong to ${raidData.name} (${difficulty})`);
    }

    // Process each boss from our calculated data
    for (const [encounterId, bossInfo] of bossDataMap.entries()) {
      // Double-check this boss belongs to the raid (should always be true due to earlier filtering)
      if (!validBossIds.has(encounterId)) {
        guildLog.warn(`Skipping boss ${bossInfo.name} (ID: ${encounterId}) - not in raid ${raidData.name}'s boss list`);
        continue;
      }

      let bossProgress = raidProgress.bosses.find((b) => b.bossId === encounterId);

      const bossData: IBossProgress = {
        bossId: encounterId,
        bossName: bossInfo.name,
        kills: bossInfo.kills,
        bestPercent: bossInfo.bestPercent,
        pullCount: bossInfo.pulls,
        timeSpent: bossInfo.totalTime,
        firstKillTime: bossInfo.firstKillTime,
        firstKillReportCode: bossInfo.firstKillReportCode,
        firstKillFightId: bossInfo.firstKillFightId,
        killOrder: killOrderMap.get(encounterId),
        bestPullPhase: bossInfo.kills > 0 ? undefined : bossInfo.bestPullPhase,
        bestPullReportCode: bossInfo.kills > 0 ? undefined : bossInfo.bestPullReportCode,
        bestPullFightId: bossInfo.kills > 0 ? undefined : bossInfo.bestPullFightId,
        pullHistory: bossInfo.pullHistory,
        lastUpdated: new Date(),
      };

      if (bossProgress) {
        // Check if we should create events
        if (createEvents) {
          await this.checkAndCreateEvents(guild, raidProgress, bossProgress, bossData);
        }

        // Update existing boss progress
        Object.assign(bossProgress, bossData);
      } else {
        // New boss progress
        guildLog.info(`Adding new boss to ${difficulty} progress: ${bossData.bossName} (${bossData.kills} kills, ${bossData.pullCount} pulls)`);
        if (createEvents) {
          await this.checkAndCreateEvents(guild, raidProgress, this.createUnstartedBossProgress(bossData), bossData);
        }
        raidProgress.bosses.push(bossData);
      }
    }

    // Reset bosses that exist in progress but have no fights in the current data
    // This handles the case where reports/fights were deleted
    for (const boss of raidProgress.bosses) {
      if (validBossIds.has(boss.bossId) && !bossDataMap.has(boss.bossId)) {
        guildLog.info(`Resetting stale boss progress: ${boss.bossName} (ID: ${boss.bossId}) - no ${difficulty} fights found`);
        boss.kills = 0;
        boss.bestPercent = 100;
        boss.pullCount = 0;
        boss.timeSpent = 0;
        boss.pullHistory = [];
        boss.firstKillTime = undefined;
        boss.firstKillReportCode = undefined;
        boss.firstKillFightId = undefined;
        boss.killOrder = undefined;
        boss.bestPullPhase = undefined;
        boss.bestPullReportCode = undefined;
        boss.bestPullFightId = undefined;
        boss.lastUpdated = new Date();
      }
    }

    // Recalculate totals from only the valid bosses that belong to this raid
    let totalTime = 0;
    let defeatedCount = 0;
    for (const boss of raidProgress.bosses) {
      // Extra safety check - only count bosses that belong to this raid
      if (validBossIds.has(boss.bossId)) {
        totalTime += boss.timeSpent;
        if (boss.kills > 0) defeatedCount++;
      }
    }

    raidProgress.bossesDefeated = defeatedCount;
    raidProgress.totalBosses = raidData.bosses.length;
    raidProgress.totalTimeSpent = totalTime;
    raidProgress.totalCombatTimeSpent = totalCombatTime;
    raidProgress.progressRaidTimeSpent = progressRaidTimeSpent;
    raidProgress.totalRaidTimeSpent = totalRaidTimeSpent;
    raidProgress.lastUpdated = new Date();

    guildLog.info(`Before markModified - ${difficulty} progress has ${raidProgress.bosses.length} bosses in array`);

    // Mark the specific progress subdocument as modified
    const progressIndex = guild.progress.findIndex((p) => p.raidId === raidData.id && p.difficulty === difficulty);
    if (progressIndex !== -1) {
      guild.markModified(`progress.${progressIndex}.bosses`);
      guild.markModified(`progress.${progressIndex}.bossesDefeated`);
      guild.markModified(`progress.${progressIndex}.totalTimeSpent`);
      guild.markModified(`progress.${progressIndex}.totalCombatTimeSpent`);
      guild.markModified(`progress.${progressIndex}.progressRaidTimeSpent`);
      guild.markModified(`progress.${progressIndex}.totalRaidTimeSpent`);
    }

    // Also mark the entire progress array as modified
    guild.markModified("progress");

    guildLog.info(`Processed ${difficulty} progress: ${defeatedCount}/${raidData.bosses.length} bosses defeated, ${raidProgress.bosses.length} bosses tracked`);
    await this.enqueueBestPullVodLinks(guild, raidProgress, vodCandidateFightsByBoss);
  }

  // Look up a boss icon filename from the BossIcon cache
  // Returns the cached filename or undefined if not found
  private async getBossIconFilename(bossName: string): Promise<string | undefined> {
    try {
      const cachedIcon = await BossIcon.findOne({ bossName });
      return cachedIcon?.iconUrl || undefined;
    } catch {
      return undefined;
    }
  }

  private async enqueueBestPullVodLinks(guild: IGuild, raidProgress: IRaidProgress, vodCandidateFightsByBoss: Map<number, StatisticsFight[]>): Promise<void> {
    if (!guild.streamers || guild.streamers.length === 0 || vodCandidateFightsByBoss.size === 0) return;

    for (const [bossId, fights] of vodCandidateFightsByBoss.entries()) {
      const boss = raidProgress.bosses.find((entry) => entry.bossId === bossId);
      if (!boss || fights.length === 0) continue;

      const bestFights = [...fights]
        .sort((a, b) => {
          const aProgress = a.isKill ? 0 : a.fightPercentage || 0;
          const bProgress = b.isKill ? 0 : b.fightPercentage || 0;
          if (aProgress !== bProgress) return aProgress - bProgress;
          return b.timestamp.getTime() - a.timestamp.getTime();
        })
        .slice(0, 5);

      await fightVodService.enqueueForFights(guild, raidProgress, boss, bestFights);
    }
  }

  private getShortPhaseLabel(phaseName: string | undefined, fallbackNumber: number): string {
    if (!phaseName) return `P${fallbackNumber}`;
    const normalized = phaseName.toLowerCase();
    const numberWords: Record<string, string> = {
      one: "1",
      two: "2",
      three: "3",
      four: "4",
      five: "5",
      six: "6",
      seven: "7",
      eight: "8",
      nine: "9",
      ten: "10",
    };

    const match = normalized.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    const number = match ? numberWords[match[1]] || match[1] : String(fallbackNumber);

    if (normalized.includes("intermission")) return `I${number}`;
    return `P${number}`;
  }

  private getPhaseLinksForFight(fight: any | undefined, videoId: string, fightVodOffsetSeconds: number): Array<{ label: string; url: string; offsetSeconds: number }> {
    const phaseLinks: Array<{ label: string; url: string; offsetSeconds: number }> = [];
    const fightStartLink = {
      label: "P1",
      url: fightVodService.buildTwitchVodUrl(videoId, fightVodOffsetSeconds),
      offsetSeconds: fightVodOffsetSeconds,
    };

    if (!fight) return [fightStartLink];

    const transitions = [...(fight.phaseTransitions || [])].sort((a: any, b: any) => a.startTime - b.startTime);
    let addedTransitionLink = false;
    let intermissionCount = 0;

    transitions.forEach((transition: any) => {
      let phaseOffsetMs: number | null = null;

      if (transition.startTime >= fight.fightStartTime && transition.startTime <= fight.fightEndTime) {
        phaseOffsetMs = transition.startTime - fight.fightStartTime;
      } else if (transition.startTime >= 0 && transition.startTime <= fight.duration) {
        phaseOffsetMs = transition.startTime;
      }

      if (phaseOffsetMs === null || phaseOffsetMs < 0 || phaseOffsetMs > fight.duration + 1000) return;

      const isIntermission = String(transition.name || "")
        .toLowerCase()
        .includes("intermission");
      const fallbackNumber = isIntermission ? ++intermissionCount : Number.isFinite(transition.id) ? transition.id : phaseLinks.length + 1;
      const label = this.getShortPhaseLabel(transition.name, fallbackNumber);
      const offsetSeconds = fightVodOffsetSeconds + Math.floor(phaseOffsetMs / 1000);
      phaseLinks.push({
        label,
        url: fightVodService.buildTwitchVodUrl(videoId, offsetSeconds),
        offsetSeconds,
      });
      addedTransitionLink = true;
    });

    if (!addedTransitionLink) {
      phaseLinks.push(fightStartLink);
    }

    if (fight.isKill && fight.duration > 0) {
      const reactionOffsetSeconds = fightVodOffsetSeconds + Math.max(0, Math.floor(fight.duration / 1000) - 5);
      phaseLinks.push({
        label: "Reaction",
        url: fightVodService.buildTwitchVodUrl(videoId, reactionOffsetSeconds),
        offsetSeconds: reactionOffsetSeconds,
      });
    }

    return phaseLinks;
  }

  private createUnstartedBossProgress(boss: IBossProgress): IBossProgress {
    return {
      bossId: boss.bossId,
      bossName: boss.bossName,
      kills: 0,
      bestPercent: 100,
      pullCount: 0,
      timeSpent: 0,
      pullHistory: [],
      lastUpdated: boss.lastUpdated,
    };
  }

  private async getBestPullEventTimestamp(boss: IBossProgress): Promise<Date> {
    if (boss.bestPullReportCode && boss.bestPullFightId) {
      const bestPullFight = await Fight.findOne({ reportCode: boss.bestPullReportCode, fightId: boss.bestPullFightId }, { timestamp: 1 });
      if (bestPullFight?.timestamp) {
        return bestPullFight.timestamp;
      }
    }

    const firstPullTimestamp = boss.pullHistory?.[0]?.timestamp;
    if (firstPullTimestamp) {
      return firstPullTimestamp instanceof Date ? firstPullTimestamp : new Date(firstPullTimestamp);
    }

    return new Date();
  }

  private async checkAndCreateEvents(guild: IGuild, raidProgress: IRaidProgress, oldBoss: IBossProgress, newBoss: IBossProgress): Promise<void> {
    let eventCreated = false;

    // Look up boss icon from cache (non-blocking, returns undefined if not found)
    const bossIconUrl = await this.getBossIconFilename(newBoss.bossName);

    // Check for first kill
    if (oldBoss.kills === 0 && newBoss.kills > 0) {
      // Deduplicate: skip if a boss_kill event already exists for this guild/boss/difficulty
      const existingKillEvent = await Event.findOne({
        type: "boss_kill",
        guildId: guild._id,
        bossId: newBoss.bossId,
        difficulty: raidProgress.difficulty,
        raidId: raidProgress.raidId,
      });

      if (!existingKillEvent) {
        await Event.create({
          type: "boss_kill",
          guildId: guild._id,
          guildName: guild.name,
          guildRealm: guild.realm,
          guildCrest: guild.crest,
          raidId: raidProgress.raidId,
          raidName: raidProgress.raidName,
          bossId: newBoss.bossId,
          bossName: newBoss.bossName,
          bossIconUrl,
          difficulty: raidProgress.difficulty,
          data: {
            pullCount: newBoss.pullCount,
            timeSpent: newBoss.timeSpent,
          },
          timestamp: newBoss.firstKillTime || new Date(),
        });

        eventCreated = true;

        // Retroactively fix any best_pull events that were created in a prior cycle
        // with a timestamp at or after the kill — progress must appear before the kill
        const killTimestamp = newBoss.firstKillTime || new Date();
        const fixedPulls = await Event.updateMany(
          {
            type: "best_pull",
            guildId: guild._id,
            bossId: newBoss.bossId,
            difficulty: raidProgress.difficulty,
            raidId: raidProgress.raidId,
            timestamp: { $gte: killTimestamp },
          },
          { $set: { timestamp: new Date(killTimestamp.getTime() - 1000) } },
        );
        if (fixedPulls.modifiedCount > 0) {
          getGuildLogger(guild.name, guild.realm).info(`Fixed ${fixedPulls.modifiedCount} best_pull event(s) for ${newBoss.bossName} with timestamp after kill`);
        }

        // Update world rank after boss kill event (only for current raids)
        if (CURRENT_RAID_IDS.includes(raidProgress.raidId) && raidProgress.difficulty === "mythic") {
          getGuildLogger(guild.name, guild.realm).info("Boss kill event created, updating world rank for current raids...");
          await this.updateCurrentRaidsWorldRanking((guild._id as mongoose.Types.ObjectId).toString());
          await this.calculateGuildRankingsForRaid(raidProgress.raidId);
        }
      } else {
        getGuildLogger(guild.name, guild.realm).info(`Skipping duplicate boss_kill event for ${newBoss.bossName} (${raidProgress.difficulty})`);
      }
    }

    // Check for new best pull. The threshold is measured from the best emitted event,
    // not the last stored boss progress, so sub-5% improvements can accumulate.
    if (newBoss.kills === 0 && newBoss.pullCount > 0 && Number.isFinite(newBoss.bestPercent)) {
      const bestPullEvent = await Event.findOne({
        type: "best_pull",
        guildId: guild._id,
        bossId: newBoss.bossId,
        difficulty: raidProgress.difficulty,
        raidId: raidProgress.raidId,
        "data.bestPercent": { $exists: true },
      })
        .sort({ "data.bestPercent": 1 })
        .select("data.bestPercent");

      const bestPullEventPercent = typeof bestPullEvent?.data?.bestPercent === "number" ? bestPullEvent.data.bestPercent : undefined;
      const hasEventAtOrBelowCurrent = bestPullEventPercent !== undefined && bestPullEventPercent <= newBoss.bestPercent;
      const isFirstBestPullEvent = bestPullEventPercent === undefined;
      const improvedSinceLastEvent = bestPullEventPercent !== undefined && bestPullEventPercent - newBoss.bestPercent >= 5;

      if (!hasEventAtOrBelowCurrent && (isFirstBestPullEvent || improvedSinceLastEvent)) {
        const bestPullTimestamp = await this.getBestPullEventTimestamp(newBoss);

        await Event.create({
          type: "best_pull",
          guildId: guild._id,
          guildName: guild.name,
          guildRealm: guild.realm,
          guildCrest: guild.crest,
          raidId: raidProgress.raidId,
          raidName: raidProgress.raidName,
          bossId: newBoss.bossId,
          bossName: newBoss.bossName,
          bossIconUrl,
          difficulty: raidProgress.difficulty,
          data: {
            bestPercent: newBoss.bestPercent,
            pullCount: newBoss.pullCount,
            progressDisplay: newBoss.bestPullPhase?.displayString, // Include phase display string
          },
          timestamp: bestPullTimestamp,
        });

        eventCreated = true;

        // Update world rank after significant progress event (only for current raids)
        if (CURRENT_RAID_IDS.includes(raidProgress.raidId) && raidProgress.difficulty === "mythic") {
          getGuildLogger(guild.name, guild.realm).info("Best pull event created, updating world rank for current raids...");
          await this.updateCurrentRaidsWorldRanking((guild._id as mongoose.Types.ObjectId).toString());
          await this.calculateGuildRankingsForRaid(raidProgress.raidId);
        }
      } else if (hasEventAtOrBelowCurrent) {
        getGuildLogger(guild.name, guild.realm).info(`Skipping duplicate best_pull event for ${newBoss.bossName} (${raidProgress.difficulty}, ${newBoss.bestPercent.toFixed(1)}%)`);
      }
    }

    // Invalidate event caches if any event was created
    if (eventCreated) {
      await cacheService.invalidateEventCaches();
    }

    // Check for re-progress: boss was previously killed, re-kill took more than 5 pulls
    if (oldBoss.kills >= 1 && newBoss.kills > oldBoss.kills) {
      const guildLog = getGuildLogger(guild.name, guild.realm);
      guildLog.info(`Detected re-kill of ${newBoss.bossName} (${raidProgress.difficulty}) - checking for re-progress event`);

      try {
        const difficultyNumber = raidProgress.difficulty === "mythic" ? DIFFICULTIES.MYTHIC : DIFFICULTIES.HEROIC;

        // Find the two most recent kills to count pulls between them
        const recentKills = await Fight.find({
          guildId: guild._id,
          encounterID: newBoss.bossId,
          difficulty: difficultyNumber,
          isKill: true,
        })
          .sort({ timestamp: -1 })
          .limit(2);

        if (recentKills.length >= 2) {
          const latestKill = recentKills[0];
          const previousKill = recentKills[1];

          // Count all pulls (kills + wipes) between the two kills
          const pullsBetweenKills = await Fight.countDocuments({
            guildId: guild._id,
            encounterID: newBoss.bossId,
            difficulty: difficultyNumber,
            timestamp: { $gt: previousKill.timestamp, $lte: latestKill.timestamp },
          });

          guildLog.info(`Re-kill of ${newBoss.bossName}: ${pullsBetweenKills} pulls between previous and latest kill`);

          if (pullsBetweenKills > 5) {
            await Event.create({
              type: "reproge",
              guildId: guild._id,
              guildName: guild.name,
              guildRealm: guild.realm,
              guildCrest: guild.crest,
              raidId: raidProgress.raidId,
              raidName: raidProgress.raidName,
              bossId: newBoss.bossId,
              bossName: newBoss.bossName,
              bossIconUrl,
              difficulty: raidProgress.difficulty,
              data: {
                pullCount: pullsBetweenKills,
              },
              timestamp: latestKill.timestamp,
            });

            guildLog.info(`Created reproge event for ${newBoss.bossName} (${pullsBetweenKills} pulls to re-kill)`);
            await cacheService.invalidateEventCaches();
          }
        }
      } catch (error) {
        guildLog.error(`Error checking for reproge event on ${newBoss.bossName}:`, error);
      }
    }
  }

  // Detect regress: guild pulled a boss during a raid night but failed to improve bestPercent or kill it
  // Called when guild transitions from raiding → not raiding, comparing pre-night vs post-night progress
  async checkForRegressEvents(guild: IGuild, preRaidProgress: IRaidProgress[]): Promise<void> {
    const guildLog = getGuildLogger(guild.name, guild.realm);

    for (const raidId of CURRENT_RAID_IDS) {
      const oldRaidProgress = preRaidProgress.find((p) => p.raidId === raidId);
      if (!oldRaidProgress) continue;

      // Check both difficulties
      for (const difficulty of ["mythic", "heroic"] as const) {
        const oldDiffProgress = preRaidProgress.find((p) => p.raidId === raidId && p.difficulty === difficulty);
        const newDiffProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === difficulty);

        if (!oldDiffProgress || !newDiffProgress) continue;

        for (const newBoss of newDiffProgress.bosses) {
          const oldBoss = oldDiffProgress.bosses.find((b) => b.bossId === newBoss.bossId);
          if (!oldBoss) continue;

          // Regress conditions:
          // 1. Boss was not killed before AND still not killed
          // 2. Guild had actually pulled this boss before (pullCount > 0 before the session)
          // 3. Pull count increased during this session (they actually pulled it)
          // 4. Best percent did NOT improve (same or worse)
          const pullsThisSession = newBoss.pullCount - oldBoss.pullCount;
          const noImprovement = newBoss.bestPercent >= oldBoss.bestPercent;
          const notKilled = oldBoss.kills === 0 && newBoss.kills === 0;
          const hadPreviousPulls = oldBoss.pullCount > 0;

          if (notKilled && hadPreviousPulls && pullsThisSession > 0 && noImprovement) {
            guildLog.info(
              `Regress detected for ${newBoss.bossName} (${difficulty}): ` +
                `${pullsThisSession} pulls with no improvement (${oldBoss.bestPercent.toFixed(1)}% → ${newBoss.bestPercent.toFixed(1)}%)`,
            );

            const regressBossIconUrl = await this.getBossIconFilename(newBoss.bossName);

            await Event.create({
              type: "regress",
              guildId: guild._id,
              guildName: guild.name,
              guildRealm: guild.realm,
              guildCrest: guild.crest,
              raidId: raidId,
              raidName: newDiffProgress.raidName,
              bossId: newBoss.bossId,
              bossName: newBoss.bossName,
              bossIconUrl: regressBossIconUrl,
              difficulty: difficulty,
              data: {
                pullCount: pullsThisSession,
                bestPercent: newBoss.bestPercent,
              },
              timestamp: new Date(),
            });

            await cacheService.invalidateEventCaches();
          }
        }
      }
    }
  }

  // Detect hiatus: guild has not raided for 7, 14, or 30 days
  // Only applies to current tier guilds with heroic or mythic progress
  // Each threshold triggers at most once per guild per raid tier
  async checkForHiatusEvents(): Promise<void> {
    const HIATUS_THRESHOLDS = [
      { days: 30, label: "1 month" },
      { days: 14, label: "14 days" },
      { days: 7, label: "7 days" },
    ];

    logger.info("[Hiatus] Checking for hiatus events across all guilds...");

    const raidDataById = new Map<number, IRaid>();
    for (const raidId of CURRENT_RAID_IDS) {
      const raidData = await this.getRaidData(raidId);
      if (raidData) raidDataById.set(raidId, raidData);
    }

    if (raidDataById.size === 0) {
      logger.info("[Hiatus] No current raid data found, skipping hiatus check");
      return;
    }

    // Find guilds that have current tier progress (heroic or mythic)
    // and have a lastLogEndTime set (meaning they have raided before).
    const currentRaidProgressClauses = CURRENT_RAID_IDS.flatMap((raidId) => [
      { progress: { $elemMatch: { raidId, difficulty: "heroic", bossesDefeated: { $gt: 0 } } } },
      { progress: { $elemMatch: { raidId, difficulty: "mythic", bossesDefeated: { $gt: 0 } } } },
    ]);
    const guilds = await Guild.find({
      lastLogEndTime: { $exists: true },
      wclStatus: { $ne: "not_found" },
      $or: currentRaidProgressClauses,
    });

    logger.info(`[Hiatus] Checking ${guilds.length} guilds across current raids (${CURRENT_RAID_IDS.join(", ")})`);

    for (const guild of guilds) {
      if (!guild.lastLogEndTime) continue;

      const daysSinceLastLog = (Date.now() - guild.lastLogEndTime.getTime()) / (1000 * 60 * 60 * 24);

      // Determine highest WCL-backed progress per current raid.
      // Synthetic RaiderIO-only entries have an empty bosses array — skip those,
      // since hiatus only makes sense for guilds that actually have WarcraftLogs data.
      const eligibleProgress = CURRENT_RAID_IDS.flatMap((raidId) => {
        const mythicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "mythic" && p.bossesDefeated > 0 && p.bosses.length > 0);
        const heroicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "heroic" && p.bossesDefeated > 0 && p.bosses.length > 0);
        const progress = mythicProgress || heroicProgress;
        return progress ? [{ raidId, raidName: progress.raidName, difficulty: progress.difficulty }] : [];
      });

      if (eligibleProgress.length === 0) continue;

      const primaryProgress = eligibleProgress.find((progress) => progress.raidId === PRIMARY_RAID_ID);
      const eventProgress = primaryProgress || eligibleProgress[0];
      const raidData = raidDataById.get(eventProgress.raidId);

      // Check each threshold, highest first.
      for (const threshold of HIATUS_THRESHOLDS) {
        if (daysSinceLastLog < threshold.days) continue;

        // Hiatus is a guild-level event in the feed, so dedupe across current raids.
        const existingEvent = await Event.findOne({
          type: "hiatus",
          guildId: guild._id,
          raidId: { $in: CURRENT_RAID_IDS },
          "data.hiatusDays": threshold.days,
        });

        if (existingEvent) continue;

        const guildLog = getGuildLogger(guild.name, guild.realm);
        guildLog.info(`Creating hiatus event: ${threshold.days} days since last raid (last log: ${guild.lastLogEndTime.toISOString()})`);

        await Event.create({
          type: "hiatus",
          guildId: guild._id,
          guildName: guild.name,
          guildRealm: guild.realm,
          guildCrest: guild.crest,
          raidId: eventProgress.raidId,
          raidName: raidData?.name || eventProgress.raidName,
          difficulty: eventProgress.difficulty,
          data: {
            hiatusDays: threshold.days,
          },
          timestamp: new Date(),
        });

        await cacheService.invalidateEventCaches();
      }
    }

    logger.info("[Hiatus] Hiatus check complete");
  }

  // Check if guild has ongoing reports (currently raiding)
  // NOTE: This method is now deprecated in favor of the live log detection in performUpdate()
  // which checks if report endTime is within 30 minutes of current time
  // Keeping this for backward compatibility and manual status checks
  async updateRaidingStatus(guild: IGuild): Promise<void> {
    const currentTime = Date.now();
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;

    // Check if there are any reports with endTime within 30 minutes for this guild
    const recentReports = await Report.find({
      guildId: guild._id,
      zoneId: { $in: TRACKED_RAIDS },
    })
      .sort({ endTime: -1 })
      .limit(5);

    let hasLiveLog = false;
    for (const report of recentReports) {
      if (report.endTime && currentTime - report.endTime < THIRTY_MINUTES_MS) {
        hasLiveLog = true;
        break;
      }
    }

    const wasRaiding = guild.isCurrentlyRaiding;
    guild.isCurrentlyRaiding = hasLiveLog;

    if (wasRaiding !== guild.isCurrentlyRaiding) {
      getGuildLogger(guild.name, guild.realm).info(`Raiding status changed: ${guild.isCurrentlyRaiding ? "STARTED" : "STOPPED"} raiding`);
      // Don't save here - let the caller save to avoid overwriting changes
    }
  }

  // Helper function to calculate raid schedule summary
  private calculateScheduleSummary(raidSchedule?: any): { totalDays: number; averageHours: number } | null {
    if (!raidSchedule || !raidSchedule.days || raidSchedule.days.length === 0) {
      return null;
    }

    const totalDays = raidSchedule.days.length;
    const averageHours =
      raidSchedule.days.reduce((sum: number, day: any) => {
        return sum + (day.endHour - day.startHour);
      }, 0) / totalDays;

    return {
      totalDays,
      averageHours: Math.round(averageHours), // Round to nearest hour
    };
  }

  // Get all guilds with only their raid schedules (for calendar/timetable view)
  // Only includes guilds that have progress in the current raid tier
  async getAllGuildSchedules(): Promise<any[]> {
    const currentRaidId = PRIMARY_RAID_ID;

    const guilds = await Guild.find({
      "raidSchedule.days.0": { $exists: true },
      progress: {
        $elemMatch: {
          raidId: currentRaidId,
          bossesDefeated: { $gt: 0 },
        },
      },
    })
      .select("_id name realm region parent_guild raidSchedule")
      .lean();

    return guilds.map((guild) => ({
      _id: guild._id,
      name: guild.name,
      realm: guild.realm,
      region: guild.region,
      parent_guild: guild.parent_guild,
      raidSchedule: {
        days: guild.raidSchedule!.days.map((day: any) => ({
          day: day.day,
          startHour: day.startHour,
          endHour: day.endHour,
        })),
        lastCalculated: guild.raidSchedule!.lastCalculated,
      },
    }));
  }

  // Get guilds scheduled to raid on the given weekday, using precomputed current-tier schedules.
  async getGuildsRaidingOnDay(dayName: string): Promise<GuildRaidingTodayItem[]> {
    const currentRaidId = PRIMARY_RAID_ID;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const guilds = await Guild.find({
      "raidSchedule.days": { $elemMatch: { day: dayName } },
      lastLogEndTime: { $gte: sevenDaysAgo },
      progress: {
        $elemMatch: {
          raidId: currentRaidId,
          bossesDefeated: { $gt: 0 },
        },
      },
      excludedRaidIds: { $ne: currentRaidId },
    })
      .select("_id name realm region faction parent_guild crest raidSchedule")
      .lean();

    return guilds
      .flatMap((guild) => {
        const raidTimes = guild.raidSchedule?.days.filter((day: any) => day.day === dayName) ?? [];

        return raidTimes.map((day: any) => ({
          _id: String(guild._id),
          name: guild.name,
          realm: guild.realm,
          region: guild.region,
          faction: guild.faction,
          crest: guild.crest,
          parent_guild: guild.parent_guild,
          raidTime: {
            day: day.day,
            startHour: day.startHour,
            endHour: day.endHour,
          },
        }));
      })
      .sort((a, b) => {
        const startCompare = a.raidTime.startHour - b.raidTime.startHour;
        if (startCompare !== 0) return startCompare;

        const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        if (nameCompare !== 0) return nameCompare;

        return a.realm.localeCompare(b.realm, undefined, { sensitivity: "base" });
      });
  }

  // Get minimal guild list for directory page (only essential fields)
  async getGuildListMinimal(): Promise<any[]> {
    const guilds = await Guild.find().select("name realm region parent_guild warcraftlogsId isCurrentlyRaiding -_id").sort({ name: 1 }).lean();
    return guilds;
  }

  async getReservedHorseRaceUmaImages(): Promise<string[]> {
    const images = await Guild.distinct("horseRaceUmaImage", {
      horseRaceUmaImage: { $exists: true, $nin: [null, ""] },
    });

    return images.filter((image): image is string => typeof image === "string" && image.trim().length > 0).map((image) => image.trim());
  }

  private getLastKilledBoss(bosses: any[] = []): any | null {
    const killedBosses = bosses.filter((boss) => boss.kills > 0 && boss.firstKillReportCode && boss.firstKillFightId);
    if (killedBosses.length === 0) return null;

    return killedBosses.reduce((latest, boss) => {
      const latestTime = latest.firstKillTime ? new Date(latest.firstKillTime).getTime() : 0;
      const bossTime = boss.firstKillTime ? new Date(boss.firstKillTime).getTime() : 0;
      return bossTime > latestTime ? boss : latest;
    });
  }

  private getLastKilledBossForSummary(bosses: any[] = []): any | null {
    const killedBosses = bosses.filter((boss) => boss.kills > 0);
    if (killedBosses.length === 0) return null;

    return killedBosses.reduce((latest, boss) => {
      const latestTime = latest.firstKillTime ? new Date(latest.firstKillTime).getTime() : 0;
      const bossTime = boss.firstKillTime ? new Date(boss.firstKillTime).getTime() : 0;
      if (bossTime !== latestTime) return bossTime > latestTime ? boss : latest;

      const latestOrder = latest.killOrder ?? 0;
      const bossOrder = boss.killOrder ?? 0;
      return bossOrder > latestOrder ? boss : latest;
    });
  }

  private getTotalPullsForSummary(bosses: any[] = [], totalBosses = 0): number | null {
    if (totalBosses <= 0 || bosses.filter((boss) => boss.kills > 0).length < totalBosses) return null;

    return bosses.reduce((total, boss) => total + (boss.pullCount || 0), 0);
  }

  private hasProgressPullData(progress: any | null | undefined): boolean {
    if (!progress) return false;

    const currentBoss = progress.bosses?.find((boss: any) => boss.kills === 0);
    return Boolean(
      currentBoss?.pullCount > 0 ||
        currentBoss?.bestPercent > 0 ||
        currentBoss?.bestPullPhase ||
        (progress.totalTimeSpent ?? 0) > 0 ||
        (progress.totalCombatTimeSpent ?? 0) > 0 ||
        (progress.progressRaidTimeSpent ?? 0) > 0 ||
        (progress.totalRaidTimeSpent ?? 0) > 0,
    );
  }

  private getBestVodTargetForProgress(progress: any | null | undefined): { reportCode: string; fightId: number } | null {
    if (!progress) return null;

    const bosses = progress.bosses || [];
    const currentBoss = bosses.find((boss: any) => boss.kills === 0);

    if (currentBoss?.pullCount > 0 && currentBoss.bestPullReportCode && currentBoss.bestPullFightId) {
      return {
        reportCode: currentBoss.bestPullReportCode,
        fightId: currentBoss.bestPullFightId,
      };
    }

    const lastKilledBoss = this.getLastKilledBoss(bosses);
    if (lastKilledBoss) {
      return {
        reportCode: lastKilledBoss.firstKillReportCode,
        fightId: lastKilledBoss.firstKillFightId,
      };
    }

    if (currentBoss?.bestPullReportCode && currentBoss.bestPullFightId) {
      return {
        reportCode: currentBoss.bestPullReportCode,
        fightId: currentBoss.bestPullFightId,
      };
    }

    return null;
  }

  private getBestVodTargetForGuildProgress(progressEntries: any[] = []): { reportCode: string; fightId: number } | null {
    const mythicProgress = progressEntries.find((p: any) => p.difficulty === "mythic");
    const heroicProgress = progressEntries.find((p: any) => p.difficulty === "heroic");
    const mythicHasPullData = this.hasProgressPullData(mythicProgress);
    const heroicHasPullData = this.hasProgressPullData(heroicProgress);

    const preferredProgress = mythicHasPullData ? mythicProgress : heroicHasPullData ? heroicProgress : mythicProgress || heroicProgress;
    const fallbackProgress = preferredProgress === mythicProgress ? heroicProgress : mythicProgress;

    return this.getBestVodTargetForProgress(preferredProgress) || this.getBestVodTargetForProgress(fallbackProgress);
  }

  private getBossVodTarget(boss: any): FightVodTarget | null {
    if (boss.kills > 0 && boss.firstKillReportCode && boss.firstKillFightId) {
      return {
        reportCode: boss.firstKillReportCode,
        fightId: boss.firstKillFightId,
      };
    }

    if (boss.bestPullReportCode && boss.bestPullFightId) {
      return {
        reportCode: boss.bestPullReportCode,
        fightId: boss.bestPullFightId,
      };
    }

    return null;
  }

  private async getVodLinksByFightTarget(targets: FightVodTarget[]): Promise<Map<string, any[]>> {
    const uniqueTargets = Array.from(new Map(targets.map((target) => [`${target.reportCode}:${target.fightId}`, target])).values());
    const vodLinksByFight = new Map<string, any[]>();

    if (uniqueTargets.length === 0) {
      return vodLinksByFight;
    }

    const targetFights = await Fight.find({
      $or: uniqueTargets.map((target) => ({
        reportCode: target.reportCode,
        fightId: target.fightId,
      })),
    })
      .select("reportCode fightId duration isKill phaseTransitions fightStartTime fightEndTime")
      .lean();

    const targetFightsByKey = new Map<string, any>();
    targetFights.forEach((fight) => {
      targetFightsByKey.set(`${fight.reportCode}:${fight.fightId}`, fight);
    });

    const vodLinks = await FightVodLink.find({
      status: "resolved",
      availabilityStatus: { $ne: "unavailable" },
      $or: uniqueTargets.map((target) => ({
        reportCode: target.reportCode,
        fightId: target.fightId,
      })),
    })
      .select("reportCode fightId channelName vodUrl offsetSeconds videoId -_id")
      .sort({ channelName: 1 })
      .lean();

    vodLinks.forEach((link) => {
      if (!link.vodUrl) return;

      const key = `${link.reportCode}:${link.fightId}`;
      const linksForFight = vodLinksByFight.get(key) || [];
      const offsetSeconds = link.offsetSeconds || 0;

      linksForFight.push({
        channelName: link.channelName,
        url: link.videoId ? fightVodService.buildTwitchVodUrl(link.videoId, offsetSeconds) : link.vodUrl,
        offsetSeconds,
        videoId: link.videoId,
        phaseLinks: link.videoId ? this.getPhaseLinksForFight(targetFightsByKey.get(key), link.videoId, offsetSeconds) : [],
      });
      vodLinksByFight.set(key, linksForFight);
    });

    return vodLinksByFight;
  }

  // Get all guilds with progress filtered by raidId (minimal data for leaderboard)
  // Optimized with MongoDB aggregation pipeline for better performance
  async getAllGuildsForRaid(raidId: number): Promise<any[]> {
    const raid = await Raid.findOne({ id: raidId }).lean();
    const raidSlug = raid?.slug?.toLowerCase();
    const includeRaidSchedule = CURRENT_RAID_IDS.includes(raidId);

    const guildProjection: Record<string, unknown> = {
      _id: 1,
      name: 1,
      realm: 1,
      region: 1,
      faction: 1,
      warcraftlogsId: 1,
      crest: 1,
      horseRaceUmaImage: 1,
      parent_guild: 1,
      isCurrentlyRaiding: 1,
      lastFetched: 1,
      // Filter progress array to only include the specified raid
      progress: {
        $filter: {
          input: "$progress",
          as: "p",
          cond: { $eq: ["$$p.raidId", raidId] },
        },
      },
      // Include official progress from Raider.IO
      officialProgress: 1,
      // Include lightweight streamer data for live status and modal Twitch links
      streamers: {
        $map: {
          input: { $ifNull: ["$streamers", []] },
          as: "s",
          in: { channelName: "$$s.channelName", isLive: "$$s.isLive" },
        },
      },
    };

    if (includeRaidSchedule) {
      guildProjection.raidSchedule = 1;
    }

    // Use aggregation pipeline to filter, project, and sort at database level
    const guilds = await Guild.aggregate([
      // Stage 1: Match only guilds that have progress for this raid with at least 1 boss kill
      // Also exclude guilds that have this raid in their excludedRaidIds
      {
        $match: {
          excludedRaidIds: { $ne: raidId },
          progress: {
            $elemMatch: {
              raidId: raidId,
              bossesDefeated: { $gt: 0 },
            },
          },
        },
      },
      // Stage 2: Project only the fields we need (exclude heavy nested data like pullHistory)
      {
        $project: guildProjection,
      },
      // Stage 3: Add computed field for sorting — find the unified guildRank.
      // The ranking algorithm stores guildRank on the highest-difficulty progress entry:
      // mythic entry for guilds with mythic kills, heroic entry for heroic-only guilds.
      {
        $addFields: {
          mythicProgress: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$progress",
                  as: "p",
                  cond: { $eq: ["$$p.difficulty", "mythic"] },
                },
              },
              0,
            ],
          },
          heroicProgress: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$progress",
                  as: "p",
                  cond: { $eq: ["$$p.difficulty", "heroic"] },
                },
              },
              0,
            ],
          },
        },
      },
      // Stage 4: Extract the unified guildRank (stored on whichever difficulty entry has it)
      {
        $addFields: {
          sortRank: {
            $ifNull: ["$mythicProgress.guildRank", { $ifNull: ["$heroicProgress.guildRank", 99999] }],
          },
        },
      },
      // Stage 5: Sort by guild rank at database level
      {
        $sort: { sortRank: 1 },
      },
      // Stage 6: Remove temporary sort fields
      {
        $project: {
          mythicProgress: 0,
          heroicProgress: 0,
          sortRank: 0,
        },
      },
    ]);

    const guildRows = guilds.map((guildObj) => {
      const bestVodTarget = this.getBestVodTargetForGuildProgress(guildObj.progress);

      // Transform progress to minimal structure
      const minimalProgress = guildObj.progress.map((p: any) => {
        // Find current boss (first unkilled boss) to get best pull info
        const currentBoss = p.bosses?.find((b: any) => b.kills === 0);

        const lastKilledBoss = this.getLastKilledBossForSummary(p.bosses);

        return {
          raidId: p.raidId,
          raidName: p.raidName,
          difficulty: p.difficulty,
          bossesDefeated: p.bossesDefeated,
          totalBosses: p.totalBosses,
          totalTimeSpent: p.totalTimeSpent,
          totalCombatTimeSpent: p.totalCombatTimeSpent,
          progressRaidTimeSpent: p.progressRaidTimeSpent,
          totalRaidTimeSpent: p.totalRaidTimeSpent,
          currentBossPulls: currentBoss?.pullCount || 0,
          totalPulls: this.getTotalPullsForSummary(p.bosses, p.totalBosses),
          bestPullPercent: currentBoss?.bestPercent || 0,
          bestPullPhase: currentBoss?.bestPullPhase,
          lastKillTime: lastKilledBoss?.firstKillTime || null,
          lastKilledBossPulls: lastKilledBoss?.pullCount || 0,
          worldRank: p.worldRank,
          worldRankColor: p.worldRankColor,
          wclWorldRank: p.wclWorldRank,
          rioWorldRank: p.rioWorldRank,
          guildRank: p.guildRank,
        };
      });

      // Calculate schedule summary
      const scheduleSummary = this.calculateScheduleSummary(guildObj.raidSchedule);
      const raidSchedule =
        includeRaidSchedule && guildObj.raidSchedule?.days
          ? {
              days: guildObj.raidSchedule.days.map((day: any) => ({
                day: day.day,
                startHour: day.startHour,
                endHour: day.endHour,
              })),
              lastCalculated: guildObj.raidSchedule.lastCalculated,
            }
          : undefined;

      // Check if any streamers are live
      const isStreaming = guildObj.streamers && guildObj.streamers.length > 0 ? guildObj.streamers.some((s: any) => s.isLive) : false;
      const streamers =
        guildObj.streamers
          ?.filter((s: any) => s.channelName)
          .map((s: any) => ({
            channelName: s.channelName,
            isLive: !!s.isLive,
          })) ?? [];

      // Filter officialProgress to only include the requested raid
      const filteredOfficialProgress = raidSlug ? guildObj.officialProgress?.filter((op: any) => op.raidTierSlug?.toLowerCase() === raidSlug) || [] : [];

      // Return minimal guild structure
      return {
        _id: guildObj._id,
        name: guildObj.name,
        realm: guildObj.realm,
        region: guildObj.region,
        faction: guildObj.faction,
        warcraftlogsId: guildObj.warcraftlogsId,
        crest: guildObj.crest,
        horseRaceUmaImage: guildObj.horseRaceUmaImage,
        parent_guild: guildObj.parent_guild,
        isCurrentlyRaiding: guildObj.isCurrentlyRaiding,
        isStreaming: isStreaming,
        lastFetched: guildObj.lastFetched,
        progress: minimalProgress,
        streamers,
        officialProgress: filteredOfficialProgress,
        scheduleDisplay: scheduleSummary,
        ...(raidSchedule ? { raidSchedule } : {}),
        bestVodTarget,
      };
    });

    const raidingGuildIds = guildRows.filter((guildObj) => guildObj.isCurrentlyRaiding).map((guildObj) => guildObj._id as mongoose.Types.ObjectId);

    const vodTargetKeys = Array.from(
      new Map(
        guildRows
          .filter((guildObj) => guildObj.bestVodTarget)
          .map((guildObj) => [`${guildObj.bestVodTarget!.reportCode}:${guildObj.bestVodTarget!.fightId}`, guildObj.bestVodTarget!]),
      ).values(),
    );

    const vodLinksByFight = new Map<string, any[]>();
    if (vodTargetKeys.length > 0) {
      const targetFights = await Fight.find({
        $or: vodTargetKeys.map((target) => ({
          reportCode: target.reportCode,
          fightId: target.fightId,
        })),
      })
        .select("reportCode fightId duration isKill phaseTransitions fightStartTime fightEndTime")
        .lean();

      const targetFightsByKey = new Map<string, any>();
      targetFights.forEach((fight) => {
        targetFightsByKey.set(`${fight.reportCode}:${fight.fightId}`, fight);
      });

      const vodLinks = await FightVodLink.find({
        status: "resolved",
        $or: vodTargetKeys.map((target) => ({
          reportCode: target.reportCode,
          fightId: target.fightId,
        })),
      })
        .select("reportCode fightId channelName vodUrl offsetSeconds videoId -_id")
        .sort({ channelName: 1 })
        .lean();

      vodLinks.forEach((link) => {
        if (!link.vodUrl) return;

        const key = `${link.reportCode}:${link.fightId}`;
        const linksForFight = vodLinksByFight.get(key) || [];
        const offsetSeconds = link.offsetSeconds || 0;
        linksForFight.push({
          channelName: link.channelName,
          url: link.videoId ? fightVodService.buildTwitchVodUrl(link.videoId, offsetSeconds) : link.vodUrl,
          offsetSeconds,
          videoId: link.videoId,
          phaseLinks: link.videoId ? this.getPhaseLinksForFight(targetFightsByKey.get(key), link.videoId, offsetSeconds) : [],
        });
        vodLinksByFight.set(key, linksForFight);
      });
    }

    const latestReportsByGuildId = await this.getLatestReportLinksByGuildIds(raidingGuildIds);

    return guildRows.map(({ bestVodTarget, ...guildObj }) => {
      const latestReport = latestReportsByGuildId.get(guildObj._id.toString());

      return {
        ...guildObj,
        ...(latestReport ? { latestReport } : {}),
        bestVodLinks: bestVodTarget ? vodLinksByFight.get(`${bestVodTarget.reportCode}:${bestVodTarget.fightId}`) || [] : [],
      };
    });
  }

  // Get detailed boss progress for a specific raid (returns only progress array, not guild info)
  // Excludes pullHistory to reduce payload size
  async getGuildBossProgressForRaid(guildId: string, raidId: number): Promise<any[] | null> {
    const guild = await Guild.findById(guildId).select("progress").lean();

    if (!guild) {
      return null;
    }

    const matchingProgress = guild.progress.filter((p) => p.raidId === raidId);
    const bossVodTargets = matchingProgress.flatMap((progress) => progress.bosses.map((boss) => this.getBossVodTarget(boss)).filter((target): target is FightVodTarget => target !== null));
    const vodLinksByFight = await this.getVodLinksByFightTarget(bossVodTargets);

    // Return only the progress array for the specified raid, excluding pullHistory
    const raidProgress = matchingProgress
      .map((progress) => ({
        ...progress,
        bosses: progress.bosses.map((boss) => {
          const { pullHistory, ...bossWithoutHistory } = boss;
          const vodTarget = this.getBossVodTarget(boss);

          return {
            ...bossWithoutHistory,
            bestVodLinks: vodTarget ? vodLinksByFight.get(`${vodTarget.reportCode}:${vodTarget.fightId}`) || [] : [],
          };
        }),
      }));

    return raidProgress;
  }

  // Get detailed boss progress for a specific raid by realm and name (returns only progress array)
  // Excludes pullHistory to reduce payload size
  // For current raid tier, also includes worldRankHistory for the modal chart
  async getGuildBossProgressForRaidByRealmName(realm: string, name: string, raidId: number): Promise<{ progress: any[]; worldRankHistory?: any[] } | null> {
    const guild = await Guild.findOne({ name, realm })
      .collation(CASE_INSENSITIVE_COLLATION)
      .select("_id progress")
      .lean();

    if (!guild) {
      return null;
    }

    const matchingProgress = guild.progress.filter((p) => p.raidId === raidId);
    const bossVodTargets = matchingProgress.flatMap((progress) => progress.bosses.map((boss) => this.getBossVodTarget(boss)).filter((target): target is FightVodTarget => target !== null));
    const vodLinksByFight = await this.getVodLinksByFightTarget(bossVodTargets);

    // Return only the progress array for the specified raid, excluding pullHistory
    const raidProgress = matchingProgress
      .map((progress) => ({
        ...progress,
        bosses: progress.bosses.map((boss) => {
          const { pullHistory, ...bossWithoutHistory } = boss;
          const vodTarget = this.getBossVodTarget(boss);

          return {
            ...bossWithoutHistory,
            bestVodLinks: vodTarget ? vodLinksByFight.get(`${vodTarget.reportCode}:${vodTarget.fightId}`) || [] : [],
          };
        }),
      }));

    // Include world rank history only for current raid tier
    let worldRankHistory: any[] | undefined;
    if (CURRENT_RAID_IDS.includes(raidId)) {
      worldRankHistory = await this.getWorldRankHistory(guild._id as mongoose.Types.ObjectId, raidId);
    }

    return { progress: raidProgress, worldRankHistory };
  }

  // Get pull history for a specific boss (on-demand fetching)
  async getBossPullHistory(realm: string, name: string, raidId: number, bossId: number, difficulty: "mythic" | "heroic"): Promise<any | null> {
    const escapedName = this.escapeRegex(name);
    const escapedRealm = this.escapeRegex(realm);

    const guild = await Guild.findOne({
      name: { $regex: new RegExp(`^${escapedName}$`, "i") }, // Case-insensitive exact match
      realm: { $regex: new RegExp(`^${escapedRealm}$`, "i") }, // Case-insensitive exact match
    })
      .select("_id progress")
      .lean();

    if (!guild) {
      return null;
    }

    // Find the specific raid progress (guild is already plain object from .lean())
    const raidProgress = guild.progress.find((p: any) => p.raidId === raidId && p.difficulty === difficulty);

    if (!raidProgress) {
      return null;
    }

    // Find the specific boss
    const boss = raidProgress.bosses.find((b: any) => b.bossId === bossId);

    if (!boss) {
      return null;
    }

    const difficultyId = difficulty === "mythic" ? DIFFICULTIES.MYTHIC : DIFFICULTIES.HEROIC;
    const firstKill = await Fight.findOne({
      guildId: guild._id,
      zoneId: raidId,
      encounterID: bossId,
      difficulty: difficultyId,
      isKill: true,
    })
      .select("timestamp")
      .sort({ timestamp: 1 })
      .lean();

    const fightQuery: any = {
      guildId: guild._id,
      zoneId: raidId,
      encounterID: bossId,
      difficulty: difficultyId,
    };

    if (firstKill?.timestamp) {
      fightQuery.timestamp = { $lte: firstKill.timestamp };
    }

    let pullHistory = boss.pullHistory || [];
    const historyFights = await Fight.find(fightQuery)
      .select("reportCode fightId encounterID difficulty timestamp duration bossPercentage fightPercentage isKill lastPhaseId lastPhaseName progressDisplay")
      .sort({ timestamp: 1 })
      .lean();

    if (historyFights.length > 0) {
      const seenHistoryFights = new Map<string, any>();
      const uniqueHistoryFights: any[] = [];

      for (const fight of historyFights) {
        const duplicateFight = findDuplicateFight(fight, seenHistoryFights);
        if (duplicateFight) {
          continue;
        }
        uniqueHistoryFights.push(fight);
      }

      pullHistory = uniqueHistoryFights.map((fight, index) => ({
        pullNumber: index + 1,
        fightPercentage: fight.isKill ? 0 : fight.fightPercentage || 0,
        phase: fight.lastPhaseName ? this.getShortPhaseLabel(fight.lastPhaseName, fight.lastPhaseId || 1) : undefined,
        isKill: fight.isKill,
        reportCode: fight.reportCode,
        fightId: fight.fightId,
        url: this.getKillLogUrl(fight.reportCode, fight.fightId),
        timestamp: fight.timestamp instanceof Date ? fight.timestamp.toISOString() : new Date(fight.timestamp).toISOString(),
        duration: Math.round((fight.duration || 0) / 1000),
        bossPercentage: fight.bossPercentage || 0,
        progressDisplay: fight.progressDisplay,
      }));
    }

    // Calculate phase distribution (pullHistory already stores phases as P1, P2, I1, I2 format)
    const phaseCount = new Map<string, number>();
    pullHistory.forEach((pull: any) => {
      if (pull.phase) {
        const count = phaseCount.get(pull.phase) || 0;
        phaseCount.set(pull.phase, count + 1);
      }
    });

    // Sort by pull count (descending)
    const phaseDistribution = Array.from(phaseCount.entries())
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => b.count - a.count);

    const candidateLimit = Math.max(25, Math.min((boss.pullCount || 25) * 2, 250));
    const bestPullCandidates = await Fight.find(fightQuery)
      .select("reportCode fightId timestamp duration bossPercentage fightPercentage isKill progressDisplay phaseTransitions fightStartTime fightEndTime")
      .sort({ fightPercentage: 1, timestamp: -1 })
      .limit(candidateLimit)
      .lean();

    const seenFights = new Map<string, any>();
    const bestFightByKey = new Map<string, any>();
    const bestPulls: any[] = [];

    for (const fight of bestPullCandidates) {
      const duplicateFight = findDuplicateFight(fight, seenFights);
      if (duplicateFight) {
        continue;
      }

      bestPulls.push({
        reportCode: fight.reportCode,
        fightId: fight.fightId,
        url: this.getKillLogUrl(fight.reportCode, fight.fightId),
        timestamp: fight.timestamp instanceof Date ? fight.timestamp.toISOString() : new Date(fight.timestamp).toISOString(),
        duration: Math.round((fight.duration || 0) / 1000),
        bossPercentage: fight.bossPercentage || 0,
        fightPercentage: fight.isKill ? 0 : fight.fightPercentage || 0,
        progressDisplay: fight.progressDisplay,
        isKill: fight.isKill,
      });
      bestFightByKey.set(`${fight.reportCode}:${fight.fightId}`, fight);

      if (bestPulls.length === 5) {
        break;
      }
    }

    if (bestPulls.length > 0) {
      const vodLinks = await FightVodLink.find({
        status: "resolved",
        availabilityStatus: { $ne: "unavailable" },
        $or: bestPulls.map((pull) => ({
          reportCode: pull.reportCode,
          fightId: pull.fightId,
        })),
      })
        .select("reportCode fightId channelName vodUrl offsetSeconds videoId -_id")
        .sort({ channelName: 1 })
        .lean();

      const vodLinksByFight = new Map<string, any[]>();
      vodLinks.forEach((link) => {
        if (!link.vodUrl) return;
        const key = `${link.reportCode}:${link.fightId}`;
        const linksForFight = vodLinksByFight.get(key) || [];
        linksForFight.push({
          channelName: link.channelName,
          url: link.vodUrl,
          offsetSeconds: link.offsetSeconds || 0,
          videoId: link.videoId,
          phaseLinks: link.videoId ? this.getPhaseLinksForFight(bestFightByKey.get(key), link.videoId, link.offsetSeconds || 0) : [],
        });
        vodLinksByFight.set(key, linksForFight);
      });

      bestPulls.forEach((pull) => {
        pull.vodLinks = vodLinksByFight.get(`${pull.reportCode}:${pull.fightId}`) || [];
      });
    }

    // Return both pull history and phase distribution
    return {
      pullHistory,
      phaseDistribution,
      bestPulls,
    };
  }

  // Get single guild by ID
  async getGuildById(id: string): Promise<IGuild | null> {
    return await Guild.findById(id);
  }

  // Get single guild by realm and name
  async getGuildByRealmName(realm: string, name: string): Promise<IGuild | null> {
    return await Guild.findOne({
      name: { $regex: new RegExp(`^${this.escapeRegex(name)}$`, "i") }, // Case-insensitive exact match
      realm: { $regex: new RegExp(`^${this.escapeRegex(realm)}$`, "i") }, // Case-insensitive exact match
    });
  }

  private async getLatestReportLinksByGuildIds(guildIds: mongoose.Types.ObjectId[]): Promise<Map<string, LatestReportLink>> {
    const latestReportsByGuildId = new Map<string, LatestReportLink>();
    const uniqueGuildIds = Array.from(new Map(guildIds.map((guildId) => [guildId.toString(), guildId])).values());

    if (uniqueGuildIds.length === 0) {
      return latestReportsByGuildId;
    }

    const reports = await Report.aggregate<LatestReportLinkAggregation>([
      {
        $match: {
          guildId: { $in: uniqueGuildIds },
        },
      },
      {
        $sort: {
          guildId: 1,
          startTime: -1,
        },
      },
      {
        $group: {
          _id: "$guildId",
          code: { $first: "$code" },
          startTime: { $first: "$startTime" },
          isOngoing: { $first: "$isOngoing" },
        },
      },
    ]);

    for (const report of reports) {
      if (!report.code) continue;

      latestReportsByGuildId.set(report._id.toString(), {
        code: report.code,
        url: `https://www.warcraftlogs.com/reports/${report.code}`,
        startTime: report.startTime,
        isOngoing: report.isOngoing === true,
      });
    }

    return latestReportsByGuildId;
  }

  private async getLatestReportSummaries(guildId: mongoose.Types.ObjectId, limit = 3): Promise<LatestReportSummary[]> {
    const searchLimit = Math.max(limit * 4, limit);
    const reports = (await Report.find({ guildId }).sort({ startTime: -1 }).limit(searchLimit).lean()) as unknown as LeanReportSummaryDocument[];

    if (reports.length === 0) {
      return [];
    }

    const reportCodes = reports.map((report) => report.code);

    const fightAggregation = await Fight.aggregate<LatestReportFightAggregation>([
      {
        $match: {
          guildId,
          reportCode: { $in: reportCodes },
        },
      },
      {
        $group: {
          _id: {
            reportCode: "$reportCode",
            zoneId: "$zoneId",
            encounterID: "$encounterID",
            encounterName: "$encounterName",
            difficulty: "$difficulty",
          },
          pulls: { $sum: 1 },
          kills: { $sum: { $cond: ["$isKill", 1, 0] } },
          wipes: { $sum: { $cond: ["$isKill", 0, 1] } },
        },
      },
    ]);

    const pullsByReportZone = new Map<string, Map<number, number>>();
    for (const entry of fightAggregation) {
      const zoneId = entry._id.zoneId;
      if (!zoneId || zoneId <= 0) {
        continue;
      }

      if (!pullsByReportZone.has(entry._id.reportCode)) {
        pullsByReportZone.set(entry._id.reportCode, new Map());
      }

      const zonePulls = pullsByReportZone.get(entry._id.reportCode)!;
      zonePulls.set(zoneId, (zonePulls.get(zoneId) || 0) + entry.pulls);
    }

    const inferredRaidIdByReport = new Map<string, number>();
    for (const [reportCode, zonePulls] of pullsByReportZone.entries()) {
      const [dominantZone] =
        Array.from(zonePulls.entries()).sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return b[0] - a[0];
        })[0] || [];

      if (dominantZone) {
        inferredRaidIdByReport.set(reportCode, dominantZone);
      }
    }

    const raidIds = Array.from(
      new Set([
        ...reports.map((report) => report.zoneId).filter((zoneId): zoneId is number => typeof zoneId === "number" && zoneId > 0),
        ...Array.from(inferredRaidIdByReport.values()),
      ]),
    );

    const raids = (await Raid.find({ id: { $in: raidIds } })
      .select("id name iconUrl bosses.id bosses.name bosses.iconUrl")
      .lean()) as unknown as Array<{ id: number; name: string; iconUrl?: string; bosses?: Array<{ id: number; name: string; iconUrl?: string }> }>;

    const raidInfoById = new Map(raids.map((raid) => [raid.id, raid]));
    const bossInfoByEncounterId = new Map<number, { name: string; iconUrl?: string }>();
    for (const raid of raids) {
      for (const boss of raid.bosses || []) {
        if (!bossInfoByEncounterId.has(boss.id)) {
          bossInfoByEncounterId.set(boss.id, {
            name: boss.name,
            iconUrl: boss.iconUrl,
          });
        }
      }
    }
    const summariesByCode = new Map<string, LatestReportSummary>();
    const bossesByReport = new Map<string, Map<number, LatestReportBossSummary>>();
    const difficultiesByReport = new Map<string, Map<number, LatestReportDifficultySummary>>();
    const bossDifficultiesByReport = new Map<string, Map<number, Map<number, LatestReportDifficultySummary>>>();

    for (const report of reports) {
      const endTime = report.endTime && report.endTime > 0 ? report.endTime : undefined;
      const durationSeconds = endTime ? Math.max(0, Math.round((endTime - report.startTime) / 1000)) : undefined;
      const raidId = inferredRaidIdByReport.get(report.code) || (report.zoneId && report.zoneId > 0 ? report.zoneId : undefined);
      const raidInfo = raidId ? raidInfoById.get(raidId) : undefined;

      summariesByCode.set(report.code, {
        code: report.code,
        url: `https://www.warcraftlogs.com/reports/${report.code}`,
        raidId,
        raidName: raidInfo?.name || (raidId ? `Raid ${raidId}` : "Raid Log"),
        raidIconUrl: raidInfo?.iconUrl,
        startTime: report.startTime,
        endTime,
        durationSeconds,
        isOngoing: report.isOngoing === true,
        fightCount: 0,
        kills: 0,
        wipes: 0,
        difficulties: [],
        bosses: [],
      });
      bossesByReport.set(report.code, new Map());
      difficultiesByReport.set(report.code, new Map());
      bossDifficultiesByReport.set(report.code, new Map());
    }

    for (const entry of fightAggregation) {
      const reportCode = entry._id.reportCode;
      const summary = summariesByCode.get(reportCode);
      const bossMap = bossesByReport.get(reportCode);
      const difficultyMap = difficultiesByReport.get(reportCode);
      const bossDifficultyMap = bossDifficultiesByReport.get(reportCode);

      if (!summary || !bossMap || !difficultyMap || !bossDifficultyMap) {
        continue;
      }

      summary.fightCount += entry.pulls;
      summary.kills += entry.kills;
      summary.wipes += entry.wipes;

      const encounterID = entry._id.encounterID;
      const bossInfo = bossInfoByEncounterId.get(encounterID);
      const existingBoss = bossMap.get(encounterID);
      if (existingBoss) {
        existingBoss.pulls += entry.pulls;
        existingBoss.kills += entry.kills;
        existingBoss.wipes += entry.wipes;
      } else {
        bossMap.set(encounterID, {
          encounterID,
          name: bossInfo?.name || entry._id.encounterName || `Boss ${encounterID}`,
          iconUrl: bossInfo?.iconUrl,
          pulls: entry.pulls,
          kills: entry.kills,
          wipes: entry.wipes,
          difficulties: [],
        });
      }

      const difficultyId = entry._id.difficulty;
      if (!bossDifficultyMap.has(encounterID)) {
        bossDifficultyMap.set(encounterID, new Map());
      }

      const difficultiesForBoss = bossDifficultyMap.get(encounterID)!;
      const existingBossDifficulty = difficultiesForBoss.get(difficultyId);
      if (existingBossDifficulty) {
        existingBossDifficulty.pulls += entry.pulls;
        existingBossDifficulty.kills += entry.kills;
        existingBossDifficulty.wipes += entry.wipes;
      } else {
        difficultiesForBoss.set(difficultyId, {
          difficultyId,
          difficulty: this.getReportDifficultyLabel(difficultyId),
          pulls: entry.pulls,
          kills: entry.kills,
          wipes: entry.wipes,
        });
      }

      const existingDifficulty = difficultyMap.get(difficultyId);
      if (existingDifficulty) {
        existingDifficulty.pulls += entry.pulls;
        existingDifficulty.kills += entry.kills;
        existingDifficulty.wipes += entry.wipes;
      } else {
        difficultyMap.set(difficultyId, {
          difficultyId,
          difficulty: this.getReportDifficultyLabel(difficultyId),
          pulls: entry.pulls,
          kills: entry.kills,
          wipes: entry.wipes,
        });
      }
    }

    for (const [reportCode, summary] of summariesByCode.entries()) {
      summary.bosses = Array.from(bossesByReport.get(reportCode)?.values() ?? []).sort((a, b) => {
        if (b.pulls !== a.pulls) return b.pulls - a.pulls;
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.name.localeCompare(b.name);
      });

      for (const boss of summary.bosses) {
        boss.difficulties = Array.from(bossDifficultiesByReport.get(reportCode)?.get(boss.encounterID)?.values() ?? []).sort((a, b) => {
          const difficultySort = this.getReportDifficultySortValue(a.difficultyId) - this.getReportDifficultySortValue(b.difficultyId);
          if (difficultySort !== 0) return difficultySort;
          return b.pulls - a.pulls;
        });
      }

      summary.difficulties = Array.from(difficultiesByReport.get(reportCode)?.values() ?? []).sort((a, b) => {
        const difficultySort = this.getReportDifficultySortValue(a.difficultyId) - this.getReportDifficultySortValue(b.difficultyId);
        if (difficultySort !== 0) return difficultySort;
        return b.pulls - a.pulls;
      });
    }

    return reports
      .map((report) => summariesByCode.get(report.code))
      .filter((summary): summary is LatestReportSummary => Boolean(summary && summary.fightCount > 0))
      .slice(0, limit);
  }

  // Get guild summary with progress summaries (without boss arrays)
  async getGuildSummary(guildId: string): Promise<any | null> {
    const guild = await Guild.findById(guildId);

    if (!guild) {
      return null;
    }

    const guildObj = guild.toObject();

    // Transform progress to summary format (without boss arrays)
    const summaryProgress = guildObj.progress.map((p) => {
      // Find current boss (first unkilled boss) to get best pull info
      const currentBoss = p.bosses.find((b) => b.kills === 0);

      const lastKilledBoss = this.getLastKilledBossForSummary(p.bosses);

      return {
        raidId: p.raidId,
        raidName: p.raidName,
        difficulty: p.difficulty,
        bossesDefeated: p.bossesDefeated,
        totalBosses: p.totalBosses,
        totalTimeSpent: p.totalTimeSpent,
        totalCombatTimeSpent: p.totalCombatTimeSpent,
        progressRaidTimeSpent: p.progressRaidTimeSpent,
        totalRaidTimeSpent: p.totalRaidTimeSpent,
        currentBossPulls: currentBoss?.pullCount || 0,
        totalPulls: this.getTotalPullsForSummary(p.bosses, p.totalBosses),
        bestPullPercent: currentBoss?.bestPercent || 0,
        bestPullPhase: currentBoss?.bestPullPhase,
        lastKillTime: lastKilledBoss?.firstKillTime || null,
        lastKilledBossPulls: lastKilledBoss?.pullCount || 0,
        worldRank: p.worldRank,
        worldRankColor: p.worldRankColor,
        guildRank: p.guildRank,
      };
    });

    // Calculate schedule summary and prepare full schedule data
    const scheduleSummary = this.calculateScheduleSummary(guildObj.raidSchedule);
    const raidSchedule = guildObj.raidSchedule
      ? {
          days: guildObj.raidSchedule.days.map((day: any) => ({
            day: day.day,
            startHour: day.startHour,
            endHour: day.endHour,
          })),
          lastCalculated: guildObj.raidSchedule.lastCalculated,
        }
      : undefined;

    const latestReports = await this.getLatestReportSummaries(guildObj._id as mongoose.Types.ObjectId);

    return {
      _id: guildObj._id,
      name: guildObj.name,
      realm: guildObj.realm,
      region: guildObj.region,
      faction: guildObj.faction,
      crest: guildObj.crest,
      horseRaceUmaImage: guildObj.horseRaceUmaImage,
      parent_guild: guildObj.parent_guild,
      isCurrentlyRaiding: guildObj.isCurrentlyRaiding,
      lastFetched: guildObj.lastFetched,
      progress: summaryProgress,
      scheduleDisplay: scheduleSummary,
      raidSchedule: raidSchedule,
      latestReports,
    };
  }

  // Get guild summary by realm and name with progress summaries (without boss arrays)
  async getGuildSummaryByRealmName(realm: string, name: string): Promise<any | null> {
    const guildObj = (await Guild.findOne({ name, realm })
      .collation(CASE_INSENSITIVE_COLLATION)
      .lean()) as (IGuild & {
      _id: mongoose.Types.ObjectId;
    }) | null;

    if (!guildObj) {
      return null;
    }

    // Transform progress to summary format (without boss arrays)
    const summaryProgress = guildObj.progress.map((p) => {
      // Find current boss (first unkilled boss) to get best pull info
      const currentBoss = p.bosses.find((b) => b.kills === 0);

      const lastKilledBoss = this.getLastKilledBossForSummary(p.bosses);

      return {
        raidId: p.raidId,
        raidName: p.raidName,
        difficulty: p.difficulty,
        bossesDefeated: p.bossesDefeated,
        totalBosses: p.totalBosses,
        totalTimeSpent: p.totalTimeSpent,
        totalCombatTimeSpent: p.totalCombatTimeSpent,
        progressRaidTimeSpent: p.progressRaidTimeSpent,
        totalRaidTimeSpent: p.totalRaidTimeSpent,
        currentBossPulls: currentBoss?.pullCount || 0,
        totalPulls: this.getTotalPullsForSummary(p.bosses, p.totalBosses),
        bestPullPercent: currentBoss?.bestPercent || 0,
        bestPullPhase: currentBoss?.bestPullPhase,
        lastKillTime: lastKilledBoss?.firstKillTime || null,
        lastKilledBossPulls: lastKilledBoss?.pullCount || 0,
        worldRank: p.worldRank,
        worldRankColor: p.worldRankColor,
        guildRank: p.guildRank,
      };
    });

    // Calculate schedule summary and prepare full schedule data
    const scheduleSummary = this.calculateScheduleSummary(guildObj.raidSchedule);
    const raidSchedule = guildObj.raidSchedule
      ? {
          days: guildObj.raidSchedule.days.map((day: any) => ({
            day: day.day,
            startHour: day.startHour,
            endHour: day.endHour,
          })),
          lastCalculated: guildObj.raidSchedule.lastCalculated,
        }
      : undefined;

    // Include streamer data if available
    const streamers = guildObj.streamers
      ? guildObj.streamers.map((s: any) => ({
          channelName: s.channelName,
          isLive: s.isLive,
        }))
      : undefined;

    // Get supplemental profile summaries in parallel.
    const [tierScores, latestReports, profileHighlights] = await Promise.all([
      this.getGuildTierScores(guildObj._id.toString()),
      this.getLatestReportSummaries(guildObj._id, 3),
      guildProfileHighlightsService.getHighlightsForGuild(guildObj._id),
    ]);

    return {
      _id: guildObj._id,
      name: guildObj.name,
      realm: guildObj.realm,
      region: guildObj.region,
      faction: guildObj.faction,
      warcraftlogsId: guildObj.warcraftlogsId,
      crest: guildObj.crest,
      horseRaceUmaImage: guildObj.horseRaceUmaImage,
      parent_guild: guildObj.parent_guild,
      isCurrentlyRaiding: guildObj.isCurrentlyRaiding,
      lastFetched: guildObj.lastFetched,
      progress: summaryProgress,
      officialProgress: guildObj.officialProgress || [],
      scheduleDisplay: scheduleSummary,
      raidSchedule: raidSchedule,
      streamers: streamers,
      tierScores: tierScores,
      latestReports,
      profileHighlights,
    };
  }

  // Get full guild profile with all raid progress including boss details
  async getGuildFullProfile(guildId: string): Promise<any | null> {
    const guild = await Guild.findById(guildId);

    if (!guild) {
      return null;
    }

    const guildObj = guild.toObject();

    // Return full guild with all progress data
    return {
      _id: guildObj._id,
      name: guildObj.name,
      realm: guildObj.realm,
      region: guildObj.region,
      faction: guildObj.faction,
      warcraftlogsId: guildObj.warcraftlogsId,
      horseRaceUmaImage: guildObj.horseRaceUmaImage,
      isCurrentlyRaiding: guildObj.isCurrentlyRaiding,
      lastFetched: guildObj.lastFetched,
      progress: guildObj.progress, // Full progress with boss arrays
    };
  }

  // Get guilds that need updating (haven't been updated in a while)
  async getGuildsNeedingUpdate(maxAge: number = 5 * 60 * 1000): Promise<IGuild[]> {
    const cutoff = new Date(Date.now() - maxAge);
    return await Guild.find({
      $or: [{ lastFetched: { $exists: false } }, { lastFetched: null }, { lastFetched: { $lt: cutoff } }],
    });
  }

  // Get guilds that are currently raiding (for frequent polling)
  async getGuildsCurrentlyRaiding(): Promise<IGuild[]> {
    return await Guild.find({ isCurrentlyRaiding: true });
  }

  // Generate WarcraftLogs URL for a specific kill
  getKillLogUrl(reportCode: string, fightId: number): string {
    return `https://www.warcraftlogs.com/reports/${reportCode}#fight=${fightId}`;
  }

  // Update guild crests for all guilds from Blizzard API
  async updateAllGuildCrests(): Promise<void> {
    logger.info("[Guild Crests] Starting guild crest update for all guilds...");

    try {
      // Get all guilds from database
      const guilds = await Guild.find();

      if (guilds.length === 0) {
        logger.info("[Guild Crests] No guilds found in database");
        return;
      }

      logger.info(`[Guild Crests] Found ${guilds.length} guild(s) to update`);

      let successCount = 0;
      let failureCount = 0;

      // Update each guild's crest
      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];

        // Use parent_guild name if it exists, as that's the actual guild in Blizzard's system
        const blizzardGuildName = guild.parent_guild || guild.name;
        logger.info(
          `[Guild Crests] [${i + 1}/${guilds.length}] Fetching crest for: ${blizzardGuildName} - ${guild.realm}${guild.parent_guild ? ` (parent guild for ${guild.name})` : ""}`,
        );

        try {
          const guildData = await blizzardService.getGuildData(blizzardGuildName, guild.realm.toLowerCase(), guild.region);

          if (guildData) {
            // Update the guild's crest and faction in database
            guild.crest = guildData.crest;
            guild.markModified("crest");
            if (guildData.faction) {
              guild.faction = guildData.faction;
            }
            await guild.save();

            successCount++;
            logger.info(`[Guild Crests] ✅ Updated crest for: ${blizzardGuildName}`);
          } else {
            failureCount++;
            logger.warn(`[Guild Crests] ⚠️  Could not fetch crest data for: ${blizzardGuildName}`);
          }
        } catch (error) {
          failureCount++;
          logger.error(`[Guild Crests] ❌ Error fetching crest for ${blizzardGuildName}:`, error instanceof Error ? error.message : "Unknown error");
        }

        // Sleep for 1 second between requests to avoid rate limiting
        if (i < guilds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logger.info(`[Guild Crests] Update complete: ${successCount} successful, ${failureCount} failed`);
    } catch (error) {
      logger.error("[Guild Crests] Error during guild crest update:", error);
      throw error;
    }
  }

  // Get all live streamers with their guild info
  async getLiveStreamers(): Promise<any[]> {
    try {
      const guilds = await Guild.find({
        streamers: { $exists: true, $ne: [] },
      })
        .select("name realm region progress streamers isCurrentlyRaiding")
        .lean();

      const liveStreamers: any[] = [];

      for (const guild of guilds) {
        if (!guild.streamers || guild.streamers.length === 0) continue;

        // Filter only live streamers
        const liveStreamsForGuild = guild.streamers.filter((s) => s.isLive);

        if (liveStreamsForGuild.length > 0) {
          // Get current raid mythic progress for this guild
          const currentRaidId = PRIMARY_RAID_ID;
          const mythicProgress = guild.progress.find((p) => p.raidId === currentRaidId && p.difficulty === "mythic");

          // Find current boss (first unkilled boss) to get best pull info
          let bestPull = null;
          if (mythicProgress) {
            const currentBoss = mythicProgress.bosses.find((b) => b.kills === 0);
            if (currentBoss && currentBoss.pullCount > 0) {
              bestPull = {
                bossName: currentBoss.bossName,
                pullCount: currentBoss.pullCount,
                bestPercent: currentBoss.bestPercent,
                bestPullPhase: currentBoss.bestPullPhase,
              };
            }
          }

          liveStreamsForGuild.forEach((streamer) => {
            liveStreamers.push({
              channelName: streamer.channelName,
              isLive: streamer.isLive,
              isPlayingWoW: streamer.isPlayingWoW,
              gameName: streamer.gameName,
              guild: {
                name: guild.name,
                realm: guild.realm,
                region: guild.region,
                parent_guild: guild.parent_guild,
                isCurrentlyRaiding: guild.isCurrentlyRaiding ?? false,
              },
              bestPull: bestPull,
            });
          });
        }
      }

      return liveStreamers;
    } catch (error) {
      logger.error("Error fetching live streamers:", error);
      return [];
    }
  }

  // Get tier list scores for a specific guild (overall + current raids)
  async getGuildTierScores(guildId: string): Promise<{
    overall: {
      overallScore: number;
      speedScore: number;
      efficiencyScore: number;
    } | null;
    raids: {
      raidId: number;
      raidName: string;
      overallScore: number;
      speedScore: number;
      efficiencyScore: number;
    }[];
  } | null> {
    try {
      const tierList = await TierList.findOne().sort({ calculatedAt: -1 });
      if (!tierList) return null;

      // Find this guild's overall scores
      const overallEntry = tierList.overall.find((g) => g.guildId.toString() === guildId);
      const overall = overallEntry
        ? {
            overallScore: overallEntry.overallScore,
            speedScore: overallEntry.speedScore,
            efficiencyScore: overallEntry.efficiencyScore,
          }
        : null;

      // Find this guild's scores for current raids only
      const raidScores: {
        raidId: number;
        raidName: string;
        overallScore: number;
        speedScore: number;
        efficiencyScore: number;
      }[] = [];

      for (const raidId of CURRENT_RAID_IDS) {
        const raidTierList = tierList.raids.find((r) => r.raidId === raidId);
        if (raidTierList) {
          const guildEntry = raidTierList.guilds.find((g) => g.guildId.toString() === guildId);
          if (guildEntry) {
            raidScores.push({
              raidId: raidTierList.raidId,
              raidName: raidTierList.raidName,
              overallScore: guildEntry.overallScore,
              speedScore: guildEntry.speedScore,
              efficiencyScore: guildEntry.efficiencyScore,
            });
          }
        }
      }

      return { overall, raids: raidScores };
    } catch (error) {
      logger.error("Error fetching guild tier scores:", error);
      return null;
    }
  }

  /**
   * Queue all guilds for death events rescan via the background processing queue.
   * Each guild will be processed one-by-one, respecting rate limits and showing progress.
   */
  async queueAllGuildsForDeathRescan(priority = 15, targetRaidIds?: number[]): Promise<{
    queued: number;
    skipped: number;
  }> {
    logger.info("[RescanDeaths] Queueing all guilds for death events rescan");
    await this.ensureDeathBackfillIndexes();

    const deathStatusFilters: any[] = [
      { deathEventsFetchStatus: "pending" },
      { deathEventsFetchStatus: { $exists: false } },
      { deathEventsFetchStatus: "failed" },
    ];
    const combatantInfoStatusFilters: any[] = [
      { difficulty: 5, combatantInfoFetchStatus: "pending" },
      { difficulty: 5, combatantInfoFetchStatus: { $exists: false } },
      { difficulty: 5, combatantInfoFetchStatus: "failed" },
    ];

    const pendingGuildIds = await Fight.distinct("guildId", {
      reportEndTime: { $gt: 0 },
      ...(targetRaidIds?.length ? { zoneId: { $in: targetRaidIds } } : {}),
      $or: [...deathStatusFilters, ...combatantInfoStatusFilters],
    });
    const guilds = await Guild.find({ _id: { $in: pendingGuildIds }, initialFetchCompleted: true });
    let queued = 0;
    let skipped = 0;

    for (const guild of guilds) {
      try {
        await backgroundGuildProcessor.queueGuild(guild, priority, "rescan_deaths", undefined, { targetRaidIds });
        queued++;
      } catch {
        skipped++;
      }
    }

    logger.info(`[RescanDeaths] Queued ${queued} guilds, skipped ${skipped}, pending guilds ${pendingGuildIds.length}`);
    return { queued, skipped };
  }

  /**
   * Queue all guilds for character rescan via the background processing queue.
   * Each guild will be processed one-by-one, respecting rate limits and showing progress.
   */
  async queueAllGuildsForCharacterRescan(): Promise<{
    queued: number;
    skipped: number;
  }> {
    logger.info("[RescanCharacters] Queueing all guilds for character rescan");

    const guilds = await Guild.find({ initialFetchCompleted: true });
    let queued = 0;
    let skipped = 0;

    for (const guild of guilds) {
      try {
        await backgroundGuildProcessor.queueGuild(guild, 15, "rescan_characters");
        queued++;
      } catch {
        skipped++;
      }
    }

    logger.info(`[RescanCharacters] Queued ${queued} guilds, skipped ${skipped}`);
    return { queued, skipped };
  }

  /**
   * Queue all guilds for report-level character backfill via the background processing queue.
   * This fetches rankedCharacters once per stored report and skips reports already marked fetched.
   */
  async queueAllGuildsForReportCharacterBackfill(): Promise<{
    queued: number;
    skipped: number;
  }> {
    logger.info("[ReportCharacterBackfill] Queueing all guilds for report character backfill");

    const guilds = await Guild.find({ initialFetchCompleted: true });
    let queued = 0;
    let skipped = 0;

    for (const guild of guilds) {
      try {
        await backgroundGuildProcessor.queueGuild(guild, 20, "backfill_report_characters");
        queued++;
      } catch {
        skipped++;
      }
    }

    logger.info(`[ReportCharacterBackfill] Queued ${queued} guilds, skipped ${skipped}`);
    return { queued, skipped };
  }
}

export default new GuildService();
