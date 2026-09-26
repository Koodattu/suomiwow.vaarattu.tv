/// <reference path="../src/types/express-session.d.ts" />
process.env.BLIZZARD_CLIENT_ID = "rewards-test";
process.env.BLIZZARD_CLIENT_SECRET = "rewards-test";
import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import mongoose, { ClientSession } from "mongoose";
import express from "express";
import { Server } from "node:http";
import duplicates from "../src/services/ccg-duplicate-rewards.service";
import ccg from "../src/services/ccg.service";
import identity from "../src/services/ccg-character-identity.service";
import rewardsRouter from "../src/routes/ccg-rewards";
import Account from "../src/models/CcgDuplicateRewardAccount";
import Progress from "../src/models/CcgDuplicateRewardProgress";
import User from "../src/models/User";
import Ownership from "../src/models/CcgOwnership";
import Card from "../src/models/CcgCard";
import SetModel from "../src/models/CcgSet";
import Credit from "../src/models/CcgPackCredit";
import Ledger from "../src/models/CcgLedgerEntry";
import Balance from "../src/models/CcgPackBalance";
import Codes from "../src/models/CcgRedeemCode";
import Claims from "../src/models/CcgRedeemClaim";
import Pickem from "../src/models/Pickem";
import Creator from "../src/models/CcgSupporterCreator";
import Source from "../src/models/CcgSupporterCharacter";
import { CCG_PACK_BALANCE_VERSION, CcgSetKind, CcgFinish, getCcgPackFinishOrder } from "../src/config/ccg";

