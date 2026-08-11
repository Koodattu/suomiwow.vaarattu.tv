import mongoose, { Document, Schema } from "mongoose";

export interface ICcgRaidLockout extends Document {
  ownerType: "user" | "guest";
  ownerId: mongoose.Types.ObjectId;
  weeklyKey: string;
  difficulty: "story" | "normal" | "heroic";
  seed: string;
  rosterCardIds: string[];
  activeCardIds: string[];
  bossIndex: number;
  bossKills: string[];
  pullCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const CcgRaidLockoutSchema = new Schema<ICcgRaidLockout>(
  {
    ownerType: { type: String, enum: ["user", "guest"], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    weeklyKey: { type: String, required: true, index: true },
    difficulty: { type: String, enum: ["story", "normal", "heroic"], required: true },
    seed: { type: String, required: true },
    rosterCardIds: { type: [String], required: true },
    activeCardIds: { type: [String], required: true },
    bossIndex: { type: Number, required: true, min: 0, default: 0 },
    bossKills: { type: [String], required: true, default: [] },
    pullCount: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

CcgRaidLockoutSchema.index({ ownerType: 1, ownerId: 1, weeklyKey: 1 }, { unique: true });

export default mongoose.model<ICcgRaidLockout>("CcgRaidLockout", CcgRaidLockoutSchema);
