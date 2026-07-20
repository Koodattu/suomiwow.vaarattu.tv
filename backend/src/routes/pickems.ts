import { Router, Request, Response } from "express";
import Guild from "../models/Guild";
import User, { IPickemEntry, IPickemPrediction } from "../models/User";
import { calculatePickemPoints, calculateStreakBonus, IPickem } from "../models/Pickem";
import discordService from "../services/discord.service";
import pickemService from "../services/pickem.service";
import cacheService from "../services/cache.service";
import { PICK_EM_RWF_GUILDS } from "../config/guilds";
import { cacheMiddleware } from "../middleware/cache.middleware";
import logger from "../utils/logger";
import { isPickemPlaceholderRaidIds, isPickemReferenceRaidId, PICKEM_REFERENCE_RANKINGS_LIMIT } from "../utils/pickemRaid";
import {
  assertPickemAcceptingPredictions,
  createGuestPickemEntryIfAbsent,
  PickemSubmissionError,
  validatePickemPredictions,
} from "../services/pickem-submission.service";

const router = Router();

// Helper to get user from session (updated for express-session)
async function getUserFromSession(req: Request) {
  const userId = req.session.userId;
  if (!userId) return null;
  return discordService.getUserFromSession(userId);
}

// Rate limit: max 10 prediction submissions per minute per session
const PREDICT_RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();

function checkPredictRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = PREDICT_RATE_LIMIT.get(sessionId);
  if (!entry || now > entry.resetAt) {
    PREDICT_RATE_LIMIT.set(sessionId, { count: 1, resetAt: now + 60000 });
    return true;
  }
  entry.count++;
  return entry.count <= 10;
}

function sendPickemSubmissionError(res: Response, error: unknown): boolean {
  if (!(error instanceof PickemSubmissionError)) {
    return false;
  }

  res.status(error.status).json({
    error: error.message,
    code: error.code,
  });
  return true;
}

// Get all available pickems with their status
router.get(
  "/",
  cacheMiddleware(
    (req) => "pickems:list",
    () => 2 * 60 * 1000,
  ),
  async (req: Request, res: Response) => {
    try {
      const now = new Date();
      const pickems = await pickemService.getActivePickems();

      const result = pickems.map((p) => ({
        id: p.pickemId,
        name: p.name,
        type: p.type || "regular",
        raidIds: p.raidIds,
        rankingsPending: (p.type || "regular") === "regular" && isPickemPlaceholderRaidIds(p.raidIds),
        guildCount: p.guildCount || 10,
        finalRankingsCount: p.finalRankingsCount || 0,
        scoreOutOfRangeGuilds: p.scoreOutOfRangeGuilds ?? false,
        votingStart: p.votingStart,
        votingEnd: p.votingEnd,
        isVotingOpen: now >= new Date(p.votingStart) && now <= new Date(p.votingEnd),
        hasEnded: now > new Date(p.votingEnd),
        // RWF finalization status
        finalized: p.finalized ?? false,
        finalRankings: p.finalRankings ?? [],
        finalizedAt: p.finalizedAt ?? null,
        scoringConfig: p.scoringConfig,
        streakConfig: p.streakConfig,
        prizeConfig: p.prizeConfig,
      }));

      res.json(result);
    } catch (error) {
      logger.error("Error fetching pickems:", error);
      res.status(500).json({ error: "Failed to fetch pickems" });
    }
  },
);

