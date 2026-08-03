import { CURRENT_RAID_IDS, PRIMARY_RAID_ID, TRACKED_RAIDS } from "../config/guilds";
import { compareRaidIdsByPriority } from "../utils/raidPriority";
import { CLASSES } from "../config/classes";
import { ROLE_BY_CLASS_AND_SPEC } from "../config/specs";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import { MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY } from "../config/character-eligibility";
import Character, { ICharacter } from "../models/Character";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterIdentityLink from "../models/CharacterIdentityLink";
import CharacterIdentityResolution from "../models/CharacterIdentityResolution";
import CharacterLeaderboard from "../models/CharacterLeaderboard";
import CharacterMedia from "../models/CharacterMedia";
import CharacterMechanicsLeaderboard from "../models/CharacterMechanicsLeaderboard";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import CharacterRaidAchievementSummary, {
  CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
  ICharacterRaidAchievementSummary,
} from "../models/CharacterRaidAchievementSummary";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import Guild from "../models/Guild";
import Ranking from "../models/Ranking";
import Raid from "../models/Raid";
import Report from "../models/Report";
import logger from "../utils/logger";
import { resolveBlizzardCharacterIdentity } from "../utils/character-identity";
import { createCharacterIdentityAliasKey, createReportRankingSourceIdentityKey, normalizeCharacterIdentityPart } from "../utils/character-identity-link";
import { areEquivalentRealms, createRealmIdentityKey, realmNameToSlugCandidate } from "../utils/realm";
import { resolveRole, slugifySpecName } from "../utils/spec";
import cacheService from "./cache.service";
import characterMediaService from "./character-media.service";
import characterContinuityService from "./character-continuity.service";
import { updateCharacterIdentityFromObservation } from "./character-observed-identity.service";
import { getPrimaryCharacterRaidGuilds } from "./character-raid-guild.service";
import mythicPlusService, { CharacterMythicPlusProfileResponse } from "./mythic-plus.service";
import rateLimitService from "./rate-limit.service";
import wclService from "./warcraftlogs.service";
import mongoose from "mongoose";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

type ProfileMetric = "dps" | "hps";
type ProfileRole = "dps" | "healer" | "tank";

type ProfileLeaderboardRow = {
  zoneId: number;
  type?: string;
  encounterId?: number | null;
  metric?: ProfileMetric | string | null;
  role?: ProfileRole | string | null;
  specName?: string | null;
  classID?: number;
  rankPercent?: number | null;
  score?: number | null;
};

interface IWarcraftLogsAllStars {
  partition: number;
  spec: string;
  points: number;
  possiblePoints: number;
  rank: number;
  regionRank: number;
  serverRank: number;
  rankPercent: number;
  total: number;
  rankTooltip: string | null;
}

interface IWarcraftLogsRanking {
  encounter: {
    id: number;
    name: string;
  };
  rankPercent: number | null;
  medianPercent: number | null;
  lockedIn: boolean;
  totalKills: number;
  fastestKill: number;
  allStars: IWarcraftLogsAllStars | null;
  spec: string | null;
  bestSpec: string;
  bestAmount: number;
  rankTooltip: string | null;
  bestRank: {
    rank_id: number;
    class: number;
    spec: number;
    per_second_amount: number;
    ilvl: number;
    fight_metadata: number;
  };
}

interface IWarcraftLogsZoneRankings {
  bestPerformanceAverage: number;
  medianPerformanceAverage: number;
  difficulty: number;
  partition: number;
  zone: number;
  size: number;
  allStars?: IWarcraftLogsAllStars[];
  rankings: IWarcraftLogsRanking[];
}

interface IWarcraftLogsCharacter {
  id: number;
  canonicalID: number;
  name: string;
  classID: number;
  level: number;
  hidden: boolean;
  server: {
    id: number;
    name: string;
    region: {
      name: string;
    };
  };
  // When using aliased queries, zoneRankings fields appear as dynamic keys (e.g. "holyRankings", "shadowRankings")
  [aliasedRankings: string]: IWarcraftLogsZoneRankings | null | unknown;
}

interface IWarcraftLogsResponse {
  characterData: {
    character: IWarcraftLogsCharacter | null;
  };
}

/**
 * Convert a spec slug ("beast-mastery") to WCL PascalCase spec name ("BeastMastery").
 * WCL expects specName with first letter uppercase and hyphens removed.
 */
function toWclSpecName(specSlug: string): string {
  return specSlug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Convert a spec slug ("beast-mastery") to a valid GraphQL alias ("beastMasteryRankings").
 */
function toSpecAlias(specSlug: string): string {
  const parts = specSlug.split("-");
  const camel =
    parts[0] +
    parts
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");
  return `${camel}Rankings`;
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
    type: "allStars" | "bestAmount";
    value: number;
  };
  stats: {
    allStars?: { points: number; possiblePoints: number };
    bestAmount?: number;
    rankPercent?: number;
    medianPercent?: number;
    lockedIn?: boolean;
    totalKills?: number;
  };
  updatedAt?: string;
};

export type CharacterRankingsResponse = {
  data: CharacterRankingRow[];
  pagination: {
    totalItems: number;
    totalRankedItems: number;
    totalPages: number;
    currentPage: number;
    pageSize: number;
  };
};

export type GuildRaidCharacterRosterResponse = {
  guild: {
    id: string;
    name: string;
    realm: string;
  };
  raid: {
    id: number;
    name: string;
  } | null;
  characters: Array<{
    wclCanonicalCharacterId: number | null;
    name: string;
    realm: string;
    region: string;
    classID: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    reportCount: number;
  }>;
};

export type CharacterRaidAchievementType = "cutting_edge" | "ahead_of_the_curve";

export type CharacterRaidAchievementSummaryResponse = {
  version: string;
  fetchedAt: Date;
  cuttingEdgeCount: number;
  aheadOfTheCurveCount: number;
  totalCount: number;
  achievements: Array<{
    achievementId: number;
    name: string;
    type: CharacterRaidAchievementType;
    completedTimestamp: number;
    completedAt: Date;
  }>;
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
    firstReportSeenAt?: Date;
    lastReportSeenAt?: Date;
    guildHistory: Array<{
      guildName: string;
      guildRealm: string;
      firstSeenAt: Date;
      lastSeenAt: Date;
    }>;
    nameHistory: Array<{
      name: string;
      realm: string;
      region: string;
      firstSeenAt: Date;
      lastSeenAt: Date;
      reportCount: number;
    }>;
    raidAchievements: CharacterRaidAchievementSummaryResponse | null;
    account?: {
      groupId: string;
      slug?: string | null;
      displayName?: string | null;
      signalVersion: string;
      generatedAt: Date;
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
        lastSeenAt?: Date | null;
        lastMythicSeenAt?: Date | null;
        reportCount?: number;
        raidAchievements: CharacterRaidAchievementSummaryResponse | null;
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
    firstSeenAt: Date;
    lastSeenAt: Date;
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
    updatedAt?: Date;
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
    survivalPercentile: number | null;
    pulls: number;
    evaluatedPulls: number;
    deaths: number;
    survivedPulls: number;
    earlyDeaths: number;
    averageDeathPercent: number | null;
    deathDataAvailable: boolean;
    identityMethod: string | null;
    identityConfidence: string | null;
    scoreVersion: number;
    raidFightCoverage: number;
    updatedAt?: Date;
  }>;
  mythicPlus: CharacterMythicPlusProfileResponse;
};

