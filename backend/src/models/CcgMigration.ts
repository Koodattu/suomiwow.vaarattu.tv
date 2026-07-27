import mongoose, { Document, Schema } from "mongoose";

export interface ICcgMigration extends Document {
  key: string;
  completedAt: Date;
  details: Record<string, unknown>;
}

const CcgMigrationSchema = new Schema<ICcgMigration>(
  {
    key: { type: String, required: true, unique: true, index: true },
    completedAt: { type: Date, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: false },
);

export default mongoose.model<ICcgMigration>("CcgMigration", CcgMigrationSchema);
