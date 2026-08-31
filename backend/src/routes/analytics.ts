import { Router, Request, Response } from "express";
import { RequestLog, HourlyStats, DailyStats } from "../models/Analytics";
import { requireAdmin } from "../middleware/admin.middleware";
import logger from "../utils/logger";

const router = Router();
const DAILY_STATS_BATCH_SIZE = 10;

router.use(requireAdmin);

// Helper to format bytes to human readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

type StatsMap<T> = Map<string, T> | Record<string, T> | null | undefined;

type DailyEndpointAggregate = {
  endpoint?: string;
  count?: number;
  totalResponseTime?: number;
  totalSize?: number;
  errorCount?: number;
  methods?: string[];
  lastCalled?: Date | string;
  lastErrorAt?: Date | string;
  statusCodes?: StatsMap<number>;
};

type DailyStatsDocument = {
  date: Date | string;
  totalRequests?: number;
  totalResponseTime?: number;
  totalDataTransferred?: number;
  uniqueVisitors?: number;
  statusCodeSummary?: StatsMap<number>;
  endpointStats?: StatsMap<DailyEndpointAggregate>;
};

type EndpointAggregate = {
  endpoint: string;
  count: number;
  totalResponseTime: number;
  totalSize: number;
  errorCount: number;
  methods: Set<string>;
  lastCalled?: Date;
  lastErrorAt?: Date;
  statusCodes: Map<string, number>;
};

type OverviewStatsAggregate = {
  totalRequests24h: number;
  totalResponseTime24h: number;
  totalDataTransferred24h: number;
  totalRequests7d: number;
  totalResponseTime7d: number;
  totalDataTransferred7d: number;
  totalRequests30d: number;
  totalResponseTime30d: number;
  totalDataTransferred30d: number;
};

type OverviewVisitorAggregate = {
  uniqueVisitors24h: number;
  uniqueVisitors7d: number;
  uniqueVisitors30d: number;
};

type SlowEndpointAggregate = {
  _id: string;
  count: number;
  avgResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  p95ResponseTime: number[];
};

const mapEntries = <T>(value: StatsMap<T>): [string, T][] => {
  if (!value) return [];
  if (value instanceof Map) return Array.from(value.entries());
  return Object.entries(value);
};

const toDateKey = (date: Date | string): string => new Date(date).toISOString().slice(0, 10);

const toValidDate = (date?: Date | string): Date | undefined => {
  if (!date) return undefined;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const getStartDate = (days: number): Date => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  return startDate;
};

const getErrorCountFromStatusCodes = (statusCodes: StatsMap<number>): number =>
  mapEntries(statusCodes).reduce((total, [statusCode, count]) => total + (parseInt(statusCode, 10) >= 400 ? count || 0 : 0), 0);

