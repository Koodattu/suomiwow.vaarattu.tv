import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { RequestLog, HourlyStats, DailyStats, DailyUniqueVisitor } from "../models/Analytics";
import logger from "../utils/logger";

// In-memory buffer to batch writes (reduces database load)
interface LogEntry {
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  responseSize: number;
  visitorHash?: string;
  userAgent?: string;
  referer?: string;
  timestamp: Date;
}

const logBuffer: LogEntry[] = [];
const BUFFER_SIZE = 50; // Flush every 50 requests
const FLUSH_INTERVAL = 30000; // Or every 30 seconds

const getHourStart = (date: Date): Date => {
  const hour = new Date(date);
  hour.setMinutes(0, 0, 0);
  return hour;
};

const getDayStart = (date: Date): Date => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
};

const getEndpointStorageKey = (endpoint: string): string => crypto.createHash("sha1").update(endpoint).digest("hex");

const sanitizeMapKey = (key: string): string => key.replace(/[.$]/g, "_");

// Normalize endpoint paths to group dynamic parameters
// e.g., /api/guilds/draenor/some-guild -> /api/guilds/:realm/:name
const normalizeEndpoint = (path: string): string => {
  // Remove query strings
  const pathWithoutQuery = path.split("?")[0];

  // Common patterns to normalize
  const patterns = [
    // Guild routes: /api/guilds/:realm/:name/...
    { regex: /^\/api\/guilds\/([^/]+)\/([^/]+)\/raids\/(\d+)\/bosses$/, replacement: "/api/guilds/:realm/:name/raids/:raidId/bosses" },
    { regex: /^\/api\/guilds\/([^/]+)\/([^/]+)\/summary$/, replacement: "/api/guilds/:realm/:name/summary" },
    { regex: /^\/api\/guilds\/([^/]+)\/([^/]+)\/reports$/, replacement: "/api/guilds/:realm/:name/reports" },
    { regex: /^\/api\/guilds\/([^/]+)\/([^/]+)$/, replacement: "/api/guilds/:realm/:name" },
    // ObjectId-based routes
    { regex: /^\/api\/guilds\/[a-f0-9]{24}\/raids\/(\d+)\/bosses$/, replacement: "/api/guilds/:id/raids/:raidId/bosses" },
    { regex: /^\/api\/guilds\/[a-f0-9]{24}\/summary$/, replacement: "/api/guilds/:id/summary" },
    { regex: /^\/api\/guilds\/[a-f0-9]{24}$/, replacement: "/api/guilds/:id" },
    // Raid routes
    { regex: /^\/api\/raids\/(\d+)\/dates$/, replacement: "/api/raids/:raidId/dates" },
    { regex: /^\/api\/raids\/(\d+)$/, replacement: "/api/raids/:raidId" },
    // Pickems routes
    { regex: /^\/api\/pickems\/([^/]+)\/predict$/, replacement: "/api/pickems/:pickemId/predict" },
    { regex: /^\/api\/pickems\/(?!guilds(?:\/rwf)?$)([^/]+)$/, replacement: "/api/pickems/:pickemId" },
    // Icon routes
    { regex: /^\/icons\/.*$/, replacement: "/icons/:file" },
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(pathWithoutQuery)) {
      return pattern.replacement;
    }
  }

  return pathWithoutQuery;
};

const getVisitorHash = (req: Request): string | undefined => {
  const userId = req.session?.userId;
  const userAgent = req.get("user-agent") || "unknown";

  const rawIdentifier = userId ? `user:${userId}` : `anon:${req.ip}|${userAgent}`;

  if (!rawIdentifier) {
    return undefined;
  }

  return crypto.createHash("sha256").update(rawIdentifier).digest("hex").slice(0, 32);
};

