import mongoose, { Document, Schema } from "mongoose";

export interface ICcgGuest extends Document {
  tokenHash: string;
  dateKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  claimedByUserId?: mongoose.Types.ObjectId | null;
  claimedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CcgGuestSchema = new Schema<ICcgGuest>(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    dateKey: { type: String, required: true, index: true },
    firstSeenAt: { type: Date, required: true, default: Date.now },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    claimedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CcgGuestSchema.index({ dateKey: 1, expiresAt: 1 });
CcgGuestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ICcgGuest>("CcgGuest", CcgGuestSchema);
