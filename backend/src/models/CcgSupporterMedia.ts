import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  sourceId: { type: Schema.Types.ObjectId, ref: "CcgSupporterCharacter", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  kind: { type: String, enum: ["image", "audio"], required: true },
  status: { type: String, enum: ["processing", "pending", "approved", "rejected", "withdrawn", "superseded", "failed"], required: true },
  storageKey: String,
  contentType: String,
  byteLength: Number,
  sha256: String,
  width: Number,
  height: Number,
  duration: Number,
  reason: { type: String, maxlength: 500, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  purgeAfter: { type: Date, default: null, index: true },
  purgedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ sourceId: 1, kind: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["processing", "pending"] } }, name: "one_pending_media" });
schema.index({ sourceId: 1, kind: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "approved" }, name: "one_approved_media" });
schema.index({ status: 1, createdAt: 1 });

export default mongoose.model("CcgSupporterMedia", schema);
