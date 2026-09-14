import mongoose, { Schema } from "mongoose";

const CacheRefreshLeaseSchema = new Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { collection: "api_cache_refresh_leases", versionKey: false });

CacheRefreshLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("CacheRefreshLease", CacheRefreshLeaseSchema);
