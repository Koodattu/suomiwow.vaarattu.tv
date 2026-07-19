import { Router, Request, Response } from "express";
import { TRACKED_RAIDS } from "../config/guilds";
import guildNetworkService from "../services/guild-network.service";
import logger from "../utils/logger";

const router = Router();

router.get("/meta", async (_req: Request, res: Response) => {
  try {
    const meta = await guildNetworkService.getActiveMeta();
    if (!meta) {
      return res.status(404).json({ error: "Guild network snapshot has not been built yet" });
    }

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=300");
    res.setHeader("ETag", meta.etag);
    res.json(meta);
  } catch (error) {
    logger.error("Error fetching guild network metadata:", error);
    res.status(500).json({ error: "Failed to fetch guild network metadata" });
  }
});

router.get("/universe", async (req: Request, res: Response) => {
  try {
    const ifNoneMatch = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : undefined;
    const streamed = await guildNetworkService.streamActiveUniverse(ifNoneMatch, res);
    if (!streamed && !res.headersSent) {
      res.status(404).json({ error: "Guild network snapshot has not been built yet" });
    }
  } catch (error) {
    logger.error("Error streaming guild network universe:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch guild network universe" });
    } else {
      res.end();
    }
  }
});

router.get("/raids/:raidId/movement", async (req: Request, res: Response) => {
  const raidId = Number(req.params.raidId);
  if (!Number.isInteger(raidId) || raidId <= 0) {
    res.status(400).json({ error: "Invalid raid ID" });
    return;
  }
  if (!TRACKED_RAIDS.includes(raidId)) {
    res.status(404).json({ error: "Raid is not available in the guild network" });
    return;
  }

  try {
    const ifNoneMatch = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : undefined;
    const streamed = await guildNetworkService.streamActiveRaidMovement(raidId, ifNoneMatch, res);
    if (!streamed && !res.headersSent) {
      res.status(404).json({ error: "Raid movement snapshot has not been built yet" });
    }
  } catch (error) {
    logger.error(`Error streaming guild network movement for raid ${raidId}:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch raid movement" });
    } else {
      res.end();
    }
  }
});

export default router;