const aggregateEndpointsFromDailyStats = async (startDate: Date, limit: number): Promise<EndpointAggregate[]> => {
  const dailyDocs = DailyStats.find({ date: { $gte: startDate } }).select("endpointStats").lean().cursor({ batchSize: DAILY_STATS_BATCH_SIZE });
  const byEndpoint = new Map<string, EndpointAggregate>();

  for await (const document of dailyDocs) {
    const day = document as unknown as DailyStatsDocument;
    for (const [key, stat] of mapEntries(day.endpointStats)) {
      const endpoint = stat.endpoint || key;
      const existing =
        byEndpoint.get(endpoint) ||
        ({
          endpoint,
          count: 0,
          totalResponseTime: 0,
          totalSize: 0,
          errorCount: 0,
          methods: new Set<string>(),
          statusCodes: new Map<string, number>(),
        } satisfies EndpointAggregate);

      existing.count += stat.count || 0;
      existing.totalResponseTime += stat.totalResponseTime || 0;
      existing.totalSize += stat.totalSize || 0;
      existing.errorCount += typeof stat.errorCount === "number" ? stat.errorCount : getErrorCountFromStatusCodes(stat.statusCodes);

      for (const method of stat.methods || []) {
        existing.methods.add(method);
      }

      for (const [statusCode, count] of mapEntries(stat.statusCodes)) {
        existing.statusCodes.set(statusCode, (existing.statusCodes.get(statusCode) || 0) + (count || 0));
      }

      const lastCalled = toValidDate(stat.lastCalled);
      if (lastCalled && (!existing.lastCalled || lastCalled > existing.lastCalled)) {
        existing.lastCalled = lastCalled;
      }

      const lastErrorAt = toValidDate(stat.lastErrorAt);
      if (lastErrorAt && (!existing.lastErrorAt || lastErrorAt > existing.lastErrorAt)) {
        existing.lastErrorAt = lastErrorAt;
      }

      byEndpoint.set(endpoint, existing);
    }
  }

  return Array.from(byEndpoint.values())
    .filter((stat) => stat.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};

const aggregateStatusCodesFromDailyStats = async (startDate: Date): Promise<Array<{ statusCode: number; count: number }>> => {
  const dailyDocs = DailyStats.find({ date: { $gte: startDate } }).select("statusCodeSummary").lean().cursor({ batchSize: DAILY_STATS_BATCH_SIZE });
  const statusCounts = new Map<string, number>();

  for await (const document of dailyDocs) {
    const day = document as unknown as DailyStatsDocument;
    for (const [statusCode, count] of mapEntries(day.statusCodeSummary)) {
      statusCounts.set(statusCode, (statusCounts.get(statusCode) || 0) + (count || 0));
    }
  }

  return Array.from(statusCounts.entries())
    .map(([statusCode, count]) => ({ statusCode: parseInt(statusCode, 10), count }))
    .filter((stat) => Number.isFinite(stat.statusCode))
    .sort((a, b) => a.statusCode - b.statusCode);
};

const aggregateErrorsFromDailyStats = async (startDate: Date, limit: number) => {
  const endpoints = await aggregateEndpointsFromDailyStats(startDate, Number.MAX_SAFE_INTEGER);
  const details = endpoints.flatMap((endpoint) => {
    const lastOccurred = endpoint.lastErrorAt || endpoint.lastCalled || new Date();

    return Array.from(endpoint.statusCodes.entries())
      .filter(([statusCode, count]) => parseInt(statusCode, 10) >= 400 && count > 0)
      .map(([statusCode, count]) => ({
        endpoint: endpoint.endpoint,
        statusCode: parseInt(statusCode, 10),
        count,
        lastOccurred,
      }));
  });

  return details.sort((a, b) => b.count - a.count).slice(0, limit);
};

// Get overview stats (last 24 hours, 7 days, 30 days)
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // One pass per collection avoids scanning the same windows repeatedly. The
    // visitor aggregation returns three numbers instead of materializing every
    // distinct visitor hash in the Node.js process.
    const [statsResult, visitorResult] = await Promise.all([
      HourlyStats.aggregate<OverviewStatsAggregate>([
        { $match: { hour: { $gte: last30d } } },
        {
          $group: {
            _id: null,
            totalRequests24h: { $sum: { $cond: [{ $gte: ["$hour", last24h] }, "$totalRequests", 0] } },
            totalResponseTime24h: { $sum: { $cond: [{ $gte: ["$hour", last24h] }, "$totalResponseTime", 0] } },
            totalDataTransferred24h: { $sum: { $cond: [{ $gte: ["$hour", last24h] }, "$totalDataTransferred", 0] } },
            totalRequests7d: { $sum: { $cond: [{ $gte: ["$hour", last7d] }, "$totalRequests", 0] } },
            totalResponseTime7d: { $sum: { $cond: [{ $gte: ["$hour", last7d] }, "$totalResponseTime", 0] } },
            totalDataTransferred7d: { $sum: { $cond: [{ $gte: ["$hour", last7d] }, "$totalDataTransferred", 0] } },
            totalRequests30d: { $sum: "$totalRequests" },
            totalResponseTime30d: { $sum: "$totalResponseTime" },
            totalDataTransferred30d: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
      RequestLog.aggregate<OverviewVisitorAggregate>([
        {
          $match: {
            timestamp: { $gte: last30d },
            visitorHash: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: "$visitorHash", lastSeen: { $max: "$timestamp" } } },
        {
          $group: {
            _id: null,
            uniqueVisitors24h: { $sum: { $cond: [{ $gte: ["$lastSeen", last24h] }, 1, 0] } },
            uniqueVisitors7d: { $sum: { $cond: [{ $gte: ["$lastSeen", last7d] }, 1, 0] } },
            uniqueVisitors30d: { $sum: 1 },
          },
        },
      ]).allowDiskUse(true),
    ]);

    const stats = statsResult[0];
    const visitors = visitorResult[0];
    const formatPeriodStats = (totalRequests = 0, totalResponseTime = 0, totalDataTransferred = 0, uniqueVisitors = 0) => {
      return {
        totalRequests,
        avgResponseTime: totalRequests > 0 ? Math.round(totalResponseTime / totalRequests) : 0,
        totalDataTransferred,
        formattedData: formatBytes(totalDataTransferred),
        uniqueVisitors,
      };
    };

    res.json({
      last24Hours: formatPeriodStats(stats?.totalRequests24h, stats?.totalResponseTime24h, stats?.totalDataTransferred24h, visitors?.uniqueVisitors24h),
      last7Days: formatPeriodStats(stats?.totalRequests7d, stats?.totalResponseTime7d, stats?.totalDataTransferred7d, visitors?.uniqueVisitors7d),
      last30Days: formatPeriodStats(stats?.totalRequests30d, stats?.totalResponseTime30d, stats?.totalDataTransferred30d, visitors?.uniqueVisitors30d),
    });
  } catch (error) {
    logger.error("Error fetching analytics overview:", error);
    res.status(500).json({ error: "Failed to fetch analytics overview" });
  }
});

// Get hourly breakdown for a specific date range
router.get("/hourly", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const hourlyStats = await HourlyStats.find({
      hour: { $gte: startDate },
    })
      .select("hour totalRequests totalResponseTime totalDataTransferred")
      .sort({ hour: 1 })
      .lean();

    const formatted = hourlyStats.map((stat) => ({
      hour: stat.hour,
      requests: stat.totalRequests,
      avgResponseTime: stat.totalRequests > 0 ? Math.round(stat.totalResponseTime / stat.totalRequests) : 0,
      dataTransferred: stat.totalDataTransferred,
      formattedData: formatBytes(stat.totalDataTransferred),
    }));

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching hourly analytics:", error);
    res.status(500).json({ error: "Failed to fetch hourly analytics" });
  }
});

