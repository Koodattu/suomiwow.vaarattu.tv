import mongoose, { Schema, Document } from "mongoose";
import { MythicPlusScoreBucket } from "../config/mythic-plus";

export interface IMythicPlusScores {
  all: number;
  dps: number;
  healer: number;
  tank: number;
  spec_0: number;
  spec_1: number;
  spec_2: number;
  spec_3: number;
}

export interface ICharacterMythicPlusSpecScore {
  field: MythicPlusScoreBucket;
  blizzardSpecId?: number | null;
  blizzardSpecIndex?: number | null;
  specName?: string | null;
  specSlug?: string | null;
  role?: "dps" | "healer" | "tank" | null;
  score: number;
  color?: string | null;
}

export interface ICharacterMythicPlusSeasonScore extends Document {
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  guildName?: string | null;
  guildRealm?: string | null;
  identityStatus: "current" | "stale";

  season: string;
  scoreStatus?: "available" | "no_score";
  scores: IMythicPlusScores;
  segments: Record<string, unknown>;
  specScores: ICharacterMythicPlusSpecScore[];
  bestSpecField?: MythicPlusScoreBucket | null;
  bestSpecName?: string | null;
  bestSpecSlug?: string | null;
  bestSpecScore: number;

  sourceClassName?: string | null;
  activeSpecName?: string | null;
  activeSpecRole?: string | null;
  profileUrl?: string | null;
  rioLastCrawledAt?: Date | null;
  fetchedAt: Date;
  rawProfileMeta: Record<string, unknown>;
  rawSeason: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const MythicPlusScoresSchema = new Schema<IMythicPlusScores>(
  {
    all: { type: Number, required: true, default: 0 },
    dps: { type: Number, required: true, default: 0 },
    healer: { type: Number, required: true, default: 0 },
    tank: { type: Number, required: true, default: 0 },
    spec_0: { type: Number, required: true, default: 0 },
    spec_1: { type: Number, required: true, default: 0 },
    spec_2: { type: Number, required: true, default: 0 },
    spec_3: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const CharacterMythicPlusSpecScoreSchema = new Schema<ICharacterMythicPlusSpecScore>(
  {
    field: { type: String, required: true },
    blizzardSpecId: { type: Number, default: null },
    blizzardSpecIndex: { type: Number, default: null },
    specName: { type: String, default: null },
    specSlug: { type: String, default: null },
    role: { type: String, enum: ["dps", "healer", "tank", null], default: null },
    score: { type: Number, required: true, default: 0 },
    color: { type: String, default: null },
  },
  { _id: false },
);

const CharacterMythicPlusSeasonScoreSchema = new Schema<ICharacterMythicPlusSeasonScore>(
  {
    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    wclCanonicalCharacterId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    region: { type: String, required: true },
    classID: { type: Number, required: true, index: true },
    guildName: { type: String, default: null },
    guildRealm: { type: String, default: null },
    identityStatus: { type: String, enum: ["current", "stale"], required: true, default: "current" },

    season: { type: String, required: true, index: true },
    scoreStatus: { type: String, enum: ["available", "no_score"], default: undefined },
    scores: { type: MythicPlusScoresSchema, required: true, default: () => ({}) },
    segments: { type: Schema.Types.Mixed, default: {} },
    specScores: { type: [CharacterMythicPlusSpecScoreSchema], default: [] },
    bestSpecField: { type: String, default: null },
    bestSpecName: { type: String, default: null },
    bestSpecSlug: { type: String, default: null, index: true },
    bestSpecScore: { type: Number, required: true, default: 0 },

    sourceClassName: { type: String, default: null },
    activeSpecName: { type: String, default: null },
    activeSpecRole: { type: String, default: null },
    profileUrl: { type: String, default: null },
    rioLastCrawledAt: { type: Date, default: null },
    fetchedAt: { type: Date, required: true, default: Date.now },
    rawProfileMeta: { type: Schema.Types.Mixed, default: {} },
    rawSeason: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

CharacterMythicPlusSeasonScoreSchema.index({ characterId: 1, season: 1 }, { unique: true });
CharacterMythicPlusSeasonScoreSchema.index({ season: 1, "scores.all": -1, name: 1 });
CharacterMythicPlusSeasonScoreSchema.index({ season: 1, "scores.dps": -1, name: 1 });
CharacterMythicPlusSeasonScoreSchema.index({ season: 1, "scores.healer": -1, name: 1 });
CharacterMythicPlusSeasonScoreSchema.index({ season: 1, "scores.tank": -1, name: 1 });
CharacterMythicPlusSeasonScoreSchema.index({ season: 1, classID: 1, "scores.all": -1 });
CharacterMythicPlusSeasonScoreSchema.index({ season: 1, guildName: 1, "scores.all": -1 });
CharacterMythicPlusSeasonScoreSchema.index({ season: 1, bestSpecSlug: 1, bestSpecScore: -1 });
CharacterMythicPlusSeasonScoreSchema.index({ wclCanonicalCharacterId: 1, classID: 1, season: 1 });

export default mongoose.model<ICharacterMythicPlusSeasonScore>("CharacterMythicPlusSeasonScore", CharacterMythicPlusSeasonScoreSchema);
