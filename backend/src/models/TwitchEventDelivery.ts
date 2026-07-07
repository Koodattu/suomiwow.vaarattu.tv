import mongoose, { Schema, Document } from "mongoose";

export type TwitchEventDeliveryStatus = "pending" | "sent" | "failed" | "expired";

export interface ITwitchEventDelivery extends Document {
  eventId: mongoose.Types.ObjectId;
  guildId: mongoose.Types.ObjectId;
  channelName: string;
  status: TwitchEventDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  expiresAt: Date;
  sentAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitchEventDeliverySchema = new Schema<ITwitchEventDelivery>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true },
    channelName: { type: String, required: true },
    status: { type: String, enum: ["pending", "sent", "failed", "expired"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    sentAt: { type: Date },
    lastError: { type: String },
  },
  {
    timestamps: true,
  },
);

TwitchEventDeliverySchema.index({ eventId: 1, channelName: 1 }, { unique: true });
TwitchEventDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
TwitchEventDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
TwitchEventDeliverySchema.index({ guildId: 1, createdAt: -1 });

export default mongoose.model<ITwitchEventDelivery>("TwitchEventDelivery", TwitchEventDeliverySchema);
