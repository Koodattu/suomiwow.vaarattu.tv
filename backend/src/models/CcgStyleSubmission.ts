import mongoose, { Document, Schema } from "mongoose";
import { CCG_FINISH_ORDER, CcgArtVariant, CcgFinish } from "../config/ccg";

export interface ICcgStyleSubmission extends Document {
  ownerType: "user" | "guest";
  ownerId: mongoose.Types.ObjectId;
  dateKey: string;
  theme: string;
  cardId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  createdAt: Date;
  updatedAt: Date;
}

const CcgStyleSubmissionSchema = new Schema<ICcgStyleSubmission>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    theme: { type: String, required: true, index: true },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", required: true },
    finish: { type: String, enum: CCG_FINISH_ORDER, required: true },
    artVariant: { type: String, enum: ["standard", "alternative"], required: true },
  },
  { timestamps: true },
);

CcgStyleSubmissionSchema.index({ ownerType: 1, ownerId: 1, dateKey: 1, theme: 1 }, { unique: true });
CcgStyleSubmissionSchema.index({ dateKey: 1, theme: 1, createdAt: 1 });

export default mongoose.model<ICcgStyleSubmission>("CcgStyleSubmission", CcgStyleSubmissionSchema);
