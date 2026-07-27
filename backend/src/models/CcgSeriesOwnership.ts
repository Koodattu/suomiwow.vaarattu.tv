import mongoose, { Document, Schema } from "mongoose";
import type { CcgOwnerType } from "./CcgOwnership";

export interface ICcgSeriesOwnership extends Document {
  ownerType: CcgOwnerType;
  ownerId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  unlockedSnapshotVersions: number[];
  firstAcquiredAt: Date;
  lastAcquiredAt: Date;
  dateKey?: string | null;
  expiresAt?: Date | null;
}

const CcgSeriesOwnershipSchema = new Schema<ICcgSeriesOwnership>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    setId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true, index: true },
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    unlockedSnapshotVersions: [{ type: Number, required: true, min: 1 }],
    firstAcquiredAt: { type: Date, required: true, default: Date.now },
    lastAcquiredAt: { type: Date, required: true, default: Date.now },
    dateKey: { type: String, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: false },
);

CcgSeriesOwnershipSchema.index(
  { ownerType: 1, ownerId: 1, setId: 1, characterId: 1 },
  { unique: true, name: "ccg_series_ownership_owner_series" },
);
CcgSeriesOwnershipSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ICcgSeriesOwnership>("CcgSeriesOwnership", CcgSeriesOwnershipSchema);
