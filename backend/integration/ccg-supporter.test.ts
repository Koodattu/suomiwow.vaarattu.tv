/// <reference path="../src/types/express-session.d.ts" />
process.env.BLIZZARD_CLIENT_ID = "supporter-test";
process.env.BLIZZARD_CLIENT_SECRET = "supporter-test";
import assert from "node:assert/strict";
import test, { before, beforeEach, after, mock } from "node:test";
import mongoose from "mongoose";
import crypto from "crypto";
import User from "../src/models/User";
import Creator from "../src/models/CcgSupporterCreator";
import Source from "../src/models/CcgSupporterCharacter";
import Grant from "../src/models/CcgSupporterGrant";
import Event from "../src/models/CcgSupporterEvent";
import Limit from "../src/models/CcgSupporterLimit";
import Card from "../src/models/CcgCard";
import SetModel from "../src/models/CcgSet";
import Pool from "../src/models/CcgPackPool";
import Ownership from "../src/models/CcgOwnership";
import Series from "../src/models/CcgSeriesOwnership";
import Invalidation from "../src/models/CcgLeaderboardInvalidation";
import CcgJobLock from "../src/models/CcgJobLock";
import CcgLeaderboardEntry from "../src/models/CcgLeaderboardEntry";
import CcgPackBalance from "../src/models/CcgPackBalance";
import CcgPackOpening from "../src/models/CcgPackOpening";
import CcgQualityProgress from "../src/models/CcgQualityProgress";
import status, { supporterLimit } from "../src/services/ccg-supporter-status.service";
import studio from "../src/services/ccg-supporter.service";
import publisher from "../src/services/ccg-publisher.service";
import ccg from "../src/services/ccg.service";
import leaderboard from "../src/services/ccg-leaderboard.service";
import blizzard from "../src/services/blizzard.service";
import renders from "../src/services/character-render-storage.service";
import { CCG_BASE_FINISH_ORDER, CCG_PACK_BALANCE_VERSION, CcgCustomFinish } from "../src/config/ccg";

// Dedicated disposable replica set; never read deployment credentials.
const database = `ccg_supporter_test_${process.pid}`;
const userId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();
const models = [User, Creator, Source, Grant, Event, Limit, Card, SetModel, Pool, Ownership, Series, Invalidation,
  CcgJobLock, CcgLeaderboardEntry, CcgPackBalance, CcgPackOpening, CcgQualityProgress];
const chars = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, realmId: 10, name: `Mage${i + 1}`, realm: "Stormreaver",
  realmSlug: "stormreaver", class: "Mage", race: "Human", level: 10, faction: "ALLIANCE" as const, selected: false }));

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27139/${database}?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  for (const model of Object.values(mongoose.models)) await model.init();
  mock.method(blizzard, "getCharacterProfile", async (name: string) => ({ id: Number(name.replace("Mage", "")), name,
    realm: { id: 10, name: "Stormreaver", slug: "stormreaver" }, character_class: { name: "Mage" }, active_spec: { name: "Fire" } }) as any);
  mock.method(blizzard, "getCharacterMedia", async () => ({ avatarUrl: null, mainRawUrl: "https://render.worldofwarcraft.com/test.png", insetUrl: null }));
  mock.method(renders, "ingest", async () => ({ url: "/api/ccg/media/assets/test", assetId: new mongoose.Types.ObjectId(), fit: null }) as any);
  mock.method(ccg as any, "enqueuePackOpeningAnalytics", () => undefined);
});
after(async () => {
  mock.restoreAll();
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  for (const model of models) await model.collection.deleteMany({});
  const connectedAt = new Date();
  await User.collection.insertMany([userId, otherId].map((id, index) => ({ _id: id, discord: { id: `discord${index}`, username: `Tester${index}` },
    battlenet: { id: `bnet${index}`, connectedAt, accessToken: "fixture", tokenExpiresAt: new Date(Date.now() + 3600_000) } })));
  await Creator.create({ userId, battlenetId: "bnet0", earnedSlots: 4, roster: chars, rosterCheckedAt: new Date(), rosterConnectionAt: connectedAt });
  (publisher as any).configuredAt = 0;
  ccg.invalidateCardAvailabilityCaches();
});

