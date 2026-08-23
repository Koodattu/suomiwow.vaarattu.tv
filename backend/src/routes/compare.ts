import { Router, Request, Response } from "express";
import compareService from "../services/compare.service";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";
import logger from "../utils/logger";
import { COMPARE_DIFFICULTIES, CompareDifficulty } from "../config/compare";

const router = Router();

function getDifficulty(value: unknown): CompareDifficulty | null {
  if (value === undefined) return "mythic";
  return COMPARE_DIFFICULTIES.find((difficulty) => difficulty === value) ?? null;
}

router.get(
  "/:raidId",
  (req: Request, res: Response, next) => {
    if (Number.isNaN(parseInt(req.params.raidId))) {
      return res.status(400).json({ error: "Invalid raid ID" });
    }

    if (!getDifficulty(req.query.difficulty)) {
      return res.status(400).json({ error: "Invalid difficulty" });
    }

    next();
  },
  cacheMiddleware(
    (req) => cacheService.getCompareKey(parseInt(req.params.raidId), getDifficulty(req.query.difficulty) ?? "mythic"),
    (req) => cacheService.getTTLForRaid(parseInt(req.params.raidId)),
  ),
  async (req: Request, res: Response) => {
    try {
      const raidId = parseInt(req.params.raidId);
      const difficulty = getDifficulty(req.query.difficulty) ?? "mythic";

      const compare = await compareService.getRaidCompare(raidId, difficulty);

      if (!compare) {
        return res.status(404).json({ error: "Raid not found" });
      }

      res.json(compare);
    } catch (error) {
      logger.error("Error fetching raid compare data:", error);
      res.status(500).json({ error: "Failed to fetch raid compare data" });
    }
  },
);

export default router;
