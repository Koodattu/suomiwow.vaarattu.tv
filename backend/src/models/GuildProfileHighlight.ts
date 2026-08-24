import mongoose, { Document, Schema } from "mongoose";

export type GuildProfileHighlightKind = "character" | "account";

export interface IGuildProfileHighlightMainstay {
  kind: GuildProfileHighlightKind;
  characterId?: mongoose.Types.ObjectId | null;
  accountGroupId?: mongoose.Types.ObjectId | null;
  accountSlug?: string | null;
  accountDisplayName?: string | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  characterCount: number;
  reportCount: number;
  raidCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface IGuildProfileHighlightTopPerformer {
  kind: GuildProfileHighlightKind;
  characterId?: mongoose.Types.ObjectId | null;
  accountGroupId?: mongoose.Types.ObjectId | null;
  accountSlug?: string | null;
  accountDisplayName?: string | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  characterCount: number;
  reportCount: number;
  raidCount: number;
  performanceRaidCount: number;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  score: number;
  parseScore: number;
  survivalScore: number | null;
  pulls: number;
  deaths: number;
  earlyDeaths: number;
  zoneId: number;
  raidName: string;
}

export interface IGuildProfileHighlight extends Document {
  guildId: mongoose.Types.ObjectId;
  guildName: string;
  guildRealm: string;
  generatedAt: Date;
  sourceUpdatedAt?: Date | null;
  mainstays: IGuildProfileHighlightMainstay[];
  topPerformers: IGuildProfileHighlightTopPerformer[];
  createdAt: Date;
  updatedAt: Date;
}

const HighlightIdentityFields = {
  kind: { type: String, enum: ["character", "account"], required: true },
  characterId: { type: Schema.Types.ObjectId, ref: "Character", default: null },
  accountGroupId: { type: Schema.Types.ObjectId, ref: "CharacterAccountGroup", default: null },
  accountSlug: { type: String, default: null },
  accountDisplayName: { type: String, default: null },
  name: { type: String, required: true },
  realm: { type: String, required: true },
  region: { type: String, required: true },
  classID: { type: Number, required: true },
  characterCount: { type: Number, required: true, default: 1 },
  reportCount: { type: Number, required: true, default: 0 },
  raidCount: { type: Number, required: true, default: 0 },
} as const;

const GuildProfileHighlightMainstaySchema = new Schema<IGuildProfileHighlightMainstay>(
  {
    ...HighlightIdentityFields,
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { _id: false },
);

const GuildProfileHighlightTopPerformerSchema = new Schema<IGuildProfileHighlightTopPerformer>(
  {
    ...HighlightIdentityFields,
    performanceRaidCount: { type: Number, required: true, default: 0 },
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    score: { type: Number, required: true },
    parseScore: { type: Number, required: true },
    survivalScore: { type: Number, default: null },
    pulls: { type: Number, required: true, default: 0 },
    deaths: { type: Number, required: true, default: 0 },
    earlyDeaths: { type: Number, required: true, default: 0 },
    zoneId: { type: Number, required: true },
    raidName: { type: String, required: true },
  },
  { _id: false },
);

const GuildProfileHighlightSchema = new Schema<IGuildProfileHighlight>(
  {
    guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true, unique: true, index: true },
    guildName: { type: String, required: true },
    guildRealm: { type: String, required: true },
    generatedAt: { type: Date, required: true, default: Date.now, index: true },
    sourceUpdatedAt: { type: Date, default: null },
    mainstays: { type: [GuildProfileHighlightMainstaySchema], default: [] },
    topPerformers: { type: [GuildProfileHighlightTopPerformerSchema], default: [] },
  },
  { timestamps: true },
);

GuildProfileHighlightSchema.index({ guildId: 1, generatedAt: -1 });
GuildProfileHighlightSchema.index({ guildRealm: 1, guildName: 1 });

export default mongoose.model<IGuildProfileHighlight>("GuildProfileHighlight", GuildProfileHighlightSchema);
