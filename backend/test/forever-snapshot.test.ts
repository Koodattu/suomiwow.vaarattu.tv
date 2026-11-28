import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { ForeverSnapshotCache } from "../src/features/forever/forever-snapshot";
import { ForeverLeaderboardCache, ForeverLeaderboardLease } from "../src/features/forever/forever-leaderboard.models";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { foreverAnalytics } from "../src/features/forever/forever-analytics";
import { publicGuilds } from "../src/features/forever/forever-guilds";
import { namegameLeaderboard, namegameOverview } from "../src/features/forever/forever-namegame";
import { startForeverPageCaches, stopForeverPageCaches } from "../src/features/forever/forever-cache-warmer";
import logger from "../src/utils/logger";
import { deferred, mockSnapshotStorage } from "./helpers/snapshot-cache";
import { ForeverCharacterDetail, ForeverItem } from "../src/features/forever/forever-details.models";

let revision = 0, namegameRevision = 0;
function setup(t: TestContext) {
  revision = 0;
  namegameRevision = 0;
  mockSnapshotStorage(t, { cache: ForeverLeaderboardCache, leases: ForeverLeaderboardLease });
  t.mock.method(ForeverWorker, "findById", () => ({ select: () => ({ lean: async () => ({ leaderboardRevision: revision, namegameRevision }) }) }));
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: new Date("2026-11-16T10:00:00Z") });
  // Raid and record pages read profile details; no profiles have been fetched in these scenarios.
  const empty = { select() { return this; }, lean: async () => [] };
  t.mock.method(ForeverCharacterDetail, "find", () => empty);
  t.mock.method(ForeverItem, "find", () => empty);
}

test("startup prepares all three public pages and refreshes them through an idle period", async t => {
  setup(t);
  t.after(stopForeverPageCaches);
  let reads = 0, version = 1;
  const query = (rows: unknown[]) => ({
    select() { return this; }, sort() { return this; }, lean() { return this; }, maxTimeMS() { return this; },
    then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
  });
  t.mock.method(ForeverGuild, "find", (filter: { hidden?: unknown }) => {
    reads++;
    return query(filter.hidden === true ? [] : [{ _id: "guild", region: "eu", slug: "guild", name: `Guild ${version}`, roster: [] }]);
  });
  t.mock.method(ForeverCharacter, "find", () => {
    reads++;
    return query([{ source: "admin", level: version, nameRating: { name: `Name ${version}`, score: version, category: "sound" } }]);
  });

  startForeverPageCaches();
  startForeverPageCaches(); // Repeated initialization must not add schedules.
  await nextTurn();
  const startupReads = reads;
  assert.ok(startupReads > 0, "startup builds without any public page request");
  assert.equal((await foreverAnalytics()).averageLevel, 1);
  assert.equal((await publicGuilds()).guilds[0].name, "Guild 1");
  assert.equal((await namegameOverview()).boards[0].names[0].name, "Name 1");
  assert.equal((await namegameLeaderboard({})).names[0].name, "Name 1");
  assert.equal(reads, startupReads, "first visitors do not scan histories, rosters or names");

  for (version = 2; version <= 5; version++) {
    namegameRevision++;
    t.mock.timers.tick(30_000);
    await nextTurn();
    assert.equal(reads, startupReads * version, "each idle interval builds once per page");
  }
  const idleReads = reads;
  assert.equal((await foreverAnalytics()).averageLevel, 5);
  assert.equal((await publicGuilds()).guilds[0].name, "Guild 5");
  assert.equal((await namegameOverview()).boards[0].names[0].name, "Name 5");
  assert.equal(reads, idleReads, "visitors after multiple TTLs reuse server-prepared data");

  // Moderation changes the shared key for every page immediately.
  revision++;
  assert.equal((await foreverAnalytics()).averageLevel, 6);
  assert.equal((await publicGuilds()).guilds[0].name, "Guild 6");
  assert.equal((await namegameLeaderboard({})).names[0].name, "Name 6");
  await stopForeverPageCaches();
  const stoppedReads = reads;
  t.mock.timers.tick(120_000);
  await nextTurn();
  assert.equal(reads, stoppedReads, "shutdown removes all page schedules");
});

test("unchanged Name Game warming reuses the ranked population and observes scores and moderation independently", async t => {
  setup(t);
  let builds = 0;
  const cache = new ForeverSnapshotCache("forever:namegame:test", async () => ++builds, "namegameRevision");
  t.after(() => cache.stop());
  assert.equal(await cache.get(true), 1);
  t.mock.timers.tick(31_000);
  assert.equal(await cache.get(true), 1);
  namegameRevision++;
  t.mock.timers.tick(31_000);
  assert.equal(await cache.get(true), 2);
  revision++;
  assert.equal(await cache.get(), 3);
  t.mock.timers.tick(61_000);
  assert.equal(await cache.get(), 4, "hard expiry reconciles even out-of-band changes");
});

