import mongoose, { Document, Schema } from "mongoose";
import { CcgOwnerType } from "./CcgOwnership";

export interface ICcgPackBalance extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  remaining: number;
  lastRechargeAt: Date;
  grantVersion?: number;
  hasPlayed?: boolean;
  firstPlayedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CcgPackBalanceSchema = new Schema<ICcgPackBalance>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    remaining: { type: Number, required: true, min: 0 },
    lastRechargeAt: { type: Date, required: true },
    grantVersion: { type: Number },
    hasPlayed: { type: Boolean },
    firstPlayedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CcgPackBalanceSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });

export default mongoose.model<ICcgPackBalance>("CcgPackBalance", CcgPackBalanceSchema);
