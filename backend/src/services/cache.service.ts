import logger from "../utils/logger";
import { CURRENT_RAID_IDS, TRACKED_RAIDS } from "../config/guilds";
import Cache from "../models/Cache";

/**
 * Cache warmer function type - async function that generates cache data
 */
type CacheWarmer = () => Promise<any>;

/**
 * In-memory cache entry with metadata for LRU tracking and stale-while-revalidate
 */
interface MemoryCacheEntry {
  data: any;
  cachedAt: Date;
  expiresAt: Date;
  staleExpiresAt: Date;
  lastAccessed: Date;
  accessCount: number;
}

/**
 * MongoDB cache entry structure (matches what we read from DB)
 */
interface MongoCacheEntry {
  key: string;
  data: any;
  cachedAt: Date;
  expiresAt: Date;
  staleExpiresAt?: Date;
  ttlMs: number;
  endpoint: string;
}

/**
 * ============================================================================
 * STALE-WHILE-REVALIDATE CACHE SERVICE
 * ============================================================================
 *
 * This cache service implements a two-tier caching strategy with stale-while-revalidate:
 *
 * ## Architecture
 *
 * 1. **L1 Cache (In-Memory)**: Fast Map-based cache for hot paths
 *    - Holds up to MAX_MEMORY_ENTRIES items
 *    - LRU eviction when full (evicts least recently accessed items)
 *    - Checked FIRST before hitting MongoDB
 *    - Prioritizes frequently accessed keys (home, progress:raid:*)
 *
 * 2. **L2 Cache (MongoDB)**: Persistent cache with TTL indexes
 *    - Survives server restarts
 *    - Automatic cleanup via MongoDB TTL indexes
 *    - Source of truth for cache state
 *
 * ## Stale-While-Revalidate Pattern
 *
 * Each cache entry has TWO expiration times:
 * - `expiresAt`: When data is considered "fresh" (main TTL)
 * - `staleExpiresAt`: When data is completely unusable (stale TTL, typically 2x main TTL)
 *
 * Cache lookup behavior:
 * - **Fresh data** (now < expiresAt): Return immediately
 * - **Stale data** (expiresAt < now < staleExpiresAt): Return stale data AND trigger background refresh
 * - **Expired data** (now > staleExpiresAt): Cache miss, must fetch new data
 *
 * ## Refresh Pattern (vs Invalidation)
 *
 * Instead of delete-then-warm pattern which leaves a gap:
 * ```
 * OLD: delete(key) -> cache miss window -> warm(key)
 * ```
 *
 * We use refresh-in-place pattern:
 * ```
 * NEW: refreshCache(key, warmer) -> old data served until new data ready
 * ```
 *
 * ## Stampede Prevention
 *
 * - `inFlightRefreshes` Set tracks keys currently being refreshed
 * - If refresh already in progress, new requests wait or get stale data
 * - Only ONE refresh executes at a time per key
 *
 * ## Cache Key Priorities
 *
 * Hot paths that benefit from in-memory caching:
 * - `home:*` - Home page, most frequently accessed
 * - `progress:raid:*` - Raid progress pages
 * - `guilds:list` - Guild directory
 * - `guilds:raid:*` - Guild lists by raid
 */
class CacheService {
  private warmers: Map<string, CacheWarmer> = new Map();
  private isInitialized: boolean = false;

  // ============================================================================
  // IN-MEMORY CACHE (L1)
  // ============================================================================

  /**
   * In-memory cache using Map for O(1) lookups
   * Stores frequently accessed keys to avoid MongoDB round-trips
   */
  private memoryCache: Map<string, MemoryCacheEntry> = new Map();

  /**
   * Maximum number of entries in memory cache
   * Prevents unbounded memory growth
   */
  private readonly MAX_MEMORY_ENTRIES = 100;

  /**
   * Keys that should be prioritized for in-memory caching
   * These patterns are checked first and less likely to be evicted
   */
  private readonly HOT_PATH_PATTERNS = [
    /^home:/,
    /^progress:raid:/,
    /^compare:raid:/,
    /^guilds:list$/,
    /^guilds:raid:/,
    /^guilds:schedules$/,
    /^guilds:raiding-today:/,
    /^guilds:live-streamers$/,
    /^guilds:horse-race-uma-reservations$/,
    /^events:/,
    /^characters:profile:/,
    /^raids:list$/,
    /^raid:\d+:dates$/,
    /^raid:\d+:bosses$/,
    /^ccg:analytics:/,
  ];

  // ============================================================================
  // STALE-WHILE-REVALIDATE TRACKING
  // ============================================================================

  /**
   * Set of keys currently being refreshed
   * Prevents stampede - only one refresh per key at a time
   */
  private inFlightRefreshes: Set<string> = new Set();

  /**
   * Multiplier for stale TTL relative to main TTL
   * staleExpiresAt = expiresAt + (TTL * STALE_MULTIPLIER)
   *
   * With multiplier of 1.0, stale data is valid for 2x the main TTL
   * Example: 5min TTL -> fresh for 5min, stale-but-usable for 5-10min
   */
  private readonly STALE_TTL_MULTIPLIER = 1.0;
  private readonly HOME_CACHE_STALE_EXTENSION_MS = 60 * 60 * 1000; // 1 hour safety net for the bundled home payload

  // ============================================================================
  // TTL CONSTANTS (milliseconds)
  // ============================================================================

  // Static data - rarely changes, long TTL (invalidated by backend triggers)
  public readonly STATIC_TTL = 24 * 60 * 60 * 1000; // 24 hours
  public readonly TIER_LIST_TTL = 24 * 60 * 60 * 1000; // 24 hours (recalculated nightly)
  public readonly CHARACTER_TIER_LIST_TTL = 24 * 60 * 60 * 1000; // 24 hours (rebuilt after character mechanics)
  public readonly RAID_ANALYTICS_TTL = 24 * 60 * 60 * 1000; // 24 hours (recalculated nightly)
  public readonly OLDER_RAID_TTL = 24 * 60 * 60 * 1000; // 24 hours for historical raids

  // Semi-static data - changes occasionally, 24h TTL (invalidated by triggers)
  public readonly SCHEDULES_TTL = 24 * 60 * 60 * 1000; // 24 hours (invalidated on schedule update or nightly)
  public readonly RAIDING_TODAY_TTL = 15 * 60 * 1000; // 15 minutes (date-aware key, refreshed for home page strip)

