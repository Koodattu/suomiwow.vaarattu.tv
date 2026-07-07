import Guild from "../models/Guild";
import Raid from "../models/Raid";
import RaidAnalytics, { IRaidAnalytics, IBossAnalytics, IRaidOverallAnalytics, IGuildEntry, IDistribution, IWeeklyProgressionEntry } from "../models/RaidAnalytics";
import { TRACKED_RAIDS } from "../config/guilds";
import logger from "../utils/logger";
import { compareRaidIdsByPriority } from "../utils/raidPriority";

interface GuildBossData {
  guildName: string;
  guildRealm: string;
  pullCount: number;
  timeSpent: number;
  kills: number;
  firstKillTime?: Date;
}

interface GuildRaidData {
  guildName: string;
  guildRealm: string;
  totalPulls: number;
  totalTimeSpent: number;
  progressRaidTimeSpent: number;
  bossesKilled: number;
  totalBosses: number;
  lastBossKillTime?: Date;
}

type DistributionValueKey = "pullCount" | "timeSpent" | "progressRaidTimeSpent";

/** Internal type for distribution calculation that includes values */
interface IGuildEntryWithValues {
  name: string;
  realm: string;
  pullCount: number;
  timeSpent: number;
  progressRaidTimeSpent?: number;
}

export interface RaidBossProgressionMilestone {
  key: string;
  type: "boss" | "clear";
  bossIndex?: number;
  bossId?: number;
  bossName: string;
  isFinalBoss?: boolean;
  guildsKilled: number;
  weeklyProgression: IWeeklyProgressionEntry[];
}

export interface RaidBossProgressionComparisonRaid {
  raidId: number;
  raidName: string;
  raidStart?: Date;
  raidEnd?: Date;
  totalBosses: number;
  lastCalculated: Date;
  milestones: RaidBossProgressionMilestone[];
}

export interface RaidBossProgressionComparison {
  generatedAt: Date;
  raids: RaidBossProgressionComparisonRaid[];
}

/**
 * Format seconds to hours and minutes for display labels
 */
function formatTime(seconds: number): string {
  if (seconds === 0) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function isTimeDistribution(valueKey: DistributionValueKey): boolean {
  return valueKey === "timeSpent" || valueKey === "progressRaidTimeSpent";
}

function getNiceNumberStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 1) return 1;

  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;

  return Math.max(1, Math.ceil(multiplier * magnitude));
}

function getNiceTimeStep(rawStep: number): number {
  const niceTimeSteps = [
    5 * 60,
    10 * 60,
    15 * 60,
    30 * 60,
    60 * 60,
    2 * 60 * 60,
    3 * 60 * 60,
    4 * 60 * 60,
    6 * 60 * 60,
    8 * 60 * 60,
    12 * 60 * 60,
    24 * 60 * 60,
    48 * 60 * 60,
    72 * 60 * 60,
    7 * 24 * 60 * 60,
    14 * 24 * 60 * 60,
  ];

  return niceTimeSteps.find((step) => step >= rawStep) ?? getNiceNumberStep(rawStep);
}

function getDistributionStep(rawStep: number, valueKey: DistributionValueKey): number {
  return isTimeDistribution(valueKey) ? getNiceTimeStep(rawStep) : getNiceNumberStep(rawStep);
}

function formatDistributionValue(value: number, valueKey: DistributionValueKey): string {
  return isTimeDistribution(valueKey) ? formatTime(Math.floor(value)) : `${Math.floor(value)}`;
}

function formatDistributionLabel(start: number, endExclusive: number, valueKey: DistributionValueKey): string {
  if (valueKey === "pullCount") {
    const labelStart = Math.max(0, Math.ceil(start));
    const labelEnd = Math.max(labelStart, Math.ceil(endExclusive) - 1);
    return labelStart === labelEnd ? `${labelStart}` : `${labelStart}-${labelEnd}`;
  }

  const labelStart = Math.max(0, Math.floor(start));
  const labelEnd = Math.max(labelStart, Math.ceil(endExclusive));
  return labelStart === labelEnd ? formatTime(labelStart) : `${formatTime(labelStart)}-${formatTime(labelEnd)}`;
}

