import { randomUUID } from "crypto";
import { TRACKED_RAIDS } from "../config/guilds";
import CharacterIdentityResolution from "../models/CharacterIdentityResolution";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import CharacterRankingBackfill from "../models/CharacterRankingBackfill";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import FullHistoryRefresh, { FullHistoryRefreshStage, IFullHistoryRefresh } from "../models/FullHistoryRefresh";
import Fight from "../models/Fight";
import GuildProcessingQueue from "../models/GuildProcessingQueue";
import logger from "../utils/logger";
import cacheService from "./cache.service";
import characterIdentityResolutionService, { CharacterIdentityResolutionStatusResponse } from "./character-identity-resolution.service";
import characterMediaService from "./character-media.service";
import characterMechanicsService from "./character-mechanics.service";
import characterRankingBackfillService from "./character-ranking-backfill.service";
import characterService from "./character.service";
import characterTierListService from "./character-tierlist.service";
import guildService from "./guild.service";
import mythicPlusService from "./mythic-plus.service";
import taskTracker from "./task-tracker.service";

const PIPELINE_KEY = "all-raids";
const POLL_INTERVAL_MS = 30_000;

type QueueCounts = {
  pending: number;
  inProgress: number;
  paused: number;
  completed: number;
  failed: number;
  active: number;
  total: number;
};

export type FullHistoryRefreshStatusResponse = {
  runId: string | null;
  status: "idle" | "running" | "completed" | "failed";
  stage: FullHistoryRefreshStage | null;
  startedAt: Date | null;
  stageStartedAt: Date | null;
  lastActivityAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  progress: Record<string, unknown>;
  fightDetailsQueue: QueueCounts;
  identityQueue: CharacterIdentityResolutionStatusResponse["queue"];
  rankingQueue: {
    pending: number;
    inProgress: number;
    completed: number;
    skipped: number;
    failed: number;
    active: number;
    total: number;
  };
};

