import assert from "node:assert/strict";
import test from "node:test";
import { findAvoidableMechanic } from "../src/config/avoidable-mechanics";
import service from "../src/services/avoidable-damage.service";
import { mockSnapshotStorage } from "./helpers/snapshot-cache";
import { MechanicLeaderboardFilters, MechanicSnapshot, MechanicSnapshotRow, selectMechanicLeaderboard } from "../src/utils/mechanic-leaderboard";

const mechanic = findAvoidableMechanic("sszorak-tempest")!;
const filters: MechanicLeaderboardFilters = { mechanic: mechanic.key, outcome: "all", sort: "damage", order: "desc", page: 1, limit: 50 };
const row = (key: string, values: Partial<MechanicSnapshotRow> = {}): MechanicSnapshotRow => ({
  key, name: key, realm: "test", region: "eu", classId: 2, specName: null, guildId: "one", guildName: "One", isKill: false, role: "dps",
  damage: 100, hits: 10, directHits: 10, ticks: 0, pulls: 10, reportCode: "A", fightId: 1, actorId: 1, timestamp: 1, ...values,
});
const snapshot: MechanicSnapshot = { mechanic, rows: [
  row("hybrid"), row("hybrid", { role: "healer", damage: 50, hits: 1, directHits: 1, pulls: 15, timestamp: 2, reportCode: "B" }),
  row("tank", { role: "tank", damage: 300, hits: 3, directHits: 3, pulls: 50 }),
  row("dodge", { damage: 0, hits: 0, directHits: 0, pulls: 100 }),
  row("unknown", { role: null, damage: 80 }),
  row("hybrid", { guildId: "two", guildName: "Two", isKill: true, damage: 20, hits: 2, directHits: 2, pulls: 5, timestamp: 3, reportCode: "C" }),
], coverage: [
  { guildId: "one", isKill: false, status: "fetched", fights: 100, updatedAt: "2026-09-01T00:00:00.000Z" },
  { guildId: "two", isKill: true, status: "fetched", fights: 5, updatedAt: "2026-09-02T00:00:00.000Z" },
  { guildId: "one", isKill: false, status: "unavailable", fights: 3, updatedAt: null },
] };

test("role combinations count only matching pulls, keep zero hits and never guess an unknown role", () => {
  const all = selectMechanicLeaderboard(snapshot, filters);
  assert.equal(all.totals.players, 4);
  assert.equal(all.totals.damage, 550);
  assert.equal(all.rows.find((entry) => entry.key === "hybrid")?.reportCode, "C");
  const mixed = selectMechanicLeaderboard(snapshot, { ...filters, roles: ["dps", "healer"], minPulls: 25 });
  assert.equal(mixed.totals.players, 2);
  assert.equal(mixed.totals.damage, 170);
  assert.equal(mixed.rows[0].pulls, 30);
  assert.equal(mixed.rows[0].hitsPerPull, 13 / 30);
  assert.equal(mixed.rows[1].hits, 0);
  const healer = selectMechanicLeaderboard(snapshot, { ...filters, roles: ["healer"], minPulls: 10 });
  assert.equal(healer.rows[0].damage, 50);
  assert.equal(healer.rows[0].pulls, 15);
  assert.equal(healer.rows[0].reportCode, "B");
  assert.equal(selectMechanicLeaderboard(snapshot, { ...filters, roles: [], minPulls: 0 }).totals.players, 0);
  assert.equal(selectMechanicLeaderboard(snapshot, { ...filters, roles: ["healer"], minPulls: 25 }).totals.players, 0);
  assert.equal(healer.coverage.fetched, 105);
  assert.equal(snapshot.rows[0].damage, 100, "filtering must not mutate the shared cache");
});

