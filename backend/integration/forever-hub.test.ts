import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import { foreverHub, searchForeverHub } from "../src/features/forever/forever-hub";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { ForeverLeaderboardCache, ForeverLeaderboardLease } from "../src/features/forever/forever-leaderboard.models";
import { stopForeverLeaderboard } from "../src/features/forever/forever-leaderboard";
import { stopForeverPageCaches } from "../src/features/forever/forever-cache-warmer";

test("hub totals, highlights and name searches respect public visibility", { skip: !process.env.FOREVER_TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.FOREVER_TEST_MONGODB_URI!, { dbName: `forever_hub_test_${randomUUID().replace(/-/g, "")}` });
  try {
    await Promise.all([ForeverCharacter.init(), ForeverGuild.init(), ForeverWorker.init(), ForeverLeaderboardCache.init(), ForeverLeaderboardLease.init()]);
    const now = Date.now();
    const history = [{ level: 58, observedAt: new Date(now - 3600_000) }, { level: 60, observedAt: new Date(now - 1000) }];
    const base = { region: "eu", status: "tracked", source: "admin", level: 60, history };
    const hidden = { name: "Yö Hidden", region: "eu", slug: "yo-hidden" };
    await ForeverGuild.create([{ ...hidden, status: "approved", hidden: true }, { name: "Yö", region: "eu", slug: "yo", status: "approved" }]);
    await ForeverCharacter.insertMany([
      { ...base, name: "Yö", slug: "yo", nameRating: { name: "Yö", category: "sound", score: 75 } },
      { ...base, name: "Yö Kuu", slug: "yo-kuu", history: history.slice(1) },
      { ...base, name: "Keskiyö", slug: "keskiyo", level: 58, history: history.slice(0, 1) },
      { ...base, name: "Yö Hidden", slug: "hidden", guild: hidden, source: "guild" },
      { ...base, name: "Yö Paused", slug: "paused", status: "paused" },
      { ...base, name: "Yö US", slug: "us", region: "us" },
    ]);
    const hub = await foreverHub();
    assert.deepEqual([hub.characters, hub.guilds, hub.levelsGained24h, hub.featuredName], [3, 1, 2, "Yö"]);
    assert.deepEqual(hub.milestones.map(row => row.slug), ["yo"]);
    const hits = await searchForeverHub("  YO\u0308  ");
    assert.deepEqual(hits.characters.map(row => row.name), ["Yö", "Yö Kuu", "Keskiyö"]);
    assert.deepEqual(hits.guilds.map(row => row.name), ["Yö"]);
    assert.deepEqual(await searchForeverHub(".*"), { characters: [], guilds: [] });
    await assert.rejects(searchForeverHub(["Yö"]), { code: "invalid_input" });
  } finally {
    await Promise.all([stopForeverPageCaches(), stopForeverLeaderboard()]);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
