import { Router, type Request, type Response } from "express";
import { isValidObjectId } from "mongoose";
import discordService from "../../services/discord.service";
import logger from "../../utils/logger";
import { loadBossMechanicLeaderboard, sanitizeBossMechanicScoreInput, submitBossMechanicScore } from "./boss-mechanic-leaderboard.service";
import { generateFunGameRound, loadBossMechanicCharacters, loadBossMechanicGuilds, searchFunGameCandidates } from "./fun-game.service";
import { isFunGameSearchSlug, isFunGameSlug, isHigherOrWipeMode, type HigherOrWipeMode } from "./fun-game.types";
import { FunRoundUnavailableError } from "./fun-game.utils";

const router = Router();

async function getAuthenticatedUser(req: Request) {
  return req.session.userId ? discordService.getUserFromSession(req.session.userId) : null;
}

router.get("/boss-mechanics/leaderboard", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(await loadBossMechanicLeaderboard());
  } catch (error) {
    logger.error("[Fun] Failed to load boss mechanic leaderboard:", error);
    res.status(500).json({ error: "Failed to load boss mechanic leaderboard", code: "BOSS_MECHANIC_LEADERBOARD_FAILED" });
  }
});

router.post("/boss-mechanics/leaderboard", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });
      return;
    }
    const input = sanitizeBossMechanicScoreInput(req.body);
    if (!input) {
      res.status(400).json({ error: "Invalid boss mechanic score", code: "INVALID_BOSS_MECHANIC_SCORE" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(await submitBossMechanicScore(user, input));
  } catch (error) {
    logger.error("[Fun] Failed to submit boss mechanic score:", error);
    res.status(500).json({ error: "Failed to submit boss mechanic score", code: "BOSS_MECHANIC_SCORE_FAILED" });
  }
});

router.get("/boss-mechanics/guilds", async (_req: Request, res: Response) => {
  try {
    const response = await loadBossMechanicGuilds();
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json(response);
  } catch (error) {
    logger.error("[Fun] Failed to load boss mechanic guilds:", error);
    res.status(500).json({ error: "Failed to load boss mechanic guilds", code: "BOSS_MECHANIC_GUILDS_FAILED" });
  }
});

router.get("/boss-mechanics/characters", async (req: Request, res: Response) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  if (guildId && !isValidObjectId(guildId)) {
    res.status(400).json({ error: "Unknown boss mechanic guild", code: "UNKNOWN_BOSS_MECHANIC_GUILD" });
    return;
  }

  try {
    const response = await loadBossMechanicCharacters(guildId);
    res.setHeader("Cache-Control", "no-store");
    res.json(response);
  } catch (error) {
    if (error instanceof FunRoundUnavailableError) {
      res.status(503).json({ error: "A playable raid group could not be generated from the current data", code: "NO_BOSS_MECHANIC_GROUP" });
      return;
    }

    logger.error("[Fun] Failed to load boss mechanic characters:", error);
    res.status(500).json({ error: "Failed to load boss mechanic characters", code: "BOSS_MECHANIC_CHARACTERS_FAILED" });
  }
});

router.get("/:game/search", async (req: Request, res: Response) => {
  const game = req.params.game;
  if (!isFunGameSearchSlug(game)) {
    res.status(404).json({ error: "Search is not available for this prototype game", code: "UNKNOWN_FUN_SEARCH" });
    return;
  }

  const query = typeof req.query.q === "string" ? req.query.q : "";
  const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 10;
  try {
    const response = await searchFunGameCandidates(game, query, requestedLimit);
    res.json(response);
  } catch (error) {
    logger.error(`[Fun] Failed to search ${game}:`, error);
    res.status(500).json({ error: "Failed to search prototype game", code: "FUN_SEARCH_FAILED" });
  }
});

router.post("/:game/round", async (req: Request, res: Response) => {
  const game = req.params.game;
  if (!isFunGameSlug(game)) {
    res.status(404).json({ error: "Unknown prototype game", code: "UNKNOWN_FUN_GAME" });
    return;
  }

  let higherOrWipeMode: HigherOrWipeMode = "random";
  if (game === "higher-or-wipe" && req.query.mode !== undefined) {
    if (typeof req.query.mode !== "string" || !isHigherOrWipeMode(req.query.mode)) {
      res.status(400).json({ error: "Unknown Higher or Wipe mode", code: "UNKNOWN_HIGHER_OR_WIPE_MODE" });
      return;
    }
    higherOrWipeMode = req.query.mode;
  }

  try {
    const round = await generateFunGameRound(game, { higherOrWipeMode });
    res.setHeader("Cache-Control", "no-store");
    res.json(round);
  } catch (error) {
    if (error instanceof FunRoundUnavailableError) {
      res.status(503).json({ error: "A playable round could not be generated from the current data", code: "NO_FUN_ROUND" });
      return;
    }

    logger.error(`[Fun] Failed to generate ${game}:`, error);
    res.status(500).json({ error: "Failed to generate prototype game", code: "FUN_GENERATION_FAILED" });
  }
});

export default router;
