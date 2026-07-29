import { ReactNode } from "react";

export interface BestPullPhase {
  phaseId: number;
  phaseName: string;
  bossHealth: number;
  fightCompletion: number;
  displayString: string; // e.g., "45% P3"
}

// Pull history entry for progress charts
export interface PullHistoryEntry {
  pullNumber: number;
  fightPercentage: number; // 0-100, where 0 = kill, 100 = instant wipe
  phase?: string; // Phase identifier like "P1", "P2", "I1" etc.
  isKill: boolean;
  reportCode?: string;
  fightId?: number;
  url?: string;
  timestamp?: string;
  duration?: number; // seconds
  bossPercentage?: number;
  progressDisplay?: string;
}

// Phase distribution for pie chart
export interface PhaseDistribution {
  phase: string;
  count: number;
}

export interface BossBestPull {
  reportCode: string;
  fightId: number;
  url: string;
  timestamp: string;
  duration: number; // seconds
  bossPercentage: number;
  fightPercentage: number;
  progressDisplay?: string;
  isKill: boolean;
  vodLinks?: Array<{
    channelName: string;
    url: string;
    offsetSeconds: number;
    videoId?: string;
    phaseLinks?: Array<{
      label: string;
      url: string;
      offsetSeconds: number;
    }>;
  }>;
}

// Response from getBossPullHistory API
export interface BossPullHistoryResponse {
  pullHistory: PullHistoryEntry[];
  phaseDistribution: PhaseDistribution[];
  bestPulls: BossBestPull[];
}

export type BossPredictionUnavailableReason = "raid_not_current" | "guild_or_boss_not_found" | "boss_not_progressing";

export type BossPredictionResponse =
  | {
      available: false;
      reason: BossPredictionUnavailableReason;
    }
  | {
      available: true;
      boss: {
        id: number;
        name: string;
        raidName: string;
        difficulty: "mythic" | "heroic";
      };
      estimate: {
        killPull: number;
        remainingPulls: number;
        confidence: "low" | "medium" | "high";
      };
      facts: {
        currentPulls: number;
        bestPercent: number;
        phaseCounts: PhaseDistribution[];
        killedGuilds: number;
        progressingGuilds: number;
        medianKillPull: number | null;
        usedPhaseData: boolean;
      };
    };

