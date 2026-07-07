import { Router, Request, Response } from "express";
import raidAnalyticsService from "../services/raid-analytics.service";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";
import logger from "../utils/logger";

const router = Router();

/**
 * Get list of raids that have analytics available
 * GET /api/raid-analytics/raids
 */
router.get(
  "/raids",
  cacheMiddleware(
    () => cacheService.getRaidAnalyticsRaidsKey(),
    () => cacheService.RAID_ANALYTICS_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const raids = await raidAnalyticsService.getAvailableRaids();
      res.json(raids);
    } catch (error) {
      logger.error("Error fetching available raids for analytics:", error);
      res.status(500).json({ error: "Failed to fetch available raids" });
    }
  },
);

/**
 * Get analytics for all raids in a single request
 * Returns raid-level data only (no boss breakdown) for overview
 * GET /api/raid-analytics/all
 */
router.get(
  "/all",
  cacheMiddleware(
    () => cacheService.getRaidAnalyticsAllKey(),
    () => cacheService.RAID_ANALYTICS_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const allAnalytics = await raidAnalyticsService.getAllRaidAnalyticsOverview();
      res.json(allAnalytics);
    } catch (error) {
      logger.error("Error fetching all raid analytics:", error);
      res.status(500).json({ error: "Failed to fetch all raid analytics" });
    }
  },
);

/**
 * Get boss kill progression comparison for all raids
 * Returns boss-level weekly data shaped for cross-tier charts
 * GET /api/raid-analytics/boss-progression
 */
router.get(
  "/boss-progression",
  cacheMiddleware(
    () => cacheService.getRaidAnalyticsBossProgressionKey(),
    () => cacheService.RAID_ANALYTICS_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const progression = await raidAnalyticsService.getBossProgressionComparison();
      res.json(progression);
    } catch (error) {
      logger.error("Error fetching raid boss progression comparison:", error);
      res.status(500).json({ error: "Failed to fetch raid boss progression comparison" });
    }
  },
);

/**
 * Get analytics for a specific raid
 * Returns full data including boss breakdown
 * GET /api/raid-analytics/:raidId
 */
router.get(
  "/:raidId",
  cacheMiddleware(
    (req) => cacheService.getRaidAnalyticsKey(parseInt(req.params.raidId)),
    () => cacheService.RAID_ANALYTICS_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const raidId = parseInt(req.params.raidId);

      if (isNaN(raidId)) {
        return res.status(400).json({ error: "Invalid raid ID" });
      }

      const analytics = await raidAnalyticsService.getRaidAnalytics(raidId);

      if (!analytics) {
        return res.status(404).json({ error: "No analytics found for this raid" });
      }

      res.json(analytics);
    } catch (error) {
      logger.error("Error fetching raid analytics:", error);
      res.status(500).json({ error: "Failed to fetch raid analytics" });
    }
  },
);

export default router;
