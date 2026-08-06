import mongoose, { Schema, Document } from "mongoose";

// Scoring configuration for a pickem
export interface IScoringConfig {
  exactMatch: number; // Points for exact position match
  offByOne: number; // Points for being off by 1 position
  offByTwo: number; // Points for being off by 2 positions
  offByThree: number; // Points for being off by 3 positions
  offByFour: number; // Points for being off by 4 positions
  offByFiveOrMore: number; // Points for being off by 5+ positions
}

// Streak bonus configuration
export interface IStreakConfig {
  enabled: boolean; // Whether streak bonuses are enabled
  minStreak: number; // Minimum streak length to award bonus (e.g., 2)
  bonusPerGuild: number; // Bonus points per guild in streak (e.g., 2 extra per guild)
}

// Prize configuration for a pickem
export interface IPrizeConfig {
  enabled: boolean;
  goldPool: number;
  distribution: { place: number; percentage: number }[];
  description: string;
}

// Pickem type: regular (Finnish guilds from DB) or rwf (Race to World First guilds from config)
export type PickemType = "regular" | "rwf";

export const DEFAULT_PICKEM_CCG_REWARD_PACKS = 25;
export const MAX_PICKEM_CCG_REWARD_PACKS = 100;

// Pickem document interface
export interface IPickem extends Document {
  pickemId: string; // Unique identifier (e.g., "season-one")
  name: string; // Display name
  type: PickemType; // Type of pickem: "regular" for Finnish guilds, "rwf" for Race to World First
  raidIds: number[]; // Array of raid IDs included in this pickem (only used for regular type)
  guildCount: number; // Number of guilds to predict (10 for regular, 5 for rwf)
  finalRankingsCount: number; // Number of guilds required for finalization (e.g., 10 for RWF) — defaults to guildCount if not set
  scoreOutOfRangeGuilds: boolean; // For regular pickems, award points for picked guilds ranked beyond guildCount
  votingStart: Date; // When voting opens
  votingEnd: Date; // When voting closes
  ccgRewardPacks: number; // Generic CCG packs available for an explicit participant claim
  active: boolean; // Whether this pickem is visible/active
  scoringConfig: IScoringConfig; // Point configuration
  streakConfig: IStreakConfig; // Streak bonus configuration
  prizeConfig: IPrizeConfig; // Prize pool configuration
  // RWF-specific finalization fields
  finalized: boolean; // Whether this RWF pickem has been finalized with results
  finalRankings: string[]; // Final guild rankings (in order, index 0 = 1st place) - only for RWF
  finalizedAt: Date | null; // When the pickem was finalized
  createdAt: Date;
  updatedAt: Date;
}

// Default scoring configuration
export const DEFAULT_SCORING_CONFIG: IScoringConfig = {
  exactMatch: 10,
  offByOne: 8,
  offByTwo: 6,
  offByThree: 4,
  offByFour: 2,
  offByFiveOrMore: 0,
};

// Default streak configuration
export const DEFAULT_STREAK_CONFIG: IStreakConfig = {
  enabled: true,
  minStreak: 2,
  bonusPerGuild: 2,
};

export const DEFAULT_PRIZE_CONFIG: IPrizeConfig = {
  enabled: false,
  goldPool: 0,
  distribution: [],
  description: "",
};

