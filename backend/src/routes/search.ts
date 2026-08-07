import { Router, Request, Response } from "express";
import logger from "../utils/logger";
import searchService from "../services/search.service";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 5;
    const includeHistorical = req.query.scope === "all";
    const results = await searchService.searchSite(query, requestedLimit, { includeHistorical });

    res.json({ results });
  } catch (error) {
    logger.error("Error searching site:", error);
    res.status(500).json({ error: "Failed to search" });
  }
});

export default router;
