import { Router, type Request, type Response } from "express";
import logger from "../../utils/logger";
import { generateFunGameRound } from "./fun-game.service";
import { isFunGameSlug, isHigherOrWipeMode, type HigherOrWipeMode } from "./fun-game.types";
import { FunRoundUnavailableError } from "./fun-game.utils";

const router = Router();

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