test("most-played spec counts matching boss pulls, including zero-hit pulls, across all groups", () => {
  const specs: MechanicSnapshot = { mechanic, coverage: [], rows: [
    row("hybrid", { specName: "balance", pulls: 6, damage: 0, hits: 0, directHits: 0 }),
    row("hybrid", { specName: "restoration", role: "healer", pulls: 8, timestamp: 4, damage: 1000 }),
    row("hybrid", { specName: "balance", isKill: true, pulls: 5, timestamp: 2, damage: 0, hits: 0, directHits: 0 }),
    row("hybrid", { specName: "restoration", role: "healer", guildId: "two", isKill: true, pulls: 2, timestamp: 5 }),
    row("hybrid", { specName: "feral", guildId: "two", isKill: true, pulls: 3, timestamp: 6 }),
    row("hybrid", { specName: null, role: null, pulls: 100, timestamp: 7 }),
  ] };
  const select = (scope: Partial<MechanicLeaderboardFilters> = {}) => selectMechanicLeaderboard(specs, { ...filters, ...scope }).rows[0];
  assert.equal(select().specName, "balance", "total attendance wins over damage, group size and latest spec");
  assert.equal(select().pulls, 124, "unknown specs still contribute to totals");
  assert.equal(select({ roles: ["healer"] }).specName, "restoration");
  assert.equal(select({ roles: ["dps"] }).specName, "balance");
  assert.equal(select({ guildId: "two" }).specName, "feral");
  assert.equal(select({ outcome: "wipes" }).specName, "restoration");
  assert.equal(selectMechanicLeaderboard({ ...specs, rows: [...specs.rows].reverse() }, filters).rows[0].specName, "balance");
});

test("spec ties prefer recent attendance and missing specs remain unknown", () => {
  const specs: MechanicSnapshot = { mechanic, coverage: [], rows: [
    row("recent", { specName: "balance", timestamp: 1 }), row("recent", { specName: "restoration", timestamp: 2 }),
    row("tied", { specName: "restoration" }), row("tied", { specName: "balance" }), row("unknown"),
  ] };
  const rows = selectMechanicLeaderboard(specs, filters).rows;
  assert.equal(rows.find((entry) => entry.key === "recent")?.specName, "restoration");
  assert.equal(rows.find((entry) => entry.key === "tied")?.specName, "balance");
  assert.equal(rows.find((entry) => entry.key === "unknown")?.specName, null);
});

test("minimum pulls use inclusive thresholds after guild, outcome and role filtering", () => {
  for (const minimum of [10, 25, 50, 100]) {
    const result = selectMechanicLeaderboard({ ...snapshot, rows: [row("under", { pulls: minimum - 1 }), row("equal", { pulls: minimum }), row("over", { pulls: minimum + 1 })] }, { ...filters, minPulls: minimum });
    assert.deepEqual(result.rows.map((entry) => entry.key), ["equal", "over"]);
  }
  const kills = selectMechanicLeaderboard(snapshot, { ...filters, guildId: "two", outcome: "kills", minPulls: 10 });
  assert.equal(kills.totals.players, 0);
  assert.equal(kills.coverage.fetched, 5);
  assert.equal(kills.coverage.unavailable, 0);
  const wipes = selectMechanicLeaderboard(snapshot, { ...filters, guildId: "one", outcome: "wipes", roles: ["dps"] });
  assert.equal(wipes.rows[0].pulls, 10);
  assert.equal(wipes.rows[0].reportCode, "A");
});

test("ascending and descending sort the complete filtered leaderboard before pagination", () => {
  const large = { ...snapshot, rows: Array.from({ length: 120 }, (_, index) => row(`player-${index}`, { damage: index * 10, hits: 120 - index, pulls: 10 })) };
  for (const sort of ["damage", "hits", "hitsPerPull"] as const) {
    const asc = selectMechanicLeaderboard(large, { ...filters, sort, order: "asc", page: 2 });
    const desc = selectMechanicLeaderboard(large, { ...filters, sort, order: "desc", page: 2 });
    assert.equal(asc.rows.length, 50);
    assert.equal(asc.totalPages, 3);
    assert.equal(asc.totals.players, 120);
    assert.ok(asc.rows[0][sort] < asc.rows[49][sort]);
    assert.ok(desc.rows[0][sort] > desc.rows[49][sort]);
    assert.equal(asc.rows[0].key, sort === "damage" ? "player-50" : "player-69");
  }
});

test("character search uses sitewide accent folding and searches names only", () => {
  const names = ["Käris", "Shánkdk", "Ægir", "Smørrebrød", "Straße", "Laa\u0308ke", "Plainname"];
  const searchable: MechanicSnapshot = { ...snapshot, rows: names.map((name) => row(name)) };
  for (const [search, expected] of [["KARIS", "Käris"], ["hank", "Shánkdk"], ["aegir", "Ægir"], ["smorrebrod", "Smørrebrød"], ["strasse", "Straße"], ["laake", "Laa\u0308ke"], ["PLÁÎN", "Plainname"]]) {
    const result = selectMechanicLeaderboard(searchable, { ...filters, search });
    assert.deepEqual(result.rows.map((entry) => entry.name), [expected]);
    assert.equal(result.totals.players, 1);
    assert.equal(result.totals.damage, 100);
  }
  assert.equal(selectMechanicLeaderboard(searchable, { ...filters, search: "one" }).totals.players, 0, "guild names must not match character search");
  assert.equal(selectMechanicLeaderboard(searchable, { ...filters, search: "test" }).totals.players, 0, "realms must not match character search");
  assert.equal(selectMechanicLeaderboard(searchable, { ...filters, search: "  " }).totals.players, names.length);
  assert.deepEqual(searchable.rows.map((entry) => entry.name), names, "search must preserve displayed spelling and the shared snapshot");
});

