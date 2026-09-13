import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test, { after, before, beforeEach } from "node:test";
import mongoose from "mongoose";
import { getCcgFinishOrder } from "../src/config/ccg";
import CcgAnalyticsDaily from "../src/models/CcgAnalyticsDaily";
import CcgCard from "../src/models/CcgCard";
import CcgCollectorProfile from "../src/models/CcgCollectorProfile";
import CcgJobLock from "../src/models/CcgJobLock";
import CcgLeaderboardEntry from "../src/models/CcgLeaderboardEntry";
import CcgLedgerEntry from "../src/models/CcgLedgerEntry";
import CcgMigration from "../src/models/CcgMigration";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgPackOpening from "../src/models/CcgPackOpening";
import CcgQualityProgress from "../src/models/CcgQualityProgress";
import CcgRedeemClaim from "../src/models/CcgRedeemClaim";
import CcgRedeemCode from "../src/models/CcgRedeemCode";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import CcgSet from "../src/models/CcgSet";
import CcgShare from "../src/models/CcgShare";
import TwitchCcgOverlayEvent from "../src/models/TwitchCcgOverlayEvent";
import TwitchCcgRedemption from "../src/models/TwitchCcgRedemption";
import User from "../src/models/User";
import {
  assertCcgAntorusFinishReady,
  migrateCcgAntorusFinish,
  planCcgAntorusFinishMigration,
  refreshCcgAntorusMigrationLeaderboard,
} from "../src/services/ccg-antorus-finish-migration.service";
import ccgLeaderboardService from "../src/services/ccg-leaderboard.service";

// This suite only connects to the disposable localhost replica set documented in the runbook.
const database = `ccg_antorus_test_${process.pid}`;
const models = [CcgAnalyticsDaily, CcgCard, CcgCollectorProfile, CcgJobLock, CcgLeaderboardEntry,
  CcgLedgerEntry, CcgMigration, CcgOwnership, CcgPackOpening, CcgQualityProgress, CcgRedeemClaim,
  CcgRedeemCode, CcgSeriesOwnership, CcgSet, CcgShare, TwitchCcgOverlayEvent, TwitchCcgRedemption, User];
