import { Router, Request, Response } from "express";
import { requireAdmin } from "../middleware/admin.middleware";
import { CURRENT_RAID_IDS, TRACKED_RAIDS } from "../config/guilds";
import User from "../models/User";
import Guild from "../models/Guild";
import Report from "../models/Report";
import Fight from "../models/Fight";
import Event from "../models/Event";
import TierList from "../models/TierList";
import Raid from "../models/Raid";
import Character from "../models/Character";
import Ranking from "../models/Ranking";
import CharacterLeaderboard from "../models/CharacterLeaderboard";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import Pickem from "../models/Pickem";
import { RequestLog, HourlyStats } from "../models/Analytics";
import { CLASSES } from "../config/classes";
import pickemService from "../services/pickem.service";
import cacheService from "../services/cache.service";
import rateLimitService from "../services/rate-limit.service";
import backgroundGuildProcessor from "../services/background-guild-processor.service";
import GuildProcessingQueue, { ProcessingStatus } from "../models/GuildProcessingQueue";
import taskTracker from "../services/task-tracker.service";
import logger from "../utils/logger";
import scheduler from "../services/scheduler.service";
import guildService, { GuildReportImportError } from "../services/guild.service";
import characterService from "../services/character.service";
import characterMechanicsService from "../services/character-mechanics.service";
import characterTierListService from "../services/character-tierlist.service";
import characterRankingBackfillService from "../services/character-ranking-backfill.service";
import characterAchievementService from "../services/character-achievement.service";
import mythicPlusService from "../services/mythic-plus.service";
import wclService from "../services/warcraftlogs.service";
import wclUserAuthService from "../services/warcraftlogs-user-auth.service";
import blizzardService from "../services/blizzard.service";
import twitchBotAuthService from "../services/twitch-bot-auth.service";
import twitchChatBotService from "../services/twitch-chat-bot.service";

const router = Router();
let isSyncingRaidsFromWCL = false;

// Apply admin middleware to all routes
router.use(requireAdmin);

function getFrontendUrl(): string {
  return process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
}

function getAllowedDeathResetStatuses(value: unknown): Array<"failed" | "archived"> {
  if (!Array.isArray(value)) {
    return ["failed", "archived"];
  }

  const statuses = value.filter((status): status is "failed" | "archived" => status === "failed" || status === "archived");
  return statuses.length > 0 ? Array.from(new Set(statuses)) : ["failed", "archived"];
}

// ============================================================
// WARCRAFT LOGS USER OAUTH
// ============================================================

router.get("/wcl-user/status", async (req: Request, res: Response) => {
  try {
    const [authStatus, deathEventCounts] = await Promise.all([
      wclUserAuthService.getStatus(),
      Fight.aggregate([
        { $match: { deathEventsFetchStatus: { $in: ["pending", "failed", "archived"] } } },
        { $group: { _id: "$deathEventsFetchStatus", count: { $sum: 1 } } },
      ]),
    ]);
    const countsByStatus = new Map(deathEventCounts.map((entry: { _id: string; count: number }) => [entry._id, entry.count]));

    res.json({
      ...authStatus,
      deathEvents: {
        pending: countsByStatus.get("pending") || 0,
        failed: countsByStatus.get("failed") || 0,
        archived: countsByStatus.get("archived") || 0,
      },
    });
  } catch (error) {
    logger.error("Error fetching WCL user auth status:", error);
    res.status(500).json({ error: "Failed to fetch WCL user auth status" });
  }
});

router.get("/wcl-user/authorize", async (req: Request, res: Response) => {
  try {
    const adminUser = (req as any).user;
    const url = wclUserAuthService.createAuthorizationUrl(adminUser._id.toString());
    res.json({ url });
  } catch (error) {
    logger.error("Error creating WCL user authorization URL:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create WCL user authorization URL" });
  }
});

router.get("/wcl-user/callback", async (req: Request, res: Response) => {
  try {
    const adminUser = (req as any).user;
    const { code, state } = req.query;
    const oauthError = typeof req.query.error === "string" ? req.query.error : null;

    if (oauthError) {
      return res.redirect(`${getFrontendUrl()}/admin?wclUser=error&reason=${encodeURIComponent(oauthError)}`);
    }

    if (!code || typeof code !== "string" || !state || typeof state !== "string") {
      return res.redirect(`${getFrontendUrl()}/admin?wclUser=error&reason=missing_code_or_state`);
    }

    if (!wclUserAuthService.validateState(state, adminUser._id.toString())) {
      return res.redirect(`${getFrontendUrl()}/admin?wclUser=error&reason=invalid_state`);
    }

    await wclUserAuthService.exchangeCodeAndStore(code, adminUser);
    res.redirect(`${getFrontendUrl()}/admin?wclUser=connected`);
  } catch (error) {
    logger.error("Error in WCL user OAuth callback:", error);
    res.redirect(`${getFrontendUrl()}/admin?wclUser=error&reason=callback_failed`);
  }
});

router.post("/wcl-user/verify", async (req: Request, res: Response) => {
  try {
    const user = await wclUserAuthService.verifyCurrentUser();
    res.json({ success: true, user, status: await wclUserAuthService.getStatus() });
  } catch (error) {
    logger.error("Error verifying WCL user auth:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to verify WCL user auth" });
  }
});

router.post("/wcl-user/probe-report", async (req: Request, res: Response) => {
  try {
    const reportCode = typeof req.body?.reportCode === "string" ? req.body.reportCode.trim() : "";
    if (!/^[a-zA-Z0-9]+$/.test(reportCode)) {
      return res.status(400).json({ error: "A valid reportCode is required" });
    }

    const archiveQuery = `
      query($reportCode: String!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        reportData {
          report(code: $reportCode) {
            code
            archiveStatus {
              isArchived
              isAccessible
              archiveDate
            }
          }
        }
      }
    `;

    const archiveData = await wclService.queryUser<any>(archiveQuery, { reportCode });
    const storedFights = await Fight.find({ reportCode, reportEndTime: { $gt: 0 } }).select("fightId").sort({ fightId: 1 }).limit(50).lean();

    let deathEventProbe: { fightsTested: number; eventCount: number | null } | null = null;
    if (storedFights.length > 0) {
      const deathData = await wclService.getDeathEventsForReport(
        reportCode,
        storedFights.map((fight) => fight.fightId),
        { forceUserEndpoint: true },
      );
      const events = deathData.reportData?.report?.events?.data;
      deathEventProbe = {
        fightsTested: storedFights.length,
        eventCount: Array.isArray(events) ? events.length : null,
      };
    }

    res.json({
      success: true,
      report: archiveData.reportData?.report || null,
      deathEventProbe,
    });
  } catch (error) {
    logger.error("Error probing WCL user report access:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to probe WCL report access" });
  }
});

router.delete("/wcl-user", async (req: Request, res: Response) => {
  try {
    await wclUserAuthService.disconnect();
    res.json({ success: true, message: "Warcraft Logs user authorization disconnected" });
  } catch (error) {
    logger.error("Error disconnecting WCL user auth:", error);
    res.status(500).json({ error: "Failed to disconnect WCL user authorization" });
  }
});

// ============================================================
// TWITCH BOT OAUTH
// ============================================================

router.get("/twitch-bot/status", async (_req: Request, res: Response) => {
  try {
    res.json(await twitchChatBotService.getStatus());
  } catch (error) {
    logger.error("Error fetching Twitch bot status:", error);
    res.status(500).json({ error: "Failed to fetch Twitch bot status" });
  }
});

router.put("/twitch-bot/settings", async (req: Request, res: Response) => {
  try {
    const settings = await twitchChatBotService.updateSettings({
      eventPublishingEnabled: req.body?.eventPublishingEnabled,
      eventTypes: req.body?.eventTypes,
      difficulties: req.body?.difficulties,
      includeUrl: req.body?.includeUrl,
    });
    res.json(settings);
  } catch (error) {
    logger.error("Error updating Twitch bot settings:", error);
    res.status(500).json({ error: "Failed to update Twitch bot settings" });
  }
});

router.get("/twitch-bot/follows", async (_req: Request, res: Response) => {
  try {
    res.json(await twitchBotAuthService.getFollowedChannels());
  } catch (error) {
    logger.error("Error fetching Twitch bot followed channels:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch Twitch bot followed channels" });
  }
});

router.get("/twitch-bot/authorize", async (req: Request, res: Response) => {
  try {
    const adminUser = (req as any).user;
    const url = twitchBotAuthService.createAuthorizationUrl(adminUser._id.toString());
    res.json({ url });
  } catch (error) {
    logger.error("Error creating Twitch bot authorization URL:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create Twitch bot authorization URL" });
  }
});

router.get("/twitch-bot/callback", async (req: Request, res: Response) => {
  try {
    const adminUser = (req as any).user;
    const { code, state } = req.query;
    const oauthError = typeof req.query.error === "string" ? req.query.error : null;

    if (oauthError) {
      return res.redirect(`${getFrontendUrl()}/admin?twitchBot=error&reason=${encodeURIComponent(oauthError)}`);
    }

    if (!code || typeof code !== "string" || !state || typeof state !== "string") {
      return res.redirect(`${getFrontendUrl()}/admin?twitchBot=error&reason=missing_code_or_state`);
    }

    if (!twitchBotAuthService.validateState(state, adminUser._id.toString())) {
      return res.redirect(`${getFrontendUrl()}/admin?twitchBot=error&reason=invalid_state`);
    }

    await twitchBotAuthService.exchangeCodeAndStore(code, adminUser);
    res.redirect(`${getFrontendUrl()}/admin?twitchBot=connected`);
  } catch (error) {
    logger.error("Error in Twitch bot OAuth callback:", error);
    res.redirect(`${getFrontendUrl()}/admin?twitchBot=error&reason=callback_failed`);
  }
});

router.post("/twitch-bot/verify", async (_req: Request, res: Response) => {
  try {
    const user = await twitchBotAuthService.verifyCurrentUser();
    res.json({ success: true, user, status: await twitchChatBotService.getStatus() });
  } catch (error) {
    logger.error("Error verifying Twitch bot auth:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to verify Twitch bot authorization" });
  }
});

router.delete("/twitch-bot", async (_req: Request, res: Response) => {
  try {
    await twitchBotAuthService.disconnect();
    res.json({ success: true, message: "Twitch bot authorization disconnected" });
  } catch (error) {
    logger.error("Error disconnecting Twitch bot auth:", error);
    res.status(500).json({ error: "Failed to disconnect Twitch bot authorization" });
  }
});

type AdminTrackedTwitchGuild = {
  _id: unknown;
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
  isCurrentlyRaiding?: boolean;
  activityStatus?: "active" | "inactive";
  streamers?: Array<{
    channelName?: string;
    isLive?: boolean;
    isPlayingWoW?: boolean;
    gameName?: string;
    twitchUserId?: string;
    currentStreamId?: string;
    streamStartedAt?: Date;
    lastStreamId?: string;
    lastStreamStartedAt?: Date;
    lastStreamEndedAt?: Date;
    lastLiveAt?: Date;
    lastChecked?: Date;
  }>;
};

// List every Twitch channel currently configured on tracked guilds.
router.get("/twitch-streams", async (_req: Request, res: Response) => {
  try {
    const guilds = (await Guild.find({ "streamers.0": { $exists: true } })
      .select({
        name: 1,
        realm: 1,
        region: 1,
        parent_guild: 1,
        isCurrentlyRaiding: 1,
        activityStatus: 1,
        streamers: 1,
      })
      .sort({ name: 1, realm: 1 })
      .lean()) as AdminTrackedTwitchGuild[];

    const uniqueChannels = new Set<string>();
    const streams = guilds.flatMap((guild) =>
      (guild.streamers || [])
        .map((streamer) => {
          const channelName = streamer.channelName?.trim();
          if (!channelName) return null;

          uniqueChannels.add(channelName.toLowerCase());
          return {
            channelName,
            twitchUrl: `https://www.twitch.tv/${encodeURIComponent(channelName)}`,
            isLive: Boolean(streamer.isLive),
            isPlayingWoW: Boolean(streamer.isPlayingWoW),
            gameName: streamer.gameName,
            twitchUserId: streamer.twitchUserId,
            currentStreamId: streamer.currentStreamId,
            streamStartedAt: streamer.streamStartedAt,
            lastStreamId: streamer.lastStreamId,
            lastStreamStartedAt: streamer.lastStreamStartedAt,
            lastStreamEndedAt: streamer.lastStreamEndedAt,
            lastLiveAt: streamer.lastLiveAt,
            lastChecked: streamer.lastChecked,
            guild: {
              id: String(guild._id),
              name: guild.name,
              realm: guild.realm,
              region: guild.region,
              parentGuild: guild.parent_guild,
              isCurrentlyRaiding: Boolean(guild.isCurrentlyRaiding),
              activityStatus: guild.activityStatus || "active",
            },
          };
        })
        .filter((stream): stream is NonNullable<typeof stream> => stream !== null),
    );

    streams.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      if (a.isPlayingWoW !== b.isPlayingWoW) return a.isPlayingWoW ? -1 : 1;
      const channelCompare = a.channelName.localeCompare(b.channelName);
      if (channelCompare !== 0) return channelCompare;
      return a.guild.name.localeCompare(b.guild.name);
    });

    res.json({
      streams,
      stats: {
        total: streams.length,
        uniqueChannels: uniqueChannels.size,
        live: streams.filter((stream) => stream.isLive).length,
        livePlayingWoW: streams.filter((stream) => stream.isLive && stream.isPlayingWoW).length,
      },
    });
  } catch (error) {
    logger.error("Error fetching tracked Twitch streams:", error);
    res.status(500).json({ error: "Failed to fetch tracked Twitch streams" });
  }
});

