import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import { TRACKED_RAIDS } from "../config/guilds";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterMechanicsLeaderboard from "../models/CharacterMechanicsLeaderboard";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import Guild from "../models/Guild";
import GuildProfileHighlight, {
  IGuildProfileHighlightMainstay,
  IGuildProfileHighlightTopPerformer,
  GuildProfileHighlightKind,
} from "../models/GuildProfileHighlight";
import Raid from "../models/Raid";
import cacheService from "./cache.service";
import logger from "../utils/logger";

const MYTHIC_DIFFICULTY = 5;
const HIGHLIGHT_LIMIT = 6;
const TOP_PERFORMER_MIN_PULLS = 100;

type GuildRow = {
  _id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
};

type RaidRow = {
  id: number;
  name: string;
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
  updatedAt?: Date;
};

type MechanicsRow = {
  characterId: mongoose.Types.ObjectId;
  wclCanonicalCharacterId: number;
  zoneId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  metric: "dps" | "hps";
  score: number;
  parseScore: number;
  survivalScore: number | null;
  pulls: number;
  deaths: number;
  earlyDeaths: number;
  guildName?: string | null;
  guildRealm?: string | null;
  updatedAt?: Date;
};

type AccountGroupRow = {
  _id: mongoose.Types.ObjectId;
  slug?: string | null;
  displayName?: string | null;
  characterIds?: mongoose.Types.ObjectId[];
};

type AccountInfo = {
  id: mongoose.Types.ObjectId;
  idString: string;
  slug?: string | null;
  displayName?: string | null;
};

type DisplayIdentity = {
  characterId?: mongoose.Types.ObjectId | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  reportCount: number;
  lastSeenAt?: Date | null;
};

