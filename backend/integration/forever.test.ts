/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { ArmoryError, armoryUrl, ForeverProfile } from "../src/features/forever/forever-armory";
import { ForeverCharacter, ForeverGuild, ForeverRequestLimit, ForeverWorker } from "../src/features/forever/forever.models";
import { ForeverRunner, initializeForever } from "../src/features/forever/forever.worker";
import * as service from "../src/features/forever/forever.service";

const uri = process.env.FOREVER_TEST_MONGODB_URI;
test("Forever tracking integration (isolated replica-set database)", { skip: !uri }, async (t) => {
  const database = `forever_test_${randomUUID().replace(/-/g, "")}`;
  await mongoose.connect(uri!, { dbName: database, serverSelectionTimeoutMS: 5000 });
  try {
    await initializeForever();
    const profile: ForeverProfile = { region: "eu", slug: "test-hero", name: "Test Hero", level: 10, className: "Paladin", race: "Human", faction: "Alliance", ruleset: "Normal", sourceUpdatedAt: new Date("2026-11-05T10:00:00Z"), guild: { region: "eu", slug: "test-guild", name: "Test Guild" } };
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
      assert.equal((await service.leaderboard("eu", "", 1)).total, 0);
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
    await t.test("all persisted feature collections are isolated from retail", async () => {
      const names = (await mongoose.connection.db!.listCollections().toArray()).map((entry) => entry.name);
      assert.ok(names.length >= 4); assert.ok(names.every((name) => name.startsWith("forever_")));
    });
  } finally {
    // The randomly named database is created solely by this test run.
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
