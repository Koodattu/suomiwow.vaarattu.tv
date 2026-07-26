import mongoose, { Document, Schema } from "mongoose";
import { CcgFinish, CcgTierGrade } from "../config/ccg";

type CountRecord<Key extends string> = Record<Key, number>;

export interface ICcgAnalyticsDaily extends Document {
  dateKey: string;
  packOpenings: number;
  activeUsers: number;
  modes: CountRecord<"current" | "legacy">;
  finishes: CountRecord<CcgFinish>;
  grades: CountRecord<CcgTierGrade>;
  updatedAt: Date;
}

const ModeCountsSchema = new Schema(
  {
    current: { type: Number, required: true, default: 0, min: 0 },
    legacy: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const FinishCountsSchema = new Schema(
  {
    standard: { type: Number, required: true, default: 0, min: 0 },
    foil: { type: Number, required: true, default: 0, min: 0 },
    golden: { type: Number, required: true, default: 0, min: 0 },
    prismatic: { type: Number, required: true, default: 0, min: 0 },
    holographic: { type: Number, required: true, default: 0, min: 0 },
    void: { type: Number, required: true, default: 0, min: 0 },
    toxic: { type: Number, required: true, default: 0, min: 0 },
    negative: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const GradeCountsSchema = new Schema(
  {
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
    modes: { type: ModeCountsSchema, required: true, default: () => ({}) },
    finishes: { type: FinishCountsSchema, required: true, default: () => ({}) },
    grades: { type: GradeCountsSchema, required: true, default: () => ({}) },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

export default mongoose.model<ICcgAnalyticsDaily>("CcgAnalyticsDaily", CcgAnalyticsDailySchema);
