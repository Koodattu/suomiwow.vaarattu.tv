import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  messageId: { type: String, required: true, unique: true },
  creatorId: { type: Schema.Types.ObjectId, ref: "CcgSupporterCreator", required: true },
  broadcasterId: { type: String, required: true },
  connectionRevision: { type: Number, required: true },
  observedAt: { type: Date, required: true },
  subscribed: { type: Boolean, required: true },
  tier: { type: String, default: null },
  processed: { type: Boolean, default: false, required: true, index: true },
}, { timestamps: true });
export default mongoose.model("CcgSupporterEvent", schema);
