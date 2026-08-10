import mongoose, { Document, Schema } from "mongoose";
import {
  ReporterBossSnapshot,
  ReporterFact,
  ReporterGeneratedContent,
  ReporterGuildSnapshot,
  ReporterLink,
  ReporterLinkVisual,
  ReporterLocaleContent,
  ReporterPickemSnapshot,
  ReporterPlayerSnapshot,
  ReporterPostStatus,
  ReporterProgressSnapshot,
  ReporterRunSource,
  ReporterSettingsValue,
  ReporterUsage,
} from "./reporter.types";

const ReporterColorSchema = new Schema(
  {
    r: { type: Number, required: true },
    g: { type: Number, required: true },
    b: { type: Number, required: true },
    a: { type: Number, required: true },
  },
  { _id: false },
);

const ReporterGuildCrestSchema = new Schema(
  {
    emblem: {
      id: { type: Number, required: true },
      imageName: { type: String, required: true },
      color: { type: ReporterColorSchema, required: true },
    },
    border: {
      id: { type: Number, required: true },
      imageName: { type: String, required: true },
      color: { type: ReporterColorSchema, required: true },
    },
    background: {
      color: { type: ReporterColorSchema, required: true },
    },
  },
  { _id: false },
);

const ReporterBossSnapshotSchema = new Schema<ReporterBossSnapshot>(
  {
    bossId: { type: Number, required: true },
    bossName: { type: String, required: true },
    iconUrl: { type: String },
    kills: { type: Number, required: true },
    bestPercent: { type: Number, required: true },
    pullCount: { type: Number, required: true },
    firstKillTime: { type: String },
    firstKillReportCode: { type: String },
    firstKillFightId: { type: Number },
    bestPullReportCode: { type: String },
    bestPullFightId: { type: Number },
    totalPhases: { type: Number },
    bestPullPhase: {
      phaseId: { type: Number },
      phaseName: { type: String },
      bossHealth: { type: Number },
      fightCompletion: { type: Number },
      displayString: { type: String },
    },
  },
  { _id: false },
);

const ReporterProgressSnapshotSchema = new Schema<ReporterProgressSnapshot>(
  {
    raidId: { type: Number, required: true },
    raidName: { type: String, required: true },
    iconUrl: { type: String },
    difficulty: { type: String, enum: ["mythic", "heroic"], required: true },
    bossesDefeated: { type: Number, required: true },
    totalBosses: { type: Number, required: true },
    guildRank: { type: Number },
    worldRank: { type: Number },
    bosses: { type: [ReporterBossSnapshotSchema], required: true, default: [] },
  },
  { _id: false },
);

