import mongoose, { Document, Schema } from "mongoose";
import { CcgOwnerType } from "./CcgOwnership";

export interface ICcgQualityProgress extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  foil: number;
  golden: number;
  prismatic: number;
  holographic: number;
  negative: number;
  custom: Map<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const CcgQualityProgressSchema = new Schema<ICcgQualityProgress>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    foil: { type: Number, required: true, min: 0, default: 0 },
    golden: { type: Number, required: true, min: 0, default: 0 },
    prismatic: { type: Number, required: true, min: 0, default: 0 },
    holographic: { type: Number, required: true, min: 0, default: 0 },
    negative: { type: Number, required: true, min: 0, default: 0 },
    custom: { type: Map, of: Number, required: true, default: () => ({}) },
  },
  { timestamps: true },
);

CcgQualityProgressSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });

export default mongoose.model<ICcgQualityProgress>("CcgQualityProgress", CcgQualityProgressSchema);
