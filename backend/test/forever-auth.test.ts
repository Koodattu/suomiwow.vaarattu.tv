/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";

test("Forever mutation routes require Discord login and admin routes reject ordinary members", async (t) => {
  process.env.BLIZZARD_CLIENT_ID ??= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ??= "test-secret";
  const { default: discord } = await import("../src/services/discord.service");
  const { foreverRouter, foreverAdminRouter } = await import("../src/features/forever/forever.routes");
  t.mock.method(discord, "getUserFromSession", async () => ({ discord: { username: "ordinary-member" } }));
  t.mock.method(discord, "isAdmin", () => false);
  const app = express(); app.use(express.json());
  app.use(session({ secret: "forever-test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { if (req.headers["x-test-member"]) req.session.userId = "member"; next(); });
  app.use("/api/forever", foreverRouter); app.use("/api/admin/forever", foreverAdminRouter);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const path of ["/proposals", "/guild-proposals", "/characters/507f1f77bcf86cd799439011/refresh"]) {
      const response = await fetch(`${base}/api/forever${path}`, { method: "POST" }); assert.equal(response.status, 401);
    }
    const adminRoutes = [["POST", "/guilds"], ["PATCH", "/guilds/507f1f77bcf86cd799439011/visibility"], ["GET", ""], ["POST", "/characters"], ["POST", "/characters/bulk"], ["PATCH", "/characters/507f1f77bcf86cd799439011"], ["PATCH", "/characters/507f1f77bcf86cd799439011/twitch"],
      ["POST", "/characters/507f1f77bcf86cd799439011/refresh"], ["POST", "/characters/507f1f77bcf86cd799439011/refresh-now"], ["GET", "/guilds/507f1f77bcf86cd799439011"],
      ["PATCH", "/guilds/507f1f77bcf86cd799439011"], ["POST", "/guilds/507f1f77bcf86cd799439011/refresh"], ["POST", "/guild-language"]];
    for (const [method, path] of adminRoutes) {
      assert.equal((await fetch(`${base}/api/admin/forever${path}`, { method })).status, 401);
      assert.equal((await fetch(`${base}/api/admin/forever${path}`, { method, headers: { "x-test-member": "true" } })).status, 403);
    }
    const invalid = await fetch(`${base}/api/forever/proposals`, { method: "POST", headers: { "x-test-member": "true", "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://example.com/retail" }) });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json() as { code: string }).code, "invalid_url");
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
