import mongoose, { Document, Schema } from "mongoose";
import { CcgArtVariant, CcgFinish, CcgTierGrade } from "../config/ccg";

export type TwitchCcgGrantStatus = "pending" | "granted" | "failed";
export type TwitchCcgChatStatus = "pending" | "sent" | "failed" | "expired";
export type TwitchCcgRewardKind = "packs" | "card_reveal";
export type TwitchCcgAssignmentStatus = "not_applicable" | "pending" | "assigned" | "failed";

export interface TwitchCcgAssignedCard {
  cardId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  snapshotVersion: number;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  tierGrade: CcgTierGrade;
  poolVersion: string;
}

export interface ITwitchCcgRedemption extends Document {
  redemptionId: string;
  eventMessageId: string;
  broadcasterId: string;
  broadcasterLogin: string;
  twitchUserId: string;
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  rewardKind: TwitchCcgRewardKind;
  redeemedAt: Date;
  receivedAt: Date;
  assignmentStatus: TwitchCcgAssignmentStatus;
  assignmentAttempts: number;
  assignmentNextAttemptAt: Date;
  assignmentLastError?: string;
  assignedCard?: TwitchCcgAssignedCard;
  grantStatus: TwitchCcgGrantStatus;
  grantedUserId?: mongoose.Types.ObjectId;
  grantedAt?: Date;
  grantAttempts: number;
  grantNextAttemptAt: Date;
  grantLastError?: string;
  chatStatus: TwitchCcgChatStatus;
  chatAttempts: number;
  chatNextAttemptAt: Date;
  chatExpiresAt: Date;
  chatSentAt?: Date;
  chatLastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchCcgRedemptionSchema = new Schema<ITwitchCcgRedemption>(
  {
    redemptionId: { type: String, required: true, unique: true },
    eventMessageId: { type: String, required: true, unique: true },
    broadcasterId: { type: String, required: true, index: true },
    broadcasterLogin: { type: String, required: true },
    twitchUserId: { type: String, required: true, index: true },
    twitchUserLogin: { type: String, required: true },
    twitchUserDisplayName: { type: String, required: true },
    rewardId: { type: String, required: true, index: true },
    rewardTitle: { type: String, required: true },
    rewardCost: { type: Number, required: true, min: 0 },
    rewardKind: { type: String, enum: ["packs", "card_reveal"], required: true, default: "packs", index: true },
    redeemedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    assignmentStatus: {
      type: String,
      enum: ["not_applicable", "pending", "assigned", "failed"],
      required: true,
      default: "not_applicable",
      index: true,
    },
    assignmentAttempts: { type: Number, required: true, default: 0 },
    assignmentNextAttemptAt: { type: Date, required: true, default: Date.now },
    assignmentLastError: { type: String },
    assignedCard: {
      cardId: { type: Schema.Types.ObjectId, ref: "CcgCard" },
      setId: { type: Schema.Types.ObjectId, ref: "CcgSet" },
      characterId: { type: Schema.Types.ObjectId, ref: "Character" },
      snapshotVersion: { type: Number, min: 1 },
      finish: { type: String },
      artVariant: { type: String, enum: ["standard", "alternative"] },
      tierGrade: { type: String, enum: ["S", "A", "B", "C", "D", "E", "F"] },
      poolVersion: { type: String },
    },
    grantStatus: { type: String, enum: ["pending", "granted", "failed"], required: true, default: "pending", index: true },
    grantedUserId: { type: Schema.Types.ObjectId, ref: "User" },
    grantedAt: { type: Date },
    grantAttempts: { type: Number, required: true, default: 0 },
    grantNextAttemptAt: { type: Date, required: true, default: Date.now },
    grantLastError: { type: String },
    chatStatus: { type: String, enum: ["pending", "sent", "failed", "expired"], required: true, default: "pending", index: true },
    chatAttempts: { type: Number, required: true, default: 0 },
    chatNextAttemptAt: { type: Date, required: true, default: Date.now },
    chatExpiresAt: { type: Date, required: true },
    chatSentAt: { type: Date },
    chatLastError: { type: String },
  },
  { timestamps: true },
);

TwitchCcgRedemptionSchema.index({ twitchUserId: 1, grantStatus: 1, grantNextAttemptAt: 1, redeemedAt: 1 });
TwitchCcgRedemptionSchema.index({ chatStatus: 1, chatNextAttemptAt: 1, chatExpiresAt: 1 });
TwitchCcgRedemptionSchema.index({ rewardKind: 1, assignmentStatus: 1, assignmentNextAttemptAt: 1 });

export default mongoose.model<ITwitchCcgRedemption>("TwitchCcgRedemption", TwitchCcgRedemptionSchema);
