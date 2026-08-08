import { Router, Request, Response, NextFunction } from "express";
import { MYTHIC_PLUS_SCORE_BUCKETS, MythicPlusScoreBucket } from "../config/mythic-plus";
import { cacheMiddleware } from "../middleware/cache.middleware";
import cacheService from "../services/cache.service";
import mythicPlusService, { MythicPlusDungeonSort } from "../services/mythic-plus.service";
import logger from "../utils/logger";
import { normalizeSearchText } from "../utils/search";

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

export function isMythicPlusLeaderboardQueryCacheable(query: Request["query"]): boolean {
  return !parseStringQuery(query.search) && !parseStringQuery(query.characterName) && !parseStringQuery(query.guildName) && parseStringQuery(query.nocache)?.toLowerCase() !== "true";
}

export function getMythicPlusLeaderboardCacheKey(query: Request["query"]): string {
  const params = new URLSearchParams();
  const season = parseStringQuery(query.season);
  const bucket = parseStringQuery(query.bucket)?.toLowerCase() ?? "all";
  const dungeonId = parseNumberQuery(query.dungeonId);
  const dungeonSort = parseStringQuery(query.dungeonSort)?.toLowerCase() ?? "score";
  const classId = parseNumberQuery(query.classId);
  const specName = parseStringQuery(query.specName)?.toLowerCase();
  const role = parseStringQuery(query.role)?.toLowerCase();
  const page = parseNumberQuery(query.page) ?? 1;
  const limit = parseNumberQuery(query.limit) ?? 100;

  if (season) params.set("season", season);
  params.set("bucket", bucket);
  if (dungeonId !== undefined) params.set("dungeonId", String(dungeonId));
  params.set("dungeonSort", dungeonSort);
  if (classId !== undefined) params.set("classId", String(classId));
  if (specName) params.set("specName", specName);
  if (role) params.set("role", role);
  params.set("page", String(page));
  params.set("limit", String(limit));

  return `mythic-plus:leaderboard:v3:${params.toString()}`;
}

const leaderboardCacheMiddleware = cacheMiddleware(
  (req) => getMythicPlusLeaderboardCacheKey(req.query),
  () => cacheService.DEFAULT_TTL,
);

function cachePublicLeaderboard(req: Request, res: Response, next: NextFunction) {
  if (!isMythicPlusLeaderboardQueryCacheable(req.query)) return next();
  return leaderboardCacheMiddleware(req, res, next);
}

router.get(
  "/options",
  cacheMiddleware(
    () => "mythic-plus:options:v2",
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

router.get("/", cachePublicLeaderboard, async (req: Request, res: Response) => {
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
    const search = parseStringQuery(req.query.search);
    const characterName = parseStringQuery(req.query.characterName);
    const characterRealm = parseStringQuery(req.query.characterRealm);
    const guildName = parseStringQuery(req.query.guildName);
    const guildRealm = parseStringQuery(req.query.guildRealm);
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
    if (search !== undefined && (normalizeSearchText(search).replace(/\s/g, "").length < 2 || search.length > 64)) {
      return res.status(400).json({ error: "Invalid search" });
    }
    if ((characterName !== undefined && characterName.length > 64) || (characterRealm !== undefined && characterRealm.length > 64)) {
      return res.status(400).json({ error: "Invalid characterName" });
    }
    if ((guildName !== undefined && guildName.length > 64) || (guildRealm !== undefined && guildRealm.length > 64)) {
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
      search,
      characterName,
      characterRealm,
      guildName,
      guildRealm,
    });

    res.json(response);
  } catch (error) {
    logger.error("Error fetching Mythic+ leaderboard:", error);
    res.status(500).json({ error: "Failed to fetch Mythic+ leaderboard" });
  }
});

export default router;
