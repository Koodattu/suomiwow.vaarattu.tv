import Pickem, { IPickem, IScoringConfig, IStreakConfig, IPrizeConfig, DEFAULT_SCORING_CONFIG, DEFAULT_STREAK_CONFIG, DEFAULT_PRIZE_CONFIG, PickemType } from "../models/Pickem";
import { PICKEM_SEED_DATA } from "../config/pickems";
import { PICK_EM_RWF_GUILDS } from "../config/guilds";
import logger from "../utils/logger";
import { getRegularPickemRaidIdsValidationError, isPickemPlaceholderRaidIds } from "../utils/pickemRaid";

class PickemService {
  /**
   * Seed pickems from config to database
   * Only creates pickems that don't already exist (by pickemId)
   */
  async seedPickems(): Promise<void> {
    logger.info("Seeding pickems from configuration...");

    for (const seedData of PICKEM_SEED_DATA) {
      try {
        const existing = await Pickem.findOne({ pickemId: seedData.pickemId });

        if (!existing) {
          const type = seedData.type || "regular";
          const guildCount = seedData.guildCount ?? 10;
          const finalRankingsCount = seedData.finalRankingsCount ?? 0;
          const scoreOutOfRangeGuilds = seedData.scoreOutOfRangeGuilds ?? false;

          await Pickem.create({
            pickemId: seedData.pickemId,
            name: seedData.name,
            type,
            raidIds: seedData.raidIds || [],
            guildCount,
            finalRankingsCount,
            scoreOutOfRangeGuilds,
            votingStart: seedData.votingStart,
            votingEnd: seedData.votingEnd,
            active: seedData.active,
            scoringConfig: seedData.scoringConfig || DEFAULT_SCORING_CONFIG,
            streakConfig: seedData.streakConfig || DEFAULT_STREAK_CONFIG,
            prizeConfig: seedData.prizeConfig || DEFAULT_PRIZE_CONFIG,
          });
          logger.info(`Created pickem: ${seedData.pickemId}`);
        } else {
          logger.debug(`Pickem already exists: ${seedData.pickemId}`);
        }
      } catch (error) {
        logger.error(`Error seeding pickem ${seedData.pickemId}:`, error);
      }
    }

    logger.info("Pickem seeding complete");
  }

  /**
   * Get all pickems
   */
  async getAllPickems(): Promise<IPickem[]> {
    return Pickem.find().sort({ votingStart: -1 }).lean();
  }

  /**
   * Get all active pickems
   */
  async getActivePickems(): Promise<IPickem[]> {
    return Pickem.find({ active: true }).sort({ votingStart: -1 }).lean();
  }

  /**
   * Get a specific pickem by ID
   */
  async getPickemById(pickemId: string): Promise<IPickem | null> {
    return Pickem.findOne({ pickemId }).lean();
  }

  /**
   * Create a new pickem
   */
  async createPickem(data: {
    pickemId: string;
    name: string;
    type?: PickemType;
    raidIds?: number[];
    guildCount?: number;
    finalRankingsCount?: number;
    scoreOutOfRangeGuilds?: boolean;
    votingStart: Date;
    votingEnd: Date;
    active?: boolean;
    scoringConfig?: Partial<IScoringConfig>;
    streakConfig?: Partial<IStreakConfig>;
    prizeConfig?: Partial<IPrizeConfig>;
  }): Promise<IPickem> {
    const type = data.type || "regular";
    const guildCount = data.guildCount ?? 10;
    const finalRankingsCount = data.finalRankingsCount ?? 0;
    const scoreOutOfRangeGuilds = data.scoreOutOfRangeGuilds ?? false;

    if (type === "regular") {
      const raidIdsError = getRegularPickemRaidIdsValidationError(data.raidIds);
      if (raidIdsError) {
        throw new Error(raidIdsError);
      }
    }

    const pickem = await Pickem.create({
      pickemId: data.pickemId,
      name: data.name,
      type,
      raidIds: data.raidIds || [],
      guildCount,
      finalRankingsCount,
      scoreOutOfRangeGuilds,
      votingStart: data.votingStart,
      votingEnd: data.votingEnd,
      active: data.active ?? true,
      scoringConfig: { ...DEFAULT_SCORING_CONFIG, ...data.scoringConfig },
      streakConfig: { ...DEFAULT_STREAK_CONFIG, ...data.streakConfig },
      prizeConfig: { ...DEFAULT_PRIZE_CONFIG, ...data.prizeConfig },
    });

    return pickem.toObject();
  }

  /**
   * Update an existing pickem
   */
  async updatePickem(
    pickemId: string,
    data: {
      name?: string;
      type?: PickemType;
      raidIds?: number[];
      guildCount?: number;
      finalRankingsCount?: number;
      scoreOutOfRangeGuilds?: boolean;
      votingStart?: Date;
      votingEnd?: Date;
      active?: boolean;
      scoringConfig?: Partial<IScoringConfig>;
      streakConfig?: Partial<IStreakConfig>;
      prizeConfig?: Partial<IPrizeConfig>;
    },
  ): Promise<IPickem | null> {
    const pickem = await Pickem.findOne({ pickemId });
    if (!pickem) return null;

    if (data.raidIds !== undefined) {
      if (pickem.type === "regular") {
        const raidIdsError = getRegularPickemRaidIdsValidationError(data.raidIds);
        if (raidIdsError) {
          throw new Error(raidIdsError);
        }
      } else if (data.raidIds.length !== 0) {
        throw new Error("raidIds must be empty for RWF pickems");
      }
    }

    if (data.name !== undefined) pickem.name = data.name;
    if (data.type !== undefined) pickem.type = data.type;
    if (data.raidIds !== undefined) pickem.raidIds = data.raidIds;
    if (data.guildCount !== undefined) pickem.guildCount = data.guildCount;
    if (data.finalRankingsCount !== undefined) pickem.finalRankingsCount = data.finalRankingsCount;
    if (data.scoreOutOfRangeGuilds !== undefined) pickem.scoreOutOfRangeGuilds = data.scoreOutOfRangeGuilds;
    if (data.votingStart !== undefined) pickem.votingStart = data.votingStart;
    if (data.votingEnd !== undefined) pickem.votingEnd = data.votingEnd;
    if (data.active !== undefined) pickem.active = data.active;

    if (data.scoringConfig) {
      pickem.scoringConfig = {
        ...pickem.scoringConfig,
        ...data.scoringConfig,
      };
    }

    if (data.streakConfig) {
      pickem.streakConfig = {
        ...pickem.streakConfig,
        ...data.streakConfig,
      };
    }

    if (data.prizeConfig) {
      pickem.prizeConfig = {
        ...pickem.prizeConfig,
        ...data.prizeConfig,
      };
    }

    await pickem.save();
    return pickem.toObject();
  }

