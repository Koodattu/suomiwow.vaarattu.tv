import mongoose, { Document, Schema } from "mongoose";

export type CharacterIdentityResolutionStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";
export type CharacterIdentityResolutionOutcome = "resolved" | "manual_link" | "hidden" | "not_found" | "class_mismatch" | "invalid_response";

export interface ICharacterIdentityResolutionEvidence {
  appearanceCount: number;
  reportCount: number;
  guildCount: number;
  zoneIds: number[];
  firstSeenAt?: Date;
  lastSeenAt?: Date;
}

export interface ICharacterIdentityResolution extends Document {
  sourceIdentityKey: string;
  sourceName: string;
  sourceRealm: string;
  sourceRegion: string;
  sourceClassID: number;

  status: CharacterIdentityResolutionStatus;
  outcome?: CharacterIdentityResolutionOutcome | null;
  priority: number;
  evidence: ICharacterIdentityResolutionEvidence;

  targetCharacterId?: mongoose.Types.ObjectId | null;
  wclCharacterId?: number | null;
  wclCanonicalCharacterId?: number | null;
  resolvedName?: string | null;
  resolvedRealm?: string | null;
  resolvedRegion?: string | null;
  resolvedClassID?: number | null;

  attempts: number;
  maxAttempts: number;
  completionReason?: string | null;
  lastError?: string | null;
  lastErrorAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastActivityAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

const CharacterIdentityResolutionEvidenceSchema = new Schema<ICharacterIdentityResolutionEvidence>(
  {
    appearanceCount: { type: Number, required: true, default: 0 },
    reportCount: { type: Number, required: true, default: 0 },
    guildCount: { type: Number, required: true, default: 0 },
    zoneIds: { type: [Number], required: true, default: [] },
    firstSeenAt: { type: Date },
    lastSeenAt: { type: Date },
  },
  { _id: false },
);

const CharacterIdentityResolutionSchema = new Schema<ICharacterIdentityResolution>(
  {
    sourceIdentityKey: { type: String, required: true, unique: true, index: true },
    sourceName: { type: String, required: true },
    sourceRealm: { type: String, required: true },
    sourceRegion: { type: String, required: true },
    sourceClassID: { type: Number, required: true, index: true },

    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "skipped", "failed"],
      required: true,
      default: "pending",
      index: true,
    },
    outcome: {
      type: String,
      enum: ["resolved", "manual_link", "hidden", "not_found", "class_mismatch", "invalid_response"],
      default: null,
      index: true,
    },
    priority: { type: Number, required: true, default: 20, index: true },
    evidence: { type: CharacterIdentityResolutionEvidenceSchema, required: true, default: () => ({}) },

    targetCharacterId: { type: Schema.Types.ObjectId, ref: "Character", default: null, index: true },
    wclCharacterId: { type: Number, default: null },
    wclCanonicalCharacterId: { type: Number, default: null, index: true },
    resolvedName: { type: String, default: null },
    resolvedRealm: { type: String, default: null },
    resolvedRegion: { type: String, default: null },
    resolvedClassID: { type: Number, default: null },

    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    completionReason: { type: String, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

CharacterIdentityResolutionSchema.index({ status: 1, priority: 1, "evidence.reportCount": -1, createdAt: 1 });
CharacterIdentityResolutionSchema.index({ outcome: 1, completedAt: -1 });
CharacterIdentityResolutionSchema.index({ lastErrorAt: -1 });

export default mongoose.model<ICharacterIdentityResolution>("CharacterIdentityResolution", CharacterIdentityResolutionSchema);
