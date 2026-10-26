/// <reference path="../src/types/express-session.d.ts" />
process.env.BLIZZARD_CLIENT_ID = "pack-batch-test";
process.env.BLIZZARD_CLIENT_SECRET = "pack-batch-test";
import assert from "node:assert/strict";
import test, { before, beforeEach, after, mock } from "node:test";
import mongoose from "mongoose";
import express from "express";
import { Server } from "node:http";
import ccg from "../src/services/ccg.service";
import ccgRouter from "../src/routes/ccg";
import User from "../src/models/User";
import Card from "../src/models/CcgCard";
import SetModel from "../src/models/CcgSet";
import Balance from "../src/models/CcgPackBalance";
import Ledger from "../src/models/CcgLedgerEntry";
import Opening from "../src/models/CcgPackOpening";
import QualityProgress from "../src/models/CcgQualityProgress";
import Ownership from "../src/models/CcgOwnership";
import { CCG_GUEST_COOKIE, CCG_PACK_BALANCE_VERSION } from "../src/config/ccg";

// Dedicated disposable replica set; this suite never loads .env or deployment credentials.
const database = `ccg_pack_batch_test_${process.pid}`;
const ownerId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();
const req = { session: { userId: String(ownerId) } } as any;
let server: Server;
let url: string;
let poolCardIds: mongoose.Types.ObjectId[] = [];
let poolSetId: mongoose.Types.ObjectId;
let pickIndex = 0;

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27141/${database}?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  for (const model of Object.values(mongoose.models)) await model.init();
  mock.method(ccg as any, "enqueuePackOpeningAnalytics", () => undefined);
  // Deterministic pools: each pack draws the next five cards, so packs in a batch differ.
  mock.method(ccg as any, "selectPackResults", async () => ({
    version: "fixture",
    sourceSetIds: [poolSetId],
    results: Array.from({ length: 5 }, () => ({ cardId: poolCardIds[pickIndex++ % poolCardIds.length], missingCardAlternatives: [] })),
  }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: req.headers["x-test-user"] } as any; next(); });
  app.use("/api/ccg", ccgRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ccg`;
});

beforeEach(async () => {
  for (const model of Object.values(mongoose.models)) await model.collection.deleteMany({});
  pickIndex = 0;
  await User.collection.insertMany([ownerId, otherId].map((id, index) => ({ _id: id, discord: { id: `batch-test-${index}`, username: `Tester${index}` }, pickems: [] })));
  poolSetId = new mongoose.Types.ObjectId();
  await SetModel.collection.insertOne({ _id: poolSetId, zoneId: 9001, kind: "raid", state: "current", slug: "batch-fixture", raidName: "Batch Fixture" });
  poolCardIds = Array.from({ length: 40 }, () => new mongoose.Types.ObjectId());
  await Card.collection.insertMany(poolCardIds.map((cardId, index) => ({
    _id: cardId,
    setId: poolSetId,
    characterId: new mongoose.Types.ObjectId(),
    snapshotVersion: 1,
    name: `Fixture${index}`,
    tierGrade: "B",
    setNumber: index + 1,
  })));
  await setPacks(ownerId, 12);
  await setPacks(otherId, 12);
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function setPacks(userId: mongoose.Types.ObjectId, remaining: number) {
  await Balance.updateOne(
    { ownerType: "user", ownerId: userId },
    { $set: { remaining, grantVersion: CCG_PACK_BALANCE_VERSION, lastRechargeAt: new Date(), hasPlayed: true } },
    { upsert: true },
  );
}

async function remainingPacks(userId = ownerId) {
  return (await Balance.findOne({ ownerType: "user", ownerId: userId }).lean())?.remaining;
}

async function request(path: string, body?: unknown, userId = ownerId) {
  return fetch(url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-test-user": String(userId) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("a batch opens every pack in one go as separate openings that share a batch ID", async () => {
  const batch = await ccg.openPackBatch(req, {} as any, { idempotencyKey: "batch-open-five", count: 5 }) as any;

  assert.equal(batch.openings.length, 5);
  assert.ok(mongoose.Types.ObjectId.isValid(batch.batchId));
  for (const opening of batch.openings) {
    assert.equal(opening.batchId, batch.batchId);
    assert.equal(opening.results.length, 5);
    assert.ok(opening.cacheUpdates, "Fresh openings carry cache updates like single packs do");
  }
  const cardIds = batch.openings.flatMap((opening: any) => opening.results.map((result: any) => result.card.id));
  assert.equal(new Set(cardIds).size, 25, "Each pack drew its own cards");

  const stored = await Opening.find({ ownerId }).sort({ _id: 1 }).lean();
  assert.deepEqual(stored.map((opening) => opening.idempotencyKey), [1, 2, 3, 4, 5].map((n) => `batch-open-five:${n}`));
  assert.ok(stored.every((opening) => String(opening.batchId) === batch.batchId));
  assert.equal(await remainingPacks(), 7);
  assert.equal(await Ledger.countDocuments({ ownerId, action: "pack_open" }), 5);
  assert.equal(batch.openings.at(-1).cacheUpdates.packs.totalRemaining, 7, "The last pack reports the balance after the whole batch");
  assert.equal(
    batch.openings.reduce((total: number, opening: any) => total + opening.cacheUpdates.ownedCardsBySetDelta[String(poolSetId)], 0),
    25,
  );
});

test("bad-luck protection carries across packs inside the batch", async () => {
  const batch = await ccg.openPackBatch(req, {} as any, { idempotencyKey: "batch-pity-carry", count: 5 }) as any;
  const progress = await QualityProgress.findOne({ ownerId }).lean() as any;
  const last = batch.openings.at(-1).cacheUpdates.qualityProtection;
  for (const [finish, counter] of Object.entries(last)) {
    assert.equal(progress?.[finish], counter, `${finish} counter is saved after the final pack`);
  }
  // Every counter rises by one per card and only resets on its own finish, so an unrolled
  // astral reads 25 after the batch; restarting protection per pack would leave it at 5.
  const finishes = batch.openings.flatMap((opening: any) => opening.results.map((result: any) => result.finish));
  if (!finishes.includes("astral")) assert.equal(progress?.astral, 25);
  if (!finishes.includes("negative") && !finishes.includes("astral")) assert.equal(progress?.negative, 25);
  for (let index = 1; index < batch.openings.length; index += 1) {
    const before = batch.openings[index - 1].cacheUpdates.qualityProtection.astral;
    const after = batch.openings[index].cacheUpdates.qualityProtection.astral;
    const rolledAstral = batch.openings[index].results.some((result: any) => result.finish === "astral");
    if (!rolledAstral) assert.equal(after, before + 5, `pack ${index + 1} continues from pack ${index}`);
  }
});

test("ownership upserts use the owner-series index and preserve existing quantities", async () => {
  const card = await Card.findById(poolCardIds[0]).lean();
  assert.ok(card);
  // Many collectors own this character, but an acquisition must touch only its owner.
  await Ownership.collection.insertMany(Array.from({ length: 300 }, () => ({
    ownerType: "user", ownerId: new mongoose.Types.ObjectId(), cardId: card._id,
    setId: card.setId, characterId: card.characterId, finish: "standard", quantity: 1,
  })));
  const originalBulkWrite = Ownership.collection.bulkWrite;
  const filters: Record<string, any>[] = [];
  const capture = mock.method(Ownership.collection, "bulkWrite", function (operations: any[], options: any) {
    filters.push(...operations.map((operation) => operation.updateOne.filter));
    return originalBulkWrite.call(Ownership.collection, operations, options);
  });
  try {
    const result = { cardId: card._id, setId: card.setId, characterId: card.characterId,
      snapshotVersion: 1, finish: "standard", artVariant: "standard" };
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await (ccg as any).addOwnership({ ownerType: "user", ownerId }, [result], session);
        await (ccg as any).addOwnership({ ownerType: "user", ownerId }, [result], session);
      });
    } finally {
      await session.endSession();
    }
  } finally {
    capture.mock.restore();
  }
  const owned = await Ownership.find({ ownerId }).lean();
  assert.equal(owned.length, 1, "Both acquisitions update the same ownership row");
  assert.equal(owned[0].quantity, 2);
  assert.equal(String(owned[0].setId), String(card.setId), "Upserts retain equality fields");
  assert.equal(String(owned[0].characterId), String(card.characterId));
  assert.equal(await Ownership.countDocuments({ ownerId: { $ne: ownerId }, quantity: 1 }), 300);
  assert.equal(filters.length, 2);
  for (const q of filters) {
    // Explain the actual driver update without executing another acquisition.
    const explanation = await mongoose.connection.db!.command({
      explain: { update: Ownership.collection.name, updates: [{ q, u: { $inc: { quantity: 1 } }, upsert: true }] },
      verbosity: "executionStats", maxTimeMS: 5000,
    });
    assert.match(JSON.stringify(explanation.queryPlanner.winningPlan), /ccg_ownership_owner_series_finish/);
    assert.equal(explanation.executionStats.totalDocsExamined, 1);
  }
  assert.equal((await Ownership.findOne({ ownerId }).lean())?.quantity, 2, "Explain never writes");
});

test("replaying a batch key returns the same packs without spending more", async () => {
  const body = { idempotencyKey: "batch-replay-key", count: 5 };
  const first = await ccg.openPackBatch(req, {} as any, body) as any;
  const replay = await ccg.openPackBatch(req, {} as any, body) as any;

  assert.equal(replay.batchId, first.batchId);
  assert.deepEqual(replay.openings.map((opening: any) => opening.id), first.openings.map((opening: any) => opening.id));
  assert.equal(await remainingPacks(), 7);
  assert.equal(await Opening.countDocuments({ ownerId }), 5);
});

test("concurrent requests with the same batch key open the batch once", async () => {
  const body = { idempotencyKey: "batch-concurrent-key", count: 5 };
  const results = await Promise.allSettled([
    ccg.openPackBatch(req, {} as any, body),
    ccg.openPackBatch(req, {} as any, body),
  ]);
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled");
  assert.ok(fulfilled.length >= 1);
  const batchIds = new Set(fulfilled.map((result) => result.value.batchId));
  assert.equal(batchIds.size, 1);
  for (const result of results) {
    if (result.status === "rejected") assert.equal((result.reason as any).code, "pack_open_busy");
  }
  assert.equal(await Opening.countDocuments({ ownerId }), 5);
  assert.equal(await remainingPacks(), 7);
});

test("a batch larger than the balance opens nothing", async () => {
  await setPacks(ownerId, 3);
  await assert.rejects(
    ccg.openPackBatch(req, {} as any, { idempotencyKey: "batch-not-enough", count: 5 }),
    { code: "no_packs" },
  );
  assert.equal(await remainingPacks(), 3);
  assert.equal(await Opening.countDocuments({ ownerId }), 0);
  assert.equal(await Ledger.countDocuments({ ownerId }), 0);
  assert.equal(await QualityProgress.countDocuments({ ownerId }), 0, "The rolled-back batch leaves no protection progress behind");
});

test("batch counts and keys are validated", async () => {
  for (const count of [1, 6, 2.5, "5", undefined]) {
    await assert.rejects(ccg.openPackBatch(req, {} as any, { idempotencyKey: "batch-bad-count", count }), { code: "invalid_pack_count" });
  }
  await assert.rejects(
    ccg.openPackBatch(req, {} as any, { idempotencyKey: `x${"y".repeat(118)}`, count: 5 }),
    { code: "invalid_idempotency_key" },
    "A batch key must leave room for the per-pack suffix",
  );
  assert.equal(await remainingPacks(), 12);
});

test("a batch key that collides with an earlier single pack is refused", async () => {
  await ccg.openPack(req, {} as any, { idempotencyKey: "batch-collide:1" });
  await assert.rejects(
    ccg.openPackBatch(req, {} as any, { idempotencyKey: "batch-collide", count: 5 }),
    { code: "idempotency_conflict" },
  );
  assert.equal(await remainingPacks(), 11);
});

test("single pack opening is unchanged and carries no batch ID", async () => {
  const opening = await ccg.openPack(req, {} as any, { idempotencyKey: "single-after-refactor" }) as any;
  assert.equal(opening.results.length, 5);
  assert.equal(opening.batchId, undefined);
  assert.equal(opening.cacheUpdates.packs.totalRemaining, 11);
  const stored = await Opening.findById(opening.id).lean();
  assert.equal(stored?.batchId, null);
  const replay = await ccg.openPack(req, {} as any, { idempotencyKey: "single-after-refactor" }) as any;
  assert.equal(replay.id, opening.id);
  assert.equal(await remainingPacks(), 11);
});

test("the batch routes open and recover a batch for its owner only", async () => {
  const opened = await request("/packs/open-batch", { idempotencyKey: "batch-route-open", count: 5 });
  assert.equal(opened.status, 200);
  const batch = await opened.json() as any;
  assert.equal(batch.openings.length, 5);

  const recovered = await request(`/openings/batch/${batch.batchId}`);
  assert.equal(recovered.status, 200);
  const recoveredBody = await recovered.json() as any;
  assert.equal(recoveredBody.batchId, batch.batchId);
  assert.deepEqual(recoveredBody.openings.map((opening: any) => opening.id), batch.openings.map((opening: any) => opening.id));

  const foreign = await request(`/openings/batch/${batch.batchId}`, undefined, otherId);
  assert.equal(foreign.status, 404);
  const malformed = await request("/openings/batch/not-an-id");
  assert.equal(malformed.status, 400);
  const single = await request(`/openings/${batch.openings[0].id}`);
  assert.equal(single.status, 200, "Each pack in a batch is still recoverable on its own");
});

test("a batch can be shared once and read back with all of its packs", async () => {
  const batch = await ccg.openPackBatch(req, {} as any, { idempotencyKey: "batch-share-open", count: 5 }) as any;

  const created = await request("/shares/batch", { batchId: batch.batchId });
  assert.equal(created.status, 200);
  const link = await created.json() as any;
  assert.equal(link.kind, "batch");
  assert.equal(link.path, `/ccg/share/${link.id}`);
  const again = await (await request("/shares/batch", { batchId: batch.batchId })).json() as any;
  assert.equal(again.id, link.id, "Sharing the same batch twice reuses its link");

  const shared = await (await request(`/shares/${link.id}`)).json() as any;
  assert.equal(shared.kind, "batch");
  assert.equal(shared.batch.batchId, batch.batchId);
  assert.deepEqual(shared.batch.openings.map((opening: any) => opening.id), batch.openings.map((opening: any) => opening.id));
  assert.ok(shared.batch.openings.every((opening: any) => opening.results.length === 5));

  const foreign = await request("/shares/batch", { batchId: batch.batchId }, otherId);
  assert.equal(foreign.status, 404, "Only the owner can share a batch");
  const anonymous = await fetch(`${url}/shares/batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: batch.batchId }) });
  assert.equal(anonymous.status, 401);
});

