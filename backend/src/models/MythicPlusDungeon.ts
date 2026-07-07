import mongoose, { Schema, Document } from "mongoose";

export interface IMythicPlusDungeon extends Document {
  raiderIoDungeonId: number;
  challengeModeId?: number | null;
  expansionId: number;
  slug: string;
  name: string;
  shortName?: string | null;
  timerSeconds?: number | null;
  iconUrl?: string | null;
  backgroundImageUrl?: string | null;
  raw: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const MythicPlusDungeonSchema = new Schema<IMythicPlusDungeon>(
  {
    raiderIoDungeonId: { type: Number, required: true, unique: true, index: true },
    challengeModeId: { type: Number, default: null, index: true },
    expansionId: { type: Number, required: true, index: true },
    slug: { type: String, required: true, index: true },
    name: { type: String, required: true },
    shortName: { type: String, default: null },
    timerSeconds: { type: Number, default: null },
    iconUrl: { type: String, default: null },
    backgroundImageUrl: { type: String, default: null },
    raw: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

MythicPlusDungeonSchema.index({ expansionId: 1, name: 1 });
MythicPlusDungeonSchema.index({ expansionId: 1, challengeModeId: 1 });

export default mongoose.model<IMythicPlusDungeon>("MythicPlusDungeon", MythicPlusDungeonSchema);
