import mongoose, { Document, Schema } from "mongoose";
import { CcgFinish } from "../config/ccg";

export type CcgOwnerType = "user" | "guest";

export interface ICcgOwnership extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  cardId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  quantity: number;
  alternativeQuantity: number;
  firstAcquiredAt: Date;
  lastAcquiredAt: Date;
  dateKey?: string | null;
  expiresAt?: Date | null;
}

const CcgOwnershipSchema = new Schema<ICcgOwnership>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", required: true, index: true },
    finish: { type: String, enum: ["standard", "foil", "golden", "prismatic", "holographic", "negative"], required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    alternativeQuantity: { type: Number, required: true, min: 0, default: 0 },
    firstAcquiredAt: { type: Date, required: true, default: Date.now },
    lastAcquiredAt: { type: Date, required: true, default: Date.now },
    dateKey: { type: String, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: false },
);

CcgOwnershipSchema.index({ ownerType: 1, ownerId: 1, cardId: 1, finish: 1 }, { unique: true });
CcgOwnershipSchema.index({ ownerType: 1, ownerId: 1, lastAcquiredAt: -1 });
CcgOwnershipSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ICcgOwnership>("CcgOwnership", CcgOwnershipSchema);
