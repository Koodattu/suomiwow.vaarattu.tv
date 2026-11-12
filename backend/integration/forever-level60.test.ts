import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import { ArmoryError } from "../src/features/forever/forever-armory";
import { ForeverLevel60Runner } from "../src/features/forever/forever-level60.worker";
import { ForeverRunner } from "../src/features/forever/forever.worker";
import { ForeverCharacter, ForeverWorker } from "../src/features/forever/forever.models";
import { characterDetail } from "../src/features/forever/forever.service";
import { leaderboard, stopForeverLeaderboard } from "../src/features/forever/forever-leaderboard";

test("level 60 worker backfills once, honors upstream delays and ranks by corroborated time", { skip: !process.env.FOREVER_TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.FOREVER_TEST_MONGODB_URI!, { dbName: `forever_cap_test_${randomUUID()}` });
  try {
    await ForeverWorker.create({ _id: "level60" });
    const tick = async (runner: ForeverLevel60Runner) => {
      await ForeverWorker.updateOne({ _id: "level60" }, { $set: { nextRequestAt: new Date(0) } });
      await runner.tick();
    };
    const seen = new Date("2026-11-09T12:25:56Z"), previous = new Date("2026-11-09T08:32:57Z");
    const at = new Date("2026-11-09T11:18:00Z");
    const base = { region: "eu", source: "admin", status: "tracked", className: "Hunter", level: 60, lastLevelAt: seen } as const;
    const history = [{ level: 58, observedAt: previous }, { level: 60, observedAt: seen }];
    await ForeverCharacter.create({ ...base, slug: "test-hunter", history });
    let requests = 0;
    const runner = new ForeverLevel60Runner(async slug => {
      requests++;
      return { character: { slug }, achievements: [{ id: 61993, achievement: { id: 61993 }, criteria: { is_completed: true }, completed_timestamp: at.getTime() }] };
    });
    // Two workers race for the same previously tracked 60.
    await Promise.all([runner.tick(), runner.tick()]);
    assert.equal(requests, 1);
    const hunter = await characterDetail("test-hunter");
    assert.deepEqual(hunter.estimatedLevel60At, at);
    assert.deepEqual(hunter.lastLevelAt, seen);
    assert.deepEqual(hunter.history.map(p => p.observedAt), [previous, seen]);
    await ForeverCharacter.create({ ...base, slug: "first-seen-capped", lastLevelAt: new Date(at.getTime() + 60_000),
      history: [{ level: 60, observedAt: new Date(at.getTime() + 60_000) }] });
    await tick(runner);
    await tick(runner);
    assert.equal(requests, 1, "completed or uncorroborated characters need no further requests");
    assert.deepEqual((await leaderboard()).characters.map(c => c.slug), ["test-hunter", "first-seen-capped"]);
    await ForeverCharacter.create({ ...base, slug: "new-hunter", history });
    await tick(new ForeverLevel60Runner(async () => { throw new ArmoryError("upstream_error", 429, 3600_000); }));
    const retry = await ForeverCharacter.findOne({ slug: "new-hunter" }).lean();
    assert.ok(retry!.level60NextCheckAt!.getTime() > Date.now() + 3500_000);
    assert.ok((await ForeverWorker.findById("level60"))!.nextRequestAt.getTime() > Date.now() + 3500_000);
    assert.equal(retry!.estimatedLevel60At, undefined);
    assert.equal(retry!.failures, 0);
    await ForeverCharacter.updateOne({ slug: "new-hunter" }, { $set: { level60NextCheckAt: new Date(0) } });
    await tick(new ForeverLevel60Runner(async slug => {
      await ForeverCharacter.updateOne({ slug }, { $set: { status: "paused" } });
      return { character: { slug }, achievements: [] };
    }));
    assert.equal((await ForeverCharacter.findOne({ slug: "new-hunter" }))!.level60NextCheckAt!.getTime(), 0);

    await ForeverWorker.create({ _id: "armory" });
    await ForeverCharacter.updateOne({ slug: "test-hunter" }, { $set: { rosterLevel: 60, rosterObservedAt: seen, refreshRequestedAt: new Date() } });
    await new ForeverRunner({
      character: async identity => ({ ...identity, level: 59, sourceUpdatedAt: new Date(at.getTime() + 60_000),
        name: "Test Hunter", className: "Hunter", race: "Human", faction: "Alliance", ruleset: "Normal", guild: null }),
      roster: async () => [],
    }).tick();
    const corrected = await characterDetail("test-hunter");
    assert.equal(corrected.estimatedLevel60At, undefined, "later evidence of 59 disproves the account milestone");
    assert.equal(corrected.level, 60);
    assert.deepEqual(corrected.lastLevelAt, seen);
  } finally {
    await stopForeverLeaderboard();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
