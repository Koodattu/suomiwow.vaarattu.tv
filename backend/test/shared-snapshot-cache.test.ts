import assert from "node:assert/strict";
import test from "node:test";
import { SharedSnapshotCacheService } from "../src/services/shared-snapshot-cache.service";
import { MythicPlusCacheService, MYTHIC_PLUS_OPTIONS_CACHE_KEY, MYTHIC_PLUS_OPTIONS_TTL_MS } from "../src/services/mythic-plus-cache.service";
import { deferred, mockSnapshotStorage } from "./helpers/snapshot-cache";

const key = "avoidable-damage:snapshot:v3:fixture:1";
const ttl = 5 * 60_000;

test("cold API and worker instances coordinate a single build and persist an hour of fallback", async (t) => {
  const { entries, leases } = mockSnapshotStorage(t);
  const api = new SharedSnapshotCacheService("API");
  const worker = new SharedSnapshotCacheService("Worker");
  let builds = 0;
  const build = async () => { builds++; return { version: 1 }; };
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? api : worker).get(key, build, ttl)));
  assert.equal(builds, 1);
  assert.deepEqual(results, Array(8).fill({ version: 1 }));
  assert.equal(leases.size, 0);
  const entry = entries.get(key)!;
  assert.equal(entry.staleExpiresAt.getTime() - entry.expiresAt.getTime(), 60 * 60_000);
});

test("zero-traffic warming refreshes ahead of expiry and survives API process replacement", async (t) => {
  mockSnapshotStorage(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-02T10:00:00Z") });
  const worker = new SharedSnapshotCacheService("Worker");
  let builds = 0;
  const build = async () => ({ version: ++builds });
  await worker.get(key, build, ttl, true);
  t.mock.timers.tick(2 * 60_000);
  await worker.get(key, build, ttl, true);
  assert.equal(builds, 1, "a fresh snapshot should not rebuild on every scheduled check");
  t.mock.timers.tick(2 * 60_000);
  await worker.get(key, build, ttl, true);
  assert.equal(builds, 2, "worker refreshes before the five-minute TTL without a visitor");
  const api = new SharedSnapshotCacheService("New API process");
  assert.deepEqual(await api.get(key, async () => assert.fail("visitor rebuilt worker snapshot"), ttl), { version: 2 });
});

test("visitors after an idle gap use the last snapshot during a slow refresh, then see the replacement", { timeout: 4000 }, async (t) => {
  mockSnapshotStorage(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-02T10:00:00Z") });
  const worker = new SharedSnapshotCacheService("Worker");
  const api = new SharedSnapshotCacheService("API");
  await worker.get(key, async () => ({ version: 1 }), ttl, true);
  t.mock.timers.tick(20 * 60_000);
  const started = deferred<void>();
  const replacement = deferred<{ version: number }>();
  const warming = worker.get(key, async () => { started.resolve(); return replacement.promise; }, ttl, true);
  await started.promise;
  let duplicateBuilds = 0;
  const build = async () => { duplicateBuilds++; return { version: 3 }; };
  try {
    assert.deepEqual(await api.get(key, build, ttl), { version: 1 });
  } finally {
    replacement.resolve({ version: 2 });
    await warming;
    // Drain the API's lease waiter before the model mocks are restored.
    await api.get(key, build, ttl, true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  assert.equal(duplicateBuilds, 0);
  assert.deepEqual(await api.get(key, build, ttl), { version: 2 });
});

test("failed refresh keeps the snapshot and releases its lease for retry", async (t) => {
  const { entries, leases } = mockSnapshotStorage(t);
  const cache = new SharedSnapshotCacheService("Fixture");
  await cache.get(key, async () => ({ version: 1 }), ttl);
  const previous = structuredClone(entries.get(key)!);
  await cache.markStale(key);
  await assert.rejects(cache.get(key, async () => { throw new Error("fixture failure"); }, ttl, true), /fixture failure/);
  assert.deepEqual(entries.get(key)!.data, previous.data);
  assert.equal(entries.get(key)!.staleExpiresAt.getTime(), previous.staleExpiresAt.getTime());
  assert.equal(leases.size, 0);
  assert.deepEqual(await cache.get(key, async () => ({ version: 2 }), ttl, true), { version: 2 });
});

test("lost ownership cannot publish over a newer worker or release its lease", async (t) => {
  const { entries, leases } = mockSnapshotStorage(t);
  const cache = new SharedSnapshotCacheService("Fixture");
  await cache.get(key, async () => ({ version: 1 }), ttl);
  await cache.markStale(key);
  await assert.rejects(cache.get(key, async () => {
    leases.get(key)!.owner = "replacement";
    return { version: 2 };
  }, ttl, true), /lease lost/);
  assert.deepEqual(entries.get(key)!.data, { version: 1 });
  assert.equal(leases.get(key)!.owner, "replacement");
});

test("the shared implementation preserves Mythic+ option retention and throttled invalidation", async (t) => {
  const { entries } = mockSnapshotStorage(t);
  const cache = new MythicPlusCacheService();
  await cache.get(MYTHIC_PLUS_OPTIONS_CACHE_KEY, async () => ({ seasons: ["current"] }), MYTHIC_PLUS_OPTIONS_TTL_MS, true);
  const original = structuredClone(entries.get(MYTHIC_PLUS_OPTIONS_CACHE_KEY)!);
  assert.equal(original.ttlMs, 24 * 60 * 60_000);
  assert.equal(original.staleExpiresAt.getTime() - original.expiresAt.getTime(), 7 * 24 * 60 * 60_000);
  await cache.markOptionsStale(60_000);
  assert.deepEqual(entries.get(MYTHIC_PLUS_OPTIONS_CACHE_KEY), original);
  await cache.markOptionsStale();
  assert.ok(entries.get(MYTHIC_PLUS_OPTIONS_CACHE_KEY)!.expiresAt.getTime() <= Date.now());
  assert.deepEqual(entries.get(MYTHIC_PLUS_OPTIONS_CACHE_KEY)!.data, original.data);
});
