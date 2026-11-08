import { isMainEncounter, mainEncounterFilter } from "../config/raid-encounters";
import Guild, { IBossProgress, IGuild, IGuildCrest } from "../models/Guild";
import TierList, { IGuildTierScore, IRaidTierList } from "../models/TierList";
import Fight from "../models/Fight";
import { TRACKED_RAIDS } from "../config/guilds";
import logger from "../utils/logger";

// Sporefall is tracked separately but must not influence any guild tier rating.
const GUILD_TIER_RAIDS = TRACKED_RAIDS.filter(raidId => raidId !== 50);

type EfficiencyBoss = Pick<IBossProgress, "bossId" | "kills" | "firstKillReportCode" | "pullCount" | "timeSpent">;

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
  heroicBosses: EfficiencyBoss[];
  heroicTotalBosses: number;
  heroicWorldRank: number | null;
  heroicGuildRank: number | null;
  // Mythic data
  mythicBossesDefeated: number;
  mythicBosses: EfficiencyBoss[];
  mythicTotalBosses: number;
  mythicWorldRank: number | null;
  mythicGuildRank: number | null;
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
   * - Efficiency Score: Progress-capped, same-boss comparisons of first-kill pulls and combat time
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
      const fightAgg = await Fight.aggregate([{ $match: { $or: GUILD_TIER_RAIDS.map(raidId => ({ zoneId: raidId, ...mainEncounterFilter(raidId) })) } }, { $group: { _id: { guildId: "$guildId", zoneId: "$zoneId" } } }]);

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

        for (const raidId of GUILD_TIER_RAIDS) {
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
            heroicBosses: heroicProgress?.bosses || [],
            heroicTotalBosses: heroicProgress?.totalBosses || 0,
            heroicWorldRank: heroicProgress?.worldRank || null,
            heroicGuildRank: heroicProgress?.guildRank || null,
            mythicBossesDefeated: mythicProgress?.bossesDefeated || 0,
            mythicBosses: mythicProgress?.bosses || [],
            mythicTotalBosses: mythicProgress?.totalBosses || 0,
            mythicWorldRank: mythicProgress?.worldRank || null,
            mythicGuildRank: mythicProgress?.guildRank || null,
          });
        }

        if (raidDataList.length > 0) {
          guildRaidDataMap.set(guildId, raidDataList);
        }
      }

      // Calculate per-raid tier lists
      const raidTierLists: IRaidTierList[] = [];
      const raidScoresMap = new Map<number, Map<string, { speedScore: number; efficiencyScore: number }>>();

      for (const raidId of GUILD_TIER_RAIDS) {
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
   * Calculate exponential progress score for bosses defeated.
   * Later bosses are worth more than earlier bosses (exponential growth).
   * 0 bosses = 0 score, all bosses = 1000 score.
   *
   * @param k Steepness factor. Higher = more emphasis on later bosses.
   *          Speed scoring uses k=5 (moderate emphasis on full clears).
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
   * Compare each verified first kill with the same boss on the same difficulty.
   * Median benchmarks limit the influence of unusually sparse or expensive logs.
   * At the median a metric earns 0.5; less effort approaches 1, more approaches 0.
   * Fewer than three guild samples earn neutral credit instead of an assumed best score.
   *
   * Progress multiplies the entire result: 1/8 cannot exceed its 24-point credit,
   * even with perfect ratios. Unkilled or unlogged bosses cannot earn credit.
   */
  private calculateDifficultyEfficiencyScore(
    bosses: EfficiencyBoss[],
    totalBosses: number,
    allBosses: EfficiencyBoss[][],
    raidId: number,
  ): number {
    const isUsable = (boss: EfficiencyBoss): boolean =>
      isMainEncounter(raidId, boss.bossId) &&
      boss.kills > 0 && Boolean(boss.firstKillReportCode) &&
      Number.isInteger(boss.pullCount) && boss.pullCount > 0 &&
      Number.isFinite(boss.timeSpent) && boss.timeSpent > 0;

    const killedBosses = bosses.filter(isUsable);
    if (totalBosses <= 0 || killedBosses.length === 0) return 0;

    const samplesByBoss = new Map<number, EfficiencyBoss[]>();
    for (const guildBosses of allBosses) {
      for (const boss of guildBosses.filter(isUsable)) {
        const samples = samplesByBoss.get(boss.bossId) || [];
        samples.push(boss);
        samplesByBoss.set(boss.bossId, samples);
      }
    }

    const median = (values: number[]): number => {
      values.sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    };

    let timeCredit = 0;
    let pullCredit = 0;
    for (const boss of killedBosses) {
      const samples = samplesByBoss.get(boss.bossId) || [];
      if (samples.length < 3) {
        timeCredit += 0.5;
        pullCredit += 0.5;
        continue;
      }

      const medianTime = median(samples.map(sample => sample.timeSpent));
      const medianPulls = median(samples.map(sample => sample.pullCount));
      timeCredit += 1 / (1 + boss.timeSpent / medianTime);
      pullCredit += 1 / (1 + boss.pullCount / medianPulls);
    }

    const progress = this.calculateExponentialProgressScore(killedBosses.length, totalBosses, 3);
    return Math.round(progress * (0.25 + 0.5 * timeCredit / killedBosses.length + 0.25 * pullCredit / killedBosses.length));
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
    // Same-boss comparisons are capped by verified progress on each difficulty.
    // Keep heroic/mythic weights fixed, including when one difficulty has no logs.
    const heroicEfficiencyScore = this.calculateDifficultyEfficiencyScore(
      guildData.heroicBosses,
      heroicTotalBosses,
      allGuildsData.map(data => data.heroicBosses),
      guildData.raidId,
    );
    const mythicEfficiencyScore = this.calculateDifficultyEfficiencyScore(
      guildData.mythicBosses,
      mythicTotalBosses,
      allGuildsData.map(data => data.mythicBosses),
      guildData.raidId,
    );
    const efficiencyScore = heroicEfficiencyScore * this.HEROIC_WEIGHT + mythicEfficiencyScore * this.MYTHIC_WEIGHT;

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
