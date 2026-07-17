import { Router, Request, Response } from "express";
import guildService from "../services/guild.service";
import characterService from "../services/character.service";
import bossKillPredictionService from "../services/boss-kill-prediction.service";
import logger from "../utils/logger";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";
import { CURRENT_RAID_IDS } from "../config/guilds";

const router = Router();

const HELSINKI_TIME_ZONE = "Europe/Helsinki";
const HELSINKI_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: HELSINKI_TIME_ZONE,
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getHelsinkiToday(): { dateKey: string; weekday: string } {
  const parts = HELSINKI_DATE_FORMATTER.formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
  };
}

// Get all guilds with only their raid schedules (for calendar/timetable view)
router.get(
  "/schedules",
  cacheMiddleware(
    () => cacheService.getSchedulesKey(),
    () => cacheService.SCHEDULES_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const schedules = await guildService.getAllGuildSchedules();
      res.json(schedules);
    } catch (error) {
      logger.error("Error fetching guild schedules:", error);
      res.status(500).json({ error: "Failed to fetch guild schedules" });
    }
  },
);

// Get guilds scheduled to raid today (for the home page strip)
router.get(
  "/raiding-today",
  cacheMiddleware(
    () => cacheService.getRaidingTodayKey(getHelsinkiToday().dateKey),
    () => cacheService.RAIDING_TODAY_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const today = getHelsinkiToday();
      const guilds = await guildService.getGuildsRaidingOnDay(today.weekday);

      res.json({
        date: today.dateKey,
        day: today.weekday,
        guilds,
      });
    } catch (error) {
      logger.error("Error fetching guilds raiding today:", error);
      res.status(500).json({ error: "Failed to fetch guilds raiding today" });
    }
  },
);

// Get all live streamers with their guild info
router.get(
  "/live-streamers",
  cacheMiddleware(
    () => cacheService.getLiveStreamersKey(),
    () => cacheService.LIVE_STREAMERS_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const liveStreamers = await guildService.getLiveStreamers();
      res.json(liveStreamers);
    } catch (error) {
      logger.error("Error fetching live streamers:", error);
      res.status(500).json({ error: "Failed to fetch live streamers" });
    }
  },
);

// Get minimal guild list for directory page (name, realm, region, parent_guild, warcraftlogsId, isCurrentlyRaiding)
router.get(
  "/list",
  cacheMiddleware(
    () => cacheService.getGuildListKey(),
    () => cacheService.GUILD_LIST_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const guilds = await guildService.getGuildListMinimal();
      res.json(guilds);
    } catch (error) {
      logger.error("Error fetching guild list:", error);
      res.status(500).json({ error: "Failed to fetch guild list" });
    }
  },
);

// Get all manually reserved Uma images so random horse race assignments do not reuse them
router.get(
  "/horse-race-uma-reservations",
  cacheMiddleware(
    () => cacheService.getHorseRaceUmaReservationsKey(),
    () => cacheService.GUILD_LIST_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const reservedImages = await guildService.getReservedHorseRaceUmaImages();
      res.json(reservedImages);
    } catch (error) {
      logger.error("Error fetching horse race Uma reservations:", error);
      res.status(500).json({ error: "Failed to fetch horse race Uma reservations" });
    }
  },
);

// Get all guilds with their progress for a specific raid
// Required query param: raidId
router.get(
  "/",
  cacheMiddleware(
    (req) => {
      const raidId = req.query.raidId ? parseInt(req.query.raidId as string) : null;
      if (!raidId) return "guilds:invalid"; // will never cache — route returns 400 before this runs
      return cacheService.getGuildsKey(raidId);
    },
    (req) => {
      const raidId = req.query.raidId ? parseInt(req.query.raidId as string) : null;
      return cacheService.getTTLForRaid(raidId);
    },
  ),
  async (req: Request, res: Response) => {
    try {
      const raidId = req.query.raidId ? parseInt(req.query.raidId as string) : null;

      if (!raidId) {
        return res.status(400).json({ error: "raidId query parameter is required" });
      }

      const guilds = await guildService.getAllGuildsForRaid(raidId);
      res.json(guilds);
    } catch (error) {
      logger.error("Error fetching guilds:", error);
      res.status(500).json({ error: "Failed to fetch guilds" });
    }
  },
);

