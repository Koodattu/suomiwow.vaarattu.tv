import mongoose, { Schema, Document } from "mongoose";

export interface IStreamer {
  channelName: string; // Twitch channel name (login name)
  // Missing adminManaged on legacy records is intentionally treated as true.
  adminManaged?: boolean; // Whether an admin explicitly attached this channel to the guild
  managedByUserId?: string; // Site user who selected this guild through self-service
  isLive: boolean; // Current live status
  isPlayingWoW: boolean; // Whether the streamer is playing World of Warcraft
  gameName?: string; // Current game being played
  twitchUserId?: string; // Twitch broadcaster user ID
  currentStreamId?: string; // Current Twitch stream ID while live
  streamStartedAt?: Date; // Current stream start time while live
  lastStreamId?: string; // Most recent known stream ID
  lastStreamStartedAt?: Date; // Most recent known stream start time
  lastStreamEndedAt?: Date; // When we last observed the stream offline
  lastLiveAt?: Date; // Last time the channel was observed live
  lastChecked?: Date; // Last time we checked the status
}

const StreamerSchema = new Schema<IStreamer>(
  {
    channelName: { type: String, required: true },
    adminManaged: { type: Boolean, default: true },
    managedByUserId: { type: String },
    isLive: { type: Boolean, required: true, default: false },
    isPlayingWoW: { type: Boolean, required: true, default: false },
    gameName: { type: String },
    twitchUserId: { type: String },
    currentStreamId: { type: String },
    streamStartedAt: { type: Date },
    lastStreamId: { type: String },
    lastStreamStartedAt: { type: Date },
    lastStreamEndedAt: { type: Date },
    lastLiveAt: { type: Date },
    lastChecked: { type: Date },
  },
  { _id: false } // Don't create separate _id for subdocuments
);

export default StreamerSchema;
