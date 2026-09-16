import { Router } from "express";
import { CCG_FEATURE_ENABLED } from "../config/ccg";
import User from "../models/User";
import CcgSupporterCharacter from "../models/CcgSupporterCharacter";
import { requireAdmin } from "../middleware/admin.middleware";
import studio from "../services/ccg-supporter.service";
import supporterStatus, { supporterLimit } from "../services/ccg-supporter-status.service";
import { CcgSupporterError } from "../utils/ccg-supporter";
import logger from "../utils/logger";

const router = Router();

router.use(async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!CCG_FEATURE_ENABLED) return res.status(404).json({ code: "feature_unavailable" });
  if (!req.session.userId) return res.status(401).json({ code: "authentication_required" });
  if (req.method !== "GET") {
    const allowedOrigin = process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
    if (req.headers.origin !== allowedOrigin || !req.is("application/json")) return res.status(403).json({ code: "invalid_origin" });
  }
  try {
    if (!await User.exists({ _id: req.session.userId })) return res.status(401).json({ code: "authentication_required" });
    await supporterLimit(`studio:${req.session.userId}`, 90, 60_000);
    next();
  } catch (error) { next(error); }
});

const route = (fn: (userId: string, body: Record<string, unknown>, id: string) => Promise<unknown>) =>
  async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try { res.json(await fn(req.session.userId!, req.body ?? {}, req.params.id)); }
    catch (error) { next(error); }
  };

router.get("/", route((userId) => studio.getState(userId)));
router.post("/roster", route((userId) => studio.getState(userId, true)));
router.post("/status", route(async (userId) => {
  await supporterStatus.initializeExistingLink(userId);
  await supporterStatus.refresh(userId, true);
  return studio.getState(userId);
}));
router.post("/drafts", route((userId, body) => studio.create(userId, body)));
router.patch("/drafts/:id", route((userId, body, id) => studio.save(userId, id, body)));
router.delete("/drafts/:id", route((userId, body, id) => studio.discard(userId, id, body.revision)));
router.post("/drafts/:id/render", route((userId, _body, id) => studio.refreshRender(userId, id)));
router.post("/drafts/:id/publish", route((userId, body, id) => studio.publish(userId, id, body.revision)));
router.get("/moderation", requireAdmin, route(async () => ({ creations: await CcgSupporterCharacter.find({ cardId: { $exists: true } })
  .select("_id name realm cardId editsFrozen distributable").sort({ createdAt: -1 }).lean() })));
router.patch("/moderation/:id", requireAdmin, route((_userId, body, id) => studio.moderate(id, body)));

router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  if (error instanceof CcgSupporterError) return res.status(error.status).json({ code: error.code, nextAllowedAt: error.nextAllowedAt });
  logger.error("[CCG/Studio] Request failed", error instanceof Error ? error.name : "unknown");
  res.status(500).json({ code: "studio_unavailable" });
});

export default router;
