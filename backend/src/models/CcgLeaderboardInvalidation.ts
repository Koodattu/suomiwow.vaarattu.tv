import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  key: { type: String, required: true, unique: true },
  revision: { type: Number, default: 0, required: true },
  completedRevision: { type: Number, default: 0, required: true },
}, { timestamps: true });
export default mongoose.model("CcgLeaderboardInvalidation", schema);
