import mongoose, { Schema } from "mongoose";

const CcgSupporterGrantSchema = new Schema({
  creatorId: { type: Schema.Types.ObjectId, ref: "CcgSupporterCreator", required: true, index: true },
  broadcasterId: { type: String, required: true },
  twitchUserId: { type: String, required: true },
  kind: { type: String, enum: ["follower", "subscriber", "monthly"], required: true },
  period: { type: String, required: true },
  amount: { type: Number, required: true },
  observedAt: { type: Date, required: true },
}, { timestamps: true });

CcgSupporterGrantSchema.index({ broadcasterId: 1, twitchUserId: 1, kind: 1, period: 1 }, { unique: true });
export default mongoose.model("CcgSupporterGrant", CcgSupporterGrantSchema);
