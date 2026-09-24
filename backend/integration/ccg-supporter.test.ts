/// <reference path="../src/types/express-session.d.ts" />
process.env.BLIZZARD_CLIENT_ID = "supporter-test";
process.env.BLIZZARD_CLIENT_SECRET = "supporter-test";
process.env.CCG_MEDIA_CACHE_DIR = require("node:path").join(require("node:os").tmpdir(), `ccg-supporter-media-test-${process.pid}`);
import assert from "node:assert/strict";
import test, { before, beforeEach, after, mock } from "node:test";
import mongoose from "mongoose";
import crypto from "crypto";
import sharp from "sharp";
import express from "express";
import { Server } from "node:http";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Media from "../src/models/CcgSupporterMedia";
import AlternativeArt from "../src/models/CcgAlternativeArt";
import mediaService from "../src/services/ccg-supporter-media.service";
import artReview, { SupporterArtReview } from "../src/services/ccg-supporter-art-review.service";
import ccgRouter from "../src/routes/ccg";
import { resolveAlternativeArtKey } from "../src/utils/ccg-alternative-art";
import User from "../src/models/User";
import Guild from "../src/models/Guild";
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
import CcgPackCredit from "../src/models/CcgPackCredit";
import CcgLedgerEntry from "../src/models/CcgLedgerEntry";
import CcgPackOpening from "../src/models/CcgPackOpening";
import CcgQualityProgress from "../src/models/CcgQualityProgress";
import CcgDuplicateRewardAccount from "../src/models/CcgDuplicateRewardAccount";
import CcgDuplicateRewardProgress from "../src/models/CcgDuplicateRewardProgress";
import status, { supporterLimit } from "../src/services/ccg-supporter-status.service";
import studio from "../src/services/ccg-supporter.service";
import publisher from "../src/services/ccg-publisher.service";
import ccg from "../src/services/ccg.service";
import leaderboard from "../src/services/ccg-leaderboard.service";
import blizzard from "../src/services/blizzard.service";
import battlenet from "../src/services/battlenet-auth.service";
import renders from "../src/services/character-render-storage.service";
import { CCG_BASE_FINISH_ORDER, CCG_PACK_BALANCE_VERSION, CcgCustomFinish } from "../src/config/ccg";

// Dedicated disposable replica set; never read deployment credentials.
const database = `ccg_supporter_test_${process.pid}`;
const userId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();
let server: Server;
let baseUrl: string;
const models = [User, Guild, Creator, Source, Grant, Event, Limit, Card, SetModel, Pool, Ownership, Series, Invalidation,
  CcgJobLock, CcgLeaderboardEntry, CcgPackBalance, CcgPackCredit, CcgLedgerEntry, CcgPackOpening, CcgQualityProgress, Media, AlternativeArt,
  CcgDuplicateRewardAccount, CcgDuplicateRewardProgress];
const chars = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, realmId: 10, name: `Mage${i + 1}`, realm: "Stormreaver",
  realmSlug: "stormreaver", class: "Mage", race: "Human", level: 10, faction: "ALLIANCE" as const, selected: false, inactive: false }));