async function draft(characterId = 1) {
  await studio.create(String(userId), { characterId, realmId: 10 });
  return Source.findOne({ blizzardCharacterId: characterId }).orFail();
}
async function publish(characterId = 1, finish?: CcgCustomFinish) {
  const source = await draft(characterId);
  if (finish) { source.draft!.creatorFinish = finish; await source.save(); }
  await studio.publish(String(userId), String(source._id), source.revision);
  return Source.findById(source._id).orFail();
}
async function connect() {
  const session = await mongoose.startSession();
  try { await session.withTransaction(() => status.connect(String(userId), "twitch0", session)); }
  finally { await session.endSession(); }
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 0, connectedSince: new Date("2026-09-01T00:00:00Z") } });
  return Creator.findOne({ userId }).orFail();
}

test("concurrent observations credit each permanent and monthly grant exactly once", async () => {
  const creator = await connect();
  const observe = (date: string) => status.observe(creator._id, creator.connectionRevision, "channel", true, true, "1000", new Date(date));
  await Promise.all(Array.from({ length: 4 }, () => observe("2026-09-16T12:00:00Z")));
  assert.equal((await Creator.findById(creator._id))?.earnedSlots, 4);
  await Promise.all(Array.from({ length: 4 }, () => observe("2026-10-16T12:00:00Z")));
  assert.equal((await Creator.findById(creator._id))?.earnedSlots, 5);
  assert.equal(await Grant.countDocuments(), 3);
});

test("disconnect fences in-flight checks, preserves allowance and rejects account transfer", async () => {
  const creator = await connect();
  await status.observe(creator._id, creator.connectionRevision, "channel", true, true, "1000", new Date("2026-09-16T12:00:00Z"));
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => status.disconnect(String(userId), session));
    await status.observe(creator._id, creator.connectionRevision, "channel", true, true, "1000", new Date("2026-10-16T12:00:00Z"));
    assert.equal((await Creator.findById(creator._id))?.earnedSlots, 4);
    await assert.rejects(session.withTransaction(() => status.connect(String(otherId), "twitch0", session)), { code: "account_bound" });
    await session.withTransaction(() => status.connect(String(userId), "twitch0", session));
    const current = await Creator.findById(creator._id).orFail();
    await status.observe(current._id, current.connectionRevision, "channel", true, true, "2000", new Date("2026-11-16T12:00:00Z"));
    assert.equal((await Creator.findById(creator._id))?.earnedSlots, 5);
  } finally { await session.endSession(); }
});

test("duplicate and out-of-order events preserve grants and latest status", async () => {
  await connect();
  await Promise.all(Array.from({ length: 3 }, () => status.recordEvent("same", "channel", "twitch0", true, "1000", new Date("2026-10-01T00:00:00Z"))));
  await status.recordEvent("older", "channel", "twitch0", true, "1000", new Date("2026-09-30T00:00:00Z"));
  await status.recordEvent("end", "channel", "twitch0", false, null, new Date("2026-11-02T00:00:00Z"));
  await status.recordEvent("late", "channel", "twitch0", true, "1000", new Date("2026-10-15T00:00:00Z"));
  const creator = await Creator.findOne({ userId }).orFail();
  assert.equal(creator.earnedSlots, 5);
  assert.equal(creator.firstSubscriberMonth, "2026-09");
  assert.equal(creator.subscribed, false);
  assert.equal(await Event.countDocuments({ processed: false }), 0);
});