// Get pull history for a specific boss
router.get("/:realm/:name/raids/:raidId/bosses/:bossId/pull-history", async (req: Request, res: Response) => {
  try {
    const realm = decodeURIComponent(req.params.realm);
    const name = decodeURIComponent(req.params.name);
    const raidId = parseInt(req.params.raidId);
    const bossId = parseInt(req.params.bossId);
    const difficulty = req.query.difficulty as "mythic" | "heroic" | undefined;

    if (!difficulty) {
      return res.status(400).json({ error: "difficulty query parameter is required" });
    }

    const pullHistory = await guildService.getBossPullHistory(realm, name, raidId, bossId, difficulty);

    if (pullHistory === null) {
      return res.status(404).json({ error: "Guild or boss not found" });
    }

    res.json(pullHistory);
  } catch (error) {
    logger.error("Error fetching boss pull history:", error);
    res.status(500).json({ error: "Failed to fetch boss pull history" });
  }
});

// Get an on-demand kill prediction for a specific progressing boss
router.get("/:realm/:name/raids/:raidId/bosses/:bossId/prediction", async (req: Request, res: Response) => {
  try {
    const realm = req.params.realm;
    const name = req.params.name;
    const raidId = Number(req.params.raidId);
    const bossId = Number(req.params.bossId);
    const difficulty = req.query.difficulty;

    if (!Number.isInteger(raidId) || raidId <= 0 || !Number.isInteger(bossId) || bossId <= 0) {
      return res.status(400).json({ error: "Invalid raid or boss ID" });
    }

    if (difficulty !== "mythic" && difficulty !== "heroic") {
      return res.status(400).json({ error: "difficulty must be mythic or heroic" });
    }

    if (!CURRENT_RAID_IDS.includes(raidId)) {
      return res.json({ available: false, reason: "raid_not_current" });
    }

    const result = await bossKillPredictionService.predictForGuildBoss(realm, name, raidId, bossId, difficulty);
    res.json(result);
  } catch (error) {
    logger.error("Error calculating boss kill prediction:", error);
    res.status(500).json({ error: "Failed to calculate boss kill prediction" });
  }
});

// Get calculated character roster for a specific guild and raid by realm/name
router.get("/:realm/:name/raids/:raidId/characters", async (req: Request, res: Response) => {
  try {
    const realm = decodeURIComponent(req.params.realm);
    const name = decodeURIComponent(req.params.name);
    const raidId = parseInt(req.params.raidId);

    if (!Number.isFinite(raidId)) {
      return res.status(400).json({ error: "Invalid raid ID" });
    }

    const result = await characterService.getGuildRaidCharactersByRealmName(realm, name, raidId);
    if (!result) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(result);
  } catch (error) {
    logger.error("Error fetching guild raid characters:", error);
    res.status(500).json({ error: "Failed to fetch guild raid characters" });
  }
});

// Get detailed boss progress for a specific guild and raid by realm/name (returns only progress array)
router.get(
  "/:realm/:name/raids/:raidId/bosses",
  cacheMiddleware(
    (req) => {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const raidId = parseInt(req.params.raidId);
      return cacheService.getBossProgressKey(realm, name, raidId);
    },
    (req) => {
      const raidId = parseInt(req.params.raidId);
      return cacheService.getTTLForRaid(raidId);
    },
  ),
  async (req: Request, res: Response) => {
    try {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const raidId = parseInt(req.params.raidId);

      const result = await guildService.getGuildBossProgressForRaidByRealmName(realm, name, raidId);

      if (!result) {
        return res.status(404).json({ error: "Guild not found" });
      }

      res.json(result);
    } catch (error) {
      logger.error("Error fetching guild boss progress:", error);
      res.status(500).json({ error: "Failed to fetch guild boss progress" });
    }
  },
);

