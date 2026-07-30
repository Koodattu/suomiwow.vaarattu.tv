import mongoose, { Document, Schema } from "mongoose";

export interface ICcgSeriesOwnershipArchive extends Document {
  sourceDocument: Record<string, unknown>;
  reason: "missing_finish_ownership";
  migrationKey: string;
  archivedAt: Date;
}

const CcgSeriesOwnershipArchiveSchema = new Schema<ICcgSeriesOwnershipArchive>(
  {
    sourceDocument: { type: Schema.Types.Mixed, required: true },
    reason: { type: String, enum: ["missing_finish_ownership"], required: true },
    migrationKey: { type: String, required: true },
    archivedAt: { type: Date, required: true },
  },
  {
    collection: "ccgseriesownershiparchives",
    timestamps: false,
  },
);

CcgSeriesOwnershipArchiveSchema.index({ reason: 1, archivedAt: -1 });

export default mongoose.model<ICcgSeriesOwnershipArchive>(
  "CcgSeriesOwnershipArchive",
  CcgSeriesOwnershipArchiveSchema,
);
