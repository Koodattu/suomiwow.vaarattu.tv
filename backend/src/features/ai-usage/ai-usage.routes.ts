import { Router } from "express";
import { requireAdmin } from "../../middleware/admin.middleware";
import logger from "../../utils/logger";
import { AiCall, AI_FEATURES, type AiFeature } from "./ai-usage";

const metrics = {
  calls: { $sum: 1 }, polls: { $sum: { $cond: [{ $eq: ["$endpoint", "poll"] }, 1, 0] } },
  failures: { $sum: { $cond: [{ $in: ["$status", ["failed", "cancelled", "incomplete"]] }, 1, 0] } },
  unpriced: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$costNanoUsd", null] }, null] }, 1, 0] } },
  costNanoUsd: { $sum: "$costNanoUsd" }, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" },
  cachedInputTokens: { $sum: "$cachedInputTokens" }, cacheWriteTokens: { $sum: "$cacheWriteTokens" },
  reasoningTokens: { $sum: "$reasoningTokens" }, totalTokens: { $sum: "$totalTokens" },
};
type Totals = Record<keyof typeof metrics, number>;
const zero = Object.fromEntries(Object.keys(metrics).map(key => [key, 0])) as Totals;
export async function usageReport(days: number, page: number, feature?: AiFeature, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
  const match = { at: { $gte: start, $lte: now }, ...(feature && { feature }) };
  const pageSize = 25;
  const [grouped, calls, first] = await Promise.all([
    AiCall.aggregate<{ totals: Totals[]; byFeature: (Totals & { _id: string })[] }>([
      { $match: match }, { $facet: { totals: [{ $group: { _id: null, ...metrics } }, { $project: { _id: 0 } }],
        byFeature: [{ $group: { _id: "$feature", ...metrics } }, { $sort: { costNanoUsd: -1, _id: 1 } }] } },
    ]),
    AiCall.find(match).sort({ at: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).select("-__v").lean(),
    AiCall.findOne().sort({ at: 1, _id: 1 }).select("at").lean(),
  ]);
  return { start, end: now, firstRecordedAt: first?.at ?? null, pageSize, features: AI_FEATURES,
    totals: grouped[0]?.totals[0] ?? zero, byFeature: grouped[0]?.byFeature ?? [], calls };
}

export const aiUsageRouter = Router();
aiUsageRouter.use(requireAdmin);
aiUsageRouter.get("/", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const { days = "7", page = "1", feature } = req.query;
  if (typeof days !== "string" || !["1", "7", "30", "90"].includes(days) ||
      typeof page !== "string" || !/^[1-9]\d{0,6}$/.test(page) ||
      (feature !== undefined && !AI_FEATURES.includes(feature as AiFeature))) {
    res.status(400).json({ code: "invalid_query" }); return;
  }
  try { res.json(await usageReport(Number(days), Number(page), feature as AiFeature | undefined)); }
  catch { logger.error("[AI usage] Could not load report"); res.status(503).json({ code: "unavailable" }); }
});
