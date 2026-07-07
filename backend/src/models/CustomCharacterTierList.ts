import mongoose, { Schema, Document } from "mongoose";

export type CustomCharacterTier = "S" | "A" | "B" | "C" | "D" | "E" | "F";

export interface ICustomCharacterTierBucket {
  tier: CustomCharacterTier;
  characterKeys: string[];
}

export interface ICustomCharacterTierList extends Document {
  userId: mongoose.Types.ObjectId;
  guildId: mongoose.Types.ObjectId;
  guildName: string;
  guildRealm: string;
  zoneId: number;
  raidName: string;
  tiers: ICustomCharacterTierBucket[];
  unplacedCharacterKeys: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CustomCharacterTierBucketSchema = new Schema<ICustomCharacterTierBucket>(
  {
    tier: { type: String, enum: ["S", "A", "B", "C", "D", "E", "F"], required: true },
    characterKeys: { type: [String], default: [] },
  },
  { _id: false },
);

const CustomCharacterTierListSchema = new Schema<ICustomCharacterTierList>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true, index: true },
    guildName: { type: String, required: true },
    guildRealm: { type: String, required: true },
    zoneId: { type: Number, required: true, index: true },
    raidName: { type: String, required: true },
    tiers: { type: [CustomCharacterTierBucketSchema], default: [] },
    unplacedCharacterKeys: { type: [String], default: [] },
  },
  { timestamps: true },
);

CustomCharacterTierListSchema.index({ userId: 1, guildId: 1, zoneId: 1 }, { unique: true });

export default mongoose.model<ICustomCharacterTierList>("CustomCharacterTierList", CustomCharacterTierListSchema);
