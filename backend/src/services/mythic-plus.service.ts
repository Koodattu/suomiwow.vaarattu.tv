import fetch from "node-fetch";
import mongoose from "mongoose";
import { CLASSES, getSpecRole } from "../config/classes";
import { MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY } from "../config/character-eligibility";
import {
  MYTHIC_PLUS_ROLE_BUCKETS,
  MYTHIC_PLUS_SCORE_BUCKETS,
  MythicPlusScoreBucket,
  RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SET,
  RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS,
  RAIDER_IO_MYTHIC_PLUS_EXPANSION_IDS,
} from "../config/mythic-plus";
import { RAIDER_IO_SPEC_FIELDS, RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID, RaiderIoSpecField } from "../config/raiderio-specs";
import Character from "../models/Character";
import CharacterMythicPlusDungeonRun from "../models/CharacterMythicPlusDungeonRun";
import CharacterMythicPlusFetchJob, {
  CharacterMythicPlusFetchJobStatus,
  ICharacterMythicPlusFetchJob,
} from "../models/CharacterMythicPlusFetchJob";
import CharacterMythicPlusSeasonScore, { IMythicPlusScores } from "../models/CharacterMythicPlusSeasonScore";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import MythicPlusDungeon from "../models/MythicPlusDungeon";
import MythicPlusSeason from "../models/MythicPlusSeason";
import { getMissingMythicPlusSeasons, resolveMythicPlusSeasonRows } from "../utils/mythic-plus";
import logger from "../utils/logger";
import { normalizeRealmSlug } from "../utils/realm";
import cacheService from "./cache.service";
import taskTracker from "./task-tracker.service";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;
const RAIDER_IO_API_BASE_URL = "https://raider.io/api/v1";
const RAIDER_IO_SITE_API_BASE_URL = "https://raider.io/api";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const PROCESS_LOG_INTERVAL = 25;
const DEFAULT_NIGHTLY_CURRENT_SEASON_LIMIT = Math.max(25, Number(process.env.RAIDER_IO_MPLUS_NIGHTLY_CHARACTER_LIMIT || 750));
const DEFAULT_NIGHTLY_ACTIVE_DAYS = Math.max(1, Number(process.env.RAIDER_IO_MPLUS_NIGHTLY_ACTIVE_DAYS || 21));
const DEFAULT_NIGHTLY_PROFILE_STALE_HOURS = Math.max(1, Number(process.env.RAIDER_IO_MPLUS_NIGHTLY_PROFILE_STALE_HOURS || 24));
const DEFAULT_NIGHTLY_RUN_STALE_HOURS = Math.max(1, Number(process.env.RAIDER_IO_MPLUS_NIGHTLY_RUN_STALE_HOURS || 18));
const DEFAULT_NIGHTLY_HISTORICAL_REPAIR_LIMIT = Math.max(25, Number(process.env.RAIDER_IO_MPLUS_NIGHTLY_REPAIR_LIMIT || 750));

type RaiderIoHttpResult =
  | {
      ok: true;
      status: number;
      data: any;
    }
  | {
      ok: false;
      status: number | null;
      error: string;
      retryable: boolean;
    };

type CharacterIdentity = {
  _id: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  guildName?: string | null;
  guildRealm?: string | null;
  lastMythicSeenAt?: Date | null;
};

type EnqueueProfileJobsOptions = {
  limit?: number;
  refresh?: boolean;
  characterIds?: string[];
  targetSeasons?: string[];
  fetchSeasonProgress?: boolean;
};

export type BucketContext = {
  bucketType: "overall" | "role" | "spec";
  role: "dps" | "healer" | "tank" | null;
  specName: string | null;
  specSlug: string | null;
  blizzardSpecId: number | null;
  blizzardSpecIndex: number | null;
};

export type MythicPlusLeaderboardMode = "season" | "dungeon";
export type MythicPlusDungeonSort = "score" | "level";

export interface MythicPlusOptionsResponse {
  seasons: Array<{
    slug: string;
    name: string;
    shortName?: string | null;
    expansionId?: number | null;
    dungeons: Array<{
      id: number;
      challengeModeId?: number | null;
      slug?: string | null;
      name: string;
      shortName?: string | null;
      iconUrl?: string | null;
    }>;
  }>;
  defaultSelection: {
    season: string | null;
  };
}

export interface MythicPlusLeaderboardResponse {
  data: Array<{
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
    scores?: IMythicPlusScores;
    bestSpec?: {
      name?: string | null;
      slug?: string | null;
      score: number;
    } | null;
    dungeon?: {
      id: number;
      challengeModeId?: number | null;
      name: string;
      shortName?: string | null;
      iconUrl?: string | null;
    } | null;
    run?: {
      keystoneRunId?: number | null;
      mythicLevel: number;
      score: number;
      clearTimeMs?: number | null;
      parTimeMs?: number | null;
      upgrades?: number | null;
      completedAt?: Date | null;
      url?: string | null;
    } | null;
    dungeonRuns: Array<{
      dungeonId: number;
      challengeModeId?: number | null;
      dungeonName: string;
      dungeonShortName?: string | null;
      dungeonIconUrl?: string | null;
      mythicLevel: number;
      score: number;
      clearTimeMs?: number | null;
      parTimeMs?: number | null;
      completedAt?: Date | null;
      url?: string | null;
    }>;
    updatedAt?: Date;
  }>;
  pagination: {
    totalItems: number;
    totalRankedItems: number;
    totalPages: number;
    currentPage: number;
    pageSize: number;
  };
}

export interface CharacterMythicPlusProfileResponse {
  seasons: Array<{
    season: string;
    seasonName: string;
    shortName?: string | null;
    expansionId?: number | null;
    scores: IMythicPlusScores;
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
    dungeonRuns: Array<{
      dungeonId: number;
      challengeModeId?: number | null;
      dungeonName: string;
      dungeonShortName?: string | null;
      dungeonIconUrl?: string | null;
      mythicLevel: number;
      score: number;
      clearTimeMs?: number | null;
      parTimeMs?: number | null;
      completedAt?: Date | null;
      url?: string | null;
    }>;
    fetchedAt: Date;
  }>;
}

export interface MythicPlusCrawlerStatusResponse {
  processor: {
    isRunning: boolean;
    currentJob: ReturnType<MythicPlusService["summarizeJob"]> | null;
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
  recentFailures: Array<ReturnType<MythicPlusService["summarizeJob"]>>;
  updatedAt: Date;
}

function normalizeClassName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNullableDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return null;
  return date;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPartialRegex(value?: string): RegExp | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return new RegExp(escapeRegex(trimmed), "i");
}

function getScoreSegmentColor(segments: Record<string, any>, bucket: MythicPlusScoreBucket): string | null {
  const segment = segments?.[bucket];
  return typeof segment?.color === "string" ? segment.color : null;
}

function getRunZoneId(run: any): number {
  return toFiniteNumber(run?.zoneId ?? run?.zone_id, 0);
}

function getRunId(run: any): number | null {
  const value = toFiniteNumber(run?.keystoneRunId ?? run?.keystone_run_id ?? run?.id, 0);
  return value > 0 ? value : null;
}

function extractAffixes(compactRun: any, rawRun: any): number[] {
  const affixes = Array.isArray(compactRun?.affixes) ? compactRun.affixes : [];
  const compactIds = affixes
    .map((affix: any) => toFiniteNumber(typeof affix === "object" ? affix?.id : affix, 0))
    .filter((id: number) => id > 0);

  if (compactIds.length > 0) return compactIds;

  return [rawRun?.affix_0_id, rawRun?.affix_1_id, rawRun?.affix_2_id, rawRun?.affix_3_id].map((value) => toFiniteNumber(value, 0)).filter((id) => id > 0);
}

function compareRuns(a: any, b: any): number {
  const levelDiff = toFiniteNumber(b.mythicLevel ?? b.mythic_level) - toFiniteNumber(a.mythicLevel ?? a.mythic_level);
  if (levelDiff !== 0) return levelDiff;

  const scoreDiff = toFiniteNumber(b.score) - toFiniteNumber(a.score);
  if (scoreDiff !== 0) return scoreDiff;

  const clearA = toFiniteNumber(a.clearTimeMs ?? a.clear_time_ms, Number.MAX_SAFE_INTEGER);
  const clearB = toFiniteNumber(b.clearTimeMs ?? b.clear_time_ms, Number.MAX_SAFE_INTEGER);
  return clearA - clearB;
}

function redactRaiderIoSecrets(value: string): string {
  return value.replace(/([?&]access_key=)[^&\s]+/gi, "$1[redacted]");
}

class MythicPlusService {
  private readonly apiKey = process.env.RAIDER_IO_API_KEY || "";
  private readonly maxRequestsPerHour = Math.max(60, Number(process.env.RAIDER_IO_MPLUS_MAX_REQUESTS_PER_HOUR || 900));
  private requestTimestamps: number[] = [];
  private isRunning = false;
  private currentJob: ReturnType<MythicPlusService["summarizeJob"]> | null = null;
  private lastMessage: string | null = null;

