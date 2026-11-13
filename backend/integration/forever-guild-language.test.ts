import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import OpenAI from "openai";
import { ForeverCharacter, ForeverGuild } from "../src/features/forever/forever.models";
import { GuildLanguageWorker, queueGuildLanguageAssessments } from "../src/features/forever/forever-guild-language.worker";
import { adminOverview, guildDetail } from "../src/features/forever/forever.service";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("all-guild assessments survive duplicate claims, preserve partial results and rescore changed names", { skip: !uri }, async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";
  await mongoose.connect(uri!, { dbName: "forever_language_test_" + randomUUID().replace(/-/g, ""), serverSelectionTimeoutMS: 5000 });
  try {
    const guild = await ForeverGuild.create({ region: "eu", slug: "one", name: "One", status: "rejected", hidden: true,
      roster: [{ name: "Ää One", slug: "aa-one", region: "eu" }, { slug: "two-names", region: "eu" }] });
    await ForeverGuild.create({ region: "us", slug: "two", name: "Two", status: "proposed" });
    await ForeverCharacter.create({ region: "us", slug: "some-member", name: "Some Member", source: "admin",
      guild: { name: "Two", slug: "two", region: "us" } });
    await ForeverGuild.create({ region: "eu", slug: "three", name: "Three", status: "paused" });
    let failDecision = true;
    const calls: { guildName: string; characterNames: string[] }[] = [];
    const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body)), input = JSON.parse(body.input[0].content);
      calls.push(input);
      if (String(url).endsWith("/decisions")) {
        if (failDecision && input.guildName === "One") return Response.json({ error: {} }, { status: 429 });
        return Response.json({ answers: [{ type: "choice", name: "finnish", choice: true, confidence: 0.7,
          probabilities: [{ value: true, probability: 0.8 }, { value: false, probability: 0.2 }] }] });
      }
      return Response.json({ object: "response", status: "completed", output: [{ type: "message", content: [
        { type: "output_text", text: body.text ? '{"percent":90}' : "0" },
      ] }] });
    } });
    const worker = new GuildLanguageWorker();
    const drain = () => Promise.all(Array.from({ length: 4 }, () => worker.tick(client)));
    assert.deepEqual(await queueGuildLanguageAssessments(), { queued: 3 });
    assert.deepEqual(await queueGuildLanguageAssessments(), { queued: 0 });
    await drain();
    assert.equal(calls.length, 9);
    assert.deepEqual(calls.find(x => x.guildName === "One")?.characterNames, ["two names", "Ää One"]);
    assert.deepEqual(calls.find(x => x.guildName === "Two")?.characterNames, ["Some Member"]);
    assert.deepEqual(calls.find(x => x.guildName === "Three")?.characterNames, []);
    const result = await guildDetail(String(guild._id));
    assert.equal(result.languageAssessment?.plain, 0);
    assert.equal(result.languageAssessment?.decision, null);
    assert.equal(result.languageAssessment?.fingerprint, undefined);
    assert.equal(result.status, "rejected");
    assert.equal(result.hidden, true);
    const overview = await adminOverview({ guildStatus: "rejected" });
    assert.equal(overview.languagePending, 0);
    assert.equal(overview.guilds.length, 1);
    assert.equal(overview.guilds[0].languageAssessment.structured, 90);
    failDecision = false;
    await queueGuildLanguageAssessments(); await drain();
    assert.equal(calls.length, 10);
    assert.equal((await guildDetail(String(guild._id))).languageAssessment?.decision?.percent, 80);
    await ForeverGuild.updateOne({ _id: guild._id }, { $set: { name: "Changed" } });
    await queueGuildLanguageAssessments(); await drain();
    assert.equal(calls.length, 13);
    assert.equal(calls.filter(x => x.guildName === "Changed").length, 3);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
