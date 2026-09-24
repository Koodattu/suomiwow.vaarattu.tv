import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, unique: true },
  initializedAt: { type: Date, required: true },
  historicalPacks: { type: Number, required: true, min: 0, default: 0 },
  breakdown: { raid: { type: Number, default: 0 }, community: { type: Number, default: 0 }, supporter: { type: Number, default: 0 } },
  claimedAt: { type: Date, default: null },
  revision: { type: Number, default: 0 },
});

export default mongoose.model("CcgDuplicateRewardAccount", schema);
