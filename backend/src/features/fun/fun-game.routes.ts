import { Router, type Request, type Response } from "express";
import logger from "../../utils/logger";
import { generateFunGameRound, loadBossMechanicCharacters, searchFunGameCandidates } from "./fun-game.service";
import { isFunGameSearchSlug, isFunGameSlug, isHigherOrWipeMode, type HigherOrWipeMode } from "./fun-game.types";
import { FunRoundUnavailableError } from "./fun-game.utils";

const router = Router();

router.get("/boss-mechanics/characters", async (_req: Request, res: Response) => {
  try {
    const response = await loadBossMechanicCharacters();
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
