import mongoose, { Schema, Document } from "mongoose";
import type { EventType } from "./Event";

export type TwitchBotDifficulty = "mythic" | "heroic";
export type TwitchBotMessageTemplateKey = "bossKill" | "bestPull" | "progressUpdate";

export type TwitchBotMessageTemplates = Record<TwitchBotMessageTemplateKey, string>;

export interface ITwitchBotSettings extends Document {
  key: string;
  eventPublishingEnabled: boolean;
  eventTypes: EventType[];
  difficulties: TwitchBotDifficulty[];
  includeUrl: boolean;
  messageTemplates?: Partial<TwitchBotMessageTemplates>;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchBotSettingsSchema = new Schema<ITwitchBotSettings>(
  {
    key: { type: String, required: true, unique: true },
    eventPublishingEnabled: { type: Boolean, required: true, default: true },
    eventTypes: [{ type: String }],
    difficulties: [{ type: String }],
    includeUrl: { type: Boolean, required: true, default: true },
    messageTemplates: {
      bossKill: { type: String },
      bestPull: { type: String },
      progressUpdate: { type: String },
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<ITwitchBotSettings>("TwitchBotSettings", TwitchBotSettingsSchema);