  // Guild directory/profile payloads include live state, so keep these close to the Twitch/live-log polling cadence.
  public readonly GUILD_LIST_TTL = 15 * 60 * 1000; // 15 minutes
  public readonly GUILD_SUMMARY_TTL = 15 * 60 * 1000; // 15 minutes

  // Dynamic data - changes frequently, short TTL
  public readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
  public readonly CURRENT_RAID_TTL = 5 * 60 * 1000; // 5 minutes for current raid
  public readonly LIVE_STREAMERS_TTL = 60 * 1000; // 1 minute
  public readonly EVENTS_TTL = 60 * 1000; // 1 minute
  public readonly CHARACTER_PROFILE_TTL = 5 * 60 * 1000; // 5 minutes
  public readonly PICKEM_LEADERBOARD_TTL = 5 * 60 * 1000;
  public readonly PICKEM_RANKINGS_TTL = 5 * 60 * 1000;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the cache service.
   * Should be called after MongoDB connection is established.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug("Cache service already initialized");
      return;
    }

    try {
      await this.migrateStaleExpirationIndex();

      // Ensure indexes are created (TTL index is critical)
      await Cache.createIndexes();
      this.isInitialized = true;
      logger.info("MongoDB cache service initialized with TTL indexes and in-memory L1 cache");
    } catch (error) {
      logger.error("Failed to initialize cache service:", error);
      throw error;
    }
  }

  private async migrateStaleExpirationIndex(): Promise<void> {
    const collection = Cache.collection;

    try {
      // Existing deployments may have documents written before staleExpiresAt
      // was the TTL field. Give those entries the same stale window new writes use.
      await collection.updateMany(
        { staleExpiresAt: { $exists: false }, expiresAt: { $exists: true }, ttlMs: { $exists: true } },
        [
          {
            $set: {
              staleExpiresAt: {
                $toDate: {
                  $add: [{ $toLong: "$expiresAt" }, "$ttlMs"],
                },
              },
            },
          },
        ],
      );

      const indexes = await collection.indexes();
      const oldExpiresAtTtlIndex = indexes.find(
        (index) => index.expireAfterSeconds === 0 && Object.keys(index.key ?? {}).length === 1 && index.key?.expiresAt === 1,
      );

      if (oldExpiresAtTtlIndex?.name) {
        await collection.dropIndex(oldExpiresAtTtlIndex.name);
        logger.info(`[Cache] Dropped old expiresAt TTL index: ${oldExpiresAtTtlIndex.name}`);
      }
    } catch (error) {
      logger.warn("[Cache] Failed to migrate stale expiration index:", error);
    }
  }

  // ============================================================================
  // IN-MEMORY CACHE OPERATIONS
  // ============================================================================

  /**
   * Check if a key matches hot path patterns (should be prioritized in memory)
   */
  private isHotPath(key: string): boolean {
    return this.HOT_PATH_PATTERNS.some((pattern) => pattern.test(key));
  }

  /**
   * Get entry from in-memory cache
   * Updates access tracking for LRU
   */
  private getFromMemory(key: string): MemoryCacheEntry | null {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return null;
    }

    // Update access tracking
    entry.lastAccessed = new Date();
    entry.accessCount++;

    return entry;
  }

  /**
   * Set entry in in-memory cache
   * Handles LRU eviction if cache is full
   */
  private setInMemory(key: string, data: any, expiresAt: Date, staleExpiresAt: Date, cachedAt: Date = new Date()): void {
    // Evict if necessary before adding new entry
    if (!this.memoryCache.has(key) && this.memoryCache.size >= this.MAX_MEMORY_ENTRIES) {
      this.evictLRU();
    }

    this.memoryCache.set(key, {
      data,
      cachedAt,
      expiresAt,
      staleExpiresAt,
      lastAccessed: new Date(),
      accessCount: 1,
    });
  }

  /**
   * Evict least recently used entry from memory cache
   * Prioritizes keeping hot paths in cache
   */
  private evictLRU(): void {
    let oldestNonHotKey: string | null = null;
    let oldestNonHotTime: Date | null = null;
    let oldestHotKey: string | null = null;
    let oldestHotTime: Date | null = null;

    // Find oldest entry, preferring to evict non-hot paths
    for (const [key, entry] of this.memoryCache.entries()) {
      const isHot = this.isHotPath(key);

      if (isHot) {
        if (!oldestHotTime || entry.lastAccessed < oldestHotTime) {
          oldestHotKey = key;
          oldestHotTime = entry.lastAccessed;
        }
      } else {
        if (!oldestNonHotTime || entry.lastAccessed < oldestNonHotTime) {
          oldestNonHotKey = key;
          oldestNonHotTime = entry.lastAccessed;
        }
      }
    }

    // Prefer evicting non-hot paths
    const keyToEvict = oldestNonHotKey || oldestHotKey;
    if (keyToEvict) {
      this.memoryCache.delete(keyToEvict);
      logger.debug(`[Memory Cache] Evicted LRU entry: ${keyToEvict}`);
    }
  }

  /**
   * Remove entry from in-memory cache
   */
  private removeFromMemory(key: string): void {
    this.memoryCache.delete(key);
  }

  /**
   * Remove entries matching pattern from in-memory cache
   */
  private removeFromMemoryByPattern(pattern: RegExp): number {
    let removed = 0;
    for (const key of this.memoryCache.keys()) {
      if (pattern.test(key)) {
        this.memoryCache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear entire in-memory cache
   */
  private clearMemoryCache(): void {
    const size = this.memoryCache.size;
    this.memoryCache.clear();
    logger.debug(`[Memory Cache] Cleared ${size} entries`);
  }

  // ============================================================================
  // CORE CACHE OPERATIONS WITH STALE-WHILE-REVALIDATE
  // ============================================================================

  /**
   * Get cached data with stale-while-revalidate support.
   *
   * Lookup order:
   * 1. Check in-memory cache (L1)
   * 2. Check MongoDB cache (L2)
   *
   * For each level:
   * - If fresh: return immediately
   * - If stale but within stale TTL: return stale data AND trigger background refresh
   * - If expired: continue to next level or return null
   *
   * NEVER returns null if we have stale data within stale TTL.
   */
  async get<T>(key: string): Promise<T | null> {
    const now = new Date();

    // ========================================
    // L1: Check in-memory cache first
    // ========================================
    const memoryEntry = this.getFromMemory(key);
    if (memoryEntry) {
      // Check if data is fresh
      if (now < memoryEntry.expiresAt) {
        logger.debug(`[L1 Cache] Fresh hit for key: ${key}`);
        return memoryEntry.data as T;
      }

      // Check if data is stale but still usable
      if (now < memoryEntry.staleExpiresAt) {
        logger.debug(`[L1 Cache] Stale hit for key: ${key} - triggering background refresh`);
        // Trigger background refresh (non-blocking)
        this.triggerBackgroundRefresh(key);
        return memoryEntry.data as T;
      }

      // Data is completely expired, remove from memory
      this.removeFromMemory(key);
      logger.debug(`[L1 Cache] Expired, removed key: ${key}`);
    }

    // ========================================
    // L2: Check MongoDB cache
    // ========================================
    try {
      const entry = (await Cache.findOne({ key }).lean()) as MongoCacheEntry | null;

      if (!entry) {
        logger.debug(`[L2 Cache] Miss for key: ${key}`);
        return null;
      }

      const expiresAt = new Date(entry.expiresAt);
      const staleExpiresAt = this.getEffectiveStaleExpiresAt(key, expiresAt, entry.staleExpiresAt ? new Date(entry.staleExpiresAt) : undefined, entry.ttlMs);

      // Check if data is fresh
      if (now < expiresAt) {
        logger.debug(`[L2 Cache] Fresh hit for key: ${key}`);
        // Promote to L1 cache if it's a hot path
        if (this.isHotPath(key)) {
          this.setInMemory(key, entry.data, expiresAt, staleExpiresAt, new Date(entry.cachedAt));
        }
        return entry.data as T;
      }

      // Check if data is stale but still usable
      if (now < staleExpiresAt) {
        logger.debug(`[L2 Cache] Stale hit for key: ${key} - triggering background refresh`);
        // Promote to L1 cache even if stale (we'll serve it while refreshing)
        if (this.isHotPath(key)) {
          this.setInMemory(key, entry.data, expiresAt, staleExpiresAt, new Date(entry.cachedAt));
        }
        // Trigger background refresh (non-blocking)
        this.triggerBackgroundRefresh(key);
        return entry.data as T;
      }

      // Data is completely expired
      logger.debug(`[L2 Cache] Expired for key: ${key}`);
      return null;
    } catch (error) {
      logger.error(`[L2 Cache] Get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Get cached data with metadata for HTTP cache headers.
   *
   * Returns the cached data along with TTL and expiration info needed for
   * calculating Cache-Control headers and ETags.
   *
   * Uses same lookup logic as get() with stale-while-revalidate support.
   */
  async getWithMetadata<T>(key: string): Promise<{ data: T; expiresAt: Date; staleExpiresAt: Date; ttlMs: number; cachedAt: Date } | null> {
    const now = new Date();

    // ========================================
    // L1: Check in-memory cache first
    // ========================================
    const memoryEntry = this.getFromMemory(key);
    if (memoryEntry) {
      // Check if data is fresh
      if (now < memoryEntry.expiresAt) {
        logger.debug(`[L1 Cache] Fresh hit with metadata for key: ${key}`);
        const ttlMs = memoryEntry.expiresAt.getTime() - memoryEntry.cachedAt.getTime();
        return {
          data: memoryEntry.data as T,
          expiresAt: memoryEntry.expiresAt,
          staleExpiresAt: memoryEntry.staleExpiresAt,
          ttlMs,
          cachedAt: memoryEntry.cachedAt,
        };
      }

      // Check if data is stale but still usable
      if (now < memoryEntry.staleExpiresAt) {
        logger.debug(`[L1 Cache] Stale hit with metadata for key: ${key} - triggering background refresh`);
        this.triggerBackgroundRefresh(key);
        const ttlMs = memoryEntry.expiresAt.getTime() - memoryEntry.cachedAt.getTime();
        return {
          data: memoryEntry.data as T,
          expiresAt: memoryEntry.expiresAt,
          staleExpiresAt: memoryEntry.staleExpiresAt,
          ttlMs,
          cachedAt: memoryEntry.cachedAt,
        };
      }

      // Data is completely expired, remove from memory
      this.removeFromMemory(key);
      logger.debug(`[L1 Cache] Expired, removed key: ${key}`);
    }

    // ========================================
    // L2: Check MongoDB cache
    // ========================================
    try {
      const entry = (await Cache.findOne({ key }).lean()) as MongoCacheEntry | null;

      if (!entry) {
        logger.debug(`[L2 Cache] Miss with metadata for key: ${key}`);
        return null;
      }

      const expiresAt = new Date(entry.expiresAt);
      const staleExpiresAt = this.getEffectiveStaleExpiresAt(key, expiresAt, entry.staleExpiresAt ? new Date(entry.staleExpiresAt) : undefined, entry.ttlMs);

      // Check if data is fresh
      if (now < expiresAt) {
        logger.debug(`[L2 Cache] Fresh hit with metadata for key: ${key}`);
        if (this.isHotPath(key)) {
          this.setInMemory(key, entry.data, expiresAt, staleExpiresAt, new Date(entry.cachedAt));
        }
        return {
          data: entry.data as T,
          expiresAt,
          staleExpiresAt,
          ttlMs: entry.ttlMs,
          cachedAt: new Date(entry.cachedAt),
        };
      }

      // Check if data is stale but still usable
      if (now < staleExpiresAt) {
        logger.debug(`[L2 Cache] Stale hit with metadata for key: ${key} - triggering background refresh`);
        if (this.isHotPath(key)) {
          this.setInMemory(key, entry.data, expiresAt, staleExpiresAt, new Date(entry.cachedAt));
        }
        this.triggerBackgroundRefresh(key);
        return {
          data: entry.data as T,
          expiresAt,
          staleExpiresAt,
          ttlMs: entry.ttlMs,
          cachedAt: new Date(entry.cachedAt),
        };
      }

      // Data is completely expired
      logger.debug(`[L2 Cache] Expired with metadata for key: ${key}`);
      return null;
    } catch (error) {
      logger.error(`[L2 Cache] Get with metadata error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set data in cache with stale-while-revalidate TTLs.
   *
   * Sets data in both L1 (if hot path) and L2 (MongoDB).
   * Calculates both fresh TTL and stale TTL.
   */
  async set<T>(key: string, data: T, customTtl?: number): Promise<void> {
    try {
      const ttl = customTtl ?? this.DEFAULT_TTL;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttl);
      const staleExpiresAt = new Date(expiresAt.getTime() + this.getStaleExtensionMs(key, ttl));
      const endpoint = this.extractEndpoint(key);

      // ========================================
      // L1: Set in memory if hot path
      // ========================================
      if (this.isHotPath(key)) {
        this.setInMemory(key, data, expiresAt, staleExpiresAt, now);
        logger.debug(`[L1 Cache] Set for key: ${key}`);
      }

      // ========================================
      // L2: Set in MongoDB
      // ========================================
      // Check approximate JSON size to avoid BSON 16MB document limit.
      // JSON.stringify is used only for the size check; MongoDB serializes
      // via BSON which is slightly larger, so we use a conservative 14MB cap.
      const jsonSize = Buffer.byteLength(JSON.stringify(data), "utf8");
      if (jsonSize > 14 * 1024 * 1024) {
        logger.warn(`[L2 Cache] Skipping MongoDB write for key ${key}: data too large (${Math.round(jsonSize / 1024 / 1024)}MB exceeds 14MB safety limit)`);
        return;
      }

      await Cache.findOneAndUpdate(
        { key },
        {
          key,
          data,
          cachedAt: now,
          expiresAt,
          staleExpiresAt,
          ttlMs: ttl,
          endpoint,
        },
        { upsert: true, new: true },
      );

      logger.debug(`[L2 Cache] Set for key: ${key} (fresh: ${Math.round(ttl / 1000)}s, stale: ${Math.round((ttl + this.getStaleExtensionMs(key, ttl)) / 1000)}s)`);
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  private getStaleExtensionMs(key: string, ttl: number): number {
    if (key === "home:data") {
      return Math.max(ttl * this.STALE_TTL_MULTIPLIER, this.HOME_CACHE_STALE_EXTENSION_MS);
    }

    return ttl * this.STALE_TTL_MULTIPLIER;
  }

  private getEffectiveStaleExpiresAt(key: string, expiresAt: Date, storedStaleExpiresAt: Date | undefined, ttl: number): Date {
    const maxStaleExpiresAt = new Date(expiresAt.getTime() + this.getStaleExtensionMs(key, ttl));

    if (!storedStaleExpiresAt || storedStaleExpiresAt > maxStaleExpiresAt) {
      return maxStaleExpiresAt;
    }

    return storedStaleExpiresAt;
  }

  /**
   * Extract endpoint category from cache key for grouping.
   */
  private extractEndpoint(key: string): string {
    // Extract first two segments as endpoint identifier
    const parts = key.split(":");
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}`;
    }
    return parts[0];
  }

  // ============================================================================
  // BACKGROUND REFRESH & STAMPEDE PREVENTION
  // ============================================================================

  /**
   * Trigger a background refresh for a stale cache key.
   *
   * This is non-blocking - the caller gets stale data immediately while
   * we refresh in the background. Uses in-flight tracking to prevent stampede.
   */
  private triggerBackgroundRefresh(key: string): void {
    // Check if refresh is already in progress
    if (this.inFlightRefreshes.has(key)) {
      logger.debug(`[Refresh] Already in progress for key: ${key}`);
      return;
    }

    // Check if we have a warmer for this key
    const warmer = this.warmers.get(key);
    if (!warmer) {
      logger.debug(`[Refresh] No warmer registered for key: ${key}`);
      return;
    }

    // Mark as in-flight and start refresh
    this.inFlightRefreshes.add(key);
    logger.debug(`[Refresh] Starting background refresh for key: ${key}`);

    // Execute refresh in background (don't await)
    this.executeRefresh(key, warmer)
      .catch((error) => {
        logger.error(`[Refresh] Background refresh failed for key ${key}:`, error);
      })
      .finally(() => {
        this.inFlightRefreshes.delete(key);
        logger.debug(`[Refresh] Completed for key: ${key}`);
      });
  }

  /**
   * Execute the actual refresh operation.
   */
  private async executeRefresh(key: string, warmer: CacheWarmer): Promise<void> {
    const data = await warmer();
    const ttl = this.inferTTLFromKey(key);
    await this.set(key, data, ttl);
    logger.info(`[Refresh] Cache refreshed for key: ${key}`);
  }

  /**
   * Refresh cache in place - fetches new data and updates cache atomically.
   *
   * Unlike invalidate-then-warm, this keeps old data available until new data is ready.
   * Returns true if refresh succeeded, false otherwise.
   *
   * @param key - Cache key to refresh
   * @param warmer - Function that generates new cache data
   * @param forceRefresh - If true, ignores in-flight check and forces refresh
   */
  async refreshCache(key: string, warmer: CacheWarmer, forceRefresh: boolean = false): Promise<boolean> {
    // Check if refresh is already in progress (unless forced)
    if (!forceRefresh && this.inFlightRefreshes.has(key)) {
      logger.debug(`[Refresh] Debounced - already in progress for key: ${key}`);
      return false;
    }

    this.inFlightRefreshes.add(key);

    try {
      const data = await warmer();
      const ttl = this.inferTTLFromKey(key);
      await this.set(key, data, ttl);
      logger.info(`[Refresh] Cache refreshed in place for key: ${key}`);
      return true;
    } catch (error) {
      logger.error(`[Refresh] Failed to refresh cache for key ${key}:`, error);
      return false;
    } finally {
      this.inFlightRefreshes.delete(key);
    }
  }

  /**
   * Check if a key is currently being refreshed.
   */
  isRefreshing(key: string): boolean {
    return this.inFlightRefreshes.has(key);
  }

  // ============================================================================
  // LEGACY INVALIDATION (kept for backward compatibility, but prefers refresh)
  // ============================================================================

  /**
   * Invalidate (delete) a specific cache entry from both L1 and L2.
   *
   * NOTE: Prefer using refreshCache() instead to avoid cache miss windows.
   * This is kept for cases where you truly want to delete without replacement.
   */
  async invalidate(key: string): Promise<void> {
    try {
      // Remove from L1
      this.removeFromMemory(key);

      // Remove from L2
      const result = await Cache.deleteOne({ key });
      if (result.deletedCount > 0) {
        logger.info(`Cache invalidated for key: ${key}`);
      }
    } catch (error) {
      logger.error(`Cache invalidate error for key ${key}:`, error);
    }
  }

  /**
   * Invalidate all cache entries matching a pattern (regex) from both L1 and L2.
   *
   * NOTE: Prefer using refreshCachePattern() for batch refreshes.
   */
  async invalidatePattern(pattern: RegExp): Promise<void> {
    try {
      // Remove from L1
      const memoryRemoved = this.removeFromMemoryByPattern(pattern);

      // Remove from L2
      const result = await Cache.deleteMany({ key: { $regex: pattern } });
      if (result.deletedCount > 0 || memoryRemoved > 0) {
        logger.info(`Cache invalidated ${result.deletedCount} L2 + ${memoryRemoved} L1 entries matching pattern: ${pattern}`);
      }
    } catch (error) {
      logger.error(`Cache invalidatePattern error for ${pattern}:`, error);
    }
  }

  /**
   * Clear all cache entries from both L1 and L2.
   */
  async clear(): Promise<void> {
    try {
      // Clear L1
      this.clearMemoryCache();

      // Clear L2
      const result = await Cache.deleteMany({});
      logger.info(`Cache cleared: ${result.deletedCount} L2 entries removed`);
    } catch (error) {
      logger.error("Cache clear error:", error);
    }
  }

  // ============================================================================
  // CACHE KEY GENERATORS
  // ============================================================================

  /**
   * Get cache key for home page.
   */
  getHomeKey(): string {
    return "home:data";
  }

  /**
   * Get cache key for tracked raids list.
   */
  getRaidsKey(): string {
    return "raids:list";
  }

  /**
   * Get cache key for progress page by raid.
   */
  getProgressKey(raidId: number): string {
    return `progress:raid:${raidId}`;
  }

  /**
   * Get cache key for compare page by raid.
   */
  getCompareKey(raidId: number): string {
    return `compare:raid:${raidId}`;
  }

  /**
   * Get cache key for guilds list by raid.
   */
  getGuildsKey(raidId: number): string {
    return `guilds:raid:${raidId}`;
  }

  /**
   * Get cache key for minimal guild list (directory page).
   */
  getGuildListKey(): string {
    return "guilds:list";
  }

  /**
   * Get cache key for guild schedules.
   */
  getSchedulesKey(): string {
    return "guilds:schedules";
  }

  /**
   * Get cache key for guilds raiding today.
   */
  getRaidingTodayKey(dateKey: string): string {
    return `guilds:raiding-today:${dateKey}`;
  }

  /**
   * Get cache key for live streamers.
   */
  getLiveStreamersKey(): string {
    return "guilds:live-streamers";
  }

  /**
   * Get cache key for individual guild summary.
   */
  getGuildSummaryKey(realm: string, name: string): string {
    return `guild:${realm.toLowerCase()}:${name.toLowerCase()}:summary`;
  }

  /**
   * Get cache key for guild boss progress.
   */
  getBossProgressKey(realm: string, name: string, raidId: number): string {
    return `guild:${realm.toLowerCase()}:${name.toLowerCase()}:raid:${raidId}:bosses`;
  }

  /**
   * Get cache key for events.
   */
  getEventsKey(limit: number): string {
    return `events:limit:${limit}`;
  }

  /**
   * Get cache key for events with pagination and filters.
   */
  getEventsPaginatedKey(limit: number, page: number, types: string = "", difficulties: string = "", guildName: string = ""): string {
    return `events:limit:${limit}:page:${page}:types:${types}:diff:${difficulties}:guild:${guildName}`;
  }

  /**
   * Get cache key for guild-specific events.
   */
  getGuildEventsKey(realm: string, name: string, limit: number, page: number): string {
    return `events:guild:${realm.toLowerCase()}:${name.toLowerCase()}:limit:${limit}:page:${page}`;
  }

  /**
   * Get cache key for character profile lookups.
   */
  getCharacterProfileKey(realm: string, name: string, classId?: number): string {
    const classKey = Number.isFinite(classId) ? String(classId) : "any";
    return `characters:profile:v3:${realm.toLowerCase()}:${name.toLowerCase()}:class:${classKey}`;
  }

  /**
   * Get cache key for raid dates.
   */
  getRaidDatesKey(raidId: number): string {
    return `raid:${raidId}:dates`;
  }

  /**
   * Get cache key for raid bosses.
   */
  getRaidBossesKey(raidId: number): string {
    return `raid:${raidId}:bosses`;
  }

  /**
   * Get cache key for horse race Uma image reservations.
   */
  getHorseRaceUmaReservationsKey(): string {
    return "guilds:horse-race-uma-reservations";
  }

  /**
   * Get cache key for tier list (full).
   */
  getTierListFullKey(): string {
    return "tierlists:full";
  }

  /**
   * Get cache key for overall tier list.
   */
  getTierListOverallKey(): string {
    return "tierlists:overall";
  }

  /**
   * Get cache key for tier list by raid.
   */
  getTierListRaidKey(raidId: number): string {
    return `tierlists:raid:${raidId}`;
  }

  /**
   * Get cache key for tier list available raids.
   */
  getTierListRaidsKey(): string {
    return "tierlists:raids";
  }

  private formatCharacterTierListFilterSegment(filters: { minReports?: number; role?: string | null; classId?: number | null; limit?: number | null }): string {
    const minReports = Number.isFinite(filters.minReports) ? filters.minReports : "default";
    const role = filters.role || "all";
    const classId = Number.isFinite(filters.classId) ? filters.classId : "all";
    const limit = filters.limit === null ? "all" : Number.isFinite(filters.limit) ? filters.limit : "default";
    return `reports:${minReports}:role:${role}:class:${classId}:limit:${limit}`;
  }

  getCharacterTierListRaidsKey(): string {
    return "character-tierlists:v6:raids";
  }

  getCharacterTierListGlobalKey(raidId: number, filters: { minReports?: number; role?: string | null; classId?: number | null; limit?: number | null }): string {
    return `character-tierlists:v6:global:${raidId}:${this.formatCharacterTierListFilterSegment(filters)}`;
  }

  getCharacterTierListGuildKey(realm: string, name: string, raidId: number, filters: { minReports?: number; role?: string | null; classId?: number | null; limit?: number | null }): string {
    return `character-tierlists:v6:guild:${realm.toLowerCase()}:${name.toLowerCase()}:${raidId}:${this.formatCharacterTierListFilterSegment(filters)}`;
  }

  /**
   * Get cache key for raid analytics all overview.
   */
  getRaidAnalyticsAllKey(): string {
    return "raid-analytics:all";
  }

  /**
   * Get cache key for raid analytics boss progression comparison.
   */
  getRaidAnalyticsBossProgressionKey(): string {
    return "raid-analytics:boss-progression";
  }

  /**
   * Get cache key for specific raid analytics.
   */
  getRaidAnalyticsKey(raidId: number): string {
    return `raid-analytics:${raidId}`;
  }

  /**
   * Get cache key for raid analytics available raids.
   */
  getRaidAnalyticsRaidsKey(): string {
    return "raid-analytics:raids";
  }

  /**
   * Get cache key for pickem leaderboard.
   */
  getPickemLeaderboardKey(pickemId: string): string {
    return `pickems:leaderboard:${pickemId}`;
  }

  /**
   * Get cache key for pickem guild rankings.
   */
  getPickemRankingsKey(pickemId: string): string {
    return `pickems:rankings:${pickemId}`;
  }

  getCharacterRankingsOptionsKey(): string {
    return "character-rankings:options:v2";
  }

  // ============================================================================
  // TTL GETTERS
  // ============================================================================

  /**
   * Get TTL for a specific raid (current vs older).
   */
  getTTLForRaid(raidId: number | null): number {
    if (!raidId) {
      return this.DEFAULT_TTL;
    }
    const isCurrentRaid = CURRENT_RAID_IDS.includes(raidId);
    return isCurrentRaid ? this.CURRENT_RAID_TTL : this.OLDER_RAID_TTL;
  }

  /**
   * Get TTL for events.
   */
  getEventsTTL(): number {
    return this.EVENTS_TTL;
  }

  /**
   * Get TTL for tier lists.
   */
  getTierListTTL(): number {
    return this.TIER_LIST_TTL;
  }

  /**
   * Get TTL for character tier lists.
   */
  getCharacterTierListTTL(): number {
    return this.CHARACTER_TIER_LIST_TTL;
  }

  /**
   * Get TTL for raid analytics.
   */
  getRaidAnalyticsTTL(): number {
    return this.RAID_ANALYTICS_TTL;
  }

  // ============================================================================
  // CACHE REFRESH METHODS (NEW PATTERN - REPLACES INVALIDATION)
  // ============================================================================

  /**
   * Refresh ALL guild-related caches using registered warmers.
   *
   * Unlike invalidateAllGuildCaches(), this updates data in place.
   * Old data remains available until new data is ready.
   *
   * ⚠️ USE SPARINGLY - This refreshes many caches and should only be called when:
   * - A NEW guild is added and its data is fetched (new guild appears in all lists)
   * - Major data restructuring occurs
   */
  async refreshAllGuildCaches(): Promise<void> {
    logger.info("[Refresh] Starting full guild cache refresh...");

    // Refresh home data if warmer exists
    const homeKey = this.getHomeKey();
    if (this.warmers.has(homeKey)) {
      await this.refreshCache(homeKey, this.warmers.get(homeKey)!);
    }

    // Refresh guild list if warmer exists
    const guildListKey = this.getGuildListKey();
    if (this.warmers.has(guildListKey)) {
      await this.refreshCache(guildListKey, this.warmers.get(guildListKey)!);
    }

    const schedulesKey = this.getSchedulesKey();
    if (this.warmers.has(schedulesKey)) {
      await this.refreshCache(schedulesKey, this.warmers.get(schedulesKey)!);
    }

    const liveStreamersKey = this.getLiveStreamersKey();
    if (this.warmers.has(liveStreamersKey)) {
      await this.refreshCache(liveStreamersKey, this.warmers.get(liveStreamersKey)!);
    }

    const umaReservationsKey = this.getHorseRaceUmaReservationsKey();
    if (this.warmers.has(umaReservationsKey)) {
      await this.refreshCache(umaReservationsKey, this.warmers.get(umaReservationsKey)!);
    }

    // Refresh progress for all tracked raids
    for (const raidId of TRACKED_RAIDS) {
      const progressKey = this.getProgressKey(raidId);
      if (this.warmers.has(progressKey)) {
        await this.refreshCache(progressKey, this.warmers.get(progressKey)!);
      }

      const guildsKey = this.getGuildsKey(raidId);
      if (this.warmers.has(guildsKey)) {
        await this.refreshCache(guildsKey, this.warmers.get(guildsKey)!);
      }

      const compareKey = this.getCompareKey(raidId);
      if (this.warmers.has(compareKey)) {
        await this.refreshCache(compareKey, this.warmers.get(compareKey)!);
      }
    }

    logger.info("[Refresh] Full guild cache refresh complete");
  }

  /**
   * Refresh caches for current raid only.
   *
   * ✅ USE THIS for regular guild updates (hot/off hours).
   * Updates data in place - old data served until new is ready.
   */
  async refreshCurrentRaidCaches(): Promise<void> {
    logger.info("[Refresh] Starting current raid cache refresh...");

    // Refresh home data
    const homeKey = this.getHomeKey();
    if (this.warmers.has(homeKey)) {
      await this.refreshCache(homeKey, this.warmers.get(homeKey)!);
    }

    // Refresh current raid progress
    for (const raidId of CURRENT_RAID_IDS) {
      const progressKey = this.getProgressKey(raidId);
      if (this.warmers.has(progressKey)) {
        await this.refreshCache(progressKey, this.warmers.get(progressKey)!);
      }

      const guildsKey = this.getGuildsKey(raidId);
      if (this.warmers.has(guildsKey)) {
        await this.refreshCache(guildsKey, this.warmers.get(guildsKey)!);
      }

      const compareKey = this.getCompareKey(raidId);
      if (this.warmers.has(compareKey)) {
        await this.refreshCache(compareKey, this.warmers.get(compareKey)!);
      }
    }

    // Refresh live streamers
    const streamersKey = this.getLiveStreamersKey();
    if (this.warmers.has(streamersKey)) {
      await this.refreshCache(streamersKey, this.warmers.get(streamersKey)!);
    }

    logger.info("[Refresh] Current raid cache refresh complete");
  }

  // ============================================================================
  // CACHE INVALIDATION METHODS (LEGACY - USE REFRESH METHODS WHEN POSSIBLE)
  // ============================================================================

  /**
   * Invalidate ALL guild-related caches including older raid progress.
   *
   * ⚠️ DEPRECATED: Prefer refreshAllGuildCaches() to avoid cache miss windows.
   *
   * This invalidates:
   * - guilds:* (guild list, schedules, live streamers)
   * - home:* (home page data)
   * - guild:* (individual guild summaries)
   * - progress:* (ALL raid progress including older raids)
   */
  async invalidateAllGuildCaches(): Promise<void> {
    await this.refreshAllGuildCaches();
    await this.invalidatePattern(/^guild:/);
    logger.info("All guild-related list/progress caches refreshed; guild-specific caches invalidated");
  }

  /**
   * @deprecated Use refreshCurrentRaidCaches() for regular updates or refreshAllGuildCaches() for new guilds
   */
  async invalidateGuildCaches(): Promise<void> {
    // Redirect to the more targeted method for backward compatibility
    await this.invalidateCurrentRaidCaches();
  }

  /**
   * Invalidate caches for current raid only.
   *
   * ⚠️ DEPRECATED: Prefer refreshCurrentRaidCaches() to avoid cache miss windows.
   */
  async invalidateCurrentRaidCaches(): Promise<void> {
    await this.refreshCurrentRaidCaches();
    logger.info("Current raid caches refreshed in place");
  }

  /**
   * Invalidate caches for a specific raid.
   * Called after raid-specific updates.
   */
  async invalidateRaidCaches(raidId: number): Promise<void> {
    await this.invalidate(this.getProgressKey(raidId));
    await this.invalidate(this.getGuildsKey(raidId));
    await this.invalidatePattern(new RegExp(`raid:${raidId}`));

    // If it's a current raid, also invalidate home cache
    if (CURRENT_RAID_IDS.includes(raidId)) {
      await this.invalidate(this.getHomeKey());
    }

    logger.info(`Raid-specific caches invalidated for raid ${raidId}`);
  }

  /**
   * Invalidate event caches.
   * Called after new events are created.
   */
  async invalidateEventCaches(): Promise<void> {
    await this.invalidatePattern(/^events:/);
    await this.invalidatePattern(/^home:/); // Home page includes events
    logger.info("Event caches invalidated");
  }

  /**
   * Invalidate all tier list caches.
   * Called after tier list recalculation.
   */
  async invalidateTierListCaches(): Promise<void> {
    await this.invalidatePattern(/^tierlists:/);
    logger.info("Tier list caches invalidated");
  }

  /**
   * Invalidate all character tier list caches.
   * Called after character tier list entries are rebuilt.
   */
  async invalidateCharacterTierListCaches(): Promise<void> {
    await this.invalidatePattern(/^character-tierlists:/);
    logger.info("Character tier list caches invalidated");
  }

  /**
   * Invalidate all raid analytics caches.
   * Called after raid analytics recalculation.
   */
  async invalidateRaidAnalyticsCaches(): Promise<void> {
    await this.invalidatePattern(/^raid-analytics:/);
    logger.info("Raid analytics caches invalidated");
  }

  /**
   * Invalidate schedules cache.
   * Called when guild schedules are updated.
   */
  async invalidateSchedulesCaches(): Promise<void> {
    await this.invalidate(this.getSchedulesKey());
    logger.info("Schedules cache invalidated");
  }

  /**
   * Invalidate caches for a specific guild.
   * Called after individual guild update.
   */
  async invalidateGuildSpecificCaches(realm: string, name: string): Promise<void> {
    // Invalidate guild summary
    await this.invalidate(this.getGuildSummaryKey(realm, name));

    // Invalidate all boss progress caches for this guild
    await this.invalidatePattern(new RegExp(`^guild:${realm.toLowerCase()}:${name.toLowerCase()}:`));

    // Invalidate guild events
    await this.invalidatePattern(new RegExp(`^events:guild:${realm.toLowerCase()}:${name.toLowerCase()}:`));

    logger.debug(`Guild-specific caches invalidated for ${name}-${realm}`);
  }

  // ============================================================================
  // CACHE WARMING
  // ============================================================================

  /**
   * Register a cache warmer function for a specific key.
   * Warmers are called during startup and after invalidation.
   */
  registerWarmer(key: string, warmer: CacheWarmer): void {
    this.warmers.set(key, warmer);
    logger.debug(`Cache warmer registered for key: ${key}`);
  }

  /**
   * Warm a specific cache key using its registered warmer.
   */
  async warmCache(key: string): Promise<boolean> {
    const warmer = this.warmers.get(key);
    if (!warmer) {
      logger.debug(`No warmer registered for key: ${key}`);
      return false;
    }

    try {
      const data = await warmer();
      // TTL will be determined by the cache key pattern
      const ttl = this.inferTTLFromKey(key);
      await this.set(key, data, ttl);
      logger.info(`Cache warmed for key: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Failed to warm cache for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Warm all registered caches.
   * Called during server startup.
   */
  async warmAllCaches(): Promise<{ warmed: number; failed: number }> {
    logger.info(`[Cache Warm] Starting cache warm-up for ${this.warmers.size} registered warmers...`);
    let warmed = 0;
    let failed = 0;

    for (const key of this.warmers.keys()) {
      const success = await this.warmCache(key);
      if (success) {
        warmed++;
      } else {
        failed++;
      }
    }

    logger.info(`[Cache Warm] Cache warm-up complete: ${warmed} warmed, ${failed} failed`);
    return { warmed, failed };
  }

  /**
   * Warm progress caches for all tracked raids.
   * Called during startup or after major updates.
   */
  async warmProgressCaches(progressFetcher: (raidId: number) => Promise<any>): Promise<void> {
    logger.info(`[Cache Warm] Warming progress caches for ${TRACKED_RAIDS.length} raids...`);

    for (const raidId of TRACKED_RAIDS) {
      try {
        const key = this.getProgressKey(raidId);
        const data = await progressFetcher(raidId);
        const ttl = this.getTTLForRaid(raidId);
        await this.set(key, data, ttl);
        logger.debug(`[Cache Warm] Progress cache warmed for raid ${raidId}`);
      } catch (error) {
        logger.error(`[Cache Warm] Failed to warm progress cache for raid ${raidId}:`, error);
      }
    }

    logger.info(`[Cache Warm] Progress caches warmed for all raids`);
  }

  /**
   * Warm tier list caches for all raids.
   */
  async warmTierListCaches(
    fullFetcher: () => Promise<any>,
    overallFetcher: () => Promise<any>,
    raidFetcher: (raidId: number) => Promise<any>,
    raidsFetcher: () => Promise<any>,
  ): Promise<void> {
    logger.info(`[Cache Warm] Warming tier list caches...`);

    try {
      // Warm full tier list
      const fullData = await fullFetcher();
      if (fullData) {
        await this.set(this.getTierListFullKey(), fullData, this.TIER_LIST_TTL);
      }

      // Warm overall tier list
      const overallData = await overallFetcher();
      if (overallData) {
        await this.set(this.getTierListOverallKey(), overallData, this.TIER_LIST_TTL);
      }

      // Warm available raids list
      const raidsData = await raidsFetcher();
      if (raidsData) {
        await this.set(this.getTierListRaidsKey(), raidsData, this.TIER_LIST_TTL);

        // Warm per-raid tier lists
        for (const raid of raidsData) {
          try {
            const raidData = await raidFetcher(raid.raidId);
            if (raidData) {
              await this.set(this.getTierListRaidKey(raid.raidId), raidData, this.TIER_LIST_TTL);
            }
          } catch (error) {
            logger.error(`[Cache Warm] Failed to warm tier list for raid ${raid.raidId}:`, error);
          }
        }
      }

      logger.info(`[Cache Warm] Tier list caches warmed`);
    } catch (error) {
      logger.error(`[Cache Warm] Failed to warm tier list caches:`, error);
    }
  }

  /**
   * Warm raid analytics caches.
   */
  async warmRaidAnalyticsCaches(allFetcher: () => Promise<any>, raidFetcher: (raidId: number) => Promise<any>, raidsFetcher: () => Promise<any>): Promise<void> {
    logger.info(`[Cache Warm] Warming raid analytics caches...`);

    try {
      // Warm all analytics overview
      const allData = await allFetcher();
      if (allData) {
        await this.set(this.getRaidAnalyticsAllKey(), allData, this.RAID_ANALYTICS_TTL);
      }

      // Warm available raids list
      const raidsData = await raidsFetcher();
      if (raidsData) {
        await this.set(this.getRaidAnalyticsRaidsKey(), raidsData, this.RAID_ANALYTICS_TTL);

        // Warm per-raid analytics
        for (const raid of raidsData) {
          try {
            const raidData = await raidFetcher(raid.raidId);
            if (raidData) {
              await this.set(this.getRaidAnalyticsKey(raid.raidId), raidData, this.RAID_ANALYTICS_TTL);
            }
          } catch (error) {
            logger.error(`[Cache Warm] Failed to warm analytics for raid ${raid.raidId}:`, error);
          }
        }
      }

      logger.info(`[Cache Warm] Raid analytics caches warmed`);
    } catch (error) {
      logger.error(`[Cache Warm] Failed to warm raid analytics caches:`, error);
    }
  }

  /**
   * Infer TTL from cache key pattern.
   */
  private inferTTLFromKey(key: string): number {
    if (key.startsWith("tierlists:")) return this.TIER_LIST_TTL;
    if (key.startsWith("character-tierlists:")) return this.CHARACTER_TIER_LIST_TTL;
    if (key.startsWith("raid-analytics:")) return this.RAID_ANALYTICS_TTL;
    if (key.startsWith("progress:")) {
      // Extract raid ID and determine TTL
      const match = key.match(/progress:raid:(\d+)/);
      if (match) {
        const raidId = parseInt(match[1]);
        return this.getTTLForRaid(raidId);
      }
    }
    if (key.startsWith("compare:")) {
      const match = key.match(/compare:raid:(\d+)/);
      if (match) {
        const raidId = parseInt(match[1]);
        return this.getTTLForRaid(raidId);
      }
    }
    if (key.startsWith("guilds:raid:")) {
      const match = key.match(/guilds:raid:(\d+)/);
      if (match) {
        const raidId = parseInt(match[1]);
        return this.getTTLForRaid(raidId);
      }
    }
    if (key === "guilds:list") return this.GUILD_LIST_TTL;
    if (key === "guilds:schedules") return this.SCHEDULES_TTL;
    if (key.startsWith("guilds:raiding-today:")) return this.RAIDING_TODAY_TTL;
    if (key === "guilds:live-streamers") return this.LIVE_STREAMERS_TTL;
    if (key === "guilds:horse-race-uma-reservations") return this.GUILD_LIST_TTL;
    if (key.startsWith("events:")) return this.EVENTS_TTL;
    if (key.startsWith("characters:profile:")) return this.CHARACTER_PROFILE_TTL;
    if (key.startsWith("home:")) return this.CURRENT_RAID_TTL;
    if (key === "raids:list") return this.STATIC_TTL;
    if (/^raid:\d+:bosses$/.test(key)) return this.STATIC_TTL;
    if (/^raid:\d+:dates$/.test(key)) return this.STATIC_TTL;
    if (key.startsWith("guild:")) return this.GUILD_SUMMARY_TTL;

    return this.DEFAULT_TTL;
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get cache statistics including in-memory cache info.
   */
  async getStats(): Promise<{
    totalEntries: number;
    memoryEntries: number;
    inFlightRefreshes: number;
    byEndpoint: Record<string, number>;
    oldestEntry: Date | null;
    newestEntry: Date | null;
    memoryHotPaths: string[];
  }> {
    try {
      const totalEntries = await Cache.countDocuments();

      // Group by endpoint
      const endpointStats = await Cache.aggregate([{ $group: { _id: "$endpoint", count: { $sum: 1 } } }]);

      const byEndpoint: Record<string, number> = {};
      for (const stat of endpointStats) {
        byEndpoint[stat._id] = stat.count;
      }

      // Get oldest and newest entries
      const oldest = await Cache.findOne().sort({ cachedAt: 1 }).select("cachedAt").lean();
      const newest = await Cache.findOne().sort({ cachedAt: -1 }).select("cachedAt").lean();

      // Get memory cache hot paths
      const memoryHotPaths = Array.from(this.memoryCache.keys()).filter((key) => this.isHotPath(key));

      return {
        totalEntries,
        memoryEntries: this.memoryCache.size,
        inFlightRefreshes: this.inFlightRefreshes.size,
        byEndpoint,
        oldestEntry: oldest?.cachedAt || null,
        newestEntry: newest?.cachedAt || null,
        memoryHotPaths,
      };
    } catch (error) {
      logger.error("Failed to get cache stats:", error);
      return {
        totalEntries: 0,
        memoryEntries: this.memoryCache.size,
        inFlightRefreshes: this.inFlightRefreshes.size,
        byEndpoint: {},
        oldestEntry: null,
        newestEntry: null,
        memoryHotPaths: [],
      };
    }
  }

  /**
   * Get detailed memory cache statistics.
   */
  getMemoryCacheStats(): {
    size: number;
    maxSize: number;
    utilizationPercent: number;
    entries: Array<{
      key: string;
      accessCount: number;
      isHotPath: boolean;
      isFresh: boolean;
      isStale: boolean;
    }>;
  } {
    const now = new Date();
    const entries = Array.from(this.memoryCache.entries()).map(([key, entry]) => ({
      key,
      accessCount: entry.accessCount,
      isHotPath: this.isHotPath(key),
      isFresh: now < entry.expiresAt,
      isStale: now >= entry.expiresAt && now < entry.staleExpiresAt,
    }));

    // Sort by access count descending
    entries.sort((a, b) => b.accessCount - a.accessCount);

    return {
      size: this.memoryCache.size,
      maxSize: this.MAX_MEMORY_ENTRIES,
      utilizationPercent: Math.round((this.memoryCache.size / this.MAX_MEMORY_ENTRIES) * 100),
      entries,
    };
  }
}

// Export singleton instance
export default new CacheService();
