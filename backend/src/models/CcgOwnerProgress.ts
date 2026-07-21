import mongoose, { Document, Schema } from "mongoose";
import { CcgMode } from "../config/ccg";

export interface ICcgOwnerProgress extends Document {
  ownerId: mongoose.Types.ObjectId;
  mode: CcgMode;
  duplicateRemainder: number;
  totalDuplicatePulls: number;
  bonusPacksEarned: number;
  createdAt: Date;
  updatedAt: Date;
}

const CcgOwnerProgressSchema = new Schema<ICcgOwnerProgress>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    mode: { type: String, enum: ["current", "legacy"], required: true },
    duplicateRemainder: { type: Number, required: true, min: 0, max: 9, default: 0 },
    totalDuplicatePulls: { type: Number, required: true, default: 0 },
    bonusPacksEarned: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

CcgOwnerProgressSchema.index({ ownerId: 1, mode: 1 }, { unique: true });

export default mongoose.model<ICcgOwnerProgress>("CcgOwnerProgress", CcgOwnerProgressSchema);
