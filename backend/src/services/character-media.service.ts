import mongoose from "mongoose";
import Character from "../models/Character";
import CharacterMedia from "../models/CharacterMedia";
import CharacterMediaFetchQueue, { ICharacterMediaFetchQueue } from "../models/CharacterMediaFetchQueue";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import CcgSet from "../models/CcgSet";
import logger from "../utils/logger";
import cacheService from "./cache.service";

const DEFAULT_DISCOVERY_LIMIT = Math.max(50, Number(process.env.CCG_MEDIA_DISCOVERY_LIMIT || 1000));
const DEFAULT_REFRESH_DAYS = Math.max(1, Number(process.env.CCG_MEDIA_REFRESH_DAYS || 14));
const PROCESS_IDLE_MS = 5000;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

function realmSlug(realm: string): string {
  return realm
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
  queue: Record<string, number>;
  media: Record<string, number>;
  recentFailures: Array<{ characterId: string; name: string; realm: string; status: string; error: string | null }>;
};

class CharacterMediaService {
  private isRunning = false;

  async enqueueMissing(limit = DEFAULT_DISCOVERY_LIMIT): Promise<{ candidates: number; queued: number }> {
    const candidates = await Character.aggregate<{ _id: mongoose.Types.ObjectId; name: string; realm: string; region: string }>([
      { $sort: { updatedAt: -1 } },
      {
        $lookup: {
          from: "charactermedias",
          localField: "_id",
          foreignField: "characterId",
          as: "media",
        },
      },
      { $match: { $or: [{ media: { $size: 0 } }, { "media.status": { $in: ["pending", "failed"] } }] } },
      { $limit: Math.max(1, Math.min(limit, 10000)) },
      { $project: { name: 1, realm: 1, region: 1 } },
    ]);
    return { candidates: candidates.length, queued: await this.enqueueRows(candidates, 10) };
  }

  async enqueueActiveCurrent(limit = DEFAULT_DISCOVERY_LIMIT): Promise<{ candidates: number; queued: number }> {
    const zoneIds = await CcgSet.distinct("zoneId", { state: "current", enabledAt: { $ne: null } });
    if (zoneIds.length === 0) return { candidates: 0, queued: 0 };
    const characterIds = await CharacterTierListEntry.distinct("characterId", {
      scope: "global",
      zoneId: { $in: zoneIds },
      survivalScore: { $ne: null },
    });
    const refreshBefore = new Date(Date.now() - DEFAULT_REFRESH_DAYS * 24 * 60 * 60 * 1000);
    const staleMediaIds = await CharacterMedia.distinct("characterId", {
      characterId: { $in: characterIds },
      $or: [{ fetchedAt: null }, { fetchedAt: { $lt: refreshBefore } }, { nextMediaRefreshAt: { $lte: new Date() } }],
    });
    const existingMediaIds = new Set((await CharacterMedia.distinct("characterId", { characterId: { $in: characterIds } })).map(String));
    const missingIds = characterIds.filter((id) => !existingMediaIds.has(String(id)));
    const targetIds = [...staleMediaIds, ...missingIds].slice(0, limit);
    const rows = await Character.find({ _id: { $in: targetIds } }).select("name realm region").lean();
    return { candidates: rows.length, queued: await this.enqueueRows(rows, 100, true) };
  }

  async enqueueCharacter(characterId: string): Promise<void> {
    const row = await Character.findById(characterId).select("name realm region").lean();
    if (row) await this.enqueueRows([row], 50);
  }

  async enqueueCharacters(characterIds: mongoose.Types.ObjectId[], priority = 50): Promise<number> {
    if (characterIds.length === 0) return 0;
    const rows = await Character.find({ _id: { $in: characterIds } }).select("name realm region").lean();
    return this.enqueueRows(rows, priority);
  }