test("publication is idempotent and later edits update one card without changing rarity", async () => {
  const source = await draft();
  await Promise.all([1, 2].map(() => studio.publish(String(userId), String(source._id), source.revision)));
  let current = await Source.findById(source._id).orFail();
  assert.equal(await Card.countDocuments(), 1);
  assert.equal((await Creator.findOne({ userId }))?.usedSlots, 1);
  assert.equal((await Ownership.findOne({ cardId: current.cardId }))?.quantity, 1);
  assert.equal((await Ownership.findOne({ cardId: current.cardId }))?.finish, current.creatorFinish);
  await assert.rejects(studio.save(String(userId), String(current._id), { ...source.toObject().draft, revision: current.revision, tierGrade: "F" }), { code: "rarity_locked" });
  await studio.save(String(userId), String(current._id), { ...source.toObject().draft, revision: current.revision, performance: 80, mechanics: 60 });
  current = await Source.findById(source._id).orFail();
  await assert.rejects(studio.publish(String(userId), String(current._id), current.revision), { code: "edit_cooldown" });
  await Source.updateOne({ _id: current._id }, { $set: { nextEditAt: new Date(0) } });
  await studio.publish(String(userId), String(current._id), current.revision);
  const card = await Card.findById(current.cardId).orFail();
  assert.equal(card.communityScores?.combined, 70);
  assert.equal(card.snapshotVersion, 1);
  assert.equal(await Card.countDocuments(), 1);
  assert.equal((await Creator.findOne({ userId }))?.draftCount, 0);
});

test("five draft limit is enforced concurrently and discarding preserves render cooldown", async () => {
  const results = await Promise.allSettled(chars.slice(0, 6).map((character) => draft(character.id)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
  assert.equal((await Creator.findOne({ userId }))?.draftCount, 5);
  const source = await Source.findOne({ draft: { $ne: null } }).orFail();
  const refreshAt = source.nextRenderRefreshAt.getTime();
  await studio.discard(String(userId), String(source._id), source.revision);
  await studio.create(String(userId), { characterId: source.blizzardCharacterId, realmId: source.realmId });
  const restored = await Source.findById(source._id).orFail();
  assert.equal(restored.nextRenderRefreshAt.getTime(), refreshAt);
  assert.ok(restored.draft?.renderAssetId);
});

test("ownership loss and unavailable slots prevent publication without partial writes", async () => {
  const source = await draft();
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 0 } });
  await assert.rejects(studio.publish(String(userId), String(source._id), source.revision), { code: "no_slots" });
  assert.equal(await Card.countDocuments(), 0);
  assert.equal((await Creator.findOne({ userId }))?.draftCount, 1);
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 4, roster: [] } });
  await assert.rejects(studio.publish(String(userId), String(source._id), source.revision), { code: "ownership_required" });
  assert.equal(await Card.countDocuments(), 0);
});

test("supporter selection excludes raids and grants allow only the card's chosen raid finish and base artwork", async () => {
  const source = await publish(1, "phaseglass");
  const card = await Card.findById(source.cardId).orFail();
  const session = await mongoose.startSession();
  try {
    const pool = await (ccg as any).selectSupporterPackResults(session);
    assert.equal(pool.results.length, 5);
    assert.ok(pool.results.every((result: any) => String(result.cardId) === String(card._id)));
    await assert.rejects((ccg as any).selectPackResults(session, card.setId), { code: "target_set_unavailable" });
    await assert.rejects((ccg as any).selectPackResults(session, null, true, false, null, [card.setId]), { code: "selected_sets_unavailable" });
    const owner = { ownerType: "user", ownerId: otherId, dateKey: "2026-09-16" };
    const result = { cardId: card._id, setId: card.setId, characterId: card.characterId, snapshotVersion: 1, finish: source.creatorFinish, artVariant: "standard" };
    await assert.rejects((ccg as any).addOwnership(owner, [{ ...result, finish: "relic" }], session), { code: "supporter_finish_unavailable" });
    await assert.rejects((ccg as any).addOwnership(owner, [{ ...result, finish: "standard", artVariant: "alternative" }], session), { code: "supporter_finish_unavailable" });
    await session.withTransaction(() => (ccg as any).addOwnership(owner, [result], session));
    assert.equal((await Ownership.findOne({ ownerId: otherId }))?.finish, "phaseglass");
  } finally { await session.endSession(); }
});