router.post("/death-events/reset-failed-archived", async (req: Request, res: Response) => {
  try {
    const statuses = getAllowedDeathResetStatuses(req.body?.statuses);
    const shouldQueue = req.body?.queue !== false;
    const query = {
      reportEndTime: { $gt: 0 },
      deathEventsFetchStatus: { $in: statuses },
    };

    const guildIds = shouldQueue ? await Fight.distinct("guildId", query) : [];
    const resetResult = await Fight.updateMany(query, {
      $set: { deathEventsFetchStatus: "pending" },
      $unset: {
        deathEventsFetchFailedAt: 1,
        deathEventsFetchError: 1,
      },
    });

    let queued = 0;
    let skipped = 0;
    if (shouldQueue && guildIds.length > 0) {
      const guilds = await Guild.find({ _id: { $in: guildIds }, initialFetchCompleted: true });
      for (const guild of guilds) {
        try {
          await backgroundGuildProcessor.queueGuild(guild, 5, "rescan_deaths");
          queued++;
        } catch {
          skipped++;
        }
      }
    }

    res.json({
      success: true,
      message: `Reset ${resetResult.modifiedCount} death-event fight rows to pending${shouldQueue ? ` and queued ${queued} guilds` : ""}`,
      statuses,
      modifiedCount: resetResult.modifiedCount,
      matchedCount: resetResult.matchedCount,
      guildsMatched: guildIds.length,
      queued,
      skipped,
    });
  } catch (error) {
    logger.error("Error resetting failed/archived death event fetches:", error);
    res.status(500).json({ error: "Failed to reset failed/archived death event fetches" });
  }
});

// ============================================================
// USER MANAGEMENT
// ============================================================

// Get all users with pagination
router.get("/users", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.aggregate([
        { $sort: { lastLoginAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            "discord.id": 1,
            "discord.username": 1,
            "discord.avatar": 1,
            "twitch.displayName": 1,
            "twitch.connectedAt": 1,
            "battlenet.battletag": 1,
            "battlenet.connectedAt": 1,
            createdAt: 1,
            lastLoginAt: 1,
            pickemSubmissionCount: { $size: { $ifNull: ["$pickems", []] } },
          },
        },
      ]),
      User.countDocuments(),
    ]);

    // Format users for response (don't expose sensitive tokens)
    const formattedUsers = users.map((user) => ({
      id: user._id,
      discord: {
        id: user.discord.id,
        username: user.discord.username,
        hasAvatar: !!user.discord.avatar,
      },
      twitch: user.twitch
        ? {
            displayName: user.twitch.displayName,
            connectedAt: user.twitch.connectedAt,
          }
        : null,
      battlenet: user.battlenet
        ? {
            battletag: user.battlenet.battletag,
            connectedAt: user.battlenet.connectedAt,
          }
        : null,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      pickemSubmissionCount: user.pickemSubmissionCount,
    }));

    res.json({
      users: formattedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get user count stats
router.get("/users/stats", async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [total, activeDay, activeWeek, activeMonth, withTwitch, withBattlenet] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ lastLoginAt: { $gte: last24h } }),
      User.countDocuments({ lastLoginAt: { $gte: last7d } }),
      User.countDocuments({ lastLoginAt: { $gte: last30d } }),
      User.countDocuments({ twitch: { $exists: true } }),
      User.countDocuments({ battlenet: { $exists: true } }),
    ]);

    res.json({
      total,
      active: {
        last24Hours: activeDay,
        last7Days: activeWeek,
        last30Days: activeMonth,
      },
      connections: {
        twitch: withTwitch,
        battlenet: withBattlenet,
      },
    });
  } catch (error) {
    logger.error("Error fetching user stats:", error);
    res.status(500).json({ error: "Failed to fetch user stats" });
  }
});

// Get all pickem submissions for a specific user
router.get("/users/:userId/pickems", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!/^[a-fA-F0-9]{24}$/.test(userId)) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = await User.findById(userId).select({ pickems: 1 }).lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const pickemEntries = user.pickems || [];
    const pickemIds = [...new Set(pickemEntries.map((entry) => entry.pickemId))];

    const pickemConfigs =
      pickemIds.length > 0
        ? await Pickem.find({ pickemId: { $in: pickemIds } })
            .select({
              pickemId: 1,
              name: 1,
              type: 1,
              guildCount: 1,
              votingStart: 1,
              votingEnd: 1,
              active: 1,
              finalized: 1,
            })
            .lean()
        : [];

    const pickemConfigById = new Map(pickemConfigs.map((pickem) => [pickem.pickemId, pickem]));

    const submissions = pickemEntries.map((entry) => {
      const metadata = pickemConfigById.get(entry.pickemId);

      return {
        pickem: {
          id: metadata?.pickemId || entry.pickemId,
          name: metadata?.name || entry.pickemId,
          type: metadata?.type || "regular",
          guildCount: metadata?.guildCount ?? entry.predictions.length,
          votingStart: metadata?.votingStart || null,
          votingEnd: metadata?.votingEnd || null,
          active: metadata?.active ?? false,
          finalized: metadata?.finalized ?? false,
        },
        submittedAt: entry.submittedAt,
        updatedAt: entry.updatedAt,
        predictions: [...entry.predictions].sort((a, b) => a.position - b.position),
      };
    });

    res.json({
      userId: user._id.toString(),
      submissions,
    });
  } catch (error) {
    logger.error("Error fetching user pickem submissions:", error);
    res.status(500).json({ error: "Failed to fetch user pickem submissions" });
  }
});

// ============================================================
// GUILD MANAGEMENT
// ============================================================

function normalizeHorseRaceUmaImage(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120 || trimmed.includes("/") || trimmed.includes("\\") || !/^[a-z0-9][a-z0-9 .'-]*\.png$/i.test(trimmed)) return undefined;

  return trimmed;
}

// Get all guilds with pagination and optional search
router.get("/guilds", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string)?.trim() || "";
    const skip = (page - 1) * limit;

    // Build query with optional search filter
    const query: Record<string, unknown> = {};
    if (search) {
      // Search by guild name or realm (case-insensitive)
      query.$or = [{ name: { $regex: search, $options: "i" } }, { realm: { $regex: search, $options: "i" } }];
    }

    const [guilds, total] = await Promise.all([
      Guild.find(query)
        .select({
          name: 1,
          realm: 1,
          region: 1,
          faction: 1,
          warcraftlogsId: 1,
          horseRaceUmaImage: 1,
          parent_guild: 1,
          isCurrentlyRaiding: 1,
          lastFetched: 1,
          createdAt: 1,
          "progress.raidId": 1,
          "progress.raidName": 1,
          "progress.difficulty": 1,
          "progress.bossesDefeated": 1,
          "progress.totalBosses": 1,
        })
        .sort({ lastFetched: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Guild.countDocuments(query),
    ]);

    // Format guilds for response
    const formattedGuilds = guilds.map((guild) => ({
      id: guild._id,
      name: guild.name,
      realm: guild.realm,
      region: guild.region,
      faction: guild.faction,
      warcraftlogsId: guild.warcraftlogsId,
      horseRaceUmaImage: guild.horseRaceUmaImage,
      wclStatus: guild.wclStatus || "unknown",
      parentGuild: guild.parent_guild,
      isCurrentlyRaiding: guild.isCurrentlyRaiding,
      lastFetched: guild.lastFetched,
      createdAt: guild.createdAt,
      progress: guild.progress?.map((p: any) => ({
        raidName: p.raidName,
        difficulty: p.difficulty,
        bossesDefeated: p.bossesDefeated,
        totalBosses: p.totalBosses,
      })),
    }));

    res.json({
      guilds: formattedGuilds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Error fetching guilds:", error);
    res.status(500).json({ error: "Failed to fetch guilds" });
  }
});

// Get guild stats
router.get("/guilds/stats", async (req: Request, res: Response) => {
  try {
    const [total, currentlyRaiding, withWarcraftlogsId, factionCounts] = await Promise.all([
      Guild.countDocuments(),
      Guild.countDocuments({ isCurrentlyRaiding: true }),
      Guild.countDocuments({ warcraftlogsId: { $exists: true } }),
      Guild.aggregate([{ $group: { _id: "$faction", count: { $sum: 1 } } }]),
    ]);

    const factions: Record<string, number> = {};
    factionCounts.forEach((f: { _id: string; count: number }) => {
      factions[f._id || "unknown"] = f.count;
    });

    res.json({
      total,
      currentlyRaiding,
      withWarcraftlogsId,
      factions,
    });
  } catch (error) {
    logger.error("Error fetching guild stats:", error);
    res.status(500).json({ error: "Failed to fetch guild stats" });
  }
});

// Get detailed guild info
router.get("/guilds/:guildId", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId).lean();
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Get report count
    const reportCount = await Report.countDocuments({ guildId: guild._id });

    // Get fight count
    const fightCount = await Fight.countDocuments({ guildId: guild._id });

    // Get queue status if exists
    const queueItem = await GuildProcessingQueue.findOne({ guildId: guild._id }).lean();

    res.json({
      id: guild._id.toString(),
      name: guild.name,
      realm: guild.realm,
      region: guild.region,
      faction: guild.faction,
      warcraftlogsId: guild.warcraftlogsId,
      horseRaceUmaImage: guild.horseRaceUmaImage,
      parentGuild: guild.parent_guild,
      streamers: guild.streamers || [],
      isCurrentlyRaiding: guild.isCurrentlyRaiding,
      activityStatus: guild.activityStatus,
      lastFetched: guild.lastFetched,
      lastLogEndTime: guild.lastLogEndTime,
      createdAt: guild.createdAt,
      updatedAt: guild.updatedAt,
      wclStatus: guild.wclStatus || "unknown",
      wclStatusUpdatedAt: guild.wclStatusUpdatedAt,
      wclNotFoundCount: guild.wclNotFoundCount || 0,
      rioStatus: guild.rioStatus || "unknown",
      lastRioUpdate: guild.lastRioUpdate,
      progress: guild.progress || [],
      excludedRaidIds: guild.excludedRaidIds || [],
      reportCount,
      fightCount,
      queueStatus: queueItem
        ? {
            status: queueItem.status,
            progress: queueItem.progress,
            errorCount: queueItem.errorCount,
            lastError: queueItem.lastError,
            errorType: queueItem.errorType,
            isPermanentError: queueItem.isPermanentError,
            createdAt: queueItem.createdAt,
            startedAt: queueItem.startedAt,
            completedAt: queueItem.completedAt,
          }
        : null,
    });
  } catch (error) {
    logger.error("Error fetching guild details:", error);
    res.status(500).json({ error: "Failed to fetch guild details" });
  }
});

// Recalculate stats for single guild (queued to background worker)
router.post("/guilds/:guildId/recalculate-stats", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Queue for background worker instead of running in the API process
    const queueItem = await backgroundGuildProcessor.queueGuild(guild, 5, "recalculate_stats");

    res.json({
      success: true,
      message: `Statistics recalculation queued for ${guild.name}`,
      queueId: queueItem._id.toString(),
      status: queueItem.status,
    });
  } catch (error) {
    logger.error("Error triggering guild stats recalculation:", error);
    res.status(500).json({ error: "Failed to trigger statistics recalculation" });
  }
});

// Update world rankings for single guild (all raids)
router.post("/guilds/:guildId/update-world-ranks", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Run async
    guildService
      .updateGuildWorldRankings(guildId)
      .then(() => {
        logger.info(`Updated world rankings for guild: ${guild.name}`);
      })
      .catch((err) => logger.error(`Failed to update world ranks for ${guild.name}:`, err));

    res.json({
      success: true,
      message: `World rankings update started for ${guild.name}`,
    });
  } catch (error) {
    logger.error("Error triggering guild world ranks update:", error);
    res.status(500).json({ error: "Failed to trigger world rankings update" });
  }
});

// Queue guild for full rescan (WCL guilds go to queue, RIO-only guilds get direct RIO update)
router.post("/guilds/:guildId/queue-rescan", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // For guilds not found on WarcraftLogs, run Raider.IO update directly
    if (guild.wclStatus === "not_found") {
      logger.info(`[Admin] Running Raider.IO update for WCL-not-found guild: ${guild.name}-${guild.realm}`);
      const hasProgress = await guildService.updateGuildFromRaiderIO(guildId);
      return res.json({
        success: true,
        message: hasProgress
          ? `Guild ${guild.name} updated from Raider.IO with current-tier progress`
          : `Guild ${guild.name} updated from Raider.IO (no current-tier progress found)`,
        source: "raiderio",
      });
    }

    // Check if already in queue and processing with same job type
    const existingQueue = await GuildProcessingQueue.findOne({
      guildId: guild._id,
      jobType: "full_rescan",
      status: { $in: ["pending", "in_progress"] },
    });

    if (existingQueue) {
      return res.status(400).json({
        error: "Guild is already in the processing queue for full rescan",
        status: existingQueue.status,
      });
    }

    // Add to queue for full rescan
    const queueItem = await backgroundGuildProcessor.queueGuild(guild, 5, "full_rescan"); // Priority 5 = higher than normal

    res.json({
      success: true,
      message: `Guild ${guild.name} queued for rescan`,
      queueId: queueItem._id.toString(),
      status: queueItem.status,
    });
  } catch (error) {
    logger.error("Error queueing guild for rescan:", error);
    res.status(500).json({ error: "Failed to queue guild for rescan" });
  }
});