export interface GuildCrest {
  emblem: {
    id: number;
    imageName: string;
    color: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
  border: {
    id: number;
    imageName: string;
    color: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
  background: {
    color: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  };
}

export interface BossProgress {
  bossId: number;
  bossName: string;
  kills: number;
  bestPercent: number; // Best pull: lowest boss health % reached (0 = kill, 100 = no progress)
  pullCount: number;
  timeSpent: number;
  firstKillTime?: string;
  firstKillReportCode?: string; // WCL report code for first kill
  firstKillFightId?: number; // Fight ID within the report
  killOrder?: number; // Order in which this boss was first killed (1 = first, 2 = second, etc.)
  bestPullPhase?: BestPullPhase; // Phase context for best pull
  bestPullReportCode?: string; // WCL report code for best pull (for unkilled bosses)
  bestPullFightId?: number; // Fight ID within the report for best pull (for unkilled bosses)
  bestVodLinks?: NonNullable<BossBestPull["vodLinks"]>; // VOD links for the row's kill/best-pull log target
  pullHistory?: PullHistoryEntry[]; // Pull history for progress charts (up to first kill)
  lastUpdated: string;
}

// Minimal progress for leaderboard (without detailed bosses array)
export interface RaidProgressSummary {
  raidId: number;
  raidName: string;
  difficulty: "mythic" | "heroic";
  bossesDefeated: number;
  totalBosses: number;
  totalTimeSpent: number;
  totalCombatTimeSpent?: number;
  progressRaidTimeSpent?: number;
  totalRaidTimeSpent?: number;
  currentBossPulls: number;
  totalPulls?: number | null; // Combined pulls when every boss has logged kill data
  bestPullPercent: number;
  bestPullPhase?: BestPullPhase;
  lastKillTime?: string | null; // Timestamp of the most recent boss kill
  lastKilledBossPulls?: number; // Pull count for the most recently defeated boss
  worldRank?: number; // Best world rank (lowest of WCL and Raider.IO)
  worldRankColor?: string; // Color class for the best world rank
  wclWorldRank?: number; // World rank from WarcraftLogs
  wclWorldRankColor?: string; // Color from WarcraftLogs
  rioWorldRank?: number; // World rank from Raider.IO
  guildRank?: number; // Rank among tracked guilds (1 = best)
}

// Full progress with bosses array (for guild detail view)
export interface RaidProgress {
  raidId: number;
  raidName: string;
  difficulty: "mythic" | "heroic";
  bossesDefeated: number;
  totalBosses: number;
  totalTimeSpent: number;
  totalCombatTimeSpent?: number;
  progressRaidTimeSpent?: number;
  totalRaidTimeSpent?: number;
  bosses: BossProgress[];
  worldRank?: number; // Best world rank (lowest of WCL and Raider.IO)
  worldRankColor?: string; // Color class for the best world rank
  wclWorldRank?: number; // World rank from WarcraftLogs
  wclWorldRankColor?: string; // Color from WarcraftLogs
  rioWorldRank?: number; // World rank from Raider.IO
  guildRank?: number; // Rank among tracked guilds (1 = best)
  lastUpdated: string;
}

// Official raid progression from Raider.IO (reflects in-game kills, not log-dependent)
export interface OfficialRaidProgress {
  raidTierSlug: string;
  summary: string; // e.g., "6/9 M"
  totalBosses: number;
  normalBossesKilled: number;
  heroicBossesKilled: number;
  mythicBossesKilled: number;
  lastUpdated: string;
}

export interface ScheduleDisplay {
  totalDays: number;
  averageHours: number;
}

export interface Streamer {
  channelName: string;
  isLive: boolean;
}

export interface LiveStreamer {
  channelName: string;
  isLive: boolean;
  isPlayingWoW: boolean;
  gameName?: string;
  guild: {
    name: string;
    realm: string;
    region: string;
    parent_guild?: string;
    isCurrentlyRaiding: boolean;
  };
  bestPull?: {
    bossName: string;
    pullCount: number;
    bestPercent: number;
    bestPullPhase?: BestPullPhase;
  };
}

export interface GuildLatestReportLink {
  code: string;
  url: string;
  startTime: number;
  isOngoing: boolean;
}

// Ultra-minimal guild info for directory/list page
export interface GuildDirectoryItem {
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
  warcraftlogsId?: number;
  isCurrentlyRaiding: boolean;
}

// Minimal guild info for leaderboard
export interface GuildListItem {
  _id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  warcraftlogsId?: number;
  crest?: GuildCrest;
  horseRaceUmaImage?: string;
  parent_guild?: string; // Parent guild name if this is a team/sub-guild
  isCurrentlyRaiding: boolean;
  isStreaming?: boolean; // Computed field: true if any streamer is live
  latestReport?: GuildLatestReportLink; // Latest WCL report link for active raiding badge
  lastFetched?: string;
  progress: RaidProgressSummary[];
  streamers?: Streamer[]; // Twitch streamers for this guild
  bestVodLinks?: Array<{
    channelName: string;
    url: string;
    offsetSeconds?: number;
    videoId?: string;
    phaseLinks?: Array<{
      label: string;
      url: string;
      offsetSeconds: number;
    }>;
  }>;
  officialProgress?: OfficialRaidProgress[];
  scheduleDisplay?: ScheduleDisplay | null;
  raidSchedule?: RaidSchedule;
}

// Tier score for a single category
export interface TierScoreEntry {
  overallScore: number;
  speedScore: number;
  efficiencyScore: number;
}

// Tier score for a specific raid
export interface RaidTierScoreEntry extends TierScoreEntry {
  raidId: number;
  raidName: string;
}

// Guild tier scores (overall + current raids)
export interface GuildTierScores {
  overall: TierScoreEntry | null;
  raids: RaidTierScoreEntry[];
}

export type GuildLatestReportDifficulty = "mythic" | "heroic" | "normal" | "lfr" | "unknown";

export interface GuildLatestReportDifficultySummary {
  difficultyId: number;
  difficulty: GuildLatestReportDifficulty;
  pulls: number;
  kills: number;
  wipes: number;
}

export interface GuildLatestReportBossSummary {
  encounterID: number;
  name: string;
  iconUrl?: string;
  pulls: number;
  kills: number;
  wipes: number;
  difficulties: GuildLatestReportDifficultySummary[];
}

export interface GuildLatestReport {
  code: string;
  url: string;
  raidId?: number;
  raidName: string;
  raidIconUrl?: string;
  startTime: number;
  endTime?: number;
  durationSeconds?: number;
  isOngoing: boolean;
  fightCount: number;
  kills: number;
  wipes: number;
  difficulties: GuildLatestReportDifficultySummary[];
  bosses: GuildLatestReportBossSummary[];
}

export type GuildProfileHighlightKind = "character" | "account";

export interface GuildProfileHighlightMember {
  kind: GuildProfileHighlightKind;
  characterId?: string | null;
  accountGroupId?: string | null;
  accountSlug?: string | null;
  accountDisplayName?: string | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  characterCount: number;
  reportCount: number;
  raidCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface GuildProfileHighlightTopPerformer {
  kind: GuildProfileHighlightKind;
  characterId?: string | null;
  accountGroupId?: string | null;
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
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  score: number;
  parseScore: number;
  survivalScore: number | null;
  pulls: number;
  deaths: number;
  earlyDeaths: number;
}

export interface GuildProfileHighlights {
  generatedAt: string;
  sourceUpdatedAt?: string | null;
  mainstays: GuildProfileHighlightMember[];
  topPerformers: GuildProfileHighlightTopPerformer[];
}

// Guild with summary progress (for guild profile page initial load)
export interface GuildSummary {
  _id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  warcraftlogsId?: number;
  crest?: GuildCrest;
  horseRaceUmaImage?: string;
  parent_guild?: string; // Parent guild name if this is a team/sub-guild
  isCurrentlyRaiding: boolean;
  lastFetched?: string;
  progress: RaidProgressSummary[];
  officialProgress?: OfficialRaidProgress[];
  scheduleDisplay?: ScheduleDisplay | null;
  raidSchedule?: RaidSchedule;
  streamers?: Streamer[]; // Twitch streamers for this guild
  tierScores?: GuildTierScores | null; // Tier list scores for this guild
  latestReports?: GuildLatestReport[]; // Recent WCL reports with compact pull summaries
  profileHighlights?: GuildProfileHighlights | null; // Compact guild-only character/account cards
}

export interface WorldRankHistoryEntry {
  worldRank: number;
  wclWorldRank?: number;
  rioWorldRank?: number;
  recordedAt: string;
}

export interface GuildBossProgressResponse {
  progress: RaidProgress[];
  worldRankHistory?: WorldRankHistoryEntry[];
}

// Full guild info with detailed boss progress (for detail view)
export interface Guild {
  _id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  warcraftlogsId?: number;
  crest?: GuildCrest;
  horseRaceUmaImage?: string;
  parent_guild?: string; // Parent guild name if this is a team/sub-guild
  isCurrentlyRaiding: boolean;
  lastFetched?: string;
  progress: RaidProgress[];
  streamers?: Streamer[]; // Twitch streamers for this guild
  raidSchedule?: RaidSchedule;
  worldRankHistory?: WorldRankHistoryEntry[];
}

export interface Event {
  _id: string;
  type: "boss_kill" | "best_pull" | "milestone" | "hiatus" | "regress" | "reproge";
  guildId: string;
  guildName: string;
  guildRealm?: string;
  guildCrest?: GuildCrest;
  raidId: number;
  raidName: string;
  bossId?: number;
  bossName?: string;
  bossIconUrl?: string;
  liveStreamers?: string[]; // Currently live Twitch channel names for this guild
  isCurrentlyRaiding?: boolean; // Current guild live-log status, enriched at response time
  difficulty: "mythic" | "heroic";
  data: {
    killRank?: number;
    pullCount?: number;
    bestPercent?: number;
    timeSpent?: number;
    progressDisplay?: string; // Phase-enhanced display string like "45% P3"
    hiatusDays?: number; // Days since last raid activity (7, 14, 30)
  };
  timestamp: string;
}

export interface Boss {
  id: number;
  name: string;
  slug: string;
  iconUrl?: string;
}

export interface RegionDates {
  us?: string;
  eu?: string;
  tw?: string;
  kr?: string;
  cn?: string;
}

export interface RaidDates {
  starts?: RegionDates;
  ends?: RegionDates;
}

// Home page data response (single endpoint with all data)
export interface HomePageData {
  raid: {
    id: number;
    name: string;
    slug: string;
    expansion: string;
    iconUrl?: string;
  };
  raids: RaidInfo[];
  dates: RaidDates;
  guilds: GuildListItem[];
  events: Event[];
}

// Minimal raid info (without bosses or dates) - used in raid selector
export interface RaidInfo {
  id: number;
  name: string;
  slug: string;
  rioSlug?: string;
  expansion: string;
  iconUrl?: string;
  partitions?: RaidPartition[];
  isCurrent?: boolean;
  isPrimary?: boolean;
}

export interface RaidPartition {
  id: number;
  name: string;
}

export interface CharacterRankingsRaidOption {
  id: number;
  name: string;
  expansion: string;
  iconUrl?: string;
  partitions: RaidPartition[];
}

export interface CharacterRankingsFilterOptionsResponse {
  raids: CharacterRankingsRaidOption[];
  defaultSelection: {
    zoneId: number;
    partition: number | null;
  };
}

export type CharacterRaidAchievementType = "cutting_edge" | "ahead_of_the_curve";

export interface CharacterRaidAchievementEntry {
  achievementId: number;
  name: string;
  type: CharacterRaidAchievementType;
  completedTimestamp: number;
  completedAt: string;
}

export interface CharacterRaidAchievementSummary {
  version: string;
  fetchedAt: string;
  cuttingEdgeCount: number;
  aheadOfTheCurveCount: number;
  totalCount: number;
  achievements: CharacterRaidAchievementEntry[];
}

// Full raid info with bosses and dates - for backward compatibility
export interface Raid extends RaidInfo {
  starts?: RegionDates;
  ends?: RegionDates;
  bosses: Boss[];
  _id?: string; // Optional for backward compatibility
  createdAt?: string; // Optional for backward compatibility
  updatedAt?: string; // Optional for backward compatibility
}

export interface PaginationInfo {
  page: number;
  limit: number;
  totalPages: number;
  totalCount: number;
}

export interface EventFilters {
  types?: string[];
  difficulties?: string[];
  guildName?: string;
}

export interface EventsResponse {
  events: Event[];
  pagination: PaginationInfo;
}

export interface RaidScheduleDay {
  day: string; // "Monday", "Tuesday", etc.
  startHour: number; // 0-23.5 (supports half hours)
  endHour: number; // 0-23.5 (supports half hours)
}

export interface RaidSchedule {
  days: RaidScheduleDay[];
  lastCalculated?: string;
}

export interface GuildSchedule {
  _id: string;
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
  raidSchedule: RaidSchedule;
}

export interface RaidingTodayGuild {
  _id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  crest?: GuildCrest;
  parent_guild?: string;
  raidTime: RaidScheduleDay;
}

export interface RaidingTodayResponse {
  date: string;
  day: string;
  guilds: RaidingTodayGuild[];
}

// Tier List types
export interface GuildTierScore {
  guildId: string;
  guildName: string;
  realm: string;
  faction?: string;
  crest?: GuildCrest;
  parent_guild?: string;
  overallScore: number;
  speedScore: number;
  efficiencyScore: number;
}

export interface RaidTierList {
  raidId: number;
  raidName: string;
  guilds: GuildTierScore[];
}

export interface TierList {
  calculatedAt: string;
  overall: GuildTierScore[];
  raids: RaidTierList[];
}

// Response for overall tier list only (without per-raid data)
export interface OverallTierListResponse {
  calculatedAt: string;
  guilds: GuildTierScore[];
}

// Response for a specific raid tier list
export interface RaidTierListResponse {
  calculatedAt: string;
  raidId: number;
  raidName: string;
  guilds: GuildTierScore[];
}

// Available raid info from tier list
export interface TierListRaidInfo {
  raidId: number;
  raidName: string;
}

export type CharacterTierListRole = "dps" | "healer" | "tank";
export type CharacterTierListMetric = "dps" | "hps";
export type CharacterTierName = "S" | "A" | "B" | "C" | "D" | "E" | "F";
export type CustomCharacterTierName = CharacterTierName;

export interface CharacterTierListRaidInfo {
  raidId: number;
  raidName: string;
  generatedAt: string | null;
  characterCount: number;
}

export interface CharacterTierListBossScore {
  encounterId: number;
  encounterName: string;
  score: number;
  parseScore: number;
  survivalScore: number | null;
  pulls: number;
  deaths: number;
  survivedPulls: number;
  earlyDeaths: number;
  averageDeathPercent: number | null;
  deathDataAvailable: boolean;
  specName: string;
  rankPercent: number;
}

export interface CharacterTierListCharacter {
  characterKey: string;
  characterId: string | null;
  accountGroupId: string | null;
  wclCanonicalCharacterId: number | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  guildName: string | null;
  role: CharacterTierListRole;
  metric: CharacterTierListMetric;
  specName: string;
  bestSpecName: string | null;
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
  bossScores: CharacterTierListBossScore[];
  reportCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceUpdatedAt: string;
}

export interface CharacterTierListFilters {
  minReports: number;
  role: CharacterTierListRole | null;
  classId: number | null;
  limit: number | null;
}

export interface CharacterTierListResponse {
  raid: {
    id: number;
    name: string;
  };
  guild?: {
    id: string;
    name: string;
    realm: string;
  } | null;
  filters: CharacterTierListFilters;
  generatedAt: string | null;
  characters: CharacterTierListCharacter[];
  total: number;
}

export interface CharacterTierListRosterCharacter {
  characterKey: string;
  characterId: string | null;
  wclCanonicalCharacterId: number | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reportCount: number;
  score: number | null;
  parseScore: number | null;
  survivalScore: number | null;
  role: CharacterTierListRole | null;
  metric: CharacterTierListMetric | null;
  specName: string | null;
  bestSpecName: string | null;
  pulls: number | null;
  deaths: number | null;
}

export interface CustomCharacterTierBucket {
  tier: CustomCharacterTierName;
  characterKeys: string[];
}

export interface CustomCharacterTierListResponse {
  guild: {
    id: string;
    name: string;
    realm: string;
  };
  raid: {
    id: number;
    name: string;
  };
  roster: CharacterTierListRosterCharacter[];
  canSave: boolean;
  customList: {
    saved: boolean;
    updatedAt: string | null;
    tiers: CustomCharacterTierBucket[];
    unplacedCharacterKeys: string[];
  };
}

export interface SharedCharacterTierListResponse extends CustomCharacterTierListResponse {
  share: {
    shareId: string;
    createdAt: string;
    updatedAt: string;
    owner: boolean;
    canEdit: boolean;
  };
}

export interface SaveCustomCharacterTierListInput {
  tiers: CustomCharacterTierBucket[];
  unplacedCharacterKeys: string[];
}

// Analytics types
export interface AnalyticsPeriodStats {
  totalRequests: number;
  avgResponseTime: number;
  totalDataTransferred: number;
  formattedData: string;
  uniqueVisitors: number;
}

export interface AnalyticsOverview {
  last24Hours: AnalyticsPeriodStats;
  last7Days: AnalyticsPeriodStats;
  last30Days: AnalyticsPeriodStats;
}

export interface AnalyticsHourly {
  hour: string;
  requests: number;
  avgResponseTime: number;
  dataTransferred: number;
  formattedData: string;
}

export interface AnalyticsDaily {
  date: string;
  requests: number;
  avgResponseTime: number;
  dataTransferred: number;
  formattedData: string;
  uniqueVisitors: number;
}

export interface AnalyticsEndpoint {
  endpoint: string;
  count: number;
  avgResponseTime: number;
  totalSize: number;
  formattedSize: string;
  successRate: number;
  errorCount: number;
  methods?: string[];
  lastCalled?: string;
}

export interface AnalyticsStatusCode {
  statusCode: number;
  count: number;
}

export interface AnalyticsRecent {
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  responseSize: number;
  formattedSize: string;
  timestamp: string;
}

export interface AnalyticsRealtime {
  currentHour: {
    requests: number;
    avgResponseTime: number;
    dataTransferred: string;
  };
  requestsPerMinute: number;
}

export interface AnalyticsPeakHour {
  hour: number;
  hourLabel: string;
  totalRequests: number;
  avgRequests: number;
  avgResponseTime: number;
}

export interface AnalyticsPeakHours {
  hours: AnalyticsPeakHour[];
  peakHour: AnalyticsPeakHour;
}

export interface AnalyticsTrends {
  weekOverWeek: {
    current: number;
    previous: number;
    change: number;
    dataChange: number;
  };
  dayOverDay: {
    current: number;
    previous: number;
    change: number;
    dataChange: number;
  };
}

export interface AnalyticsSlowEndpoint {
  endpoint: string;
  count: number;
  avgResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  p95ResponseTime: number;
}

export interface AnalyticsErrorDetail {
  endpoint: string;
  statusCode: number;
  count: number;
  lastOccurred: string;
}

export interface AnalyticsErrorSummary {
  endpoint: string;
  totalErrors: number;
  statusCodes: Record<number, number>;
}

export interface AnalyticsErrors {
  details: AnalyticsErrorDetail[];
  summary: AnalyticsErrorSummary[];
}

// User/Auth types
export interface DiscordUserInfo {
  username: string;
  avatarUrl: string;
}

export interface TwitchUserInfo {
  displayName: string;
  profileImageUrl: string | null;
  connectedAt: string;
}

export interface WoWCharacter {
  id: number;
  name: string;
  realm: string;
  realmSlug?: string; // Only present when fetching all characters
  class: string;
  race: string;
  level: number;
  faction: "ALLIANCE" | "HORDE";
  guild?: string;
  selected: boolean;
  inactive?: boolean;
}

export interface BattleNetUserInfo {
  battletag: string;
  connectedAt: string;
  characters: WoWCharacter[];
  lastCharacterSync: string | null;
}

// Minimal user info from /me endpoint (used for auth check)
export interface AuthUser {
  discord: DiscordUserInfo;
  isAdmin: boolean;
}

// Full user profile from /profile endpoint (used on profile page)
export interface UserProfile {
  discord: DiscordUserInfo;
  twitch?: TwitchUserInfo;
  battlenet?: BattleNetUserInfo;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export interface StreamerGuildOption {
  id: string;
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
}

export interface StreamerSettings {
  selectedGuildId: string | null;
  eligibleGuilds: StreamerGuildOption[];
  requirements: {
    hasTwitch: boolean;
    hasBattleNet: boolean;
    hasSelectedCharacter: boolean;
    hasEligibleGuild: boolean;
  };
}

export type DiscordEventType = "boss_kill" | "best_pull" | "milestone" | "hiatus" | "regress" | "reproge";
export type DiscordEventDifficulty = "mythic" | "heroic";

export interface DiscordBotStatus {
  enabled: boolean;
  missing: {
    clientId: boolean;
    clientSecret: boolean;
    botToken: boolean;
    publicKey: boolean;
  };
  installRedirectUri: string;
  interactionsEndpointUrl: string;
}

export interface DiscordManageableGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  canManage: boolean;
  botInstalled: boolean;
}

export interface DiscordGuildsResponse {
  needsReconnect: boolean;
  guilds: DiscordManageableGuild[];
}

export interface DiscordIntegration {
  id: string;
  discordGuildId: string;
  discordGuildName: string;
  discordGuildIcon: string | null;
  features: {
    search: boolean;
    events: boolean;
  };
  eventConfig: {
    enabled: boolean;
    channelId: string | null;
    channelName: string | null;
    guildIds: string[];
    eventTypes: DiscordEventType[];
    difficulties: DiscordEventDifficulty[];
    raidIds: number[];
  };
  isInstalled: boolean;
  installedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface DiscordIntegrationsResponse {
  needsReconnect: boolean;
  integrations: DiscordIntegration[];
}

export interface DiscordChannelOption {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
}

export interface DiscordTrackedGuildOption {
  id: string;
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
}

export interface DiscordRaidOption {
  id: number;
  name: string;
  expansion: string;
  iconUrl?: string;
}

export interface DiscordIntegrationSettings {
  integration: DiscordIntegration | null;
  channels: DiscordChannelOption[];
  guildOptions: DiscordTrackedGuildOption[];
  raidOptions: DiscordRaidOption[];
  validEventTypes: DiscordEventType[];
  validDifficulties: DiscordEventDifficulty[];
}

export interface UpdateDiscordIntegrationInput {
  searchEnabled: boolean;
  eventsEnabled: boolean;
  channelId: string | null;
  guildIds: string[];
  eventTypes: DiscordEventType[];
  difficulties: DiscordEventDifficulty[];
  raidIds: number[];
}

// Alias for backwards compatibility
export type User = AuthUser;

// Admin Panel types
export interface AdminUser {
  id: string;
  discord: {
    id: string;
    username: string;
    hasAvatar: boolean;
  };
  twitch: {
    displayName: string;
    connectedAt: string;
  } | null;
  battlenet: {
    battletag: string;
    connectedAt: string;
  } | null;
  createdAt: string;
  lastLoginAt: string;
  pickemSubmissionCount: number;
}

export interface AdminGuild {
  id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  warcraftlogsId?: number;
  wclStatus?: "active" | "not_found" | "unclaimed" | "unknown";
  horseRaceUmaImage?: string;
  parentGuild?: string;
  isCurrentlyRaiding: boolean;
  lastFetched?: string;
  createdAt?: string;
  progress?: {
    raidName: string;
    difficulty: string;
    bossesDefeated: number;
    totalBosses: number;
  }[];
}

export interface AdminPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  pagination: AdminPagination;
}

export interface AdminUserPickemMetadata {
  id: string;
  name: string;
  type: PickemType;
  guildCount: number;
  votingStart: string | null;
  votingEnd: string | null;
  active: boolean;
  finalized: boolean;
}

export interface AdminUserPickemSubmission {
  pickem: AdminUserPickemMetadata;
  submittedAt: string;
  updatedAt: string;
  predictions: PickemPrediction[];
}

export interface AdminUserPickemsResponse {
  userId: string;
  submissions: AdminUserPickemSubmission[];
}

export interface AdminGuildsResponse {
  guilds: AdminGuild[];
  pagination: AdminPagination;
}

export interface AdminTwitchStream {
  channelName: string;
  twitchUrl: string;
  isLive: boolean;
  isPlayingWoW: boolean;
  gameName?: string;
  twitchUserId?: string;
  currentStreamId?: string;
  streamStartedAt?: string;
  lastStreamId?: string;
  lastStreamStartedAt?: string;
  lastStreamEndedAt?: string;
  lastLiveAt?: string;
  lastChecked?: string;
  guild: {
    id: string;
    name: string;
    realm: string;
    region: string;
    parentGuild?: string;
    isCurrentlyRaiding: boolean;
    activityStatus: "active" | "inactive";
  };
}

export interface AdminTwitchStreamsResponse {
  streams: AdminTwitchStream[];
  stats: {
    total: number;
    uniqueChannels: number;
    live: number;
    livePlayingWoW: number;
  };
}

export type TwitchBotEventType = "boss_kill" | "best_pull" | "milestone" | "hiatus" | "regress" | "reproge";
export type TwitchBotDifficulty = "mythic" | "heroic";
export type TwitchBotMessageTemplateKey = "bossKill" | "bestPull" | "progressUpdate";
export type TwitchBotMessageTemplates = Record<TwitchBotMessageTemplateKey, string>;

export interface TwitchBotSettings {
  eventPublishingEnabled: boolean;
  eventTypes: TwitchBotEventType[];
  difficulties: TwitchBotDifficulty[];
  includeUrl: boolean;
  messageTemplates: TwitchBotMessageTemplates;
}

export interface TwitchBotFollowedChannel {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  followedAt: string;
}

export interface TwitchBotFollowsResponse {
  enabled: boolean;
  connected: boolean;
  requiredScope: string;
  hasRequiredScope: boolean;
  total: number;
  channels: TwitchBotFollowedChannel[];
  fetchedAt?: string;
}

export interface TwitchCustomReward {
  id: string;
  title: string;
  cost: number;
  isEnabled: boolean;
  isPaused: boolean;
  isInStock: boolean;
  skipsRequestQueue: boolean;
}

export type TwitchCcgRewardKind = "packs" | "packs_10" | "card_reveal";

export interface TwitchChannelPointsRewardStatus {
  enabled: boolean;
  rewardId?: string;
  rewardTitle?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  subscriptionCreatedAt?: string;
  lastNotificationAt?: string;
  lastError?: string;
}

export interface TwitchChannelPointsStatus {
  enabled: boolean;
  connected: boolean;
  expectedBroadcasterLogin: string;
  redirectUri: string;
  callbackUrl: string;
  scopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  broadcasterUserId?: string;
  broadcasterLogin?: string;
  broadcasterDisplayName?: string;
  connectedAt?: string;
  connectedByUsername?: string;
  tokenExpiresAt?: string;
  rewardEnabled: boolean;
  rewardId?: string;
  rewardTitle?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  subscriptionCreatedAt?: string;
  lastNotificationAt?: string;
  lastRefreshAt?: string;
  lastRefreshError?: string;
  lastVerifiedAt?: string;
  lastVerifiedError?: string;
  lastError?: string;
  deliveries: {
    grants: { pending: number; granted: number; failed: number };
    chat: { pending: number; sent: number; skipped: number; failed: number; expired: number; sent24h: number };
    assignments: { pending: number; assigned: number; failed: number };
    byReward: Record<TwitchCcgRewardKind, {
      grants: { pending: number; granted: number; failed: number };
      chat: { pending: number; sent: number; skipped: number; failed: number; expired: number; sent24h: number };
    }>;
  };
  rewards: Record<TwitchCcgRewardKind, TwitchChannelPointsRewardStatus>;
  overlay: {
    configured: boolean;
    lastSeenAt?: string;
    queued: number;
    leased: number;
    played: number;
    expired: number;
  };
}

export interface AdminUserStats {
  total: number;
  active: {
    last24Hours: number;
    last7Days: number;
    last30Days: number;
  };
  connections: {
    twitch: number;
    battlenet: number;
  };
}

export interface AdminGuildStats {
  total: number;
  currentlyRaiding: number;
  withWarcraftlogsId: number;
  factions: Record<string, number>;
}

export interface AdminCharacter {
  id: string;
  name: string;
  realm: string;
  region: string;
  classID: number;
  wclCanonicalCharacterId: number;
  className: string;
  lastMythicSeenAt: string | null;
  rankingsAvailable: boolean | null;
  blizzardIdentity: {
    name: string;
    realm: string;
    region: string;
  };
  blizzardIdentityOverride: {
    name: string;
    realm: string;
    updatedAt: string;
    updatedBy: string;
    active: boolean;
  } | null;
  identityLinks: AdminCharacterIdentityLink[];
  accountLinks: AdminCharacterAccountLink[];
  continuitySources: AdminCharacterContinuityLink[];
  continuityTarget: AdminCharacterContinuityLink | null;
}

export interface AdminCharacterIdentityLink {
  id: string;
  sourceName: string;
  sourceRealm: string;
  sourceRegion: string;
  sourceClassID: number;
  createdBy: string;
  createdAt: string;
}

export interface AdminCharacterIdentityLinkPreview {
  eligible: boolean;
  blockers: string[];
  source: { name: string; realm: string; region: string; classID: number };
  target: { id: string; name: string; realm: string; region: string; classID: number; wclCanonicalCharacterId: number };
  impact: {
    appearanceCount: number;
    unresolvedAppearanceCount: number;
    conflictingAppearanceCount: number;
    reportCollisionCount: number;
    raidCount: number;
    guildCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  existingLink: { id: string; targetCharacterId: string; createdBy: string; createdAt: string } | null;
}

export interface AdminCharacterAccountLink {
  id: string;
  character: { id: string; name: string; realm: string; region: string; classID: number };
  createdBy: string;
  createdAt: string;
}

export interface AdminCharacterAccountLinkPreview {
  eligible: boolean;
  blockers: string[];
  target: { id: string; name: string; realm: string; region: string; classID: number };
  other: { id: string; name: string; realm: string; region: string; classID: number };
  impact: {
    alreadyGrouped: boolean;
    currentGroupCount: number;
    mergedCharacterCount: number;
    members: Array<{ id: string; name: string; realm: string; region: string; classID: number }>;
  };
  existingEdge: { id: string; createdBy: string; createdAt: string } | null;
}

export interface AdminCharacterContinuityLink {
  id: string;
  character: {
    id: string;
    name: string;
    realm: string;
    region: string;
    classID: number;
    wclCanonicalCharacterId: number;
  };
  createdBy: string;
  createdAt: string;
}

export interface AdminCharacterContinuityLinkPreview {
  eligible: boolean;
  blockers: string[];
  source: { id: string; name: string; realm: string; region: string; classID: number; wclCanonicalCharacterId: number };
  target: { id: string; name: string; realm: string; region: string; classID: number; wclCanonicalCharacterId: number };
  sourceCluster: Array<{ id: string; name: string; realm: string; region: string; classID: number; wclCanonicalCharacterId: number }>;
  targetCluster: Array<{ id: string; name: string; realm: string; region: string; classID: number; wclCanonicalCharacterId: number }>;
  impact: {
    wclIdentityCount: number;
    appearanceCount: number;
    raidCount: number;
    guildCount: number;
    rankingCount: number;
    leaderboardCount: number;
    mechanicsCount: number;
    sharedReportCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  existingLink: { id: string; sourceCharacterId: string; targetCharacterId: string; createdBy: string; createdAt: string } | null;
}

export interface AdminCharactersResponse {
  characters: AdminCharacter[];
  pagination: AdminPagination;
}

export interface AdminCharacterStats {
  total: number;
  withRankings: number;
  recentlyActive: number;
}

export interface AdminOverview {
  users: {
    total: number;
    activeToday: number;
  };
  guilds: {
    total: number;
    updatedToday: number;
  };
}

// Pickems types
export type PickemType = "regular" | "rwf";

export interface ScoringConfig {
  exactMatch: number;
  offByOne: number;
  offByTwo: number;
  offByThree: number;
  offByFour: number;
  offByFiveOrMore: number;
}

export interface StreakConfig {
  enabled: boolean;
  minLength: number;
  bonusPerGuild: number;
}

export interface PrizeDistribution {
  place: number;
  percentage: number;
}

export interface PrizeConfig {
  enabled: boolean;
  goldPool: number;
  distribution: PrizeDistribution[];
  description: string;
}

export interface PickemSummary {
  id: string;
  name: string;
  type: PickemType;
  raidIds: number[];
  rankingsPending: boolean;
  guildCount: number;
  finalRankingsCount: number;
  scoreOutOfRangeGuilds: boolean;
  votingStart: string;
  votingEnd: string;
  isVotingOpen: boolean;
  hasEnded: boolean;
  scoringConfig?: ScoringConfig;
  streakConfig?: StreakConfig;
  prizeConfig?: PrizeConfig;
  finalized: boolean;
  finalRankings: string[];
  finalizedAt: string | null;
}

export interface PickemPrediction {
  guildName: string;
  realm: string;
  position: number;
}

export type GuestPickemImportStatus = "imported" | "already_exists" | "voting_closed";

export interface GuestPickemImportResult {
  status: GuestPickemImportStatus;
  message?: string;
}

export interface UserPickemEntry {
  pickemId: string;
  pickemName: string | null;
  type: string | null;
  predictions: PickemPrediction[];
  submittedAt: string;
  updatedAt: string;
}

export interface GuildRanking {
  rank: number;
  name: string;
  realm: string;
  bossesKilled?: number;
  totalBosses?: number;
  isComplete?: boolean;
  lastKillTime?: string | null;
}

export interface LeaderboardPrediction {
  guildName: string;
  realm: string;
  predictedRank: number;
  actualRank: number | null;
  points: number;
}

export interface StreakInfo {
  length: number;
  guilds: string[];
}

export interface LeaderboardEntry {
  username: string;
  avatarUrl: string;
  totalPoints: number;
  positionPoints?: number;
  streakBonus?: number;
  streaks?: StreakInfo[];
  predictions: LeaderboardPrediction[];
}

export interface PickemDetails {
  id: string;
  name: string;
  type: PickemType;
  raidIds: number[];
  rankingsPending: boolean;
  guildCount: number;
  finalRankingsCount: number;
  scoreOutOfRangeGuilds: boolean;
  votingStart: string;
  votingEnd: string;
  isVotingOpen: boolean;
  hasEnded: boolean;
  scoringConfig?: ScoringConfig;
  streakConfig?: StreakConfig;
  prizeConfig?: PrizeConfig;
  finalized: boolean;
  finalRankings: string[];
  finalizedAt: string | null;
  guildRankings: GuildRanking[];
  userPredictions: PickemPrediction[] | null;
  leaderboard: LeaderboardEntry[];
}

export interface SimpleGuild {
  name: string;
  realm: string;
}

// Admin Pickem types
export interface AdminPickem {
  _id: string;
  pickemId: string;
  name: string;
  type: PickemType;
  raidIds: number[];
  guildCount: number;
  finalRankingsCount: number;
  scoreOutOfRangeGuilds: boolean;
  votingStart: string;
  votingEnd: string;
  active: boolean;
  scoringConfig: ScoringConfig;
  streakConfig: StreakConfig;
  prizeConfig: PrizeConfig;
  finalized: boolean;
  finalRankings: string[];
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPickemStats {
  total: number;
  active: number;
  votingOpen: number;
  totalParticipants: number;
}

export interface AdminPickemsResponse {
  pickems: AdminPickem[];
  stats: AdminPickemStats;
}

export interface CreatePickemInput {
  pickemId: string;
  name: string;
  type?: PickemType;
  raidIds?: number[];
  guildCount?: number;
  finalRankingsCount?: number;
  scoreOutOfRangeGuilds?: boolean;
  votingStart: string;
  votingEnd: string;
  active?: boolean;
  scoringConfig?: Partial<ScoringConfig>;
  streakConfig?: Partial<StreakConfig>;
  prizeConfig?: Partial<PrizeConfig>;
}

export interface UpdatePickemInput {
  name?: string;
  type?: PickemType;
  raidIds?: number[];
  guildCount?: number;
  finalRankingsCount?: number;
  scoreOutOfRangeGuilds?: boolean;
  votingStart?: string;
  votingEnd?: string;
  active?: boolean;
  scoringConfig?: Partial<ScoringConfig>;
  streakConfig?: Partial<StreakConfig>;
  prizeConfig?: Partial<PrizeConfig>;
}

export type CharacterRankingRow = {
  rank: number;
  character: {
    wclCanonicalCharacterId: number;
    name: string;
    realm: string;
    region: string;
    classID: number;
    guild?: {
      name: string;
      realm: string;
    } | null;
  };
  context: {
    zoneId: number;
    difficulty: number;
    metric: "dps" | "hps";
    partition?: number;
    encounterId: number | null;
    specName?: string;
    bestSpecName?: string;
    role?: "dps" | "healer" | "tank";
    ilvl?: number;
  };
  encounter?: {
    id: number;
    name: string;
  };
  score: {
    type: "allStars" | "bestAmount" | "mechanics";
    value: number;
  };
  stats: {
    allStars?: { points: number; possiblePoints: number };
    bestAmount?: number;
    rankPercent?: number;
    medianPercent?: number;
    lockedIn?: boolean;
    totalKills?: number;
    mechanics?: {
      parseScore: number;
      survivalScore: number | null;
      pulls: number;
      deaths: number;
      survivedPulls: number;
      earlyDeaths: number;
      averageDeathPercent: number | null;
      deathDataAvailable: boolean;
    };
  };
  updatedAt?: string;
  bossScores?: Array<{
    encounterId: number;
    encounterName?: string;
    points?: number;
    rankPercent: number;
    specName?: string;
    score?: number;
    parseScore?: number;
    survivalScore?: number | null;
    pulls?: number;
    deaths?: number;
    survivedPulls?: number;
    earlyDeaths?: number;
    averageDeathPercent?: number | null;
    deathDataAvailable?: boolean;
  }>;
};

export type MythicPlusScoreBucket = "all" | "dps" | "healer" | "tank" | "spec_0" | "spec_1" | "spec_2" | "spec_3";

export type MythicPlusScores = {
  all: number;
  dps: number;
  healer: number;
  tank: number;
  spec_0: number;
  spec_1: number;
  spec_2: number;
  spec_3: number;
};

export type MythicPlusDungeonOption = {
  id: number;
  challengeModeId?: number | null;
  slug?: string | null;
  name: string;
  shortName?: string | null;
  iconUrl?: string | null;
};

export type MythicPlusSeasonOption = {
  slug: string;
  name: string;
  shortName?: string | null;
  expansionId?: number | null;
  dungeons: MythicPlusDungeonOption[];
};

export type MythicPlusOptionsResponse = {
  seasons: MythicPlusSeasonOption[];
  defaultSelection: {
    season: string | null;
  };
};

export type MythicPlusRunSummary = {
  dungeonId: number;
  challengeModeId?: number | null;
  dungeonName: string;
  dungeonShortName?: string | null;
  dungeonIconUrl?: string | null;
  mythicLevel: number;
  score: number;
  clearTimeMs?: number | null;
  parTimeMs?: number | null;
  completedAt?: string | null;
  url?: string | null;
};

export type MythicPlusLeaderboardRow = {
  rank: number;
  character: {
    id: string;
    wclCanonicalCharacterId: number;
    name: string;
    realm: string;
    region: string;
    classID: number;
    guild?: {
      name: string;
      realm: string;
    } | null;
  };
  season: string;
  score: {
    bucket: MythicPlusScoreBucket;
    value: number;
  };
  scores?: MythicPlusScores;
  bestSpec?: {
    name?: string | null;
    slug?: string | null;
    score: number;
  } | null;
  dungeon?: MythicPlusDungeonOption | null;
  run?: {
    keystoneRunId?: number | null;
    mythicLevel: number;
    score: number;
    clearTimeMs?: number | null;
    parTimeMs?: number | null;
    upgrades?: number | null;
    completedAt?: string | null;
    url?: string | null;
  } | null;
  dungeonRuns: MythicPlusRunSummary[];
  updatedAt?: string;
};

export type MythicPlusLeaderboardResponse = {
  data: MythicPlusLeaderboardRow[];
  pagination: {
    totalItems: number;
    totalRankedItems: number;
    totalPages: number;
    currentPage: number;
    pageSize: number;
  };
};

export type CharacterMythicPlusProfile = {
  seasons: Array<{
    season: string;
    seasonName: string;
    shortName?: string | null;
    expansionId?: number | null;
    scores: MythicPlusScores;
    bestSpec?: {
      name?: string | null;
      slug?: string | null;
      score: number;
    } | null;
    specScores: Array<{
      field: MythicPlusScoreBucket;
      specName?: string | null;
      specSlug?: string | null;
      role?: "dps" | "healer" | "tank" | null;
      score: number;
      color?: string | null;
    }>;
    dungeonRuns: MythicPlusRunSummary[];
    fetchedAt: string;
  }>;
};

export type GuildRaidCharacter = {
  wclCanonicalCharacterId: number | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reportCount: number;
};

export type GuildRaidCharactersResponse = {
  guild: {
    id: string;
    name: string;
    realm: string;
  };
  raid: {
    id: number;
    name: string;
  } | null;
  characters: GuildRaidCharacter[];
};

export type CharacterSearchResult = {
  wclCanonicalCharacterId: number | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  matchedName?: string;
  matchedRealm?: string;
  guild?: {
    name: string;
    realm: string;
  } | null;
  lastReportSeenAt?: string;
  lastMythicSeenAt?: string;
};

export type CharacterSearchResponse = {
  characters: CharacterSearchResult[];
};

export type GlobalSearchResult = {
  name: string;
  realm: string;
  type: "guild" | "character";
  href: string;
  classID?: number;
};

export type GlobalSearchResponse = {
  results: GlobalSearchResult[];
};

export type CharacterProfileResponse = {
  type: "profile";
  canonicalPath?: string | null;
  character: {
    wclCanonicalCharacterId: number | null;
    name: string;
    realm: string;
    region: string;
    classID: number;
    media: {
      avatarUrl: string | null;
    } | null;
    firstReportSeenAt?: string;
    lastReportSeenAt?: string;
    guildHistory: Array<{
      guildName: string;
      guildRealm: string;
      firstSeenAt: string;
      lastSeenAt: string;
    }>;
    nameHistory: Array<{
      name: string;
      realm: string;
      region: string;
      firstSeenAt: string;
      lastSeenAt: string;
      reportCount: number;
    }>;
    raidAchievements: CharacterRaidAchievementSummary | null;
    account?: {
      groupId: string;
      slug?: string | null;
      displayName?: string | null;
      signalVersion: string;
      generatedAt: string;
      totalReportCount: number;
      minScore: number;
      maxScore: number;
      avgScore: number;
      characters: Array<{
        characterId: string;
        name: string;
        realm: string;
        region: string;
        classID: number;
        guildName?: string | null;
        guildRealm?: string | null;
        lastSeenAt?: string | null;
        lastMythicSeenAt?: string | null;
        reportCount?: number;
        raidAchievements: CharacterRaidAchievementSummary | null;
      }>;
    };
  };
  raidTimeline: Array<{
    zoneId: number;
    raidName: string;
    guildId: string;
    guildName: string;
    guildRealm: string;
    characterName: string;
    characterRealm: string;
    characterRegion: string;
    firstSeenAt: string;
    lastSeenAt: string;
    reportCount: number;
  }>;
  rankings: Array<{
    zoneId: number;
    raidName: string;
    encounterId: number | null;
    encounterName: string | null;
    metric: string | null;
    role: string | null;
    specName: string | null;
    rankPercent: number | null;
    score: number;
    partition: number | null;
    updatedAt?: string;
  }>;
  mechanics: Array<{
    zoneId: number;
    raidName: string;
    encounterId: number | null;
    encounterName: string | null;
    metric: string | null;
    role: string | null;
    specName: string | null;
    rankPercent: number | null;
    score: number;
    parseScore: number | null;
    survivalScore: number | null;
    pulls: number;
    deaths: number;
    survivedPulls: number;
    earlyDeaths: number;
    averageDeathPercent: number | null;
    deathDataAvailable: boolean;
    updatedAt?: string;
  }>;
  mythicPlus: CharacterMythicPlusProfile;
};

export type CharacterProfileChoice = {
  wclCanonicalCharacterIds: number[];
  name: string;
  realm: string;
  region: string;
  classID: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  reportCount: number;
  guildCount: number;
  latestGuild?: {
    name: string;
    realm: string;
  } | null;
};

export type CharacterProfileChoicesResponse = {
  type: "choices";
  canonicalPath?: string | null;
  character: {
    name: string;
    realm: string;
  };
  choices: CharacterProfileChoice[];
};

export type CharacterProfileLookupResponse = CharacterProfileResponse | CharacterProfileChoicesResponse;

export type CcgMode = "current" | "legacy";
export type CcgBaseFinish = "standard" | "foil" | "golden" | "prismatic" | "holographic" | "negative";
export type CcgCustomFinish = "void" | "toxic";
export type CcgFinish = CcgBaseFinish | CcgCustomFinish;
export type CcgArtVariant = "standard" | "alternative";
export type CcgRegularTierGrade = "S" | "A" | "B" | "C" | "D" | "E" | "F";
export type CcgTierGrade = "H" | CcgRegularTierGrade;

export type CcgSet = {
  id: string;
  slug: string;
  zoneId: number;
  raidName: string;
  expansionName: string;
  state: "draft" | "current" | "legacy" | "locked";
  kind: "raid" | "community";
  enabledAt: string | null;
  themeKey: string;
  theme: { mark: string; accent: string; glow: string };
  customFinish: { key: CcgCustomFinish; hardPity: number } | null;
  backgroundPath: string;
  iconUrl?: string | null;
  packArtOffsetX: number;
  cardCount: number;
  ownedCards: number;
  publicationWave: number;
  lastPublishedAt: string | null;
};

export type CcgCardOwnership = { finish: CcgFinish; artVariant: CcgArtVariant; quantity: number };

export type CcgAlternativeArt = {
  characterArtFilename: string | null;
  characterArtPath: string | null;
  characterArtEnabled: boolean;
  backgroundArtFilename: string | null;
  backgroundArtPath: string | null;
  backgroundArtEnabled: boolean;
};

export type CcgQuip = {
  text: string | null;
  audioFilename: string | null;
  audioPath: string | null;
};

export type CcgCard = {
  id: string;
  characterId: string;
  setNumber: number;
  snapshotVersion: number;
  snapshotKey: string | null;
  name: string;
  realm: string;
  region: string;
  guildId: string | null;
  guildName: string | null;
  guildRealm: string | null;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  metric: "dps" | "hps";
  itemLevel: number;
  scores: { performance: number | null; mechanics: number | null; combined: number | null; mythicPlus: number | null };
  tierGrade: CcgTierGrade;
  avatarUrl: string | null;
  renderUrl: string | null;
  alternativeArt: CcgAlternativeArt | null;
  quip: CcgQuip | null;
  backgroundCrop: { x: number; y: number; scale: number };
  performanceSnapshotAt: string;
  mediaCapturedAt: string | null;
  publicationWave: number;
  publishedAt: string;
  set: CcgSet;
  seriesOwned?: boolean;
  snapshotOwned?: boolean;
  ownership?: CcgCardOwnership[];
  totalQuantity?: number;
  variants?: CcgCardVariant[];
};

export type CcgOverlayEvent = {
  eventId: string;
  leaseId: string;
  source: "redemption" | "test";
  viewer: { login: string; displayName: string };
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  tierGrade: CcgTierGrade;
  card: CcgCard;
};

export type CcgCollectionSort =
  | "duplicates_desc"
  | "rarity_desc"
  | "rarity_asc"
  | "quality_desc"
  | "quality_asc"
  | "alphabetical"
  | "reverse_alphabetical"
  | "damage_desc"
  | "damage_asc"
  | "mechanics_desc"
  | "mechanics_asc"
  | "combined_desc"
  | "combined_asc"
  | "mythic_plus_desc"
  | "mythic_plus_asc";

export type CcgCardVariant = {
  card: CcgCard;
  ownership: CcgCardOwnership[];
  totalQuantity: number;
};

export type CcgSession = {
  ownerType: "user" | "guest";
  dateKey: string;
  resetAt: string;
  packs: Record<CcgMode, { regularRemaining: number; bonusRemaining: number; totalRemaining: number }>;
  recharge: Record<CcgMode, { cap: number; intervalHours: number; nextAt: string }>;
  qualityProtection: Record<Exclude<CcgBaseFinish, "standard">, number>;
  customQualityProtection: Array<{
    setSlug: string;
    raidName: string;
    finish: CcgCustomFinish;
    counter: number;
    hardPity: number;
  }>;
  ownedFinishes: number;
};

export type CcgBootstrapResponse = {
  session: CcgSession;
  sets: CcgSet[];
};

export type CcgAnalytics = {
  uniqueUsers: number;
  packOpenings: number;
};

export type CcgLeaderboardShowcaseCard = {
  card: CcgCard;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
};

export type CcgLeaderboardEntry = {
  rank: number;
  username: string;
  avatarUrl: string;
  score: number;
  cardsOwned: number;
  snapshotsOwned: number;
  finishesOwned: number;
  premiumFinishesOwned: number;
  completedCards: number;
  completedSets: number;
  breakdown: {
    collection: number;
    rarity: number;
    finishes: number;
    completedCards: number;
    completedSets: number;
  };
  showcase: CcgLeaderboardShowcaseCard[];
};

export type CcgLeaderboardResponse = {
  scoreVersion: string;
  calculatedAt: string | null;
  refreshIntervalSeconds: number;
  scoring: {
    version: string;
    seriesBase: number;
    grades: Record<CcgTierGrade, number>;
    finishes: Record<CcgFinish, number>;
    allFinishesBonus: number;
    completeSetPerCard: number;
  };
  entries: CcgLeaderboardEntry[];
};

export type CcgLeaderboardMeResponse = {
  entry: CcgLeaderboardEntry | null;
  showcase: CcgLeaderboardShowcaseCard[];
};

export type CcgShowcaseCardInput = Pick<CcgLeaderboardShowcaseCard, "finish" | "artVariant"> & {
  cardId: string;
};

export type CcgRedeemReward =
  | { type: "packs"; currentPacks: number; legacyPacks: number }
  | { type: "card"; finish: CcgFinish; artVariant: CcgArtVariant; card: CcgCard };

export type CcgRedeemResult = {
  code: string;
  reward: CcgRedeemReward;
};

export type CcgOpening = {
  id: string;
  mode: CcgMode;
  targetSetId: string | null;
  sets: CcgSet[];
  allowanceSource: "daily" | "recharge" | "credit";
  duplicateRewards: number;
  createdAt: string;
  results: Array<{ position: number; finish: CcgFinish; artVariant: CcgArtVariant; isDuplicate: boolean; card: CcgCard }>;
  cacheUpdates?: {
    packs: CcgSession["packs"];
    qualityProtection: CcgSession["qualityProtection"];
    customQualityProtection: Array<{ setSlug: string; counter: number }>;
    ownedFinishesDelta: number;
    ownedCardsBySetDelta: Record<string, number>;
  };
};

export type CcgShareLink = {
  id: string;
  kind: "card" | "pack";
  path: string;
};

export type CcgShareAttribution = {
  username: string;
  avatarUrl: string;
};

export type CcgShare =
  | {
      id: string;
      kind: "card";
      createdAt: string;
      unboxedBy: CcgShareAttribution;
      card: { card: CcgCard; finish: CcgFinish; artVariant: CcgArtVariant };
    }
  | {
      id: string;
      kind: "pack";
      createdAt: string;
      unboxedBy: CcgShareAttribution;
      pack: CcgOpening;
    };

export type CcgActivityFilter = "all" | "packs" | "codes" | "twitch";

export type CcgActivityReward =
  | { type: "packs"; currentPacks: number; legacyPacks: number; currentPackArt: CcgActivityPackArt | null }
  | { type: "card"; finish: CcgFinish | null; artVariant: CcgArtVariant | null; card: CcgCard | null };

export type CcgActivityPackArt = Pick<
  CcgSet,
  "slug" | "raidName" | "theme" | "backgroundPath" | "packArtOffsetX"
>;

export type CcgActivityPackCard = {
  name: string;
  realm: string;
  classID: number;
  tierGrade: CcgTierGrade;
  finish: CcgFinish;
};

export type CcgActivityItem =
  | {
      id: string;
      kind: "pack";
      occurredAt: string;
      openingId: string;
      mode: CcgMode;
      packArt: CcgActivityPackArt | null;
      cards: CcgActivityPackCard[];
      newCards: number;
      duplicates: number;
      bonusPacks: number;
    }
  | {
      id: string;
      kind: "code";
      occurredAt: string;
      reward: CcgActivityReward;
    }
  | {
      id: string;
      kind: "twitch";
      occurredAt: string;
      broadcasterLogin: string;
      rewardTitle: string;
      reward: CcgActivityReward;
    };

export type CcgActivitySummary = {
  packsTotal: number;
  cardsTotal: number;
  uniqueCards: number;
  raidPacks: Array<{
    mode: CcgMode;
    count: number;
    packArt: CcgActivityPackArt | null;
  }>;
  finishes: Record<CcgFinish, number>;
};

export type CcgActivityResponse = {
  items: CcgActivityItem[];
  summary: CcgActivitySummary | null;
  nextCursor: string | null;
};

export type CcgCharacterCheckBlocker = "mythic_reports" | "mythic_pulls" | "scores" | "media";

export type CcgCharacterCheckResponse =
  | {
      found: false;
      query: { name: string; realm: string };
    }
  | {
      found: true;
      query: { name: string; realm: string };
      character: {
        id: string;
        name: string;
        realm: string;
        region: string;
        classID: number;
        guildName: string | null;
        avatarUrl: string | null;
        lastRaidedAt: string | null;
      };
      eligible: boolean;
      ready: boolean;
      media: {
        status: "untracked" | "pending" | "available" | "not_found" | "failed" | "render_missing";
        ready: boolean;
        lastErrorCode: string | null;
      };
      thresholds: {
        mythicReports: number;
        pulls: number;
      };
      raids: Array<{
        zoneId: number;
        raidName: string;
        state: "draft" | "current" | "legacy" | "locked";
        eligible: boolean;
        ready: boolean;
        hasCard: boolean;
        publicationEstimate: {
          snapshotTime: string;
          publicationTime: string;
          timeZone: string;
        } | null;
        blockers: CcgCharacterCheckBlocker[];
        mythicReports: number;
        pulls: number;
        scoresReady: boolean;
      }>;
      cards: Array<{
        id: string;
        characterId: string;
        setSlug: string;
        raidName: string;
        kind: "raid" | "community";
        state: "draft" | "current" | "legacy" | "locked";
        tierGrade: CcgTierGrade;
        snapshotCount: number;
        publishedAt: string;
      }>;
    };

export type CcgAdminSetStatus = {
  id: string | null;
  zoneId: number;
  slug: string;
  raidName: string;
  expansionName: string;
  targetMode: CcgMode;
  state: "draft" | "current" | "legacy" | "locked";
  availability: "candidate" | "enabled";
  enabledAt: string | null;
  enabledBy: string | null;
  cardCount: number;
  publicationWave: number;
  lastSnapshotAt: string | null;
  lastPublishedAt: string | null;
  backgroundPath: string;
  packArtOffsetX: number;
  theme: { mark: string; accent: string; glow: string };
};

export type CcgAdminSnapshotPreviewCounts = {
  eligibleCharacters: number;
  projectedSnapshots: number;
  newCharacters: number;
  rarityChanges: number;
  unchangedCharacters: number;
  blockedByMissingMedia: number;
  mediaReady: number;
  missingMedia: number;
};

export type CcgAdminSnapshotSetPreview = CcgAdminSnapshotPreviewCounts & {
  setId: string;
  zoneId: number;
  slug: string;
  raidName: string;
  mode: CcgMode;
  gradeDistribution: Record<CcgRegularTierGrade, number>;
  characters: Array<{
    characterId: string;
    name: string;
    realm: string;
    region: string;
    disposition: "new_character" | "rarity_change" | "blocked_new_character" | "blocked_rarity_change";
    previousTierGrade: CcgTierGrade | null;
    nextTierGrade: CcgRegularTierGrade;
    mediaStatus: "pending" | "available" | "not_found" | "failed" | "untracked" | "render_missing";
    attemptCount: number;
    nextAttemptAt: string | null;
    lastErrorCode: string | null;
    lastError: string | null;
  }>;
};

export type CcgAdminSnapshotPreview = {
  calculatedAt: string;
  sets: CcgAdminSnapshotSetPreview[];
  totals: CcgAdminSnapshotPreviewCounts;
};

export type CcgAdminReadinessBlocker = "eligible_population" | "media_ready" | "media_coverage" | "already_enabled";

export type CcgAdminRolloverPreview = {
  required: boolean;
  fromSets: Array<{ id: string; raidName: string; mythicPlusSeason: string }>;
  balanceOwners: { users: number; guests: number; total: number };
  storedCurrentPacks: { regular: number; bonus: number; total: number };
  newCurrentPacks: { users: number; guests: number; total: number };
};

export type CcgAdminSetReadiness = {
  configured: {
    zoneId: number;
    slug: string;
    raidName: string;
    expansionName: string;
  };
  setId: string | null;
  state: "draft" | "current" | "legacy" | "locked";
  enabledAt: string | null;
  targetMode: CcgMode;
  eligible: number;
  mediaReady: number;
  mediaCoverage: number;
  published: number;
  poolCards: number;
  activationRevision: string;
  rollover: CcgAdminRolloverPreview;
  readyToEnable: boolean;
  blockers: CcgAdminReadinessBlocker[];
  thresholds: { eligible: number; mediaReady: number; mediaCoverage: number };
  checkedAt: string;
};

export type CcgAdminMediaStatus = {
  processorRunning: boolean;
  discoveryRunning: boolean;
  queue: Record<string, number>;
  media: Record<string, number>;
  lastDiscovery: {
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    error: string | null;
    scanned: number | null;
    candidates: number | null;
    queued: number | null;
    eligibleCandidates: number | null;
    generalCandidates: number | null;
  } | null;
  recentFailures: Array<{ characterId: string; name: string; realm: string; status: string; error: string | null }>;
};

export type CcgAdminMediaDiscoveryResult = {
  scanned: number;
  candidates: number;
  queued: number;
  eligibleCandidates: number;
  generalCandidates: number;
  raidSets: Array<{ zoneId: number; raidName: string; candidates: number; queued: number }>;
};

export type CcgAdminStatusResponse = {
  sets: CcgAdminSetStatus[];
  excludedRaids: Array<{
    zoneId: number;
    raidName: string;
    slug: string;
    expansionName: string;
    availability: "excluded";
  }>;
  media: CcgAdminMediaStatus;
  totals: { cards: number; openings: number };
  community: { characters: CcgAdminCommunityCharacter[] };
  rollover: {
    sequence: number;
    effectiveAt: string;
    fromSetIds: string[];
    toSetId: string;
    pendingBalances: number;
  } | null;
};

export type CcgAdminAnalyticsRange = 7 | 30 | 90;

export type CcgAdminAnalyticsResponse = {
  rangeDays: CcgAdminAnalyticsRange;
  series: Array<{ date: string; packOpenings: number; activeUsers: number }>;
  totals: {
    packOpenings: number;
    cardsRevealed: number;
    activeUsersToday: number;
    averageDailyOpenings: number;
    modes: Record<CcgMode, number>;
  };
  qualities: Array<{ key: CcgFinish; count: number; rate: number }>;
  rarities: Array<{ key: CcgTierGrade; count: number; rate: number }>;
};

export type CcgAdminCommunityCharacter = {
  id: string;
  cardId: string | null;
  name: string;
  realm: string;
  realmSlug: string;
  region: string;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  guildName: string | null;
  guildRealm: string | null;
  tierGrade: CcgTierGrade;
  scores: { performance: number | null; mechanics: number | null; combined: number | null; mythicPlus: number | null };
  linkedCharacterId: string | null;
  avatarUrl: string | null;
  renderUrl: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CcgAdminCardSearchResponse = {
  search: string;
  cards: CcgCard[];
};

export type CcgAdminRedeemCode = {
  id: string;
  code: string;
  active: boolean;
  redemptionCount: number;
  createdAt: string;
  updatedAt: string;
  reward:
    | { type: "packs"; currentPacks: number; legacyPacks: number }
    | {
        type: "card";
        cardId: string | null;
        finish: CcgFinish | null;
        artVariant: CcgArtVariant | null;
        card: CcgCard | null;
      };
};

export type CcgAdminRedeemCodesResponse = {
  codes: CcgAdminRedeemCode[];
};

export type CcgAdminAlternativeArtResponse = {
  alternativeArt: CcgAlternativeArt | null;
  quip: CcgQuip | null;
  hasCommunityVariant: boolean;
};

export type CcgAdminEnableResponse = {
  readiness: CcgAdminSetReadiness;
  publication: { snapshotKey: string; published: number; unchanged: number; totalCards: number; poolVersion: string };
  movedToLegacy: number;
  rollover: { sequence: number; effectiveAt: string; fromSetIds: string[] } | null;
};

export type CcgCatalogResponse = {
  sets: CcgSet[];
  cards: CcgCard[];
  page: number;
  limit: number;
  total: number;
  pages: number;
};

export type CcgFeaturedCardResponse = {
  sets: CcgSet[];
  card: CcgCard | null;
};

export type CcgGuildFacet = {
  id: string;
  name: string;
  realm: string;
  setIds: string[];
};

export type CcgGuildsResponse = {
  guilds: CcgGuildFacet[];
};

export type CcgCharacterFacet = {
  id: string;
  name: string;
  realm: string;
  classID: number;
};

export type CcgCharacterSearchResponse = {
  search: string;
  characters: CcgCharacterFacet[];
};

export type CcgCollectionResponse = {
  sets: CcgSet[];
  cards: CcgCard[];
  page: number;
  limit: number;
  total: number;
  pages: number;
};

export type CharacterAccountResponse = {
  account: {
    id: string;
    slug: string;
    displayName: string;
    signalVersion: string;
    generatedAt: string;
    totalReportCount: number;
    characterCount: number;
    edgeCount: number;
    minScore: number;
    maxScore: number;
    avgScore: number;
    raidAchievements: CharacterRaidAchievementSummary | null;
  };
  characters: Array<{
    characterId: string;
    name: string;
    realm: string;
    region: string;
    classID: number;
    guildName?: string | null;
    guildRealm?: string | null;
    lastSeenAt?: string | null;
    lastMythicSeenAt?: string | null;
    reportCount: number;
    raidAchievements: CharacterRaidAchievementSummary | null;
  }>;
};

export type CharacterRaidReport = {
  code: string;
  url: string;
  startTime: number;
  endTime?: number;
  isOngoing: boolean;
  durationSeconds?: number;
  fightCount: number;
  kills: number;
  wipes: number;
};

export type CharacterRaidReportsResponse = {
  character: {
    wclCanonicalCharacterId: number | null;
    name: string;
    realm: string;
    region: string;
  };
  raid: {
    id: number;
    name: string;
  } | null;
  guild: {
    id: string;
    name: string;
    realm: string;
  };
  reports: CharacterRaidReport[];
};

export type Spec = {
  name: string;
  role: "dps" | "healer" | "tank";
};

export type ClassInfo = {
  id: number;
  name: string;
  iconUrl: string;
  specs: Spec[];
};

export type ColumnDef<T> = {
  id: string;
  header: ReactNode;
  accessor?: (row: T, index: number) => ReactNode;
  width?: string;
  /** When true the column shrinks to its content width and never wraps. */
  shrink?: boolean;
  /** Horizontal alignment of cell content. Defaults to "left". */
  align?: "left" | "center" | "right";
  sortable?: boolean;
  /** When true the column is hidden on mobile (below md breakpoint). */
  mobileHidden?: boolean;
};

// ============================================================================
// RAID ANALYTICS TYPES
// ============================================================================

// Pull count statistics (stripped - no guild references)
export interface AnalyticsPullStats {
  average: number;
  lowest: number;
  highest: number;
}

// Time spent statistics (stripped - no guild references)
export interface AnalyticsTimeStats {
  average: number; // in seconds
  lowest: number;
  highest: number;
}

// Kill progression entry (for cumulative charts) - legacy, kept for compatibility
export interface KillProgressionEntry {
  date: string;
  killCount: number;
}

// Clear progression entry (for cumulative charts) - legacy, kept for compatibility
export interface ClearProgressionEntry {
  date: string;
  clearCount: number;
}

// Guild entry for distribution bucket tooltips
export interface GuildDistributionEntry {
  name: string;
  realm: string;
  value?: number;
}

// Pre-calculated distribution bucket
export interface DistributionBucket {
  label: string;
  count: number;
  guilds: GuildDistributionEntry[];
}

// Pre-calculated distribution data
export interface Distribution {
  buckets: DistributionBucket[];
}

// Pre-calculated weekly progression entry
export interface WeeklyProgressionEntry {
  weekNumber: number;
  value: number;
  label: string; // "W1", "W2", etc.
}

// Boss analytics
export interface BossAnalytics {
  bossId: number;
  bossName: string;
  guildsKilled: number;
  guildsProgressing: number;
  pullCount: AnalyticsPullStats;
  timeSpent: AnalyticsTimeStats;
  pullDistribution?: Distribution;
  timeDistribution?: Distribution;
  weeklyProgression?: WeeklyProgressionEntry[];
}

// Overall raid analytics
export interface RaidOverallAnalytics {
  guildsCleared: number;
  guildsProgressing: number;
  pullCount: AnalyticsPullStats;
  timeSpent: AnalyticsTimeStats;
  progressRaidTimeSpent?: AnalyticsTimeStats;
  pullDistribution?: Distribution;
  timeDistribution?: Distribution;
  progressRaidTimeDistribution?: Distribution;
  weeklyProgression?: WeeklyProgressionEntry[];
}

// Full raid analytics response (stripped - no difficulty, _id, __v, etc.)
export interface RaidAnalytics {
  raidId: number;
  raidName: string;
  overall: RaidOverallAnalytics;
  bosses?: BossAnalytics[]; // Optional since /all endpoint doesn't include bosses
  raidStart?: string;
  raidEnd?: string;
  lastCalculated: string;
}

// Available raid for analytics
export interface RaidAnalyticsListItem {
  raidId: number;
  raidName: string;
  lastCalculated: string;
}

export interface RaidBossProgressionMilestone {
  key: string;
  type: "boss" | "clear";
  bossIndex?: number;
  bossId?: number;
  bossName: string;
  isFinalBoss?: boolean;
  guildsKilled: number;
  weeklyProgression: WeeklyProgressionEntry[];
}

export interface RaidBossProgressionComparisonRaid {
  raidId: number;
  raidName: string;
  raidStart?: string;
  raidEnd?: string;
  totalBosses: number;
  lastCalculated: string;
  milestones: RaidBossProgressionMilestone[];
}

export interface RaidBossProgressionComparison {
  generatedAt: string;
  raids: RaidBossProgressionComparisonRaid[];
}

// ============================================================================
// GUILD NETWORK TYPES
// ============================================================================

export interface GuildNetworkTier {
  id: number;
  name: string;
  expansion: string;
  start: string | null;
  end: string | null;
  participations: number;
}

export type GuildNetworkGuildTuple = [name: string, realmIdx: number];
export type GuildNetworkCharacterTuple = [name: string, realmIdx: number, classID: number, memberships: number[], aliases?: string[]];
export type GuildNetworkAccountTuple = [displayName: string, slug: string | null, characterIndexes: number[]];

export interface GuildNetworkUniverse {
  schemaVersion: number;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  rowCount: number;
  tiers: GuildNetworkTier[];
  realms: string[];
  guilds: GuildNetworkGuildTuple[];
  guildKeys?: string[];
  characters: GuildNetworkCharacterTuple[];
  accounts?: GuildNetworkAccountTuple[];
}

export interface GuildNetworkMeta {
  schemaVersion: number;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  rowCount: number;
  tierCount: number;
  guildCount: number;
  characterCount: number;
  byteLength: number;
  chunkCount: number;
  etag: string;
  movementReady: boolean;
}

export type GuildNetworkMovementGuildTuple = [key: string, name: string, realm: string];
export type GuildNetworkMovementCharacterTuple = [key: string, name: string, realm: string, classID: number, aliases?: string[]];
export type GuildNetworkMovementReportTuple = [
  code: string,
  startTime: number,
  endTime: number | null,
  guildIndex: number,
  characterIndexes: number[],
];

export interface GuildNetworkMovement {
  schemaVersion: number;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  rowCount: number;
  raid: {
    id: number;
    name: string;
    expansion: string;
    start: string | null;
    end: string | null;
  };
  guilds: GuildNetworkMovementGuildTuple[];
  characters: GuildNetworkMovementCharacterTuple[];
  accounts: GuildNetworkAccountTuple[];
  reports: GuildNetworkMovementReportTuple[];
}

// ============================================================
// RAID COMPARE TYPES
// ============================================================

export interface CompareBossInfo {
  id: number;
  name: string;
  iconUrl?: string;
}

export interface CompareGuildBossMetric {
  bossId: number;
  pulls: number;
  timeSpent: number;
  kills: number;
  firstKillTime?: string;
}

export interface CompareGuildMetric {
  id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  crest?: GuildCrest;
  parentGuild?: string;
  guildRank?: number;
  worldRank?: number;
  wclWorldRank?: number;
  rioWorldRank?: number;
  totalPulls: number;
  totalTimeSpent: number;
  totalCombatTimeSpent: number;
  progressRaidTimeSpent: number;
  bossesDefeated: number;
  totalBosses: number;
  bosses: CompareGuildBossMetric[];
}

export interface RaidCompare {
  raid: {
    id: number;
    name: string;
    iconUrl?: string;
    bosses: CompareBossInfo[];
  };
  difficulty: "mythic";
  guilds: CompareGuildMetric[];
  generatedAt: string;
}

// ============================================================
// RATE LIMIT & PROCESSING QUEUE TYPES
// ============================================================

export type ProcessingStatus = "pending" | "in_progress" | "completed" | "failed" | "paused";

export type ErrorType = "guild_not_found" | "rate_limited" | "network_error" | "api_error" | "database_error" | "unknown";

export interface RateLimitStatus {
  pointsUsed: number;
  pointsMax: number;
  pointsRemaining: number;
  percentUsed: number;
  resetAt: string;
  resetInSeconds: number;
  isNearLimit: boolean;
  isPaused: boolean;
  lastUpdated: string;
}

export interface RateLimitConfig {
  liveOperationsReserve: number;
  warningThreshold: number;
  pauseThreshold: number;
}

export interface RateLimitResponse {
  status: RateLimitStatus;
  config: RateLimitConfig;
}

export interface WarcraftLogsUserAuthStatus {
  enabled: boolean;
  connected: boolean;
  redirectUri: string;
  tokenExpiresAt?: string;
  connectedAt?: string;
  connectedByUsername?: string;
  wclUserId?: number;
  wclUserName?: string;
  scope?: string;
  lastRefreshAt?: string;
  lastRefreshError?: string;
  lastVerifiedAt?: string;
  lastVerifiedError?: string;
  deathEvents: {
    pending: number;
    failed: number;
    archived: number;
  };
}

export interface WarcraftLogsUserReportProbeResponse {
  success: boolean;
  report: {
    code: string;
    archiveStatus?: {
      isArchived: boolean;
      isAccessible: boolean;
      archiveDate?: number | null;
    };
  } | null;
  deathEventProbe: {
    fightsTested: number;
    eventCount: number | null;
  } | null;
}

export interface TwitchChatBotStatus {
  enabled: boolean;
  connected: boolean;
  redirectUri: string;
  scopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  tokenExpiresAt?: string;
  connectedAt?: string;
  connectedByUsername?: string;
  twitchUserId?: string;
  twitchLogin?: string;
  twitchDisplayName?: string;
  lastRefreshAt?: string;
  lastRefreshError?: string;
  lastVerifiedAt?: string;
  lastVerifiedError?: string;
  botEnabled: boolean;
  settings: TwitchBotSettings;
  chat: {
    running: boolean;
    connected: boolean;
    desiredChannels: string[];
    joinedChannels: string[];
    bannedChannels: Array<{
      channelName: string;
      reason: "msg_banned";
      detectedAt: string;
      lastAttemptAt: string;
      nextRetryAt: string;
      failureCount: number;
    }>;
    desiredCount: number;
    joinedCount: number;
    lastStartedAt?: string;
    lastStoppedAt?: string;
    lastConnectedAt?: string;
    lastDisconnectedAt?: string;
    lastReconciledAt?: string;
    lastMessageAt?: string;
    lastErrorAt?: string;
    lastError?: string;
  };
  deliveries: {
    pending: number;
    failed: number;
    expired: number;
    sent24h: number;
  };
}

export interface DeathEventsResetResponse {
  success: boolean;
  message: string;
  statuses: Array<"failed" | "archived">;
  modifiedCount: number;
  matchedCount: number;
  guildsMatched: number;
  queued: number;
  skipped: number;
}

export interface ErrorBreakdown {
  guild_not_found: number;
  rate_limited: number;
  network_error: number;
  api_error: number;
  database_error: number;
  unknown: number;
}

export interface QueueStatistics {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  paused: number;
  totalReportsFetched: number;
  totalFightsSaved: number;
  errorBreakdown?: ErrorBreakdown;
}

export interface ProcessorStatus {
  isRunning: boolean;
  isPaused: boolean;
  currentGuild: string | null;
}

export interface ProcessingQueueStatsResponse {
  processor: ProcessorStatus;
  queue: QueueStatistics;
}

export interface QueueItemProgress {
  percentComplete: number;
  reportsFetched: number;
  totalReportsEstimate: number;
  fightsSaved: number;
  currentPage: number;
}

export interface QueueItem {
  id: string;
  guildId: string;
  guildLogSourceId?: string;
  guildName: string;
  guildRealm: string;
  guildRegion: string;
  jobType: "full_rescan" | "rescan_deaths" | "rescan_characters" | "backfill_report_characters" | "recalculate_stats";
  status: ProcessingStatus;
  priority: number;
  progress: QueueItemProgress;
  errorCount: number;
  lastError?: string;
  errorType?: ErrorType;
  isPermanentError?: boolean;
  failureReason?: string;
  lastErrorAt?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivityAt: string;
}

export interface ProcessingQueueResponse {
  items: QueueItem[];
  pagination: AdminPagination;
}

export interface ProcessingQueueErrorItem {
  id: string;
  guildName: string;
  guildRealm: string;
  guildRegion: string;
  jobType: "full_rescan" | "rescan_deaths" | "rescan_characters" | "backfill_report_characters" | "recalculate_stats";
  status: ProcessingStatus;
  errorType?: ErrorType;
  isPermanentError?: boolean;
  failureReason?: string;
  lastError?: string;
  lastErrorAt?: string;
  errorCount: number;
}

export interface ProcessingQueueErrorsResponse {
  items: ProcessingQueueErrorItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================
// ADMIN TRIGGER & DETAIL TYPES
// ============================================================

// Admin Trigger Response
export interface TriggerResponse {
  success: boolean;
  message: string;
  currentTierOnly?: boolean;
}

export type MythicPlusCrawlerJobStatus = "pending" | "in_progress" | "completed" | "skipped" | "not_found" | "class_mismatch" | "rate_limited" | "failed";

export interface MythicPlusCrawlerJob {
  id: string;
  jobType: "profile" | "season_progress";
  characterId: string;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  season?: string | null;
  targetSeasons: string[];
  status: MythicPlusCrawlerJobStatus;
  attempts: number;
  maxAttempts: number;
  profileSeasonsWritten: number;
  detailJobsQueued: number;
  dungeonRunsWritten: number;
  completionReason?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MythicPlusCrawlerStatusResponse {
  processor: {
    isRunning: boolean;
    currentJob: MythicPlusCrawlerJob | null;
    lastMessage: string | null;
    requestsInWindow: number;
    maxRequestsPerHour: number;
  };
  queue: {
    pending: number;
    inProgress: number;
    completed: number;
    skipped: number;
    notFound: number;
    classMismatch: number;
    rateLimited: number;
    failed: number;
    total: number;
    terminal: number;
    profileSeasonsWritten: number;
    detailJobsQueued: number;
    dungeonRunsWritten: number;
  };
  recentFailures: MythicPlusCrawlerJob[];
  updatedAt: string;
}

export interface MythicPlusCrawlerTriggerResponse extends TriggerResponse {
  mode: "historical" | "current";
  started: boolean;
  static: {
    seasons: number;
    dungeons: number;
  };
  enqueue:
    | {
        candidates: number;
        queued: number;
        existing: number;
      }
    | {
        currentSeason: string | null;
        candidates: number;
        activeSince: string | null;
        profileStaleBefore: string | null;
        runStaleBefore: string | null;
        profileJobs: {
          candidates: number;
          queued: number;
          existing: number;
        };
        detailJobs: {
          candidates: number;
          queued: number;
        };
      };
  status: MythicPlusCrawlerStatusResponse;
}

export type CharacterRankingBackfillItemStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";

export interface CharacterRankingBackfillItem {
  id: string;
  characterId: string;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  zoneId: number;
  raidName?: string | null;
  status: CharacterRankingBackfillItemStatus;
  attempts: number;
  maxAttempts: number;
  aliasesQueried: number;
  specQuerySource?: "observed" | "fallback" | null;
  specsQueried: string[];
  rankingsWritten: number;
  leaderboardEntriesWritten: number;
  completionReason?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterRankingBackfillStatusResponse {
  processor: {
    isRunning: boolean;
    isWaitingForRateLimit: boolean;
    currentItem: CharacterRankingBackfillItem | null;
    lastMessage: string | null;
  };
  leaderboardRebuild: {
    isRunning: boolean;
    startedAt: string | null;
    completedAt: string | null;
    totalPairs: number;
    processedPairs: number;
    writtenEntries: number;
    lastMessage: string | null;
    lastError: string | null;
  };
  queue: {
    pending: number;
    inProgress: number;
    completed: number;
    skipped: number;
    failed: number;
    total: number;
    terminal: number;
    aliasesQueried: number;
    observedSpecItems: number;
    fallbackSpecItems: number;
    rankingsWritten: number;
    leaderboardEntriesWritten: number;
  };
  recentFailures: CharacterRankingBackfillItem[];
  updatedAt: string;
}

export interface CharacterRankingBackfillTriggerResponse extends TriggerResponse {
  started: boolean;
  enqueue: {
    candidates: number;
    queued: number;
    existing: number;
    updated: number;
    skippedWithoutCharacter: number;
    discoverySkipped: boolean;
  };
  status: CharacterRankingBackfillStatusResponse;
}

export interface CharacterRankingLeaderboardRebuildTriggerResponse extends TriggerResponse {
  started: boolean;
  status: CharacterRankingBackfillStatusResponse;
}

export interface CharacterRankingMythicEvidenceCleanupResponse extends TriggerResponse {
  invalidPairs: number;
  rankingsDeleted: number;
  leaderboardEntriesDeleted: number;
  backfillItemsDeleted: number;
}

export type CharacterAchievementBackfillItemStatus = "pending" | "in_progress" | "completed" | "not_found" | "skipped" | "failed";

export interface CharacterAchievementBackfillItem {
  id: string;
  characterId: string;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  signalVersion: string;
  status: CharacterAchievementBackfillItemStatus;
  attempts: number;
  maxAttempts: number;
  httpStatus?: number | null;
  errorCode?: string | null;
  isPermanentError: boolean;
  completionReason?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  nextAttemptAt: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterAchievementBackfillStatusResponse {
  processor: {
    isRunning: boolean;
    isWaitingForRateLimit: boolean;
    currentItem: CharacterAchievementBackfillItem | null;
    lastMessage: string | null;
    startedAt: string | null;
  };
  queue: {
    pending: number;
    inProgress: number;
    completed: number;
    notFound: number;
    skipped: number;
    failed: number;
    total: number;
    terminal: number;
  };
  fingerprints: number;
  tokens: number;
  matches: {
    high: number;
    medium: number;
    total: number;
  };
  groups: number;
  signalVersion: string;
  signalAchievementCount: number;
  raidAchievementSummaryVersion: string;
  raidAchievementTargetCount: number;
  raidAchievementSummaries: number;
  recentFailures: CharacterAchievementBackfillItem[];
  updatedAt: string;
}

export interface CharacterAchievementBackfillTriggerResponse extends TriggerResponse {
  started: boolean;
  enqueue: {
    candidates: number;
    queued: number;
    existing: number;
    updated: number;
    skippedWithFingerprint: number;
    skippedWithRaidAchievementSummary: number;
    missingRaidAchievementSummary: number;
  };
  status: CharacterAchievementBackfillStatusResponse;
}

export interface CharacterAccountGroupRebuildResponse extends TriggerResponse {
  groups: number;
  matchedCharacters: number;
  highConfidenceEdges: number;
  manualEdges: number;
}

export interface AdminRaidOption {
  id: number;
  name: string;
  isCurrent: boolean;
  isPrimary?: boolean;
  partitions: { id: number; name: string }[];
}

export interface AdminGuildLogSource {
  id: string;
  name: string;
  realm: string;
  region: string;
  warcraftlogsId?: number;
  isPrimary: boolean;
  syncPolicy: "active" | "historical";
  enabled: boolean;
  wclStatus: "active" | "not_found" | "unclaimed" | "unknown";
  wclStatusUpdatedAt?: string;
  wclNotFoundCount: number;
  initialFetchCompleted: boolean;
  lastFetched?: string;
  lastLogEndTime?: string;
  legacyGuildId?: string;
  reportCount: number;
  queueStatus: {
    id: string;
    status: ProcessingStatus;
    progress: QueueItemProgress;
    lastError?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  } | null;
}

export interface GuildLogSourceMigrationPreview {
  sourceGuild: { id: string; name: string; realm: string; region: string };
  targetGuild: { id: string; name: string; realm: string; region: string };
  counts: {
    reports: number;
    fights: number;
    appearances: number;
    participations: number;
    events: number;
    vodLinks: number;
    logSources: number;
    integrityMismatches: number;
  };
  blockers: string[];
  warnings: string[];
  canMigrate: boolean;
  confirmationText: string;
}

export interface GuildLogSourceMigrationResponse {
  success: boolean;
  message: string;
  result: {
    sourceGuildId: string;
    targetGuildId: string;
    sourceId: string;
    moved: { reports: number; fights: number; appearances: number; vodLinks: number; logSources: number };
    warnings: string[];
  };
  postProcessing: {
    statisticsRecalculated: boolean;
    statisticsRecalculationQueued: boolean;
    derivedDataRebuildStarted: boolean;
    derivedDataRefreshScheduled: boolean;
    warnings: string[];
  };
}

// Detailed Guild Info for Admin
export interface AdminGuildDetail {
  id: string;
  name: string;
  realm: string;
  region: string;
  faction?: string;
  warcraftlogsId?: number;
  horseRaceUmaImage?: string;
  parentGuild?: string;
  streamers?: Array<{ channelName: string; adminManaged?: boolean; isLive?: boolean; isPlayingWoW?: boolean }>;
  isCurrentlyRaiding: boolean;
  activityStatus?: "active" | "inactive";
  lastFetched?: string;
  lastLogEndTime?: string;
  createdAt: string;
  updatedAt: string;
  wclStatus: "active" | "not_found" | "unclaimed" | "unknown";
  wclStatusUpdatedAt?: string;
  wclNotFoundCount: number;
  rioStatus?: "active" | "not_found" | "unknown";
  lastRioUpdate?: string;
  progress: Array<{
    raidId: number;
    raidName: string;
    difficulty: string;
    bossesDefeated: number;
    totalBosses: number;
  }>;
  excludedRaidIds: number[];
  reportCount: number;
  fightCount: number;
  logSources: AdminGuildLogSource[];
  queueStatus: {
    status: ProcessingStatus;
    progress: QueueItemProgress;
    errorCount: number;
    lastError?: string;
    errorType?: ErrorType;
    isPermanentError?: boolean;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  } | null;
}

// Verify Reports Response
export interface VerifyReportsResponse {
  guildName: string;
  storedReportCount: number;
  wclReportCount: number | null;
  wclSampleSize?: number;
  missingFromSample?: number;
  missingReportCodes?: string[];
  hasMorePages?: boolean;
  isComplete?: boolean;
  message: string;
  error?: string;
}

// Queue Rescan Response
export interface QueueRescanResponse {
  success: boolean;
  message: string;
  queueId?: string;
  status?: ProcessingStatus;
  error?: string;
}

// Create Guild Input
export interface CreateGuildInput {
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
  streamers?: string[];
}

// Create Guild Response
export interface CreateGuildResponse {
  success: boolean;
  message: string;
  guild: {
    id: string;
    name: string;
    realm: string;
    region: string;
    parentGuild?: string;
  };
  queueStatus: {
    id: string;
    status: ProcessingStatus;
  };
}

// Delete Guild Preview Response
export interface DeleteGuildPreviewResponse {
  guild: {
    id: string;
    name: string;
    realm: string;
    region: string;
  };
  willBeDeleted: {
    reports: number;
    fights: number;
    events: number;
    queueItem: number;
    tierListEntries: string;
  };
  warning: string;
}

// Delete Guild Response
export interface DeleteGuildResponse {
  success: boolean;
  message: string;
  deleted: {
    guild: {
      id: string;
      name: string;
      realm: string;
    };
    reports: number;
    fights: number;
    events: number;
    queueItems: number;
    tierListEntriesModified: number;
  };
}

// Update Guild Input
export interface UpdateGuildInput {
  parent_guild?: string | null;
  streamers?: string[];
  activityStatus?: "active" | "inactive";
  horseRaceUmaImage?: string | null;
}

// Toggle Guild Raid Exclusion Response
export interface ToggleGuildRaidExclusionResponse {
  success: boolean;
  guild: {
    id: string;
    name: string;
    realm: string;
  };
  excludedRaidIds: number[];
}

// Update Guild Response
export interface UpdateGuildResponse {
  success: boolean;
  guild: {
    id: string;
    name: string;
    realm: string;
    region: string;
    horseRaceUmaImage?: string;
    parent_guild?: string;
    streamers?: Array<{ channelName: string }>;
    activityStatus?: "active" | "inactive";
  };
}

// Delete Character Response
export interface DeleteCharacterResponse {
  success: boolean;
  message: string;
  deleted: {
    character: {
      id: string;
      name: string;
      realm: string;
    };
    rankings: number;
  };
}

export interface DeleteCharacterRankingsPreviewResponse {
  raid: { id: number; name: string };
  partition: { id: number; name: string };
  willBeDeleted: {
    rankings: number;
    leaderboardEntries: number;
    leaderboardAllPartitionsEntries: number;
  };
  totalDocuments: number;
  warning: string;
}

export interface DeleteCharacterRankingsResponse {
  success: boolean;
  message: string;
  deleted: {
    raid: { id: number; name: string };
    partition: { id: number; name: string };
    rankings: number;
    leaderboardEntries: number;
    leaderboardAllPartitionsEntries: number;
    total: number;
  };
}

// ============================================================
// TASK LOGS
// ============================================================

export type TaskLogStatus = "running" | "completed" | "failed";

export interface TaskLogEntry {
  _id: string;
  taskName: string;
  status: TaskLogStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskLogStats {
  running: number;
  completed: number;
  failed: number;
}

export interface TaskLogsResponse {
  logs: TaskLogEntry[];
}

export interface TaskLogsLatestResponse {
  tasks: TaskLogEntry[];
  stats: TaskLogStats;
}

// ============================================================
// ADMIN REPORT MANAGEMENT TYPES
// ============================================================

export interface AdminReportFightsByDifficulty {
  [difficulty: string]: { total: number; kills: number };
}

export interface AdminReport {
  id: string;
  code: string;
  startTime: number;
  endTime?: number;
  fightCount: number;
  fightsByDifficulty: AdminReportFightsByDifficulty;
  sourceGuildSnapshot?: { name?: string; realm?: string; region?: string; warcraftlogsId?: number };
  importSource?: "manual_admin";
  manualImportedAt?: string;
  createdAt: string;
  lastProcessed: string;
}

export interface AdminReportRaidGroup {
  zoneId: number;
  raidName: string;
  reports: AdminReport[];
}

export interface AdminGuildReportsResponse {
  guildName: string;
  guildId: string;
  raids: AdminReportRaidGroup[];
  totalReports: number;
}

export interface AdminDeleteReportResponse {
  success: boolean;
  message: string;
  deletedFights: number;
  reportCode: string;
}

export interface AdminImportReportResponse {
  success: boolean;
  message: string;
  guildId: string;
  guildName: string;
  reportId: string;
  reportCode: string;
  alreadyImported: boolean;
  totalFightCount: number;
  trackedFightCount: number;
  affectedRaidIds: number[];
}