  private async enqueueRows(
    rows: Array<{ _id: mongoose.Types.ObjectId; name: string; realm: string; region: string }>,
    priority: number,
    force = false,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const now = new Date();
    const operations = rows.map((row) => ({
      updateOne: {
        filter: { characterId: row._id },
        update: {
          $set: {
            name: row.name,
            realm: row.realm,
            realmSlug: realmSlug(row.realm),
            region: row.region.toLowerCase(),
            priority,
            ...(force ? { status: "pending" as const, nextAttemptAt: now, completedAt: null } : {}),
          },
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
    return result.upsertedCount + result.modifiedCount;
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
      { new: true, sort: { priority: -1, nextAttemptAt: 1, createdAt: 1 } },
    );
  }

  private async processItem(item: ICharacterMediaFetchQueue): Promise<void> {
    const now = new Date();
    try {
      const { default: blizzardService } = await import("./blizzard.service");
      const media = await blizzardService.getCharacterMedia(item.name, item.realmSlug, item.region);
      if (!media.avatarUrl && !media.mainRawUrl) throw new Error("Blizzard media response contained no usable assets");

      await CharacterMedia.findOneAndUpdate(
        { characterId: item.characterId },
        {
          $set: {
            region: item.region,
            realmSlug: item.realmSlug,
            characterName: item.name,
            ...media,
            sourceUpdatedAt: now,
            fetchedAt: now,
            status: "available",
            attemptCount: item.attempts,
            nextAttemptAt: null,
            nextMediaRefreshAt: new Date(now.getTime() + DEFAULT_REFRESH_DAYS * 24 * 60 * 60 * 1000),
            lastErrorCode: null,
            lastError: null,
          },
        },
        { upsert: true, new: true },
      );
      await CharacterMediaFetchQueue.updateOne(
        { _id: item._id },
        { $set: { status: "completed", completedAt: now, lastActivityAt: now, lastError: null, lastErrorCode: null } },
      );
      await cacheService.invalidatePattern(
        new RegExp(`^characters:profile:v3:${escapeRegExp(item.realm.toLowerCase())}:${escapeRegExp(item.name.toLowerCase())}:`),
      );
    } catch (error) {
      const status = errorStatus(error);
      const message = error instanceof Error ? error.message : String(error);
      const isNotFound = status === 404;
      const exhausted = item.attempts >= item.maxAttempts;
      const delayMs = isNotFound ? 30 * 24 * 60 * 60 * 1000 : Math.min(6 * 60 * 60 * 1000, 2 ** item.attempts * 60 * 1000);
      const nextAttemptAt = new Date(now.getTime() + delayMs);
      const queueStatus = isNotFound ? "not_found" : exhausted ? "failed" : "retry";

      await CharacterMedia.findOneAndUpdate(
        { characterId: item.characterId },
        {
          $set: {
            region: item.region,
            realmSlug: item.realmSlug,
            characterName: item.name,
            status: isNotFound ? "not_found" : "failed",
            attemptCount: item.attempts,
            nextAttemptAt,
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
            status: queueStatus,
            nextAttemptAt,
            completedAt: queueStatus === "retry" ? null : now,
            lastActivityAt: now,
            lastErrorCode: status ? String(status) : "request_failed",
            lastError: message.slice(0, 500),
          },
        },
      );
    }
  }

  async recoverStaleProcessing(): Promise<number> {
    const staleAt = new Date(Date.now() - STALE_PROCESSING_MS);
    const result = await CharacterMediaFetchQueue.updateMany(
      { status: "processing", lastActivityAt: { $lt: staleAt } },
      { $set: { status: "retry", nextAttemptAt: new Date(), startedAt: null } },
    );
    return result.modifiedCount;
  }

  async retryFailures(): Promise<number> {
    const result = await CharacterMediaFetchQueue.updateMany(
      { status: { $in: ["failed", "not_found"] } },
      { $set: { status: "retry", attempts: 0, nextAttemptAt: new Date(), completedAt: null, startedAt: null } },
    );
    return result.modifiedCount;
  }

  async getStatus(): Promise<CharacterMediaQueueStatus> {
    const [queueRows, mediaRows, recentFailures] = await Promise.all([
      CharacterMediaFetchQueue.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      CharacterMedia.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      CharacterMediaFetchQueue.find({ status: { $in: ["failed", "not_found", "retry"] } })
        .sort({ updatedAt: -1 })
        .limit(20)
        .select("characterId name realm status lastError")
        .lean(),
    ]);
    return {
      processorRunning: this.isRunning,
      queue: Object.fromEntries(queueRows.map((row) => [row._id, row.count])),
      media: Object.fromEntries(mediaRows.map((row) => [row._id, row.count])),
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
