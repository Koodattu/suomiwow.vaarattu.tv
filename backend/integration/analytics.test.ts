/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, Server } from "node:http";
import express from "express";
import mongoose from "mongoose";
import { analyticsMiddleware, flushAnalytics } from "../src/middleware/analytics.middleware";
import { DailyStats, RequestLog, HourlyStats, DailyUniqueVisitor } from "../src/models/Analytics";
import { audienceReport, initializeSiteAnalytics, SiteEvent, SiteSession } from "../src/services/site-analytics.service";
import { endpointReport } from "../src/services/endpoint-analytics.service";
import telemetry from "../src/routes/telemetry";
import analytics from "../src/routes/analytics";
import { frontendApiRouter } from "../src/routes/frontend-api";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

const uri = process.env.ANALYTICS_TEST_MONGODB_URI;
test("analytics coverage and audience accounting", { skip: !uri }, async t => {
  await mongoose.connect(uri!, { dbName: `analytics_test_${randomUUID().replace(/-/g, "")}`, serverSelectionTimeoutMS: 5000 });
  const upstream = createServer((req, res) => {
    res.writeHead(req.url?.includes("missing") ? 404 : 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=600", ETag: '"test"' });
    res.write("first"); res.end("second");
  });
  const upstreamUrl = await listen(upstream);
  const app = express();
  app.use((req, _res, next) => { req.session = { userId: req.get("test-account") } as typeof req.session; next(); });
  app.use(analyticsMiddleware);
  app.use(express.json());
  for (const prefix of ["/api/guilds", "/api/characters", "/api/forever"]) {
    const router = express.Router();
    router.get("/", (_req, res) => res.json({ ok: true }));
    router.get("/leveling", (_req, res) => res.json({ ok: true }));
    router.get("/characters/:slug", (_req, res) => res.status(403).json({ error: "test" }));
    app.use(prefix, router);
  }
  app.get("/health", (_req, res) => res.sendStatus(200));
  app.use("/api/telemetry", telemetry);
  app.use("/api/analytics", analytics);
  app.use("/api", frontendApiRouter(upstreamUrl));
  const server = createServer(app), base = await listen(server);
  const agent = "Mozilla/5.0 analytics-test-browser";
  const event = (body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => fetch(`${base}/api/telemetry/activity`, {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "user-agent": agent, ...headers },
    body: JSON.stringify({ path: "/forever/leveling", kind: "pageview", eventId: randomUUID(), ...body }),
  });
  try {
    await Promise.all([initializeSiteAnalytics(), RequestLog.init(), DailyStats.init(), HourlyStats.init(), DailyUniqueVisitor.init()]);
    await t.test("router prefixes, dynamic routes, errors and streamed frontend APIs are recorded", async () => {
      for (const path of ["/api/guilds", "/api/characters", "/api/forever/leveling?search=private", "/api/forever/characters/one-name", "/api/forever/characters/two-name", "/api/not-a-route", "/health"]) {
        await (await fetch(base + path)).text();
      }
      const image = await fetch(`${base}/api/og/ccg/share/card/test?value=private`);
      assert.equal(image.headers.get("cache-control"), "public, max-age=600");
      assert.equal(image.headers.get("etag"), '"test"');
      assert.equal(await image.text(), "firstsecond");
      assert.equal((await fetch(`${base}/api/og?missing=true`)).status, 404);
      await fetch(`${base}/api/guilds`, { method: "OPTIONS" });
      assert.equal((await fetch(`${base}/api/analytics/audience`)).status, 401);
      await flushAnalytics();
      const logs = await RequestLog.find().lean();
      assert.equal(logs.length, 8);
      assert.ok(logs.every(log => log.endpoint.startsWith("/api/") || log.endpoint === "/unmatched"));
      assert.equal(logs.filter(log => log.endpoint === "/api/forever/characters/:slug").length, 2);
      assert.ok(logs.some(log => log.endpoint === "/api/guilds"));
      assert.ok(logs.some(log => log.endpoint === "/api/characters"));
      assert.equal(logs.find(log => log.endpoint === "/api/og/ccg/share/:kind/:shareId")?.responseSize, 11);
      assert.equal(logs.find(log => log.endpoint === "/api/og")?.statusCode, 404);
      assert.ok(!JSON.stringify(logs).includes("private"));
      const report = await endpointReport({ search: "forever" });
      assert.equal(report.total, 2);
      assert.ok(report.items.every((row: { legacyCount: number }) => row.legacyCount === 0));
    });
    await t.test("search includes low-volume endpoints beyond the first 100; pagination and legacy rows remain correct", async () => {
      const endpointStats = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`endpoint${i}`, { endpoint: `/legacy/test-${i}`, count: 120 - i, totalResponseTime: 120 - i, errorCount: i === 119 ? 1 : 0, totalSize: 10, methods: ["GET"] }]));
      await DailyStats.create({ date: new Date(Date.now() - 86400000), endpointStats });
      const target = await endpointReport({ search: "test-119", sort: "count" });
      assert.equal(target.total, 1); assert.equal(target.items[0].count, 1); assert.equal(target.items[0].legacyCount, 1);
      const first = await endpointReport({ search: "/legacy/", pageSize: 50 }), third = await endpointReport({ search: "/legacy/", page: 3 });
      assert.equal(first.total, 120); assert.equal(first.items.length, 50); assert.equal(third.items.length, 20);
      assert.equal(third.items.at(-1).endpoint, "/legacy/test-119");
      assert.equal((await endpointReport({ search: "/legacy/", order: "asc" })).items[0].endpoint, "/legacy/test-119");
      assert.equal((await endpointReport({ search: "[.*" })).total, 0, "search is literal, not executable regex");
    });
    await t.test("page views deduplicate retries; activity and login never inflate page views or visitor counts", async () => {
      const id = randomUUID();
      assert.equal((await event({ eventId: id })).status, 204);
      assert.equal((await event({ eventId: id })).status, 204);
      await event({ kind: "activity" }, { "test-account": "account-one" });
      await event({ path: "/" }, { "test-account": "account-one" });
      let report = await audienceReport(7);
      assert.equal(report.pageViews, 2); assert.equal(report.visitors, 1); assert.equal(report.sessions, 1); assert.equal(report.signedInUsers, 1);
      await event({}, { "test-account": "account-one", "user-agent": "Mozilla/5.0 second-device" });
      report = await audienceReport(7);
      assert.equal(report.visitors, 2); assert.equal(report.sessions, 2); assert.equal(report.signedInUsers, 1);
      await SiteSession.updateMany({}, { $set: { lastSeenAt: new Date(Date.now() - 31 * 60000) } });
      await event({ kind: "activity" });
      report = await audienceReport(7);
      assert.equal(report.sessions, 3); assert.equal(report.pageViews, 3);
      assert.equal(report.pages.find((page: { path: string }) => page.path === "/forever/leveling")?.views, 2);
    });
    await t.test("automation, privacy signals, invalid paths and foreign origins cannot inflate human audience", async () => {
      await event({}, { "user-agent": "Googlebot/2.1" });
      await event({ automated: true });
      await event({}, { dnt: "1" }); await event({}, { "sec-gpc": "1" });
      assert.equal((await event({}, { origin: "https://other.example" })).status, 403);
      for (const path of ["/admin", "/admin/forever", "/ccg/overlay", "/?token=secret", "//external.example", "/api/guilds"]) assert.equal((await event({ path })).status, 400);
      assert.equal((await event({ eventId: "------------------------------------" })).status, 400);
      const report = await audienceReport(7);
      assert.equal(report.pageViews, 3); assert.equal(report.excludedAutomatedViews, 2);
      assert.equal(report.visitors, 2); assert.equal(report.signedInUsers, 1);
      assert.equal(await SiteEvent.countDocuments(), 7);
      assert.ok((await SiteEvent.collection.indexes()).some(index => index.expireAfterSeconds === 90 * 86400));
      const stored = await SiteEvent.findOne().lean();
      assert.ok(!JSON.stringify(stored).includes(agent));
      assert.ok(!JSON.stringify(stored).includes("account-one"));
      await flushAnalytics();
      assert.equal(await RequestLog.countDocuments(), 8, "telemetry must not count as API usage");
    });
    await t.test("repeated submissions are rate limited", async () => {
      let limited = false;
      for (let i = 0; i < 65; i++) { if ((await event({}, { "user-agent": "Mozilla/5.0 rate-limit-test" })).status === 429) { limited = true; break; } }
      assert.ok(limited);
    });
  } finally {
    await close(server); await close(upstream);
    await flushAnalytics();
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
