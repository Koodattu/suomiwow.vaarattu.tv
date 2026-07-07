import mongoose, { Schema, Document } from "mongoose";

export interface IMythicPlusSeason extends Document {
  slug: string;
  name: string;
  shortName?: string | null;
  expansionId: number;
  order: number;
  isMainSeason: boolean;
  starts?: Record<string, string> | null;
  ends?: Record<string, string> | null;
  raw: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const MythicPlusSeasonSchema = new Schema<IMythicPlusSeason>(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    shortName: { type: String, default: null },
    expansionId: { type: Number, required: true, index: true },
    order: { type: Number, required: true, default: 0, index: true },
    isMainSeason: { type: Boolean, required: true, default: false, index: true },
    starts: { type: Schema.Types.Mixed, default: null },
    ends: { type: Schema.Types.Mixed, default: null },
    raw: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

MythicPlusSeasonSchema.index({ isMainSeason: 1, order: 1 });
MythicPlusSeasonSchema.index({ expansionId: 1, order: 1 });

export default mongoose.model<IMythicPlusSeason>("MythicPlusSeason", MythicPlusSeasonSchema);
