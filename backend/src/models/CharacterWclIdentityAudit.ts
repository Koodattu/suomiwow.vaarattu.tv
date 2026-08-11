import mongoose, { Document, Schema } from "mongoose";

export type CharacterWclIdentityAuditStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";
export type CharacterWclIdentityAuditOutcome = "resolved" | "hidden" | "not_found" | "class_mismatch" | "invalid_response";

export interface ICharacterWclIdentityAudit extends Document {
  characterId: mongoose.Types.ObjectId;
  expectedWclCanonicalCharacterId: number;
  expectedClassID: number;
  sourceName: string;
  sourceRealm: string;
  sourceRegion: string;

  status: CharacterWclIdentityAuditStatus;
  outcome?: CharacterWclIdentityAuditOutcome | null;
  priority: number;
  identityChanged: boolean;

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

const CharacterWclIdentityAuditSchema = new Schema<ICharacterWclIdentityAudit>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, unique: true, index: true },
    expectedWclCanonicalCharacterId: { type: Number, required: true, index: true },
    expectedClassID: { type: Number, required: true, index: true },
    sourceName: { type: String, required: true },
    sourceRealm: { type: String, required: true },
    sourceRegion: { type: String, required: true },

    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "skipped", "failed"],
      required: true,
      default: "pending",
      index: true,
    },
    outcome: {
      type: String,
      enum: ["resolved", "hidden", "not_found", "class_mismatch", "invalid_response"],
      default: null,
      index: true,
    },
    priority: { type: Number, required: true, default: 20, index: true },
    identityChanged: { type: Boolean, required: true, default: false },

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

CharacterWclIdentityAuditSchema.index({ status: 1, priority: 1, createdAt: 1 });
CharacterWclIdentityAuditSchema.index({ outcome: 1, completedAt: -1 });
CharacterWclIdentityAuditSchema.index({ lastErrorAt: -1 });

export default mongoose.model<ICharacterWclIdentityAudit>("CharacterWclIdentityAudit", CharacterWclIdentityAuditSchema);