  /**
   * Delete a pickem
   */
  async deletePickem(pickemId: string): Promise<boolean> {
    const result = await Pickem.deleteOne({ pickemId });
    return result.deletedCount > 0;
  }

  /**
   * Get pickem statistics
   */
  async getPickemStats(): Promise<{
    total: number;
    active: number;
    votingOpen: number;
  }> {
    const now = new Date();

    const [total, active, votingOpen] = await Promise.all([
      Pickem.countDocuments(),
      Pickem.countDocuments({ active: true }),
      Pickem.countDocuments({
        active: true,
        votingStart: { $lte: now },
        votingEnd: { $gte: now },
      }),
    ]);

    return { total, active, votingOpen };
  }

  /**
   * Finalize an RWF pickem with final rankings
   * This sets the final results and marks the pickem as finalized
   * Only applicable to RWF-type pickems
   */
  async finalizeRwfPickem(pickemId: string, finalRankings: string[]): Promise<{ success: boolean; pickem?: IPickem; error?: string }> {
    const pickem = await Pickem.findOne({ pickemId });

    if (!pickem) {
      return { success: false, error: "Pickem not found" };
    }

    if (pickem.type !== "rwf") {
      return { success: false, error: "Only RWF pickems can be finalized with rankings. Use finalizeRegularPickem for regular pickems." };
    }

    if (pickem.finalized) {
      return { success: false, error: "Pickem has already been finalized" };
    }

    // Validate that all guilds in finalRankings are valid RWF guilds
    const invalidGuilds = finalRankings.filter((guild) => !PICK_EM_RWF_GUILDS.includes(guild));
    if (invalidGuilds.length > 0) {
      return { success: false, error: `Invalid guilds in rankings: ${invalidGuilds.join(", ")}` };
    }

    // Validate ranking count matches finalRankingsCount (or guildCount if not configured)
    const expectedCount = pickem.finalRankingsCount || pickem.guildCount;
    if (finalRankings.length !== expectedCount) {
      return { success: false, error: `Expected ${expectedCount} guilds in rankings, got ${finalRankings.length}` };
    }

    // Validate no duplicate guilds
    const uniqueGuilds = new Set(finalRankings);
    if (uniqueGuilds.size !== finalRankings.length) {
      return { success: false, error: "Duplicate guilds in rankings" };
    }

    // Update pickem with final rankings
    pickem.finalRankings = finalRankings;
    pickem.finalized = true;
    pickem.finalizedAt = new Date();

    await pickem.save();

    logger.info(`Finalized RWF pickem ${pickemId} with rankings: ${finalRankings.join(", ")}`);

    return { success: true, pickem: pickem.toObject() };
  }

  /**
   * Finalize a regular pickem (admin marks the race as over, rankings are locked)
   * For regular pickems, no finalRankings are needed — scores are derived from live guild data.
   */
  async finalizeRegularPickem(pickemId: string): Promise<{ success: boolean; pickem?: IPickem; error?: string }> {
    const pickem = await Pickem.findOne({ pickemId });

    if (!pickem) {
      return { success: false, error: "Pickem not found" };
    }

    if (pickem.type !== "regular") {
      return { success: false, error: "Use finalizeRwfPickem for RWF pickems" };
    }

    if (pickem.finalized) {
      return { success: false, error: "Pickem has already been finalized" };
    }

    if (isPickemPlaceholderRaidIds(pickem.raidIds)) {
      return { success: false, error: "Replace the upcoming raid placeholder with the real raid before finalizing" };
    }

    pickem.finalized = true;
    pickem.finalizedAt = new Date();

    await pickem.save();

    logger.info(`Finalized regular pickem ${pickemId}`);

    return { success: true, pickem: pickem.toObject() };
  }

  /**
   * Unfinalize a pickem (admin correction)
   * Works for both RWF and regular pickems.
   * For RWF pickems, this also clears the final rankings.
   */
  async unfinalizePickem(pickemId: string): Promise<{ success: boolean; pickem?: IPickem; error?: string }> {
    const pickem = await Pickem.findOne({ pickemId });

    if (!pickem) {
      return { success: false, error: "Pickem not found" };
    }

    if (!pickem.finalized) {
      return { success: false, error: "Pickem is not finalized" };
    }

    // Clear finalization
    if (pickem.type === "rwf") {
      pickem.finalRankings = [];
    }
    pickem.finalized = false;
    pickem.finalizedAt = null;

    await pickem.save();

    logger.info(`Unfinalized pickem ${pickemId} (type: ${pickem.type})`);

    return { success: true, pickem: pickem.toObject() };
  }
}

export default new PickemService();
