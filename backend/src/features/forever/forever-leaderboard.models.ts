import mongoose, { Schema } from "mongoose";
import type { ICache } from "../../models/Cache";

// Reuse the shared cache protocol, but keep all Forever data in its own collections.
const snapshotSchema = new Schema<ICache>({
  key: { type: String, required: true, unique: true },
  data: { type: Schema.Types.Mixed, required: true },
  cachedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  staleExpiresAt: Date,
  ttlMs: { type: Number, required: true },
  endpoint: { type: String, required: true },
}, { collection: "forever_leaderboard_cache", timestamps: false });
snapshotSchema.index({ staleExpiresAt: 1 }, { expireAfterSeconds: 0 });

const leaseSchema = new Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { collection: "forever_leaderboard_leases", versionKey: false });
leaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ForeverLeaderboardCache = mongoose.model<ICache>("ForeverLeaderboardCache", snapshotSchema);
export const ForeverLeaderboardLease = mongoose.model("ForeverLeaderboardLease", leaseSchema);
