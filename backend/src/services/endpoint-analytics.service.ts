import { DailyStats } from "../models/Analytics";
import { AnalyticsCoverage } from "./site-analytics.service";

export async function endpointReport(query: Record<string, unknown>) {
  const integer = (value: unknown, fallback: number, maximum: number) => Math.max(1, Math.min(maximum, Number.parseInt(String(value), 10) || fallback));
  const days = integer(query.days, 7, 365);
  const page = integer(query.page, 1, 100000);
  const pageSize = integer(query.pageSize, 50, 100);
  const search = String(query.search || "").trim().slice(0, 100);
  const sort = ["count", "avgResponseTime", "errorCount"].includes(String(query.sort)) ? String(query.sort) : "count";
  const direction = query.order === "asc" ? 1 : -1;
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  // Persisted daily buckets cover the full range, including data older than the
  // raw-log TTL. Search and sorting happen before pagination, never on a top-N list.
  const [result, coverage] = await Promise.all([
    DailyStats.aggregate([
      { $match: { date: { $gte: since } } },
      { $project: { entries: { $objectToArray: "$endpointStats" } } },
      { $unwind: "$entries" },
      { $project: { endpoint: { $ifNull: ["$entries.v.endpoint", "$entries.k"] }, stat: "$entries.v" } },
      ...(search ? [{ $match: { endpoint: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } }] : []),
      { $group: { _id: "$endpoint", count: { $sum: "$stat.count" }, totalTime: { $sum: "$stat.totalResponseTime" }, totalSize: { $sum: "$stat.totalSize" }, errorCount: { $sum: "$stat.errorCount" }, methods: { $addToSet: "$stat.methods" }, lastCalled: { $max: "$stat.lastCalled" }, legacyCount: { $sum: { $subtract: ["$stat.count", { $ifNull: ["$stat.canonicalCount", 0] }] } } } },
      { $match: { count: { $gt: 0 } } },
      { $set: { endpoint: "$_id", avgResponseTime: { $round: [{ $divide: ["$totalTime", "$count"] }, 0] }, successRate: { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$count", "$errorCount"] }, "$count"] }, 100] }, 0] }, methods: { $reduce: { input: "$methods", initialValue: [], in: { $setUnion: ["$$value", { $ifNull: ["$$this", []] }] } } } } },
      { $facet: { total: [{ $count: "count" }], items: [{ $sort: { [sort]: direction, endpoint: 1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $unset: ["_id", "totalTime"] }] } },
    ]).allowDiskUse(true),
    AnalyticsCoverage.findById("v2").lean(),
  ]);
  return { items: result[0]?.items || [], total: result[0]?.total[0]?.count || 0, page, pageSize, startedAt: coverage?.startedAt || null };
}