test("a guest's batch moves to the account on first login and can then be recovered and shared", async () => {
  let guestToken = "";
  const guestRes = { cookie: (_name: string, value: string) => { guestToken = value; } } as any;
  await ccg.resolveOwner({ session: {} } as any, guestRes);
  assert.ok(guestToken, "A guest cookie is issued");
  const guestReq = { session: {}, cookies: { [CCG_GUEST_COOKIE]: guestToken } } as any;

  const single = await ccg.openPack(guestReq, guestRes, { idempotencyKey: "guest-single-pack" }) as any;
  const batch = await ccg.openPackBatch(guestReq, guestRes, { idempotencyKey: "guest-batch-pack", count: 5 }) as any;
  assert.equal(batch.openings.length, 5);

  const newUserId = new mongoose.Types.ObjectId();
  await User.collection.insertOne({ _id: newUserId, discord: { id: "batch-test-new", username: "Newcomer" }, pickems: [] });
  const loginReq = { session: { userId: String(newUserId) }, cookies: { [CCG_GUEST_COOKIE]: guestToken } } as any;
  // The open page passes the combined opening's ID, which is the batch's last pack.
  const claim = await ccg.claimGuest(loginReq, { idempotencyKey: "guest-batch-claim", openingId: batch.openings.at(-1).id }) as any;
  assert.equal(claim.claimed, true);
  assert.equal(claim.cards, 30, "The single pack and all five batch packs move over");

  const claimedOpenings = await Opening.find({ batchId: new mongoose.Types.ObjectId(batch.batchId) }).lean();
  assert.equal(claimedOpenings.length, 5);
  assert.ok(claimedOpenings.every((opening) => String(opening.claimedByUserId) === String(newUserId)));
  assert.ok(await Opening.exists({ _id: single.id, claimedByUserId: newUserId }));

  const userOwner = { ownerType: "user" as const, ownerId: newUserId, dateKey: "2026-10-26" };
  const recovered = await ccg.getOpeningBatch(userOwner, batch.batchId) as any;
  assert.deepEqual(recovered.openings.map((opening: any) => opening.id), batch.openings.map((opening: any) => opening.id));

  const shared = await request("/shares/batch", { batchId: batch.batchId }, newUserId);
  assert.equal(shared.status, 200, "A claimed guest batch can be shared like a claimed guest pack");
  assert.equal(await Opening.countDocuments({ batchId: new mongoose.Types.ObjectId(batch.batchId), dateKey: null }), 5);
});
