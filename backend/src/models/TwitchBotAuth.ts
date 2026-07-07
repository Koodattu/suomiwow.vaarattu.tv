import mongoose, { Schema, Document } from "mongoose";

export interface ITwitchBotAuth extends Document {
  key: string;
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  scope?: string[];
  expiresIn: number;
  obtainmentTimestamp: number;
  tokenExpiresAt: Date;
  twitchUserId?: string;
  twitchLogin?: string;
  twitchDisplayName?: string;
  connectedAt: Date;
  connectedByUserId?: mongoose.Types.ObjectId;
  connectedByUsername?: string;
  lastRefreshAt?: Date;
  lastRefreshError?: string;
  lastVerifiedAt?: Date;
  lastVerifiedError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchBotAuthSchema = new Schema<ITwitchBotAuth>(
  {
    key: { type: String, required: true, unique: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenType: { type: String },
    scope: [{ type: String }],
    expiresIn: { type: Number, required: true, default: 0 },
    obtainmentTimestamp: { type: Number, required: true, default: 0 },
    tokenExpiresAt: { type: Date, required: true },
    twitchUserId: { type: String },
    twitchLogin: { type: String },
    twitchDisplayName: { type: String },
    connectedAt: { type: Date, required: true, default: Date.now },
    connectedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    connectedByUsername: { type: String },
    lastRefreshAt: { type: Date },
    lastRefreshError: { type: String },
    lastVerifiedAt: { type: Date },
    lastVerifiedError: { type: String },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<ITwitchBotAuth>("TwitchBotAuth", TwitchBotAuthSchema);