type CharacterParticipationAggregate = {
  identityKey: string;
  characterId?: mongoose.Types.ObjectId | null;
  name: string;
  realm: string;
  region: string;
  classID: number;
  reportCount: number;
  raidIds: Set<number>;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type MemberAggregate = {
  identityKey: string;
  account?: AccountInfo;
  characterIds: Set<string>;
  raidIds: Set<number>;
  reportCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  primary: DisplayIdentity;
};

type TopPerformerAggregate = MemberAggregate & {
  performanceRaidIds: Set<number>;
  participationKeys: Set<string>;
  pulls: number;
  deaths: number;
  earlyDeaths: number;
  bestRow: MechanicsRow;
};

type ParticipationTarget = {
  guildId: string;
  participation?: CharacterParticipationAggregate;
};

export type GuildProfileHighlightsResponse = {
  generatedAt: Date;
  sourceUpdatedAt?: Date | null;
  mainstays: Array<
    Omit<IGuildProfileHighlightMainstay, "characterId" | "accountGroupId"> & {
      characterId?: string | null;
      accountGroupId?: string | null;
    }
  >;
  topPerformers: Array<
    Omit<IGuildProfileHighlightTopPerformer, "characterId" | "accountGroupId"> & {
      characterId?: string | null;
      accountGroupId?: string | null;
    }
  >;
};

class GuildProfileHighlightsService {
  private normalize(value?: string | null): string {
    return (value ?? "").trim().toLowerCase();
  }

  private guildLookupKey(name?: string | null, realm?: string | null): string {
    return `${this.normalize(name)}:${this.normalize(realm)}`;
  }

  private toObjectIdString(value?: mongoose.Types.ObjectId | string | null): string | null {
    return value ? value.toString() : null;
  }

  private getParticipationIdentityKey(row: ParticipationRow): string {
    const characterId = this.toObjectIdString(row.characterId);
    if (characterId) return `character:${characterId}`;
    if (typeof row.wclCanonicalCharacterId === "number") return `canonical:${row.wclCanonicalCharacterId}:${row.classID}`;
    return `fallback:${this.normalize(row.characterRegion)}:${this.normalize(row.characterRealm)}:${this.normalize(row.characterName)}:${row.classID}`;
  }

  private isValidDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
  }

  private maxDate(values: Array<Date | null | undefined>): Date | null {
    const valid = values.filter((value): value is Date => this.isValidDate(value));
    if (valid.length === 0) return null;
    return valid.reduce((latest, value) => (value > latest ? value : latest), valid[0]);
  }

  private getDisplayNameSortValue(value: string): string {
    return value.toLocaleLowerCase("en");
  }

  private preferIdentity(current: DisplayIdentity, candidate: DisplayIdentity): DisplayIdentity {
    const reportDiff = candidate.reportCount - current.reportCount;
    if (reportDiff > 0) return candidate;
    if (reportDiff < 0) return current;

    const currentLastSeen = current.lastSeenAt?.getTime() ?? 0;
    const candidateLastSeen = candidate.lastSeenAt?.getTime() ?? 0;
    if (candidateLastSeen > currentLastSeen) return candidate;
    if (candidateLastSeen < currentLastSeen) return current;

    return this.getDisplayNameSortValue(candidate.name) < this.getDisplayNameSortValue(current.name) ? candidate : current;
  }

  private addParticipationToCharacterAggregate(
    characterAggregatesByGuild: Map<string, Map<string, CharacterParticipationAggregate>>,
    row: ParticipationRow,
  ): void {
    const guildId = row.reportGuildId.toString();
    let guildAggregates = characterAggregatesByGuild.get(guildId);
    if (!guildAggregates) {
      guildAggregates = new Map();
      characterAggregatesByGuild.set(guildId, guildAggregates);
    }

    const identityKey = this.getParticipationIdentityKey(row);
    const existing = guildAggregates.get(identityKey);

    if (!existing) {
      guildAggregates.set(identityKey, {
        identityKey,
        characterId: row.characterId ?? null,
        name: row.characterName,
        realm: row.characterRealm,
        region: row.characterRegion,
        classID: row.classID,
        reportCount: row.reportCount,
        raidIds: new Set([row.zoneId]),
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
      });
      return;
    }

    existing.reportCount += row.reportCount;
    existing.raidIds.add(row.zoneId);
    if (row.firstSeenAt < existing.firstSeenAt) existing.firstSeenAt = row.firstSeenAt;
    if (row.lastSeenAt > existing.lastSeenAt) {
      existing.lastSeenAt = row.lastSeenAt;
      existing.name = row.characterName;
      existing.realm = row.characterRealm;
      existing.region = row.characterRegion;
      existing.classID = row.classID;
    }

    if (!existing.characterId && row.characterId) existing.characterId = row.characterId;
  }

  private createMemberAggregate(identityKey: string, aggregate: CharacterParticipationAggregate, account?: AccountInfo): MemberAggregate {
    const characterId = this.toObjectIdString(aggregate.characterId);
    return {
      identityKey,
      account,
      characterIds: new Set(characterId ? [characterId] : [aggregate.identityKey]),
      raidIds: new Set(aggregate.raidIds),
      reportCount: aggregate.reportCount,
      firstSeenAt: aggregate.firstSeenAt,
      lastSeenAt: aggregate.lastSeenAt,
      primary: {
        characterId: aggregate.characterId ?? null,
        name: aggregate.name,
        realm: aggregate.realm,
        region: aggregate.region,
        classID: aggregate.classID,
        reportCount: aggregate.reportCount,
        lastSeenAt: aggregate.lastSeenAt,
      },
    };
  }

  private addCharacterAggregateToMember(member: MemberAggregate, aggregate: CharacterParticipationAggregate): void {
    const characterId = this.toObjectIdString(aggregate.characterId);
    member.characterIds.add(characterId ?? aggregate.identityKey);
    for (const raidId of aggregate.raidIds) member.raidIds.add(raidId);
    member.reportCount += aggregate.reportCount;
    if (!member.firstSeenAt || aggregate.firstSeenAt < member.firstSeenAt) member.firstSeenAt = aggregate.firstSeenAt;
    if (!member.lastSeenAt || aggregate.lastSeenAt > member.lastSeenAt) member.lastSeenAt = aggregate.lastSeenAt;
    member.primary = this.preferIdentity(member.primary, {
      characterId: aggregate.characterId ?? null,
      name: aggregate.name,
      realm: aggregate.realm,
      region: aggregate.region,
      classID: aggregate.classID,
      reportCount: aggregate.reportCount,
      lastSeenAt: aggregate.lastSeenAt,
    });
  }

  private resolveKind(member: MemberAggregate): GuildProfileHighlightKind {
    return member.account && member.characterIds.size > 1 ? "account" : "character";
  }

  private getMemberName(member: MemberAggregate): string {
    return this.resolveKind(member) === "account" ? member.account?.displayName || member.primary.name : member.primary.name;
  }

  private toMainstay(member: MemberAggregate): IGuildProfileHighlightMainstay {
    const kind = this.resolveKind(member);
    return {
      kind,
      characterId: kind === "character" ? member.primary.characterId ?? null : null,
      accountGroupId: kind === "account" ? member.account?.id ?? null : null,
      accountSlug: kind === "account" ? member.account?.slug ?? null : null,
      accountDisplayName: kind === "account" ? member.account?.displayName ?? null : null,
      name: this.getMemberName(member),
      realm: member.primary.realm,
      region: member.primary.region,
      classID: member.primary.classID,
      characterCount: member.characterIds.size,
      reportCount: member.reportCount,
      raidCount: member.raidIds.size,
      firstSeenAt: member.firstSeenAt ?? new Date(0),
      lastSeenAt: member.lastSeenAt ?? member.firstSeenAt ?? new Date(0),
    };
  }

  private buildMainstaysForGuild(
    characterAggregates: Map<string, CharacterParticipationAggregate> | undefined,
    accountByCharacterId: Map<string, AccountInfo>,
  ): IGuildProfileHighlightMainstay[] {
    if (!characterAggregates || characterAggregates.size === 0) return [];

    const memberAggregates = new Map<string, MemberAggregate>();
    for (const characterAggregate of characterAggregates.values()) {
      const characterId = this.toObjectIdString(characterAggregate.characterId);
      const account = characterId ? accountByCharacterId.get(characterId) : undefined;
      const identityKey = account ? `account:${account.idString}` : `character:${characterAggregate.identityKey}`;
      const existing = memberAggregates.get(identityKey);

      if (!existing) {
        memberAggregates.set(identityKey, this.createMemberAggregate(identityKey, characterAggregate, account));
      } else {
        this.addCharacterAggregateToMember(existing, characterAggregate);
      }
    }

    return Array.from(memberAggregates.values())
      .map((member) => this.toMainstay(member))
      .sort((a, b) => {
        const firstSeenDiff = a.firstSeenAt.getTime() - b.firstSeenAt.getTime();
        if (firstSeenDiff !== 0) return firstSeenDiff;
        const raidDiff = b.raidCount - a.raidCount;
        if (raidDiff !== 0) return raidDiff;
        const reportDiff = b.reportCount - a.reportCount;
        if (reportDiff !== 0) return reportDiff;
        const lastSeenDiff = b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
        if (lastSeenDiff !== 0) return lastSeenDiff;
        return this.getDisplayNameSortValue(a.name).localeCompare(this.getDisplayNameSortValue(b.name));
      })
      .slice(0, HIGHLIGHT_LIMIT);
  }

  private isBetterMechanicsRow(candidate: MechanicsRow, existing?: MechanicsRow): boolean {
    if (!existing) return true;
    const scoreDiff = candidate.score - existing.score;
    if (scoreDiff !== 0) return scoreDiff > 0;
    const pullsDiff = candidate.pulls - existing.pulls;
    if (pullsDiff !== 0) return pullsDiff > 0;
    const updatedDiff = (candidate.updatedAt?.getTime() ?? 0) - (existing.updatedAt?.getTime() ?? 0);
    if (updatedDiff !== 0) return updatedDiff > 0;
    return this.getDisplayNameSortValue(candidate.name) < this.getDisplayNameSortValue(existing.name);
  }

  private createTopAggregate(identityKey: string, row: MechanicsRow, account?: AccountInfo): TopPerformerAggregate {
    const characterId = row.characterId.toString();
    return {
      identityKey,
      account,
      characterIds: new Set([characterId]),
      raidIds: new Set(),
      reportCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      primary: {
        characterId: row.characterId,
        name: row.name,
        realm: row.realm,
        region: row.region,
        classID: row.classID,
        reportCount: 0,
        lastSeenAt: row.updatedAt ?? null,
      },
      performanceRaidIds: new Set(),
      participationKeys: new Set(),
      pulls: 0,
      deaths: 0,
      earlyDeaths: 0,
      bestRow: row,
    };
  }

  private addParticipationStatsToTopAggregate(topAggregate: TopPerformerAggregate, participation?: CharacterParticipationAggregate): void {
    if (!participation) return;

    const participationKey = participation.identityKey;
    if (topAggregate.participationKeys.has(participationKey)) return;
    topAggregate.participationKeys.add(participationKey);

    this.addCharacterAggregateToMember(topAggregate, participation);
  }

  private addMechanicsRowToTopAggregate(topAggregate: TopPerformerAggregate, row: MechanicsRow): void {
    topAggregate.characterIds.add(row.characterId.toString());
    topAggregate.performanceRaidIds.add(row.zoneId);
    topAggregate.pulls += row.pulls;
    topAggregate.deaths += row.deaths;
    topAggregate.earlyDeaths += row.earlyDeaths;

    if (this.isBetterMechanicsRow(row, topAggregate.bestRow)) {
      topAggregate.bestRow = row;
      topAggregate.primary = this.preferIdentity(topAggregate.primary, {
        characterId: row.characterId,
        name: row.name,
        realm: row.realm,
        region: row.region,
        classID: row.classID,
        reportCount: topAggregate.primary.reportCount,
        lastSeenAt: row.updatedAt ?? null,
      });
    }
  }

  private toTopPerformer(member: TopPerformerAggregate, raidNameById: Map<number, string>): IGuildProfileHighlightTopPerformer {
    const kind = this.resolveKind(member);
    const bestRow = member.bestRow;
    return {
      kind,
      characterId: kind === "character" ? member.primary.characterId ?? bestRow.characterId : null,
      accountGroupId: kind === "account" ? member.account?.id ?? null : null,
      accountSlug: kind === "account" ? member.account?.slug ?? null : null,
      accountDisplayName: kind === "account" ? member.account?.displayName ?? null : null,
      name: this.getMemberName(member),
      realm: member.primary.realm,
      region: member.primary.region,
      classID: member.primary.classID,
      characterCount: member.characterIds.size,
      reportCount: member.reportCount,
      raidCount: member.raidIds.size || member.performanceRaidIds.size,
      performanceRaidCount: member.performanceRaidIds.size,
      firstSeenAt: member.firstSeenAt,
      lastSeenAt: member.lastSeenAt,
      score: bestRow.score,
      parseScore: bestRow.parseScore,
      survivalScore: bestRow.survivalScore,
      pulls: member.pulls,
      deaths: member.deaths,
      earlyDeaths: member.earlyDeaths,
      metric: bestRow.metric,
      role: bestRow.role,
      specName: bestRow.specName,
      zoneId: bestRow.zoneId,
      raidName: raidNameById.get(bestRow.zoneId) ?? `Raid ${bestRow.zoneId}`,
    };
  }

  private buildTopPerformersByGuild(
    mechanicsRows: MechanicsRow[],
    guildByNameRealm: Map<string, GuildRow>,
    accountByCharacterId: Map<string, AccountInfo>,
    accountMemberCountsByGuild: Map<string, number>,
    participationByGuildCharacterId: Map<string, CharacterParticipationAggregate>,
    participationsByCharacterZone: Map<string, ParticipationTarget[]>,
    raidNameById: Map<number, string>,
  ): Map<string, IGuildProfileHighlightTopPerformer[]> {
    const bestMechanicsByCharacterZone = new Map<string, MechanicsRow>();

    for (const row of mechanicsRows) {
      if (!Number.isFinite(row.score) || row.pulls < TOP_PERFORMER_MIN_PULLS) continue;

      const key = `${row.characterId.toString()}:${row.zoneId}`;
      const existing = bestMechanicsByCharacterZone.get(key);
      if (this.isBetterMechanicsRow(row, existing)) {
        bestMechanicsByCharacterZone.set(key, row);
      }
    }

    const topAggregatesByGuild = new Map<string, Map<string, TopPerformerAggregate>>();

    for (const row of bestMechanicsByCharacterZone.values()) {
      const characterId = row.characterId.toString();
      const participationTargets = participationsByCharacterZone.get(`${characterId}:${row.zoneId}`) ?? [];
      const fallbackGuild = participationTargets.length === 0 ? guildByNameRealm.get(this.guildLookupKey(row.guildName, row.guildRealm)) : undefined;
      const targets =
        participationTargets.length > 0
          ? participationTargets
          : fallbackGuild
            ? [
                {
                  guildId: fallbackGuild._id.toString(),
                  participation: participationByGuildCharacterId.get(`${fallbackGuild._id.toString()}:${characterId}`),
                },
              ]
            : [];

      for (const target of targets) {
        const account = accountByCharacterId.get(characterId);
        const accountGuildCharacterCount = account ? accountMemberCountsByGuild.get(`${target.guildId}:${account.idString}`) ?? 0 : 0;
        const identityKey = account && accountGuildCharacterCount > 1 ? `account:${account.idString}` : `character:${characterId}`;

        let guildTopAggregates = topAggregatesByGuild.get(target.guildId);
        if (!guildTopAggregates) {
          guildTopAggregates = new Map();
          topAggregatesByGuild.set(target.guildId, guildTopAggregates);
        }

        let topAggregate = guildTopAggregates.get(identityKey);
        if (!topAggregate) {
          topAggregate = this.createTopAggregate(identityKey, row, account && accountGuildCharacterCount > 1 ? account : undefined);
          guildTopAggregates.set(identityKey, topAggregate);
        }

        this.addParticipationStatsToTopAggregate(topAggregate, target.participation);
        this.addMechanicsRowToTopAggregate(topAggregate, row);
      }
    }

    const result = new Map<string, IGuildProfileHighlightTopPerformer[]>();
    for (const [guildId, guildTopAggregates] of topAggregatesByGuild.entries()) {
      const topPerformers = Array.from(guildTopAggregates.values())
        .map((member) => this.toTopPerformer(member, raidNameById))
        .sort((a, b) => {
          const scoreDiff = b.score - a.score;
          if (scoreDiff !== 0) return scoreDiff;
          const performanceRaidDiff = b.performanceRaidCount - a.performanceRaidCount;
          if (performanceRaidDiff !== 0) return performanceRaidDiff;
          const pullDiff = b.pulls - a.pulls;
          if (pullDiff !== 0) return pullDiff;
          return this.getDisplayNameSortValue(a.name).localeCompare(this.getDisplayNameSortValue(b.name));
        })
        .slice(0, HIGHLIGHT_LIMIT);

      result.set(guildId, topPerformers);
    }

    return result;
  }

  async rebuildHighlights(): Promise<{ guilds: number; mainstays: number; topPerformers: number; generatedAt: Date }> {
    const startedAt = Date.now();
    const generatedAt = new Date();
    logger.info("[GuildProfileHighlights] Starting rebuild");

    const [guilds, participationRows, mechanicsRows, raids, accountGroups, latestParticipation, latestMechanics, latestAccountGroup] = await Promise.all([
      Guild.find({}).select("_id name realm").lean<GuildRow[]>(),
      CharacterRaidParticipation.find({ zoneId: { $in: TRACKED_RAIDS } })
        .select(
          "characterId wclCanonicalCharacterId zoneId reportGuildId reportGuildName reportGuildRealm characterName characterRealm characterRegion classID firstSeenAt lastSeenAt reportCount updatedAt -_id",
        )
        .lean<ParticipationRow[]>(),
      CharacterMechanicsLeaderboard.find({
        zoneId: { $in: TRACKED_RAIDS },
        difficulty: MYTHIC_DIFFICULTY,
        type: "overall",
        encounterId: null,
        deathDataAvailable: true,
        survivalScore: { $ne: null },
        pulls: { $gte: TOP_PERFORMER_MIN_PULLS },
      })
        .select(
          "characterId wclCanonicalCharacterId zoneId name realm region classID specName role metric score parseScore survivalScore pulls deaths earlyDeaths guildName guildRealm updatedAt -_id",
        )
        .lean<MechanicsRow[]>(),
      Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name -_id").lean<RaidRow[]>(),
      CharacterAccountGroup.find({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION })
        .select("_id slug displayName characterIds")
        .lean<AccountGroupRow[]>(),
      CharacterRaidParticipation.findOne({ zoneId: { $in: TRACKED_RAIDS } }).sort({ updatedAt: -1 }).select("updatedAt -_id").lean<{ updatedAt?: Date }>(),
      CharacterMechanicsLeaderboard.findOne({ zoneId: { $in: TRACKED_RAIDS } }).sort({ updatedAt: -1 }).select("updatedAt -_id").lean<{ updatedAt?: Date }>(),
      CharacterAccountGroup.findOne({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION }).sort({ updatedAt: -1 }).select("updatedAt generatedAt -_id").lean<{ updatedAt?: Date; generatedAt?: Date }>(),
    ]);

    if (guilds.length === 0) {
      await GuildProfileHighlight.deleteMany({});
      await cacheService.invalidatePattern(/^guild:.*:summary$/);
      return { guilds: 0, mainstays: 0, topPerformers: 0, generatedAt };
    }

    const accountByCharacterId = new Map<string, AccountInfo>();
    for (const group of accountGroups) {
      const accountInfo: AccountInfo = {
        id: group._id,
        idString: group._id.toString(),
        slug: group.slug ?? null,
        displayName: group.displayName ?? null,
      };

      for (const characterId of group.characterIds ?? []) {
        accountByCharacterId.set(characterId.toString(), accountInfo);
      }
    }

    const guildByNameRealm = new Map<string, GuildRow>();
    for (const guild of guilds) {
      guildByNameRealm.set(this.guildLookupKey(guild.name, guild.realm), guild);
    }

    const raidNameById = new Map(raids.map((raid) => [raid.id, raid.name]));
    const characterAggregatesByGuild = new Map<string, Map<string, CharacterParticipationAggregate>>();

    for (const row of participationRows) {
      this.addParticipationToCharacterAggregate(characterAggregatesByGuild, row);
    }

    const participationByGuildCharacterId = new Map<string, CharacterParticipationAggregate>();
    const participationsByCharacterZone = new Map<string, ParticipationTarget[]>();
    const accountMemberCountsByGuild = new Map<string, number>();

    for (const [guildId, characterAggregates] of characterAggregatesByGuild.entries()) {
      const accountCharacterIdsByGuild = new Map<string, Set<string>>();

      for (const characterAggregate of characterAggregates.values()) {
        const characterId = this.toObjectIdString(characterAggregate.characterId);
        if (!characterId) continue;

        participationByGuildCharacterId.set(`${guildId}:${characterId}`, characterAggregate);
        for (const raidId of characterAggregate.raidIds) {
          const characterZoneKey = `${characterId}:${raidId}`;
          const targets = participationsByCharacterZone.get(characterZoneKey) ?? [];
          targets.push({ guildId, participation: characterAggregate });
          participationsByCharacterZone.set(characterZoneKey, targets);
        }

        const account = accountByCharacterId.get(characterId);
        if (!account) continue;

        let characterIds = accountCharacterIdsByGuild.get(account.idString);
        if (!characterIds) {
          characterIds = new Set();
          accountCharacterIdsByGuild.set(account.idString, characterIds);
        }
        characterIds.add(characterId);
      }

      for (const [accountId, characterIds] of accountCharacterIdsByGuild.entries()) {
        accountMemberCountsByGuild.set(`${guildId}:${accountId}`, characterIds.size);
      }
    }

    const topPerformersByGuild = this.buildTopPerformersByGuild(
      mechanicsRows,
      guildByNameRealm,
      accountByCharacterId,
      accountMemberCountsByGuild,
      participationByGuildCharacterId,
      participationsByCharacterZone,
      raidNameById,
    );

    const sourceUpdatedAt =
      this.maxDate([latestParticipation?.updatedAt, latestMechanics?.updatedAt, latestAccountGroup?.updatedAt, latestAccountGroup?.generatedAt]) ?? generatedAt;
    const activeGuildIds = guilds.map((guild) => guild._id);
    const documents = guilds.map((guild) => {
      const guildId = guild._id.toString();
      const mainstays = this.buildMainstaysForGuild(characterAggregatesByGuild.get(guildId), accountByCharacterId);
      const topPerformers = topPerformersByGuild.get(guildId) ?? [];

      return {
        guildId: guild._id,
        guildName: guild.name,
        guildRealm: guild.realm,
        generatedAt,
        sourceUpdatedAt,
        mainstays,
        topPerformers,
      };
    });

    await GuildProfileHighlight.bulkWrite(
      documents.map((document) => ({
        updateOne: {
          filter: { guildId: document.guildId },
          update: { $set: document },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    await GuildProfileHighlight.deleteMany({ guildId: { $nin: activeGuildIds } });
    await cacheService.invalidatePattern(/^guild:.*:summary$/);

    const mainstayCount = documents.reduce((sum, document) => sum + document.mainstays.length, 0);
    const topPerformerCount = documents.reduce((sum, document) => sum + document.topPerformers.length, 0);
    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    logger.info(
      `[GuildProfileHighlights] Rebuild complete in ${duration}s: ${documents.length} guilds, ${mainstayCount} mainstay cards, ${topPerformerCount} top performer cards`,
    );

    return {
      guilds: documents.length,
      mainstays: mainstayCount,
      topPerformers: topPerformerCount,
      generatedAt,
    };
  }

  async getHighlightsForGuild(guildId: mongoose.Types.ObjectId | string): Promise<GuildProfileHighlightsResponse | null> {
    const highlight = await GuildProfileHighlight.findOne({ guildId }).select("generatedAt sourceUpdatedAt mainstays topPerformers -_id").lean();
    if (!highlight) return null;

    return {
      generatedAt: highlight.generatedAt,
      sourceUpdatedAt: highlight.sourceUpdatedAt,
      mainstays: (highlight.mainstays ?? []).map((member) => ({
        ...member,
        characterId: this.toObjectIdString(member.characterId),
        accountGroupId: this.toObjectIdString(member.accountGroupId),
      })),
      topPerformers: (highlight.topPerformers ?? []).map((member) => ({
        ...member,
        characterId: this.toObjectIdString(member.characterId),
        accountGroupId: this.toObjectIdString(member.accountGroupId),
      })),
    };
  }
}

export default new GuildProfileHighlightsService();
