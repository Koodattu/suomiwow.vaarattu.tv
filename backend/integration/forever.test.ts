/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { ArmoryError, armoryUrl, ForeverProfile } from "../src/features/forever/forever-armory";
import { ForeverCharacter, ForeverGuild, ForeverRequestLimit, ForeverWorker } from "../src/features/forever/forever.models";
import { ForeverRunner, initializeForever } from "../src/features/forever/forever.worker";
import * as service from "../src/features/forever/forever.service";
import { ForeverTwitchRunner } from "../src/features/forever/forever-twitch";
import { seedForeverCharacters } from "../src/features/forever/forever-seed";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("Forever tracking integration (isolated replica-set database)", { skip: !uri }, async (t) => {
  const database = `forever_test_${randomUUID().replace(/-/g, "")}`;
  await mongoose.connect(uri!, { dbName: database, serverSelectionTimeoutMS: 5000 });
  try {
    await initializeForever();
    const profile: ForeverProfile = { region: "eu", slug: "test-hero", name: "Test Hero", level: 10, className: "Paladin", race: "Human", faction: "Alliance", ruleset: "Normal", sourceUpdatedAt: new Date("2026-11-05T10:00:00Z"), guild: { region: "eu", slug: "test-guild", name: "Test Guild" } };
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
      assert.equal((await seedForeverCharacters()).inserted, 71);
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
    await t.test("all persisted feature collections are isolated from retail", async () => {
      const names = (await mongoose.connection.db!.listCollections().toArray()).map((entry) => entry.name);
      assert.ok(names.length >= 4); assert.ok(names.every((name) => name.startsWith("forever_")));
    });
  } finally {
    // The randomly named database is created solely by this test run.
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
