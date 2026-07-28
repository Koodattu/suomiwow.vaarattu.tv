import { Router, Request, Response } from "express";
import characterService from "../services/character.service";
import logger from "../utils/logger";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";

const router = Router();

router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 10;

    const characters = await characterService.searchCharacters(query, Number.isFinite(limit) ? limit : 10);
    res.json({ characters });
  } catch (error) {
    logger.error("Error searching characters:", error);
    res.status(500).json({ error: "Failed to search characters" });
  }
});

router.get("/:realm/:name/raids/:raidId/guilds/:guildId/reports", async (req: Request, res: Response) => {
  try {
    const realm = decodeURIComponent(req.params.realm);
    const name = decodeURIComponent(req.params.name);
    const raidId = parseInt(req.params.raidId, 10);
    const guildId = req.params.guildId;
    const classId = typeof req.query.class === "string" ? Number(req.query.class) : undefined;

    if (!Number.isFinite(raidId)) {
      return res.status(400).json({ error: "Invalid raid ID" });
    }

    if (classId !== undefined && !Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class ID" });
    }

    const result = await characterService.getCharacterRaidReportsByRealmName(realm, name, raidId, guildId, classId);
    if (!result) {
      return res.status(404).json({ error: "Character or guild not found" });
    }

    res.json(result);
  } catch (error) {
    logger.error("Error fetching character raid reports:", error);
    res.status(500).json({ error: "Failed to fetch character raid reports" });
  }
});

router.get(
  "/:realm/:name",
  cacheMiddleware(
    (req) => {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const classParam = typeof req.query.class === "string" ? req.query.class : undefined;
      const classId = classParam !== undefined ? Number(classParam) : undefined;
      if (classId !== undefined && !Number.isFinite(classId)) {
        return `characters:profile:v4:${realm.toLowerCase()}:${name.toLowerCase()}:class:invalid:${classParam}`;
      }
      return cacheService.getCharacterProfileKey(realm, name, classId);
    },
    () => cacheService.CHARACTER_PROFILE_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const classId = typeof req.query.class === "string" ? Number(req.query.class) : undefined;

      if (classId !== undefined && !Number.isFinite(classId)) {
        return res.status(400).json({ error: "Invalid class ID" });
      }

      const profile = await characterService.getCharacterProfileByRealmName(realm, name, classId);
      if (!profile) {
        return res.status(404).json({ error: "Character not found" });
      }

      res.json(profile);
    } catch (error) {
      logger.error("Error fetching character profile:", error);
      res.status(500).json({ error: "Failed to fetch character profile" });
    }
  },
);

export default router;
