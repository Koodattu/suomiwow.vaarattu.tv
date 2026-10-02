import assert from "node:assert/strict";
import test from "node:test";
import { activeAvoidableMechanics, findAvoidableMechanic } from "../src/config/avoidable-mechanics";
import { parseMechanicFilters } from "../src/routes/avoidable-damage";
import { isWithinMechanicTier } from "../src/services/avoidable-damage.service";
import wcl from "../src/services/warcraftlogs.service";
import { addMechanicDamage, emptyDamageTotals, isSameMechanicPull, mechanicClassId, mechanicIdentity, MechanicCollectionPaused, MechanicDamageEvent } from "../src/utils/avoidable-damage";

const event = (overrides: Partial<MechanicDamageEvent> = {}): MechanicDamageEvent => ({ type: "damage", fight: 7, targetID: 1, abilityGameID: 1287083, amount: 100, hitType: 1, ...overrides });
const actors = [{ id: 1, name: "Hit", server: "Test Realm", subType: "Mage" }, { id: 2, name: "Dodge", server: "Test Realm", subType: "DeathKnight" }];
const response = (events: MechanicDamageEvent[], next: number | null = null) => ({ reportData: { report: {
  masterData: { actors }, fights: [{ id: 7, encounterID: 3420, difficulty: 5, friendlyPlayers: [1, 2] }],
  events: { data: events, nextPageTimestamp: next },
} } });

test("the approved catalogue uses stable keys and explicit damage IDs", () => {
  const catalogue = activeAvoidableMechanics();
  assert.equal(catalogue.length, 31);
  assert.equal(new Set(catalogue.map((entry) => entry.key)).size, catalogue.length);
  for (const entry of catalogue) {
    assert.ok(entry.version > 0 && entry.damageSpellIds.length > 0);
    assert.ok(entry.damageSpellIds.every((id) => Number.isSafeInteger(id) && id > 0));
    assert.equal(new Set(entry.damageSpellIds).size, entry.damageSpellIds.length);
    assert.match(entry.icon, /^[a-z0-9_]+\.jpg$/);
  }
  assert.deepEqual(findAvoidableMechanic("zekvoz-surging-darkness")?.damageSpellIds, [265451, 265452, 265454]);
  assert.ok(!findAvoidableMechanic("vanguard-divine-toll")?.damageSpellIds.includes(375576));
  assert.deepEqual(findAvoidableMechanic("sprocketmonger-beams")?.damageSpellIds, [1216415, 1216679]);
});

test("damage matches WCL raw damage and distinguishes direct hits, ticks, absorbs and misses", () => {
  const totals = emptyDamageTotals();
  for (const entry of [
    event({ amount: 70, absorbed: 20, overkill: 30 }), // WCL amount already excludes overkill.
    event({ amount: 0, absorbed: 80, hitType: 3 }),
    event({ amount: 40, overkill: -1, tick: true }),
    event({ amount: 0, hitType: 1 }),
    event({ amount: 0, hitType: 10 }),
    event({ amount: 0, hitType: 0 }),
    event({ amount: 0, hitType: 7 }),
    event({ type: "applydebuff" }),
  ]) addMechanicDamage(totals, entry);
  assert.deepEqual(totals, { damage: 240, hits: 4, directHits: 3, ticks: 1 });
});

test("pagination fetches only the whitelist and keeps zero-hit roster participants", async (t) => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  t.mock.method(wcl, "query", async (query: string, variables: Record<string, unknown>) => {
    calls.push({ query, variables: { ...variables } });
    return calls.length === 1 ? response([event(), event({ abilityGameID: 1307324 }), event({ fight: 8 }), event({ targetID: 99 })], 12345)
      : response([event({ amount: 25, tick: true })]);
  });
  let checks = 0;
  const result = await wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async () => { checks++; });
  assert.equal(checks, 2);
  assert.match(calls[0].query, /difficulty: 5, dataType: DamageTaken/);
  assert.match(calls[0].query, /includeResources: false/);
  assert.deepEqual(calls[0].variables.fightIds, [7]);
  assert.equal(calls[0].variables.filter, "target.type = 'Player' AND ability.id IN (1287083)");
  assert.equal(calls[1].variables.start, 12345);
  assert.equal(calls[1].variables.metadata, false);
  assert.deepEqual(result.damage.get(7)?.get(1), { damage: 125, hits: 2, directHits: 1, ticks: 1 });
  assert.deepEqual(result.damage.get(7)?.get(2), emptyDamageTotals());
});