// This suite never loads .env or deployment credentials.
const database = `ccg_rewards_test_${process.pid}`;
const ownerId = new mongoose.Types.ObjectId();
const req = { session: { userId: String(ownerId) } } as any;
let server: Server;
let url: string;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27140/${database}?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  for (const model of Object.values(mongoose.models)) await model.init();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: req.headers["x-test-user"] } as any; next(); });
  app.use("/rewards", rewardsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/rewards`;
});
beforeEach(async () => {
  for (const model of Object.values(mongoose.models)) await model.collection.deleteMany({});
  await User.collection.insertOne({ _id: ownerId, discord: { id: "rewards-test", username: "Tester" }, pickems: [] });
  await Balance.create({ ownerType: "user", ownerId, remaining: 0, grantVersion: CCG_PACK_BALANCE_VERSION, lastRechargeAt: new Date(), hasPlayed: true });
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
async function transaction<T>(fn: (session: ClientSession) => Promise<T>) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => fn(session)); }
  finally { await session.endSession(); }
}
async function fixture(kind: CcgSetKind, extra: number, complete = true) {
  const setId = new mongoose.Types.ObjectId(), characterId = new mongoose.Types.ObjectId(), cardId = new mongoose.Types.ObjectId();
  const custom = kind === "community" ? undefined : "void";
  const finishes = [...getCcgPackFinishOrder(kind, custom)];
  await SetModel.collection.insertOne({ _id: setId, zoneId: parseInt(String(setId).slice(-7), 16), kind, state: "legacy", slug: String(setId), customFinish: custom ? { key: custom, hardPity: 250 } : undefined });
  await Card.collection.insertOne({ _id: cardId, setId, characterId, creatorFinish: kind === "supporter" ? custom : undefined, snapshotVersion: 1, name: "Fixture", tierGrade: "A", setNumber: 1 });
  if (!complete) finishes.pop();
  await Ownership.insertMany(finishes.map((finish, index) => ({ ownerType: "user", ownerId, setId, characterId, cardId, finish, quantity: 1 + (index === 0 ? extra : 0) })));
  return { cardId, setId, characterId, finish: "standard" as CcgFinish, artVariant: "standard" as const, snapshotVersion: 1 };
}
async function acquire(rows: Awaited<ReturnType<typeof fixture>>[]) {
  return transaction(session => (ccg as any).addOwnership({ ownerType: "user", ownerId, dateKey: "2026-09-24" }, rows, session)) as Promise<Array<{ packs: number; progress?: number }>>;
}
async function request(path = "", body?: unknown, authenticated = true) {
  return fetch(url + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", ...(authenticated ? { "x-test-user": String(ownerId) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("lazy initialization runs once, per card, for all three collections and preserves remainders", async () => {
  await fixture("raid", 27); await fixture("community", 14); await fixture("supporter", 9);
  await fixture("raid", 100, false);
  await Promise.all(Array.from({ length: 6 }, () => duplicates.ensure(ownerId)));
  const state = await duplicates.status(ownerId);
  assert.equal(state.availablePacks, 3);
  assert.deepEqual(state.breakdown, { raid: 2, community: 1, supporter: 0 });
  assert.equal(await Account.countDocuments(), 1);
  assert.deepEqual((await Progress.find().sort({ duplicates: 1 })).map(row => row.duplicates), [9, 14, 27]);
  assert.equal(await Credit.countDocuments(), 0, "Historical packs remain unclaimed");
  await Ownership.updateMany({}, { $inc: { quantity: 100 } });
  await duplicates.ensure(ownerId);
  assert.equal((await duplicates.status(ownerId)).availablePacks, 3, "Opening Rewards again never recalculates the baseline");
});

test("empty accounts persist initialization and do not recalculate later", async () => {
  await duplicates.ensure(ownerId);
  await fixture("raid", 20);
  await duplicates.ensure(ownerId);
  assert.equal((await duplicates.status(ownerId)).availablePacks, 0);
});

test("vault sessions and rewards ignore preserved malformed legacy ownership", async () => {
  const card = await fixture("community", 19);
  const validOwnership = await Ownership.collection.find({ ownerId }).sort({ _id: 1 }).toArray();
  const malformed = [
    { cardId: null, finish: null },
    { setId: null, characterId: card.characterId },
    { setId: String(card.setId), characterId: card.characterId },
    { setId: card.setId },
    { setId: card.setId, characterId: null },
    { setId: card.setId, characterId: String(card.characterId) },
  ].map(fields => ({
    _id: new mongoose.Types.ObjectId(), ownerType: "user", ownerId,
    cardId: new mongoose.Types.ObjectId(), finish: "standard", quantity: 5, ...fields,
  }));
  // Bypass schema validation to reproduce records preserved by the ownership migration.
  await Ownership.collection.insertMany(malformed as any);
  const before = await Ownership.collection.find({ ownerId }).sort({ _id: 1 }).toArray();

  const session = await ccg.getSession(req, {} as any);
  assert.equal(session.ownerType, "user");
  assert.equal(session.ownedFinishes, validOwnership.length);
  const response = await request();
  assert.equal(response.status, 200);
  const state = (await response.json() as any).historical;
  assert.equal(state.availablePacks, 1);
  assert.deepEqual(state.breakdown, { raid: 0, community: 1, supporter: 0 });
  assert.equal(await Account.countDocuments({ ownerId }), 1);
  const progress = await Progress.find({ ownerId }).lean();
  assert.equal(progress.length, 1);
  assert.equal(String(progress[0].characterId), String(card.characterId));
  assert.equal(progress[0].duplicates, 19);
  assert.equal(progress[0].processedMilestones, 1);
  assert.equal(await Credit.countDocuments(), 0, "Historical rewards remain unclaimed");
  assert.deepEqual(await Ownership.collection.find({ ownerId }).sort({ _id: 1 }).toArray(), before);
});

test("reward initialization still rejects valid ownership whose set metadata is missing", async () => {
  const card = await fixture("community", 19);
  await SetModel.deleteOne({ _id: card.setId });
  await assert.rejects(duplicates.ensure(ownerId), /Duplicate reward set metadata missing/);
  assert.equal(await Account.countDocuments(), 0);
  assert.equal(await Progress.countDocuments(), 0);
});

test("character identity reconciliation preserves milestones and combines outstanding progress", async () => {
  const card = await fixture("community", 19);
  const target = new mongoose.Types.ObjectId();
  await duplicates.ensure(ownerId);
  await Progress.create({ ownerId, setId: card.setId, characterId: target, duplicates: 19, processedMilestones: 1 });
  await transaction(async session => {
    await (identity as any).migrateOwnership(card.cardId, card.setId, card.characterId, target, session);
    await Card.collection.updateOne({ _id: card.cardId }, { $set: { characterId: target } }, { session });
  });
  const merged = await Progress.findOne({ characterId: target });
  assert.equal(await Progress.countDocuments(), 1);
  assert.equal(merged?.duplicates, 38);
  assert.equal(merged?.processedMilestones, 2);
  assert.deepEqual(await acquire([{ ...card, characterId: target }]), [{ packs: 1, progress: 9 }]);
  assert.deepEqual(await acquire([{ ...card, characterId: target }]), [{ packs: 1, progress: 0 }]);
  assert.equal(await Credit.countDocuments({ source: "duplicate_milestone" }), 2);
  assert.equal((await duplicates.status(ownerId)).availablePacks, 1, "The saved historical entitlement never changes");
});

test("new acquisitions award the tenth duplicate immediately while historical packs remain pending", async () => {
  const card = await fixture("supporter", 27);
  const rewards = await acquire([card, card, card, card]);
  assert.deepEqual(rewards, [{ packs: 0, progress: 8 }, { packs: 0, progress: 9 }, { packs: 1, progress: 0 }, { packs: 0, progress: 1 }]);
  assert.equal((await duplicates.status(ownerId)).availablePacks, 2);
  assert.equal((await Credit.findOne({ source: "duplicate_milestone" }))?.remaining, 1);
  assert.equal((await Progress.findOne())?.duplicates, 31);
  assert.equal(await Ledger.countDocuments({ action: "duplicate_milestone" }), 1);
});

test("the final missing finish does not count; subsequent copies in the same batch do", async () => {
  const card = await fixture("community", 0, false);
  const rows = [{ ...card, finish: "astral" as const }, ...Array.from({ length: 10 }, () => card)];
  const results = await acquire(rows);
  assert.deepEqual(results[0], { packs: 0 });
  assert.equal(results.reduce((sum, row) => sum + row.packs, 0), 1);
  assert.equal((await Progress.findOne())?.duplicates, 10);
});

test("pack opening returns the instant milestone and replaying its request cannot grant it twice", async t => {
  const card = await fixture("raid", 9);
  await Balance.updateOne({ ownerId }, { $set: { remaining: 1 } });
  await Credit.create({ ownerId, source: "duplicate", sourceKey: `completed-series:${card.setId}:${card.characterId}`, remaining: 0 });
  t.mock.method(ccg as any, "selectPackResults", async () => ({ version: "fixture", sourceSetIds: [card.setId],
    results: Array.from({ length: 5 }, () => ({ cardId: card.cardId, missingCardAlternatives: [] })) }));
  t.mock.method(ccg as any, "enqueuePackOpeningAnalytics", () => undefined);
  const body = { idempotencyKey: "reward-opening-retry-test" };
  const opening = await ccg.openPack(req, {} as any, body) as any;
  assert.equal(opening.duplicateRewards, 1);
  assert.equal(opening.results.filter((row: any) => row.duplicateMilestonePacks === 1).length, 1);
  assert.equal(opening.cacheUpdates.packs.totalRemaining, 1);
  const replay = await ccg.openPack(req, {} as any, body) as any;
  assert.equal(replay.id, opening.id);
  assert.equal(replay.duplicateRewards, 1);
  assert.equal((await Progress.findOne())?.duplicates, 14);
  assert.equal(await Credit.countDocuments({ source: "duplicate_milestone" }), 1);
});

test("new finish requirements pause counting without resetting earned progress", async () => {
  const card = await fixture("raid", 19);
  await duplicates.ensure(ownerId);
  await SetModel.updateOne({ _id: card.setId }, { $set: { "customFinish.key": "toxic" } });
  assert.deepEqual(await acquire([card]), [{ packs: 0 }]);
  assert.equal((await Progress.findOne())?.duplicates, 19);
  assert.deepEqual(await acquire([{ ...card, finish: "toxic" }]), [{ packs: 0 }]);
  assert.deepEqual(await acquire([card]), [{ packs: 1, progress: 0 }]);
  assert.equal((await duplicates.status(ownerId)).availablePacks, 1);
});

test("simultaneous claims and acquisitions never double-grant or lose progress", async () => {
  const card = await fixture("raid", 29);
  await duplicates.ensure(ownerId);
  const results = await Promise.all([
    ccg.claimHistoricalDuplicates(req), ccg.claimHistoricalDuplicates(req), acquire([card]), acquire([card]),
  ]);
  assert.equal((results[0] as { claimedPacks: number }).claimedPacks + (results[1] as { claimedPacks: number }).claimedPacks, 2);
  assert.equal((await duplicates.status(ownerId)).availablePacks, 0);
  assert.equal((await Progress.findOne())?.duplicates, 31);
  assert.equal(await Credit.countDocuments({ source: "duplicate_backfill" }), 1);
  assert.equal(await Credit.countDocuments({ source: "duplicate_milestone" }), 1);
  assert.equal((await Credit.find()).reduce((sum, row) => sum + row.remaining, 0), 3);
});

test("aborted acquisitions roll back initialization, progress, ownership and credits", async () => {
  const card = await fixture("raid", 9);
  const before = await Ownership.findOne({ cardId: card.cardId, finish: "standard" });
  await assert.rejects(transaction(async session => {
    await (ccg as any).addOwnership({ ownerType: "user", ownerId }, [card], session);
    throw new Error("rollback fixture");
  }), /rollback fixture/);
  assert.equal(await Account.countDocuments(), 0);
  assert.equal(await Progress.countDocuments(), 0);
  assert.equal(await Credit.countDocuments(), 0);
  assert.equal((await Ownership.findById(before!._id))?.quantity, before!.quantity);
});

test("historical claims settle earned recharge and preserve packs above the storage cap", async () => {
  await fixture("raid", 1100);
  await Balance.updateOne({ ownerId }, { $set: { remaining: 95, lastRechargeAt: new Date(Date.now() - 40 * 60_000) } });
  assert.equal((await ccg.claimHistoricalDuplicates(req)).claimedPacks, 110);
  assert.equal((await Balance.findOne({ ownerId }))?.remaining, 97);
  assert.equal((await Credit.findOne({ source: "duplicate_backfill" }))?.remaining, 110);
});

test("guest collection import seeds historical rewards even after the empty account initialized", async () => {
  await duplicates.ensure(ownerId);
  await fixture("community", 19);
  await transaction(session => duplicates.importGuest(ownerId, session));
  assert.equal((await duplicates.status(ownerId)).availablePacks, 1);
  assert.equal((await Progress.findOne())?.duplicates, 19);
});

test("Rewards requires authentication and lists only active public unclaimed codes", async () => {
  assert.equal((await request("", undefined, false)).status, 401);
  const common = { rewardType: "packs" as const, packs: 5, createdBy: ownerId };
  const [visible, privateCode, inactive, used] = await Codes.create([
    { ...common, code: "PUBLIC", public: true }, { ...common, code: "PRIVATE" },
    { ...common, code: "INACTIVE", public: true, active: false }, { ...common, code: "USED", public: true },
  ]);
  await Claims.create({ codeId: used._id, userId: ownerId, rewardType: "packs", packs: 5 });
  const response = await request(); assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).publicCodes.codes.map((row: any) => row.code), ["PUBLIC"]);
  assert.equal((await request("/claim", { source: "code", id: String(privateCode._id) })).status, 404);
  assert.equal((await request("/claim", { source: "code", id: String(inactive._id) })).status, 404);
  assert.equal((await request("/claim", { source: "code", id: String(visible._id) })).status, 200);
  await assert.rejects(ccg.redeemCode(req, { code: "PUBLIC" }), (error: any) => error.code === "redeem_code_already_used");
  assert.equal(await Claims.countDocuments({ codeId: visible._id, userId: ownerId }), 1);
  assert.equal((await Balance.findOne({ ownerId }))?.remaining, 5);
  const history = (await (await request()).json() as any).recent;
  assert.equal(history[0].source, "redeem_code");
  assert.equal(history[0].packs, 5);
  assert.equal(history[0].rewardType, "packs");
  const claimedCodes = (await (await request()).json() as any).claimedCodes.codes;
  assert.deepEqual(new Set(claimedCodes.map((code: any) => code.code)), new Set(["PUBLIC", "USED"]));
});

test("Rewards retains all of this account's claimed codes, including private and disabled codes", async () => {
  const codes = await Codes.create(Array.from({ length: 15 }, (_, index) => ({
    code: `HISTORY-${index}`, rewardType: "packs" as const, packs: index + 1, createdBy: ownerId,
    public: index % 2 === 0, active: index % 3 !== 0,
  })));
  await Claims.insertMany(codes.map((code, index) => ({ codeId: code._id, userId: ownerId,
    rewardType: "packs", packs: code.packs, redeemedAt: new Date(Date.UTC(2026, 8, index + 1)) })));
  const otherCode = await Codes.create({ code: "OTHER-USER", rewardType: "packs", packs: 50, createdBy: ownerId });
  await Claims.create({ codeId: otherCode._id, userId: new mongoose.Types.ObjectId(), rewardType: "packs", packs: 50 });
  const response = await (await request()).json() as any;
  assert.equal(response.publicCodes.codes.length, 0);
  assert.equal(response.claimedCodes.codes.length, 15, "History is not truncated to the ten recent ledger entries");
  assert.equal(response.claimedCodes.codes[0].code, "HISTORY-14");
  assert.equal(response.claimedCodes.codes[0].claimedAt, "2026-09-15T00:00:00.000Z");
  assert.equal(response.claimedCodes.codes[0].reward.packs, 15);
  assert.ok(!response.claimedCodes.codes.some((code: any) => code.code === "OTHER-USER"));
});

test("legacy codes without visibility stay private until explicitly made public", async () => {
  const legacy = await Codes.collection.insertOne({ code: "LEGACY", rewardType: "packs", packs: 5, active: true, createdBy: ownerId });
  assert.equal((await ccg.getPublicRedeemCodes(ownerId)).codes.length, 0);
  await ccg.setRedeemCodeVisibilityForAdmin(String(legacy.insertedId), true);
  assert.equal((await (await request()).json() as any).publicCodes.codes[0].code, "LEGACY");
  await ccg.setRedeemCodeVisibilityForAdmin(String(legacy.insertedId), false);
  assert.equal((await (await request()).json() as any).publicCodes.codes.length, 0);
});

test("public card rewards honor availability and grant a duplicate milestone once", async () => {
  const card = await fixture("community", 9);
  const code = await Codes.create({ code: "CARD", rewardType: "card", cardId: card.cardId, finish: "standard", artVariant: "standard", public: true, createdBy: ownerId });
  assert.equal((await ccg.getPublicRedeemCodes(ownerId)).codes.length, 1);
  await Card.collection.updateOne({ _id: card.cardId }, { $set: { availabilityStatus: "archived" } });
  assert.equal((await ccg.getPublicRedeemCodes(ownerId)).codes.length, 0);
  await Card.collection.updateOne({ _id: card.cardId }, { $set: { availabilityStatus: "available" } });
  assert.equal((await request("/claim", { source: "code", id: String(code._id) })).status, 200);
  assert.equal((await Credit.findOne({ source: "duplicate_milestone" }))?.remaining, 1);
  assert.equal((await Progress.findOne())?.duplicates, 10);
  assert.equal((await request("/claim", { source: "code", id: String(code._id) })).status, 409);
  assert.equal(await Credit.countDocuments({ source: "duplicate_milestone" }), 1);
  const history = (await (await request()).json() as any).recent;
  assert.equal(history[0].rewardType, "card");
  assert.equal(history[0].packs, 0);
  await Card.collection.updateOne({ _id: card.cardId }, { $set: { availabilityStatus: "archived" } });
  const claimed = (await (await request()).json() as any).claimedCodes.codes;
  assert.equal(claimed[0].code, "CARD", "Archived card rewards remain visible in claim history");
  assert.equal(claimed[0].reward.type, "card");
});

test("public/private edits retain manual redemption and previous claims", async () => {
  const code = await Codes.create({ code: "TOGGLE", rewardType: "packs", packs: 8, createdBy: ownerId });
  assert.equal(code.public, false);
  await ccg.setRedeemCodeVisibilityForAdmin(String(code._id), true);
  assert.equal((await ccg.getPublicRedeemCodes(ownerId)).codes.length, 1);
  await ccg.setRedeemCodeVisibilityForAdmin(String(code._id), false);
  assert.equal((await ccg.getPublicRedeemCodes(ownerId)).codes.length, 0);
  await ccg.redeemCode(req, { code: "TOGGLE" });
  await ccg.setRedeemCodeVisibilityForAdmin(String(code._id), true);
  assert.equal((await ccg.getPublicRedeemCodes(ownerId)).codes.length, 0);
});

test("unified Rewards lists and claims eligible Pickems and individual Studio creations", async () => {
  await User.updateOne({ _id: ownerId }, { $push: { pickems: { pickemId: "test", predictions: [], submittedAt: new Date() } } });
  await Pickem.collection.insertOne({ pickemId: "test", name: "Fixture predictions", type: "regular", active: true, ccgRewardPacks: 25 });
  const creator = await Creator.create({ userId: ownerId });
  const source = await Source.collection.insertOne({ creatorId: creator._id, cardId: new mongoose.Types.ObjectId(), name: "Fixture creation" });
  const data = await (await request()).json() as any;
  assert.deepEqual(data.items.map((row: any) => row.packs).sort((a: number, b: number) => a - b), [10, 25]);
  assert.equal((await request("/claim", { source: "pickem", id: "test" })).status, 200);
  assert.equal((await request("/claim", { source: "studio", id: String(source.insertedId) })).status, 200);
  assert.equal((await (await request()).json() as any).items.length, 0);
  assert.equal((await Credit.find()).reduce((sum, row) => sum + row.remaining, 0), 35);
  const activity = await ccg.getActivity(req, {});
  assert.equal((activity.items as any[]).filter(row => row.kind === "reward").length, 2);
});