class FullHistoryRefreshService {
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
    logger.info("[FullHistoryRefresh] Persistent pipeline monitor started");
  }

  async trigger(): Promise<{ started: boolean; status: FullHistoryRefreshStatusResponse }> {
    const existing = await FullHistoryRefresh.findOne({ key: PIPELINE_KEY }).lean<IFullHistoryRefresh>();
    if (existing?.status === "running") {
      return { started: false, status: await this.getStatus() };
    }

    const now = new Date();
    await FullHistoryRefresh.findOneAndUpdate(
      { key: PIPELINE_KEY },
      {
        $set: {
          runId: randomUUID(),
          status: "running",
          stage: "queue_fight_details",
          startedAt: now,
          stageStartedAt: now,
          lastActivityAt: now,
          completedAt: null,
          lastError: null,
          progress: {},
        },
        $setOnInsert: { key: PIPELINE_KEY },
      },
      { upsert: true, returnDocument: "after" },
    );

    logger.info("[FullHistoryRefresh] Full-history refresh requested for all tracked raids");
    return { started: true, status: await this.getStatus() };
  }

  async triggerIncrementalCharacterData(): Promise<{ started: boolean; status: FullHistoryRefreshStatusResponse }> {
    const existing = await FullHistoryRefresh.findOne({ key: PIPELINE_KEY }).lean<IFullHistoryRefresh>();
    if (existing?.status === "running") {
      return { started: false, status: await this.getStatus() };
    }

    const [targets, rankingStatus] = await Promise.all([
      this.findIncrementalTargets(),
      characterRankingBackfillService.getStatus(),
    ]);
    const rankingMaintenanceActive = rankingStatus.processor.isRunning || rankingStatus.leaderboardRebuild.isRunning;
    if (rankingMaintenanceActive) characterRankingBackfillService.requestStop();

    const now = new Date();
    await FullHistoryRefresh.findOneAndUpdate(
      { key: PIPELINE_KEY },
      {
        $set: {
          runId: randomUUID(),
          status: "running",
          stage: rankingMaintenanceActive ? "stop_rankings_for_identity_recovery" : "queue_character_identities",
          startedAt: now,
          stageStartedAt: now,
          lastActivityAt: now,
          completedAt: null,
          lastError: null,
          progress: {
            mode: "incremental_character_data",
            message: rankingMaintenanceActive
              ? "Stopping ranking maintenance before incremental character identity recovery"
              : "Preparing incremental historical character identity recovery",
            targetZoneIds: targets.zoneIds,
            targetGuildIds: targets.guildIds,
            characterIdentityResolutionCompleted: false,
          },
        },
        $setOnInsert: { key: PIPELINE_KEY },
      },
      { upsert: true, returnDocument: "after" },
    );

    void this.tick();
    logger.info(
      `[FullHistoryRefresh] Incremental character-data refresh requested for ${targets.guildIds.length} guild(s), raid(s): ${targets.zoneIds.join(", ") || "none"}`,
    );
    return { started: true, status: await this.getStatus() };
  }

  async restartFromIdentityRecovery(): Promise<{ started: boolean; message: string; status: FullHistoryRefreshStatusResponse }> {
    const existing = await FullHistoryRefresh.findOne({ key: PIPELINE_KEY }).lean<IFullHistoryRefresh>();
    const restartableRunningStages: FullHistoryRefreshStage[] = ["queue_rankings", "rankings", "stop_rankings_for_identity_recovery"];

    if (existing?.status === "running" && !restartableRunningStages.includes(existing.stage)) {
      return {
        started: false,
        message: `Cannot restart from identity recovery while the full-history pipeline is in ${existing.stage}`,
        status: await this.getStatus(),
      };
    }
    if (existing?.status === "running" && existing.stage === "stop_rankings_for_identity_recovery") {
      return {
        started: false,
        message: "Ranking shutdown and identity-recovery restart are already in progress",
        status: await this.getStatus(),
      };
    }

    characterRankingBackfillService.requestStop();
    const now = new Date();
    await FullHistoryRefresh.findOneAndUpdate(
      { key: PIPELINE_KEY },
      {
        $set: {
          runId: randomUUID(),
          status: "running",
          stage: "stop_rankings_for_identity_recovery",
          startedAt: now,
          stageStartedAt: now,
          lastActivityAt: now,
          completedAt: null,
          lastError: null,
          progress: {
            message: "Stopping the current ranking worker before identity recovery",
            restartMode: "identity_recovery_and_rankings",
            fightDetailsReused: true,
            rankingRestartFromScratch: true,
            characterIdentityResolutionCompleted: false,
            previousRunId: existing?.runId ?? null,
            previousStage: existing?.stage ?? null,
          },
        },
        $setOnInsert: { key: PIPELINE_KEY },
      },
      { upsert: true, returnDocument: "after" },
    );

    void this.tick();
    logger.warn("[FullHistoryRefresh] Restart requested from identity recovery; existing fight details will be reused");
    return {
      started: true,
      message: "Stopping current rankings, then restarting from identity recovery without refetching fight details",
      status: await this.getStatus(),
    };
  }

  async getStatus(): Promise<FullHistoryRefreshStatusResponse> {
    const [run, fightDetailsQueue, identityStatus, rankingQueue] = await Promise.all([
      FullHistoryRefresh.findOne({ key: PIPELINE_KEY }).lean<IFullHistoryRefresh>(),
      this.getFightDetailsQueueCounts(),
      characterIdentityResolutionService.getStatus(),
      this.getRankingQueueCounts(),
    ]);

    return {
      runId: run?.runId ?? null,
      status: run?.status ?? "idle",
      stage: run?.stage ?? null,
      startedAt: run?.startedAt ?? null,
      stageStartedAt: run?.stageStartedAt ?? null,
      lastActivityAt: run?.lastActivityAt ?? null,
      completedAt: run?.completedAt ?? null,
      lastError: run?.lastError ?? null,
      progress: run?.progress ?? {},
      fightDetailsQueue,
      identityQueue: identityStatus.queue,
      rankingQueue,
    };
  }

  private async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;
    let run: IFullHistoryRefresh | null = null;

    try {
      run = await FullHistoryRefresh.findOne({ key: PIPELINE_KEY, status: "running" });
      if (!run) return;

      switch (run.stage) {
        case "queue_fight_details":
          await this.queueFightDetails(run);
          break;
        case "fight_details":
          await this.waitForFightDetails(run);
          break;
        case "queue_character_identities":
          await this.queueCharacterIdentities(run);
          break;
        case "character_identities":
          await this.waitForCharacterIdentities(run);
          break;
        case "rebuild_character_participation":
          await this.rebuildCharacterParticipation(run);
          break;
        case "stop_rankings_for_identity_recovery":
          await this.stopRankingsForIdentityRecovery(run);
          break;
        case "queue_rankings":
          await this.queueRankings(run);
          break;
        case "rankings":
          await this.waitForRankings(run);
          break;
        case "mechanics_and_tier_lists":
          await this.rebuildMechanicsAndTierLists(run);
          break;
        case "ccg_snapshots":
          await this.complete(run, { ...run.progress, message: "Full-history data refresh completed; CCG was not changed" });
          break;
        default:
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (run && /already running|still running/i.test(message)) {
        logger.info(`[FullHistoryRefresh] ${run.stage} is waiting for another maintenance task: ${message}`);
        await FullHistoryRefresh.updateOne(
          { _id: run._id, status: "running", stage: run.stage },
          {
            $set: {
              lastActivityAt: new Date(),
              lastError: message,
              progress: { ...run.progress, message: `Waiting to retry ${run.stage}: ${message}` },
            },
          },
        );
        return;
      }
      logger.error("[FullHistoryRefresh] Pipeline failed:", error);
      await FullHistoryRefresh.updateOne(
        { key: PIPELINE_KEY, status: "running" },
        {
          $set: {
            status: "failed",
            stage: "failed",
            completedAt: new Date(),
            lastActivityAt: new Date(),
            lastError: message,
          },
        },
      );
    } finally {
      this.isTicking = false;
    }
  }

  private async queueFightDetails(run: IFullHistoryRefresh): Promise<void> {
    const existingQueue = await this.getFightDetailsQueueCounts();
    if (existingQueue.active > 0) {
      await this.updateProgress(run, { message: "Waiting for an existing fight-details queue before starting the all-raid pass", fightDetailsQueue: existingQueue });
      return;
    }

    const reopened = await this.reopenTerminalFightDetails();
    const result = await guildService.queueAllGuildsForDeathRescan(15, TRACKED_RAIDS);
    await this.advance(run, "fight_details", {
      message: "All-raid fight-details backfill queued",
      queuedGuilds: result.queued,
      skippedGuilds: result.skipped,
      reopenedFightRows: reopened,
      fightDetailsQueue: await this.getFightDetailsQueueCounts(),
    });
  }

  private async waitForFightDetails(run: IFullHistoryRefresh): Promise<void> {
    const queue = await this.getFightDetailsQueueCounts();
    await this.updateProgress(run, { ...run.progress, message: "Processing all-raid fight details", fightDetailsQueue: queue });
    if (queue.active > 0) return;
    await this.advance(run, "queue_character_identities", {
      ...run.progress,
      message: "All-raid fight-details queue finished; preparing historical character identity recovery",
      fightDetailsQueue: queue,
    });
  }

  private async queueCharacterIdentities(run: IFullHistoryRefresh): Promise<void> {
    const incremental = run.progress.mode === "incremental_character_data";
    const result = await characterIdentityResolutionService.trigger({
      refreshCandidates: true,
      reprocessSkipped: !incremental,
      reprocessSkippedWithNewEvidence: incremental,
    });
    await this.advance(run, "character_identities", {
      ...run.progress,
      message: incremental
        ? "New historical report-ranking identities queued for WCL resolution"
        : "Historical report-ranking identities queued for WCL resolution",
      identityEnqueue: result.enqueue,
      identityQueue: result.status.queue,
    });
  }

  private async waitForCharacterIdentities(run: IFullHistoryRefresh): Promise<void> {
    await characterIdentityResolutionService.resumeInterrupted();
    const status = await characterIdentityResolutionService.getStatus();
    await this.updateProgress(run, {
      ...run.progress,
      message: "Resolving historical character names through WCL",
      identityQueue: status.queue,
    });
    if (status.queue.active > 0) return;

    await this.advance(run, "rebuild_character_participation", {
      ...run.progress,
      message: "Historical WCL identity resolution finished; rebuilding character participation",
      identityQueue: status.queue,
    });
  }

  private async rebuildCharacterParticipation(run: IFullHistoryRefresh): Promise<void> {
    const result = await characterService.rebuildCharacterRaidParticipations();
    const incremental = run.progress.mode === "incremental_character_data";
    const targetGuildIds = incremental ? this.getIncrementalTargetGuildIds(run) : [];
    const mythicPlusCharacterIds =
      targetGuildIds.length > 0
        ? await CharacterRaidParticipation.distinct("characterId", {
            reportGuildId: { $in: targetGuildIds },
            characterId: { $ne: null },
            reportCount: { $gte: 2 },
          })
        : [];
    const mythicPlusEnqueue =
      incremental && mythicPlusCharacterIds.length > 0
        ? await mythicPlusService.enqueueProfileJobs({
            characterIds: mythicPlusCharacterIds.map(String),
            refresh: true,
            targetSeasons: [],
            fetchSeasonProgress: false,
          })
        : null;
    const mythicPlus = mythicPlusEnqueue
      ? { started: mythicPlusEnqueue.candidates > 0 ? mythicPlusService.startProcessing() : false, enqueue: mythicPlusEnqueue }
      : null;
    await this.advance(run, "queue_rankings", {
      ...run.progress,
      message: incremental
        ? "Resolved identities linked, character participation rebuilt, and missing Mythic+ profiles queued"
        : "Resolved identities linked and character participation rebuilt",
      characterIdentityResolutionCompleted: true,
      participationRebuild: result,
      ...(mythicPlus ? { mythicPlus } : {}),
    });
  }

  private async stopRankingsForIdentityRecovery(run: IFullHistoryRefresh): Promise<void> {
    characterRankingBackfillService.requestStop();
    const status = await characterRankingBackfillService.getStatus();
    await this.updateProgress(run, {
      ...run.progress,
      message: status.processor.isRunning
        ? "Waiting for the current ranking request to finish before identity recovery"
        : status.leaderboardRebuild.isRunning
          ? "Waiting for the character ranking-table rebuild to finish before identity recovery"
          : "Ranking worker stopped; starting identity recovery",
      rankingQueue: status.queue,
    });
    if (status.processor.isRunning || status.leaderboardRebuild.isRunning) return;

    await this.advance(run, "queue_character_identities", {
      ...run.progress,
      message: "Ranking worker stopped; reusing stored fight details and starting identity recovery",
      rankingQueue: status.queue,
    });
  }

  private async queueRankings(run: IFullHistoryRefresh): Promise<void> {
    if (run.progress.characterIdentityResolutionCompleted !== true) {
      await this.rewindToIdentityRecovery(run, "Recovering historical character identities before ranking refresh");
      return;
    }

    const incremental = run.progress.mode === "incremental_character_data";
    const restartFromScratch = !incremental && run.progress.rankingRestartFromScratch === true;
    if (restartFromScratch) {
      const existingStatus = await characterRankingBackfillService.getStatus();
      if (existingStatus.processor.isRunning) {
        await this.advance(run, "rankings", {
          ...run.progress,
          message: "Fresh ranking queue already started",
          rankingRestartFromScratch: false,
          rankingQueueRestartedFromScratch: true,
          rankingQueue: existingStatus.queue,
        });
        return;
      }
    }

    const result = await characterRankingBackfillService.triggerBackfill({
      refreshCandidates: true,
      reprocessCompleted: !incremental && !restartFromScratch,
      reprocessAll: restartFromScratch,
    });
    await this.advance(run, "rankings", {
      ...run.progress,
      message: incremental
        ? "Missing character/raid ranking pairs discovered and queued"
        : restartFromScratch
        ? "All ranking pairs reset and queued from the beginning"
        : "All character/raid pairs queued for all-spec ranking refresh",
      rankingRestartFromScratch: false,
      rankingQueueRestartedFromScratch: restartFromScratch,
      rankingEnqueue: result.enqueue,
      rankingQueue: result.status.queue,
    });
  }

  private async waitForRankings(run: IFullHistoryRefresh): Promise<void> {
    if (run.progress.characterIdentityResolutionCompleted !== true) {
      await this.rewindToIdentityRecovery(run, "Stopping the old ranking pass so identity recovery can run first");
      return;
    }

    await characterRankingBackfillService.resumeInterruptedBackfill();
    const status = await characterRankingBackfillService.getStatus();
    const active = status.queue.pending + status.queue.inProgress;
    const incremental = run.progress.mode === "incremental_character_data";
    await this.updateProgress(run, {
      ...run.progress,
      message: incremental ? "Fetching all class specs for newly discovered ranking pairs" : "Refetching every class spec for every tracked raid",
      rankingQueue: status.queue,
    });
    if (active > 0) return;
    await this.advance(run, "mechanics_and_tier_lists", {
      ...run.progress,
      message: incremental ? "New ranking pairs finished; rebuilding affected raid data" : "All-spec ranking refresh finished",
      rankingQueue: status.queue,
    });
  }

  private async rebuildMechanicsAndTierLists(run: IFullHistoryRefresh): Promise<void> {
    if (run.progress.characterIdentityResolutionCompleted !== true) {
      await this.rewindToIdentityRecovery(run, "Recovering historical character identities before mechanics and tier-list rebuilds");
      return;
    }

    const incremental = run.progress.mode === "incremental_character_data";
    const raidIds = incremental ? this.getIncrementalTargetZoneIds(run) : TRACKED_RAIDS;
    const taskId = await taskTracker.start(incremental ? "Incremental Mechanics and Character Tier Lists" : "Full History Mechanics and Character Tier Lists", {
      runId: run.runId,
      raidIds,
    });
    try {
      const mechanics = raidIds.length > 0 ? await characterMechanicsService.buildMechanicsLeaderboards(raidIds) : { zones: [], entries: 0 };
      const skippedZones = mechanics.zones.filter((zone) => zone.status === "skipped");
      if (skippedZones.length > 0) {
        const summary = skippedZones.map((zone) => `${zone.zoneId}: ${zone.reason ?? "insufficient fight coverage"}`).join("; ");
        throw new Error(`Full-history refresh stopped because ${skippedZones.length} raid(s) could not be rebuilt: ${summary}`);
      }

      const builtZoneIds = mechanics.zones.filter((zone) => zone.status === "built").map((zone) => zone.zoneId);
      const tierLists = await characterTierListService.rebuildCharacterTierLists(builtZoneIds);
      await cacheService.invalidateCharacterTierListCaches();
      const targetGuildIds = incremental ? this.getIncrementalTargetGuildIds(run) : [];
      const targetMediaCharacterIds =
        targetGuildIds.length > 0
          ? await CharacterRaidParticipation.distinct("characterId", {
              reportGuildId: { $in: targetGuildIds },
              characterId: { $ne: null },
            })
          : [];
      const mediaDiscovery = incremental ? await characterMediaService.enqueueMissing() : null;
      const targetedMediaQueued =
        incremental && targetMediaCharacterIds.length > 0
          ? await characterMediaService.enqueueCharacters(targetMediaCharacterIds, 200, true)
          : 0;
      const media = mediaDiscovery
        ? { ...mediaDiscovery, targetedCandidates: targetMediaCharacterIds.length, targetedQueued: targetedMediaQueued }
        : null;
      if (media) characterMediaService.startProcessing();
      await taskTracker.complete(taskId, { mechanics, tierLists, ...(media ? { media } : {}) });
      await this.complete(run, {
        ...run.progress,
        message: incremental
          ? "Missing identities, participation, rankings, Mythic+ profiles, mechanics, tier lists, and character renders were queued or refreshed; CCG snapshots were not changed"
          : "All tracked fight data, rankings, mechanics leaderboards, and character tier lists refreshed; CCG was not changed",
        mechanics,
        tierLists,
        ...(media ? { media } : {}),
      });
    } catch (error) {
      await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private getIncrementalTargetZoneIds(run: Pick<IFullHistoryRefresh, "progress">): number[] {
    const zoneIds = Array.isArray(run.progress.targetZoneIds) ? run.progress.targetZoneIds : [];
    return [...new Set(zoneIds.filter((zoneId): zoneId is number => Number.isInteger(zoneId) && TRACKED_RAIDS.includes(zoneId as number)))].sort(
      (left, right) => right - left,
    );
  }

  private getIncrementalTargetGuildIds(run: Pick<IFullHistoryRefresh, "progress">): string[] {
    const guildIds = Array.isArray(run.progress.targetGuildIds) ? run.progress.targetGuildIds : [];
    return [...new Set(guildIds.filter((guildId): guildId is string => typeof guildId === "string" && /^[a-f\d]{24}$/i.test(guildId)))];
  }

  private async findIncrementalTargets(): Promise<{ zoneIds: number[]; guildIds: string[] }> {
    const [identityRows, rankingRows] = await Promise.all([
      CharacterReportAppearance.aggregate<{ _id: null; zoneIds: number[]; guildIds: unknown[] }>([
        {
          $match: {
            appearanceSource: "reportRankings",
            wclCanonicalCharacterId: null,
            reportZoneId: { $in: TRACKED_RAIDS },
            hidden: { $ne: true },
            sourceIdentityKey: { $type: "string" },
          },
        },
        {
          $lookup: {
            from: CharacterIdentityResolution.collection.name,
            localField: "sourceIdentityKey",
            foreignField: "sourceIdentityKey",
            as: "identityResolution",
          },
        },
        { $set: { identityResolution: { $arrayElemAt: ["$identityResolution", 0] } } },
        {
          $match: {
            $or: [
              { identityResolution: null },
              { "identityResolution.status": { $in: ["pending", "in_progress", "completed"] } },
              {
                $expr: {
                  $and: [
                    { $in: ["$identityResolution.status", ["skipped", "failed"]] },
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$identityResolution.completedAt", null] }, null] },
                        { $gt: ["$createdAt", "$identityResolution.completedAt"] },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        },
        { $group: { _id: null, zoneIds: { $addToSet: "$reportZoneId" }, guildIds: { $addToSet: "$reportGuildId" } } },
      ]).allowDiskUse(true),
      CharacterReportAppearance.aggregate<{ _id: null; zoneIds: number[]; guildIds: unknown[] }>([
        {
          $match: {
            appearanceSource: "reportRankings",
            wclCanonicalCharacterId: { $type: "number" },
            characterId: { $ne: null },
            reportZoneId: { $in: TRACKED_RAIDS },
            hidden: { $ne: true },
            rankingFightIds: { $exists: true, $ne: [] },
          },
        },
        {
          $group: {
            _id: {
              wclCanonicalCharacterId: "$wclCanonicalCharacterId",
              classID: "$classID",
              zoneId: "$reportZoneId",
            },
            guildIds: { $addToSet: "$reportGuildId" },
          },
        },
        {
          $lookup: {
            from: CharacterRankingBackfill.collection.name,
            let: { canonicalId: "$_id.wclCanonicalCharacterId", classId: "$_id.classID", zoneId: "$_id.zoneId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$wclCanonicalCharacterId", "$$canonicalId"] },
                      { $eq: ["$classID", "$$classId"] },
                      { $eq: ["$zoneId", "$$zoneId"] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "rankingBackfill",
          },
        },
        { $match: { rankingBackfill: { $size: 0 } } },
        { $unwind: "$guildIds" },
        { $group: { _id: null, zoneIds: { $addToSet: "$_id.zoneId" }, guildIds: { $addToSet: "$guildIds" } } },
      ]).allowDiskUse(true),
    ]);

    return {
      zoneIds: [
        ...new Set([...(identityRows[0]?.zoneIds ?? []), ...(rankingRows[0]?.zoneIds ?? [])].filter((zoneId) => TRACKED_RAIDS.includes(zoneId))),
      ].sort((left, right) => right - left),
      guildIds: [
        ...new Set([...(identityRows[0]?.guildIds ?? []), ...(rankingRows[0]?.guildIds ?? [])].map(String).filter((guildId) => /^[a-f\d]{24}$/i.test(guildId))),
      ],
    };
  }

  private async rewindToIdentityRecovery(run: IFullHistoryRefresh, message: string): Promise<void> {
    characterRankingBackfillService.requestStop();
    await this.advance(run, "stop_rankings_for_identity_recovery", {
      ...run.progress,
      message,
      restartMode: "identity_recovery_and_rankings",
      fightDetailsReused: true,
      rankingRestartFromScratch: true,
      characterIdentityResolutionCompleted: false,
    });
  }

  private async advance(run: IFullHistoryRefresh, stage: FullHistoryRefreshStage, progress: Record<string, unknown>): Promise<void> {
    const now = new Date();
    await FullHistoryRefresh.updateOne(
      { _id: run._id, status: "running", stage: run.stage },
      { $set: { stage, stageStartedAt: now, lastActivityAt: now, progress, lastError: null } },
    );
    logger.info(`[FullHistoryRefresh] Run ${run.runId} advanced from ${run.stage} to ${stage}`);
  }

  private async complete(run: IFullHistoryRefresh, progress: Record<string, unknown>): Promise<void> {
    const now = new Date();
    await FullHistoryRefresh.updateOne(
      { _id: run._id, status: "running", stage: run.stage },
      {
        $set: {
          status: "completed",
          stage: "completed",
          completedAt: now,
          lastActivityAt: now,
          lastError: null,
          progress,
        },
      },
    );
    logger.info(`[FullHistoryRefresh] Completed run ${run.runId} without changing CCG snapshots or cards`);
  }

  private async updateProgress(run: IFullHistoryRefresh, progress: Record<string, unknown>): Promise<void> {
    await FullHistoryRefresh.updateOne(
      { _id: run._id, status: "running", stage: run.stage },
      { $set: { progress, lastActivityAt: new Date() } },
    );
  }

  private async getFightDetailsQueueCounts(): Promise<QueueCounts> {
    const rows = await GuildProcessingQueue.aggregate<{ _id: string; count: number }>([
      { $match: { jobType: "rescan_deaths" } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const counts: QueueCounts = { pending: 0, inProgress: 0, paused: 0, completed: 0, failed: 0, active: 0, total: 0 };
    for (const row of rows) {
      if (row._id === "pending") counts.pending = row.count;
      if (row._id === "in_progress") counts.inProgress = row.count;
      if (row._id === "paused") counts.paused = row.count;
      if (row._id === "completed") counts.completed = row.count;
      if (row._id === "failed") counts.failed = row.count;
      counts.total += row.count;
    }
    counts.active = counts.pending + counts.inProgress + counts.paused;
    return counts;
  }

  private async reopenTerminalFightDetails(): Promise<{ deathEvents: number; combatantInfo: number }> {
    const statuses = ["failed", "archived", "unavailable"] as const;
    const [deathEvents, combatantInfo] = await Promise.all([
      Fight.updateMany(
        { reportEndTime: { $gt: 0 }, zoneId: { $in: TRACKED_RAIDS }, deathEventsFetchStatus: { $in: statuses } },
        {
          $set: { deathEventsFetchStatus: "pending" },
          $unset: { deathEventsFetchFailedAt: 1, deathEventsFetchError: 1 },
        },
      ),
      Fight.updateMany(
        { reportEndTime: { $gt: 0 }, zoneId: { $in: TRACKED_RAIDS }, difficulty: 5, combatantInfoFetchStatus: { $in: statuses } },
        {
          $set: { combatantInfoFetchStatus: "pending" },
          $unset: { combatantInfoFetchFailedAt: 1, combatantInfoFetchError: 1 },
        },
      ),
    ]);
    return { deathEvents: deathEvents.modifiedCount ?? 0, combatantInfo: combatantInfo.modifiedCount ?? 0 };
  }

  private async getRankingQueueCounts(): Promise<FullHistoryRefreshStatusResponse["rankingQueue"]> {
    const rows = await CharacterRankingBackfill.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const counts = { pending: 0, inProgress: 0, completed: 0, skipped: 0, failed: 0, active: 0, total: 0 };
    for (const row of rows) {
      if (row._id === "pending") counts.pending = row.count;
      if (row._id === "in_progress") counts.inProgress = row.count;
      if (row._id === "completed") counts.completed = row.count;
      if (row._id === "skipped") counts.skipped = row.count;
      if (row._id === "failed") counts.failed = row.count;
      counts.total += row.count;
    }
    counts.active = counts.pending + counts.inProgress;
    return counts;
  }
}

export default new FullHistoryRefreshService();
