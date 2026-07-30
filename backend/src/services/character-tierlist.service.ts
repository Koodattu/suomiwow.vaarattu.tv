import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { AnyBulkWriteOperation } from "mongoose";
import CharacterMechanicsLeaderboard, { IMechanicsBossScore } from "../models/CharacterMechanicsLeaderboard";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import CharacterTierListEntry, { ICharacterTierListEntry, CharacterTierListRole, CharacterTierListMetric } from "../models/CharacterTierListEntry";
import CustomCharacterTierList, { CustomCharacterTier, ICustomCharacterTierList } from "../models/CustomCharacterTierList";
import SharedCharacterTierList, { ISharedCharacterTierList } from "../models/SharedCharacterTierList";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import Guild from "../models/Guild";
import Raid from "../models/Raid";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import {
  MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
  MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY,
} from "../config/character-eligibility";
import { TRACKED_RAIDS } from "../config/guilds";
import { getPrimaryCharacterRaidGuilds, type CharacterRaidGuild } from "./character-raid-guild.service";
import logger from "../utils/logger";

const MYTHIC_DIFFICULTY = 5;
const DEFAULT_TIERS: CustomCharacterTier[] = ["S", "A", "B", "C", "D", "E", "F"];
const MAX_QUERY_LIMIT = 2000;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

type CustomCharacterTierListPayload = {
  tiers?: Array<{ tier?: string; characterKeys?: unknown }>;
  unplacedCharacterKeys?: unknown;
};

type NormalizedCustomCharacterTierList = {
  tiers: Array<{ tier: CustomCharacterTier; characterKeys: string[] }>;
  unplacedCharacterKeys: string[];
};

type SavedCustomCharacterTierListLike = Pick<ICustomCharacterTierList | ISharedCharacterTierList, "tiers" | "unplacedCharacterKeys" | "updatedAt">;

type AccountGroupRow = {
  _id: mongoose.Types.ObjectId;
  characterIds?: Array<mongoose.Types.ObjectId | string>;
};

type MechanicsRow = {
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  role: CharacterTierListRole;
  metric: CharacterTierListMetric;
  specName: string;
  bestSpecName?: string | null;
  ilvl?: number;
  score: number;
  parseScore: number;
  survivalScore: number | null;
  rankPercent?: number;
  medianPercent?: number;
  totalKills?: number;
  pulls?: number;
  deaths?: number;
  survivedPulls?: number;
  earlyDeaths?: number;
  averageDeathPercent?: number | null;
  deathDataAvailable?: boolean;
  bossScores?: IMechanicsBossScore[];
  updatedAt?: Date;
};

type ParticipationRow = {
  characterId?: mongoose.Types.ObjectId | null;
  wclCanonicalCharacterId?: number | null;
  zoneId: number;
  reportGuildId: mongoose.Types.ObjectId;
  reportGuildName: string;
  reportGuildRealm: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  classID: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reportCount: number;
  mythicReportCount: number;
  updatedAt?: Date;
};

type ParticipationAggregate = {
  characterKey: string;
  characterId?: mongoose.Types.ObjectId | null;
  wclCanonicalCharacterId?: number | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  reportCount: number;
  mythicReportCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sourceUpdatedAt: Date;
};

type GuildParticipationAggregate = ParticipationAggregate & {
  guildId: mongoose.Types.ObjectId;
  guildName: string;
  guildRealm: string;
};

export type CharacterTierListFilters = {
  minReports?: number;
  role?: CharacterTierListRole | null;
  classId?: number | null;
  limit?: number | null;
};

type NormalizedCharacterTierListFilters = {
  minReports: number;
  role: CharacterTierListRole | null;
  classId: number | null;
  limit: number | null;
};

export type CharacterTierListCharacter = {
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
  bossScores: IMechanicsBossScore[];
  reportCount: number;
  mythicReportCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sourceUpdatedAt: Date;
};

export type CharacterTierListRosterCharacter = {
  characterKey: string;
  characterId: string | null;
  wclCanonicalCharacterId: number | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
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
};

export type CharacterTierListResponse = {
  raid: { id: number; name: string };
  guild?: { id: string; name: string; realm: string } | null;
  filters: NormalizedCharacterTierListFilters;
  generatedAt: Date | null;
  characters: CharacterTierListCharacter[];
  total: number;
};

export type CustomCharacterTierListResponse = {
  guild: { id: string; name: string; realm: string };
  raid: { id: number; name: string };
  roster: CharacterTierListRosterCharacter[];
  canSave: boolean;
  customList: {
    saved: boolean;
    updatedAt: Date | null;
    tiers: Array<{ tier: CustomCharacterTier; characterKeys: string[] }>;
    unplacedCharacterKeys: string[];
  };
};

export type SharedCharacterTierListResponse = CustomCharacterTierListResponse & {
  share: {
    shareId: string;
    createdAt: Date;
    updatedAt: Date;
    owner: boolean;
    canEdit: boolean;
  };
};

export class CharacterTierListServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

class CharacterTierListService {
  async rebuildCharacterTierLists(zoneIds: number[]): Promise<{ zones: Array<{ zoneId: number; entries: number; characters: number; guildEntries: number }>; entries: number }> {
    const uniqueZoneIds = Array.from(new Set(zoneIds.filter((zoneId) => Number.isInteger(zoneId) && zoneId > 0)));
    const zones: Array<{ zoneId: number; entries: number; characters: number; guildEntries: number }> = [];
    let entries = 0;

    for (const zoneId of uniqueZoneIds) {
      const result = await this.rebuildZone(zoneId);
      zones.push(result);
      entries += result.entries;
    }

    return { zones, entries };
  }