test("a replacement API reuses the persisted snapshot and cold concurrent reads coalesce", async t => {
  setup(t);
  let builds = 0;
  const first = new ForeverSnapshotCache("forever:test:v1", async () => ({ version: ++builds }));
  t.after(() => first.stop());
  const results = await Promise.all(Array.from({ length: 8 }, () => first.get()));
  assert.deepEqual(results, Array(8).fill({ version: 1 }));
  assert.equal(builds, 1);
  const replacement = new ForeverSnapshotCache("forever:test:v1", async () => assert.fail("replacement rebuilt a fresh shared snapshot"));
  t.after(() => replacement.stop());
  assert.deepEqual(await replacement.get(), { version: 1 });
});

test("build duration does not postpone the next refresh until the expiry boundary", async t => {
  setup(t);
  let builds = 0;
  const cache = new ForeverSnapshotCache("forever:test:v1", async () => {
    builds++;
    t.mock.timers.tick(2_000);
    return builds;
  });
  t.after(() => cache.stop());
  cache.start(); await nextTurn();
  assert.equal(builds, 1);
  t.mock.timers.tick(28_000); await nextTurn();
  assert.equal(builds, 1, "the snapshot is only 28 seconds old at the first half-minute");
  t.mock.timers.tick(15_000); await nextTurn();
  assert.equal(builds, 2, "refresh begins with at least 15 seconds left before expiry");
});

test("slow refresh leaves the fresh result readable, coalesces work and drains on shutdown", async t => {
  setup(t);
  const started = deferred<void>(), finish = deferred<number>();
  let builds = 0;
  const cache = new ForeverSnapshotCache("forever:test:v1", async () => {
    if (++builds === 1) return 1;
    started.resolve();
    return finish.promise;
  });
  t.after(async () => { finish.resolve(2); await cache.stop(); });
  cache.start(); await nextTurn();
  t.mock.timers.tick(30_000);
  await started.promise;
  assert.equal(await cache.get(), 1, "an in-progress proactive refresh does not block fresh reads");
  t.mock.timers.tick(60_000); await nextTurn();
  assert.equal(builds, 2, "slow builds cannot accumulate on subsequent ticks");
  let stopped = false;
  const stopping = cache.stop().then(() => { stopped = true; });
  await nextTurn(); assert.equal(stopped, false);
  finish.resolve(2); await stopping;
  assert.equal(stopped, true);
  t.mock.timers.tick(60_000); await nextTurn();
  assert.equal(builds, 2);
});

test("failed warming retries without blocking another page's schedule", async t => {
  setup(t);
  const errors = t.mock.method(logger, "error", () => logger);
  let attempts = 0, healthyBuilds = 0;
  const failing = new ForeverSnapshotCache("forever:failing:v1", async () => {
    if (++attempts === 1) throw new Error("temporary read failure");
    return "recovered";
  });
  const healthy = new ForeverSnapshotCache("forever:healthy:v1", async () => ++healthyBuilds);
  t.after(async () => { await Promise.all([failing.stop(), healthy.stop()]); });
  failing.start(); healthy.start(); await nextTurn();
  assert.equal(errors.mock.callCount(), 1);
  assert.equal(await healthy.get(), 1);
  t.mock.timers.tick(30_000); await nextTurn();
  assert.equal(attempts, 2);
  assert.equal(await failing.get(), "recovered");
  assert.equal(await healthy.get(), 2);
});

test("moderation during an older build cannot republish into the new public view", async t => {
  setup(t);
  const started = deferred<void>(), finish = deferred<string>();
  let builds = 0;
  const cache = new ForeverSnapshotCache("forever:test:v1", async () => {
    if (++builds > 1) return "moderated";
    started.resolve(); return finish.promise;
  });
  t.after(async () => { finish.resolve("old"); await cache.stop(); });
  const old = cache.get(); await started.promise;
  revision++;
  assert.equal(await cache.get(), "moderated");
  finish.resolve("old"); await old;
  assert.equal(await cache.get(), "moderated");
  assert.equal(builds, 2);
});

test("expired snapshots wait for fresh data instead of retaining obsolete data indefinitely", async t => {
  setup(t);
  let builds = 0;
  const cache = new ForeverSnapshotCache("forever:test:v1", async () => ++builds);
  t.after(() => cache.stop());
  assert.equal(await cache.get(), 1);
  t.mock.timers.tick(60_001);
  assert.equal(await cache.get(), 2);
});
