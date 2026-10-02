import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { findAvoidableMechanic } from "../src/config/avoidable-mechanics";
import AvoidableDamageFight, { MechanicFetchStatus } from "../src/models/AvoidableDamageFight";
import Character from "../src/models/Character";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import Fight from "../src/models/Fight";
import Guild from "../src/models/Guild";
import GuildProcessingQueue from "../src/models/GuildProcessingQueue";
import Raid from "../src/models/Raid";
import Report from "../src/models/Report";
import service from "../src/services/avoidable-damage.service";
import iconCache from "../src/services/icon-cache.service";
import wcl from "../src/services/warcraftlogs.service";
import { MechanicCollectionPaused } from "../src/utils/avoidable-damage";
import cache from "../src/services/cache.service";

const mongoUri = process.env.MECHANIC_TEST_MONGO_URI;
test("mechanic collection and leaderboard work together against MongoDB", { skip: !mongoUri }, async (t) => {
  // Never allow this test to drop a real application database.
  assert.match(mongoUri!, /^mongodb:\/\/127\.0\.0\.1:\d+\/wow_mechanic_test_[a-z0-9_]+$/);
  await mongoose.connect(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const mechanic = findAvoidableMechanic("sszorak-tempest")!;
  const initialVersion = mechanic.version;
  try {
    await AvoidableDamageFight.init();
    const guildId = new mongoose.Types.ObjectId();
    const reportStartTime = Date.parse("2026-09-01T18:00:00Z");
    await Guild.collection.insertOne({ _id: guildId, name: "Fixture Guild", realm: "test-realm", region: "EU", excludedRaidIds: [] });
    await Raid.collection.insertOne({ id: 53, name: "Fixture Raid", expansion: "Midnight", starts: { eu: new Date("2026-01-01") }, ends: { eu: new Date("2027-01-01") } });
    await Report.collection.insertMany(["A", "B", "ARCHIVE"].map((code) => ({ code, guildId, zoneId: 53, isOngoing: false, startTime: reportStartTime })));
    const base = { guildId, zoneId: 53, encounterID: 3420, encounterName: "Sszorak", difficulty: 5, isKill: false, reportStartTime, duration: 20_000 };
    const insertPull = async (reportCode: string, fightId: number, start: number, extra = {}) => Fight.collection.insertOne({ ...base, reportCode, fightId, fightStartTime: start, fightEndTime: start + base.duration, timestamp: new Date(reportStartTime + start), ...extra });
    await insertPull("A", 1, 0);
    await insertPull("B", 1, 500); // Reupload of the first pull.
    await insertPull("A", 2, 60_000, { isKill: true });
    await Fight.updateOne({ reportCode: "A", fightId: 1 }, { $set: { combatants: [
      { name: "hit", server: "test-realm", specName: "fire", role: "dps" },
      { name: "Dodge", server: "different-realm", role: "tank" }, // Never match a namesake on another realm.
      { name: "Dodge", server: "Test Realm", specID: 257 }, // Holy priest; derive the role from its recorded spec.
    ] } });
    await Fight.updateOne({ reportCode: "A", fightId: 2 }, { $set: { combatants: [
      { name: "Dodge", server: "Test Realm", role: "dps" }, // The same priest changed role on the kill.
    ] } });
    await insertPull("ARCHIVE", 1, 120_000);
    await insertPull("A", 3, 180_000, { difficulty: 4 });
    await insertPull("A", 4, 240_000, { encounterID: 999 });
    await insertPull("A", 5, 400 * 24 * 60 * 60 * 1000); // Outside the tier.
    await CharacterReportAppearance.collection.insertOne({ reportCode: "A", sourceIdentityKey: "fixture", characterName: "Hit", characterRealm: "test-realm", characterRegion: "eu", classID: 4, wclCanonicalCharacterId: 42, hidden: false });
    const queue = await GuildProcessingQueue.create({ guildId, guildName: "Fixture Guild", guildRealm: "test-realm", guildRegion: "EU", jobType: "backfill_avoidable_damage" });
    const requested: Array<{ report: string; fights: number[] }> = [];
    t.mock.method(iconCache, "downloadAndCacheIcon", async () => "fixture.jpg");
    t.mock.method(wcl, "getAvoidableDamage", async (report: string, _encounter: number, ids: number[]) => {
      requested.push({ report, fights: ids });
      if (report === "ARCHIVE") throw new Error("This report has been archived");
      return { actors: [{ id: 1, name: "Hit", server: "Test Realm", subType: "Mage" }, { id: 2, name: "Dodge", server: "Test Realm", subType: "Priest" }],
        fights: ids.map((id) => ({ id, encounterID: 3420, difficulty: 5, friendlyPlayers: [1, 2] })),
        damage: new Map(ids.map((id) => [id, new Map([
          [1, { damage: id === 1 ? 120 : 0, hits: id === 1 ? 2 : 0, directHits: 1, ticks: 1 }],
          [2, { damage: 0, hits: 0, directHits: 0, ticks: 0 }],
        ])])),
      };
    });
    assert.equal(await service.collectGuild(queue, async () => {}), true);
    assert.deepEqual(requested.find((entry) => entry.report === "A")?.fights.sort(), [1, 2]);
    assert.equal(requested.some((entry) => entry.report === "B"), false);
    const filters = { mechanic: mechanic.key, outcome: "all" as const, sort: "damage" as const, page: 1, limit: 1 };
    let board = await service.getLeaderboard(filters);
    assert.equal(board.totals.damage, 120);
    assert.equal(board.totals.players, 2);
    assert.equal(board.rows[0].pulls, 2);
    assert.equal(board.rows[0].hitsPerPull, 1);
    assert.equal(board.rows[0].classId, 4);
    assert.equal(board.rows[0].key, "wcl:42:4");
    assert.deepEqual(board.coverage, { pending: 0, fetched: 2, failed: 0, archived: 1, unavailable: 0, duplicate: 1 });
    const second = await service.getLeaderboard({ ...filters, page: 2 });
    assert.equal(second.rows[0].name, "Dodge");
    assert.equal(second.rows[0].pulls, 2);
    assert.equal(second.rows[0].hits, 0);
    const kills = await service.getLeaderboard({ ...filters, outcome: "kills" });
    assert.equal(kills.coverage.fetched, 1);
    assert.equal(kills.totals.damage, 0);
    const healers = await service.getLeaderboard({ ...filters, roles: ["healer"] });
    assert.equal(healers.totals.players, 1);
    assert.equal(healers.rows[0].name, "Dodge");
    assert.equal(healers.rows[0].pulls, 1);
    assert.equal(healers.rows[0].hits, 0);
    const damage = await service.getLeaderboard({ ...filters, roles: ["dps"], limit: 50 });
    assert.equal(damage.rows.find((entry) => entry.name === "Hit")?.pulls, 2, "a pure damage class needs no guessed hybrid role");
    assert.equal(damage.rows.find((entry) => entry.name === "Dodge")?.pulls, 1);
    assert.equal((await service.getLeaderboard({ ...filters, roles: ["tank"] })).totals.players, 0);
    // All filter combinations above must share the stored, unpaginated snapshot.
    const aggregate = t.mock.method(AvoidableDamageFight, "aggregate", () => { throw new Error("unexpected repeat aggregation"); });
    assert.equal((await service.getLeaderboard({ ...filters, sort: "damage", order: "asc" })).rows[0].name, "Dodge");
    assert.equal((await service.getLeaderboard({ ...filters, minPulls: 10 })).totals.players, 0);
    aggregate.mock.restore();

    // Nightly reruns seed idempotently and don't spend any WCL requests on completed/archived data.
    queue.progress.currentPage = 0;
    const before = requested.length;
    await service.collectGuild(queue, async () => {});
    assert.equal(requested.length, before);
    assert.equal(await AvoidableDamageFight.countDocuments(), 4);

    // A changed definition gets independent results, while old results stop being public.
    mechanic.version++;
    queue.progress.currentPage = 0;
    await service.collectGuild(queue, async () => {});
    assert.equal(await AvoidableDamageFight.countDocuments(), 8);
    board = await service.getLeaderboard(filters);
    assert.equal(board.totals.damage, 120);
    assert.equal(board.coverage.fetched, 2);

    // Later privacy changes, exclusions and deleted source fights are respected on cache refresh.
    await Character.collection.insertOne({ wclCanonicalCharacterId: 42, classID: 4, wclProfileHidden: true });
    await service.warmLeaderboardCaches([mechanic.key], true);
    board = await service.getLeaderboard(filters);
    assert.equal(board.totals.players, 1);
    assert.equal(board.totals.damage, 0);
    await Guild.collection.updateOne({ _id: guildId }, { $set: { excludedRaidIds: [53] } });
    await service.warmLeaderboardCaches([mechanic.key], true);
    assert.equal((await service.getLeaderboard(filters)).coverage.fetched, 0);
    await Guild.collection.updateOne({ _id: guildId }, { $set: { excludedRaidIds: [] } });
    await Fight.deleteOne({ reportCode: "A", fightId: 2 });
    await service.warmLeaderboardCaches([mechanic.key], true);
    assert.equal((await service.getLeaderboard(filters)).coverage.fetched, 1);
  } finally {
    await service.warmLeaderboardCaches([mechanic.key]);
    mechanic.version = initialVersion;
    await cache.invalidatePattern(/^avoidable-damage:/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("selected collection persists scope, merges concurrent requests and resumes without refetching", { skip: !mongoUri }, async (t) => {
  assert.match(mongoUri!, /^mongodb:\/\/127\.0\.0\.1:\d+\/wow_mechanic_test_[a-z0-9_]+$/);
  await mongoose.connect(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const tempest = findAvoidableMechanic("sszorak-tempest")!;
  const axe = findAvoidableMechanic("coiled-altar-axegrinder")!;
  try {
    // The previous test drops the database, so explicitly rebuild these unique indexes.
    await GuildProcessingQueue.createIndexes();
    await AvoidableDamageFight.createIndexes();
    const guildIds = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
    const [guildId, otherGuildId, excludedGuildId, heroicGuildId] = guildIds;
    await Guild.collection.insertMany(guildIds.map((_id, index) => ({ _id, name: `Fixture ${index}`, realm: "realm", region: "EU", excludedRaidIds: index === 2 ? [53] : [] })));
    const start = Date.parse("2026-09-01T18:00:00Z");
    await Raid.collection.insertOne({ id: 53, name: "Fixture", starts: { eu: new Date("2026-01-01") }, ends: { eu: new Date("2027-01-01") } });
    await Report.collection.insertMany(guildIds.map((id, index) => ({ code: `R${index}`, guildId: id, zoneId: 53, isOngoing: false })));
    const insertPull = async (id: mongoose.Types.ObjectId, reportCode: string, fightId: number, encounterID: number, difficulty = 5) => {
      const fight = { guildId: id, reportCode, fightId, zoneId: 53, encounterID, difficulty, isKill: false,
        reportStartTime: start, fightStartTime: fightId * 60_000, duration: 20_000, timestamp: new Date(start + fightId * 60_000) };
      const result = await Fight.collection.insertOne(fight);
      return { ...fight, _id: result.insertedId };
    };
    const first = await insertPull(guildId, "R0", 1, tempest.encounterId);
    const second = await insertPull(guildId, "R0", 2, axe.encounterId);
    await insertPull(otherGuildId, "R1", 1, tempest.encounterId);
    await insertPull(excludedGuildId, "R2", 1, tempest.encounterId);
    await insertPull(heroicGuildId, "R3", 1, tempest.encounterId, 4);
    const guild = (await Guild.findById(guildId))!;
    const requested: Array<{ report: string; fights: number[]; encounter: number }> = [];
    let rateLimited = false;
    let pauseAfterRequest: number | undefined;
    t.mock.method(iconCache, "downloadAndCacheIcon", async () => "fixture.jpg");
    t.mock.method(wcl, "getAvoidableDamage", async (report: string, encounter: number, ids: number[]) => {
      if (rateLimited) throw new Error("WCL API request failed: 429 Too many requests");
      if (pauseAfterRequest !== undefined && requested.length >= pauseAfterRequest) throw new MechanicCollectionPaused("fixture pause between batches");
      requested.push({ report, encounter, fights: ids });
      return { actors: [{ id: 1, name: "Player", server: "Realm", subType: "Mage" }],
        fights: ids.map((id) => ({ id, encounterID: encounter, difficulty: 5, friendlyPlayers: [1] })),
        damage: new Map(ids.map((id) => [id, new Map([[1, { damage: 10, hits: 1, directHits: 1, ticks: 0 }]])])),
      };
    });
    const seedRow = async (source: typeof first, mechanic = tempest, status: MechanicFetchStatus = "pending", version = mechanic.version) => AvoidableDamageFight.create({
      sourceFightId: source._id, guildId: source.guildId, reportCode: source.reportCode, fightId: source.fightId,
      mechanicKey: mechanic.key, version, encounterId: source.encounterID, zoneId: 53, timestamp: source.timestamp,
      duration: source.duration, isKill: false, status,
    });
    // An unrelated pending mechanic must stay untouched by the selected run.
    await seedRow(second, axe);
    const initial = await service.queueBackfill({ mechanicKeys: [tempest.key] });
    assert.equal(initial.queued, 2);
    assert.equal(await GuildProcessingQueue.countDocuments({ guildId: { $in: [excludedGuildId, heroicGuildId] } }), 0);
    const claim = () => GuildProcessingQueue.findOneAndUpdate({ guildId }, { $set: { status: "in_progress" } }, { returnDocument: "after" }).orFail();
    const queue = await claim();
    assert.deepEqual(queue.targetMechanicKeys, [tempest.key]);
    assert.equal(await service.collectGuild(queue, async () => {}), true);
    assert.deepEqual(requested, [{ report: "R0", encounter: tempest.encounterId, fights: [1] }]);
    assert.equal((await AvoidableDamageFight.findOne({ sourceFightId: second._id }))?.status, "pending");

    // New requests cannot be overwritten by the old worker's completion.
    await service.queueBackfill({ guildId: String(guildId), mechanicKeys: [axe.key] });
    await service.releaseGuild(queue, true);
    let latest = (await GuildProcessingQueue.findOne({ guildId }))!;
    assert.equal(latest.status, "pending");
    assert.deepEqual(new Set(latest.targetMechanicKeys), new Set([tempest.key, axe.key]));
    latest = await claim();
    assert.equal(await service.collectGuild(latest, async () => {}), true);
    await service.releaseGuild(latest, true);
    assert.equal(requested.length, 2);
    assert.deepEqual(requested[1], { report: "R0", encounter: axe.encounterId, fights: [2] });
    assert.equal((await GuildProcessingQueue.findById(latest._id))?.status, "completed");

    // Restart/requeue of the same version uses saved aggregates, with no WCL calls.
    await service.queueBackfill({ guildId: String(guildId), mechanicKeys: [tempest.key] });
    latest = await claim();
    assert.equal(await service.collectGuild(latest, async () => {}), true);
    assert.equal(requested.length, 2);
    await service.releaseGuild(latest, true);

    const retrySource = await insertPull(guildId, "R0", 3, tempest.encounterId);
    const retryRow = await seedRow(retrySource, tempest, "archived");
    const otherMechanicSource = await insertPull(guildId, "R0", 4, axe.encounterId);
    const otherMechanicRow = await seedRow(otherMechanicSource, axe, "archived");
    const oldVersionRow = await seedRow(first, tempest, "archived", 0);
    const otherGuildSource = await insertPull(otherGuildId, "R1", 2, tempest.encounterId);
    const otherGuildRow = await seedRow(otherGuildSource, tempest, "archived");
    const retried = await service.queueBackfill({ guildId: String(guildId), mechanicKeys: [tempest.key], retryUnavailable: true });
    assert.equal(retried.retried, 1);
    for (const untouched of [otherMechanicRow, oldVersionRow, otherGuildRow]) assert.equal((await AvoidableDamageFight.findById(untouched._id))?.status, "archived");
    assert.equal((await AvoidableDamageFight.findOne({ sourceFightId: first._id, version: tempest.version }))?.status, "fetched");
    latest = await claim();
    rateLimited = true;
    await assert.rejects(service.collectGuild(latest, async () => {}), MechanicCollectionPaused);
    assert.equal((await AvoidableDamageFight.findById(retryRow._id))?.status, "pending");
    rateLimited = false;
    // Simulate resuming in a new worker process, after the seed checkpoint was saved.
    latest = (await GuildProcessingQueue.findById(latest._id))!;
    await service.collectGuild(latest, async () => {});
    assert.deepEqual(requested[2].fights, [3]);
    await service.releaseGuild(latest, true);

    await Promise.all([service.enqueueGuild(guild, [tempest.key]), service.enqueueGuild(guild, [axe.key])]);
    latest = (await GuildProcessingQueue.findOne({ guildId }))!;
    assert.deepEqual(new Set(latest.targetMechanicKeys), new Set([tempest.key, axe.key]));
    const invalidSource = await insertPull(guildId, "R0", 5, tempest.encounterId, 4);
    const invalidRow = await seedRow(invalidSource);
    latest = await claim();
    const before = requested.length;
    await service.collectGuild(latest, async () => {});
    assert.equal(requested.length, before);
    assert.equal((await AvoidableDamageFight.findById(invalidRow._id))?.status, "unavailable");

    // A pause inside a long report preserves both data and per-batch progress.
    for (let id = 10; id < 61; id++) await insertPull(guildId, "R0", id, tempest.encounterId);
    await service.releaseGuild(latest, true);
    await service.queueBackfill({ guildId: String(guildId), mechanicKeys: [tempest.key] });
    latest = await claim();
    pauseAfterRequest = requested.length + 1;
    await assert.rejects(service.collectGuild(latest, async () => {}), MechanicCollectionPaused);
    latest = (await GuildProcessingQueue.findById(latest._id))!;
    assert.equal(latest.progress.fightsSaved, 50);
    assert.equal(requested[requested.length - 1]?.fights.length, 50);
    pauseAfterRequest = undefined;
    await service.collectGuild(latest, async () => {});
    assert.equal(requested[requested.length - 1]?.fights.length, 1);
    assert.equal((await GuildProcessingQueue.findById(latest._id))?.progress.fightsSaved, 51);
    await GuildProcessingQueue.updateOne({ _id: latest._id }, { $set: { status: "paused" } });
    await service.releaseGuild(latest, false);
    await service.enqueueGuild(guild, [tempest.key]);
    assert.equal((await GuildProcessingQueue.findById(latest._id))?.status, "paused");
    const adminStatus = await service.getCollectionStatus(String(guildId));
    assert.equal(adminStatus.mechanics.find((entry) => entry.key === tempest.key)?.coverage.fetched, 53);
    assert.equal(adminStatus.counts.paused, 1);
    assert.equal(adminStatus.jobs.length, 1);
    await GuildProcessingQueue.deleteOne({ _id: latest._id });
    await service.releaseGuild(latest, true);
    assert.equal(await GuildProcessingQueue.exists({ _id: latest._id }), null);
  } finally {
    await service.warmLeaderboardCaches([tempest.key, axe.key]);
    await cache.invalidatePattern(/^avoidable-damage:/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
