import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Fight, { PHYSICAL_PULL_INDEX, PHYSICAL_PULL_INDEX_NAME } from "../src/models/Fight";
import Guild from "../src/models/Guild";
import Raid from "../src/models/Raid";
import Event from "../src/models/Event";
import { turtlesPulls } from "../test/fixtures/pull-fixtures";

process.env.BLIZZARD_CLIENT_ID ||= "test";
process.env.BLIZZARD_CLIENT_SECRET ||= "test";
process.env.RAIDER_IO_API_KEY ||= "test";

// Fixed localhost destination; never load deployment credentials or an application database.
const database = `wow_pull_dedup_test_${process.pid}`;
test("MongoDB: real progress, event correction, history and indexed chronological grouping", async t => {
  await mongoose.connect(`mongodb://127.0.0.1:27141/${database}?directConnection=true`, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000,
  });
  try {
    const service = (await import("../src/services/guild.service")).default as any;
    const mechanics = (await import("../src/services/character-mechanics.service")).default as any;
    const rows = turtlesPulls();
    const guildId = new mongoose.Types.ObjectId(rows[0].guildId);
    const guild = await Guild.create({ _id: guildId, name: "Pull regression", realm: "test", region: "eu", progress: [] });
    const raid = await Raid.create({ id: 53, name: "The Venomous Abyss", slug: "the-venomous-abyss", expansion: "Midnight",
      bosses: [{ id: 3492, name: "Ula'tek", slug: "ulatek" }] });
    await Fight.insertMany(rows.map(row => ({ ...row, guildId, reportEndTime: +row.timestamp + row.duration,
      deathEventsFetchStatus: "fetched", combatantInfoFetchStatus: "fetched", deaths: [] })));
    await Fight.collection.createIndex({ reportCode: 1, fightId: 1 }, { unique: true });
    await Fight.collection.createIndex(PHYSICAL_PULL_INDEX, { name: PHYSICAL_PULL_INDEX_NAME });
    await Event.create({ type: "boss_kill", guildId, guildName: guild.name, raidId: 53, raidName: raid.name,
      bossId: 3492, bossName: "Ula'tek", difficulty: "mythic", data: { pullCount: 291, timeSpent: 51139.384 },
      timestamp: new Date("2026-11-08T19:33:56.085Z") });

    await service.calculateRaidStatistics(guild, raid, "mythic", false, undefined, false);
    await guild.save();
    assert.equal(guild.progress[0].bosses[0].pullCount, 292);
    assert.equal(guild.progress[0].bosses[0].kills, 1);
    assert.equal(await Fight.countDocuments({ guildId }), 306, "raw recordings remain intact");
    const event: any = await Event.findOne({ guildId }).lean();
    assert.equal(event.data.pullCount, 292);
    assert.equal(+event.timestamp, +new Date("2026-11-08T19:33:53.584Z"));
    assert.equal(event.data.timeSpent, guild.progress[0].bosses[0].timeSpent);
    const history = await service.getBossPullHistory("test", guild.name, 53, 3492, "mythic");
    assert.equal(history.pullHistory.length, 292);
    assert.equal(history.pullHistory.at(-1).isKill, true);

    await service.calculateRaidStatistics(guild, raid, "mythic", false, undefined, false);
    const repeated: any = await Event.findOne({ guildId }).lean();
    assert.equal(+repeated.updatedAt, +event.updatedAt, "unchanged recalculation performs no event update");
    assert.equal(await Event.countDocuments({ guildId }), 1, "no replacement event was published");

    t.mock.method(mechanics, "findReportRegions", async () => new Map());
    t.mock.method(mechanics, "findReportAppearances", async () => []);
    t.mock.method(mechanics, "findCharacterAliases", async () => []);
    const coverage = await mechanics.buildSurvivalStatsFromFetchedFights(53);
    assert.equal(coverage.eligibleFights, 292);
    assert.equal(coverage.fights, 292);
    assert.equal(coverage.coverage, 1);

    const plan: any = await Fight.find({ zoneId: 53, difficulty: 5, encounterID: { $in: [3492] }, reportEndTime: { $gt: 0 }, duration: { $gt: 0 } })
      .sort({ timestamp: 1, reportCode: 1, fightId: 1 }).explain("executionStats");
    const stages: string[] = [];
    const indices: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.stage) stages.push(node.stage);
      if (node.indexName) indices.push(node.indexName);
      for (const child of Object.values(node)) if (typeof child === "object") walk(child);
    };
    walk(plan.queryPlanner.winningPlan);
    assert.equal(stages.includes("SORT"), false, "chronological scan must not need a blocking sort");
    assert.ok(indices.includes(PHYSICAL_PULL_INDEX_NAME));
    assert.equal(plan.executionStats.nReturned, 306);

    // A historical recording outside this tier must not change the history cutoff.
    raid.starts = { eu: new Date("2026-08-01T00:00:00Z") };
    raid.ends = { eu: new Date("2026-12-01T00:00:00Z") };
    await raid.save();
    await Fight.create({ ...rows[0], guildId, reportCode: "outside-tier", isKill: true,
      timestamp: new Date("2026-07-01T00:00:00Z") });
    await service.calculateRaidStatistics(guild, raid, "mythic", false, undefined, false);
    await guild.save();
    const scopedHistory = await service.getBossPullHistory("test", guild.name, 53, 3492, "mythic");
    assert.equal(guild.progress[0].bosses[0].pullCount, 292);
    assert.equal(scopedHistory.pullHistory.length, 292);
    assert.equal(scopedHistory.pullHistory.at(-1).reportCode, "bNhcWmvTgQH2LrKw");

  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
