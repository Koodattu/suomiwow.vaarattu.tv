import { mainEncounterFilter } from "../config/raid-encounters";
import Guild, { IGuild, IGuildCrest } from "../models/Guild";
import TierList, { IGuildTierScore, IRaidTierList } from "../models/TierList";
import Fight from "../models/Fight";
import { TRACKED_RAIDS } from "../config/guilds";
import logger from "../utils/logger";

interface GuildRaidData {
  guildId: string;
  guildName: string;
  realm: string;
  faction?: string;
  crest?: IGuildCrest;
  parent_guild?: string;
  raidId: number;
  raidName: string;
  // Heroic data
  heroicBossesDefeated: number;
  heroicWclBossesDefeated: number;
  heroicTotalBosses: number;
  heroicWorldRank: number | null;
  heroicGuildRank: number | null;
  heroicTotalPulls: number;
  heroicTimeSpent: number;
  // Mythic data
  mythicBossesDefeated: number;
  mythicWclBossesDefeated: number;
  mythicTotalBosses: number;
  mythicWorldRank: number | null;
  mythicGuildRank: number | null;
  mythicTotalPulls: number;
  mythicTimeSpent: number;
}

class TierListService {
  // Weight constants for scoring (heroic 20%, mythic 80%)
  private readonly HEROIC_WEIGHT = 0.2;
  private readonly MYTHIC_WEIGHT = 0.8;

  // Score range constants
  private readonly MAX_SCORE = 1000;
  private readonly MIN_SCORE = 0;

  // Cap for world rank (ranks above this are treated as this value)
  private readonly MAX_WORLD_RANK_CAP = 10000;

