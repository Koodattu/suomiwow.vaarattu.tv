import mongoose, { Document, Schema } from "mongoose";
import { CharacterRenderFit, CharacterRenderFitSchema } from "./CharacterRenderAsset";

export type CharacterMediaStatus = "pending" | "available" | "not_found" | "failed";

export interface ICharacterMedia extends Document {
  characterId: mongoose.Types.ObjectId;
  region: string;
  realmSlug: string;
  characterName: string;
  avatarUrl?: string | null;
  insetUrl?: string | null;
  mainRawUrl?: string | null;
  renderAssetId?: mongoose.Types.ObjectId | null;
  renderAssetExpiresAt?: Date | null;
  renderFit?: CharacterRenderFit | null;
  sourceUpdatedAt?: Date | null;
  sourceValidatedAt?: Date | null;
  fetchedAt?: Date | null;
  status: CharacterMediaStatus;
  attemptCount: number;
  nextAttemptAt?: Date | null;
  nextMediaRefreshAt?: Date | null;
  lastErrorCode?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterMediaSchema = new Schema<ICharacterMedia>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, unique: true, index: true },
    region: { type: String, required: true },
    realmSlug: { type: String, required: true },
    characterName: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    insetUrl: { type: String, default: null },
    mainRawUrl: { type: String, default: null },
    renderAssetId: { type: Schema.Types.ObjectId, ref: "CharacterRenderAsset", default: null, index: true },
    renderAssetExpiresAt: { type: Date, default: null, index: true },
    renderFit: { type: CharacterRenderFitSchema, default: null },
    sourceUpdatedAt: { type: Date, default: null },
    sourceValidatedAt: { type: Date, default: null },
    fetchedAt: { type: Date, default: null },
    status: { type: String, enum: ["pending", "available", "not_found", "failed"], default: "pending", index: true },
    attemptCount: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, default: null, index: true },
    nextMediaRefreshAt: { type: Date, default: null, index: true },
    lastErrorCode: { type: String, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

CharacterMediaSchema.index({ status: 1, nextAttemptAt: 1 });
CharacterMediaSchema.index({ status: 1, nextMediaRefreshAt: 1 });

export default mongoose.model<ICharacterMedia>("CharacterMedia", CharacterMediaSchema);
