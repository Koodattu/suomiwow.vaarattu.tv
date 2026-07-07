import mongoose, { Schema, Document } from "mongoose";

export interface IReportFightSequenceEntry {
  fightId: number;
  encounterID: number;
  difficulty: number;
  startTime: number;
  endTime: number;
  name?: string;
}

export interface IReport extends Document {
  code: string; // WCL report code (unique)
  guildId: mongoose.Types.ObjectId;
  zoneId: number;
  startTime: number; // Unix timestamp
  endTime?: number; // Unix timestamp, undefined if ongoing
  isOngoing: boolean;
  fightCount: number;
  fightSequence?: IReportFightSequenceEntry[]; // Full WCL fight order, including non-tracked fights, for raid-time calculations
  encounterFights: {
    // Quick summary of fights by encounter
    [encounterID: number]: {
      total: number;
      kills: number;
      wipes: number;
    };
  };
  lastProcessed: Date;
  importSource?: "manual_admin";
  manualImportedAt?: Date;
  manualImportedByUserId?: mongoose.Types.ObjectId;
  charactersFetchStatus?: "pending" | "fetched" | "failed";
  charactersFetchedAt?: Date;
  charactersFetchFailedAt?: Date;
  charactersFetchError?: string;
  rankedCharacterCount?: number;
  rankingsCharacterCount?: number;
  rankingsFetchedAt?: Date;
  characterAppearanceCount?: number;
  charactersFetchSource?: "rankedCharacters" | "reportRankings" | "none";
  createdAt: Date;
  updatedAt: Date;
}

const ReportFightSequenceSchema: Schema = new Schema(
  {
    fightId: { type: Number, required: true },
    encounterID: { type: Number, default: 0 },
    difficulty: { type: Number, default: 0 },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    name: { type: String },
  },
  { _id: false },
);

const ReportSchema: Schema = new Schema(
  {
    code: { type: String, required: true },
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true },
    zoneId: { type: Number, required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number },
    isOngoing: { type: Boolean, default: false },
    fightCount: { type: Number, default: 0 },
    fightSequence: [ReportFightSequenceSchema],
    encounterFights: { type: Map, of: Object, default: new Map() },
    lastProcessed: { type: Date, default: Date.now },
    importSource: {
      type: String,
      enum: ["manual_admin"],
      index: true,
    },
    manualImportedAt: { type: Date },
    manualImportedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    charactersFetchStatus: {
      type: String,
      enum: ["pending", "fetched", "failed"],
      default: "pending",
      index: true,
    },
    charactersFetchedAt: { type: Date },
    charactersFetchFailedAt: { type: Date },
    charactersFetchError: { type: String },
    rankedCharacterCount: { type: Number, default: 0 },
    rankingsCharacterCount: { type: Number, default: 0 },
    rankingsFetchedAt: { type: Date },
    characterAppearanceCount: { type: Number, default: 0 },
    charactersFetchSource: {
      type: String,
      enum: ["rankedCharacters", "reportRankings", "none"],
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for efficient lookups
ReportSchema.index({ guildId: 1, zoneId: 1, startTime: -1 });
ReportSchema.index({ guildId: 1, startTime: -1 });
ReportSchema.index({ code: 1 }, { unique: true });
ReportSchema.index({ isOngoing: 1 });
ReportSchema.index({ guildId: 1, charactersFetchStatus: 1, startTime: 1 });
ReportSchema.index({ zoneId: 1, "fightSequence.difficulty": 1, code: 1 });

export default mongoose.model<IReport>("Report", ReportSchema);
