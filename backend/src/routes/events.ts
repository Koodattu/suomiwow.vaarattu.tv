import { Router, Request, Response } from "express";
import Event from "../models/Event";
import Guild from "../models/Guild";
import logger from "../utils/logger";
import cacheService from "../services/cache.service";
import { cacheMiddleware } from "../middleware/cache.middleware";

const router = Router();

// Valid event types and difficulties for filtering
const VALID_EVENT_TYPES = ["boss_kill", "best_pull", "milestone", "hiatus", "regress", "reproge"];
const VALID_DIFFICULTIES = ["mythic", "heroic"];

// Enrich events with live streamer data and guild realm (for profile links).
// Guild crest and boss icon are stored at creation time — no backfill for old events.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichEventsWithGuildData(events: any[]): Promise<Record<string, unknown>[]> {
  if (events.length === 0) return events;

  const guildIds = [...new Set(events.map((e) => String(e.guildId)))];

  // Only fetch realm and streamers — lightweight query
  const guilds = await Guild.find({ _id: { $in: guildIds } }, { _id: 1, realm: 1, streamers: 1, isCurrentlyRaiding: 1 }).lean();

  const guildMap = new Map<string, { realm: string; liveStreamers: string[]; isCurrentlyRaiding: boolean }>();
  for (const guild of guilds) {
    const liveStreamers = (guild.streamers || []).filter((s) => s.isLive).map((s) => s.channelName);
    guildMap.set(String(guild._id), { realm: guild.realm, liveStreamers, isCurrentlyRaiding: guild.isCurrentlyRaiding ?? false });
  }

  return events.map((event) => {
    const guildData = guildMap.get(String(event.guildId));
    return {
      ...event,
      guildRealm: event.guildRealm || guildData?.realm,
      liveStreamers: guildData?.liveStreamers || [],
      isCurrentlyRaiding: guildData?.isCurrentlyRaiding || false,
    };
  });
}

// Parse filter query params into a MongoDB filter object
function parseEventFilters(query: Request["query"]): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  // Filter by event types (comma-separated)
  const typesParam = query.types as string | undefined;
  if (typesParam) {
    const types = typesParam.split(",").filter((t) => VALID_EVENT_TYPES.includes(t));
    if (types.length > 0 && types.length < VALID_EVENT_TYPES.length) {
      filter.type = { $in: types };
    }
  }

  // Filter by difficulties (comma-separated)
  const difficultiesParam = query.difficulties as string | undefined;
  if (difficultiesParam) {
    const difficulties = difficultiesParam.split(",").filter((d) => VALID_DIFFICULTIES.includes(d));
    if (difficulties.length > 0 && difficulties.length < VALID_DIFFICULTIES.length) {
      filter.difficulty = { $in: difficulties };
    }
  }

  // Filter by guild name (exact match, case-insensitive)
  const guildNameParam = query.guildName as string | undefined;
  if (guildNameParam) {
    filter.guildName = guildNameParam;
  }

  return filter;
}

// Get recent events with pagination and optional filters
router.get(
  "/",
  cacheMiddleware(
    (req) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const page = parseInt(req.query.page as string) || 1;
      const types = (req.query.types as string) || "";
      const difficulties = (req.query.difficulties as string) || "";
      const guildName = (req.query.guildName as string) || "";
      return cacheService.getEventsPaginatedKey(limit, page, types, difficulties, guildName);
    },
    () => cacheService.getEventsTTL(),
  ),
  async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const page = parseInt(req.query.page as string) || 1;
      const skip = (page - 1) * limit;
      const filter = parseEventFilters(req.query);

      const [events, totalCount] = await Promise.all([
        Event.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).select("-__v -createdAt -updatedAt").lean(),
        Event.countDocuments(filter),
      ]);

      const enrichedEvents = await enrichEventsWithGuildData(events);

      res.json({
        events: enrichedEvents,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
        },
      });
    } catch (error) {
      logger.error("Error fetching events:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  },
);

// Get events for a specific guild by realm and name
router.get(
  "/guild/:realm/:name",
  cacheMiddleware(
    (req) => {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const limit = parseInt(req.query.limit as string) || 50;
      const page = parseInt(req.query.page as string) || 1;
      return cacheService.getGuildEventsKey(realm, name, limit, page);
    },
    () => cacheService.getEventsTTL(),
  ),
  async (req, res) => {
    try {
      const realm = decodeURIComponent(req.params.realm);
      const name = decodeURIComponent(req.params.name);
      const limit = parseInt(req.query.limit as string) || 50;
      const page = parseInt(req.query.page as string) || 1;
      const skip = (page - 1) * limit;

      // Find only the guild id; event enrichment loads the small guild fields it needs later.
      const guild = await Guild.findOne({ realm, name })
        .select("_id")
        .collation({ locale: "en", strength: 2 })
        .lean();

      if (!guild) {
        return res.status(404).json({ error: "Guild not found" });
      }

      const [events, totalCount] = await Promise.all([
        Event.find({ guildId: guild._id }).sort({ timestamp: -1 }).skip(skip).limit(limit).select("-__v -createdAt -updatedAt").lean(),
        Event.countDocuments({ guildId: guild._id }),
      ]);

      const enrichedEvents = await enrichEventsWithGuildData(events);

      res.json({
        events: enrichedEvents,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
        },
      });
    } catch (error) {
      logger.error("Error fetching guild events:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  },
);

// Get events for a specific guild
router.get("/guild/:guildId", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const skip = (page - 1) * limit;

    const [events, totalCount] = await Promise.all([
      Event.find({ guildId: req.params.guildId }).sort({ timestamp: -1 }).skip(skip).limit(limit).select("-__v -createdAt -updatedAt").lean(),
      Event.countDocuments({ guildId: req.params.guildId }),
    ]);

    const enrichedEvents = await enrichEventsWithGuildData(events);

    res.json({
      events: enrichedEvents,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
      },
    });
  } catch (error) {
    logger.error("Error fetching guild events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

export default router;
