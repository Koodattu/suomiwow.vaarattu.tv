import mongoose, { Schema, Document } from "mongoose";

export interface ITwitchBotRuntimeState extends Document {
  key: string;
  enabled: boolean;
  running: boolean;
  connected: boolean;
  desiredChannels: string[];
  joinedChannels: string[];
  lastEventCreatedAt?: Date;
  lastStartedAt?: Date;
  lastStoppedAt?: Date;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
  lastReconciledAt?: Date;
  lastMessageAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchBotRuntimeStateSchema = new Schema<ITwitchBotRuntimeState>(
  {
    key: { type: String, required: true, unique: true },
    enabled: { type: Boolean, required: true, default: false },
    running: { type: Boolean, required: true, default: false },
    connected: { type: Boolean, required: true, default: false },
    desiredChannels: [{ type: String }],
    joinedChannels: [{ type: String }],
    lastEventCreatedAt: { type: Date },
    lastStartedAt: { type: Date },
    lastStoppedAt: { type: Date },
    lastConnectedAt: { type: Date },
    lastDisconnectedAt: { type: Date },
    lastReconciledAt: { type: Date },
    lastMessageAt: { type: Date },
    lastErrorAt: { type: Date },
    lastError: { type: String },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<ITwitchBotRuntimeState>("TwitchBotRuntimeState", TwitchBotRuntimeStateSchema);
