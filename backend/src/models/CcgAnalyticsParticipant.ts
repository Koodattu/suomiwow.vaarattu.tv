import mongoose, { Document, Schema } from "mongoose";
import { CcgOwnerType } from "./CcgOwnership";

export interface ICcgAnalyticsParticipant extends Document {
  ownerKey: string;
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  packOpenings: number;
  firstOpenedAt: Date;
  lastOpenedAt: Date;
}

const CcgAnalyticsParticipantSchema = new Schema<ICcgAnalyticsParticipant>(
  {
    ownerKey: { type: String, required: true, unique: true, index: true },
    ownerType: { type: String, enum: ["user", "guest"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    packOpenings: { type: Number, required: true, min: 1 },
    firstOpenedAt: { type: Date, required: true },
    lastOpenedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

CcgAnalyticsParticipantSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
CcgAnalyticsParticipantSchema.index({ packOpenings: -1, ownerKey: 1 });

export default mongoose.model<ICcgAnalyticsParticipant>("CcgAnalyticsParticipant", CcgAnalyticsParticipantSchema);
