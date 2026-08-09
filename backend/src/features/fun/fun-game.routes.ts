import { Router, type Request, type Response } from "express";
import logger from "../../utils/logger";
import { generateFunGameRound } from "./fun-game.service";
import { isFunGameSlug } from "./fun-game.types";
import { FunRoundUnavailableError } from "./fun-game.utils";

const router = Router();

router.post("/:game/round", async (req: Request, res: Response) => {
  const game = req.params.game;
  if (!isFunGameSlug(game)) {
    res.status(404).json({ error: "Unknown prototype game", code: "UNKNOWN_FUN_GAME" });
    return;
  }

  try {
    const round = await generateFunGameRound(game);
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
