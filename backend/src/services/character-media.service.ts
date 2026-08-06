import mongoose from "mongoose";
import {
  COMPLETE_CCG_SCORE_FILTER,
  MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
  MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
} from "../config/character-eligibility";
import { CCG_CONFIGURED_SETS, CCG_MEDIA_REFRESH_MS } from "../config/ccg";
import Character from "../models/Character";
import CharacterMedia from "../models/CharacterMedia";
import CharacterMediaFetchQueue, { ICharacterMediaFetchQueue } from "../models/CharacterMediaFetchQueue";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import CcgCard from "../models/CcgCard";
import CcgSet from "../models/CcgSet";
import TaskLog from "../models/TaskLog";
import CharacterRenderAsset, { CharacterRenderFit } from "../models/CharacterRenderAsset";
import { resolveBlizzardCharacterIdentity } from "../utils/character-identity";
import logger from "../utils/logger";
import { toBlizzardRealmSlug } from "../utils/realm";
import cacheService from "./cache.service";
import ccgCardAvailabilityService from "./ccg-card-availability.service";
import { getCharacterRaidParticipationSummaries } from "./character-raid-guild.service";
import characterRenderStorageService from "./character-render-storage.service";

const PROCESS_IDLE_MS = 5000;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const DISCOVERY_QUERY_MAX_TIME_MS = 30 * 60 * 1000;
const QUEUE_WRITE_BATCH_SIZE = 1000;
const GENERAL_DISCOVERY_PRIORITY = 10;
const CCG_DISCOVERY_PRIORITY_BASE = 1000;
const TRANSIENT_FAILURE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_FOUND_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

export const CHARACTER_MEDIA_DISCOVERY_TASK_NAME = "CCG Character Media Discovery";
export const CHARACTER_MEDIA_REFRESH_TASK_NAME = "CCG Character Media Validation";
export const CHARACTER_MEDIA_RECOVERY_TASK_NAME = "CCG Character Media Recovery";
export const CHARACTER_MEDIA_RETRY_TASK_NAME = "CCG Character Media Retry";
export const CHARACTER_MEDIA_AUDIT_TASK_NAME = "CCG Previously Successful Media Audit";

type CharacterMediaQueueRow = {
  _id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  region: string;
  identityObservedAt?: Date | null;
  blizzardIdentityOverride?: {
    name: string;
    realm: string;
    updatedAt: Date;
  } | null;
  currentMediaName?: string | null;
  currentMediaRealmSlug?: string | null;
  currentMediaRegion?: string | null;
};

export type CharacterCardMediaSyncResult = {
  candidates: number;
  modified: number;
};

