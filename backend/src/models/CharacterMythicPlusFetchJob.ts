import mongoose, { Schema, Document } from "mongoose";

export type CharacterMythicPlusFetchJobType = "profile" | "season_progress";
export type CharacterMythicPlusFetchJobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped"
  | "not_found"
  | "class_mismatch"
  | "rate_limited"
  | "failed";

export interface ICharacterMythicPlusFetchJob extends Document {
  jobType: CharacterMythicPlusFetchJobType;
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  guildName?: string | null;
  guildRealm?: string | null;
  season?: string | null;
  targetSeasons: string[];

  status: CharacterMythicPlusFetchJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  httpStatus?: number | null;
  lastError?: string | null;
  lastErrorAt?: Date | null;
  completionReason?: string | null;
  profileSeasonsWritten: number;
  detailJobsQueued: number;
  dungeonRunsWritten: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterMythicPlusFetchJobSchema = new Schema<ICharacterMythicPlusFetchJob>(
  {
    jobType: { type: String, enum: ["profile", "season_progress"], required: true, index: true },
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    wclCanonicalCharacterId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    region: { type: String, required: true },
    classID: { type: Number, required: true, index: true },
    guildName: { type: String, default: null },
    guildRealm: { type: String, default: null },
    season: { type: String, default: null, index: true },
    targetSeasons: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "skipped", "not_found", "class_mismatch", "rate_limited", "failed"],
      required: true,
      default: "pending",
      index: true,
    },
    priority: { type: Number, required: true, default: 20, index: true },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    nextAttemptAt: { type: Date, required: true, default: Date.now, index: true },
    httpStatus: { type: Number, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
    completionReason: { type: String, default: null },
    profileSeasonsWritten: { type: Number, required: true, default: 0 },
    detailJobsQueued: { type: Number, required: true, default: 0 },
    dungeonRunsWritten: { type: Number, required: true, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

CharacterMythicPlusFetchJobSchema.index({ characterId: 1, jobType: 1, season: 1 }, { unique: true });
CharacterMythicPlusFetchJobSchema.index({ status: 1, priority: 1, nextAttemptAt: 1, createdAt: 1 });
CharacterMythicPlusFetchJobSchema.index({ completedAt: -1 });
CharacterMythicPlusFetchJobSchema.index({ lastErrorAt: -1 });

export default mongoose.model<ICharacterMythicPlusFetchJob>("CharacterMythicPlusFetchJob", CharacterMythicPlusFetchJobSchema);
