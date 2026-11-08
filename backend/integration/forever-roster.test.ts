import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { ArmoryError, ForeverMember, ForeverProfile } from "../src/features/forever/forever-armory";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "../src/features/forever/forever.models";
import { ForeverRunner, initializeForever } from "../src/features/forever/forever.worker";
import { MINUTE, PROFILE_AUDIT_INTERVAL, ROSTER_COVERAGE, ROSTER_INTERVAL } from "../src/features/forever/forever-policy";
import { releaseRosterCoverage } from "../src/features/forever/forever-roster-sync";
import * as service from "../src/features/forever/forever.service";
import { seedForeverCharacters } from "../src/features/forever/forever-seed";
import { invalidateForeverLeaderboard, stopForeverLeaderboard } from "../src/features/forever/forever-leaderboard";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("roster-driven polling (isolated replica-set database)", { skip: !uri }, async t => {
  await mongoose.connect(uri!, { dbName: `forever_roster_test_${randomUUID().replace(/-/g, "")}`, serverSelectionTimeoutMS: 5000 });
  const guildIdentity = { region: "eu" as const, slug: "test-guild", name: "Test Guild" };
  const member = (slug: string, level = 20): ForeverMember => ({ region: "eu", slug, name: slug.replace(/-/g, " "),
    level, className: "Mage", race: "Human", faction: "Alliance", isOutdated: false });
  const profile = (slug: string, level = 20): ForeverProfile => ({ ...member(slug, level), race: "Human", faction: "Alliance",
    ruleset: "Normal", avatarUrl: null, sourceUpdatedAt: new Date(Date.now() - MINUTE), guild: guildIdentity });
  const guild = () => ForeverGuild.create({ ...guildIdentity, status: "approved", nextFetchAt: new Date(0), rosterPollingVersion: 1 });
  const tracked = (slug: string, extra: Record<string, unknown> = {}) => ForeverCharacter.create({ ...profile(slug),
    source: "guild", status: "tracked", nextFetchAt: new Date(0), lastFetchedAt: new Date(Date.now() - 10 * MINUTE),
    history: [{ level: 20, observedAt: new Date(Date.now() - 10 * MINUTE) }], lastLevelAt: new Date(Date.now() - 10 * MINUTE), ...extra });
  const ready = () => ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
  const dueGuild = () => ForeverGuild.updateOne(guildIdentity, { $set: { nextFetchAt: new Date(0) } });
  const run = async (roster: ForeverMember[], character = async (identity: { slug: string }) => profile(identity.slug)) => {
    await ready(); await new ForeverRunner({ roster: async () => roster, character }).tick();
  };
  try {
    await initializeForever();
    t.beforeEach(() => invalidateForeverLeaderboard());
    t.after(() => stopForeverLeaderboard());
    t.afterEach(async () => {
      await ForeverCharacter.deleteMany({}); await ForeverGuild.deleteMany({});
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0), failedJobs: [], consecutiveGuilds: 0 },
        $unset: { leaseToken: 1, leaseUntil: 1, errorCode: 1, failureWindowStartedAt: 1 } });
    });

    await t.test("one roster updates members in bulk ahead of the individual backlog, retains metadata and unique ranks", async () => {
      await guild();
      const old = await tracked("first-member", { lastFetchedAt: new Date(Date.now() - 11 * MINUTE) });
      const second = await tracked("second-member", { avatarUrl: "portrait", sourceUpdatedAt: new Date(Date.now() - 5 * MINUTE) });
      const failed = await tracked("failed-member", { failures: 3, nextFetchAt: new Date(Date.now() + 86400_000), errorCode: "upstream_error" });
      await tracked("paused-member", { status: "paused" });
      await tracked("rejected-member", { status: "rejected" });
      const roster = [member("first-member", 21), member("second-member", 22), member("failed-member", 23),
        member("new-member", 24), member("paused-member", 25), member("rejected-member", 25)];
      await run(roster, async () => { throw new Error("roster should precede backlog"); });
      const a = await ForeverCharacter.findById(old._id).lean(), b = await ForeverCharacter.findById(second._id).lean();
      assert.equal(a?.level, 21); assert.equal(b?.level, 22);
      assert.equal(b?.ruleset, "Normal"); assert.equal(b?.avatarUrl, "portrait");
      assert.equal(b?.sourceUpdatedAt?.getTime(), second.sourceUpdatedAt?.getTime(), "roster must not invent source timestamps");
      assert.equal(b?.profileFetchedAt?.getTime(), second.lastFetchedAt?.getTime());
      assert.equal(b?.nextFetchAt?.getTime(), second.lastFetchedAt!.getTime() + PROFILE_AUDIT_INTERVAL);
      assert.ok(a!.nextFetchAt! <= new Date(), "oldest profile is a rotating audit sample");
      assert.equal(b?.history[1]?.source, "roster"); assert.equal(b?.history[1]?.sourceUpdatedAt, undefined);
      const newMember = await ForeverCharacter.findOne({ slug: "new-member" }).lean();
      assert.equal(newMember?.level, 24); assert.equal(newMember?.ruleset, "Normal");
      assert.equal(newMember?.rulesetInferredFromGuild, guildIdentity.slug); assert.ok(newMember!.nextFetchAt! <= new Date());
      const retry = await ForeverCharacter.findById(failed._id).lean();
      assert.equal(retry?.level, 23); assert.equal(retry?.failures, 3); assert.equal(retry?.nextFetchAt?.getTime(), failed.nextFetchAt?.getTime());
      assert.equal((await ForeverCharacter.findOne({ slug: "paused-member" }).lean())?.level, 20);
      assert.equal((await ForeverCharacter.findOne({ slug: "rejected-member" }).lean())?.status, "rejected");
      await dueGuild(); await run(roster);
      assert.equal((await ForeverCharacter.findById(second._id).lean())?.history.length, 2);
      assert.equal((await ForeverCharacter.findById(second._id).lean())?.lastLevelAt?.getTime(), b?.lastLevelAt?.getTime());
      const board = await service.leaderboard({ search: "second member" });
      assert.equal(board.characters[0].rank, 3);
      const schedule = (await ForeverGuild.findOne().lean())!.nextFetchAt!;
      assert.ok(schedule > new Date()); assert.ok(schedule.getTime() <= Date.now() + ROSTER_INTERVAL);
    });

    await t.test("three direct confirmations classify roster-only members; sub-10 profiles never enter either queue", async () => {
      await guild();
      for (const slug of ["known-one", "known-two", "known-three"]) await tracked(slug);
      const roster = [member("known-one"), member("known-two"), member("known-three"), member("young-member", 9)];
      await run(roster);
      const young = (await ForeverCharacter.findOne({ slug: "young-member" }).lean())!;
      assert.equal(young.ruleset, "Normal"); assert.equal(young.faction, "Alliance");
      assert.equal(young.rulesetInferredFromGuild, guildIdentity.slug);
      assert.equal(young.sourceUpdatedAt, undefined); assert.equal(young.profileFetchedAt, undefined);
      assert.equal(young.nextFetchAt, null); assert.equal(young.history.length, 1);
      await assert.rejects(service.adminRefreshNow(String(young._id)), /below_armory_level/);
      await assert.rejects(service.requestRefresh(String(young._id), "low-level-user"), /below_armory_level/);
      assert.deepEqual(await service.adminCharacterAction([String(young._id)], "retry"), { updated: 0, skipped: 1 });
      await ForeverCharacter.updateMany({ slug: { $ne: "young-member" } }, { $set: { nextFetchAt: new Date(Date.now() + PROFILE_AUDIT_INTERVAL) } });
      // Even a leftover priority request or due date cannot bypass the worker guard.
      await ForeverCharacter.updateOne({ _id: young._id }, { $set: { nextFetchAt: new Date(0), refreshRequestedAt: new Date(0) } });
      let calls = 0;
      await ready(); await new ForeverRunner({ roster: async () => { calls++; return roster; }, character: async identity => { calls++; return profile(identity.slug); } }).tick();
      assert.equal(calls, 0);

      await ForeverCharacter.updateOne({ _id: young._id }, { $set: { failures: 6, errorCode: "upstream_error", nextFetchAt: new Date(Date.now() + 86400_000) } });
      await initializeForever();
      const reset = (await ForeverCharacter.findById(young._id).lean())!;
      assert.equal(reset.nextFetchAt, null); assert.equal(reset.failures, 0); assert.equal(reset.errorCode, undefined);
      assert.equal(reset.refreshRequestedAt, undefined);
      await dueGuild(); await run(roster.map(m => m.slug === "young-member" ? member(m.slug, 10) : m));
      const unlocked = (await ForeverCharacter.findById(young._id).lean())!;
      assert.equal(unlocked.level, 10); assert.ok(unlocked.nextFetchAt! <= new Date());
      await ForeverCharacter.updateMany({ slug: { $ne: "young-member" } }, { $set: { nextFetchAt: new Date(Date.now() + PROFILE_AUDIT_INTERVAL) } });
      const fetched: string[] = [];
      await run([], async identity => { fetched.push(identity.slug); return profile(identity.slug, 10); });
      assert.deepEqual(fetched, ["young-member"]);
      const confirmed = (await ForeverCharacter.findById(young._id).lean())!;
      assert.equal(confirmed.ruleset, "Normal"); assert.equal(confirmed.rulesetInferredFromGuild, undefined);
      assert.ok(confirmed.profileFetchedAt);
    });

    await t.test("conflicts and departures withdraw inferred rulesets without overwriting direct observations", async () => {
      await guild();
      for (const slug of ["known-one", "known-two", "known-three"]) await tracked(slug);
      const roster = [member("known-one"), member("known-two"), member("known-three"), member("young-member", 5)];
      await run(roster);
      assert.equal((await ForeverCharacter.findOne({ slug: "young-member" }).lean())?.ruleset, "Normal");
      await ForeverCharacter.updateOne({ slug: "known-three" }, { $set: { ruleset: "PvP", status: "paused" } });
      await dueGuild(); await run(roster);
      const conflict = (await ForeverCharacter.findOne({ slug: "young-member" }).lean())!;
      assert.equal(conflict.ruleset, undefined); assert.equal(conflict.rulesetInferredFromGuild, undefined);
      assert.equal((await ForeverCharacter.findOne({ slug: "known-three" }).lean())?.ruleset, "PvP");
      assert.equal((await ForeverCharacter.findOne({ slug: "known-three" }).lean())?.status, "paused");
      await ForeverCharacter.updateOne({ slug: "known-three" }, { $set: { ruleset: "Normal" } });
      await dueGuild(); await run(roster);
      assert.equal((await ForeverCharacter.findOne({ slug: "young-member" }).lean())?.ruleset, "Normal");
      await ForeverCharacter.updateMany({ level: { $gte: 10 } }, { $set: { nextFetchAt: new Date(Date.now() + PROFILE_AUDIT_INTERVAL) } });
      await dueGuild(); await run(roster.filter(m => m.slug !== "young-member"));
      const left = (await ForeverCharacter.findOne({ slug: "young-member" }).lean())!;
      assert.equal(left.ruleset, undefined); assert.equal(left.nextFetchAt, null);
      assert.equal(left.status, "tracked"); assert.equal(left.history.length, 1);
    });

    await t.test("outdated sub-10 roster entries suppress lookups without publishing unverified progress", async () => {
      await guild();
      await run([{ ...member("outdated-young", 5), isOutdated: true }]);
      const young = (await ForeverCharacter.findOne({ slug: "outdated-young" }).lean())!;
      assert.equal(young.level, undefined); assert.equal(young.history.length, 0); assert.equal(young.rosterLevel, 5);
      await assert.rejects(service.adminRefreshNow(String(young._id)), /below_armory_level/);
      await ForeverCharacter.updateOne({ _id: young._id }, { $set: { nextFetchAt: new Date(0), refreshRequestedAt: new Date(0) } });
      let calls = 0;
      await ready(); await new ForeverRunner({ roster: async () => { calls++; return []; }, character: async identity => { calls++; return profile(identity.slug); } }).tick();
      assert.equal(calls, 0);
      await ForeverCharacter.updateOne({ _id: young._id }, { $unset: { refreshRequestedAt: 1 } });
      await dueGuild(); await run([member("outdated-young", 10)]);
      const unlocked = (await ForeverCharacter.findById(young._id).lean())!;
      assert.equal(unlocked.level, 10); assert.equal(unlocked.history.length, 1); assert.ok(unlocked.nextFetchAt! <= new Date());
    });

    await t.test("older character pages supply profile details without lowering roster progress or resetting first-to-level time", async () => {
      await guild(); await tracked("first-member");
      await run([member("first-member", 31)]);
      const before = await ForeverCharacter.findOne().lean();
      await run([], async () => profile("first-member", 20));
      const after = await ForeverCharacter.findOne().lean();
      assert.equal(after?.level, 31); assert.equal(after?.profileLevel, 20); assert.equal(after?.failures, 0);
      assert.equal(after?.history.length, 2); assert.equal(after?.lastLevelAt?.getTime(), before?.lastLevelAt?.getTime());
      assert.ok(after!.nextFetchAt!.getTime() >= Date.now() + PROFILE_AUDIT_INTERVAL - 2000);
      assert.equal((await ForeverGuild.findOne().lean())?.rosterAheadCount, 1);
      await ForeverCharacter.updateOne({ _id: after!._id }, { $set: { nextFetchAt: new Date(0) } });
      await run([], async () => profile("first-member", 19));
      const regressed = await ForeverCharacter.findOne().lean();
      assert.equal(regressed?.level, 31); assert.equal(regressed?.profileLevel, 20); assert.equal(regressed?.errorCode, "stale_data");
    });

    await t.test("departures and conflicting memberships return to profile fetching without deleting history or importing another guild", async () => {
      const g = await guild(); await tracked("first-member"); await tracked("second-member");
      await run([member("first-member"), member("second-member")]);
      await ForeverCharacter.updateOne({ slug: "first-member" }, { $set: { nextFetchAt: new Date(Date.now() + PROFILE_AUDIT_INTERVAL) } });
      await dueGuild(); await run([member("second-member")]);
      const departed = await ForeverCharacter.findOne({ slug: "first-member" }).lean();
      assert.equal(departed?.status, "tracked"); assert.equal(departed?.rosterCoverageUntil, undefined);
      assert.ok(departed!.nextFetchAt! <= new Date()); assert.equal(departed?.history.length, 1);
      await ForeverCharacter.updateOne({ slug: "second-member" }, { $set: { nextFetchAt: new Date(Date.now() + PROFILE_AUDIT_INTERVAL) } });
      await run([], async () => ({ ...profile("first-member"), guild: { ...guildIdentity, slug: "new-guild", name: "New Guild" } }));
      assert.equal((await ForeverGuild.findOne({ slug: "new-guild" }).lean())?.status, "pending");
      await ForeverGuild.updateOne({ slug: "new-guild" }, { $set: { nextFetchAt: null } });
      await ForeverGuild.updateOne({ _id: g._id }, { $set: { nextFetchAt: new Date(0) } });
      await run([member("first-member", 40), member("second-member")]);
      const moved = await ForeverCharacter.findOne({ slug: "first-member" }).lean();
      assert.equal(moved?.guild?.slug, "new-guild"); assert.equal(moved?.level, 20, "stale old-guild roster cannot change a moved member");
      assert.equal(moved?.rosterCoverageUntil, undefined);
    });

    await t.test("expired coverage falls back, fresh coverage and profile failure deadlines remain intact", async () => {
      const future = new Date(Date.now() + PROFILE_AUDIT_INTERVAL);
      await tracked("expired-member", { rosterCoverageUntil: new Date(1), nextFetchAt: future });
      await tracked("fresh-member", { rosterCoverageUntil: future, nextFetchAt: future });
      await tracked("failed-member", { rosterCoverageUntil: new Date(1), failures: 4, nextFetchAt: future });
      await releaseRosterCoverage({ rosterCoverageUntil: { $lte: new Date(), $ne: null } }, new Date());
      assert.ok((await ForeverCharacter.findOne({ slug: "expired-member" }).lean())!.nextFetchAt! < future);
      assert.equal((await ForeverCharacter.findOne({ slug: "fresh-member" }).lean())?.nextFetchAt?.getTime(), future.getTime());
      assert.equal((await ForeverCharacter.findOne({ slug: "fresh-member" }).lean())?.rosterCoverageUntil?.getTime(), future.getTime());
      assert.equal((await ForeverCharacter.findOne({ slug: "failed-member" }).lean())?.nextFetchAt?.getTime(), future.getTime());
      assert.equal((await ForeverCharacter.findOne({ slug: "failed-member" }).lean())?.rosterCoverageUntil, undefined);
    });

    await t.test("errors retain the roster and its coverage until expiry; flagged members never update progress", async () => {
      await guild(); await tracked("first-member"); await tracked("second-member");
      await run([member("first-member"), member("second-member")]);
      const before = await ForeverCharacter.findOne({ slug: "second-member" }).lean();
      await dueGuild(); await ready();
      await new ForeverRunner({ roster: async () => { throw new ArmoryError("upstream_error", 500); }, character: async () => profile("first-member") }).tick();
      const failed = await ForeverGuild.findOne().lean();
      assert.equal(failed?.roster.length, 2); assert.equal(failed?.failures, 1);
      assert.equal((await ForeverCharacter.findById(before!._id).lean())?.rosterCoverageUntil?.getTime(), before?.rosterCoverageUntil?.getTime());
      await dueGuild(); await run([member("first-member"), { ...member("second-member", 60), isOutdated: true }]);
      const outdated = await ForeverCharacter.findById(before!._id).lean();
      assert.equal(outdated?.level, 20); assert.equal(outdated?.rosterCoverageUntil, undefined);
      assert.ok(outdated!.nextFetchAt! <= new Date());
    });

    await t.test("demonstrably stale rosters trigger guild-wide individual fallback and record endpoint comparisons", async () => {
      await guild(); await tracked("first-member"); await tracked("second-member");
      await run([member("first-member"), member("second-member")]);
      await run([], async () => profile("first-member", 22));
      const g = await ForeverGuild.findOne().lean();
      assert.equal(g?.profileAheadCount, 1); assert.equal(g?.profileComparisons, 1); assert.ok(g!.individualUntil! > new Date());
      assert.equal((await ForeverCharacter.findOne({ slug: "second-member" }).lean())?.rosterCoverageUntil, undefined);
      assert.ok((await ForeverCharacter.findOne({ slug: "second-member" }).lean())!.nextFetchAt! <= new Date());
      await dueGuild(); await run([member("first-member", 20), member("second-member", 21)]);
      assert.equal((await ForeverCharacter.findOne({ slug: "first-member" }).lean())?.level, 22);
      assert.equal((await ForeverCharacter.findOne({ slug: "second-member" }).lean())?.level, 21);
      assert.equal((await ForeverCharacter.findOne({ slug: "second-member" }).lean())?.rosterCoverageUntil, undefined);
      assert.equal((await ForeverGuild.findOne().lean())?.rosterLaggingMembers, 1);
    });

    await t.test("manual refresh requests survive roster updates and instant refresh precedes a due guild", async () => {
      await guild();
      const first = await tracked("first-member"), second = await tracked("second-member", { nextFetchAt: new Date(Date.now() + PROFILE_AUDIT_INTERVAL), lastAttemptAt: new Date(0) });
      await service.requestRefresh(String(second._id), "test-user");
      const queued = await ForeverCharacter.findById(second._id).lean();
      await run([member("first-member"), member("second-member")]);
      assert.equal((await ForeverCharacter.findById(second._id).lean())?.nextFetchAt?.getTime(), queued?.nextFetchAt?.getTime());
      await ForeverCharacter.updateOne({ _id: first._id }, { $set: { nextFetchAt: new Date(Date.now() + PROFILE_AUDIT_INTERVAL) } });
      await run([], async () => profile("second-member"));
      assert.equal((await ForeverCharacter.findById(second._id).lean())?.refreshQueuedAt, undefined);
      await dueGuild();
      await ForeverCharacter.updateOne({ _id: first._id }, { $set: { refreshRequestedAt: new Date() } });
      await ready();
      await new ForeverRunner({ roster: async () => { throw new Error("priority refresh must go first"); }, character: async identity => {
        assert.equal(identity.slug, "first-member"); return profile(identity.slug);
      } }).tick();
      assert.equal((await ForeverCharacter.findById(first._id).lean())?.refreshRequestedAt, undefined);
    });

    await t.test("hidden guilds cannot hide confirmed individuals; approvals and seed reruns upgrade existing imports", async () => {
      const g = await guild();
      await tracked("guild-member"); await tracked("admin-member", { source: "admin" }); await tracked("seed-member", { source: "seed" });
      const upgraded = await tracked("upgraded-member"), approved = await tracked("approved-member", { source: "proposal", status: "pending" });
      await service.addCharacter("Upgraded Member", "admin", "admin");
      await service.setCharacterStatus(String(approved._id), "tracked");
      const seededImport = await tracked("wiba-wiba", { status: "paused", twitchChannel: "edited_channel" });
      const seededBefore = await ForeverCharacter.findById(seededImport._id).lean();
      await seedForeverCharacters();
      assert.equal((await ForeverCharacter.findById(seededImport._id).lean())?.independentlyTracked, true);
      assert.equal((await ForeverCharacter.findById(seededImport._id).lean())?.status, "paused");
      assert.equal((await seedForeverCharacters()).inserted, 0);
      const seededAfter = await ForeverCharacter.findById(seededImport._id).lean();
      assert.equal(seededAfter?.twitchChannel, "edited_channel"); assert.equal(seededAfter?.level, 20);
      assert.equal(seededAfter?.history.length, 1); assert.equal(seededAfter?.updatedAt.getTime(), seededBefore?.updatedAt.getTime());
      await service.setGuildVisibility(String(g._id), true);
      await service.setGuildStatus(String(g._id), "rejected");
      await assert.rejects(service.characterDetail("guild-member"), /not_found/);
      for (const slug of ["admin-member", "seed-member", "upgraded-member", "approved-member"]) assert.equal((await service.characterDetail(slug)).level, 20);
      assert.equal((await ForeverCharacter.findById(upgraded._id).lean())?.source, "guild", "preserve original acquisition source");
      const imported = await ForeverCharacter.findOne({ slug: "guild-member" }).lean();
      assert.deepEqual(await service.adminCharacterAction([String(imported!._id)], "tracked"), { updated: 1, skipped: 0 });
      assert.equal((await service.characterDetail("guild-member")).level, 20);
      await service.setCharacterStatus(String(upgraded._id), "paused");
      await assert.rejects(service.characterDetail("upgraded-member"), /not_found/);
    });

    await t.test("automatic guild approval of a pending proposal does not falsely mark it individually confirmed on restart", async () => {
      await guild(); await tracked("proposed-member", { source: "proposal", status: "pending" });
      await run([member("proposed-member")]); await initializeForever();
      assert.equal((await ForeverCharacter.findOne().lean())?.independentlyTracked, false);
    });

    await t.test("guild moderation during an in-flight roster stops member updates", async () => {
      const g = await guild(); await tracked("first-member"); await ready();
      await new ForeverRunner({ character: async () => profile("first-member"), roster: async () => {
        await service.setGuildVisibility(String(g._id), true); return [member("first-member", 50), member("new-member")];
      } }).tick();
      assert.equal((await ForeverCharacter.findOne({ slug: "first-member" }).lean())?.level, 20);
      assert.equal(await ForeverCharacter.countDocuments({ slug: "new-member" }), 0);
    });

    await t.test("hidden-guild members are skipped while manual characters continue to fetch and discover new guilds", async () => {
      const g = await guild(); await tracked("guild-member"); await tracked("manual-member", { source: "admin" });
      await service.setGuildVisibility(String(g._id), true);
      await ready(); const fetched: string[] = [];
      await new ForeverRunner({ roster: async () => { throw new Error("hidden guild cannot fetch"); }, character: async identity => {
        fetched.push(identity.slug); return { ...profile(identity.slug, 21), guild: { ...guildIdentity, slug: "unreviewed-guild", name: "Unreviewed Guild" } };
      } }).tick();
      assert.deepEqual(fetched, ["manual-member"]);
      assert.equal((await ForeverCharacter.findOne({ slug: "manual-member" }).lean())?.level, 21);
      assert.equal((await ForeverGuild.findOne({ slug: "unreviewed-guild" }).lean())?.status, "pending");
      assert.equal((await ForeverCharacter.findOne({ slug: "guild-member" }).lean())?.level, 20);
    });

    await t.test("a guild hidden during an individual request prevents publishing its imported member", async () => {
      const g = await guild(); await ForeverGuild.updateOne({ _id: g._id }, { $set: { nextFetchAt: new Date(Date.now() + ROSTER_INTERVAL) } });
      await tracked("guild-member"); await ready();
      await new ForeverRunner({ roster: async () => [], character: async () => {
        await service.setGuildVisibility(String(g._id), true); return profile("guild-member", 40);
      } }).tick();
      assert.equal((await ForeverCharacter.findOne().lean())?.level, 20);
    });

    await t.test("ordinary characters cannot be starved by continuously due guilds", async () => {
      await tracked("first-member");
      await ForeverGuild.insertMany(Array.from({ length: 8 }, (_, i) => ({ ...guildIdentity, slug: `busy-guild${i}`, status: "approved", nextFetchAt: new Date(0) })));
      const calls: string[] = [];
      const runner = new ForeverRunner({ roster: async () => { calls.push("guild"); return []; }, character: async identity => {
        calls.push("character"); return profile(identity.slug);
      } });
      for (let i = 0; i < 4; i++) { await ready(); await runner.tick(); }
      assert.deepEqual(calls, ["guild", "guild", "guild", "character"]);
    });

    await t.test("a newly queued public refresh arriving during a profile fetch is not postponed by the audit schedule", async () => {
      await guild(); const c = await tracked("first-member");
      await run([member("first-member")]);
      await ready(); await new ForeverRunner({ roster: async () => [], character: async () => {
        await ForeverCharacter.updateOne({ _id: c._id }, { $set: { refreshQueuedAt: new Date() } });
        return profile("first-member");
      } }).tick();
      const after = await ForeverCharacter.findById(c._id).lean();
      assert.ok(after?.refreshQueuedAt); assert.ok(after!.nextFetchAt! <= new Date());
    });

    await t.test("startup staggers the legacy schedule once without shortening failed retries", async () => {
      const future = new Date(Date.now() + PROFILE_AUDIT_INTERVAL);
      const g = await ForeverGuild.create({ ...guildIdentity, status: "approved", nextFetchAt: future });
      const failed = await ForeverGuild.create({ ...guildIdentity, slug: "failed-guild", status: "approved", failures: 4, nextFetchAt: future });
      await initializeForever();
      const first = await ForeverGuild.findById(g._id).lean();
      assert.equal(first?.rosterPollingVersion, 1); assert.ok(first!.nextFetchAt!.getTime() <= Date.now() + ROSTER_INTERVAL);
      await initializeForever();
      assert.equal((await ForeverGuild.findById(g._id).lean())?.nextFetchAt?.getTime(), first?.nextFetchAt?.getTime());
      assert.equal((await ForeverGuild.findById(failed._id).lean())?.nextFetchAt?.getTime(), future.getTime());
    });

    await t.test("a thousand-member roster uses bounded bulk operations and one upstream call", async () => {
      await guild(); const rows = Array.from({ length: 1000 }, (_, i) => member(`load-member${i}`, i % 60 + 1));
      const start = Date.now(); let calls = 0;
      await ready(); await new ForeverRunner({ roster: async () => { calls++; return rows; }, character: async () => { throw new Error("individual fetch not expected"); } }).tick();
      assert.equal(calls, 1); assert.equal(await ForeverCharacter.countDocuments({ status: "tracked", level: { $gte: 1 } }), 1000);
      assert.equal((await service.leaderboard()).totalRanked, 1000);
      console.log(JSON.stringify({ rosterMembers: 1000, upstreamRequests: calls, syncMilliseconds: Date.now() - start }));
    });
  } finally {
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