const ReporterGuildSnapshotSchema = new Schema<ReporterGuildSnapshot>(
  {
    guildId: { type: String, required: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    faction: { type: String },
    crest: { type: ReporterGuildCrestSchema },
    parentGuild: { type: String },
    progress: { type: [ReporterProgressSnapshotSchema], required: true, default: [] },
  },
  { _id: false },
);

const ReporterPlayerSnapshotSchema = new Schema<ReporterPlayerSnapshot>(
  {
    category: { type: String, enum: ["dps", "healer", "tank"], required: true },
    rank: { type: Number, required: true },
    name: { type: String, required: true },
    realm: { type: String, required: true },
    classId: { type: Number },
    guildName: { type: String },
    guildRealm: { type: String },
    role: { type: String, required: true },
    specName: { type: String, required: true },
    score: { type: Number, required: true },
  },
  { _id: false },
);

const ReporterLinkVisualSchema = new Schema<ReporterLinkVisual>(
  {
    type: { type: String, enum: ["guild-crest", "icon", "wcl"], required: true },
    crest: { type: ReporterGuildCrestSchema },
    faction: { type: String },
    iconUrl: { type: String },
    provider: { type: String, enum: ["wcl"] },
  },
  { _id: false },
);

const ReporterPickemSnapshotSchema = new Schema<ReporterPickemSnapshot>(
  {
    pickemId: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    active: { type: Boolean, required: true },
    votingStart: { type: String, required: true },
    votingEnd: { type: String, required: true },
    finalized: { type: Boolean, required: true },
    updatedAt: { type: String, required: true },
  },
  { _id: false },
);

const ReporterLinkSchema = new Schema<ReporterLink>(
  {
    ref: { type: String, required: true },
    label: { type: String, required: true },
    url: { type: String, required: true },
    kind: { type: String, enum: ["guild", "character", "boss", "pickem", "event", "analytics", "log"], required: true },
    visual: { type: ReporterLinkVisualSchema },
  },
  { _id: false },
);

const ReporterFactSchema = new Schema<ReporterFact>(
  {
    id: { type: String, required: true },
    kind: { type: String, required: true },
    summary: { type: String, required: true },
    occurredAt: { type: String },
    links: { type: [ReporterLinkSchema], required: true, default: [] },
  },
  { _id: false },
);

const ReporterLocaleContentSchema = new Schema<ReporterLocaleContent>(
  {
    title: { type: String, required: true },
    summary: { type: String, required: true },
    body: { type: String, required: true },
  },
  { _id: false },
);

const ReporterGeneratedContentSchema = new Schema<ReporterGeneratedContent>(
  {
    en: { type: ReporterLocaleContentSchema, required: true },
    fi: { type: ReporterLocaleContentSchema, required: true },
  },
  { _id: false },
);

const ReporterUsageSchema = new Schema<ReporterUsage>(
  {
    inputTokens: { type: Number, required: true },
    cachedInputTokens: { type: Number, required: true },
    cacheWriteTokens: { type: Number, required: true },
    outputTokens: { type: Number, required: true },
    reasoningTokens: { type: Number, required: true },
    totalTokens: { type: Number, required: true },
    estimatedCostUsd: { type: Number, required: true },
    rates: {
      inputPerMillion: { type: Number, required: true },
      cachedInputPerMillion: { type: Number, required: true },
      cacheWritePerMillion: { type: Number, required: true },
      outputPerMillion: { type: Number, required: true },
    },
  },
  { _id: false },
);

export interface IReporterSnapshot extends Document {
  weekKey: string;
  capturedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  guilds: ReporterGuildSnapshot[];
  players: ReporterPlayerSnapshot[];
  pickems: ReporterPickemSnapshot[];
  createdAt: Date;
}

export interface IReporterGeneration extends Document {
  weekKey: string;
  source: ReporterRunSource;
  status: "running" | "completed" | "failed";
  modelId: string;
  reasoningEffort: string;
  promptVersion: string;
  snapshotId: mongoose.Types.ObjectId;
  responseId?: string;
  usage?: ReporterUsage;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReporterPost extends Document {
  weekKey: string;
  slug: string;
  status: ReporterPostStatus;
  periodStart: Date;
  periodEnd: Date;
  snapshotId: mongoose.Types.ObjectId;
  previousSnapshotId?: mongoose.Types.ObjectId;
  generationId: mongoose.Types.ObjectId;
  facts: ReporterFact[];
  content: ReporterGeneratedContent;
  usage: ReporterUsage;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReporterSettings extends Document, Omit<ReporterSettingsValue, "updatedAt"> {
  key: "global";
  createdAt: Date;
  updatedAt: Date;
}

const ReporterSnapshotSchema = new Schema<IReporterSnapshot>(
  {
    weekKey: { type: String, required: true, index: true },
    capturedAt: { type: Date, required: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    guilds: { type: [ReporterGuildSnapshotSchema], required: true, default: [] },
    players: { type: [ReporterPlayerSnapshotSchema], required: true, default: [] },
    pickems: { type: [ReporterPickemSnapshotSchema], required: true, default: [] },
  },
  { timestamps: true, collection: "reporter_snapshots" },
);

const ReporterGenerationSchema = new Schema<IReporterGeneration>(
  {
    weekKey: { type: String, required: true, index: true },
    source: { type: String, enum: ["admin", "cron"], required: true },
    status: { type: String, enum: ["running", "completed", "failed"], required: true, index: true },
    modelId: { type: String, required: true },
    reasoningEffort: { type: String, required: true },
    promptVersion: { type: String, required: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: "ReporterSnapshot", required: true },
    responseId: { type: String },
    usage: { type: ReporterUsageSchema },
    error: { type: String },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
    durationMs: { type: Number },
  },
  { timestamps: true, collection: "reporter_generations" },
);

const ReporterPostSchema = new Schema<IReporterPost>(
  {
    weekKey: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true },
    status: { type: String, enum: ["draft", "published"], required: true, default: "draft", index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: "ReporterSnapshot", required: true },
    previousSnapshotId: { type: Schema.Types.ObjectId, ref: "ReporterSnapshot" },
    generationId: { type: Schema.Types.ObjectId, ref: "ReporterGeneration", required: true },
    facts: { type: [ReporterFactSchema], required: true, default: [] },
    content: { type: ReporterGeneratedContentSchema, required: true },
    usage: { type: ReporterUsageSchema, required: true },
    publishedAt: { type: Date },
  },
  { timestamps: true, collection: "reporter_posts" },
);

const ReporterSettingsSchema = new Schema<IReporterSettings>(
  {
    key: { type: String, enum: ["global"], required: true, unique: true, default: "global" },
    featureEnabled: { type: Boolean, required: true, default: false },
    automationEnabled: { type: Boolean, required: true, default: false },
    autoPublish: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, collection: "reporter_settings" },
);

ReporterPostSchema.index({ status: 1, publishedAt: -1 });

export const ReporterSnapshot = mongoose.model<IReporterSnapshot>("ReporterSnapshot", ReporterSnapshotSchema);
export const ReporterGeneration = mongoose.model<IReporterGeneration>("ReporterGeneration", ReporterGenerationSchema);
export const ReporterPost = mongoose.model<IReporterPost>("ReporterPost", ReporterPostSchema);
export const ReporterSettings = mongoose.model<IReporterSettings>("ReporterSettings", ReporterSettingsSchema);
