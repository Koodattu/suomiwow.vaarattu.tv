import cacheService from "./cache.service";
import guildService from "./guild.service";
import compareService from "./compare.service";
import tierListService from "./tierlist.service";
import raidAnalyticsService from "./raid-analytics.service";
import { TRACKED_RAIDS, CURRENT_RAID_IDS, PRIMARY_RAID_ID } from "../config/guilds";
import logger from "../utils/logger";
import Raid from "../models/Raid";
import Event from "../models/Event";
import Guild from "../models/Guild";
import { addRaidPriorityFlagsAndSort } from "../utils/raidPriority";
import { COMPARE_DIFFICULTIES } from "../config/compare";

/**
 * Cache Warming Service
 *
 * Responsible for pre-populating MongoDB caches with data to ensure
 * fast response times for end users. Called during:
 * - Server startup (after initialization)
 * - Nightly at 02:00 UTC (before all other nightly jobs)
 * - After scheduled recalculations (tier lists, analytics)
 * - After guild updates
 *
 * All cache operations are async since they hit MongoDB.
 */
class CacheWarmerService {
  constructor() {
    this.registerWarmers();
  }

  private registerWarmers(): void {
    cacheService.registerWarmer(cacheService.getHomeKey(), () => this.buildHomeCacheData());
    cacheService.registerWarmer(cacheService.getGuildListKey(), () => guildService.getGuildListMinimal());
    cacheService.registerWarmer(cacheService.getSchedulesKey(), () => guildService.getAllGuildSchedules());
    cacheService.registerWarmer(cacheService.getLiveStreamersKey(), () => guildService.getLiveStreamers());
    cacheService.registerWarmer(cacheService.getHorseRaceUmaReservationsKey(), () => guildService.getReservedHorseRaceUmaImages());
    cacheService.registerWarmer(cacheService.getRaidsKey(), () => this.getTrackedRaids());

    for (const raidId of TRACKED_RAIDS) {
      cacheService.registerWarmer(cacheService.getProgressKey(raidId), () => guildService.getAllGuildsForRaid(raidId));
      cacheService.registerWarmer(cacheService.getGuildsKey(raidId), () => guildService.getAllGuildsForRaid(raidId));
      for (const difficulty of COMPARE_DIFFICULTIES) {
        cacheService.registerWarmer(cacheService.getCompareKey(raidId, difficulty), async () => {
          const data = await compareService.getRaidCompare(raidId, difficulty);
          if (!data) throw new Error(`Compare data not found for raid ${raidId} on ${difficulty}`);
          return data;
        });
      }
      cacheService.registerWarmer(cacheService.getRaidDatesKey(raidId), () => this.getRaidDates(raidId));
      cacheService.registerWarmer(cacheService.getRaidBossesKey(raidId), () => this.getRaidBosses(raidId));
    }
  }

  private async getTrackedRaids(): Promise<any[]> {
    const raids = await Raid.find({ id: { $in: TRACKED_RAIDS } })
      .select("id name slug rioSlug expansion iconUrl partitions -_id")
      .lean();
    return addRaidPriorityFlagsAndSort(raids);
  }

  private async getRaidDates(raidId: number): Promise<{ starts: unknown; ends: unknown } | null> {
    const raid = await Raid.findOne({ id: raidId }).select("starts ends -_id").lean();
    if (!raid) throw new Error(`Raid dates not found for raid ${raidId}`);
    return {
      starts: (raid as any).starts,
      ends: (raid as any).ends,
    };
  }

  private async getRaidBosses(raidId: number): Promise<any[] | null> {
    const raid = await Raid.findOne({ id: raidId }).select("bosses -_id").lean();
    if (!raid) throw new Error(`Raid bosses not found for raid ${raidId}`);

    return ((raid as any).bosses ?? []).map((boss: any) => ({
      id: boss.id,
      name: boss.name,
      slug: boss.slug,
      iconUrl: boss.iconUrl,
    }));
  }