// Queue guild for death events rescan
router.post("/guilds/:guildId/queue-rescan-deaths", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const existingQueue = await GuildProcessingQueue.findOne({
      guildId: guild._id,
      jobType: "rescan_deaths",
      status: { $in: ["pending", "in_progress"] },
    });

    if (existingQueue) {
      return res.status(400).json({
        error: "Guild is already queued for death events rescan",
        status: existingQueue.status,
      });
    }

    const queueItem = await backgroundGuildProcessor.queueGuild(guild, 5, "rescan_deaths");

    res.json({
      success: true,
      message: `Guild ${guild.name} queued for death events rescan`,
      queueId: queueItem._id.toString(),
      status: queueItem.status,
    });
  } catch (error) {
    logger.error("Error queueing guild for death rescan:", error);
    res.status(500).json({ error: "Failed to queue guild for death events rescan" });
  }
});

// Queue guild for character rescan
router.post("/guilds/:guildId/queue-rescan-characters", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const existingQueue = await GuildProcessingQueue.findOne({
      guildId: guild._id,
      jobType: "rescan_characters",
      status: { $in: ["pending", "in_progress"] },
    });

    if (existingQueue) {
      return res.status(400).json({
        error: "Guild is already queued for character rescan",
        status: existingQueue.status,
      });
    }

    const queueItem = await backgroundGuildProcessor.queueGuild(guild, 5, "rescan_characters");

    res.json({
      success: true,
      message: `Guild ${guild.name} queued for character rescan`,
      queueId: queueItem._id.toString(),
      status: queueItem.status,
    });
  } catch (error) {
    logger.error("Error queueing guild for character rescan:", error);
    res.status(500).json({ error: "Failed to queue guild for character rescan" });
  }
});

// Queue guild for report-level character backfill
router.post("/guilds/:guildId/queue-backfill-report-characters", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const existingQueue = await GuildProcessingQueue.findOne({
      guildId: guild._id,
      jobType: "backfill_report_characters",
      status: { $in: ["pending", "in_progress"] },
    });

    if (existingQueue) {
      return res.status(400).json({
        error: "Guild is already queued for report character backfill",
        status: existingQueue.status,
      });
    }

    const queueItem = await backgroundGuildProcessor.queueGuild(guild, 5, "backfill_report_characters");

    res.json({
      success: true,
      message: `Guild ${guild.name} queued for report character backfill`,
      queueId: queueItem._id.toString(),
      status: queueItem.status,
    });
  } catch (error) {
    logger.error("Error queueing guild for report character backfill:", error);
    res.status(500).json({ error: "Failed to queue guild for report character backfill" });
  }
});

// Check if we have all reports (compare WCL vs database)
router.get("/guilds/:guildId/verify-reports", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Get our stored reports
    const storedReports = await Report.find({ guildId: guild._id }).select("code startTime endTime").lean();

    const storedReportCodes = new Set(storedReports.map((r) => r.code));

    // Fetch reports from WCL (just first page to get count/sample)
    try {
      const wclReports = await wclService.getGuildReports(
        guild.name,
        guild.realm.toLowerCase().replace(/\s+/g, "-"),
        guild.region.toLowerCase(),
        1, // page
        100, // limit
      );

      // Find reports in WCL that we don't have
      const missingReports = wclReports.data.filter((r: { code: string }) => !storedReportCodes.has(r.code));

      res.json({
        guildName: guild.name,
        storedReportCount: storedReports.length,
        wclReportCount: wclReports.total,
        wclSampleSize: wclReports.data.length,
        missingFromSample: missingReports.length,
        missingReportCodes: missingReports.map((r: { code: string }) => r.code).slice(0, 20), // First 20
        hasMorePages: wclReports.has_more_pages,
        isComplete: missingReports.length === 0 && !wclReports.has_more_pages,
        message:
          missingReports.length > 0
            ? `Found ${missingReports.length} missing reports in first ${wclReports.data.length} WCL reports`
            : wclReports.has_more_pages
              ? "No missing reports in sample, but more pages exist in WCL"
              : "All reports appear to be synced",
      });
    } catch (wclError) {
      const errorMessage = wclError instanceof Error ? wclError.message : "Unknown error";
      res.json({
        guildName: guild.name,
        storedReportCount: storedReports.length,
        wclReportCount: null,
        error: errorMessage,
        message: "Could not fetch reports from WarcraftLogs",
      });
    }
  } catch (error) {
    logger.error("Error verifying guild reports:", error);
    res.status(500).json({ error: "Failed to verify reports" });
  }
});

// Get all reports for a guild, grouped by raid tier with fight counts
router.get("/guilds/:guildId/reports", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId).lean();
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Fetch reports and raid metadata in parallel
    const [reports, raids] = await Promise.all([Report.find({ guildId: guild._id }).lean(), Raid.find({}).lean()]);

    const raidMap = new Map(raids.map((r) => [r.id, r.name]));

    // Aggregate fight counts by reportCode and difficulty in one query
    const fightAggregation = await Fight.aggregate([
      { $match: { guildId: guild._id } },
      {
        $group: {
          _id: { reportCode: "$reportCode", difficulty: "$difficulty" },
          total: { $sum: 1 },
          kills: { $sum: { $cond: ["$isKill", 1, 0] } },
        },
      },
    ]);

    // Build a lookup: reportCode -> { difficulty -> { total, kills } }
    const fightsByReport = new Map<string, Map<number, { total: number; kills: number }>>();
    for (const entry of fightAggregation) {
      const code = entry._id.reportCode;
      const diff = entry._id.difficulty;
      if (!fightsByReport.has(code)) {
        fightsByReport.set(code, new Map());
      }
      fightsByReport.get(code)!.set(diff, { total: entry.total, kills: entry.kills });
    }

    // Group reports by zoneId
    const groupedByZone = new Map<number, typeof reports>();
    for (const report of reports) {
      if (!groupedByZone.has(report.zoneId)) {
        groupedByZone.set(report.zoneId, []);
      }
      groupedByZone.get(report.zoneId)!.push(report);
    }

    // Build response
    const raidGroups = Array.from(groupedByZone.entries()).map(([zoneId, zoneReports]) => {
      // Sort by startTime descending (newest first)
      zoneReports.sort((a, b) => b.startTime - a.startTime);

      const enrichedReports = zoneReports.map((report) => {
        const diffMap = fightsByReport.get(report.code);
        const fightsByDifficulty: Record<string, { total: number; kills: number }> = {};
        let fightCount = 0;

        if (diffMap) {
          for (const [diff, counts] of diffMap.entries()) {
            fightsByDifficulty[String(diff)] = counts;
            fightCount += counts.total;
          }
        }

        return {
          id: report._id.toString(),
          code: report.code,
          startTime: report.startTime,
          endTime: report.endTime,
          fightCount,
          fightsByDifficulty,
          importSource: report.importSource,
          manualImportedAt: report.manualImportedAt,
          createdAt: report.createdAt,
          lastProcessed: report.lastProcessed,
        };
      });

      return {
        zoneId,
        raidName: raidMap.get(zoneId) || `Unknown Raid (${zoneId})`,
        reports: enrichedReports,
      };
    });

    res.json({
      guildName: guild.name,
      guildId: guild._id.toString(),
      raids: raidGroups,
      totalReports: reports.length,
    });
  } catch (error) {
    logger.error("Error fetching guild reports:", error);
    res.status(500).json({ error: "Failed to fetch guild reports" });
  }
});

// Import a specific Warcraft Logs report code and attribute it to this guild.
router.post("/guilds/:guildId/reports/import", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const reportCode = typeof req.body?.reportCode === "string" ? req.body.reportCode.trim() : "";

    if (!/^[a-zA-Z0-9]+$/.test(reportCode)) {
      return res.status(400).json({ error: "A valid report code is required" });
    }

    const adminUser = (req as any).user;
    const result = await guildService.importSpecificReportForGuild(guildId, reportCode, adminUser?._id);

    res.json({
      success: true,
      message: result.alreadyImported
        ? `Report ${result.reportCode} is already stored for ${result.guildName}`
        : `Report ${result.reportCode} imported for ${result.guildName} with ${result.trackedFightCount} tracked fights`,
      ...result,
    });
  } catch (error) {
    if (error instanceof GuildReportImportError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }

    logger.error("Error importing guild report:", error);
    res.status(500).json({ error: "Failed to import report" });
  }
});