  private async getEligibleCharacterIds(characterIds?: mongoose.Types.ObjectId[]): Promise<mongoose.Types.ObjectId[]> {
    if (characterIds && characterIds.length === 0) return [];

    const filter: Record<string, unknown> = {
      characterId: characterIds ? { $in: characterIds } : { $ne: null },
      reportCount: { $gte: MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY },
    };
    const eligibleIds = await CharacterRaidParticipation.distinct("characterId", filter);
    return eligibleIds.filter((id): id is mongoose.Types.ObjectId => id instanceof mongoose.Types.ObjectId);
  }

  private async isCharacterEligible(characterId: mongoose.Types.ObjectId): Promise<boolean> {
    return Boolean(
      await CharacterRaidParticipation.exists({
        characterId,
        reportCount: { $gte: MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY },
      }),
    );
  }

  private async waitForRateLimit(): Promise<void> {
    const oneHourAgo = Date.now() - 3600 * 1000;
    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > oneHourAgo);

    if (this.requestTimestamps.length >= this.maxRequestsPerHour) {
      const waitMs = this.requestTimestamps[0] + 3600 * 1000 - Date.now() + 250;
      this.lastMessage = `Waiting ${Math.ceil(waitMs / 1000)}s for Raider.IO M+ rate limit`;
      logger.warn(`[MythicPlus] ${this.lastMessage}`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 1000)));
      const nowOneHourAgo = Date.now() - 3600 * 1000;
      this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > nowOneHourAgo);
    }

    this.requestTimestamps.push(Date.now());
  }

  private async fetchJson(url: string, label: string): Promise<RaiderIoHttpResult> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.waitForRateLimit();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(url, { signal: controller.signal as any });
        clearTimeout(timeoutId);

        if (response.status === 429) {
          return {
            ok: false,
            status: response.status,
            error: `Raider.IO rate limited ${label}`,
            retryable: true,
          };
        }

        if (response.status >= 500 && attempt < 3) {
          const delay = 1500 * Math.pow(2, attempt - 1);
          logger.warn(`[MythicPlus] Raider.IO ${response.status} for ${label}; retrying in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return {
            ok: false,
            status: response.status,
            error: redactRaiderIoSecrets(text.slice(0, 500) || response.statusText),
            retryable: response.status >= 500,
          };
        }

        return {
          ok: true,
          status: response.status,
          data: await response.json(),
        };
      } catch (error: any) {
        const retryable = error?.name === "AbortError" || error?.code === "ETIMEDOUT" || error?.code === "ECONNRESET";
        if (retryable && attempt < 3) {
          const delay = 1500 * Math.pow(2, attempt - 1);
          logger.warn(`[MythicPlus] Network error for ${label}; retrying in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return {
          ok: false,
          status: null,
          error: `Raider.IO network error for ${label}: ${error?.name === "AbortError" ? "request timed out" : String(error?.code || error?.name || "request failed")}`,
          retryable,
        };
      }
    }

    return {
      ok: false,
      status: null,
      error: `Raider.IO request failed after retries: ${label}`,
      retryable: true,
    };
  }

  private buildAccessKeyParams(params: URLSearchParams): URLSearchParams {
    if (this.apiKey) params.set("access_key", this.apiKey);
    return params;
  }

  private getClassSpecMap(classID: number) {
    const localClass = CLASSES.find((entry) => entry.id === classID);
    if (!localClass) return null;

    return Object.values(RAIDER_IO_SPEC_SLOTS_BY_BLIZZARD_CLASS_ID).find((entry) => normalizeClassName(entry.className) === normalizeClassName(localClass.name)) ?? null;
  }

  private isProfileClassMatch(profileClassName: unknown, classID: number): boolean {
    if (typeof profileClassName !== "string" || !profileClassName.trim()) return true;
    const localClassName = CLASSES.find((entry) => entry.id === classID)?.name;
    if (!localClassName) return false;
    return normalizeClassName(profileClassName) === normalizeClassName(localClassName);
  }

  getBucketContext(classID: number, bucket: MythicPlusScoreBucket): BucketContext {
    if (bucket === "all") {
      return {
        bucketType: "overall",
        role: null,
        specName: null,
        specSlug: null,
        blizzardSpecId: null,
        blizzardSpecIndex: null,
      };
    }

    if (MYTHIC_PLUS_ROLE_BUCKETS.has(bucket)) {
      return {
        bucketType: "role",
        role: bucket as "dps" | "healer" | "tank",
        specName: null,
        specSlug: null,
        blizzardSpecId: null,
        blizzardSpecIndex: null,
      };
    }

    const spec = this.getClassSpecMap(classID)?.specs[bucket as RaiderIoSpecField] ?? null;
    const specSlug = spec?.specSlug ?? null;
    return {
      bucketType: "spec",
      role: specSlug ? getSpecRole(classID, specSlug) : null,
      specName: spec?.specName ?? null,
      specSlug,
      blizzardSpecId: spec?.blizzardSpecId ?? null,
      blizzardSpecIndex: spec?.blizzardSpecIndex ?? null,
    };
  }

  private getSpecBucketForClass(classID: number | undefined, specSlug: string | undefined): MythicPlusScoreBucket | null {
    if (!classID || !specSlug) return null;
    const specMap = this.getClassSpecMap(classID);
    if (!specMap) return null;
    for (const field of RAIDER_IO_SPEC_FIELDS) {
      if (specMap.specs[field]?.specSlug === specSlug) return field;
    }
    return null;
  }

  private normalizeScores(value: any): IMythicPlusScores {
    return {
      all: toFiniteNumber(value?.all),
      dps: toFiniteNumber(value?.dps),
      healer: toFiniteNumber(value?.healer),
      tank: toFiniteNumber(value?.tank),
      spec_0: toFiniteNumber(value?.spec_0),
      spec_1: toFiniteNumber(value?.spec_1),
      spec_2: toFiniteNumber(value?.spec_2),
      spec_3: toFiniteNumber(value?.spec_3),
    };
  }

  mapSpecScores(classID: number, scores: IMythicPlusScores, segments: Record<string, any>) {
    const specMap = this.getClassSpecMap(classID);
    if (!specMap) return [];

    return RAIDER_IO_SPEC_FIELDS.map((field) => {
      const spec = specMap.specs[field];
      const specSlug = spec?.specSlug ?? null;
      return {
        field,
        blizzardSpecId: spec?.blizzardSpecId ?? null,
        blizzardSpecIndex: spec?.blizzardSpecIndex ?? null,
        specName: spec?.specName ?? null,
        specSlug,
        role: specSlug ? getSpecRole(classID, specSlug) : null,
        score: scores[field],
        color: getScoreSegmentColor(segments, field),
      };
    }).filter((entry) => entry.specName || entry.score > 0);
  }

  summarizeJob(job: ICharacterMythicPlusFetchJob | any) {
    return {
      id: String(job._id),
      jobType: job.jobType,
      characterId: String(job.characterId),
      wclCanonicalCharacterId: job.wclCanonicalCharacterId,
      name: job.name,
      realm: job.realm,
      region: job.region,
      classID: job.classID,
      season: job.season ?? null,
      targetSeasons: Array.isArray(job.targetSeasons) ? job.targetSeasons : [],
      fetchSeasonProgress: job.fetchSeasonProgress !== false,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      profileSeasonsWritten: job.profileSeasonsWritten,
      detailJobsQueued: job.detailJobsQueued,
      dungeonRunsWritten: job.dungeonRunsWritten,
      completionReason: job.completionReason,
      lastError: job.lastError,
      lastErrorAt: job.lastErrorAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      lastActivityAt: job.lastActivityAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async syncStaticData(options: { includeAllSeasons?: boolean } = {}): Promise<{ seasons: number; dungeons: number }> {
    let seasonCount = 0;
    let dungeonCount = 0;
    const configuredOrder = new Map<string, number>(RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS.map((slug, index) => [slug, index + 1]));

    for (const expansionId of RAIDER_IO_MYTHIC_PLUS_EXPANSION_IDS) {
      const params = this.buildAccessKeyParams(new URLSearchParams({ expansion_id: String(expansionId) }));
      const url = `${RAIDER_IO_API_BASE_URL}/mythic-plus/static-data?${params.toString()}`;
      const result = await this.fetchJson(url, `mythic-plus/static-data expansion ${expansionId}`);

      if (!result.ok) {
        logger.warn(`[MythicPlus] Failed to fetch static data for expansion ${expansionId}: ${result.error}`);
        continue;
      }

      const seasons = Array.isArray(result.data?.seasons) ? result.data.seasons : [];
      const topLevelDungeons = Array.isArray(result.data?.dungeons) ? result.data.dungeons : [];
      const seasonDungeons = seasons.flatMap((season: any) => (Array.isArray(season?.dungeons) ? season.dungeons : []));
      const dungeonById = new Map<number, any>();
      for (const dungeon of [...topLevelDungeons, ...seasonDungeons]) {
        const dungeonId = toFiniteNumber(dungeon?.id, 0);
        if (dungeonId > 0) dungeonById.set(dungeonId, dungeon);
      }
      const dungeons = [...dungeonById.values()];

      const seasonOperations = seasons
        .filter((season: any) => typeof season?.slug === "string")
        .filter((season: any) => options.includeAllSeasons || RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SET.has(season.slug))
        .map((season: any, index: number) => {
          const configured = configuredOrder.get(season.slug);
          return {
            updateOne: {
              filter: { slug: season.slug },
              update: {
                $set: {
                  slug: season.slug,
                  name: season.name || season.short_name || season.slug,
                  shortName: season.short_name ?? season.shortName ?? null,
                  expansionId,
                  order: configured ?? 10000 + expansionId * 100 + index,
                  isMainSeason: RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SET.has(season.slug),
                  starts: season.starts ?? season.start ?? null,
                  ends: season.ends ?? season.end ?? null,
                  raw: season,
                },
              },
              upsert: true,
            },
          };
        });

      if (seasonOperations.length > 0) {
        await MythicPlusSeason.bulkWrite(seasonOperations, { ordered: false });
        seasonCount += seasonOperations.length;
      }

      const dungeonOperations = dungeons
        .filter((dungeon: any) => toFiniteNumber(dungeon?.id, 0) > 0)
        .map((dungeon: any) => ({
          updateOne: {
            filter: { raiderIoDungeonId: toFiniteNumber(dungeon.id) },
            update: {
              $set: {
                raiderIoDungeonId: toFiniteNumber(dungeon.id),
                challengeModeId: toFiniteNumber(dungeon.challenge_mode_id, 0) || null,
                expansionId,
                slug: dungeon.slug || `dungeon-${dungeon.id}`,
                name: dungeon.name || `Dungeon ${dungeon.id}`,
                shortName: dungeon.short_name ?? null,
                timerSeconds: toFiniteNumber(dungeon.keystone_timer_seconds, 0) || null,
                iconUrl: dungeon.icon_url ?? null,
                backgroundImageUrl: dungeon.background_image_url ?? null,
                raw: dungeon,
              },
            },
            upsert: true,
          },
        }));

      if (dungeonOperations.length > 0) {
        await MythicPlusDungeon.bulkWrite(dungeonOperations, { ordered: false });
        dungeonCount += dungeonOperations.length;
      }
    }

    await cacheService.invalidatePattern(/^mythic-plus:/);
    return { seasons: seasonCount, dungeons: dungeonCount };
  }

  async getMainSeasonSlugs(): Promise<string[]> {
    const seasons = await MythicPlusSeason.find({ isMainSeason: true }).select("slug order -_id").sort({ order: 1 }).lean();
    if (seasons.length > 0) return seasons.map((season) => season.slug);
    return [...RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS];
  }

  async getCurrentSeasonSlug(): Promise<string | null> {
    const seasons = await this.getMainSeasonSlugs();
    return seasons[0] ?? null;
  }

  async fetchCharacterProfileScores(character: Pick<CharacterIdentity, "name" | "realm" | "region">, seasons: string[]): Promise<RaiderIoHttpResult> {
    const fields = `mythic_plus_scores_by_season:${seasons.join(":")}`;
    const params = this.buildAccessKeyParams(
      new URLSearchParams({
        region: character.region.toLowerCase(),
        realm: normalizeRealmSlug(character.realm),
        name: character.name,
        fields,
      }),
    );
    const url = `${RAIDER_IO_API_BASE_URL}/characters/profile?${params.toString()}`;
    return this.fetchJson(url, `characters/profile ${character.region}/${character.realm}/${character.name}`);
  }

  async fetchCharacterSeasonProgress(character: Pick<CharacterIdentity, "name" | "realm" | "region">, season: string): Promise<RaiderIoHttpResult> {
    const region = encodeURIComponent(character.region.toLowerCase());
    const realm = encodeURIComponent(normalizeRealmSlug(character.realm));
    const name = encodeURIComponent(character.name);
    const url = `${RAIDER_IO_SITE_API_BASE_URL}/characters/${region}/${realm}/${name}/mythic-plus-progress?season=${encodeURIComponent(season)}`;
    return this.fetchJson(url, `mythic-plus-progress ${character.region}/${character.realm}/${character.name} ${season}`);
  }

  async upsertCharacterProfileScores(
    character: CharacterIdentity,
    profile: any,
    requestedSeasons: string[],
  ): Promise<{ written: number; nonZeroSeasons: string[] }> {
    const rows = Array.isArray(profile?.mythic_plus_scores_by_season) ? profile.mythic_plus_scores_by_season : [];
    const fetchedAt = new Date();
    const rioLastCrawledAt = toNullableDate(profile?.last_crawled_at);
    const { mythic_plus_scores_by_season: _scoresBySeason, ...rawProfileMeta } = profile || {};
    const operations: any[] = [];
    const nonZeroSeasons: string[] = [];

    resolveMythicPlusSeasonRows(requestedSeasons, rows).forEach(({ season, row }) => {
      if (!row) return;

      const scores = this.normalizeScores(row?.scores);
      const segments = row?.segments && typeof row.segments === "object" ? row.segments : {};
      const specScores = this.mapSpecScores(character.classID, scores, segments);
      const bestSpec = specScores.filter((entry) => entry.specName).sort((a, b) => b.score - a.score)[0] ?? null;

      if (scores.all > 0) nonZeroSeasons.push(season);

      operations.push({
        replaceOne: {
          filter: { characterId: character._id, season },
          replacement: {
            characterId: character._id,
            wclCanonicalCharacterId: character.wclCanonicalCharacterId,
            name: character.name,
            realm: character.realm,
            region: character.region,
            classID: character.classID,
            guildName: character.guildName ?? null,
            guildRealm: character.guildRealm ?? null,
            season,
            scoreStatus: scores.all > 0 ? "available" : "no_score",
            scores,
            segments,
            specScores,
            bestSpecField: bestSpec?.field ?? null,
            bestSpecName: bestSpec?.specName ?? null,
            bestSpecSlug: bestSpec?.specSlug ?? null,
            bestSpecScore: bestSpec?.score ?? 0,
            sourceClassName: typeof profile?.class === "string" ? profile.class : null,
            activeSpecName: typeof profile?.active_spec_name === "string" ? profile.active_spec_name : null,
            activeSpecRole: typeof profile?.active_spec_role === "string" ? profile.active_spec_role : null,
            profileUrl: typeof profile?.profile_url === "string" ? profile.profile_url : null,
            rioLastCrawledAt,
            fetchedAt,
            rawProfileMeta,
            rawSeason: row,
          },
          upsert: true,
        },
      });
    });

    if (operations.length > 0) {
      await CharacterMythicPlusSeasonScore.bulkWrite(operations, { ordered: false });
      await Promise.all([cacheService.invalidatePattern(/^mythic-plus:/), cacheService.invalidatePattern(/^characters:profile:/)]);
    }

    return {
      written: operations.length,
      nonZeroSeasons,
    };
  }

  private async getDungeonMap(): Promise<Map<number, any>> {
    const dungeons = await MythicPlusDungeon.find({}).lean();
    return new Map(dungeons.map((dungeon: any) => [dungeon.raiderIoDungeonId, dungeon]));
  }

  async upsertCharacterSeasonProgress(character: CharacterIdentity, season: string, progressPayload: any): Promise<number> {
    const progress = progressPayload?.characterMythicPlusProgress ?? progressPayload;
    const scoreBuckets = progress?.mythicPlusScores && typeof progress.mythicPlusScores === "object" ? progress.mythicPlusScores : {};
    const dungeonById = await this.getDungeonMap();
    const fetchedAt = new Date();
    const operations: any[] = [];
    const processedDungeonIdsByBucket = new Map<MythicPlusScoreBucket, Set<number>>();

    for (const bucket of MYTHIC_PLUS_SCORE_BUCKETS) {
      const bucketData = scoreBuckets[bucket];
      if (!bucketData || typeof bucketData !== "object") continue;

      const compactRuns = Array.isArray(bucketData.runs) ? bucketData.runs : [];
      const rawRuns = Array.isArray(bucketData.rawRuns) ? bucketData.rawRuns : [];
      const compactById = new Map<number, any>();

      for (const compactRun of compactRuns) {
        const id = getRunId(compactRun);
        if (id) compactById.set(id, compactRun);
      }

      const candidates = rawRuns.length > 0 ? rawRuns : compactRuns;
      const bestByDungeon = new Map<number, { compactRun: any; rawRun: any; combined: any }>();

      for (const run of candidates) {
        const rawRun = rawRuns.length > 0 ? run : {};
        const runId = getRunId(run);
        const compactRun = runId ? (compactById.get(runId) ?? run) : run;
        const zoneId = getRunZoneId(rawRun) || getRunZoneId(compactRun);
        if (zoneId <= 0) continue;

        const combined = {
          ...rawRun,
          ...compactRun,
          zoneId,
          mythicLevel: toFiniteNumber(compactRun?.mythicLevel ?? rawRun?.mythic_level),
          score: toFiniteNumber(compactRun?.score ?? rawRun?.bnet_mythic_rating),
          clearTimeMs: toFiniteNumber(compactRun?.clearTimeMs ?? rawRun?.clear_time_ms, 0) || null,
        };
        const existing = bestByDungeon.get(zoneId);
        if (!existing || compareRuns(combined, existing.combined) < 0) {
          bestByDungeon.set(zoneId, { compactRun, rawRun, combined });
        }
      }

      const bucketContext = this.getBucketContext(character.classID, bucket);
      const processedDungeonIds = new Set<number>();

      for (const [zoneId, { compactRun, rawRun, combined }] of bestByDungeon.entries()) {
        const dungeon = dungeonById.get(zoneId);
        const keystoneRunId = getRunId(compactRun) ?? getRunId(rawRun);
        const completedAt = toNullableDate(compactRun?.completedAt ?? compactRun?.completed_at ?? rawRun?.completed_at);
        const dungeonSlug = dungeon?.slug ?? null;
        const url = typeof compactRun?.url === "string" ? compactRun.url : null;
        processedDungeonIds.add(zoneId);

        operations.push({
          replaceOne: {
            filter: {
              characterId: character._id,
              season,
              bucket,
              raiderIoDungeonId: zoneId,
            },
            replacement: {
              characterId: character._id,
              wclCanonicalCharacterId: character.wclCanonicalCharacterId,
              name: character.name,
              realm: character.realm,
              region: character.region,
              classID: character.classID,
              guildName: character.guildName ?? null,
              guildRealm: character.guildRealm ?? null,
              season,
              bucket,
              bucketType: bucketContext.bucketType,
              role: bucketContext.role,
              specName: bucketContext.specName,
              specSlug: bucketContext.specSlug,
              blizzardSpecId: bucketContext.blizzardSpecId,
              blizzardSpecIndex: bucketContext.blizzardSpecIndex,
              raiderIoDungeonId: zoneId,
              challengeModeId: dungeon?.challengeModeId ?? (toFiniteNumber(compactRun?.map_challenge_mode_id, 0) || null),
              dungeonSlug,
              dungeonName: dungeon?.name ?? compactRun?.dungeon ?? `Dungeon ${zoneId}`,
              dungeonShortName: dungeon?.shortName ?? compactRun?.short_name ?? null,
              dungeonIconUrl: dungeon?.iconUrl ?? compactRun?.icon_url ?? null,
              dungeonBackgroundImageUrl: dungeon?.backgroundImageUrl ?? compactRun?.background_image_url ?? null,
              keystoneRunId,
              mythicLevel: toFiniteNumber(combined.mythicLevel),
              score: toFiniteNumber(combined.score),
              clearTimeMs: combined.clearTimeMs,
              parTimeMs: toFiniteNumber(compactRun?.parTimeMs ?? rawRun?.par_time_ms, 0) || null,
              upgrades: toFiniteNumber(compactRun?.upgrades, -1) >= 0 ? toFiniteNumber(compactRun.upgrades) : null,
              period: toFiniteNumber(compactRun?.period ?? rawRun?.period, 0) || null,
              affixes: extractAffixes(compactRun, rawRun),
              completedAt,
              loggedRunId: toFiniteNumber(compactRun?.loggedRunId ?? rawRun?.logged_run_id, 0) || null,
              url,
              fetchedAt,
              rawRun: compactRun ?? {},
              rawFullRun: rawRun ?? {},
            },
            upsert: true,
          },
        });
      }

      processedDungeonIdsByBucket.set(bucket, processedDungeonIds);
    }

    if (operations.length > 0) {
      await CharacterMythicPlusDungeonRun.bulkWrite(operations, { ordered: false });
    }

    for (const [bucket, dungeonIds] of processedDungeonIdsByBucket.entries()) {
      await CharacterMythicPlusDungeonRun.deleteMany({
        characterId: character._id,
        season,
        bucket,
        raiderIoDungeonId: { $nin: [...dungeonIds] },
      });
    }

    if (operations.length > 0 || processedDungeonIdsByBucket.size > 0) {
      await Promise.all([cacheService.invalidatePattern(/^mythic-plus:/), cacheService.invalidatePattern(/^characters:profile:/)]);
    }

    return operations.length;
  }

  async enqueueProfileJobs(options: EnqueueProfileJobsOptions = {}) {
    const limit = options.limit && options.limit > 0 ? options.limit : 0;
    const targetSeasons = Array.from(new Set((options.targetSeasons ?? []).filter((season) => typeof season === "string" && season.trim()).map((season) => season.trim())));
    const fetchSeasonProgress = options.fetchSeasonProgress !== false;
    let requestedCharacterIds: mongoose.Types.ObjectId[] | undefined;
    if (options.characterIds?.length) {
      requestedCharacterIds = options.characterIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
    }
    const eligibleCharacterIds = await this.getEligibleCharacterIds(requestedCharacterIds);
    const characterFilter: any = {
      _id: { $in: eligibleCharacterIds },
      wclProfileHidden: { $ne: true },
    };

    const query = Character.find(characterFilter)
      .select("_id wclCanonicalCharacterId name realm region classID guildName guildRealm lastMythicSeenAt")
      .sort({ lastMythicSeenAt: -1, lastReportSeenAt: -1, updatedAt: -1 });
    if (limit > 0) query.limit(limit);

    const cursor = query.lean<CharacterIdentity[]>().cursor();
    const operations: any[] = [];
    let candidates = 0;
    let queued = 0;
    let existing = 0;

    for await (const character of cursor) {
      candidates += 1;
      const priority = character.lastMythicSeenAt ? 10 : 30;
      operations.push({
        updateOne: {
          filter: {
            characterId: character._id,
            jobType: "profile",
            season: null,
          },
          update: {
            $set: {
              characterId: character._id,
              wclCanonicalCharacterId: character.wclCanonicalCharacterId,
              name: character.name,
              realm: character.realm,
              region: character.region,
              classID: character.classID,
              guildName: character.guildName ?? null,
              guildRealm: character.guildRealm ?? null,
              targetSeasons,
              fetchSeasonProgress,
              priority,
              lastActivityAt: new Date(),
              ...(options.refresh
                ? {
                    status: "pending",
                    attempts: 0,
                    nextAttemptAt: new Date(),
                    httpStatus: null,
                    lastError: null,
                    lastErrorAt: null,
                    startedAt: null,
                    completedAt: null,
                    completionReason: null,
                  }
                : {}),
            },
            $setOnInsert: {
              jobType: "profile",
              season: null,
              maxAttempts: 3,
              profileSeasonsWritten: 0,
              detailJobsQueued: 0,
              dungeonRunsWritten: 0,
              ...(options.refresh
                ? {}
                : {
                    status: "pending",
                    attempts: 0,
                    nextAttemptAt: new Date(),
                  }),
            },
          },
          upsert: true,
        },
      });

      if (operations.length >= 1000) {
        const result = await CharacterMythicPlusFetchJob.bulkWrite(operations, { ordered: false });
        queued += result.upsertedCount ?? 0;
        existing += (result.matchedCount ?? 0) + (result.modifiedCount ?? 0);
        operations.length = 0;
      }
    }

    if (operations.length > 0) {
      const result = await CharacterMythicPlusFetchJob.bulkWrite(operations, { ordered: false });
      queued += result.upsertedCount ?? 0;
      existing += (result.matchedCount ?? 0) + (result.modifiedCount ?? 0);
    }

    return { candidates, queued, existing };
  }

  private async enqueueSeasonProgressJobs(character: CharacterIdentity, seasons: string[], refresh = false): Promise<number> {
    return this.enqueueSeasonProgressJobsForCharacters([character], seasons, refresh);
  }

  private async enqueueSeasonProgressJobsForCharacters(characters: CharacterIdentity[], seasons: string[], refresh = false): Promise<number> {
    if (characters.length === 0 || seasons.length === 0) return 0;

    const seasonOrder = new Map<string, number>(RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS.map((slug, index) => [slug, index]));
    const operations: any[] = characters.flatMap((character) =>
      seasons.map((season) => ({
        updateOne: {
          filter: {
            characterId: character._id,
            jobType: "season_progress",
            season,
          },
          update: {
            $set: {
              characterId: character._id,
              wclCanonicalCharacterId: character.wclCanonicalCharacterId,
              name: character.name,
              realm: character.realm,
              region: character.region,
              classID: character.classID,
              guildName: character.guildName ?? null,
              guildRealm: character.guildRealm ?? null,
              priority: 15 + (seasonOrder.get(season) ?? 100),
              lastActivityAt: new Date(),
              ...(refresh
                ? {
                    status: "pending",
                    attempts: 0,
                    nextAttemptAt: new Date(),
                    lastError: null,
                    lastErrorAt: null,
                    completedAt: null,
                    completionReason: null,
                  }
                : {}),
            },
            $setOnInsert: {
              jobType: "season_progress",
              season,
              targetSeasons: [],
              maxAttempts: 3,
              profileSeasonsWritten: 0,
              detailJobsQueued: 0,
              dungeonRunsWritten: 0,
              ...(refresh
                ? {}
                : {
                    status: "pending",
                    attempts: 0,
                    nextAttemptAt: new Date(),
                  }),
            },
          },
          upsert: true,
        },
      })),
    );

    if (operations.length === 0) return 0;
    const result = await CharacterMythicPlusFetchJob.bulkWrite(operations, { ordered: false });
    return (result.upsertedCount ?? 0) + (refresh ? (result.modifiedCount ?? 0) : 0);
  }

  async enqueueCurrentSeasonRefreshJobs(
    options: {
      characterLimit?: number;
      activeSinceDays?: number;
      profileStaleHours?: number;
      runStaleHours?: number;
    } = {},
  ) {
    const currentSeason = await this.getCurrentSeasonSlug();
    if (!currentSeason) {
      return {
        currentSeason: null,
        candidates: 0,
        activeSince: null,
        profileStaleBefore: null,
        runStaleBefore: null,
        profileJobs: { candidates: 0, queued: 0, existing: 0 },
        detailJobs: { candidates: 0, queued: 0 },
      };
    }

    const characterLimit = Math.min(Math.max(Math.floor(options.characterLimit ?? DEFAULT_NIGHTLY_CURRENT_SEASON_LIMIT), 1), 10000);
    const activeSinceDays = Math.max(1, options.activeSinceDays ?? DEFAULT_NIGHTLY_ACTIVE_DAYS);
    const profileStaleHours = Math.max(1, options.profileStaleHours ?? DEFAULT_NIGHTLY_PROFILE_STALE_HOURS);
    const runStaleHours = Math.max(1, options.runStaleHours ?? DEFAULT_NIGHTLY_RUN_STALE_HOURS);
    const activeSince = new Date(Date.now() - activeSinceDays * 24 * 60 * 60 * 1000);
    const profileStaleBefore = new Date(Date.now() - profileStaleHours * 60 * 60 * 1000);
    const runStaleBefore = new Date(Date.now() - runStaleHours * 60 * 60 * 1000);
    const eligibleCharacterIds = await this.getEligibleCharacterIds();

    const recentCharacters = await Character.find({
      _id: { $in: eligibleCharacterIds },
      wclProfileHidden: { $ne: true },
      lastMythicSeenAt: { $gte: activeSince },
    })
      .select("_id wclCanonicalCharacterId name realm region classID guildName guildRealm lastMythicSeenAt")
      .sort({ lastMythicSeenAt: -1, lastReportSeenAt: -1, updatedAt: -1 })
      .limit(characterLimit)
      .lean<CharacterIdentity[]>();

    if (recentCharacters.length === 0) {
      return {
        currentSeason,
        candidates: 0,
        activeSince,
        profileStaleBefore,
        runStaleBefore,
        profileJobs: { candidates: 0, queued: 0, existing: 0 },
        detailJobs: { candidates: 0, queued: 0 },
      };
    }

    const characterIds = recentCharacters.map((character) => character._id);
    const scoreRows = await CharacterMythicPlusSeasonScore.find({
      season: currentSeason,
      characterId: { $in: characterIds },
    })
      .select("characterId scores fetchedAt")
      .lean();
    const scoreByCharacter = new Map(scoreRows.map((row: any) => [String(row.characterId), row]));
    const profileCandidateIds = recentCharacters
      .filter((character) => {
        const row = scoreByCharacter.get(String(character._id));
        if (!row) return true;
        const fetchedAt = toNullableDate(row.fetchedAt);
        return !fetchedAt || fetchedAt <= profileStaleBefore;
      })
      .map((character) => String(character._id));

    const profileJobs =
      profileCandidateIds.length > 0
        ? await this.enqueueProfileJobs({
            characterIds: profileCandidateIds,
            refresh: true,
            targetSeasons: [currentSeason],
          })
        : { candidates: 0, queued: 0, existing: 0 };

    const positiveCurrentSeasonCharacters = recentCharacters.filter((character) => toFiniteNumber(scoreByCharacter.get(String(character._id))?.scores?.all, 0) > 0);
    const positiveCharacterIds = positiveCurrentSeasonCharacters.map((character) => character._id);
    const runFreshness =
      positiveCharacterIds.length > 0
        ? await CharacterMythicPlusDungeonRun.aggregate<{ _id: mongoose.Types.ObjectId; latestFetchedAt?: Date | null; runCount: number }>([
            {
              $match: {
                season: currentSeason,
                bucket: "all",
                characterId: { $in: positiveCharacterIds },
              },
            },
            {
              $group: {
                _id: "$characterId",
                latestFetchedAt: { $max: "$fetchedAt" },
                runCount: { $sum: 1 },
              },
            },
          ])
        : [];
    const runFreshnessByCharacter = new Map(runFreshness.map((row) => [String(row._id), row]));
    const progressCharacters = positiveCurrentSeasonCharacters.filter((character) => {
      const row = runFreshnessByCharacter.get(String(character._id));
      const latestFetchedAt = toNullableDate(row?.latestFetchedAt);
      return !row || !latestFetchedAt || latestFetchedAt <= runStaleBefore;
    });
    const detailJobsQueued = await this.enqueueSeasonProgressJobsForCharacters(progressCharacters, [currentSeason], true);

    return {
      currentSeason,
      candidates: recentCharacters.length,
      activeSince,
      profileStaleBefore,
      runStaleBefore,
      profileJobs,
      detailJobs: {
        candidates: progressCharacters.length,
        queued: detailJobsQueued,
      },
    };
  }

  async enqueueHistoricalScoreRepairJobs(options: { limit?: number } = {}) {
    const mainSeasons = await this.getMainSeasonSlugs();
    const currentSeason = mainSeasons[0] ?? null;
    const historicalSeasons = mainSeasons.filter((season) => season !== currentSeason);
    const limit = Math.min(Math.max(Math.floor(options.limit ?? DEFAULT_NIGHTLY_HISTORICAL_REPAIR_LIMIT), 1), 10000);

    if (historicalSeasons.length === 0) {
      return { currentSeason, historicalSeasons, candidates: 0, queued: 0, missingSeasonPairs: 0 };
    }

    const eligibleCharacterIds = await this.getEligibleCharacterIds();
    const candidates = await Character.aggregate<
      CharacterIdentity & { storedSeasons: string[]; lastProfileJobAt?: Date | null }
    >([
      {
        $match: {
          _id: { $in: eligibleCharacterIds },
          wclProfileHidden: { $ne: true },
        },
      },
      {
        $lookup: {
          from: CharacterMythicPlusSeasonScore.collection.name,
          let: { characterId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$characterId", "$$characterId"] },
                    { $in: ["$season", historicalSeasons] },
                  ],
                },
              },
            },
            { $project: { _id: 0, season: 1 } },
          ],
          as: "historicalScores",
        },
      },
      { $set: { storedSeasons: "$historicalScores.season" } },
      {
        $match: {
          $expr: {
            $gt: [{ $size: { $setDifference: [historicalSeasons, "$storedSeasons"] } }, 0],
          },
        },
      },
      {
        $lookup: {
          from: CharacterMythicPlusFetchJob.collection.name,
          let: { characterId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$characterId", "$$characterId"] },
                    { $eq: ["$jobType", "profile"] },
                    { $eq: ["$season", null] },
                  ],
                },
              },
            },
            { $project: { _id: 0, updatedAt: 1 } },
          ],
          as: "profileJobs",
        },
      },
      { $set: { lastProfileJobAt: { $arrayElemAt: ["$profileJobs.updatedAt", 0] } } },
      { $sort: { lastProfileJobAt: 1, lastMythicSeenAt: -1, lastReportSeenAt: -1, updatedAt: -1, _id: 1 } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          wclCanonicalCharacterId: 1,
          name: 1,
          realm: 1,
          region: 1,
          classID: 1,
          guildName: 1,
          guildRealm: 1,
          lastMythicSeenAt: 1,
          storedSeasons: 1,
          lastProfileJobAt: 1,
        },
      },
    ]);

    const now = new Date();
    const operations: any[] = candidates.map((character) => {
      const targetSeasons = getMissingMythicPlusSeasons(historicalSeasons, character.storedSeasons ?? []);
      return {
        updateOne: {
          filter: { characterId: character._id, jobType: "profile", season: null },
          update: {
            $set: {
              characterId: character._id,
              wclCanonicalCharacterId: character.wclCanonicalCharacterId,
              name: character.name,
              realm: character.realm,
              region: character.region,
              classID: character.classID,
              guildName: character.guildName ?? null,
              guildRealm: character.guildRealm ?? null,
              targetSeasons,
              fetchSeasonProgress: false,
              priority: 20,
              status: "pending",
              attempts: 0,
              nextAttemptAt: now,
              httpStatus: null,
              lastError: null,
              lastErrorAt: null,
              startedAt: null,
              completedAt: null,
              completionReason: "Queued to repair missing historical season scores",
              lastActivityAt: now,
            },
            $setOnInsert: {
              jobType: "profile",
              season: null,
              maxAttempts: 3,
              profileSeasonsWritten: 0,
              detailJobsQueued: 0,
              dungeonRunsWritten: 0,
            },
          },
          upsert: true,
        },
      };
    });

    if (operations.length === 0) {
      return { currentSeason, historicalSeasons, candidates: 0, queued: 0, missingSeasonPairs: 0 };
    }

    const result = await CharacterMythicPlusFetchJob.bulkWrite(operations, { ordered: false });
    return {
      currentSeason,
      historicalSeasons,
      candidates: candidates.length,
      queued: (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0),
      missingSeasonPairs: candidates.reduce(
        (sum, character) => sum + getMissingMythicPlusSeasons(historicalSeasons, character.storedSeasons ?? []).length,
        0,
      ),
    };
  }

  async triggerHistoricalBackfill(options: { process?: boolean; maxJobs?: number; syncStatic?: boolean } = {}) {
    const staticResult = options.syncStatic === false ? { seasons: 0, dungeons: 0 } : await this.syncStaticData();
    const enqueue = await this.enqueueProfileJobs({ refresh: true, targetSeasons: [] });
    const started = options.process === false ? false : this.startProcessing({ maxJobs: options.maxJobs });
    return {
      mode: "historical" as const,
      started,
      static: staticResult,
      enqueue,
      status: await this.getStatus(),
    };
  }

  async triggerHistoricalScoreRepair(options: { process?: boolean; maxJobs?: number; limit?: number } = {}) {
    const enqueue = await this.enqueueHistoricalScoreRepairJobs({ limit: options.limit });
    const started = options.process === false || enqueue.queued === 0 ? false : this.startProcessing({ maxJobs: options.maxJobs });
    return {
      mode: "historical_repair" as const,
      started,
      enqueue,
      status: await this.getStatus(),
    };
  }

  async triggerCurrentSeasonCrawl(
    options: {
      process?: boolean;
      maxJobs?: number;
      syncStatic?: boolean;
      characterLimit?: number;
      activeSinceDays?: number;
      profileStaleHours?: number;
      runStaleHours?: number;
    } = {},
  ) {
    const staticResult = options.syncStatic === false ? { seasons: 0, dungeons: 0 } : await this.syncStaticData();
    const enqueue = await this.enqueueCurrentSeasonRefreshJobs(options);
    const hasCurrentSeasonWork =
      enqueue.currentSeason !== null && ((enqueue.profileJobs?.candidates ?? 0) > 0 || (enqueue.detailJobs?.candidates ?? 0) > 0 || (enqueue.profileJobs?.queued ?? 0) > 0 || (enqueue.detailJobs?.queued ?? 0) > 0);
    const started = options.process === false || !hasCurrentSeasonWork ? false : this.startProcessing({ maxJobs: options.maxJobs });
    return {
      mode: "current" as const,
      started,
      static: staticResult,
      enqueue,
      status: await this.getStatus(),
    };
  }

  async triggerCrawl(options: { limit?: number; refreshProfiles?: boolean; process?: boolean; maxJobs?: number; syncStatic?: boolean } = {}) {
    const staticResult = options.syncStatic === false ? { seasons: 0, dungeons: 0 } : await this.syncStaticData();
    const enqueue = await this.enqueueProfileJobs({ limit: options.limit, refresh: options.refreshProfiles, targetSeasons: [] });
    const started = options.process === false ? false : this.startProcessing({ maxJobs: options.maxJobs });
    return {
      mode: "historical" as const,
      started,
      static: staticResult,
      enqueue,
      status: await this.getStatus(),
    };
  }

  isProcessing(): boolean {
    return this.isRunning;
  }

  startProcessing(options: { maxJobs?: number } = {}): boolean {
    if (this.isRunning) return false;

    this.isRunning = true;
    this.lastMessage = "Mythic+ crawler started";
    void this.processLoop(options.maxJobs).catch((error) => {
      logger.error("[MythicPlus] Processor crashed:", error);
      this.isRunning = false;
      this.currentJob = null;
      this.lastMessage = `Processor crashed: ${error instanceof Error ? error.message : String(error)}`;
    });
    return true;
  }

  async processPendingJobs(options: { maxJobs?: number } = {}): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    try {
      return await this.processLoop(options.maxJobs);
    } finally {
      this.isRunning = false;
      this.currentJob = null;
    }
  }

  async resetInterruptedJobs(): Promise<number> {
    const result = await CharacterMythicPlusFetchJob.updateMany(
      { status: "in_progress" },
      {
        $set: {
          status: "pending",
          nextAttemptAt: new Date(),
          startedAt: null,
          lastActivityAt: new Date(),
          completionReason: "Reset after interrupted processor",
        },
      },
    );
    return result.modifiedCount ?? 0;
  }

  private async processLoop(maxJobs?: number): Promise<number> {
    const taskId = await taskTracker.start("Mythic+ Crawler", maxJobs ? { maxJobs } : undefined);
    let processed = 0;

    try {
      await this.resetInterruptedJobs();

      while (!maxJobs || processed < maxJobs) {
        const job = await this.claimNextJob();
        if (!job) break;

        this.currentJob = this.summarizeJob(job);
        try {
          await this.processJob(job);
        } catch (error) {
          await this.handleJobError(job, error);
        }

        processed += 1;
        if (processed % PROCESS_LOG_INTERVAL === 0) {
          logger.info(`[MythicPlus] Processed ${processed} crawler jobs`);
        }
      }

      await taskTracker.complete(taskId, { processed });
      return processed;
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.isRunning = false;
      this.currentJob = null;
      this.lastMessage = `Mythic+ crawler idle after ${processed} job(s)`;
    }
  }

  private async claimNextJob(): Promise<ICharacterMythicPlusFetchJob | null> {
    const now = new Date();
    return CharacterMythicPlusFetchJob.findOneAndUpdate(
      {
        status: { $in: ["pending", "rate_limited"] },
        nextAttemptAt: { $lte: now },
      },
      {
        $set: {
          status: "in_progress",
          startedAt: now,
          lastActivityAt: now,
        },
        $inc: { attempts: 1 },
      },
      {
        new: true,
        sort: { priority: 1, nextAttemptAt: 1, createdAt: 1 },
      },
    );
  }

  private jobCharacter(job: ICharacterMythicPlusFetchJob): CharacterIdentity {
    return {
      _id: job.characterId,
      wclCanonicalCharacterId: job.wclCanonicalCharacterId,
      name: job.name,
      realm: job.realm,
      region: job.region,
      classID: job.classID,
      guildName: job.guildName ?? null,
      guildRealm: job.guildRealm ?? null,
    };
  }

  private async getProfileJobSeasons(job: ICharacterMythicPlusFetchJob): Promise<string[]> {
    const targetSeasons = Array.isArray(job.targetSeasons)
      ? Array.from(new Set(job.targetSeasons.filter((season) => typeof season === "string" && season.trim()).map((season) => season.trim())))
      : [];
    if (targetSeasons.length > 0) return targetSeasons;
    return this.getMainSeasonSlugs();
  }

  private async processJob(job: ICharacterMythicPlusFetchJob): Promise<void> {
    if (!(await this.isCharacterEligible(job.characterId))) {
      await this.markJob(job, "skipped", {
        completionReason: `Requires at least ${MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY} Heroic/Mythic reports for the same guild and raid`,
      });
      return;
    }

    if (job.jobType === "profile") {
      await this.processProfileJob(job);
      return;
    }
    await this.processSeasonProgressJob(job);
  }

  private async processProfileJob(job: ICharacterMythicPlusFetchJob): Promise<void> {
    const character = this.jobCharacter(job);
    const seasons = await this.getProfileJobSeasons(job);
    const result = await this.fetchCharacterProfileScores(character, seasons);

    if (!result.ok) {
      await this.handleFetchFailure(job, result);
      return;
    }

    if (!this.isProfileClassMatch(result.data?.class, character.classID)) {
      await this.markJob(job, "class_mismatch", {
        completionReason: `Raider.IO returned ${result.data?.class || "unknown class"} for local class ${character.classID}`,
      });
      return;
    }

    const writeResult = await this.upsertCharacterProfileScores(character, result.data, seasons);
    const detailJobsQueued = job.fetchSeasonProgress === false ? 0 : await this.enqueueSeasonProgressJobs(character, writeResult.nonZeroSeasons, true);

    await this.markJob(job, "completed", {
      profileSeasonsWritten: writeResult.written,
      detailJobsQueued,
      completionReason:
        job.fetchSeasonProgress === false
          ? `Stored ${writeResult.written} season score(s); score-only repair`
          : `Stored ${writeResult.written} season score(s); queued ${detailJobsQueued} detail job(s)`,
    });
  }

  private async processSeasonProgressJob(job: ICharacterMythicPlusFetchJob): Promise<void> {
    const character = this.jobCharacter(job);
    const season = job.season;
    if (!season) {
      await this.markJob(job, "skipped", { completionReason: "Missing season on progress job" });
      return;
    }

    const result = await this.fetchCharacterSeasonProgress(character, season);
    if (!result.ok) {
      await this.handleFetchFailure(job, result);
      return;
    }

    const progress = result.data?.characterMythicPlusProgress ?? result.data;
    const allScore = toFiniteNumber(progress?.mythicPlusScores?.all?.score ?? progress?.bestMythicPlusScore, 0);
    if (allScore <= 0 && !progress?.mythicPlusScores?.all) {
      await this.markJob(job, "skipped", { completionReason: "No Mythic+ progress payload returned" });
      return;
    }

    const dungeonRunsWritten = await this.upsertCharacterSeasonProgress(character, season, result.data);
    await this.markJob(job, "completed", {
      dungeonRunsWritten,
      completionReason: `Stored ${dungeonRunsWritten} dungeon run row(s)`,
    });
  }

  private async handleFetchFailure(job: ICharacterMythicPlusFetchJob, result: Extract<RaiderIoHttpResult, { ok: false }>): Promise<void> {
    if (result.status === 404) {
      await this.markJob(job, "not_found", {
        httpStatus: result.status,
        completionReason: "Raider.IO character not found",
      });
      return;
    }

    if (result.status === 429) {
      await this.markJob(job, "rate_limited", {
        httpStatus: result.status,
        lastError: result.error,
        lastErrorAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
        completionReason: "Rate limited; retry scheduled",
      });
      return;
    }

    if (result.retryable && job.attempts < job.maxAttempts) {
      await this.markJob(job, "pending", {
        httpStatus: result.status,
        lastError: result.error,
        lastErrorAt: new Date(),
        nextAttemptAt: new Date(Date.now() + Math.min(60, job.attempts * 10) * 1000),
        completionReason: `Retry queued after attempt ${job.attempts}`,
      });
      return;
    }

    await this.markJob(job, "failed", {
      httpStatus: result.status,
      lastError: result.error,
      lastErrorAt: new Date(),
      completionReason: `Failed after ${job.attempts} attempt(s)`,
    });
  }

  private async handleJobError(job: ICharacterMythicPlusFetchJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempts < job.maxAttempts;
    await this.markJob(job, retry ? "pending" : "failed", {
      lastError: message.slice(0, 2000),
      lastErrorAt: new Date(),
      nextAttemptAt: retry ? new Date(Date.now() + Math.min(60, job.attempts * 10) * 1000) : job.nextAttemptAt,
      completionReason: retry ? `Retry queued after attempt ${job.attempts}` : `Failed after ${job.attempts} attempt(s)`,
    });
  }

  private async markJob(job: ICharacterMythicPlusFetchJob, status: CharacterMythicPlusFetchJobStatus, patch: Record<string, unknown> = {}): Promise<void> {
    const terminalStatuses = new Set<CharacterMythicPlusFetchJobStatus>(["completed", "skipped", "not_found", "class_mismatch", "failed"]);
    await CharacterMythicPlusFetchJob.findByIdAndUpdate(job._id, {
      $set: {
        status,
        lastActivityAt: new Date(),
        ...(terminalStatuses.has(status) ? { completedAt: new Date() } : {}),
        ...patch,
      },
    });
  }

  async getOptions(): Promise<MythicPlusOptionsResponse> {
    const eligibleCharacterIds = await this.getEligibleCharacterIds();
    const scoreSeasons = await CharacterMythicPlusSeasonScore.distinct("season", {
      characterId: { $in: eligibleCharacterIds },
      "scores.all": { $gt: 0 },
    });
    const runRows = await CharacterMythicPlusDungeonRun.aggregate<{ _id: { season: string; dungeonId: number } }>([
      { $match: { characterId: { $in: eligibleCharacterIds } } },
      {
        $group: {
          _id: {
            season: "$season",
            dungeonId: "$raiderIoDungeonId",
          },
        },
      },
    ]);

    const seasonsWithData = Array.from(new Set([...scoreSeasons, ...runRows.map((row) => row._id.season)].filter((value): value is string => typeof value === "string")));
    const seasonDocs = await MythicPlusSeason.find({ slug: { $in: seasonsWithData } }).select("slug name shortName expansionId order -_id").sort({ order: 1 }).lean();
    const seasonBySlug = new Map(seasonDocs.map((season) => [season.slug, season]));
    const seasonOrder = new Map<string, number>(RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS.map((slug, index) => [slug, index + 1]));
    const dungeonIds = Array.from(new Set(runRows.map((row) => row._id.dungeonId).filter((id) => typeof id === "number")));
    const dungeons = await MythicPlusDungeon.find({ raiderIoDungeonId: { $in: dungeonIds } })
      .select("raiderIoDungeonId challengeModeId slug name shortName iconUrl expansionId -_id")
      .lean();
    const dungeonById = new Map(dungeons.map((dungeon: any) => [dungeon.raiderIoDungeonId, dungeon]));

    const dungeonIdsBySeason = new Map<string, Set<number>>();
    for (const row of runRows) {
      const set = dungeonIdsBySeason.get(row._id.season) ?? new Set<number>();
      set.add(row._id.dungeonId);
      dungeonIdsBySeason.set(row._id.season, set);
    }

    const orderedSeasonSlugs = seasonsWithData.sort((a, b) => {
      const orderA = seasonBySlug.get(a)?.order ?? seasonOrder.get(a) ?? 99999;
      const orderB = seasonBySlug.get(b)?.order ?? seasonOrder.get(b) ?? 99999;
      return orderA - orderB || a.localeCompare(b);
    });

    const seasons = orderedSeasonSlugs.map((slug) => {
      const season = seasonBySlug.get(slug);
      const seasonDungeonIds = [...(dungeonIdsBySeason.get(slug) ?? new Set<number>())];
      const seasonDungeons = seasonDungeonIds
        .map((id) => dungeonById.get(id))
        .filter(Boolean)
        .sort((a: any, b: any) => (a.shortName || a.name).localeCompare(b.shortName || b.name))
        .map((dungeon: any) => ({
          id: dungeon.raiderIoDungeonId,
          challengeModeId: dungeon.challengeModeId ?? null,
          slug: dungeon.slug ?? null,
          name: dungeon.name,
          shortName: dungeon.shortName ?? null,
          iconUrl: dungeon.iconUrl ?? null,
        }));

      return {
        slug,
        name: season?.name ?? slug,
        shortName: season?.shortName ?? null,
        expansionId: season?.expansionId ?? null,
        dungeons: seasonDungeons,
      };
    });

    return {
      seasons,
      defaultSelection: {
        season: seasons[0]?.slug ?? null,
      },
    };
  }

  async getLeaderboard(options: {
    season?: string;
    bucket?: MythicPlusScoreBucket;
    dungeonId?: number;
    dungeonSort?: MythicPlusDungeonSort;
    classId?: number;
    specName?: string;
    role?: "dps" | "healer" | "tank";
    page?: number;
    limit?: number;
    characterName?: string;
    guildName?: string;
  }): Promise<MythicPlusLeaderboardResponse> {
    const season = options.season || (await this.getOptions()).defaultSelection.season;
    if (!season) {
      return {
        data: [],
        pagination: { totalItems: 0, totalRankedItems: 0, totalPages: 0, currentPage: 1, pageSize: DEFAULT_PAGE_SIZE },
      };
    }

    const bucket = options.bucket && MYTHIC_PLUS_SCORE_BUCKETS.includes(options.bucket) ? options.bucket : "all";
    const pageSize = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const currentPage = Math.max(options.page ?? 1, 1);
    const skip = (currentPage - 1) * pageSize;
    const eligibleCharacterIds = await this.getEligibleCharacterIds();
    if (eligibleCharacterIds.length === 0) {
      return {
        data: [],
        pagination: { totalItems: 0, totalRankedItems: 0, totalPages: 0, currentPage, pageSize },
      };
    }

    if (options.dungeonId && options.dungeonId > 0) {
      return this.getDungeonLeaderboard({ ...options, season, bucket, pageSize, currentPage, skip, eligibleCharacterIds });
    }

    return this.getSeasonLeaderboard({ ...options, season, bucket, pageSize, currentPage, skip, eligibleCharacterIds });
  }

  private async getSeasonLeaderboard(options: any): Promise<MythicPlusLeaderboardResponse> {
    const characterRegex = buildPartialRegex(options.characterName);
    const guildRegex = buildPartialRegex(options.guildName);
    const match: any = {
      season: options.season,
      characterId: { $in: options.eligibleCharacterIds },
    };
    if (options.classId !== undefined) match.classID = options.classId;
    if (options.role) match[`scores.${options.role}`] = { $gt: 0 };
    if (characterRegex) match.name = characterRegex;
    if (guildRegex) match.guildName = guildRegex;
    if (options.specName) match["specScores.specSlug"] = options.specName;

    const scoreExpression = options.specName
      ? {
          $let: {
            vars: {
              matchedSpec: {
                $first: {
                  $filter: {
                    input: "$specScores",
                    as: "spec",
                    cond: { $eq: ["$$spec.specSlug", options.specName] },
                  },
                },
              },
            },
            in: { $ifNull: ["$$matchedSpec.score", 0] },
          },
        }
      : `$scores.${options.bucket}`;

    const basePipeline: any[] = [{ $match: match }, { $addFields: { leaderboardScore: scoreExpression } }, { $match: { leaderboardScore: { $gt: 0 } } }];
    const [countRow] = await CharacterMythicPlusSeasonScore.aggregate([...basePipeline, { $count: "total" }]);
    const totalItems = countRow?.total ?? 0;
    const rows = await CharacterMythicPlusSeasonScore.aggregate([
      ...basePipeline,
      { $sort: { leaderboardScore: -1, name: 1 } },
      { $skip: options.skip },
      { $limit: options.pageSize },
    ]);

    const characterIds = rows.map((row: any) => row.characterId).filter(Boolean);
    const runBucket = options.specName ? (this.getSpecBucketForClass(options.classId, options.specName) ?? options.bucket) : options.bucket;
    const runs = characterIds.length
      ? await CharacterMythicPlusDungeonRun.find({
          season: options.season,
          bucket: runBucket,
          characterId: { $in: characterIds },
        })
          .sort({ dungeonName: 1 })
          .lean()
      : [];
    const runsByCharacter = this.groupRunsByCharacter(runs);

    return {
      data: rows.map((row: any, index: number) => this.toSeasonLeaderboardRow(row, options.bucket, runsByCharacter.get(String(row.characterId)) ?? [], options.skip + index + 1)),
      pagination: {
        totalItems,
        totalRankedItems: totalItems,
        totalPages: Math.ceil(totalItems / options.pageSize),
        currentPage: options.currentPage,
        pageSize: options.pageSize,
      },
    };
  }

  private async getDungeonLeaderboard(options: any): Promise<MythicPlusLeaderboardResponse> {
    const characterRegex = buildPartialRegex(options.characterName);
    const guildRegex = buildPartialRegex(options.guildName);
    const bucket = options.specName ? (this.getSpecBucketForClass(options.classId, options.specName) ?? options.bucket) : options.bucket;
    const match: any = {
      season: options.season,
      bucket,
      raiderIoDungeonId: options.dungeonId,
      characterId: { $in: options.eligibleCharacterIds },
    };
    if (options.classId !== undefined) match.classID = options.classId;
    if (options.specName) match.specSlug = options.specName;
    if (options.role) match.role = options.role;
    if (characterRegex) match.name = characterRegex;
    if (guildRegex) match.guildName = guildRegex;

    const totalItems = await CharacterMythicPlusDungeonRun.countDocuments(match);
    const sort: any = options.dungeonSort === "level" ? { mythicLevel: -1, clearTimeMs: 1, score: -1, name: 1 } : { score: -1, mythicLevel: -1, clearTimeMs: 1, name: 1 };
    const rows = await CharacterMythicPlusDungeonRun.find(match).sort(sort).skip(options.skip).limit(options.pageSize).lean();

    return {
      data: rows.map((row: any, index: number) => this.toDungeonLeaderboardRow(row, options.skip + index + 1)),
      pagination: {
        totalItems,
        totalRankedItems: totalItems,
        totalPages: Math.ceil(totalItems / options.pageSize),
        currentPage: options.currentPage,
        pageSize: options.pageSize,
      },
    };
  }

  private groupRunsByCharacter(runs: any[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();
    for (const run of runs) {
      const key = String(run.characterId);
      const list = grouped.get(key) ?? [];
      list.push(run);
      grouped.set(key, list);
    }
    return grouped;
  }

  private toGuild(row: any): { name: string; realm: string } | null {
    return row.guildName && row.guildRealm ? { name: row.guildName, realm: row.guildRealm } : null;
  }

  private toRunSummary(run: any) {
    return {
      dungeonId: run.raiderIoDungeonId,
      challengeModeId: run.challengeModeId ?? null,
      dungeonName: run.dungeonName,
      dungeonShortName: run.dungeonShortName ?? null,
      dungeonIconUrl: run.dungeonIconUrl ?? null,
      mythicLevel: run.mythicLevel ?? 0,
      score: run.score ?? 0,
      clearTimeMs: run.clearTimeMs ?? null,
      parTimeMs: run.parTimeMs ?? null,
      completedAt: run.completedAt ?? null,
      url: run.url ?? null,
    };
  }

  private toSeasonLeaderboardRow(row: any, bucket: MythicPlusScoreBucket, runs: any[], rank: number): MythicPlusLeaderboardResponse["data"][number] {
    return {
      rank,
      character: {
        id: String(row.characterId),
        wclCanonicalCharacterId: row.wclCanonicalCharacterId,
        name: row.name,
        realm: row.realm,
        region: row.region,
        classID: row.classID,
        guild: this.toGuild(row),
      },
      season: row.season,
      score: {
        bucket,
        value: row.leaderboardScore ?? row.scores?.[bucket] ?? 0,
      },
      scores: row.scores,
      bestSpec: row.bestSpecName
        ? {
            name: row.bestSpecName,
            slug: row.bestSpecSlug ?? null,
            score: row.bestSpecScore ?? 0,
          }
        : null,
      dungeon: null,
      run: null,
      dungeonRuns: runs.map((run) => this.toRunSummary(run)),
      updatedAt: row.updatedAt,
    };
  }

  private toDungeonLeaderboardRow(row: any, rank: number): MythicPlusLeaderboardResponse["data"][number] {
    return {
      rank,
      character: {
        id: String(row.characterId),
        wclCanonicalCharacterId: row.wclCanonicalCharacterId,
        name: row.name,
        realm: row.realm,
        region: row.region,
        classID: row.classID,
        guild: this.toGuild(row),
      },
      season: row.season,
      score: {
        bucket: row.bucket,
        value: row.score ?? 0,
      },
      dungeon: {
        id: row.raiderIoDungeonId,
        challengeModeId: row.challengeModeId ?? null,
        name: row.dungeonName,
        shortName: row.dungeonShortName ?? null,
        iconUrl: row.dungeonIconUrl ?? null,
      },
      run: {
        keystoneRunId: row.keystoneRunId ?? null,
        mythicLevel: row.mythicLevel ?? 0,
        score: row.score ?? 0,
        clearTimeMs: row.clearTimeMs ?? null,
        parTimeMs: row.parTimeMs ?? null,
        upgrades: row.upgrades ?? null,
        completedAt: row.completedAt ?? null,
        url: row.url ?? null,
      },
      dungeonRuns: [this.toRunSummary(row)],
      updatedAt: row.updatedAt,
    };
  }

  async getCharacterProfileMythicPlus(characterId: mongoose.Types.ObjectId): Promise<CharacterMythicPlusProfileResponse> {
    if (!(await this.isCharacterEligible(characterId))) return { seasons: [] };

    const scoreRows = await CharacterMythicPlusSeasonScore.find({ characterId, "scores.all": { $gt: 0 } }).lean();
    if (scoreRows.length === 0) return { seasons: [] };

    const seasonSlugs = scoreRows.map((row: any) => row.season);
    const seasonDocs = await MythicPlusSeason.find({ slug: { $in: seasonSlugs } }).select("slug name shortName expansionId order -_id").lean();
    const seasonBySlug = new Map(seasonDocs.map((season) => [season.slug, season]));
    const configuredOrder = new Map<string, number>(RAIDER_IO_MAIN_MYTHIC_PLUS_SEASON_SLUGS.map((slug, index) => [slug, index + 1]));
    const runs = await CharacterMythicPlusDungeonRun.find({
      characterId,
      season: { $in: seasonSlugs },
      bucket: "all",
    })
      .sort({ dungeonName: 1 })
      .lean();

    const runsBySeason = new Map<string, any[]>();
    for (const run of runs) {
      const list = runsBySeason.get(run.season) ?? [];
      list.push(run);
      runsBySeason.set(run.season, list);
    }

    const seasons = [...scoreRows]
      .sort((a: any, b: any) => {
        const orderA = seasonBySlug.get(a.season)?.order ?? configuredOrder.get(a.season) ?? 99999;
        const orderB = seasonBySlug.get(b.season)?.order ?? configuredOrder.get(b.season) ?? 99999;
        return orderA - orderB || a.season.localeCompare(b.season);
      })
      .map((row: any) => {
        const season = seasonBySlug.get(row.season);
        return {
          season: row.season,
          seasonName: season?.name ?? row.season,
          shortName: season?.shortName ?? null,
          expansionId: season?.expansionId ?? null,
          scores: row.scores,
          bestSpec: row.bestSpecName
            ? {
                name: row.bestSpecName,
                slug: row.bestSpecSlug ?? null,
                score: row.bestSpecScore ?? 0,
              }
            : null,
          specScores: (row.specScores ?? []).map((spec: any) => ({
            field: spec.field,
            specName: spec.specName ?? null,
            specSlug: spec.specSlug ?? null,
            role: spec.role ?? null,
            score: spec.score ?? 0,
            color: spec.color ?? null,
          })),
          dungeonRuns: (runsBySeason.get(row.season) ?? []).map((run) => this.toRunSummary(run)),
          fetchedAt: row.fetchedAt,
        };
      });

    return { seasons };
  }

  async getStatus(): Promise<MythicPlusCrawlerStatusResponse> {
    const counts = await CharacterMythicPlusFetchJob.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          profileSeasonsWritten: { $sum: "$profileSeasonsWritten" },
          detailJobsQueued: { $sum: "$detailJobsQueued" },
          dungeonRunsWritten: { $sum: "$dungeonRunsWritten" },
        },
      },
    ]);

    const byStatus = new Map(counts.map((row: any) => [row._id, row]));
    const getCount = (status: CharacterMythicPlusFetchJobStatus) => byStatus.get(status)?.count ?? 0;
    const total = counts.reduce((sum: number, row: any) => sum + row.count, 0);
    const recentFailures = await CharacterMythicPlusFetchJob.find({ status: { $in: ["failed", "class_mismatch", "not_found"] } })
      .sort({ lastErrorAt: -1, completedAt: -1 })
      .limit(20)
      .lean();
    const oneHourAgo = Date.now() - 3600 * 1000;
    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > oneHourAgo);

    return {
      processor: {
        isRunning: this.isRunning,
        currentJob: this.currentJob,
        lastMessage: this.lastMessage,
        requestsInWindow: this.requestTimestamps.length,
        maxRequestsPerHour: this.maxRequestsPerHour,
      },
      queue: {
        pending: getCount("pending"),
        inProgress: getCount("in_progress"),
        completed: getCount("completed"),
        skipped: getCount("skipped"),
        notFound: getCount("not_found"),
        classMismatch: getCount("class_mismatch"),
        rateLimited: getCount("rate_limited"),
        failed: getCount("failed"),
        total,
        terminal: getCount("completed") + getCount("skipped") + getCount("not_found") + getCount("class_mismatch") + getCount("failed"),
        profileSeasonsWritten: counts.reduce((sum: number, row: any) => sum + (row.profileSeasonsWritten ?? 0), 0),
        detailJobsQueued: counts.reduce((sum: number, row: any) => sum + (row.detailJobsQueued ?? 0), 0),
        dungeonRunsWritten: counts.reduce((sum: number, row: any) => sum + (row.dungeonRunsWritten ?? 0), 0),
      },
      recentFailures: recentFailures.map((job) => this.summarizeJob(job)),
      updatedAt: new Date(),
    };
  }
}

export const mythicPlusService = new MythicPlusService();
export default mythicPlusService;
