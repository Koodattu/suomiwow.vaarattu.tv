import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import mongoose from "mongoose";
import ReportOverride from "../src/models/ReportOverride";
import Guild from "../src/models/Guild";
import policy from "../src/services/report-override-policy.service";
import leases, { IngestionLeaseService, IngestionLeaseLostError, INGESTION_LEASE_MS } from "../src/services/ingestion-lease.service";
import { acquireGuildIngestionLease } from "../src/services/guild-ingestion-lease.service";

// Disposable local replica set only. Never load deployment configuration.
const database = `ingestion_leases_test_${process.pid}`;
const code = "LeaseTestReport";
const guildId = new mongoose.Types.ObjectId();
const Result = mongoose.model("IngestionLeaseTestResult", new mongoose.Schema({ value: Number }));
const tokens = new Set<string>();

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27140/${database}?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([ReportOverride.init(), Guild.init(), Result.init()]);
});
after(async () => {
  for (const token of tokens) await leases.release(token);
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  for (const token of tokens) await leases.release(token);
  tokens.clear();
  await ReportOverride.deleteMany({});
  await Guild.deleteMany({});
  await Result.deleteMany({});
  await Guild.collection.insertOne({ _id: guildId, name: "Lease test", realm: "Test", region: "EU" });
});

async function acquire(reportCode = code) {
  const token = await policy.acquire(reportCode);
  tokens.add(token);
  return token;
}
async function expire() {
  await ReportOverride.updateOne({ code }, { $set: { leaseExpiresAt: new Date(Date.now() - 1) } });
}

test("simultaneous report acquisitions elect one writer", async () => {
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => acquire()));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected" && r.reason.code === "report_busy").length, 7);
});

test("a crashed report owner is recoverable within the lease window, preserving corrections", async () => {
  // An abandoned persisted lease represents a process that died without finally.
  await ReportOverride.create({ code, lockToken: "dead-worker", lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() - 1), exclusions: [{ guildId }] });
  const token = await acquire();
  const stored = await ReportOverride.findOne({ code }).lean();
  assert.equal(stored!.lockToken, token);
  assert.equal(String(stored!.exclusions[0].guildId), String(guildId));
  assert.ok(stored!.leaseExpiresAt!.getTime() <= Date.now() + INGESTION_LEASE_MS);
});

test("expired owners cannot write or release a successor's lease", async () => {
  const old = await acquire();
  await expire();
  await assert.rejects(leases.writeFor(old, async () => Result.create({ value: 1 })), IngestionLeaseLostError);
  const next = await acquire();
  await leases.writeFor(next, async () => Result.create({ value: 2 }));
  await assert.rejects(leases.writeFor(old, async () => Result.updateMany({}, { value: 9 })), IngestionLeaseLostError);
  await policy.release(code, old);
  assert.equal((await ReportOverride.findOne({ code }))!.lockToken, next);
  assert.deepEqual((await Result.find().lean()).map((r) => r.value), [2]);
});

test("fenced writes roll back saves, updates and bulk writes together", async () => {
  const token = await acquire();
  const original = await Result.create({ value: 0 });
  await assert.rejects(leases.writeFor(token, async () => {
    await Result.updateOne({ _id: original._id }, { value: 1 });
    await Result.bulkWrite([{ insertOne: { document: { value: 2 } } }]);
    await new Result({ value: 3 }).save();
    throw new Error("abort all writes");
  }), /abort all writes/);
  assert.deepEqual((await Result.find().lean()).map((r) => r.value), [0]);
});

test("documents returned by one fenced transaction can be saved in a later fenced transaction", async () => {
  const token = await acquire();
  const doc = await leases.writeFor(token, async () => Result.create({ value: 1 }));
  const loaded = await leases.writeFor(token, async () => Result.findById(doc._id));
  loaded!.value = 2;
  await leases.writeFor(token, async () => loaded!.save());
  loaded!.value = 3;
  await assert.rejects(leases.writeFor(token, async () => {
    await loaded!.save();
    throw new Error("rollback reused document");
  }), /rollback reused document/);
  assert.equal((await Result.findById(doc._id))!.value, 2);
});

