import mongoose, { Document, Schema } from "mongoose";

export interface IGuildNetworkMovementSnapshot extends Document {
  batchId: string;
  raidId: number;
  schemaVersion: number;
  generatedAt: Date;
  sourceUpdatedAt?: Date | null;
  rowCount: number;
  reportCount: number;
  guildCount: number;
  characterCount: number;
  byteLength: number;
  chunkCount: number;
  chunkSize: number;
  etag: string;
  createdAt: Date;
}

const GuildNetworkMovementSnapshotSchema = new Schema<IGuildNetworkMovementSnapshot>(
  {
    batchId: { type: String, required: true, index: true },
    raidId: { type: Number, required: true, index: true },
    schemaVersion: { type: Number, required: true },
    generatedAt: { type: Date, required: true, index: true },
    sourceUpdatedAt: { type: Date, default: null },
    rowCount: { type: Number, required: true },
    reportCount: { type: Number, required: true },
    guildCount: { type: Number, required: true },
    characterCount: { type: Number, required: true },
    byteLength: { type: Number, required: true },
    chunkCount: { type: Number, required: true },
    chunkSize: { type: Number, required: true },
    etag: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

GuildNetworkMovementSnapshotSchema.index({ batchId: 1, raidId: 1 }, { unique: true });
GuildNetworkMovementSnapshotSchema.index({ createdAt: 1 });

export default mongoose.model<IGuildNetworkMovementSnapshot>("GuildNetworkMovementSnapshot", GuildNetworkMovementSnapshotSchema);
