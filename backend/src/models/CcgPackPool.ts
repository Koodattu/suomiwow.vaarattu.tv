import mongoose, { Document, Schema } from "mongoose";
import { CcgTierGrade } from "../config/ccg";

export interface ICcgPackPool extends Document {
  setId: mongoose.Types.ObjectId;
  version: string;
  active: boolean;
  buckets: Array<{ grade: CcgTierGrade; cardIds: mongoose.Types.ObjectId[] }>;
  totalCards: number;
  createdAt: Date;
  updatedAt: Date;
}

const BucketSchema = new Schema(
  {
    grade: { type: String, enum: ["H", "S", "A", "B", "C", "D", "E", "F"], required: true },
    cardIds: { type: [Schema.Types.ObjectId], ref: "CcgCard", default: [] },
  },
  { _id: false },
);

const CcgPackPoolSchema = new Schema<ICcgPackPool>(
  {
    setId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true, index: true },
    version: { type: String, required: true },
    active: { type: Boolean, required: true, default: true, index: true },
    buckets: { type: [BucketSchema], default: [] },
    totalCards: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

CcgPackPoolSchema.index({ setId: 1, version: 1 }, { unique: true });
CcgPackPoolSchema.index({ setId: 1, active: 1, updatedAt: -1 });

export default mongoose.model<ICcgPackPool>("CcgPackPool", CcgPackPoolSchema);