function normalizedIdentityPart(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

function mediaIdentityNeedsRefresh(row: CharacterMediaQueueRow): boolean {
  return (
    normalizedIdentityPart(row.name) !== normalizedIdentityPart(row.currentMediaName) ||
    toBlizzardRealmSlug(row.realm) !== normalizedIdentityPart(row.currentMediaRealmSlug) ||
    normalizedIdentityPart(row.region) !== normalizedIdentityPart(row.currentMediaRegion)
  );
}

export async function syncCharacterCardsFromMedia(
  characterId: mongoose.Types.ObjectId,
  media: {
    avatarUrl?: string | null;
    renderAssetId?: mongoose.Types.ObjectId | null;
    renderFit?: CharacterRenderFit | null;
    fetchedAt?: Date | null;
  },
): Promise<number> {
  if (!media.renderAssetId) return 0;
  const renderUrl = characterRenderStorageService.getPublicUrl(media.renderAssetId);
  // Existing URL-only cards are attached once during rollout. Once a card has an
  // asset reference, later character refreshes must not change its appearance.
  const result = await CcgCard.collection.updateMany(
    { characterId, renderAssetId: null },
    {
      $set: {
        renderUrl,
        renderAssetId: media.renderAssetId,
        renderFit: media.renderFit ?? null,
        avatarUrl: media.avatarUrl ?? null,
        mediaCapturedAt: media.fetchedAt ?? new Date(),
      },
    },
  );
  return result.modifiedCount;
}

export async function syncCardsFromCurrentMedia(characterIds: readonly mongoose.Types.ObjectId[]): Promise<CharacterCardMediaSyncResult> {
  if (characterIds.length === 0) return { candidates: 0, modified: 0 };
  const mediaRows = await CharacterMedia.find({
    characterId: { $in: characterIds },
    status: "available",
    renderAssetId: { $ne: null },
  })
    .select("characterId avatarUrl renderAssetId renderFit fetchedAt")
    .lean();
  if (mediaRows.length === 0) return { candidates: 0, modified: 0 };

  const operations = mediaRows.map((media) => ({
    updateMany: {
      filter: {
        characterId: media.characterId,
        renderAssetId: null,
      },
      update: {
        $set: {
          renderUrl: characterRenderStorageService.getPublicUrl(media.renderAssetId!),
          renderAssetId: media.renderAssetId,
          renderFit: media.renderFit ?? null,
          avatarUrl: media.avatarUrl ?? null,
          mediaCapturedAt: media.fetchedAt ?? new Date(),
        },
      },
    },
  }));
  const result = await CcgCard.collection.bulkWrite(operations, { ordered: false });
  return { candidates: mediaRows.length, modified: result.modifiedCount };
}

export type CharacterMediaFailureTransition = {
  queueStatus: "retry" | "failed" | "not_found";
  delayMs: number;
};

export function getCharacterMediaFailureTransition(
  attempts: number,
  maxAttempts: number,
  status: number | null,
): CharacterMediaFailureTransition {
  if (status === 404) return { queueStatus: "not_found", delayMs: NOT_FOUND_RETRY_MS };
  if (attempts >= maxAttempts) return { queueStatus: "failed", delayMs: TRANSIENT_FAILURE_RETRY_MS };
  return { queueStatus: "retry", delayMs: Math.min(6 * 60 * 60 * 1000, 2 ** attempts * 60 * 1000) };
}

function errorStatus(error: unknown): number | null {
  const match = (error instanceof Error ? error.message : String(error)).match(/status (\d{3})/i);
  return match ? Number(match[1]) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type CharacterMediaQueueStatus = {
  processorRunning: boolean;
  discoveryRunning: boolean;
  queue: Record<string, number>;
  media: Record<string, number>;
  assets: {
    active: number;
    activeBytes: number;
    expired: number;
    expiringWithinSevenDays: number;
    purged: number;
  };
  cardSeries: {
    active: number;
    verificationPending: number;
    archived: number;
  };
  lastDiscovery: {
    status: "running" | "completed" | "failed";
    startedAt: Date;
    completedAt: Date | null;
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

export type CharacterMediaDiscoveryResult = {
  scanned: number;
  candidates: number;
  queued: number;
  eligibleCandidates: number;
  generalCandidates: number;
  raidSets: Array<{ zoneId: number; raidName: string; candidates: number; queued: number }>;
};

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class CharacterMediaService {
  private isRunning = false;
  private discoveryPromise: Promise<CharacterMediaDiscoveryResult> | null = null;

  async enqueueMissing(): Promise<CharacterMediaDiscoveryResult> {
    if (this.discoveryPromise) return this.discoveryPromise;
    this.discoveryPromise = this.discoverMissing();
    try {
      return await this.discoveryPromise;
    } finally {
      this.discoveryPromise = null;
    }
  }

  private async discoverMissing(): Promise<CharacterMediaDiscoveryResult> {
    const now = new Date();
    const [dueCharacters, renamedCandidates, scanned] = await Promise.all([
      Character.aggregate<CharacterMediaQueueRow>([
        {
          $lookup: {
            from: "charactermedias",
            localField: "_id",
            foreignField: "characterId",
            as: "media",
          },
        },
        {
          $match: {
            $or: [
              { media: { $size: 0 } },
              {
                media: {
                  $elemMatch: {
                    mainRawUrl: null,
                    $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
                  },
                },
              },
            ],
          },
        },
        { $sort: { updatedAt: -1 } },
        { $project: { name: 1, realm: 1, region: 1, identityObservedAt: 1, blizzardIdentityOverride: 1 } },
      ])
        .allowDiskUse(true)
        .option({ maxTimeMS: DISCOVERY_QUERY_MAX_TIME_MS })
        .exec(),
      CharacterMedia.aggregate<CharacterMediaQueueRow>([
        {
          $lookup: {
            from: Character.collection.name,
            localField: "characterId",
            foreignField: "_id",
            as: "character",
          },
        },
        { $set: { character: { $arrayElemAt: ["$character", 0] } } },
        {
          $lookup: {
            from: CharacterRaidParticipation.collection.name,
            let: { characterId: "$characterId" },
            pipeline: [
              { $match: { $expr: { $eq: ["$characterId", "$$characterId"] } } },
              { $sort: { lastSeenAt: -1, zoneId: -1, _id: -1 } },
              { $limit: 1 },
              {
                $project: {
                  _id: 0,
                  name: "$characterName",
                  realm: "$characterRealm",
                  region: "$characterRegion",
                  observedAt: "$lastSeenAt",
                },
              },
            ],
            as: "latestIdentity",
          },
        },
        { $set: { latestIdentity: { $arrayElemAt: ["$latestIdentity", 0] } } },
        {
          $set: {
            observedIdentity: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ["$latestIdentity", null] }, null] },
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$character.identityObservedAt", null] }, null] },
                        { $gt: ["$latestIdentity.observedAt", "$character.identityObservedAt"] },
                      ],
                    },
                  ],
                },
                "$latestIdentity",
                {
                  name: "$character.name",
                  realm: "$character.realm",
                  region: "$character.region",
                  observedAt: "$character.identityObservedAt",
                },
              ],
            },
          },
        },
        {
          $set: {
            desiredIdentity: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ["$character.blizzardIdentityOverride", null] }, null] },
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$observedIdentity.observedAt", null] }, null] },
                        { $gte: ["$character.blizzardIdentityOverride.updatedAt", "$observedIdentity.observedAt"] },
                      ],
                    },
                  ],
                },
                {
                  name: "$character.blizzardIdentityOverride.name",
                  realm: "$character.blizzardIdentityOverride.realm",
                  region: "$character.region",
                },
                "$observedIdentity",
              ],
            },
          },
        },
        {
          $match: {
            $expr: {
              $and: [
                { $ne: [{ $ifNull: ["$desiredIdentity", null] }, null] },
                {
                  $or: [
                    { $ne: [{ $toLower: { $ifNull: ["$desiredIdentity.name", ""] } }, { $toLower: { $ifNull: ["$characterName", ""] } }] },
                    { $ne: [{ $toLower: { $ifNull: ["$desiredIdentity.realm", ""] } }, { $toLower: { $ifNull: ["$realmSlug", ""] } }] },
                    { $ne: [{ $toLower: { $ifNull: ["$desiredIdentity.region", ""] } }, { $toLower: { $ifNull: ["$region", ""] } }] },
                  ],
                },
              ],
            },
          },
        },
        {
          $project: {
            _id: "$characterId",
            name: "$desiredIdentity.name",
            realm: "$desiredIdentity.realm",
            region: "$desiredIdentity.region",
            blizzardIdentityOverride: "$character.blizzardIdentityOverride",
            currentMediaName: "$characterName",
            currentMediaRealmSlug: "$realmSlug",
            currentMediaRegion: "$region",
          },
        },
      ])
        .allowDiskUse(true)
        .option({ maxTimeMS: DISCOVERY_QUERY_MAX_TIME_MS })
        .exec(),
      Character.countDocuments(),
    ]);

    const renamedCharacters = renamedCandidates.filter(mediaIdentityNeedsRefresh);

    const discoveredByCharacterId = new Map(dueCharacters.map((character) => [String(character._id), character]));
    for (const character of renamedCharacters) {
      discoveredByCharacterId.set(String(character._id), character);
    }
    const dueByCharacterId = new Map(discoveredByCharacterId);
    const assignedEligibleCharacterIds = new Set<string>();
    const configuredSets = [...CCG_CONFIGURED_SETS].sort((left, right) => right.zoneId - left.zoneId);
    const raidSets: Array<{ zoneId: number; raidName: string; candidates: number; queued: number }> = [];
    let eligibleCandidates = 0;
    let queued = 0;

    for (const [index, set] of configuredSets.entries()) {
      const rankedEntries = await CharacterTierListEntry.find({
        scope: "global",
        zoneId: set.zoneId,
        pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
        ...COMPLETE_CCG_SCORE_FILTER,
      })
        .select("characterId")
        .maxTimeMS(DISCOVERY_QUERY_MAX_TIME_MS)
        .lean<Array<{ characterId: mongoose.Types.ObjectId }>>();
      const participationByCharacter = await getCharacterRaidParticipationSummaries(
        set.zoneId,
        rankedEntries.map((entry) => entry.characterId),
      );
      const eligibleCharacterIds = rankedEntries
        .filter(
          (entry) =>
            (participationByCharacter.get(String(entry.characterId))?.mythicReportCount ?? 0) >=
            MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
        )
        .map((entry) => entry.characterId);
      const rows: CharacterMediaQueueRow[] = [];

      for (const characterId of eligibleCharacterIds) {
        const key = String(characterId);
        if (assignedEligibleCharacterIds.has(key)) continue;
        assignedEligibleCharacterIds.add(key);
        const character = dueByCharacterId.get(key);
        if (!character) continue;
        rows.push(character);
        dueByCharacterId.delete(key);
      }

      const setQueued = await this.enqueueRows(rows, CCG_DISCOVERY_PRIORITY_BASE + configuredSets.length - index, true);
      eligibleCandidates += rows.length;
      queued += setQueued;
      raidSets.push({ zoneId: set.zoneId, raidName: set.raidName, candidates: rows.length, queued: setQueued });
    }

    const generalCharacters = Array.from(dueByCharacterId.values());
    const generalQueued = await this.enqueueRows(generalCharacters, GENERAL_DISCOVERY_PRIORITY, true);
    queued += generalQueued;

    return {
      scanned,
      candidates: discoveredByCharacterId.size,
      queued,
      eligibleCandidates,
      generalCandidates: generalCharacters.length,
      raidSets,
    };
  }

  async enqueueActiveCurrent(): Promise<{ candidates: number; queued: number; purged: number }> {
    const now = new Date();
    const zoneIds = await CcgSet.distinct("zoneId", { state: "current", enabledAt: { $ne: null } });
    const characterIds = zoneIds.length > 0
      ? await CharacterTierListEntry.distinct("characterId", {
          scope: "global",
          zoneId: { $in: zoneIds },
          survivalScore: { $ne: null },
        })
      : [];
    const refreshBefore = new Date(Date.now() - CCG_MEDIA_REFRESH_MS);
    const staleMediaIds = await CharacterMedia.distinct("characterId", {
      characterId: { $in: characterIds },
      status: "available",
      mainRawUrl: { $ne: null },
      $or: [{ fetchedAt: null }, { fetchedAt: { $lt: refreshBefore } }, { nextMediaRefreshAt: { $lte: now } }],
    });
    const existingMediaIds = new Set((await CharacterMedia.distinct("characterId", { characterId: { $in: characterIds } })).map(String));
    const missingIds = characterIds.filter((id) => !existingMediaIds.has(String(id)));
    const unbackfilledMediaIds = await CharacterMedia.distinct("characterId", {
      renderAssetId: null,
      mainRawUrl: { $ne: null },
    });
    const unbackfilledCardIds = await CcgCard.distinct("characterId", {
      renderAssetId: null,
      communityCharacterId: null,
    });
    const currentTargetIds = new Map(
      [...staleMediaIds, ...missingIds].map((characterId) => [String(characterId), characterId]),
    );
    const allTargetIds = new Map(currentTargetIds);
    for (const characterId of unbackfilledMediaIds) allTargetIds.set(String(characterId), characterId);
    for (const characterId of unbackfilledCardIds) allTargetIds.set(String(characterId), characterId);
    const rows = await Character.find({ _id: { $in: [...allTargetIds.values()] } })
      .select("name realm region identityObservedAt blizzardIdentityOverride")
      .lean();
    const currentRows = rows.filter((row) => currentTargetIds.has(String(row._id)));
    const backfillRows = rows.filter((row) => !currentTargetIds.has(String(row._id)));
    const currentQueued = await this.enqueueRows(currentRows, 100, true);
    const backfillQueued = await this.enqueueRows(backfillRows, 50, true);
    return { candidates: rows.length, queued: currentQueued + backfillQueued, purged: 0 };
  }

  async auditPreviouslySuccessful(): Promise<{ candidates: number; queued: number }> {
    const characterIds = await CharacterRenderAsset.distinct("characterId");
    const rows = await Character.find({ _id: { $in: characterIds } })
      .select("name realm region identityObservedAt blizzardIdentityOverride")
      .lean();
    const queued = await this.enqueueRows(rows, 250, true);
    return { candidates: rows.length, queued };
  }

  async enqueueCharacter(characterId: string, priority = 50, force = false): Promise<void> {
    const row = await Character.findById(characterId).select("name realm region identityObservedAt blizzardIdentityOverride").lean();
    if (row) await this.enqueueRows([row], priority, force);
  }

  async enqueueCharacters(characterIds: mongoose.Types.ObjectId[], priority = 50, force = false): Promise<number> {
    if (characterIds.length === 0) return 0;
    const rows = await Character.find({ _id: { $in: characterIds } }).select("name realm region identityObservedAt blizzardIdentityOverride").lean();
    return this.enqueueRows(rows, priority, force);
  }

  async enqueueDueForCardSnapshots(
    characterIds: readonly mongoose.Types.ObjectId[],
    now = new Date(),
  ): Promise<number> {
    if (characterIds.length === 0) return 0;
    const mediaRows = await CharacterMedia.find({ characterId: { $in: characterIds } })
      .select("characterId renderAssetId nextMediaRefreshAt")
      .lean();
    const mediaByCharacterId = new Map(mediaRows.map((media) => [String(media.characterId), media]));
    const dueIds = characterIds.filter((characterId) => {
      const media = mediaByCharacterId.get(String(characterId));
      return !media?.renderAssetId || !media.nextMediaRefreshAt || media.nextMediaRefreshAt <= now;
    });
    return this.enqueueCharacters(dueIds, 500, true);
  }

  private async enqueueRows(
    rows: CharacterMediaQueueRow[],
    priority: number,
    force = false,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const now = new Date();
    let queued = 0;

    for (let offset = 0; offset < rows.length; offset += QUEUE_WRITE_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + QUEUE_WRITE_BATCH_SIZE);
      const resolvedBatch = await this.resolveLatestIdentityRows(batch);
      const operations = resolvedBatch.map((row) => ({
        updateOne: {
          filter: { characterId: row._id },
          update: {
            $set: {
              name: row.name,
              realm: row.realm,
              realmSlug: toBlizzardRealmSlug(row.realm),
              region: row.region.toLowerCase(),
            },
            $max: { priority },
            $setOnInsert: {
              characterId: row._id,
              status: "pending" as const,
              attempts: 0,
              maxAttempts: 5,
              nextAttemptAt: now,
              lastActivityAt: now,
            },
          },
          upsert: true,
        },
      }));
      const result = await CharacterMediaFetchQueue.bulkWrite(operations, { ordered: false });
      queued += force ? resolvedBatch.length : result.upsertedCount;

      if (force) {
        await CharacterMediaFetchQueue.updateMany(
          { characterId: { $in: resolvedBatch.map((row) => row._id) }, status: { $ne: "processing" } },
          {
            $set: {
              status: "pending",
              attempts: 0,
              nextAttemptAt: now,
              startedAt: null,
              completedAt: null,
              lastActivityAt: now,
            },
          },
        );
      }
    }

    return queued;
  }

  private async resolveLatestIdentityRows(rows: CharacterMediaQueueRow[]): Promise<CharacterMediaQueueRow[]> {
    const latestRows = await CharacterRaidParticipation.find({
      characterId: { $in: rows.map((row) => row._id) },
    })
      .sort({ lastSeenAt: -1, zoneId: -1, _id: -1 })
      .select("characterId characterName characterRealm characterRegion lastSeenAt")
      .lean<Array<{
        characterId: mongoose.Types.ObjectId;
        characterName: string;
        characterRealm: string;
        characterRegion: string;
        lastSeenAt: Date;
      }>>();
    const latestByCharacterId = new Map<string, (typeof latestRows)[number]>();

    for (const latest of latestRows) {
      const characterId = String(latest.characterId);
      if (!latestByCharacterId.has(characterId)) latestByCharacterId.set(characterId, latest);
    }

    return rows.map((row) => {
      const latest = latestByCharacterId.get(String(row._id));
      return {
        ...row,
        ...resolveBlizzardCharacterIdentity(
          row,
          latest
            ? {
                name: latest.characterName,
                realm: latest.characterRealm,
                region: latest.characterRegion,
                observedAt: latest.lastSeenAt,
              }
            : null,
        ),
      };
    });
  }

  startProcessing(): boolean {
    if (this.isRunning) return false;
    this.isRunning = true;
    void this.processLoop();
    logger.info("[CharacterMedia] Processor started");
    return true;
  }

  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const item = await this.claimNext();
        if (!item) {
          await new Promise((resolve) => setTimeout(resolve, PROCESS_IDLE_MS));
          continue;
        }
        await this.processItem(item);
      } catch (error) {
        logger.error("[CharacterMedia] Processor loop failed:", error);
        await new Promise((resolve) => setTimeout(resolve, PROCESS_IDLE_MS));
      }
    }
  }

  private async claimNext(): Promise<ICharacterMediaFetchQueue | null> {
    const now = new Date();
    return CharacterMediaFetchQueue.findOneAndUpdate(
      {
        status: { $in: ["pending", "retry"] },
        nextAttemptAt: { $lte: now },
        $expr: { $lt: ["$attempts", "$maxAttempts"] },
      },
      { $set: { status: "processing", startedAt: now, lastActivityAt: now }, $inc: { attempts: 1 } },
      { returnDocument: "after", sort: { priority: -1, nextAttemptAt: 1, createdAt: 1 } },
    );
  }

  private async processItem(item: ICharacterMediaFetchQueue): Promise<void> {
    const now = new Date();
    try {
      const existingMedia = await CharacterMedia.findOne({ characterId: item.characterId })
        .select("avatarUrl insetUrl mainRawUrl renderAssetId")
        .lean<{
          avatarUrl?: string | null;
          insetUrl?: string | null;
          mainRawUrl?: string | null;
          renderAssetId?: mongoose.Types.ObjectId | null;
        }>();
      const legacyCard = !existingMedia?.renderAssetId && !existingMedia?.mainRawUrl
        ? await CcgCard.findOne({
            characterId: item.characterId,
            communityCharacterId: null,
            renderAssetId: null,
            renderUrl: /^https:\/\/render\.worldofwarcraft\.com\//i,
          })
            .sort({ publishedAt: -1 })
            .select("avatarUrl renderUrl")
            .lean<{ avatarUrl?: string | null; renderUrl?: string | null }>()
        : null;
      const existingSourceUrl = existingMedia?.mainRawUrl ?? legacyCard?.renderUrl ?? null;
      let renderAsset = !existingMedia?.renderAssetId
        ? await characterRenderStorageService.ingestExistingSource(item.characterId, existingSourceUrl, now)
        : null;
      let media = renderAsset
        ? {
            avatarUrl: existingMedia?.avatarUrl ?? legacyCard?.avatarUrl ?? null,
            insetUrl: existingMedia?.insetUrl ?? null,
            mainRawUrl: existingSourceUrl,
          }
        : null;

      if (!renderAsset) {
        const { default: blizzardService } = await import("./blizzard.service");
        media = await blizzardService.getCharacterMedia(item.name, item.realmSlug, item.region);
        if (!media.avatarUrl && !media.mainRawUrl) throw new Error("Blizzard media response contained no usable assets");

        if (!media.mainRawUrl) {
          const transition = getCharacterMediaFailureTransition(item.attempts, item.maxAttempts, null);
          const nextAttemptAt = new Date(now.getTime() + transition.delayMs);
          await CharacterMedia.findOneAndUpdate(
            { characterId: item.characterId },
            {
              $set: {
                region: item.region,
                realmSlug: item.realmSlug,
                characterName: item.name,
                avatarUrl: media.avatarUrl,
                insetUrl: media.insetUrl,
                sourceUpdatedAt: now,
                sourceValidatedAt: now,
                fetchedAt: now,
                status: "available",
                attemptCount: item.attempts,
                nextAttemptAt,
                nextMediaRefreshAt: null,
                lastErrorCode: "render_missing",
                lastError: "Blizzard media response contained no full character render",
              },
            },
            { upsert: true, returnDocument: "after" },
          );
          await CharacterMediaFetchQueue.updateOne(
            { _id: item._id },
            {
              $set: {
                status: transition.queueStatus,
                nextAttemptAt,
                completedAt: transition.queueStatus === "retry" ? null : now,
                lastActivityAt: now,
                lastErrorCode: "render_missing",
                lastError: "Blizzard media response contained no full character render",
              },
            },
          );
          return;
        }

        renderAsset = await characterRenderStorageService.ingest(item.characterId, media.mainRawUrl, now);
      }

      if (!media || !renderAsset) throw new Error("Character render could not be resolved");
      const storedMedia = await CharacterMedia.findOneAndUpdate(
        { characterId: item.characterId },
        {
          $set: {
            region: item.region,
            realmSlug: item.realmSlug,
            characterName: item.name,
            ...media,
            renderAssetId: renderAsset.assetId,
            renderFit: renderAsset.fit,
            sourceUpdatedAt: now,
            sourceValidatedAt: now,
            fetchedAt: now,
            status: "available",
            attemptCount: item.attempts,
            nextAttemptAt: null,
            nextMediaRefreshAt: new Date(now.getTime() + CCG_MEDIA_REFRESH_MS),
            lastErrorCode: null,
            lastError: null,
          },
        },
        { upsert: true, returnDocument: "after" },
      );
      await CharacterMediaFetchQueue.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "completed",
            attempts: 0,
            startedAt: null,
            completedAt: now,
            lastActivityAt: now,
            lastError: null,
            lastErrorCode: null,
          },
        },
      );
      try {
        const syncedCards = storedMedia ? await syncCharacterCardsFromMedia(item.characterId, storedMedia) : 0;
        await ccgCardAvailabilityService.noteAvailable(item.characterId, now);
        if (syncedCards > 0) await cacheService.invalidatePattern(/^ccg:/);
      } catch (error) {
        logger.error(`[CharacterMedia] Failed to propagate refreshed media or availability for ${item.characterId}:`, error);
      }
      await cacheService.invalidatePattern(
        new RegExp(`^characters:profile:v4:${escapeRegExp(item.realm.toLowerCase())}:${escapeRegExp(item.name.toLowerCase())}:`),
      );
    } catch (error) {
      const status = errorStatus(error);
      const message = error instanceof Error ? error.message : String(error);
      const transition = getCharacterMediaFailureTransition(item.attempts, item.maxAttempts, status);
      const nextAttemptAt = new Date(now.getTime() + transition.delayMs);
      if (status === 404) {
        try {
          await ccgCardAvailabilityService.noteNotFound(item.characterId, now);
        } catch (availabilityError) {
          logger.error(`[CharacterMedia] Failed to update card availability for ${item.characterId}:`, availabilityError);
        }
        await cacheService.invalidatePattern(/^ccg:/);
      }
      const existingMedia = await CharacterMedia.findOne({ characterId: item.characterId })
        .select("renderAssetId")
        .lean();
      const hasExistingRender = Boolean(existingMedia?.renderAssetId);

      await CharacterMedia.findOneAndUpdate(
        { characterId: item.characterId },
        {
          $set: {
            region: item.region,
            realmSlug: item.realmSlug,
            characterName: item.name,
            status: hasExistingRender ? "available" : status === 404 ? "not_found" : "failed",
            attemptCount: item.attempts,
            nextAttemptAt,
            ...(hasExistingRender ? { nextMediaRefreshAt: nextAttemptAt } : {}),
            ...(status === 404 && !hasExistingRender
              ? {
                  avatarUrl: null,
                  insetUrl: null,
                  mainRawUrl: null,
                  renderAssetId: null,
                  renderFit: null,
                }
              : {}),
            lastErrorCode: status ? String(status) : "request_failed",
            lastError: message.slice(0, 500),
          },
        },
        { upsert: true },
      );
      await CharacterMediaFetchQueue.updateOne(
        { _id: item._id },
        {
          $set: {
            status: transition.queueStatus,
            nextAttemptAt,
            completedAt: transition.queueStatus === "retry" ? null : now,
            lastActivityAt: now,
            lastErrorCode: status ? String(status) : "request_failed",
            lastError: message.slice(0, 500),
          },
        },
      );
    }
  }

  async recoverStaleProcessing(): Promise<number> {
    const now = new Date();
    const staleAt = new Date(Date.now() - STALE_PROCESSING_MS);
    const exhausted = await CharacterMediaFetchQueue.find({
      status: "processing",
      lastActivityAt: { $lt: staleAt },
      $expr: { $gte: ["$attempts", "$maxAttempts"] },
    })
      .select("characterId name realmSlug region attempts")
      .lean();
    let exhaustedCount = 0;

    if (exhausted.length > 0) {
      const characterIds = exhausted.map((item) => item.characterId);
      const existingRenderIds = new Set(
        (await CharacterMedia.distinct("characterId", {
          characterId: { $in: characterIds },
          renderAssetId: { $ne: null },
        })).map(String),
      );
      const nextAttemptAt = new Date(now.getTime() + TRANSIENT_FAILURE_RETRY_MS);
      await CharacterMedia.bulkWrite(
        exhausted.map((item) => ({
          updateOne: {
            filter: { characterId: item.characterId },
            update: {
              $set: {
                region: item.region,
                realmSlug: item.realmSlug,
                characterName: item.name,
                status: existingRenderIds.has(String(item.characterId)) ? ("available" as const) : ("failed" as const),
                attemptCount: item.attempts,
                nextAttemptAt,
                ...(existingRenderIds.has(String(item.characterId)) ? { nextMediaRefreshAt: nextAttemptAt } : {}),
                lastErrorCode: "stale_processing",
                lastError: "Character media request stopped responding",
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      const failed = await CharacterMediaFetchQueue.updateMany(
        { _id: { $in: exhausted.map((item) => item._id) }, status: "processing" },
        {
          $set: {
            status: "failed",
            nextAttemptAt,
            startedAt: null,
            completedAt: now,
            lastActivityAt: now,
            lastErrorCode: "stale_processing",
            lastError: "Character media request stopped responding",
          },
        },
      );
      exhaustedCount = failed.modifiedCount;
    }

    const retried = await CharacterMediaFetchQueue.updateMany(
      {
        status: "processing",
        lastActivityAt: { $lt: staleAt },
        $expr: { $lt: ["$attempts", "$maxAttempts"] },
      },
      { $set: { status: "retry", nextAttemptAt: now, startedAt: null, lastActivityAt: now } },
    );
    return exhaustedCount + retried.modifiedCount;
  }

  async retryFailures(): Promise<number> {
    const result = await CharacterMediaFetchQueue.updateMany(
      { status: { $in: ["failed", "not_found"] } },
      { $set: { status: "retry", attempts: 0, nextAttemptAt: new Date(), completedAt: null, startedAt: null } },
    );
    return result.modifiedCount;
  }

  async getStatus(): Promise<CharacterMediaQueueStatus> {
    const [queueRows, mediaRows, assets, cardSeriesRows, recentFailures, lastDiscovery] = await Promise.all([
      CharacterMediaFetchQueue.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      CharacterMedia.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      characterRenderStorageService.getStats(),
      CcgCard.aggregate<{ _id: number; count: number }>([
        {
          $group: {
            _id: { setId: "$setId", characterId: "$characterId" },
            availabilityRank: {
              $max: {
                $switch: {
                  branches: [
                    { case: { $eq: ["$availabilityStatus", "archived"] }, then: 2 },
                    { case: { $eq: ["$availabilityStatus", "verification_pending"] }, then: 1 },
                  ],
                  default: 0,
                },
              },
            },
          },
        },
        { $group: { _id: "$availabilityRank", count: { $sum: 1 } } },
      ]),
      CharacterMediaFetchQueue.find({ status: { $in: ["failed", "not_found", "retry"] } })
        .sort({ updatedAt: -1 })
        .limit(20)
        .select("characterId name realm status lastError")
        .lean(),
      TaskLog.findOne({ taskName: CHARACTER_MEDIA_DISCOVERY_TASK_NAME }).sort({ startedAt: -1 }).lean(),
    ]);
    return {
      processorRunning: this.isRunning,
      discoveryRunning: this.discoveryPromise !== null,
      queue: Object.fromEntries(queueRows.map((row) => [row._id, row.count])),
      media: Object.fromEntries(mediaRows.map((row) => [row._id, row.count])),
      assets,
      cardSeries: {
        active: cardSeriesRows.find((row) => row._id === 0)?.count ?? 0,
        verificationPending: cardSeriesRows.find((row) => row._id === 1)?.count ?? 0,
        archived: cardSeriesRows.find((row) => row._id === 2)?.count ?? 0,
      },
      lastDiscovery: lastDiscovery
        ? {
            status: lastDiscovery.status,
            startedAt: lastDiscovery.startedAt,
            completedAt: lastDiscovery.completedAt ?? null,
            durationMs: lastDiscovery.durationMs ?? null,
            error: lastDiscovery.error ?? null,
            scanned: metadataNumber(lastDiscovery.metadata, "scanned"),
            candidates: metadataNumber(lastDiscovery.metadata, "candidates"),
            queued: metadataNumber(lastDiscovery.metadata, "queued"),
            eligibleCandidates: metadataNumber(lastDiscovery.metadata, "eligibleCandidates"),
            generalCandidates: metadataNumber(lastDiscovery.metadata, "generalCandidates"),
          }
        : null,
      recentFailures: recentFailures.map((row) => ({
        characterId: String(row.characterId),
        name: row.name,
        realm: row.realm,
        status: row.status,
        error: row.lastError ?? null,
      })),
    };
  }
}

export default new CharacterMediaService();
