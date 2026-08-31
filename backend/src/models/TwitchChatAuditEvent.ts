import mongoose, { Document, Schema } from "mongoose";
import type { TwitchBotCommandOutcome } from "./TwitchBotRuntimeState";

export type TwitchChatAuditDirection = "inbound" | "outbound";
export type TwitchChatAuditKind =
  | "command"
  | "mention"
  | "command_reply"
  | "progress_alert"
  | "join_announcement"
  | "reward"
  | "system_reply";
export type TwitchChatAuditDeliveryStatus = "received" | "sent" | "failed";

export interface ITwitchChatAuditEvent extends Document {
  direction: TwitchChatAuditDirection;
  kind: TwitchChatAuditKind;
  channelName: string;
  message: string;
  twitchMessageId?: string;
  userId?: string;
  userName?: string;
  userDisplayName?: string;
  commandName?: string;
  commandOutcome?: TwitchBotCommandOutcome;
  deliveryStatus: TwitchChatAuditDeliveryStatus;
  relatedEventId?: mongoose.Types.ObjectId;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchChatAuditEventSchema = new Schema<ITwitchChatAuditEvent>(
  {
    direction: { type: String, required: true, enum: ["inbound", "outbound"] },
    kind: {
      type: String,
      required: true,
      enum: ["command", "mention", "command_reply", "progress_alert", "join_announcement", "reward", "system_reply"],
    },
    channelName: { type: String, required: true, lowercase: true, trim: true },
    message: { type: String, required: true },
    twitchMessageId: { type: String },
    userId: { type: String },
    userName: { type: String, lowercase: true, trim: true },
    userDisplayName: { type: String, trim: true },
    commandName: { type: String, lowercase: true, trim: true },
    commandOutcome: {
      type: String,
      enum: ["received", "replied", "unsupported", "channel_not_allowed", "channel_disabled", "cooldown", "no_response", "handler_failed", "reply_failed"],
    },
    deliveryStatus: { type: String, required: true, enum: ["received", "sent", "failed"] },
    relatedEventId: { type: Schema.Types.ObjectId, ref: "TwitchChatAuditEvent" },
    error: { type: String },
  },
  { timestamps: true },
);

TwitchChatAuditEventSchema.index({ createdAt: -1 });
TwitchChatAuditEventSchema.index({ channelName: 1, createdAt: -1 });
TwitchChatAuditEventSchema.index({ kind: 1, createdAt: -1 });
TwitchChatAuditEventSchema.index({ commandName: 1, createdAt: -1 });

export default mongoose.model<ITwitchChatAuditEvent>("TwitchChatAuditEvent", TwitchChatAuditEventSchema);
