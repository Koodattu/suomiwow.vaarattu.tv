import { createHmac, randomUUID } from "node:crypto";
import type { Request } from "express";
import mongoose, { Schema } from "mongoose";

export const AUDIENCE_RETENTION_DAYS = 90;
const eventSchema = new Schema({
  _id: String, timestamp: { type: Date, required: true }, path: String,
  kind: { type: String, enum: ["pageview", "activity"], required: true },
  visitorHash: String, accountHash: String, sessionId: String, automated: Boolean,
}, { collection: "site_analytics_events" });
eventSchema.index({ timestamp: 1 }, { expireAfterSeconds: AUDIENCE_RETENTION_DAYS * 86400 });
eventSchema.index({ automated: 1, timestamp: 1 });
const sessionSchema = new Schema({ _id: String, sessionId: String, lastSeenAt: Date }, { collection: "site_analytics_sessions" });
sessionSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 86400 });
export const SiteEvent = mongoose.model("SiteAnalyticsEvent", eventSchema);
export const SiteSession = mongoose.model("SiteAnalyticsSession", sessionSchema);
export const AnalyticsCoverage = mongoose.model("AnalyticsCoverage", new Schema({ _id: String, startedAt: Date }, { collection: "analytics_coverage" }));

export async function initializeSiteAnalytics() {
  await Promise.all([SiteEvent.init(), SiteSession.init(), AnalyticsCoverage.init()]);
  try {
    await AnalyticsCoverage.updateOne({ _id: "v2" }, { $setOnInsert: { startedAt: new Date() } }, { upsert: true });
  } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
}

export function isAutomatedAgent(agent: string): boolean {
  return !agent || /bot\b|crawler|spider|headless|curl\/|wget\/|^node$|python|httpclient|uptime|monitor|facebookexternalhit|discordbot/i.test(agent);
}

// Cookie-free estimates: network/browser changes can still split or merge visitors.
function hashIdentity(value: string) {
  return createHmac("sha256", process.env.SESSION_SECRET || "local-analytics").update(value).digest("hex");
}

const staticPages = new Set("/ /accounts /analytics /analytics/raids /analytics/compare /analytics/mechanics /analytics/network /ccg /ccg/activity /ccg/collection /ccg/leaderboard /ccg/leaderboard/records /ccg/open /ccg/rewards /ccg/character-checker /ccg/studio /ccg/effects-lab /characters /collectibles /collectibles/gallery /compare /death-analysis /events /forever /forever/leveling /fun /fun/boss-mechanics/entombed-sentinels /guilds /livestreams /pickems /pickems-rules /privacy /profile /profile/discord /progress /raid-analytics /reporter /search /terms /tierlists /tierlists/characters /timetable /tools /tools/rclc /tools/figurine-lab".split(" "));
const pagePatterns: [RegExp, string][] = [
  [/^\/forever\/characters\/[^/]+$/, "/forever/characters/:character"],
  [/^\/characters\/[^/]+\/[^/]+$/, "/characters/:realm/:name"],
  [/^\/guilds\/[^/]+\/[^/]+\/raids\/[^/]+\/tierlist\/shared\/[^/]+$/, "/guilds/:realm/:name/raids/:raidId/tierlist/shared/:shareId"],
  [/^\/guilds\/[^/]+\/[^/]+\/raids\/[^/]+\/tierlist$/, "/guilds/:realm/:name/raids/:raidId/tierlist"],
  [/^\/guilds\/[^/]+\/[^/]+$/, "/guilds/:realm/:name"],
  [/^\/accounts\/[^/]+$/, "/accounts/:slug"], [/^\/reporter\/[^/]+$/, "/reporter/:slug"],
  [/^\/ccg\/share\/(card|pack)\/[^/]+$/, "/ccg/share/:kind/:shareId"],
  [/^\/ccg\/share\/[^/]+$/, "/ccg/share/:shareId"], [/^\/fun\/[^/]+$/, "/fun/:game"],
];
export function normalizePagePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500 || !/^\/(?!\/)[^?#\\\s]*$/.test(value)) return null;
  const path = value.replace(/\/$/, "") || "/";
  // Operational screens and unattended stream overlays are not audience visits.
  if (path === "/admin" || path.startsWith("/admin/") || path === "/ccg/overlay" || path.startsWith("/api/")) return null;
  return staticPages.has(path) ? path : pagePatterns.find(([pattern]) => pattern.test(path))?.[1] || "/other";
}