test("a failed or paused later page never returns a partial success", async (t) => {
  let calls = 0;
  t.mock.method(wcl, "query", async () => { if (++calls > 1) throw new Error("network failure"); return response([event()], 99); });
  await assert.rejects(wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async () => {}), /network failure/);
  calls = 0;
  let checks = 0;
  await assert.rejects(wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async () => {
    if (++checks > 1) throw new MechanicCollectionPaused("budget");
  }), MechanicCollectionPaused);
  assert.equal(calls, 1);
});

test("pagination refuses non-advancing cursors and missing rosters", async (t) => {
  const stub = t.mock.method(wcl, "query", async () => response([event()], 12));
  await assert.rejects(wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async () => {}), /did not advance/);
  stub.mock.mockImplementation(async () => {
    const data = response([]);
    data.reportData.report.fights[0].friendlyPlayers = [];
    return data;
  });
  await assert.rejects(wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async () => {}), /Incomplete Mythic fight roster/);
  await assert.rejects(wcl.getAvoidableDamage("TEST", 3420, [], [1287083], async () => {}), /Explicit/);
});

test("archived reports use existing user authorization for every remaining page", async (t) => {
  t.mock.method(wcl, "query", async () => { throw new Error("This report has been archived. Use the /user API endpoint"); });
  t.mock.method(wcl, "hasUserAuthConnected", async () => true);
  let calls = 0;
  t.mock.method(wcl, "queryUser", async () => ++calls === 1 ? response([event()], 10) : response([]));
  const checks: string[] = [];
  await wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async (endpoint) => { checks.push(endpoint); });
  assert.deepEqual(checks, ["client", "user", "user"]);
});

test("duplicate detection needs matching encounter, absolute time, duration and outcome", () => {
  const pull = { reportCode: "A", fightId: 1, encounterID: 3420, reportStartTime: 1_000_000, fightStartTime: 10_000, duration: 90_000, isKill: false };
  assert.equal(isSameMechanicPull(pull, { ...pull, reportCode: "B", reportStartTime: 1_005_000, fightStartTime: 5_000 }), true);
  assert.equal(isSameMechanicPull(pull, { ...pull, fightStartTime: 110_000 }), false);
  assert.equal(isSameMechanicPull(pull, { ...pull, encounterID: 1 }), false);
  assert.equal(isSameMechanicPull(pull, { ...pull, isKill: true }), false);
  assert.equal(isSameMechanicPull(pull, { ...pull, duration: 80_000 }), false);
});

test("realm matching and class IDs agree with the existing WCL character catalogue", () => {
  assert.equal(mechanicClassId(actors[0]), 4);
  assert.equal(mechanicClassId(actors[1]), 1);
  assert.equal(mechanicIdentity("CHAR", "Test Realm", "EU", 4), mechanicIdentity("char", "test-realm", "eu", 4));
  assert.notEqual(mechanicIdentity("char", "one", "eu", 4), mechanicIdentity("char", "two", "eu", 4));
});

test("regional tier windows exclude later over-levelled runs", () => {
  const raid = { starts: { eu: new Date(100), us: new Date(50) }, ends: { eu: new Date(200), us: new Date(150) } };
  assert.equal(isWithinMechanicTier(75, "EU", raid), false);
  assert.equal(isWithinMechanicTier(175, "EU", raid), true);
  assert.equal(isWithinMechanicTier(175, "US", raid), false);
  assert.equal(isWithinMechanicTier(201, "EU", raid), false);
});

