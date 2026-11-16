import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import OpenAI from "openai";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { NamegameBatch, NamegameWorker } from "../src/features/forever/forever-namegame.worker";
import { namegameLeaderboard, namegameOverview } from "../src/features/forever/forever-namegame";
import { invalidateForeverLeaderboard } from "../src/features/forever/forever-leaderboard";
import { setGuildVisibility, setGuildStatus, setCharacterStatus } from "../src/features/forever/forever.service";
import { ForeverLeaderboardCache, ForeverLeaderboardLease } from "../src/features/forever/forever-leaderboard.models";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("Namegame scores eligible identities once and caches browsing without bypassing moderation", { skip: !uri }, async t => {
  await mongoose.connect(uri!, { dbName: "forever_namegame_test_" + randomUUID().replace(/-/g, ""), serverSelectionTimeoutMS: 5000 });
  try {
    await Promise.all([ForeverGuild.init(), ForeverCharacter.init(), ForeverWorker.init(), NamegameBatch.init(), ForeverLeaderboardCache.init(), ForeverLeaderboardLease.init()]);
    const region = "eu", guild = { region, slug: "approved", name: "Guild Context" };
    const roster = ["member", "paused", "moved", "unfetched"].map(slug => ({ region, slug, name: slug === "unfetched" ? "Ää Öö" : slug }));
    const approved = await ForeverGuild.create({ ...guild, status: "approved", roster });
    await ForeverGuild.create({ region, slug: "pending", name: "Pending", status: "pending" });
    const character = (slug: string, extra: Record<string, unknown> = {}) => ForeverCharacter.create({
      region, slug, name: slug, status: "tracked", source: "guild", guild, ...extra,
    });
    await Promise.all([character("member"), character("paused", { status: "paused" }), character("departed"),
      character("unfetched", { name: null, guild: null }), character("moved", { guild: { region, slug: "pending" } }),
      character("member", { region: "us", guild: null }), character("individual", { independentlyTracked: true, guild: null }),
      character("legacy", { source: "seed", guild: null }), character("pending", { status: "pending", source: "seed" })]);
    const ready = () => ForeverWorker.updateOne({ _id: "namegame" }, { $set: { nextRequestAt: new Date(0) } }, { upsert: true });
    let submissions = 0, polls = 0;
    let generation: Record<string, { score: number; category: string }> = {};
    const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async (url, init) => {
      if (init?.method === "POST") {
        submissions++;
        const names: { slot: string; character_name: string; guild_name: string | null }[] = JSON.parse(JSON.parse(String(init.body)).input[0].content);
        assert.deepEqual(names.map(x => x.character_name).sort(), ["individual", "legacy", "member", "Ää Öö"]);
        assert.equal(names.find(x => x.character_name === "Ää Öö")?.guild_name, "Guild Context");
        generation = Object.fromEntries(names.map(x => [x.slot, { score: x.character_name === "individual" ? 0 : 92,
          category: x.character_name === "individual" ? "straight" : "sound" }]));
        return Response.json({ id: "resp_one", status: "queued" });
      }
      assert.ok(String(url).endsWith("/responses/resp_one"));
      if (++polls === 1) return Response.json({ id: "resp_one", status: "in_progress" });
      return Response.json({ object: "response", status: "completed", output: [{ type: "message",
        content: [{ type: "output_text", text: JSON.stringify(generation) }] }] });
    } });
    await ready();
    await Promise.all([new NamegameWorker().tick(client), new NamegameWorker().tick(client)]);
    assert.equal(submissions, 1);
    assert.equal(await NamegameBatch.countDocuments({ responseId: "resp_one" }), 1);
    for (let i = 0; i < 3; i++) { await ready(); await new NamegameWorker().tick(client); }
    assert.equal(submissions, 1);
    assert.equal(await NamegameBatch.countDocuments(), 0);
    const board = await namegameLeaderboard({});
    assert.deepEqual(board.names.map(x => x.name), ["legacy", "member", "Ää Öö", "individual"]);
    assert.equal(board.total, 4);
    assert.deepEqual((await namegameLeaderboard({ category: "straight" })).names, [{ name: "individual", category: "straight", score: 0, rank: 1 }]);
    await setGuildVisibility(String(approved._id), true);
    assert.deepEqual((await namegameLeaderboard({})).names.map(x => x.name), ["legacy", "individual"]);
    assert.equal((await namegameOverview()).total, 2, "overview also respects moderation of a warm snapshot");
    await setGuildVisibility(String(approved._id), false);
    await setGuildStatus(String(approved._id), "paused");
    assert.equal((await namegameLeaderboard({})).total, 2);
    await setGuildStatus(String(approved._id), "approved");
    const individual = await ForeverCharacter.findOne({ slug: "individual" }).lean();
    await setCharacterStatus(String(individual!._id), "rejected");
    await ready(); await new NamegameWorker().tick(client);
    assert.equal(submissions, 1);
    assert.equal((await namegameLeaderboard({})).total, 3);

    const tied = Array.from({ length: 96 }, (_, i) => ({ region, slug: "tie-" + i, status: "tracked", source: "admin",
      nameRating: { name: "Same Name", category: "sound", score: 92 } }));
    await ForeverCharacter.insertMany(tied);
    await invalidateForeverLeaderboard();
    const second = await namegameLeaderboard({ category: "sound", page: "3" });
    assert.equal(second.total, 99);
    assert.deepEqual(second.names.map(x => x.name), ["legacy", "member", "Ää Öö"]);
    await assert.rejects(namegameLeaderboard({ category: { $ne: null } }));
    await assert.rejects(namegameLeaderboard({ page: "-1" }));
    await assert.rejects(namegameLeaderboard({ search: { $ne: null } }));
    await assert.rejects(namegameLeaderboard({ search: "x".repeat(101) }));
    await assert.rejects(namegameLeaderboard({ sort: ["name"] }));

    const late = await character("late", { independentlyTracked: true });
    const rejected = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async () => Response.json(
      { error: { message: "Rate limited" } }, { status: 429 }) });
    await ready(); await new NamegameWorker().tick(rejected);
    assert.equal(await NamegameBatch.countDocuments(), 0);
    assert.equal((await ForeverCharacter.findById(late._id).select("+namegameBatch").lean())?.namegameBatch, undefined);
    let attempts = 0;
    const lostAck = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async () => { attempts++; throw new Error("Lost acknowledgement"); } });
    await ready(); await new NamegameWorker().tick(lostAck);
    await ready(); await new NamegameWorker().tick(lostAck);
    assert.equal(attempts, 1);
    assert.equal(await NamegameBatch.countDocuments({ error: "submission_unknown" }), 1);

    await ForeverCharacter.insertMany(Array.from({ length: 10_000 }, (_, i) => ({ region, slug: `browse-${i}`, status: "tracked", source: "admin",
      nameRating: { name: `Browse ${String(i).padStart(5, "0")}`, score: i % 101, category: i % 2 ? "wordplay" : "sound" } })));
    await invalidateForeverLeaderboard();
    let characterReads = 0, guildReads = 0;
    mongoose.set("debug", (collection, method) => {
      if (!["find", "aggregate", "countDocuments"].includes(method)) return;
      if (collection === "forever_characters") characterReads++;
      if (collection === "forever_guilds") guildReads++;
    });
    const start = performance.now();
    const boards = await Promise.all(Array.from({ length: 12 }, (_, i) => namegameLeaderboard({ page: String(i + 1) })));
    const coldMs = performance.now() - start;
    assert.equal(characterReads, 1, "concurrent cold pages share one projected character scan");
    assert.equal(guildReads, 2, "eligibility is built once for all concurrent pages");
    assert.equal(new Set(boards.map(board => board.generatedAt)).size, 1);
    assert.equal(new Set(boards.flatMap(board => board.names.map(name => name.rank))).size, 12 * 48);
    const warmStart = performance.now();
    const found = await namegameLeaderboard({ search: "BROWSE 000", category: "wordplay", sort: "name" });
    assert.equal(found.total, 50);
    assert.equal(found.names[0].name, "Browse 00001");
    assert.equal(found.names[found.names.length - 1]?.name, "Browse 00095");
    assert.equal((await namegameLeaderboard({ search: ".*" })).total, 0, "search is literal");
    assert.equal((await namegameLeaderboard({ search: "ää öö" })).names[0].name, "Ää Öö");
    assert.equal((await namegameLeaderboard({ sort: "score-asc" })).names[0].score, 0);
    assert.equal((await namegameLeaderboard({ page: "9999999", search: "Browse 000", category: "wordplay" })).page, 2);
    const overview = await namegameOverview();
    assert.equal(overview.boards.length, 9);
    assert.equal(overview.total, boards[0].total);
    assert.equal(overview.boards.slice(1).reduce((sum, board) => sum + board.total, 0), overview.total);
    assert.deepEqual(overview.boards[0].names, boards[0].names.slice(0, 5));
    const wordplay = await namegameLeaderboard({ category: "wordplay" });
    assert.deepEqual(overview.boards.find(board => board.category === "wordplay")?.names, wordplay.names.slice(0, 5));
    assert.deepEqual(wordplay.names.map(entry => entry.rank), Array.from({ length: 48 }, (_, i) => i + 1));
    assert.equal(overview.boards.find(board => board.category === "warcraft")?.total, 0);
    assert.deepEqual(overview.boards.find(board => board.category === "warcraft")?.names, []);
    assert.equal(characterReads, 1, "warm filters, sorts and pages never rescan characters");
    assert.equal(guildReads, 2, "warm filters, sorts and pages never rebuild roster eligibility");
    t.diagnostic(`10,099 names: 12 concurrent cold pages ${coldMs.toFixed(1)} ms; 8 warm queries including all category previews ${(performance.now() - warmStart).toFixed(1)} ms`);
    const cached = await ForeverLeaderboardCache.findOne({ key: /^forever:namegame:/ }).lean();
    assert.ok(cached);
    assert.ok(!JSON.stringify(cached.data).includes('"guild"'));
    mongoose.set("debug", false);
    await ForeverCharacter.updateOne({ slug: "browse-0" }, { $set: { "nameRating.name": "Fresh Score", "nameRating.score": 100 } });
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    t.mock.timers.tick(61_000);
    assert.equal((await namegameLeaderboard({ search: "Fresh Score" })).total, 1, "worker score changes appear after snapshot expiry");
  } finally { t.mock.timers.reset(); mongoose.set("debug", false); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
