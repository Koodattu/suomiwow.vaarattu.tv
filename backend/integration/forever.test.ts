/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { ArmoryError, armoryUrl, ForeverProfile } from "../src/features/forever/forever-armory";
import { ForeverCharacter, ForeverGuild, ForeverRequestLimit, ForeverWorker } from "../src/features/forever/forever.models";
import foreverRunner, { ForeverRunner, initializeForever } from "../src/features/forever/forever.worker";
import * as service from "../src/features/forever/forever.service";
import { ForeverTwitchRunner } from "../src/features/forever/forever-twitch";
import { seedForeverCharacters } from "../src/features/forever/forever-seed";
import { invalidateForeverLeaderboard, stopForeverLeaderboard } from "../src/features/forever/forever-leaderboard";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("Forever tracking integration (isolated replica-set database)", { skip: !uri }, async (t) => {
  const database = `forever_test_${randomUUID().replace(/-/g, "")}`;
  await mongoose.connect(uri!, { dbName: database, serverSelectionTimeoutMS: 5000 });
  try {
    await initializeForever();
    // Each subtest installs fixtures directly, bypassing the admin invalidation path.
    t.beforeEach(() => invalidateForeverLeaderboard());
    t.after(() => stopForeverLeaderboard());
    const profile: ForeverProfile = { region: "eu", slug: "test-hero", name: "Test Hero", level: 10, className: "Paladin", race: "Human", faction: "Alliance", ruleset: "Normal", sourceUpdatedAt: new Date("2026-11-05T10:00:00Z"), guild: { region: "eu", slug: "test-guild", name: "Test Guild" } };
    await t.test("guild suggestions wait for approval, share the submission limit, and deduplicate name/link inputs", async () => {
      const guild = await service.addGuild("Review Guild", "proposal", "review-user");
      assert.equal(guild.status, "proposed");
      assert.equal((await service.addGuild(armoryUrl({ region: "eu", slug: "review-guild" }, "guild"), "proposal", "review-user")).id, guild.id);
      let calls = 0;
      const runner = new ForeverRunner({ character: async () => { throw new Error("No character should be fetched"); }, roster: async () => { calls++; return [{ region: "eu", slug: "review-member", name: "Review Member", level: 12, className: "Mage" }]; } });
      await runner.tick(); assert.equal(calls, 0);
      await service.addCharacter("Review Hero", "proposal", "review-user");
      await service.addGuild("Another Guild", "proposal", "review-user");
      await service.addCharacter("Another Hero", "proposal", "review-user");
      await assert.rejects(service.addGuild("Rate Limited", "proposal", "review-user"), /rate_limited/);
      await service.setGuildStatus(guild.id, "approved");
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
      await runner.tick(); assert.equal(calls, 1);
      assert.equal((await ForeverCharacter.findOne({ slug: "review-member" }).lean())?.status, "tracked");
      await service.setGuildStatus(guild.id, "rejected");
      assert.equal((await service.addGuild("Review Guild", "proposal", "other-user")).status, "rejected");
      assert.equal((await service.addGuild("Review Guild", "admin", "admin")).status, "pending");
      await ForeverCharacter.deleteMany({}); await ForeverGuild.deleteMany({});
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
    });
    await t.test("unique first-to-level ranks survive filtering/pagination and guild hiding is reversible without changing individual states", async () => {
      const future = new Date(Date.now() + 86400000);
      const guild = await ForeverGuild.create({ region: "eu", slug: "hidden-guild", name: "Hidden Guild", status: "approved", nextFetchAt: future, roster: [{ region: "eu", slug: "rank-unfetched" }] });
      const base = { region: "eu", source: "admin", status: "tracked", nextFetchAt: future, lastLevelAt: new Date("2026-11-05T12:00:00Z") };
      await ForeverCharacter.insertMany([
        ...["top-a", "top-b"].map((slug, index) => ({ ...base, source: "guild", slug, name: slug, level: 60, lastLevelAt: new Date(`2026-11-05T${index ? "10" : "11"}:00:00Z`), guild: { region: "eu", slug: guild.slug, name: guild.name }, history: [{ level: 60, observedAt: new Date() }] })),
        { ...base, slug: "rank-target", name: "Rank Target", level: 40, faction: "Alliance" },
        ...Array.from({ length: 51 }, (_, i) => ({ ...base, slug: `rank-low-${i}`, name: `Rank Low ${i}`, level: 30 })),
        { ...base, slug: "rank-paused", level: 60, status: "paused", guild: { region: "eu", slug: guild.slug, name: guild.name } },
        { ...base, slug: "rank-private", level: 60, status: "pending" },
        { ...base, slug: "rank-us", level: 60, region: "us" },
        { ...base, source: "guild", slug: "rank-unfetched", nextFetchAt: new Date(0) },
      ]);
      const first = await service.leaderboard(), second = await service.leaderboard({ page: 2 });
      assert.deepEqual(first.characters.slice(0, 2).map(c => c.slug), ["top-b", "top-a"], "earlier level observation wins over alphabetical name or creation order");
      assert.deepEqual([...first.characters, ...second.characters].map(c => c.rank), Array.from({ length: 54 }, (_, i) => i + 1));
      const filtered = await service.leaderboard({ search: "Rank Target", faction: "Alliance" });
      assert.equal(filtered.characters[0].rank, 3); assert.equal(filtered.total, 1); assert.equal(filtered.totalRanked, 54);
      const last = second.characters[second.characters.length - 1];
      assert.equal((await service.leaderboard({ search: last.name })).characters.find(c => String(c._id) === String(last._id))?.rank, 54);
      assert.deepEqual((await service.leaderboard({ page: 2 })).characters.map(c => String(c._id)), second.characters.map(c => String(c._id)), "identical timestamps have deterministic unique ordering");
      const plan = await ForeverCharacter.collection.find({ region: "eu", status: "tracked", level: { $gte: 1 } }, { projection: { _id: 1 } }).sort({ level: -1, lastLevelAt: 1, _id: 1 }).explain("executionStats");
      const stats = plan.executionStats;
      assert.equal(stats.totalDocsExamined, 0, "global ranks must use the covering index, not character/history documents");
      console.log(JSON.stringify({ rankQueryDocumentsExamined: stats.totalDocsExamined, rankQueryKeysExamined: stats.totalKeysExamined }));
      await service.setGuildVisibility(String(guild._id), true);
      const visible = await service.leaderboard();
      assert.equal(visible.total, 52); assert.equal(visible.characters[0].rank, 1); assert.equal(visible.pending, 0);
      assert.ok(!visible.filterOptions.guild.includes(guild.name));
      await assert.rejects(service.characterDetail("top-a"), /not_found/);
      const top = await ForeverCharacter.findOne({ slug: "top-a" }).lean();
      await assert.rejects(service.adminRefreshNow(String(top!._id)), /not_found/);
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
      let calls = 0;
      await new ForeverRunner({ character: async () => { calls++; return profile; }, roster: async () => { calls++; return []; } }).tick();
      assert.equal(calls, 0, "hidden unfetched members must not be polled");
      await service.setGuildVisibility(String(guild._id), false);
      assert.equal((await service.leaderboard({ search: "Rank Target" })).characters[0].rank, 3);
      assert.equal((await ForeverCharacter.findOne({ slug: "rank-paused" }).lean())?.status, "paused");
      assert.equal((await ForeverCharacter.findOne({ slug: "top-a" }).lean())?.history.length, 1);
      await ForeverCharacter.deleteMany({}); await ForeverGuild.deleteMany({});
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
    });
    await t.test("admin refresh runs first, bypasses character backoff, and respects shared leases and cooldowns", async () => {
      const target = await ForeverCharacter.create({ region: "eu", slug: "priority-hero", source: "admin", status: "tracked", failures: 4, lastAttemptAt: new Date(), nextFetchAt: new Date(Date.now() + 86400000) });
      const regular = await ForeverCharacter.create({ region: "eu", slug: "regular-hero", source: "admin", status: "tracked", nextFetchAt: new Date(0) });
      const guild = await ForeverGuild.create({ region: "eu", slug: "priority-test-guild", name: "Priority Test Guild", status: "pending", nextFetchAt: new Date(0) });
      const calls: string[] = [];
      let fail = false, requestAgain = false;
      const priorityRunner = new ForeverRunner({ character: async (identity) => {
        calls.push(identity.slug);
        if (fail) throw new ArmoryError("upstream_error", 500);
        if (requestAgain) await ForeverCharacter.updateOne({ _id: target._id }, { $set: { refreshRequestedAt: new Date(Date.now() + 10) } });
        return { ...profile, ...identity, guild: null };
      }, roster: async () => { calls.push("guild"); return []; } });
      const mock = t.mock.method(foreverRunner, "tick", () => priorityRunner.tick());
      const id = String(target._id);
      try {
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
        assert.deepEqual(await service.adminRefreshNow(id), { refreshState: "refreshed" });
        assert.deepEqual(calls, ["priority-hero"]);
        assert.equal((await ForeverCharacter.findById(id).lean())?.refreshRequestedAt, undefined);
        const cooldown = new Date(Date.now() + 120000);
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: cooldown } });
        assert.deepEqual(await service.adminRefreshNow(id), { refreshState: "prioritized" });
        assert.equal(calls.length, 1);
        assert.equal((await ForeverWorker.findById("armory").lean())?.nextRequestAt?.getTime(), cooldown.getTime());
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0), leaseToken: "busy", leaseUntil: cooldown } });
        assert.deepEqual(await service.adminRefreshNow(id), { refreshState: "prioritized" });
        assert.equal(calls.length, 1);
        await ForeverWorker.updateOne({ _id: "armory" }, { $unset: { leaseToken: 1, leaseUntil: 1 } });
        fail = true;
        await priorityRunner.tick();
        assert.deepEqual(calls, ["priority-hero", "priority-hero"]);
        const failed = await ForeverCharacter.findById(id).lean();
        assert.equal(failed?.refreshRequestedAt, undefined);
        assert.equal(failed?.errorCode, "upstream_error");
        assert.ok(failed!.nextFetchAt! > new Date());
        assert.equal(failed?.history.length, 1);
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
        await priorityRunner.tick();
        assert.equal(calls[2], "guild", "failed priority request returns to backoff so a due roster can run");
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
        await priorityRunner.tick();
        assert.equal(calls[3], "regular-hero", "ordinary characters continue after the due roster");
        fail = false; requestAgain = true;
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
        assert.deepEqual(await service.adminRefreshNow(id), { refreshState: "prioritized" });
        assert.ok((await ForeverCharacter.findById(id).lean())?.refreshRequestedAt, "request arriving during a fetch must survive completion");
        requestAgain = false;
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } });
        await priorityRunner.tick();
        assert.equal(calls[calls.length - 1], "priority-hero");
        assert.equal((await ForeverCharacter.findById(id).lean())?.refreshRequestedAt, undefined);
        await service.setCharacterStatus(id, "paused");
        await assert.rejects(service.adminRefreshNow(id), (e: service.ForeverError) => e.status === 404);
      } finally {
        mock.mock.restore();
        await ForeverCharacter.deleteMany({ _id: { $in: [target._id, regular._id] } });
        await ForeverGuild.deleteOne({ _id: guild._id });
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0), failedJobs: [] }, $unset: { leaseToken: 1, leaseUntil: 1, errorCode: 1 } });
      }
    });
    await t.test("the running queue starts immediately and drains at sub-second spacing without bursts", async () => {
      const slugs = ["pace-first", "pace-second"];
      await ForeverCharacter.insertMany(slugs.map((slug) => ({ region: "eu", slug, source: "admin", status: "tracked", nextFetchAt: new Date(0) })));
      const starts: number[] = [];
      let finished!: () => void;
      const drained = new Promise<void>((resolve) => { finished = resolve; });
      const fast = new ForeverRunner({ character: async (identity) => {
        starts.push(Date.now());
        if (starts.length === 2) finished();
        return { ...profile, ...identity, guild: null };
      }, roster: async () => [] });
      const startedAt = Date.now();
      let timeout: NodeJS.Timeout | undefined;
      try {
        fast.start();
        await Promise.race([drained, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Queue did not drain promptly")), 5_000); })]);
      } finally { clearTimeout(timeout); await fast.stop(); }
      assert.equal(starts.length, 2);
      assert.ok(starts[0] - startedAt < 2_000, "first request should not wait for a polling interval");
      assert.ok(starts[1] - starts[0] >= 500, "shared spacing must prevent bursts");
      assert.ok(starts[1] - starts[0] < 2_000, "successful work should continue without a long timer");
      assert.equal(await ForeverCharacter.countDocuments({ slug: { $in: slugs }, level: 10 }), 2);
      await ForeverCharacter.deleteMany({ slug: { $in: slugs } });
    });
    let calls = 0, rosterCalls = 0, fail: ArmoryError | undefined;
    const source = { character: async () => { calls++; if (fail) throw fail; return { ...profile }; }, roster: async () => {
      rosterCalls++; return [{ region: "eu" as const, slug: "guild-member", name: "Guild Member", level: 20, className: "Mage" }];
    } };
    const runner = new ForeverRunner(source);
    const ready = async () => { await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0) } }); };
    const added = await service.addCharacter(armoryUrl(profile), "proposal", "discord-user");

    await t.test("proposals are private, deduplicated and never fetched before approval", async () => {
      await service.addCharacter(armoryUrl(profile), "proposal", "another-user");
      await runner.tick(); assert.equal(calls, 0);
      assert.equal(await ForeverCharacter.countDocuments(), 1);
      assert.equal((await service.leaderboard()).total, 0);
      await assert.rejects(service.characterDetail(added.id));
    });
    await t.test("approval fetches a character and discovers a guild without importing members", async () => {
      await service.setCharacterStatus(added.id, "tracked"); await ready(); await runner.tick();
      const character = await ForeverCharacter.findById(added.id).lean();
      assert.equal(character?.level, 10); assert.equal(character?.history.length, 1);
      const guild = await ForeverGuild.findOne().lean(); assert.equal(guild?.status, "pending");
      await ready(); await runner.tick();
      assert.equal(rosterCalls, 1); assert.equal((await ForeverGuild.findOne().lean())?.roster.length, 1);
      assert.equal(await ForeverCharacter.countDocuments(), 1);
    });
    await t.test("guild approval imports members, but explicit pauses and rejections are preserved", async () => {
      const guild = await ForeverGuild.findOne().lean();
      await service.setGuildStatus(String(guild!._id), "approved"); await ready(); await runner.tick();
      const member = await ForeverCharacter.findOne({ slug: "guild-member" }).lean(); assert.equal(member?.status, "tracked");
      await service.setCharacterStatus(String(member!._id), "paused");
      await ForeverGuild.updateOne({ _id: guild!._id }, { $set: { lastAttemptAt: new Date(0) } });
      await service.refreshGuild(String(guild!._id)); await ready(); await runner.tick();
      assert.equal((await ForeverCharacter.findById(member!._id).lean())?.status, "paused");
      await service.setGuildStatus(String(guild!._id), "paused");
    });
    await t.test("unchanged observations are idempotent; level jumps add only the observed level", async () => {
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } }); await ready(); await runner.tick();
      assert.equal((await ForeverCharacter.findById(added.id).lean())?.history.length, 1);
      profile.level = 13; profile.sourceUpdatedAt = new Date("2026-11-05T10:30:00Z");
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } }); await ready(); await runner.tick();
      assert.deepEqual((await ForeverCharacter.findById(added.id).lean())?.history.map((row) => row.level), [10, 13]);
    });
    await t.test("404s preserve snapshots and cooldowns survive user refreshes and worker restart", async () => {
      fail = new ArmoryError("not_found", 404);
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } }); await ready(); await runner.tick();
      const before = await ForeverCharacter.findById(added.id).lean(); assert.equal(before?.level, 13); assert.equal(before?.failures, 1);
      assert.ok(before!.nextFetchAt!.getTime() > Date.now() + 14 * 60_000);
      await service.requestRefresh(added.id, "discord-user");
      assert.equal((await ForeverCharacter.findById(added.id).lean())?.nextFetchAt?.getTime(), before?.nextFetchAt?.getTime());
      const beforeCalls = calls; await ready(); await new ForeverRunner(source).tick(); assert.equal(calls, beforeCalls);
    });
    await t.test("429 applies a shared Retry-After pause across runners", async () => {
      fail = new ArmoryError("upstream_error", 429, 3600_000);
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } }); await ready(); await runner.tick();
      assert.ok((await ForeverWorker.findById("armory").lean())!.nextRequestAt!.getTime() > Date.now() + 3590_000);
      const beforeCalls = calls; await new ForeverRunner(source).tick(); assert.equal(calls, beforeCalls);
    });
    await t.test("mixed launch errors back off individual jobs while other profiles continue across worker restarts", async () => {
      const slugs = ["launch-fail-one", "launch-ok-one", "launch-fail-two", "launch-ok-two"];
      await ForeverCharacter.insertMany(slugs.map((slug, index) => ({ region: "eu", slug, source: "admin", status: "tracked", nextFetchAt: new Date(index) })));
      const attempted: string[] = [];
      const launchSource = { roster: async () => [], character: async (identity: { region: "eu" | "us"; slug: string }) => {
        attempted.push(identity.slug);
        if (identity.slug.includes("fail")) throw new ArmoryError("upstream_error", 500);
        return { ...profile, ...identity, guild: null };
      } };
      try {
        for (const slug of slugs) {
          await ready(); await new ForeverRunner(launchSource).tick();
          const worker = await ForeverWorker.findById("armory").lean();
          assert.ok(worker!.nextRequestAt!.getTime() < Date.now() + 1_000, "individual 500 must not pause unrelated jobs");
          assert.equal(worker?.errorCode, undefined, "worker must not advertise a global outage for an isolated failure");
          assert.equal(worker?.failedJobs.length, slug.includes("fail") ? 1 : 0);
        }
        assert.deepEqual(attempted, slugs);
        assert.equal(await ForeverCharacter.countDocuments({ slug: { $in: slugs }, level: 13 }), 2);
        const failed = await ForeverCharacter.findOne({ slug: slugs[0] }).lean();
        assert.equal(failed?.failures, 1);
        assert.ok(failed!.nextFetchAt!.getTime() > Date.now() + 110_000);
      } finally { await ForeverCharacter.deleteMany({ slug: { $in: slugs } }); }
    });
    await t.test("ten distinct failures pause all runners, then a healthy probe clears persisted outage evidence", async () => {
      const slugs = Array.from({ length: 11 }, (_, index) => `outage-${index}`);
      await ForeverCharacter.insertMany(slugs.map((slug, index) => ({ region: "eu", slug, source: "admin", status: "tracked", nextFetchAt: new Date(index) })));
      let attempted = 0;
      const outageSource = { roster: async () => [], character: async () => { attempted++; throw new ArmoryError("upstream_error", 500); } };
      try {
        for (let index = 0; index < 10; index++) {
          await ready(); await new ForeverRunner(outageSource).tick();
          const worker = await ForeverWorker.findById("armory").lean();
          if (index < 9) {
            assert.equal(worker?.failedJobs.length, index + 1);
            assert.ok(worker!.nextRequestAt!.getTime() < Date.now() + 1_000);
          } else {
            assert.ok(worker!.nextRequestAt!.getTime() > Date.now() + 110_000);
            assert.equal(worker?.errorCode, "upstream_error");
          }
        }
        await new ForeverRunner(outageSource).tick(); assert.equal(attempted, 10);
        await ready();
        await new ForeverRunner({ roster: async () => [], character: async (identity) => ({ ...profile, ...identity, guild: null }) }).tick();
        assert.equal((await ForeverCharacter.findOne({ slug: slugs[10] }).lean())?.level, 13);
        const recovered = await ForeverWorker.findById("armory").lean();
        assert.equal(recovered?.errorCode, undefined); assert.deepEqual(recovered?.failedJobs, []);
      } finally { await ForeverCharacter.deleteMany({ slug: { $in: slugs } }); }
    });
    await t.test("concurrent workers make only one upstream request and persist one level observation", async () => {
      fail = undefined; profile.level = 14;
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } }); await ready();
      const before = calls; await Promise.all([runner.tick(), new ForeverRunner(source).tick()]);
      assert.equal(calls, before + 1);
      assert.deepEqual((await ForeverCharacter.findById(added.id).lean())?.history.map((row) => row.level), [10, 13, 14]);
    });
    await t.test("admin pause during an in-flight fetch prevents its writes and discovery", async () => {
      const racingRunner = new ForeverRunner({ ...source, character: async () => { await service.setCharacterStatus(added.id, "paused"); return { ...profile, level: 15 }; } });
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } }); await ready(); await racingRunner.tick();
      assert.equal((await ForeverCharacter.findById(added.id).lean())?.level, 14);
      assert.equal((await ForeverCharacter.findById(added.id).lean())?.status, "paused");
    });
    await t.test("distributed submission limit admits exactly five requests under concurrency", async () => {
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => service.consumeLimit("concurrent-user", "proposal", 5)));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
      assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.reason.status === 429));
      assert.ok(await ForeverRequestLimit.countDocuments() > 0);
    });
    await t.test("expired leases recover and a displaced worker cannot write or release its successor", async () => {
      await service.setCharacterStatus(added.id, "tracked");
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } });
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: new Date(0), leaseToken: "crashed", leaseUntil: new Date(Date.now() + 60_000) } });
      const before = calls; await runner.tick(); assert.equal(calls, before);
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { leaseUntil: new Date(0) } });
      await runner.tick(); assert.equal(calls, before + 1);
      await ForeverCharacter.updateOne({ _id: added.id }, { $set: { nextFetchAt: new Date(0) } }); await ready();
      const displaced = new ForeverRunner({ ...source, character: async () => {
        await ForeverWorker.updateOne({ _id: "armory" }, { $set: { leaseToken: "successor", leaseUntil: new Date(Date.now() + 60_000) } });
        return { ...profile, level: 16 };
      } });
      await assert.rejects(displaced.tick(), /lease lost/);
      assert.equal((await ForeverCharacter.findById(added.id).lean())?.level, 14);
      assert.equal((await ForeverWorker.findById("armory").lean())?.leaseToken, "successor");
    });
    await t.test("seed reruns preserve edits, pauses and history without duplicate Wiba entries", async () => {
      assert.equal((await seedForeverCharacters()).inserted, 125);
      const wiba = await ForeverCharacter.findOne({ slug: "wiba-wiba" }).lean();
      assert.equal(wiba?.twitchChannel, "wiba");
      await service.setCharacterStatus(String(wiba!._id), "paused");
      await service.setCharacterTwitch(String(wiba!._id), "different_channel");
      await ForeverCharacter.updateOne({ _id: wiba!._id }, { $set: { level: 42 }, $push: { history: { level: 42, observedAt: new Date() } } });
      const edited = await ForeverCharacter.findById(wiba!._id).lean();
      assert.equal((await seedForeverCharacters()).inserted, 0);
      const after = await ForeverCharacter.findById(wiba!._id).lean();
      assert.equal(after?.twitchChannel, "different_channel"); assert.equal(after?.status, "paused");
      assert.equal(after?.history.length, 1); assert.equal(after?.level, 42);
      assert.equal(after?.updatedAt.getTime(), edited?.updatedAt.getTime());
      assert.equal(await ForeverCharacter.countDocuments({ slug: "wiba-wiba" }), 1);
    });
    await t.test("Twitch batches are bounded, leased, cached and independent of Blizzard backoff", async () => {
      let requests = 0;
      const twitch = { isEnabled: () => true, getStreamStatus: async (channels: string[]) => {
        requests++; assert.ok(channels.length <= 20);
        return new Map(channels.map((channel) => [channel, { isLive: true, isPlayingWoW: true }]));
      } };
      await Promise.all([new ForeverTwitchRunner(twitch).tick(), new ForeverTwitchRunner(twitch).tick()]);
      assert.equal(requests, 1);
      const updated = await ForeverCharacter.findOne({ twitchCheckedAt: { $exists: true } }).lean();
      assert.ok(updated?.twitchIsLive); assert.ok(updated!.twitchNextCheckAt!.getTime() > Date.now() + 110_000);
      assert.equal((await service.characterDetail(String(updated!._id))).twitchChannel, updated?.twitchChannel);
      const before = updated!.twitchCheckedAt;
      await ForeverCharacter.updateMany({ twitchChannel: { $exists: true } }, { $set: { twitchNextCheckAt: new Date(0) } });
      await ForeverWorker.updateOne({ _id: "twitch" }, { $set: { nextRequestAt: new Date(0) } });
      await new ForeverTwitchRunner({ ...twitch, getStreamStatus: async () => { throw new Error("Twitch unavailable"); } }).tick();
      assert.equal((await ForeverCharacter.findById(updated!._id).lean())?.twitchCheckedAt?.getTime(), before?.getTime());
      assert.ok((await ForeverWorker.findById("twitch").lean())!.nextRequestAt!.getTime() > Date.now() + 110_000);
      await service.setCharacterTwitch(String(updated!._id), "new_channel");
      assert.equal((await ForeverCharacter.findById(updated!._id).lean())?.twitchCheckedAt, undefined);
      await service.setCharacterTwitch(String(updated!._id), "");
      assert.equal((await ForeverCharacter.findById(updated!._id).lean())?.twitchChannel, undefined);
      await assert.rejects(service.setCharacterTwitch(String(updated!._id), "https://evil.test"), /invalid_twitch/);
    });
    await t.test("an in-flight Twitch result cannot restore a cleared channel or outlive its lease", async () => {
      await ForeverCharacter.updateMany({}, { $unset: { twitchChannel: 1 } });
      await service.setCharacterTwitch(added.id, "original_channel");
      const readyTwitch = () => ForeverWorker.updateOne({ _id: "twitch" }, { $set: { nextRequestAt: new Date(0) } });
      await readyTwitch();
      await new ForeverTwitchRunner({ isEnabled: () => true, getStreamStatus: async () => {
        await service.setCharacterTwitch(added.id, "replacement_channel");
        return new Map([["original_channel", { isLive: true, isPlayingWoW: true }]]);
      } }).tick();
      assert.equal((await ForeverCharacter.findById(added.id).lean())?.twitchCheckedAt, undefined);
      await readyTwitch();
      await new ForeverTwitchRunner({ isEnabled: () => true, getStreamStatus: async () => {
        await ForeverWorker.updateOne({ _id: "twitch" }, { $set: { leaseToken: "successor" } });
        return new Map([["replacement_channel", { isLive: true, isPlayingWoW: true }]]);
      } }).tick();
      assert.equal((await ForeverWorker.findById("twitch").lean())?.leaseToken, "successor");
      assert.equal((await ForeverCharacter.findById(added.id).lean())?.twitchCheckedAt, undefined);
    });
    await t.test("population statistics cover all matching pages and preserve unknown values without counting private or unfetched characters", async () => {
      const base = { region: "eu", source: "admin", status: "tracked", level: 20, race: "Human", className: "Mage", guild: { region: "eu", slug: "statistics-guild", name: "Statistics Guild" } };
      await ForeverCharacter.insertMany([
        ...Array.from({ length: 60 }, (_, index) => ({ ...base, slug: `stats-${index}`, faction: index < 40 ? "Horde" : "Alliance", ruleset: index < 30 ? "PvP" : index < 50 ? "Normal" : "Roleplay" })),
        { ...base, slug: "stats-missing", level: 60, className: "Warrior" },
        { ...base, slug: "stats-empty", level: 10, faction: "", ruleset: "Normal" },
        { ...base, slug: "stats-us", region: "us", level: 60 },
        { ...base, slug: "stats-paused", status: "paused", level: 60 },
        { ...base, slug: "stats-private", status: "pending", level: 60 },
        { ...base, slug: "stats-unfetched", level: undefined },
      ]);
      try {
        const first = await service.leaderboard({ guild: "Statistics Guild" });
        const second = await service.leaderboard({ guild: "Statistics Guild", page: 2 });
        assert.equal(first.total, 62); assert.equal(first.characters.length, 50); assert.equal(second.characters.length, 12);
        assert.deepEqual(first.statistics, second.statistics);
        const counts = (entries: { name: string | null; count: number }[]) => Object.fromEntries(entries.map((entry) => [entry.name ?? "unknown", entry.count]));
        assert.deepEqual(counts(first.statistics.factions), { Horde: 40, Alliance: 20, unknown: 2 });
        assert.deepEqual(counts(first.statistics.rulesets), { PvP: 30, Normal: 21, Roleplay: 10, unknown: 1 });
        assert.deepEqual(Object.fromEntries(first.statistics.combinations.map((entry) => [`${entry.faction ?? "unknown"}/${entry.ruleset ?? "unknown"}`, entry.count])), {
          "Horde/PvP": 30, "Horde/Normal": 10, "Alliance/Normal": 10, "Alliance/Roleplay": 10, "unknown/Normal": 1, "unknown/unknown": 1,
        });
        assert.equal(first.statistics.combinations.reduce((sum, entry) => sum + entry.count, 0), first.total);
        assert.equal(first.statistics.atMaxLevel, 1);
        assert.ok(Math.abs(first.statistics.averageLevel! - 1270 / 62) < 0.00001);
        const filtered = await service.leaderboard({ guild: "Statistics Guild", race: "Human", className: "Mage", faction: "Horde", ruleset: "Normal" });
        assert.equal(filtered.total, 10);
        assert.deepEqual(filtered.statistics, { factions: [{ name: "Horde", count: 10 }], rulesets: [{ name: "Normal", count: 10 }], combinations: [{ faction: "Horde", ruleset: "Normal", count: 10 }], averageLevel: 20, atMaxLevel: 0 });
        const empty = await service.leaderboard({ guild: "Statistics Guild", ruleset: "Nonexistent" });
        assert.equal(empty.total, 0);
        assert.deepEqual(empty.statistics, { factions: [], rulesets: [], combinations: [], averageLevel: null, atMaxLevel: 0 });
        const beyond = await service.leaderboard({ guild: "Statistics Guild", page: 3 });
        assert.equal(beyond.characters.length, 0); assert.deepEqual(beyond.statistics, first.statistics);
      } finally { await ForeverCharacter.deleteMany({ slug: /^stats-/ }); }
    });
    await t.test("leaderboard searches literal names and guilds before pagination and statistics", async () => {
      const base = { region: "eu", source: "admin", status: "tracked", level: 20, faction: "Horde", guild: { region: "eu", slug: "search-guild", name: "Search [Guild]" } };
      await ForeverCharacter.insertMany([
        ...Array.from({ length: 51 }, (_, index) => ({ ...base, slug: `search-${index}`, name: `Näätä ${index}` })),
        { ...base, slug: "search-other", name: "Other Name", faction: "Alliance" },
        { ...base, slug: "search-us", name: "Näätä US", region: "us" },
        { ...base, slug: "search-private", name: "Näätä Private", status: "pending" },
      ]);
      try {
        const first = await service.leaderboard({ search: "  NÄÄTÄ  " });
        const second = await service.leaderboard({ search: "näätä", page: 2 });
        assert.equal(first.total, 51); assert.equal(first.characters.length, 50); assert.equal(second.characters.length, 1);
        assert.deepEqual(first.statistics, second.statistics);
        assert.deepEqual(first.statistics.factions, [{ name: "Horde", count: 51 }]);
        assert.equal((await service.leaderboard({ search: "[guild]" })).total, 52);
        assert.equal((await service.leaderboard({ search: "[guild]", faction: "Alliance" })).total, 1);
        assert.equal((await service.leaderboard({ search: ".*" })).total, 0);
        assert.equal((await service.leaderboard({ search: "missing character" })).statistics.averageLevel, null);
        assert.equal((await service.leaderboard({ search: "   " })).total, (await service.leaderboard()).total);
        await assert.rejects(service.leaderboard({ search: { $ne: "" } }), /invalid_input/);
        await assert.rejects(service.leaderboard({ search: "x".repeat(101) }), /invalid_input/);
      } finally { await ForeverCharacter.deleteMany({ slug: /^search-/ }); }
    });
    await t.test("leaderboard combines all four filters before pagination and scopes results and options to Europe", async () => {
      const base = { region: "eu", source: "admin", status: "tracked", level: 20, race: "Human", className: "Mage", faction: "Horde", ruleset: "Normal" };
      await ForeverCharacter.insertMany([
        ...Array.from({ length: 51 }, (_, index) => ({ ...base, slug: `filter-mage-${index}`, name: `Filter Mage ${String(index).padStart(2, "0")}` })),
        { ...base, slug: "filter-warrior", race: "Tauren", className: "Warrior", faction: "Alliance", ruleset: "Hardcore" },
        { ...base, slug: "filter-us", region: "us", race: "Gnome" },
        { ...base, slug: "filter-private", status: "pending", race: "Night Elf" },
      ]);
      const filters = { race: "Human", className: "Mage", faction: "Horde", ruleset: "Normal" };
      const first = await service.leaderboard(filters), second = await service.leaderboard({ ...filters, page: 2 });
      assert.equal(first.total, 51); assert.equal(first.characters.length, 50); assert.equal(second.characters.length, 1);
      assert.ok(first.characters.every((entry) => entry.region === "eu" && entry.className === "Mage" && entry.faction === "Horde"));
      assert.ok(!first.filterOptions.race.includes("Gnome")); assert.ok(!first.filterOptions.race.includes("Night Elf"));
      assert.ok(first.filterOptions.race.includes("Tauren"), "options should remain available outside the selected filters");
      assert.equal((await service.leaderboard({ ...filters, faction: "Alliance" })).total, 0);
      assert.equal((await service.leaderboard({ ruleset: "Hardcore" })).total, 1);
      await assert.rejects(service.leaderboard({ race: { $ne: "Human" } }), /invalid_input/);
      await ForeverCharacter.deleteMany({ slug: /^filter-/ });
    });
    await t.test("Twitch-only filtering includes offline channels before pagination and statistics", async () => {
      const base = { region: "eu", source: "admin", status: "tracked", level: 20, faction: "Horde", ruleset: "Normal", guild: { region: "eu", slug: "stream-filter-guild", name: "Stream Filter Guild" } };
      await ForeverCharacter.insertMany([
        ...Array.from({ length: 51 }, (_, index) => ({ ...base, slug: `stream-filter-${index}`, name: `Streamer ${index}`, twitchChannel: `streamer_${index}`, twitchIsLive: index === 0 })),
        { ...base, slug: "stream-filter-unknown", twitchChannel: "unknown_status", faction: "Alliance" },
        { ...base, slug: "stream-filter-missing", level: 60, twitchIsLive: true },
        { ...base, slug: "stream-filter-empty", twitchChannel: "" },
        { ...base, slug: "stream-filter-null", twitchChannel: null },
        { ...base, slug: "stream-filter-private", twitchChannel: "private", status: "pending" },
        { ...base, slug: "stream-filter-us", twitchChannel: "us_channel", region: "us" },
      ]);
      try {
        const filters = { guild: base.guild.name, twitch: "only" };
        const first = await service.leaderboard(filters);
        const second = await service.leaderboard({ ...filters, page: 2 });
        const all = await service.leaderboard({ guild: base.guild.name });
        assert.equal(first.total, 52); assert.equal(first.characters.length, 50); assert.equal(second.characters.length, 2);
        const characters = [...first.characters, ...second.characters];
        assert.ok(characters.every((character) => character.twitchChannel));
        assert.equal(characters.filter((character) => character.twitchIsLive === false).length, 50);
        assert.ok(characters.some((character) => character.slug === "stream-filter-unknown"));
        assert.deepEqual(first.statistics, second.statistics);
        assert.equal(first.statistics.averageLevel, 20);
        assert.equal(first.statistics.atMaxLevel, 0);
        assert.equal(all.total, 55);
        assert.equal((await service.leaderboard({ guild: base.guild.name, twitch: "" })).total, all.total);
        assert.equal(first.totalRanked, all.totalRanked);
        assert.equal(first.characters[0].rank, all.characters.find((character) => String(character._id) === String(first.characters[0]._id))?.rank);
        assert.equal((await service.leaderboard({ ...filters, faction: "Alliance", ruleset: "Normal" })).total, 1);
        assert.equal((await service.leaderboard({ ...filters, search: "Streamer 50" })).total, 1);
        await assert.rejects(service.leaderboard({ twitch: "live" }), /invalid_input/);
        await assert.rejects(service.leaderboard({ twitch: { $ne: "" } }), /invalid_input/);
      } finally { await ForeverCharacter.deleteMany({ slug: /^stream-filter-/ }); }
    });
    await t.test("all persisted feature collections are isolated from retail", async () => {
      const names = (await mongoose.connection.db!.listCollections().toArray()).map((entry) => entry.name);
      assert.ok(names.length >= 4); assert.ok(names.every((name) => name.startsWith("forever_")));
    });
    await t.test("guild filtering combines with grouped Skyborne races without changing stored Armory identities", async () => {
      const base = { region: "eu", source: "admin", status: "tracked", level: 22, guild: { region: "eu", slug: "sky-guild", name: "Sky Guild" } };
      await ForeverCharacter.insertMany([
        { ...base, slug: "sky-wind", race: "Windshaper Skyborne", className: "Warrior" },
        { ...base, slug: "sky-order", race: "High Order Skyborne", className: "Mage" },
        { ...base, slug: "sky-other", race: "Human", guild: { region: "eu", slug: "other-guild", name: "Other Guild" } },
        { ...base, slug: "sky-private", status: "pending", guild: { region: "eu", slug: "private-guild", name: "Private Guild" } },
        { ...base, slug: "sky-us", region: "us", guild: { region: "us", slug: "us-guild", name: "US Guild" } },
      ]);
      const board = await service.leaderboard({ guild: "Sky Guild", race: "Skyborne" });
      assert.equal(board.total, 2); assert.ok(board.filterOptions.race.includes("Skyborne"));
      assert.ok(!board.filterOptions.race.includes("Windshaper Skyborne"));
      assert.ok(board.filterOptions.guild.includes("Other Guild"));
      assert.ok(!board.filterOptions.guild.includes("Private Guild")); assert.ok(!board.filterOptions.guild.includes("US Guild"));
      assert.equal((await service.leaderboard({ guild: "Sky Guild", race: "Skyborne", className: "Warrior" })).total, 1);
      assert.equal((await ForeverCharacter.findOne({ slug: "sky-wind" }).lean())?.race, "Windshaper Skyborne");
      await assert.rejects(service.leaderboard({ guild: { $ne: "" } }), /invalid_input/);
      await ForeverCharacter.deleteMany({ slug: /^sky-/ });
    });
    await t.test("readable Unicode character names resolve only tracked EU profiles while old IDs still work", async () => {
      const records = await ForeverCharacter.insertMany([
        { region: "eu", slug: "väinö-korpi", name: "Väinö Korpi", source: "admin", status: "tracked", level: 15 },
        { region: "us", slug: "väinö-korpi", name: "Väinö Korpi", source: "admin", status: "tracked", level: 40 },
        { region: "eu", slug: "private-name", source: "proposal", status: "pending" },
      ]);
      assert.equal((await service.characterDetail("Väinö-Korpi")).level, 15);
      assert.equal((await service.characterDetail(String(records[0]._id))).slug, "väinö-korpi");
      assert.equal((await service.characterDetail(String(records[1]._id))).level, 40);
      await assert.rejects(service.characterDetail("private-name"), /not_found/);
      await assert.rejects(service.characterDetail("bad/name"), /not_found/);
      await assert.rejects(service.characterDetail({ $ne: "" }), /not_found/);
      await ForeverCharacter.deleteMany({ _id: { $in: records.map((record) => record._id) } });
    });
    await t.test("admin search and health filters apply before pagination and escape literal search text", async () => {
      const base = { region: "eu", source: "admin", status: "tracked", errorCode: "upstream_error", guild: { region: "eu", slug: "fel", name: "Fel" } };
      await ForeverCharacter.insertMany(Array.from({ length: 51 }, (_, i) => ({ ...base, slug: `admin-search-${i}`, name: `Search [${i}]` })));
      const first = await service.adminOverview({ search: "Fel", health: "errors" });
      const second = await service.adminOverview({ search: "Fel", health: "errors", characterPage: 2 });
      assert.equal(first.totalCharacters, 51); assert.equal(first.characters.length, 50); assert.equal(second.characters.length, 1);
      assert.equal((await service.adminOverview({ search: "[0]" })).totalCharacters, 1);
      assert.equal((await service.adminOverview({ search: ".*" })).totalCharacters, 0);
      await assert.rejects(service.adminOverview({ search: { $ne: "" } }), /invalid_input/);
      await assert.rejects(service.adminOverview({ health: "unknown" }), /invalid_input/);
      const guildView = await service.adminOverview({ guildSearch: "Test", guildStatus: "paused" });
      assert.equal(guildView.totalGuilds, 1); assert.equal(guildView.guilds[0].rosterCount, 1);
      const detail = await service.guildDetail(String(guildView.guilds[0]._id));
      assert.equal(detail.roster[0].trackingStatus, "paused");
      await ForeverCharacter.deleteMany({ slug: /^admin-search-/ });
    });
    await t.test("bounded admin bulk actions and failed retries preserve cooldowns, snapshots and shared pauses", async () => {
      const next = new Date(Date.now() + 3600_000);
      const records = await ForeverCharacter.insertMany([
        { region: "eu", slug: "admin-retry", source: "admin", status: "tracked", level: 20, failures: 4, errorCode: "upstream_error", lastAttemptAt: new Date(0), nextFetchAt: next },
        { region: "eu", slug: "admin-cooldown", source: "admin", status: "tracked", lastAttemptAt: new Date(), nextFetchAt: next },
        { region: "eu", slug: "admin-paused", source: "admin", status: "paused", nextFetchAt: next },
        { region: "eu", slug: "admin-pending", source: "proposal", status: "pending", nextFetchAt: next },
      ]);
      const ids = records.map((r) => String(r._id));
      await ForeverWorker.updateOne({ _id: "armory" }, { $set: { nextRequestAt: next, errorCode: "upstream_error" } });
      assert.deepEqual(await service.adminCharacterAction([...ids, ids[0]], "retry"), { updated: 1, skipped: 3 });
      const retried = await ForeverCharacter.findById(ids[0]).lean();
      assert.equal(retried?.failures, 4); assert.equal(retried?.level, 20); assert.ok(retried!.nextFetchAt!.getTime() < next.getTime());
      assert.equal((await ForeverWorker.findById("armory").lean())!.nextRequestAt!.getTime(), next.getTime());
      assert.deepEqual(await service.adminCharacterAction(ids, "rejected"), { updated: 1, skipped: 3 });
      assert.deepEqual(await service.adminCharacterAction(ids, "paused"), { updated: 2, skipped: 2 });
      assert.deepEqual(await service.adminCharacterAction(ids, "tracked"), { updated: 4, skipped: 0 });
      await assert.rejects(service.adminCharacterAction([], "retry"), /invalid_input/);
      await assert.rejects(service.adminCharacterAction(Array(51).fill(ids[0]), "retry"), /invalid_input/);
      await assert.rejects(service.adminCharacterAction([ids[0], "bad-id"], "paused"), /not_found/);
      assert.equal((await ForeverCharacter.findById(ids[0]).lean())?.status, "tracked");
      const guild = await ForeverGuild.create({ region: "eu", slug: "admin-fel", name: "Fel", status: "pending", failures: 4, errorCode: "upstream_error", lastAttemptAt: new Date(0), nextFetchAt: next });
      assert.deepEqual(await service.refreshGuild(String(guild._id)), { updated: 1, skipped: 0 });
      await ForeverGuild.updateOne({ _id: guild._id }, { $set: { lastAttemptAt: new Date() } });
      assert.deepEqual(await service.refreshGuild(String(guild._id)), { updated: 0, skipped: 1 });
      await ForeverGuild.updateOne({ _id: guild._id }, { $set: { lastAttemptAt: new Date(0), status: "paused" } });
      assert.deepEqual(await service.refreshGuild(String(guild._id)), { updated: 0, skipped: 1 });
      assert.equal((await ForeverGuild.findById(guild._id).lean())?.roster.length, 0);
      await ForeverCharacter.deleteMany({ _id: { $in: ids } }); await ForeverGuild.deleteOne({ _id: guild._id });
    });
  } finally {
    // The randomly named database is created solely by this test run.
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