  async getAvailableRaids(): Promise<Array<{ raidId: number; raidName: string; generatedAt: Date | null; characterCount: number }>> {
    const rows = await CharacterTierListEntry.aggregate([
      { $match: { scope: "global", pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY } } },
      {
        $group: {
          _id: "$zoneId",
          raidName: { $first: "$raidName" },
          generatedAt: { $max: "$generatedAt" },
          characterCount: { $sum: 1 },
        },
      },
    ]);

    const order = new Map(TRACKED_RAIDS.map((raidId, index) => [raidId, index]));
    return rows
      .map((row) => ({
        raidId: row._id as number,
        raidName: row.raidName as string,
        generatedAt: (row.generatedAt as Date | undefined) ?? null,
        characterCount: row.characterCount as number,
      }))
      .sort((a, b) => (order.get(a.raidId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.raidId) ?? Number.MAX_SAFE_INTEGER) || b.raidId - a.raidId);
  }

  async getGlobalTierList(zoneId: number, filters: CharacterTierListFilters = {}): Promise<CharacterTierListResponse> {
    const raid = await this.getRaidInfo(zoneId);
    const normalizedFilters = this.normalizeFilters(filters, 3);
    const query = this.buildEntryQuery(zoneId, normalizedFilters, null);

    const characterQuery = CharacterTierListEntry.find(query).sort({ score: -1, reportCount: -1, lastSeenAt: -1, name: 1 });
    if (normalizedFilters.limit !== null) {
      characterQuery.limit(MAX_QUERY_LIMIT);
    }
    const characters = await characterQuery.lean<ICharacterTierListEntry[]>();
    const accountGroupIdByCharacterId = await this.getAccountGroupIdsByCharacterId(characters);
    const accountRepresentatives = this.selectMostPlayedGeneratedEntries(characters, accountGroupIdByCharacterId);
    const limitedCharacters = normalizedFilters.limit === null ? accountRepresentatives : accountRepresentatives.slice(0, normalizedFilters.limit);
    const primaryGuildByCharacterId = await getPrimaryCharacterRaidGuilds(
      zoneId,
      limitedCharacters.map((entry) => entry.characterId),
    );

    return {
      raid,
      guild: null,
      filters: normalizedFilters,
      generatedAt: characters[0]?.generatedAt ?? null,
      characters: limitedCharacters.map((entry) => this.formatGeneratedCharacter(entry, accountGroupIdByCharacterId, primaryGuildByCharacterId)),
      total: accountRepresentatives.length,
    };
  }

  async getGuildTierList(realm: string, name: string, zoneId: number, filters: CharacterTierListFilters = {}): Promise<CharacterTierListResponse | null> {
    const guild = await this.findGuild(realm, name);
    if (!guild) return null;

    const raid = await this.getRaidInfo(zoneId);
    const normalizedFilters = this.normalizeFilters(filters, 1);
    const query = this.buildEntryQuery(zoneId, normalizedFilters, guild._id);

    const characters = await CharacterTierListEntry.find(query).sort({ score: -1, reportCount: -1, lastSeenAt: -1, name: 1 }).lean<ICharacterTierListEntry[]>();
    const accountGroupIdByCharacterId = await this.getAccountGroupIdsByCharacterId(characters);
    const accountRepresentatives = this.selectMostPlayedGeneratedEntries(characters, accountGroupIdByCharacterId);
    const limitedCharacters = normalizedFilters.limit === null ? accountRepresentatives : accountRepresentatives.slice(0, normalizedFilters.limit);

    return {
      raid,
      guild: { id: guild._id.toString(), name: guild.name, realm: guild.realm },
      filters: normalizedFilters,
      generatedAt: characters[0]?.generatedAt ?? null,
      characters: limitedCharacters.map((entry) => this.formatGeneratedCharacter(entry, accountGroupIdByCharacterId)),
      total: accountRepresentatives.length,
    };
  }

  async getCustomTierList(userId: string | null, realm: string, name: string, zoneId: number): Promise<CustomCharacterTierListResponse | null> {
    const context = await this.getGuildRosterContext(realm, name, zoneId);
    if (!context) return null;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return this.buildCustomResponse(context, null, false);
    }

    const customList = await CustomCharacterTierList.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      guildId: context.guildObjectId,
      zoneId,
    }).lean<ICustomCharacterTierList | null>();

    return this.buildCustomResponse(context, customList, true);
  }

  async saveCustomTierList(
    userId: string,
    realm: string,
    name: string,
    zoneId: number,
    payload: CustomCharacterTierListPayload,
  ): Promise<CustomCharacterTierListResponse | null> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new CharacterTierListServiceError(401, "Login is required");
    }

    const context = await this.getGuildRosterContext(realm, name, zoneId);
    if (!context) return null;

    const normalized = this.normalizeCustomPayload(payload, context.roster.map((character) => character.characterKey));
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const saved = await CustomCharacterTierList.findOneAndUpdate(
      { userId: userObjectId, guildId: context.guildObjectId, zoneId },
      {
        $set: {
          userId: userObjectId,
          guildId: context.guildObjectId,
          guildName: context.guild.name,
          guildRealm: context.guild.realm,
          zoneId,
          raidName: context.raid.name,
          tiers: normalized.tiers,
          unplacedCharacterKeys: normalized.unplacedCharacterKeys,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean<ICustomCharacterTierList>();

    return this.buildCustomResponse(context, saved, true);
  }

  async deleteCustomTierList(userId: string, realm: string, name: string, zoneId: number): Promise<CustomCharacterTierListResponse | null> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new CharacterTierListServiceError(401, "Login is required");
    }

    const context = await this.getGuildRosterContext(realm, name, zoneId);
    if (!context) return null;

    await CustomCharacterTierList.deleteOne({
      userId: new mongoose.Types.ObjectId(userId),
      guildId: context.guildObjectId,
      zoneId,
    });

    return this.buildCustomResponse(context, null, true);
  }

  async createSharedTierList(
    userId: string | null,
    realm: string,
    name: string,
    zoneId: number,
    payload: CustomCharacterTierListPayload,
  ): Promise<SharedCharacterTierListResponse | null> {
    const context = await this.getGuildRosterContext(realm, name, zoneId);
    if (!context) return null;

    const normalized = this.normalizeCustomPayload(payload, context.roster.map((character) => character.characterKey));
    const userObjectId = this.toUserObjectId(userId);
    const shareId = await this.createShareId();

    const shared = await SharedCharacterTierList.create({
      shareId,
      userId: userObjectId,
      guildId: context.guildObjectId,
      guildName: context.guild.name,
      guildRealm: context.guild.realm,
      zoneId,
      raidName: context.raid.name,
      tiers: normalized.tiers,
      unplacedCharacterKeys: normalized.unplacedCharacterKeys,
    });

    return this.buildSharedResponse(context, shared, userObjectId);
  }

  async getSharedTierList(userId: string | null, shareId: string): Promise<SharedCharacterTierListResponse | null> {
    this.validateShareId(shareId);

    const shared = await SharedCharacterTierList.findOne({ shareId }).lean<ISharedCharacterTierList | null>();
    if (!shared) return null;

    const context = await this.getGuildRosterContext(shared.guildRealm, shared.guildName, shared.zoneId);
    if (!context) return null;

    return this.buildSharedResponse(context, shared, this.toUserObjectId(userId));
  }

  async updateSharedTierList(userId: string | undefined, shareId: string, payload: CustomCharacterTierListPayload): Promise<SharedCharacterTierListResponse | null> {
    this.validateShareId(shareId);

    const userObjectId = this.requireUserObjectId(userId);
    const shared = await SharedCharacterTierList.findOne({ shareId }).lean<ISharedCharacterTierList | null>();
    if (!shared) return null;

    if (!this.isSharedOwner(shared, userObjectId)) {
      throw new CharacterTierListServiceError(403, "Only the owner can edit this shared tier list");
    }

    const context = await this.getGuildRosterContext(shared.guildRealm, shared.guildName, shared.zoneId);
    if (!context) return null;

    const normalized = this.normalizeCustomPayload(payload, context.roster.map((character) => character.characterKey));
    const updated = await SharedCharacterTierList.findOneAndUpdate(
      { shareId },
      {
        $set: {
          tiers: normalized.tiers,
          unplacedCharacterKeys: normalized.unplacedCharacterKeys,
          guildName: context.guild.name,
          guildRealm: context.guild.realm,
          raidName: context.raid.name,
        },
      },
      { new: true },
    ).lean<ISharedCharacterTierList | null>();

    return updated ? this.buildSharedResponse(context, updated, userObjectId) : null;
  }

  private async rebuildZone(zoneId: number): Promise<{ zoneId: number; entries: number; characters: number; guildEntries: number }> {
    const startedAt = Date.now();
    const generatedAt = new Date();
    const raid = await this.getRaidInfo(zoneId);

    logger.info(`[CharacterTierList] Rebuilding character tier list entries for ${raid.name} (${zoneId})`);

    const [mechanicsRows, participationRows] = await Promise.all([
      CharacterMechanicsLeaderboard.find({
        zoneId,
        difficulty: MYTHIC_DIFFICULTY,
        type: "overall",
        encounterId: null,
        score: { $gte: 0 },
        parseScore: { $gte: 0 },
        survivalScore: { $gte: 0 },
        pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
      })
        .select(
          "characterId wclCanonicalCharacterId name realm region classID role metric specName bestSpecName ilvl score parseScore survivalScore rankPercent medianPercent totalKills pulls deaths survivedPulls earlyDeaths averageDeathPercent deathDataAvailable bossScores updatedAt",
        )
        .lean<MechanicsRow[]>(),
      CharacterRaidParticipation.find({ zoneId })
        .select("characterId wclCanonicalCharacterId zoneId reportGuildId reportGuildName reportGuildRealm characterName characterRealm characterRegion classID firstSeenAt lastSeenAt reportCount mythicReportCount updatedAt")
        .lean<ParticipationRow[]>(),
    ]);

    const bestMechanicsRows = this.getBestMechanicsRows(mechanicsRows);
    const participation = this.aggregateParticipation(participationRows);
    const operations: AnyBulkWriteOperation<ICharacterTierListEntry>[] = [];
    let guildEntries = 0;

    for (const mechanicsRow of bestMechanicsRows.values()) {
      const aliases = this.getIdentityKeys(mechanicsRow);
      const globalParticipation = this.findByAliases(participation.globalByAlias, aliases);
      if (!globalParticipation) continue;

      const globalEntry = this.createGeneratedEntry({
        scope: "global",
        raid,
        mechanicsRow,
        participation: globalParticipation,
        generatedAt,
      });
      operations.push(this.createEntryUpsert(globalEntry));

      const guildAggregates = this.findGuildAggregatesByAliases(participation.guildsByAlias, aliases);
      for (const guildParticipation of guildAggregates) {
        const guildEntry = this.createGeneratedEntry({
          scope: "guild",
          raid,
          mechanicsRow,
          participation: guildParticipation,
          generatedAt,
        });
        operations.push(this.createEntryUpsert(guildEntry));
        guildEntries++;
      }
    }

    if (operations.length > 0) {
      await CharacterTierListEntry.bulkWrite(operations, { ordered: false });
    }

    await CharacterTierListEntry.deleteMany({ zoneId, generatedAt: { $lt: generatedAt } });

    const duration = Math.round((Date.now() - startedAt) / 1000);
    logger.info(`[CharacterTierList] Rebuilt ${operations.length} entries for raid ${zoneId} in ${duration}s`);

    return {
      zoneId,
      entries: operations.length,
      characters: bestMechanicsRows.size,
      guildEntries,
    };
  }

  private getBestMechanicsRows(rows: MechanicsRow[]): Map<string, MechanicsRow> {
    const bestRows = new Map<string, MechanicsRow>();

    for (const row of rows) {
      if (!row.characterId || !Number.isFinite(row.score) || !Number.isFinite(row.parseScore) || !Number.isFinite(row.survivalScore)) continue;
      const characterKey = this.buildCharacterKey(row);
      const existing = bestRows.get(characterKey);
      if (!existing || this.isBetterMechanicsRow(row, existing)) {
        bestRows.set(characterKey, row);
      }
    }

    return bestRows;
  }

  private isBetterMechanicsRow(candidate: MechanicsRow, existing: MechanicsRow): boolean {
    const pullsDiff = (candidate.pulls ?? 0) - (existing.pulls ?? 0);
    if (pullsDiff !== 0) return pullsDiff > 0;

    const candidateMetricFitsRole = this.metricFitsRole(candidate);
    const existingMetricFitsRole = this.metricFitsRole(existing);
    if (candidateMetricFitsRole !== existingMetricFitsRole) return candidateMetricFitsRole;

    const scoreDiff = (candidate.score ?? 0) - (existing.score ?? 0);
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff > 0;

    const candidateUpdated = candidate.updatedAt ? new Date(candidate.updatedAt).getTime() : 0;
    const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
    if (candidateUpdated !== existingUpdated) return candidateUpdated > existingUpdated;

    return `${candidate.name}-${candidate.realm}`.localeCompare(`${existing.name}-${existing.realm}`) < 0;
  }

  private metricFitsRole(row: Pick<MechanicsRow, "role" | "metric">): boolean {
    return row.role === "healer" ? row.metric === "hps" : row.metric === "dps";
  }

  private aggregateParticipation(rows: ParticipationRow[]): {
    globalByAlias: Map<string, ParticipationAggregate>;
    guildsByAlias: Map<string, Map<string, GuildParticipationAggregate>>;
  } {
    const globalByPrimary = new Map<string, ParticipationAggregate>();
    const globalByAlias = new Map<string, ParticipationAggregate>();
    const guildByPrimary = new Map<string, GuildParticipationAggregate>();
    const guildsByAlias = new Map<string, Map<string, GuildParticipationAggregate>>();

    for (const row of rows) {
      const primaryKey = this.buildCharacterKey(row);
      const aliases = this.getIdentityKeys(row);
      const sourceUpdatedAt = row.updatedAt ?? row.lastSeenAt;

      let global = globalByPrimary.get(primaryKey);
      if (!global) {
        global = {
          characterKey: primaryKey,
          characterId: row.characterId ?? null,
          wclCanonicalCharacterId: row.wclCanonicalCharacterId ?? null,
          name: row.characterName,
          realm: row.characterRealm,
          region: row.characterRegion,
          classID: row.classID,
          reportCount: 0,
          mythicReportCount: 0,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          sourceUpdatedAt,
        };
        globalByPrimary.set(primaryKey, global);
      }

      this.mergeParticipation(global, row, sourceUpdatedAt);
      for (const alias of aliases) {
        globalByAlias.set(alias, global);
      }

      const guildPrimaryKey = `${row.reportGuildId.toString()}:${primaryKey}`;
      let guild = guildByPrimary.get(guildPrimaryKey);
      if (!guild) {
        guild = {
          characterKey: primaryKey,
          characterId: row.characterId ?? null,
          wclCanonicalCharacterId: row.wclCanonicalCharacterId ?? null,
          name: row.characterName,
          realm: row.characterRealm,
          region: row.characterRegion,
          classID: row.classID,
          reportCount: 0,
          mythicReportCount: 0,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          sourceUpdatedAt,
          guildId: row.reportGuildId,
          guildName: row.reportGuildName,
          guildRealm: row.reportGuildRealm,
        };
        guildByPrimary.set(guildPrimaryKey, guild);
      }

      this.mergeParticipation(guild, row, sourceUpdatedAt);
      for (const alias of aliases) {
        let guildMap = guildsByAlias.get(alias);
        if (!guildMap) {
          guildMap = new Map<string, GuildParticipationAggregate>();
          guildsByAlias.set(alias, guildMap);
        }
        guildMap.set(guildPrimaryKey, guild);
      }
    }

    return { globalByAlias, guildsByAlias };
  }

  private mergeParticipation(aggregate: ParticipationAggregate, row: ParticipationRow, sourceUpdatedAt: Date): void {
    aggregate.reportCount += Math.max(row.reportCount ?? 0, 0);
    aggregate.mythicReportCount += Math.max(row.mythicReportCount ?? 0, 0);

    if (row.firstSeenAt < aggregate.firstSeenAt) {
      aggregate.firstSeenAt = row.firstSeenAt;
    }

    if (row.lastSeenAt > aggregate.lastSeenAt) {
      aggregate.lastSeenAt = row.lastSeenAt;
      aggregate.name = row.characterName;
      aggregate.realm = row.characterRealm;
      aggregate.region = row.characterRegion;
      aggregate.classID = row.classID;
      aggregate.characterId = row.characterId ?? aggregate.characterId ?? null;
      aggregate.wclCanonicalCharacterId = row.wclCanonicalCharacterId ?? aggregate.wclCanonicalCharacterId ?? null;
    }

    if (sourceUpdatedAt > aggregate.sourceUpdatedAt) {
      aggregate.sourceUpdatedAt = sourceUpdatedAt;
    }
  }

  private createGeneratedEntry(params: {
    scope: "global" | "guild";
    raid: { id: number; name: string };
    mechanicsRow: MechanicsRow;
    participation: ParticipationAggregate | GuildParticipationAggregate;
    generatedAt: Date;
  }): Omit<ICharacterTierListEntry, keyof mongoose.Document> {
    const { scope, raid, mechanicsRow, participation, generatedAt } = params;
    const guildParticipation = "guildId" in participation ? participation : null;
    const sourceUpdatedAt = new Date(Math.max(participation.sourceUpdatedAt.getTime(), mechanicsRow.updatedAt ? new Date(mechanicsRow.updatedAt).getTime() : 0));

    return {
      scope,
      zoneId: raid.id,
      raidName: raid.name,
      guildId: guildParticipation?.guildId ?? null,
      guildName: guildParticipation?.guildName ?? null,
      guildRealm: guildParticipation?.guildRealm ?? null,
      characterId: mechanicsRow.characterId,
      characterKey: participation.characterKey,
      wclCanonicalCharacterId: mechanicsRow.wclCanonicalCharacterId ?? participation.wclCanonicalCharacterId ?? null,
      name: participation.name,
      realm: participation.realm,
      region: participation.region,
      classID: participation.classID,
      role: mechanicsRow.role,
      metric: mechanicsRow.metric,
      specName: mechanicsRow.specName,
      bestSpecName: mechanicsRow.bestSpecName ?? null,
      ilvl: mechanicsRow.ilvl ?? 0,
      score: Math.round((mechanicsRow.score ?? 0) * 100) / 100,
      parseScore: Math.round((mechanicsRow.parseScore ?? 0) * 100) / 100,
      survivalScore: mechanicsRow.survivalScore === null || mechanicsRow.survivalScore === undefined ? null : Math.round(mechanicsRow.survivalScore * 100) / 100,
      rankPercent: mechanicsRow.rankPercent ?? 0,
      medianPercent: mechanicsRow.medianPercent ?? 0,
      totalKills: mechanicsRow.totalKills ?? 0,
      pulls: mechanicsRow.pulls ?? 0,
      deaths: mechanicsRow.deaths ?? 0,
      survivedPulls: mechanicsRow.survivedPulls ?? 0,
      earlyDeaths: mechanicsRow.earlyDeaths ?? 0,
      averageDeathPercent: mechanicsRow.averageDeathPercent ?? null,
      deathDataAvailable: mechanicsRow.deathDataAvailable ?? false,
      bossScores: mechanicsRow.bossScores ?? [],
      reportCount: participation.reportCount,
      mythicReportCount: participation.mythicReportCount,
      firstSeenAt: participation.firstSeenAt,
      lastSeenAt: participation.lastSeenAt,
      sourceUpdatedAt,
      generatedAt,
    };
  }

  private createEntryUpsert(entry: Omit<ICharacterTierListEntry, keyof mongoose.Document>): AnyBulkWriteOperation<ICharacterTierListEntry> {
    return {
      replaceOne: {
        filter: {
          scope: entry.scope,
          zoneId: entry.zoneId,
          guildId: entry.guildId ?? null,
          characterKey: entry.characterKey,
        },
        replacement: entry as ICharacterTierListEntry,
        upsert: true,
      },
    };
  }

  private async getGuildRosterContext(realm: string, name: string, zoneId: number): Promise<{
    guildObjectId: mongoose.Types.ObjectId;
    guild: { id: string; name: string; realm: string };
    raid: { id: number; name: string };
    roster: CharacterTierListRosterCharacter[];
  } | null> {
    const guild = await this.findGuild(realm, name);
    if (!guild) return null;

    const raid = await this.getRaidInfo(zoneId);
    const [participationRows, generatedEntries] = await Promise.all([
      CharacterRaidParticipation.find({ reportGuildId: guild._id, zoneId, reportCount: { $gte: MIN_GUILD_RAID_REPORTS_FOR_CHARACTER_ELIGIBILITY } })
        .sort({ classID: 1, characterName: 1 })
        .select("characterId wclCanonicalCharacterId characterName characterRealm characterRegion classID firstSeenAt lastSeenAt reportCount mythicReportCount updatedAt")
        .lean<ParticipationRow[]>(),
      CharacterTierListEntry.find({
        scope: "guild",
        guildId: guild._id,
        zoneId,
        pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
      }).lean<ICharacterTierListEntry[]>(),
    ]);

    const accountGroupIdByCharacterId = await this.getAccountGroupIdsByCharacterId(participationRows);
    const rosterRows = this.selectMostPlayedRosterRows(participationRows, accountGroupIdByCharacterId);
    const generatedByKey = new Map(generatedEntries.map((entry) => [entry.characterKey, entry]));
    const roster = rosterRows
      .map((row) => {
        const characterKey = this.buildCharacterKey(row);
        const generated = generatedByKey.get(characterKey);
        return {
          characterKey,
          characterId: row.characterId?.toString() ?? null,
          wclCanonicalCharacterId: row.wclCanonicalCharacterId ?? null,
          name: row.characterName,
          realm: row.characterRealm,
          region: row.characterRegion,
          classID: row.classID,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          reportCount: row.reportCount,
          score: generated?.score ?? null,
          parseScore: generated?.parseScore ?? null,
          survivalScore: generated?.survivalScore ?? null,
          role: generated?.role ?? null,
          metric: generated?.metric ?? null,
          specName: generated?.specName ?? null,
          bestSpecName: generated?.bestSpecName ?? null,
          pulls: generated?.pulls ?? null,
          deaths: generated?.deaths ?? null,
        };
      })
      .sort((a, b) => {
        const scoreA = a.score ?? -1;
        const scoreB = b.score ?? -1;
        if (scoreA !== scoreB) return scoreB - scoreA;
        if (a.reportCount !== b.reportCount) return b.reportCount - a.reportCount;
        return a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm);
      });

    return {
      guildObjectId: guild._id,
      guild: { id: guild._id.toString(), name: guild.name, realm: guild.realm },
      raid,
      roster,
    };
  }

  private async getAccountGroupIdsByCharacterId(rows: Array<{ characterId?: mongoose.Types.ObjectId | null }>): Promise<Map<string, string>> {
    const characterIdsByString = new Map<string, mongoose.Types.ObjectId>();
    for (const row of rows) {
      if (!row.characterId) continue;
      characterIdsByString.set(row.characterId.toString(), row.characterId);
    }

    if (characterIdsByString.size === 0) return new Map();

    const accountGroups = await CharacterAccountGroup.find({
      signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      characterIds: { $in: Array.from(characterIdsByString.values()) },
    })
      .select("_id characterIds")
      .lean<AccountGroupRow[]>();

    const accountGroupIdByCharacterId = new Map<string, string>();
    for (const accountGroup of accountGroups) {
      const accountGroupId = accountGroup._id.toString();
      for (const characterId of accountGroup.characterIds ?? []) {
        const characterIdString = characterId.toString();
        if (characterIdsByString.has(characterIdString)) {
          accountGroupIdByCharacterId.set(characterIdString, accountGroupId);
        }
      }
    }

    return accountGroupIdByCharacterId;
  }

  private selectMostPlayedGeneratedEntries(entries: ICharacterTierListEntry[], accountGroupIdByCharacterId: Map<string, string>): ICharacterTierListEntry[] {
    const selectedEntries = new Map<string, ICharacterTierListEntry>();

    for (const entry of entries) {
      const accountGroupId = accountGroupIdByCharacterId.get(entry.characterId.toString());
      const entryKey = accountGroupId ? `account:${accountGroupId}` : `character:${entry.characterKey}`;
      const current = selectedEntries.get(entryKey);

      if (!current || this.isBetterGeneratedRepresentative(entry, current)) {
        selectedEntries.set(entryKey, entry);
      }
    }

    return Array.from(selectedEntries.values()).sort((a, b) => b.score - a.score || b.reportCount - a.reportCount || a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm));
  }

  private isBetterGeneratedRepresentative(candidate: ICharacterTierListEntry, current: ICharacterTierListEntry): boolean {
    if (candidate.reportCount !== current.reportCount) return candidate.reportCount > current.reportCount;

    const candidateLastSeenAt = candidate.lastSeenAt ? new Date(candidate.lastSeenAt).getTime() : 0;
    const currentLastSeenAt = current.lastSeenAt ? new Date(current.lastSeenAt).getTime() : 0;
    if (candidateLastSeenAt !== currentLastSeenAt) return candidateLastSeenAt > currentLastSeenAt;

    return candidate.characterKey.localeCompare(current.characterKey) < 0;
  }

  private selectMostPlayedRosterRows(rows: ParticipationRow[], accountGroupIdByCharacterId: Map<string, string>): ParticipationRow[] {
    const selectedRows = new Map<string, ParticipationRow>();

    for (const row of rows) {
      const characterId = row.characterId?.toString() ?? null;
      const accountGroupId = characterId ? accountGroupIdByCharacterId.get(characterId) : null;
      const rosterKey = accountGroupId ? `account:${accountGroupId}` : `character:${this.buildCharacterKey(row)}`;
      const current = selectedRows.get(rosterKey);

      if (!current || this.isBetterRosterRepresentative(row, current)) {
        selectedRows.set(rosterKey, row);
      }
    }

    return Array.from(selectedRows.values());
  }

  private isBetterRosterRepresentative(candidate: ParticipationRow, current: ParticipationRow): boolean {
    if (candidate.reportCount !== current.reportCount) return candidate.reportCount > current.reportCount;

    const candidateLastSeenAt = candidate.lastSeenAt ? new Date(candidate.lastSeenAt).getTime() : 0;
    const currentLastSeenAt = current.lastSeenAt ? new Date(current.lastSeenAt).getTime() : 0;
    if (candidateLastSeenAt !== currentLastSeenAt) return candidateLastSeenAt > currentLastSeenAt;

    return this.buildCharacterKey(candidate).localeCompare(this.buildCharacterKey(current)) < 0;
  }

  private buildCustomResponse(
    context: {
      guild: { id: string; name: string; realm: string };
      raid: { id: number; name: string };
      roster: CharacterTierListRosterCharacter[];
    },
    customList: ICustomCharacterTierList | null,
    canSave: boolean,
  ): CustomCharacterTierListResponse {
    const normalized = this.normalizeSavedCustomList(customList, context.roster.map((character) => character.characterKey));

    return {
      guild: context.guild,
      raid: context.raid,
      roster: context.roster,
      canSave,
      customList: normalized,
    };
  }

  private buildSharedResponse(
    context: {
      guild: { id: string; name: string; realm: string };
      raid: { id: number; name: string };
      roster: CharacterTierListRosterCharacter[];
    },
    sharedList: SavedCustomCharacterTierListLike & Pick<ISharedCharacterTierList, "shareId" | "createdAt" | "userId">,
    userObjectId: mongoose.Types.ObjectId | null,
  ): SharedCharacterTierListResponse {
    const owner = this.isSharedOwner(sharedList, userObjectId);
    const normalized = this.normalizeSavedCustomList(sharedList, context.roster.map((character) => character.characterKey));

    return {
      guild: context.guild,
      raid: context.raid,
      roster: context.roster,
      canSave: !!userObjectId,
      customList: normalized,
      share: {
        shareId: sharedList.shareId,
        createdAt: sharedList.createdAt,
        updatedAt: sharedList.updatedAt ?? sharedList.createdAt,
        owner,
        canEdit: owner,
      },
    };
  }

  private normalizeSavedCustomList(
    customList: SavedCustomCharacterTierListLike | null,
    rosterKeys: string[],
  ): CustomCharacterTierListResponse["customList"] {
    if (!customList) {
      return {
        saved: false,
        updatedAt: null,
        tiers: DEFAULT_TIERS.map((tier) => ({ tier, characterKeys: [] })),
        unplacedCharacterKeys: rosterKeys,
      };
    }

    const normalized = this.normalizeCustomPayload({ tiers: customList.tiers, unplacedCharacterKeys: customList.unplacedCharacterKeys }, rosterKeys);
    return {
      saved: true,
      updatedAt: customList.updatedAt ?? null,
      ...normalized,
    };
  }

  private normalizeCustomPayload(
    payload: { tiers?: Array<{ tier?: string; characterKeys?: unknown }>; unplacedCharacterKeys?: unknown },
    rosterKeys: string[],
  ): { tiers: Array<{ tier: CustomCharacterTier; characterKeys: string[] }>; unplacedCharacterKeys: string[] } {
    const validKeys = new Set(rosterKeys);
    const usedKeys = new Set<string>();
    const byTier = new Map<CustomCharacterTier, string[]>(DEFAULT_TIERS.map((tier) => [tier, []]));

    for (const bucket of payload.tiers ?? []) {
      if (!this.isCustomTier(bucket.tier)) {
        throw new CharacterTierListServiceError(400, "Tier list contains an invalid tier");
      }

      if (!Array.isArray(bucket.characterKeys)) {
        throw new CharacterTierListServiceError(400, "Tier list contains invalid characters");
      }

      const keys = byTier.get(bucket.tier)!;
      for (const characterKey of bucket.characterKeys) {
        if (typeof characterKey !== "string" || !validKeys.has(characterKey)) {
          throw new CharacterTierListServiceError(400, "Tier list contains a character that is not in this guild raid roster");
        }
        if (usedKeys.has(characterKey)) {
          throw new CharacterTierListServiceError(400, "A character can only appear once in a custom tier list");
        }
        usedKeys.add(characterKey);
        keys.push(characterKey);
      }
    }

    const unplacedCharacterKeys: string[] = [];
    if (Array.isArray(payload.unplacedCharacterKeys)) {
      for (const characterKey of payload.unplacedCharacterKeys) {
        if (typeof characterKey !== "string" || !validKeys.has(characterKey)) {
          throw new CharacterTierListServiceError(400, "Tier list contains a character that is not in this guild raid roster");
        }
        if (usedKeys.has(characterKey)) continue;
        usedKeys.add(characterKey);
        unplacedCharacterKeys.push(characterKey);
      }
    }

    for (const characterKey of rosterKeys) {
      if (!usedKeys.has(characterKey)) {
        usedKeys.add(characterKey);
        unplacedCharacterKeys.push(characterKey);
      }
    }

    return {
      tiers: DEFAULT_TIERS.map((tier) => ({ tier, characterKeys: byTier.get(tier) ?? [] })),
      unplacedCharacterKeys,
    };
  }

  private async createShareId(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const shareId = randomBytes(9).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const existing = await SharedCharacterTierList.exists({ shareId });
      if (!existing) return shareId;
    }

    throw new CharacterTierListServiceError(500, "Failed to create shared tier list link");
  }

  private validateShareId(shareId: string): void {
    if (!SHARE_ID_PATTERN.test(shareId)) {
      throw new CharacterTierListServiceError(400, "Invalid shared tier list link");
    }
  }

  private toUserObjectId(userId: string | null | undefined): mongoose.Types.ObjectId | null {
    return userId && mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
  }

  private requireUserObjectId(userId: string | undefined): mongoose.Types.ObjectId {
    const userObjectId = this.toUserObjectId(userId);
    if (!userObjectId) {
      throw new CharacterTierListServiceError(401, "Login is required");
    }
    return userObjectId;
  }

  private isSharedOwner(sharedList: Pick<ISharedCharacterTierList, "userId">, userObjectId: mongoose.Types.ObjectId | null): boolean {
    return !!sharedList.userId && !!userObjectId && sharedList.userId.toString() === userObjectId.toString();
  }

  private isCustomTier(value: unknown): value is CustomCharacterTier {
    return typeof value === "string" && (DEFAULT_TIERS as string[]).includes(value);
  }

  private buildEntryQuery(zoneId: number, filters: NormalizedCharacterTierListFilters, guildId: mongoose.Types.ObjectId | null): Record<string, unknown> {
    const query: Record<string, unknown> = {
      zoneId,
      scope: guildId ? "guild" : "global",
      guildId,
      reportCount: { $gte: filters.minReports },
      pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
    };

    if (filters.role) {
      query.role = filters.role;
    }

    if (filters.classId) {
      query.classID = filters.classId;
    }

    return query;
  }

  private normalizeFilters(filters: CharacterTierListFilters, defaultMinReports: number): NormalizedCharacterTierListFilters {
    return {
      minReports: Math.max(1, Math.min(999, Math.floor(filters.minReports ?? defaultMinReports))),
      role: filters.role ?? null,
      classId: filters.classId ?? null,
      limit: filters.limit === null ? null : Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.floor(filters.limit ?? 400))),
    };
  }

  private async getRaidInfo(zoneId: number): Promise<{ id: number; name: string }> {
    const raid = await Raid.findOne({ id: zoneId }).select("id name -_id").lean<{ id: number; name: string } | null>();
    return raid ? { id: raid.id, name: raid.name } : { id: zoneId, name: `Raid ${zoneId}` };
  }

  private async findGuild(realm: string, name: string): Promise<{ _id: mongoose.Types.ObjectId; name: string; realm: string } | null> {
    return Guild.findOne({
      realm: new RegExp(`^${this.escapeRegex(realm)}$`, "i"),
      name: new RegExp(`^${this.escapeRegex(name)}$`, "i"),
    })
      .select("_id name realm")
      .lean<{ _id: mongoose.Types.ObjectId; name: string; realm: string } | null>();
  }

  private formatGeneratedCharacter(
    entry: ICharacterTierListEntry,
    accountGroupIdByCharacterId: Map<string, string> = new Map(),
    primaryGuildByCharacterId: Map<string, CharacterRaidGuild> = new Map(),
  ): CharacterTierListCharacter {
    const characterId = entry.characterId?.toString() ?? null;
    const primaryGuild = characterId ? primaryGuildByCharacterId.get(characterId) : null;

    return {
      characterKey: entry.characterKey,
      characterId,
      accountGroupId: characterId ? accountGroupIdByCharacterId.get(characterId) ?? null : null,
      wclCanonicalCharacterId: entry.wclCanonicalCharacterId ?? null,
      name: entry.name,
      realm: entry.realm,
      region: entry.region,
      classID: entry.classID,
      guildName: primaryGuild?.name ?? entry.guildName ?? null,
      role: entry.role,
      metric: entry.metric,
      specName: entry.specName,
      bestSpecName: entry.bestSpecName ?? null,
      ilvl: entry.ilvl,
      score: entry.score,
      parseScore: entry.parseScore,
      survivalScore: entry.survivalScore,
      rankPercent: entry.rankPercent,
      medianPercent: entry.medianPercent,
      totalKills: entry.totalKills,
      pulls: entry.pulls,
      deaths: entry.deaths,
      survivedPulls: entry.survivedPulls,
      earlyDeaths: entry.earlyDeaths,
      averageDeathPercent: entry.averageDeathPercent,
      deathDataAvailable: entry.deathDataAvailable,
      bossScores: entry.bossScores ?? [],
      reportCount: entry.reportCount,
      mythicReportCount: entry.mythicReportCount,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      sourceUpdatedAt: entry.sourceUpdatedAt,
    };
  }

  private findByAliases<T>(map: Map<string, T>, aliases: string[]): T | null {
    for (const alias of aliases) {
      const value = map.get(alias);
      if (value) return value;
    }
    return null;
  }

  private findGuildAggregatesByAliases(map: Map<string, Map<string, GuildParticipationAggregate>>, aliases: string[]): GuildParticipationAggregate[] {
    const byKey = new Map<string, GuildParticipationAggregate>();
    for (const alias of aliases) {
      const guildMap = map.get(alias);
      if (!guildMap) continue;
      for (const [key, value] of guildMap) {
        byKey.set(key, value);
      }
    }
    return Array.from(byKey.values());
  }

  private getIdentityKeys(parts: {
    characterId?: mongoose.Types.ObjectId | null;
    wclCanonicalCharacterId?: number | null;
    classID: number;
    region?: string;
    realm?: string;
    name?: string;
    characterRegion?: string;
    characterRealm?: string;
    characterName?: string;
  }): string[] {
    const keys: string[] = [];
    const canonicalId = parts.wclCanonicalCharacterId;
    if (typeof canonicalId === "number" && Number.isFinite(canonicalId)) {
      keys.push(`canonical:${canonicalId}:${parts.classID}`);
    }
    if (parts.characterId) {
      keys.push(`character:${parts.characterId.toString()}`);
    }
    const region = parts.region ?? parts.characterRegion;
    const realm = parts.realm ?? parts.characterRealm;
    const name = parts.name ?? parts.characterName;
    if (region && realm && name) {
      keys.push(`fallback:${this.normalizeIdentityPart(region)}:${this.normalizeIdentityPart(realm)}:${this.normalizeIdentityPart(name)}:${parts.classID}`);
    }
    return Array.from(new Set(keys));
  }

  private buildCharacterKey(parts: {
    characterId?: mongoose.Types.ObjectId | null;
    wclCanonicalCharacterId?: number | null;
    classID: number;
    region?: string;
    realm?: string;
    name?: string;
    characterRegion?: string;
    characterRealm?: string;
    characterName?: string;
  }): string {
    const aliases = this.getIdentityKeys({
      ...parts,
      realm: parts.realm ?? parts.characterRealm ?? "",
      name: parts.name ?? parts.characterName ?? "",
    });

    if (aliases.length === 0) {
      throw new CharacterTierListServiceError(500, "Character identity is missing");
    }

    return aliases[0];
  }

  private normalizeIdentityPart(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, "-");
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export default new CharacterTierListService();
