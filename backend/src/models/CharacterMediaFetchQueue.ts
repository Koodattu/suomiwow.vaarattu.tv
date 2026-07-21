import mongoose, { Document, Schema } from "mongoose";

export type CharacterMediaFetchStatus = "pending" | "processing" | "completed" | "retry" | "not_found" | "failed";

export interface ICharacterMediaFetchQueue extends Document {
  characterId: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  realmSlug: string;
  region: string;
  status: CharacterMediaFetchStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastActivityAt: Date;
  lastErrorCode?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterMediaFetchQueueSchema = new Schema<ICharacterMediaFetchQueue>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, unique: true, index: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    realmSlug: { type: String, required: true },
    region: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "retry", "not_found", "failed"],
      required: true,
      default: "pending",
      index: true,
    },
    priority: { type: Number, required: true, default: 10, index: true },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 5 },
    nextAttemptAt: { type: Date, required: true, default: Date.now, index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, required: true, default: Date.now },
    lastErrorCode: { type: String, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

CharacterMediaFetchQueueSchema.index({ status: 1, nextAttemptAt: 1, priority: -1, createdAt: 1 });
CharacterMediaFetchQueueSchema.index({ status: 1, lastActivityAt: 1 });

export default mongoose.model<ICharacterMediaFetchQueue>("CharacterMediaFetchQueue", CharacterMediaFetchQueueSchema);
