import mongoose, { Schema, Document } from "mongoose";
import { MythicPlusScoreBucket } from "../config/mythic-plus";

export interface ICharacterMythicPlusDungeonRun extends Document {
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
  bucket: MythicPlusScoreBucket;
  bucketType: "overall" | "role" | "spec";
  role?: "dps" | "healer" | "tank" | null;
  specName?: string | null;
  specSlug?: string | null;
  blizzardSpecId?: number | null;
  blizzardSpecIndex?: number | null;

  raiderIoDungeonId: number;
  challengeModeId?: number | null;
  dungeonSlug?: string | null;
  dungeonName: string;
  dungeonShortName?: string | null;
  dungeonIconUrl?: string | null;
  dungeonBackgroundImageUrl?: string | null;

  keystoneRunId?: number | null;
  mythicLevel: number;
  score: number;
  clearTimeMs?: number | null;
  parTimeMs?: number | null;
  upgrades?: number | null;
  period?: number | null;
  affixes: number[];
  completedAt?: Date | null;
  loggedRunId?: number | null;
  url?: string | null;

  fetchedAt: Date;
  rawRun: Record<string, unknown>;
  rawFullRun: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const CharacterMythicPlusDungeonRunSchema = new Schema<ICharacterMythicPlusDungeonRun>(
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
    bucket: { type: String, required: true, index: true },
    bucketType: { type: String, enum: ["overall", "role", "spec"], required: true },
    role: { type: String, enum: ["dps", "healer", "tank", null], default: null, index: true },
    specName: { type: String, default: null },
    specSlug: { type: String, default: null, index: true },
    blizzardSpecId: { type: Number, default: null },
    blizzardSpecIndex: { type: Number, default: null },

    raiderIoDungeonId: { type: Number, required: true, index: true },
    challengeModeId: { type: Number, default: null, index: true },
    dungeonSlug: { type: String, default: null },
    dungeonName: { type: String, required: true },
    dungeonShortName: { type: String, default: null },
    dungeonIconUrl: { type: String, default: null },
    dungeonBackgroundImageUrl: { type: String, default: null },

    keystoneRunId: { type: Number, default: null, index: true },
    mythicLevel: { type: Number, required: true, default: 0 },
    score: { type: Number, required: true, default: 0 },
    clearTimeMs: { type: Number, default: null },
    parTimeMs: { type: Number, default: null },
    upgrades: { type: Number, default: null },
    period: { type: Number, default: null },
    affixes: { type: [Number], default: [] },
    completedAt: { type: Date, default: null },
    loggedRunId: { type: Number, default: null },
    url: { type: String, default: null },

    fetchedAt: { type: Date, required: true, default: Date.now },
    rawRun: { type: Schema.Types.Mixed, default: {} },
    rawFullRun: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

CharacterMythicPlusDungeonRunSchema.index({ characterId: 1, season: 1, bucket: 1, raiderIoDungeonId: 1 }, { unique: true });
CharacterMythicPlusDungeonRunSchema.index({ season: 1, bucket: 1, raiderIoDungeonId: 1, score: -1, name: 1 });
CharacterMythicPlusDungeonRunSchema.index({ season: 1, bucket: 1, raiderIoDungeonId: 1, mythicLevel: -1, clearTimeMs: 1 });
CharacterMythicPlusDungeonRunSchema.index({ season: 1, classID: 1, bucket: 1, score: -1 });
CharacterMythicPlusDungeonRunSchema.index({ wclCanonicalCharacterId: 1, classID: 1, season: 1 });

export default mongoose.model<ICharacterMythicPlusDungeonRun>("CharacterMythicPlusDungeonRun", CharacterMythicPlusDungeonRunSchema);
