import mongoose, { Document, Schema } from "mongoose";

export interface ICcgAnalyticsSummary extends Document {
  key: "global";
  schemaVersion: number;
  detailedSchemaVersion: number;
  uniqueUsers: number;
  packOpenings: number;
  updatedAt: Date;
}

const CcgAnalyticsSummarySchema = new Schema<ICcgAnalyticsSummary>(
  {
    key: { type: String, enum: ["global"], required: true, unique: true, index: true },
    schemaVersion: { type: Number, required: true },
    detailedSchemaVersion: { type: Number, required: true, default: 0 },
    uniqueUsers: { type: Number, required: true, min: 0 },
    packOpenings: { type: Number, required: true, min: 0 },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

export default mongoose.model<ICcgAnalyticsSummary>("CcgAnalyticsSummary", CcgAnalyticsSummarySchema);
