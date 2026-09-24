import { Router, Request, Response } from "express";
import characterService from "../services/character.service";
import logger from "../utils/logger";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";
import { MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY } from "../config/character-eligibility";
import { TRACKED_RAIDS } from "../config/guilds";
import { getCharacterDeaths } from "../services/character-deaths.service";

const router = Router();

router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 10;
    const eligibility = req.query.eligibility === "fun"
      ? { zoneIds: TRACKED_RAIDS, minMythicReportCount: MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY }
      : undefined;

    const characters = await characterService.searchCharacters(query, Number.isFinite(limit) ? limit : 10, eligibility);
    res.json({ characters });
  } catch (error) {
    logger.error("Error searching characters:", error);
    res.status(500).json({ error: "Failed to search characters" });
  }
});

router.get("/:realm/:name/deaths", async (req: Request, res: Response) => {
  const number = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  const zoneId = number(req.query.zoneId);
  const encounterId = number(req.query.encounterId);
  const classId = number(req.query.class);
  const difficulty = req.query.difficulty === undefined ? 5 : number(req.query.difficulty);
  const page = req.query.page === undefined ? 1 : number(req.query.page);
  const region = req.query.region ?? "eu";
  const outcome = req.query.outcome ?? "all";
  if (![zoneId, encounterId, classId, page].every((value) => Number.isSafeInteger(value) && value > 0)
    || ![3, 4, 5].includes(difficulty) || !["eu", "us", "kr", "tw", "cn"].includes(String(region))
    || typeof region !== "string" || !["all", "kills", "wipes"].includes(String(outcome)) || typeof outcome !== "string"
    || req.params.realm.length > 64 || req.params.name.length > 64) {
    return res.status(400).json({ error: "Invalid death analysis filters" });
  }
  try {
    const result = await getCharacterDeaths({ realm: req.params.realm, name: req.params.name, classId, region, zoneId, encounterId, difficulty, page, outcome: outcome as "all" | "kills" | "wipes" });
    return res.json(result);
  } catch (error) {
    logger.error("Error fetching character death analysis:", error);
    return res.status(500).json({ error: "Failed to fetch death analysis" });
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
