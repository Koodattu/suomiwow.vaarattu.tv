import { Router } from "express";
import mongoose from "mongoose";
import { findAvoidableMechanic } from "../config/avoidable-mechanics";
import { cacheMiddleware } from "../middleware/cache.middleware";
import avoidableDamageService, { MechanicLeaderboardFilters } from "../services/avoidable-damage.service";
import logger from "../utils/logger";

export function parseMechanicFilters(query: Record<string, unknown>): MechanicLeaderboardFilters | null {
  const { mechanic, guildId, outcome = "all", sort = "damage", page = "1", limit = "50" } = query;
  if (typeof mechanic !== "string" || !findAvoidableMechanic(mechanic) ||
      (guildId !== undefined && (typeof guildId !== "string" || !mongoose.isObjectIdOrHexString(guildId))) ||
      typeof outcome !== "string" || !["all", "kills", "wipes"].includes(outcome) ||
      typeof sort !== "string" || !["damage", "hits", "hitsPerPull"].includes(sort) ||
      typeof page !== "string" || !/^[1-9]\d*$/.test(page) || Number(page) > 10000 ||
      typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100) return null;
  return { mechanic, guildId, outcome, sort, page: Number(page), limit: Number(limit) } as MechanicLeaderboardFilters;
}

const router = Router();
router.get("/options", cacheMiddleware(() => "avoidable-damage:options:v1", () => 5 * 60 * 1000), async (_req, res) => {
  try { res.json(await avoidableDamageService.getOptions()); }
  catch (error) { logger.error("[AvoidableDamage] Options failed", error); res.status(500).json({ error: "Could not load mechanic options" }); }
});
router.get("/", (req, res, next) => {
  const filters = parseMechanicFilters(req.query);
  if (!filters) return res.status(400).json({ error: "Invalid mechanic leaderboard filters" });
  res.locals.mechanicFilters = filters;
  next();
}, cacheMiddleware((req) => `avoidable-damage:${JSON.stringify(parseMechanicFilters(req.query))}`, () => 5 * 60 * 1000), async (_req, res) => {
  try { res.json(await avoidableDamageService.getLeaderboard(res.locals.mechanicFilters)); }
  catch (error) { logger.error("[AvoidableDamage] Leaderboard failed", error); res.status(500).json({ error: "Could not load mechanic leaderboard" }); }
});
export default router;