// Get simple guild list for autocomplete (just name and realm) - for regular pickems
// Only returns parent guilds (guilds without parent_guild set).
// Child guilds are represented by their parent in pickems — their progress contributes to the parent's ranking.
// Uses the pre-warmed guild list cache (guilds:list) to avoid DB queries.
router.get(
  "/guilds",
  cacheMiddleware(
    (req) => "pickems:guilds",
    () => 30 * 60 * 1000,
  ),
  async (req: Request, res: Response) => {
    try {
      // Read from the pre-warmed guild list cache (warmed on startup and nightly)
      const cachedGuildList = await cacheService.get<any[]>(cacheService.getGuildListKey());
      if (cachedGuildList) {
        const simpleGuilds = cachedGuildList.filter((g: any) => !g.parent_guild).map((g: any) => ({ name: g.name, realm: g.realm }));
        return res.json(simpleGuilds);
      }

      // Fallback to direct DB query if cache is cold
      logger.warn("Pickems guild list cache miss — falling back to DB query");
      const guilds = await Guild.find({ $or: [{ parent_guild: null }, { parent_guild: "" }, { parent_guild: { $exists: false } }] }, { name: 1, realm: 1, _id: 0 }).lean();
      res.json(guilds);
    } catch (error) {
      logger.error("Error fetching guilds for pickems:", error);
      res.status(500).json({ error: "Failed to fetch guilds" });
    }
  },
);

// Get RWF guild list for autocomplete - for RWF pickems (Race to World First)
router.get(
  "/guilds/rwf",
  cacheMiddleware(
    (req) => "pickems:guilds:rwf",
    () => 60 * 60 * 1000,
  ),
  async (req: Request, res: Response) => {
    try {
      // Return RWF guilds as simple objects with name only (no realm for RWF guilds)
      const guilds = PICK_EM_RWF_GUILDS.map((name) => ({ name, realm: "RWF" }));
      res.json(guilds);
    } catch (error) {
      logger.error("Error fetching RWF guilds for pickems:", error);
      res.status(500).json({ error: "Failed to fetch RWF guilds" });
    }
  },
);

// Get a past raid's rankings as a reference while a Pickem uses the upcoming raid placeholder.
router.get("/:pickemId/reference-rankings", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const pickem = await pickemService.getPickemById(pickemId);

    if (!pickem || !pickem.active) {
      return res.status(404).json({ error: "Pickem not found" });
    }

    if ((pickem.type || "regular") !== "regular" || !isPickemPlaceholderRaidIds(pickem.raidIds)) {
      return res.status(409).json({ error: "Reference rankings are available only while raid rankings are pending" });
    }

    const raidId = typeof req.query.raidId === "string" ? Number(req.query.raidId) : NaN;
    if (!isPickemReferenceRaidId(raidId)) {
      return res.status(400).json({ error: "Select a past tracked raid tier" });
    }

    const rankings = await getGuildRankingsForPickem([raidId]);
    res.json(rankings.slice(0, PICKEM_REFERENCE_RANKINGS_LIMIT));
  } catch (error) {
    logger.error("Error fetching Pickem reference rankings:", error);
    res.status(500).json({ error: "Failed to fetch reference rankings" });
  }
});

