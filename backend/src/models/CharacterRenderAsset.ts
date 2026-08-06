import mongoose, { Document, Schema } from "mongoose";

export type CharacterRenderFit = {
  top: number;
  ground: number;
  centerX: number;
};

export type CharacterRenderAssetStatus = "active" | "purged";

export interface ICharacterRenderAsset extends Document {
  characterId: mongoose.Types.ObjectId;
  sourceUrl: string;
  sourceValidatedAt: Date;
  expiresAt: Date;
  status: CharacterRenderAssetStatus;
  sha256: string;
  storageKey: string;
  contentType: "image/webp";
  byteLength: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  cropLeft: number;
  cropTop: number;
  silhouetteFit: CharacterRenderFit;
  stanceFit: CharacterRenderFit;
  purgedAt?: Date | null;
  purgeReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const CharacterRenderFitSchema = new Schema<CharacterRenderFit>(
  {
    top: { type: Number, required: true, min: 0, max: 1 },
    ground: { type: Number, required: true, min: 0, max: 1 },
    centerX: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const CharacterRenderAssetSchema = new Schema<ICharacterRenderAsset>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    sourceUrl: { type: String, required: true },
    sourceValidatedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["active", "purged"], required: true, default: "active", index: true },
    sha256: { type: String, required: true },
    storageKey: { type: String, required: true, index: true },
    contentType: { type: String, enum: ["image/webp"], required: true, default: "image/webp" },
    byteLength: { type: Number, required: true, min: 1 },
    width: { type: Number, required: true, min: 1 },
    height: { type: Number, required: true, min: 1 },
    sourceWidth: { type: Number, required: true, min: 1 },
    sourceHeight: { type: Number, required: true, min: 1 },
    cropLeft: { type: Number, required: true, min: 0 },
    cropTop: { type: Number, required: true, min: 0 },
    silhouetteFit: { type: CharacterRenderFitSchema, required: true },
    stanceFit: { type: CharacterRenderFitSchema, required: true },
    purgedAt: { type: Date, default: null },
    purgeReason: { type: String, default: null },
  },
  { timestamps: true },
);

CharacterRenderAssetSchema.index({ characterId: 1, sha256: 1 }, { unique: true });
CharacterRenderAssetSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model<ICharacterRenderAsset>("CharacterRenderAsset", CharacterRenderAssetSchema);
