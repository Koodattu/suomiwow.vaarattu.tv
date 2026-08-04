import mongoose, { Document, Schema } from "mongoose";
import { CCG_FINISH_ORDER, CcgFinish } from "../config/ccg";

export interface ICcgLeaderboardEntry extends Document {
  userId: mongoose.Types.ObjectId;
  rank: number;
  username: string;
  avatarUrl: string;
  score: number;
  cardsOwned: number;
  snapshotsOwned: number;
  finishesOwned: number;
  premiumFinishesOwned: number;
  finishCounts: Record<CcgFinish, number>;
  completedCards: number;
  completedSets: number;
  firstCollectedAt: Date;
  breakdown: {
    collection: number;
    rarity: number;
    finishes: number;
    completedCards: number;
    completedSets: number;
  };
  scoreVersion: string;
  calculatedAt: Date;
}

const ScoreBreakdownSchema = new Schema(
  {
    collection: { type: Number, required: true, min: 0 },
    rarity: { type: Number, required: true, min: 0 },
    finishes: { type: Number, required: true, min: 0 },
    completedCards: { type: Number, required: true, min: 0 },
    completedSets: { type: Number, required: true, min: 0 },
  },
  { _id: false, suppressReservedKeysWarning: true },
);

const FinishCountsSchema = new Schema(
  Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, { type: Number, required: true, default: 0, min: 0 }])),
  { _id: false },
);

const CcgLeaderboardEntrySchema = new Schema<ICcgLeaderboardEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    rank: { type: Number, required: true, min: 1, index: true },
    username: { type: String, required: true },
    avatarUrl: { type: String, required: true },
    score: { type: Number, required: true, min: 0 },
    cardsOwned: { type: Number, required: true, min: 0 },
    snapshotsOwned: { type: Number, required: true, min: 0 },
    finishesOwned: { type: Number, required: true, min: 0 },
    premiumFinishesOwned: { type: Number, required: true, min: 0 },
    finishCounts: { type: FinishCountsSchema, required: true, default: () => ({}) },
    completedCards: { type: Number, required: true, min: 0 },
    completedSets: { type: Number, required: true, min: 0 },
    firstCollectedAt: { type: Date, required: true },
    breakdown: { type: ScoreBreakdownSchema, required: true },
    scoreVersion: { type: String, required: true, index: true },
    calculatedAt: { type: Date, required: true, index: true },
  },
  { timestamps: false },
);

CcgLeaderboardEntrySchema.index({ scoreVersion: 1, rank: 1 });

export default mongoose.model<ICcgLeaderboardEntry>("CcgLeaderboardEntry", CcgLeaderboardEntrySchema);