// Delete a single report and all associated fights
router.delete("/guilds/:guildId/reports/:reportId", async (req: Request, res: Response) => {
  try {
    const { guildId, reportId } = req.params;

    const guild = await Guild.findById(guildId).lean();
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const report = await Report.findOne({ _id: reportId, guildId: guild._id });
    if (!report) {
      return res.status(404).json({ error: "Report not found for this guild" });
    }

    // Delete all fights and character appearances for this report, then the report itself
    const [fightDeleteResult, appearanceDeleteResult] = await Promise.all([
      Fight.deleteMany({
        reportCode: report.code,
        guildId: report.guildId,
      }),
      CharacterReportAppearance.deleteMany({
        reportCode: report.code,
        reportGuildId: report.guildId,
      }),
    ]);

    await Report.deleteOne({ _id: report._id });

    logger.info(`Deleted report ${report.code}, ${fightDeleteResult.deletedCount} fights, and ${appearanceDeleteResult.deletedCount} character appearances for guild ${guild.name}`);

    res.json({
      success: true,
      message: `Report ${report.code} deleted with ${fightDeleteResult.deletedCount} fights`,
      deletedFights: fightDeleteResult.deletedCount,
      reportCode: report.code,
    });
  } catch (error) {
    logger.error("Error deleting report:", error);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

// Create a new guild
router.post("/guilds", async (req: Request, res: Response) => {
  try {
    const { name, realm, region, parent_guild, streamers } = req.body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Guild name is required" });
    }
    if (!realm || typeof realm !== "string" || realm.trim().length === 0) {
      return res.status(400).json({ error: "Realm is required" });
    }
    if (!region || typeof region !== "string" || !["EU", "US", "KR", "TW", "CN"].includes(region.toUpperCase())) {
      return res.status(400).json({ error: "Valid region is required (EU, US, KR, TW, CN)" });
    }

    // Validate optional fields
    if (parent_guild !== undefined && parent_guild !== null && typeof parent_guild !== "string") {
      return res.status(400).json({ error: "Parent guild must be a string" });
    }
    if (streamers !== undefined && streamers !== null) {
      if (!Array.isArray(streamers)) {
        return res.status(400).json({ error: "Streamers must be an array of channel names" });
      }
      if (!streamers.every((s: unknown) => typeof s === "string")) {
        return res.status(400).json({ error: "All streamer entries must be strings" });
      }
    }

    const normalizedName = name.trim();
    const normalizedRealm = realm.trim();
    const normalizedRegion = region.toUpperCase();

    // Check if guild already exists
    const existingGuild = await Guild.findOne({
      name: { $regex: new RegExp(`^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      realm: { $regex: new RegExp(`^${normalizedRealm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      region: normalizedRegion,
    });

    if (existingGuild) {
      return res.status(409).json({
        error: "Guild already exists",
        existingGuildId: existingGuild._id.toString(),
      });
    }

    // Fetch guild crest and faction from Blizzard API
    let crest = null;
    let faction = undefined;
    try {
      const guildData = await blizzardService.getGuildData(normalizedName, normalizedRealm.toLowerCase().replace(/\s+/g, "-"), normalizedRegion.toLowerCase());
      if (guildData) {
        crest = guildData.crest;
        faction = guildData.faction;
      }
    } catch (crestError) {
      logger.warn(`Could not fetch crest for ${normalizedName}-${normalizedRealm}: ${crestError instanceof Error ? crestError.message : "Unknown error"}`);
    }

    // Format streamers array
    const formattedStreamers = streamers
      ? streamers.map((channelName: string) => ({
          channelName: channelName.trim().toLowerCase(),
          isLive: false,
          isPlayingWoW: false,
          gameName: null,
          lastChecked: null,
        }))
      : [];

    // Create the guild
    const newGuild = await Guild.create({
      name: normalizedName,
      realm: normalizedRealm,
      region: normalizedRegion,
      faction,
      parent_guild: parent_guild?.trim() || undefined,
      crest: crest || undefined,
      streamers: formattedStreamers,
      progress: [],
      isCurrentlyRaiding: false,
      activityStatus: "active",
      wclStatus: "unknown",
    });

    // Queue the guild for initial report processing
    const queueItem = await backgroundGuildProcessor.queueGuild(newGuild, 10);

    logger.info(`Admin created new guild: ${normalizedName}-${normalizedRealm} (${normalizedRegion}) - queued for processing`);

    res.status(201).json({
      success: true,
      message: `Guild ${normalizedName} created and queued for processing`,
      guild: {
        id: newGuild._id.toString(),
        name: newGuild.name,
        realm: newGuild.realm,
        region: newGuild.region,
        parentGuild: newGuild.parent_guild,
      },
      queueStatus: {
        id: queueItem._id.toString(),
        status: queueItem.status,
      },
    });
  } catch (error) {
    logger.error("Error creating guild:", error);
    res.status(500).json({ error: "Failed to create guild" });
  }
});

// Delete a guild and all associated data
router.delete("/guilds/:guildId", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { confirm } = req.query;

    // Require explicit confirmation
    if (confirm !== "true") {
      return res.status(400).json({
        error: "Deletion requires confirmation",
        message: "Add ?confirm=true to confirm deletion of guild and all associated data",
      });
    }

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const guildName = guild.name;
    const guildRealm = guild.realm;

    // Count associated data before deletion
    const [reportCount, fightCount, eventCount, queueCount, appearanceCount] = await Promise.all([
      Report.countDocuments({ guildId: guild._id }),
      Fight.countDocuments({ guildId: guild._id }),
      Event.countDocuments({ guildId: guild._id }),
      GuildProcessingQueue.countDocuments({ guildId: guild._id }),
      CharacterReportAppearance.countDocuments({ reportGuildId: guild._id }),
    ]);

    // Delete all associated data in parallel
    const [reportResult, fightResult, eventResult, queueResult, appearanceResult, tierListOverallResult, tierListRaidsResult] = await Promise.all([
      Report.deleteMany({ guildId: guild._id }),
      Fight.deleteMany({ guildId: guild._id }),
      Event.deleteMany({ guildId: guild._id }),
      GuildProcessingQueue.deleteMany({ guildId: guild._id }),
      CharacterReportAppearance.deleteMany({ reportGuildId: guild._id }),
      // Remove guild from tier list overall array
      TierList.updateMany({}, { $pull: { overall: { guildId: guild._id } } }),
      // Remove guild from tier list raid arrays
      TierList.updateMany({}, { $pull: { "raids.$[].guilds": { guildId: guild._id } } }),
    ]);

    // Delete the guild itself
    await Guild.deleteOne({ _id: guild._id });

    logger.info(
      `Admin deleted guild: ${guildName}-${guildRealm} (ID: ${guildId}). ` +
        `Removed: ${reportResult.deletedCount} reports, ${fightResult.deletedCount} fights, ` +
        `${eventResult.deletedCount} events, ${queueResult.deletedCount} queue items`,
    );

    res.json({
      success: true,
      message: `Guild ${guildName} and all associated data deleted`,
      deleted: {
        guild: { id: guildId, name: guildName, realm: guildRealm },
        reports: reportResult.deletedCount,
        fights: fightResult.deletedCount,
        events: eventResult.deletedCount,
        queueItems: queueResult.deletedCount,
        tierListEntriesModified: tierListOverallResult.modifiedCount + tierListRaidsResult.modifiedCount,
      },
    });
  } catch (error) {
    logger.error("Error deleting guild:", error);
    res.status(500).json({ error: "Failed to delete guild" });
  }
});

// Update a guild
router.put("/guilds/:guildId", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { parent_guild, streamers, activityStatus, horseRaceUmaImage } = req.body;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Validate and apply optional fields
    if (parent_guild !== undefined) {
      if (parent_guild !== null && typeof parent_guild !== "string") {
        return res.status(400).json({ error: "Parent guild must be a string or null" });
      }
      guild.parent_guild = parent_guild?.trim() || undefined;
    }

    if (streamers !== undefined) {
      if (!Array.isArray(streamers)) {
        return res.status(400).json({ error: "Streamers must be an array of channel names" });
      }
      if (!streamers.every((s: unknown) => typeof s === "string")) {
        return res.status(400).json({ error: "All streamer entries must be strings" });
      }
      guild.streamers = streamers.map((channelName: string) => ({
        channelName: channelName.trim().toLowerCase(),
        isLive: false,
        isPlayingWoW: false,
        gameName: undefined,
        lastChecked: undefined,
      }));
    }

    if (activityStatus !== undefined) {
      if (!["active", "inactive"].includes(activityStatus)) {
        return res.status(400).json({ error: "Activity status must be 'active' or 'inactive'" });
      }
      guild.activityStatus = activityStatus;
    }

    if (horseRaceUmaImage !== undefined) {
      const normalizedUmaImage = normalizeHorseRaceUmaImage(horseRaceUmaImage);
      if (normalizedUmaImage === undefined) {
        return res.status(400).json({ error: "Horse race Uma image must be a PNG filename or null" });
      }
      guild.horseRaceUmaImage = normalizedUmaImage || undefined;
    }

    await guild.save();
    cacheService.refreshCurrentRaidCaches().catch((error) => {
      logger.warn("Failed to refresh current raid caches after admin guild update:", error);
    });
    await cacheService.invalidateGuildSpecificCaches(guild.realm, guild.name).catch((error) => {
      logger.warn("Failed to invalidate guild-specific caches after admin guild update:", error);
    });

    logger.info(`Admin updated guild: ${guild.name}-${guild.realm} (ID: ${guildId})`);

    res.json({
      success: true,
      guild: {
        id: guild._id.toString(),
        name: guild.name,
        realm: guild.realm,
        region: guild.region,
        horseRaceUmaImage: guild.horseRaceUmaImage,
        parent_guild: guild.parent_guild,
        streamers: guild.streamers,
        activityStatus: guild.activityStatus,
      },
    });
  } catch (error) {
    logger.error("Error updating guild:", error);
    res.status(500).json({ error: "Failed to update guild" });
  }
});

// Toggle a raid tier exclusion for a guild
// When a guild is excluded from a raid tier, it is hidden from progress, tier lists, rankings, etc.
router.put("/guilds/:guildId/excluded-raids", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { raidId, excluded } = req.body;

    if (typeof raidId !== "number" || typeof excluded !== "boolean") {
      return res.status(400).json({ error: "raidId (number) and excluded (boolean) are required" });
    }

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Verify the raid exists
    const raid = await Raid.findOne({ id: raidId }).lean();
    if (!raid) {
      return res.status(404).json({ error: "Raid not found" });
    }

    const currentExcluded = guild.excludedRaidIds || [];

    if (excluded) {
      // Add raid to exclusion list (if not already there)
      if (!currentExcluded.includes(raidId)) {
        guild.excludedRaidIds = [...currentExcluded, raidId];
      }
    } else {
      // Remove raid from exclusion list
      guild.excludedRaidIds = currentExcluded.filter((id) => id !== raidId);
    }

    await guild.save();

    logger.info(`Admin toggled raid exclusion for guild ${guild.name}-${guild.realm}: raid ${raidId} (${raid.name}) excluded=${excluded}`);

    res.json({
      success: true,
      guild: {
        id: guild._id.toString(),
        name: guild.name,
        realm: guild.realm,
      },
      excludedRaidIds: guild.excludedRaidIds || [],
    });
  } catch (error) {
    logger.error("Error updating guild raid exclusions:", error);
    res.status(500).json({ error: "Failed to update guild raid exclusions" });
  }
});

// Get guild deletion preview (shows what will be deleted)
router.get("/guilds/:guildId/delete-preview", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Count associated data
    const [reportCount, fightCount, eventCount, queueItem] = await Promise.all([
      Report.countDocuments({ guildId: guild._id }),
      Fight.countDocuments({ guildId: guild._id }),
      Event.countDocuments({ guildId: guild._id }),
      GuildProcessingQueue.findOne({ guildId: guild._id }).lean(),
    ]);

    res.json({
      guild: {
        id: guildId,
        name: guild.name,
        realm: guild.realm,
        region: guild.region,
      },
      willBeDeleted: {
        reports: reportCount,
        fights: fightCount,
        events: eventCount,
        queueItem: queueItem ? 1 : 0,
        tierListEntries: "Guild will be removed from all tier lists",
      },
      warning: "This action cannot be undone. The guild and all associated data will be permanently deleted.",
    });
  } catch (error) {
    logger.error("Error getting guild deletion preview:", error);
    res.status(500).json({ error: "Failed to get deletion preview" });
  }
});

// ============================================================
// ANALYTICS (moved from public analytics routes)
// ============================================================

// Helper to format bytes to human readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Get overview stats (last 24 hours, 7 days, 30 days)
router.get("/analytics/overview", async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [stats24h, stats7d, stats30d] = await Promise.all([
      HourlyStats.aggregate([
        { $match: { hour: { $gte: last24h } } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: "$totalRequests" },
            totalResponseTime: { $sum: "$totalResponseTime" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
      HourlyStats.aggregate([
        { $match: { hour: { $gte: last7d } } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: "$totalRequests" },
            totalResponseTime: { $sum: "$totalResponseTime" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
      HourlyStats.aggregate([
        { $match: { hour: { $gte: last30d } } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: "$totalRequests" },
            totalResponseTime: { $sum: "$totalResponseTime" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
    ]);

    const formatPeriodStats = (stats: Array<{ totalRequests: number; totalResponseTime: number; totalDataTransferred: number }>) => {
      if (!stats || stats.length === 0) {
        return { totalRequests: 0, avgResponseTime: 0, totalDataTransferred: 0, formattedData: "0 B" };
      }
      const s = stats[0];
      return {
        totalRequests: s.totalRequests || 0,
        avgResponseTime: s.totalRequests > 0 ? Math.round(s.totalResponseTime / s.totalRequests) : 0,
        totalDataTransferred: s.totalDataTransferred || 0,
        formattedData: formatBytes(s.totalDataTransferred || 0),
      };
    };

    res.json({
      last24Hours: formatPeriodStats(stats24h),
      last7Days: formatPeriodStats(stats7d),
      last30Days: formatPeriodStats(stats30d),
    });
  } catch (error) {
    logger.error("Error fetching analytics overview:", error);
    res.status(500).json({ error: "Failed to fetch analytics overview" });
  }
});

// Get daily breakdown
router.get("/analytics/daily", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const dailyStats = await HourlyStats.aggregate([
      { $match: { hour: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$hour" },
          },
          totalRequests: { $sum: "$totalRequests" },
          totalResponseTime: { $sum: "$totalResponseTime" },
          totalDataTransferred: { $sum: "$totalDataTransferred" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const formatted = dailyStats.map((stat) => ({
      date: stat._id,
      requests: stat.totalRequests,
      avgResponseTime: stat.totalRequests > 0 ? Math.round(stat.totalResponseTime / stat.totalRequests) : 0,
      dataTransferred: stat.totalDataTransferred,
      formattedData: formatBytes(stat.totalDataTransferred),
    }));

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching daily analytics:", error);
    res.status(500).json({ error: "Failed to fetch daily analytics" });
  }
});

// Get endpoint statistics
router.get("/analytics/endpoints", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const endpointStats = await RequestLog.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: "$endpoint",
          count: { $sum: 1 },
          totalResponseTime: { $sum: "$responseTime" },
          avgResponseTime: { $avg: "$responseTime" },
          errorCount: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);

    const formatted = endpointStats.map((stat) => ({
      endpoint: stat._id,
      count: stat.count,
      avgResponseTime: Math.round(stat.avgResponseTime),
      errorCount: stat.errorCount,
    }));

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching endpoint analytics:", error);
    res.status(500).json({ error: "Failed to fetch endpoint analytics" });
  }
});

// Get realtime stats
router.get("/analytics/realtime", async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const currentHourStart = new Date(now);
    currentHourStart.setMinutes(0, 0, 0);

    const lastMinute = new Date(now.getTime() - 60 * 1000);

    const [currentHourStats, lastMinuteCount] = await Promise.all([
      HourlyStats.findOne({ hour: currentHourStart }),
      RequestLog.countDocuments({ timestamp: { $gte: lastMinute } }),
    ]);

    res.json({
      currentHour: {
        requests: currentHourStats?.totalRequests || 0,
        avgResponseTime: currentHourStats?.totalRequests ? Math.round(currentHourStats.totalResponseTime / currentHourStats.totalRequests) : 0,
        dataTransferred: formatBytes(currentHourStats?.totalDataTransferred || 0),
      },
      requestsPerMinute: lastMinuteCount,
    });
  } catch (error) {
    logger.error("Error fetching realtime analytics:", error);
    res.status(500).json({ error: "Failed to fetch realtime analytics" });
  }
});

// ============================================================
// DATABASE OVERVIEW
// ============================================================

// Get database overview
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const [userCount, guildCount, recentLogins, recentGuildUpdates] = await Promise.all([
      User.countDocuments(),
      Guild.countDocuments(),
      User.countDocuments({
        lastLoginAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
      Guild.countDocuments({
        lastFetched: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ]);

    res.json({
      users: {
        total: userCount,
        activeToday: recentLogins,
      },
      guilds: {
        total: guildCount,
        updatedToday: recentGuildUpdates,
      },
    });
  } catch (error) {
    logger.error("Error fetching admin overview:", error);
    res.status(500).json({ error: "Failed to fetch overview" });
  }
});

// ============================================================
// PICKEM MANAGEMENT
// ============================================================

// Get all pickems (including inactive ones)
router.get("/pickems", async (req: Request, res: Response) => {
  try {
    const pickems = await pickemService.getAllPickems();
    const stats = await pickemService.getPickemStats();

    res.json({
      pickems,
      stats,
    });
  } catch (error) {
    logger.error("Error fetching pickems:", error);
    res.status(500).json({ error: "Failed to fetch pickems" });
  }
});

// Get a specific pickem by ID
router.get("/pickems/:pickemId", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const pickem = await pickemService.getPickemById(pickemId);

    if (!pickem) {
      return res.status(404).json({ error: "Pickem not found" });
    }

    res.json(pickem);
  } catch (error) {
    logger.error("Error fetching pickem:", error);
    res.status(500).json({ error: "Failed to fetch pickem" });
  }
});

// Create a new pickem
router.post("/pickems", async (req: Request, res: Response) => {
  try {
    const { pickemId, name, raidIds, votingStart, votingEnd, active, scoringConfig, streakConfig, prizeConfig, type, guildCount, finalRankingsCount, scoreOutOfRangeGuilds } = req.body;

    // Determine pickem type (default to 'regular' for backwards compatibility)
    const pickemType = type === "rwf" ? "rwf" : "regular";

    // Validate required fields (raidIds only required for regular pickems)
    if (!pickemId || !name || !votingStart || !votingEnd) {
      return res.status(400).json({
        error: "Missing required fields: pickemId, name, votingStart, votingEnd",
      });
    }

    // Validate raidIds for regular pickems
    if (pickemType === "regular") {
      if (!raidIds || !Array.isArray(raidIds) || raidIds.length === 0) {
        return res.status(400).json({ error: "raidIds must be a non-empty array for regular pickems" });
      }
    }

    // Validate pickemId format (alphanumeric with dashes)
    if (!/^[a-z0-9-]+$/.test(pickemId)) {
      return res.status(400).json({
        error: "pickemId must contain only lowercase letters, numbers, and dashes",
      });
    }

    // Validate dates
    const startDate = new Date(votingStart);
    const endDate = new Date(votingEnd);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    if (startDate >= endDate) {
      return res.status(400).json({ error: "votingEnd must be after votingStart" });
    }

    // Validate guildCount if provided
    const finalGuildCount = guildCount ?? 10;
    if (typeof finalGuildCount !== "number" || finalGuildCount < 1 || finalGuildCount > 25) {
      return res.status(400).json({ error: "guildCount must be a number between 1 and 25" });
    }

    const finalFinalRankingsCount = finalRankingsCount ?? 0;
    if (typeof finalFinalRankingsCount !== "number" || finalFinalRankingsCount < 0 || finalFinalRankingsCount > 25) {
      return res.status(400).json({ error: "finalRankingsCount must be a number between 0 and 25" });
    }

    const pickem = await pickemService.createPickem({
      pickemId,
      name,
      raidIds: pickemType === "regular" ? raidIds : [],
      votingStart: startDate,
      votingEnd: endDate,
      active: active ?? true,
      scoringConfig,
      streakConfig,
      prizeConfig,
      type: pickemType,
      guildCount: finalGuildCount,
      finalRankingsCount: finalFinalRankingsCount,
      scoreOutOfRangeGuilds: pickemType === "regular" ? scoreOutOfRangeGuilds === true : false,
    });

    res.status(201).json(pickem);
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({ error: "A pickem with this ID already exists" });
    }
    logger.error("Error creating pickem:", error);
    res.status(500).json({ error: "Failed to create pickem" });
  }
});

// Update an existing pickem
router.put("/pickems/:pickemId", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const updates = req.body;

    // Don't allow changing the pickemId or type (type changes could break existing predictions)
    delete updates.pickemId;
    delete updates.type;

    // Validate dates if provided
    if (updates.votingStart) {
      updates.votingStart = new Date(updates.votingStart);
      if (isNaN(updates.votingStart.getTime())) {
        return res.status(400).json({ error: "Invalid votingStart date format" });
      }
    }
    if (updates.votingEnd) {
      updates.votingEnd = new Date(updates.votingEnd);
      if (isNaN(updates.votingEnd.getTime())) {
        return res.status(400).json({ error: "Invalid votingEnd date format" });
      }
    }

    // Validate guildCount if provided
    if (updates.guildCount !== undefined) {
      if (typeof updates.guildCount !== "number" || updates.guildCount < 1 || updates.guildCount > 25) {
        return res.status(400).json({ error: "guildCount must be a number between 1 and 25" });
      }
    }

    if (updates.finalRankingsCount !== undefined) {
      if (typeof updates.finalRankingsCount !== "number" || updates.finalRankingsCount < 0 || updates.finalRankingsCount > 25) {
        return res.status(400).json({ error: "finalRankingsCount must be a number between 0 and 25" });
      }
    }

    if (updates.scoreOutOfRangeGuilds !== undefined && typeof updates.scoreOutOfRangeGuilds !== "boolean") {
      return res.status(400).json({ error: "scoreOutOfRangeGuilds must be a boolean" });
    }

    const pickem = await pickemService.updatePickem(pickemId, updates);

    if (!pickem) {
      return res.status(404).json({ error: "Pickem not found" });
    }

    await cacheService.invalidate(cacheService.getPickemLeaderboardKey(pickemId));
    await cacheService.invalidate(cacheService.getPickemRankingsKey(pickemId));
    await cacheService.invalidate("pickems:list");

    res.json(pickem);
  } catch (error) {
    logger.error("Error updating pickem:", error);
    res.status(500).json({ error: "Failed to update pickem" });
  }
});

