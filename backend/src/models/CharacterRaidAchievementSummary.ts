import mongoose, { Document, Schema } from "mongoose";
import { FeaturedAchievementType } from "../utils/featured-achievements";

export const CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION = "character-raid-achievements-v1";

export interface ICharacterRaidAchievement {
  achievementId: number;
  name: string;
  type: FeaturedAchievementType;
  completedTimestamp: number;
  completedAt: Date;
}

export interface ICharacterRaidAchievementSummary extends Document {
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  version: string;
  achievementPoints: number;
  totalQuantity: number;
  achievements: ICharacterRaidAchievement[];
  cuttingEdgeCount: number;
  aheadOfTheCurveCount: number;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterRaidAchievementSchema = new Schema<ICharacterRaidAchievement>(
  {
    achievementId: { type: Number, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["cutting_edge", "ahead_of_the_curve"], required: true },
    completedTimestamp: { type: Number, required: true },
    completedAt: { type: Date, required: true },
  },
  { _id: false },
);

const CharacterRaidAchievementSummarySchema = new Schema<ICharacterRaidAchievementSummary>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    wclCanonicalCharacterId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    region: { type: String, required: true },
    classID: { type: Number, required: true, index: true },
    version: { type: String, required: true, index: true },
    achievementPoints: { type: Number, required: true, default: 0 },
    totalQuantity: { type: Number, required: true, default: 0 },
    achievements: { type: [CharacterRaidAchievementSchema], default: [] },
    cuttingEdgeCount: { type: Number, required: true, default: 0, index: true },
    aheadOfTheCurveCount: { type: Number, required: true, default: 0, index: true },
    fetchedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true },
);

CharacterRaidAchievementSummarySchema.index({ characterId: 1, version: 1 }, { unique: true });
CharacterRaidAchievementSummarySchema.index({ version: 1, "achievements.achievementId": 1 });
CharacterRaidAchievementSummarySchema.index({ realm: 1, name: 1, region: 1, classID: 1 });

export default mongoose.model<ICharacterRaidAchievementSummary>("CharacterRaidAchievementSummary", CharacterRaidAchievementSummarySchema);
