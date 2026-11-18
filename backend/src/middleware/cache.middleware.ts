import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cacheService from "../services/cache.service";

/**
 * Generate an ETag from data using a fast hash
 */
function generateETag(data: any): string {
  const hash = crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
  return `"${hash}"`;
}

/**
 * Calculate HTTP cache headers based on TTL
 * @param ttlMs - Time-to-live in milliseconds
 * @param remainingFreshMs - Remaining fresh time in milliseconds (optional, defaults to ttlMs)
 */
function getCacheHeaders(ttlMs: number, remainingFreshMs?: number): Record<string, string> {
  const maxAgeSeconds = Math.max(0, Math.floor((remainingFreshMs ?? ttlMs) / 1000));
  const staleSeconds = Math.floor(ttlMs / 1000); // Full TTL for stale-while-revalidate

  return {
    "Cache-Control": `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${staleSeconds}`,
    Vary: "Accept-Encoding",
  };
}

/**
 * Check if client's ETag matches and return 304 Not Modified if so
 */
function checkETagMatch(req: Request, res: Response, etag: string): boolean {
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

/**
 * Cache middleware factory for MongoDB-backed caching.
 *
 * Creates middleware that checks MongoDB cache before running the route handler.
 * On cache miss, intercepts the response and caches it to MongoDB.
 * Adds HTTP cache headers (Cache-Control, ETag) to responses.
 *
 * Note: All cache operations are async since they hit MongoDB.
 */
export function cacheMiddleware<P extends Request["params"] = Record<string, string>>(getKey: (req: Request<P>) => string, getTTL?: (req: Request<P>) => number) {
  return async (req: Request<P>, res: Response, next: NextFunction) => {
    try {
      // Generate cache key for this request
      const cacheKey = getKey(req);

      // Try to get cached data from MongoDB (async operation)
      let cacheEntry = await cacheService.getWithMetadata(cacheKey);
      const ttl = getTTL ? getTTL(req) : cacheService.DEFAULT_TTL;

      // If code lowered a route TTL, do not keep serving entries written with the old longer TTL.
      if (cacheEntry && cacheEntry.ttlMs > ttl) {
        await cacheService.invalidate(cacheKey);
        cacheEntry = null;
      }

      if (cacheEntry) {
        const { data, expiresAt, ttlMs } = cacheEntry;

        // Generate ETag for the cached data
        const etag = generateETag(data);

        // Check for If-None-Match header - return 304 if client has fresh copy
        if (checkETagMatch(req, res, etag)) {
          return;
        }

        // Calculate remaining fresh time
        const now = Date.now();
        const remainingFreshMs = Math.max(0, new Date(expiresAt).getTime() - now);

        // Set HTTP cache headers
        const cacheHeaders = getCacheHeaders(ttlMs, remainingFreshMs);
        Object.entries(cacheHeaders).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        res.setHeader("ETag", etag);

        // Cache hit - return cached response immediately
        return res.json(data);
      }

      // Cache miss - store the original res.json function
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response before sending
      res.json = function (body: any): Response {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Generate ETag for fresh response
          const etag = generateETag(body);

          // Set HTTP cache headers for fresh response
          const cacheHeaders = getCacheHeaders(ttl);
          Object.entries(cacheHeaders).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
          res.setHeader("ETag", etag);

          // Cache the response data (async, but we don't wait for it)
          // This is fire-and-forget to avoid blocking the response
          cacheService.set(cacheKey, body, ttl).catch((error) => {
            // Log error but don't fail the response
            console.error(`Failed to cache response for ${cacheKey}:`, error);
          });
        }

        // Send the response using the original function
        return originalJson(body);
      };

      // Continue to the route handler
      next();
    } catch (error) {
      // On cache error, continue to route handler without caching
      console.error("Cache middleware error:", error);
      next();
    }
  };
}

/**
 * Middleware to skip cache and force fresh data.
 * Useful for admin endpoints or when ?nocache=true query param is present.
 */
export function skipCacheMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check if nocache query param is present
  if (req.query.nocache === "true") {
    // Override res.json to not cache
    const originalJson = res.json.bind(res);
    res.json = function (body: any): Response {
      return originalJson(body);
    };
  }
  next();
}