  private async buildHomeCacheData(): Promise<any> {
    const currentRaidId = PRIMARY_RAID_ID;

    // Fetch all data needed for home page
    const [guilds, events, raid, raidDatesDoc, raids] = await Promise.all([
      guildService.getAllGuildsForRaid(currentRaidId),
      Event.find().sort({ timestamp: -1 }).limit(5).lean(),
      Raid.findOne({ id: currentRaidId }).lean(),
      Raid.findOne({ id: currentRaidId }).select("starts ends").lean(),
      this.getTrackedRaids(),
    ]);

    if (!raid) {
      throw new Error("Current raid not found");
    }

    // Enrich events with live streamer data - must match what the home route handler produces.
    const guildIds = [...new Set(events.map((e: any) => String(e.guildId)))];
    const eventGuilds = await Guild.find({ _id: { $in: guildIds } }, { _id: 1, realm: 1, streamers: 1, isCurrentlyRaiding: 1 }).lean();
    const guildMap = new Map<string, { realm: string; liveStreamers: string[]; isCurrentlyRaiding: boolean }>();
    for (const g of eventGuilds) {
      const liveStreamers = (g.streamers || []).filter((s: any) => s.isLive).map((s: any) => s.channelName);
      guildMap.set(String(g._id), { realm: g.realm, liveStreamers, isCurrentlyRaiding: g.isCurrentlyRaiding ?? false });
    }
    const enrichedEvents = events.map((event: any) => {
      const guildData = guildMap.get(String(event.guildId));
      return {
        ...event,
        guildRealm: event.guildRealm || guildData?.realm,
        liveStreamers: guildData?.liveStreamers || [],
        isCurrentlyRaiding: guildData?.isCurrentlyRaiding || false,
      };
    });

    return {
      raid: {
        id: (raid as any).id,
        name: (raid as any).name,
        slug: (raid as any).slug,
        expansion: (raid as any).expansion,
        iconUrl: (raid as any).iconUrl,
      },
      raids,
      dates: {
        starts: (raidDatesDoc as any)?.starts,
        ends: (raidDatesDoc as any)?.ends,
      },
      guilds,
      events: enrichedEvents,
    };
  }

  /**
   * Warm all critical caches on server startup or nightly refresh.
   * This should be called after all services are initialized.
   */
  async warmAllCaches(): Promise<void> {
    logger.info("[Cache Warmer] Starting full cache warm-up...");
    const startTime = Date.now();

    try {
      // Warm caches in priority order (most important first)
      await Promise.all([this.warmProgressCaches(), this.warmCompareCaches(), this.warmHomeCacheData(), this.warmGuildListCaches()]);

      // Warm tier lists and analytics (can take longer)
      await Promise.all([this.warmTierListCaches(), this.warmRaidAnalyticsCaches()]);

      const duration = Math.round((Date.now() - startTime) / 1000);
      logger.info(`[Cache Warmer] Full cache warm-up completed in ${duration}s`);
    } catch (error) {
      logger.error("[Cache Warmer] Error during cache warm-up:", error);
    }
  }

  /**
   * Warm progress caches for all tracked raids.
   * Older raids get longer TTL since they don't change.
   */
  async warmProgressCaches(): Promise<void> {
    logger.info(`[Cache Warmer] Warming progress caches for ${TRACKED_RAIDS.length} raids...`);

    for (const raidId of TRACKED_RAIDS) {
      try {
        const key = cacheService.getProgressKey(raidId);
        const data = await guildService.getAllGuildsForRaid(raidId);
        const ttl = cacheService.getTTLForRaid(raidId);
        await cacheService.set(key, data, ttl);
        logger.debug(`[Cache Warmer] Progress cache warmed for raid ${raidId}`);
      } catch (error) {
        logger.error(`[Cache Warmer] Failed to warm progress cache for raid ${raidId}:`, error);
      }
    }

    // Pickem rankings and scores are derived from progress caches, so they
    // must be rebuilt after progress data changes.
    await cacheService.invalidatePattern(/^pickems:(rankings|leaderboard):/);

    logger.info(`[Cache Warmer] Progress caches warmed`);
  }

  /**
   * Warm compare caches for all tracked raids.
   */
  async warmCompareCaches(): Promise<void> {
    logger.info(`[Cache Warmer] Warming compare caches for ${TRACKED_RAIDS.length} raids...`);

    for (const raidId of TRACKED_RAIDS) {
      try {
        for (const difficulty of COMPARE_DIFFICULTIES) {
          const key = cacheService.getCompareKey(raidId, difficulty);
          const data = await compareService.getRaidCompare(raidId, difficulty);
          if (!data) {
            continue;
          }
          const ttl = cacheService.getTTLForRaid(raidId);
          await cacheService.set(key, data, ttl);
        }
        logger.debug(`[Cache Warmer] Compare cache warmed for raid ${raidId}`);
      } catch (error) {
        logger.error(`[Cache Warmer] Failed to warm compare cache for raid ${raidId}:`, error);
      }
    }

    logger.info(`[Cache Warmer] Compare caches warmed`);
  }

  /**
   * Warm home page data cache.
   */
  async warmHomeCacheData(): Promise<void> {
    logger.info("[Cache Warmer] Warming home page cache...");

    try {
      const response = await this.buildHomeCacheData();
      await cacheService.set(cacheService.getHomeKey(), response, cacheService.CURRENT_RAID_TTL);
      logger.info("[Cache Warmer] Home page cache warmed");
    } catch (error) {
      logger.error("[Cache Warmer] Failed to warm home cache:", error);
    }
  }

