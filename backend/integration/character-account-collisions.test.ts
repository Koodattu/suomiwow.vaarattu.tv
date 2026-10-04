import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION as signalVersion } from "../src/config/achievement-signals";
import Character from "../src/models/Character";
import CharacterAccountGroup from "../src/models/CharacterAccountGroup";
import CharacterAccountMatch from "../src/models/CharacterAccountMatch";
import CharacterAccountManualEdge from "../src/models/CharacterAccountManualEdge";
import CharacterContinuityLink from "../src/models/CharacterContinuityLink";
import CharacterAchievementFingerprint from "../src/models/CharacterAchievementFingerprint";
import CharacterAchievementToken from "../src/models/CharacterAchievementToken";
import CharacterAchievementFetchQueue from "../src/models/CharacterAchievementFetchQueue";
import CharacterRaidAchievementSummary, { CHARACTER_RAID_ACHIEVEMENT_SUMMARY_VERSION as version } from "../src/models/CharacterRaidAchievementSummary";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import Cache from "../src/models/Cache";
import service, { buildCharacterAchievementSnapshotKey } from "../src/services/character-achievement.service";
import { auditCharacterAccountCollisions, applyCharacterAccountCollisionRepair } from "../src/scripts/repair-character-account-collisions";

// Use only the disposable local replica set; never load deployment credentials.
const database = `character_account_collisions_test_${process.pid}`;
const models = [Character, CharacterAccountGroup, CharacterAccountMatch, CharacterAccountManualEdge, CharacterContinuityLink,
  CharacterAchievementFingerprint, CharacterAchievementToken, CharacterAchievementFetchQueue,
  CharacterRaidAchievementSummary, CharacterRaidParticipation, Cache];
