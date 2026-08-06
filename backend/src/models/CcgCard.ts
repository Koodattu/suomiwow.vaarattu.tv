import mongoose, { Document, Schema } from "mongoose";
import { CcgTierGrade } from "../config/ccg";
import { CharacterRenderFit, CharacterRenderFitSchema } from "./CharacterRenderAsset";

export type CcgCommunityScores = {
  performance: number | null;
  mechanics: number | null;
  combined: number | null;
  mythicPlus: number | null;
};

export type CcgCardAvailabilityStatus = "active" | "verification_pending" | "archived";

const CcgCommunityScoresSchema = new Schema<CcgCommunityScores>(
  {
    performance: { type: Number, max: 100, default: null },
    mechanics: { type: Number, max: 100, default: null },
    combined: { type: Number, max: 100, default: null },
    mythicPlus: { type: Number, max: 100_000, default: null },
  },
  { _id: false },
);

export interface ICcgCard extends Document {
  setId: mongoose.Types.ObjectId;
  setNumber: number;
  snapshotVersion: number;
  snapshotKey?: string | null;
  supersedesCardId?: mongoose.Types.ObjectId | null;
  characterId: mongoose.Types.ObjectId;
  collectorKey?: string | null;
  communityCharacterId?: mongoose.Types.ObjectId | null;
  wclCanonicalCharacterId?: number | null;
  name: string;
  realm: string;
  region: string;
  guildId?: mongoose.Types.ObjectId | null;
  guildName?: string | null;
  guildRealm?: string | null;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  metric: "dps" | "hps";
  itemLevel: number;
  parseScore: number;
  survivalScore: number;
  combinedScore: number;
  mythicPlusScore?: number | null;
  communityScores?: CcgCommunityScores | null;
  tierGrade: CcgTierGrade;
  avatarUrl?: string | null;
  renderUrl?: string | null;
  renderAssetId?: mongoose.Types.ObjectId | null;
  renderFit?: CharacterRenderFit | null;
  availabilityStatus: CcgCardAvailabilityStatus;
  availabilityFirstNotFoundAt?: Date | null;
  availabilityLastNotFoundAt?: Date | null;
  availabilityChangedAt?: Date | null;
  backgroundCrop: { x: number; y: number; scale: number };
  pulls: number;
  deaths: number;
  reportCount: number;
  mythicReportCount: number;
  totalKills: number;
  performanceSnapshotAt: Date;
  mediaCapturedAt?: Date | null;
  sourcePartition: string;
  publicationWave: number;
  gradingVersion: string;
  eligibilityVersion: string;
  themeVersion: string;
  publishedAt: Date;
}

const CcgCardSchema = new Schema<ICcgCard>(
  {
    setId: { type: Schema.Types.ObjectId, ref: "CcgSet", required: true, index: true },
    setNumber: { type: Number, required: true },
    snapshotVersion: { type: Number, required: true, min: 1, default: 1 },
    snapshotKey: { type: String, default: null, index: true },
    supersedesCardId: { type: Schema.Types.ObjectId, ref: "CcgCard", default: null },
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    collectorKey: { type: String, default: null, index: true },
    communityCharacterId: { type: Schema.Types.ObjectId, ref: "CcgCommunityCharacter", default: null, index: true },
    wclCanonicalCharacterId: { type: Number, default: null, index: true },
    name: { type: String, required: true, index: true },
    realm: { type: String, required: true },
    region: { type: String, required: true },
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", default: null },
    guildName: { type: String, default: null, index: true },
    guildRealm: { type: String, default: null },
    classID: { type: Number, required: true, index: true },
    specName: { type: String, required: true },
    role: { type: String, enum: ["dps", "healer", "tank"], required: true, index: true },
    metric: { type: String, enum: ["dps", "hps"], required: true },
    itemLevel: { type: Number, required: true, default: 0 },
    parseScore: { type: Number, required: true },
    survivalScore: { type: Number, required: true },
    combinedScore: { type: Number, required: true },
    mythicPlusScore: { type: Number, default: null },
    communityScores: { type: CcgCommunityScoresSchema, default: undefined },
    tierGrade: { type: String, enum: ["H", "S", "A", "B", "C", "D", "E", "F"], required: true, index: true },
    avatarUrl: { type: String, default: null },
    renderUrl: { type: String, default: null },
    renderAssetId: { type: Schema.Types.ObjectId, ref: "CharacterRenderAsset", default: null, index: true },
    renderFit: { type: CharacterRenderFitSchema, default: null },
    availabilityStatus: {
      type: String,
      enum: ["active", "verification_pending", "archived"],
      required: true,
      default: "active",
      index: true,
    },
    availabilityFirstNotFoundAt: { type: Date, default: null },
    availabilityLastNotFoundAt: { type: Date, default: null },
    availabilityChangedAt: { type: Date, default: null },
    backgroundCrop: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      scale: { type: Number, required: true },
    },
    pulls: { type: Number, required: true, default: 0 },
    deaths: { type: Number, required: true, default: 0 },
    reportCount: { type: Number, required: true, default: 0 },
    mythicReportCount: { type: Number, required: true, default: 0 },
    totalKills: { type: Number, required: true, default: 0 },
    performanceSnapshotAt: { type: Date, required: true },
    mediaCapturedAt: { type: Date, default: null },
    sourcePartition: { type: String, required: true },
    publicationWave: { type: Number, required: true },
    gradingVersion: { type: String, required: true },
    eligibilityVersion: { type: String, required: true },
    themeVersion: { type: String, required: true },
    publishedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

CcgCardSchema.index(
  { setId: 1, characterId: 1, snapshotVersion: 1 },
  { unique: true, name: "ccg_card_character_snapshot_version" },
);
CcgCardSchema.index(
  { setId: 1, setNumber: 1, snapshotVersion: 1 },
  { unique: true, name: "ccg_card_set_number_snapshot_version" },
);
CcgCardSchema.index({ setId: 1, characterId: 1, performanceSnapshotAt: -1, publishedAt: -1 });
CcgCardSchema.index({ setId: 1, tierGrade: 1, setNumber: 1 });
CcgCardSchema.index({ setId: 1, availabilityStatus: 1, tierGrade: 1, setNumber: 1 });
CcgCardSchema.index({ setId: 1, guildId: 1, setNumber: 1 });
CcgCardSchema.index({ setId: 1, guildId: 1, tierGrade: 1, setNumber: 1 });
CcgCardSchema.index({ characterId: 1, publishedAt: -1 });

const rejectPublishedCardMutation = () => {
  throw new Error("Published CCG cards are immutable");
};
CcgCardSchema.pre("findOneAndUpdate", rejectPublishedCardMutation);
CcgCardSchema.pre("updateOne", rejectPublishedCardMutation);
CcgCardSchema.pre("updateMany", rejectPublishedCardMutation);
CcgCardSchema.pre("replaceOne", rejectPublishedCardMutation);
CcgCardSchema.pre("save", function () {
  if (!this.isNew && this.isModified()) throw new Error("Published CCG cards are immutable");
});

export default mongoose.model<ICcgCard>("CcgCard", CcgCardSchema);
