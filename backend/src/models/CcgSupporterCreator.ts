import mongoose, { Schema } from "mongoose";

const CcgSupporterCreatorSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  twitchUserId: { type: String },
  battlenetId: { type: String },
  earnedSlots: { type: Number, default: 0, min: 0, required: true },
  usedSlots: { type: Number, default: 0, min: 0, required: true },
  draftCount: { type: Number, default: 0, min: 0, required: true },
  trackingEnabled: { type: Boolean, default: false, required: true },
  trackingStartedAt: { type: Date, default: null },
  connectedSince: { type: Date, default: null },
  connectionRevision: { type: Number, default: 0, required: true },
  firstSubscriberMonth: { type: String, default: null },
  following: { type: Boolean, default: null },
  subscribed: { type: Boolean, default: null },
  tier: { type: String, default: null },
  checkedAt: { type: Date, default: null },
  statusObservedAt: { type: Date, default: null },
  checkedMonth: { type: String, default: null },
  attemptMonth: { type: String, default: null },
  checkLeaseUntil: { type: Date, default: () => new Date(0), required: true },
  nextManualCheckAt: { type: Date, default: () => new Date(0), required: true },
  checkError: { type: String, default: null },
  nextCheckAt: { type: Date, default: () => new Date(0), index: true },
}, { timestamps: true });

CcgSupporterCreatorSchema.index({ twitchUserId: 1 }, { unique: true, sparse: true });
CcgSupporterCreatorSchema.index({ battlenetId: 1 }, { unique: true, sparse: true });
export default mongoose.model("CcgSupporterCreator", CcgSupporterCreatorSchema);
