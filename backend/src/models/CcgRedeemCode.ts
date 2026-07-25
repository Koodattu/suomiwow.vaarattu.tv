import mongoose, { Document, Schema } from "mongoose";
import { CcgArtVariant, CcgFinish } from "../config/ccg";
import { CCG_REDEEM_CODE_PATTERN, CCG_REDEEM_PACK_GRANT_MAX } from "../utils/ccg-redeem";

export type CcgRedeemRewardType = "packs" | "card";

export interface ICcgRedeemCode extends Document {
  code: string;
  rewardType: CcgRedeemRewardType;
  currentPacks: number;
  legacyPacks: number;
  cardId?: mongoose.Types.ObjectId | null;
  finish?: CcgFinish | null;
  artVariant?: CcgArtVariant | null;
  active: boolean;
  redemptionCount: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CcgRedeemCodeSchema = new Schema<ICcgRedeemCode>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: CCG_REDEEM_CODE_PATTERN,
    },
    rewardType: { type: String, enum: ["packs", "card"], required: true, immutable: true },
    currentPacks: { type: Number, required: true, min: 0, max: CCG_REDEEM_PACK_GRANT_MAX, default: 0, immutable: true },
    legacyPacks: { type: Number, required: true, min: 0, max: CCG_REDEEM_PACK_GRANT_MAX, default: 0, immutable: true },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", default: null, immutable: true },
    finish: {
      type: String,
      enum: ["standard", "foil", "golden", "prismatic", "holographic", "negative", null],
      default: null,
      immutable: true,
    },
    artVariant: { type: String, enum: ["standard", "alternative", null], default: null, immutable: true },
    active: { type: Boolean, required: true, default: true, index: true },
    redemptionCount: { type: Number, required: true, min: 0, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  },
  { timestamps: true },
);

CcgRedeemCodeSchema.pre("validate", function () {
  if (this.rewardType === "packs") {
    if (this.currentPacks + this.legacyPacks < 1) this.invalidate("currentPacks", "At least one pack must be granted");
    if (this.cardId || this.finish || this.artVariant) this.invalidate("cardId", "Pack codes cannot include a card reward");
    return;
  }

  if (!this.cardId || !this.finish || !this.artVariant) this.invalidate("cardId", "Card codes require a card, quality, and artwork choice");
  if (this.currentPacks !== 0 || this.legacyPacks !== 0) this.invalidate("currentPacks", "Card codes cannot include pack rewards");
});

export default mongoose.model<ICcgRedeemCode>("CcgRedeemCode", CcgRedeemCodeSchema);
