import { Router, Request, Response } from "express";
import characterTierListService, { CharacterTierListFilters, CharacterTierListServiceError } from "../services/character-tierlist.service";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";
import logger from "../utils/logger";

const router = Router();

function parseFilters(req: Request, defaultMinReports: number): CharacterTierListFilters {
  const minReports = req.query.minReports ? parseInt(req.query.minReports as string, 10) : defaultMinReports;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 400;
  const role = typeof req.query.role === "string" ? req.query.role : null;
  const classId = req.query.classId ? parseInt(req.query.classId as string, 10) : null;

  if (!Number.isFinite(minReports) || minReports < 1) {
    throw new CharacterTierListServiceError(400, "minReports must be at least 1");
  }

  if (!Number.isFinite(limit) || limit < 1) {
    throw new CharacterTierListServiceError(400, "limit must be at least 1");
  }

  if (role && role !== "dps" && role !== "healer" && role !== "tank") {
    throw new CharacterTierListServiceError(400, "role must be dps, healer, or tank");
  }

  if (classId !== null && (!Number.isFinite(classId) || classId < 1)) {
    throw new CharacterTierListServiceError(400, "classId must be a positive number");
  }

  return {
    minReports,
    limit,
    role: role as CharacterTierListFilters["role"],
    classId,
  };
}

function parseRaidId(req: Request): number {
  const raidId = parseInt(req.params.raidId, 10);
  if (!Number.isFinite(raidId)) {
    throw new CharacterTierListServiceError(400, "Invalid raid ID");
  }
  return raidId;
}

function handleError(res: Response, message: string, error: unknown): void {
  if (error instanceof CharacterTierListServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  logger.error(message, error);
  res.status(500).json({ error: message });
}

router.get(
  "/raids",
  cacheMiddleware(
    () => cacheService.getCharacterTierListRaidsKey(),
    () => cacheService.CHARACTER_TIER_LIST_TTL,
  ),
  async (_req: Request, res: Response) => {
    try {
      const raids = await characterTierListService.getAvailableRaids();
      res.json(raids);
    } catch (error) {
      handleError(res, "Failed to fetch character tier list raids", error);
    }
  },
);

router.get(
  "/raids/:raidId",
  cacheMiddleware(
    (req) => cacheService.getCharacterTierListGlobalKey(parseRaidId(req), parseFilters(req, 3)),
    () => cacheService.CHARACTER_TIER_LIST_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const raidId = parseRaidId(req);
      const filters = parseFilters(req, 3);
      const tierList = await characterTierListService.getGlobalTierList(raidId, filters);
      res.json(tierList);
    } catch (error) {
      handleError(res, "Failed to fetch character tier list", error);
    }
  },
);

router.get("/shared/:shareId", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId ?? null;
    const tierList = await characterTierListService.getSharedTierList(userId, req.params.shareId);
    if (!tierList) {
      return res.status(404).json({ error: "Shared tier list not found" });
    }

    res.json(tierList);
  } catch (error) {
    handleError(res, "Failed to fetch shared character tier list", error);
  }
});

router.put("/shared/:shareId", async (req: Request, res: Response) => {
  try {
    const tierList = await characterTierListService.updateSharedTierList(req.session.userId, req.params.shareId, req.body ?? {});
    if (!tierList) {
      return res.status(404).json({ error: "Shared tier list not found" });
    }

    res.json(tierList);
  } catch (error) {
    handleError(res, "Failed to update shared character tier list", error);
  }
});

router.get(
  "/guilds/:realm/:name/raids/:raidId",
  cacheMiddleware(
    (req) => {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      return cacheService.getCharacterTierListGuildKey(realm, name, parseRaidId(req), parseFilters(req, 1));
    },
    () => cacheService.CHARACTER_TIER_LIST_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const raidId = parseRaidId(req);
      const filters = parseFilters(req, 1);

      const tierList = await characterTierListService.getGuildTierList(realm, name, raidId, filters);
      if (!tierList) {
        return res.status(404).json({ error: "Guild not found" });
      }

      res.json(tierList);
    } catch (error) {
      handleError(res, "Failed to fetch guild character tier list", error);
    }
  },
);

router.get("/guilds/:realm/:name/raids/:raidId/custom", async (req: Request, res: Response) => {
  try {
    const realm = decodeURIComponent(req.params.realm);
    const name = decodeURIComponent(req.params.name);
    const raidId = parseRaidId(req);
    const userId = req.session.userId ?? null;

    const tierList = await characterTierListService.getCustomTierList(userId, realm, name, raidId);
    if (!tierList) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(tierList);
  } catch (error) {
    handleError(res, "Failed to fetch custom character tier list", error);
  }
});

router.post("/guilds/:realm/:name/raids/:raidId/shared", async (req: Request, res: Response) => {
  try {
    const realm = decodeURIComponent(req.params.realm);
    const name = decodeURIComponent(req.params.name);
    const raidId = parseRaidId(req);
    const userId = req.session.userId ?? null;

    const tierList = await characterTierListService.createSharedTierList(userId, realm, name, raidId, req.body ?? {});
    if (!tierList) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.status(201).json(tierList);
  } catch (error) {
    handleError(res, "Failed to share custom character tier list", error);
  }
});

router.put("/guilds/:realm/:name/raids/:raidId/custom", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: "Login is required" });
    }

    const realm = decodeURIComponent(req.params.realm);
    const name = decodeURIComponent(req.params.name);
    const raidId = parseRaidId(req);

    const tierList = await characterTierListService.saveCustomTierList(userId, realm, name, raidId, req.body ?? {});
    if (!tierList) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(tierList);
  } catch (error) {
    handleError(res, "Failed to save custom character tier list", error);
  }
});

router.delete("/guilds/:realm/:name/raids/:raidId/custom", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: "Login is required" });
    }

    const realm = decodeURIComponent(req.params.realm);
    const name = decodeURIComponent(req.params.name);
    const raidId = parseRaidId(req);

    const tierList = await characterTierListService.deleteCustomTierList(userId, realm, name, raidId);
    if (!tierList) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(tierList);
  } catch (error) {
    handleError(res, "Failed to reset custom character tier list", error);
  }
});

export default router;
