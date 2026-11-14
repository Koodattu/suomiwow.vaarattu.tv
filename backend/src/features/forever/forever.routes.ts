import { Router, Request, Response, NextFunction } from "express";
import { requireAdmin } from "../../middleware/admin.middleware";
import discordService from "../../services/discord.service";
import logger from "../../utils/logger";
import * as service from "./forever.service";
import { foreverAnalytics } from "./forever-analytics";
import { namegameLeaderboard, namegameOverview } from "./forever-namegame";
import { queueGuildLanguageAssessments } from "./forever-guild-language.worker";

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try { const result = await handler(req, res); if (!res.headersSent) res.json(result ?? { ok: true }); }
    catch (error) {
      if (error instanceof service.ForeverError) {
        if (error.status === 429) res.setHeader("Retry-After", "3600");
        res.status(error.status).json({ code: error.code });
      } else { logger.error("[Forever] Request failed"); res.status(500).json({ code: "unavailable" }); }
    }
  };
}
async function requireDiscord(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.session?.userId || !await discordService.getUserFromSession(req.session.userId)) {
      res.status(401).json({ code: "login_required" }); return;
    }
    next();
  } catch { res.status(503).json({ code: "unavailable" }); }
}
export const foreverRouter = Router();
foreverRouter.get("/leveling", route(async (req) => service.leaderboard(req.query)));
foreverRouter.get("/analytics", route(async () => foreverAnalytics()));
foreverRouter.get("/namegame", route(async (req) => namegameLeaderboard(req.query)));
foreverRouter.get("/namegame/overview", route(async () => namegameOverview()));
foreverRouter.get("/characters/:id", route(async (req) => service.characterDetail(req.params.id)));
foreverRouter.post("/proposals", requireDiscord, route(async (req, res) => {
  const result = await service.addCharacter(req.body?.url, "proposal", req.session.userId!);
  res.status(202); return result;
}));
foreverRouter.post("/characters/:id/refresh", requireDiscord, route(async (req, res) => {
  const result = await service.requestRefresh(req.params.id, req.session.userId!); res.status(202); return result;
}));
foreverRouter.post("/guild-proposals", requireDiscord, route(async (req, res) => {
  const result = await service.addGuild(req.body?.url, "proposal", req.session.userId!);
  res.status(202); return result;
}));

export const foreverAdminRouter = Router();
foreverAdminRouter.use(requireAdmin);
foreverAdminRouter.get("/", route(async (req) => service.adminOverview(req.query)));
foreverAdminRouter.post("/guild-language", route(async (_req, res) => {
  const result = await queueGuildLanguageAssessments();
  res.status(202); return result;
}));
foreverAdminRouter.post("/characters", route(async (req) => service.addCharacter(req.body?.url, "admin", req.session.userId!, req.body?.twitchChannel)));
foreverAdminRouter.post("/characters/bulk", route(async (req) => service.adminCharacterAction(req.body?.ids, req.body?.action)));
foreverAdminRouter.patch("/characters/:id/twitch", route(async (req) => service.setCharacterTwitch(req.params.id, req.body?.twitchChannel)));
foreverAdminRouter.patch("/characters/:id", route(async (req) => service.setCharacterStatus(req.params.id, req.body?.status)));
foreverAdminRouter.post("/characters/:id/refresh", route(async (req) => service.adminCharacterAction([req.params.id], "retry")));
foreverAdminRouter.post("/characters/:id/refresh-now", route(async (req) => service.adminRefreshNow(req.params.id)));
foreverAdminRouter.get("/guilds/:id", route(async (req) => service.guildDetail(req.params.id)));
foreverAdminRouter.post("/guilds", route(async (req) => service.addGuild(req.body?.url, "admin", req.session.userId!)));
foreverAdminRouter.patch("/guilds/:id/visibility", route(async (req) => service.setGuildVisibility(req.params.id, req.body?.hidden)));
foreverAdminRouter.patch("/guilds/:id", route(async (req) => service.setGuildStatus(req.params.id, req.body?.status)));
foreverAdminRouter.post("/guilds/:id/refresh", route(async (req) => service.refreshGuild(req.params.id)));