// DEPRECATED: Get detailed boss progress by ObjectId (kept for backward compatibility)
router.get("/:id/raids/:raidId/bosses", async (req: Request, res: Response) => {
  try {
    const guildId = req.params.id;
    const raidId = parseInt(req.params.raidId);

    const bossProgress = await guildService.getGuildBossProgressForRaid(guildId, raidId);

    if (!bossProgress) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(bossProgress);
  } catch (error) {
    logger.error("Error fetching guild boss progress:", error);
    res.status(500).json({ error: "Failed to fetch guild boss progress" });
  }
});

// Get guild summary by realm/name (without boss details)
router.get(
  "/:realm/:name/summary",
  cacheMiddleware(
    (req) => {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      return cacheService.getGuildSummaryKey(realm, name);
    },
    () => cacheService.GUILD_SUMMARY_TTL,
  ),
  async (req: Request, res: Response) => {
    try {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const summary = await guildService.getGuildSummaryByRealmName(realm, name);

      if (!summary) {
        return res.status(404).json({ error: "Guild not found" });
      }

      res.json(summary);
    } catch (error) {
      logger.error("Error fetching guild summary:", error);
      res.status(500).json({ error: "Failed to fetch guild summary" });
    }
  },
);

// DEPRECATED: Get single guild by ID with summary progress (kept for backward compatibility)
router.get("/:id/summary", async (req: Request, res: Response) => {
  try {
    const guildId = req.params.id;
    const summary = await guildService.getGuildSummary(guildId);

    if (!summary) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(summary);
  } catch (error) {
    logger.error("Error fetching guild summary:", error);
    res.status(500).json({ error: "Failed to fetch guild summary" });
  }
});

// Get single guild by ID with full progress for all raids
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const guild = await guildService.getGuildById(req.params.id);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(guild);
  } catch (error) {
    logger.error("Error fetching guild:", error);
    res.status(500).json({ error: "Failed to fetch guild" });
  }
});

// Get full guild profile with all raid progress (including boss details)
router.get("/:id/profile", async (req: Request, res: Response) => {
  try {
    const guildId = req.params.id;
    const fullProfile = await guildService.getGuildFullProfile(guildId);

    if (!fullProfile) {
      return res.status(404).json({ error: "Guild not found" });
    }

    res.json(fullProfile);
  } catch (error) {
    logger.error("Error fetching guild profile:", error);
    res.status(500).json({ error: "Failed to fetch guild profile" });
  }
});

// DEBUG: Fetch and log guild zone rankings for a specific zone
router.get("/:id/debug/rankings/:zoneId", async (req: Request, res: Response) => {
  try {
    const guildId = req.params.id;
    const zoneId = parseInt(req.params.zoneId);

    logger.info(`\n[DEBUG ENDPOINT] Fetching zone rankings for guild ${guildId}, zone ${zoneId}`);

    await guildService.fetchGuildZoneRankings(guildId, zoneId);

    res.json({
      success: true,
      message: "Zone rankings fetched. Check server console logs for detailed output.",
    });
  } catch (error) {
    logger.error("Error fetching guild zone rankings:", error);
    res.status(500).json({ error: "Failed to fetch guild zone rankings" });
  }
});

// DEBUG: Fetch and log guild zone rankings for current raid
router.get("/:id/debug/rankings", async (req: Request, res: Response) => {
  try {
    const guildId = req.params.id;

    logger.info(`\n[DEBUG ENDPOINT] Fetching zone rankings for guild ${guildId} (current raid)`);

    await guildService.fetchGuildZoneRankings(guildId);

    res.json({
      success: true,
      message: "Zone rankings fetched. Check server console logs for detailed output.",
    });
  } catch (error) {
    logger.error("Error fetching guild zone rankings:", error);
    res.status(500).json({ error: "Failed to fetch guild zone rankings" });
  }
});

export default router;
