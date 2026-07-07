import { Router, Request, Response } from "express";
import { MYTHIC_PLUS_SCORE_BUCKETS, MythicPlusScoreBucket } from "../config/mythic-plus";
import { cacheMiddleware } from "../middleware/cache.middleware";
import cacheService from "../services/cache.service";
import mythicPlusService, { MythicPlusDungeonSort } from "../services/mythic-plus.service";
import logger from "../utils/logger";

const router = Router();

const ALLOWED_BUCKETS = new Set<MythicPlusScoreBucket>(MYTHIC_PLUS_SCORE_BUCKETS);
const ALLOWED_DUNGEON_SORTS = new Set<MythicPlusDungeonSort>(["score", "level"]);
const ALLOWED_ROLES = new Set(["dps", "healer", "tank"] as const);

function parseNumberQuery(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStringQuery(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = String(value).trim();
  return parsed.length > 0 ? parsed : undefined;
}

router.get(
  "/options",
  cacheMiddleware(
    () => "mythic-plus:options:v1",
    () => cacheService.STATIC_TTL,
  ),
  async (_req: Request, res: Response) => {
    try {
      res.json(await mythicPlusService.getOptions());
    } catch (error) {
      logger.error("Error fetching Mythic+ options:", error);
      res.status(500).json({ error: "Failed to fetch Mythic+ options" });
    }
  },
);

router.get("/", async (req: Request, res: Response) => {
  try {
    const bucketRaw = parseStringQuery(req.query.bucket)?.toLowerCase() as MythicPlusScoreBucket | undefined;
    const bucket = bucketRaw ?? "all";
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return res.status(400).json({ error: "Invalid bucket" });
    }

    const dungeonSortRaw = parseStringQuery(req.query.dungeonSort)?.toLowerCase() as MythicPlusDungeonSort | undefined;
    const dungeonSort = dungeonSortRaw ?? "score";
    if (!ALLOWED_DUNGEON_SORTS.has(dungeonSort)) {
      return res.status(400).json({ error: "Invalid dungeonSort" });
    }

    const dungeonId = parseNumberQuery(req.query.dungeonId);
    const classId = parseNumberQuery(req.query.classId);
    const page = parseNumberQuery(req.query.page);
    const limit = parseNumberQuery(req.query.limit);
    const characterName = parseStringQuery(req.query.characterName);
    const guildName = parseStringQuery(req.query.guildName);
    const season = parseStringQuery(req.query.season);
    const specName = parseStringQuery(req.query.specName)?.toLowerCase();
    const roleRaw = parseStringQuery(req.query.role)?.toLowerCase();
    const role = roleRaw as "dps" | "healer" | "tank" | undefined;

    if (dungeonId !== undefined && (!Number.isFinite(dungeonId) || dungeonId < 1)) {
      return res.status(400).json({ error: "Invalid dungeonId" });
    }
    if (classId !== undefined && (!Number.isFinite(classId) || classId < 1)) {
      return res.status(400).json({ error: "Invalid classId" });
    }
    if (page !== undefined && (!Number.isFinite(page) || page < 1)) {
      return res.status(400).json({ error: "Invalid page" });
    }
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      return res.status(400).json({ error: "Invalid limit" });
    }
    if (characterName !== undefined && characterName.length > 64) {
      return res.status(400).json({ error: "Invalid characterName" });
    }
    if (guildName !== undefined && guildName.length > 64) {
      return res.status(400).json({ error: "Invalid guildName" });
    }
    if (role !== undefined && !ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const response = await mythicPlusService.getLeaderboard({
      season,
      bucket,
      dungeonId,
      dungeonSort,
      classId,
      specName,
      role,
      page,
      limit,
      characterName,
      guildName,
    });

    res.json(response);
  } catch (error) {
    logger.error("Error fetching Mythic+ leaderboard:", error);
    res.status(500).json({ error: "Failed to fetch Mythic+ leaderboard" });
  }
});

export default router;