// Delete a pickem
router.delete("/pickems/:pickemId", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const result = await pickemService.deletePickem(pickemId);

    if (!result) {
      return res.status(404).json({ error: "Pickem not found" });
    }

    res.json({ success: true, message: "Pickem deleted" });
  } catch (error) {
    logger.error("Error deleting pickem:", error);
    res.status(500).json({ error: "Failed to delete pickem" });
  }
});

// Toggle pickem active status
router.patch("/pickems/:pickemId/toggle", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const pickem = await pickemService.getPickemById(pickemId);

    if (!pickem) {
      return res.status(404).json({ error: "Pickem not found" });
    }

    const updated = await pickemService.updatePickem(pickemId, { active: !pickem.active });
    res.json(updated);
  } catch (error) {
    logger.error("Error toggling pickem:", error);
    res.status(500).json({ error: "Failed to toggle pickem" });
  }
});

// Finalize an RWF pickem with final rankings
router.post("/pickems/:pickemId/finalize", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const { finalRankings } = req.body;

    // Check pickem type to determine finalization path
    const pickem = await pickemService.getPickemById(pickemId);
    if (!pickem) {
      return res.status(404).json({ error: "Pickem not found" });
    }

    if (pickem.type === "rwf") {
      // RWF pickems require finalRankings
      if (!Array.isArray(finalRankings) || finalRankings.length === 0) {
        return res.status(400).json({ error: "finalRankings must be a non-empty array of guild names" });
      }

      if (!finalRankings.every((g: unknown) => typeof g === "string")) {
        return res.status(400).json({ error: "All items in finalRankings must be strings" });
      }

      const result = await pickemService.finalizeRwfPickem(pickemId, finalRankings);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, pickem: result.pickem });
    } else {
      // Regular pickems just get marked as finalized (rankings come from live data)
      const result = await pickemService.finalizeRegularPickem(pickemId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, pickem: result.pickem });
    }
  } catch (error) {
    logger.error("Error finalizing pickem:", error);
    res.status(500).json({ error: "Failed to finalize pickem" });
  }
});

// Unfinalize a pickem (admin correction) - works for both RWF and regular
router.post("/pickems/:pickemId/unfinalize", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;

    const result = await pickemService.unfinalizePickem(pickemId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, pickem: result.pickem });
  } catch (error) {
    logger.error("Error unfinalizing pickem:", error);
    res.status(500).json({ error: "Failed to unfinalize pickem" });
  }
});

// ============================================================
// RATE LIMIT MONITORING
// ============================================================

// Get current rate limit status
router.get("/rate-limit", async (req: Request, res: Response) => {
  try {
    const status = await rateLimitService.getSharedStatus();
    const config = rateLimitService.getConfig();

    res.json({
      status,
      config,
    });
  } catch (error) {
    logger.error("Error fetching rate limit status:", error);
    res.status(500).json({ error: "Failed to fetch rate limit status" });
  }
});

// Toggle manual pause for background processing
router.post("/rate-limit/pause", async (req: Request, res: Response) => {
  try {
    const { paused } = req.body;

    if (typeof paused !== "boolean") {
      return res.status(400).json({ error: "paused must be a boolean" });
    }

    await rateLimitService.setManualPause(paused);

    res.json({
      success: true,
      isPaused: paused,
      status: await rateLimitService.getSharedStatus(),
    });
  } catch (error) {
    logger.error("Error toggling rate limit pause:", error);
    res.status(500).json({ error: "Failed to toggle rate limit pause" });
  }
});

// ============================================================
// CHARACTER RANKING BACKFILL
// ============================================================

router.get("/character-ranking-backfill/status", async (req: Request, res: Response) => {
  try {
    const status = await characterRankingBackfillService.getStatus();
    res.json(status);
  } catch (error) {
    logger.error("Error fetching character ranking backfill status:", error);
    res.status(500).json({ error: "Failed to fetch character ranking backfill status" });
  }
});

router.get("/mythic-plus-crawler/status", async (_req: Request, res: Response) => {
  try {
    const status = await mythicPlusService.getStatus();
    res.json(status);
  } catch (error) {
    logger.error("Error fetching Mythic+ crawler status:", error);
    res.status(500).json({ error: "Failed to fetch Mythic+ crawler status" });
  }
});

// ============================================================
// CHARACTER ACHIEVEMENT ACCOUNT MATCHING
// ============================================================

router.get("/character-achievement-backfill/status", async (req: Request, res: Response) => {
  try {
    const status = await characterAchievementService.getStatus();
    res.json(status);
  } catch (error) {
    logger.error("Error fetching character achievement backfill status:", error);
    res.status(500).json({ error: "Failed to fetch character achievement backfill status" });
  }
});

// ============================================================
// GUILD PROCESSING QUEUE
// ============================================================

// Get processing queue status and statistics
router.get("/processing-queue/stats", async (req: Request, res: Response) => {
  try {
    const stats = await backgroundGuildProcessor.getQueueStats();
    const processorStatus = backgroundGuildProcessor.getStatus();

    // Get error breakdown by type
    const errorBreakdown = await GuildProcessingQueue.aggregate([
      {
        $match: {
          lastError: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$errorType",
          count: { $sum: 1 },
        },
      },
    ]);

    const errorsByType: Record<string, number> = {};
    for (const item of errorBreakdown) {
      errorsByType[item._id || "unknown"] = item.count;
    }

    res.json({
      processor: processorStatus,
      queue: stats,
      errorsByType,
    });
  } catch (error) {
    logger.error("Error fetching processing queue stats:", error);
    res.status(500).json({ error: "Failed to fetch processing queue stats" });
  }
});