// Get a specific pickem with leaderboard and user's predictions
router.get("/:pickemId", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const pickem = await pickemService.getPickemById(pickemId);

    if (!pickem || !pickem.active) {
      return res.status(404).json({ error: "Pickem not found" });
    }

    const now = new Date();
    const isVotingOpen = now >= new Date(pickem.votingStart) && now <= new Date(pickem.votingEnd);
    const hasEnded = now > new Date(pickem.votingEnd);

    const pickemType = pickem.type || "regular";
    const guildCount = pickem.guildCount || 10;
    const rankingsPending = pickemType === "regular" && isPickemPlaceholderRaidIds(pickem.raidIds);

    // Get actual guild rankings based on pickem type
    let guildRankings: { rank: number; name: string; realm: string; bossesKilled?: number; totalBosses?: number; isComplete?: boolean; lastKillTime?: Date | null }[];

    if (pickemType === "rwf") {
      // For RWF pickems, check if finalized - use finalRankings, otherwise show unranked guilds
      if (pickem.finalized && pickem.finalRankings && pickem.finalRankings.length > 0) {
        // Use the manually set final rankings
        guildRankings = pickem.finalRankings.map((name, index) => ({
          rank: index + 1,
          name,
          realm: "RWF",
        }));
      } else {
        // Not finalized yet - return guilds in config order without actual rankings
        // These are just for display/prediction purposes, not for scoring
        guildRankings = PICK_EM_RWF_GUILDS.map((name, index) => ({
          rank: index + 1, // Placeholder rank (not used for scoring until finalized)
          name,
          realm: "RWF",
        }));
      }
    } else {
      if (rankingsPending) {
        guildRankings = [];
      } else {
        // For regular pickems, get rankings from cached guild progress data (two-tier cache)
        const rankingsCacheKey = cacheService.getPickemRankingsKey(pickemId);
        const cachedRankings = await cacheService.get<typeof guildRankings>(rankingsCacheKey);
        if (cachedRankings) {
          guildRankings = cachedRankings;
        } else {
          guildRankings = await getGuildRankingsForPickem(pickem.raidIds);
          // Cache rankings in two-tier cache (L1 memory + L2 MongoDB)
          await cacheService.set(rankingsCacheKey, guildRankings, cacheService.PICKEM_RANKINGS_TTL);
        }
      }
    }

    // Get user's predictions if logged in
    let userPredictions: IPickemPrediction[] | null = null;
    const user = await getUserFromSession(req);
    if (user) {
      const entry = user.pickems?.find((p: IPickemEntry) => p.pickemId === pickemId);
      if (entry) {
        userPredictions = entry.predictions;
      }
    }

    // Get leaderboard (all users' scores for this pickem, two-tier cached with invalidation on prediction submit)
    const leaderboardCacheKey = cacheService.getPickemLeaderboardKey(pickemId);
    let leaderboard = await cacheService.get<any[]>(leaderboardCacheKey);
    if (!leaderboard) {
      leaderboard = await getPickemLeaderboard(pickemId, guildRankings, pickem);
      await cacheService.set(leaderboardCacheKey, leaderboard, cacheService.PICKEM_LEADERBOARD_TTL);
    }

    // Hide prediction details while voting is open to prevent copying strategies
    const sanitizedLeaderboard = isVotingOpen
      ? leaderboard.map((entry: any) => ({
          ...entry,
          predictions: entry.predictions.map((p: any) => ({
            ...p,
            guildName: "Hidden",
            realm: "",
          })),
        }))
      : leaderboard;

    res.json({
      id: pickem.pickemId,
      name: pickem.name,
      type: pickemType,
      raidIds: pickem.raidIds,
      rankingsPending,
      guildCount,
      finalRankingsCount: pickem.finalRankingsCount || 0,
      scoreOutOfRangeGuilds: pickem.scoreOutOfRangeGuilds ?? false,
      votingStart: pickem.votingStart,
      votingEnd: pickem.votingEnd,
      isVotingOpen,
      hasEnded,
      // RWF finalization status
      finalized: pickem.finalized ?? false,
      finalRankings: pickem.finalRankings ?? [],
      finalizedAt: pickem.finalizedAt ?? null,
      scoringConfig: pickem.scoringConfig,
      streakConfig: pickem.streakConfig,
      prizeConfig: pickem.prizeConfig,
      guildRankings,
      userPredictions,
      leaderboard: sanitizedLeaderboard,
    });
  } catch (error) {
    logger.error("Error fetching pickem details:", error);
    res.status(500).json({ error: "Failed to fetch pickem details" });
  }
});

