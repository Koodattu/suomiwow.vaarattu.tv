import mongoose, { Document, Schema } from "mongoose";
import { CCG_FINISH_ORDER, CcgFinish, CcgTierGrade } from "../config/ccg";

type CountRecord<Key extends string> = Record<Key, number>;

export interface ICcgAnalyticsDaily extends Document {
  dateKey: string;
  packOpenings: number;
  activeUsers: number;
  finishes: CountRecord<CcgFinish>;
  grades: CountRecord<CcgTierGrade>;
  updatedAt: Date;
}

const FinishCountsSchema = new Schema(
  Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, { type: Number, required: true, default: 0, min: 0 }])),
  { _id: false },
);

const GradeCountsSchema = new Schema(
  {
    H: { type: Number, required: true, default: 0, min: 0 },
    S: { type: Number, required: true, default: 0, min: 0 },
    A: { type: Number, required: true, default: 0, min: 0 },
    B: { type: Number, required: true, default: 0, min: 0 },
    C: { type: Number, required: true, default: 0, min: 0 },
    D: { type: Number, required: true, default: 0, min: 0 },
    E: { type: Number, required: true, default: 0, min: 0 },
    F: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const CcgAnalyticsDailySchema = new Schema<ICcgAnalyticsDaily>(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    packOpenings: { type: Number, required: true, default: 0, min: 0 },
    activeUsers: { type: Number, required: true, default: 0, min: 0 },
    finishes: { type: FinishCountsSchema, required: true, default: () => ({}) },
    grades: { type: GradeCountsSchema, required: true, default: () => ({}) },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

export default mongoose.model<ICcgAnalyticsDaily>("CcgAnalyticsDaily", CcgAnalyticsDailySchema);
