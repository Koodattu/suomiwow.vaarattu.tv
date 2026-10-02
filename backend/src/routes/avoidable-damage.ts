import { Router } from "express";
import mongoose from "mongoose";
import { findAvoidableMechanic } from "../config/avoidable-mechanics";
import avoidableDamageService, { MechanicLeaderboardFilters } from "../services/avoidable-damage.service";
import { MECHANIC_MIN_PULLS, MECHANIC_ROLES } from "../utils/mechanic-leaderboard";
import logger from "../utils/logger";

export function parseMechanicFilters(query: Record<string, unknown>): MechanicLeaderboardFilters | null {
  const { mechanic, guildId, outcome = "all", sort = "damage", order = "desc", roles = "dps,healer,tank", minPulls = "10", page = "1", limit = "50" } = query;
  if (typeof mechanic !== "string" || !findAvoidableMechanic(mechanic) ||
      (guildId !== undefined && (typeof guildId !== "string" || !mongoose.isObjectIdOrHexString(guildId))) ||
      typeof outcome !== "string" || !["all", "kills", "wipes"].includes(outcome) ||
      typeof sort !== "string" || !["damage", "hits", "hitsPerPull"].includes(sort) ||
      typeof order !== "string" || !["asc", "desc"].includes(order) ||
      typeof roles !== "string" || (roles !== "" && roles.split(",").some((role) => !MECHANIC_ROLES.includes(role as typeof MECHANIC_ROLES[number]))) ||
      typeof minPulls !== "string" || !/^(0|[1-9]\d*)$/.test(minPulls) || !MECHANIC_MIN_PULLS.includes(Number(minPulls)) ||
      typeof page !== "string" || !/^[1-9]\d*$/.test(page) || Number(page) > 10000 ||
      typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100) return null;
  return { mechanic, guildId: guildId?.toLowerCase(), outcome, sort, order,
    roles: MECHANIC_ROLES.filter((role) => roles.split(",").includes(role)), minPulls: Number(minPulls),
    page: Number(page), limit: Number(limit) } as MechanicLeaderboardFilters;
}

const router = Router();
router.get("/options", async (_req, res) => {
  try {
    const data = await avoidableDamageService.getOptions();
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
    res.json(data);
  }
  catch (error) { logger.error("[AvoidableDamage] Options failed", error); res.status(500).json({ error: "Could not load mechanic options" }); }
});
router.get("/", (req, res, next) => {
  const filters = parseMechanicFilters(req.query);
  if (!filters) return res.status(400).json({ error: "Invalid mechanic leaderboard filters" });
  res.locals.mechanicFilters = filters;
  next();
}, async (_req, res) => {
  try {
    const data = await avoidableDamageService.getLeaderboard(res.locals.mechanicFilters);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
    res.json(data);
  }
  catch (error) { logger.error("[AvoidableDamage] Leaderboard failed", error); res.status(500).json({ error: "Could not load mechanic leaderboard" }); }
});
export default router;
