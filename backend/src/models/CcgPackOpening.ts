import mongoose, { Document, Schema } from "mongoose";
import { CcgFinish, CcgMode, CcgTierGrade } from "../config/ccg";
import { CcgOwnerType } from "./CcgOwnership";

export type CcgAllowanceSource = "daily" | "credit";

export interface ICcgPackResult {
  cardId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  finish: CcgFinish;
  tierGrade: CcgTierGrade;
  isDuplicate: boolean;
}

export interface ICcgPackOpening extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  mode: CcgMode;
  sourceSetIds: mongoose.Types.ObjectId[];
  allowanceSource: CcgAllowanceSource;
  creditId?: mongoose.Types.ObjectId | null;
  idempotencyKey: string;
  poolVersion: string;
  packRuleVersion: string;
  results: ICcgPackResult[];
  duplicateRewards: number;
  state: "committed";
  dateKey?: string | null;
  expiresAt?: Date | null;
  claimedByUserId?: mongoose.Types.ObjectId | null;
  claimedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ResultSchema = new Schema<ICcgPackResult>(
  {
    cardId: { type: Schema.Types.ObjectId, ref: "CcgCard", required: true },
    setId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true },
    finish: { type: String, enum: ["standard", "golden", "prismatic"], required: true },
    tierGrade: { type: String, enum: ["S", "A", "B", "C", "D", "E", "F"], required: true },
    isDuplicate: { type: Boolean, required: true },
  },
  { _id: false },
);

const CcgPackOpeningSchema = new Schema<ICcgPackOpening>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    mode: { type: String, enum: ["current", "legacy"], required: true, index: true },
    sourceSetIds: { type: [Schema.Types.ObjectId], ref: "CcgSet", required: true, default: [] },
    allowanceSource: { type: String, enum: ["daily", "credit"], required: true },
    creditId: { type: Schema.Types.ObjectId, ref: "CcgPackCredit", default: null },
    idempotencyKey: { type: String, required: true },
    poolVersion: { type: String, required: true },
    packRuleVersion: { type: String, required: true },
    results: { type: [ResultSchema], required: true },
    duplicateRewards: { type: Number, required: true, default: 0 },
    state: { type: String, enum: ["committed"], required: true, default: "committed" },
    dateKey: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    claimedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CcgPackOpeningSchema.index({ ownerType: 1, ownerId: 1, idempotencyKey: 1 }, { unique: true });
CcgPackOpeningSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
CcgPackOpeningSchema.index({ sourceSetIds: 1, createdAt: -1 });
CcgPackOpeningSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ICcgPackOpening>("CcgPackOpening", CcgPackOpeningSchema);