// Get processing queue items with errors
router.get("/processing-queue/errors", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const errorType = req.query.errorType as string | undefined;
    const skip = (page - 1) * limit;

    // Build query for items with errors
    const query: Record<string, unknown> = {
      lastError: { $exists: true, $ne: null },
    };

    if (errorType) {
      query.errorType = errorType;
    }

    const [items, total] = await Promise.all([
      GuildProcessingQueue.find(query)
        .select({
          guildId: 1,
          guildName: 1,
          guildRealm: 1,
          guildRegion: 1,
          jobType: 1,
          status: 1,
          errorType: 1,
          isPermanentError: 1,
          failureReason: 1,
          lastError: 1,
          lastErrorAt: 1,
          errorCount: 1,
        })
        .sort({ lastErrorAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      GuildProcessingQueue.countDocuments(query),
    ]);

    const formattedItems = items.map((item) => ({
      id: item._id.toString(),
      guildName: item.guildName,
      guildRealm: item.guildRealm,
      guildRegion: item.guildRegion,
      jobType: item.jobType || "full_rescan",
      status: item.status,
      errorType: item.errorType || "unknown",
      isPermanentError: item.isPermanentError || false,
      failureReason: item.failureReason,
      lastError: item.lastError,
      lastErrorAt: item.lastErrorAt,
      errorCount: item.errorCount,
    }));

    res.json({
      items: formattedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Error fetching processing queue errors:", error);
    res.status(500).json({ error: "Failed to fetch processing queue errors" });
  }
});

// Get processing queue items
router.get("/processing-queue", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as ProcessingStatus | undefined;

    const result = await backgroundGuildProcessor.getQueueItems(page, limit, status);

    res.json({
      items: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    logger.error("Error fetching processing queue:", error);
    res.status(500).json({ error: "Failed to fetch processing queue" });
  }
});

// Pause/Resume all background processing
router.post("/processing-queue/pause-all", async (req: Request, res: Response) => {
  try {
    const { paused } = req.body;

    if (typeof paused !== "boolean") {
      return res.status(400).json({ error: "paused must be a boolean" });
    }

    if (paused) {
      await backgroundGuildProcessor.pauseAll();
    } else {
      await backgroundGuildProcessor.resumeAll();
    }

    res.json({
      success: true,
      processor: backgroundGuildProcessor.getStatus(),
    });
  } catch (error) {
    logger.error("Error toggling processing queue pause:", error);
    res.status(500).json({ error: "Failed to toggle processing queue pause" });
  }
});

// Pause a specific guild's processing
router.post("/processing-queue/:guildId/pause", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const success = await backgroundGuildProcessor.pauseGuild(guildId);

    if (!success) {
      return res.status(404).json({ error: "Guild not found in processing queue or not in pausable state" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error pausing guild processing:", error);
    res.status(500).json({ error: "Failed to pause guild processing" });
  }
});

// Resume a specific guild's processing
router.post("/processing-queue/:guildId/resume", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const success = await backgroundGuildProcessor.resumeGuild(guildId);

    if (!success) {
      return res.status(404).json({ error: "Guild not found in processing queue or not in resumable state" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error resuming guild processing:", error);
    res.status(500).json({ error: "Failed to resume guild processing" });
  }
});

// Retry a failed guild's processing
router.post("/processing-queue/:guildId/retry", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const success = await backgroundGuildProcessor.retryGuild(guildId);

    if (!success) {
      return res.status(404).json({ error: "Guild not found in processing queue or not in failed state" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error retrying guild processing:", error);
    res.status(500).json({ error: "Failed to retry guild processing" });
  }
});

// Clear all completed guilds from the processing queue
// NOTE: This route MUST be defined before the parameterized /:guildId route
router.delete("/processing-queue/clear-completed", async (req: Request, res: Response) => {
  try {
    const result = await GuildProcessingQueue.deleteMany({ status: "completed" });

    logger.info(`Cleared ${result.deletedCount} completed guilds from processing queue`);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Cleared ${result.deletedCount} completed guilds from the queue`,
    });
  } catch (error) {
    logger.error("Error clearing completed guilds from processing queue:", error);
    res.status(500).json({ error: "Failed to clear completed guilds" });
  }
});

// Clear all guilds from the processing queue
// NOTE: This route MUST be defined before the parameterized /:guildId route
router.delete("/processing-queue/clear-all", async (req: Request, res: Response) => {
  try {
    const result = await GuildProcessingQueue.deleteMany({});

    logger.info(`Cleared ${result.deletedCount} guilds from processing queue`);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Cleared ${result.deletedCount} guilds from the queue`,
    });
  } catch (error) {
    logger.error("Error clearing all guilds from processing queue:", error);
    res.status(500).json({ error: "Failed to clear processing queue" });
  }
});

// Clear errors from failed guilds (reset them to pending for retry, or optionally remove them)
// NOTE: This route MUST be defined before the parameterized /:guildId route
router.delete("/processing-queue/clear-errors", async (req: Request, res: Response) => {
  try {
    const { action = "reset" } = req.query; // "reset" or "remove"

    if (action === "remove") {
      // Remove all failed guilds from the queue
      const result = await GuildProcessingQueue.deleteMany({ status: "failed" });

      logger.info(`Removed ${result.deletedCount} failed guilds from processing queue`);

      res.json({
        success: true,
        deletedCount: result.deletedCount,
        message: `Removed ${result.deletedCount} failed guilds from the queue`,
      });
    } else {
      // Reset failed guilds to pending and clear error state
      const result = await GuildProcessingQueue.updateMany(
        { status: "failed" },
        {
          $set: {
            status: "pending",
            errorType: null,
            isPermanentError: false,
            failureReason: null,
            lastError: null,
            lastErrorAt: null,
            errorCount: 0,
          },
        },
      );

      logger.info(`Reset ${result.modifiedCount} failed guilds in processing queue`);

      res.json({
        success: true,
        modifiedCount: result.modifiedCount,
        message: `Reset ${result.modifiedCount} failed guilds for retry`,
      });
    }
  } catch (error) {
    logger.error("Error clearing errors from processing queue:", error);
    res.status(500).json({ error: "Failed to clear errors" });
  }
});

// Remove a guild from the processing queue
router.delete("/processing-queue/:guildId", async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const success = await backgroundGuildProcessor.removeFromQueue(guildId);

    if (!success) {
      return res.status(404).json({ error: "Guild not found in processing queue" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error removing guild from processing queue:", error);
    res.status(500).json({ error: "Failed to remove guild from processing queue" });
  }
});

// Manually queue a guild for processing
router.post("/processing-queue/queue-guild", async (req: Request, res: Response) => {
  try {
    const { guildId, priority } = req.body;

    if (!guildId) {
      return res.status(400).json({ error: "guildId is required" });
    }

    const guild = await Guild.findById(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const queueItem = await backgroundGuildProcessor.queueGuild(guild, priority || 10);

    res.json({
      success: true,
      queueItem: {
        id: queueItem._id,
        guildName: queueItem.guildName,
        guildRealm: queueItem.guildRealm,
        status: queueItem.status,
        priority: queueItem.priority,
      },
    });
  } catch (error) {
    logger.error("Error queueing guild for processing:", error);
    res.status(500).json({ error: "Failed to queue guild for processing" });
  }
});

// Get tracked raids list for admin dropdown
router.get("/raids", async (req: Request, res: Response) => {
  try {
    const { TRACKED_RAIDS, CURRENT_RAID_IDS, PRIMARY_RAID_ID } = await import("../config/guilds");
    const { compareRaidsByPriority } = await import("../utils/raidPriority");
    const raids = await Raid.find({ id: { $in: TRACKED_RAIDS } })
      .select("id name slug expansion partitions")
      .lean();

    res.json({
      raids: [...raids].sort(compareRaidsByPriority).map((r) => ({
        id: r.id,
        name: r.name,
        isCurrent: CURRENT_RAID_IDS.includes(r.id),
        isPrimary: r.id === PRIMARY_RAID_ID,
        partitions: (r.partitions || []).map((p: { id: number; name: string }) => ({
          id: p.id,
          name: p.name,
        })),
      })),
    });
  } catch (error) {
    logger.error("Error fetching admin raids:", error);
    res.status(500).json({ error: "Failed to fetch raids" });
  }
});

// ============================================================
// MANUAL TRIGGER ENDPOINTS
// ============================================================

// Trigger raid metadata sync from WarcraftLogs
router.post("/trigger/sync-raids-from-wcl", async (_req: Request, res: Response) => {
  try {
    if (isSyncingRaidsFromWCL) {
      res.status(409).json({ error: "Raid sync from WarcraftLogs is already running" });
      return;
    }

    isSyncingRaidsFromWCL = true;
    const taskId = await taskTracker.start("Sync Raids From WarcraftLogs");

    void (async () => {
      try {
        await guildService.syncRaidsFromWCL(true);
        await cacheService.invalidate(cacheService.getRaidsKey());
        await cacheService.invalidate(cacheService.getHomeKey());
        await cacheService.invalidate(cacheService.getCharacterRankingsOptionsKey());
        await cacheService.invalidate("character-mechanics:options:v1");
        await cacheService.invalidatePattern(/^raid:\d+:/);
        await taskTracker.complete(taskId);
        logger.info("Sync raids from WarcraftLogs completed");
      } catch (err) {
        logger.error("Sync raids from WarcraftLogs failed:", err);
        await taskTracker.fail(taskId, err instanceof Error ? err.message : String(err));
      } finally {
        isSyncingRaidsFromWCL = false;
      }
    })();

    res.json({ success: true, message: "Raid sync from WarcraftLogs started" });
  } catch (error) {
    isSyncingRaidsFromWCL = false;
    logger.error("Error triggering raid sync from WarcraftLogs:", error);
    res.status(500).json({ error: "Failed to trigger raid sync from WarcraftLogs" });
  }
});

// Trigger recalculation of statistics for ALL guilds
// Body: { raidId?: number, scope?: "all" | "current" }
router.post("/trigger/calculate-all-statistics", async (req: Request, res: Response) => {
  try {
    const raidId = req.body.raidId ? Number(req.body.raidId) : undefined;
    const scope: string = req.body.scope || "current";

    if (guildService.isExistingGuildStatisticsRecalculationRunning()) {
      res.status(409).json({ error: "Statistics recalculation is already running" });
      return;
    }

    // Determine recalculation mode
    const currentTierOnly = raidId ? true : scope === "current";
    const raidIds = raidId ? [raidId] : undefined;

    // Run async - don't wait for completion
    guildService
      .recalculateExistingGuildStatistics(currentTierOnly, raidIds)
      .then(() => logger.info("Calculate all statistics completed"))
      .catch((err) => logger.error("Calculate all statistics failed:", err));

    const label = raidId
      ? `Statistics recalculation started for raid ${raidId}`
      : scope === "all"
        ? "Statistics recalculation started for all raids"
        : "Statistics recalculation started for current tier";

    res.json({ success: true, message: label });
  } catch (error) {
    logger.error("Error triggering statistics calculation:", error);
    res.status(500).json({ error: "Failed to trigger statistics calculation" });
  }
});

// Trigger tier list calculation
router.post("/trigger/calculate-tier-lists", async (req: Request, res: Response) => {
  try {
    const raidId = req.body.raidId ? Number(req.body.raidId) : undefined;

    scheduler
      .calculateTierLists(raidId)
      .then(() => logger.info("Calculate tier lists completed"))
      .catch((err) => logger.error("Calculate tier lists failed:", err));

    res.json({
      success: true,
      message: raidId ? `Tier list calculation started for raid ${raidId}` : "Tier list calculation started for all raids",
    });
  } catch (error) {
    logger.error("Error triggering tier list calculation:", error);
    res.status(500).json({ error: "Failed to trigger tier list calculation" });
  }
});

// Trigger Twitch stream status check
router.post("/trigger/check-twitch-streams", async (req: Request, res: Response) => {
  try {
    scheduler
      .updateTwitchStreamStatus()
      .then(() => logger.info("Check Twitch streams completed"))
      .catch((err) => logger.error("Check Twitch streams failed:", err));

    res.json({ success: true, message: "Twitch stream check started" });
  } catch (error) {
    logger.error("Error triggering Twitch stream check:", error);
    res.status(500).json({ error: "Failed to trigger Twitch stream check" });
  }
});

router.post("/trigger/twitch-bot/reconnect", async (_req: Request, res: Response) => {
  try {
    await twitchChatBotService.reconnect();
    res.json({ success: true, message: "Twitch bot reconnect requested" });
  } catch (error) {
    logger.error("Error reconnecting Twitch bot:", error);
    res.status(500).json({ error: "Failed to reconnect Twitch bot" });
  }
});

router.post("/trigger/twitch-bot/reconcile", async (_req: Request, res: Response) => {
  try {
    const result = await twitchChatBotService.reconcileChannels();
    res.json({
      success: true,
      message: `Twitch bot reconciled ${result.joinedChannels.length}/${result.desiredChannels.length} channels`,
      ...result,
    });
  } catch (error) {
    logger.error("Error reconciling Twitch bot channels:", error);
    res.status(500).json({ error: "Failed to reconcile Twitch bot channels" });
  }
});

// Trigger historical best-pull VOD backfill
router.post("/trigger/backfill-fight-vods", async (req: Request, res: Response) => {
  try {
    scheduler
      .backfillFightVodLinks()
      .then(() => logger.info("Backfill fight VOD links completed"))
      .catch((err) => logger.error("Backfill fight VOD links failed:", err));

    res.json({ success: true, message: "Best-pull VOD backfill started" });
  } catch (error) {
    logger.error("Error triggering fight VOD backfill:", error);
    res.status(500).json({ error: "Failed to trigger fight VOD backfill" });
  }
});

// Trigger world ranks update for all guilds
// Body: { raidId?: number, scope?: "all" | "current" }
router.post("/trigger/update-world-ranks", async (req: Request, res: Response) => {
  try {
    const raidId = req.body.raidId ? Number(req.body.raidId) : undefined;
    const scope: string = req.body.scope || "current";

    // When scope is "all", pass undefined raidId but use a special flag
    // The scheduler defaults to CURRENT_RAID_IDS when no raidId is given
    if (scope === "all" && !raidId) {
      // Import TRACKED_RAIDS to update world ranks for all tracked raids
      const { TRACKED_RAIDS } = await import("../config/guilds");
      scheduler
        .updateWorldRanksForRaids(TRACKED_RAIDS)
        .then(() => logger.info("Update world ranks completed for all raids"))
        .catch((err) => logger.error("Update world ranks failed:", err));
    } else {
      scheduler
        .updateAllGuildsWorldRanks(raidId)
        .then(() => logger.info("Update world ranks completed"))
        .catch((err) => logger.error("Update world ranks failed:", err));
    }

    const label = raidId
      ? `World ranks update started for raid ${raidId}`
      : scope === "all"
        ? "World ranks update started for all tracked raids"
        : "World ranks update started for current tier";

    res.json({ success: true, message: label });
  } catch (error) {
    logger.error("Error triggering world ranks update:", error);
    res.status(500).json({ error: "Failed to trigger world ranks update" });
  }
});

// Trigger raid analytics calculation
// Body: { raidId?: number, scope?: "all" | "current" }
router.post("/trigger/calculate-raid-analytics", async (req: Request, res: Response) => {
  try {
    const raidId = req.body.raidId ? Number(req.body.raidId) : undefined;
    const scope: string = req.body.scope || "current";

    if (raidId) {
      scheduler
        .calculateRaidAnalytics(raidId)
        .then(() => logger.info(`Calculate raid analytics completed for raid ${raidId}`))
        .catch((err) => logger.error("Calculate raid analytics failed:", err));
    } else if (scope === "current") {
      // Only calculate for current raid IDs
      const { CURRENT_RAID_IDS } = await import("../config/guilds");
      Promise.all(CURRENT_RAID_IDS.map((id) => scheduler.calculateRaidAnalytics(id)))
        .then(() => logger.info("Calculate raid analytics completed for current tier"))
        .catch((err) => logger.error("Calculate raid analytics failed:", err));
    } else {
      scheduler
        .calculateRaidAnalytics()
        .then(() => logger.info("Calculate raid analytics completed for all raids"))
        .catch((err) => logger.error("Calculate raid analytics failed:", err));
    }

    const label = raidId
      ? `Raid analytics calculation started for raid ${raidId}`
      : scope === "all"
        ? "Raid analytics calculation started for all raids"
        : "Raid analytics calculation started for current tier";

    res.json({ success: true, message: label });
  } catch (error) {
    logger.error("Error triggering raid analytics calculation:", error);
    res.status(500).json({ error: "Failed to trigger raid analytics calculation" });
  }
});

// Trigger active guilds update
router.post("/trigger/update-active-guilds", async (req: Request, res: Response) => {
  try {
    scheduler
      .updateActiveGuilds()
      .then(() => logger.info("Update active guilds completed"))
      .catch((err) => logger.error("Update active guilds failed:", err));

    res.json({ success: true, message: "Active guilds update started" });
  } catch (error) {
    logger.error("Error triggering active guilds update:", error);
    res.status(500).json({ error: "Failed to trigger active guilds update" });
  }
});

// Trigger inactive guilds update
router.post("/trigger/update-inactive-guilds", async (req: Request, res: Response) => {
  try {
    scheduler
      .updateInactiveGuilds()
      .then(() => logger.info("Update inactive guilds completed"))
      .catch((err) => logger.error("Update inactive guilds failed:", err));

    res.json({ success: true, message: "Inactive guilds update started" });
  } catch (error) {
    logger.error("Error triggering inactive guilds update:", error);
    res.status(500).json({ error: "Failed to trigger inactive guilds update" });
  }
});

// Trigger all guilds update
router.post("/trigger/update-all-guilds", async (req: Request, res: Response) => {
  try {
    scheduler
      .updateAllGuilds()
      .then(() => logger.info("Update all guilds completed"))
      .catch((err) => logger.error("Update all guilds failed:", err));

    res.json({ success: true, message: "All guilds update started" });
  } catch (error) {
    logger.error("Error triggering all guilds update:", error);
    res.status(500).json({ error: "Failed to trigger all guilds update" });
  }
});

// Trigger recent reports refetch for all active guilds
router.post("/trigger/refetch-recent-reports", async (req: Request, res: Response) => {
  try {
    scheduler
      .refetchRecentReportsForAllActiveGuilds()
      .then(() => logger.info("Refetch recent reports completed"))
      .catch((err) => logger.error("Refetch recent reports failed:", err));

    res.json({ success: true, message: "Recent reports refetch started" });
  } catch (error) {
    logger.error("Error triggering recent reports refetch:", error);
    res.status(500).json({ error: "Failed to trigger recent reports refetch" });
  }
});

// Trigger guild crests update
router.post("/trigger/update-guild-crests", async (req: Request, res: Response) => {
  try {
    scheduler
      .updateAllGuildCrests()
      .then(() => logger.info("Update guild crests completed"))
      .catch((err) => logger.error("Update guild crests failed:", err));

    res.json({ success: true, message: "Guild crests update started" });
  } catch (error) {
    logger.error("Error triggering guild crests update:", error);
    res.status(500).json({ error: "Failed to trigger guild crests update" });
  }
});

// Queue all guilds for death events rescan
router.post("/trigger/rescan-death-events", async (req: Request, res: Response) => {
  const taskId = await taskTracker.start("Queue Death Event Backfill", { source: "manual" });
  try {
    const result = await guildService.queueAllGuildsForDeathRescan();
    await taskTracker.complete(taskId, result);
    res.json({
      success: true,
      message: `Death events rescan queued: ${result.queued} guilds queued, ${result.skipped} skipped`,
      ...result,
    });
  } catch (error) {
    logger.error("Error triggering death events rescan:", error);
    await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Failed to trigger death events rescan" });
  }
});

// Queue all guilds for character rescan
router.post("/trigger/rescan-characters", async (req: Request, res: Response) => {
  const taskId = await taskTracker.start("Queue Character Rescan", { source: "manual" });
  try {
    const result = await guildService.queueAllGuildsForCharacterRescan();
    await taskTracker.complete(taskId, result);
    res.json({
      success: true,
      message: `Character rescan queued: ${result.queued} guilds queued, ${result.skipped} skipped`,
      ...result,
    });
  } catch (error) {
    logger.error("Error triggering character rescan:", error);
    await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Failed to trigger character rescan" });
  }
});

// Queue all guilds for report-level character backfill
router.post("/trigger/backfill-report-characters", async (req: Request, res: Response) => {
  const taskId = await taskTracker.start("Queue Report Character Backfill", { source: "manual" });
  try {
    const result = await guildService.queueAllGuildsForReportCharacterBackfill();
    await taskTracker.complete(taskId, result);
    res.json({
      success: true,
      message: `Report character backfill queued: ${result.queued} guilds queued, ${result.skipped} skipped`,
      ...result,
    });
  } catch (error) {
    logger.error("Error triggering report character backfill:", error);
    await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Failed to trigger report character backfill" });
  }
});

// Queue and start historical character ranking backfill
router.post("/trigger/backfill-character-rankings", async (req: Request, res: Response) => {
  try {
    const refreshCandidates = req.body?.refreshCandidates === true;
    const result = await characterRankingBackfillService.triggerBackfill({ refreshCandidates });
    const queueMessage = result.enqueue.discoverySkipped
      ? `candidate discovery skipped, ${result.enqueue.existing} persistent queue items already exist`
      : `${result.enqueue.queued} new character/raid items queued, ${result.enqueue.existing} already tracked`;
    res.json({
      success: true,
      message: result.started ? `Character ranking backfill started: ${queueMessage}` : `Character ranking backfill is already running: ${queueMessage}`,
      ...result,
    });
  } catch (error) {
    logger.error("Error triggering character ranking backfill:", error);
    res.status(500).json({ error: "Failed to trigger character ranking backfill" });
  }
});

// Queue and start Raider.IO Mythic+ score/run crawler
router.post("/trigger/crawl-mythic-plus", async (req: Request, res: Response) => {
  try {
    const mode = req.body?.mode === "historical" || req.body?.mode === "current" ? req.body.mode : "limited";
    const limitRaw = Number(req.body?.limit ?? 500);
    const maxJobsRaw = Number(req.body?.maxJobs ?? 0);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 10000) : 500;
    const maxJobs = Number.isFinite(maxJobsRaw) && maxJobsRaw > 0 ? Math.floor(maxJobsRaw) : undefined;
    const process = req.body?.process !== false;
    const syncStatic = req.body?.syncStatic !== false;
    const result =
      mode === "historical"
        ? await mythicPlusService.triggerHistoricalBackfill({ maxJobs, process, syncStatic })
        : mode === "current"
          ? await mythicPlusService.triggerCurrentSeasonCrawl({
              maxJobs,
              process,
              syncStatic,
              characterLimit: Number.isFinite(Number(req.body?.characterLimit)) ? Number(req.body.characterLimit) : undefined,
              activeSinceDays: Number.isFinite(Number(req.body?.activeSinceDays)) ? Number(req.body.activeSinceDays) : undefined,
              profileStaleHours: Number.isFinite(Number(req.body?.profileStaleHours)) ? Number(req.body.profileStaleHours) : undefined,
              runStaleHours: Number.isFinite(Number(req.body?.runStaleHours)) ? Number(req.body.runStaleHours) : undefined,
            })
          : await mythicPlusService.triggerCrawl({
              limit,
              maxJobs,
              refreshProfiles: req.body?.refreshProfiles === true,
              process,
              syncStatic,
            });

    const queuedProfileJobs = "profileJobs" in result.enqueue ? result.enqueue.profileJobs.queued : result.enqueue.queued;
    const existingProfileJobs = "profileJobs" in result.enqueue ? result.enqueue.profileJobs.existing : result.enqueue.existing;
    const currentProfileCandidates = "profileJobs" in result.enqueue ? result.enqueue.profileJobs.candidates : queuedProfileJobs;
    const currentDetailCandidates = "detailJobs" in result.enqueue ? result.enqueue.detailJobs.candidates : 0;

    res.json({
      success: true,
      message:
        mode === "historical"
          ? result.started
            ? `Mythic+ historical backfill started: ${queuedProfileJobs} new profile job(s), ${existingProfileJobs} existing/updated`
            : `Mythic+ historical profile jobs queued: ${queuedProfileJobs} new, ${existingProfileJobs} existing/updated`
          : mode === "current"
            ? result.started
              ? `Mythic+ current season refresh started: ${currentProfileCandidates} profile candidate(s), ${currentDetailCandidates} dungeon candidate(s)`
              : `Mythic+ current season refresh queued: ${currentProfileCandidates} profile candidate(s), ${currentDetailCandidates} dungeon candidate(s)`
            : result.started
              ? `Mythic+ crawler started: ${queuedProfileJobs} new profile job(s), ${existingProfileJobs} existing/updated`
              : `Mythic+ profile jobs queued: ${queuedProfileJobs} new, ${existingProfileJobs} existing/updated`,
      ...result,
    });
  } catch (error) {
    logger.error("Error triggering Mythic+ crawler:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to trigger Mythic+ crawler" });
  }
});

// Queue and start Blizzard achievement fingerprint backfill for account matching
router.post("/trigger/backfill-character-achievements", async (req: Request, res: Response) => {
  try {
    const refreshCandidates = req.body?.refreshCandidates === true;
    const refreshAll = req.body?.refreshAll === true;
    const result = await characterAchievementService.triggerBackfill({ refreshCandidates, refreshAll });
    const queueMessage =
      `${result.enqueue.queued} new character achievement item(s) queued, ${result.enqueue.updated} updated, ` +
      `${result.enqueue.existing} already tracked, ${result.enqueue.missingRaidAchievementSummary} missing raid achievement summaries`;
    res.json({
      success: true,
      message: result.started ? `Character achievement backfill started: ${queueMessage}` : `Character achievement backfill is already running: ${queueMessage}`,
      ...result,
    });
  } catch (error) {
    logger.error("Error triggering character achievement backfill:", error);
    res.status(500).json({ error: "Failed to trigger character achievement backfill" });
  }
});

// Rebuild character account groups from stored high-confidence achievement matches (no Blizzard API calls)
router.post("/trigger/rebuild-character-account-groups", async (req: Request, res: Response) => {
  const taskId = await taskTracker.start("Rebuild Character Account Groups", { source: "manual" });
  try {
    const result = await characterAchievementService.rebuildAccountGroups();
    await taskTracker.complete(taskId, { ...result });
    res.json({
      success: true,
      message: `Character account groups rebuilt: ${result.groups} groups, ${result.matchedCharacters} characters, ${result.highConfidenceEdges} high-confidence edges`,
      ...result,
    });
  } catch (error) {
    logger.error("Error rebuilding character account groups:", error);
    await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Failed to rebuild character account groups" });
  }
});

// Rebuild compact guild profile highlight cards from stored participation and mechanics rows
router.post("/trigger/rebuild-guild-profile-highlights", async (_req: Request, res: Response) => {
  try {
    const started = scheduler.triggerGuildProfileHighlightsRebuild();
    if (!started) {
      return res.status(409).json({ error: "Guild profile highlights rebuild is already running" });
    }

    res.json({
      success: true,
      message: "Guild profile highlights rebuild started",
    });
  } catch (error) {
    logger.error("Error triggering guild profile highlights rebuild:", error);
    res.status(500).json({ error: "Failed to trigger guild profile highlights rebuild" });
  }
});

// Rebuild generated character tier lists from stored participation and mechanics rows
router.post("/trigger/rebuild-character-tier-lists", async (req: Request, res: Response) => {
  try {
    const requestedRaidId = req.body?.raidId !== undefined ? parseInt(String(req.body.raidId), 10) : null;
    const scope = req.body?.scope === "all" ? "all" : "current";
    const zoneIds =
      requestedRaidId && Number.isFinite(requestedRaidId) && requestedRaidId > 0
        ? [requestedRaidId]
        : scope === "all"
          ? TRACKED_RAIDS
          : CURRENT_RAID_IDS;

    const started = scheduler.triggerCharacterTierListsRebuild(zoneIds);
    if (!started) {
      return res.status(409).json({ error: "Character tier list rebuild is already running" });
    }

    res.json({
      success: true,
      message: "Character tier list rebuild started",
      raidIds: zoneIds,
    });
  } catch (error) {
    logger.error("Error triggering character tier list rebuild:", error);
    res.status(500).json({ error: "Failed to trigger character tier list rebuild" });
  }
});

// Rebuild historical character ranking leaderboards from stored Ranking rows (no WCL API calls)
router.post("/trigger/rebuild-character-ranking-leaderboards", async (req: Request, res: Response) => {
  try {
    const result = await characterRankingBackfillService.triggerLeaderboardRebuildFromRankings();
    res.json({
      success: result.started,
      ...result,
    });
  } catch (error) {
    logger.error("Error triggering character ranking leaderboard rebuild:", error);
    res.status(500).json({ error: "Failed to trigger character ranking leaderboard rebuild" });
  }
});

// Remove derived character ranking rows that have no stored Mythic report-ranking evidence (no WCL API calls)
router.post("/trigger/prune-character-rankings-without-mythic-evidence", async (req: Request, res: Response) => {
  const taskId = await taskTracker.start("Prune Character Rankings Without Mythic Evidence", { source: "manual" });
  try {
    const result = await characterRankingBackfillService.pruneRankingsWithoutMythicEvidence();
    await taskTracker.complete(taskId, { ...result });
    res.json({
      success: true,
      message:
        `Pruned ${result.invalidPairs} invalid character/raid pairs: ` +
        `${result.rankingsDeleted} rankings, ${result.leaderboardEntriesDeleted} leaderboard entries, ${result.backfillItemsDeleted} backfill items removed`,
      ...result,
    });
  } catch (error) {
    logger.error("Error pruning character rankings without Mythic evidence:", error);
    await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to prune character rankings" });
  }
});

// Trigger Raider.IO update for all WCL-not-found guilds (same as nightly 9 AM job)
router.post("/trigger/update-raiderio-guilds", async (req: Request, res: Response) => {
  try {
    const started = scheduler.triggerRaiderIOGuildsUpdate();
    if (!started) {
      return res.json({ success: false, message: "Raider.IO guilds update is already running" });
    }
    res.json({ success: true, message: "Raider.IO guilds update started in background" });
  } catch (error) {
    logger.error("Error triggering Raider.IO guilds update:", error);
    res.status(500).json({ error: "Failed to trigger Raider.IO guilds update" });
  }
});

// Trigger character rankings refresh (same as nightly 7 AM job)
router.post("/trigger/refresh-character-rankings", async (req: Request, res: Response) => {
  try {
    const started = scheduler.triggerCharacterRankingsRefresh();
    if (!started) {
      res.json({ success: false, message: "Character rankings refresh is already running" });
      return;
    }
    res.json({ success: true, message: "Character rankings refresh started in background" });
  } catch (error) {
    logger.error("Error triggering character rankings refresh:", error);
    res.status(500).json({ error: "Failed to trigger character rankings refresh" });
  }
});

// Trigger character raid participation rebuild (fast, no WCL API calls)
router.post("/trigger/rebuild-character-raid-participations", async (req: Request, res: Response) => {
  try {
    const started = scheduler.triggerCharacterRaidParticipationRebuild();
    if (!started) {
      res.json({ success: false, message: "Character raid participation rebuild is already running" });
      return;
    }
    res.json({ success: true, message: "Character raid participation rebuild started in background" });
  } catch (error) {
    logger.error("Error triggering character raid participation rebuild:", error);
    res.status(500).json({ error: "Failed to trigger character raid participation rebuild" });
  }
});

// Rebuild the production guild network snapshot from materialized character raid participations.
router.post("/trigger/rebuild-guild-network", async (req: Request, res: Response) => {
  try {
    const started = scheduler.triggerGuildNetworkSnapshotRebuild();
    if (!started) {
      res.json({ success: false, message: "Guild network snapshot rebuild is already running" });
      return;
    }
    res.json({ success: true, message: "Guild network snapshot rebuild started in background" });
  } catch (error) {
    logger.error("Error triggering guild network snapshot rebuild:", error);
    res.status(500).json({ error: "Failed to trigger guild network snapshot rebuild" });
  }
});

// Rebuild the materialized leaderboard collection (fast, no WCL API calls)
router.get("/trigger/rebuild-leaderboard", async (req: Request, res: Response) => {
  const taskId = await taskTracker.start("Rebuild Character Leaderboards", { source: "manual" });
  try {
    const startTime = Date.now();
    await characterService.buildCharacterLeaderboards();
    const duration = Math.round((Date.now() - startTime) / 1000);
    await taskTracker.complete(taskId, { durationSeconds: duration });
    res.json({ success: true, message: `Leaderboard rebuilt in ${duration}s` });
  } catch (error) {
    logger.error("Error rebuilding leaderboard:", error);
    await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Failed to rebuild leaderboard" });
  }
});

// Rebuild character mechanics leaderboards from stored rankings and death events (no WCL API calls)
router.post("/trigger/rebuild-character-mechanics-leaderboards", async (req: Request, res: Response) => {
  try {
    const scope: string = req.body?.scope || "current";
    const { TRACKED_RAIDS, CURRENT_RAID_IDS } = await import("../config/guilds");
    const raidId = req.body?.raidId ? Number(req.body.raidId) : undefined;
    const zoneIds = Number.isFinite(raidId) ? [raidId as number] : scope === "all" ? TRACKED_RAIDS : CURRENT_RAID_IDS;
    const targetLabel = Number.isFinite(raidId) ? `raid ${raidId}` : scope === "all" ? "all tracked raids" : "current tier";
    const taskId = await taskTracker.start("Rebuild Character Mechanics Leaderboard", { source: "manual", zoneIds });

    characterMechanicsService
      .buildMechanicsLeaderboards(zoneIds)
      .then(async (result) => {
        logger.info(`[Admin] Character mechanics leaderboard rebuild completed for ${targetLabel}`);
        const rebuiltZoneIds = result.zones.map((zone) => zone.zoneId);
        const tierListResult = await characterTierListService.rebuildCharacterTierLists(rebuiltZoneIds);
        await cacheService.invalidateCharacterTierListCaches();
        logger.info(`[Admin] Character tier list rebuild completed after mechanics rebuild: ${tierListResult.entries} entries`);
        await taskTracker.complete(taskId, { ...result, characterTierLists: tierListResult });
      })
      .catch(async (err) => {
        logger.error("[Admin] Character mechanics leaderboard rebuild failed:", err);
        await taskTracker.fail(taskId, err instanceof Error ? err.message : String(err));
      });

    res.json({
      success: true,
      message: `Character mechanics leaderboard rebuild started for ${targetLabel}`,
      zoneIds,
    });
  } catch (error) {
    logger.error("Error triggering character mechanics leaderboard rebuild:", error);
    res.status(500).json({ error: "Failed to trigger character mechanics leaderboard rebuild" });
  }
});

// ============================================================
// CHARACTERS
// ============================================================

// List characters with pagination and search
router.get("/characters", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (search) {
      query.$or = [{ name: { $regex: search, $options: "i" } }, { realm: { $regex: search, $options: "i" } }];
    }

    const [characters, total] = await Promise.all([Character.find(query).sort({ lastMythicSeenAt: -1, name: 1 }).skip(skip).limit(limit).lean(), Character.countDocuments(query)]);

    // Build class name lookup
    const classNameMap = new Map<number, string>();
    for (const cls of CLASSES) {
      classNameMap.set(cls.id, cls.name);
    }

    const formatted = characters.map((c) => ({
      id: c._id.toString(),
      name: c.name,
      realm: c.realm,
      region: c.region,
      classID: c.classID,
      className: classNameMap.get(c.classID) || `Unknown (${c.classID})`,
      lastMythicSeenAt: c.lastMythicSeenAt,
      rankingsAvailable: c.rankingsAvailable,
    }));

    res.json({
      characters: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Error fetching characters:", error);
    res.status(500).json({ error: "Failed to fetch characters" });
  }
});

// Get character stats
router.get("/characters/stats", async (req: Request, res: Response) => {
  try {
    const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [total, withRankings, recentlyActive] = await Promise.all([
      Character.countDocuments(),
      Character.countDocuments({ rankingsAvailable: true }),
      Character.countDocuments({ lastMythicSeenAt: { $gte: cutoffDate } }),
    ]);

    res.json({ total, withRankings, recentlyActive });
  } catch (error) {
    logger.error("Error fetching character stats:", error);
    res.status(500).json({ error: "Failed to fetch character stats" });
  }
});

// Delete a character and its rankings
router.delete("/characters/:characterId", async (req: Request, res: Response) => {
  try {
    const { characterId } = req.params;

    const character = await Character.findById(characterId);
    if (!character) {
      return res.status(404).json({ error: "Character not found" });
    }

    const characterName = character.name;
    const characterRealm = character.realm;

    const rankingResult = await Ranking.deleteMany({ characterId: character._id });
    await Character.deleteOne({ _id: character._id });

    logger.info(`Admin deleted character: ${characterName}-${characterRealm} (ID: ${characterId}). ` + `Removed: ${rankingResult.deletedCount} rankings`);

    res.json({
      success: true,
      message: `Character ${characterName}-${characterRealm} and associated data deleted`,
      deleted: {
        character: { id: characterId, name: characterName, realm: characterRealm },
        rankings: rankingResult.deletedCount,
      },
    });
  } catch (error) {
    logger.error("Error deleting character:", error);
    res.status(500).json({ error: "Failed to delete character" });
  }
});

// ============================================================
// CHARACTER RANKINGS MANAGEMENT
// ============================================================

// Preview character rankings deletion for a specific raid and partition
router.get("/character-rankings/delete-preview", async (req: Request, res: Response) => {
  try {
    const zoneId = parseInt(req.query.zoneId as string);
    const partition = parseInt(req.query.partition as string);

    if (!zoneId || !partition || isNaN(zoneId) || isNaN(partition)) {
      return res.status(400).json({ error: "Valid zoneId and partition are required" });
    }

    const raid = await Raid.findOne({ id: zoneId }).select("name partitions").lean();
    if (!raid) {
      return res.status(404).json({ error: "Raid not found" });
    }

    const partitionInfo = raid.partitions?.find((p: { id: number; name: string }) => p.id === partition);

    const [rankingsCount, leaderboardPartitionCount, leaderboardAllPartitionsCount] = await Promise.all([
      Ranking.countDocuments({ zoneId, partition }),
      CharacterLeaderboard.countDocuments({ zoneId, partition }),
      CharacterLeaderboard.countDocuments({ zoneId, partition: null }),
    ]);

    res.json({
      raid: { id: zoneId, name: raid.name },
      partition: { id: partition, name: partitionInfo?.name || `Partition ${partition}` },
      willBeDeleted: {
        rankings: rankingsCount,
        leaderboardEntries: leaderboardPartitionCount,
        leaderboardAllPartitionsEntries: leaderboardAllPartitionsCount,
      },
      totalDocuments: rankingsCount + leaderboardPartitionCount + leaderboardAllPartitionsCount,
      warning:
        "This will delete all character rankings and leaderboard entries for this raid and partition. The 'all partitions' leaderboard entries will also be removed and rebuilt on next nightly cycle.",
    });
  } catch (error) {
    logger.error("Error fetching character rankings delete preview:", error);
    res.status(500).json({ error: "Failed to fetch deletion preview" });
  }
});

// Delete character rankings for a specific raid and partition
router.delete("/character-rankings", async (req: Request, res: Response) => {
  try {
    const zoneId = parseInt(req.query.zoneId as string);
    const partition = parseInt(req.query.partition as string);
    const confirm = req.query.confirm === "true";

    if (!zoneId || !partition || isNaN(zoneId) || isNaN(partition)) {
      return res.status(400).json({ error: "Valid zoneId and partition are required" });
    }

    if (!confirm) {
      return res.status(400).json({ error: "Confirmation required. Add ?confirm=true to proceed." });
    }

    const raid = await Raid.findOne({ id: zoneId }).select("name partitions").lean();
    if (!raid) {
      return res.status(404).json({ error: "Raid not found" });
    }

    const partitionInfo = raid.partitions?.find((p: { id: number; name: string }) => p.id === partition);

    const [rankingsResult, leaderboardPartitionResult, leaderboardAllPartitionsResult] = await Promise.all([
      Ranking.deleteMany({ zoneId, partition }),
      CharacterLeaderboard.deleteMany({ zoneId, partition }),
      CharacterLeaderboard.deleteMany({ zoneId, partition: null }),
    ]);

    const totalDeleted = rankingsResult.deletedCount + leaderboardPartitionResult.deletedCount + leaderboardAllPartitionsResult.deletedCount;

    logger.info(
      `Admin deleted character rankings for ${raid.name} partition ${partitionInfo?.name || partition}. ` +
        `Removed: ${rankingsResult.deletedCount} rankings, ${leaderboardPartitionResult.deletedCount} leaderboard entries, ` +
        `${leaderboardAllPartitionsResult.deletedCount} all-partitions leaderboard entries`,
    );

    res.json({
      success: true,
      message: `Deleted ${totalDeleted} documents for ${raid.name} - ${partitionInfo?.name || `Partition ${partition}`}`,
      deleted: {
        raid: { id: zoneId, name: raid.name },
        partition: { id: partition, name: partitionInfo?.name || `Partition ${partition}` },
        rankings: rankingsResult.deletedCount,
        leaderboardEntries: leaderboardPartitionResult.deletedCount,
        leaderboardAllPartitionsEntries: leaderboardAllPartitionsResult.deletedCount,
        total: totalDeleted,
      },
    });
  } catch (error) {
    logger.error("Error deleting character rankings:", error);
    res.status(500).json({ error: "Failed to delete character rankings" });
  }
});

// ============================================================
// TASK LOGS
// ============================================================

// Get recent task logs
router.get("/task-logs", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const logs = await taskTracker.getRecentLogs(limit);

    res.json({ logs });
  } catch (error) {
    logger.error("Error fetching task logs:", error);
    res.status(500).json({ error: "Failed to fetch task logs" });
  }
});

// Get latest status per task
router.get("/task-logs/latest", async (req: Request, res: Response) => {
  try {
    const latest = await taskTracker.getLatestByTask();
    const stats = await taskTracker.getStats();

    res.json({ tasks: latest, stats });
  } catch (error) {
    logger.error("Error fetching latest task statuses:", error);
    res.status(500).json({ error: "Failed to fetch latest task statuses" });
  }
});

export default router;