test("public filters reject unknown mechanics, query objects and unbounded pagination", () => {
  const valid = { mechanic: "sszorak-tempest" };
  assert.deepEqual(parseMechanicFilters(valid), { ...valid, guildId: undefined, outcome: "all", sort: "damage", order: "desc", roles: ["dps", "healer", "tank"], minPulls: 0, page: 1, limit: 50 });
  assert.deepEqual(parseMechanicFilters({ ...valid, roles: "tank,dps,tank", order: "asc", minPulls: "25" })?.roles, ["dps", "tank"]);
  assert.deepEqual(parseMechanicFilters({ ...valid, roles: "" })?.roles, []);
  for (const changes of [{ mechanic: "removed" }, { mechanic: ["sszorak-tempest"] }, { page: "1.5" }, { page: "10001" }, { limit: "101" }, { guildId: { $ne: null } }, { sort: "$where" }, { outcome: "heroic" },
    { roles: ["dps"] }, { roles: "damage" }, { roles: "tank," }, { order: "up" }, { minPulls: "-1" }, { minPulls: "11" }, { minPulls: "10.0" }, { minPulls: { $gt: 0 } }]) {
    assert.equal(parseMechanicFilters({ ...valid, ...changes }), null);
  }
});

test("an exhausted archive-auth budget yields without making a paid client request", async (t) => {
  // Match the other queue tests: its existing dependencies construct clients on
  // import. This test never calls them and must not require real credentials.
  for (const key of ["BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET", "RAIDER_IO_API_KEY"]) {
    const previous = process.env[key];
    process.env[key] = "mechanic-test-unused";
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const { default: processor } = await import("../src/services/background-guild-processor.service");
  const { default: service } = await import("../src/services/avoidable-damage.service");
  const { default: rateLimit } = await import("../src/services/rate-limit.service");
  type Queue = Parameters<typeof service.collectGuild>[0];
  const controller = processor as unknown as {
    isRunning: boolean;
    refreshProcessorPauseState(): Promise<void>;
    processGuildAvoidableDamage(queue: Queue): Promise<boolean>;
  };
  const wasRunning = controller.isRunning;
  let resumed = 0;
  let fetched = 0;
  t.mock.method(controller, "refreshProcessorPauseState", async () => {});
  t.mock.method(rateLimit, "getAllSharedStatuses", async () => ({}));
  t.mock.method(rateLimit, "canProceedBackground", (endpoint: string = "client") => endpoint !== "user");
  t.mock.method(service, "releaseGuild", async () => { resumed++; });
  t.mock.method(service, "collectGuild", async (_queue: Queue, beforePage: (endpoint: "client" | "user") => Promise<void>) => {
    await beforePage("client");
    fetched++;
    return true;
  });
  try {
    controller.isRunning = true;
    const queue = {} as Queue;
    assert.equal(await controller.processGuildAvoidableDamage(queue), false);
    assert.equal(resumed, 1);
    assert.equal(fetched, 0);
  } finally {
    controller.isRunning = wasRunning;
  }
});

test("mechanic HTTP 429 yields once and shared hard limits prevent the next request", async (t) => {
  const { default: rateLimit } = await import("../src/services/rate-limit.service");
  const transport = wcl as unknown as { authenticate(): Promise<string>; requestDelay(): Promise<void>; fetchWithNetworkRetry(): Promise<unknown> };
  let requests = 0;
  let hardLimited = false;
  t.mock.method(transport, "authenticate", async () => "test-unused");
  t.mock.method(transport, "requestDelay", async () => {});
  t.mock.method(transport, "fetchWithNetworkRetry", async () => {
    requests++;
    return { status: 429, headers: { get: () => "60" } };
  });
  t.mock.method(rateLimit, "refreshSharedState", async () => {});
  t.mock.method(rateLimit, "isHardLimited", () => hardLimited);
  t.mock.method(rateLimit, "recordRateLimited", async () => { hardLimited = true; });
  t.mock.method(rateLimit, "waitForHardLimit", async () => { assert.fail("A mechanic job must yield instead of blocking inside an HTTP retry"); });
  await assert.rejects(wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async () => {}), MechanicCollectionPaused);
  assert.equal(requests, 1);
  await assert.rejects(wcl.getAvoidableDamage("TEST", 3420, [7], [1287083], async () => {}), MechanicCollectionPaused);
  assert.equal(requests, 1);
});
