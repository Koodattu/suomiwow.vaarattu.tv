import { Router } from "express";
import mongoose from "mongoose";
import { activeAvoidableMechanics, findAvoidableMechanic } from "../config/avoidable-mechanics";
import { requireAdmin } from "../middleware/admin.middleware";
import service, { MechanicBackfillOptions } from "../services/avoidable-damage.service";
import logger from "../utils/logger";

export function parseMechanicBackfill(body: unknown): MechanicBackfillOptions | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { mechanicKeys, guildId, retryUnavailable } = body as Record<string, unknown>;
  if (!Array.isArray(mechanicKeys) || !mechanicKeys.length || mechanicKeys.length > activeAvoidableMechanics().length ||
      mechanicKeys.some((key) => typeof key !== "string" || !findAvoidableMechanic(key)) ||
      (guildId !== undefined && (typeof guildId !== "string" || !mongoose.isObjectIdOrHexString(guildId))) ||
      (retryUnavailable !== undefined && typeof retryUnavailable !== "boolean")) return null;
  return { mechanicKeys: [...new Set(mechanicKeys)], guildId, retryUnavailable: retryUnavailable === true };
}

const router = Router();
router.use(requireAdmin);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

router.get("/", async (req, res) => {
  const { guildId } = req.query;
  if (Object.keys(req.query).some((key) => key !== "guildId") ||
      (guildId !== undefined && (typeof guildId !== "string" || !mongoose.isObjectIdOrHexString(guildId)))) {
    return res.status(400).json({ error: "Invalid guild ID" });
  }
  try { res.json(await service.getCollectionStatus(guildId)); }
  catch (error) {
    logger.error("[AvoidableDamage] Admin status failed", error);
    res.status(500).json({ error: "Could not load mechanic collection status" });
  }
});

router.post("/queue", async (req, res) => {
  const options = parseMechanicBackfill(req.body);
  if (!options) return res.status(400).json({ error: "Select valid mechanics, an optional guild and a boolean retry option" });
  try { res.status(202).json(await service.queueBackfill(options)); }
  catch (error) {
    logger.error("[AvoidableDamage] Admin queue failed", error);
    res.status(500).json({ error: "Could not queue mechanic collection" });
  }
});

export default router;
