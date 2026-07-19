import mongoose, { Document, Schema } from "mongoose";

export interface IGuildNetworkMovementSnapshotChunk extends Document {
  snapshotId: mongoose.Types.ObjectId;
  index: number;
  data: string;
  createdAt: Date;
}

const GuildNetworkMovementSnapshotChunkSchema = new Schema<IGuildNetworkMovementSnapshotChunk>(
  {
    snapshotId: { type: Schema.Types.ObjectId, ref: "GuildNetworkMovementSnapshot", required: true, index: true },
    index: { type: Number, required: true },
    data: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

GuildNetworkMovementSnapshotChunkSchema.index({ snapshotId: 1, index: 1 }, { unique: true });
GuildNetworkMovementSnapshotChunkSchema.index({ createdAt: 1 });

export default mongoose.model<IGuildNetworkMovementSnapshotChunk>("GuildNetworkMovementSnapshotChunk", GuildNetworkMovementSnapshotChunkSchema);