// Get daily breakdown
router.get("/daily", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = getStartDate(days);

    // Aggregate hourly stats into daily
    const [dailyStats, persistedDailyStats] = await Promise.all([
      HourlyStats.aggregate([
        { $match: { hour: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$hour" },
            },
            totalRequests: { $sum: "$totalRequests" },
            totalResponseTime: { $sum: "$totalResponseTime" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      DailyStats.find({ date: { $gte: startDate } }).select("date totalRequests totalResponseTime totalDataTransferred uniqueVisitors").sort({ date: 1 }).lean(),
    ]);

    const rowsByDate = new Map<
      string,
      {
        date: string;
        requests: number;
        totalResponseTime: number;
        dataTransferred: number;
        uniqueVisitors: number;
      }
    >();

    for (const stat of dailyStats) {
      rowsByDate.set(stat._id as string, {
        date: stat._id as string,
        requests: stat.totalRequests || 0,
        totalResponseTime: stat.totalResponseTime || 0,
        dataTransferred: stat.totalDataTransferred || 0,
        uniqueVisitors: 0,
      });
    }

    for (const stat of persistedDailyStats as DailyStatsDocument[]) {
      const date = toDateKey(stat.date);
      const existing = rowsByDate.get(date);

      if (existing) {
        existing.uniqueVisitors = stat.uniqueVisitors || 0;
      } else {
        rowsByDate.set(date, {
          date,
          requests: stat.totalRequests || 0,
          totalResponseTime: stat.totalResponseTime || 0,
          dataTransferred: stat.totalDataTransferred || 0,
          uniqueVisitors: stat.uniqueVisitors || 0,
        });
      }
    }

    const formatted = Array.from(rowsByDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((stat) => ({
        date: stat.date,
        requests: stat.requests,
        avgResponseTime: stat.requests > 0 ? Math.round(stat.totalResponseTime / stat.requests) : 0,
        dataTransferred: stat.dataTransferred,
        formattedData: formatBytes(stat.dataTransferred),
        uniqueVisitors: stat.uniqueVisitors,
      }));

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching daily analytics:", error);
    res.status(500).json({ error: "Failed to fetch daily analytics" });
  }
});

// Get top endpoints
router.get("/endpoints", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const limit = parseInt(req.query.limit as string) || 100; // Default to 100, allow fetching all
    const startDate = getStartDate(days);

    const dailyEndpointStats = await aggregateEndpointsFromDailyStats(startDate, limit);

    if (days > 30 && dailyEndpointStats.length > 0) {
      const formatted = dailyEndpointStats.map((stat) => ({
        endpoint: stat.endpoint,
        count: stat.count,
        avgResponseTime: stat.count > 0 ? Math.round(stat.totalResponseTime / stat.count) : 0,
        totalSize: stat.totalSize,
        formattedSize: formatBytes(stat.totalSize),
        successRate: stat.count > 0 ? Math.round(((stat.count - stat.errorCount) / stat.count) * 100) : 0,
        errorCount: stat.errorCount,
        methods: Array.from(stat.methods),
        lastCalled: stat.lastCalled,
      }));

      return res.json(formatted);
    }

    const endpointStats = await RequestLog.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: "$endpoint",
          count: { $sum: 1 },
          avgResponseTime: { $avg: "$responseTime" },
          totalSize: { $sum: "$responseSize" },
          successCount: {
            $sum: { $cond: [{ $lt: ["$statusCode", 400] }, 1, 0] },
          },
          errorCount: {
            $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
          },
          methods: { $addToSet: "$method" },
          lastCalled: { $max: "$timestamp" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    const formatted = endpointStats.map((stat) => ({
      endpoint: stat._id,
      count: stat.count,
      avgResponseTime: Math.round(stat.avgResponseTime),
      totalSize: stat.totalSize,
      formattedSize: formatBytes(stat.totalSize),
      successRate: stat.count > 0 ? Math.round((stat.successCount / stat.count) * 100) : 0,
      errorCount: stat.errorCount,
      methods: stat.methods,
      lastCalled: stat.lastCalled,
    }));

    if (formatted.length === 0 && dailyEndpointStats.length > 0) {
      return res.json(
        dailyEndpointStats.map((stat) => ({
          endpoint: stat.endpoint,
          count: stat.count,
          avgResponseTime: stat.count > 0 ? Math.round(stat.totalResponseTime / stat.count) : 0,
          totalSize: stat.totalSize,
          formattedSize: formatBytes(stat.totalSize),
          successRate: stat.count > 0 ? Math.round(((stat.count - stat.errorCount) / stat.count) * 100) : 0,
          errorCount: stat.errorCount,
          methods: Array.from(stat.methods),
          lastCalled: stat.lastCalled,
        })),
      );
    }

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching endpoint analytics:", error);
    res.status(500).json({ error: "Failed to fetch endpoint analytics" });
  }
});

// Get status code distribution
router.get("/status-codes", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = getStartDate(days);

    const dailyStatusStats = await aggregateStatusCodesFromDailyStats(startDate);

    if (days > 30 && dailyStatusStats.length > 0) {
      return res.json(dailyStatusStats);
    }

    const statusStats = await RequestLog.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: "$statusCode",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const formatted = statusStats.map((stat) => ({
      statusCode: stat._id,
      count: stat.count,
    }));

    if (formatted.length === 0 && dailyStatusStats.length > 0) {
      return res.json(dailyStatusStats);
    }

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching status code analytics:", error);
    res.status(500).json({ error: "Failed to fetch status code analytics" });
  }
});

