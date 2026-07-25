import mongoose, { Document, Schema } from "mongoose";

export interface ICcgRollover extends Document {
  sequence: number;
  fromSetIds: mongoose.Types.ObjectId[];
  fromSeasons: string[];
  toSetId: mongoose.Types.ObjectId;
  toSeason: string;
  effectiveAt: Date;
  activatedBy: mongoose.Types.ObjectId;
  userCurrentPacks: number;
  guestCurrentPacks: number;
  createdAt: Date;
}

const CcgRolloverSchema = new Schema<ICcgRollover>(
  {
    sequence: { type: Number, required: true, min: 1, unique: true, index: true },
    fromSetIds: { type: [Schema.Types.ObjectId], ref: "CcgSet", required: true },
    fromSeasons: { type: [String], required: true },
    toSetId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true, index: true },
    toSeason: { type: String, required: true },
    effectiveAt: { type: Date, required: true, index: true },
    activatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userCurrentPacks: { type: Number, required: true, min: 0 },
    guestCurrentPacks: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.model<ICcgRollover>("CcgRollover", CcgRolloverSchema);
