import mongoose, { Document, Schema } from "mongoose";

export interface ITwitchChannelPointsAuth extends Document {
  key: string;
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  scope: string[];
  expiresIn: number;
  obtainmentTimestamp: number;
  tokenExpiresAt: Date;
  broadcasterUserId: string;
  broadcasterLogin: string;
  broadcasterDisplayName: string;
  connectedAt: Date;
  connectedByUserId?: mongoose.Types.ObjectId;
  connectedByUsername?: string;
  enabled: boolean;
  rewardId?: string;
  rewardTitle?: string;
  webhookSecret: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  subscriptionCreatedAt?: Date;
  lastNotificationAt?: Date;
  tenPackRewardEnabled: boolean;
  tenPackRewardId?: string;
  tenPackRewardTitle?: string;
  tenPackSubscriptionId?: string;
  tenPackSubscriptionStatus?: string;
  tenPackSubscriptionCreatedAt?: Date;
  tenPackLastNotificationAt?: Date;
  tenPackLastError?: string;
  cardRewardEnabled: boolean;
  cardRewardId?: string;
  cardRewardTitle?: string;
  cardSubscriptionId?: string;
  cardSubscriptionStatus?: string;
  cardSubscriptionCreatedAt?: Date;
  cardLastNotificationAt?: Date;
  cardLastError?: string;
  overlayTokenHash?: string;
  overlayTokenCreatedAt?: Date;
  overlayLastSeenAt?: Date;
  lastRefreshAt?: Date;
  lastRefreshError?: string;
  lastVerifiedAt?: Date;
  lastVerifiedError?: string;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchChannelPointsAuthSchema = new Schema<ITwitchChannelPointsAuth>(
  {
    key: { type: String, required: true, unique: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenType: { type: String },
    scope: [{ type: String, required: true }],
    expiresIn: { type: Number, required: true, default: 0 },
    obtainmentTimestamp: { type: Number, required: true, default: 0 },
    tokenExpiresAt: { type: Date, required: true },
    broadcasterUserId: { type: String, required: true, index: true },
    broadcasterLogin: { type: String, required: true },
    broadcasterDisplayName: { type: String, required: true },
    connectedAt: { type: Date, required: true, default: Date.now },
    connectedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    connectedByUsername: { type: String },
    enabled: { type: Boolean, required: true, default: false },
    rewardId: { type: String },
    rewardTitle: { type: String },
    webhookSecret: { type: String, required: true },
    subscriptionId: { type: String },
    subscriptionStatus: { type: String },
    subscriptionCreatedAt: { type: Date },
    lastNotificationAt: { type: Date },
    tenPackRewardEnabled: { type: Boolean, required: true, default: false },
    tenPackRewardId: { type: String },
    tenPackRewardTitle: { type: String },
    tenPackSubscriptionId: { type: String },
    tenPackSubscriptionStatus: { type: String },
    tenPackSubscriptionCreatedAt: { type: Date },
    tenPackLastNotificationAt: { type: Date },
    tenPackLastError: { type: String },
    cardRewardEnabled: { type: Boolean, required: true, default: false },
    cardRewardId: { type: String },
    cardRewardTitle: { type: String },
    cardSubscriptionId: { type: String },
    cardSubscriptionStatus: { type: String },
    cardSubscriptionCreatedAt: { type: Date },
    cardLastNotificationAt: { type: Date },
    cardLastError: { type: String },
    overlayTokenHash: { type: String },
    overlayTokenCreatedAt: { type: Date },
    overlayLastSeenAt: { type: Date },
    lastRefreshAt: { type: Date },
    lastRefreshError: { type: String },
    lastVerifiedAt: { type: Date },
    lastVerifiedError: { type: String },
    lastError: { type: String },
  },
  { timestamps: true },
);

export default mongoose.model<ITwitchChannelPointsAuth>("TwitchChannelPointsAuth", TwitchChannelPointsAuthSchema);