test("new Supporter publication forces full leaderboard rebuild without another collector acquisition", async () => {
  const source = await publish();
  const card = await Card.findById(source.cardId).orFail();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => (ccg as any).addOwnership({ ownerType: "user", ownerId: otherId, dateKey: "2026-09-16" },
      CCG_BASE_FINISH_ORDER.map((finish) => ({ cardId: card._id, setId: card.setId, characterId: card.characterId, snapshotVersion: 1, finish, artVariant: "standard" })), session));
  } finally { await session.endSession(); }
  await leaderboard.refresh("full");
  assert.equal((await CcgLeaderboardEntry.findOne({ userId: otherId }))?.completedSets, 1);
  assert.equal((await CcgLeaderboardEntry.findOne({ userId: otherId }))?.completedCards, 0, "Seven bases alone are incomplete");
  const grantSession = await mongoose.startSession();
  try {
    await grantSession.withTransaction(() => (ccg as any).addOwnership({ ownerType: "user", ownerId: otherId, dateKey: "2026-09-16" },
      [{ cardId: card._id, setId: card.setId, characterId: card.characterId, snapshotVersion: 1, finish: source.creatorFinish, artVariant: "standard" }], grantSession));
  } finally { await grantSession.endSession(); }
  await leaderboard.refresh("full");
  assert.equal((await CcgLeaderboardEntry.findOne({ userId: otherId }))?.completedCards, 1, "All eight finishes complete the card");
  await publish(2);
  const result = await leaderboard.refresh("incremental");
  assert.equal(result.mode, "full");
  assert.equal((await CcgLeaderboardEntry.findOne({ userId: otherId }))?.completedSets, 0);
  const invalidation = await Invalidation.findOne({ key: "supporter" }).orFail();
  assert.equal(invalidation.revision, invalidation.completedRevision);
});

test("persistent rate limits remain bounded under concurrency", async () => {
  const results = await Promise.allSettled(Array.from({ length: 15 }, () => supporterLimit("test", 5, 60000)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
});

test("last publication slot cannot be consumed twice by simultaneous different drafts", async () => {
  const first = await draft(1), second = await draft(2);
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 1 } });
  const results = await Promise.allSettled([first, second].map((source) => studio.publish(String(userId), String(source._id), source.revision)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await Card.countDocuments(), 1);
  assert.equal((await Creator.findOne({ userId }))?.usedSlots, 1);
  assert.equal((await Creator.findOne({ userId }))?.draftCount, 1);
});

test("real Supporter openings roll the selected Phaseglass finish for users and guests with isolated pity", async (t) => {
  const source = await publish(1, "phaseglass");
  t.mock.method(crypto, "randomInt", ((maximum: number) => maximum - 1) as typeof crypto.randomInt);
  for (const ownerType of ["user", "guest"] as const) {
    const ownerId = ownerType === "user" ? otherId : new mongoose.Types.ObjectId();
    const owner = { ownerType, ownerId, dateKey: "2026-09-16" };
    const resolve = t.mock.method(ccg, "resolveOwner", async () => owner);
    await CcgPackBalance.create({ ...owner, remaining: 10, lastRechargeAt: new Date(), grantVersion: CCG_PACK_BALANCE_VERSION });
    await CcgQualityProgress.create({ ...owner, custom: { highmaul: 249, manaforge: 83, "supporter-phaseglass": 249, "supporter-relic": 42 }, astral: 0 });
    const result = await ccg.openPack({} as any, {} as any, { type: "supporter", idempotencyKey: `supporter_${ownerType}_test` }) as any;
    assert.equal(result.selection.type, "supporter");
    assert.equal(result.results.length, 5);
    assert.ok(result.results.every((row: any) => ([...CCG_BASE_FINISH_ORDER, "phaseglass"] as string[]).includes(row.finish) && row.artVariant === "standard" && row.card.id === String(source.cardId)));
    assert.equal(result.results[0].finish, "phaseglass");
    assert.equal(result.results[0].card.creatorFinish, "phaseglass");
    assert.equal((await CcgPackBalance.findOne({ ownerId }))?.remaining, 9);
    assert.equal((await CcgQualityProgress.findOne({ ownerId }))?.custom.get("highmaul"), 249);
    assert.equal((await CcgQualityProgress.findOne({ ownerId }))?.custom.get("manaforge"), 83);
    assert.equal((await CcgQualityProgress.findOne({ ownerId }))?.custom.get("supporter-relic"), 42);
    assert.ok((await CcgQualityProgress.findOne({ ownerId }))!.custom.get("supporter-phaseglass")! < 5);
    const sessionState = await (ccg as any).buildSession(owner);
    assert.ok(sessionState.customQualityProtection.some((row: any) => row.setSlug === "supporter-phaseglass" && row.finish === "phaseglass"));
    const repeat = await ccg.openPack({} as any, {} as any, { type: "supporter", idempotencyKey: `supporter_${ownerType}_test` }) as any;
    assert.equal(repeat.id, result.id);
    assert.equal((await CcgPackBalance.findOne({ ownerId }))?.remaining, 9);
    resolve.mock.restore();
  }
});

