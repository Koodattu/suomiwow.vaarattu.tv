import { Router, Request, Response } from "express";
import { CURRENT_RAID_IDS, PRIMARY_RAID_ID, TRACKED_RAIDS } from "../config/guilds";
import CharacterMechanicsLeaderboard from "../models/CharacterMechanicsLeaderboard";
import Raid from "../models/Raid";
import { cacheMiddleware } from "../middleware/cache.middleware";
import cacheService from "../services/cache.service";
import characterMechanicsService from "../services/character-mechanics.service";
import { compareRaidIdsByPriority } from "../utils/raidPriority";

const router = Router();

const ALLOWED_ROLES = new Set(["dps", "healer", "tank"] as const);
const ALLOWED_METRICS = new Set(["dps", "hps"] as const);
const ALLOWED_SCORE_TYPES = new Set(["combined", "survival"] as const);
const MYTHIC_DIFFICULTY = 5;

const parseNumberQuery = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseStringQuery = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  const parsed = String(value).trim();
  return parsed.length > 0 ? parsed : undefined;
};

router.get(
  "/options",
  cacheMiddleware(
    (_req) => "character-mechanics:options:v1",
    (_req) => cacheService.STATIC_TTL,
  ),
  async (_req: Request, res: Response) => {
    try {
      const zoneIdsWithMechanics = await CharacterMechanicsLeaderboard.distinct("zoneId", {
        difficulty: MYTHIC_DIFFICULTY,
        zoneId: { $in: TRACKED_RAIDS },
        deathDataAvailable: true,
        survivalScore: { $ne: null },
        survivalPercentile: { $ne: null },
      });

      const sortedZoneIds = (zoneIdsWithMechanics.length > 0 ? zoneIdsWithMechanics : CURRENT_RAID_IDS)
        .filter((id): id is number => typeof id === "number")
        .sort(compareRaidIdsByPriority);

      const raids = await Raid.find({ id: { $in: sortedZoneIds } }).select("id name expansion iconUrl -_id").lean();
      const raidById = new Map(raids.map((raid) => [raid.id, raid]));
      const orderedRaids = sortedZoneIds
        .map((zoneId) => raidById.get(zoneId))
        .filter((raid) => Boolean(raid)) as typeof raids;

      const raidOptions = orderedRaids.map((raid) => ({
        id: raid.id,
        name: raid.name,
        expansion: raid.expansion,
        iconUrl: raid.iconUrl,
        partitions: [],
      }));

      const defaultZoneId = raidOptions.some((raid) => raid.id === PRIMARY_RAID_ID) ? PRIMARY_RAID_ID : (raidOptions[0]?.id ?? PRIMARY_RAID_ID);

      res.json({
        raids: raidOptions,
        defaultSelection: {
          zoneId: defaultZoneId,
          partition: null,
        },
      });
    } catch (error) {
      res.status(500).json({ error: `Failed to fetch character mechanics options: ${error instanceof Error ? error.message : "Unknown error"}` });
    }
  },
);

router.get("/", async (req: Request, res: Response) => {
  try {
    const zoneIdFromQuery = parseNumberQuery(req.query.zoneId);
    if (req.query.zoneId !== undefined && zoneIdFromQuery === undefined) {
      return res.status(400).json({ error: "Invalid zoneId" });
    }

    const zoneId = zoneIdFromQuery ?? PRIMARY_RAID_ID;
    if (!Number.isFinite(zoneId)) {
      return res.status(400).json({ error: "Invalid zone ID" });
    }

    const encounterId = parseNumberQuery(req.query.encounterId);
    const classId = parseNumberQuery(req.query.classId);
    const page = parseNumberQuery(req.query.page);
    const limit = parseNumberQuery(req.query.limit);
    const characterName = parseStringQuery(req.query.characterName);
    const guildName = parseStringQuery(req.query.guildName);

    const specNameRaw = parseStringQuery(req.query.specName);
    const specName = specNameRaw?.toLowerCase();

    const roleRaw = parseStringQuery(req.query.role)?.toLowerCase();
    const role = roleRaw as "dps" | "healer" | "tank" | undefined;

    const metricRaw = parseStringQuery(req.query.metric)?.toLowerCase() ?? "dps";
    const metric = metricRaw as "dps" | "hps";
    const scoreTypeRaw = parseStringQuery(req.query.scoreType)?.toLowerCase() ?? "combined";
    const scoreType = scoreTypeRaw as "combined" | "survival";

    if (encounterId !== undefined && !Number.isFinite(encounterId)) {
      return res.status(400).json({ error: "Invalid encounterId" });
    }
    if (classId !== undefined && !Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid classId" });
    }
    if (page !== undefined && (!Number.isFinite(page) || page < 1)) {
      return res.status(400).json({ error: "Invalid page" });
    }
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      return res.status(400).json({ error: "Invalid limit" });
    }
    if (role !== undefined && !ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (!ALLOWED_METRICS.has(metric)) {
      return res.status(400).json({ error: "Invalid metric" });
    }
    if (!ALLOWED_SCORE_TYPES.has(scoreType)) {
      return res.status(400).json({ error: "Invalid scoreType" });
    }
    if (characterName !== undefined && characterName.length > 64) {
      return res.status(400).json({ error: "Invalid characterName" });
    }
    if (guildName !== undefined && guildName.length > 64) {
      return res.status(400).json({ error: "Invalid guildName" });
    }

    const rankings = await characterMechanicsService.getMechanicsRankings({
      zoneId,
      encounterId,
      classId,
      specName,
      role,
      metric,
      scoreType,
      page,
      limit,
      characterName,
      guildName,
    });

    res.json(rankings);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch character mechanics rankings: ${error instanceof Error ? error.message : "Unknown error"}` });
  }
});

export default router;
