import mongoose, { Schema, Document } from "mongoose";

// Guild entry for distribution bucket tooltips
export interface IGuildEntry {
  name: string;
  realm: string;
  value?: number;
}

// Pre-calculated distribution bucket
export interface IDistributionBucket {
  label: string;
  count: number;
  guilds: IGuildEntry[];
}

// Pre-calculated distribution data
export interface IDistribution {
  buckets: IDistributionBucket[];
}

// Pre-calculated weekly progression entry
export interface IWeeklyProgressionEntry {
  weekNumber: number;
  value: number;
  label: string; // "W1", "W2", etc.
}

// Statistics for a single boss
export interface IBossAnalytics {
  bossId: number;
  bossName: string;
  guildsKilled: number; // Number of guilds that have killed this boss
  guildsProgressing: number; // Number of guilds currently progressing (pulled but not killed)
  pullCount: {
    average: number;
    lowest: number;
    highest: number;
  };
  timeSpent: {
    average: number; // in seconds
    lowest: number;
    highest: number;
  };
  // Pre-calculated distributions
  pullDistribution: IDistribution;
  timeDistribution: IDistribution;
  // Pre-calculated weekly progression
  weeklyProgression: IWeeklyProgressionEntry[];
}

// Overall raid statistics
export interface IRaidOverallAnalytics {
  guildsCleared: number; // Guilds that killed all bosses
  guildsProgressing: number; // Guilds that started but haven't cleared
  pullCount: {
    average: number;
    lowest: number;
    highest: number;
  };
  timeSpent: {
    average: number; // in seconds
    lowest: number;
    highest: number;
  };
  progressRaidTimeSpent: {
    average: number; // in seconds, includes breaks between progression pulls
    lowest: number;
    highest: number;
  };
  // Pre-calculated distributions
  pullDistribution: IDistribution;
  timeDistribution: IDistribution;
  progressRaidTimeDistribution: IDistribution;
  // Pre-calculated weekly progression
  weeklyProgression: IWeeklyProgressionEntry[];
}

export interface IRaidAnalytics extends Document {
  raidId: number;
  raidName: string;
  difficulty: "mythic";
  overall: IRaidOverallAnalytics;
  bosses: IBossAnalytics[];
  raidStart?: Date; // When the raid season started (EU)
  raidEnd?: Date; // When the raid season ended (EU), if applicable
  lastCalculated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GuildEntrySchema = new Schema(
  {
    name: { type: String, required: true },
    realm: { type: String, required: true },
    value: { type: Number },
  },
  { _id: false },
);

const DistributionBucketSchema = new Schema(
  {
    label: { type: String, required: true },
    count: { type: Number, required: true },
    guilds: [GuildEntrySchema],
  },
  { _id: false },
);

const DistributionSchema = new Schema(
  {
    buckets: [DistributionBucketSchema],
  },
  { _id: false },
);

const WeeklyProgressionEntrySchema = new Schema(
  {
    weekNumber: { type: Number, required: true },
    value: { type: Number, required: true },
    label: { type: String, required: true },
  },
  { _id: false },
);

const BossAnalyticsSchema = new Schema(
  {
    bossId: { type: Number, required: true },
    bossName: { type: String, required: true },
    guildsKilled: { type: Number, default: 0 },
    guildsProgressing: { type: Number, default: 0 },
    pullCount: {
      average: { type: Number, default: 0 },
      lowest: { type: Number, default: 0 },
      highest: { type: Number, default: 0 },
    },
    timeSpent: {
      average: { type: Number, default: 0 },
      lowest: { type: Number, default: 0 },
      highest: { type: Number, default: 0 },
    },
    pullDistribution: { type: DistributionSchema, default: { buckets: [] } },
    timeDistribution: { type: DistributionSchema, default: { buckets: [] } },
    weeklyProgression: [WeeklyProgressionEntrySchema],
  },
  { _id: false },
);

const RaidOverallAnalyticsSchema = new Schema(
  {
    guildsCleared: { type: Number, default: 0 },
    guildsProgressing: { type: Number, default: 0 },
    pullCount: {
      average: { type: Number, default: 0 },
      lowest: { type: Number, default: 0 },
      highest: { type: Number, default: 0 },
    },
    timeSpent: {
      average: { type: Number, default: 0 },
      lowest: { type: Number, default: 0 },
      highest: { type: Number, default: 0 },
    },
    progressRaidTimeSpent: {
      average: { type: Number, default: 0 },
      lowest: { type: Number, default: 0 },
      highest: { type: Number, default: 0 },
    },
    pullDistribution: { type: DistributionSchema, default: { buckets: [] } },
    timeDistribution: { type: DistributionSchema, default: { buckets: [] } },
    progressRaidTimeDistribution: { type: DistributionSchema, default: { buckets: [] } },
    weeklyProgression: [WeeklyProgressionEntrySchema],
  },
  { _id: false },
);

const RaidAnalyticsSchema: Schema = new Schema(
  {
    raidId: { type: Number, required: true, unique: true },
    raidName: { type: String, required: true },
    difficulty: { type: String, enum: ["mythic"], default: "mythic" },
    overall: { type: RaidOverallAnalyticsSchema, required: true },
    bosses: [BossAnalyticsSchema],
    raidStart: { type: Date },
    raidEnd: { type: Date },
    lastCalculated: { type: Date, required: true },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IRaidAnalytics>("RaidAnalytics", RaidAnalyticsSchema);
