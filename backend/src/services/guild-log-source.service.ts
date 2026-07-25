import mongoose from "mongoose";
import Guild, { IGuild } from "../models/Guild";
import GuildLogSource, { GuildLogSourceSyncPolicy, IGuildLogSource } from "../models/GuildLogSource";
import Report from "../models/Report";
import Fight from "../models/Fight";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import GuildProcessingQueue from "../models/GuildProcessingQueue";
import Event from "../models/Event";
import FightVodLink from "../models/FightVodLink";
import WorldRankHistory from "../models/WorldRankHistory";
import GuildProfileHighlight from "../models/GuildProfileHighlight";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import TierList from "../models/TierList";
import CustomCharacterTierList from "../models/CustomCharacterTierList";
import SharedCharacterTierList from "../models/SharedCharacterTierList";
import DiscordGuildIntegration from "../models/DiscordGuildIntegration";
import TwitchEventDelivery from "../models/TwitchEventDelivery";
import CcgCard from "../models/CcgCard";
import CcgCommunityCharacter from "../models/CcgCommunityCharacter";
import cacheService from "./cache.service";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;
const SUPPORTED_REGIONS = new Set(["EU", "US", "KR", "TW", "CN"]);
const ACTIVE_QUEUE_STATUSES = ["pending", "in_progress", "paused"] as const;

export type GuildLogSourceErrorCode =
  | "invalid_input"
  | "guild_not_found"
  | "source_not_found"
  | "source_already_exists"
  | "existing_guild_requires_migration"
  | "migration_blocked"
  | "transactions_unavailable";

export class GuildLogSourceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: GuildLogSourceErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "GuildLogSourceError";
  }
}

export interface CreateGuildLogSourceInput {
  name: string;
  realm: string;
  region: string;
  syncPolicy?: GuildLogSourceSyncPolicy;
  enabled?: boolean;
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
}

export interface GuildLogSourceMigrationResult {
  sourceGuildId: string;
  targetGuildId: string;
  sourceId: string;
  moved: {
    reports: number;
    fights: number;
    appearances: number;
    vodLinks: number;
    logSources: number;
  };
  warnings: string[];
}

export function normalizeGuildLogSourceInput(input: CreateGuildLogSourceInput): Required<Pick<CreateGuildLogSourceInput, "name" | "realm" | "region">> & {
  syncPolicy: GuildLogSourceSyncPolicy;
  enabled: boolean;
} {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const realm = typeof input.realm === "string" ? input.realm.trim() : "";
  const region = typeof input.region === "string" ? input.region.trim().toUpperCase() : "";
  const syncPolicy = input.syncPolicy === "active" ? "active" : "historical";

  if (!name || !realm) {
    throw new GuildLogSourceError(400, "invalid_input", "Warcraft Logs source name and realm are required");
  }
  if (!SUPPORTED_REGIONS.has(region)) {
    throw new GuildLogSourceError(400, "invalid_input", "Warcraft Logs source region must be EU, US, KR, TW, or CN");
  }

  return { name, realm, region, syncPolicy, enabled: input.enabled !== false };
}

export function getGuildLogSourceSnapshot(source: Pick<IGuildLogSource, "name" | "realm" | "region" | "warcraftlogsId">) {
  return {
    name: source.name,
    realm: source.realm,
    region: source.region,
    ...(source.warcraftlogsId ? { warcraftlogsId: source.warcraftlogsId } : {}),
  };
}

function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Transaction numbers are only allowed|replica set member|mongos/i.test(message);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
}

