/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import express from "express";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { ForeverCharacter, ForeverGuild } from "../src/features/forever/forever.models";
import { foreverAnalytics } from "../src/features/forever/forever-analytics";

test("Forever analytics API scopes the population and coalesces history reads", { skip: !process.env.FOREVER_TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.FOREVER_TEST_MONGODB_URI!, { dbName: `forever_analytics_test_${randomUUID().replace(/-/g, "")}` });
  let server: ReturnType<express.Express["listen"]> | undefined;
  try {
    await ForeverCharacter.init(); await ForeverGuild.init();
    const now = Date.now();
    const base = { region: "eu", source: "guild", status: "tracked", level: 20, race: "Human", className: "Mage", faction: "Alliance", ruleset: "PvP",
      history: [{ level: 10, observedAt: new Date(now - 48 * 3600_000) }, { level: 20, observedAt: new Date(now - 3600_000) }] };
    await ForeverCharacter.insertMany([
      { ...base, slug: "visible-member" },
      { ...base, slug: "hidden-member", guild: { region: "eu", slug: "hidden-guild", name: "Hidden Guild" } },
      { ...base, slug: "manual-member", source: "admin", guild: { region: "eu", slug: "hidden-guild", name: "Hidden Guild" } },
      { ...base, slug: "paused-member", status: "paused" }, { ...base, slug: "rejected-member", status: "rejected" },
      { ...base, slug: "pending-member", status: "pending" }, { ...base, slug: "us-member", region: "us" },
      { ...base, slug: "unfetched-member", level: undefined, history: [] },
    ]);
    const guild = await ForeverGuild.create({ region: "eu", slug: "hidden-guild", name: "Hidden Guild", status: "approved" });
    let characterReads = 0;
    mongoose.set("debug", (collection, method) => { if (collection === "forever_characters" && method === "find") characterReads++; });
    const results = await Promise.all(Array.from({ length: 10 }, () => foreverAnalytics()));
    assert.ok(results.every(result => result.total === 3 && result.active24h === 3));
    assert.deepEqual(results[0].statistics.rulesets, [{ name: "PvP", count: 3 }]);
    assert.equal(results[0].levelsGained24h, 30); assert.equal(results[0].new24h, 0);
    assert.equal(characterReads, 1, "concurrent viewers share one history read");
    await foreverAnalytics(); assert.equal(characterReads, 1, "cached viewers do not reread all histories");
    await ForeverGuild.updateOne({ _id: guild._id }, { $set: { hidden: true } });
    const hidden = await foreverAnalytics();
    assert.equal(hidden.total, 2); assert.equal(hidden.active24h, 2); assert.equal(characterReads, 2, "guild hiding changes the cache visibility key immediately");
    assert.equal(hidden.statistics.combinations[0].count, 2); assert.equal(hidden.levelsGained24h, 20);
    process.env.BLIZZARD_CLIENT_ID ??= "test-client"; process.env.BLIZZARD_CLIENT_SECRET ??= "test-secret";
    const { foreverRouter } = await import("../src/features/forever/forever.routes");
    const app = express(); app.use("/api/forever", foreverRouter);
    server = app.listen(0); await new Promise<void>(resolve => server!.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/forever/analytics`);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json() as { total: number; levels: unknown[] };
    assert.equal(result.total, 2); assert.equal(result.levels.length, 60);
    assert.ok(!JSON.stringify(result).includes("manual-member"), "response contains aggregates, not character identities");
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    mongoose.set("debug", false); await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
