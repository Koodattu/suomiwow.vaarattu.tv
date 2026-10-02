import mongoose, { PipelineStage } from "mongoose";
import { activeAvoidableMechanics, AvoidableMechanic, findAvoidableMechanic } from "../config/avoidable-mechanics";
import { ROLE_BY_CLASS_AND_SPEC } from "../config/specs";
import AvoidableDamageFight, { MechanicPlayer } from "../models/AvoidableDamageFight";
import Character from "../models/Character";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import Fight from "../models/Fight";
import Guild, { IGuild } from "../models/Guild";
import GuildProcessingQueue, { IGuildProcessingQueue } from "../models/GuildProcessingQueue";
import Raid, { RegionDates } from "../models/Raid";
import Report from "../models/Report";
import ReportOverride from "../models/ReportOverride";
import ProcessorState from "../models/ProcessorState";
import { isSameMechanicPull, mechanicClassId, mechanicIdentity, MechanicCollectionPaused } from "../utils/avoidable-damage";
import logger from "../utils/logger";
import { classifyError, ErrorType } from "../utils/error-classifier";
import { normalizeRealmSlug } from "../utils/realm";
import { resolveSpecByBlizzardSpecId, slugifySpecName, tryResolveRole } from "../utils/spec";
import { MechanicLeaderboardFilters, MechanicSnapshot, MechanicSnapshotRow, selectMechanicLeaderboard } from "../utils/mechanic-leaderboard";
import iconCacheService from "./icon-cache.service";
import cacheService from "./cache.service";
import rateLimitService from "./rate-limit.service";
import { reportAllowedForGuild } from "./report-override-policy.service";
import wclService from "./warcraftlogs.service";

const RETRY_MS = 24 * 60 * 60 * 1000;
const REPORTS_PER_TURN = 10;
const FIGHTS_PER_REQUEST = 50;
const LEADERBOARD_CACHE_MS = 5 * 60 * 1000;
const currentVersions = (mechanics = activeAvoidableMechanics()) => mechanics.map((entry) => ({ mechanicKey: entry.key, version: entry.version }));
const queueMechanics = (queue: IGuildProcessingQueue) => activeAvoidableMechanics().filter((entry) =>
  queue.targetMechanicKeys === undefined || queue.targetMechanicKeys.includes(entry.key));
const dueFilter = () => ({ $or: [{ status: "pending" as const }, { status: "failed" as const, retryAt: { $lte: new Date() } }] });

export function isWithinMechanicTier(timestamp: number, region: string, raid: { starts?: RegionDates; ends?: RegionDates }): boolean {
  const key = region.toLowerCase() as keyof RegionDates;
  const start = raid.starts?.[key]?.getTime();
  const end = raid.ends?.[key]?.getTime();
  return (start === undefined || timestamp >= start) && (end === undefined || timestamp <= end);
}

export type { MechanicLeaderboardFilters } from "../utils/mechanic-leaderboard";

export interface MechanicBackfillOptions {
  guildId?: string;
  mechanicKeys?: string[];
  retryUnavailable?: boolean;
}

class AvoidableDamageService {
  private snapshotBuilds = new Map<string, Promise<MechanicSnapshot>>();

