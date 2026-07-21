import { Request, Response, Router } from "express";
import mongoose from "mongoose";
import { CCG_CONFIGURED_SETS } from "../config/ccg";
import { requireAdmin } from "../middleware/admin.middleware";
import CcgCard from "../models/CcgCard";
import CcgPackOpening from "../models/CcgPackOpening";
import CcgSet from "../models/CcgSet";
import Raid from "../models/Raid";
import characterMediaService from "../services/character-media.service";
import ccgPublisherService, { CcgPublisherError } from "../services/ccg-publisher.service";
import ccgService from "../services/ccg.service";
import logger from "../utils/logger";

const router = Router();
router.use(requireAdmin);

function adminRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const value = await handler(req, res);
      if (!res.headersSent) res.json(value);
    } catch (error) {
      logger.error("[Admin/CCG] Request failed:", error);
      if (error instanceof CcgPublisherError) return res.status(error.status).json({ error: error.message, code: error.code });
      res.status(500).json({ error: error instanceof Error ? error.message : "CCG administration request failed" });
    }
  };
}

router.get(
  "/status",
  adminRoute(async () => {
    await ccgPublisherService.ensureConfiguredSets();
    const minimumZoneId = Math.min(...CCG_CONFIGURED_SETS.map((set) => set.zoneId));
    const [sets, knownRaids, media, cards, openings] = await Promise.all([
      CcgSet.find().sort({ zoneId: 1 }).lean(),
      Raid.find({ id: { $gte: minimumZoneId } }).select("id name slug expansion").sort({ id: 1 }).lean(),
      characterMediaService.getStatus(),
      CcgCard.countDocuments(),
      CcgPackOpening.countDocuments(),
    ]);
    const setByZone = new Map(sets.map((set) => [set.zoneId, set]));
    const configuredZoneIds = new Set(CCG_CONFIGURED_SETS.map((set) => set.zoneId));
    return {
      sets: CCG_CONFIGURED_SETS.map((configured) => {
        const set = setByZone.get(configured.zoneId);
        return {
          id: set ? String(set._id) : null,
          zoneId: configured.zoneId,
          slug: configured.slug,
          raidName: configured.raidName,
          expansionName: configured.expansionName,
          targetMode: configured.state === "current" ? "current" : "legacy",
          state: set?.state ?? "draft",
          availability: set?.enabledAt ? "enabled" : "candidate",
          enabledAt: set?.enabledAt ?? null,
          enabledBy: set?.enabledBy ? String(set.enabledBy) : null,
          cardCount: set?.cardCount ?? 0,
          publicationWave: set?.publicationWave ?? 0,
          lastSnapshotAt: set?.lastSnapshotAt ?? null,
          lastPublishedAt: set?.lastPublishedAt ?? null,
          backgroundPath: configured.backgroundPath,
          theme: { mark: configured.mark, accent: configured.accent, glow: configured.glow },
        };
      }),
      excludedRaids: knownRaids
        .filter((raid) => !configuredZoneIds.has(raid.id))
        .map((raid) => ({ zoneId: raid.id, raidName: raid.name, slug: raid.slug, expansionName: raid.expansion, availability: "excluded" as const })),
      media,
      totals: { cards, openings },
    };
  }),
);

router.post(
  "/sets/bootstrap",
  adminRoute(async () => ({ sets: await ccgPublisherService.ensureConfiguredSets() })),
);

router.get(
  "/sets/:zoneId/preview",
  adminRoute(async (req) => ccgPublisherService.preview(Number(req.params.zoneId))),
);

router.post(
  "/sets/:zoneId/enable",
  adminRoute(async (req) => {
    const zoneId = Number(req.params.zoneId);
    if (!Number.isInteger(zoneId)) throw new CcgPublisherError(400, "invalid_zone", "A valid raid zone ID is required");
    const userId = (req as Request & { user?: { _id?: mongoose.Types.ObjectId | string } }).user?._id;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) throw new CcgPublisherError(401, "admin_identity_missing", "Admin identity is unavailable");
    return ccgPublisherService.enableSet(zoneId, new mongoose.Types.ObjectId(String(userId)));
  }),
);

router.post(
  "/sets/:zoneId/snapshot",
  adminRoute(async (req) => ccgPublisherService.buildSnapshot(Number(req.params.zoneId))),
);

router.post(
  "/sets/:setSlug/publish",
  adminRoute(async (req) => ccgPublisherService.publishLatestWave(req.params.setSlug)),
);

router.post(
  "/media/discover",
  adminRoute(async () => characterMediaService.enqueueMissing()),
);

router.post(
  "/media/refresh-current",
  adminRoute(async () => characterMediaService.enqueueActiveCurrent()),
);

router.post(
  "/media/recover",
  adminRoute(async () => ({ recovered: await characterMediaService.recoverStaleProcessing() })),
);

router.post(
  "/media/retry",
  adminRoute(async () => ({ retried: await characterMediaService.retryFailures() })),
);

router.post(
  "/guests/cleanup",
  adminRoute(async () => ccgService.cleanupExpiredGuestData()),
);

export default router;
