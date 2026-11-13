import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import OpenAI from "openai";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { NamegameBatch, NamegameWorker } from "../src/features/forever/forever-namegame.worker";
import { namegameLeaderboard } from "../src/features/forever/forever-namegame";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("Namegame scores eligible identities once, recovers the same response after restart and respects current moderation", { skip: !uri }, async () => {
  await mongoose.connect(uri!, { dbName: "forever_namegame_test_" + randomUUID().replace(/-/g, ""), serverSelectionTimeoutMS: 5000 });
  try {
    await Promise.all([ForeverGuild.init(), ForeverCharacter.init(), ForeverWorker.init(), NamegameBatch.init()]);
    const region = "eu", guild = { region, slug: "approved", name: "Guild Context" };
    const roster = ["member", "paused", "moved", "unfetched"].map(slug => ({ region, slug, name: slug === "unfetched" ? "Ää Öö" : slug }));
    await ForeverGuild.create({ ...guild, status: "approved", roster });
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
    assert.deepEqual((await namegameLeaderboard({ category: "straight" })).names, [{ name: "individual", category: "straight", score: 0 }]);
    await ForeverGuild.updateOne({ slug: "approved" }, { $set: { hidden: true } });
    assert.deepEqual((await namegameLeaderboard({})).names.map(x => x.name), ["legacy", "individual"]);
    await ForeverGuild.updateOne({ slug: "approved" }, { $set: { hidden: false, status: "paused" } });
    assert.equal((await namegameLeaderboard({})).total, 2);
    await ForeverGuild.updateOne({ slug: "approved" }, { $set: { status: "approved" } });
    await ForeverCharacter.updateOne({ slug: "individual" }, { $set: { status: "rejected" } });
    await ready(); await new NamegameWorker().tick(client);
    assert.equal(submissions, 1);
    assert.equal((await namegameLeaderboard({})).total, 3);

    const tied = Array.from({ length: 96 }, (_, i) => ({ region, slug: "tie-" + i, status: "tracked", source: "admin",
      nameRating: { name: "Same Name", category: "sound", score: 92 } }));
    await ForeverCharacter.insertMany(tied);
    const second = await namegameLeaderboard({ category: "sound", page: "2" });
    assert.equal(second.total, 99);
    assert.deepEqual(second.names.map(x => x.name), ["legacy", "member", "Ää Öö"]);
    await assert.rejects(namegameLeaderboard({ category: { $ne: null } }));
    await assert.rejects(namegameLeaderboard({ page: "-1" }));

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
  } finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});
