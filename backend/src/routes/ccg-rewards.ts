import { Router } from "express";
import mongoose from "mongoose";
import { CCG_FEATURE_ENABLED } from "../config/ccg";
import User from "../models/User";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import duplicates from "../services/ccg-duplicate-rewards.service";
import studio from "../services/ccg-supporter.service";
import pickems from "../services/pickem-ccg-reward.service";
import ccg from "../services/ccg.service";
import logger from "../utils/logger";

const router = Router();
router.use(async (req, res, next) => {
  if (!CCG_FEATURE_ENABLED) { res.status(404).json({ code: "ccg_disabled" }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    const origin = process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
    if (req.headers.origin !== origin || !req.is("application/json")) { res.status(403).json({ code: "invalid_origin" }); return; }
  }
  const id = req.session.userId;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) { res.status(401).json({ code: "authentication_required" }); return; }
  try {
    if (!await User.exists({ _id: id })) { res.status(401).json({ code: "authentication_required" }); return; }
    next();
  } catch (error) { next(error); }
});
router.get("/", async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const ownerId = new mongoose.Types.ObjectId(req.session.userId!);
    const [historical, pickem, creation, publicCodes, recent] = await Promise.all([
      duplicates.status(ownerId), pickems.getClaimableRewards(ownerId), studio.getClaimableRewards(String(ownerId)), ccg.getPublicRedeemCodes(ownerId),
      CcgLedgerEntry.find({ ownerType: "user", ownerId, action: { $in: ["duplicate_backfill", "supporter_creation", "pickem_reward", "redeem_code"] } })
        .select("action amount metadata.rewardType createdAt").sort({ createdAt: -1, _id: -1 }).limit(10).lean(),
    ]);
    res.json({ historical, items: [...pickem, ...creation], publicCodes,
      recent: recent.map(row => ({ id: String(row._id), source: row.action, packs: row.metadata?.rewardType === "card" ? 0 : row.amount,
        rewardType: row.metadata?.rewardType === "card" ? "card" : "packs", at: row.createdAt })) });
  } catch (error) { next(error); }
});
router.post("/claim", async (req, res, next) => {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.session.userId!);
    const { source, id } = req.body ?? {};
    if (source !== "duplicates" && (typeof id !== "string" || !id.length)) { res.status(400).json({ code: "invalid_reward" }); return; }
    if (source === "duplicates") res.json(await ccg.claimHistoricalDuplicates(req));
    else if (source === "pickem") res.json(await pickems.claim(ownerId, id));
    else if (source === "studio") res.json(await studio.claimPacks(String(ownerId), id));
    else if (source === "code") res.json(await ccg.claimPublicRedeemCode(req, id));
    else res.status(400).json({ code: "invalid_reward" });
  } catch (error) { next(error); }
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  const known = error as { status?: number; code?: string };
  if (known.status && known.code) { res.status(known.status).json({ code: known.code }); return; }
  logger.error("[CCG] Rewards request failed", error);
  res.status(500).json({ code: "rewards_failed" });
});
export default router;
