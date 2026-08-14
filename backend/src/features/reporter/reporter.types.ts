import type { IGuildCrest } from "../../models/Guild";

export type ReporterRunSource = "admin" | "cron";
export type ReporterPostStatus = "draft" | "published";

export interface ReporterSettingsValue {
  featureEnabled: boolean;
  automationEnabled: boolean;
  autoPublish: boolean;
  updatedAt?: Date;
}

export type ReporterSettingsUpdate = Partial<Pick<ReporterSettingsValue, "featureEnabled" | "automationEnabled" | "autoPublish">>;

export interface ReporterLinkVisual {
  type: "guild-crest" | "icon" | "wcl";
  crest?: IGuildCrest;
  faction?: string;
  iconUrl?: string;
  provider?: "wcl";
}

export interface ReporterLink {
  ref: string;
  label: string;
  url: string;
  kind: "guild" | "character" | "boss" | "pickem" | "event" | "analytics" | "log";
  visual?: ReporterLinkVisual;
}

export interface ReporterResolvedLink {
  url: string;
  kind: ReporterLink["kind"];
  visual?: ReporterLinkVisual;
}

export interface ReporterFact {
  id: string;
  kind: string;
  summary: string;
  occurredAt?: string;
  links: ReporterLink[];
}

export interface ReporterLocaleContent {
  title: string;
  summary: string;
  body: string;
}

export interface ReporterGeneratedContent {
  en: ReporterLocaleContent;
  fi: ReporterLocaleContent;
}

export interface ReporterUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  rates: {
    inputPerMillion: number;
    cachedInputPerMillion: number;
    cacheWritePerMillion: number;
    outputPerMillion: number;
  };
}

export interface ReporterBossSnapshot {
  bossId: number;
  bossName: string;
  iconUrl?: string;
  kills: number;
  bestPercent: number;
  pullCount: number;
  firstKillTime?: string;
  firstKillReportCode?: string;
  firstKillFightId?: number;
  bestPullReportCode?: string;
  bestPullFightId?: number;
  totalPhases?: number;
  bestPullPhase?: {
    phaseId?: number;
    phaseName?: string;
    bossHealth?: number;
    fightCompletion?: number;
    displayString?: string;
  };
}

export interface ReporterProgressSnapshot {
  raidId: number;
  raidName: string;
  iconUrl?: string;
  difficulty: "mythic" | "heroic";
  bossesDefeated: number;
  totalBosses: number;
  guildRank?: number;
  worldRank?: number;
  bosses: ReporterBossSnapshot[];
}

export interface ReporterGuildSnapshot {
  guildId: string;
  name: string;
  realm: string;
  faction?: string;
  crest?: IGuildCrest;
  parentGuild?: string;
  progress: ReporterProgressSnapshot[];
}

export interface ReporterPlayerSnapshot {
  category: "dps" | "healer" | "tank";
  rank: number;
  name: string;
  realm: string;
  classId?: number;
  guildName?: string;
  guildRealm?: string;
  role: string;
  specName: string;
  score: number;
}

export interface ReporterPickemSnapshot {
  pickemId: string;
  name: string;
  type: string;
  active: boolean;
  votingStart: string;
  votingEnd: string;
  finalized: boolean;
  updatedAt: string;
}