  /**
   * Calculate tier list scores for all guilds
   * Algorithm:
   * - Speed Score: Based on world rank and guild rank (lower = better)
   * - Efficiency Score: Based on kills per pull ratio and time efficiency
   * - Overall Score: Weighted combination of speed and efficiency
   */
  async calculateTierLists(): Promise<void> {
    logger.info("[TierList] Starting tier list calculation...");

    try {
      // Get all guilds with their progress
      const guilds = await Guild.find().select("-progress.bosses.pullHistory -lairProgress");

      if (guilds.length === 0) {
        logger.info("[TierList] No guilds found, skipping calculation");
        return;
      }

      // Find which guilds have WarcraftLogs fight data per raid
      // Efficiency scores depend on fight data, so exclude guilds without any
      const fightAgg = await Fight.aggregate([{ $match: { $or: TRACKED_RAIDS.map(raidId => ({ zoneId: raidId, ...mainEncounterFilter(raidId) })) } }, { $group: { _id: { guildId: "$guildId", zoneId: "$zoneId" } } }]);

      const guildsWithFights = new Map<number, Set<string>>();
      for (const doc of fightAgg) {
        const raidId = doc._id.zoneId as number;
        const guildId = doc._id.guildId.toString() as string;
        if (!guildsWithFights.has(raidId)) {
          guildsWithFights.set(raidId, new Set());
        }
        guildsWithFights.get(raidId)!.add(guildId);
      }

      logger.info(`[TierList] Found WarcraftLogs fight data for ${guildsWithFights.size} raids`);

      // Collect raid data for all guilds
      const guildRaidDataMap = new Map<string, GuildRaidData[]>();

      for (const guild of guilds as IGuild[]) {
        const guildId = (guild._id as any).toString();
        const raidDataList: GuildRaidData[] = [];

        for (const raidId of TRACKED_RAIDS) {
          // Skip if guild is excluded from this raid tier
          if (guild.excludedRaidIds?.includes(raidId)) continue;

          const heroicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "heroic");
          const mythicProgress = guild.progress.find((p) => p.raidId === raidId && p.difficulty === "mythic");

          // Skip if no progress for this raid
          if (!heroicProgress && !mythicProgress) continue;

          // Skip if guild has no WarcraftLogs fight data for this raid
          // Efficiency scores depend entirely on WCL data (time spent, pulls)
          if (!guildsWithFights.get(raidId)?.has(guildId)) {
            logger.debug(`[TierList] Skipping guild ${guild.name} for raid ${raidId} - no WCL fight data`);
            continue;
          }

          const raidName = heroicProgress?.raidName || mythicProgress?.raidName || `Raid ${raidId}`;

          // Calculate total pulls and WCL verified bosses from bosses array
          const heroicTotalPulls = heroicProgress?.bosses.reduce((sum, boss) => sum + boss.pullCount, 0) || 0;
          const mythicTotalPulls = mythicProgress?.bosses.reduce((sum, boss) => sum + boss.pullCount, 0) || 0;

          // A boss is considered WCL-backed if it has a firstKillReportCode or essentially any verifiable WCL kill data
          const heroicWclBossesDefeated = heroicProgress?.bosses.filter((b) => b.kills > 0 && b.firstKillReportCode).length || 0;
          const mythicWclBossesDefeated = mythicProgress?.bosses.filter((b) => b.kills > 0 && b.firstKillReportCode).length || 0;

          raidDataList.push({
            guildId,
            guildName: guild.name,
            realm: guild.realm,
            faction: guild.faction,
            crest: guild.crest,
            parent_guild: guild.parent_guild,
            raidId,
            raidName,
            heroicBossesDefeated: heroicProgress?.bossesDefeated || 0,
            heroicWclBossesDefeated,
            heroicTotalBosses: heroicProgress?.totalBosses || 0,
            heroicWorldRank: heroicProgress?.worldRank || null,
            heroicGuildRank: heroicProgress?.guildRank || null,
            heroicTotalPulls,
            heroicTimeSpent: heroicProgress?.totalTimeSpent || 0,
            mythicBossesDefeated: mythicProgress?.bossesDefeated || 0,
            mythicWclBossesDefeated,
            mythicTotalBosses: mythicProgress?.totalBosses || 0,
            mythicWorldRank: mythicProgress?.worldRank || null,
            mythicGuildRank: mythicProgress?.guildRank || null,
            mythicTotalPulls,
            mythicTimeSpent: mythicProgress?.totalTimeSpent || 0,
          });
        }

        if (raidDataList.length > 0) {
          guildRaidDataMap.set(guildId, raidDataList);
        }
      }

      // Calculate per-raid tier lists
      const raidTierLists: IRaidTierList[] = [];
      const raidScoresMap = new Map<number, Map<string, { speedScore: number; efficiencyScore: number }>>();

      for (const raidId of TRACKED_RAIDS) {
        const raidGuildsData: GuildRaidData[] = [];

        // Collect all guilds' data for this raid
        for (const [, raidDataList] of guildRaidDataMap) {
          const raidData = raidDataList.find((rd) => rd.raidId === raidId);
          if (raidData) {
            raidGuildsData.push(raidData);
          }
        }

        if (raidGuildsData.length === 0) continue;

        // Calculate scores for each guild in this raid
        const guildScores: IGuildTierScore[] = [];
        const scoreMap = new Map<string, { speedScore: number; efficiencyScore: number }>();

        for (const data of raidGuildsData) {
          const { speedScore, efficiencyScore, overallScore } = this.calculateGuildRaidScores(data, raidGuildsData);

          scoreMap.set(data.guildId, { speedScore, efficiencyScore });

          guildScores.push({
            guildId: data.guildId as any,
            guildName: data.guildName,
            realm: data.realm,
            faction: data.faction,
            crest: data.crest,
            parent_guild: data.parent_guild,
            overallScore: Math.round(overallScore),
            speedScore: Math.round(speedScore),
            efficiencyScore: Math.round(efficiencyScore),
          });
        }

        raidScoresMap.set(raidId, scoreMap);

        // Sort by overall score descending
        guildScores.sort((a, b) => b.overallScore - a.overallScore);

        const raidName = raidGuildsData[0]?.raidName || `Raid ${raidId}`;
        raidTierLists.push({
          raidId,
          raidName,
          guilds: guildScores,
        });
      }

      // Calculate overall tier list (combined scores across all raids)
      const overallScores: Map<
        string,
        { guildName: string; realm: string; faction?: string; crest?: IGuildCrest; parent_guild?: string; totalSpeed: number; totalEfficiency: number; raidCount: number }
      > = new Map();

      for (const [guildId, raidDataList] of guildRaidDataMap) {
        const guildInfo = raidDataList[0];
        let totalSpeed = 0;
        let totalEfficiency = 0;
        let raidCount = 0;

        for (const raidData of raidDataList) {
          const scoreMap = raidScoresMap.get(raidData.raidId);
          if (scoreMap) {
            const scores = scoreMap.get(guildId);
            if (scores) {
              totalSpeed += scores.speedScore;
              totalEfficiency += scores.efficiencyScore;
              raidCount++;
            }
          }
        }

        if (raidCount > 0) {
          overallScores.set(guildId, {
            guildName: guildInfo.guildName,
            realm: guildInfo.realm,
            faction: guildInfo.faction,
            crest: guildInfo.crest,
            parent_guild: guildInfo.parent_guild,
            totalSpeed,
            totalEfficiency,
            raidCount,
          });
        }
      }

      // Convert to array and calculate final overall scores
      const overallGuildScores: IGuildTierScore[] = [];

      for (const [guildId, data] of overallScores) {
        const avgSpeed = data.totalSpeed / data.raidCount;
        const avgEfficiency = data.totalEfficiency / data.raidCount;
        const overallScore = (avgSpeed + avgEfficiency) / 2;

        overallGuildScores.push({
          guildId: guildId as any,
          guildName: data.guildName,
          realm: data.realm,
          faction: data.faction,
          crest: data.crest,
          parent_guild: data.parent_guild,
          overallScore: Math.round(overallScore),
          speedScore: Math.round(avgSpeed),
          efficiencyScore: Math.round(avgEfficiency),
        });
      }

      // Sort by overall score descending
      overallGuildScores.sort((a, b) => b.overallScore - a.overallScore);

      // Delete old tier lists and save new one
      await TierList.deleteMany({});

      const tierList = new TierList({
        calculatedAt: new Date(),
        overall: overallGuildScores,
        raids: raidTierLists,
      });

      await tierList.save();

      logger.info(`[TierList] Tier list calculation completed. ${overallGuildScores.length} guilds ranked across ${raidTierLists.length} raids.`);
    } catch (error) {
      logger.error("[TierList] Error calculating tier lists:", error);
      throw error;
    }
  }

  /**
   * Linear interpolation helper: maps a value from [min, max] range to [1000, 0] score.
   * Lower values get higher scores (closer to 1000). Use for metrics where less = better.
   */
  private interpolateScore(value: number, minValue: number, maxValue: number): number {
    if (minValue === maxValue) return this.MAX_SCORE;
    const normalized = (value - minValue) / (maxValue - minValue);
    return Math.round(this.MAX_SCORE * (1 - normalized));
  }

  /**
   * Ascending interpolation helper: maps a value from [min, max] range to [0, 1000] score.
   * Higher values get higher scores. Use for metrics where more = better (e.g. credit-per-time).
   */
  private interpolateScoreAscending(value: number, minValue: number, maxValue: number): number {
    if (minValue === maxValue) return this.MAX_SCORE;
    const normalized = (value - minValue) / (maxValue - minValue);
    return Math.round(this.MAX_SCORE * normalized);
  }

  /**
   * Calculate exponential progress score for bosses defeated.
   * Later bosses are worth more than earlier bosses (exponential growth).
   * 0 bosses = 0 score, all bosses = 1000 score.
   *
   * @param k Steepness factor. Higher = more emphasis on later bosses.
   *          Speed scoring uses k=10 (only near-full clears matter).
   *          Efficiency scoring uses k=3 (all progress meaningful).
   */
  private calculateExponentialProgressScore(bossesDefeated: number, totalBosses: number, k: number = 10): number {
    if (totalBosses === 0 || bossesDefeated === 0) return 0;
    if (bossesDefeated >= totalBosses) return this.MAX_SCORE;

    const progress = bossesDefeated / totalBosses;
    const exponentialProgress = (Math.exp(k * progress) - 1) / (Math.exp(k) - 1);

    return Math.round(exponentialProgress * this.MAX_SCORE);
  }

  /**
   * Calculate speed, efficiency, and overall scores for a guild in a specific raid
   * All scores are on a 0-1000 scale where 1000 is best
   */
  private calculateGuildRaidScores(
    guildData: GuildRaidData,
    allGuildsData: GuildRaidData[],
  ): {
    speedScore: number;
    efficiencyScore: number;
    overallScore: number;
    heroicSpeedScore: number;
    mythicSpeedScore: number;
    heroicEfficiencyScore: number;
    mythicEfficiencyScore: number;
  } {
    // === FIND MIN/MAX VALUES FOR DYNAMIC SCORING ===

    // Guild ranks (use actual min/max from data, not a phantom rank 1)
    const heroicGuildRanks = allGuildsData.filter((g) => g.heroicGuildRank !== null).map((g) => g.heroicGuildRank!);
    const mythicGuildRanks = allGuildsData.filter((g) => g.mythicGuildRank !== null).map((g) => g.mythicGuildRank!);
    const minHeroicGuildRank = heroicGuildRanks.length > 0 ? Math.min(...heroicGuildRanks) : 1;
    const maxHeroicGuildRank = heroicGuildRanks.length > 0 ? Math.max(...heroicGuildRanks) : 1;
    const minMythicGuildRank = mythicGuildRanks.length > 0 ? Math.min(...mythicGuildRanks) : 1;
    const maxMythicGuildRank = mythicGuildRanks.length > 0 ? Math.max(...mythicGuildRanks) : 1;

    // Total bosses (for progress calculation)
    const heroicTotalBosses = guildData.heroicTotalBosses || allGuildsData.find((g) => g.heroicTotalBosses > 0)?.heroicTotalBosses || 0;
    const mythicTotalBosses = guildData.mythicTotalBosses || allGuildsData.find((g) => g.mythicTotalBosses > 0)?.mythicTotalBosses || 0;

    // === CALCULATE HEROIC SPEED SCORE ===
    // Speed = world rank (60%) + boss progress (25%) + guild rank (15%).
    // World rank uses absolute scale [1, 10000] so scores are stable regardless of pool.
    // Boss progress uses k=5 (moderate curve — partial progress matters but full clears rewarded).
    // Missing components score 0 (not excluded) so guilds aren't inflated by sparse data.
    const SPEED_K = 5;
    let heroicSpeedScore = 0;
    let hasHeroicSpeed = false;
    if (guildData.heroicGuildRank !== null || guildData.heroicWorldRank !== null || guildData.heroicBossesDefeated > 0) {
      hasHeroicSpeed = true;

      // World rank score — absolute scale [1, MAX_WORLD_RANK_CAP], 60% weight
      let worldRankScore = 0;
      if (guildData.heroicWorldRank !== null) {
        const cappedRank = Math.min(guildData.heroicWorldRank, this.MAX_WORLD_RANK_CAP);
        worldRankScore = this.interpolateScore(cappedRank, 1, this.MAX_WORLD_RANK_CAP);
      }

      // Boss progress score — k=5 exponential, 25% weight
      let progressScore = 0;
      if (heroicTotalBosses > 0) {
        progressScore = this.calculateExponentialProgressScore(guildData.heroicBossesDefeated, heroicTotalBosses, SPEED_K);
      }

      // Guild rank score — relative to tracked pool, 15% weight
      let guildRankScore = 0;
      if (guildData.heroicGuildRank !== null) {
        guildRankScore = this.interpolateScore(guildData.heroicGuildRank, minHeroicGuildRank, maxHeroicGuildRank);
      }

      heroicSpeedScore = worldRankScore * 0.6 + progressScore * 0.25 + guildRankScore * 0.15;
    }

    // === CALCULATE MYTHIC SPEED SCORE ===
    let mythicSpeedScore = 0;
    let hasMythicSpeed = false;
    if (guildData.mythicGuildRank !== null || guildData.mythicWorldRank !== null || guildData.mythicBossesDefeated > 0) {
      hasMythicSpeed = true;

      let worldRankScore = 0;
      if (guildData.mythicWorldRank !== null) {
        const cappedRank = Math.min(guildData.mythicWorldRank, this.MAX_WORLD_RANK_CAP);
        worldRankScore = this.interpolateScore(cappedRank, 1, this.MAX_WORLD_RANK_CAP);
      }

      let progressScore = 0;
      if (mythicTotalBosses > 0) {
        progressScore = this.calculateExponentialProgressScore(guildData.mythicBossesDefeated, mythicTotalBosses, SPEED_K);
      }

      let guildRankScore = 0;
      if (guildData.mythicGuildRank !== null) {
        guildRankScore = this.interpolateScore(guildData.mythicGuildRank, minMythicGuildRank, maxMythicGuildRank);
      }

      mythicSpeedScore = worldRankScore * 0.6 + progressScore * 0.25 + guildRankScore * 0.15;
    }

    // === CALCULATE EFFICIENCY SCORE ===
    // Efficiency measures how effectively a guild clears bosses relative to time and effort.
    // Score each difficulty independently, then apply the same heroic/mythic weights as speed.
    // This prevents heroic-only clears from gaining unweighted ratio credit against mythic progression.
    //
    // Per difficulty: creditPerTime 50% + creditPerPull 25% + progress 25%.
    // Final: heroicEfficiency * 0.2 + mythicEfficiency * 0.8.
    let heroicEfficiencyScore = 0;
    let mythicEfficiencyScore = 0;
    let efficiencyScore = 0;
    // For efficiency, ONLY count WCL-backed bosses since time/pull values originate purely from WCL logs
    const hasHeroicEfficiency = guildData.heroicWclBossesDefeated > 0;
    const hasMythicEfficiency = guildData.mythicWclBossesDefeated > 0;

    if (hasHeroicEfficiency || hasMythicEfficiency) {
      const EFFICIENCY_K = 3;

      const calculateDifficultyEfficiencyScore = (
        bossesDefeated: number,
        totalBosses: number,
        timeSpent: number,
        totalPulls: number,
        getBossesDefeated: (data: GuildRaidData) => number,
        getTimeSpent: (data: GuildRaidData) => number,
        getTotalPulls: (data: GuildRaidData) => number,
      ): number => {
        if (bossesDefeated <= 0 || totalBosses <= 0) return 0;

        const progress = this.calculateExponentialProgressScore(bossesDefeated, totalBosses, EFFICIENCY_K);
        const creditPerTimeValues: number[] = [];
        const creditPerPullValues: number[] = [];

        for (const g of allGuildsData) {
          const gBossesDefeated = getBossesDefeated(g);
          if (gBossesDefeated <= 0) continue;

          const gProgress = this.calculateExponentialProgressScore(gBossesDefeated, totalBosses, EFFICIENCY_K);
          const gTimeSpent = getTimeSpent(g);
          const gTotalPulls = getTotalPulls(g);

          if (gTimeSpent > 0) creditPerTimeValues.push(gProgress / gTimeSpent);
          if (gTotalPulls > 0) creditPerPullValues.push(gProgress / gTotalPulls);
        }

        const minCPT = creditPerTimeValues.length > 0 ? Math.min(...creditPerTimeValues) : 0;
        const maxCPT = creditPerTimeValues.length > 0 ? Math.max(...creditPerTimeValues) : 1;
        const minCPP = creditPerPullValues.length > 0 ? Math.min(...creditPerPullValues) : 0;
        const maxCPP = creditPerPullValues.length > 0 ? Math.max(...creditPerPullValues) : 1;

        let creditPerTimeScore = 0;
        if (timeSpent > 0) {
          creditPerTimeScore = this.interpolateScoreAscending(progress / timeSpent, minCPT, maxCPT);
        }

        let creditPerPullScore = 0;
        if (totalPulls > 0) {
          creditPerPullScore = this.interpolateScoreAscending(progress / totalPulls, minCPP, maxCPP);
        }

        return Math.round(creditPerTimeScore * 0.5 + creditPerPullScore * 0.25 + progress * 0.25);
      };

      heroicEfficiencyScore = calculateDifficultyEfficiencyScore(
        guildData.heroicWclBossesDefeated,
        heroicTotalBosses,
        guildData.heroicTimeSpent,
        guildData.heroicTotalPulls,
        (data) => data.heroicWclBossesDefeated,
        (data) => data.heroicTimeSpent,
        (data) => data.heroicTotalPulls,
      );

      mythicEfficiencyScore = calculateDifficultyEfficiencyScore(
        guildData.mythicWclBossesDefeated,
        mythicTotalBosses,
        guildData.mythicTimeSpent,
        guildData.mythicTotalPulls,
        (data) => data.mythicWclBossesDefeated,
        (data) => data.mythicTimeSpent,
        (data) => data.mythicTotalPulls,
      );

      if (hasHeroicEfficiency && hasMythicEfficiency) {
        efficiencyScore = heroicEfficiencyScore * this.HEROIC_WEIGHT + mythicEfficiencyScore * this.MYTHIC_WEIGHT;
      } else if (hasHeroicEfficiency) {
        efficiencyScore = heroicEfficiencyScore * this.HEROIC_WEIGHT;
      } else if (hasMythicEfficiency) {
        efficiencyScore = mythicEfficiencyScore * this.MYTHIC_WEIGHT;
      }

      efficiencyScore = Math.max(this.MIN_SCORE, Math.min(this.MAX_SCORE, efficiencyScore));
    }

    // === CALCULATE WEIGHTED SPEED SCORE ===
    // Heroic 20%, Mythic 80%. Single-difficulty guilds are scaled by their weight
    // so mythic-only can reach 800 and heroic-only caps at 200.
    let speedScore = 0;
    if (hasHeroicSpeed && hasMythicSpeed) {
      speedScore = heroicSpeedScore * this.HEROIC_WEIGHT + mythicSpeedScore * this.MYTHIC_WEIGHT;
    } else if (hasHeroicSpeed) {
      speedScore = heroicSpeedScore * this.HEROIC_WEIGHT;
    } else if (hasMythicSpeed) {
      speedScore = mythicSpeedScore * this.MYTHIC_WEIGHT;
    }

    // === OVERALL SCORE ===
    // Average of speed and efficiency
    const overallScore = (speedScore + efficiencyScore) / 2;

    return {
      speedScore: Math.max(this.MIN_SCORE, Math.min(this.MAX_SCORE, Math.round(speedScore))),
      efficiencyScore: Math.max(this.MIN_SCORE, Math.min(this.MAX_SCORE, Math.round(efficiencyScore))),
      overallScore: Math.max(this.MIN_SCORE, Math.min(this.MAX_SCORE, Math.round(overallScore))),
      heroicSpeedScore: Math.round(heroicSpeedScore),
      mythicSpeedScore: Math.round(mythicSpeedScore),
      heroicEfficiencyScore: Math.round(heroicEfficiencyScore),
      mythicEfficiencyScore: Math.round(mythicEfficiencyScore),
    };
  }

  /**
   * Get the latest tier list (full data - all raids + overall)
   */
  async getTierList(): Promise<any> {
    const tierList = await TierList.findOne().sort({ calculatedAt: -1 }).lean();
    if (!tierList) return null;

    // Remove guildId from response as frontend doesn't need it
    return {
      calculatedAt: tierList.calculatedAt,
      overall: tierList.overall.map(this.stripGuildId),
      raids: tierList.raids.map((raid) => ({
        raidId: raid.raidId,
        raidName: raid.raidName,
        guilds: raid.guilds.map(this.stripGuildId),
      })),
    };
  }

  /**
   * Get overall tier list only (without per-raid data)
   */
  async getOverallTierList(): Promise<{ calculatedAt: Date; guilds: Omit<IGuildTierScore, "guildId">[] } | null> {
    const tierList = await TierList.findOne().sort({ calculatedAt: -1 }).lean();
    if (!tierList) return null;

    return {
      calculatedAt: tierList.calculatedAt,
      guilds: tierList.overall.map(this.stripGuildId),
    };
  }

  /**
   * Get tier list for a specific raid
   */
  async getTierListForRaid(raidId: number): Promise<{ calculatedAt: Date; raidId: number; raidName: string; guilds: Omit<IGuildTierScore, "guildId">[] } | null> {
    const tierList = await TierList.findOne().sort({ calculatedAt: -1 }).lean();
    if (!tierList) return null;

    const raidTierList = tierList.raids.find((r) => r.raidId === raidId);
    if (!raidTierList) return null;

    return {
      calculatedAt: tierList.calculatedAt,
      raidId: raidTierList.raidId,
      raidName: raidTierList.raidName,
      guilds: raidTierList.guilds.map(this.stripGuildId),
    };
  }

  /**
   * Get available raids from tier list (just raid IDs and names)
   */
  async getAvailableRaids(): Promise<{ raidId: number; raidName: string }[]> {
    const tierList = await TierList.findOne().sort({ calculatedAt: -1 }).lean();
    if (!tierList) return [];

    return tierList.raids.map((raid) => ({
      raidId: raid.raidId,
      raidName: raid.raidName,
    }));
  }

  /**
   * Strip guildId from guild tier score (not needed by frontend)
   */
  private stripGuildId(guild: IGuildTierScore): Omit<IGuildTierScore, "guildId"> {
    const { guildId, ...rest } = guild as any;
    return rest;
  }
}

export default new TierListService();
