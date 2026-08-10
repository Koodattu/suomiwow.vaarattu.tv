import mongoose, { Schema, Document } from "mongoose";

export interface ITwitchBotChannelBan {
  reason: "msg_banned";
  detectedAt: Date;
  lastAttemptAt: Date;
  nextRetryAt: Date;
  failureCount: number;
}

export type TwitchBotCommandOutcome =
  | "received"
  | "replied"
  | "unsupported"
  | "channel_not_allowed"
  | "cooldown"
  | "no_response"
  | "handler_failed"
  | "reply_failed";

export interface ITwitchBotRuntimeState extends Document {
  key: string;
  enabled: boolean;
  running: boolean;
  connected: boolean;
  desiredChannels: string[];
  joinedChannels: string[];
  channelBansBotUserId?: string;
  channelBans: Map<string, ITwitchBotChannelBan>;
  lastEventCreatedAt?: Date;
  lastStartedAt?: Date;
  lastStoppedAt?: Date;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
  lastReconciledAt?: Date;
  lastMessageAt?: Date;
  lastInboundMessageAt?: Date;
  lastInboundChannel?: string;
  lastCommandAt?: Date;
  lastCommandChannel?: string;
  lastCommandName?: string;
  lastCommandOutcome?: TwitchBotCommandOutcome;
  lastErrorAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchBotChannelBanSchema = new Schema<ITwitchBotChannelBan>(
  {
    reason: { type: String, required: true, enum: ["msg_banned"] },
    detectedAt: { type: Date, required: true },
    lastAttemptAt: { type: Date, required: true },
    nextRetryAt: { type: Date, required: true },
    failureCount: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const TwitchBotRuntimeStateSchema = new Schema<ITwitchBotRuntimeState>(
  {
    key: { type: String, required: true, unique: true },
    enabled: { type: Boolean, required: true, default: false },
    running: { type: Boolean, required: true, default: false },
    connected: { type: Boolean, required: true, default: false },
    desiredChannels: [{ type: String }],
    joinedChannels: [{ type: String }],
    channelBansBotUserId: { type: String },
    channelBans: { type: Map, of: TwitchBotChannelBanSchema, default: {} },
    lastEventCreatedAt: { type: Date },
    lastStartedAt: { type: Date },
    lastStoppedAt: { type: Date },
    lastConnectedAt: { type: Date },
    lastDisconnectedAt: { type: Date },
    lastReconciledAt: { type: Date },
    lastMessageAt: { type: Date },
    lastInboundMessageAt: { type: Date },
    lastInboundChannel: { type: String },
    lastCommandAt: { type: Date },
    lastCommandChannel: { type: String },
    lastCommandName: { type: String },
    lastCommandOutcome: {
      type: String,
      enum: ["received", "replied", "unsupported", "channel_not_allowed", "cooldown", "no_response", "handler_failed", "reply_failed"],
    },
    lastErrorAt: { type: Date },
    lastError: { type: String },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<ITwitchBotRuntimeState>("TwitchBotRuntimeState", TwitchBotRuntimeStateSchema);
