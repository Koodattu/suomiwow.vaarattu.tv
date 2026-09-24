import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true },
  setId: { type: Schema.Types.ObjectId, required: true },
  characterId: { type: Schema.Types.ObjectId, required: true },
  duplicates: { type: Number, required: true, min: 0 },
  processedMilestones: { type: Number, required: true, min: 0, default: 0 },
});
schema.index({ ownerId: 1, setId: 1, characterId: 1 }, { unique: true });
export default mongoose.model("CcgDuplicateRewardProgress", schema);