class RaidAnalyticsService {
  /**
   * Calculate analytics for a specific raid
   */
  async calculateRaidAnalytics(raidId: number): Promise<IRaidAnalytics | null> {
    try {
      const raid = await Raid.findOne({ id: raidId });
      if (!raid) {
        logger.warn(`[RaidAnalytics] Raid ${raidId} not found`);
        return null;
      }

      const totalBosses = raid.bosses.length;
      logger.info(`[RaidAnalytics] Calculating analytics for ${raid.name} (${totalBosses} bosses)`);

      const guilds = await Guild.find({
        "progress.raidId": raidId,
        "progress.difficulty": "mythic",
      }).select("name realm progress");

      if (guilds.length === 0) {
        logger.info(`[RaidAnalytics] No guilds with progress for raid ${raidId}`);
        return null;
      }

      const bossDataMap = new Map<number, GuildBossData[]>();
      raid.bosses.forEach((boss) => {
        bossDataMap.set(boss.id, []);
      });

      const guildRaidDataList: GuildRaidData[] = [];

      for (const guild of guilds) {
        const mythicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "mythic");
        if (!mythicProgress) continue;

        let totalPulls = 0;
        let totalTimeSpent = 0;
        let bossesKilled = 0;
        let lastBossKillTime: Date | undefined;

        for (const boss of mythicProgress.bosses) {
          const bossDataList = bossDataMap.get(boss.bossId);
          if (bossDataList) {
            bossDataList.push({
              guildName: guild.name,
              guildRealm: guild.realm,
              pullCount: boss.pullCount,
              timeSpent: boss.timeSpent,
              kills: boss.kills,
              firstKillTime: boss.firstKillTime,
            });
          }

          totalPulls += boss.pullCount;
          totalTimeSpent += boss.timeSpent;

          if (boss.kills > 0) {
            bossesKilled++;
            if (boss.firstKillTime) {
              const killTime = new Date(boss.firstKillTime);
              if (!lastBossKillTime || killTime > lastBossKillTime) {
                lastBossKillTime = killTime;
              }
            }
          }
        }

        if (totalPulls > 0) {
          const progressRaidTimeSpent = Math.max(mythicProgress.progressRaidTimeSpent ?? 0, totalTimeSpent);

          guildRaidDataList.push({
            guildName: guild.name,
            guildRealm: guild.realm,
            totalPulls,
            totalTimeSpent,
            progressRaidTimeSpent,
            bossesKilled,
            totalBosses,
            lastBossKillTime: bossesKilled === totalBosses ? lastBossKillTime : undefined,
          });
        }
      }

      const raidStart = raid.starts?.eu ? new Date(raid.starts.eu) : undefined;
      const raidEnd = raid.ends?.eu ? new Date(raid.ends.eu) : undefined;

      // Calculate boss analytics
      const bossAnalytics: IBossAnalytics[] = [];

      for (const boss of raid.bosses) {
        const bossDataList = bossDataMap.get(boss.id) || [];
        const pulledGuilds = bossDataList.filter((g) => g.pullCount > 0);
        const killedGuilds = pulledGuilds.filter((g) => g.kills > 0);

        // Calculate pull count stats
        let pullStats = {
          average: 0,
          lowest: 0,
          highest: 0,
        } as IBossAnalytics["pullCount"];

        if (killedGuilds.length > 0) {
          const counts = killedGuilds.map((g) => g.pullCount);

          pullStats = {
            average: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length),
            lowest: Math.min(...counts),
            highest: Math.max(...counts),
          };
        }

        // Calculate time spent stats
        let timeStats = {
          average: 0,
          lowest: 0,
          highest: 0,
        } as IBossAnalytics["timeSpent"];

        if (killedGuilds.length > 0) {
          const times = killedGuilds.map((g) => g.timeSpent);

          timeStats = {
            average: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
            lowest: Math.min(...times),
            highest: Math.max(...times),
          };
        }

        // Create internal guild entries with values for distribution calculation
        const guildEntriesWithValues = killedGuilds.map((g) => ({
          name: g.guildName,
          realm: g.guildRealm,
          pullCount: g.pullCount,
          timeSpent: g.timeSpent,
        }));

        // Calculate pre-bucketed distributions
        const pullDistribution = this.calculateDistribution(guildEntriesWithValues, "pullCount");
        const timeDistribution = this.calculateDistribution(guildEntriesWithValues, "timeSpent");

        // Calculate weekly progression from kill dates
        const killDates = killedGuilds.filter((g) => g.firstKillTime).map((g) => new Date(g.firstKillTime!));
        const weeklyProgression = this.calculateWeeklyProgression(killDates, raidStart, raidEnd);

        bossAnalytics.push({
          bossId: boss.id,
          bossName: boss.name,
          guildsKilled: killedGuilds.length,
          guildsProgressing: pulledGuilds.length - killedGuilds.length,
          pullCount: pullStats,
          timeSpent: timeStats,
          pullDistribution,
          timeDistribution,
          weeklyProgression,
        });
      }

