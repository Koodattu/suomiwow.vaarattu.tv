import mongoose, { Document, Schema } from "mongoose";
import { CCG_FINISH_ORDER, CcgFinish } from "../config/ccg";

export type CcgOwnerType = "user" | "guest";

export interface ICcgOwnership extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  cardId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  quantity: number;
  alternativeQuantity: number;
  firstAcquiredAt: Date;
  lastAcquiredAt: Date;
  dateKey?: string | null;
}

const CcgOwnershipSchema = new Schema<ICcgOwnership>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    setId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true, index: true },
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", required: true, index: true },
    finish: { type: String, enum: CCG_FINISH_ORDER, required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    alternativeQuantity: { type: Number, required: true, min: 0, default: 0 },
    firstAcquiredAt: { type: Date, required: true, default: Date.now },
    lastAcquiredAt: { type: Date, required: true, default: Date.now },
    dateKey: { type: String, default: null },
  },
  { timestamps: false },
);

CcgOwnershipSchema.index({ ownerType: 1, ownerId: 1, cardId: 1, finish: 1 }, { unique: true });
CcgOwnershipSchema.index(
  { ownerType: 1, ownerId: 1, setId: 1, characterId: 1, finish: 1 },
  {
    unique: true,
    name: "ccg_ownership_owner_series_finish",
    partialFilterExpression: { setId: { $type: "objectId" }, characterId: { $type: "objectId" } },
  },
);
CcgOwnershipSchema.index({ ownerType: 1, ownerId: 1, lastAcquiredAt: -1 });

export default mongoose.model<ICcgOwnership>("CcgOwnership", CcgOwnershipSchema);
