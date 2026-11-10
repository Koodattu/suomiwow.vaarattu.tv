import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Fight from "../src/models/Fight";
import Report from "../src/models/Report";
import Raid from "../src/models/Raid";
import Guild from "../src/models/Guild";
import Event from "../src/models/Event";
import FightVodLink from "../src/models/FightVodLink";
import { groupPulls } from "../src/utils/fight-deduplication";
import { turtlesPulls } from "./fixtures/pull-fixtures";

process.env.BLIZZARD_CLIENT_ID ||= "test";
process.env.BLIZZARD_CLIENT_SECRET ||= "test";
process.env.RAIDER_IO_API_KEY ||= "test";
const query = (rows: any) => ({ select() { return this; }, sort() { return this; }, lean: async () => rows });
const guildId = new mongoose.Types.ObjectId("69078debcac26f9ef1008fe6");
const guild = () => ({ _id: guildId, name: "Pull regression", realm: "test", region: "eu", progress: [] as any[], lairProgress: [], markModified() {} });
const raid = { id: 53, name: "The Venomous Abyss", bosses: [{ id: 3492, name: "Ula'tek" }] };

async function guildService() { return (await import("../src/services/guild.service")).default as any; }

test("real guild recalculation and history agree on 292; existing event is corrected without publication", async t => {
  const service = await guildService();
  const cache = (await import("../src/services/cache.service")).default;
  const g = guild();
  const corrections: any[] = [];
  t.mock.method(Fight, "find", () => query(turtlesPulls()) as any);
  t.mock.method(Report, "find", () => query([]) as any);
  t.mock.method(Event, "updateMany", async (filter: any, update: any) => { corrections.push({ filter, update }); return { modifiedCount: 1 }; });
  t.mock.method(Event, "create", async () => { throw new Error("Recalculation must not publish events"); });
  let invalidated = 0;
  t.mock.method(cache, "invalidateEventCaches", async () => { invalidated++; });
  await service.calculateRaidStatistics(g, raid, "mythic", false, undefined, false);
  const boss = g.progress[0].bosses[0];
  assert.equal(boss.pullCount, 292);
  assert.equal(boss.kills, 1);
  assert.equal(boss.pullHistory.length, 292);
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].filter.type, "boss_kill");
  assert.equal(corrections[0].filter.raidId, 53);
  assert.equal(corrections[0].filter.difficulty, "mythic");
  assert.equal(corrections[0].update.$set["data.pullCount"], 292);
  assert.equal(+corrections[0].update.$set.timestamp, +boss.firstKillTime);
  assert.equal(invalidated, 1);
  t.mock.method(Guild, "findOne", () => query(g) as any);
  t.mock.method(Raid, "findOne", () => query(raid) as any);
  t.mock.method(FightVodLink, "find", () => query([]) as any);
  const history = await service.getBossPullHistory("test", g.name, 53, 3492, "mythic");
  assert.equal(history.pullHistory.length, 292);
  assert.equal(history.pullHistory.at(-1).isKill, true);
});

test("unchanged event reconciliation does not invalidate caches or create an event", async t => {
  const service = await guildService();
  const cache = (await import("../src/services/cache.service")).default;
  t.mock.method(Event, "updateMany", async (filter: any) => {
    assert.equal(filter.$or[0]["data.pullCount"].$ne, 292);
    return { modifiedCount: 0 };
  });
  t.mock.method(cache, "invalidateEventCaches", async () => { throw new Error("Unchanged snapshot"); });
  await service.reconcileKillEvent(guild(), { raidId: 53, difficulty: "mythic" }, { bossId: 3492, pullCount: 292, timeSpent: 100, firstKillTime: new Date() });
});