const [warlock, rogue, alt, manualA, manualB] = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
const fetchedAt = new Date("2026-07-09T05:57:42Z");
const tokens = Array.from({ length: 60 }, (_, i) => `${i}:123456789`);
const historical = { characterId: warlock, name: "Jappe", realm: "stormreaver", region: "eu", classID: 10, wclCanonicalCharacterId: 72802025 };

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27141/${database}?directConnection=true`, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
  for (const model of models) await model.createCollection();
  await CharacterAccountGroup.createIndexes();
});
after(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  for (const model of models) await model.collection.deleteMany({});
  await Character.collection.insertMany([
    { _id: warlock, ...historical },
    { _id: rogue, ...historical, characterId: rogue, classID: 8 },
    { _id: alt, name: "Jape", realm: "stormreaver", region: "eu", classID: 1, wclCanonicalCharacterId: 100 },
    { _id: manualA, name: "ManualA", realm: "stormreaver", region: "eu", classID: 2, wclCanonicalCharacterId: 200 },
    { _id: manualB, name: "ManualB", realm: "stormreaver", region: "eu", classID: 3, wclCanonicalCharacterId: 300 },
  ]);
  await CharacterAchievementFingerprint.collection.insertMany([
    { ...historical, signalVersion, signalTokens: tokens, fetchedAt },
    { ...historical, characterId: rogue, classID: 8, signalVersion, signalTokens: tokens, fetchedAt },
  ]);
  await CharacterAchievementToken.collection.insertMany([
    { signalVersion, token: tokens[0], characterIds: [warlock, rogue, alt], characterCount: 3 },
    { signalVersion, token: tokens[1], characterIds: [warlock], characterCount: 1 },
    { signalVersion: "older-version", token: tokens[0], characterIds: [warlock], characterCount: 1 },
  ]);
  await CharacterAccountMatch.collection.insertMany([[warlock, rogue], [warlock, alt], [rogue, alt]].map(([characterAId, characterBId]) => ({ signalVersion, characterAId, characterBId, confidence: "high", score: 95 })));
  await CharacterAccountManualEdge.collection.insertOne({ characterAId: manualA, characterBId: manualB, createdBy: "test" });
  await CharacterRaidAchievementSummary.collection.insertMany([
    { ...historical, version }, { ...historical, characterId: rogue, classID: 8, version },
  ]);
  await CharacterAchievementFetchQueue.collection.insertOne({ ...historical, signalVersion, snapshotKey: buildCharacterAchievementSnapshotKey(historical), status: "completed" });
  await CharacterRaidParticipation.collection.insertMany([
    { characterId: warlock, reportCount: 72 }, { characterId: rogue, reportCount: 16 }, { characterId: alt, reportCount: 500 },
  ]);
  await service.rebuildAccountGroups();
});

test("dry-run finds copied evidence without changing production-shaped records", async (t) => {
  t.mock.method(service, "fetchCharacterProfile", (async () => ({ id: 145295547, character_class: { id: 4, name: "Rogue" } })) as any);
  const plan = await auditCharacterAccountCollisions();
  assert.equal(plan.analysis.copiedFingerprints, 1);
  assert.equal(plan.analysis.affectedGroups, 1);
  assert.equal(plan.analysis.automaticMatchesToRemove, 2);
  assert.equal(plan.analysis.raidSummariesToRemove, 1);
  assert.deepEqual(plan.repairs.map((row) => String(row.characterId)), [String(warlock)]);
  assert.equal(await CharacterAchievementFingerprint.countDocuments({}), 2);
  assert.equal(await CharacterAccountMatch.countDocuments({}), 3);
  assert.equal((await CharacterAccountGroup.findOne({ characterIds: warlock }))?.characterIds.length, 3);
});

test("repair removes derived evidence, preserves characters and manual links, and is repeatable", async () => {
  const fingerprint = await CharacterAchievementFingerprint.findOne({ characterId: warlock }).lean();
  assert.ok(fingerprint);
  const manualGroup = await CharacterAccountGroup.findOne({ characterIds: manualA }).lean();
  const originalAccount = await CharacterAccountGroup.findOne({ characterIds: rogue }).lean();
  await applyCharacterAccountCollisionRepair([fingerprint]);
  assert.equal(await CharacterAchievementFingerprint.countDocuments({ characterId: warlock }), 0);
  assert.equal(await CharacterAchievementFingerprint.countDocuments({ characterId: rogue }), 1);
  assert.equal(await CharacterAccountMatch.countDocuments({}), 1);
  assert.equal(await CharacterRaidAchievementSummary.countDocuments({ characterId: warlock }), 0);
  assert.equal(await CharacterRaidAchievementSummary.countDocuments({ characterId: rogue }), 1);
  const remainingToken = await CharacterAchievementToken.findOne({ signalVersion, token: tokens[0] }).lean();
  assert.equal(remainingToken?.characterCount, 2);
  assert.deepEqual(remainingToken?.characterIds.map(String).sort(), [String(rogue), String(alt)].sort());
  assert.equal(await CharacterAchievementToken.countDocuments({ signalVersion, token: tokens[1] }), 0);
  assert.equal(await CharacterAchievementToken.countDocuments({ signalVersion: "older-version" }), 1);
  assert.equal((await CharacterAchievementFetchQueue.findOne({ characterId: warlock }))?.status, "skipped");
  assert.equal(await CharacterAccountGroup.countDocuments({ characterIds: warlock }), 0);
  const account = await CharacterAccountGroup.findOne({ characterIds: rogue }).lean();
  assert.equal(String(account?._id), String(originalAccount?._id));
  assert.equal(account?.slug, originalAccount?.slug);
  assert.equal(account?.characterIds.length, 2);
  assert.equal(account?.totalReportCount, 516);
  assert.equal(await Character.countDocuments({}), 5);
  assert.equal(await CharacterRaidParticipation.countDocuments({}), 3);
  assert.equal(String((await CharacterAccountGroup.findOne({ characterIds: manualA }))?._id), String(manualGroup?._id));
  await applyCharacterAccountCollisionRepair([]);
  assert.equal((await CharacterAccountGroup.findOne({ characterIds: rogue }))?.slug, originalAccount?.slug);
  assert.equal(await CharacterAccountGroup.countDocuments({}), 2);
  assert.equal(await CharacterAccountMatch.countDocuments({}), 1);
});

test("a changed snapshot aborts the repair before any writes", async () => {
  const fingerprints = await CharacterAchievementFingerprint.find({}).lean();
  await CharacterAchievementFingerprint.updateOne({ characterId: rogue }, { $set: { fetchedAt: new Date("2026-08-01") } });
  await assert.rejects(applyCharacterAccountCollisionRepair(fingerprints), /Fingerprints changed since the audit/);
  assert.equal(await CharacterAchievementFingerprint.countDocuments({}), 2);
  assert.equal(await CharacterAccountMatch.countDocuments({}), 3);
  assert.equal((await CharacterAchievementToken.findOne({ signalVersion, token: tokens[0] }))?.characterCount, 3);
  assert.equal((await CharacterAchievementFetchQueue.findOne({ characterId: warlock }))?.status, "completed");
});

test("a failure after deleting a fingerprint rolls back the entire batch", async (t) => {
  const fingerprint = await CharacterAchievementFingerprint.findOne({ characterId: warlock }).lean();
  assert.ok(fingerprint);
  t.mock.method(CharacterAchievementToken, "updateMany", (() => { throw new Error("Simulated token update failure"); }) as any);
  await assert.rejects(applyCharacterAccountCollisionRepair([fingerprint]), /Simulated token update failure/);
  assert.equal(await CharacterAchievementFingerprint.countDocuments({ characterId: warlock }), 1);
  assert.equal(await CharacterAccountMatch.countDocuments({}), 3);
  assert.equal((await CharacterAchievementToken.findOne({ signalVersion, token: tokens[0] }))?.characterCount, 3);
});

test("removing members in separate batches preserves the same account ID and URL", async (t) => {
  const extraIds = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
  await Character.collection.insertMany(extraIds.map((_id, i) => ({ ...historical, _id, wclCanonicalCharacterId: 400 + i })));
  await CharacterAchievementFingerprint.collection.insertMany(extraIds.map((characterId) => ({ ...historical, characterId, signalVersion, signalTokens: tokens, fetchedAt })));
  await CharacterAccountMatch.collection.insertMany(extraIds.map((characterAId) => ({ signalVersion, characterAId, characterBId: rogue, confidence: "high", score: 95 })));
  await service.rebuildAccountGroups();
  const originalAccount = await CharacterAccountGroup.findOne({ characterIds: rogue }).lean();
  const fingerprints = await CharacterAchievementFingerprint.find({ characterId: { $in: [warlock, ...extraIds] } }).lean();
  const transaction = mongoose.connection.transaction.bind(mongoose.connection);
  let transactionCount = 0;
  t.mock.method(mongoose.connection, "transaction", ((...args: Parameters<typeof transaction>) => {
    transactionCount += 1;
    return transaction(...args);
  }) as any);
  await applyCharacterAccountCollisionRepair(fingerprints);
  assert.equal(transactionCount, 2);
  const account = await CharacterAccountGroup.findOne({ characterIds: rogue }).lean();
  assert.equal(String(account?._id), String(originalAccount?._id));
  assert.equal(account?.slug, originalAccount?.slug);
  assert.deepEqual(account?.characterIds.map(String).sort(), [String(rogue), String(alt)].sort());
  assert.equal(await CharacterAchievementFingerprint.countDocuments({}), 1);
});

test("an explicit manual association of a repaired character remains authoritative", async () => {
  await CharacterAccountManualEdge.collection.insertOne({ characterAId: warlock, characterBId: alt, createdBy: "test" });
  const originalAccount = await CharacterAccountGroup.findOne({ characterIds: rogue }).lean();
  const fingerprint = await CharacterAchievementFingerprint.findOne({ characterId: warlock }).lean();
  assert.ok(fingerprint);
  await applyCharacterAccountCollisionRepair([fingerprint]);
  const account = await CharacterAccountGroup.findOne({ characterIds: rogue }).lean();
  assert.equal(String(account?._id), String(originalAccount?._id));
  assert.equal(account?.slug, originalAccount?.slug);
  assert.equal(account?.characterIds.length, 3);
  assert.equal(await CharacterAccountMatch.countDocuments({ characterAId: warlock }), 0);
  assert.equal(await CharacterAccountManualEdge.countDocuments({ characterAId: warlock }), 1);
});
