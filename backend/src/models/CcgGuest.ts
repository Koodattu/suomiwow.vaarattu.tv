import mongoose, { Document, Schema } from "mongoose";

export interface ICcgGuest extends Document {
  tokenHash: string;
  dateKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
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
    claimedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model<ICcgGuest>("CcgGuest", CcgGuestSchema);
