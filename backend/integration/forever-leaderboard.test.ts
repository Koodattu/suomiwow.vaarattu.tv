import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { ForeverLeaderboardCache as Cache, ForeverLeaderboardLease as CacheRefreshLease } from "../src/features/forever/forever-leaderboard.models";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { leaderboard, stopForeverLeaderboard } from "../src/features/forever/forever-leaderboard";
import { setCharacterStatus, setGuildVisibility } from "../src/features/forever/forever.service";

test("Forever snapshots reuse one ranked population for all views and refresh after expiry/moderation", { skip: !process.env.FOREVER_TEST_MONGODB_URI }, async t => {
  await mongoose.connect(process.env.FOREVER_TEST_MONGODB_URI!, { dbName: `forever_board_test_${randomUUID().replace(/-/g, "")}` });
  try {
    await Promise.all([ForeverCharacter.init(), ForeverGuild.init(), ForeverWorker.init(), Cache.init(), CacheRefreshLease.init()]);
    const guild = await ForeverGuild.create({ region: "eu", slug: "test-guild", name: "Test Guild", status: "approved" });
    await ForeverWorker.create({ _id: "armory" });
    const base = { region: "eu", status: "tracked", source: "guild", race: "Human", className: "Mage", faction: "Alliance", ruleset: "PvP",
      guild: { region: "eu", slug: guild.slug, name: guild.name }, history: [{ level: 1, observedAt: new Date() }] };
    await ForeverCharacter.insertMany(Array.from({ length: 120 }, (_, index) => ({ ...base, slug: `member-${index}`, name: `Member ${index}`,
      level: 60 - Math.floor(index / 4), lastLevelAt: new Date(1000 * index), source: index === 0 ? "admin" : "guild" })));
    let characterReads = 0;
    mongoose.set("debug", (collection, method) => { if (collection === "forever_characters" && ["find", "aggregate", "distinct", "countDocuments"].includes(method)) characterReads++; });
    const boards = await Promise.all(Array.from({ length: 12 }, (_, i) => leaderboard({ page: i % 3 + 1 })));
    assert.equal(characterReads, 2, "one projected population scan and pending count, shared by concurrent cold requests");
    assert.equal(new Set(boards.map(board => board.generatedAt)).size, 1);
    assert.deepEqual(boards.slice(0, 3).flatMap(board => board.characters.map(character => character.rank)), Array.from({ length: 120 }, (_, i) => i + 1));
    assert.equal(boards[0].characters[0].slug, "member-0");
    assert.ok(!JSON.stringify(boards).includes('"history"'));

    const before = characterReads;
    const filtered = await leaderboard({ search: "member 99", guild: "Test Guild", faction: "Alliance" });
    assert.equal(filtered.total, 1); assert.equal(filtered.totalRanked, 120);
    assert.equal(filtered.characters[0].rank, 100);
    assert.equal(filtered.statistics.averageLevel, 36);
    assert.equal((await leaderboard({ search: ".*" })).total, 0, "search is literal");
    await leaderboard({ page: 2 }); await leaderboard({ className: "Mage", ruleset: "PvP" });
    assert.equal(characterReads, before, "new pages and filter combinations do not query character documents");

    // Another API process can reuse the shared snapshot after dropping this process's L1.
    await stopForeverLeaderboard();
    assert.equal((await leaderboard({ page: 3 })).characters[0].rank, 101);
    assert.equal(characterReads, before);

    await setGuildVisibility(String(guild._id), true);
    const hidden = await leaderboard();
    assert.equal(hidden.total, 1); assert.equal(hidden.characters[0].slug, "member-0", "manual tracking survives guild hiding");
    await setGuildVisibility(String(guild._id), false);
    assert.equal((await leaderboard()).total, 120);
    const leader = await ForeverCharacter.findOne({ slug: "member-0" }).lean();
    await setCharacterStatus(String(leader!._id), "paused");
    assert.equal((await leaderboard()).characters[0].slug, "member-1");
    assert.equal((await leaderboard()).characters[0].rank, 1);

    await ForeverCharacter.updateOne({ slug: "member-119" }, { $set: { level: 60, lastLevelAt: new Date(0) } });
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    t.mock.timers.tick(31_000);
    const fresh = await leaderboard();
    assert.equal(fresh.characters[0].slug, "member-119", "worker changes appear when the 30-second snapshot expires");
    assert.equal(fresh.characters[0].rank, 1);
    assert.ok(Date.now() - Date.parse(fresh.generatedAt) < 30_000);
    t.mock.timers.reset();
  } finally {
    t.mock.timers.reset(); mongoose.set("debug", false);
    await stopForeverLeaderboard(); await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
