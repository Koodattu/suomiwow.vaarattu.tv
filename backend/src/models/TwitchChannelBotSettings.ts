import mongoose, { Document, Schema } from "mongoose";

export interface ITwitchChannelBotSettings extends Document {
  channelName: string;
  alertsEnabled: boolean;
  commandsEnabled: boolean;
  joinAnnouncementEnabled: boolean;
  lastJoinAnnouncementAt?: Date;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchChannelBotSettingsSchema = new Schema<ITwitchChannelBotSettings>(
  {
    channelName: { type: String, required: true, unique: true, lowercase: true, trim: true },
    alertsEnabled: { type: Boolean, required: true, default: true },
    commandsEnabled: { type: Boolean, required: true, default: true },
    joinAnnouncementEnabled: { type: Boolean, required: true, default: true },
    lastJoinAnnouncementAt: { type: Date },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true },
);

export default mongoose.model<ITwitchChannelBotSettings>("TwitchChannelBotSettings", TwitchChannelBotSettingsSchema);