class GuildLogSourceService {
  async ensurePrimarySource(guild: IGuild): Promise<IGuildLogSource> {
    const guildId = guild._id as mongoose.Types.ObjectId;
    const existingPrimary = await GuildLogSource.findOne({ guildId, isPrimary: true });
    if (existingPrimary) {
      await this.backfillReportSources(guildId, existingPrimary);
      return existingPrimary;
    }

    const identityMatch = await GuildLogSource.findOne({
      name: guild.name,
      realm: guild.realm,
      region: guild.region,
    }).collation(CASE_INSENSITIVE_COLLATION);

    if (identityMatch && identityMatch.guildId.toString() !== guildId.toString()) {
      throw new GuildLogSourceError(409, "source_already_exists", `${guild.name}-${guild.realm} is already a log source for another guild`);
    }

    let source = identityMatch;
    if (!source) {
      try {
        source = await GuildLogSource.create({
          guildId,
          name: guild.name,
          realm: guild.realm,
          region: guild.region,
          warcraftlogsId: guild.warcraftlogsId,
          isPrimary: true,
          syncPolicy: "active",
          enabled: true,
          wclStatus: guild.wclStatus || "unknown",
          wclStatusUpdatedAt: guild.wclStatusUpdatedAt,
          wclNotFoundCount: guild.wclNotFoundCount || 0,
          initialFetchCompleted: guild.initialFetchCompleted || false,
          initialFetchCompletedAt: guild.initialFetchCompletedAt,
          lastFetched: guild.lastFetched,
          lastLogEndTime: guild.lastLogEndTime,
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        source = await GuildLogSource.findOne({ guildId, isPrimary: true });
        if (!source) throw error;
      }
    }

    if (!source.isPrimary || source.guildId.toString() !== guildId.toString()) {
      source.guildId = guildId;
      source.isPrimary = true;
      source.syncPolicy = "active";
      await source.save();
    }

    await this.backfillReportSources(guildId, source);
    return source;
  }

  async ensurePrimarySourcesForAllGuilds(): Promise<{ guilds: number; sources: number }> {
    await GuildLogSource.syncIndexes();
    let guilds = 0;
    let sources = 0;
    for await (const guild of Guild.find().cursor({ batchSize: 25 })) {
      await this.ensurePrimarySource(guild);
      guilds++;
      sources++;
    }
    return { guilds, sources };
  }

  private async backfillReportSources(guildId: mongoose.Types.ObjectId, source: IGuildLogSource): Promise<void> {
    await Report.updateMany(
      {
        guildId,
        $or: [{ warcraftLogsSourceId: { $exists: false } }, { warcraftLogsSourceId: null }],
      },
      {
        $set: {
          warcraftLogsSourceId: source._id,
          sourceGuildSnapshot: getGuildLogSourceSnapshot(source),
        },
      },
    );
  }

  async listForGuild(guildId: mongoose.Types.ObjectId | string): Promise<IGuildLogSource[]> {
    const guild = await Guild.findById(guildId);
    if (!guild) throw new GuildLogSourceError(404, "guild_not_found", "Guild not found");
    await this.ensurePrimarySource(guild);
    return GuildLogSource.find({ guildId: guild._id }).sort({ isPrimary: -1, createdAt: 1 });
  }

  async createSource(guildId: string, input: CreateGuildLogSourceInput): Promise<IGuildLogSource> {
    const guild = await Guild.findById(guildId);
    if (!guild) throw new GuildLogSourceError(404, "guild_not_found", "Guild not found");
    if (
      guild.logSourceMigrationLockToken &&
      guild.logSourceMigrationLockedAt &&
      guild.logSourceMigrationLockedAt.getTime() >= Date.now() - 2 * 60 * 60 * 1000
    ) {
      throw new GuildLogSourceError(409, "migration_blocked", "This guild is currently being migrated. Wait for the migration to finish.");
    }
    await this.ensurePrimarySource(guild);

    const normalized = normalizeGuildLogSourceInput(input);
    if (normalized.syncPolicy === "active") {
      throw new GuildLogSourceError(400, "invalid_input", "Secondary guild log sources are historical and are rescanned explicitly from Admin");
    }
    const existingGuild = await Guild.findOne({ name: normalized.name, realm: normalized.realm, region: normalized.region }).collation(CASE_INSENSITIVE_COLLATION);
    if (existingGuild && existingGuild._id.toString() !== guild._id.toString()) {
      throw new GuildLogSourceError(409, "existing_guild_requires_migration", "This Warcraft Logs identity is already a tracked guild. Use Convert existing guild so its stored data is preserved.", {
        existingGuildId: existingGuild._id.toString(),
      });
    }

    const existingSource = await GuildLogSource.findOne({ name: normalized.name, realm: normalized.realm, region: normalized.region }).collation(CASE_INSENSITIVE_COLLATION);
    if (existingSource) {
      throw new GuildLogSourceError(409, "source_already_exists", "This Warcraft Logs identity is already registered as a guild log source", {
        guildId: existingSource.guildId.toString(),
        sourceId: existingSource._id.toString(),
      });
    }

    try {
      return await GuildLogSource.create({
        guildId: guild._id,
        ...normalized,
        isPrimary: false,
        wclStatus: "unknown",
        initialFetchCompleted: false,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new GuildLogSourceError(409, "source_already_exists", "This Warcraft Logs identity was registered by another request");
      }
      throw error;
    }
  }

  async updateSource(guildId: string, sourceId: string, input: { enabled?: boolean; syncPolicy?: GuildLogSourceSyncPolicy }): Promise<IGuildLogSource> {
    const migrationInProgress = await Guild.exists({
      _id: guildId,
      logSourceMigrationLockToken: { $exists: true },
      logSourceMigrationLockedAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    if (migrationInProgress) {
      throw new GuildLogSourceError(409, "migration_blocked", "This guild is currently being migrated. Wait for the migration to finish.");
    }
    const source = await GuildLogSource.findOne({ _id: sourceId, guildId });
    if (!source) throw new GuildLogSourceError(404, "source_not_found", "Guild log source not found");
    if (source.isPrimary && input.enabled === false) {
      throw new GuildLogSourceError(400, "invalid_input", "The primary Warcraft Logs source cannot be disabled");
    }
    if (source.isPrimary && input.syncPolicy === "historical") {
      throw new GuildLogSourceError(400, "invalid_input", "The primary Warcraft Logs source must stay active");
    }
    if (!source.isPrimary && input.syncPolicy === "active") {
      throw new GuildLogSourceError(400, "invalid_input", "Secondary guild log sources are historical and are rescanned explicitly from Admin");
    }
    if (typeof input.enabled === "boolean") source.enabled = input.enabled;
    if (input.syncPolicy === "active" || input.syncPolicy === "historical") source.syncPolicy = input.syncPolicy;
    await source.save();
    return source;
  }

  async getMigrationPreview(targetGuildId: string, sourceGuildId: string): Promise<GuildLogSourceMigrationPreview> {
    if (!mongoose.Types.ObjectId.isValid(targetGuildId) || !mongoose.Types.ObjectId.isValid(sourceGuildId) || targetGuildId === sourceGuildId) {
      throw new GuildLogSourceError(400, "invalid_input", "Choose two different valid guilds");
    }

    const [targetGuild, sourceGuild] = await Promise.all([Guild.findById(targetGuildId).lean(), Guild.findById(sourceGuildId).lean()]);
    if (!targetGuild || !sourceGuild) throw new GuildLogSourceError(404, "guild_not_found", "Source or target guild not found");

    const sourceGuildObjectId = sourceGuild._id as mongoose.Types.ObjectId;
    const fightOwnershipMismatchesPromise = Fight.aggregate<{ count: number }>([
      { $match: { guildId: sourceGuildObjectId } },
      { $lookup: { from: Report.collection.name, localField: "reportCode", foreignField: "code", as: "report" } },
      { $match: { $expr: { $ne: [{ $arrayElemAt: ["$report.guildId", 0] }, sourceGuildObjectId] } } },
      { $count: "count" },
    ]).then((rows) => rows[0]?.count || 0);
    const appearanceOwnershipMismatchesPromise = CharacterReportAppearance.aggregate<{ count: number }>([
      { $match: { reportGuildId: sourceGuildObjectId } },
      { $lookup: { from: Report.collection.name, localField: "reportCode", foreignField: "code", as: "report" } },
      { $match: { $expr: { $ne: [{ $arrayElemAt: ["$report.guildId", 0] }, sourceGuildObjectId] } } },
      { $count: "count" },
    ]).then((rows) => rows[0]?.count || 0);
    const reportFightMismatchesPromise = Report.aggregate<{ count: number }>([
      { $match: { guildId: sourceGuildObjectId } },
      {
        $lookup: {
          from: Fight.collection.name,
          let: { reportCode: "$code" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$reportCode", "$$reportCode"] }, { $ne: ["$guildId", sourceGuildObjectId] }] } } },
            { $limit: 1 },
          ],
          as: "foreignFights",
        },
      },
      { $match: { "foreignFights.0": { $exists: true } } },
      { $count: "count" },
    ]).then((rows) => rows[0]?.count || 0);
    const reportAppearanceMismatchesPromise = Report.aggregate<{ count: number }>([
      { $match: { guildId: sourceGuildObjectId } },
      {
        $lookup: {
          from: CharacterReportAppearance.collection.name,
          let: { reportCode: "$code" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$reportCode", "$$reportCode"] }, { $ne: ["$reportGuildId", sourceGuildObjectId] }] } } },
            { $limit: 1 },
          ],
          as: "foreignAppearances",
        },
      },
      { $match: { "foreignAppearances.0": { $exists: true } } },
      { $count: "count" },
    ]).then((rows) => rows[0]?.count || 0);

    const [
      reports,
      fights,
      appearances,
      participations,
      events,
      vodLinks,
      logSources,
      activeQueues,
      customLists,
      sharedLists,
      ccgCards,
      ccgCommunityCharacters,
      fightOwnershipMismatches,
      appearanceOwnershipMismatches,
      reportFightMismatches,
      reportAppearanceMismatches,
    ] = await Promise.all([
      Report.countDocuments({ guildId: sourceGuild._id }),
      Fight.countDocuments({ guildId: sourceGuild._id }),
      CharacterReportAppearance.countDocuments({ reportGuildId: sourceGuild._id }),
      CharacterRaidParticipation.countDocuments({ reportGuildId: sourceGuild._id }),
      Event.countDocuments({ guildId: sourceGuild._id }),
      FightVodLink.countDocuments({ guildId: sourceGuild._id }),
      GuildLogSource.countDocuments({ guildId: sourceGuild._id }),
      GuildProcessingQueue.countDocuments({ guildId: { $in: [sourceGuild._id, targetGuild._id] }, status: { $in: ACTIVE_QUEUE_STATUSES } }),
      CustomCharacterTierList.countDocuments({ guildId: sourceGuild._id }),
      SharedCharacterTierList.countDocuments({ guildId: sourceGuild._id }),
      CcgCard.countDocuments({ guildId: sourceGuild._id }),
      CcgCommunityCharacter.countDocuments({ guildId: sourceGuild._id }),
      fightOwnershipMismatchesPromise,
      appearanceOwnershipMismatchesPromise,
      reportFightMismatchesPromise,
      reportAppearanceMismatchesPromise,
    ]);

    const blockers: string[] = [];
    const warnings: string[] = [];
    const activeUpdateCutoff = Date.now() - 60 * 60 * 1000;
    const activeMigrationCutoff = Date.now() - 2 * 60 * 60 * 1000;
    const involvedGuilds = [sourceGuild, targetGuild];
    const activeUpdateLocks = involvedGuilds.filter(
      (guild) => guild.wclUpdateLockToken && guild.wclUpdateStartedAt && guild.wclUpdateStartedAt.getTime() >= activeUpdateCutoff,
    ).length;
    const activeMigrationLocks = involvedGuilds.filter(
      (guild) => guild.logSourceMigrationLockToken && guild.logSourceMigrationLockedAt && guild.logSourceMigrationLockedAt.getTime() >= activeMigrationCutoff,
    ).length;
    const integrityMismatches = fightOwnershipMismatches + appearanceOwnershipMismatches + reportFightMismatches + reportAppearanceMismatches;
    if (activeQueues > 0) blockers.push("Pause or finish all pending, running, and paused queue jobs for both guilds before migrating.");
    if (activeUpdateLocks > 0) blockers.push("A Warcraft Logs update is currently running for the source or target guild. Wait for it to finish.");
    if (activeMigrationLocks > 0) blockers.push("The source or target guild is already locked by another log-source migration.");
    if (customLists > 0) blockers.push(`The source guild has ${customLists} custom character tier list(s) that require manual reassignment.`);
    if (sharedLists > 0) blockers.push(`The source guild has ${sharedLists} shared character tier list(s) that require manual reassignment.`);
    if (ccgCards > 0 || ccgCommunityCharacters > 0) blockers.push(`The source guild is referenced by CCG data (${ccgCards} cards, ${ccgCommunityCharacters} community characters).`);
    if (integrityMismatches > 0) {
      blockers.push(`Found ${integrityMismatches} report/fight/appearance ownership mismatch(es). Repair those records before migrating.`);
    }
    if (events > 0) warnings.push(`${events} historical feed event(s) will be removed and will not be recreated.`);
    if (participations > 0) warnings.push(`${participations} materialized character participation row(s) will be rebuilt from report appearances.`);
    if (sourceGuild.streamers?.length) warnings.push(`${sourceGuild.streamers.length} streamer association(s) will be merged into the target guild.`);

    return {
      sourceGuild: { id: sourceGuild._id.toString(), name: sourceGuild.name, realm: sourceGuild.realm, region: sourceGuild.region },
      targetGuild: { id: targetGuild._id.toString(), name: targetGuild.name, realm: targetGuild.realm, region: targetGuild.region },
      counts: { reports, fights, appearances, participations, events, vodLinks, logSources: Math.max(1, logSources), integrityMismatches },
      blockers,
      warnings,
      canMigrate: blockers.length === 0,
    };
  }

  async migrateExistingGuild(targetGuildId: string, sourceGuildId: string): Promise<GuildLogSourceMigrationResult> {
    const preview = await this.getMigrationPreview(targetGuildId, sourceGuildId);
    if (!preview.canMigrate) {
      throw new GuildLogSourceError(409, "migration_blocked", "Guild migration is blocked until the listed issues are resolved", preview);
    }

    const [targetGuild, sourceGuild] = await Promise.all([Guild.findById(targetGuildId), Guild.findById(sourceGuildId)]);
    if (!targetGuild || !sourceGuild) throw new GuildLogSourceError(404, "guild_not_found", "Source or target guild not found");

    await this.ensurePrimarySource(targetGuild);
    const sourcePrimary = await this.ensurePrimarySource(sourceGuild);
    const mergedStreamers = this.mergeStreamers(targetGuild, sourceGuild);
    const session = await mongoose.startSession();
    const migrationLockToken = new mongoose.Types.ObjectId().toHexString();
    const lockStartedAt = new Date();
    const staleUpdateLock = new Date(lockStartedAt.getTime() - 60 * 60 * 1000);
    const staleMigrationLock = new Date(lockStartedAt.getTime() - 2 * 60 * 60 * 1000);
    const involvedGuildIds = [targetGuild._id, sourceGuild._id];
    let reportResult = { modifiedCount: 0 };
    let fightResult = { modifiedCount: 0 };
    let appearanceResult = { modifiedCount: 0 };
    let vodResult = { modifiedCount: 0 };
    let sourceResult = { modifiedCount: 0 };

    try {
      const lockResult = await Guild.updateMany(
        {
          _id: { $in: involvedGuildIds },
          $and: [
            {
              $or: [
                { wclUpdateLockToken: { $exists: false } },
                { wclUpdateStartedAt: { $lt: staleUpdateLock } },
              ],
            },
            {
              $or: [
                { logSourceMigrationLockToken: { $exists: false } },
                { logSourceMigrationLockedAt: { $lt: staleMigrationLock } },
              ],
            },
          ],
        },
        { $set: { logSourceMigrationLockToken: migrationLockToken, logSourceMigrationLockedAt: lockStartedAt } },
      );
      if (lockResult.modifiedCount !== 2) {
        throw new GuildLogSourceError(409, "migration_blocked", "The source or target guild started another update. Wait for it to finish and preview again.");
      }

      await session.withTransaction(async () => {
        const lockedGuildCount = await Guild.countDocuments({
          _id: { $in: involvedGuildIds },
          logSourceMigrationLockToken: migrationLockToken,
        }).session(session);
        if (lockedGuildCount !== 2) throw new GuildLogSourceError(409, "migration_blocked", "The migration lock was lost before the transaction started.");

        const activeQueue = await GuildProcessingQueue.exists({
          guildId: { $in: [targetGuild._id, sourceGuild._id] },
          status: { $in: ACTIVE_QUEUE_STATUSES },
        }).session(session);
        if (activeQueue) throw new GuildLogSourceError(409, "migration_blocked", "A queue job started after the preview. Finish or remove it and retry.");

        sourceResult = await GuildLogSource.updateMany(
          { guildId: sourceGuild._id },
          { $set: { guildId: targetGuild._id, isPrimary: false, syncPolicy: "historical", legacyGuildId: sourceGuild._id } },
          { session },
        );

        reportResult = await Report.updateMany(
          { guildId: sourceGuild._id },
          [
            {
              $set: {
                guildId: targetGuild._id,
                warcraftLogsSourceId: { $ifNull: ["$warcraftLogsSourceId", sourcePrimary._id] },
                sourceGuildSnapshot: { $ifNull: ["$sourceGuildSnapshot", getGuildLogSourceSnapshot(sourcePrimary)] },
              },
            },
          ],
          { session },
        );
        fightResult = await Fight.updateMany({ guildId: sourceGuild._id }, { $set: { guildId: targetGuild._id } }, { session });
        appearanceResult = await CharacterReportAppearance.updateMany(
          { reportGuildId: sourceGuild._id },
          { $set: { reportGuildId: targetGuild._id, reportGuildName: targetGuild.name, reportGuildRealm: targetGuild.realm } },
          { session },
        );
        vodResult = await FightVodLink.updateMany({ guildId: sourceGuild._id }, { $set: { guildId: targetGuild._id } }, { session });

        // The MongoDB driver does not support parallel operations within one
        // transaction, so these writes intentionally run in sequence.
        await Event.deleteMany({ guildId: sourceGuild._id }, { session });
        await WorldRankHistory.deleteMany({ guildId: sourceGuild._id }, { session });
        await CharacterRaidParticipation.deleteMany({ reportGuildId: sourceGuild._id }, { session });
        await GuildProfileHighlight.deleteMany({ guildId: { $in: [sourceGuild._id, targetGuild._id] } }, { session });
        await CharacterTierListEntry.deleteMany({ guildId: { $in: [sourceGuild._id, targetGuild._id] } }, { session });
        await GuildProcessingQueue.deleteMany({ guildId: sourceGuild._id }, { session });
        await TwitchEventDelivery.deleteMany({ guildId: sourceGuild._id }, { session });
        await TierList.updateMany(
          {},
          {
            $pull: {
              overall: { guildId: { $in: [sourceGuild._id, targetGuild._id] } },
              "raids.$[].guilds": { guildId: { $in: [sourceGuild._id, targetGuild._id] } },
            },
          } as mongoose.UpdateQuery<unknown>,
          { session },
        );
        await DiscordGuildIntegration.updateMany(
          { "eventConfig.guildIds": sourceGuild._id },
          [
            {
              $set: {
                "eventConfig.guildIds": {
                  $setUnion: [
                    {
                      $filter: {
                        input: "$eventConfig.guildIds",
                        as: "guildId",
                        cond: { $ne: ["$$guildId", sourceGuild._id] },
                      },
                    },
                    [targetGuild._id],
                  ],
                },
              },
            },
          ],
          { session },
        );

        await Guild.updateOne({ _id: targetGuild._id }, { $set: { streamers: mergedStreamers } }, { session });
        await Guild.deleteOne({ _id: sourceGuild._id }, { session });
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        throw new GuildLogSourceError(503, "transactions_unavailable", "Guild migration requires MongoDB transaction support. No guild ownership data was moved.");
      }
      throw error;
    } finally {
      try {
        await session.endSession();
      } finally {
        await Guild.updateMany(
          { _id: { $in: involvedGuildIds }, logSourceMigrationLockToken: migrationLockToken },
          { $unset: { logSourceMigrationLockToken: 1, logSourceMigrationLockedAt: 1 } },
        );
      }
    }

    const warnings: string[] = [];
    try {
      const mostRecentReport = await Report.findOne({ guildId: targetGuild._id }).sort({ endTime: -1 }).select("endTime").lean();
      await Guild.updateOne(
        { _id: targetGuild._id },
        {
          $set: {
            ...(mostRecentReport?.endTime ? { lastLogEndTime: new Date(mostRecentReport.endTime) } : {}),
          },
        },
      );
      // Sweep any queue item that raced the preflight lock. A worker that had
      // already claimed it will safely fail because the source guild is gone.
      await GuildProcessingQueue.deleteMany({ guildId: sourceGuild._id });
    } catch {
      warnings.push("The migration committed, but the final guild timestamp or queue cleanup should be checked manually.");
    }
    try {
      await Promise.all([cacheService.invalidateAllGuildCaches(), cacheService.invalidateGuildSpecificCaches(targetGuild.realm, targetGuild.name)]);
    } catch {
      warnings.push("The migration committed, but guild caches could not be invalidated and may remain stale until their normal refresh.");
    }

    return {
      sourceGuildId,
      targetGuildId,
      sourceId: sourcePrimary._id.toString(),
      moved: {
        reports: reportResult.modifiedCount,
        fights: fightResult.modifiedCount,
        appearances: appearanceResult.modifiedCount,
        vodLinks: vodResult.modifiedCount,
        logSources: sourceResult.modifiedCount,
      },
      warnings,
    };
  }

  private mergeStreamers(targetGuild: IGuild, sourceGuild: IGuild): unknown[] {
    const byChannel = new Map<string, unknown>();
    for (const streamer of targetGuild.streamers || []) {
      const streamerDocument = streamer as typeof streamer & { toObject?: () => unknown };
      byChannel.set(streamer.channelName.toLowerCase(), streamerDocument.toObject ? streamerDocument.toObject() : streamer);
    }
    for (const streamer of sourceGuild.streamers || []) {
      const key = streamer.channelName.toLowerCase();
      const streamerDocument = streamer as typeof streamer & { toObject?: () => unknown };
      if (!byChannel.has(key)) byChannel.set(key, streamerDocument.toObject ? streamerDocument.toObject() : streamer);
    }
    return Array.from(byChannel.values());
  }

  async setSourceFetchSucceeded(source: IGuildLogSource, params: { warcraftlogsId?: number; lastLogEndTime?: Date }): Promise<void> {
    await GuildLogSource.updateOne(
      { _id: source._id },
      {
        $set: {
          ...(params.warcraftlogsId ? { warcraftlogsId: params.warcraftlogsId } : {}),
          ...(params.lastLogEndTime ? { lastLogEndTime: params.lastLogEndTime } : {}),
          lastFetched: new Date(),
          wclStatus: "active",
          wclStatusUpdatedAt: new Date(),
          wclNotFoundCount: 0,
          initialFetchCompleted: true,
          initialFetchCompletedAt: source.initialFetchCompletedAt || new Date(),
        },
      },
    );
  }

  async setSourceFetchFailed(sourceId: mongoose.Types.ObjectId, notFound: boolean): Promise<void> {
    await GuildLogSource.updateOne(
      { _id: sourceId },
      {
        $set: {
          ...(notFound ? { wclStatus: "not_found" } : {}),
          wclStatusUpdatedAt: new Date(),
          ...(notFound ? { initialFetchCompleted: true, initialFetchCompletedAt: new Date() } : {}),
        },
        ...(notFound ? { $inc: { wclNotFoundCount: 1 } } : {}),
      },
    );
  }
}

export default new GuildLogSourceService();