const id = () => new mongoose.Types.ObjectId();
const setId = id(), otherSetId = id(), cardId = id(), snapshotId = id(), otherCardId = id();
const userId = id(), guestId = id(), characterId = id();
const acquiredAt = new Date("2026-09-01T12:00:00Z");
const openedAt = new Date("2026-09-02T22:30:00Z"); // September 3 in Helsinki.
const award = (card = cardId, set = setId, finish = "worldcore") => ({ cardId: card, setId: set, finish, artVariant: "alternative", tierGrade: "C" });

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27137/${database}?directConnection=true`, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
  for (const model of models) await model.createCollection();
  await CcgOwnership.collection.createIndex({ ownerType: 1, ownerId: 1, setId: 1, characterId: 1, finish: 1 }, { unique: true });
  await CcgShare.collection.createIndex({ kind: 1, userId: 1, cardId: 1, finish: 1, artVariant: 1 }, { unique: true, partialFilterExpression: { kind: "card" } });
  await CcgMigration.collection.createIndex({ key: 1 }, { unique: true });
  await CcgJobLock.collection.createIndex({ key: 1 }, { unique: true });
});

after(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  for (const model of models) await model.collection.deleteMany({});
  await CcgSet.collection.insertMany([
    { _id: setId, zoneId: 17, slug: "antorus", customFinish: { key: "worldcore", hardPity: 250 }, kind: "raid", cardCount: 1, enabledAt: acquiredAt },
    { _id: otherSetId, zoneId: -1, slug: "community", kind: "community", cardCount: 1, enabledAt: acquiredAt },
  ]);
  await CcgCard.collection.insertMany([
    { _id: cardId, setId, characterId, snapshotVersion: 1, tierGrade: "C" },
    { _id: snapshotId, setId, characterId, snapshotVersion: 2, tierGrade: "B" },
    { _id: otherCardId, setId: otherSetId, characterId, snapshotVersion: 1, tierGrade: "C" },
  ]);
  await User.collection.insertOne({ _id: userId, discord: { id: "123456789", username: "Migration fixture", avatar: null } });
  await CcgOwnership.collection.insertMany([
    ...getCcgFinishOrder("worldcore").map((finish) => ({ ownerType: "user", ownerId: userId, setId, characterId, cardId, finish, quantity: 3, alternativeQuantity: 1, firstAcquiredAt: acquiredAt, lastAcquiredAt: openedAt })),
    { ownerType: "guest", ownerId: guestId, setId, characterId, cardId: snapshotId, finish: "worldcore", quantity: 2, alternativeQuantity: 2, firstAcquiredAt: acquiredAt, lastAcquiredAt: openedAt },
    { ownerType: "user", ownerId: userId, setId: otherSetId, characterId, cardId: otherCardId, finish: "worldcore", quantity: 1, alternativeQuantity: 0, firstAcquiredAt: acquiredAt, lastAcquiredAt: openedAt },
  ]);
  await CcgSeriesOwnership.collection.insertMany([
    { ownerType: "user", ownerId: userId, setId, characterId, unlockedSnapshotVersions: [1, 2], firstAcquiredAt: acquiredAt, lastAcquiredAt: openedAt },
    { ownerType: "user", ownerId: userId, setId: otherSetId, characterId, unlockedSnapshotVersions: [1], firstAcquiredAt: acquiredAt, lastAcquiredAt: openedAt },
  ]);
  await CcgQualityProgress.collection.insertOne({ ownerType: "user", ownerId: userId, custom: { antorus: 249, community: 13 }, foil: 4 });
  await CcgPackOpening.collection.insertMany([
    { state: "committed", analyticsPending: false, results: [award(), award(snapshotId), award(otherCardId, otherSetId), award(cardId, setId, "foil")], createdAt: openedAt },
    { state: "committed", analyticsPending: true, results: [award()], createdAt: openedAt },
  ]);
  await CcgAnalyticsDaily.collection.insertOne({ dateKey: "2026-09-03", finishes: { worldcore: 3, foil: 1 }, packOpenings: 1, activeUsers: 1, grades: { C: 4 } });
  await CcgCollectorProfile.collection.insertOne({ userId, showcase: [award(snapshotId), award(otherCardId, otherSetId), award(cardId, setId, "foil")] });
  for (const model of [CcgShare, CcgRedeemCode, CcgRedeemClaim, TwitchCcgOverlayEvent]) {
    await model.collection.insertMany([
      { ...award(snapshotId), userId, kind: "card", publicId: "preserved-antorus-link", createdAt: acquiredAt },
      { ...award(otherCardId, otherSetId), userId, kind: "card", publicId: "preserved-other-link", createdAt: acquiredAt },
    ]);
  }
  await TwitchCcgRedemption.collection.insertOne({ assignedCard: award(), assignedCards: [award(snapshotId), award(otherCardId, otherSetId)], grantStatus: "pending" });
  await CcgLedgerEntry.collection.insertOne({ metadata: { cardId: String(cardId), finish: "worldcore", cards: [{ cardId: String(snapshotId), finish: "worldcore" }, { cardId: String(otherCardId), finish: "worldcore" }] }, amount: 2, createdAt: acquiredAt });
});

async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const model of models) result[model.modelName] = await model.collection.find({}).sort({ _id: 1 }).toArray();
  return result;
}

test("dry run reports affected documents without changing any data", async () => {
  const original = await snapshot();
  const plan = await planCcgAntorusFinishMigration();
  assert.equal(plan.cards, 2);
  assert.equal(plan.documents.ownership, 2);
  assert.equal(plan.documents.packOpenings, 2);
  assert.equal(plan.documents.showcases, 1);
  assert.equal(plan.analyticsDays, 1);
  assert.equal(plan.analyticsResults, 2);
  assert.equal(plan.ownershipConflicts, 0);
  assert.equal(plan.shareConflicts, 0);
  assert.deepEqual(await snapshot(), original);
  await assert.rejects(assertCcgAntorusFinishReady(), /migration is required/);
});

test("migration preserves quantities, snapshots, pity, shares and completion; rerun is a no-op", async () => {
  await ccgLeaderboardService.refresh("full");
  const leaderboardBefore = await CcgLeaderboardEntry.collection.findOne({ userId });
  const ownershipBefore = await CcgOwnership.collection.find({ setId }).sort({ _id: 1 }).toArray();
  const seriesBefore = await CcgSeriesOwnership.collection.find({}).toArray();
  const pityBefore = await CcgQualityProgress.collection.find({}).toArray();
  const cardsBefore = await CcgCard.collection.find({}).toArray();
  await migrateCcgAntorusFinish();
  await assert.rejects(assertCcgAntorusFinishReady(), /migration is required/);
  await refreshCcgAntorusMigrationLeaderboard();
  await assertCcgAntorusFinishReady();
  assert.deepEqual(await CcgOwnership.collection.find({ setId }).sort({ _id: 1 }).toArray(), ownershipBefore.map((row) => ({ ...row, finish: row.finish === "worldcore" ? "felforged" : row.finish })));
  assert.deepEqual(await CcgSeriesOwnership.collection.find({}).toArray(), seriesBefore);
  assert.deepEqual(await CcgQualityProgress.collection.find({}).toArray(), pityBefore);
  assert.deepEqual(await CcgCard.collection.find({}).toArray(), cardsBefore);
  assert.equal((await CcgOwnership.collection.findOne({ setId: otherSetId }))?.finish, "worldcore");
  const set = await CcgSet.collection.findOne({ _id: setId });
  assert.deepEqual(set?.customFinish, { key: "felforged", hardPity: 250 });
  for (const model of [CcgShare, CcgRedeemCode, CcgRedeemClaim, TwitchCcgOverlayEvent]) {
    const row = await model.collection.findOne({ cardId: snapshotId });
    assert.equal(row?.finish, "felforged");
    assert.equal(row?.publicId, "preserved-antorus-link");
    assert.equal((await model.collection.findOne({ cardId: otherCardId }))?.finish, "worldcore");
  }
  const opening = await CcgPackOpening.collection.findOne({ analyticsPending: false });
  assert.deepEqual(opening?.results.map((row: { finish: string }) => row.finish), ["felforged", "felforged", "worldcore", "foil"]);
  assert.equal((await CcgPackOpening.collection.findOne({ analyticsPending: true }))?.results[0].finish, "felforged");
  const daily = await CcgAnalyticsDaily.collection.findOne({ dateKey: "2026-09-03" });
  assert.deepEqual(daily?.finishes, { worldcore: 1, foil: 1, felforged: 2 });
  assert.equal(daily?.packOpenings, 1);
  const showcase = await CcgCollectorProfile.collection.findOne({ userId });
  assert.deepEqual(showcase?.showcase.map((row: { finish: string }) => row.finish), ["felforged", "worldcore", "foil"]);
  const twitch = await TwitchCcgRedemption.collection.findOne({});
  assert.equal(twitch?.assignedCard.finish, "felforged");
  assert.deepEqual(twitch?.assignedCards.map((row: { finish: string }) => row.finish), ["felforged", "worldcore"]);
  assert.equal(twitch?.grantStatus, "pending");
  const ledger = await CcgLedgerEntry.collection.findOne({});
  assert.equal(ledger?.metadata.finish, "felforged");
  assert.deepEqual(ledger?.metadata.cards.map((row: { finish: string }) => row.finish), ["felforged", "worldcore"]);
  const leaderboardAfter = await CcgLeaderboardEntry.collection.findOne({ userId });
  assert.equal(leaderboardAfter?.score, leaderboardBefore?.score);
  assert.equal(leaderboardAfter?.completedCards, 1);
  assert.equal(leaderboardAfter?.finishCounts.worldcore, 1);
  assert.equal(leaderboardAfter?.finishCounts.felforged, 1);
  const migrated = await snapshot();
  await migrateCcgAntorusFinish();
  await refreshCcgAntorusMigrationLeaderboard();
  assert.deepEqual(await snapshot(), migrated);
  assert.ok(Object.values((await planCcgAntorusFinishMigration()).documents).every((count) => count === 0));
});

test("ownership collisions abort before any writes", async () => {
  await CcgOwnership.collection.insertOne({ ownerType: "user", ownerId: userId, setId, characterId, cardId: snapshotId, finish: "felforged", quantity: 1 });
  const original = await snapshot();
  assert.equal((await planCcgAntorusFinishMigration()).ownershipConflicts, 1);
  await assert.rejects(migrateCcgAntorusFinish(), /Conflicting Antorus/);
  assert.deepEqual(await snapshot(), original);
});

test("share collisions preserve both URLs and abort before any writes", async () => {
  await CcgShare.collection.insertOne({ userId, cardId: snapshotId, kind: "card", finish: "felforged", artVariant: "alternative", publicId: "existing-felforged-link" });
  const original = await snapshot();
  assert.equal((await planCcgAntorusFinishMigration()).shareConflicts, 1);
  await assert.rejects(migrateCcgAntorusFinish(), /Conflicting Antorus/);
  assert.deepEqual(await snapshot(), original);
});

test("a database error after writes rolls back all changes and the marker", async () => {
  const original = await snapshot();
  const collection = CcgAnalyticsDaily.collection;
  const updateOne = collection.updateOne;
  collection.updateOne = async () => { throw new Error("Injected analytics failure"); };
  try {
    await assert.rejects(migrateCcgAntorusFinish(), /Injected analytics failure/);
  } finally {
    collection.updateOne = updateOne;
  }
  assert.deepEqual(await snapshot(), original);
});

test("leaderboard lock leaves a resumable migration and blocks startup", async () => {
  await migrateCcgAntorusFinish();
  const lock = await CcgJobLock.collection.insertOne({ key: "ccg-leaderboard-refresh-v1", owner: "test", expiresAt: new Date(Date.now() + 60_000) });
  await assert.rejects(refreshCcgAntorusMigrationLeaderboard(), /refresh is locked/);
  await assert.rejects(assertCcgAntorusFinishReady(), /migration is required/);
  await CcgJobLock.collection.deleteOne({ _id: lock.insertedId });
  await migrateCcgAntorusFinish();
  await refreshCcgAntorusMigrationLeaderboard();
  await assertCcgAntorusFinishReady();
});

test("analytics mismatch aborts, and fresh databases need no migration", async () => {
  await CcgAnalyticsDaily.collection.updateOne({}, { $set: { "finishes.worldcore": 1 } });
  const original = await snapshot();
  await assert.rejects(migrateCcgAntorusFinish(), /analytics are inconsistent/);
  assert.deepEqual(await snapshot(), original);
  for (const model of models) await model.collection.deleteMany({});
  await assertCcgAntorusFinishReady();
  assert.equal((await planCcgAntorusFinishMigration()).setFound, false);
  await assert.rejects(migrateCcgAntorusFinish(), /set was not found/);
});

test("CLI defaults to dry run, requires stopped writers, and verifies an applied migration", async () => {
  const run = (args: string[]) => promisify(execFile)(process.execPath, ["-r", "ts-node/register", "src/scripts/migrate-ccg-antorus-finish.ts", ...args], {
    env: { ...process.env, MONGODB_URI: `mongodb://127.0.0.1:27137/${database}?directConnection=true`, DOTENV_CONFIG_PATH: "integration/nonexistent-test-env" },
    timeout: 60_000,
  });
  const original = await snapshot();
  assert.match((await run([])).stdout, /dry run/);
  assert.deepEqual(await snapshot(), original);
  await assert.rejects(run(["--apply"]), /Stop all API and worker processes/);
  assert.deepEqual(await snapshot(), original);
  assert.match((await run(["--apply", "--writers-stopped"])).stdout, /migration verified; leaderboard refreshed/);
  await assertCcgAntorusFinishReady();
  assert.ok(Object.values((await planCcgAntorusFinishMigration()).documents).every((count) => count === 0));
});
