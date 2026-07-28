import mongoose, { Document, Schema } from "mongoose";
import { CCG_FINISH_ORDER, CcgArtVariant, CcgFinish } from "../config/ccg";

export interface ICcgShowcaseCard {
  cardId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
}

export interface ICcgCollectorProfile extends Document {
  userId: mongoose.Types.ObjectId;
  showcase: ICcgShowcaseCard[];
  createdAt: Date;
  updatedAt: Date;
}

const ShowcaseCardSchema = new Schema<ICcgShowcaseCard>(
  {
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", required: true },
    finish: { type: String, enum: CCG_FINISH_ORDER, required: true },
    artVariant: { type: String, enum: ["standard", "alternative"], required: true },
  },
  { _id: false },
);

const CcgCollectorProfileSchema = new Schema<ICcgCollectorProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    showcase: { type: [ShowcaseCardSchema], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model<ICcgCollectorProfile>("CcgCollectorProfile", CcgCollectorProfileSchema);
