import Pickem, {
  IPickem,
  IScoringConfig,
  IStreakConfig,
  IPrizeConfig,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_STREAK_CONFIG,
  DEFAULT_PRIZE_CONFIG,
  DEFAULT_PICKEM_CCG_REWARD_PACKS,
  PickemType,
} from "../models/Pickem";
import User from "../models/User";
import CcgPackCredit from "../models/CcgPackCredit";
import { PICK_EM_RWF_GUILDS } from "../config/guilds";
import logger from "../utils/logger";
import { getRegularPickemRaidIdsValidationError, isPickemPlaceholderRaidIds } from "../utils/pickemRaid";

export interface PickemDeletionResult {
  pickemDeleted: boolean;
  affectedUsers: number;
}

export class PickemRewardConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickemRewardConfigurationError";
  }
}

class PickemService {
  private readonly mutationTails = new Map<string, Promise<void>>();

  async runWithMutationLock<T>(pickemId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(pickemId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.mutationTails.set(pickemId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(pickemId) === tail) {
        this.mutationTails.delete(pickemId);
      }
    }
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

  async ensureCcgRewardDefaults(now = new Date()): Promise<{ rewarded: number; disabled: number }> {
    const missingReward = {
      $or: [
        { ccgRewardPacks: { $exists: false } },
        { ccgRewardPacks: null },
      ],
    };

    const [rewarded, disabled] = await Promise.all([
      Pickem.updateMany(
        { ...missingReward, votingEnd: { $gte: now } },
        { $set: { ccgRewardPacks: DEFAULT_PICKEM_CCG_REWARD_PACKS } },
      ),
      Pickem.updateMany(
        { ...missingReward, votingEnd: { $lt: now } },
        { $set: { ccgRewardPacks: 0 } },
      ),
    ]);

    const result = { rewarded: rewarded.modifiedCount, disabled: disabled.modifiedCount };
    if (result.rewarded > 0 || result.disabled > 0) {
      logger.info(`[Pickem] Initialized CCG rewards: ${result.rewarded} current/future, ${result.disabled} expired`);
    }
    return result;
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
    ccgRewardPacks?: number;
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
      ccgRewardPacks: data.ccgRewardPacks ?? DEFAULT_PICKEM_CCG_REWARD_PACKS,
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
      ccgRewardPacks?: number;
      active?: boolean;
      scoringConfig?: Partial<IScoringConfig>;
      streakConfig?: Partial<IStreakConfig>;
      prizeConfig?: Partial<IPrizeConfig>;
    },
  ): Promise<IPickem | null> {
    const pickem = await Pickem.findOne({ pickemId });
    if (!pickem) return null;

    if (data.ccgRewardPacks !== undefined && data.ccgRewardPacks !== pickem.ccgRewardPacks) {
      const hasClaims = await CcgPackCredit.exists({ sourceKey: `pickem-reward:${pickem._id}` });
      if (hasClaims) {
        throw new PickemRewardConfigurationError("The CCG pack reward cannot be changed after the first claim");
      }
    }

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
    if (data.ccgRewardPacks !== undefined) pickem.ccgRewardPacks = data.ccgRewardPacks;
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
   * Delete a pickem and every user submission associated with it.
   */
  async deletePickem(pickemId: string): Promise<PickemDeletionResult> {
    return this.runWithMutationLock(pickemId, async () => {
      await Pickem.updateOne({ pickemId }, { $set: { active: false } });
      const userResult = await User.updateMany({ "pickems.pickemId": pickemId }, { $pull: { pickems: { pickemId } } });
      const pickemResult = await Pickem.deleteOne({ pickemId });
      const result = {
        pickemDeleted: pickemResult.deletedCount > 0,
        affectedUsers: userResult.modifiedCount,
      };

      logger.info(`Deleted pickem ${pickemId}: document=${result.pickemDeleted}, affectedUsers=${result.affectedUsers}`);
      return result;
    });
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
