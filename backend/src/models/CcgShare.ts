import mongoose, { Document, Schema } from "mongoose";
import { CCG_FINISH_ORDER, CcgArtVariant, CcgFinish } from "../config/ccg";

export type CcgShareKind = "card" | "pack";

export interface ICcgShare extends Document {
  publicId: string;
  shortId?: string;
  kind: CcgShareKind;
  userId: mongoose.Types.ObjectId;
  cardId?: mongoose.Types.ObjectId | null;
  openingId?: mongoose.Types.ObjectId | null;
  finish?: CcgFinish | null;
  artVariant?: CcgArtVariant | null;
  createdAt: Date;
  updatedAt: Date;
}

const CcgShareSchema = new Schema<ICcgShare>(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    shortId: { type: String, unique: true, sparse: true, index: true },
    kind: { type: String, enum: ["card", "pack"], required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", default: null },
    openingId: { type: Schema.Types.ObjectId, ref: "CcgPackOpening", default: null },
    finish: { type: String, enum: CCG_FINISH_ORDER, default: null },
    artVariant: { type: String, enum: ["standard", "alternative"], default: null },
  },
  { timestamps: true },
);

CcgShareSchema.index(
  { kind: 1, userId: 1, cardId: 1, finish: 1, artVariant: 1 },
  { unique: true, partialFilterExpression: { kind: "card" } },
);
CcgShareSchema.index(
  { kind: 1, userId: 1, openingId: 1 },
  { unique: true, partialFilterExpression: { kind: "pack" } },
);

export default mongoose.model<ICcgShare>("CcgShare", CcgShareSchema);
