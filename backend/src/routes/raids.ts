import { mainRaidBosses, raidLairs } from "../config/raid-encounters";
import { Router, Request, Response } from "express";
import Raid from "../models/Raid";
import { TRACKED_RAIDS } from "../config/guilds";
import logger from "../utils/logger";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";
import { addRaidPriorityFlagsAndSort } from "../utils/raidPriority";

const router = Router();

// Get all tracked raids (minimal data, without bosses or dates)
router.get(
  "/",
  cacheMiddleware(
    () => cacheService.getRaidsKey(),
    () => cacheService.STATIC_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      // Get only the tracked raids from the database, excluding unnecessary fields
      const raids = await Raid.find({ id: { $in: TRACKED_RAIDS } })
        .select("id name slug rioSlug expansion iconUrl partitions -_id")
        .lean();
      res.json(addRaidPriorityFlagsAndSort(raids));
    } catch (error) {
      logger.error("Error fetching raids:", error);
      res.status(500).json({ error: "Failed to fetch raids" });
    }
  },
);

// Get single raid by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const raidId = parseInt(req.params.id);
    const raid = await Raid.findOne({ id: raidId });

    if (!raid) {
      return res.status(404).json({ error: "Raid not found" });
    }

    res.json(raid);
  } catch (error) {
    logger.error("Error fetching raid:", error);
    res.status(500).json({ error: "Failed to fetch raid" });
  }
});

// Get bosses for a specific raid
router.get(
  "/:id/bosses",
  cacheMiddleware(
    (req) => {
      const raidId = parseInt(req.params.id);
      return cacheService.getRaidBossesKey(raidId) + (req.query.includeLairs === "true" ? ":with-lairs" : "");
    },
    () => cacheService.STATIC_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const raidId = parseInt(req.params.id);
      const raid = await Raid.findOne({ id: raidId }).select("bosses -_id");

      if (!raid) {
        return res.status(404).json({ error: "Raid not found" });
      }

      // Return only the bosses array without _id fields
      const bosses = mainRaidBosses(raidId, raid.bosses).map((boss: any) => ({
        id: boss.id,
        name: boss.name,
        slug: boss.slug,
        iconUrl: boss.iconUrl,
      }));

      if (req.query.includeLairs === "true") for (const lair of raidLairs(raidId)) {
        const source = raid.bosses.find(boss => boss.id === lair.id);
        bosses.push({ id: lair.id, name: lair.name, slug: lair.slug, iconUrl: source?.iconUrl, isLair: true } as any);
      }
      res.json(bosses);
    } catch (error) {
      logger.error("Error fetching raid bosses:", error);
      res.status(500).json({ error: "Failed to fetch raid bosses" });
    }
  },
);

// Get start/end dates for a specific raid
router.get(
  "/:id/dates",
  cacheMiddleware(
    (req) => {
      const raidId = parseInt(req.params.id);
      return cacheService.getRaidDatesKey(raidId);
    },
    (req) => {
      const raidId = parseInt(req.params.id);
      return cacheService.getTTLForRaid(raidId);
    },
  ),
  async (req: Request, res: Response) => {
    try {
      const raidId = parseInt(req.params.id);
      const raid = await Raid.findOne({ id: raidId }).select("starts ends -_id");

      if (!raid) {
        return res.status(404).json({ error: "Raid not found" });
      }

      // Return only the dates
      res.json({
        starts: raid.starts,
        ends: raid.ends,
      });
    } catch (error) {
      logger.error("Error fetching raid dates:", error);
      res.status(500).json({ error: "Failed to fetch raid dates" });
    }
  },
);

export default router;