  async queueBackfill({ guildId, mechanicKeys, retryUnavailable = false }: MechanicBackfillOptions = {}) {
    if (mechanicKeys?.some((key) => !findAvoidableMechanic(key))) throw new Error("Unknown mechanic selection");
    const mechanics = activeAvoidableMechanics().filter((entry) => mechanicKeys === undefined || mechanicKeys.includes(entry.key));
    if (!mechanics.length) return { queued: 0, retried: 0, mechanicKeys: [] as string[] };
    const ids = await Fight.distinct("guildId", {
      ...(guildId ? { guildId: new mongoose.Types.ObjectId(guildId) } : {}), difficulty: 5,
      $or: mechanics.map((entry) => ({ zoneId: entry.zoneId, encounterID: entry.encounterId })),
    });
    const guilds = await Guild.find({ _id: { $in: ids }, logSourceMigrationLockToken: { $exists: false } });
    let queued = 0;
    let retried = 0;
    for (const guild of guilds) {
      const selected = mechanics.filter((entry) => !guild.excludedRaidIds?.includes(entry.zoneId));
      if (!selected.length) continue;
      if (retryUnavailable) {
        const result = await AvoidableDamageFight.updateMany({ guildId: guild._id, $or: currentVersions(selected), status: { $in: ["archived", "unavailable", "failed"] } },
          { $set: { status: "pending" }, $unset: { retryAt: 1, error: 1 } });
        retried += result.modifiedCount;
      }
      await this.enqueueGuild(guild, selected.map((entry) => entry.key));
      queued++;
    }
    return { queued, retried, mechanicKeys: mechanics.map((entry) => entry.key) };
  }

