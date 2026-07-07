import mongoose, { Schema, Document } from "mongoose";
import { IMechanicsBossScore } from "./CharacterMechanicsLeaderboard";

export type CharacterTierListScope = "global" | "guild";
export type CharacterTierListRole = "dps" | "healer" | "tank";
export type CharacterTierListMetric = "dps" | "hps";

export interface ICharacterTierListEntry extends Document {
  scope: CharacterTierListScope;
  zoneId: number;
  raidName: string;

  guildId?: mongoose.Types.ObjectId | null;
  guildName?: string | null;
  guildRealm?: string | null;

  characterId: mongoose.Types.ObjectId;
  characterKey: string;
  wclCanonicalCharacterId?: number | null;
  name: string;
  realm: string;
  region: string;
  classID: number;

  role: CharacterTierListRole;
  metric: CharacterTierListMetric;
  specName: string;
  bestSpecName?: string | null;
  ilvl: number;

  score: number;
  parseScore: number;
  survivalScore: number | null;
  rankPercent: number;
  medianPercent: number;
  totalKills: number;

  pulls: number;
  deaths: number;
  survivedPulls: number;
  earlyDeaths: number;
  averageDeathPercent: number | null;
  deathDataAvailable: boolean;
  bossScores: IMechanicsBossScore[];

  reportCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sourceUpdatedAt: Date;
  generatedAt: Date;
}

const MechanicsBossScoreSchema = new Schema<IMechanicsBossScore>(
  {
    encounterId: { type: Number, required: true },
    encounterName: { type: String, required: true },
    score: { type: Number, required: true },
    parseScore: { type: Number, required: true },
    survivalScore: { type: Number, default: null },
    pulls: { type: Number, default: 0 },
    deaths: { type: Number, default: 0 },
    survivedPulls: { type: Number, default: 0 },
    earlyDeaths: { type: Number, default: 0 },
    averageDeathPercent: { type: Number, default: null },
    deathDataAvailable: { type: Boolean, default: false },
    specName: { type: String, required: true },
    rankPercent: { type: Number, required: true },
  },
  { _id: false },
);

const CharacterTierListEntrySchema = new Schema<ICharacterTierListEntry>(
  {
    scope: { type: String, enum: ["global", "guild"], required: true, index: true },
    zoneId: { type: Number, required: true, index: true },
    raidName: { type: String, required: true },

    guildId: { type: Schema.Types.ObjectId, ref: "Guild", default: null, index: true },
    guildName: { type: String, default: null },
    guildRealm: { type: String, default: null },

    characterId: { type: Schema.Types.ObjectId, ref: "Character", required: true, index: true },
    characterKey: { type: String, required: true },
    wclCanonicalCharacterId: { type: Number, default: null, index: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    region: { type: String, required: true },
    classID: { type: Number, required: true, index: true },

    role: { type: String, enum: ["dps", "healer", "tank"], required: true, index: true },
    metric: { type: String, enum: ["dps", "hps"], required: true },
    specName: { type: String, required: true },
    bestSpecName: { type: String, default: null },
    ilvl: { type: Number, default: 0 },

    score: { type: Number, required: true, index: true },
    parseScore: { type: Number, required: true },
    survivalScore: { type: Number, default: null },
    rankPercent: { type: Number, default: 0 },
    medianPercent: { type: Number, default: 0 },
    totalKills: { type: Number, default: 0 },

    pulls: { type: Number, default: 0 },
    deaths: { type: Number, default: 0 },
    survivedPulls: { type: Number, default: 0 },
    earlyDeaths: { type: Number, default: 0 },
    averageDeathPercent: { type: Number, default: null },
    deathDataAvailable: { type: Boolean, default: false },
    bossScores: { type: [MechanicsBossScoreSchema], default: [] },

    reportCount: { type: Number, required: true, default: 0, index: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    sourceUpdatedAt: { type: Date, required: true },
    generatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

CharacterTierListEntrySchema.index({ scope: 1, zoneId: 1, guildId: 1, characterKey: 1 }, { unique: true });
CharacterTierListEntrySchema.index({ zoneId: 1, scope: 1, reportCount: -1, score: -1 });
CharacterTierListEntrySchema.index({ zoneId: 1, scope: 1, role: 1, classID: 1, reportCount: -1, score: -1 });
CharacterTierListEntrySchema.index({ zoneId: 1, scope: 1, guildId: 1, role: 1, classID: 1, reportCount: -1, score: -1 });
CharacterTierListEntrySchema.index({ zoneId: 1, generatedAt: -1 });

export default mongoose.model<ICharacterTierListEntry>("CharacterTierListEntry", CharacterTierListEntrySchema);