const rateBuckets = new Map<string, { minute: number; count: number }>();
export async function recordSiteActivity(req: Request): Promise<number> {
  const origin = req.get("origin");
  const allowedOrigin = process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : /^http:\/\/localhost:\d+$/;
  if (!origin || (typeof allowedOrigin === "string" ? origin !== allowedOrigin : !allowedOrigin.test(origin))) return 403;
  if (req.get("dnt") === "1" || req.get("sec-gpc") === "1") return 204;
  const { path: input, kind, eventId, automated } = req.body || {};
  const path = normalizePagePath(input);
  if (!path || !["pageview", "activity"].includes(kind) || typeof eventId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(eventId) || (automated !== undefined && typeof automated !== "boolean")) return 400;
  const agent = req.get("user-agent") || "";
  const visitorHash = hashIdentity(`visitor:${req.ip}|${agent}`);
  const minute = Math.floor(Date.now() / 60000);
  if (rateBuckets.size >= 10000) for (const [key, value] of rateBuckets) if (value.minute !== minute) rateBuckets.delete(key);
  const bucket = rateBuckets.get(visitorHash);
  if ((bucket?.minute === minute && bucket.count >= 60) || (!bucket && rateBuckets.size >= 10000)) return 429;
  rateBuckets.set(visitorHash, { minute, count: bucket?.minute === minute ? bucket.count + 1 : 1 });
  const timestamp = new Date();
  const id = hashIdentity(`event:${visitorHash}:${eventId}`);
  if (await SiteEvent.exists({ _id: id })) return 204;
  const bot = automated === true || isAutomatedAgent(agent);
  let sessionId: string | undefined;
  if (!bot) {
    const sessions = mongoose.connection.db!.collection<{ _id: string; sessionId: string; lastSeenAt: Date }>(SiteSession.collection.name);
    const update = [{ $set: { lastSeenAt: timestamp, sessionId: { $cond: [
      { $gte: ["$lastSeenAt", new Date(timestamp.getTime() - 30 * 60000)] }, "$sessionId", randomUUID(),
    ] } } }];
    try {
      const state = await sessions.findOneAndUpdate({ _id: visitorHash }, update, { upsert: true, returnDocument: "after" });
      sessionId = state!.sessionId;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      sessionId = (await sessions.findOneAndUpdate({ _id: visitorHash }, update, { returnDocument: "after" }))!.sessionId;
    }
  }
  try {
    await SiteEvent.updateOne({ _id: id }, { $setOnInsert: { timestamp, path, kind, visitorHash, sessionId,
      automated: bot, ...(req.session?.userId ? { accountHash: hashIdentity(`account:${req.session.userId}`) } : {}),
    } }, { upsert: true });
  } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  return 204;
}

export async function audienceReport(days: number) {
  const now = new Date(), since = new Date(now.getTime() - Math.min(days, AUDIENCE_RETENTION_DAYS) * 86400000);
  const [coverage, data] = await Promise.all([
    AnalyticsCoverage.findById("v2").lean(),
    SiteEvent.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $facet: {
        pageViews: [{ $match: { automated: false, kind: "pageview" } }, { $count: "count" }],
        visitors: [{ $match: { automated: false } }, { $group: { _id: "$visitorHash" } }, { $count: "count" }],
        sessions: [{ $match: { automated: false, sessionId: { $type: "string" } } }, { $group: { _id: "$sessionId" } }, { $count: "count" }],
        signedInUsers: [{ $match: { automated: false, accountHash: { $type: "string" } } }, { $group: { _id: "$accountHash" } }, { $count: "count" }],
        automated: [{ $match: { automated: true, kind: "pageview" } }, { $count: "count" }],
        pages: [{ $match: { automated: false, kind: "pageview" } }, { $group: { _id: { path: "$path", visitor: "$visitorHash" }, views: { $sum: 1 } } }, { $group: { _id: "$_id.path", views: { $sum: "$views" }, visitors: { $sum: 1 } } }, { $project: { _id: 0, path: "$_id", views: 1, visitors: 1 } }, { $sort: { views: -1, path: 1 } }],
      } },
    ]).allowDiskUse(true),
  ]);
  return { since, startedAt: coverage?.startedAt || null, retentionDays: AUDIENCE_RETENTION_DAYS,
    pageViews: data[0]?.pageViews[0]?.count || 0, visitors: data[0]?.visitors[0]?.count || 0,
    sessions: data[0]?.sessions[0]?.count || 0, signedInUsers: data[0]?.signedInUsers[0]?.count || 0,
    excludedAutomatedViews: data[0]?.automated[0]?.count || 0, pages: data[0]?.pages || [],
  };
}