      // Calculate overall raid analytics
      const overallAnalytics = this.calculateOverallAnalytics(guildRaidDataList, totalBosses, raidStart, raidEnd);

      const analytics = await RaidAnalytics.findOneAndUpdate(
        { raidId },
        {
          raidId,
          raidName: raid.name,
          difficulty: "mythic",
          overall: overallAnalytics,
          bosses: bossAnalytics,
          raidStart,
          raidEnd,
          lastCalculated: new Date(),
        },
        { upsert: true, new: true },
      );

      logger.info(`[RaidAnalytics] Completed analytics for ${raid.name}: ${overallAnalytics.guildsCleared} cleared, ${overallAnalytics.guildsProgressing} progressing`);

      return analytics;
    } catch (error) {
      logger.error(`[RaidAnalytics] Error calculating analytics for raid ${raidId}:`, error);
      return null;
    }
  }

  /**
   * Calculate rounded value-range distribution buckets.
   * Bucket widths represent metric ranges; counts show how many guilds fall into each range.
   */
  private calculateDistribution(guilds: IGuildEntryWithValues[], valueKey: DistributionValueKey): IDistribution {
    if (guilds.length === 0) {
      return { buckets: [] };
    }

    const guildsWithValues = guilds
      .map((guild) => ({ guild, value: guild[valueKey] }))
      .filter((entry): entry is { guild: IGuildEntryWithValues; value: number } => typeof entry.value === "number" && Number.isFinite(entry.value) && entry.value >= 0)
      .sort((a, b) => a.value - b.value);

    if (guildsWithValues.length === 0) {
      return { buckets: [] };
    }

    const values = guildsWithValues.map((entry) => entry.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;

    const numGuilds = guildsWithValues.length;
    const targetBuckets = numGuilds < 5 ? numGuilds : 5;

    const stripGuilds = (guildList: { guild: IGuildEntryWithValues; value: number }[]): IGuildEntry[] =>
      guildList.map(({ guild, value }) => ({ name: guild.name, realm: guild.realm, value: Math.round(value) }));

    // Single bucket case: all guilds have the same value or only one guild has data.
    if (range === 0 || targetBuckets === 1) {
      const label = formatDistributionValue(minValue, valueKey);

      return {
        buckets: [
          {
            label,
            count: guildsWithValues.length,
            guilds: stripGuilds(guildsWithValues),
          },
        ],
      };
    }

    let step = getDistributionStep(range / targetBuckets, valueKey);
    let bucketStart = Math.max(0, Math.floor(minValue / step) * step);
    let bucketCount = Math.max(1, Math.ceil((maxValue - bucketStart + 1) / step));

    for (let guard = 0; bucketCount > targetBuckets + 1 && guard < 8; guard++) {
      const nextStep = getDistributionStep(step * 1.01, valueKey);
      if (nextStep <= step) break;

      step = nextStep;
      bucketStart = Math.max(0, Math.floor(minValue / step) * step);
      bucketCount = Math.max(1, Math.ceil((maxValue - bucketStart + 1) / step));
    }

    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const min = bucketStart + index * step;
      const maxExclusive = min + step;

      return {
        min,
        maxExclusive,
        guilds: [] as { guild: IGuildEntryWithValues; value: number }[],
      };
    });

    for (const entry of guildsWithValues) {
      const bucketIndex = Math.max(0, Math.min(bucketCount - 1, Math.floor((entry.value - bucketStart) / step)));
      buckets[bucketIndex].guilds.push(entry);
    }

    const resultBuckets = buckets.map((bucket) => ({
      label: formatDistributionLabel(bucket.min, bucket.maxExclusive, valueKey),
      count: bucket.guilds.length,
      guilds: stripGuilds(bucket.guilds),
    }));

    return { buckets: resultBuckets };
  }

  /**
   * Calculate weekly progression from dates
   * Converts daily data to weekly buckets
   */
  private calculateWeeklyProgression(dates: Date[], raidStart?: Date, raidEnd?: Date): IWeeklyProgressionEntry[] {
    if (!raidStart) {
      return [];
    }

    const startDate = raidStart;
    const endDate = raidEnd || new Date();
    const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
    const totalWeeks = Math.ceil((endDate.getTime() - startDate.getTime()) / millisecondsPerWeek);

    // Sort dates
    const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());

    // Build cumulative count per day first
    const cumulativeByDate = new Map<string, number>();
    let cumulativeCount = 0;

    for (const date of sortedDates) {
      cumulativeCount++;
      const dateStr = date.toISOString().split("T")[0];
      cumulativeByDate.set(dateStr, cumulativeCount);
    }

    const weeklyData: IWeeklyProgressionEntry[] = [];

    for (let week = 1; week <= totalWeeks; week++) {
      const weekStart = new Date(startDate.getTime() + (week - 1) * millisecondsPerWeek);
      const weekEnd = new Date(Math.min(weekStart.getTime() + millisecondsPerWeek, endDate.getTime()));

      // Find max cumulative value within this week
      let weekValue = 0;
      cumulativeByDate.forEach((count, dateStr) => {
        const entryDate = new Date(dateStr);
        if (entryDate >= weekStart && entryDate < weekEnd) {
          weekValue = Math.max(weekValue, count);
        }
      });

      // Carry forward from previous week if no new kills
      if (weekValue === 0 && week > 1) {
        weekValue = weeklyData[week - 2].value;
      }

      weeklyData.push({
        weekNumber: week,
        value: weekValue,
        label: `W${week}`,
      });
    }

    return weeklyData;
  }

  /**
   * Calculate overall raid analytics
   */
  private calculateOverallAnalytics(guildRaidDataList: GuildRaidData[], totalBosses: number, raidStart?: Date, raidEnd?: Date): IRaidOverallAnalytics {
    const clearedGuilds = guildRaidDataList.filter((g) => g.bossesKilled === totalBosses);
    const progressingGuilds = guildRaidDataList.filter((g) => g.bossesKilled > 0 && g.bossesKilled < totalBosses);

    // Pull count stats
    let pullStats = {
      average: 0,
      lowest: 0,
      highest: 0,
    } as IRaidOverallAnalytics["pullCount"];

    if (clearedGuilds.length > 0) {
      const counts = clearedGuilds.map((g) => g.totalPulls);

      pullStats = {
        average: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length),
        lowest: Math.min(...counts),
        highest: Math.max(...counts),
      };
    }

    // Time spent stats
    let timeStats = {
      average: 0,
      lowest: 0,
      highest: 0,
    } as IRaidOverallAnalytics["timeSpent"];

    if (clearedGuilds.length > 0) {
      const times = clearedGuilds.map((g) => g.totalTimeSpent);

      timeStats = {
        average: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        lowest: Math.min(...times),
        highest: Math.max(...times),
      };
    }

    // Progress raid time stats include breaks between valid progression pulls.
    let progressRaidTimeStats = {
      average: 0,
      lowest: 0,
      highest: 0,
    } as IRaidOverallAnalytics["progressRaidTimeSpent"];

    if (clearedGuilds.length > 0) {
      const times = clearedGuilds.map((g) => g.progressRaidTimeSpent);

      progressRaidTimeStats = {
        average: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        lowest: Math.min(...times),
        highest: Math.max(...times),
      };
    }

    // Create internal guild entries with values for distribution calculation
    const guildEntriesWithValues: IGuildEntryWithValues[] = clearedGuilds.map((g) => ({
      name: g.guildName,
      realm: g.guildRealm,
      pullCount: g.totalPulls,
      timeSpent: g.totalTimeSpent,
      progressRaidTimeSpent: g.progressRaidTimeSpent,
    }));

    // Calculate distributions
    const pullDistribution = this.calculateDistribution(guildEntriesWithValues, "pullCount");
    const timeDistribution = this.calculateDistribution(guildEntriesWithValues, "timeSpent");
    const progressRaidTimeDistribution = this.calculateDistribution(guildEntriesWithValues, "progressRaidTimeSpent");

    // Calculate weekly clear progression
    const clearDates = clearedGuilds.filter((g) => g.lastBossKillTime).map((g) => g.lastBossKillTime!);
    const weeklyProgression = this.calculateWeeklyProgression(clearDates, raidStart, raidEnd);

    return {
      guildsCleared: clearedGuilds.length,
      guildsProgressing: progressingGuilds.length,
      pullCount: pullStats,
      timeSpent: timeStats,
      progressRaidTimeSpent: progressRaidTimeStats,
      pullDistribution,
      timeDistribution,
      progressRaidTimeDistribution,
      weeklyProgression,
    };
  }

  /**
   * Calculate analytics for all tracked raids
   */
  async calculateAllRaidAnalytics(): Promise<void> {
    logger.info("[RaidAnalytics] Starting analytics calculation for all tracked raids...");
    const startTime = Date.now();

    for (const raidId of TRACKED_RAIDS) {
      await this.calculateRaidAnalytics(raidId);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    logger.info(`[RaidAnalytics] Completed analytics calculation for all raids in ${duration}s`);
  }

  /**
   * Get analytics for a specific raid (full data with bosses)
   */
  async getRaidAnalytics(raidId: number): Promise<IRaidAnalytics | null> {
    return RaidAnalytics.findOne({ raidId }).lean();
  }

  /**
   * Get overall analytics for all raids (raid-level only, no boss data)
   * Returns minimal data for overview display
   */
  async getAllRaidAnalyticsOverview(): Promise<
    {
      raidId: number;
      raidName: string;
      difficulty: string;
      overall: IRaidOverallAnalytics;
      raidStart?: Date;
      raidEnd?: Date;
      lastCalculated: Date;
    }[]
  > {
    const analytics = await RaidAnalytics.find({}).select("raidId raidName difficulty overall raidStart raidEnd lastCalculated").lean();

    return [...analytics].sort((a, b) => compareRaidIdsByPriority(a.raidId, b.raidId)).map((a) => ({
      raidId: a.raidId,
      raidName: a.raidName,
      difficulty: a.difficulty,
      overall: a.overall,
      raidStart: a.raidStart,
      raidEnd: a.raidEnd,
      lastCalculated: a.lastCalculated,
    }));
  }

  /**
   * Get boss-level weekly progression for all raids in a comparison-friendly shape.
   * Uses pre-calculated raid analytics documents, so this stays cheap to serve.
   */
  async getBossProgressionComparison(): Promise<RaidBossProgressionComparison> {
    const analytics = await RaidAnalytics.find({})
      .select("raidId raidName bosses overall raidStart raidEnd lastCalculated")
      .lean();

    const raids = [...analytics].sort((a, b) => compareRaidIdsByPriority(a.raidId, b.raidId)).map((raid) => {
      const bosses = raid.bosses ?? [];
      const totalBosses = bosses.length;

      const bossMilestones: RaidBossProgressionMilestone[] = bosses.map((boss, index) => ({
        key: `boss-${index + 1}`,
        type: "boss",
        bossIndex: index + 1,
        bossId: boss.bossId,
        bossName: boss.bossName,
        isFinalBoss: index === totalBosses - 1,
        guildsKilled: boss.guildsKilled,
        weeklyProgression: boss.weeklyProgression ?? [],
      }));

      return {
        raidId: raid.raidId,
        raidName: raid.raidName,
        raidStart: raid.raidStart,
        raidEnd: raid.raidEnd,
        totalBosses,
        lastCalculated: raid.lastCalculated,
        milestones: [
          ...bossMilestones,
          {
            key: "clear",
            type: "clear" as const,
            bossName: "Full clear",
            guildsKilled: raid.overall.guildsCleared,
            weeklyProgression: raid.overall.weeklyProgression ?? [],
          },
        ],
      };
    });

    return {
      generatedAt: new Date(),
      raids,
    };
  }

  /**
   * Get list of raids that have analytics available
   */
  async getAvailableRaids(): Promise<{ raidId: number; raidName: string; lastCalculated: Date }[]> {
    const analytics = await RaidAnalytics.find({}, { raidId: 1, raidName: 1, lastCalculated: 1 }).lean();

    return [...analytics].sort((a, b) => compareRaidIdsByPriority(a.raidId, b.raidId)).map((a) => ({
      raidId: a.raidId,
      raidName: a.raidName,
      lastCalculated: a.lastCalculated,
    }));
  }
}

export default new RaidAnalyticsService();