// Get recent requests (for debugging/live view)
router.get("/recent", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const recentLogs = await RequestLog.find()
      .select("endpoint method statusCode responseTime responseSize timestamp")
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const formatted = recentLogs.map((log) => ({
      endpoint: log.endpoint,
      method: log.method,
      statusCode: log.statusCode,
      responseTime: log.responseTime,
      responseSize: log.responseSize,
      formattedSize: formatBytes(log.responseSize),
      timestamp: log.timestamp,
    }));

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching recent requests:", error);
    res.status(500).json({ error: "Failed to fetch recent requests" });
  }
});

// Get real-time stats (current hour)
router.get("/realtime", async (req: Request, res: Response) => {
  try {
    const currentHour = new Date();
    currentHour.setMinutes(0, 0, 0);

    const [hourlyData, recentRequests] = await Promise.all([
      HourlyStats.findOne({ hour: currentHour }).select("totalRequests totalResponseTime totalDataTransferred").lean(),
      RequestLog.countDocuments({
        timestamp: { $gte: new Date(Date.now() - 60000) }, // Last minute
      }),
    ]);

    res.json({
      currentHour: hourlyData
        ? {
            requests: hourlyData.totalRequests,
            avgResponseTime: hourlyData.totalRequests > 0 ? Math.round(hourlyData.totalResponseTime / hourlyData.totalRequests) : 0,
            dataTransferred: formatBytes(hourlyData.totalDataTransferred),
          }
        : { requests: 0, avgResponseTime: 0, dataTransferred: "0 B" },
      requestsPerMinute: recentRequests,
    });
  } catch (error) {
    logger.error("Error fetching realtime analytics:", error);
    res.status(500).json({ error: "Failed to fetch realtime analytics" });
  }
});

