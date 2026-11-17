import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import OpenAI from "openai";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { GuildLanguageWorker, queueGuildLanguageAssessments } from "../src/features/forever/forever-guild-language.worker";
import { adminOverview, guildDetail, setGuildStatus, setGuildVisibility } from "../src/features/forever/forever.service";
import { GUILD_LANGUAGE_MODEL, GUILD_LANGUAGE_VERSION } from "../src/features/forever/forever-guild-language";
import { ForeverRunner } from "../src/features/forever/forever.worker";
import { visibleForeverCharacters } from "../src/features/forever/forever-visibility";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("admin LLM decision history is newest first across pages and retains hidden and manually overridden guilds", { skip: !uri }, async () => {
  await mongoose.connect(uri!, { dbName: "forever_language_history_test_" + randomUUID().replace(/-/g, ""), serverSelectionTimeoutMS: 5000 });
  try {
    const fixtures = Array.from({ length: 55 }, (_, index) => {
      const action = index % 2 === 0 ? "approved" as const : "rejected" as const;
      return { region: "eu", slug: `history-${index}`, name: `History ${String(index).padStart(2, "0")}`, status: action,
        hidden: action === "rejected", autoReview: { action, reviewedAt: new Date(Date.UTC(2026, 10, 1, 0, index)), structured: 90, decision: 90 } };
    });
    // Identical timestamps and names must still paginate deterministically.
    const guilds = await ForeverGuild.create([...fixtures, { ...fixtures[54], slug: "history-tie" }]);
    const overridden = guilds[53];
    await ForeverGuild.updateOne({ _id: overridden._id }, { $set: { status: "approved", hidden: false, manualReviewAt: new Date() } });
    // Later assessments and updates must not move an old moderation decision to the top.
    await ForeverGuild.updateOne({ _id: guilds[0]._id }, { $set: { "languageAssessment.assessedAt": new Date() } });
    await ForeverGuild.create([
      { region: "eu", slug: "manual", name: "History manual", status: "approved", manualReviewAt: new Date() },
      { region: "eu", slug: "pending", name: "History pending", status: "pending" },
      { region: "eu", slug: "null-review", name: "History null", status: "rejected", autoReview: null },
      { ...fixtures[54], slug: "other", name: "Other" },
    ]);
    const expected = [...guilds].sort((a, b) => b.autoReview!.reviewedAt.getTime() - a.autoReview!.reviewedAt.getTime()
      || a.name.localeCompare(b.name) || String(a._id).localeCompare(String(b._id)));
    const ids = (values: { _id: unknown }[]) => values.map(value => String(value._id));
    for (const guildStatus of ["auto-reviewed", "auto-approved", "auto-rejected"]) {
      const matching = expected.filter(guild => guildStatus === "auto-reviewed" || `auto-${guild.autoReview!.action}` === guildStatus);
      const pages = await Promise.all([1, 2].map(guildPage => adminOverview({ guildStatus, guildSearch: "History", guildPage })));
      assert.equal(pages[0].totalGuilds, matching.length);
      assert.deepEqual(ids(pages.flatMap(page => page.guilds)), ids(matching));
    }
    const explicit = await adminOverview({ guildStatus: "auto-reviewed", guildSearch: "History", guildSort: "reviewed-desc" });
    assert.deepEqual(ids(explicit.guilds), ids(expected.slice(0, 50)));
    const savedOverride = explicit.guilds.find(guild => String(guild._id) === String(overridden._id));
    assert.equal(savedOverride.status, "approved");
    assert.equal(savedOverride.autoReview.action, "rejected");
    assert.ok(explicit.guilds.some(guild => guild.hidden && guild.autoReview.action === "rejected"));
    const alphabetical = await adminOverview({ guildStatus: "auto-reviewed", guildSearch: "History", guildSort: "name" });
    assert.equal(alphabetical.guilds[0].slug, "history-0");
    const allPages = await Promise.all([1, 2].map(guildPage => adminOverview({ guildSort: "reviewed-desc", guildPage })));
    const all = allPages.flatMap(page => page.guilds);
    assert.ok(all.slice(0, 57).every(guild => guild.autoReview));
    assert.ok(all.slice(57).every(guild => !guild.autoReview));
    assert.equal((await adminOverview({ guildStatus: "auto-reviewed", guildSearch: "absent" })).totalGuilds, 0);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

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


test("guild automation and review history (isolated replica-set database)", { skip: !uri }, async t => {
  await mongoose.connect(uri!, { dbName: "forever_auto_review_test_" + randomUUID().replace(/-/g, ""), serverSelectionTimeoutMS: 5000 });
  let structured = 95, decision = 96, failDecision = false, calls = 0;
  let duringScoring: (() => Promise<unknown>) | undefined;
  const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async url => {
    calls++;
    if (String(url).endsWith("/decisions")) {
      if (failDecision) return Response.json({ error: {} }, { status: 429 });
      return Response.json({ answers: [{ type: "choice", name: "finnish", choice: decision > 50, confidence: 0.99,
        probabilities: [{ value: true, probability: decision / 100 }, { value: false, probability: 1 - decision / 100 }] }] });
    }
    await duringScoring?.();
    return Response.json({ object: "response", status: "completed", output: [{ type: "message", content: [
      { type: "output_text", text: JSON.stringify({ percent: structured }) },
    ] }] });
  } });
  const worker = new GuildLanguageWorker();
  const roster = [{ region: "eu", slug: "member", name: "Member" }];
  const create = (extra = {}) => ForeverGuild.create({ region: "eu", slug: "guild", name: "Guild", status: "pending",
    nextFetchAt: new Date(Date.now() + 86_400_000), lastFetchedAt: new Date(), roster, ...extra });
  t.beforeEach(async () => {
    await ForeverCharacter.deleteMany({}); await ForeverGuild.deleteMany({}); await ForeverWorker.deleteMany({});
    await ForeverWorker.create({ _id: "armory", nextRequestAt: new Date(0) });
    structured = 95; decision = 96; failDecision = false; calls = 0; duringScoring = undefined;
  });
  try {
    await t.test("profile-only and empty-roster scores cannot approve or reject a guild", async () => {
      for (const score of [95, 5]) {
        structured = decision = score;
        for (const extra of [{ lastFetchedAt: null, roster: [] }, { lastFetchedAt: null }, { roster: [] }]) {
          const guild = await create({ slug: randomUUID(), ...extra });
          await worker.tick(client);
          const saved = (await ForeverGuild.findById(guild._id).lean())!;
          assert.equal(saved.status, "pending"); assert.equal(saved.hidden, false); assert.equal(saved.autoReview, undefined);
          assert.equal(saved.languageAssessment?.structured, score);
        }
      }
    });
    await t.test("XOXO stays pending when one Finnish profile is followed by a mixed full roster", async () => {
      const guild = await create({ name: "XOXO", slug: "xoxo", lastFetchedAt: null, roster: [] });
      await ForeverCharacter.create({ region: "eu", slug: "soturi-perkele", name: "Soturi Perkele", source: "admin",
        guild: { region: "eu", slug: "xoxo", name: "XOXO" } });
      structured = 90; decision = 91;
      await worker.tick(client);
      const initial = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(initial.status, "pending"); assert.equal(initial.autoReview, undefined);
      assert.equal(initial.languageAssessment?.source, "profiles"); assert.equal(initial.languageAssessment?.nameCount, 1);
      structured = 20; decision = 33;
      await ForeverGuild.updateOne({ _id: guild._id }, { $set: { lastFetchedAt: new Date(), roster: [
        { region: "eu", slug: "soturi-perkele", name: "Soturi Perkele" },
        ...Array.from({ length: 89 }, (_, i) => ({ region: "eu", slug: `member-${i}`, name: `Member ${i}` })),
      ] } });
      await worker.tick(client); await worker.tick(client);
      const saved = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(calls, 4); assert.equal(saved.status, "pending"); assert.equal(saved.autoReview, undefined);
      assert.equal(saved.languageAssessment?.source, "roster"); assert.equal(saved.languageAssessment?.nameCount, 90);
      assert.equal(saved.languageAssessment?.structured, 20); assert.equal(saved.languageAssessment?.decision?.percent, 33);
    });
    await t.test("a roster arriving during scoring cannot turn profile scores into an approval", async () => {
      const guild = await create({ lastFetchedAt: null, roster: [] });
      duringScoring = () => ForeverGuild.updateOne({ _id: guild._id }, { $set: { lastFetchedAt: new Date(), roster } }).exec();
      await worker.tick(client);
      assert.equal((await ForeverGuild.findById(guild._id).lean())?.status, "pending");
      duringScoring = undefined;
      await worker.tick(client);
      assert.equal((await ForeverGuild.findById(guild._id).lean())?.status, "approved");
      assert.equal(calls, 4);
    });
    await t.test("automatic decisions preserve their exact evidence after later assessments", async () => {
      const guild = await create(); await worker.tick(client);
      const approved = await guildDetail(String(guild._id));
      assert.deepEqual(approved.autoReview?.evidence, { guildName: "Guild", characterNames: ["Member"] });
      assert.equal(approved.autoReview?.model, GUILD_LANGUAGE_MODEL); assert.equal(approved.autoReview?.version, GUILD_LANGUAGE_VERSION);
      assert.equal(approved.autoReview?.rosterFetchedAt?.getTime(), guild.lastFetchedAt!.getTime());
      const saved = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(approved.autoReview?.fingerprint, saved.languageAssessment?.fingerprint);
      assert.equal((await adminOverview({ guildStatus: "auto-approved" })).guilds[0].autoReview.evidence, undefined);
      structured = decision = 5;
      await ForeverGuild.updateOne({ _id: guild._id }, { $set: { name: "Changed", roster: [], languageDueAt: new Date(0) } });
      await worker.tick(client);
      const changed = await guildDetail(String(guild._id));
      assert.equal(changed.languageAssessment?.structured, 5);
      assert.deepEqual(changed.autoReview, approved.autoReview);
    });
    await t.test("approval queues a fresh roster and the existing worker tracks its members", async () => {
      const guild = await create({ status: "proposed" });
      await Promise.all([worker.tick(client), worker.tick(client)]);
      const saved = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(calls, 2, "concurrent workers score the guild once");
      assert.equal(saved.status, "approved"); assert.equal(saved.hidden, false);
      assert.ok(saved.nextFetchAt! <= new Date());
      assert.equal(saved.autoReview?.action, "approved");
      assert.equal(saved.autoReview?.structured, 95); assert.equal(saved.autoReview?.decision, 96);
      const runner = new ForeverRunner({ character: async () => { throw new Error("unexpected profile fetch"); },
        roster: async () => [{ region: "eu", slug: "new-member", name: "New Member", level: 20,
          className: "Mage", race: "Human", faction: "Alliance", isOutdated: false }] });
      await runner.tick();
      assert.equal((await ForeverCharacter.findOne({ slug: "new-member" }).lean())?.status, "tracked");
      assert.equal((await adminOverview({ guildStatus: "auto-approved" })).totalGuilds, 1);
      assert.equal((await adminOverview({ guildStatus: "auto-rejected" })).totalGuilds, 0);
    });
    await t.test("rejection hides guild imports, releases coverage and invalidates the leaderboard", async () => {
      structured = 12; decision = 9;
      const guild = await create();
      await ForeverCharacter.create({ region: "eu", slug: "member", source: "guild", status: "tracked", level: 20,
        guild: { region: "eu", slug: "guild", name: "Guild" }, rosterGuildSlug: "guild",
        rosterCoverageUntil: new Date(Date.now() + 86_400_000), nextFetchAt: new Date(Date.now() + 86_400_000) });
      await worker.tick(client);
      const saved = await guildDetail(String(guild._id));
      assert.equal(saved.status, "rejected"); assert.equal(saved.hidden, true);
      assert.equal(saved.autoReview?.action, "rejected");
      assert.deepEqual(saved.autoReview?.evidence, { guildName: "Guild", characterNames: ["Member"] });
      const member = (await ForeverCharacter.findOne({ slug: "member" }).lean())!;
      assert.equal(member.rosterCoverageUntil, undefined); assert.ok(member.nextFetchAt! <= new Date());
      assert.equal(await ForeverCharacter.countDocuments(await visibleForeverCharacters()), 0);
      assert.equal((await ForeverWorker.findById("armory").lean())?.leaderboardRevision, 1);
      const filtered = await adminOverview({ guildStatus: "auto-rejected", guildSearch: "Guild" });
      assert.equal(filtered.totalGuilds, 1); assert.equal(filtered.guilds[0].autoReview.structured, 12);
      assert.equal((await adminOverview({ guildStatus: "auto-rejected", guildSearch: "absent" })).totalGuilds, 0);
      await setGuildVisibility(String(guild._id), false); await setGuildStatus(String(guild._id), "approved");
      await ForeverGuild.updateOne({ _id: guild._id }, { $set: { languageDueAt: new Date(0) } });
      await worker.tick(client);
      const overridden = (await adminOverview({ guildStatus: "auto-rejected" })).guilds[0];
      assert.equal(overridden.status, "approved"); assert.equal(overridden.hidden, false);
      assert.equal(overridden.autoReview.reviewedAt.getTime(), saved.autoReview!.reviewedAt.getTime());
      assert.equal(calls, 2, "unchanged evidence is reused after a manual override");
    });
    await t.test("boundaries and disagreement stay pending without repeatedly scoring", async () => {
      for (const [a, b] of [[85, 99], [99, 85], [30, 0], [0, 30], [99, 0], [0, 99], [50, 50]]) {
        structured = a; decision = b;
        const guild = await create({ slug: `guild-${a}-${b}` });
        await worker.tick(client);
        const saved = await ForeverGuild.findById(guild._id).lean();
        assert.equal(saved?.status, "pending"); assert.equal(saved?.hidden, false); assert.equal(saved?.autoReview, undefined);
      }
      const completedCalls = calls;
      await worker.tick(client); assert.equal(calls, completedCalls);
    });
    await t.test("partial scores wait for retry, then apply the completed assessment once", async () => {
      failDecision = true;
      const guild = await create(); await worker.tick(client);
      const partial = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(partial.status, "pending"); assert.equal(partial.autoReview, undefined);
      assert.ok(partial.languageDueAt! > new Date());
      await worker.tick(client); assert.equal(calls, 2);
      failDecision = false;
      await ForeverGuild.updateOne({ _id: guild._id }, { $set: { languageDueAt: new Date(0) } });
      await worker.tick(client); await worker.tick(client);
      assert.equal(calls, 3); assert.equal((await ForeverGuild.findById(guild._id).lean())?.status, "approved");
    });
    await t.test("existing complete assessments are automatically reviewed without new API calls", async () => {
      const assessedAt = new Date("2026-01-01");
      const fingerprint = createHash("sha256").update(JSON.stringify([GUILD_LANGUAGE_VERSION, GUILD_LANGUAGE_MODEL,
        { guildName: "Guild", characterNames: ["Member"] }])).digest("hex");
      const guild = await create({ languageAssessment: { fingerprint, source: "roster", assessedAt, nameCount: 1,
        structured: 98, decision: { percent: 99, yes: true, confidence: "high" } } });
      await worker.tick(client); await worker.tick(client);
      const saved = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(calls, 0); assert.equal(saved.status, "approved");
      assert.equal(saved.languageAssessment?.assessedAt?.getTime(), assessedAt.getTime());
      assert.equal(saved.autoReview?.structured, 98);
    });
    await t.test("manual moderation states and in-flight manual decisions are preserved", async () => {
      for (const extra of [{ status: "approved" }, { status: "paused" }, { status: "rejected" }, { hidden: true }, { manualReviewAt: new Date() }]) {
        const guild = await create({ slug: randomUUID(), ...extra });
        await worker.tick(client);
        const saved = (await ForeverGuild.findById(guild._id).lean())!;
        assert.equal(saved.status, guild.status); assert.equal(saved.hidden, guild.hidden); assert.equal(saved.autoReview, undefined);
      }
      const guild = await create();
      duringScoring = async () => { await setGuildVisibility(String(guild._id), true); await setGuildVisibility(String(guild._id), false); };
      await worker.tick(client);
      const saved = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(saved.status, "pending"); assert.equal(saved.hidden, false); assert.equal(saved.autoReview, undefined);
      assert.equal(saved.languageAssessment?.structured, 95);
    });
    await t.test("a lost lease cannot publish scores or moderation", async () => {
      const guild = await create();
      duringScoring = () => ForeverGuild.updateOne({ _id: guild._id }, { $set: { languageLease: "replacement" } }).exec();
      await worker.tick(client);
      const saved = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(saved.status, "pending"); assert.equal(saved.autoReview, undefined); assert.equal(saved.languageAssessment, undefined);
    });
    await t.test("approval preserves an existing fetch backoff", async () => {
      const nextFetchAt = new Date(Date.now() + 86_400_000);
      const guild = await create({ failures: 2, nextFetchAt }); await worker.tick(client);
      const saved = (await ForeverGuild.findById(guild._id).lean())!;
      assert.equal(saved.status, "approved"); assert.equal(saved.nextFetchAt!.getTime(), nextFetchAt.getTime());
    });
  } finally {
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
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