test("raid time retains all source aliases when canonical copies switch reports", async t => {
  const service = await guildService();
  const base = { ...turtlesPulls()[0], guildId, reportStartTime: 1_000_000, duration: 60_000, bossPercentage: 50 };
  const a = [0, 120_000].map((start, index) => ({ ...base, reportCode: "A", fightId: index + 1, fightStartTime: start, fightEndTime: start + 60_000, timestamp: new Date(1_000_000 + start) }));
  const b = [2000, 118_000].map((start, index) => ({ ...base, reportCode: "B", fightId: index + 1, fightStartTime: start, fightEndTime: start + 60_000, timestamp: new Date(1_000_000 + start) }));
  const copies = [...a, ...b];
  t.mock.method(Fight, "find", () => query([...copies]) as any);
  t.mock.method(Report, "find", () => query([a, b].map(rows => ({ code: rows[0].reportCode, startTime: 1_000_000,
    fightSequence: rows.map(f => ({ fightId: f.fightId, startTime: f.fightStartTime, endTime: f.fightEndTime })) }))) as any);
  const g = guild();
  await service.calculateRaidStatistics(g, raid, "mythic", false, undefined, false);
  assert.equal(g.progress[0].bosses[0].pullCount, 2);
  assert.equal(g.progress[0].totalCombatTimeSpent, 120);
  assert.equal(g.progress[0].totalRaidTimeSpent, 180);
  assert.equal(g.progress[0].progressRaidTimeSpent, 180);
});

test("re-kill event counts physical pulls and ignores duplicate copies of the latest kill", async t => {
  const service = await guildService();
  const base = turtlesPulls()[0];
  const originals = Array.from({ length: 8 }, (_, index) => ({ ...base, reportCode: "A", fightId: index + 1,
    timestamp: new Date(1_000_000 + index * 300_000), duration: 60_000, isKill: index === 0 || index === 7 }));
  const copies = originals.map(f => ({ ...f, reportCode: "B", timestamp: new Date(+f.timestamp + 2500) }));
  t.mock.method(Fight, "find", (filter: any) => { assert.equal(filter.zoneId, 53); return query([...originals, ...copies]) as any; });
  t.mock.method(service, "getBossIconFilename", async () => undefined);
  const cache = (await import("../src/services/cache.service")).default;
  t.mock.method(cache, "invalidateEventCaches", async () => {});
  const events: any[] = [];
  t.mock.method(Event, "create", async (row: any) => { events.push(row); return row; });
  await service.checkAndCreateEvents(guild(), { raidId: 53, raidName: raid.name, difficulty: "mythic" }, { kills: 1 }, { bossId: 3492, bossName: "Ula'tek", kills: 2 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "reproge");
  assert.equal(events[0].data.pullCount, 7);
  assert.equal(+events[0].timestamp, +originals[7].timestamp);
});

test("VOD shortlist contains five distinct attempts from the real duplicate reports", async t => {
  const service = (await import("../src/services/fight-vod.service")).default as any;
  t.mock.method(Fight, "find", () => query(turtlesPulls()) as any);
  const rows = await service.getRecentBestPullFights(guildId, { raidId: 53, difficulty: "mythic" }, { bossId: 3492, kills: 0, pullCount: 302 }, new Date(0));
  assert.equal(rows.length, 5);
  assert.equal(groupPulls(rows).length, 5);
  assert.equal(rows.filter((row: any) => row.isKill).length, 1);
});

test("multiple uploads of a single night cannot establish a recurring raid schedule", async t => {
  const service = await guildService();
  const start = +new Date("2026-11-08T17:00:00Z");
  const base = { ...turtlesPulls()[0], reportStartTime: start, fightStartTime: 0, fightEndTime: 3_600_000, timestamp: new Date(start) };
  t.mock.method(Raid, "findOne", async () => ({ ...raid, starts: { eu: new Date("2026-01-01") }, ends: { eu: new Date("2027-01-01") } }));
  t.mock.method(Fight, "find", () => query([base, { ...base, reportCode: "B" }]) as any);
  const g: any = guild();
  await service.calculateRaidingSchedule(g, 53);
  assert.deepEqual(g.raidSchedule.days, []);
});
