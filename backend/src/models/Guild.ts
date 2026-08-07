import mongoose, { Schema, Document } from "mongoose";
import StreamerSchema, { IStreamer } from "./Streamer";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;
const ACCENT_INSENSITIVE_COLLATION = { locale: "en", strength: 1 } as const;

export interface IBestPullPhase {
  phaseId: number;
  phaseName: string;
  bossHealth: number; // Boss health at wipe
  fightCompletion: number; // Fight % at wipe
  displayString: string; // e.g., "45% P3"
}

// Pull history entry for progress charts
export interface IPullHistoryEntry {
  pullNumber: number;
  fightPercentage: number; // Raw WCL value; zero can also mean unavailable on old reports
  phase?: string; // Phase identifier like "P1", "P2", "I1" etc.
  isKill: boolean;
  reportCode?: string;
  fightId?: number;
  url?: string;
  timestamp?: Date;
  duration?: number; // seconds
  bossPercentage?: number;
  progressDisplay?: string;
}

export interface IBossProgress {
  bossId: number;
  bossName: string;
  kills: number;
  bestPercent: number; // Best pull: lowest resolved fight/boss progress % reached (0 = complete, 100 = no progress)
  bestPhase?: number; // Best phase reached (for multi-phase bosses)
  pullCount: number;
  timeSpent: number; // in seconds
  firstKillTime?: Date;
  firstKillReportCode?: string; // WCL report code for first kill (e.g., "a:1234567890")
  firstKillFightId?: number; // Fight ID within the report for first kill
  killOrder?: number; // Order in which this boss was first killed (1 = first boss killed, 2 = second, etc.)
  bestPullPhase?: IBestPullPhase; // Phase context for best pull
  bestPullReportCode?: string; // WCL report code for best pull (for unkilled bosses)
  bestPullFightId?: number; // Fight ID within the report for best pull (for unkilled bosses)
  pullHistory?: IPullHistoryEntry[]; // Pull history for progress charts (up to first kill)
  lastUpdated: Date;
}

export interface IRaidProgress {
  raidId: number;
  raidName: string;
  difficulty: "mythic" | "heroic";
  bossesDefeated: number;
  totalBosses: number;
  totalTimeSpent: number; // in seconds
  totalCombatTimeSpent?: number; // in seconds, includes all logged combat pulls
  progressRaidTimeSpent?: number; // in seconds, includes time between valid progression pulls
  totalRaidTimeSpent?: number; // in seconds, includes time between all valid logged pulls
  bosses: IBossProgress[];
  worldRank?: number; // Best (lowest) world rank from either WCL or Raider.IO
  worldRankColor?: string; // Color class for the displayed world rank (e.g., "rare", "epic", "legendary")
  wclWorldRank?: number; // World rank from WarcraftLogs
  wclWorldRankColor?: string; // Color class from WarcraftLogs
  rioWorldRank?: number; // World rank from Raider.IO
  guildRank?: number; // Rank among tracked guilds (1 = best)
  lastUpdated: Date;
}