// Flush buffer to database
const flushBufferedBatch = async () => {
  if (logBuffer.length === 0) return;

  const logsToFlush = [...logBuffer];
  logBuffer.length = 0;

  try {
    // Insert request logs
    await RequestLog.insertMany(logsToFlush, { ordered: false });
  } catch (error) {
    logger.error("Failed to write detailed analytics logs:", error);
  }

  try {
    // Update hourly stats
    const hourlyUpdates = new Map<
      string,
      {
        totalRequests: number;
        totalResponseTime: number;
        totalDataTransferred: number;
        endpoints: Map<string, { count: number; totalResponseTime: number; totalSize: number; statusCodes: Map<string, number> }>;
        statusCodes: Map<string, number>;
      }
    >();

    for (const log of logsToFlush) {
      const hourKey = getHourStart(log.timestamp);
      const hourKeyStr = hourKey.toISOString();

      if (!hourlyUpdates.has(hourKeyStr)) {
        hourlyUpdates.set(hourKeyStr, {
          totalRequests: 0,
          totalResponseTime: 0,
          totalDataTransferred: 0,
          endpoints: new Map(),
          statusCodes: new Map(),
        });
      }

      const hourData = hourlyUpdates.get(hourKeyStr)!;
      hourData.totalRequests++;
      hourData.totalResponseTime += log.responseTime;
      hourData.totalDataTransferred += log.responseSize;

      // Update status code count
      const statusKey = log.statusCode.toString();
      hourData.statusCodes.set(statusKey, (hourData.statusCodes.get(statusKey) || 0) + 1);

      // Update endpoint stats
      if (!hourData.endpoints.has(log.endpoint)) {
        hourData.endpoints.set(log.endpoint, { count: 0, totalResponseTime: 0, totalSize: 0, statusCodes: new Map() });
      }
      const endpointData = hourData.endpoints.get(log.endpoint)!;
      endpointData.count++;
      endpointData.totalResponseTime += log.responseTime;
      endpointData.totalSize += log.responseSize;
      endpointData.statusCodes.set(statusKey, (endpointData.statusCodes.get(statusKey) || 0) + 1);
    }

    // Upsert hourly stats
    for (const [hourStr, data] of hourlyUpdates) {
      const hour = new Date(hourStr);

      const increment: Record<string, number> = {
        totalRequests: data.totalRequests,
        totalResponseTime: data.totalResponseTime,
        totalDataTransferred: data.totalDataTransferred,
      };

      for (const [statusCode, count] of data.statusCodes) {
        increment[`statusCodes.${statusCode}`] = count;
      }

      for (const [endpoint, stats] of data.endpoints) {
        const endpointKey = sanitizeMapKey(endpoint);
        increment[`endpoints.${endpointKey}.count`] = stats.count;
        increment[`endpoints.${endpointKey}.totalResponseTime`] = stats.totalResponseTime;
        increment[`endpoints.${endpointKey}.totalSize`] = stats.totalSize;

        for (const [statusCode, count] of stats.statusCodes) {
          increment[`endpoints.${endpointKey}.statusCodes.${statusCode}`] = count;
        }
      }

      await HourlyStats.findOneAndUpdate(
        { hour },
        {
          $inc: increment,
        },
        { upsert: true },
      );
    }
  } catch (error) {
    logger.error("Failed to update hourly analytics stats:", error);
  }

  try {
    const dailyUpdates = new Map<
      string,
      {
        totalRequests: number;
        totalResponseTime: number;
        totalDataTransferred: number;
        endpoints: Map<
          string,
          {
            endpoint: string;
            count: number;
            totalResponseTime: number;
            totalSize: number;
            errorCount: number;
            methods: Set<string>;
            statusCodes: Map<string, number>;
            lastCalled: Date;
            lastErrorAt?: Date;
          }
        >;
        statusCodes: Map<string, number>;
        uniqueVisitors: Map<string, Date>;
      }
    >();

    for (const log of logsToFlush) {
      const dayKey = getDayStart(log.timestamp);
      const dayKeyStr = dayKey.toISOString();

      if (!dailyUpdates.has(dayKeyStr)) {
        dailyUpdates.set(dayKeyStr, {
          totalRequests: 0,
          totalResponseTime: 0,
          totalDataTransferred: 0,
          endpoints: new Map(),
          statusCodes: new Map(),
          uniqueVisitors: new Map(),
        });
      }

      const dayData = dailyUpdates.get(dayKeyStr)!;
      dayData.totalRequests++;
      dayData.totalResponseTime += log.responseTime;
      dayData.totalDataTransferred += log.responseSize;

      if (log.visitorHash && !dayData.uniqueVisitors.has(log.visitorHash)) {
        dayData.uniqueVisitors.set(log.visitorHash, log.timestamp);
      }

      const statusKey = log.statusCode.toString();
      dayData.statusCodes.set(statusKey, (dayData.statusCodes.get(statusKey) || 0) + 1);

      const endpointKey = getEndpointStorageKey(log.endpoint);
      if (!dayData.endpoints.has(endpointKey)) {
        dayData.endpoints.set(endpointKey, {
          endpoint: log.endpoint,
          count: 0,
          totalResponseTime: 0,
          totalSize: 0,
          errorCount: 0,
          methods: new Set(),
          statusCodes: new Map(),
          lastCalled: log.timestamp,
        });
      }

      const endpointData = dayData.endpoints.get(endpointKey)!;
      endpointData.count++;
      endpointData.totalResponseTime += log.responseTime;
      endpointData.totalSize += log.responseSize;
      endpointData.methods.add(log.method);
      endpointData.statusCodes.set(statusKey, (endpointData.statusCodes.get(statusKey) || 0) + 1);

      if (log.timestamp > endpointData.lastCalled) {
        endpointData.lastCalled = log.timestamp;
      }

      if (log.statusCode >= 400) {
        endpointData.errorCount++;
        if (!endpointData.lastErrorAt || log.timestamp > endpointData.lastErrorAt) {
          endpointData.lastErrorAt = log.timestamp;
        }
      }
    }

    const uniqueVisitorIncrements = new Map<string, number>();

    for (const [dayStr, data] of dailyUpdates) {
      const visitors = Array.from(data.uniqueVisitors.entries());
      if (visitors.length === 0) {
        uniqueVisitorIncrements.set(dayStr, 0);
        continue;
      }

      const date = new Date(dayStr);
      const result = await DailyUniqueVisitor.bulkWrite(
        visitors.map(([visitorHash, seenAt]) => ({
          updateOne: {
            filter: { date, visitorHash },
            update: {
              $setOnInsert: { date, visitorHash, firstSeenAt: seenAt },
              $set: { lastSeenAt: seenAt },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );

      uniqueVisitorIncrements.set(dayStr, result.upsertedCount || 0);
    }

    for (const [dayStr, data] of dailyUpdates) {
      const date = new Date(dayStr);
      const increment: Record<string, number> = {
        totalRequests: data.totalRequests,
        totalResponseTime: data.totalResponseTime,
        totalDataTransferred: data.totalDataTransferred,
      };

      const uniqueVisitorIncrement = uniqueVisitorIncrements.get(dayStr) || 0;
      if (uniqueVisitorIncrement > 0) {
        increment.uniqueVisitors = uniqueVisitorIncrement;
      }

      for (const [statusCode, count] of data.statusCodes) {
        increment[`statusCodeSummary.${statusCode}`] = count;
      }

      const setFields: Record<string, unknown> = {};
      const addToSet: Record<string, { $each: string[] }> = {};

      for (const [endpointKey, stats] of data.endpoints) {
        const path = `endpointStats.${endpointKey}`;
        increment[`${path}.count`] = stats.count;
        increment[`${path}.totalResponseTime`] = stats.totalResponseTime;
        increment[`${path}.totalSize`] = stats.totalSize;
        increment[`${path}.errorCount`] = stats.errorCount;
        setFields[`${path}.endpoint`] = stats.endpoint;
        setFields[`${path}.lastCalled`] = stats.lastCalled;

        if (stats.lastErrorAt) {
          setFields[`${path}.lastErrorAt`] = stats.lastErrorAt;
        }

        const methods = Array.from(stats.methods);
        if (methods.length > 0) {
          addToSet[`${path}.methods`] = { $each: methods };
        }

        for (const [statusCode, count] of stats.statusCodes) {
          increment[`${path}.statusCodes.${statusCode}`] = count;
        }
      }

      const update: Record<string, unknown> = { $inc: increment };
      if (Object.keys(setFields).length > 0) update.$set = setFields;
      if (Object.keys(addToSet).length > 0) update.$addToSet = addToSet;

      await DailyStats.findOneAndUpdate({ date }, update, { upsert: true });
    }
  } catch (error) {
    logger.error("Failed to update daily analytics stats:", error);
  }
};

let flushPromise: Promise<void> | null = null;

const flushBuffer = (): Promise<void> => {
  if (flushPromise) return flushPromise;
  flushPromise = flushBufferedBatch().finally(() => {
    flushPromise = null;
    if (logBuffer.length >= BUFFER_SIZE) void flushBuffer();
  });
  return flushPromise;
};

// Start periodic flush
setInterval(flushBuffer, FLUSH_INTERVAL);

// Middleware function
export const analyticsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip tracking for analytics endpoints to avoid recursion
  if (req.path.startsWith("/api/analytics") || req.path.startsWith("/api/admin/analytics")) {
    return next();
  }

  const startTime = Date.now();

  // Track response size
  let responseSize = 0;
  const originalSend = res.send;
  const originalJson = res.json;

  res.send = function (body) {
    if (body) {
      responseSize = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
    }
    return originalSend.call(this, body);
  };

  res.json = function (body) {
    if (body) {
      responseSize = Buffer.byteLength(JSON.stringify(body));
    }
    return originalJson.call(this, body);
  };

  // On response finish, log the request
  res.on("finish", () => {
    const responseTime = Date.now() - startTime;
    const endpoint = normalizeEndpoint(req.path);

    const logEntry: LogEntry = {
      endpoint,
      method: req.method,
      statusCode: res.statusCode,
      responseTime,
      responseSize,
      visitorHash: getVisitorHash(req),
      userAgent: req.get("user-agent"),
      referer: req.get("referer"),
      timestamp: new Date(),
    };

    logBuffer.push(logEntry);

    // Flush if buffer is full
    if (logBuffer.length >= BUFFER_SIZE) {
      flushBuffer();
    }
  });

  next();
};

// Graceful shutdown - wait for the active batch and drain anything buffered behind it.
export const flushAnalytics = async (): Promise<void> => {
  do {
    await flushBuffer();
  } while (logBuffer.length > 0);
};