// Get peak hours analysis (which hours of the day have most traffic)
router.get("/peak-hours", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const peakHours = await HourlyStats.aggregate([
      { $match: { hour: { $gte: startDate } } },
      {
        $group: {
          _id: { $hour: "$hour" },
          totalRequests: { $sum: "$totalRequests" },
          avgRequests: { $avg: "$totalRequests" },
          totalResponseTime: { $sum: "$totalResponseTime" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const formatted = peakHours.map((stat) => ({
      hour: stat._id,
      hourLabel: `${stat._id.toString().padStart(2, "0")}:00`,
      totalRequests: stat.totalRequests,
      avgRequests: Math.round(stat.avgRequests),
      avgResponseTime: stat.totalRequests > 0 ? Math.round(stat.totalResponseTime / stat.totalRequests) : 0,
    }));

    // Find peak hour
    const peak = formatted.reduce((max, h) => (h.avgRequests > max.avgRequests ? h : max), formatted[0] || { hour: 0, avgRequests: 0 });

    res.json({
      hours: formatted,
      peakHour: peak,
    });
  } catch (error) {
    logger.error("Error fetching peak hours analytics:", error);
    res.status(500).json({ error: "Failed to fetch peak hours analytics" });
  }
});

// Get traffic trends (compare periods)
router.get("/trends", async (req: Request, res: Response) => {
  try {
    const now = new Date();

    // Current week vs previous week
    const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Today vs yesterday
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    const [thisWeek, lastWeek, today, yesterday] = await Promise.all([
      HourlyStats.aggregate([
        { $match: { hour: { $gte: thisWeekStart } } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: "$totalRequests" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
      HourlyStats.aggregate([
        { $match: { hour: { $gte: lastWeekStart, $lt: thisWeekStart } } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: "$totalRequests" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
      HourlyStats.aggregate([
        { $match: { hour: { $gte: todayStart } } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: "$totalRequests" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
      HourlyStats.aggregate([
        { $match: { hour: { $gte: yesterdayStart, $lt: todayStart } } },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: "$totalRequests" },
            totalDataTransferred: { $sum: "$totalDataTransferred" },
          },
        },
      ]),
    ]);

    const getStats = (arr: Array<{ totalRequests: number; totalDataTransferred: number }>) => arr[0] || { totalRequests: 0, totalDataTransferred: 0 };

    const thisWeekStats = getStats(thisWeek);
    const lastWeekStats = getStats(lastWeek);
    const todayStats = getStats(today);
    const yesterdayStats = getStats(yesterday);

    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    res.json({
      weekOverWeek: {
        current: thisWeekStats.totalRequests,
        previous: lastWeekStats.totalRequests,
        change: calcChange(thisWeekStats.totalRequests, lastWeekStats.totalRequests),
        dataChange: calcChange(thisWeekStats.totalDataTransferred, lastWeekStats.totalDataTransferred),
      },
      dayOverDay: {
        current: todayStats.totalRequests,
        previous: yesterdayStats.totalRequests,
        change: calcChange(todayStats.totalRequests, yesterdayStats.totalRequests),
        dataChange: calcChange(todayStats.totalDataTransferred, yesterdayStats.totalDataTransferred),
      },
    });
  } catch (error) {
    logger.error("Error fetching trends analytics:", error);
    res.status(500).json({ error: "Failed to fetch trends analytics" });
  }
});

// Get slowest endpoints (performance issues)
router.get("/slow-endpoints", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const threshold = parseInt(req.query.threshold as string) || 10; // Minimum requests to be considered
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const slowEndpoints = await RequestLog.aggregate<SlowEndpointAggregate>([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: "$endpoint",
          count: { $sum: 1 },
          avgResponseTime: { $avg: "$responseTime" },
          maxResponseTime: { $max: "$responseTime" },
          minResponseTime: { $min: "$responseTime" },
          p95ResponseTime: {
            $percentile: {
              input: "$responseTime",
              p: [0.95],
              method: "approximate",
            },
          },
        },
      },
      { $match: { count: { $gte: threshold } } },
      { $sort: { avgResponseTime: -1 } },
      { $limit: 10 },
    ]).allowDiskUse(true);

    const formatted = slowEndpoints.map((stat) => ({
      endpoint: stat._id,
      count: stat.count,
      avgResponseTime: Math.round(stat.avgResponseTime),
      maxResponseTime: stat.maxResponseTime,
      minResponseTime: stat.minResponseTime,
      p95ResponseTime: Math.round(stat.p95ResponseTime[0] ?? stat.maxResponseTime),
    }));

    res.json(formatted);
  } catch (error) {
    logger.error("Error fetching slow endpoints:", error);
    res.status(500).json({ error: "Failed to fetch slow endpoints" });
  }
});

// Get error breakdown (which endpoints have errors)
router.get("/errors", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = getStartDate(days);

    let formatted = days > 30 ? await aggregateErrorsFromDailyStats(startDate, 50) : [];

    if (formatted.length === 0) {
      const errorStats = await RequestLog.aggregate([
        { $match: { timestamp: { $gte: startDate }, statusCode: { $gte: 400 } } },
        {
          $group: {
            _id: { endpoint: "$endpoint", statusCode: "$statusCode" },
            count: { $sum: 1 },
            lastOccurred: { $max: "$timestamp" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]);

      formatted = errorStats.map((stat) => ({
        endpoint: stat._id.endpoint,
        statusCode: stat._id.statusCode,
        count: stat.count,
        lastOccurred: stat.lastOccurred,
      }));
    }

    if (formatted.length === 0 && days <= 30) {
      formatted = await aggregateErrorsFromDailyStats(startDate, 50);
    }

    // Group by endpoint for summary
    const byEndpoint = new Map<string, { total: number; codes: Record<number, number> }>();
    for (const err of formatted) {
      if (!byEndpoint.has(err.endpoint)) {
        byEndpoint.set(err.endpoint, { total: 0, codes: {} });
      }
      const entry = byEndpoint.get(err.endpoint)!;
      entry.total += err.count;
      entry.codes[err.statusCode] = (entry.codes[err.statusCode] || 0) + err.count;
    }

    const summary = Array.from(byEndpoint.entries())
      .map(([endpoint, data]) => ({
        endpoint,
        totalErrors: data.total,
        statusCodes: data.codes,
      }))
      .sort((a, b) => b.totalErrors - a.totalErrors);

    res.json({
      details: formatted,
      summary,
    });
  } catch (error) {
    logger.error("Error fetching error analytics:", error);
    res.status(500).json({ error: "Failed to fetch error analytics" });
  }
});

export default router;
