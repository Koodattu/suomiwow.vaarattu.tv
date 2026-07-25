import mongoose, { Document, Schema } from "mongoose";
import { CcgArtVariant, CcgFinish } from "../config/ccg";
import type { CcgRedeemRewardType } from "./CcgRedeemCode";

export interface ICcgRedeemClaim extends Document {
  codeId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  rewardType: CcgRedeemRewardType;
  currentPacks: number;
  legacyPacks: number;
  cardId?: mongoose.Types.ObjectId | null;
  finish?: CcgFinish | null;
  artVariant?: CcgArtVariant | null;
  redeemedAt: Date;
}

const CcgRedeemClaimSchema = new Schema<ICcgRedeemClaim>(
  {
    codeId: { type: Schema.Types.ObjectId, ref: "CcgRedeemCode", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    rewardType: { type: String, enum: ["packs", "card"], required: true },
    currentPacks: { type: Number, required: true, min: 0, default: 0 },
    legacyPacks: { type: Number, required: true, min: 0, default: 0 },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", default: null },
    finish: { type: String, enum: ["standard", "foil", "golden", "prismatic", "holographic", "negative", null], default: null },
    artVariant: { type: String, enum: ["standard", "alternative", null], default: null },
    redeemedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

CcgRedeemClaimSchema.index({ codeId: 1, userId: 1 }, { unique: true });
CcgRedeemClaimSchema.index({ userId: 1, redeemedAt: -1 });

export default mongoose.model<ICcgRedeemClaim>("CcgRedeemClaim", CcgRedeemClaimSchema);