test("takeover cannot commit between the ownership fence and the data write", async () => {
  const old = await acquire();
  let announce!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((r) => { announce = r; });
  const resumeWrite = new Promise<void>((r) => { resume = r; });
  const writing = leases.writeFor(old, async () => {
    announce();
    await resumeWrite;
    await Result.create({ value: 1 });
  });
  await entered;
  // Force a takeover attempt, including a stale lease observation. Its update
  // must conflict/wait on the same lock document until the fenced write commits.
  let takeoverFinished = false;
  const takingOver = ReportOverride.collection.updateOne({ code }, { $set: { lockToken: "successor" } })
    .then(() => { takeoverFinished = true; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(takeoverFinished, false);
  resume();
  await writing;
  await takingOver;
  await assert.rejects(leases.writeFor(old, async () => Result.create({ value: 2 })), IngestionLeaseLostError);
  assert.deepEqual((await Result.find().lean()).map((r) => r.value), [1]);
});

test("guild lease expiry also blocks report writes and permits a new guild update", async () => {
  const guildToken = new mongoose.Types.ObjectId().toHexString();
  tokens.add(guildToken);
  assert.ok(await acquireGuildIngestionLease(String(guildId), guildToken));
  assert.equal(await acquireGuildIngestionLease(String(guildId), "competitor"), null);
  const reportToken = await acquire();
  await leases.run(guildToken, async () => {
    await Guild.updateOne({ _id: guildId }, { $set: { wclUpdateLeaseExpiresAt: new Date(0) } });
    await assert.rejects(leases.writeFor(reportToken, async () => Result.create({ value: 1 })), IngestionLeaseLostError);
  });
  const next = new mongoose.Types.ObjectId().toHexString();
  tokens.add(next);
  assert.ok(await acquireGuildIngestionLease(String(guildId), next));
  await leases.release(guildToken);
  assert.equal((await Guild.findById(guildId))!.wclUpdateLockToken, next);
});

test("legacy locks keep their original timeout and are not stolen during rollout", async () => {
  await ReportOverride.create({ code, lockToken: "legacy", lockedAt: new Date() });
  await assert.rejects(acquire(), (e: any) => e.code === "report_busy");
  await ReportOverride.updateOne({ code }, { lockedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 - 1) });
  assert.ok(await acquire());
});

test("a background importer returning from WCL after takeover cannot save fights", async (t) => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const { default: processor } = await import("../src/services/background-guild-processor.service");
  const { default: wcl } = await import("../src/services/warcraftlogs.service");
  const { default: Fight } = await import("../src/models/Fight");
  const { default: Report } = await import("../src/models/Report");
  await Promise.all([Report.init(), Fight.init()]);
  let announce!: () => void;
  let resume!: () => void;
  const requested = new Promise<void>((r) => { announce = r; });
  const response = new Promise<void>((r) => { resume = r; });
  t.mock.method(wcl, "getDeathEventsForReport", async () => {
    announce();
    await response;
    return {} as any;
  });
  t.mock.method(wcl, "determinePhaseInfo", () => ({}) as any);
  const importing = (processor as any).processReport({
    code, startTime: Date.now(), endTime: Date.now(), zone: { id: 53 },
    fights: [{ id: 1, encounterID: 3429, difficulty: 5, startTime: 0, endTime: 1000 }],
  }, { _id: guildId }, { _id: new mongoose.Types.ObjectId(), name: "test", realm: "test", region: "EU" }, new Set([3429]));
  // Attach the rejection handler before resuming the suspended importer.
  const rejected = assert.rejects(importing, IngestionLeaseLostError);
  await requested;
  await expire();
  const next = await acquire();
  resume();
  await rejected;
  assert.equal(await Fight.countDocuments({ reportCode: code }), 0);
  assert.equal((await ReportOverride.findOne({ code }))!.lockToken, next);
});

test("report character discovery also rejects an expired owner", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const { default: characters } = await import("../src/services/character.service");
  const { default: Character } = await import("../src/models/Character");
  const token = await acquire();
  const observation = { canonicalID: 123, name: "Test", serverSlug: "test", serverRegion: "EU", classID: 8, hidden: false, guildName: "Original", guildRealm: "test" };
  await leases.run(token, () => characters.upsertCharacterFromReport(observation));
  await expire();
  await assert.rejects(leases.run(token, () => characters.upsertCharacterFromReport({ ...observation, guildName: "Stale" })), IngestionLeaseLostError);
  assert.equal((await Character.findOne({ wclCanonicalCharacterId: 123 }))!.guildName, "Original");
});

test("shutdown waits for existing owners, rejects new acquisitions, and never unlocks live work on timeout", async () => {
  const manager = new IngestionLeaseService();
  const token = await acquire();
  manager.track({ model: ReportOverride, filter: { code }, token, tokenField: "lockToken", timeField: "lockedAt", expiryField: "leaseExpiresAt" });
  assert.equal(await manager.drain(10), false);
  assert.throws(() => manager.assertAcceptingWork(), /shutting down/);
  assert.equal((await ReportOverride.findOne({ code }))!.lockToken, token);
  const drained = manager.drain(1000);
  await manager.release(token);
  assert.equal(await drained, true);
});
