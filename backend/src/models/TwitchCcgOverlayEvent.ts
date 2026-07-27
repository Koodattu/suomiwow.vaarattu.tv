import mongoose, { Document, Schema } from "mongoose";
import { CcgArtVariant, CcgFinish, CcgTierGrade } from "../config/ccg";

export type TwitchCcgOverlayEventStatus = "queued" | "leased" | "played" | "expired";

export interface ITwitchCcgOverlayEvent extends Document {
  sourceKey: string;
  source: "redemption" | "test";
  redemptionId?: mongoose.Types.ObjectId;
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  cardId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  tierGrade: CcgTierGrade;
  status: TwitchCcgOverlayEventStatus;
  leaseId?: string;
  leaseUntil?: Date;
  attempts: number;
  expiresAt: Date;
  playedAt?: Date;
  deleteAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchCcgOverlayEventSchema = new Schema<ITwitchCcgOverlayEvent>(
  {
    sourceKey: { type: String, required: true, unique: true },
    source: { type: String, enum: ["redemption", "test"], required: true },
    redemptionId: { type: Schema.Types.ObjectId, ref: "TwitchCcgRedemption" },
    twitchUserLogin: { type: String, required: true },
    twitchUserDisplayName: { type: String, required: true },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", required: true },
    finish: { type: String, required: true },
    artVariant: { type: String, enum: ["standard", "alternative"], required: true },
    tierGrade: { type: String, enum: ["S", "A", "B", "C", "D", "E", "F"], required: true },
    status: { type: String, enum: ["queued", "leased", "played", "expired"], required: true, default: "queued", index: true },
    leaseId: { type: String },
    leaseUntil: { type: Date },
    attempts: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true, index: true },
    playedAt: { type: Date },
    deleteAt: { type: Date, required: true },
  },
  { timestamps: true },
);

TwitchCcgOverlayEventSchema.index({ status: 1, expiresAt: 1, createdAt: 1 });
TwitchCcgOverlayEventSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ITwitchCcgOverlayEvent>("TwitchCcgOverlayEvent", TwitchCcgOverlayEventSchema);