export interface IGuildCrest {
  emblem: {
    id: number;
    imageName: string; // e.g., "emblem_22.png"
    color: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
  border: {
    id: number;
    imageName: string; // e.g., "border_0.png"
    color: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
  background: {
    color: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
}

export interface IOfficialRaidProgress {
  raidTierSlug: string; // e.g., "tier-mn-1" from Raider.IO
  summary: string; // e.g., "6/9 M"
  totalBosses: number;
  normalBossesKilled: number;
  heroicBossesKilled: number;
  mythicBossesKilled: number;
  lastUpdated: Date;
}

export interface IRaidScheduleDay {
  day: string; // "Monday", "Tuesday", etc.
  startHour: number; // 0-23.5 (supports half hours: 0, 0.5, 1, 1.5, ..., 23, 23.5)
  endHour: number; // 0-23.5 (supports half hours: 0, 0.5, 1, 1.5, ..., 23, 23.5)
  raidCount: number; // How many raids occurred on this day/time slot
}

export interface IRaidSchedule {
  days: IRaidScheduleDay[]; // Most common raiding days and hours
  lastCalculated?: Date;
}

export interface IGuild extends Document {
  name: string;
  realm: string;
  region: string;
  faction?: string;
  warcraftlogsId?: number; // WarcraftLogs guild ID
  iconUrl?: string;
  crest?: IGuildCrest;
  horseRaceUmaImage?: string; // Optional reserved Uma image filename for the frontpage horse race
  parent_guild?: string; // Parent guild name if this is a team/sub-guild
  streamers?: IStreamer[]; // Twitch streamers associated with this guild
  progress: IRaidProgress[];
  officialProgress?: IOfficialRaidProgress[]; // Raid progression from Raider.IO (reflects in-game kills, not log-dependent)
  raidSchedule?: IRaidSchedule; // Calculated raiding schedule for current tier
  isCurrentlyRaiding: boolean;
  lastLogEndTime?: Date; // End time of the most recent log (for activity tracking)
  activityStatus?: "active" | "inactive"; // active = logs within 14 days, inactive = no logs for 14+ days
  // Raid tier IDs to exclude this guild from (hidden from progress, tier lists, rankings, etc.)
  excludedRaidIds?: number[];
  wclStatus?: "active" | "not_found" | "unclaimed" | "unknown"; // Tracks whether the guild exists on WarcraftLogs
  wclStatusUpdatedAt?: Date; // When the WCL status was last checked/updated
  wclNotFoundCount?: number; // Consecutive "guild not found" errors count
  rioStatus?: "active" | "not_found" | "unknown"; // Tracks whether the guild exists on Raider.IO
  lastRioUpdate?: Date; // When Raider.IO data was last fetched/checked
  initialFetchCompleted?: boolean; // Whether initial background fetch was completed (even if no reports were found)
  initialFetchCompletedAt?: Date; // When the initial fetch was completed
  lastFetched?: Date;
  wclUpdateLockToken?: string;
  wclUpdateStartedAt?: Date;
  logSourceMigrationLockToken?: string;
  logSourceMigrationLockedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BossProgressSchema: Schema = new Schema(
  {
    bossId: { type: Number, required: true },
    bossName: { type: String, required: true },
    kills: { type: Number, default: 0 },
    bestPercent: { type: Number, default: 100 }, // Default 100 = worst (full health), track lowest (best)
    bestPhase: { type: Number },
    pullCount: { type: Number, default: 0 },
    timeSpent: { type: Number, default: 0 },
    firstKillTime: { type: Date },
    firstKillReportCode: { type: String },
    firstKillFightId: { type: Number },
    killOrder: { type: Number },
    bestPullPhase: {
      phaseId: { type: Number },
      phaseName: { type: String },
      bossHealth: { type: Number },
      fightCompletion: { type: Number },
      displayString: { type: String },
    },
    bestPullReportCode: { type: String },
    bestPullFightId: { type: Number },
    pullHistory: [
      {
        pullNumber: { type: Number, required: true },
        fightPercentage: { type: Number, required: true },
        phase: { type: String },
        isKill: { type: Boolean, required: true },
        reportCode: { type: String },
        fightId: { type: Number },
        url: { type: String },
        timestamp: { type: Date },
        duration: { type: Number },
        bossPercentage: { type: Number },
        progressDisplay: { type: String },
      },
    ],
    lastUpdated: { type: Date, default: Date.now },
  },
  { _id: false },
);

const RaidProgressSchema: Schema = new Schema(
  {
    raidId: { type: Number, required: true },
    raidName: { type: String, required: true },
    difficulty: { type: String, enum: ["mythic", "heroic"], required: true },
    bossesDefeated: { type: Number, default: 0 },
    totalBosses: { type: Number, required: true },
    totalTimeSpent: { type: Number, default: 0 },
    totalCombatTimeSpent: { type: Number, default: 0 },
    progressRaidTimeSpent: { type: Number, default: 0 },
    totalRaidTimeSpent: { type: Number, default: 0 },
    bosses: [BossProgressSchema],
    worldRank: { type: Number }, // Best (lowest) world rank from either WCL or Raider.IO
    worldRankColor: { type: String }, // Color class for the displayed world rank
    wclWorldRank: { type: Number }, // World rank from WarcraftLogs
    wclWorldRankColor: { type: String }, // Color class from WarcraftLogs
    rioWorldRank: { type: Number }, // World rank from Raider.IO
    guildRank: { type: Number }, // Rank among tracked guilds (1 = best)
    lastUpdated: { type: Date, default: Date.now },
  },
  { _id: false },
);

const GuildSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    realm: { type: String, required: true },
    region: { type: String, required: true, default: "EU" },
    faction: { type: String },
    warcraftlogsId: { type: Number }, // WarcraftLogs guild ID
    iconUrl: { type: String },
    horseRaceUmaImage: { type: String },
    crest: {
      emblem: {
        id: { type: Number },
        imageName: { type: String },
        color: {
          r: { type: Number },
          g: { type: Number },
          b: { type: Number },
          a: { type: Number },
        },
      },
      border: {
        id: { type: Number },
        imageName: { type: String },
        color: {
          r: { type: Number },
          g: { type: Number },
          b: { type: Number },
          a: { type: Number },
        },
      },
      background: {
        color: {
          r: { type: Number },
          g: { type: Number },
          b: { type: Number },
          a: { type: Number },
        },
      },
    },
    parent_guild: { type: String }, // Parent guild name if this is a team/sub-guild
    streamers: [StreamerSchema], // Twitch streamers associated with this guild
    progress: [RaidProgressSchema],
    officialProgress: [
      {
        raidTierSlug: { type: String, required: true },
        summary: { type: String, required: true },
        totalBosses: { type: Number, required: true },
        normalBossesKilled: { type: Number, default: 0 },
        heroicBossesKilled: { type: Number, default: 0 },
        mythicBossesKilled: { type: Number, default: 0 },
        lastUpdated: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    raidSchedule: {
      days: [
        {
          day: { type: String, required: true },
          startHour: { type: Number, required: true },
          endHour: { type: Number, required: true },
          raidCount: { type: Number, required: true },
        },
      ],
      lastCalculated: { type: Date },
    },
    isCurrentlyRaiding: { type: Boolean, default: false },
    lastLogEndTime: { type: Date }, // End time of the most recent log
    activityStatus: { type: String, enum: ["active", "inactive"], default: "active" }, // Track guild activity (active = logs within 14 days)
    excludedRaidIds: [{ type: Number }], // Raid tier IDs to exclude this guild from
    wclStatus: { type: String, enum: ["active", "not_found", "unclaimed", "unknown"], default: "unknown" }, // Tracks whether the guild exists on WarcraftLogs
    wclStatusUpdatedAt: { type: Date }, // When the WCL status was last checked/updated
    wclNotFoundCount: { type: Number, default: 0 }, // Consecutive "guild not found" errors count
    rioStatus: { type: String, enum: ["active", "not_found", "unknown"], default: "unknown" }, // Tracks whether the guild exists on Raider.IO
    lastRioUpdate: { type: Date }, // When Raider.IO data was last fetched/checked
    initialFetchCompleted: { type: Boolean, default: false }, // Whether initial background fetch was completed
    initialFetchCompletedAt: { type: Date }, // When the initial fetch was completed
    lastFetched: { type: Date },
    wclUpdateLockToken: { type: String },
    wclUpdateStartedAt: { type: Date },
    logSourceMigrationLockToken: { type: String },
    logSourceMigrationLockedAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

// Compound index for guild lookup
GuildSchema.index({ name: 1, realm: 1, region: 1 }, { unique: true });
GuildSchema.index({ realm: 1, name: 1 }, { collation: CASE_INSENSITIVE_COLLATION });
GuildSchema.index({ name: 1, realm: 1 }, { collation: ACCENT_INSENSITIVE_COLLATION });

// Compound index for progress queries (used by getAllGuildsForRaid)
GuildSchema.index({ "progress.raidId": 1, "progress.bossesDefeated": -1 });

// Index for isCurrentlyRaiding (used to filter active guilds)
GuildSchema.index({ isCurrentlyRaiding: 1 });

// Index for guildStatus (used to filter by status)
GuildSchema.index({ guildStatus: 1 });

// Index for lastFetched (used in background processing to find outdated guilds)
GuildSchema.index({ lastFetched: 1 });
GuildSchema.index({ logSourceMigrationLockToken: 1 }, { sparse: true });

// Index for lastLogEndTime (used to find inactive/recently active guilds)
GuildSchema.index({ lastLogEndTime: 1 });

export default mongoose.model<IGuild>("Guild", GuildSchema);
