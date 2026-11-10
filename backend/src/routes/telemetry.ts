import { Router } from "express";
import { recordSiteActivity } from "../services/site-analytics.service";
import logger from "../utils/logger";
const router = Router();
router.post("/activity", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.sendStatus(await recordSiteActivity(req)); }
  catch { logger.error("Failed to record site activity"); res.sendStatus(503); }
});
export default router;