// Submit or update predictions for a pickem
router.post("/:pickemId/predict", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const predictionInput = (req.body as { predictions?: unknown } | undefined)?.predictions;

    // Rate limit prediction submissions
    const sessionId = req.session?.id || req.ip || "unknown";
    if (!checkPredictRateLimit(sessionId)) {
      return res.status(429).json({ error: "Too many requests. Please wait a moment before trying again." });
    }

    // Validate user is logged in
    const user = await getUserFromSession(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Validate pickem exists and voting is open
    const pickem = await pickemService.getPickemById(pickemId);
    assertPickemAcceptingPredictions(pickem);
    const predictions = await validatePickemPredictions(pickem, predictionInput);

    // Re-check against the server clock immediately before persisting.
    const currentPickem = await pickemService.getPickemById(pickemId);
    assertPickemAcceptingPredictions(currentPickem);

    // Update or create the pickem entry
    const existingEntryIndex = user.pickems?.findIndex((p: IPickemEntry) => p.pickemId === pickemId) ?? -1;

    if (existingEntryIndex >= 0) {
      // Update existing entry
      user.pickems[existingEntryIndex].predictions = predictions;
      user.pickems[existingEntryIndex].updatedAt = new Date();
    } else {
      // Create new entry
      if (!user.pickems) {
        user.pickems = [];
      }
      user.pickems.push({
        pickemId,
        predictions,
        submittedAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await user.save();

    // Invalidate leaderboard cache so new prediction shows up immediately
    await cacheService.invalidate(cacheService.getPickemLeaderboardKey(pickemId));

    res.json({
      success: true,
      message: existingEntryIndex >= 0 ? "Predictions updated" : "Predictions submitted",
    });
  } catch (error) {
    if (sendPickemSubmissionError(res, error)) {
      return;
    }
    logger.error("Error submitting predictions:", error);
    res.status(500).json({ error: "Failed to submit predictions" });
  }
});

// Import a browser-only guest draft without ever replacing an account entry.
router.post("/:pickemId/import-guest", async (req: Request, res: Response) => {
  try {
    const { pickemId } = req.params;
    const predictionInput = (req.body as { predictions?: unknown } | undefined)?.predictions;

    const sessionId = req.session?.id || req.ip || "unknown";
    if (!checkPredictRateLimit(sessionId)) {
      return res.status(429).json({ error: "Too many requests. Please wait a moment before trying again.", code: "RATE_LIMITED" });
    }

    const user = await getUserFromSession(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated", code: "NOT_AUTHENTICATED" });
    }

    const pickem = await pickemService.getPickemById(pickemId);
    assertPickemAcceptingPredictions(pickem);
    const predictions = await validatePickemPredictions(pickem, predictionInput);

    // The client timestamp is intentionally ignored. Re-read the competition
    // and use the server's time at the final authorization point.
    const currentPickem = await pickemService.getPickemById(pickemId);
    const acceptedAt = new Date();
    assertPickemAcceptingPredictions(currentPickem, acceptedAt);

    const created = await createGuestPickemEntryIfAbsent(user._id, pickemId, predictions, acceptedAt);
    if (!created) {
      throw new PickemSubmissionError("PICKEM_ALREADY_SUBMITTED", 409, "This account already has predictions for this pickem");
    }

    await cacheService.invalidate(cacheService.getPickemLeaderboardKey(pickemId));

    res.status(201).json({
      success: true,
      message: "Guest predictions imported",
    });
  } catch (error) {
    if (sendPickemSubmissionError(res, error)) {
      return;
    }
    logger.error("Error importing guest predictions:", error);
    res.status(500).json({ error: "Failed to import guest predictions" });
  }
});

// Helper function to get guild rankings for a pickem's raids
// Reads from the pre-warmed progress cache (progress:raid:{raidId}) instead of querying the DB directly.
// Falls back to DB query only if cache is cold.
// Consolidates parent/child guilds: child guild progress is attributed to the parent guild,
// and only the best-performing member of each guild family appears in the rankings.
async function getGuildRankingsForPickem(raidIds: number[]) {
  if (isPickemPlaceholderRaidIds(raidIds)) {
    return [];
  }

  // Try reading from the pre-warmed progress cache for each raid
  const cachedGuildsByRaid: Map<number, any[]> = new Map();
  let allCached = true;

  for (const raidId of raidIds) {
    const cached = await cacheService.get<any[]>(cacheService.getProgressKey(raidId));
    if (cached) {
      cachedGuildsByRaid.set(raidId, cached);
    } else {
      allCached = false;
      break;
    }
  }

  if (allCached) {
    return buildRankingsFromCachedProgress(cachedGuildsByRaid, raidIds);
  }

  // Fallback: query DB directly (only happens if cache warmer hasn't run yet)
  logger.warn(`Pickems rankings cache miss for raids [${raidIds.join(",")}] — falling back to DB query`);
  return buildRankingsFromDB(raidIds);
}

/**
 * Minimal guild shape needed by regular pickem scoring.
 */
interface GuildMapEntry {
  name: string;
  realm: string;
  parent_guild: string | null;
  progressByRaid: Map<number, any>;
}

/**
 * Build guild rankings from pre-warmed progress cache data.
 * The cached data from getAllGuildsForRaid already contains:
 * - name, realm, parent_guild
 * - progress[].difficulty, progress[].bossesDefeated, progress[].totalBosses, progress[].lastKillTime
 */
async function buildRankingsFromCachedProgress(cachedGuildsByRaid: Map<number, any[]>, raidIds: number[]) {
  // Collect all guilds across all raids, deduplicating by name+realm
  const guildMap = new Map<string, GuildMapEntry>();

  for (const raidId of raidIds) {
    const guilds = cachedGuildsByRaid.get(raidId) || [];
    for (const guild of guilds) {
      const key = `${guild.name}-${guild.realm}`;
      if (!guildMap.has(key)) {
        guildMap.set(key, {
          name: guild.name,
          realm: guild.realm,
          parent_guild: guild.parent_guild || null,
          progressByRaid: new Map(),
        });
      }
      // Find mythic progress for this raid from the filtered progress array
      const mythicProgress = guild.progress?.find((p: any) => p.difficulty === "mythic" && p.raidId === raidId);
      if (mythicProgress) {
        guildMap.get(key)!.progressByRaid.set(raidId, mythicProgress);
      }
    }
  }

  await addMissingParentGuilds(guildMap);

  return consolidateAndRankGuilds(guildMap, raidIds);
}

/**
 * The progress cache only contains guilds that have raid progress. A parent guild
 * can be absent while one of its child teams has progress, so fetch missing
 * parent metadata before family consolidation.
 */
async function addMissingParentGuilds(guildMap: Map<string, GuildMapEntry>) {
  const parentNames = new Set<string>();
  const knownParentNames = new Set<string>();

  for (const guild of guildMap.values()) {
    if (guild.parent_guild) {
      parentNames.add(guild.parent_guild);
    } else {
      knownParentNames.add(guild.name);
    }
  }

  const missingParentNames = [...parentNames].filter((parentName) => !knownParentNames.has(parentName));
  if (missingParentNames.length === 0) {
    return;
  }

  const parents = await Guild.find(
    {
      name: { $in: missingParentNames },
      $or: [{ parent_guild: null }, { parent_guild: "" }, { parent_guild: { $exists: false } }],
    },
    { name: 1, realm: 1, parent_guild: 1 },
  ).lean();

  for (const parent of parents) {
    const key = `${parent.name}-${parent.realm}`;
    if (!guildMap.has(key)) {
      guildMap.set(key, {
        name: parent.name,
        realm: parent.realm,
        parent_guild: parent.parent_guild || null,
        progressByRaid: new Map(),
      });
    }
  }
}

/**
 * Fallback: build guild rankings from direct DB query when cache is cold.
 */
async function buildRankingsFromDB(raidIds: number[]) {
  const guilds = await Guild.find({}, { name: 1, realm: 1, parent_guild: 1, progress: 1 }).lean();

  const guildMap = new Map<string, GuildMapEntry>();

  for (const guild of guilds) {
    const key = `${guild.name}-${guild.realm}`;
    const progressByRaid = new Map<number, any>();

    for (const raidId of raidIds) {
      const raidProgress = guild.progress?.find((p: { raidId: number; difficulty: string }) => p.raidId === raidId && p.difficulty === "mythic");
      if (raidProgress) {
        progressByRaid.set(raidId, raidProgress);
      }
    }

    guildMap.set(key, {
      name: guild.name,
      realm: guild.realm,
      parent_guild: guild.parent_guild || null,
      progressByRaid,
    });
  }

  return consolidateAndRankGuilds(guildMap, raidIds);
}

/**
 * Shared logic: consolidate parent/child guilds and rank them.
 * Used by both cached and DB-fallback paths.
 */
function consolidateAndRankGuilds(guildMap: Map<string, GuildMapEntry>, raidIds: number[]) {
  const useSingleRaidRanking = raidIds.length === 1;

  const readNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

  const getCurrentBossSignals = (raidProgress: any, effectiveKills: number) => {
    const bosses = Array.isArray(raidProgress?.bosses) ? raidProgress.bosses : [];
    const currentBoss = bosses[effectiveKills] ?? bosses.find((boss: any) => boss.kills === 0);
    const pullCount = readNumber(raidProgress?.currentBossPulls) ?? readNumber(currentBoss?.pullCount) ?? 0;
    const bestPullPhase = raidProgress?.bestPullPhase ?? currentBoss?.bestPullPhase;
    const bestPercent = readNumber(raidProgress?.bestPullPercent) ?? readNumber(currentBoss?.bestPercent);

    return {
      hasPullData: pullCount > 0,
      fightCompletion: readNumber(bestPullPhase?.fightCompletion) ?? bestPercent ?? 100,
      bossHealth: readNumber(bestPullPhase?.bossHealth) ?? bestPercent ?? 100,
    };
  };

  // Build parent/child relationships
  const childToParentName = new Map<string, string>();
  const parentGuildInfo = new Map<string, { name: string; realm: string }>();

  for (const [key, guild] of guildMap) {
    if (guild.parent_guild) {
      childToParentName.set(key, guild.parent_guild);
    }
  }

  for (const [key, guild] of guildMap) {
    if (!guild.parent_guild) {
      const isParent = Array.from(childToParentName.values()).includes(guild.name);
      if (isParent) {
        parentGuildInfo.set(guild.name, { name: guild.name, realm: guild.realm });
      }
    }
  }

  // Calculate combined progress across all raids for each guild
  interface GuildProgressEntry {
    name: string;
    realm: string;
    parentName: string | null;
    totalBossesKilled: number;
    totalBosses: number;
    lastKillTime: Date | null;
    isComplete: boolean;
    guildRank: number | null;
    hasPullData: boolean;
    fightCompletion: number;
    bossHealth: number;
    worldRank: number | null;
  }

  const allProgress: GuildProgressEntry[] = [];

  type SortableGuildProgress = Omit<GuildProgressEntry, "parentName">;

  for (const [key, guild] of guildMap) {
    let totalKilled = 0;
    let totalBosses = 0;
    let lastKillTime: Date | null = null;
    let guildRank: number | null = null;
    let hasPullData = false;
    let fightCompletion = 100;
    let bossHealth = 100;
    let worldRank: number | null = null;

    for (const raidId of raidIds) {
      const raidProgress = guild.progressByRaid.get(raidId);
      if (raidProgress) {
        const bossesDefeated = raidProgress.bossesDefeated || 0;
        totalKilled += bossesDefeated;
        totalBosses += raidProgress.totalBosses || 0;

        // Use lastKillTime from the cached progress data
        if (raidProgress.lastKillTime) {
          const killTime = new Date(raidProgress.lastKillTime);
          if (!lastKillTime || killTime > lastKillTime) {
            lastKillTime = killTime;
          }
        }

        if (useSingleRaidRanking) {
          guildRank = readNumber(raidProgress.guildRank);
          worldRank = readNumber(raidProgress.worldRank);
          const currentBossSignals = getCurrentBossSignals(raidProgress, bossesDefeated);
          hasPullData = currentBossSignals.hasPullData;
          fightCompletion = currentBossSignals.fightCompletion;
          bossHealth = currentBossSignals.bossHealth;
        }
      }
    }

    const parentName = childToParentName.get(key) ?? null;

    allProgress.push({
      name: guild.name,
      realm: guild.realm,
      parentName,
      totalBossesKilled: totalKilled,
      totalBosses,
      lastKillTime,
      isComplete: totalKilled === totalBosses && totalBosses > 0,
      guildRank,
      hasPullData,
      fightCompletion,
      bossHealth,
      worldRank,
    });
  }

  const compareGuildProgress = (a: SortableGuildProgress, b: SortableGuildProgress) => {
    if (useSingleRaidRanking) {
      const aGuildRank = a.guildRank ?? Infinity;
      const bGuildRank = b.guildRank ?? Infinity;
      if (aGuildRank !== bGuildRank) return aGuildRank - bGuildRank;
    }

    if (b.totalBossesKilled !== a.totalBossesKilled) return b.totalBossesKilled - a.totalBossesKilled;

    if (useSingleRaidRanking) {
      if (a.hasPullData && b.hasPullData) {
        if (a.fightCompletion !== b.fightCompletion) return a.fightCompletion - b.fightCompletion;
        if (a.bossHealth !== b.bossHealth) return a.bossHealth - b.bossHealth;
      } else if (a.hasPullData !== b.hasPullData) {
        return a.hasPullData ? -1 : 1;
      }

      const aWorldRank = a.worldRank ?? Infinity;
      const bWorldRank = b.worldRank ?? Infinity;
      if (aWorldRank !== bWorldRank) return aWorldRank - bWorldRank;

      return a.name.localeCompare(b.name);
    }

    if (a.lastKillTime && b.lastKillTime) return a.lastKillTime.getTime() - b.lastKillTime.getTime();
    if (a.lastKillTime && !b.lastKillTime) return -1;
    if (!a.lastKillTime && b.lastKillTime) return 1;
    return 0;
  };

  // Group guilds into families
  const guildFamilies = new Map<string, GuildProgressEntry[]>();

  for (const entry of allProgress) {
    if (entry.parentName) {
      const familyKey = entry.parentName;
      if (!guildFamilies.has(familyKey)) guildFamilies.set(familyKey, []);
      guildFamilies.get(familyKey)!.push(entry);
    } else if (parentGuildInfo.has(entry.name)) {
      const familyKey = entry.name;
      if (!guildFamilies.has(familyKey)) guildFamilies.set(familyKey, []);
      guildFamilies.get(familyKey)!.push(entry);
    } else {
      guildFamilies.set(`${entry.name}-${entry.realm}`, [entry]);
    }
  }

  // Pick the best-performing member of each family
  const consolidatedProgress: {
    name: string;
    realm: string;
    totalBossesKilled: number;
    totalBosses: number;
    lastKillTime: Date | null;
    isComplete: boolean;
    guildRank: number | null;
    hasPullData: boolean;
    fightCompletion: number;
    bossHealth: number;
    worldRank: number | null;
  }[] = [];

  for (const [familyKey, members] of guildFamilies) {
    members.sort(compareGuildProgress);

    const best = members[0];
    const parent = parentGuildInfo.get(familyKey);

    consolidatedProgress.push({
      name: parent ? parent.name : best.name,
      realm: parent ? parent.realm : best.realm,
      totalBossesKilled: best.totalBossesKilled,
      totalBosses: best.totalBosses,
      lastKillTime: best.lastKillTime,
      isComplete: best.isComplete,
      guildRank: best.guildRank,
      hasPullData: best.hasPullData,
      fightCompletion: best.fightCompletion,
      bossHealth: best.bossHealth,
      worldRank: best.worldRank,
    });
  }

  // Single-raid pickems should mirror the progress leaderboard order.
  // Multi-raid pickems keep the legacy combined boss-kill + kill-time sort.
  consolidatedProgress.sort(compareGuildProgress);

  return consolidatedProgress.slice(0, 50).map((g, index) => ({
    rank: index + 1,
    name: g.name,
    realm: g.realm,
    bossesKilled: g.totalBossesKilled,
    totalBosses: g.totalBosses,
    isComplete: g.isComplete,
    lastKillTime: g.lastKillTime,
  }));
}

// Helper function to get pickem leaderboard with streak bonuses
async function getPickemLeaderboard(pickemId: string, guildRankings: { rank: number; name: string; realm: string }[], pickem: IPickem) {
  // Get all users who have made predictions for this pickem
  const users = await User.find({ "pickems.pickemId": pickemId }).lean();

  // Create a map of guild -> actual rank for quick lookup
  const actualRankMap = new Map<string, number>();
  guildRankings.forEach((g) => {
    actualRankMap.set(`${g.name}-${g.realm}`, g.rank);
  });

  // For unfinalized RWF pickems, don't calculate scores - everyone gets 0
  const isUnfinalizedRwf = pickem.type === "rwf" && !pickem.finalized;
  const scoreOutOfRangeGuilds = pickem.type === "regular" && (pickem.scoreOutOfRangeGuilds ?? false);
  const scoredRankLimit = pickem.guildCount || 10;

  // Calculate scores for each user
  const leaderboard: {
    username: string;
    avatarUrl: string;
    totalPoints: number;
    positionPoints: number;
    streakBonus: number;
    streaks: { length: number; guilds: string[] }[];
    predictions: {
      guildName: string;
      realm: string;
      predictedRank: number;
      actualRank: number | null;
      points: number;
    }[];
  }[] = [];

  for (const user of users) {
    const entry = user.pickems?.find((p: IPickemEntry) => p.pickemId === pickemId);
    if (!entry) continue;

    let positionPoints = 0;
    const predictionResults: {
      guildName: string;
      realm: string;
      predictedRank: number;
      actualRank: number | null;
      points: number;
    }[] = [];
    const streakPredictions: {
      guildName: string;
      realm: string;
      predictedRank: number;
      actualRank: number | null;
    }[] = [];

    for (const pred of entry.predictions) {
      const key = `${pred.guildName}-${pred.realm}`;
      const actualRank = actualRankMap.get(key) ?? null;
      const isScoringEligibleRank = actualRank !== null && (pickem.type === "rwf" || scoreOutOfRangeGuilds || actualRank <= scoredRankLimit);
      const scoringActualRank = isScoringEligibleRank ? actualRank : null;

      // Regular pickems only score beyond the predicted range when explicitly enabled.
      const points = scoringActualRank !== null && !isUnfinalizedRwf ? calculatePickemPoints(pred.position, scoringActualRank, pickem.scoringConfig) : 0;
      positionPoints += points;

      predictionResults.push({
        guildName: pred.guildName,
        realm: pred.realm,
        predictedRank: pred.position,
        actualRank,
        points,
      });
      streakPredictions.push({
        guildName: pred.guildName,
        realm: pred.realm,
        predictedRank: pred.position,
        actualRank: scoringActualRank,
      });
    }

    // Calculate streak bonus (skip for unfinalized RWF)
    const { totalBonus: streakBonus, streaks } = isUnfinalizedRwf ? { totalBonus: 0, streaks: [] } : calculateStreakBonus(streakPredictions, pickem.streakConfig);

    // Sort predictions by predicted rank
    predictionResults.sort((a, b) => a.predictedRank - b.predictedRank);

    leaderboard.push({
      username: user.discord.username,
      avatarUrl: discordService.getAvatarUrl(user.discord.id, user.discord.avatar),
      totalPoints: positionPoints + streakBonus,
      positionPoints,
      streakBonus,
      streaks,
      predictions: predictionResults,
    });
  }

  // Sort leaderboard by total points (descending)
  leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);

  return leaderboard;
}

export default router;