  /**
   * Warm guild list related caches.
   */
  async warmGuildListCaches(): Promise<void> {
    logger.info("[Cache Warmer] Warming guild list caches...");

    try {
      // Warm minimal guild list
      const guildList = await guildService.getGuildListMinimal();
      await cacheService.set(cacheService.getGuildListKey(), guildList, cacheService.GUILD_LIST_TTL);

      // Warm schedules
      const schedules = await guildService.getAllGuildSchedules();
      await cacheService.set(cacheService.getSchedulesKey(), schedules, cacheService.SCHEDULES_TTL);

      logger.info("[Cache Warmer] Guild list caches warmed");
    } catch (error) {
      logger.error("[Cache Warmer] Failed to warm guild list caches:", error);
    }
  }

  /**
   * Warm tier list caches.
   */
  async warmTierListCaches(): Promise<void> {
    logger.info("[Cache Warmer] Warming tier list caches...");

    try {
      // Warm full tier list
      const fullTierList = await tierListService.getTierList();
      if (fullTierList) {
        await cacheService.set(cacheService.getTierListFullKey(), fullTierList, cacheService.TIER_LIST_TTL);
      }

      // Warm overall tier list
      const overallTierList = await tierListService.getOverallTierList();
      if (overallTierList) {
        await cacheService.set(cacheService.getTierListOverallKey(), overallTierList, cacheService.TIER_LIST_TTL);
      }

      // Warm available raids
      const raids = await tierListService.getAvailableRaids();
      if (raids) {
        await cacheService.set(cacheService.getTierListRaidsKey(), raids, cacheService.TIER_LIST_TTL);

        // Warm per-raid tier lists
        for (const raid of raids) {
          try {
            const raidTierList = await tierListService.getTierListForRaid(raid.raidId);
            if (raidTierList) {
              await cacheService.set(cacheService.getTierListRaidKey(raid.raidId), raidTierList, cacheService.TIER_LIST_TTL);
            }
          } catch (error) {
            logger.error(`[Cache Warmer] Failed to warm tier list for raid ${raid.raidId}:`, error);
          }
        }
      }

      logger.info("[Cache Warmer] Tier list caches warmed");
    } catch (error) {
      logger.error("[Cache Warmer] Failed to warm tier list caches:", error);
    }
  }

  /**
   * Warm raid analytics caches.
   */
  async warmRaidAnalyticsCaches(): Promise<void> {
    logger.info("[Cache Warmer] Warming raid analytics caches...");

    try {
      // Warm all analytics overview
      const allAnalytics = await raidAnalyticsService.getAllRaidAnalyticsOverview();
      if (allAnalytics) {
        await cacheService.set(cacheService.getRaidAnalyticsAllKey(), allAnalytics, cacheService.RAID_ANALYTICS_TTL);
      }

      const bossProgression = await raidAnalyticsService.getBossProgressionComparison();
      if (bossProgression) {
        await cacheService.set(cacheService.getRaidAnalyticsBossProgressionKey(), bossProgression, cacheService.RAID_ANALYTICS_TTL);
      }

      // Warm available raids
      const raids = await raidAnalyticsService.getAvailableRaids();
      if (raids) {
        await cacheService.set(cacheService.getRaidAnalyticsRaidsKey(), raids, cacheService.RAID_ANALYTICS_TTL);

        // Warm per-raid analytics
        for (const raid of raids) {
          try {
            const raidAnalytics = await raidAnalyticsService.getRaidAnalytics(raid.raidId);
            if (raidAnalytics) {
              await cacheService.set(cacheService.getRaidAnalyticsKey(raid.raidId), raidAnalytics, cacheService.RAID_ANALYTICS_TTL);
            }
          } catch (error) {
            logger.error(`[Cache Warmer] Failed to warm analytics for raid ${raid.raidId}:`, error);
          }
        }
      }

      logger.info("[Cache Warmer] Raid analytics caches warmed");
    } catch (error) {
      logger.error("[Cache Warmer] Failed to warm raid analytics caches:", error);
    }
  }

  /**
   * Warm caches for current raid only.
   * Called after guild updates during hot hours.
   */
  async warmCurrentRaidCaches(): Promise<void> {
    logger.info("[Cache Warmer] Warming current raid caches...");

    try {
      for (const raidId of CURRENT_RAID_IDS) {
        const key = cacheService.getProgressKey(raidId);
        const data = await guildService.getAllGuildsForRaid(raidId);
        await cacheService.set(key, data, cacheService.CURRENT_RAID_TTL);

        for (const difficulty of COMPARE_DIFFICULTIES) {
          const compareKey = cacheService.getCompareKey(raidId, difficulty);
          const compareData = await compareService.getRaidCompare(raidId, difficulty);
          if (compareData) {
            await cacheService.set(compareKey, compareData, cacheService.CURRENT_RAID_TTL);
          }
        }
      }

      // Also warm home page
      await this.warmHomeCacheData();

      // Pickem rankings and scores are derived from current raid progress.
      await cacheService.invalidatePattern(/^pickems:(rankings|leaderboard):/);

      logger.info("[Cache Warmer] Current raid caches warmed");
    } catch (error) {
      logger.error("[Cache Warmer] Failed to warm current raid caches:", error);
    }
  }
}

export default new CacheWarmerService();
