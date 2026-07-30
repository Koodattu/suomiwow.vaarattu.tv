import mongoose, { Schema, Document } from "mongoose";

export interface IPhaseTransition {
  id: number; // Phase ID (1-indexed)
  startTime: number; // When phase started (ms, relative to report start)
  name?: string; // Phase name if available
}

export interface IPlayerDeath {
  name: string; // Character name
  server: string; // Server/realm name (normalized)
  timestamp: number; // When death occurred (ms, relative to report start)
  deathTime: number; // Fight time when death occurred (ms, relative to fight start)
}

export type DeathEventsFetchStatus = "pending" | "fetched" | "failed" | "archived";
export type CombatantInfoFetchStatus = DeathEventsFetchStatus;

export interface IFightCombatant {
  name: string;
  server: string;
  specID: number;
  specName: string;
}

export interface IFight extends Document {
  reportCode: string; // WCL report code this fight belongs to
  guildId: mongoose.Types.ObjectId;
  fightId: number; // Fight ID within the report
  zoneId: number; // Raid zone ID
  encounterID: number; // Boss encounter ID
  encounterName: string; // Boss name
  difficulty: number; // Difficulty ID (3=Normal, 4=Heroic, 5=Mythic)
  isKill: boolean; // Whether the boss was killed
  bossPercentage: number; // Boss health percentage remaining (0 = kill, 100 = wipe at start)
  fightPercentage: number; // Overall fight progression percentage
  reportStartTime: number; // Report's start time (unix ms)
  reportEndTime: number; // Report's end time (unix ms)
  fightStartTime: number; // Fight start time relative to report start (ms)
  fightEndTime: number; // Fight end time relative to report start (ms)
  duration: number; // Fight duration in milliseconds (in-combat time)
  timestamp: Date; // Actual timestamp when the fight occurred
  // Phase information
  lastPhaseId?: number; // ID of last phase reached
  lastPhaseName?: string; // Name of last phase (e.g., "Phase 3", "Intermission")
  phaseTransitions?: IPhaseTransition[]; // All phases that occurred
  progressDisplay?: string; // Human-readable like "45% P3"
  // Player deaths
  deaths?: IPlayerDeath[]; // All player deaths in chronological order
  deathEventsFetchStatus?: DeathEventsFetchStatus;
  deathEventsFetchedAt?: Date;
  deathEventsFetchFailedAt?: Date;
  deathEventsFetchError?: string;
  combatants?: IFightCombatant[];
  combatantInfoFetchStatus?: CombatantInfoFetchStatus;
  combatantInfoFetchedAt?: Date;
  combatantInfoFetchFailedAt?: Date;
  combatantInfoFetchError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FightSchema: Schema = new Schema(
  {
    reportCode: { type: String, required: true },
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true },
    fightId: { type: Number, required: true },
    zoneId: { type: Number, required: true },
    encounterID: { type: Number, required: true, index: true },
    encounterName: { type: String, required: true },
    difficulty: { type: Number, required: true },
    isKill: { type: Boolean, default: false, index: true },
    bossPercentage: { type: Number, default: 0 },
    fightPercentage: { type: Number, default: 0 },
    reportStartTime: { type: Number, required: true },
    reportEndTime: { type: Number },
    fightStartTime: { type: Number, required: true },
    fightEndTime: { type: Number, required: true },
    duration: { type: Number, required: true },
    timestamp: { type: Date, required: true, index: true },
    // Phase information
    lastPhaseId: { type: Number },
    lastPhaseName: { type: String },
    phaseTransitions: [
      {
        id: { type: Number, required: true },
        startTime: { type: Number, required: true },
        name: { type: String },
      },
    ],
    progressDisplay: { type: String },
    // Player deaths
    deaths: [
      {
        name: { type: String, required: true },
        server: { type: String, required: true },
        timestamp: { type: Number, required: true },
        deathTime: { type: Number, required: true },
      },
    ],
    deathEventsFetchStatus: {
      type: String,
      enum: ["pending", "fetched", "failed", "archived"],
      default: "pending",
      index: true,
    },
    deathEventsFetchedAt: { type: Date },
    deathEventsFetchFailedAt: { type: Date },
    deathEventsFetchError: { type: String },
    combatants: [
      {
        name: { type: String, required: true },
        server: { type: String, required: true },
        specID: { type: Number, required: true },
        specName: { type: String, required: true },
      },
    ],
    combatantInfoFetchStatus: {
      type: String,
      enum: ["pending", "fetched", "failed", "archived"],
      default: "pending",
      index: true,
    },
    combatantInfoFetchedAt: { type: Date },
    combatantInfoFetchFailedAt: { type: Date },
    combatantInfoFetchError: { type: String },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for efficient queries
FightSchema.index({ guildId: 1, zoneId: 1, difficulty: 1 });
FightSchema.index({ reportCode: 1, fightId: 1 }, { unique: true });
FightSchema.index({ encounterID: 1, difficulty: 1, isKill: 1 });
FightSchema.index({ guildId: 1, encounterID: 1, difficulty: 1, timestamp: 1 });
FightSchema.index({ guildId: 1, zoneId: 1, encounterID: 1, difficulty: 1, fightPercentage: 1, timestamp: -1 });
FightSchema.index({ guildId: 1, deathEventsFetchStatus: 1, reportEndTime: 1, reportCode: 1 });
FightSchema.index(
  { deathEventsFetchStatus: 1, reportEndTime: 1, guildId: 1 },
  { name: "death_backfill_queue_lookup" },
);
FightSchema.index(
  { combatantInfoFetchStatus: 1, reportEndTime: 1, guildId: 1 },
  { name: "combatant_info_backfill_queue_lookup" },
);
FightSchema.index(
  { zoneId: 1, difficulty: 1, deathEventsFetchStatus: 1, combatantInfoFetchStatus: 1, reportCode: 1, fightId: 1, encounterID: 1 },
  { name: "mechanics_fight_details_lookup" },
);

export default mongoose.model<IFight>("Fight", FightSchema);
