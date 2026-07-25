import mongoose, { Document, Schema } from "mongoose";
import { CcgOwnerType } from "./CcgOwnership";

export interface ICcgAnalyticsDailyParticipant extends Document {
  dateKey: string;
  ownerKey: string;
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  firstOpenedAt: Date;
  lastOpenedAt: Date;
}

const CcgAnalyticsDailyParticipantSchema = new Schema<ICcgAnalyticsDailyParticipant>(
  {
    dateKey: { type: String, required: true },
    ownerKey: { type: String, required: true },
    ownerType: { type: String, enum: ["user", "guest"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    firstOpenedAt: { type: Date, required: true },
    lastOpenedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

CcgAnalyticsDailyParticipantSchema.index({ dateKey: 1, ownerKey: 1 }, { unique: true });
CcgAnalyticsDailyParticipantSchema.index({ ownerKey: 1, dateKey: 1 });

export default mongoose.model<ICcgAnalyticsDailyParticipant>("CcgAnalyticsDailyParticipant", CcgAnalyticsDailyParticipantSchema);
