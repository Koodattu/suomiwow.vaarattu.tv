import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import OpenAI from "openai";
import { ForeverCharacter, ForeverGuild } from "../src/features/forever/forever.models";
import { GuildLanguageWorker, queueGuildLanguageAssessments } from "../src/features/forever/forever-guild-language.worker";
import { adminOverview, guildDetail } from "../src/features/forever/forever.service";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("admin guild language sorting applies before pagination, preserves filters and puts missing scores last", { skip: !uri }, async () => {
  await mongoose.connect(uri!, { dbName: "forever_language_sort_test_" + randomUUID().replace(/-/g, ""), serverSelectionTimeoutMS: 5000 });
  try {
    const decision = (percent: number) => ({ percent, yes: percent >= 50, confidence: "high" as const });
    const fixtures = Array.from({ length: 55 }, (_, index) => {
      const percent = index === 54 ? 100 : index;
      return { region: "eu", slug: `match-${index}`, name: `Match ${String(index).padStart(2, "0")}`, status: "pending" as const,
        languageAssessment: { structured: percent, decision: decision(100 - percent) } };
    });
    const guilds = await ForeverGuild.create([
      ...fixtures,
      { region: "eu", slug: "missing", name: "Match missing", status: "pending" },
      { region: "eu", slug: "null", name: "Match null", status: "pending", languageAssessment: { structured: null, decision: null } },
      { region: "eu", slug: "structured-only", name: "Match partial", status: "pending", languageAssessment: { structured: 50, decision: null } },
      { region: "eu", slug: "decision-only", name: "Match partial", status: "pending", languageAssessment: { structured: null, decision: decision(50) } },
      { ...fixtures[50], slug: "tie", name: "Match 50" },
    ]);
    await ForeverGuild.create([
      { ...fixtures[54], slug: "rejected", status: "rejected" },
      { ...fixtures[54], slug: "other", name: "Other" },
    ]);
    const filters = { guildSearch: "Match", guildStatus: "pending" };
    for (const field of ["structured", "decision"] as const) {
      for (const direction of ["asc", "desc"] as const) {
        const score = (guild: typeof guilds[number]) => field === "structured" ? guild.languageAssessment?.structured : guild.languageAssessment?.decision?.percent;
        const expected = [...guilds].sort((left, right) => {
          const a = score(left), b = score(right);
          if (a == null && b != null) return 1;
          if (a != null && b == null) return -1;
          const difference = ((a ?? 0) - (b ?? 0)) * (direction === "asc" ? 1 : -1);
          return difference || left.name.localeCompare(right.name) || String(left._id).localeCompare(String(right._id));
        });
        const pages = await Promise.all([1, 2].map(guildPage => adminOverview({ ...filters, guildPage, guildSort: `${field}-${direction}` })));
        assert.equal(pages[0].totalGuilds, guilds.length);
        assert.equal(pages[0].guilds.length, 50);
        const actual = pages.flatMap(page => page.guilds);
        assert.deepEqual(actual.map(guild => String(guild._id)), expected.map(guild => String(guild._id)), `${field}-${direction}`);
        assert.ok(actual.every(guild => !("languageSort" in guild)));
      }
    }
    const defaultOrder = await adminOverview(filters), nameOrder = await adminOverview({ ...filters, guildSort: "name" });
    assert.deepEqual(defaultOrder.guilds.map(guild => String(guild._id)), nameOrder.guilds.map(guild => String(guild._id)));
    assert.equal(defaultOrder.guilds[0].name, "Match 00");
    await assert.rejects(adminOverview({ guildSort: "unsupported" }), /invalid_input/);
    await assert.rejects(adminOverview({ guildSort: { structured: -1 } }), /invalid_input/);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("the worker automatically assesses every guild, resumes missing results and picks up new guilds and first rosters", { skip: !uri }, async () => {
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
        { type: "output_text", text: '{"percent":0}' },
      ] }] });
    } });
    const worker = new GuildLanguageWorker();
    const drain = () => Promise.all(Array.from({ length: 4 }, () => worker.tick(client)));
    assert.equal((await adminOverview({})).languagePending, 3);
    await drain();
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.find(x => x.guildName === "One")?.characterNames, ["two names", "Ää One"]);
    assert.deepEqual(calls.find(x => x.guildName === "Two")?.characterNames, ["Some Member"]);
    assert.deepEqual(calls.find(x => x.guildName === "Three")?.characterNames, []);
    const result = await guildDetail(String(guild._id));
    assert.equal(result.languageAssessment?.structured, 0);
    assert.equal(result.languageAssessment?.decision, null);
    assert.equal(result.languageAssessment?.fingerprint, undefined);
    assert.equal(result.status, "rejected");
    assert.equal(result.hidden, true);
    const overview = await adminOverview({ guildStatus: "rejected" });
    assert.equal(overview.languagePending, 0);
    assert.equal(overview.guilds.length, 1);
    assert.equal(overview.guilds[0].languageAssessment.structured, 0);
    await drain();
    assert.equal(calls.length, 6, "idle workers respect the retry delay and skip complete results");
    failDecision = false;
    const retry = await ForeverGuild.findById(guild._id).select("languageDueAt").lean();
    assert.ok(retry?.languageDueAt && retry.languageDueAt > new Date());
    await ForeverGuild.updateOne({ _id: guild._id }, { $set: { languageDueAt: new Date(0) } });
    await drain();
    assert.equal(calls.length, 7);
    assert.equal((await guildDetail(String(guild._id))).languageAssessment?.decision?.percent, 80);
    await ForeverGuild.updateOne({ _id: guild._id }, { $set: { name: "Changed" } });
    assert.deepEqual(await queueGuildLanguageAssessments(), { queued: 3 });
    assert.deepEqual(await queueGuildLanguageAssessments(), { queued: 0 });
    await drain();
    assert.equal(calls.length, 9);
    assert.equal(calls.filter(x => x.guildName === "Changed").length, 2);
    await ForeverGuild.create({ region: "eu", slug: "four", name: "Four", status: "approved" });
    await ForeverGuild.updateOne({ slug: "two" }, { $set: { lastFetchedAt: new Date(),
      roster: [{ region: "us", slug: "roster-only", name: "Roster Only" }] } });
    assert.equal((await adminOverview({})).languagePending, 2);
    await drain();
    assert.equal(calls.length, 13);
    assert.equal(calls.filter(x => x.guildName === "Four").length, 2);
    assert.deepEqual(calls.filter(x => x.guildName === "Two").pop()?.characterNames, ["Roster Only"]);
    // A pre-deployment assessment can still contain the retired plain-text result.
    await ForeverGuild.collection.updateOne({ _id: guild._id }, { $set: { "languageAssessment.plain": 75 } });
    assert.ok(!("plain" in (await guildDetail(String(guild._id))).languageAssessment!));
    assert.ok(!("plain" in (await adminOverview({ guildStatus: "rejected" })).guilds[0].languageAssessment));
    await queueGuildLanguageAssessments(); await drain();
    assert.equal(calls.length, 13, "already-paid assessments with identical evidence require no calls");
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
