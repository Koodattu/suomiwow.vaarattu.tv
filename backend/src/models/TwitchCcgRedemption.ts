import mongoose, { Document, Schema } from "mongoose";
import { CcgArtVariant, CcgFinish, CcgTierGrade } from "../config/ccg";

export type TwitchCcgGrantStatus = "pending" | "granted" | "failed";
export type TwitchCcgChatStatus = "pending" | "sent" | "skipped" | "failed" | "expired";
export type TwitchCcgChatMessageKind = "account_link" | "delivery_error";
export type TwitchCcgRewardKind = "packs" | "packs_10" | "card_reveal";
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
  assignedCards?: TwitchCcgAssignedCard[];
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
  chatMessageKind?: TwitchCcgChatMessageKind;
  chatLastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchCcgAssignedCardSchema = new Schema<TwitchCcgAssignedCard>(
  {
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", required: true },
    setId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true },
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true },
    snapshotVersion: { type: Number, min: 1, required: true },
    finish: { type: String, required: true },
    artVariant: { type: String, enum: ["standard", "alternative"], required: true },
    tierGrade: { type: String, enum: ["H", "S", "A", "B", "C", "D", "E", "F"], required: true },
    poolVersion: { type: String, required: true },
  },
  { _id: false },
);

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
    rewardKind: { type: String, enum: ["packs", "packs_10", "card_reveal"], required: true, default: "packs", index: true },
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
    assignedCard: { type: TwitchCcgAssignedCardSchema },
    assignedCards: { type: [TwitchCcgAssignedCardSchema], default: undefined },
    grantStatus: { type: String, enum: ["pending", "granted", "failed"], required: true, default: "pending", index: true },
    grantedUserId: { type: Schema.Types.ObjectId, ref: "User" },
    grantedAt: { type: Date },
    grantAttempts: { type: Number, required: true, default: 0 },
    grantNextAttemptAt: { type: Date, required: true, default: Date.now },
    grantLastError: { type: String },
    chatStatus: { type: String, enum: ["pending", "sent", "skipped", "failed", "expired"], required: true, default: "pending", index: true },
    chatAttempts: { type: Number, required: true, default: 0 },
    chatNextAttemptAt: { type: Date, required: true, default: Date.now },
    chatExpiresAt: { type: Date, required: true },
    chatSentAt: { type: Date },
    chatMessageKind: { type: String, enum: ["account_link", "delivery_error"] },
    chatLastError: { type: String },
  },
  { timestamps: true },
);

TwitchCcgRedemptionSchema.index({ twitchUserId: 1, grantStatus: 1, grantNextAttemptAt: 1, redeemedAt: 1 });
TwitchCcgRedemptionSchema.index({ grantedUserId: 1, grantStatus: 1, redeemedAt: -1 });
TwitchCcgRedemptionSchema.index({ chatStatus: 1, chatNextAttemptAt: 1, chatExpiresAt: 1 });
TwitchCcgRedemptionSchema.index({ twitchUserId: 1, chatMessageKind: 1, chatSentAt: -1 });
TwitchCcgRedemptionSchema.index({ rewardKind: 1, assignmentStatus: 1, assignmentNextAttemptAt: 1 });

export default mongoose.model<ITwitchCcgRedemption>("TwitchCcgRedemption", TwitchCcgRedemptionSchema);
