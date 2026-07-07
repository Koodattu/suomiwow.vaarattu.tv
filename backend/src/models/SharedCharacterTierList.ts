import mongoose, { Document, Schema } from "mongoose";
import { ICustomCharacterTierBucket } from "./CustomCharacterTierList";

export interface ISharedCharacterTierList extends Document {
  shareId: string;
  userId: mongoose.Types.ObjectId | null;
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

const SharedCharacterTierBucketSchema = new Schema<ICustomCharacterTierBucket>(
  {
    tier: { type: String, enum: ["S", "A", "B", "C", "D", "E", "F"], required: true },
    characterKeys: { type: [String], default: [] },
  },
  { _id: false },
);

const SharedCharacterTierListSchema = new Schema<ISharedCharacterTierList>(
  {
    shareId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true, index: true },
    guildName: { type: String, required: true },
    guildRealm: { type: String, required: true },
    zoneId: { type: Number, required: true, index: true },
    raidName: { type: String, required: true },
    tiers: { type: [SharedCharacterTierBucketSchema], default: [] },
    unplacedCharacterKeys: { type: [String], default: [] },
  },
  { timestamps: true },
);

SharedCharacterTierListSchema.index({ userId: 1, guildId: 1, zoneId: 1 });

export default mongoose.model<ISharedCharacterTierList>("SharedCharacterTierList", SharedCharacterTierListSchema);
