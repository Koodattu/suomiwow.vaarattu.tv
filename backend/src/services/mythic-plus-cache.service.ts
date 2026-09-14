import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Cache from "../models/Cache";
import CacheRefreshLease from "../models/CacheRefreshLease";
import logger from "../utils/logger";

export const MYTHIC_PLUS_OPTIONS_CACHE_KEY = "mythic-plus:options:v2";
export const MYTHIC_PLUS_OPTIONS_TTL_MS = 24 * 60 * 60 * 1000;
export const MYTHIC_PLUS_LEADERBOARD_TTL_MS = 5 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 5 * 60 * 1000;

/** Shared snapshots bypass L1 so API processes see worker refreshes immediately. */
export class MythicPlusCacheService {
  private pending = new Map<string, Promise<unknown>>();

  async get<T>(key: string, build: () => Promise<T>, ttl: number, warm = false): Promise<T> {
    const entry = await Cache.findOne({ key }).lean();
    const now = Date.now();
    const usable = entry && entry.staleExpiresAt && new Date(entry.staleExpiresAt).getTime() > now;
    // Warm shortly before expiry, without repeatedly rebuilding the options catalog.
    const refreshAhead = warm ? Math.min(ttl / 2, 10 * 60 * 1000) : 0;
    if (usable && new Date(entry.expiresAt).getTime() > now + refreshAhead) return entry.data as T;

    const refresh = this.refresh(key, build, ttl, entry ? new Date(entry.cachedAt).getTime() : 0);
    if (usable && !warm) {
      void refresh.catch((error) => logger.error(`[Mythic+ Cache] Background refresh failed for ${key}:`, error));
      return entry.data as T;
    }
    return refresh;
  }

  private refresh<T>(key: string, build: () => Promise<T>, ttl: number, previousCachedAt: number): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const promise = this.buildWithLease(key, build, ttl, previousCachedAt).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private async buildWithLease<T>(key: string, build: () => Promise<T>, ttl: number, previousCachedAt: number): Promise<T> {
    const owner = randomUUID();
    const deadline = Date.now() + REFRESH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // Another process may have published between our initial read and lease acquisition.
      const latest = await Cache.findOne({ key, cachedAt: { $gt: new Date(previousCachedAt) }, expiresAt: { $gt: new Date() } }).lean();
      if (latest) return latest.data as T;
      let acquired = false;
      try {
        acquired = !!await CacheRefreshLease.findOneAndUpdate(
          { _id: key, expiresAt: { $lte: new Date() } },
          { $set: { owner, expiresAt: new Date(Date.now() + LEASE_MS) } },
          { upsert: true, returnDocument: "after" },
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      if (!acquired) {
        await delay(1000);
        continue;
      }

      const startedAt = Date.now();
      let leaseLost = false;
      const heartbeat = setInterval(() => {
        void CacheRefreshLease.updateOne({ _id: key, owner }, { $set: { expiresAt: new Date(Date.now() + LEASE_MS) } })
          .then((result) => { if (!result.matchedCount) leaseLost = true; })
          .catch((error) => {
            leaseLost = true;
            logger.error(`[Mythic+ Cache] Lease renewal failed for ${key}:`, error);
          });
      }, LEASE_MS / 3);
      heartbeat.unref();
      logger.info(`[Mythic+ Cache] Building ${key}`);
      try {
        const published = await Cache.findOne({ key, cachedAt: { $gt: new Date(previousCachedAt) }, expiresAt: { $gt: new Date() } }).lean();
        if (published) return published.data as T;
        const data = await build();
        if (leaseLost || !await CacheRefreshLease.exists({ _id: key, owner, expiresAt: { $gt: new Date() } })) {
          throw new Error(`Cache refresh lease lost for ${key}`);
        }
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttl);
        // Preserve a last-good result through short worker outages and slow refreshes.
        const staleMs = key === MYTHIC_PLUS_OPTIONS_CACHE_KEY ? 7 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
        await Cache.findOneAndUpdate({ key }, {
          $set: { data, cachedAt: now, expiresAt, staleExpiresAt: new Date(expiresAt.getTime() + staleMs), ttlMs: ttl, endpoint: key.split(":").slice(0, 2).join(":") },
        }, { upsert: true });
        logger.info(`[Mythic+ Cache] Published ${key} in ${Date.now() - startedAt}ms`);
        return data;
      } finally {
        clearInterval(heartbeat);
        await CacheRefreshLease.deleteOne({ _id: key, owner }).catch((error) => logger.error(`[Mythic+ Cache] Lease release failed for ${key}:`, error));
      }
    }
    throw new Error(`Timed out waiting for cache refresh: ${key}`);
  }

  async markOptionsStale(minAgeMs = 0): Promise<void> {
    // Retain the snapshot; the next scheduled refresh or reader replaces it in place.
    await Cache.updateOne({ key: MYTHIC_PLUS_OPTIONS_CACHE_KEY, cachedAt: { $lte: new Date(Date.now() - minAgeMs) } }, { $set: { expiresAt: new Date() } });
  }
}

export default new MythicPlusCacheService();
