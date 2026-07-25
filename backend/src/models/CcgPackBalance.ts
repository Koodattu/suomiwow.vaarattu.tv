import mongoose, { Document, Schema } from "mongoose";
import { CCG_PACK_STORAGE_CAPS } from "../config/ccg";
import { CcgOwnerType } from "./CcgOwnership";

export interface ICcgPackBalance extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  currentRemaining: number;
  legacyRemaining: number;
  lastRechargeAt: Date;
  grantVersion?: number;
  hasPlayed?: boolean;
  firstPlayedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CcgPackBalanceSchema = new Schema<ICcgPackBalance>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    currentRemaining: { type: Number, required: true, min: 0, default: CCG_PACK_STORAGE_CAPS.current },
    legacyRemaining: { type: Number, required: true, min: 0, default: CCG_PACK_STORAGE_CAPS.legacy },
    lastRechargeAt: { type: Date, required: true },
    grantVersion: { type: Number },
    hasPlayed: { type: Boolean },
    firstPlayedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CcgPackBalanceSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
CcgPackBalanceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ICcgPackBalance>("CcgPackBalance", CcgPackBalanceSchema);