export type CharacterProfileChoice = {
  wclCanonicalCharacterIds: number[];
  name: string;
  realm: string;
  region: string;
  classID: number;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
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

export type CharacterAccountResponse = {
  account: {
    id: string;
    slug: string;
    displayName: string;
    signalVersion: string;
    generatedAt: Date;
    totalReportCount: number;
    characterCount: number;
    edgeCount: number;
    minScore: number;
    maxScore: number;
    avgScore: number;
    raidAchievements: CharacterRaidAchievementSummaryResponse | null;
  };
  characters: Array<{
    characterId: string;
    name: string;
    realm: string;
    region: string;
    classID: number;
    guildName?: string | null;
    guildRealm?: string | null;
    lastSeenAt?: Date | null;
    lastMythicSeenAt?: Date | null;
    reportCount: number;
    raidAchievements: CharacterRaidAchievementSummaryResponse | null;
  }>;
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
  reports: Array<{
    code: string;
    url: string;
    startTime: number;
    endTime?: number;
    isOngoing: boolean;
    durationSeconds?: number;
    fightCount: number;
    kills: number;
    wipes: number;
  }>;
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
  lastReportSeenAt?: Date;
  lastMythicSeenAt?: Date;
};

type WclRankedCharacter = {
  canonicalID?: number;
  name?: string;
  classID?: number;
  hidden?: boolean;
  server?: {
    slug?: string;
    region?: {
      slug?: string;
    };
  };
  guilds?: Array<{
    name?: string;
    server?: {
      slug?: string;
      region?: {
        slug?: string;
      };
    };
  }>;
};

type WclReportPlayerActor = {
  name?: string;
  server?: string;
  subType?: string;
};

type WclReportRankingCharacter = {
  name: string;
  className: string;
  specName?: string;
  specNames?: string[];
  server: {
    name: string;
    region: string;
  };
  fightIds: number[];
};

type ReportRankingCanonicalMatch = {
  canonicalID: number;
  characterId?: mongoose.Types.ObjectId | null;
  name: string;
  realm: string;
  region: string;
};

type ResolvedReportRankingCanonicalMatch = {
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  manualIdentityLinkId?: mongoose.Types.ObjectId | null;
  name: string;
  realm: string;
  region: string;
};

class CharacterService {
  private characterIdentityIndexesSynced: boolean = false;

  private normalizeAccountDate(value?: Date | string | null): Date | null {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return null;

    return date;
  }

  private formatRaidAchievementSummary(summary?: ICharacterRaidAchievementSummary | null): CharacterRaidAchievementSummaryResponse | null {
    if (!summary) return null;

    const achievements = [...(summary.achievements ?? [])]
      .map((achievement) => ({
        achievementId: achievement.achievementId,
        name: achievement.name,
        type: achievement.type,
        completedTimestamp: achievement.completedTimestamp,
        completedAt: achievement.completedAt,
      }))
      .sort((a, b) => a.completedTimestamp - b.completedTimestamp || a.achievementId - b.achievementId);

    return {
      version: summary.version,
      fetchedAt: summary.fetchedAt,
      cuttingEdgeCount: summary.cuttingEdgeCount,
      aheadOfTheCurveCount: summary.aheadOfTheCurveCount,
      totalCount: summary.cuttingEdgeCount + summary.aheadOfTheCurveCount,
      achievements,
    };
  }

  private buildAccountRaidAchievementSummary(summaries: CharacterRaidAchievementSummaryResponse[]): CharacterRaidAchievementSummaryResponse | null {
    if (summaries.length === 0) return null;

    const achievementsById = new Map<number, CharacterRaidAchievementSummaryResponse["achievements"][number]>();
    let fetchedAt = summaries[0].fetchedAt;

    for (const summary of summaries) {
      if (summary.fetchedAt > fetchedAt) fetchedAt = summary.fetchedAt;

      for (const achievement of summary.achievements) {
        const existing = achievementsById.get(achievement.achievementId);
        if (!existing || achievement.completedTimestamp < existing.completedTimestamp) {
          achievementsById.set(achievement.achievementId, achievement);
        }
      }
    }

    const achievements = Array.from(achievementsById.values()).sort((a, b) => a.completedTimestamp - b.completedTimestamp || a.achievementId - b.achievementId);
    const cuttingEdgeCount = achievements.filter((achievement) => achievement.type === "cutting_edge").length;
    const aheadOfTheCurveCount = achievements.filter((achievement) => achievement.type === "ahead_of_the_curve").length;

    return {
      version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
      fetchedAt,
      cuttingEdgeCount,
      aheadOfTheCurveCount,
      totalCount: cuttingEdgeCount + aheadOfTheCurveCount,
      achievements,
    };
  }

  private async buildAccountCharacters(
    members: Array<{
      characterId: mongoose.Types.ObjectId;
      name: string;
      realm: string;
      region: string;
      classID: number;
      guildName?: string | null;
      guildRealm?: string | null;
      lastMythicSeenAt?: Date | null;
      reportCount?: number;
    }>,
  ): Promise<CharacterAccountResponse["characters"]> {
    const characterIds = members.map((member) => member.characterId);
    const latestByCharacterId = new Map<string, { lastReportSeenAt?: Date | null; lastMythicSeenAt?: Date | null }>();
    const raidAchievementsByCharacterId = new Map<string, CharacterRaidAchievementSummaryResponse | null>();

    if (characterIds.length > 0) {
      const [latestRows, raidAchievementRows] = await Promise.all([
        Character.find({ _id: { $in: characterIds } })
          .select("_id lastReportSeenAt lastMythicSeenAt")
          .lean<Array<{ _id: mongoose.Types.ObjectId; lastReportSeenAt?: Date | null; lastMythicSeenAt?: Date | null }>>(),
        CharacterRaidAchievementSummary.find({
          characterId: { $in: characterIds },
          version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
        }).lean<ICharacterRaidAchievementSummary[]>(),
      ]);

      latestRows.forEach((row) => {
        latestByCharacterId.set(row._id.toString(), {
          lastReportSeenAt: row.lastReportSeenAt,
          lastMythicSeenAt: row.lastMythicSeenAt,
        });
      });

      raidAchievementRows.forEach((row) => {
        raidAchievementsByCharacterId.set(row.characterId.toString(), this.formatRaidAchievementSummary(row));
      });
    }

    return members
      .map((member) => {
        const latest = latestByCharacterId.get(member.characterId.toString());
        const lastMythicSeenAt = this.normalizeAccountDate(latest?.lastMythicSeenAt ?? member.lastMythicSeenAt ?? null);
        const lastSeenAt = this.normalizeAccountDate(latest?.lastReportSeenAt ?? null) ?? lastMythicSeenAt;

        return {
          characterId: member.characterId.toString(),
          name: member.name,
          realm: member.realm,
          region: member.region,
          classID: member.classID,
          guildName: member.guildName ?? null,
          guildRealm: member.guildRealm ?? null,
          lastSeenAt,
          lastMythicSeenAt,
          reportCount: member.reportCount ?? 0,
          raidAchievements: raidAchievementsByCharacterId.get(member.characterId.toString()) ?? null,
        };
      })
      .sort((a, b) => {
        const reportDiff = b.reportCount - a.reportCount;
        if (reportDiff !== 0) return reportDiff;
        const lastSeenA = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
        const lastSeenB = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
        return lastSeenB - lastSeenA || a.name.localeCompare(b.name);
      });
  }

  private async resolveContinuityContext(
    canonicalIds: number[],
    classID: number,
    requestedIdentity?: { name: string; realm: string },
  ): Promise<{
    canonicalIds: number[];
    isCombined: boolean;
    requestedCharacterId: string | null;
    rootCharacter: (Pick<ICharacter, "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "blizzardIdentityOverride"> & {
      _id: mongoose.Types.ObjectId;
    }) | null;
  }> {
    if (canonicalIds.length === 0) return { canonicalIds, isCombined: false, requestedCharacterId: null, rootCharacter: null };

    const matchedCharacters = await Character.find({
      wclCanonicalCharacterId: { $in: canonicalIds },
      classID,
    })
      .select("wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
      .lean<
        Array<
          Pick<ICharacter, "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "blizzardIdentityOverride"> & {
            _id: mongoose.Types.ObjectId;
          }
        >
      >();
    if (matchedCharacters.length === 0) return { canonicalIds, isCombined: false, requestedCharacterId: null, rootCharacter: null };

    const graph = await characterContinuityService.getGraph();
    const requestedName = requestedIdentity?.name.trim().toLowerCase();
    const requestedRealm = requestedIdentity?.realm.trim().toLowerCase();
    const requestedCharacter =
      matchedCharacters.find(
        (character) => character.name.toLowerCase() === requestedName && character.realm.toLowerCase() === requestedRealm,
      ) ??
      matchedCharacters.find((character) => character.wclCanonicalCharacterId === canonicalIds[0]) ??
      matchedCharacters[0];
    const memberCharacterIds = [
      ...new Set(matchedCharacters.flatMap((character) => graph.getMemberIds(character._id))),
    ];
    const clusterCharacters = await Character.find({ _id: { $in: memberCharacterIds }, classID })
      .select("wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
      .lean<
        Array<
          Pick<ICharacter, "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "blizzardIdentityOverride"> & {
            _id: mongoose.Types.ObjectId;
          }
        >
      >();
    const rootCharacterId = graph.resolveRoot(requestedCharacter._id);
    const rootCharacter = clusterCharacters.find((character) => String(character._id) === rootCharacterId) ?? requestedCharacter;
    const expandedCanonicalIds = [
      rootCharacter.wclCanonicalCharacterId,
      ...canonicalIds,
      ...clusterCharacters.map((character) => character.wclCanonicalCharacterId),
    ].filter((canonicalId, index, values) => values.indexOf(canonicalId) === index);

    return {
      canonicalIds: expandedCanonicalIds,
      isCombined: memberCharacterIds.some((characterId) => graph.getTargetId(characterId) !== null),
      requestedCharacterId: String(requestedCharacter._id),
      rootCharacter,
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private getAccentInsensitiveRegex(value: string, options: { prefix?: boolean } = {}): RegExp {
    const characterClasses: Record<string, string> = {
      a: "aàáâãäåāăąǎǟǡǻȁȃạảấầẩẫậắằẳẵặ",
      c: "cçćĉċč",
      d: "dďđḍ",
      e: "eèéêëēĕėęěȅȇẹẻẽếềểễệ",
      g: "gĝğġģǧ",
      h: "hĥħḥ",
      i: "iìíîïĩīĭįıǐȉȋịỉ",
      j: "jĵ",
      k: "kķǩḳ",
      l: "lĺļľŀłḷ",
      n: "nñńņňŉŋǹṇ",
      o: "oòóôõöøōŏőơǒǫǭȍȏọỏốồổỗộớờởỡợ",
      r: "rŕŗřṛ",
      s: "sśŝşšșṣ",
      t: "tţťŧțṭ",
      u: "uùúûüũūŭůűųưǔȕȗụủứừửữự",
      w: "wŵẁẃẅ",
      y: "yýÿŷỳỵỷỹ",
      z: "zźżžẓ",
    };

    const source = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split("")
      .map((char) => {
        const lower = char.toLowerCase();
        const characterClass = characterClasses[lower];
        const token = characterClass ? `[${characterClass}]` : this.escapeRegex(char);
        return `${token}[\u0300-\u036f]*`;
      })
      .join("");

    return new RegExp(`${options.prefix ? "^" : ""}${source}`, "i");
  }

  private getSourceIdentityKey(parts: { canonicalID?: number | null; region: string; realm: string; name: string; classID: number; source: string }): string {
    if (typeof parts.canonicalID === "number") return `canonical:${parts.canonicalID}:${parts.classID}`;
    return `${parts.source}:${normalizeCharacterIdentityPart(parts.region)}:${createRealmIdentityKey(parts.realm)}:${normalizeCharacterIdentityPart(parts.name)}:${parts.classID}`;
  }

  private getClassIdFromWclClassName(className: string): number | null {
    const normalized = className.toLowerCase().replace(/[^a-z]/g, "");
    const classInfo = CLASSES.find((entry) => entry.name.toLowerCase().replace(/[^a-z]/g, "") === normalized);
    return classInfo?.id ?? null;
  }

  private getReportRankingMatchKey(parts: { region: string; realm: string; name: string }): string {
    return `${normalizeCharacterIdentityPart(parts.region)}:${createRealmIdentityKey(parts.realm)}:${normalizeCharacterIdentityPart(parts.name)}`;
  }

  private getReportActorMatchKey(parts: { realm: string; name: string }): string {
    return `${createRealmIdentityKey(parts.realm)}:${normalizeCharacterIdentityPart(parts.name)}`;
  }

  private async findCanonicalRouteCharacters(realm: string, name: string, classId?: number) {
    const nameRegex = new RegExp(`^${this.escapeRegex(name)}$`, "i");
    const candidates = await Character.find({ name: nameRegex, ...(classId ? { classID: classId } : {}) })
      .select("_id wclCanonicalCharacterId name realm region classID blizzardIdentityOverride")
      .lean<
        Array<
          Pick<ICharacter, "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "blizzardIdentityOverride"> & {
            _id: mongoose.Types.ObjectId;
          }
        >
      >();
    const normalizedRealm = realm.toLocaleLowerCase("en-US");
    const exactMatches = candidates.filter((candidate) => candidate.realm.toLocaleLowerCase("en-US") === normalizedRealm);
    if (exactMatches.length > 0) return exactMatches;

    const equivalentMatches = candidates.filter((candidate) => areEquivalentRealms(candidate.realm, realm));
    const canonicalRealms = new Set(equivalentMatches.map((candidate) => candidate.realm.toLocaleLowerCase("en-US")));
    return canonicalRealms.size === 1 ? equivalentMatches : [];
  }

  private buildReportActorClassMap(reportActors: WclReportPlayerActor[] = []): Map<string, number> {
    const classByIdentity = new Map<string, number>();
    const conflictedKeys = new Set<string>();

    for (const actor of reportActors) {
      if (!actor.name || !actor.server || !actor.subType) continue;

      const classID = this.getClassIdFromWclClassName(actor.subType);
      if (!classID) continue;

      const key = this.getReportActorMatchKey({ realm: actor.server, name: actor.name });
      const existingClassID = classByIdentity.get(key);
      if (existingClassID !== undefined && existingClassID !== classID) {
        conflictedKeys.add(key);
        classByIdentity.delete(key);
        continue;
      }

      if (!conflictedKeys.has(key)) {
        classByIdentity.set(key, classID);
      }
    }

    return classByIdentity;
  }

  buildCanonicalMatchesFromRankedCharacters(rankedCharacters: WclRankedCharacter[]): ReportRankingCanonicalMatch[] {
    return rankedCharacters
      .map((rankedCharacter) => {
        const canonicalID = rankedCharacter.canonicalID;
        const name = rankedCharacter.name;
        const realm = rankedCharacter.server?.slug;
        const region = rankedCharacter.server?.region?.slug;

        if (!canonicalID || !name || !realm || !region) return null;

        return {
          canonicalID,
          name,
          realm,
          region,
        };
      })
      .filter((match): match is ReportRankingCanonicalMatch => match !== null);
  }

  async getCanonicalMatchesFromReportAppearances(reportCode: string): Promise<ReportRankingCanonicalMatch[]> {
    const appearances = await CharacterReportAppearance.find({
      reportCode,
      wclCanonicalCharacterId: { $ne: null },
    } as any)
      .select("characterId wclCanonicalCharacterId characterName characterRealm characterRegion")
      .lean();

    return appearances
      .map((appearance): ReportRankingCanonicalMatch | null => {
        if (!appearance.wclCanonicalCharacterId) return null;

        const match: ReportRankingCanonicalMatch = {
          canonicalID: appearance.wclCanonicalCharacterId,
          name: appearance.characterName,
          realm: appearance.characterRealm,
          region: appearance.characterRegion,
        };
        if (appearance.characterId) {
          match.characterId = appearance.characterId as mongoose.Types.ObjectId;
        }

        return match;
      })
      .filter((match): match is ReportRankingCanonicalMatch => match !== null);
  }

  private async ensureCharacterIdentityIndexes(): Promise<void> {
    if (this.characterIdentityIndexesSynced) return;

    await Character.syncIndexes();
    await CharacterReportAppearance.syncIndexes();
    this.characterIdentityIndexesSynced = true;
  }

  /**
   * Upsert a character from WCL report data with guild history tracking.
   *
   * For new characters: creates the document with current guild and initial history entry.
   * For existing characters: updates core fields, then handles guild change detection
   * and history tracking in a separate atomic step.
   */
  async upsertCharacterFromReport(params: {
    canonicalID: number;
    name: string;
    serverSlug: string;
    serverRegion: string;
    classID: number;
    hidden: boolean;
    guildName: string | null;
    guildRealm: string | null;
  }): Promise<void> {
    const now = new Date();
    const { canonicalID, name, serverSlug, serverRegion, classID, hidden, guildName, guildRealm } = params;

    const initialGuildHistory = guildName && guildRealm ? [{ guildName, guildRealm, firstSeenAt: now, lastSeenAt: now }] : [];

    await this.ensureCharacterIdentityIndexes();

    // Keep identity writes monotonic. Historical report processing can arrive out of order,
    // so only the newest observation may replace the stored name and realm.
    const character = await Character.findOneAndUpdate(
      { wclCanonicalCharacterId: canonicalID, classID },
      {
        $set: {
          classID,
          wclProfileHidden: hidden,
          lastMythicSeenAt: now,
          rankingsAvailable: hidden === true ? false : null,
          nextEligibleRefreshAt: now,
        },
        $setOnInsert: {
          wclCanonicalCharacterId: canonicalID,
          name,
          realm: serverSlug,
          region: serverRegion,
          identityObservedAt: now,
          guildName,
          guildRealm,
          guildUpdatedAt: now,
          guildHistory: initialGuildHistory,
        },
      },
      { upsert: true, new: true },
    );

    if (!character) return;

    await updateCharacterIdentityFromObservation(
      character._id as mongoose.Types.ObjectId,
      { name, realm: serverSlug, region: serverRegion },
      now,
    );

    // For newly-inserted documents, $setOnInsert already set guild fields — skip further work.
    // Detect insert: guildHistory was set by $setOnInsert, so if it exists and updatedAt ≈ now,
    // we assume this was an insert. A safer check: if guildUpdatedAt equals now (same ms).
    // However, existing pre-migration characters won't have guildHistory at all.
    // To keep it simple and idempotent, always run the guild update — it's a no-op if nothing changed.
    await this.updateCharacterGuild(character._id as mongoose.Types.ObjectId, character.guildName ?? null, character.guildRealm ?? null, guildName, guildRealm, now);
  }

  /**
   * Upsert report-level character appearances discovered from WCL rankedCharacters.
   *
   * This is intentionally separate from the ranking-oriented Mythic upsert above:
   * old report discoveries should populate character/history data without making
   * the character immediately eligible for current-tier ranking refreshes.
   */
  async upsertCharactersFromReportAppearances(params: {
    reportCode: string;
    reportStartTime: number | Date;
    reportZoneId?: number;
    reportGuildId: mongoose.Types.ObjectId;
    reportGuildName: string;
    reportGuildRealm: string;
    rankedCharacters: WclRankedCharacter[];
    reportActors?: WclReportPlayerActor[];
  }): Promise<{ processed: number; skipped: number }> {
    const reportSeenAt = params.reportStartTime instanceof Date ? params.reportStartTime : new Date(params.reportStartTime);
    const guildObservedAt = new Date();
    const reportActorClassByIdentity = this.buildReportActorClassMap(params.reportActors);
    let processed = 0;
    let skipped = 0;
    let correctedClassIDs = 0;

    await this.ensureCharacterIdentityIndexes();

    for (const rankedCharacter of params.rankedCharacters) {
      const canonicalID = rankedCharacter.canonicalID;
      const name = rankedCharacter.name;
      const realm = rankedCharacter.server?.slug;
      const region = rankedCharacter.server?.region?.slug;
      const rankedClassID = rankedCharacter.classID;
      const actorClassID = name && realm ? reportActorClassByIdentity.get(this.getReportActorMatchKey({ realm, name })) : undefined;
      const classID = actorClassID ?? rankedClassID;

      if (!canonicalID || !name || !realm || !region || !classID) {
        skipped += 1;
        continue;
      }

      if (actorClassID && rankedClassID && actorClassID !== rankedClassID) {
        await CharacterReportAppearance.deleteMany({
          reportCode: params.reportCode,
          wclCanonicalCharacterId: canonicalID,
          classID: rankedClassID,
          appearanceSource: "rankedCharacters",
          characterName: new RegExp(`^${this.escapeRegex(name)}$`, "i"),
          characterRealm: new RegExp(`^${this.escapeRegex(realm)}$`, "i"),
          characterRegion: new RegExp(`^${this.escapeRegex(region)}$`, "i"),
        });
        correctedClassIDs += 1;
      }

      const character = await Character.findOneAndUpdate(
        { wclCanonicalCharacterId: canonicalID, classID },
        {
          $set: {
            classID,
            wclProfileHidden: rankedCharacter.hidden === true,
          },
          $min: {
            firstReportSeenAt: reportSeenAt,
          },
          $max: {
            lastReportSeenAt: reportSeenAt,
          },
          $setOnInsert: {
            wclCanonicalCharacterId: canonicalID,
            name,
            realm,
            region,
            identityObservedAt: reportSeenAt,
            guildName: null,
            guildRealm: null,
            guildUpdatedAt: null,
            guildHistory: [],
            lastMythicSeenAt: null,
            rankingsAvailable: null,
            nextEligibleRefreshAt: new Date("2100-01-01T00:00:00.000Z"),
          },
        },
        { upsert: true, new: true },
      );

      if (!character) {
        skipped += 1;
        continue;
      }

      await updateCharacterIdentityFromObservation(
        character._id as mongoose.Types.ObjectId,
        { name, realm, region },
        reportSeenAt,
      );

      const wclGuilds = (rankedCharacter.guilds || [])
        .map((guild) => ({
          name: guild.name,
          realm: guild.server?.slug,
          region: guild.server?.region?.slug,
        }))
        .filter((guild): guild is { name: string; realm: string; region: string } => Boolean(guild.name && guild.realm && guild.region));

      await CharacterReportAppearance.findOneAndUpdate(
        {
          reportCode: params.reportCode,
          wclCanonicalCharacterId: canonicalID,
          classID,
        },
        {
          $set: {
            characterId: character._id,
            wclCanonicalCharacterId: canonicalID,
            manualIdentityLinkId: null,
            sourceIdentityKey: this.getSourceIdentityKey({ canonicalID, region, realm, name, classID, source: "rankedCharacters" }),
            appearanceSource: "rankedCharacters",
            reportCode: params.reportCode,
            reportStartTime: reportSeenAt,
            reportZoneId: params.reportZoneId,
            reportGuildId: params.reportGuildId,
            reportGuildName: params.reportGuildName,
            reportGuildRealm: params.reportGuildRealm,
            characterName: name,
            characterRealm: realm,
            characterRegion: region,
            classID,
            specNames: [],
            rankingFightIds: [],
            hidden: rankedCharacter.hidden === true,
            wclGuilds,
          },
        },
        { upsert: true, new: true },
      );

      const primaryObservedGuild = wclGuilds[0];
      if (primaryObservedGuild) {
        await this.updateObservedGuildHistory(
          character._id as mongoose.Types.ObjectId,
          primaryObservedGuild.name,
          primaryObservedGuild.realm,
          guildObservedAt,
        );
      }
      processed += 1;
    }

    if (correctedClassIDs > 0) {
      logger.info(`[CharacterReportAppearance] ${params.reportCode}: corrected ${correctedClassIDs} rankedCharacters class IDs from report masterData actors`);
    }

    return { processed, skipped };
  }

  private async findCanonicalCharacterForReportRankingAppearance(params: {
    name: string;
    realm: string;
    region: string;
    classID: number;
  }): Promise<ResolvedReportRankingCanonicalMatch | null> {
    const nameRegex = new RegExp(`^${this.escapeRegex(params.name)}$`, "i");
    const regionRegex = new RegExp(`^${this.escapeRegex(params.region)}$`, "i");

    const manualLink = await CharacterIdentityLink.findOne({
      identityKey: createCharacterIdentityAliasKey(params),
    })
      .select("_id targetCharacterId")
      .lean();
    if (manualLink) {
      const target = await Character.findById(manualLink.targetCharacterId).select("_id wclCanonicalCharacterId name realm region classID").lean();
      if (target?.wclCanonicalCharacterId && target.classID === params.classID) {
        return {
          characterId: target._id as mongoose.Types.ObjectId,
          wclCanonicalCharacterId: target.wclCanonicalCharacterId,
          manualIdentityLinkId: manualLink._id as mongoose.Types.ObjectId,
          name: target.name,
          realm: target.realm,
          region: target.region,
        };
      }
    }

    const characterCandidates = await Character.find({
      name: nameRegex,
      region: regionRegex,
      classID: params.classID,
    })
      .select("_id wclCanonicalCharacterId name realm region")
      .lean();
    const exactCharacters = characterCandidates.filter(
      (candidate) => candidate.realm.toLocaleLowerCase("en-US") === params.realm.toLocaleLowerCase("en-US"),
    );
    const equivalentCharacters = exactCharacters.length > 0 ? exactCharacters : characterCandidates.filter((candidate) => areEquivalentRealms(candidate.realm, params.realm));
    const characterCanonicalIds = new Set(equivalentCharacters.map((candidate) => candidate.wclCanonicalCharacterId));
    const character = characterCanonicalIds.size === 1 ? equivalentCharacters[0] : null;

    if (character?.wclCanonicalCharacterId) {
      return {
        characterId: character._id as mongoose.Types.ObjectId,
        wclCanonicalCharacterId: character.wclCanonicalCharacterId,
        name: character.name,
        realm: character.realm,
        region: character.region,
      };
    }

    const automaticResolution = await CharacterIdentityResolution.findOne({
      sourceIdentityKey: createReportRankingSourceIdentityKey(params),
      status: "completed",
      outcome: "resolved",
      targetCharacterId: { $ne: null },
      wclCanonicalCharacterId: { $type: "number" },
    } as any)
      .select("targetCharacterId wclCanonicalCharacterId")
      .lean();
    if (automaticResolution?.targetCharacterId && automaticResolution.wclCanonicalCharacterId) {
      const target = await Character.findById(automaticResolution.targetCharacterId).select("_id wclCanonicalCharacterId name realm region classID").lean();
      if (
        target?.wclCanonicalCharacterId === automaticResolution.wclCanonicalCharacterId &&
        target.classID === params.classID
      ) {
        return {
          characterId: target._id as mongoose.Types.ObjectId,
          wclCanonicalCharacterId: target.wclCanonicalCharacterId,
          name: target.name,
          realm: target.realm,
          region: target.region,
        };
      }
    }

    const appearanceCandidates = await CharacterReportAppearance.find({
      characterName: nameRegex,
      characterRegion: regionRegex,
      classID: params.classID,
      wclCanonicalCharacterId: { $ne: null },
    } as any)
      .sort({ reportStartTime: -1 })
      .select("characterId wclCanonicalCharacterId characterName characterRealm characterRegion")
      .lean();
    const exactAppearances = appearanceCandidates.filter(
      (candidate) => candidate.characterRealm.toLocaleLowerCase("en-US") === params.realm.toLocaleLowerCase("en-US"),
    );
    const equivalentAppearances =
      exactAppearances.length > 0 ? exactAppearances : appearanceCandidates.filter((candidate) => areEquivalentRealms(candidate.characterRealm, params.realm));
    const appearanceCanonicalIds = new Set(equivalentAppearances.map((candidate) => candidate.wclCanonicalCharacterId));
    const appearance = appearanceCanonicalIds.size === 1 ? equivalentAppearances[0] : null;

    if (appearance?.characterId && appearance?.wclCanonicalCharacterId) {
      return {
        characterId: appearance.characterId as mongoose.Types.ObjectId,
        wclCanonicalCharacterId: appearance.wclCanonicalCharacterId,
        name: appearance.characterName,
        realm: appearance.characterRealm,
        region: appearance.characterRegion,
      };
    }

    return null;
  }

  private async upsertCanonicalCharacterForReportRankingAppearance(params: {
    canonicalID: number;
    name: string;
    realm: string;
    region: string;
    classID: number;
    reportSeenAt: Date;
  }): Promise<ResolvedReportRankingCanonicalMatch | null> {
    const character = await Character.findOneAndUpdate(
      { wclCanonicalCharacterId: params.canonicalID, classID: params.classID },
      {
        $set: {
          classID: params.classID,
          wclProfileHidden: false,
        },
        $min: {
          firstReportSeenAt: params.reportSeenAt,
        },
        $max: {
          lastReportSeenAt: params.reportSeenAt,
        },
        $setOnInsert: {
          wclCanonicalCharacterId: params.canonicalID,
          name: params.name,
          realm: params.realm,
          region: params.region,
          identityObservedAt: params.reportSeenAt,
          guildName: null,
          guildRealm: null,
          guildUpdatedAt: null,
          guildHistory: [],
          lastMythicSeenAt: null,
          rankingsAvailable: null,
          nextEligibleRefreshAt: new Date("2100-01-01T00:00:00.000Z"),
        },
      },
      { upsert: true, new: true },
    );

    if (!character) return null;

    await updateCharacterIdentityFromObservation(
      character._id as mongoose.Types.ObjectId,
      { name: params.name, realm: params.realm, region: params.region },
      params.reportSeenAt,
    );

    return {
      characterId: character._id as mongoose.Types.ObjectId,
      wclCanonicalCharacterId: params.canonicalID,
      name: params.name,
      realm: params.realm,
      region: params.region,
    };
  }

  async upsertCharacterFromWclIdentityResolution(params: {
    canonicalID: number;
    name: string;
    realm: string;
    region: string;
    classID: number;
    firstReportSeenAt?: Date;
    lastReportSeenAt?: Date;
    resolvedAt: Date;
  }): Promise<ResolvedReportRankingCanonicalMatch> {
    await this.ensureCharacterIdentityIndexes();

    const dateUpdates: Record<string, Date> = {};
    if (params.firstReportSeenAt) dateUpdates.firstReportSeenAt = params.firstReportSeenAt;
    const maxUpdates: Record<string, Date> = {};
    if (params.lastReportSeenAt) {
      maxUpdates.lastReportSeenAt = params.lastReportSeenAt;
      maxUpdates.lastMythicSeenAt = params.lastReportSeenAt;
    }

    const character = await Character.findOneAndUpdate(
      { wclCanonicalCharacterId: params.canonicalID, classID: params.classID },
      {
        $set: {
          classID: params.classID,
          wclProfileHidden: false,
          rankingsAvailable: null,
          nextEligibleRefreshAt: params.resolvedAt,
        },
        ...(Object.keys(dateUpdates).length > 0 ? { $min: dateUpdates } : {}),
        ...(Object.keys(maxUpdates).length > 0 ? { $max: maxUpdates } : {}),
        $setOnInsert: {
          wclCanonicalCharacterId: params.canonicalID,
          name: params.name,
          realm: params.realm,
          region: params.region,
          identityObservedAt: params.resolvedAt,
          guildName: null,
          guildRealm: null,
          guildUpdatedAt: null,
          guildHistory: [],
        },
      },
      { upsert: true, new: true },
    );

    if (!character) throw new Error(`Failed to upsert resolved WCL character ${params.canonicalID}/${params.classID}`);

    await updateCharacterIdentityFromObservation(
      character._id as mongoose.Types.ObjectId,
      { name: params.name, realm: params.realm, region: params.region },
      params.resolvedAt,
    );

    return {
      characterId: character._id as mongoose.Types.ObjectId,
      wclCanonicalCharacterId: params.canonicalID,
      name: params.name,
      realm: params.realm,
      region: params.region,
    };
  }

  async upsertCharactersFromReportRankingAppearances(params: {
    reportCode: string;
    reportStartTime: number | Date;
    reportZoneId?: number;
    reportGuildId: mongoose.Types.ObjectId;
    reportGuildName: string;
    reportGuildRealm: string;
    rankingCharacters: WclReportRankingCharacter[];
    canonicalMatches?: ReportRankingCanonicalMatch[];
  }): Promise<{ processed: number; skipped: number; matched: number; unmatched: number }> {
    const reportSeenAt = params.reportStartTime instanceof Date ? params.reportStartTime : new Date(params.reportStartTime);
    let processed = 0;
    let skipped = 0;
    let matched = 0;
    let unmatched = 0;
    const canonicalMatchesByIdentity = new Map<string, ReportRankingCanonicalMatch>();

    await this.ensureCharacterIdentityIndexes();

    for (const match of params.canonicalMatches ?? []) {
      canonicalMatchesByIdentity.set(this.getReportRankingMatchKey(match), match);
    }

    for (const rankingCharacter of params.rankingCharacters) {
      const name = rankingCharacter.name;
      const realm = realmNameToSlugCandidate(rankingCharacter.server.name);
      const region = rankingCharacter.server.region.toLowerCase();
      const classID = this.getClassIdFromWclClassName(rankingCharacter.className);
      const specNames = Array.from(new Set([...(rankingCharacter.specNames ?? []), rankingCharacter.specName].filter((specName): specName is string => Boolean(specName)))).sort();
      const rankingFightIds = Array.from(new Set(rankingCharacter.fightIds.filter((fightId) => typeof fightId === "number"))).sort((a, b) => a - b);

      if (!name || !realm || !region || !classID) {
        skipped += 1;
        continue;
      }

      const externalCanonicalMatch = canonicalMatchesByIdentity.get(this.getReportRankingMatchKey({ name, realm, region }));
      const canonicalMatch = externalCanonicalMatch
        ? await this.upsertCanonicalCharacterForReportRankingAppearance({
            canonicalID: externalCanonicalMatch.canonicalID,
            name,
            realm: externalCanonicalMatch.realm,
            region: externalCanonicalMatch.region,
            classID,
            reportSeenAt,
          })
        : await this.findCanonicalCharacterForReportRankingAppearance({
            name,
            realm,
            region,
            classID,
          });
      const sourceIdentityKey = this.getSourceIdentityKey({
        canonicalID: canonicalMatch?.wclCanonicalCharacterId,
        region,
        realm,
        name,
        classID,
        source: "reportRankings",
      });
      const storedRealm = canonicalMatch?.realm ?? realm;
      const storedRegion = canonicalMatch?.region ?? region;

      if (canonicalMatch?.wclCanonicalCharacterId) {
        await CharacterReportAppearance.deleteMany({
          reportCode: params.reportCode,
          wclCanonicalCharacterId: canonicalMatch.wclCanonicalCharacterId,
          classID: { $ne: classID },
          characterName: new RegExp(`^${this.escapeRegex(name)}$`, "i"),
          characterRealm: new RegExp(`^${this.escapeRegex(realm)}$`, "i"),
          characterRegion: new RegExp(`^${this.escapeRegex(region)}$`, "i"),
        });
      }

      const appearanceFilter = canonicalMatch?.wclCanonicalCharacterId
        ? {
            reportCode: params.reportCode,
            wclCanonicalCharacterId: canonicalMatch.wclCanonicalCharacterId,
            classID,
          }
        : {
            reportCode: params.reportCode,
            sourceIdentityKey,
          };

      await CharacterReportAppearance.findOneAndUpdate(
        appearanceFilter,
        {
          $set: {
            characterId: canonicalMatch?.characterId ?? null,
            wclCanonicalCharacterId: canonicalMatch?.wclCanonicalCharacterId ?? null,
            manualIdentityLinkId: canonicalMatch?.manualIdentityLinkId ?? null,
            sourceIdentityKey,
            appearanceSource: "reportRankings",
            reportCode: params.reportCode,
            reportStartTime: reportSeenAt,
            reportZoneId: params.reportZoneId,
            reportGuildId: params.reportGuildId,
            reportGuildName: params.reportGuildName,
            reportGuildRealm: params.reportGuildRealm,
            characterName: name,
            characterRealm: storedRealm,
            characterRegion: storedRegion,
            classID,
            specNames,
            rankingFightIds,
            hidden: false,
          },
          $setOnInsert: { wclGuilds: [] },
        },
        { upsert: true, new: true },
      );

      if (canonicalMatch) {
        await Character.updateOne(
          { _id: canonicalMatch.characterId },
          {
            $min: { firstReportSeenAt: reportSeenAt },
            $max: { lastReportSeenAt: reportSeenAt },
          },
        );
        matched += 1;
      } else {
        unmatched += 1;
      }

      processed += 1;
    }

    return { processed, skipped, matched, unmatched };
  }

  /**
   * Atomically update a character's current guild and guild history.
   *
   * - If guild changed: update guildName/guildRealm/guildUpdatedAt
   * - If guild exists in history: update lastSeenAt on existing entry
   * - If guild is new to history: push a new entry
   * - If guild was removed (null): clear current guild fields
   */
  private async updateCharacterGuild(
    characterId: mongoose.Types.ObjectId,
    currentGuildName: string | null,
    currentGuildRealm: string | null,
    newGuildName: string | null,
    newGuildRealm: string | null,
    seenAt: Date,
  ): Promise<void> {
    const guildChanged = currentGuildName !== newGuildName || currentGuildRealm !== newGuildRealm;

    // Case 1: No guild data from WCL
    if (!newGuildName || !newGuildRealm) {
      if (guildChanged && currentGuildName) {
        await Character.updateOne(
          { _id: characterId },
          {
            $set: {
              guildName: null,
              guildRealm: null,
              guildUpdatedAt: seenAt,
            },
          },
        );
      }
      return;
    }

    // Case 2: We have guild data — determine what to update
    const setFields: Record<string, unknown> = {};
    if (guildChanged) {
      setFields.guildName = newGuildName;
      setFields.guildRealm = newGuildRealm;
      setFields.guildUpdatedAt = seenAt;
    }

    // Try to update an existing guild history entry (atomic positional update)
    const historyUpdate = await Character.updateOne(
      {
        _id: characterId,
        guildHistory: {
          $elemMatch: { guildName: newGuildName, guildRealm: newGuildRealm },
        },
      },
      {
        $set: {
          ...setFields,
          "guildHistory.$.lastSeenAt": seenAt,
        },
      },
    );

    // If matchedCount === 0, the guild wasn't in history — add it
    if (historyUpdate.matchedCount === 0) {
      await Character.updateOne(
        { _id: characterId },
        {
          $set: setFields,
          $push: {
            guildHistory: {
              guildName: newGuildName,
              guildRealm: newGuildRealm,
              firstSeenAt: seenAt,
              lastSeenAt: seenAt,
            },
          },
        },
      );
    }
  }

  private async updateObservedGuildHistory(characterId: mongoose.Types.ObjectId, guildName: string, guildRealm: string, seenAt: Date): Promise<void> {
    const character = await Character.findById(characterId).select("guildName guildRealm guildUpdatedAt guildHistory").lean();
    if (!character) return;

    const history = [...(character.guildHistory || [])].map((entry) => ({
      guildName: entry.guildName,
      guildRealm: entry.guildRealm,
      firstSeenAt: new Date(entry.firstSeenAt),
      lastSeenAt: new Date(entry.lastSeenAt),
    }));

    const existing = history.find((entry) => entry.guildName === guildName && entry.guildRealm === guildRealm);
    if (existing) {
      if (seenAt < existing.firstSeenAt) existing.firstSeenAt = seenAt;
      if (seenAt > existing.lastSeenAt) existing.lastSeenAt = seenAt;
    } else {
      history.push({
        guildName,
        guildRealm,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
    }

    history.sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.guildName.localeCompare(b.guildName));

    const update: Record<string, unknown> = { guildHistory: history };
    const guildUpdatedAt = character.guildUpdatedAt ? new Date(character.guildUpdatedAt) : null;
    if (!guildUpdatedAt || seenAt >= guildUpdatedAt) {
      update.guildName = guildName;
      update.guildRealm = guildRealm;
      update.guildUpdatedAt = seenAt;
    }

    await Character.updateOne({ _id: characterId }, { $set: update });
  }

  private async relinkMultiClassCanonicalCharactersFromReportAppearances(): Promise<{ canonicalIds: number; groups: number; relinkedGroups: number }> {
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    logger.info("[CharacterRaidParticipation] Relink multi-class canonical characters: ensuring indexes");
    await this.ensureCharacterIdentityIndexes();

    logger.info(`[CharacterRaidParticipation] Relink multi-class canonical characters: finding canonical ID collisions (${elapsed()})`);
    const collisionRows = await CharacterReportAppearance.aggregate([
      { $match: { wclCanonicalCharacterId: { $type: "number" }, classID: { $type: "number" } } },
      {
        $group: {
          _id: "$wclCanonicalCharacterId",
          classes: { $addToSet: "$classID" },
        },
      },
      {
        $project: {
          canonicalID: "$_id",
          classCount: { $size: "$classes" },
        },
      },
      { $match: { classCount: { $gt: 1 } } },
    ]).allowDiskUse(true);

    const canonicalIds = collisionRows.map((row) => row.canonicalID).filter((id): id is number => typeof id === "number");
    logger.info(`[CharacterRaidParticipation] Relink multi-class canonical characters: found ${canonicalIds.length} multi-class canonical IDs (${elapsed()})`);
    if (canonicalIds.length === 0) {
      logger.info(`[CharacterRaidParticipation] Relink multi-class canonical characters: complete (${elapsed()})`);
      return { canonicalIds: 0, groups: 0, relinkedGroups: 0 };
    }

    logger.info(`[CharacterRaidParticipation] Relink multi-class canonical characters: aggregating identities (${elapsed()})`);
    const identityRows = await CharacterReportAppearance.aggregate([
      { $match: { wclCanonicalCharacterId: { $in: canonicalIds }, classID: { $type: "number" } } },
      { $sort: { reportStartTime: 1, reportCode: 1 } },
      {
        $group: {
          _id: {
            canonicalID: "$wclCanonicalCharacterId",
            classID: "$classID",
          },
          name: { $last: "$characterName" },
          realm: { $last: "$characterRealm" },
          region: { $last: "$characterRegion" },
          hidden: { $last: "$hidden" },
          firstReportSeenAt: { $min: "$reportStartTime" },
          lastReportSeenAt: { $max: "$reportStartTime" },
        },
      },
    ]).allowDiskUse(true);
    logger.info(`[CharacterRaidParticipation] Relink multi-class canonical characters: aggregated ${identityRows.length} identity groups (${elapsed()})`);

    let relinkedGroups = 0;
    let appearanceBulkOps: any[] = [];
    let appearanceUpdateGroups = 0;

    const flushAppearanceUpdates = async () => {
      if (appearanceBulkOps.length === 0) return;
      const batchSize = appearanceBulkOps.length;
      await CharacterReportAppearance.bulkWrite(appearanceBulkOps, { ordered: false });
      appearanceUpdateGroups += batchSize;
      logger.info(
        `[CharacterRaidParticipation] Relink multi-class canonical characters: relinked ${appearanceUpdateGroups}/${identityRows.length} appearance groups (${elapsed()})`,
      );
      appearanceBulkOps = [];
    };

    for (const row of identityRows) {
      const canonicalID = row._id?.canonicalID;
      const classID = row._id?.classID;
      if (typeof canonicalID !== "number" || typeof classID !== "number" || !row.name || !row.realm || !row.region) continue;

      const character = await Character.findOneAndUpdate(
        { wclCanonicalCharacterId: canonicalID, classID },
        {
          $set: {
            name: row.name,
            realm: row.realm,
            region: row.region,
            classID,
            wclProfileHidden: row.hidden === true,
            firstReportSeenAt: row.firstReportSeenAt,
            lastReportSeenAt: row.lastReportSeenAt,
            identityObservedAt: row.lastReportSeenAt,
          },
          $setOnInsert: {
            wclCanonicalCharacterId: canonicalID,
            lastMythicSeenAt: null,
            rankingsAvailable: null,
            nextEligibleRefreshAt: new Date("2100-01-01T00:00:00.000Z"),
          },
        },
        { upsert: true, new: true },
      );

      if (!character) continue;

      appearanceBulkOps.push({
        updateMany: {
          filter: {
            wclCanonicalCharacterId: canonicalID,
            classID,
          },
          update: [
            {
              $set: {
                characterId: character._id,
                sourceIdentityKey: this.getSourceIdentityKey({
                  canonicalID,
                  region: row.region,
                  realm: row.realm,
                  name: row.name,
                  classID,
                  source: "rankedCharacters",
                }),
                appearanceSource: { $ifNull: ["$appearanceSource", "rankedCharacters"] },
              },
            },
          ],
        },
      });
      relinkedGroups += 1;

      if (appearanceBulkOps.length >= 500) {
        await flushAppearanceUpdates();
      }
    }

    await flushAppearanceUpdates();
    logger.info(`[CharacterRaidParticipation] Relink multi-class canonical characters: complete, relinked ${relinkedGroups}/${identityRows.length} groups (${elapsed()})`);
    return { canonicalIds: canonicalIds.length, groups: identityRows.length, relinkedGroups };
  }

  private async matchReportRankingAppearancesToCanonicalCharacters(): Promise<number> {
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    logger.info("[CharacterRaidParticipation] Matching report.rankings fallback appearances to canonical characters: loading unmatched appearances");
    const unmatchedAppearances = await CharacterReportAppearance.find({
      appearanceSource: "reportRankings",
      wclCanonicalCharacterId: null,
    })
      .select(
        "_id reportCode characterName characterRealm characterRegion classID reportGuildName reportGuildRealm reportStartTime specNames rankingFightIds hidden",
      )
      .lean();
    logger.info(
      `[CharacterRaidParticipation] Matching report.rankings fallback appearances to canonical characters: loaded ${unmatchedAppearances.length} unmatched appearances (${elapsed()})`,
    );

    const getMatchKey = (name: string, realm: string, region: string, classID: number) => createCharacterIdentityAliasKey({ name, realm, region, classID });
    const canonicalMatchesByIdentity = new Map<string, ResolvedReportRankingCanonicalMatch>();
    const manualIdentityKeys = new Set<string>();
    const conflictedAutomaticIdentityKeys = new Set<string>();

    logger.info("[CharacterRaidParticipation] Matching report.rankings fallback appearances to canonical characters: building canonical match map");
    const [manualLinks, automaticResolutions, canonicalCharacters] = await Promise.all([
      CharacterIdentityLink.find({}).select("_id identityKey targetCharacterId").lean(),
      CharacterIdentityResolution.find({
        status: "completed",
        outcome: "resolved",
        targetCharacterId: { $ne: null },
        wclCanonicalCharacterId: { $type: "number" },
      } as any)
        .select("sourceName sourceRealm sourceRegion sourceClassID targetCharacterId wclCanonicalCharacterId")
        .lean(),
      Character.find({ wclCanonicalCharacterId: { $ne: null } } as any)
        .select("_id wclCanonicalCharacterId name realm region classID")
        .lean(),
    ]);
    const canonicalCharacterById = new Map(canonicalCharacters.map((character) => [String(character._id), character]));

    for (const link of manualLinks) {
      const target = canonicalCharacterById.get(String(link.targetCharacterId));
      if (!target?.wclCanonicalCharacterId) continue;
      canonicalMatchesByIdentity.set(link.identityKey, {
        characterId: target._id as mongoose.Types.ObjectId,
        wclCanonicalCharacterId: target.wclCanonicalCharacterId,
        manualIdentityLinkId: link._id as mongoose.Types.ObjectId,
        name: target.name,
        realm: target.realm,
        region: target.region,
      });
      manualIdentityKeys.add(link.identityKey);
    }

    const addAutomaticMatch = (identityKey: string, match: ResolvedReportRankingCanonicalMatch) => {
      if (manualIdentityKeys.has(identityKey) || conflictedAutomaticIdentityKeys.has(identityKey)) return;
      const existing = canonicalMatchesByIdentity.get(identityKey);
      if (existing && existing.wclCanonicalCharacterId !== match.wclCanonicalCharacterId) {
        canonicalMatchesByIdentity.delete(identityKey);
        conflictedAutomaticIdentityKeys.add(identityKey);
        return;
      }
      if (!existing) canonicalMatchesByIdentity.set(identityKey, match);
    };

    for (const resolution of automaticResolutions) {
      if (!resolution.targetCharacterId || typeof resolution.wclCanonicalCharacterId !== "number") continue;
      const target = canonicalCharacterById.get(String(resolution.targetCharacterId));
      if (
        !target?.wclCanonicalCharacterId ||
        target.wclCanonicalCharacterId !== resolution.wclCanonicalCharacterId ||
        target.classID !== resolution.sourceClassID
      ) {
        continue;
      }

      addAutomaticMatch(
        getMatchKey(resolution.sourceName, resolution.sourceRealm, resolution.sourceRegion, resolution.sourceClassID),
        {
          characterId: target._id as mongoose.Types.ObjectId,
          wclCanonicalCharacterId: target.wclCanonicalCharacterId,
          name: target.name,
          realm: target.realm,
          region: target.region,
        },
      );
    }

    for (const character of canonicalCharacters) {
      if (!character.wclCanonicalCharacterId || !character.name || !character.realm || !character.region || !character.classID) continue;
      const identityKey = getMatchKey(character.name, character.realm, character.region, character.classID);
      addAutomaticMatch(identityKey, {
        characterId: character._id as mongoose.Types.ObjectId,
        wclCanonicalCharacterId: character.wclCanonicalCharacterId,
        name: character.name,
        realm: character.realm,
        region: character.region,
      });
    }

    const canonicalAppearanceRows = await CharacterReportAppearance.aggregate([
      { $match: { wclCanonicalCharacterId: { $type: "number" }, characterId: { $ne: null }, classID: { $type: "number" } } },
      { $sort: { reportStartTime: -1 } },
      {
        $group: {
          _id: {
            name: { $toLower: "$characterName" },
            realm: { $toLower: "$characterRealm" },
            region: { $toLower: "$characterRegion" },
            classID: "$classID",
          },
          characterId: { $first: "$characterId" },
          wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
        },
      },
    ]).allowDiskUse(true);

    for (const row of canonicalAppearanceRows) {
      const name = row._id?.name;
      const realm = row._id?.realm;
      const region = row._id?.region;
      const classID = row._id?.classID;
      if (!name || !realm || !region || typeof classID !== "number" || !row.characterId || typeof row.wclCanonicalCharacterId !== "number") continue;

      const key = getMatchKey(name, realm, region, classID);
      addAutomaticMatch(key, {
        characterId: row.characterId as mongoose.Types.ObjectId,
        wclCanonicalCharacterId: row.wclCanonicalCharacterId,
        name,
        realm,
        region,
      });
    }
    logger.info(
      `[CharacterRaidParticipation] Matching report.rankings fallback appearances to canonical characters: built ${canonicalMatchesByIdentity.size} canonical identity matches (${elapsed()})`,
    );

    const matchedAppearances: Array<{
      appearance: (typeof unmatchedAppearances)[number];
      canonicalMatch: ResolvedReportRankingCanonicalMatch;
    }> = [];
    const characterDateUpdatesById = new Map<string, { characterId: mongoose.Types.ObjectId; firstSeenAt: Date; lastSeenAt: Date }>();

    for (const [index, appearance] of unmatchedAppearances.entries()) {
      const canonicalMatch = canonicalMatchesByIdentity.get(getMatchKey(appearance.characterName, appearance.characterRealm, appearance.characterRegion, appearance.classID));

      if ((index + 1) % 1000 === 0) {
        logger.info(
          `[CharacterRaidParticipation] Matching report.rankings fallback appearances to canonical characters: scanned ${index + 1}/${unmatchedAppearances.length}, matched ${matchedAppearances.length} (${elapsed()})`,
        );
      }

      if (!canonicalMatch) continue;
      matchedAppearances.push({ appearance, canonicalMatch });

      const characterDateKey = canonicalMatch.characterId.toString();
      const characterDateUpdate = characterDateUpdatesById.get(characterDateKey);
      if (!characterDateUpdate) {
        characterDateUpdatesById.set(characterDateKey, {
          characterId: canonicalMatch.characterId,
          firstSeenAt: appearance.reportStartTime,
          lastSeenAt: appearance.reportStartTime,
        });
      } else {
        if (appearance.reportStartTime < characterDateUpdate.firstSeenAt) characterDateUpdate.firstSeenAt = appearance.reportStartTime;
        if (appearance.reportStartTime > characterDateUpdate.lastSeenAt) characterDateUpdate.lastSeenAt = appearance.reportStartTime;
      }
    }

    const canonicalAppearanceKey = (reportCode: string, canonicalID: number, classID: number) => `${reportCode}:${canonicalID}:${classID}`;
    const existingCanonicalAppearances = new Map<string, { _id: mongoose.Types.ObjectId }>();
    const lookupBatchSize = 500;
    for (let offset = 0; offset < matchedAppearances.length; offset += lookupBatchSize) {
      const batch = matchedAppearances.slice(offset, offset + lookupBatchSize);
      const rows = await CharacterReportAppearance.find({
        $or: batch.map(({ appearance, canonicalMatch }) => ({
          reportCode: appearance.reportCode,
          wclCanonicalCharacterId: canonicalMatch.wclCanonicalCharacterId,
          classID: appearance.classID,
        })),
      })
        .select("_id reportCode wclCanonicalCharacterId classID")
        .lean();

      for (const row of rows) {
        if (typeof row.wclCanonicalCharacterId !== "number") continue;
        existingCanonicalAppearances.set(canonicalAppearanceKey(row.reportCode, row.wclCanonicalCharacterId, row.classID), {
          _id: row._id as mongoose.Types.ObjectId,
        });
      }
    }

    const mergeUpdates: any[] = [];
    const mergedFallbackIds: mongoose.Types.ObjectId[] = [];
    const directUpdates: any[] = [];
    for (const { appearance, canonicalMatch } of matchedAppearances) {
      const sourceIdentityKey = this.getSourceIdentityKey({
        canonicalID: canonicalMatch.wclCanonicalCharacterId,
        region: canonicalMatch.region,
        realm: canonicalMatch.realm,
        name: appearance.characterName,
        classID: appearance.classID,
        source: "reportRankings",
      });
      const existing = existingCanonicalAppearances.get(
        canonicalAppearanceKey(appearance.reportCode, canonicalMatch.wclCanonicalCharacterId, appearance.classID),
      );
      const sharedUpdate = {
        characterId: canonicalMatch.characterId,
        wclCanonicalCharacterId: canonicalMatch.wclCanonicalCharacterId,
        manualIdentityLinkId: canonicalMatch.manualIdentityLinkId ?? null,
        sourceIdentityKey,
        appearanceSource: "reportRankings" as const,
        characterName: appearance.characterName,
        characterRealm: canonicalMatch.realm,
        characterRegion: canonicalMatch.region,
        specNames: appearance.specNames ?? [],
        rankingFightIds: appearance.rankingFightIds ?? [],
        hidden: appearance.hidden === true,
      };

      if (existing) {
        mergeUpdates.push({ updateOne: { filter: { _id: existing._id }, update: { $set: sharedUpdate } } });
        mergedFallbackIds.push(appearance._id as mongoose.Types.ObjectId);
      } else {
        directUpdates.push({ updateOne: { filter: { _id: appearance._id }, update: { $set: sharedUpdate } } });
      }
    }

    const runBulkUpdates = async (operations: any[]) => {
      for (let offset = 0; offset < operations.length; offset += 1000) {
        await CharacterReportAppearance.bulkWrite(operations.slice(offset, offset + 1000), { ordered: false });
      }
    };

    // Update the canonical row first. Only delete the redundant fallback after all merges succeed.
    await runBulkUpdates(mergeUpdates);
    for (let offset = 0; offset < mergedFallbackIds.length; offset += 1000) {
      await CharacterReportAppearance.deleteMany({ _id: { $in: mergedFallbackIds.slice(offset, offset + 1000) } });
    }
    await runBulkUpdates(directUpdates);

    if (characterDateUpdatesById.size > 0) {
      const dateUpdateOps = Array.from(characterDateUpdatesById.values()).map((update) => ({
        updateOne: {
          filter: { _id: update.characterId },
          update: {
            $min: { firstReportSeenAt: update.firstSeenAt },
            $max: { lastReportSeenAt: update.lastSeenAt },
          },
        },
      }));
      await Character.bulkWrite(dateUpdateOps, { ordered: false });
    }

    logger.info(
      `[CharacterRaidParticipation] Matching report.rankings fallback appearances to canonical characters: complete, scanned ${unmatchedAppearances.length}, matched ${matchedAppearances.length}, merged ${mergedFallbackIds.length} duplicate rows (${elapsed()})`,
    );
    return matchedAppearances.length;
  }

  private async reconcileRankedCharacterAppearanceClassesFromReportRankings(): Promise<number> {
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    const maxDistanceMs = 30 * 24 * 60 * 60 * 1000;

    logger.info("[CharacterRaidParticipation] Reconciling rankedCharacters class IDs using nearby report.rankings evidence: finding multi-class aliases");
    const conflictRows = await CharacterReportAppearance.aggregate<{
      canonicalID?: number;
    }>([
      {
        $match: {
          wclCanonicalCharacterId: { $type: "number" },
          classID: { $type: "number" },
          appearanceSource: { $in: ["rankedCharacters", "reportRankings"] },
        },
      },
      {
        $group: {
          _id: {
            canonicalID: "$wclCanonicalCharacterId",
            name: { $toLower: "$characterName" },
            realm: { $toLower: "$characterRealm" },
            region: { $toLower: "$characterRegion" },
          },
          classes: { $addToSet: "$classID" },
          sources: { $addToSet: "$appearanceSource" },
        },
      },
      {
        $project: {
          _id: 0,
          canonicalID: "$_id.canonicalID",
          classCount: { $size: "$classes" },
          sources: 1,
        },
      },
      {
        $match: {
          classCount: { $gt: 1 },
          sources: { $all: ["rankedCharacters", "reportRankings"] },
        },
      },
    ]).allowDiskUse(true);

    const canonicalIds = Array.from(new Set(conflictRows.map((row) => row.canonicalID).filter((id): id is number => typeof id === "number")));
    if (canonicalIds.length === 0) {
      logger.info(`[CharacterRaidParticipation] Reconciling rankedCharacters class IDs: no multi-class aliases found (${elapsed()})`);
      return 0;
    }

    logger.info(
      `[CharacterRaidParticipation] Reconciling rankedCharacters class IDs: checking ${canonicalIds.length} canonical IDs with mixed source/class evidence (${elapsed()})`,
    );

    const correctionRows = await CharacterReportAppearance.aggregate<{
      _id: mongoose.Types.ObjectId;
      reportCode: string;
      wclCanonicalCharacterId: number;
      characterName: string;
      characterRealm: string;
      characterRegion: string;
      fromClassID: number;
      toClassID: number;
      toCharacterId: mongoose.Types.ObjectId;
      nearestReportCode: string;
      diffMs: number;
    }>([
      {
        $match: {
          appearanceSource: "rankedCharacters",
          wclCanonicalCharacterId: { $in: canonicalIds },
          classID: { $type: "number" },
        },
      },
      {
        $lookup: {
          from: CharacterReportAppearance.collection.name,
          let: {
            canonicalID: "$wclCanonicalCharacterId",
            name: { $toLower: "$characterName" },
            realm: { $toLower: "$characterRealm" },
            region: { $toLower: "$characterRegion" },
            classID: "$classID",
            reportStartTime: "$reportStartTime",
          },
          pipeline: [
            {
              $match: {
                appearanceSource: "reportRankings",
                wclCanonicalCharacterId: { $type: "number" },
                classID: { $type: "number" },
                characterId: { $ne: null },
              },
            },
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$wclCanonicalCharacterId", "$$canonicalID"] },
                    { $eq: [{ $toLower: "$characterName" }, "$$name"] },
                    { $eq: [{ $toLower: "$characterRealm" }, "$$realm"] },
                    { $eq: [{ $toLower: "$characterRegion" }, "$$region"] },
                    { $ne: ["$classID", "$$classID"] },
                    { $lte: [{ $abs: { $subtract: ["$reportStartTime", "$$reportStartTime"] } }, maxDistanceMs] },
                  ],
                },
              },
            },
            {
              $project: {
                classID: 1,
                characterId: 1,
                reportCode: 1,
                diffMs: { $abs: { $subtract: ["$reportStartTime", "$$reportStartTime"] } },
              },
            },
            { $sort: { diffMs: 1, reportCode: 1 } },
            { $limit: 1 },
          ],
          as: "historicalClass",
        },
      },
      { $unwind: "$historicalClass" },
      {
        $lookup: {
          from: CharacterReportAppearance.collection.name,
          let: {
            reportCode: "$reportCode",
            canonicalID: "$wclCanonicalCharacterId",
            classID: "$historicalClass.classID",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$reportCode", "$$reportCode"] }, { $eq: ["$wclCanonicalCharacterId", "$$canonicalID"] }, { $eq: ["$classID", "$$classID"] }],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "existingTargetClassRow",
        },
      },
      { $match: { existingTargetClassRow: { $size: 0 } } },
      {
        $project: {
          _id: 1,
          reportCode: 1,
          wclCanonicalCharacterId: 1,
          characterName: 1,
          characterRealm: 1,
          characterRegion: 1,
          fromClassID: "$classID",
          toClassID: "$historicalClass.classID",
          toCharacterId: "$historicalClass.characterId",
          nearestReportCode: "$historicalClass.reportCode",
          diffMs: "$historicalClass.diffMs",
        },
      },
    ]).allowDiskUse(true);

    if (correctionRows.length === 0) {
      logger.info(`[CharacterRaidParticipation] Reconciling rankedCharacters class IDs: no corrections needed (${elapsed()})`);
      return 0;
    }

    logger.info(`[CharacterRaidParticipation] Reconciling rankedCharacters class IDs: correcting ${correctionRows.length} rankedCharacters rows (${elapsed()})`);

    let corrected = 0;
    let bulkOps: any[] = [];
    const now = new Date();
    const flushCorrections = async () => {
      if (bulkOps.length === 0) return;
      const result = await CharacterReportAppearance.bulkWrite(bulkOps, { ordered: false });
      corrected += result.modifiedCount ?? 0;
      logger.info(`[CharacterRaidParticipation] Reconciling rankedCharacters class IDs: corrected ${corrected}/${correctionRows.length} rows (${elapsed()})`);
      bulkOps = [];
    };

    for (const row of correctionRows) {
      bulkOps.push({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              classID: row.toClassID,
              characterId: row.toCharacterId,
              sourceIdentityKey: this.getSourceIdentityKey({
                canonicalID: row.wclCanonicalCharacterId,
                region: row.characterRegion,
                realm: row.characterRealm,
                name: row.characterName,
                classID: row.toClassID,
                source: "rankedCharacters",
              }),
              updatedAt: now,
            },
          },
        },
      });

      if (bulkOps.length >= 1000) {
        await flushCorrections();
      }
    }

    await flushCorrections();
    logger.info(`[CharacterRaidParticipation] Reconciling rankedCharacters class IDs: complete, corrected ${corrected}/${correctionRows.length} rows (${elapsed()})`);
    return corrected;
  }

  private async backfillAppearanceReportZoneIds(): Promise<number> {
    const rows = await CharacterReportAppearance.aggregate([
      {
        $match: {
          $or: [{ reportZoneId: { $exists: false } }, { reportZoneId: null }, { reportZoneId: 0 }],
        },
      },
      {
        $group: {
          _id: {
            reportCode: "$reportCode",
            reportGuildId: "$reportGuildId",
          },
        },
      },
      {
        $lookup: {
          from: "reports",
          let: { reportCode: "$_id.reportCode", guildId: "$_id.reportGuildId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$code", "$$reportCode"] }, { $eq: ["$guildId", "$$guildId"] }],
                },
              },
            },
            { $project: { zoneId: 1 } },
          ],
          as: "report",
        },
      },
      { $unwind: "$report" },
      { $match: { "report.zoneId": { $gt: 0 } } },
      {
        $project: {
          _id: 0,
          reportCode: "$_id.reportCode",
          reportGuildId: "$_id.reportGuildId",
          reportZoneId: "$report.zoneId",
        },
      },
    ]).allowDiskUse(true);

    if (rows.length === 0) return 0;

    let updatedReports = 0;
    const batchSize = 1000;
    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      const bulkOps: any[] = batch.map((row) => ({
        updateMany: {
          filter: {
            reportCode: row.reportCode,
            reportGuildId: row.reportGuildId,
            $or: [{ reportZoneId: { $exists: false } }, { reportZoneId: null }, { reportZoneId: 0 }],
          },
          update: {
            $set: {
              reportZoneId: row.reportZoneId,
            },
          },
        },
      }));
      await CharacterReportAppearance.bulkWrite(bulkOps, { ordered: false });
      updatedReports += batch.length;
    }

    return updatedReports;
  }
  async rebuildCharacterRaidParticipations(): Promise<{ deleted: number; inserted: number }> {
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    const targetCollectionName = CharacterRaidParticipation.collection.name;
    const tempCollectionName = `${targetCollectionName}_rebuild_${Date.now()}`;
    const db = CharacterRaidParticipation.db.db;
    if (!db) {
      throw new Error("MongoDB connection is not ready");
    }

    logger.info("[CharacterRaidParticipation] Rebuilding materialized participation collection");
    logger.info("[CharacterRaidParticipation] Step 1/7: relinking multi-class canonical characters");
    const relinkedCanonicalClasses = await this.relinkMultiClassCanonicalCharactersFromReportAppearances();
    logger.info(`[CharacterRaidParticipation] Step 1/7 complete (${elapsed()})`);

    logger.info("[CharacterRaidParticipation] Step 2/7: matching fallback report.rankings appearances");
    const matchedFallbackAppearances = await this.matchReportRankingAppearancesToCanonicalCharacters();
    logger.info(`[CharacterRaidParticipation] Step 2/7 complete (${elapsed()})`);

    logger.info("[CharacterRaidParticipation] Step 3/7: reconciling rankedCharacters class IDs from report.rankings evidence");
    const reconciledRankedCharacterClasses = await this.reconcileRankedCharacterAppearanceClassesFromReportRankings();
    if (reconciledRankedCharacterClasses > 0) {
      logger.info("[CharacterRaidParticipation] Step 3/7: relinking multi-class canonical characters after class reconciliation");
      await this.relinkMultiClassCanonicalCharactersFromReportAppearances();
    }
    logger.info(`[CharacterRaidParticipation] Step 3/7 complete: corrected ${reconciledRankedCharacterClasses} rankedCharacters rows (${elapsed()})`);

    logger.info("[CharacterRaidParticipation] Step 4/7: ensuring report zone IDs are denormalized on appearances");
    const zoneBackfilledReports = await this.backfillAppearanceReportZoneIds();
    logger.info(`[CharacterRaidParticipation] Step 4/7 zone ID fill complete: updated ${zoneBackfilledReports} report groups (${elapsed()})`);

    try {
      logger.info("[CharacterRaidParticipation] Step 5/7: aggregating Heroic/Mythic report appearances into temporary participation rows");
      await db.collection(tempCollectionName).drop().catch(() => undefined);
      await Report.collection.createIndex({ zoneId: 1, "fightSequence.difficulty": 1, code: 1 }, { background: true });

      await Report.aggregate([
        {
          $match: {
            zoneId: { $gt: 0 },
            "fightSequence.difficulty": { $in: [4, 5] },
          },
        },
        {
          $project: {
            _id: 0,
            code: 1,
            hasMythicReport: {
              $anyElementTrue: {
                $map: {
                  input: "$fightSequence",
                  as: "fight",
                  in: { $eq: ["$$fight.difficulty", 5] },
                },
              },
            },
          },
        },
        {
          $lookup: {
            from: CharacterReportAppearance.collection.name,
            localField: "code",
            foreignField: "reportCode",
            as: "appearance",
          },
        },
        { $unwind: "$appearance" },
        { $replaceRoot: { newRoot: { $mergeObjects: ["$appearance", { hasMythicReport: "$hasMythicReport" }] } } },
        { $match: { reportZoneId: { $gt: 0 } } },
        {
          $group: {
            _id: {
              wclCanonicalCharacterId: "$wclCanonicalCharacterId",
              zoneId: "$reportZoneId",
              reportGuildId: "$reportGuildId",
              classID: "$classID",
              fallbackName: {
                $cond: [{ $eq: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] }, "$characterName", null],
              },
              fallbackRealm: {
                $cond: [{ $eq: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] }, "$characterRealm", null],
              },
              fallbackRegion: {
                $cond: [{ $eq: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] }, "$characterRegion", null],
              },
            },
            latest: {
              $top: {
                sortBy: { reportStartTime: -1, reportCode: -1 },
                output: {
                  characterId: "$characterId",
                  wclCanonicalCharacterId: "$wclCanonicalCharacterId",
                  zoneId: "$reportZoneId",
                  reportGuildId: "$reportGuildId",
                  reportGuildName: "$reportGuildName",
                  reportGuildRealm: "$reportGuildRealm",
                  characterName: "$characterName",
                  characterRealm: "$characterRealm",
                  characterRegion: "$characterRegion",
                  classID: "$classID",
                },
              },
            },
            firstSeenAt: { $min: "$reportStartTime" },
            lastSeenAt: { $max: "$reportStartTime" },
            reportCount: { $sum: 1 },
            mythicReportCount: { $sum: { $cond: ["$hasMythicReport", 1, 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            characterId: { $ifNull: ["$latest.characterId", null] },
            wclCanonicalCharacterId: { $ifNull: ["$latest.wclCanonicalCharacterId", null] },
            zoneId: "$latest.zoneId",
            reportGuildId: "$latest.reportGuildId",
            reportGuildName: "$latest.reportGuildName",
            reportGuildRealm: "$latest.reportGuildRealm",
            characterName: "$latest.characterName",
            characterRealm: "$latest.characterRealm",
            characterRegion: "$latest.characterRegion",
            classID: "$latest.classID",
            firstSeenAt: 1,
            lastSeenAt: 1,
            reportCount: 1,
            mythicReportCount: 1,
            createdAt: "$$NOW",
            updatedAt: "$$NOW",
          },
        },
        { $out: tempCollectionName },
      ])
        .allowDiskUse(true)
        .exec();

      const tempCollection = db.collection(tempCollectionName);
      const tempExists = (await db.listCollections({ name: tempCollectionName }, { nameOnly: true }).toArray()).length > 0;
      if (!tempExists) {
        await db.createCollection(tempCollectionName);
      }

      const inserted = await tempCollection.estimatedDocumentCount();
      logger.info(`[CharacterRaidParticipation] Step 5/7 complete: staged ${inserted} participation rows (${elapsed()})`);

      logger.info("[CharacterRaidParticipation] Step 6/7: creating indexes on rebuilt participation rows");
      const schemaIndexes = CharacterRaidParticipation.schema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>;
      const indexSpecs = schemaIndexes.map(([key, options]) => ({ key, ...options })) as mongoose.mongo.IndexDescription[];
      if (indexSpecs.length > 0) {
        await tempCollection.createIndexes(indexSpecs);
      }
      logger.info(`[CharacterRaidParticipation] Step 6/7 complete (${elapsed()})`);

      logger.info("[CharacterRaidParticipation] Step 7/7: swapping rebuilt participation rows into place");
      const previousRows = await CharacterRaidParticipation.estimatedDocumentCount();
      await tempCollection.rename(targetCollectionName, { dropTarget: true });
      logger.info(`[CharacterRaidParticipation] Step 7/7 complete: replaced ${previousRows} rows with ${inserted} rows (${elapsed()})`);

      await Promise.all([cacheService.invalidatePattern(/^characters:profile:/), cacheService.invalidatePattern(/^mythic-plus:/)]);

      logger.info(
        `[CharacterRaidParticipation] Rebuild complete in ${elapsed()}: relinked ${relinkedCanonicalClasses.relinkedGroups}/${relinkedCanonicalClasses.groups} canonical-class groups across ${relinkedCanonicalClasses.canonicalIds} multi-class canonical IDs, matched ${matchedFallbackAppearances} fallback appearances, corrected ${reconciledRankedCharacterClasses} rankedCharacters classes, deleted ${previousRows}, inserted ${inserted}`,
      );

      return { deleted: previousRows, inserted };
    } catch (error) {
      await db
        .collection(tempCollectionName)
        .drop()
        .catch(() => undefined);
      throw error;
    }
  }

  async getGuildRaidCharactersByRealmName(realm: string, name: string, zoneId: number): Promise<GuildRaidCharacterRosterResponse | null> {
    const guild = await Guild.findOne({
      realm: new RegExp(`^${this.escapeRegex(realm)}$`, "i"),
      name: new RegExp(`^${this.escapeRegex(name)}$`, "i"),
    })
      .select("_id name realm")
      .lean();

    if (!guild) return null;

    const [raid, characters] = await Promise.all([
      Raid.findOne({ id: zoneId }).select("id name -_id").lean(),
      CharacterRaidParticipation.find({
        reportGuildId: guild._id,
        zoneId,
        reportCount: { $gte: MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY },
      })
        .sort({ classID: 1, characterName: 1 })
        .select("wclCanonicalCharacterId characterName characterRealm characterRegion classID firstSeenAt lastSeenAt reportCount -_id")
        .lean(),
    ]);

    return {
      guild: {
        id: guild._id.toString(),
        name: guild.name,
        realm: guild.realm,
      },
      raid: raid ? { id: raid.id, name: raid.name } : null,
      characters: characters.map((character) => ({
        wclCanonicalCharacterId: character.wclCanonicalCharacterId ?? null,
        name: character.characterName,
        realm: character.characterRealm,
        region: character.characterRegion,
        classID: character.classID,
        firstSeenAt: character.firstSeenAt,
        lastSeenAt: character.lastSeenAt,
        reportCount: character.reportCount,
      })),
    };
  }

  async searchCharacters(query: string, limit = 10): Promise<CharacterSearchResult[]> {
    const trimmedQuery = query.trim().slice(0, 60);
    if (trimmedQuery.length < 2) return [];

    const safeLimit = Math.min(Math.max(limit, 1), 10);
    const candidateLimit = Math.max(safeLimit * 10, 50);
    const nameMatch = this.getAccentInsensitiveRegex(trimmedQuery);

    const aliasRows = await CharacterRaidParticipation.aggregate([
      {
        $match: {
          characterName: nameMatch,
        },
      },
      { $sort: { lastSeenAt: -1 } },
      {
        $group: {
          _id: {
            wclCanonicalCharacterId: "$wclCanonicalCharacterId",
            classID: "$classID",
            fallbackName: {
              $cond: [{ $eq: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] }, "$characterName", null],
            },
            fallbackRealm: {
              $cond: [{ $eq: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] }, "$characterRealm", null],
            },
            fallbackRegion: {
              $cond: [{ $eq: [{ $ifNull: ["$wclCanonicalCharacterId", null] }, null] }, "$characterRegion", null],
            },
          },
          matchedName: { $first: "$characterName" },
          matchedRealm: { $first: "$characterRealm" },
          matchedLastSeenAt: { $max: "$lastSeenAt" },
        },
      },
      { $sort: { matchedLastSeenAt: -1, matchedName: 1, matchedRealm: 1, "_id.classID": 1 } },
      { $limit: candidateLimit },
      {
        $lookup: {
          from: "characterraidparticipations",
          let: {
            canonicalId: "$_id.wclCanonicalCharacterId",
            classId: "$_id.classID",
            fallbackName: "$_id.fallbackName",
            fallbackRealm: "$_id.fallbackRealm",
            fallbackRegion: "$_id.fallbackRegion",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$classID", "$$classId"] },
                    {
                      $or: [
                        { $and: [{ $ne: ["$$canonicalId", null] }, { $eq: ["$wclCanonicalCharacterId", "$$canonicalId"] }] },
                        {
                          $and: [
                            { $eq: ["$$canonicalId", null] },
                            { $eq: ["$characterName", "$$fallbackName"] },
                            { $eq: ["$characterRealm", "$$fallbackRealm"] },
                            { $eq: ["$characterRegion", "$$fallbackRegion"] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
            { $sort: { lastSeenAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 0,
                characterName: 1,
                characterRealm: 1,
                characterRegion: 1,
                reportGuildName: 1,
                reportGuildRealm: 1,
                lastSeenAt: 1,
              },
            },
          ],
          as: "current",
        },
      },
      { $unwind: "$current" },
      {
        $project: {
          _id: 0,
          wclCanonicalCharacterId: "$_id.wclCanonicalCharacterId",
          name: "$current.characterName",
          realm: "$current.characterRealm",
          region: "$current.characterRegion",
          classID: "$_id.classID",
          matchedName: 1,
          matchedRealm: 1,
          guild: {
            name: "$current.reportGuildName",
            realm: "$current.reportGuildRealm",
          },
          lastReportSeenAt: "$current.lastSeenAt",
        },
      },
      { $sort: { lastReportSeenAt: -1, name: 1, realm: 1, classID: 1 } },
      { $limit: safeLimit },
    ]).option({ maxTimeMS: 5_000 });

    return (aliasRows as CharacterSearchResult[]).map((character) => ({
      ...character,
      matchedName: character.matchedName === character.name && character.matchedRealm === character.realm ? undefined : character.matchedName,
      matchedRealm: character.matchedName === character.name && character.matchedRealm === character.realm ? undefined : character.matchedRealm,
    }));
  }

  async searchCurrentCharacters(query: string, limit = 10): Promise<CharacterSearchResult[]> {
    const trimmedQuery = query.trim().slice(0, 60);
    if (trimmedQuery.length < 2) return [];

    const safeLimit = Math.min(Math.max(limit, 1), 10);
    const nameMatch = this.getAccentInsensitiveRegex(trimmedQuery);
    const characters = await Character.find({
      $or: [
        { name: nameMatch },
        { "blizzardIdentityOverride.name": nameMatch },
      ],
    })
      .sort({ lastReportSeenAt: -1, name: 1, realm: 1, classID: 1 })
      .limit(safeLimit)
      .select("wclCanonicalCharacterId name realm region classID guildName guildRealm lastReportSeenAt blizzardIdentityOverride")
      .lean();

    return characters.map((character) => {
      const currentNameMatches = nameMatch.test(character.name);
      const overrideMatches = character.blizzardIdentityOverride
        ? nameMatch.test(character.blizzardIdentityOverride.name)
        : false;
      return {
        wclCanonicalCharacterId: character.wclCanonicalCharacterId,
        name: character.name,
        realm: character.realm,
        region: character.region,
        classID: character.classID,
        matchedName: !currentNameMatches && overrideMatches ? character.blizzardIdentityOverride?.name : undefined,
        matchedRealm: !currentNameMatches && overrideMatches ? character.blizzardIdentityOverride?.realm : undefined,
        guild: character.guildName && character.guildRealm
          ? { name: character.guildName, realm: character.guildRealm }
          : null,
        lastReportSeenAt: character.lastReportSeenAt,
      };
    });
  }

  async getCharacterAccountBySlug(accountSlug: string): Promise<CharacterAccountResponse | null> {
    const normalizedSlug = accountSlug.trim().toLowerCase();
    if (!normalizedSlug) return null;

    const lookupConditions: Record<string, unknown>[] = [{ slug: normalizedSlug }];
    if (mongoose.Types.ObjectId.isValid(accountSlug)) {
      lookupConditions.push({ _id: new mongoose.Types.ObjectId(accountSlug) });
    }

    const group = await CharacterAccountGroup.findOne({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      $or: lookupConditions,
    }).lean();

    if (!group) return null;

    const characters = await this.buildAccountCharacters([...(group.members ?? [])]);
    const raidAchievements = this.buildAccountRaidAchievementSummary(
      characters.map((character) => character.raidAchievements).filter((summary): summary is CharacterRaidAchievementSummaryResponse => summary !== null),
    );

    return {
      account: {
        id: group._id.toString(),
        slug: group.slug ?? group._id.toString(),
        displayName: group.displayName ?? characters[0]?.name ?? "Account",
        signalVersion: group.signalVersion,
        generatedAt: group.generatedAt,
        totalReportCount: group.totalReportCount ?? characters.reduce((total, character) => total + character.reportCount, 0),
        characterCount: characters.length,
        edgeCount: group.edgeCount,
        minScore: group.minScore,
        maxScore: group.maxScore,
        avgScore: group.avgScore,
        raidAchievements,
      },
      characters,
    };
  }

  private getProfileRowRole(row: ProfileLeaderboardRow): ProfileRole {
    if (row.role === "dps" || row.role === "healer" || row.role === "tank") {
      return row.role;
    }

    if (row.classID && row.specName) {
      return resolveRole(row.classID, row.specName);
    }

    return "dps";
  }

  private compareProfileLeaderboardRows(a: ProfileLeaderboardRow, b: ProfileLeaderboardRow): number {
    const rankDiff = (b.rankPercent ?? -1) - (a.rankPercent ?? -1);
    if (rankDiff !== 0) return rankDiff;
    return (b.score ?? 0) - (a.score ?? 0);
  }

  private selectPreferredProfileRows<T extends ProfileLeaderboardRow>(rows: T[], overallType: "allstars" | "overall"): T[] {
    const rowsByZone = new Map<number, T[]>();
    for (const row of rows) {
      const zoneRows = rowsByZone.get(row.zoneId) ?? [];
      zoneRows.push(row);
      rowsByZone.set(row.zoneId, zoneRows);
    }

    const selectedRows: T[] = [];

    for (const zoneRows of rowsByZone.values()) {
      const bossRows = zoneRows.filter((row) => row.type !== overallType && row.encounterId !== null && row.encounterId !== undefined);
      const evidenceRows = bossRows.length > 0 ? bossRows : zoneRows;
      const specStats = new Map<
        string,
        {
          specName: string;
          role: ProfileRole;
          encounters: Set<number>;
          rows: number;
          rankTotal: number;
          rankCount: number;
          metrics: Set<ProfileMetric>;
        }
      >();

      for (const row of evidenceRows) {
        if (!row.specName) continue;
        const role = this.getProfileRowRole(row);
        const key = `${row.specName}|${role}`;
        const stat =
          specStats.get(key) ??
          {
            specName: row.specName,
            role,
            encounters: new Set<number>(),
            rows: 0,
            rankTotal: 0,
            rankCount: 0,
            metrics: new Set<ProfileMetric>(),
          };

        if (typeof row.encounterId === "number") stat.encounters.add(row.encounterId);
        stat.rows += 1;
        if (row.metric === "dps" || row.metric === "hps") stat.metrics.add(row.metric);
        if (typeof row.rankPercent === "number" && Number.isFinite(row.rankPercent)) {
          stat.rankTotal += row.rankPercent;
          stat.rankCount += 1;
        }
        specStats.set(key, stat);
      }

      const preferredSpec = Array.from(specStats.values()).sort((a, b) => {
        const encounterDiff = b.encounters.size - a.encounters.size;
        if (encounterDiff !== 0) return encounterDiff;
        const rowDiff = b.rows - a.rows;
        if (rowDiff !== 0) return rowDiff;
        const avgA = a.rankCount > 0 ? a.rankTotal / a.rankCount : -1;
        const avgB = b.rankCount > 0 ? b.rankTotal / b.rankCount : -1;
        return avgB - avgA;
      })[0];

      const hasMetric = (metric: ProfileMetric, specName?: string) =>
        zoneRows.some((row) => row.metric === metric && (!specName || row.specName === specName));

      const preferredMetric: ProfileMetric =
        preferredSpec?.role === "healer"
          ? hasMetric("hps", preferredSpec.specName)
            ? "hps"
            : "dps"
          : hasMetric("dps", preferredSpec?.specName)
            ? "dps"
            : "hps";

      selectedRows.push(
        ...zoneRows.filter((row) => (row.type === overallType || row.encounterId === null || row.encounterId === undefined) && row.metric === preferredMetric),
      );

      const rowsByEncounter = new Map<number, T[]>();
      for (const row of bossRows) {
        if (row.metric !== preferredMetric || typeof row.encounterId !== "number") continue;
        const encounterRows = rowsByEncounter.get(row.encounterId) ?? [];
        encounterRows.push(row);
        rowsByEncounter.set(row.encounterId, encounterRows);
      }

      for (const encounterRows of rowsByEncounter.values()) {
        const preferredSpecRows = preferredSpec ? encounterRows.filter((row) => row.specName === preferredSpec.specName) : [];
        selectedRows.push([...(preferredSpecRows.length > 0 ? preferredSpecRows : encounterRows)].sort((a, b) => this.compareProfileLeaderboardRows(a, b))[0]);
      }
    }

    return selectedRows.sort((a, b) => compareRaidIdsByPriority(a.zoneId, b.zoneId) || this.compareProfileLeaderboardRows(a, b));
  }

  async getCharacterProfileByRealmName(realm: string, name: string, classId?: number): Promise<CharacterProfileLookupResponse | null> {
    const canonicalRouteCharacters = await this.findCanonicalRouteCharacters(realm, name, classId);
    const routeCanonicalIds = canonicalRouteCharacters.map((candidate) => candidate.wclCanonicalCharacterId);
    const exactCharacterMatch =
      routeCanonicalIds.length > 0
        ? { wclCanonicalCharacterId: { $in: routeCanonicalIds } }
        : {
            characterRealm: realm,
            characterName: name,
          };

    const identityRows = await CharacterRaidParticipation.aggregate([
      {
        $match: {
          ...exactCharacterMatch,
          zoneId: { $in: TRACKED_RAIDS },
        },
      },
      { $sort: { lastSeenAt: -1 } },
      {
        $group: {
          _id: {
            classID: "$classID",
          },
          wclCanonicalCharacterIds: { $addToSet: "$wclCanonicalCharacterId" },
          latestWclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
          name: { $first: "$characterName" },
          realm: { $first: "$characterRealm" },
          region: { $first: "$characterRegion" },
          classID: { $first: "$classID" },
          firstSeenAt: { $min: "$firstSeenAt" },
          lastSeenAt: { $max: "$lastSeenAt" },
          reportCount: { $sum: "$reportCount" },
          guilds: { $addToSet: { name: "$reportGuildName", realm: "$reportGuildRealm" } },
          latestGuildName: { $first: "$reportGuildName" },
          latestGuildRealm: { $first: "$reportGuildRealm" },
        },
      },
      {
        $project: {
          _id: 0,
          wclCanonicalCharacterIds: 1,
          latestWclCanonicalCharacterId: 1,
          name: 1,
          realm: 1,
          region: 1,
          classID: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
          reportCount: 1,
          guildCount: { $size: "$guilds" },
          latestGuild: {
            name: "$latestGuildName",
            realm: "$latestGuildRealm",
          },
        },
      },
      { $sort: { lastSeenAt: -1, classID: 1 } },
    ]).collation(CASE_INSENSITIVE_COLLATION);

    const choices = (identityRows as Array<CharacterProfileChoice & { latestWclCanonicalCharacterId?: number | null }>).map(({ latestWclCanonicalCharacterId, ...choice }) => {
      const canonicalIds = (choice.wclCanonicalCharacterIds || []).filter((id): id is number => typeof id === "number");
      const orderedCanonicalIds =
        typeof latestWclCanonicalCharacterId === "number" ? [latestWclCanonicalCharacterId, ...canonicalIds.filter((id) => id !== latestWclCanonicalCharacterId)] : canonicalIds;

      return {
        ...choice,
        wclCanonicalCharacterIds: orderedCanonicalIds,
      };
    });
    if (!classId && choices.length > 1) {
      const canonicalChoice = choices[0];
      const canonicalPath =
        canonicalChoice &&
        (realm.toLocaleLowerCase("en-US") !== canonicalChoice.realm.toLocaleLowerCase("en-US") ||
          name.toLocaleLowerCase("en-US") !== canonicalChoice.name.toLocaleLowerCase("en-US"))
          ? `/characters/${encodeURIComponent(canonicalChoice.realm)}/${encodeURIComponent(canonicalChoice.name)}`
          : null;
      return {
        type: "choices",
        canonicalPath,
        character: {
          name: choices[0]?.name ?? name,
          realm: choices[0]?.realm ?? realm,
        },
        choices,
      };
    }

    const selectedChoice = classId ? choices.find((choice) => choice.classID === classId) : choices[0];

    let timelineRows: any[] = [];
    let rankingRows: any[] = [];
    let mechanicsRows: any[] = [];
    let character: {
      wclCanonicalCharacterId: number | null;
      name: string;
      realm: string;
      region: string;
      classID: number;
    } | null = null;
    let profileCanonicalIds: number[] = [];
    let profileClassId: number | undefined;
    let continuityActive = false;
    let continuityRequestedCharacterId: string | null = null;
    let continuityRootCharacter:
      | (Pick<ICharacter, "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "blizzardIdentityOverride"> & {
          _id: mongoose.Types.ObjectId;
        })
      | null = null;

    if (selectedChoice) {
      const continuity = await this.resolveContinuityContext(selectedChoice.wclCanonicalCharacterIds, selectedChoice.classID, { name, realm });
      const canonicalIds = continuity.canonicalIds;
      profileCanonicalIds = canonicalIds;
      profileClassId = selectedChoice.classID;
      continuityActive = continuity.isCombined;
      continuityRequestedCharacterId = continuity.requestedCharacterId;
      continuityRootCharacter = continuity.rootCharacter;
      character = {
        wclCanonicalCharacterId: continuity.rootCharacter?.wclCanonicalCharacterId ?? canonicalIds[0] ?? null,
        name: continuity.rootCharacter?.name ?? selectedChoice.name,
        realm: continuity.rootCharacter?.realm ?? selectedChoice.realm,
        region: continuity.rootCharacter?.region ?? selectedChoice.region,
        classID: selectedChoice.classID,
      };

      const timelineMatch =
        canonicalIds.length > 0
          ? {
              $or: [{ wclCanonicalCharacterId: { $in: canonicalIds } }, exactCharacterMatch],
              classID: selectedChoice.classID,
              zoneId: { $in: TRACKED_RAIDS },
            }
          : {
              ...exactCharacterMatch,
              classID: selectedChoice.classID,
              zoneId: { $in: TRACKED_RAIDS },
            };

      const [rawTimelineRows, rawRankingRows, rawMechanicsRows] = await Promise.all([
        CharacterRaidParticipation.find(timelineMatch).collation(CASE_INSENSITIVE_COLLATION).sort({ firstSeenAt: 1, zoneId: 1 }).lean(),
        canonicalIds.length > 0
          ? CharacterLeaderboard.find({
              wclCanonicalCharacterId: { $in: canonicalIds },
              classID: selectedChoice.classID,
              zoneId: { $in: TRACKED_RAIDS },
            })
              .sort({ zoneId: -1, score: -1 })
              .lean()
          : Promise.resolve([]),
        canonicalIds.length > 0
          ? CharacterMechanicsLeaderboard.find({
              wclCanonicalCharacterId: { $in: canonicalIds },
              classID: selectedChoice.classID,
              zoneId: { $in: TRACKED_RAIDS },
              deathDataAvailable: true,
              survivalScore: { $ne: null },
            })
              .sort({ zoneId: -1, score: -1 })
              .lean()
          : Promise.resolve([]),
      ]);
      timelineRows = rawTimelineRows;
      rankingRows = this.selectPreferredProfileRows(rawRankingRows as any[], "allstars");
      mechanicsRows = this.selectPreferredProfileRows(rawMechanicsRows as any[], "overall");
    } else {
      const fallbackCharacter =
        canonicalRouteCharacters.find((candidate) => !classId || candidate.classID === classId) ??
        (await Character.findOne({
          $or: [
            { realm, name },
            { "blizzardIdentityOverride.realm": realm, "blizzardIdentityOverride.name": name },
          ],
          ...(classId ? { classID: classId } : {}),
        })
          .collation(CASE_INSENSITIVE_COLLATION)
          .select("wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
          .lean());

      if (!fallbackCharacter) return null;

      const continuity = await this.resolveContinuityContext([fallbackCharacter.wclCanonicalCharacterId], fallbackCharacter.classID, { name, realm });
      continuityActive = continuity.isCombined;
      continuityRequestedCharacterId = continuity.requestedCharacterId;
      continuityRootCharacter = continuity.rootCharacter;
      character = continuity.rootCharacter ?? fallbackCharacter;
      profileCanonicalIds = continuity.canonicalIds;
      profileClassId = fallbackCharacter.classID;

      const [rawTimelineRows, rawRankingRows, rawMechanicsRows] = await Promise.all([
        CharacterRaidParticipation.find({ wclCanonicalCharacterId: { $in: profileCanonicalIds }, classID: profileClassId, zoneId: { $in: TRACKED_RAIDS } })
          .sort({ firstSeenAt: 1, zoneId: 1 })
          .lean(),
        CharacterLeaderboard.find({
          wclCanonicalCharacterId: { $in: profileCanonicalIds },
          classID: profileClassId,
          zoneId: { $in: TRACKED_RAIDS },
        })
          .sort({ zoneId: -1, score: -1 })
          .lean(),
        CharacterMechanicsLeaderboard.find({
          wclCanonicalCharacterId: { $in: profileCanonicalIds },
          classID: profileClassId,
          zoneId: { $in: TRACKED_RAIDS },
          deathDataAvailable: true,
          survivalScore: { $ne: null },
        })
          .sort({ zoneId: -1, score: -1 })
          .lean(),
      ]);
      timelineRows = rawTimelineRows;
      rankingRows = this.selectPreferredProfileRows(rawRankingRows as any[], "allstars");
      mechanicsRows = this.selectPreferredProfileRows(rawMechanicsRows as any[], "overall");
    }

    const latestTimelineRow = [...timelineRows].sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())[0];
    if (latestTimelineRow && !continuityActive) {
      character.name = latestTimelineRow.characterName;
      character.realm = latestTimelineRow.characterRealm;
      character.region = latestTimelineRow.characterRegion;
    }

    const raidIds = Array.from(new Set([...timelineRows.map((row) => row.zoneId), ...rankingRows.map((row: any) => row.zoneId), ...mechanicsRows.map((row: any) => row.zoneId)])).filter(
      (id): id is number => typeof id === "number",
    );
    const raids = await Raid.find({ id: { $in: raidIds } })
      .select("id name -_id")
      .lean();
    const raidNameById = new Map(raids.map((raid) => [raid.id, raid.name]));
    const guildHistoryByGuild = new Map<
      string,
      {
        guildName: string;
        guildRealm: string;
        firstSeenAt: Date;
        lastSeenAt: Date;
      }
    >();

    timelineRows.forEach((row) => {
      const key = `${row.reportGuildName.toLowerCase()}:${row.reportGuildRealm.toLowerCase()}`;
      const existing = guildHistoryByGuild.get(key);

      if (!existing) {
        guildHistoryByGuild.set(key, {
          guildName: row.reportGuildName,
          guildRealm: row.reportGuildRealm,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
        });
        return;
      }

      if (row.firstSeenAt < existing.firstSeenAt) existing.firstSeenAt = row.firstSeenAt;
      if (row.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = row.lastSeenAt;
    });

    const trackedGuildHistory = Array.from(guildHistoryByGuild.values()).sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
    const trackedFirstSeenAt = timelineRows.reduce<Date | undefined>((earliest, row) => (!earliest || row.firstSeenAt < earliest ? row.firstSeenAt : earliest), undefined);
    const trackedLastSeenAt = timelineRows.reduce<Date | undefined>((latest, row) => (!latest || row.lastSeenAt > latest ? row.lastSeenAt : latest), undefined);
    const nameHistory = await CharacterReportAppearance.aggregate([
      {
        $match: {
          ...(profileCanonicalIds.length > 0
            ? { $or: [{ wclCanonicalCharacterId: { $in: profileCanonicalIds } }, exactCharacterMatch] }
            : {
                ...exactCharacterMatch,
              }),
          ...(profileClassId ? { classID: profileClassId } : {}),
        },
      },
      {
        $group: {
          _id: {
            name: "$characterName",
            realm: "$characterRealm",
            region: "$characterRegion",
          },
          name: { $first: "$characterName" },
          realm: { $first: "$characterRealm" },
          region: { $first: "$characterRegion" },
          firstSeenAt: { $min: "$reportStartTime" },
          lastSeenAt: { $max: "$reportStartTime" },
          reportCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          name: 1,
          realm: 1,
          region: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
          reportCount: 1,
        },
      },
      { $sort: { lastSeenAt: -1, name: 1, realm: 1 } },
    ]).collation(CASE_INSENSITIVE_COLLATION);

    let profileCharacterDoc: {
      _id: mongoose.Types.ObjectId;
      name: string;
      realm: string;
      region: string;
      identityObservedAt?: Date | null;
      blizzardIdentityOverride?: { name: string; realm: string; updatedAt: Date } | null;
    } | null = continuityRootCharacter
      ? {
          _id: continuityRootCharacter._id,
          name: continuityRootCharacter.name,
          realm: continuityRootCharacter.realm,
          region: continuityRootCharacter.region,
          identityObservedAt: continuityRootCharacter.identityObservedAt,
          blizzardIdentityOverride: continuityRootCharacter.blizzardIdentityOverride,
        }
      : null;
    if (profileClassId && !profileCharacterDoc) {
      profileCharacterDoc = await Character.findOne({
        name: character.name,
        realm: character.realm,
        region: character.region,
        classID: profileClassId,
      })
        .collation(CASE_INSENSITIVE_COLLATION)
        .select("_id name realm region identityObservedAt blizzardIdentityOverride")
        .lean<{
          _id: mongoose.Types.ObjectId;
          name: string;
          realm: string;
          region: string;
          identityObservedAt?: Date | null;
          blizzardIdentityOverride?: { name: string; realm: string; updatedAt: Date } | null;
        }>();

      if (!profileCharacterDoc && profileCanonicalIds.length > 0) {
        profileCharacterDoc = await Character.findOne({
          wclCanonicalCharacterId: { $in: profileCanonicalIds },
          classID: profileClassId,
        })
          .sort({ lastMythicSeenAt: -1 })
          .select("_id name realm region identityObservedAt blizzardIdentityOverride")
          .lean<{
            _id: mongoose.Types.ObjectId;
            name: string;
            realm: string;
            region: string;
            identityObservedAt?: Date | null;
            blizzardIdentityOverride?: { name: string; realm: string; updatedAt: Date } | null;
          }>();
      }
    }

    if (profileCharacterDoc?.blizzardIdentityOverride) {
      Object.assign(
        character,
        resolveBlizzardCharacterIdentity(
          profileCharacterDoc,
          latestTimelineRow
            ? {
                name: latestTimelineRow.characterName,
                realm: latestTimelineRow.characterRealm,
                region: latestTimelineRow.characterRegion,
                observedAt: latestTimelineRow.lastSeenAt,
              }
            : null,
        ),
      );
    }

    const accountGroup = profileCharacterDoc
      ? await CharacterAccountGroup.findOne({
          signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
          characterIds: profileCharacterDoc._id,
        }).lean()
      : null;
    const profileMedia = profileCharacterDoc ? await CharacterMedia.findOne({ characterId: profileCharacterDoc._id }).select("avatarUrl status").lean() : null;
    if (profileCharacterDoc && (!profileMedia || profileMedia.status !== "available")) {
      void characterMediaService.enqueueCharacter(String(profileCharacterDoc._id)).catch((error) =>
        logger.warn(`[CharacterMedia] Failed to enqueue ${character.name}-${character.realm}: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    const accountCharacters = accountGroup ? await this.buildAccountCharacters([...(accountGroup.members ?? [])]) : [];
    const profileRaidAchievementRow = profileCharacterDoc
      ? await CharacterRaidAchievementSummary.findOne({
          characterId: profileCharacterDoc._id,
          version: CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION,
        }).lean<ICharacterRaidAchievementSummary>()
      : null;
    const profileRaidAchievements = this.formatRaidAchievementSummary(profileRaidAchievementRow);
    const mythicPlus = profileCharacterDoc ? await mythicPlusService.getCharacterProfileMythicPlus(profileCharacterDoc._id) : { seasons: [] };
    const routeMatchesCanonicalIdentity =
      realm.toLocaleLowerCase("en-US") === character.realm.toLocaleLowerCase("en-US") &&
      name.toLocaleLowerCase("en-US") === character.name.toLocaleLowerCase("en-US");
    const canonicalPath =
      (continuityRootCharacter && continuityRequestedCharacterId && continuityRequestedCharacterId !== String(continuityRootCharacter._id)) || !routeMatchesCanonicalIdentity
        ? `/characters/${encodeURIComponent(character.realm)}/${encodeURIComponent(character.name)}`
        : null;

    return {
      type: "profile",
      canonicalPath,
      character: {
        wclCanonicalCharacterId: character.wclCanonicalCharacterId,
        name: character.name,
        realm: character.realm,
        region: character.region,
        classID: character.classID,
        media: profileMedia?.status === "available" ? { avatarUrl: profileMedia.avatarUrl ?? null } : null,
        firstReportSeenAt: trackedFirstSeenAt,
        lastReportSeenAt: trackedLastSeenAt,
        guildHistory: trackedGuildHistory.map((entry) => ({
          guildName: entry.guildName,
          guildRealm: entry.guildRealm,
          firstSeenAt: entry.firstSeenAt,
          lastSeenAt: entry.lastSeenAt,
        })),
        nameHistory,
        raidAchievements: profileRaidAchievements,
        account: accountGroup
          ? {
              groupId: accountGroup._id.toString(),
              slug: accountGroup.slug ?? accountGroup._id.toString(),
              displayName: accountGroup.displayName ?? accountGroup.members[0]?.name ?? null,
              signalVersion: accountGroup.signalVersion,
              generatedAt: accountGroup.generatedAt,
              totalReportCount: accountGroup.totalReportCount ?? 0,
              minScore: accountGroup.minScore,
              maxScore: accountGroup.maxScore,
              avgScore: accountGroup.avgScore,
              characters: accountCharacters,
            }
          : undefined,
      },
      raidTimeline: timelineRows.map((row) => ({
        zoneId: row.zoneId,
        raidName: raidNameById.get(row.zoneId) || `Raid ${row.zoneId}`,
        guildId: row.reportGuildId.toString(),
        guildName: row.reportGuildName,
        guildRealm: row.reportGuildRealm,
        characterName: row.characterName,
        characterRealm: row.characterRealm,
        characterRegion: row.characterRegion,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        reportCount: row.reportCount,
      })),
      rankings: rankingRows.map((row: any) => ({
        zoneId: row.zoneId,
        raidName: raidNameById.get(row.zoneId) || `Raid ${row.zoneId}`,
        encounterId: row.encounterId ?? null,
        encounterName: row.encounterName || null,
        metric: row.metric ?? null,
        role: row.role ?? null,
        specName: row.specName ?? null,
        rankPercent: row.rankPercent ?? null,
        score: row.score ?? 0,
        partition: row.partition ?? null,
        updatedAt: row.updatedAt,
      })),
      mechanics: mechanicsRows.map((row: any) => ({
        zoneId: row.zoneId,
        raidName: raidNameById.get(row.zoneId) || `Raid ${row.zoneId}`,
        encounterId: row.encounterId ?? null,
        encounterName: row.encounterName || null,
        metric: row.metric ?? null,
        role: row.role ?? null,
        specName: row.specName ?? null,
        rankPercent: row.rankPercent ?? null,
        score: row.score ?? 0,
        parseScore: row.parseScore ?? null,
        survivalScore: row.survivalScore ?? null,
        survivalPercentile: row.survivalPercentile ?? null,
        pulls: row.pulls ?? 0,
        evaluatedPulls: row.evaluatedPulls ?? row.pulls ?? 0,
        deaths: row.deaths ?? 0,
        survivedPulls: row.survivedPulls ?? 0,
        earlyDeaths: row.earlyDeaths ?? 0,
        averageDeathPercent: row.averageDeathPercent ?? null,
        deathDataAvailable: row.deathDataAvailable === true,
        identityMethod: row.identityMethod ?? null,
        identityConfidence: row.identityConfidence ?? null,
        scoreVersion: row.scoreVersion ?? 1,
        raidFightCoverage: row.raidFightCoverage ?? 0,
        updatedAt: row.updatedAt,
      })),
      mythicPlus,
    };
  }

  async getCharacterRaidReportsByRealmName(realm: string, name: string, zoneId: number, guildId: string, classId?: number): Promise<CharacterRaidReportsResponse | null> {
    if (!mongoose.Types.ObjectId.isValid(guildId)) return null;

    const reportGuildId = new mongoose.Types.ObjectId(guildId);
    const canonicalRouteCharacters = await this.findCanonicalRouteCharacters(realm, name, classId);
    const routeCanonicalIds = canonicalRouteCharacters.map((candidate) => candidate.wclCanonicalCharacterId);
    const exactCharacterMatch =
      routeCanonicalIds.length > 0
        ? { wclCanonicalCharacterId: { $in: routeCanonicalIds } }
        : {
            characterRealm: realm,
            characterName: name,
          };
    const participationRows = await CharacterRaidParticipation.find({
      ...exactCharacterMatch,
      reportGuildId,
      zoneId,
      ...(classId ? { classID: classId } : {}),
    })
      .collation(CASE_INSENSITIVE_COLLATION)
      .select("wclCanonicalCharacterId classID -_id")
      .lean();
    let canonicalIds = Array.from(new Set(participationRows.map((row) => row.wclCanonicalCharacterId).filter((id): id is number => typeof id === "number")));
    const participationClassIds = Array.from(new Set(participationRows.map((row) => row.classID).filter((id): id is number => typeof id === "number")));
    const continuityClassId = classId ?? participationClassIds[0];
    if (canonicalIds.length > 0 && continuityClassId) {
      canonicalIds = (await this.resolveContinuityContext(canonicalIds, continuityClassId, { name, realm })).canonicalIds;
    }
    const appearanceMatch =
      canonicalIds.length > 0
        ? {
            wclCanonicalCharacterId: { $in: canonicalIds },
            reportGuildId,
            ...(classId ? { classID: classId } : participationClassIds.length > 0 ? { classID: { $in: participationClassIds } } : {}),
          }
        : {
            ...exactCharacterMatch,
            reportGuildId,
            ...(classId ? { classID: classId } : {}),
          };

    const [raid, appearanceRows] = await Promise.all([
      Raid.findOne({ id: zoneId }).select("id name -_id").lean(),
      CharacterReportAppearance.aggregate([
        {
          $match: appearanceMatch,
        },
        {
          $lookup: {
            from: "reports",
            let: { reportCode: "$reportCode", guildId: "$reportGuildId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$code", "$$reportCode"] }, { $eq: ["$guildId", "$$guildId"] }, { $eq: ["$zoneId", zoneId] }],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  code: 1,
                  startTime: 1,
                  endTime: 1,
                  isOngoing: 1,
                  fightCount: 1,
                  encounterFights: 1,
                },
              },
            ],
            as: "report",
          },
        },
        { $unwind: "$report" },
        { $sort: { reportStartTime: -1, reportCode: 1 } },
        {
          $project: {
            _id: 0,
            wclCanonicalCharacterId: 1,
            characterName: 1,
            characterRealm: 1,
            characterRegion: 1,
            reportGuildName: 1,
            reportGuildRealm: 1,
            report: 1,
          },
        },
      ]).collation(CASE_INSENSITIVE_COLLATION),
    ]);

    if (!appearanceRows.length) return null;

    const firstAppearance = appearanceRows[0];
    const guildName = appearanceRows[0]?.reportGuildName ?? "";
    const guildRealm = appearanceRows[0]?.reportGuildRealm ?? "";

    return {
      character: {
        wclCanonicalCharacterId: firstAppearance.wclCanonicalCharacterId ?? null,
        name: firstAppearance.characterName,
        realm: firstAppearance.characterRealm,
        region: firstAppearance.characterRegion,
      },
      raid: raid ? { id: raid.id, name: raid.name } : null,
      guild: {
        id: guildId,
        name: guildName,
        realm: guildRealm,
      },
      reports: appearanceRows.map((row) => {
        const report = row.report;
        const encounterFights = Object.values(report.encounterFights ?? {}) as Array<{ kills?: number; wipes?: number }>;
        const kills = encounterFights.reduce((total, encounter) => total + (Number(encounter.kills) || 0), 0);
        const wipes = encounterFights.reduce((total, encounter) => total + (Number(encounter.wipes) || 0), 0);
        const durationSeconds = report.endTime && report.startTime ? Math.max(0, Math.round((report.endTime - report.startTime) / 1000)) : undefined;

        return {
          code: report.code,
          url: `https://www.warcraftlogs.com/reports/${report.code}`,
          startTime: report.startTime,
          endTime: report.endTime,
          isOngoing: report.isOngoing,
          durationSeconds,
          fightCount: report.fightCount,
          kills,
          wipes,
        };
      }),
    };
  }

  // Check and update character rankings (nightly job)
  async checkAndRefreshCharacterRankings(): Promise<void> {
    logger.info("Starting character ranking check and update...");

    const CURRENT_TIER_ID = PRIMARY_RAID_ID;
    const MYTHIC_DIFFICULTY = 5;
    const BATCH_SIZE = 200;
    const MAX_WCL_REQUESTS_PER_RUN = 20000;
    // Pause when 90% of WCL hourly budget is consumed, leaving 10% for live/other operations
    const RATE_LIMIT_PAUSE_PERCENT = 90;

    try {
      const raid = await Raid.findOne({ id: CURRENT_TIER_ID }).select("partitions").lean();
      const partition = (raid?.partitions || []).reduce((max: number, entry: any) => (typeof entry?.id === "number" && entry.id > max ? entry.id : max), -1);
      logger.info(`[CharacterRankings] Using partition ${partition} for zone ${CURRENT_TIER_ID}`);

      // Find eligible characters
      const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const eligibleFilter: any = {
        // Eligible if lastMythicSeenAt within 14 days, rankingsAvailable not false and cooldown passed
        lastMythicSeenAt: { $gte: cutoffDate },
        rankingsAvailable: { $ne: false },
        nextEligibleRefreshAt: { $lte: new Date() },
      };

      // Count total eligible characters for progress tracking
      const totalEligibleCount = await Character.countDocuments(eligibleFilter);
      logger.info(`[CharacterRankings] Found ${totalEligibleCount} eligible characters to process`);

      let processedCount = 0;
      let batchIndex = 0;
      const processedCharacterIds = new Set<string>();
      let charactersProcessedThisRun = 0;

      while (processedCount < MAX_WCL_REQUESTS_PER_RUN) {
        const remaining = MAX_WCL_REQUESTS_PER_RUN - processedCount;
        const batchSize = Math.min(BATCH_SIZE, remaining);

        // Exclude already-processed characters so the query returns fresh ones
        const batchFilter =
          processedCharacterIds.size > 0 ? { ...eligibleFilter, _id: { $nin: Array.from(processedCharacterIds).map((id) => new mongoose.Types.ObjectId(id)) } } : eligibleFilter;

        const eligibleChars = await Character.aggregate([
          { $match: batchFilter },
          {
            $sort: {
              lastMythicSeenAt: -1,
              updatedAt: 1,
            },
          },
          { $limit: batchSize },
        ]);

        if (eligibleChars.length === 0) {
          logger.info(`[CharacterRankings] No more characters found in batch, stopping`);
          break;
        }

        batchIndex += 1;
        logger.info(
          `[CharacterRankings] Processing batch ${batchIndex}: ${eligibleChars.length} characters fetched (processed ${processedCount}/${MAX_WCL_REQUESTS_PER_RUN} requests, ${charactersProcessedThisRun}/${totalEligibleCount} characters)`,
        );

        for (const char of eligibleChars) {
          // Skip if we've already processed this character in this run
          const charId = String(char._id);
          if (processedCharacterIds.has(charId)) {
            logger.debug(`[CharacterRankings] Skipping already processed character ${char.name} (${char.realm})`);
            continue;
          }

          if (processedCount >= MAX_WCL_REQUESTS_PER_RUN) {
            logger.info(`[CharacterRankings] Reached request limit (${MAX_WCL_REQUESTS_PER_RUN}), stopping`);
            break;
          }

          processedCharacterIds.add(charId);
          charactersProcessedThisRun += 1;
          logger.info(`[CharacterRankings] Processing character ${charactersProcessedThisRun}/${totalEligibleCount}: ${char.name} (${char.realm})`);

          const classSpecMap = ROLE_BY_CLASS_AND_SPEC[char.classID] ?? {};
          const specSlugs = Object.keys(classSpecMap);
          if (specSlugs.length === 0) {
            logger.warn(`[CharacterRankings] No spec mappings found for classID ${char.classID} (${char.name}, ${char.realm})`);
            await Character.findByIdAndUpdate(char._id, {
              nextEligibleRefreshAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
            });
            continue;
          }

          // Check rate limit before WCL API call — wait for reset if near threshold
          if (rateLimitService.getPercentUsed() >= RATE_LIMIT_PAUSE_PERCENT) {
            const resetMs = rateLimitService.getTimeUntilReset();
            logger.info(
              `[CharacterRankings] Rate limit at ${rateLimitService.getPercentUsed().toFixed(1)}%, pausing for ${Math.ceil(resetMs / 1000)}s until reset (processed ${processedCount} so far)`,
            );
            await rateLimitService.waitForReset();
            logger.info(`[CharacterRankings] Rate limit reset, resuming`);
          }

          try {
            // Build a single query with aliased zoneRankings per spec.
            // Each alias fetches rankings for one spec, avoiding N+1 API calls.
            const specAliasFields = specSlugs.map((slug) => {
              const wclName = toWclSpecName(slug);
              const alias = toSpecAlias(slug);
              return `${alias}: zoneRankings(zoneID: $zoneID, difficulty: ${MYTHIC_DIFFICULTY}, metric: dps, compare: Rankings, timeframe: Historical, partition: ${partition}, specName: "${wclName}")`;
            });

            const query = `
              query($serverSlug: String!, $serverRegion: String!, $characterName: String!, $zoneID: Int!) {
                rateLimitData {
                  limitPerHour
                  pointsSpentThisHour
                  pointsResetIn
                }
                characterData {
                  character(
                    name: $characterName,
                    serverSlug: $serverSlug,
                    serverRegion: $serverRegion
                  ) {
                    id
                    canonicalID
                    name
                    classID
                    hidden
                    ${specAliasFields.join("\n                    ")}
                  }
                }
              }
            `;

            const variables = {
              characterName: char.name,
              serverSlug: char.realm.toLowerCase().replace(/\s+/g, "-"),
              serverRegion: char.region.toLowerCase(),
              zoneID: CURRENT_TIER_ID,
            };

            processedCount += 1;

            const result = await wclService.query<IWarcraftLogsResponse>(query, variables);

            const character = result.characterData?.character;
            if (!character || character.hidden) {
              await Character.findByIdAndUpdate(char._id, {
                wclProfileHidden: character?.hidden || false,
                rankingsAvailable: false,
                nextEligibleRefreshAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              });
              await Ranking.deleteMany({ characterId: char._id });
              logger.info(`[CharacterRankings] No rankings available for ${char.name} (${char.realm}) — hidden or missing`);
              await new Promise((resolve) => setTimeout(resolve, 100));
              continue;
            }

            let hasAnySpecRankings = false;

            // Process each spec's aliased zoneRankings from the single response
            for (const specSlug of specSlugs) {
              const alias = toSpecAlias(specSlug);
              const zoneRankings = (character as Record<string, unknown>)[alias] as IWarcraftLogsZoneRankings | null;

              if (!zoneRankings || (zoneRankings as any).error) {
                await Ranking.deleteMany({
                  characterId: char._id,
                  zoneId: CURRENT_TIER_ID,
                  difficulty: MYTHIC_DIFFICULTY,
                  partition,
                  specName: specSlug,
                  metric: "dps",
                });
                logger.debug(`[CharacterRankings] No rankings for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
                continue;
              }

              // Data is already filtered to this spec by WCL — use directly
              const allStarsEntries = zoneRankings.allStars ?? [];
              const rankingsEntries = zoneRankings.rankings ?? [];

              if (allStarsEntries.length === 0 && rankingsEntries.length === 0) {
                await Ranking.deleteMany({
                  characterId: char._id,
                  zoneId: CURRENT_TIER_ID,
                  difficulty: MYTHIC_DIFFICULTY,
                  partition: zoneRankings.partition,
                  specName: specSlug,
                  metric: "dps",
                });
                logger.debug(`[CharacterRankings] No rankings for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
                continue;
              }

              hasAnySpecRankings = true;

              // Check if rankings have changed by comparing with stored Ranking docs.
              // Compare both allStars totals AND per-boss bestAmount/rankPercent/totalKills
              // so that bosses excluded from allStars scoring are still detected as changed.
              const existingRankings = await Ranking.find({
                characterId: char._id,
                zoneId: CURRENT_TIER_ID,
                difficulty: MYTHIC_DIFFICULTY,
                partition: zoneRankings.partition,
                specName: specSlug,
                metric: "dps",
              }).lean();

              const freshPoints = allStarsEntries.reduce((sum, a) => sum + (a.points ?? 0), 0);
              const freshPossiblePoints = allStarsEntries.reduce((sum, a) => sum + (a.possiblePoints ?? 0), 0);
              const storedPoints = existingRankings.reduce((sum, r: any) => sum + (r.allStars?.points ?? 0), 0);
              const storedPossiblePoints = existingRankings.reduce((sum, r: any) => sum + (r.allStars?.possiblePoints ?? 0), 0);

              const allStarsChanged = freshPoints !== storedPoints || freshPossiblePoints !== storedPossiblePoints;

              // Build a fingerprint of per-boss data so non-allStars bosses are also detected
              const freshBossFingerprint = rankingsEntries
                .map((r) => `${r.encounter.id}:${r.bestAmount ?? 0}:${r.rankPercent ?? 0}:${r.totalKills ?? 0}`)
                .sort()
                .join("|");
              const storedBossFingerprint = existingRankings
                .map((r: any) => `${r.encounter?.id}:${r.bestAmount ?? 0}:${r.rankPercent ?? 0}:${r.totalKills ?? 0}`)
                .sort()
                .join("|");

              const hasChanged = existingRankings.length === 0 || allStarsChanged || freshBossFingerprint !== storedBossFingerprint;

              if (!hasChanged) {
                logger.debug(`[CharacterRankings] No changes for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
                continue;
              }

              // Upsert rankings for this spec
              for (const r of rankingsEntries) {
                const rankingSpecSlug = r.spec ? slugifySpecName(r.spec) : specSlug;
                const role = resolveRole(char.classID, rankingSpecSlug);
                const normalizedBestSpecName = r.bestSpec ? slugifySpecName(r.bestSpec) : rankingSpecSlug;
                const rankingPartition = r.allStars?.partition ?? zoneRankings.partition ?? partition;

                await Ranking.findOneAndUpdate(
                  {
                    characterId: char._id,
                    zoneId: CURRENT_TIER_ID,
                    difficulty: MYTHIC_DIFFICULTY,
                    partition: rankingPartition,
                    "encounter.id": r.encounter.id,
                    specName: specSlug,
                    metric: "dps",
                  },
                  {
                    characterId: char._id,
                    wclCanonicalCharacterId: character.canonicalID,

                    name: char.name,
                    realm: char.realm,
                    region: char.region,
                    classID: char.classID,

                    zoneId: CURRENT_TIER_ID,
                    difficulty: MYTHIC_DIFFICULTY,
                    partition: rankingPartition,
                    metric: "dps",

                    encounter: {
                      id: r.encounter.id,
                      name: r.encounter.name,
                    },

                    specName: rankingSpecSlug,
                    role,

                    bestSpecName: normalizedBestSpecName,

                    rankPercent: r.rankPercent ?? 0,
                    medianPercent: r.medianPercent ?? 0,
                    lockedIn: r.lockedIn,
                    totalKills: r.totalKills,
                    bestAmount: r.bestAmount ?? 0,

                    allStars: r.allStars
                      ? {
                          points: typeof r.allStars.points === "number" ? r.allStars.points : 0,
                          possiblePoints: typeof r.allStars.possiblePoints === "number" ? r.allStars.possiblePoints : 0,
                        }
                      : { points: 0, possiblePoints: 0 },

                    ilvl: r.bestRank?.ilvl,
                  },
                  { upsert: true, new: true },
                );
              }

              logger.info(`[CharacterRankings] Updated rankings for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
            }

            // ── HPS rankings for healer specs ─────────────────────────
            const healerSpecSlugs = specSlugs.filter((slug) => classSpecMap[slug] === "healer");

            if (healerSpecSlugs.length > 0) {
              if (rateLimitService.getPercentUsed() >= RATE_LIMIT_PAUSE_PERCENT) {
                const resetMs = rateLimitService.getTimeUntilReset();
                logger.info(`[CharacterRankings] Rate limit at ${rateLimitService.getPercentUsed().toFixed(1)}%, pausing for ${Math.ceil(resetMs / 1000)}s before HPS query`);
                await rateLimitService.waitForReset();
                logger.info(`[CharacterRankings] Rate limit reset, resuming`);
              }

              const hpsSpecAliasFields = healerSpecSlugs.map((slug) => {
                const wclName = toWclSpecName(slug);
                const alias = toSpecAlias(slug);
                return `${alias}: zoneRankings(zoneID: $zoneID, difficulty: ${MYTHIC_DIFFICULTY}, metric: hps, compare: Rankings, timeframe: Historical, partition: ${partition}, specName: "${wclName}")`;
              });

              const hpsQuery = `
                query($serverSlug: String!, $serverRegion: String!, $characterName: String!, $zoneID: Int!) {
                  rateLimitData {
                    limitPerHour
                    pointsSpentThisHour
                    pointsResetIn
                  }
                  characterData {
                    character(
                      name: $characterName,
                      serverSlug: $serverSlug,
                      serverRegion: $serverRegion
                    ) {
                      id
                      canonicalID
                      name
                      classID
                      hidden
                      ${hpsSpecAliasFields.join("\n                      ")}
                    }
                  }
                }
              `;

              processedCount += 1;

              const hpsResult = await wclService.query<IWarcraftLogsResponse>(hpsQuery, variables);
              const hpsCharacter = hpsResult.characterData?.character;

              if (hpsCharacter && !hpsCharacter.hidden) {
                for (const specSlug of healerSpecSlugs) {
                  const alias = toSpecAlias(specSlug);
                  const hpsZoneRankings = (hpsCharacter as Record<string, unknown>)[alias] as IWarcraftLogsZoneRankings | null;

                  if (!hpsZoneRankings || (hpsZoneRankings as any).error) {
                    await Ranking.deleteMany({
                      characterId: char._id,
                      zoneId: CURRENT_TIER_ID,
                      difficulty: MYTHIC_DIFFICULTY,
                      partition,
                      specName: specSlug,
                      metric: "hps",
                    });
                    logger.debug(`[CharacterRankings] No HPS rankings for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
                    continue;
                  }

                  const hpsAllStarsEntries = hpsZoneRankings.allStars ?? [];
                  const hpsRankingsEntries = hpsZoneRankings.rankings ?? [];

                  if (hpsAllStarsEntries.length === 0 && hpsRankingsEntries.length === 0) {
                    await Ranking.deleteMany({
                      characterId: char._id,
                      zoneId: CURRENT_TIER_ID,
                      difficulty: MYTHIC_DIFFICULTY,
                      partition: hpsZoneRankings.partition,
                      specName: specSlug,
                      metric: "hps",
                    });
                    logger.debug(`[CharacterRankings] No HPS rankings for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
                    continue;
                  }

                  const existingHpsRankings = await Ranking.find({
                    characterId: char._id,
                    zoneId: CURRENT_TIER_ID,
                    difficulty: MYTHIC_DIFFICULTY,
                    partition: hpsZoneRankings.partition,
                    specName: specSlug,
                    metric: "hps",
                  }).lean();

                  const freshHpsPoints = hpsAllStarsEntries.reduce((sum, a) => sum + (a.points ?? 0), 0);
                  const freshHpsPossiblePoints = hpsAllStarsEntries.reduce((sum, a) => sum + (a.possiblePoints ?? 0), 0);
                  const storedHpsPoints = existingHpsRankings.reduce((sum, r: any) => sum + (r.allStars?.points ?? 0), 0);
                  const storedHpsPossiblePoints = existingHpsRankings.reduce((sum, r: any) => sum + (r.allStars?.possiblePoints ?? 0), 0);

                  const hpsAllStarsChanged = freshHpsPoints !== storedHpsPoints || freshHpsPossiblePoints !== storedHpsPossiblePoints;

                  const freshHpsFingerprint = hpsRankingsEntries
                    .map((r) => `${r.encounter.id}:${r.bestAmount ?? 0}:${r.rankPercent ?? 0}:${r.totalKills ?? 0}`)
                    .sort()
                    .join("|");
                  const storedHpsFingerprint = existingHpsRankings
                    .map((r: any) => `${r.encounter?.id}:${r.bestAmount ?? 0}:${r.rankPercent ?? 0}:${r.totalKills ?? 0}`)
                    .sort()
                    .join("|");

                  const hpsHasChanged = existingHpsRankings.length === 0 || hpsAllStarsChanged || freshHpsFingerprint !== storedHpsFingerprint;

                  if (!hpsHasChanged) {
                    logger.debug(`[CharacterRankings] No HPS changes for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
                    continue;
                  }

                  for (const r of hpsRankingsEntries) {
                    const rankingSpecSlug = r.spec ? slugifySpecName(r.spec) : specSlug;
                    const role = resolveRole(char.classID, rankingSpecSlug);
                    const normalizedBestSpecName = r.bestSpec ? slugifySpecName(r.bestSpec) : rankingSpecSlug;
                    const rankingPartition = r.allStars?.partition ?? hpsZoneRankings.partition ?? partition;

                    await Ranking.findOneAndUpdate(
                      {
                        characterId: char._id,
                        zoneId: CURRENT_TIER_ID,
                        difficulty: MYTHIC_DIFFICULTY,
                        partition: rankingPartition,
                        "encounter.id": r.encounter.id,
                        specName: specSlug,
                        metric: "hps",
                      },
                      {
                        characterId: char._id,
                        wclCanonicalCharacterId: hpsCharacter.canonicalID,

                        name: char.name,
                        realm: char.realm,
                        region: char.region,
                        classID: char.classID,

                        zoneId: CURRENT_TIER_ID,
                        difficulty: MYTHIC_DIFFICULTY,
                        partition: rankingPartition,
                        metric: "hps",

                        encounter: {
                          id: r.encounter.id,
                          name: r.encounter.name,
                        },

                        specName: rankingSpecSlug,
                        role,

                        bestSpecName: normalizedBestSpecName,

                        rankPercent: r.rankPercent ?? 0,
                        medianPercent: r.medianPercent ?? 0,
                        lockedIn: r.lockedIn,
                        totalKills: r.totalKills,
                        bestAmount: r.bestAmount ?? 0,

                        allStars: r.allStars
                          ? {
                              points: typeof r.allStars.points === "number" ? r.allStars.points : 0,
                              possiblePoints: typeof r.allStars.possiblePoints === "number" ? r.allStars.possiblePoints : 0,
                            }
                          : { points: 0, possiblePoints: 0 },

                        ilvl: r.bestRank?.ilvl,
                      },
                      { upsert: true, new: true },
                    );
                  }

                  hasAnySpecRankings = true;
                  logger.info(`[CharacterRankings] Updated HPS rankings for ${char.name} (${char.realm}) [spec: ${specSlug}]`);
                }
              }
            }

            if (hasAnySpecRankings) {
              await Character.findByIdAndUpdate(char._id, {
                rankingsAvailable: true,
                nextEligibleRefreshAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
              });
            } else {
              await Character.findByIdAndUpdate(char._id, {
                rankingsAvailable: false,
                nextEligibleRefreshAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              });
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            logger.error(`[CharacterRankings] Error checking rankings for ${char.name} (${char.realm}):`, error);
            // Set a short cooldown so errored characters don't block subsequent batches
            await Character.findByIdAndUpdate(char._id, {
              nextEligibleRefreshAt: new Date(Date.now() + 1 * 60 * 60 * 1000),
            }).catch(() => {});
          }
        }

        // Break if we've processed all eligible characters
        if (charactersProcessedThisRun >= totalEligibleCount) {
          logger.info(`[CharacterRankings] Processed all ${totalEligibleCount} eligible characters, stopping`);
          break;
        }
      }

      logger.info(`[CharacterRankings] Character ranking check completed: processed ${processedCount} API requests for ${charactersProcessedThisRun} characters`);

      logger.info("[CharacterRankings] Character ranking check and update completed");
    } catch (error) {
      logger.error("[CharacterRankings] Error in character ranking check:", error);
    }
  }

  /**
   * Rebuild the materialized CharacterLeaderboard collection from Ranking data.
   * Creates one document per character per leaderboard view.
   * Should be called after nightly rankings refresh completes.
   */
  async buildCharacterLeaderboards(): Promise<void> {
    const CURRENT_TIER_ID = PRIMARY_RAID_ID;
    const MYTHIC_DIFFICULTY = 5;
    const startTime = Date.now();

    logger.info("[Leaderboard] Starting leaderboard build...");

    try {
      // Discover distinct encounters, partitions, and metrics in the current tier
      const encounterIds: number[] = await Ranking.distinct("encounter.id", { zoneId: CURRENT_TIER_ID, difficulty: MYTHIC_DIFFICULTY });
      const partitions: number[] = await Ranking.distinct("partition", { zoneId: CURRENT_TIER_ID, difficulty: MYTHIC_DIFFICULTY });

      logger.info(`[Leaderboard] Found ${encounterIds.length} encounters, ${partitions.length} partitions`);

      // Build a raid-scoped guild map once (characterId → guild with the most reports)
      const allCharacterIds = await Ranking.distinct("characterId", { zoneId: CURRENT_TIER_ID, difficulty: MYTHIC_DIFFICULTY });
      const guildMap = await getPrimaryCharacterRaidGuilds(CURRENT_TIER_ID, allCharacterIds);

      const entries: any[] = [];

      // ── Boss leaderboards (per encounter × per partition × per metric) ─
      for (const encId of encounterIds) {
        for (const part of partitions) {
          // Group by (characterId, metric) to keep only the best spec per character per metric.
          // WCL canonical IDs can be shared across different classes, so canonical ID alone is not a safe identity key.
          const rows = await Ranking.aggregate([
            {
              $match: {
                zoneId: CURRENT_TIER_ID,
                difficulty: MYTHIC_DIFFICULTY,
                partition: part,
                "encounter.id": encId,
                bestAmount: { $ne: 0 },
                metric: { $ne: null },
              },
            },
            { $sort: { bestAmount: -1, rankPercent: -1, totalKills: -1 } },
            {
              $group: {
                _id: { characterId: "$characterId", metric: "$metric" },
                characterId: { $first: "$characterId" },
                wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
                name: { $first: "$name" },
                realm: { $first: "$realm" },
                region: { $first: "$region" },
                classID: { $first: "$classID" },
                specName: { $first: "$specName" },
                bestSpecName: { $first: "$bestSpecName" },
                role: { $first: "$role" },
                metric: { $first: "$metric" },
                ilvl: { $first: "$ilvl" },
                bestAmount: { $first: "$bestAmount" },
                encounterName: { $first: "$encounter.name" },
                rankPercent: { $first: "$rankPercent" },
                medianPercent: { $first: "$medianPercent" },
                lockedIn: { $first: "$lockedIn" },
                totalKills: { $first: "$totalKills" },
                updatedAt: { $first: "$updatedAt" },
              },
            },
          ]);

          for (const r of rows) {
            const guild = guildMap.get(String(r.characterId));
            entries.push({
              zoneId: CURRENT_TIER_ID,
              difficulty: MYTHIC_DIFFICULTY,
              type: "boss",
              encounterId: encId,
              partition: part,
              metric: r.metric ?? "dps",
              characterId: r.characterId,
              wclCanonicalCharacterId: r.wclCanonicalCharacterId,
              name: r.name,
              realm: r.realm,
              region: r.region,
              classID: r.classID,
              specName: r.specName,
              bestSpecName: r.bestSpecName,
              role: r.role,
              ilvl: r.ilvl ?? 0,
              score: r.bestAmount,
              encounterName: r.encounterName,
              rankPercent: r.rankPercent,
              medianPercent: r.medianPercent,
              lockedIn: r.lockedIn,
              totalKills: r.totalKills,
              bestAmount: r.bestAmount,
              allStarsPoints: 0,
              allStarsPossiblePoints: 0,
              bossScores: [],
              guildName: guild?.name ?? null,
              guildRealm: guild?.realm ?? null,
              sourcePartition: part,
              updatedAt: r.updatedAt ?? new Date(),
            });
          }
        }

        // Boss + all partitions (best per character per metric across partitions)
        const bestPerChar = await Ranking.aggregate([
          { $match: { zoneId: CURRENT_TIER_ID, difficulty: MYTHIC_DIFFICULTY, "encounter.id": encId, metric: { $ne: null } } },
          { $sort: { bestAmount: -1, rankPercent: -1, totalKills: -1, partition: -1 } },
          {
            $group: {
              _id: { characterId: "$characterId", metric: "$metric" },
              characterId: { $first: "$characterId" },
              wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
              name: { $first: "$name" },
              realm: { $first: "$realm" },
              region: { $first: "$region" },
              classID: { $first: "$classID" },
              specName: { $first: "$specName" },
              bestSpecName: { $first: "$bestSpecName" },
              role: { $first: "$role" },
              metric: { $first: "$metric" },
              ilvl: { $first: "$ilvl" },
              bestAmount: { $first: "$bestAmount" },
              encounterName: { $first: "$encounter.name" },
              rankPercent: { $first: "$rankPercent" },
              medianPercent: { $first: "$medianPercent" },
              lockedIn: { $first: "$lockedIn" },
              totalKills: { $first: "$totalKills" },
              partition: { $first: "$partition" },
              updatedAt: { $first: "$updatedAt" },
            },
          },
          { $match: { bestAmount: { $ne: 0 } } },
        ]);

        for (const r of bestPerChar) {
          const guild = guildMap.get(String(r.characterId));
          entries.push({
            zoneId: CURRENT_TIER_ID,
            difficulty: MYTHIC_DIFFICULTY,
            type: "boss",
            encounterId: encId,
            partition: null,
            metric: r.metric ?? "dps",
            characterId: r.characterId,
            wclCanonicalCharacterId: r.wclCanonicalCharacterId,
            name: r.name,
            realm: r.realm,
            region: r.region,
            classID: r.classID,
            specName: r.specName,
            bestSpecName: r.bestSpecName,
            role: r.role,
            ilvl: r.ilvl ?? 0,
            score: r.bestAmount,
            encounterName: r.encounterName,
            rankPercent: r.rankPercent,
            medianPercent: r.medianPercent,
            lockedIn: r.lockedIn,
            totalKills: r.totalKills,
            bestAmount: r.bestAmount,
            allStarsPoints: 0,
            allStarsPossiblePoints: 0,
            bossScores: [],
            guildName: guild?.name ?? null,
            guildRealm: guild?.realm ?? null,
            sourcePartition: r.partition,
            updatedAt: r.updatedAt ?? new Date(),
          });
        }
      }

      // ── AllStars leaderboards (per partition × per metric) ────────────
      for (const part of partitions) {
        const allStarsAgg = await Ranking.aggregate([
          {
            $match: {
              zoneId: CURRENT_TIER_ID,
              difficulty: MYTHIC_DIFFICULTY,
              partition: part,
              metric: { $ne: null },
              $or: [{ "allStars.points": { $gt: 0 } }, { bestAmount: { $gt: 0 } }, { rankPercent: { $gt: 0 } }, { totalKills: { $gt: 0 } }],
            },
          },
          { $sort: { "allStars.points": -1, rankPercent: -1, bestAmount: -1, totalKills: -1 } },
          {
            $group: {
              _id: { characterId: "$characterId", encounterId: "$encounter.id", metric: "$metric" },
              characterId: { $first: "$characterId" },
              wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
              name: { $first: "$name" },
              realm: { $first: "$realm" },
              region: { $first: "$region" },
              classID: { $first: "$classID" },
              specName: { $first: "$specName" },
              role: { $first: "$role" },
              metric: { $first: "$metric" },
              points: { $first: "$allStars.points" },
              possiblePoints: { $first: "$allStars.possiblePoints" },
              ilvl: { $first: "$ilvl" },
              rankPercent: { $first: "$rankPercent" },
              medianPercent: { $first: "$medianPercent" },
              updatedAt: { $first: "$updatedAt" },
            },
          },
          {
            $group: {
              _id: { characterId: "$_id.characterId", metric: "$_id.metric" },
              characterId: { $first: "$characterId" },
              wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
              name: { $first: "$name" },
              realm: { $first: "$realm" },
              region: { $first: "$region" },
              classID: { $first: "$classID" },
              specName: { $first: "$specName" },
              role: { $first: "$role" },
              metric: { $first: "$metric" },
              points: { $sum: "$points" },
              possiblePoints: { $sum: "$possiblePoints" },
              ilvl: { $first: "$ilvl" },
              rankPercent: { $max: "$rankPercent" },
              medianPercent: { $max: "$medianPercent" },
              updatedAt: { $max: "$updatedAt" },
              bossScores: {
                $push: {
                  encounterId: "$_id.encounterId",
                  points: "$points",
                  rankPercent: "$rankPercent",
                  specName: "$specName",
                },
              },
            },
          },
          { $match: { points: { $gt: 0 } } },
        ]);

        for (const r of allStarsAgg) {
          const guild = guildMap.get(String(r.characterId));
          entries.push({
            zoneId: CURRENT_TIER_ID,
            difficulty: MYTHIC_DIFFICULTY,
            type: "allstars",
            encounterId: null,
            partition: part,
            metric: r.metric ?? "dps",
            characterId: r.characterId,
            wclCanonicalCharacterId: r.wclCanonicalCharacterId,
            name: r.name,
            realm: r.realm,
            region: r.region,
            classID: r.classID,
            specName: r.specName,
            bestSpecName: "",
            role: r.role,
            ilvl: r.ilvl ?? 0,
            score: r.points,
            encounterName: "",
            rankPercent: r.rankPercent,
            medianPercent: r.medianPercent,
            lockedIn: false,
            totalKills: 0,
            bestAmount: 0,
            allStarsPoints: r.points,
            allStarsPossiblePoints: r.possiblePoints,
            bossScores: r.bossScores ?? [],
            guildName: guild?.name ?? null,
            guildRealm: guild?.realm ?? null,
            sourcePartition: part,
            updatedAt: r.updatedAt ?? new Date(),
          });
        }
      }

      // ── AllStars + all partitions (best per boss per metric across partitions) ─
      const allStarsAllPartitions = await Ranking.aggregate([
        {
          $match: {
            zoneId: CURRENT_TIER_ID,
            difficulty: MYTHIC_DIFFICULTY,
            metric: { $ne: null },
            $or: [{ "allStars.points": { $gt: 0 } }, { bestAmount: { $gt: 0 } }, { rankPercent: { $gt: 0 } }, { totalKills: { $gt: 0 } }],
          },
        },
        { $sort: { "allStars.points": -1, rankPercent: -1, bestAmount: -1, totalKills: -1, partition: -1 } },
        {
          $group: {
            _id: { characterId: "$characterId", encounterId: "$encounter.id", metric: "$metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            points: { $first: "$allStars.points" },
            possiblePoints: { $first: "$allStars.possiblePoints" },
            ilvl: { $first: "$ilvl" },
            rankPercent: { $first: "$rankPercent" },
            medianPercent: { $first: "$medianPercent" },
            updatedAt: { $first: "$updatedAt" },
          },
        },
        {
          $group: {
            _id: { characterId: "$_id.characterId", metric: "$_id.metric" },
            characterId: { $first: "$characterId" },
            wclCanonicalCharacterId: { $first: "$wclCanonicalCharacterId" },
            name: { $first: "$name" },
            realm: { $first: "$realm" },
            region: { $first: "$region" },
            classID: { $first: "$classID" },
            specName: { $first: "$specName" },
            role: { $first: "$role" },
            metric: { $first: "$metric" },
            points: { $sum: "$points" },
            possiblePoints: { $sum: "$possiblePoints" },
            ilvl: { $first: "$ilvl" },
            rankPercent: { $max: "$rankPercent" },
            medianPercent: { $max: "$medianPercent" },
            updatedAt: { $max: "$updatedAt" },
            bossScores: {
              $push: {
                encounterId: "$_id.encounterId",
                points: "$points",
                rankPercent: "$rankPercent",
                specName: "$specName",
              },
            },
          },
        },
        { $match: { points: { $gt: 0 } } },
      ]);

      for (const r of allStarsAllPartitions) {
        const guild = guildMap.get(String(r.characterId));
        entries.push({
          zoneId: CURRENT_TIER_ID,
          difficulty: MYTHIC_DIFFICULTY,
          type: "allstars",
          encounterId: null,
          partition: null,
          metric: r.metric ?? "dps",
          characterId: r.characterId,
          wclCanonicalCharacterId: r.wclCanonicalCharacterId,
          name: r.name,
          realm: r.realm,
          region: r.region,
          classID: r.classID,
          specName: r.specName,
          bestSpecName: "",
          role: r.role,
          ilvl: r.ilvl ?? 0,
          score: r.points,
          encounterName: "",
          rankPercent: r.rankPercent,
          medianPercent: r.medianPercent,
          lockedIn: false,
          totalKills: 0,
          bestAmount: 0,
          allStarsPoints: r.points,
          allStarsPossiblePoints: r.possiblePoints,
          bossScores: r.bossScores ?? [],
          guildName: guild?.name ?? null,
          guildRealm: guild?.realm ?? null,
          sourcePartition: 0,
          updatedAt: r.updatedAt ?? new Date(),
        });
      }

      // ── Deduplicate entries by unique key ──────────────────────────
      const deduped = new Map<string, (typeof entries)[0]>();
      for (const e of entries) {
        const key = `${e.zoneId}|${e.difficulty}|${e.type}|${e.encounterId}|${e.partition}|${e.metric}|${e.characterId}`;
        const existing = deduped.get(key);
        if (!existing || e.score > existing.score) {
          deduped.set(key, e);
        }
      }
      const dedupedEntries = Array.from(deduped.values());

      // ── Atomic swap: drop old data, insert new ─────────────────────
      logger.info(`[Leaderboard] Inserting ${dedupedEntries.length} leaderboard entries (deduped from ${entries.length})...`);

      await CharacterLeaderboard.deleteMany({ zoneId: CURRENT_TIER_ID });
      // Sync after clearing this materialized tier so stale rows cannot block new unique indexes.
      await CharacterLeaderboard.syncIndexes();

      if (dedupedEntries.length > 0) {
        // Write in batches of 5000 to avoid memory pressure
        const BATCH = 5000;
        for (let i = 0; i < dedupedEntries.length; i += BATCH) {
          const batch = dedupedEntries.slice(i, i + BATCH);
          await CharacterLeaderboard.bulkWrite(
            batch.map((entry) => ({
              replaceOne: {
                filter: this.toLeaderboardUniqueFilter(entry),
                replacement: entry,
                upsert: true,
              },
            })),
            { ordered: false },
          );
        }
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      logger.info(`[Leaderboard] Build completed: ${dedupedEntries.length} entries in ${duration}s`);
    } catch (error) {
      logger.error("[Leaderboard] Build failed:", error);
      throw error;
    }
  }

  private toLeaderboardUniqueFilter(entry: any): Record<string, unknown> {
    return {
      zoneId: entry.zoneId,
      difficulty: entry.difficulty,
      type: entry.type,
      encounterId: entry.encounterId,
      partition: entry.partition,
      metric: entry.metric,
      characterId: entry.characterId,
    };
  }

  /**
   * Query the materialized leaderboard for character rankings.
   *
   * Ranking rows remain indexed and materialized, while guild labels are hydrated
   * from raid-scoped participation so historical views cannot retain current-guild
   * snapshots from an older leaderboard build.
   */
  private async applyRaidGuildsToCharacterRankingEntries<T extends { characterId?: unknown; guildName?: string | null; guildRealm?: string | null }>(
    zoneId: number,
    entries: T[],
  ): Promise<T[]> {
    const characterIds = entries
      .map((entry) => entry.characterId)
      .filter((characterId): characterId is mongoose.Types.ObjectId | string => Boolean(characterId));
    const guildByCharacterId = await getPrimaryCharacterRaidGuilds(zoneId, characterIds);

    return entries.map((entry) => {
      const guild = entry.characterId ? guildByCharacterId.get(String(entry.characterId)) : null;
      return {
        ...entry,
        guildName: guild?.name ?? null,
        guildRealm: guild?.realm ?? null,
      };
    });
  }

  async getCharacterRankings(options: {
    zoneId: number;
    encounterId?: number;
    classId?: number;
    specName?: string;
    role?: "dps" | "healer" | "tank";
    metric?: "dps" | "hps";
    partition?: number;
    limit?: number;
    page?: number;
    characterName?: string;
    guildName?: string;
  }): Promise<CharacterRankingsResponse> {
    const { zoneId, encounterId, classId, specName, role, metric = "dps", partition, limit = 100, page = 1, characterName, guildName } = options;

    const MYTHIC_DIFFICULTY = 5;
    const normalizedSpecName = specName?.trim().toLowerCase();
    const normalizedRole = role?.toLowerCase() as "dps" | "healer" | "tank" | undefined;
    const normalizedCharacterName = characterName?.trim();
    const normalizedGuildName = guildName?.trim();
    const escapeRegex = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const partialNameRegex = normalizedCharacterName ? this.getAccentInsensitiveRegex(normalizedCharacterName) : undefined;
    const partialGuildNameRegex = normalizedGuildName ? new RegExp(escapeRegex(normalizedGuildName), "i") : undefined;

    const safeLimit = Math.min(Math.max(limit, 1), 500);

    // ── Base query identifies the leaderboard view ───────────────────
    const baseQuery: any = {
      zoneId,
      difficulty: MYTHIC_DIFFICULTY,
      type: encounterId !== undefined ? "boss" : "allstars",
      encounterId: encounterId ?? null,
      partition: partition ?? null,
      metric,
    };

    // ── Optional filters ─────────────────────────────────────────────
    if (classId !== undefined) baseQuery.classID = classId;
    if (normalizedRole !== undefined) baseQuery.role = normalizedRole;

    // ── AllStars + spec filter: special in-memory path ───────────────
    // The leaderboard stores one entry per character (best spec per boss in bossScores).
    // Filtering by specName on the top-level field is unreliable because specName is
    // chosen by $first (arbitrary). Instead, find entries where bossScores contains a
    // parse for the requested spec, filter bossScores in memory, and recompute the
    // spec-specific allStars total. Some bosses have parses but zero all-star points.
    if (encounterId === undefined && normalizedSpecName !== undefined) {
      const specQuery = {
        ...baseQuery,
        bossScores: { $elemMatch: { specName: normalizedSpecName, rankPercent: { $gt: 0 } } },
      };

      let allSpecEntries = (await CharacterLeaderboard.find(specQuery).lean()) as any[];

      for (const e of allSpecEntries) {
        e.bossScores = (e.bossScores ?? []).filter((bs: any) => bs.specName === normalizedSpecName && bs.rankPercent > 0);
        e.allStarsPoints = e.bossScores.reduce((sum: number, bs: any) => sum + (bs.points ?? 0), 0);
        e.score = e.allStarsPoints;
      }

      allSpecEntries = await this.applyRaidGuildsToCharacterRankingEntries(zoneId, allSpecEntries);
      allSpecEntries.sort((a: any, b: any) => b.score - a.score || (a.name ?? "").localeCompare(b.name ?? ""));

      let displayEntries = allSpecEntries;
      if (partialNameRegex) displayEntries = displayEntries.filter((e: any) => partialNameRegex.test(e.name ?? ""));
      if (partialGuildNameRegex) displayEntries = displayEntries.filter((e: any) => partialGuildNameRegex!.test(e.guildName ?? ""));

      const specTotalRanked = allSpecEntries.length;
      const specTotalItems = displayEntries.length;
      const specPage = Math.max(page, 1);
      const specSkip = (specPage - 1) * safeLimit;
      const pageEntries = displayEntries.slice(specSkip, specSkip + safeLimit);

      const rankMap = new Map(allSpecEntries.map((e: any, i: number) => [e, i + 1]));

      const data: CharacterRankingRow[] = pageEntries.map((e: any) => {
        const guild = e.guildName && e.guildRealm ? { name: e.guildName, realm: e.guildRealm } : null;
        const row: CharacterRankingRow = {
          rank: rankMap.get(e) ?? 0,
          character: {
            wclCanonicalCharacterId: e.wclCanonicalCharacterId,
            name: e.name,
            realm: e.realm,
            region: e.region,
            classID: e.classID,
            guild,
          },
          context: {
            zoneId: e.zoneId,
            difficulty: e.difficulty,
            metric: e.metric ?? "dps",
            partition: e.sourcePartition || e.partition,
            encounterId: null,
            specName: normalizedSpecName,
            role: e.role,
            ilvl: e.ilvl,
          },
          score: { type: "allStars", value: e.score },
          stats: {
            allStars: { points: e.allStarsPoints, possiblePoints: e.allStarsPossiblePoints },
            rankPercent: e.rankPercent,
            medianPercent: e.medianPercent,
          },
          updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : undefined,
        };
        if (e.bossScores?.length > 0) (row as any).bossScores = e.bossScores;
        return row;
      });

      return {
        data,
        pagination: {
          totalItems: specTotalItems,
          totalRankedItems: specTotalRanked,
          totalPages: Math.ceil(specTotalItems / safeLimit),
          currentPage: specPage,
          pageSize: safeLimit,
        },
      };
    }

    // Boss leaderboard or allStars without spec filter — use stored specName directly
    if (normalizedSpecName !== undefined) baseQuery.specName = normalizedSpecName;

    // Total ranked items (before any name filter)
    const totalRankedItems = await CharacterLeaderboard.countDocuments(baseQuery);

    let effectiveSkip: number;
    let effectivePage: number;
    let totalItems: number;
    let fetchQuery: any = { ...baseQuery };
    let needsGlobalRanks = false;

    if (partialNameRegex) {
      fetchQuery = { ...baseQuery, name: partialNameRegex };
      totalItems = await CharacterLeaderboard.countDocuments(fetchQuery);
      effectivePage = Math.max(page, 1);
      effectiveSkip = (effectivePage - 1) * safeLimit;
      needsGlobalRanks = true;
    } else {
      totalItems = totalRankedItems;
      effectivePage = Math.max(page, 1);
      effectiveSkip = (effectivePage - 1) * safeLimit;
    }

    // ── Fetch the page and resolve raid-scoped guilds ────────────────
    let entries: any[];
    if (partialGuildNameRegex) {
      const candidates = await CharacterLeaderboard.find(fetchQuery).sort({ score: -1, name: 1 }).lean();
      const hydratedCandidates = await this.applyRaidGuildsToCharacterRankingEntries(zoneId, candidates);
      const matchingCandidates = hydratedCandidates.filter((entry) => partialGuildNameRegex.test(entry.guildName ?? ""));
      totalItems = matchingCandidates.length;
      entries = matchingCandidates.slice(effectiveSkip, effectiveSkip + safeLimit);
      needsGlobalRanks = true;
    } else {
      const storedEntries = await CharacterLeaderboard.find(fetchQuery).sort({ score: -1, name: 1 }).skip(effectiveSkip).limit(safeLimit).lean();
      entries = await this.applyRaidGuildsToCharacterRankingEntries(zoneId, storedEntries);
    }

    // ── Compute ranks ────────────────────────────────────────────────
    // When name-filtered, positional ranks are wrong (they'd show position within
    // filtered results). Instead, compute each row's global rank via indexed count.
    let ranks: number[];
    if (needsGlobalRanks && entries.length > 0) {
      ranks = await Promise.all(
        entries.map(async (e) => {
          const count = await CharacterLeaderboard.countDocuments({
            ...baseQuery,
            score: { $gt: e.score },
          });
          return count + 1;
        }),
      );
    } else {
      ranks = entries.map((_, i) => effectiveSkip + i + 1);
    }

    // ── Map to response format ───────────────────────────────────────
    const isBossType = encounterId !== undefined;

    const data: CharacterRankingRow[] = entries.map((e: any, i: number) => {
      const guild = e.guildName && e.guildRealm ? { name: e.guildName, realm: e.guildRealm } : null;

      const row: CharacterRankingRow = {
        rank: ranks[i],
        character: {
          wclCanonicalCharacterId: e.wclCanonicalCharacterId,
          name: e.name,
          realm: e.realm,
          region: e.region,
          classID: e.classID,
          guild,
        },
        context: {
          zoneId: e.zoneId,
          difficulty: e.difficulty,
          metric: e.metric ?? "dps",
          partition: e.sourcePartition || e.partition,
          encounterId: e.encounterId,
          specName: e.specName,
          bestSpecName: e.bestSpecName || undefined,
          role: e.role,
          ilvl: e.ilvl,
        },
        score: {
          type: isBossType ? "bestAmount" : "allStars",
          value: e.score,
        },
        stats: isBossType
          ? {
              bestAmount: e.bestAmount,
              rankPercent: e.rankPercent,
              medianPercent: e.medianPercent,
              lockedIn: e.lockedIn,
              totalKills: e.totalKills,
            }
          : {
              allStars: {
                points: e.allStarsPoints,
                possiblePoints: e.allStarsPossiblePoints,
              },
              rankPercent: e.rankPercent,
              medianPercent: e.medianPercent,
            },
        updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : undefined,
      };

      if (isBossType) {
        row.encounter = {
          id: e.encounterId,
          name: e.encounterName,
        };
      }

      if (!isBossType && e.bossScores?.length > 0) {
        (row as any).bossScores = e.bossScores;
      }

      return row;
    });

    return {
      data,
      pagination: {
        totalItems,
        totalRankedItems,
        totalPages: Math.ceil(totalItems / safeLimit),
        currentPage: effectivePage,
        pageSize: safeLimit,
      },
    };
  }
}

export default new CharacterService();