test("moderation preserves ownership and points, suppresses packs and empty openings roll back charges", async (t) => {
  const source = await publish();
  await studio.moderate(String(source._id), { editsFrozen: true, distributable: false });
  assert.equal(await Ownership.countDocuments({ cardId: source.cardId }), 1);
  await leaderboard.refresh("incremental");
  assert.ok((await CcgLeaderboardEntry.findOne({ userId }))!.score > 0);
  const owner = { ownerType: "user" as const, ownerId: otherId, dateKey: "2026-09-16" };
  t.mock.method(ccg, "resolveOwner", async () => owner);
  await CcgPackBalance.create({ ...owner, remaining: 10, lastRechargeAt: new Date(), grantVersion: CCG_PACK_BALANCE_VERSION });
  await assert.rejects(ccg.openPack({} as any, {} as any, { type: "supporter", idempotencyKey: "empty_supporter_test" }), { code: "pack_pool_unavailable" });
  assert.equal((await CcgPackBalance.findOne({ ownerId: otherId }))?.remaining, 10);
  assert.equal(await CcgPackOpening.countDocuments(), 0);
  await assert.rejects(studio.publish(String(userId), String(source._id), source.revision), { code: "editing_frozen" });
});

test("mixed Supporter packs resolve the raid finish per card", async (t) => {
  const sources = [await publish(1, "phaseglass"), await publish(2, "relic")];
  const cards = await Card.find({ _id: { $in: sources.map((source) => source.cardId!) } }).sort({ setNumber: 1 });
  t.mock.method(ccg as any, "selectSupporterPackResults", async () => ({
    results: [0, 1, 0, 1, 0].map((index) => ({ cardId: cards[index]._id, setId: cards[index].setId, tierGrade: cards[index].tierGrade, missingCardAlternatives: [] })),
    sourceSetIds: [cards[0].setId], version: "mixed-test",
  }));
  t.mock.method(crypto, "randomInt", ((maximum: number) => maximum - 1) as typeof crypto.randomInt);
  const owner = { ownerType: "user" as const, ownerId: otherId, dateKey: "2026-09-16" };
  t.mock.method(ccg, "resolveOwner", async () => owner);
  await CcgPackBalance.create({ ...owner, remaining: 10, lastRechargeAt: new Date(), grantVersion: CCG_PACK_BALANCE_VERSION });
  await CcgQualityProgress.create({ ...owner, custom: { "supporter-phaseglass": 249, "supporter-relic": 249 } });
  const opening = await ccg.openPack({} as any, {} as any, { type: "supporter", idempotencyKey: "mixed_supporter_test" }) as any;
  assert.equal(opening.results[0].finish, "phaseglass");
  assert.equal(opening.results[1].finish, "relic");
  for (const row of opening.results) {
    assert.ok(([...CCG_BASE_FINISH_ORDER, row.card.creatorFinish] as string[]).includes(row.finish));
  }
});

test("Supporter redemption accepts its chosen finish and rejects other raid finishes", async () => {
  const source = await publish(1, "phaseglass");
  const input = { code: "supporter-phaseglass-test", rewardType: "card", cardId: String(source.cardId), finish: "phaseglass", artVariant: "standard" };
  await assert.rejects(ccg.createRedeemCodeForAdmin({ ...input, finish: "relic" }, userId), { code: "finish_unavailable_for_set" });
  await ccg.createRedeemCodeForAdmin(input, userId);
  await ccg.redeemCode({ session: { userId: String(otherId) } } as any, { code: input.code });
  assert.equal((await Ownership.findOne({ ownerId: otherId, cardId: source.cardId }))?.finish, "phaseglass");
});
