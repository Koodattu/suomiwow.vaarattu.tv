import mongoose, { Document, Schema } from "mongoose";

export interface ICcgJobLock extends Document {
  key: string;
  owner: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CcgJobLockSchema = new Schema<ICcgJobLock>(
  {
    key: { type: String, required: true, unique: true, index: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

CcgJobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ICcgJobLock>("CcgJobLock", CcgJobLockSchema);