  async enqueueGuild(guild: IGuild, mechanicKeys: string[], priority = 30): Promise<IGuildProcessingQueue> {
    const identity = { guildId: guild._id, jobType: "backfill_avoidable_damage" as const, guildLogSourceId: { $exists: false } };
    // Compare-and-swap protects requests made concurrently by the API and scheduler.
    // A running job keeps its snapshot; the next turn seeds any newly selected keys.
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await GuildProcessingQueue.findOne(identity);
      const active = existing && ["pending", "in_progress", "paused"].includes(existing.status);
      const keys = [...new Set([...(active ? (existing.targetMechanicKeys ?? activeAvoidableMechanics().map((entry) => entry.key)) : []), ...mechanicKeys])];
      const next = {
        guildName: guild.name, guildRealm: guild.realm, guildRegion: guild.region,
        targetMechanicKeys: keys, mechanicRequestRevision: (existing?.mechanicRequestRevision ?? 0) + 1,
        priority: active ? Math.min(existing.priority, priority) : priority,
        ...(!active ? { status: "pending" as const, mechanicSeedRevision: 0, errorCount: 0, retryCount: 0,
          progress: { totalReportsEstimate: 0, reportsFetched: 0, fightsSaved: 0, currentPage: 0, percentComplete: 0 }, lastActivityAt: new Date() } : {}),
      };
      if (!existing) {
        try { return await GuildProcessingQueue.create({ guildId: guild._id, jobType: identity.jobType, ...next }); }
        catch (error) {
          if ((error as { code?: number }).code === 11000) continue;
          throw error;
        }
      }
      const updated = await GuildProcessingQueue.findOneAndUpdate({ _id: existing._id, status: existing.status,
        mechanicRequestRevision: existing.mechanicRequestRevision ?? { $exists: false } }, {
        $set: next,
        ...(!active ? { $unset: { completedAt: 1, startedAt: 1, pausedAt: 1, lastError: 1, errorType: 1, failureReason: 1, isPermanentError: 1 } } : {}),
      }, { returnDocument: "after" });
      if (updated) return updated;
    }
    throw new Error("Mechanic queue changed concurrently; retry the request");
  }

  async releaseGuild(queue: IGuildProcessingQueue, complete: boolean): Promise<void> {
    if (complete) {
      const result = await GuildProcessingQueue.updateOne({ _id: queue._id, status: "in_progress",
        mechanicRequestRevision: queue.mechanicRequestRevision ?? { $exists: false } },
      { $set: { status: "completed", completedAt: new Date(), lastActivityAt: new Date(), "progress.percentComplete": 100 },
        $unset: { lastError: 1, lastErrorAt: 1, errorType: 1, failureReason: 1 } });
      if (result.modifiedCount) return;
    }
    // Never undo an administrator's pause or resurrect a deleted queue item.
    await GuildProcessingQueue.updateOne({ _id: queue._id, status: "in_progress" },
      { $set: { status: "pending", lastActivityAt: new Date() } });
  }

  private async seedGuild(queue: IGuildProcessingQueue): Promise<void> {
    const guild = await Guild.findById(queue.guildId).lean();
    if (!guild) throw new Error("Guild no longer exists");
    const mechanics = queueMechanics(queue).filter((entry) => !guild.excludedRaidIds?.includes(entry.zoneId));
    if (!mechanics.length) return;
    const [fights, raids, reports, existing, policies] = await Promise.all([
      Fight.find({ guildId: queue.guildId, difficulty: 5, $or: mechanics.map((entry) => ({ zoneId: entry.zoneId, encounterID: entry.encounterId })) })
        .select("_id reportCode fightId zoneId encounterID timestamp reportStartTime fightStartTime duration isKill").sort({ timestamp: 1, reportCode: 1, fightId: 1 }).lean(),
      Raid.find({ id: { $in: mechanics.map((entry) => entry.zoneId) } }).select("id starts ends").lean(),
      Report.find({ guildId: queue.guildId, isOngoing: false }).select("code sourceGuildSnapshot.region").lean(),
      AvoidableDamageFight.find({ guildId: queue.guildId, $or: currentVersions(mechanics) }).select("sourceFightId mechanicKey status version").lean(),
      ReportOverride.find({ $or: [{ "assignment.guildId": { $exists: true } }, { "exclusions.guildId": queue.guildId }] }).select("code assignment exclusions").lean(),
    ]);
    const reportByCode = new Map(reports.map((report) => [report.code, report]));
    const raidById = new Map(raids.map((raid) => [raid.id, raid]));
    const policyByCode = new Map(policies.map((policy) => [policy.code, policy]));
    const statusByKey = new Map(existing.map((row) => [`${row.sourceFightId}:${row.mechanicKey}`, row.status]));
    const operations: Parameters<typeof AvoidableDamageFight.bulkWrite>[0] = [];
    for (const mechanic of mechanics) {
      const candidates: typeof fights = fights.filter((fight) => {
        const report = reportByCode.get(fight.reportCode);
        const raid = raidById.get(fight.zoneId);
        return report && raid && fight.zoneId === mechanic.zoneId && fight.encounterID === mechanic.encounterId &&
          reportAllowedForGuild(policyByCode.get(fight.reportCode) ?? null, queue.guildId) &&
          isWithinMechanicTier(fight.reportStartTime + fight.fightStartTime, report.sourceGuildSnapshot?.region ?? guild.region, raid);
      });
      // Same physical pull uploaded more than once: prefer an already fetched copy.
      // Equal duration alone is never a duplicate. Only compare adjacent clock times.
      const groups: typeof candidates[] = [];
      for (const fight of candidates) {
        const group = groups[groups.length - 1];
        if (group && isSameMechanicPull(group[0], fight)) group.push(fight);
        else groups.push([fight]);
      }
      for (const group of groups) {
        const canonical = group.find((fight) => statusByKey.get(`${fight._id}:${mechanic.key}`) === "fetched") ?? group[0];
        for (const fight of group) {
          const duplicate = String(fight._id) !== String(canonical._id);
          const filter = { sourceFightId: fight._id, mechanicKey: mechanic.key, version: mechanic.version };
          const base = { ...filter, guildId: queue.guildId, reportCode: fight.reportCode, fightId: fight.fightId,
            zoneId: mechanic.zoneId, encounterId: mechanic.encounterId, timestamp: new Date(fight.reportStartTime + fight.fightStartTime),
            duration: fight.duration, isKill: fight.isKill };
          const previousStatus = statusByKey.get(`${fight._id}:${mechanic.key}`);
          if (duplicate) {
            operations.push({ updateOne: { filter, update: { $set: { ...base, status: "duplicate", duplicateOf: canonical._id, players: [] } }, upsert: true } });
          } else if (previousStatus === "duplicate") {
            operations.push({ updateOne: { filter, update: { $set: { ...base, status: "pending" }, $unset: { duplicateOf: 1 } } } });
          } else {
            operations.push({ updateOne: { filter, update: { $set: base, $setOnInsert: { status: "pending", players: [] } }, upsert: true } });
          }
        }
      }
    }
    for (let i = 0; i < operations.length; i += 1000) await AvoidableDamageFight.bulkWrite(operations.slice(i, i + 1000), { ordered: false });
  }

  async collectGuild(queue: IGuildProcessingQueue, beforePage: (endpoint: "client" | "user") => Promise<void>): Promise<boolean> {
    const mechanics = queueMechanics(queue);
    const collectedMechanics = new Set<string>();
    if (!mechanics.length) return true;
    const versions = currentVersions(mechanics);
    if (queue.progress.currentPage === 0 || (queue.mechanicSeedRevision ?? 0) !== (queue.mechanicRequestRevision ?? 0)) {
      await beforePage("client");
      await this.seedGuild(queue);
      const count = await AvoidableDamageFight.distinct("reportCode", { guildId: queue.guildId, $and: [{ $or: versions }, dueFilter()] });
      queue.progress.totalReportsEstimate = count.length;
      queue.progress.percentComplete = 0;
      await queue.updateProgress(0, 0, 1, count.length);
      await GuildProcessingQueue.updateOne({ _id: queue._id }, { $set: { mechanicSeedRevision: queue.mechanicRequestRevision ?? 0,
        "progress.totalReportsEstimate": count.length, "progress.percentComplete": 0 } });
      queue.mechanicSeedRevision = queue.mechanicRequestRevision;
    }
    const reportCodes = await AvoidableDamageFight.aggregate<{ _id: string }>([
      { $match: { guildId: queue.guildId, $and: [{ $or: versions }, dueFilter()] } },
      { $group: { _id: "$reportCode", newest: { $max: "$timestamp" } } }, { $sort: { newest: -1, _id: 1 } }, { $limit: REPORTS_PER_TURN },
    ]);
    for (const { _id: reportCode } of reportCodes) {
      await beforePage("client");
      const report = await Report.findOne({ code: reportCode, guildId: queue.guildId, isOngoing: false }).lean();
      const guild = await Guild.findById(queue.guildId).select("region excludedRaidIds").lean();
      const policy = await ReportOverride.findOne({ code: reportCode }).lean();
      if (!report || !guild || !reportAllowedForGuild(policy, queue.guildId)) {
        await AvoidableDamageFight.updateMany({ guildId: queue.guildId, reportCode, $or: versions, status: { $in: ["pending", "failed"] } }, { $set: { status: "unavailable", error: "Source report no longer eligible" } });
        continue;
      }
      const appearances = await CharacterReportAppearance.find({ reportCode }).select("characterName characterRealm characterRegion classID wclCanonicalCharacterId hidden").lean();
      const identities = new Map<string, typeof appearances>();
      for (const appearance of appearances) {
        const key = mechanicIdentity(appearance.characterName, appearance.characterRealm, appearance.characterRegion, appearance.classID);
        identities.set(key, [...(identities.get(key) ?? []), appearance]);
      }
      const rows = await AvoidableDamageFight.find({ guildId: queue.guildId, reportCode, $and: [{ $or: versions }, dueFilter()] }).lean();
      const [sources, raids] = await Promise.all([
        Fight.find({ _id: { $in: rows.map((row) => row.sourceFightId) }, guildId: queue.guildId, reportCode, difficulty: 5 })
          .select("_id fightId zoneId encounterID reportStartTime fightStartTime").lean(),
        Raid.find({ id: { $in: mechanics.map((entry) => entry.zoneId) } }).select("id starts ends").lean(),
      ]);
      const sourceById = new Map(sources.map((source) => [String(source._id), source]));
      const pendingRows = rows.filter((row) => {
        const source = sourceById.get(String(row.sourceFightId));
        const raid = raids.find((entry) => entry.id === row.zoneId);
        return source && raid && source.fightId === row.fightId && source.zoneId === row.zoneId && source.encounterID === row.encounterId &&
          isWithinMechanicTier(source.reportStartTime + source.fightStartTime, report.sourceGuildSnapshot?.region ?? guild.region, raid);
      });
      const validIds = new Set(pendingRows.map((row) => String(row._id)));
      const invalid = rows.filter((row) => !validIds.has(String(row._id)));
      if (invalid.length) await AvoidableDamageFight.updateMany({ _id: { $in: invalid.map((row) => row._id) } },
        { $set: { status: "unavailable", error: "Stored Mythic fight no longer eligible" } });
      mechanicsForReport: for (const mechanic of mechanics) {
        const pending = pendingRows.filter((row) => row.mechanicKey === mechanic.key && row.version === mechanic.version);
        if (!pending.length) continue;
        if (guild.excludedRaidIds?.includes(mechanic.zoneId)) {
          await AvoidableDamageFight.updateMany({ _id: { $in: pending.map((row) => row._id) } }, { $set: { status: "unavailable", error: "Raid excluded for guild" } });
          continue;
        }
        // Reuse the existing icon cache; no icon or spell API requests on page views.
        await iconCacheService.downloadAndCacheIcon(`https://assets.rpglogs.com/img/warcraft/abilities/${mechanic.icon}`).catch(() => undefined);
        for (let i = 0; i < pending.length; i += FIGHTS_PER_REQUEST) {
          const batch = pending.slice(i, i + FIGHTS_PER_REQUEST);
          try {
            const data = await wclService.getAvoidableDamage(reportCode, mechanic.encounterId, batch.map((row) => row.fightId), mechanic.damageSpellIds, beforePage);
            const actors = new Map(data.actors.map((actor) => [actor.id, actor]));
            const updates: Parameters<typeof AvoidableDamageFight.bulkWrite>[0] = batch.map((row) => {
              const players: MechanicPlayer[] = [];
              for (const [actorId, totals] of data.damage.get(row.fightId) ?? []) {
                const actor = actors.get(actorId)!;
                const classId = mechanicClassId(actor);
                const realm = normalizeRealmSlug(actor.server ?? "");
                const region = (report.sourceGuildSnapshot?.region ?? guild.region).toLowerCase();
                const sourceKey = mechanicIdentity(actor.name, realm, region, classId);
                const matches = identities.get(sourceKey) ?? [];
                if (matches.some((entry) => entry.hidden)) continue;
                const ids = [...new Set(matches.map((entry) => entry.wclCanonicalCharacterId).filter((id): id is number => typeof id === "number" && id > 0))];
                const canonicalCharacterId = ids.length === 1 ? ids[0] : undefined;
                players.push({ ...totals, actorId, name: actor.name, realm, region, classId, canonicalCharacterId,
                  identity: canonicalCharacterId ? `wcl:${canonicalCharacterId}:${classId}` : realm ? sourceKey : `${reportCode}:${actorId}` });
              }
              return { updateOne: { filter: { _id: row._id }, update: {
                $set: { status: "fetched", players, fetchedAt: new Date() }, $unset: { error: 1, retryAt: 1 },
              } } };
            });
            // Nothing is committed until EVERY event page in this batch has succeeded.
            await AvoidableDamageFight.bulkWrite(updates, { ordered: false });
            collectedMechanics.add(mechanic.key);
            await queue.updateProgress(queue.progress.reportsFetched, queue.progress.fightsSaved + batch.length, queue.progress.currentPage);
          } catch (error) {
            if (error instanceof MechanicCollectionPaused) throw error;
            const message = error instanceof Error ? error.message : String(error);
            if (classifyError(message).type === ErrorType.RATE_LIMITED) throw new MechanicCollectionPaused(message);
            const status = /archived/i.test(message) ? "archived" : /unavailable|not found|permission|private/i.test(message) ? "unavailable" : "failed";
            const affected = status === "failed" ? batch : pendingRows;
            await AvoidableDamageFight.updateMany({ _id: { $in: affected.map((row) => row._id) }, status: { $ne: "fetched" } },
              { $set: { status, error: message.slice(0, 500), ...(status === "failed" ? { retryAt: new Date(Date.now() + RETRY_MS) } : {}) } });
            logger.warn(`[AvoidableDamage] ${mechanic.key} report ${reportCode}: ${status}`);
            if (status !== "failed") break mechanicsForReport;
          }
        }
      }
      await queue.updateProgress(queue.progress.reportsFetched + 1, queue.progress.fightsSaved, queue.progress.currentPage + 1);
    }
    // Refresh in place: visitors keep the previous snapshot while new results are prepared.
    if (collectedMechanics.size) void this.warmLeaderboardCaches([...collectedMechanics]);
    return !(await AvoidableDamageFight.exists({ guildId: queue.guildId, $and: [{ $or: versions }, dueFilter()] }));
  }

  async getOptions() {
    const mechanics = activeAvoidableMechanics();
    const [raids, guilds] = await Promise.all([
      Raid.find({ id: { $in: mechanics.map((entry) => entry.zoneId) } }).select("id name expansion iconUrl bosses.id bosses.iconUrl -_id").lean(),
      Guild.find().select("name realm region excludedRaidIds progress.raidId progress.difficulty progress.bosses.bossId progress.bosses.pullCount progress.bosses.kills").sort({ name: 1, realm: 1 }).lean(),
    ]);
    const raidsById = new Map(raids.map((raid) => [raid.id, raid]));
    return {
      mechanics: mechanics.map((mechanic) => ({ ...mechanic, bossIcon: raidsById.get(mechanic.zoneId)?.bosses?.find((boss) => boss.id === mechanic.encounterId)?.iconUrl })),
      raids: raids.map(({ bosses: _bosses, ...raid }) => raid),
      guilds: guilds.map((guild) => ({
        id: String(guild._id), name: guild.name, realm: guild.realm, region: guild.region,
        // Reuse the stored boss participation summaries; no fight/event scan is needed.
        mechanicKeys: mechanics.filter((mechanic) => !guild.excludedRaidIds?.includes(mechanic.zoneId) &&
          guild.progress?.some((raid) => raid.raidId === mechanic.zoneId && raid.difficulty === "mythic" &&
            raid.bosses.some((boss) => boss.bossId === mechanic.encounterId && (boss.pullCount > 0 || boss.kills > 0))))
          .map((mechanic) => mechanic.key),
      })),
    };
  }

  async getCollectionStatus(guildId?: string) {
    const guildFilter = guildId ? { guildId: new mongoose.Types.ObjectId(guildId) } : {};
    const versions = currentVersions();
    const jobFilter = { ...guildFilter, jobType: "backfill_avoidable_damage" as const };
    const [coverage, jobs, counts, buckets, processor] = await Promise.all([
      versions.length ? AvoidableDamageFight.aggregate<{ _id: { mechanic: string; status: string }; fights: number }>([
        { $match: { ...guildFilter, $or: versions } },
        { $group: { _id: { mechanic: "$mechanicKey", status: "$status" }, fights: { $sum: 1 } } },
      ]) : [],
      GuildProcessingQueue.find(jobFilter).sort({ lastActivityAt: -1 }).limit(50)
        .select("guildId guildName status targetMechanicKeys progress lastError lastActivityAt").lean(),
      GuildProcessingQueue.aggregate<{ _id: string; count: number }>([{ $match: jobFilter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      rateLimitService.getAllSharedStatuses(),
      ProcessorState.findOne({ key: "guild-processing" }).select("isPaused").lean(),
    ]);
    return {
      mechanics: activeAvoidableMechanics().map((mechanic) => ({ key: mechanic.key,
        coverage: Object.fromEntries(["pending", "fetched", "failed", "archived", "unavailable", "duplicate"].map((status) =>
          [status, coverage.find((row) => row._id.mechanic === mechanic.key && row._id.status === status)?.fights ?? 0])) })),
      jobs: jobs.map((job) => ({ id: String(job._id), guildId: String(job.guildId), guildName: job.guildName, status: job.status,
        mechanicKeys: job.targetMechanicKeys ?? activeAvoidableMechanics().map((entry) => entry.key),
        progress: job.progress, lastError: job.lastError, lastActivityAt: job.lastActivityAt })),
      counts: Object.fromEntries(["pending", "in_progress", "paused", "completed", "failed"].map((status) => [status, counts.find((row) => row._id === status)?.count ?? 0])),
      buckets, processorPaused: processor?.isPaused ?? false,
    };
  }

  private async visibleFightStages(mechanic: AvoidableMechanic): Promise<PipelineStage[]> {
    const hidden = await Character.find({ wclProfileHidden: true }).select("wclCanonicalCharacterId").lean();
    return [
      { $match: { mechanicKey: mechanic.key, version: mechanic.version } },
      // Respect report deletion/reassignment and guild exclusions without waiting for another backfill.
      { $lookup: { from: Fight.collection.name, localField: "sourceFightId", foreignField: "_id",
        pipeline: [{ $project: { guildId: 1, combatants: 1 } }], as: "source" } },
      { $match: { $expr: { $eq: [{ $arrayElemAt: ["$source.guildId", 0] }, "$guildId"] } } },
      { $lookup: { from: Guild.collection.name, localField: "guildId", foreignField: "_id",
        pipeline: [{ $project: { name: 1, excludedRaidIds: 1 } }], as: "guild" } },
      { $unwind: "$guild" }, { $match: { "guild.excludedRaidIds": { $ne: mechanic.zoneId } } },
      { $set: { players: { $filter: { input: "$players", as: "player", cond: { $not: [{ $in: ["$$player.canonicalCharacterId", hidden.map((entry) => entry.wclCanonicalCharacterId)] }] } } } } },
    ];
  }

  private async buildLeaderboardSnapshot(mechanic: AvoidableMechanic): Promise<MechanicSnapshot> {
    const stages = await this.visibleFightStages(mechanic);
    // Rosters retain WCL display realms; mechanic players store realm slugs.
    const realmIdentity = (field: string) => [" ", "\t", "\r", "\n", "-", "'", "’", "`"].reduce<unknown>(
      (input, find) => ({ $replaceAll: { input, find, replacement: "" } }), { $toLower: { $ifNull: [field, ""] } });
    type AggregateRow = Omit<MechanicSnapshotRow, "key" | "guildId" | "isKill" | "role" | "specName" | "timestamp"> & {
      _id: { identity: string; guildId: mongoose.Types.ObjectId; isKill: boolean; role?: MechanicSnapshotRow["role"]; specID?: number; specName?: string };
      timestamp: Date;
    };
    const [coverageRows, leaderboard] = await Promise.all([
      AvoidableDamageFight.aggregate([...stages, { $group: { _id: { guildId: "$guildId", isKill: "$isKill", status: "$status" }, fights: { $sum: 1 }, updatedAt: { $max: "$fetchedAt" } } }]),
      AvoidableDamageFight.aggregate<AggregateRow>([...stages,
        { $match: { status: "fetched" } }, { $unwind: "$players" }, { $sort: { timestamp: -1, reportCode: 1 } },
        // Join the already stored roster for this pull. Never guess a hybrid class's role.
        { $set: { combatant: { $arrayElemAt: [{ $filter: {
          input: { $ifNull: [{ $arrayElemAt: ["$source.combatants", 0] }, []] }, as: "combatant",
          cond: { $and: [
            { $eq: [{ $toLower: "$$combatant.name" }, { $toLower: "$players.name" }] },
            { $eq: [realmIdentity("$$combatant.server"), realmIdentity("$players.realm")] },
          ] },
        } }, 0] } } },
        { $group: { _id: { identity: "$players.identity", guildId: "$guildId", isKill: "$isKill", role: "$combatant.role", specID: "$combatant.specID", specName: "$combatant.specName" },
          name: { $first: "$players.name" }, realm: { $first: "$players.realm" }, region: { $first: "$players.region" },
          classId: { $first: "$players.classId" }, guildName: { $first: "$guild.name" },
          damage: { $sum: "$players.damage" }, hits: { $sum: "$players.hits" }, directHits: { $sum: "$players.directHits" }, ticks: { $sum: "$players.ticks" }, pulls: { $sum: 1 },
          reportCode: { $first: "$reportCode" }, fightId: { $first: "$fightId" }, actorId: { $first: "$players.actorId" }, timestamp: { $first: "$timestamp" } } },
      ]).allowDiskUse(true),
    ]);
    return {
      mechanic,
      rows: leaderboard.map(({ _id, timestamp, ...row }) => {
        const specName = _id.specName || (_id.specID ? resolveSpecByBlizzardSpecId(_id.specID)?.specName : null);
        const specRole = tryResolveRole(row.classId, specName);
        const classRoles = [...new Set(Object.values(ROLE_BY_CLASS_AND_SPEC[row.classId] ?? {}))];
        const role = specRole ?? _id.role ?? (classRoles.length === 1 ? classRoles[0] : null);
        return { ...row, key: _id.identity, guildId: String(_id.guildId), isKill: _id.isKill, role, specName: specRole && specName ? slugifySpecName(specName) : null, timestamp: timestamp.getTime() };
      }),
      coverage: coverageRows.map(({ _id, fights, updatedAt }) => ({ ..._id, guildId: String(_id.guildId), fights, updatedAt: updatedAt?.toISOString() ?? null })),
    };
  }

  private snapshotKey(mechanic: AvoidableMechanic): string {
    return `avoidable-damage:snapshot:v3:${mechanic.key}:${mechanic.version}`;
  }

  private refreshSnapshot(mechanic: AvoidableMechanic): Promise<MechanicSnapshot> {
    const key = this.snapshotKey(mechanic);
    const existing = this.snapshotBuilds.get(key);
    if (existing) return existing;
    const build = (async () => {
      const snapshot = await this.buildLeaderboardSnapshot(mechanic);
      await cacheService.set(key, snapshot, LEADERBOARD_CACHE_MS);
      return snapshot;
    })().finally(() => this.snapshotBuilds.delete(key));
    this.snapshotBuilds.set(key, build);
    return build;
  }

  async warmLeaderboardCaches(mechanicKeys = activeAvoidableMechanics().map((entry) => entry.key)): Promise<void> {
    // Sequential warming avoids flooding MongoDB during startup or a collection run.
    for (const key of mechanicKeys) {
      const mechanic = findAvoidableMechanic(key);
      if (!mechanic) continue;
      try { await this.refreshSnapshot(mechanic); }
      catch (error) { logger.error(`[AvoidableDamage] Cache refresh failed for ${key}`, error); }
    }
  }

  async getLeaderboard(filters: MechanicLeaderboardFilters) {
    const mechanic = findAvoidableMechanic(filters.mechanic);
    if (!mechanic) throw new Error("Unknown mechanic");
    const cached = await cacheService.getWithMetadata<MechanicSnapshot>(this.snapshotKey(mechanic));
    if (cached && new Date(cached.expiresAt).getTime() <= Date.now()) {
      // Serve stale data immediately; concurrent visitors share the same refresh.
      void this.warmLeaderboardCaches([mechanic.key]);
    }
    const snapshot = cached?.data ?? await this.refreshSnapshot(mechanic);
    return selectMechanicLeaderboard(snapshot, filters);
  }
}

export default new AvoidableDamageService();