before(async () => {
  mock.method(artReview, "review", async (): Promise<SupporterArtReview> => ({ decision: "error", safetyConfidence: null, reason: "review_unavailable",
    model: "gpt-6-luna", policyVersion: "supporter-art-v1", responseId: null, autoApproved: false, reviewedAt: new Date() }));
  await mongoose.connect(`mongodb://127.0.0.1:27139/${database}?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  for (const model of Object.values(mongoose.models)) await model.init();
  mock.method(blizzard, "getCharacterProfile", async (name: string) => ({ id: Number(name.replace("Mage", "")), name,
    realm: { id: 10, name: "Stormreaver", slug: "stormreaver" }, character_class: { name: "Mage" }, active_spec: { name: "Fire" } }) as any);
  mock.method(blizzard, "getCharacterMedia", async () => ({ avatarUrl: null, mainRawUrl: "https://render.worldofwarcraft.com/test.png", insetUrl: null }));
  mock.method(renders, "ingest", async () => ({ url: "/api/ccg/media/assets/test", assetId: new mongoose.Types.ObjectId(), fit: null }) as any);
  mock.method(ccg as any, "enqueuePackOpeningAnalytics", () => undefined);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: req.headers["x-test-user"] } as any; next(); });
  app.use("/api/ccg", ccgRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  mock.restoreAll();
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  const directory = path.resolve(process.env.CCG_MEDIA_CACHE_DIR!);
  assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.equal(path.basename(directory), `ccg-supporter-media-test-${process.pid}`);
  await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const model of models) await model.collection.deleteMany({});
  const connectedAt = new Date();
  await User.collection.insertMany([userId, otherId].map((id, index) => ({ _id: id, discord: { id: `discord${index}`, username: `Tester${index}` },
    battlenet: { id: `bnet${index}`, connectedAt, accessToken: "fixture", tokenExpiresAt: new Date(Date.now() + 3600_000),
      characters: chars, rosterSyncedAt: new Date() } })));
  await Creator.create({ userId, battlenetId: "bnet0", earnedSlots: 4 });
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

test("Studio overview does not wait for Battle.net; characters load separately", async (t) => {
  await User.updateOne({ _id: userId }, { $set: { "battlenet.rosterSyncedAt": null } });
  const roster = t.mock.method(battlenet, "getWoWCharacters", async () => structuredClone(chars));
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  const overview = await studio.getState(String(userId));
  assert.equal(overview.battlenetConnected, true);
  assert.equal(roster.mock.callCount(), 0);
  assert.equal("characters" in overview, false);
  const loaded = await studio.getCharacters(String(userId));
  assert.equal(loaded.rosterError, null);
  assert.equal(loaded.characters.length, chars.length);
  assert.equal(roster.mock.callCount(), 1);
  await studio.getCharacters(String(userId));
  assert.equal(roster.mock.callCount(), 1, "Subsequent character reads reuse the roster cache");
  assert.ok((await User.findById(userId))?.battlenet?.rosterSyncedAt);
});

test("Battle.net failures affect character loading without blocking Studio", async (t) => {
  await User.updateOne({ _id: userId }, { $set: { "battlenet.rosterSyncedAt": null } });
  t.mock.method(battlenet, "getWoWCharacters", async () => { throw new Error("offline"); });
  assert.equal((await studio.getCharacters(String(userId))).rosterError, "armory_unavailable");
  assert.equal((await studio.getCharacters(String(userId))).characters.length, chars.length, "Saved characters survive provider failures");
  assert.equal((await studio.getState(String(userId))).allowance.available, 6);
});

test("old cached rosters support visits, saves and publication even after the Battle.net token expires", async (t) => {
  const source = await draft();
  await User.updateOne({ _id: userId }, { $set: {
    "battlenet.rosterSyncedAt": new Date(0), "battlenet.tokenExpiresAt": new Date(0),
  } });
  const roster = t.mock.method(battlenet, "getWoWCharacters", async () => { throw new Error("Unexpected roster fetch"); });
  const profile = t.mock.method(blizzard, "getCharacterProfile", async () => { throw new Error("Unexpected profile fetch"); });
  for (let visit = 0; visit < 2; visit++) {
    assert.equal((await studio.getCharacters(String(userId))).characters.length, chars.length);
  }
  await studio.save(String(userId), String(source._id), { ...source.toObject().draft, revision: source.revision });
  const saved = await Source.findById(source._id).orFail();
  await studio.publish(String(userId), String(source._id), saved.revision);
  assert.equal(await Card.countDocuments({ supporterCharacterId: source._id }), 1);
  assert.equal(roster.mock.callCount(), 0);
  assert.equal(profile.mock.callCount(), 0);
});

test("failed explicit refresh retains the roster and ordinary reads do not retry Blizzard", async (t) => {
  const roster = t.mock.method(battlenet, "getWoWCharacters", async () => { throw new Error("offline"); });
  const refreshed = await studio.getCharacters(String(userId), true);
  assert.equal(refreshed.rosterError, "armory_unavailable");
  assert.equal(refreshed.characters.length, chars.length);
  assert.equal((await studio.getCharacters(String(userId))).rosterError, null);
  assert.equal(roster.mock.callCount(), 1);
});

test("an unknown guild after a failed first lookup cannot erase the card's saved guild", async () => {
  const source = await draft();
  await Source.updateOne({ _id: source._id }, { $set: { guildName: "Known Guild", guildRealm: "Stormreaver" } });
  await studio.save(String(userId), String(source._id), { ...source.toObject().draft, revision: source.revision });
  const saved = await Source.findById(source._id).orFail();
  assert.equal(saved.guildName, "Known Guild");
  await studio.publish(String(userId), String(source._id), saved.revision);
  assert.equal((await Card.findById((await Source.findById(source._id))!.cardId))?.guildName, "Known Guild");
});

test("claim-all rewards only this creator's published cards, once even across concurrent requests", async () => {
  await publish(1);
  await publish(2);
  await draft(3);
  const foreign = await publish(4);
  const otherCreator = await status.ensureCreator(otherId);
  await Source.updateOne({ _id: foreign._id }, { $set: { creatorId: otherCreator._id } });
  assert.equal((await studio.getState(String(userId))).rewards.availablePacks, 20);
  const results = await Promise.all([studio.claimPacks(String(userId)), studio.claimPacks(String(userId))]);
  assert.deepEqual(results.map((row) => row.claimedPacks).sort((a, b) => a - b), [0, 20]);
  assert.equal(await CcgPackCredit.countDocuments({ ownerId: userId, source: "supporter_creation" }), 2);
  assert.equal(await CcgPackCredit.countDocuments({ ownerId: otherId }), 0);
  assert.equal(await CcgLedgerEntry.countDocuments({ ownerId: userId, action: "supporter_creation", amount: 10 }), 2);
  assert.equal((await studio.getState(String(userId))).rewards.availablePacks, 0);
  assert.equal((await studio.claimPacks(String(otherId))).claimedPacks, 10);
});

test("spent rewards and edits never reopen a claim or duplicate a snapshot", async () => {
  const source = await publish();
  await studio.claimPacks(String(userId));
  await CcgPackCredit.updateMany({ ownerId: userId }, { $set: { remaining: 0 } });
  await studio.save(String(userId), String(source._id), { revision: source.revision,
    specName: "fire", role: "dps", tierGrade: source.tierGrade, creatorFinish: source.creatorFinish, performance: 70, mechanics: 80, mythicPlus: 2000 });
  await Source.updateOne({ _id: source._id }, { $set: { nextEditAt: new Date(0) } });
  const edited = await Source.findById(source._id).orFail();
  await studio.publish(String(userId), String(source._id), edited.revision);
  assert.equal((await studio.claimPacks(String(userId))).claimedPacks, 0);
  assert.equal((await studio.getState(String(userId))).rewards.availablePacks, 0);
  assert.equal(await Card.countDocuments({ supporterCharacterId: source._id }), 1);
  assert.equal((await Card.findById(source.cardId))?.snapshotVersion, 1);
});

test("failed claim transactions roll back credits and can be retried", async (t) => {
  await publish();
  const failure = t.mock.method(CcgLedgerEntry, "create", async () => { throw new Error("ledger failed"); });
  await assert.rejects(studio.claimPacks(String(userId)), /ledger failed/);
  assert.equal(await CcgPackCredit.countDocuments({ source: "supporter_creation" }), 0);
  assert.equal((await studio.getState(String(userId))).rewards.availablePacks, 10);
  failure.mock.restore();
  assert.equal((await studio.claimPacks(String(userId))).claimedPacks, 10);
});

test("claim endpoint ignores client amounts and keeps rewards above the recharge cap", async () => {
  await publish();
  await CcgPackBalance.updateOne({ ownerType: "user", ownerId: userId }, { $set: { remaining: 100,
    lastRechargeAt: new Date(), grantVersion: CCG_PACK_BALANCE_VERSION, hasPlayed: true } }, { upsert: true });
  const request = (headers: Record<string, string>) => fetch(`${baseUrl}/api/ccg/studio/rewards/claim`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", ...headers },
    body: JSON.stringify({ amount: 9999, userId: String(otherId) }),
  });
  assert.equal((await request({})).status, 401);
  assert.equal((await request({ "x-test-user": String(userId), Origin: "https://wrong.example" })).status, 403);
  const response = await request({ "x-test-user": String(userId) });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { claimedPacks: number }).claimedPacks, 10);
  assert.equal((await CcgPackBalance.findOne({ ownerId: userId }))?.remaining, 100);
  assert.equal((await CcgPackCredit.findOne({ ownerId: userId, source: "supporter_creation" }))?.remaining, 10);
  assert.equal(await CcgPackCredit.countDocuments({ ownerId: otherId }), 0);
});

test("concurrent observations credit each permanent and monthly grant exactly once", async () => {
  const creator = await connect();
  const observe = (date: string) => status.observe(creator._id, creator.connectionRevision, "channel", true, true, "1000", new Date(date));
  await Promise.all(Array.from({ length: 4 }, () => observe("2026-09-16T12:00:00Z")));
  assert.equal((await Creator.findById(creator._id))?.earnedSlots, 8);
  await Promise.all(Array.from({ length: 4 }, () => observe("2026-10-16T12:00:00Z")));
  assert.equal((await Creator.findById(creator._id))?.earnedSlots, 9);
  assert.equal(await Grant.countDocuments(), 3);
});

test("baseline slots work without Twitch and cannot be replenished by reopening Studio", async () => {
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 0 } });
  const initial = await studio.getState(String(userId));
  assert.equal(initial.twitchConnected, false);
  assert.deepEqual(initial.entitlements, { base: 2, follower: false, subscriber: false });
  assert.deepEqual(initial.allowance, { earned: 2, used: 0, available: 2, drafts: 0, draftLimit: 5 });
  await publish(1);
  await publish(2);
  const source = await draft(3);
  await assert.rejects(studio.publish(String(userId), String(source._id), source.revision), { code: "no_slots" });
  const exhausted = await studio.getState(String(userId));
  assert.equal(exhausted.allowance.available, 0);
  assert.equal(exhausted.allowance.used, 2);
  assert.equal(await Card.countDocuments(), 2);
  assert.equal(await Grant.countDocuments(), 0);
});

test("new and existing creators receive the baseline on top of permanent Twitch bonuses", async () => {
  await User.updateOne({ _id: otherId }, { $unset: { battlenet: "" } });
  const fresh = await studio.getState(String(otherId));
  assert.equal(fresh.allowance.earned, 2);
  assert.equal(fresh.allowance.available, 2);
  await Creator.updateOne({ userId }, { $set: { usedSlots: 3 } });
  const existing = await studio.getState(String(userId));
  assert.equal(existing.allowance.earned, 6);
  assert.equal(existing.allowance.available, 3);

  const creator = await connect();
  await Creator.updateOne({ userId }, { $set: { usedSlots: 0 } });
  const observe = (following: boolean, subscribed: boolean, date: string) => status.observe(creator._id,
    creator.connectionRevision, "channel", following, subscribed, subscribed ? "1000" : null, new Date(date));
  await observe(true, false, "2026-09-16T12:00:00Z");
  assert.equal((await studio.getState(String(userId))).allowance.available, 5);
  await observe(true, true, "2026-09-17T12:00:00Z");
  assert.equal((await studio.getState(String(userId))).allowance.available, 10);
  await observe(true, true, "2026-10-17T12:00:00Z");
  assert.equal((await studio.getState(String(userId))).allowance.available, 11);
  await observe(false, false, "2026-11-17T12:00:00Z");
  const expired = await studio.getState(String(userId));
  assert.equal(expired.allowance.available, 11);
  assert.deepEqual(expired.entitlements, { base: 2, follower: true, subscriber: true });
});

test("older permanent grants are topped up once after disconnection without changing usage or monthly rewards", async () => {
  const creator = await Creator.findOne({ userId }).orFail();
  await Creator.updateOne({ _id: creator._id }, { $set: { earnedSlots: 6, usedSlots: 3,
    trackingEnabled: false, following: false, subscribed: false } });
  await Grant.insertMany([
    { kind: "follower", period: "once", amount: 1 },
    { kind: "subscriber", period: "once", amount: 3 },
    { kind: "monthly", period: "2026-08", amount: 1 },
    { kind: "monthly", period: "2026-09", amount: 1 },
  ].map((grant) => ({ ...grant, creatorId: creator._id, broadcasterId: "channel", twitchUserId: "twitch0", observedAt: new Date() })));
  await Promise.all(Array.from({ length: 4 }, () => status.ensureCreator(userId)));
  const state = await studio.getState(String(userId));
  assert.deepEqual(state.entitlements, { base: 2, follower: true, subscriber: true });
  assert.deepEqual(state.allowance, { earned: 12, used: 3, available: 9, drafts: 0, draftLimit: 5 });
  assert.equal((await studio.getState(String(userId))).allowance.earned, 12);
  assert.equal(await Grant.countDocuments(), 4);
  assert.equal((await Grant.findOne({ kind: "follower" }))?.amount, 3);
  assert.equal((await Grant.findOne({ kind: "subscriber" }))?.amount, 5);
  assert.equal(await Grant.countDocuments({ kind: "monthly", amount: 1 }), 2);
});

test("a failed legacy bonus top-up rolls back its ledger change and can be retried", async (t) => {
  const creator = await Creator.findOne({ userId }).orFail();
  await Creator.updateOne({ _id: creator._id }, { $set: { earnedSlots: 1 } });
  const grant = await Grant.create({ creatorId: creator._id, broadcasterId: "channel", twitchUserId: "twitch0",
    kind: "follower", period: "once", amount: 1, observedAt: new Date() });
  const failure = t.mock.method(Creator, "updateOne", () => { throw new Error("top-up failed"); });
  await assert.rejects(status.ensureCreator(userId), /top-up failed/);
  assert.equal((await Grant.findById(grant._id))?.amount, 1);
  assert.equal((await Creator.findById(creator._id))?.earnedSlots, 1);
  failure.mock.restore();
  assert.equal((await status.ensureCreator(userId)).earnedSlots, 3);
});

test("disconnect fences in-flight checks, preserves allowance and rejects account transfer", async () => {
  const creator = await connect();
  await status.observe(creator._id, creator.connectionRevision, "channel", true, true, "1000", new Date("2026-09-16T12:00:00Z"));
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => status.disconnect(String(userId), session));
    assert.deepEqual((await studio.getState(String(userId))).entitlements, { base: 2, follower: true, subscriber: true });
    await status.observe(creator._id, creator.connectionRevision, "channel", true, true, "1000", new Date("2026-10-16T12:00:00Z"));
    assert.equal((await Creator.findById(creator._id))?.earnedSlots, 8);
    await assert.rejects(session.withTransaction(() => status.connect(String(otherId), "twitch0", session)), { code: "account_bound" });
    await session.withTransaction(() => status.connect(String(userId), "twitch0", session));
    const current = await Creator.findById(creator._id).orFail();
    await status.observe(current._id, current.connectionRevision, "channel", true, true, "2000", new Date("2026-11-16T12:00:00Z"));
    assert.equal((await Creator.findById(creator._id))?.earnedSlots, 9);
  } finally { await session.endSession(); }
});

test("duplicate and out-of-order events preserve grants and latest status", async () => {
  await connect();
  await Promise.all(Array.from({ length: 3 }, () => status.recordEvent("same", "channel", "twitch0", true, "1000", new Date("2026-10-01T00:00:00Z"))));
  await status.recordEvent("older", "channel", "twitch0", true, "1000", new Date("2026-09-30T00:00:00Z"));
  await status.recordEvent("end", "channel", "twitch0", false, null, new Date("2026-11-02T00:00:00Z"));
  await status.recordEvent("late", "channel", "twitch0", true, "1000", new Date("2026-10-15T00:00:00Z"));
  const creator = await Creator.findOne({ userId }).orFail();
  assert.equal(creator.earnedSlots, 7);
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
  await studio.save(String(userId), String(current._id), { ...source.toObject().draft, revision: current.revision, performance: 80, mechanics: 60, backgroundId: "highmaul", backgroundOffsetX: 83 });
  current = await Source.findById(source._id).orFail();
  await assert.rejects(studio.publish(String(userId), String(current._id), current.revision), { code: "edit_cooldown" });
  await Source.updateOne({ _id: current._id }, { $set: { nextEditAt: new Date(0) } });
  await studio.publish(String(userId), String(current._id), current.revision);
  const card = await Card.findById(current.cardId).orFail();
  assert.equal(card.communityScores?.combined, 70);
  assert.equal(card.snapshotVersion, 1);
  assert.equal(card.backgroundPath, "/ccg/highmaul.png");
  assert.equal(card.backgroundCrop.x, 83);
  const serialized = ccg.serializeCard(card, await SetModel.findById(card.setId).orFail());
  assert.equal(serialized.backgroundPath, "/ccg/highmaul.png");
  assert.equal(await Card.countDocuments(), 1);
  assert.equal((await Creator.findOne({ userId }))?.draftCount, 0);
});

test("Supporter guild follows the shared roster on save and publication without refreshing artwork", async (t) => {
  const trackedGuildId = new mongoose.Types.ObjectId();
  await Guild.collection.insertOne({ _id: trackedGuildId, name: "Tracked Guild", realm: "Ravencrest", region: "eu" } as any);
  let guild: { name: string; realm?: { name: string; slug: string } } | undefined = {
    name: "tracked guild", realm: { name: "Ravencrest", slug: "ravencrest" },
  };
  t.mock.method(battlenet, "getWoWCharacters", async () => structuredClone(chars));
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({ guild }));
  assert.equal((await studio.getCharacters(String(userId), true)).rosterError, null);
  const source = await draft();
  const id = String(source._id);
  const state = await studio.getState(String(userId));
  assert.equal((state.creations[0].preview as Record<string, unknown> | null)?.guildName, "tracked guild");
  assert.equal(source.guildRealm, "Ravencrest", "Use the guild realm for cross-realm membership");
  assert.equal(String(source.guildId), String(trackedGuildId));
  await studio.publish(String(userId), id, source.revision);
  let current = await Source.findById(source._id).orFail();
  const cardId = current.cardId!;
  assert.equal((await Card.findById(cardId))?.guildName, "tracked guild");
  assert.equal((await SetModel.findById((await Card.findById(cardId))!.setId))?.collectionGuilds?.length, 1);

  guild = { name: "Untracked Guild" };
  await User.updateOne({ _id: userId }, { $set: { "battlenet.lastCharacterSync": new Date(0) } });
  await battlenet.refreshCharacters(String(userId));
  const callsAfterRefresh = provider.mock.callCount();
  const profile = t.mock.method(blizzard, "getCharacterProfile", async () => { throw new Error("Save must use the roster"); });
  const refreshed = await studio.save(String(userId), id, { ...source.toObject().draft, revision: current.revision });
  await Source.updateOne({ _id: source._id }, { $set: { nextEditAt: new Date(0) } });
  assert.equal((refreshed.creations[0].preview as Record<string, unknown> | null)?.guildName, "Untracked Guild");
  assert.equal((await Card.findById(cardId))?.guildName, "tracked guild", "Refresh only changes the preview until applied");
  current = await Source.findById(source._id).orFail();
  assert.equal(current.guildId, null);
  assert.equal(current.guildRealm, "Stormreaver", "Missing guild realm falls back to character realm");
  await studio.publish(String(userId), id, current.revision);
  assert.equal((await Card.findById(cardId))?.guildName, "Untracked Guild", "Guild need not be tracked by the site");
  assert.equal((await Card.findById(cardId))?.guildId, null);
  assert.equal((await SetModel.findById((await Card.findById(cardId))!.setId))?.collectionGuilds?.length, 0, "Guild filters lose the previous membership");
  assert.equal(provider.mock.callCount(), callsAfterRefresh);
  assert.equal(profile.mock.callCount(), 0);

  current = await Source.findById(source._id).orFail();
  await studio.save(String(userId), id, { ...source.toObject().draft, revision: current.revision });
  await Source.updateOne({ _id: source._id }, { $set: { nextEditAt: new Date(0) } });
  provider.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  await User.updateOne({ _id: userId }, { $set: { "battlenet.lastCharacterSync": new Date(0) } });
  await battlenet.refreshCharacters(String(userId));
  assert.equal((await User.findById(userId))?.battlenet?.characters[0].guild, "Untracked Guild", "Failed guild lookup preserves cached membership");
  guild = undefined;
  provider.mock.mockImplementation(async () => Response.json({}));
  await User.updateOne({ _id: userId }, { $set: { "battlenet.lastCharacterSync": new Date(0) } });
  await battlenet.refreshCharacters(String(userId));
  current = await Source.findById(source._id).orFail();
  await studio.publish(String(userId), id, current.revision);
  const card = await Card.findById(cardId).orFail();
  assert.equal(card.guildId, null);
  assert.equal(card.guildName, null);
  assert.equal(card.guildRealm, null);
  assert.equal(card.snapshotVersion, 1);
  assert.equal(await Card.countDocuments(), 1);
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
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 0, usedSlots: 2 } });
  await assert.rejects(studio.publish(String(userId), String(source._id), source.revision), { code: "no_slots" });
  assert.equal(await Card.countDocuments(), 0);
  assert.equal((await Creator.findOne({ userId }))?.draftCount, 1);
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 4 } });
  await User.updateOne({ _id: userId }, { $set: { "battlenet.characters": [] } });
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
  await Creator.updateOne({ userId }, { $set: { earnedSlots: 0, usedSlots: 1 } });
  const results = await Promise.allSettled([first, second].map((source) => studio.publish(String(userId), String(source._id), source.revision)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await Card.countDocuments(), 1);
  assert.equal((await Creator.findOne({ userId }))?.usedSlots, 2);
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

async function uploadImage(sourceId: mongoose.Types.ObjectId, red = 100) {
  const image = await sharp({ create: { width: 30, height: 40, channels: 4, background: { r: red, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  await studio.submitMedia(String(userId), String(sourceId), "image", image);
  return Media.findOne({ sourceId, kind: "image", status: "pending" }).orFail();
}

function audioFixture() {
  const wav = Buffer.alloc(44 + 32000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(32000, 40);
  return wav;
}

test("ten cards can be created, saved, published and uploaded with art and audio in one rate-limit window", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const creator = await Creator.findOneAndUpdate({ userId }, { $set: { earnedSlots: 8 } }, { returnDocument: "after" }).orFail();
  // An earlier render attempt must not prevent importing the tenth new character.
  await supporterLimit(`render:${creator._id}`, 20, 86_400_000);
  const request = async (endpoint: string, method = "GET", body?: Record<string, unknown> | Buffer) => {
    const response = await fetch(`${baseUrl}/api/ccg/studio${endpoint}`, {
      method, headers: { "x-test-user": String(userId), origin: "http://localhost:3000",
        "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json" },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const result = await response.json() as Awaited<ReturnType<typeof studio.getState>>;
    assert.equal(response.status, 200, `${method} ${endpoint}: ${JSON.stringify(result)}`);
    return result;
  };
  await request("");
  await request("/characters");
  const ids: string[] = [];
  for (const character of chars) {
    let state = await request("/drafts", "POST", { characterId: character.id, realmId: character.realmId });
    let source = state.creations.find((entry) => entry.characterId === character.id)!;
    assert.equal(source.renderError, false);
    assert.ok(source.draft?.renderAssetId);
    await request("");
    for (const performance of [50, 70, 90]) {
      state = await request(`/drafts/${source.id}`, "PATCH", { ...source.draft, performance, revision: source.revision });
      source = state.creations.find((entry) => entry.id === source.id)!;
      await request("");
    }
    await request(`/drafts/${source.id}/publish`, "POST", { revision: source.revision });
    await request("");
    ids.push(source.id);
  }
  const image = await sharp({ create: { width: 30, height: 40, channels: 4, background: { r: 100, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const audio = audioFixture();
  const uploads = await Promise.allSettled(ids.flatMap((id) => [
    request(`/media/${id}/image`, "POST", image), request(`/media/${id}/audio`, "POST", audio),
  ]));
  for (const upload of uploads) if (upload.status === "rejected") throw upload.reason;
  const final = await request("");
  assert.equal(final.allowance.used, 10);
  assert.equal(final.allowance.available, 0);
  assert.equal(final.allowance.drafts, 0);
  for (const id of ids) {
    const rows = await Media.find({ sourceId: id, status: "pending" });
    assert.deepEqual(rows.map((row) => row.kind).sort(), ["audio", "image"]);
  }
  assert.equal(await Card.countDocuments({ creatorUserId: userId }), 10);
  assert.equal((await Limit.findOne({ key: `media-accepted:${userId}:${Math.floor(Date.now() / 86_400_000)}` }))?.count, 20);
});

test("media quota allows forty successful uploads and ignores failures and legacy attempt counts", async () => {
  const source = await publish();
  const window = Math.floor(Date.now() / 86_400_000);
  const key = `media-accepted:${userId}:${window}`;
  await Limit.create({ key: `media:${userId}:${window}`, count: 6, expiresAt: new Date((window + 1) * 86_400_000) });
  for (let attempt = 0; attempt < 12; attempt++) {
    await assert.rejects(studio.submitMedia(String(userId), String(source._id), "image", Buffer.from("bad")), { code: "media_image_format" });
  }
  assert.equal(await Limit.findOne({ key }), null);
  for (let accepted = 1; accepted <= 40; accepted++) {
    const row = await uploadImage(source._id);
    await assert.rejects(studio.submitMedia(String(userId), String(source._id), "image", Buffer.from("bad")), { code: "media_pending" });
    assert.equal((await Limit.findOne({ key }))?.count, accepted);
    await studio.withdrawMedia(String(userId), String(row._id));
  }
  await assert.rejects(uploadImage(source._id), { code: "rate_limited" });
  assert.equal((await Limit.findOne({ key }))?.count, 40);
  assert.equal(await Media.countDocuments({ sourceId: source._id, status: { $in: ["pending", "processing"] } }), 0);
});

test("media quota rolls back with a failed upload transaction", async (t) => {
  const source = await publish();
  const charge = Limit.findOneAndUpdate;
  const failure = t.mock.method(Limit, "findOneAndUpdate", (async (...args: any[]) => {
    await (charge as any).apply(Limit, args);
    throw new Error("Simulated transaction failure after quota charge");
  }) as any);
  await assert.rejects(uploadImage(source._id), /Simulated transaction failure/);
  failure.mock.restore();
  assert.equal(await Limit.countDocuments({ key: new RegExp(`^media-accepted:${userId}:`) }), 0);
  await uploadImage(source._id);
  assert.equal((await Limit.findOne({ key: new RegExp(`^media-accepted:${userId}:`) }))?.count, 1);
});

test("concurrent uploads cannot both claim the last daily media slot", async () => {
  const first = await publish(1);
  const second = await publish(2);
  const window = Math.floor(Date.now() / 86_400_000);
  const key = `media-accepted:${userId}:${window}`;
  await Limit.create({ key, count: 39, expiresAt: new Date((window + 1) * 86_400_000) });
  const results = await Promise.allSettled([uploadImage(first._id), uploadImage(second._id)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "rate_limited");
  assert.equal((await Limit.findOne({ key }))?.count, 40);
  assert.equal(await Media.countDocuments({ status: "pending" }), 1);
});

test("quota rejection keeps converted animation eligible for file cleanup", async () => {
  const source = await publish();
  const window = Math.floor(Date.now() / 86_400_000);
  await Limit.create({ key: `media-accepted:${userId}:${window}`, count: 40, expiresAt: new Date((window + 1) * 86_400_000) });
  const pixels = Buffer.alloc(32 * 32 * 4);
  pixels.fill(255, 0, pixels.length / 2);
  const gif = await sharp(pixels, { raw: { width: 32, height: 32, channels: 4 } }).gif().toBuffer();
  await assert.rejects(studio.submitMedia(String(userId), String(source._id), "image", gif), { code: "rate_limited" });
  const failed = await Media.findOne({ sourceId: source._id, status: "failed" }).orFail();
  assert.match(failed.storageKey!, /\.webm$/);
  const file = path.join(process.env.CCG_MEDIA_CACHE_DIR!, failed.storageKey!);
  assert.ok((await stat(file)).size > 0);
  await mediaService.cleanup();
  await assert.rejects(stat(file), { code: "ENOENT" });
});

test("AI approval is audited, replaces approved art and can be revoked by an admin", async (t) => {
  const source = await publish();
  const first = await uploadImage(source._id);
  await mediaService.review(String(first._id), String(otherId), "approve", "");
  t.mock.method(artReview, "review", async (): Promise<SupporterArtReview> => ({ decision: "safe", safetyConfidence: 99, reason: "Fantasy character.",
    model: "gpt-6-luna", policyVersion: "supporter-art-v1", responseId: "test-response", autoApproved: true, reviewedAt: new Date() }));
  const image = await sharp({ create: { width: 30, height: 40, channels: 4, background: { r: 150, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  await studio.submitMedia(String(userId), String(source._id), "image", image);
  const approved = await Media.findOne({ sourceId: source._id, status: "approved" }).orFail();
  assert.equal(approved.aiReview?.autoApproved, true);
  assert.equal(approved.reviewedBy, null);
  assert.equal((await Media.findById(first._id))?.status, "superseded");
  assert.equal(await Card.countDocuments(), 1);
  const queue = await mediaService.list([source._id], true);
  assert.equal(queue.find((row) => row.id === String(approved._id))?.aiReview?.safetyConfidence, 99);
  assert.ok((await mediaService.list([source._id])).every((row) => !row.aiReview), "AI details are admin-only");
  await mediaService.review(String(approved._id), String(otherId), "revoke", "Needs a different image.");
  assert.equal((await Media.findById(approved._id))?.status, "rejected");
});

test("uncertain, rejected and failed AI reviews all stay pending", async (t) => {
  const source = await publish();
  for (const decision of ["review", "reject", "error"] as const) {
    const review = t.mock.method(artReview, "review", async (): Promise<SupporterArtReview> => ({ decision, safetyConfidence: decision === "error" ? null : 40,
      reason: "Needs admin review.", model: "gpt-6-luna", policyVersion: "supporter-art-v1", responseId: null, autoApproved: false, reviewedAt: new Date() }));
    const row = await uploadImage(source._id);
    assert.equal(row.status, "pending");
    assert.equal(row.aiReview?.decision, decision);
    await studio.withdrawMedia(String(userId), String(row._id));
    review.mock.restore();
  }
});

test("pending media is private, card stays public, approval unlocks only that Supporter card", async () => {
  const source = await publish(1, "phaseglass");
  const card = await Card.findById(source.cardId).orFail();
  await AlternativeArt.create({ collectorKey: card.collectorKey!, characterArtFilename: "existing.png", characterArtEnabled: true, quipAudioFilename: "existing.mp3" });
  await assert.rejects(ccg.updateAlternativeArtForAdmin(String(card._id), {}), { code: "supporter_media_review_required" });
  const pending = await uploadImage(source._id);
  assert.equal(await Card.countDocuments(), 1);
  assert.equal((await Card.findById(card._id))?.snapshotVersion, 1);
  const load = () => (ccg as any).loadAlternativeArt([card]);
  assert.equal((await load()).get(resolveAlternativeArtKey(card)), undefined, "Pending and character-wide art must not leak");
  const url = `${baseUrl}/api/ccg/media/supporter/${pending._id}`;
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url, { headers: { "x-test-user": String(otherId) } })).status, 404);
  const preview = await fetch(url, { headers: { "x-test-user": String(userId) } });
  assert.equal(preview.status, 200); assert.match(preview.headers.get("cache-control")!, /no-store/);
  assert.equal((await fetch(`${baseUrl}/api/ccg/studio/media-review/${pending._id}`, { method: "POST", headers: { "x-test-user": String(userId), origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }) })).status, 403);
  await mediaService.review(String(pending._id), String(otherId), "approve", "");
  assert.equal((await fetch(url)).status, 200);
  const definitions = await (ccg as any).loadAlternativeArt([card, { characterId: new mongoose.Types.ObjectId(), collectorKey: card.collectorKey }]);
  assert.equal(definitions.get(resolveAlternativeArtKey(card)).characterArtPath, `/api/ccg/media/supporter/${pending._id}`);
  assert.equal(definitions.get(card.collectorKey).characterArtFilename, "existing.png");
  assert.equal(definitions.get(resolveAlternativeArtKey(card)).quipAudioFilename, undefined);
  const session = await mongoose.startSession();
  try { await session.withTransaction(() => (ccg as any).addOwnership({ ownerType: "user", ownerId: otherId }, [{ cardId: card._id, setId: card.setId, characterId: card.characterId, snapshotVersion: 1, finish: "phaseglass", artVariant: "alternative" }], session)); }
  finally { await session.endSession(); }
  assert.equal((await Ownership.findOne({ ownerId: otherId, cardId: card._id }))?.alternativeQuantity, 1);
});

test("replacement approval is atomic and withdrawal or rejection leaves approved media live", async () => {
  const source = await publish();
  const first = await uploadImage(source._id);
  await mediaService.review(String(first._id), String(otherId), "approve", "");
  const replacement = await uploadImage(source._id, 150);
  await assert.rejects(uploadImage(source._id, 180), { code: "media_pending" });
  assert.equal((await fetch(`${baseUrl}/api/ccg/media/supporter/${replacement._id}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/ccg/media/supporter/${first._id}`)).status, 200);
  const decisions = await Promise.allSettled([mediaService.review(String(replacement._id), String(otherId), "approve", ""), mediaService.review(String(replacement._id), String(otherId), "approve", "")]);
  assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await Media.findById(first._id))?.status, "superseded");
  assert.equal(await Media.countDocuments({ sourceId: source._id, kind: "image", status: "approved" }), 1);
  const next = await uploadImage(source._id, 190);
  await studio.withdrawMedia(String(userId), String(next._id));
  await assert.rejects(mediaService.review(String(next._id), String(otherId), "approve", ""), { code: "media_changed" });
  await mediaService.review(String(replacement._id), String(otherId), "revoke", "Please use a different image.");
  assert.equal((await fetch(`${baseUrl}/api/ccg/media/supporter/${replacement._id}`)).status, 404);
  const card = await Card.findById(source.cardId).orFail();
  assert.equal((await (ccg as any).loadAlternativeArt([card])).get(resolveAlternativeArtKey(card)), undefined);
});

test("creators can remove approved images without removing the card or pending replacement", async () => {
  const source = await publish();
  const card = await Card.findById(source.cardId).orFail();
  const image = await uploadImage(source._id);
  await mediaService.review(String(image._id), String(otherId), "approve", "");
  const replacement = await uploadImage(source._id, 150);
  const remove = (actor: mongoose.Types.ObjectId) => fetch(`${baseUrl}/api/ccg/studio/media/${image._id}`, {
    method: "DELETE", headers: { "x-test-user": String(actor), origin: "http://localhost:3000", "content-type": "application/json" }, body: "{}",
  });
  assert.equal((await remove(otherId)).status, 404);
  assert.equal((await Media.findById(image._id))?.status, "approved");
  const response = await remove(userId);
  assert.equal(response.status, 200, await response.text());
  assert.equal((await Media.findById(image._id))?.status, "withdrawn");
  assert.ok((await Media.findById(image._id))?.purgeAfter);
  assert.equal((await fetch(`${baseUrl}/api/ccg/media/supporter/${image._id}`)).status, 404);
  assert.equal((await (ccg as any).loadAlternativeArt([card])).get(resolveAlternativeArtKey(card)), undefined);
  assert.equal((await Card.findById(card._id))?.snapshotVersion, 1);
  assert.equal((await Media.findById(replacement._id))?.status, "pending");
  await mediaService.review(String(replacement._id), String(otherId), "approve", "");
  assert.equal((await remove(userId)).status, 404, "A stale removal cannot remove the replacement");
  assert.equal((await Media.findById(replacement._id))?.status, "approved");
});

test("removal racing replacement approval cannot remove the replacement", async () => {
  const source = await publish();
  const image = await uploadImage(source._id);
  await mediaService.review(String(image._id), String(otherId), "approve", "");
  const replacement = await uploadImage(source._id, 150);
  const [removal, approval] = await Promise.allSettled([
    studio.withdrawMedia(String(userId), String(image._id)),
    mediaService.review(String(replacement._id), String(otherId), "approve", ""),
  ]);
  assert.equal(approval.status, "fulfilled");
  if (removal.status === "rejected") assert.ok(["invalid_media", "media_changed"].includes(removal.reason.code));
  assert.equal((await Media.findById(replacement._id))?.status, "approved");
  assert.equal(await Media.countDocuments({ sourceId: source._id, status: "approved" }), 1);
  assert.notEqual((await Media.findById(image._id))?.status, "approved");
});

test("media upload requires publication and ownership; cleanup never removes approved files", async () => {
  const source = await draft();
  await assert.rejects(studio.submitMedia(String(userId), String(source._id), "image", Buffer.from("bad")), { code: "media_publish_first" });
  await studio.publish(String(userId), String(source._id), source.revision);
  await assert.rejects(studio.submitMedia(String(otherId), String(source._id), "image", Buffer.from("bad")), { code: "character_not_found" });
  const image = await uploadImage(source._id);
  await mediaService.review(String(image._id), String(otherId), "approve", "");
  const rejected = await uploadImage(source._id, 140);
  await mediaService.review(String(rejected._id), String(otherId), "reject", "Please remove the background.");
  await Media.updateOne({ _id: rejected._id }, { $set: { purgeAfter: new Date(0) } });
  await mediaService.cleanup();
  assert.ok((await Media.findById(rejected._id))?.purgedAt);
  assert.equal((await fetch(`${baseUrl}/api/ccg/media/supporter/${image._id}`)).status, 200);
  const response = await fetch(`${baseUrl}/api/ccg/studio/media/${source._id}/image`, { method: "POST", headers: { "x-test-user": String(userId), origin: "https://other.invalid", "content-type": "application/octet-stream" }, body: "bad" });
  assert.equal(response.status, 403);
});

test("audio submission is reviewed independently and approved media rolls through real Supporter packs", async (t) => {
  const ai = t.mock.method(artReview, "review", artReview.review);
  const source = await publish(1, "phaseglass");
  const card = await Card.findById(source.cardId).orFail();
  const wav = audioFixture();
  const response = await fetch(`${baseUrl}/api/ccg/studio/media/${source._id}/audio`, { method: "POST", headers: {
    "x-test-user": String(userId), origin: "http://localhost:3000", "content-type": "application/octet-stream",
  }, body: wav });
  assert.equal(response.status, 200, await response.text());
  const audio = await Media.findOne({ sourceId: source._id, kind: "audio", status: "pending" }).orFail();
  assert.equal(ai.mock.callCount(), 0, "Audio never goes through AI review");
  assert.equal(audio.aiReview, null);
  const image = await uploadImage(source._id);
  await mediaService.review(String(audio._id), String(otherId), "approve", "");
  const definition = (await (ccg as any).loadAlternativeArt([card])).get(resolveAlternativeArtKey(card));
  assert.ok(definition.quipAudioPath); assert.equal(definition.characterArtEnabled, undefined);
  assert.equal((await Media.findById(image._id))?.status, "pending");
  const audioResponse = await fetch(`${baseUrl}${definition.quipAudioPath}`, { headers: { Range: "bytes=0-127" } });
  assert.equal(audioResponse.status, 206); assert.equal(audioResponse.headers.get("content-type"), "audio/mpeg");
  await mediaService.review(String(image._id), String(otherId), "approve", "");
  t.mock.method(crypto, "randomInt", ((maximum: number) => maximum - 1) as typeof crypto.randomInt);
  const owner = { ownerType: "user" as const, ownerId: otherId, dateKey: "2026-09-16" };
  t.mock.method(ccg, "resolveOwner", async () => owner);
  await CcgPackBalance.create({ ...owner, remaining: 10, lastRechargeAt: new Date(), grantVersion: CCG_PACK_BALANCE_VERSION });
  const opening = await ccg.openPack({} as any, {} as any, { type: "supporter", idempotencyKey: "approved_media_pack" }) as any;
  assert.ok(opening.results.every((row: any) => row.artVariant === "alternative" && row.card.alternativeArt.characterArtEnabled && row.card.quip.audioPath === definition.quipAudioPath));
  assert.equal((await Card.findById(card._id))?.snapshotVersion, 1);
  await studio.withdrawMedia(String(userId), String(audio._id));
  const afterRemoval = (await (ccg as any).loadAlternativeArt([card])).get(resolveAlternativeArtKey(card));
  assert.equal(afterRemoval.quipAudioPath, undefined);
  assert.equal(afterRemoval.characterArtEnabled, true);
  assert.equal((await Media.findById(image._id))?.status, "approved");
  assert.equal((await fetch(`${baseUrl}${definition.quipAudioPath}`)).status, 404);
});