test("search finds later-page characters and applies minimum pulls after merging matching roles", () => {
  const searchable: MechanicSnapshot = { ...snapshot, rows: [
    ...Array.from({ length: 60 }, (_, index) => row(`other-${index}`, { damage: 1000 })),
    row("match", { name: "Käris", pulls: 25, damage: 50 }),
    row("match", { name: "Käris", role: "healer", pulls: 25, damage: 20 }),
    row("other-match", { name: "Karisalt", pulls: 50, damage: 10 }),
  ] };
  assert.equal(selectMechanicLeaderboard(searchable, filters).rows.some((entry) => entry.key === "match"), false);
  const result = selectMechanicLeaderboard(searchable, { ...filters, search: "karis", minPulls: 50, limit: 1 });
  assert.equal(result.rows[0].name, "Käris");
  assert.equal(result.rows[0].pulls, 50);
  assert.equal(result.totals.players, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(selectMechanicLeaderboard(searchable, { ...filters, search: "karis", minPulls: 50, roles: ["healer"] }).totals.players, 0);
  assert.equal(selectMechanicLeaderboard(searchable, { ...filters, search: "karis", minPulls: 50, limit: 1, page: 2 }).rows[0].name, "Karisalt");
});

test("concurrent cold filters share one build; subsequent filters and searches do not aggregate", async (t) => {
  mockSnapshotStorage(t);
  const builder = service as unknown as { buildLeaderboardSnapshot(): Promise<MechanicSnapshot> };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let builds = 0;
  t.mock.method(builder, "buildLeaderboardSnapshot", async () => { builds++; await gate; return snapshot; });
  const pending = [service.getLeaderboard(filters), service.getLeaderboard({ ...filters, roles: ["tank"], order: "asc" })];
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(builds, 1);
  release();
  const results = await Promise.all(pending);
  assert.equal(results[1].totals.players, 1);
  await service.getLeaderboard({ ...filters, page: 2, outcome: "kills", guildId: "two", minPulls: 50 });
  assert.equal((await service.getLeaderboard({ ...filters, search: "TÁNK" })).rows[0].name, "tank");
  assert.equal(builds, 1);
});

test("stale results return while one background refresh is still pending", { timeout: 3000 }, async (t) => {
  const { entries } = mockSnapshotStorage(t);
  const key = `avoidable-damage:snapshot:v3:${mechanic.key}:${mechanic.version}`;
  entries.set(key, { key, data: snapshot, cachedAt: new Date(Date.now() - 11 * 60_000),
    expiresAt: new Date(Date.now() - 6 * 60_000), staleExpiresAt: new Date(Date.now() + 54 * 60_000) });
  const builder = service as unknown as {
    buildLeaderboardSnapshot(): Promise<MechanicSnapshot>;
    getSnapshot(mechanic: typeof snapshot.mechanic, warm: boolean): Promise<MechanicSnapshot>;
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let builds = 0;
  t.mock.method(builder, "buildLeaderboardSnapshot", async () => { builds++; await gate; return snapshot; });
  try {
    const results = await Promise.all([service.getLeaderboard(filters), service.getLeaderboard({ ...filters, sort: "hits" })]);
    assert.equal(results[0].totals.players, 4);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(builds, 1);
  } finally {
    release();
    await builder.getSnapshot(mechanic, true);
  }
});

test("failed cold builds can be retried instead of retaining a rejected promise", async (t) => {
  mockSnapshotStorage(t);
  const builder = service as unknown as { buildLeaderboardSnapshot(): Promise<MechanicSnapshot> };
  let builds = 0;
  t.mock.method(builder, "buildLeaderboardSnapshot", async () => { if (++builds === 1) throw new Error("fixture failure"); return snapshot; });
  await assert.rejects(service.getLeaderboard(filters), /fixture failure/);
  assert.equal((await service.getLeaderboard(filters)).totals.players, 4);
  assert.equal(builds, 2);
});
