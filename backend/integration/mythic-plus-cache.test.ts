import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import mongoose from "mongoose";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Cache from "../src/models/Cache";
import CacheRefreshLease from "../src/models/CacheRefreshLease";
import { MythicPlusCacheService, MYTHIC_PLUS_OPTIONS_CACHE_KEY, MYTHIC_PLUS_OPTIONS_TTL_MS, MYTHIC_PLUS_LEADERBOARD_TTL_MS } from "../src/services/mythic-plus-cache.service";
import mythicPlusService from "../src/services/mythic-plus.service";
import mythicPlusRouter from "../src/routes/mythic-plus";
import { getMythicPlusLeaderboardCacheKey } from "../src/utils/mythic-plus-cache";

// A disposable local MongoDB only; never read deployment configuration.
const database = `mythic_plus_cache_test_${process.pid}`;
const key = "mythic-plus:leaderboard:v3:test";
const ttl = MYTHIC_PLUS_LEADERBOARD_TTL_MS;

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27139/${database}?directConnection=true`, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000,
  });
  for (const model of [Cache, CacheRefreshLease]) {
    await model.createCollection();
    await model.createIndexes();
  }
});
after(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Cache.deleteMany({});
  await CacheRefreshLease.deleteMany({});
});

async function seed(cacheKey = key, freshForMs = -1000) {
  await Cache.create({
    key: cacheKey, data: { version: 1 }, cachedAt: new Date(Date.now() - ttl),
    expiresAt: new Date(Date.now() + freshForMs), staleExpiresAt: new Date(Date.now() + 60_000),
    ttlMs: ttl, endpoint: "mythic-plus:leaderboard",
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

test("cold readers coalesce within and across API/worker cache instances", async () => {
  const api = new MythicPlusCacheService();
  const worker = new MythicPlusCacheService();
  let builds = 0;
  const build = async () => { builds++; return { version: 2 }; };
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? api : worker).get(key, build, ttl)));
  assert.equal(builds, 1);
  assert.deepEqual(results, Array(8).fill({ version: 2 }));
  assert.equal(await CacheRefreshLease.countDocuments(), 0);
});

test("stale visitors return immediately while the worker replaces the snapshot", async () => {
  await seed();
  const cache = new MythicPlusCacheService();
  const started = deferred<void>();
  const replacement = deferred<{ version: number }>();
  let builds = 0;
  const build = async () => { builds++; started.resolve(); return replacement.promise; };
  assert.deepEqual(await cache.get(key, build, ttl), { version: 1 });
  await started.promise;
  const warming = cache.get(key, build, ttl, true);
  assert.deepEqual(await cache.get(key, build, ttl), { version: 1 });
  replacement.resolve({ version: 2 });
  assert.deepEqual(await warming, { version: 2 });
  assert.equal(builds, 1);
  const entry = await Cache.findOne({ key }).lean();
  assert.equal(entry!.staleExpiresAt!.getTime() - entry!.expiresAt.getTime(), 60 * 60 * 1000);
});

test("failed refresh preserves the last-good snapshot and releases ownership for retry", async () => {
  await seed();
  const cache = new MythicPlusCacheService();
  const previous = await Cache.findOne({ key }).lean();
  await assert.rejects(cache.get(key, async () => { throw new Error("database unavailable"); }, ttl, true), /database unavailable/);
  assert.deepEqual(await Cache.findOne({ key }).lean(), previous);
  assert.equal(await CacheRefreshLease.countDocuments(), 0);
  assert.deepEqual(await cache.get(key, async () => ({ version: 2 }), ttl, true), { version: 2 });
});

test("fully expired snapshots block for a replacement rather than serving unbounded stale data", async () => {
  await seed();
  await Cache.updateOne({ key }, { $set: { staleExpiresAt: new Date(Date.now() - 1000) } });
  const cache = new MythicPlusCacheService();
  assert.deepEqual(await cache.get(key, async () => ({ version: 2 }), ttl), { version: 2 });
});

test("an expired worker lease can be reclaimed without waiting for MongoDB TTL cleanup", async () => {
  await CacheRefreshLease.create({ _id: key, owner: "dead-worker", expiresAt: new Date(Date.now() - 1000) });
  assert.deepEqual(await new MythicPlusCacheService().get(key, async () => ({ version: 2 }), ttl), { version: 2 });
});

test("a builder that loses its lease cannot overwrite a replacement snapshot", async () => {
  await seed();
  const cache = new MythicPlusCacheService();
  await assert.rejects(cache.get(key, async () => {
    await CacheRefreshLease.updateOne({ _id: key }, { $set: { owner: "replacement-worker" } });
    return { version: 2 };
  }, ttl, true), /lease lost/);
  assert.deepEqual((await Cache.findOne({ key }).lean())!.data, { version: 1 });
  assert.equal((await CacheRefreshLease.findById(key).lean())!.owner, "replacement-worker");
});

test("zero-traffic warming refreshes near expiry and API readers see the worker publication", async () => {
  const worker = new MythicPlusCacheService();
  const api = new MythicPlusCacheService();
  await seed(key, 1000);
  assert.deepEqual(await api.get(key, async () => assert.fail("fresh request rebuilt"), ttl), { version: 1 });
  assert.deepEqual(await worker.get(key, async () => ({ version: 2 }), ttl, true), { version: 2 });
  assert.deepEqual(await api.get(key, async () => assert.fail("worker snapshot missed"), ttl), { version: 2 });
});

test("options retain their daily TTL, and batch invalidation preserves data and is throttled", async () => {
  const cache = new MythicPlusCacheService();
  const optionsKey = MYTHIC_PLUS_OPTIONS_CACHE_KEY;
  await cache.get(optionsKey, async () => ({ seasons: ["historical", "current"] }), MYTHIC_PLUS_OPTIONS_TTL_MS, true);
  const entry = (await Cache.findOne({ key: optionsKey }).lean())!;
  assert.equal(entry.ttlMs, 24 * 60 * 60 * 1000);
  assert.equal(entry.staleExpiresAt!.getTime() - entry.expiresAt.getTime(), 7 * 24 * 60 * 60 * 1000);
  await cache.get(optionsKey, async () => assert.fail("frequent warmup rebuilt fresh options"), MYTHIC_PLUS_OPTIONS_TTL_MS, true);
  await cache.markOptionsStale(60 * 60 * 1000);
  assert.equal((await Cache.findOne({ key: optionsKey }).lean())!.expiresAt.getTime(), entry.expiresAt.getTime());
  await cache.markOptionsStale();
  const stale = (await Cache.findOne({ key: optionsKey }).lean())!;
  assert.ok(stale.expiresAt.getTime() <= Date.now());
  assert.deepEqual(stale.data, entry.data);
  assert.equal(stale.staleExpiresAt!.getTime(), entry.staleExpiresAt!.getTime());
});

test("startup warms the actual HTTP first page and season rollover selects a new cache key", async (t) => {
  let season = "season-mn-1";
  let leaderboardBuilds = 0;
  let optionsBuilds = 0;
  const service = mythicPlusService as any;
  t.mock.method(service, "getCurrentSeasonSlug", async () => season);
  t.mock.method(service, "buildOptions", async () => {
    optionsBuilds++;
    return { seasons: [{ slug: season, dungeons: [] }], defaultSelection: { season } };
  });
  t.mock.method(mythicPlusService, "getLeaderboard", async (query: Parameters<typeof mythicPlusService.getLeaderboard>[0]) => {
    leaderboardBuilds++;
    assert.equal(query.limit, 50);
    return { data: [], pagination: { totalItems: 0, totalRankedItems: 0, totalPages: 0, currentPage: 1, pageSize: 50 } };
  });
  const app = express();
  app.use("/mythic-plus", mythicPlusRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mythic-plus`;

  await mythicPlusService.warmLeaderboardCaches();
  const optionsResponse = await fetch(`${url}/options`);
  assert.equal(optionsResponse.status, 200);
  assert.equal((await optionsResponse.json() as any).defaultSelection.season, season);
  const pageResponse = await fetch(`${url}?season=${season}&bucket=all&dungeonSort=score&page=1&limit=50`);
  assert.equal(pageResponse.status, 200);
  assert.equal((await pageResponse.json() as any).pagination.pageSize, 50);
  assert.equal(leaderboardBuilds, 1);
  assert.equal(optionsBuilds, 1);
  assert.ok(await Cache.exists({ key: getMythicPlusLeaderboardCacheKey({ season, limit: 50 }) }));

  assert.equal((await fetch(`${url}?season=${season}&bucket=invalid&limit=50`)).status, 400);
  assert.equal(leaderboardBuilds, 1);
  assert.equal((await fetch(`${url}?season=${season}&search=example&limit=50`)).status, 200);
  assert.equal((await fetch(`${url}?season=${season}&search=example&limit=50`)).status, 200);
  assert.equal(leaderboardBuilds, 3, "free-text search must bypass shared snapshots");

  season = "season-mn-2";
  await mythicPlusService.warmLeaderboardCaches();
  assert.ok(await Cache.exists({ key: getMythicPlusLeaderboardCacheKey({ season, limit: 50 }) }));
  assert.equal((await mythicPlusService.getOptions()).defaultSelection.season, season);
  assert.equal(optionsBuilds, 2);
});

test("a leaderboard request without a season reuses the persisted options snapshot", async (t) => {
  const service = mythicPlusService as any;
  await new MythicPlusCacheService().get(MYTHIC_PLUS_OPTIONS_CACHE_KEY, async () => ({ defaultSelection: { season: "season-mn-2" }, seasons: [] }), MYTHIC_PLUS_OPTIONS_TTL_MS);
  t.mock.method(service, "buildOptions", async () => assert.fail("leaderboard bypassed the options cache"));
  t.mock.method(service, "getLeaderboardEligibleCharacterIds", async () => []);
  assert.deepEqual((await mythicPlusService.getLeaderboard({})).data, []);
});
