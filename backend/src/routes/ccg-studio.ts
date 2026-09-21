import { Router, raw } from "express";
import { CCG_FEATURE_ENABLED } from "../config/ccg";
import User from "../models/User";
import CcgSupporterCharacter from "../models/CcgSupporterCharacter";
import { requireAdmin } from "../middleware/admin.middleware";
import studio from "../services/ccg-supporter.service";
import supporterStatus, { supporterLimit } from "../services/ccg-supporter-status.service";
import { CcgSupporterError } from "../utils/ccg-supporter";
import logger from "../utils/logger";
import media from "../services/ccg-supporter-media.service";
import Media from "../models/CcgSupporterMedia";

const router = Router();

router.use(async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!CCG_FEATURE_ENABLED) return res.status(404).json({ code: "feature_unavailable" });
  if (!req.session.userId) return res.status(401).json({ code: "authentication_required" });
  if (req.method !== "GET") {
    const allowedOrigin = process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
    const upload = req.method === "POST" && /^\/media\/[a-f0-9]{24}\/(image|audio)$/i.test(req.path);
    if (req.headers.origin !== allowedOrigin || !req.is(upload ? "application/octet-stream" : "application/json")) return res.status(403).json({ code: "invalid_origin" });
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
router.get("/characters", route((userId) => studio.getCharacters(userId)));
router.post("/roster", route((userId) => studio.getCharacters(userId, true)));
router.post("/rewards/claim", route((userId) => studio.claimPacks(userId)));
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
router.post("/media/:id/:kind", raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res, next) => {
  try {
    if (!["image", "audio"].includes(req.params.kind) || !Buffer.isBuffer(req.body)) throw new CcgSupporterError(400, "invalid_media");
    res.json(await studio.submitMedia(req.session.userId!, req.params.id, req.params.kind as "image" | "audio", req.body));
  } catch (error) { next(error); }
});
router.delete("/media/:id", route((userId, _body, id) => studio.withdrawMedia(userId, id)));
router.get("/media-review", requireAdmin, route(async () => {
  const ids = await Media.distinct("sourceId", { status: { $in: ["pending", "approved"] }, purgedAt: null });
  const sources = await CcgSupporterCharacter.find({ _id: { $in: ids } }).select("_id name realm cardId").lean();
  return { submissions: await media.list(sources.map((source) => source._id), true), sources };
}));
router.post("/media-review/:id", requireAdmin, route((userId, body, id) => media.review(id, userId, body.action, body.reason)));

router.use((error: unknown, req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  if ((error as { type?: string })?.type === "entity.too.large") return res.status(413).json({ code: req.path.endsWith("/image") ? "media_image_size" : "media_audio_size" });
  if (error instanceof CcgSupporterError) return res.status(error.status).json({ code: error.code, nextAllowedAt: error.nextAllowedAt });
  logger.error("[CCG/Studio] Request failed", error instanceof Error ? error.name : "unknown");
  res.status(500).json({ code: "studio_unavailable" });
});

export default router;