const ScoringConfigSchema = new Schema<IScoringConfig>(
  {
    exactMatch: { type: Number, required: true, default: 10 },
    offByOne: { type: Number, required: true, default: 8 },
    offByTwo: { type: Number, required: true, default: 6 },
    offByThree: { type: Number, required: true, default: 4 },
    offByFour: { type: Number, required: true, default: 2 },
    offByFiveOrMore: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const StreakConfigSchema = new Schema<IStreakConfig>(
  {
    enabled: { type: Boolean, required: true, default: true },
    minStreak: { type: Number, required: true, default: 2 },
    bonusPerGuild: { type: Number, required: true, default: 2 },
  },
  { _id: false },
);

const PrizeDistributionSchema = new Schema(
  {
    place: { type: Number, required: true, min: 1 },
    percentage: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const PrizeConfigSchema = new Schema<IPrizeConfig>(
  {
    enabled: { type: Boolean, required: true, default: false },
    goldPool: { type: Number, required: true, default: 0, min: 0 },
    distribution: { type: [PrizeDistributionSchema], required: true, default: [] },
    description: { type: String, required: false, default: "" },
  },
  { _id: false },
);

const PickemSchema = new Schema<IPickem>(
  {
    pickemId: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["regular", "rwf"], required: true, default: "regular" },
    raidIds: {
      type: [Number],
      required: function (this: IPickem) {
        return this.type === "regular";
      },
      default: [],
    },
    guildCount: { type: Number, required: true, default: 10 },
    finalRankingsCount: { type: Number, required: false, default: 0 },
    scoreOutOfRangeGuilds: { type: Boolean, required: true, default: false },
    votingStart: { type: Date, required: true },
    votingEnd: { type: Date, required: true },
    ccgRewardPacks: {
      type: Number,
      required: true,
      default: DEFAULT_PICKEM_CCG_REWARD_PACKS,
      min: 0,
      max: MAX_PICKEM_CCG_REWARD_PACKS,
    },
    active: { type: Boolean, required: true, default: true },
    scoringConfig: { type: ScoringConfigSchema, required: true, default: () => DEFAULT_SCORING_CONFIG },
    streakConfig: { type: StreakConfigSchema, required: true, default: () => DEFAULT_STREAK_CONFIG },
    prizeConfig: { type: PrizeConfigSchema, required: true, default: () => DEFAULT_PRIZE_CONFIG },
    // RWF-specific finalization fields
    finalized: { type: Boolean, required: true, default: false },
    finalRankings: { type: [String], required: false, default: [] },
    finalizedAt: { type: Date, required: false, default: null },
  },
  {
    timestamps: true,
  },
);

// Index for fast lookup by pickemId
PickemSchema.index({ pickemId: 1 }, { unique: true });

// Index for finding active pickems
PickemSchema.index({ active: 1 });

/**
 * Calculate points for a single prediction based on scoring config
 */
export function calculatePickemPoints(predictedRank: number, actualRank: number, scoringConfig: IScoringConfig = DEFAULT_SCORING_CONFIG): number {
  const diff = Math.abs(predictedRank - actualRank);
  switch (diff) {
    case 0:
      return scoringConfig.exactMatch;
    case 1:
      return scoringConfig.offByOne;
    case 2:
      return scoringConfig.offByTwo;
    case 3:
      return scoringConfig.offByThree;
    case 4:
      return scoringConfig.offByFour;
    default:
      return scoringConfig.offByFiveOrMore;
  }
}

/**
 * Calculate streak bonus for predictions
 * A streak occurs when predicted guilds appear in the same relative order in actual rankings
 * For example: if you predict A, B, C at positions 1, 2, 3 and they finish at 5, 6, 7,
 * you get a streak bonus because A < B < C in both predicted and actual rankings
 */
export function calculateStreakBonus(
  predictions: { guildName: string; realm: string; predictedRank: number; actualRank: number | null }[],
  streakConfig: IStreakConfig = DEFAULT_STREAK_CONFIG,
): { totalBonus: number; streaks: { length: number; guilds: string[] }[] } {
  if (!streakConfig.enabled) {
    return { totalBonus: 0, streaks: [] };
  }

  // Sort predictions by predicted rank
  const sortedPredictions = [...predictions].filter((p) => p.actualRank !== null).sort((a, b) => a.predictedRank - b.predictedRank);

  if (sortedPredictions.length < streakConfig.minStreak) {
    return { totalBonus: 0, streaks: [] };
  }

  // Find streaks where guilds maintain their relative order
  const streaks: { length: number; guilds: string[] }[] = [];
  let currentStreak: typeof sortedPredictions = [];

  for (let i = 0; i < sortedPredictions.length; i++) {
    const current = sortedPredictions[i];

    if (currentStreak.length === 0) {
      currentStreak.push(current);
    } else {
      const lastInStreak = currentStreak[currentStreak.length - 1];
      // Check if current guild's actual rank is higher (greater number) than last guild's actual rank
      // This means they maintained relative order
      if (current.actualRank! > lastInStreak.actualRank!) {
        currentStreak.push(current);
      } else {
        // Streak broken - save if long enough
        if (currentStreak.length >= streakConfig.minStreak) {
          streaks.push({
            length: currentStreak.length,
            guilds: currentStreak.map((p) => p.guildName),
          });
        }
        // Start new streak with current guild
        currentStreak = [current];
      }
    }
  }

  // Don't forget the last streak
  if (currentStreak.length >= streakConfig.minStreak) {
    streaks.push({
      length: currentStreak.length,
      guilds: currentStreak.map((p) => p.guildName),
    });
  }

  // Calculate total bonus
  // Each guild in a streak (beyond the minimum) gets bonus points
  let totalBonus = 0;
  for (const streak of streaks) {
    // Bonus = bonusPerGuild * length of streak
    totalBonus += streakConfig.bonusPerGuild * streak.length;
  }

  return { totalBonus, streaks };
}

export default mongoose.model<IPickem>("Pickem", PickemSchema);
