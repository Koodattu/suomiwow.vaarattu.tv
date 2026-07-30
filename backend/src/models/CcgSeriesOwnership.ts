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
  collectionReadModelVersion?: number;
  collectionReadModelIssue?: "missing_finish_ownership" | null;
  collectionCardId?: mongoose.Types.ObjectId | null;
  collectionSnapshotVersion?: number | null;
  collectionSortGrade?: number | null;
  collectionSortSetNumber?: number | null;
  collectionSortName?: string | null;
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
    collectionReadModelVersion: { type: Number, min: 0 },
    collectionReadModelIssue: { type: String, enum: ["missing_finish_ownership", null], default: null },
    collectionCardId: { type: Schema.Types.ObjectId, ref: "CcgCard" },
    collectionSnapshotVersion: { type: Number, min: 1 },
    collectionSortGrade: { type: Number, min: 0 },
    collectionSortSetNumber: { type: Number, min: 1 },
    collectionSortName: { type: String },
  },
  { timestamps: false },
);

CcgSeriesOwnershipSchema.index(
  { ownerType: 1, ownerId: 1, setId: 1, characterId: 1 },
  { unique: true, name: "ccg_series_ownership_owner_series" },
);
CcgSeriesOwnershipSchema.index(
  {
    ownerType: 1,
    ownerId: 1,
    collectionSortGrade: 1,
    collectionSortSetNumber: 1,
    collectionSortName: 1,
    setId: 1,
    characterId: 1,
  },
  {
    name: "ccg_series_collection_default_v1",
    partialFilterExpression: { collectionReadModelVersion: 1 },
  },
);
CcgSeriesOwnershipSchema.index(
  { ownerType: 1, lastAcquiredAt: 1, ownerId: 1 },
  { name: "ccg_series_leaderboard_dirty_v1" },
);
export default mongoose.model<ICcgSeriesOwnership>("CcgSeriesOwnership", CcgSeriesOwnershipSchema);
