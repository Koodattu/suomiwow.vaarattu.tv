import mongoose, { Document, Schema } from "mongoose";
import { CcgOwnerType } from "./CcgOwnership";

export interface ICcgDailyAllowance extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  dateKey: string;
  currentGranted: number;
  currentOpened: number;
  legacyGranted: number;
  legacyOpened: number;
  createdAt: Date;
  updatedAt: Date;
}

const CcgDailyAllowanceSchema = new Schema<ICcgDailyAllowance>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    dateKey: { type: String, required: true },
    currentGranted: { type: Number, required: true, default: 10 },
    currentOpened: { type: Number, required: true, default: 0 },
    legacyGranted: { type: Number, required: true, default: 10 },
    legacyOpened: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

CcgDailyAllowanceSchema.index({ ownerType: 1, ownerId: 1, dateKey: 1 }, { unique: true });

export default mongoose.model<ICcgDailyAllowance>("CcgDailyAllowance", CcgDailyAllowanceSchema);
