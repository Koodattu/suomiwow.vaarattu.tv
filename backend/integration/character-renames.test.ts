import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterAccountGroup from "../src/models/CharacterAccountGroup";
import CharacterContinuityLink from "../src/models/CharacterContinuityLink";
import CharacterWclIdentityAudit from "../src/models/CharacterWclIdentityAudit";
import CharacterAchievementFetchQueue from "../src/models/CharacterAchievementFetchQueue";
import CharacterMediaFetchQueue from "../src/models/CharacterMediaFetchQueue";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import { CharacterWclIdentityAuditService } from "../src/services/character-wcl-identity-audit.service";
import continuityService from "../src/services/character-continuity.service";
import characterService from "../src/services/character.service";
import achievementService from "../src/services/character-achievement.service";
import ccgIdentityService from "../src/services/ccg-character-identity.service";
import cacheService from "../src/services/cache.service";
import taskTracker from "../src/services/task-tracker.service";
import wclService from "../src/services/warcraftlogs.service";

// Never load deployment credentials; this database is disposable and local.
const database = `character_renames_test_${process.pid}`;
const now = new Date("2026-10-18T18:00:00Z");
const oldId = new mongoose.Types.ObjectId();
const newId = new mongoose.Types.ObjectId();
const oldProfile = { id: 71682117, canonicalID: 113151706, name: "Alexstrussy", classID: 13, hidden: false,
  server: { slug: "kazzak", region: { slug: "EU" } } };
const newProfile = { ...oldProfile, id: 113151706, name: "Morinicar" };
const models = [Character, CharacterContinuityLink, CharacterWclIdentityAudit,
  CharacterAchievementFetchQueue, CharacterMediaFetchQueue, CharacterReportAppearance, CharacterAccountGroup];
const item = {
  characterId: oldId, expectedWclCanonicalCharacterId: oldProfile.id, expectedClassID: 13,
  sourceName: oldProfile.name, sourceRealm: "kazzak", sourceRegion: "eu",
};

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27141/${database}?directConnection=true`, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000,
  });
  for (const model of models) await model.createCollection();
  await Promise.all([Character.createIndexes(), CharacterContinuityLink.createIndexes(), CharacterWclIdentityAudit.createIndexes()]);
});
after(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  for (const model of models) await model.collection.deleteMany({});
  (continuityService as any).invalidateGraph();
  await Character.collection.insertMany([
    { _id: oldId, name: oldProfile.name, realm: "kazzak", region: "EU", classID: 13,
      wclCanonicalCharacterId: oldProfile.id, lastReportSeenAt: new Date("2026-10-12") },
    { _id: newId, name: newProfile.name, realm: "kazzak", region: "EU", classID: 13,
      wclCanonicalCharacterId: newProfile.id, lastReportSeenAt: new Date("2026-10-18T12:00:00Z"), wclProfileHidden: false },
  ]);
  await CharacterAccountGroup.collection.insertOne({
    signalVersion: "achievement-signal-v1", characterIds: [oldId, newId],
    members: [oldId, newId].map((characterId) => ({ characterId, classID: 13, region: "EU" })),
  });
});

function mockProviders(t: any, destination = newProfile) {
  t.mock.method(wclService, "query", async (_query: string, variables: { characterId: number }) => ({
    characterData: { character: variables.characterId === oldProfile.id ? oldProfile : destination },
  }));
  t.mock.method(cacheService, "invalidatePattern", async () => undefined);
  t.mock.method(achievementService, "rebuildAccountGroups", async () => ({}));
  t.mock.method(ccgIdentityService, "reconcileAll", async () => ({}));
  const service = new CharacterWclIdentityAuditService() as any;
  service.waitForBackgroundCapacity = async () => undefined;
  return service;
}

test("WCL redirect joins Alexstrussy to Morinicar without rewriting historical IDs or names", async (t) => {
  const service = mockProviders(t);
  const result = await service.processItem(item);
  assert.equal(result.status, "completed");
  assert.equal(result.resolvedName, "Morinicar");
  const link = await CharacterContinuityLink.findOne({ sourceCharacterId: oldId }).lean();
  assert.equal(String(link?.targetCharacterId), String(newId));
  assert.equal(link?.createdBy, "wcl-canonical-redirect");
  assert.equal((await Character.findById(oldId))?.name, "Alexstrussy");
  assert.equal((await Character.findById(oldId))?.wclCanonicalCharacterId, oldProfile.id);
  assert.equal((await Character.findById(newId))?.name, "Morinicar");
  assert.deepEqual(new Set((await continuityService.getCluster(newId)).memberCharacterIds), new Set([String(oldId), String(newId)]));
  const profile = await (characterService as any).resolveContinuityContext([oldProfile.id], 13, { name: "Alexstrussy", realm: "kazzak" });
  assert.equal(profile.rootCharacter.name, "Morinicar");
  assert.deepEqual(new Set(profile.canonicalIds), new Set([oldProfile.id, newProfile.id]));
  await service.processItem(item);
  assert.equal(await CharacterContinuityLink.countDocuments({}), 1);
  assert.equal(await Character.countDocuments({}), 2);
});

test("retries finish downstream reconciliation after a link was already saved", async (t) => {
  const service = mockProviders(t);
  let rebuilds = 0;
  t.mock.method(achievementService, "rebuildAccountGroups", async () => {
    if (++rebuilds === 1) throw new Error("interrupted rebuild");
    return {};
  });
  await assert.rejects(service.processItem(item), /interrupted rebuild/);
  assert.equal(await CharacterContinuityLink.countDocuments({}), 1);
  assert.equal((await service.processItem(item)).status, "completed");
  assert.equal(rebuilds, 2);
  assert.equal(await CharacterContinuityLink.countDocuments({}), 1);
});

test("a verified canonical destination can be created before its reports are imported", async (t) => {
  const service = mockProviders(t);
  await Character.deleteOne({ _id: newId });
  assert.equal((await service.processItem(item)).status, "completed");
  const target = await Character.findOne({ wclCanonicalCharacterId: newProfile.id }).lean();
  assert.equal(target?.name, "Morinicar");
  assert.equal(target?.classID, 13);
  assert.equal(target?.lastReportSeenAt?.toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(String((await CharacterContinuityLink.findOne({ sourceCharacterId: oldId }))?.targetCharacterId), String(target?._id));
});

test("redirects refuse mismatched classes, regions, hidden profiles and unconfirmed destinations", async (t) => {
  const service = mockProviders(t);
  for (const destination of [
    { ...newProfile, classID: 5 }, { ...newProfile, hidden: true },
    { ...newProfile, server: { slug: "kazzak", region: { slug: "US" } } },
    { ...newProfile, canonicalID: 999 },
  ]) {
    t.mock.method(wclService, "query", async (_query: string, variables: { characterId: number }) => ({
      characterData: { character: variables.characterId === oldProfile.id ? oldProfile : destination },
    }));
    assert.equal((await service.processItem(item)).status, "skipped");
  }
  assert.equal(await CharacterContinuityLink.countDocuments({}), 0);
  assert.equal((await Character.findById(oldId))?.name, "Alexstrussy");
});

test("report collisions block automatic continuity links", async (t) => {
  const service = mockProviders(t);
  await CharacterReportAppearance.collection.insertMany([
    { wclCanonicalCharacterId: oldProfile.id, classID: 13, reportCode: "shared-report" },
    { wclCanonicalCharacterId: newProfile.id, classID: 13, reportCode: "shared-report" },
  ]);
  const result = await service.processItem(item);
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /reportCollision/);
  assert.equal(await CharacterContinuityLink.countDocuments({}), 0);
});

test("automatic redirects preserve conflicting manual continuity links", async (t) => {
  const service = mockProviders(t);
  const third = await Character.create({ name: "Other", realm: "kazzak", region: "eu", classID: 13, wclCanonicalCharacterId: 999 });
  await CharacterContinuityLink.create({ sourceCharacterId: oldId, targetCharacterId: third._id, createdBy: "admin" });
  const result = await service.processItem(item);
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /sourceAlreadyCombined/);
  assert.equal(String((await CharacterContinuityLink.findOne({ sourceCharacterId: oldId }))?.targetCharacterId), String(third._id));
});

test("nightly discovery includes a recent raider's inactive alias and deduplicates checks for 24 hours", async (t) => {
  t.mock.method(taskTracker, "start", async () => "test");
  t.mock.method(taskTracker, "complete", async () => undefined);
  const service = new CharacterWclIdentityAuditService();
  await CharacterMediaFetchQueue.collection.insertOne({ characterId: oldId, status: "completed" });
  let result = await service.enqueueRecentRaiders(1000, now);
  assert.equal(result.queued, 2);
  assert.equal((await service.enqueueRecentRaiders(1000, now)).candidates, 0);
  await CharacterWclIdentityAudit.updateMany({}, { $set: { status: "completed", attempts: 2, lastActivityAt: now } });
  assert.equal((await service.enqueueRecentRaiders(1000, new Date("2026-10-19T17:00:00Z"))).candidates, 0);
  result = await service.enqueueRecentRaiders(1, new Date("2026-10-19T18:00:00Z"));
  assert.equal(result.requeued, 1);
  assert.equal(result.queued, 0);
  const pending = await CharacterWclIdentityAudit.findOne({ status: "pending" });
  assert.equal(pending?.attempts, 0);
  assert.equal(await CharacterWclIdentityAudit.countDocuments({ status: "completed" }), 1);
});

test("historical Armory failures stay out of nightly discovery and remain available to explicit backfill", async (t) => {
  t.mock.method(taskTracker, "start", async () => "test");
  t.mock.method(taskTracker, "complete", async () => undefined);
  const service = new CharacterWclIdentityAuditService();
  assert.equal((await service.enqueueUnchecked(1000)).candidates, 0);
  await Character.updateMany({}, { $set: { lastReportSeenAt: new Date("2020-01-01") } });
  await CharacterMediaFetchQueue.collection.insertOne({ characterId: oldId, status: "not_found" });
  assert.equal((await service.enqueueRecentRaiders(1000, now)).queued, 0);
  assert.equal((await service.enqueueUnchecked(1000)).queued, 1);
  assert.equal(await CharacterWclIdentityAudit.countDocuments({ characterId: newId }), 0);
});

test("recurring discovery retries stale failures without resetting running work", async (t) => {
  t.mock.method(taskTracker, "start", async () => "test");
  t.mock.method(taskTracker, "complete", async () => undefined);
  const service = new CharacterWclIdentityAuditService();
  await service.enqueueRecentRaiders(1000, now);
  await CharacterWclIdentityAudit.updateOne({ characterId: oldId }, {
    $set: { status: "in_progress", attempts: 1, lastActivityAt: new Date("2026-10-01") },
  });
  await CharacterWclIdentityAudit.updateOne({ characterId: newId }, {
    $set: { status: "failed", attempts: 3, lastActivityAt: new Date("2026-10-01") },
  });
  assert.equal((await service.enqueueRecentRaiders(1000, now)).requeued, 1);
  assert.equal((await CharacterWclIdentityAudit.findOne({ characterId: oldId }))?.status, "in_progress");
  assert.equal((await CharacterWclIdentityAudit.findOne({ characterId: oldId }))?.attempts, 1);
  assert.equal((await CharacterWclIdentityAudit.findOne({ characterId: newId }))?.attempts, 0);
});

test("completed redirects stop being rechecked while their current character remains eligible", async (t) => {
  t.mock.method(taskTracker, "start", async () => "test");
  t.mock.method(taskTracker, "complete", async () => undefined);
  const service = new CharacterWclIdentityAuditService();
  await service.enqueueRecentRaiders(1000, now);
  await CharacterWclIdentityAudit.updateMany({}, { $set: { status: "completed", lastActivityAt: new Date("2026-10-01") } });
  await CharacterWclIdentityAudit.updateOne({ characterId: oldId }, { $set: { identityChanged: true, wclCanonicalCharacterId: newProfile.id } });
  assert.equal((await service.enqueueRecentRaiders(1000, now)).requeued, 1);
  assert.equal((await CharacterWclIdentityAudit.findOne({ characterId: newId }))?.status, "pending");
  assert.equal((await CharacterWclIdentityAudit.findOne({ characterId: oldId }))?.status, "completed");
});

test("account expansion excludes unrelated classes, regions and accounts", async (t) => {
  t.mock.method(taskTracker, "start", async () => "test");
  t.mock.method(taskTracker, "complete", async () => undefined);
  const [differentClass, differentRegion, unrelated] = await Character.create([
    { name: "Otherclass", realm: "kazzak", region: "eu", classID: 5, wclCanonicalCharacterId: 991 },
    { name: "Otherregion", realm: "kazzak", region: "us", classID: 13, wclCanonicalCharacterId: 992 },
    { name: "Unrelated", realm: "kazzak", region: "eu", classID: 13, wclCanonicalCharacterId: 993 },
  ]);
  await CharacterAccountGroup.updateOne({ characterIds: newId }, { $push: {
    characterIds: { $each: [differentClass._id, differentRegion._id] },
    members: { $each: [differentClass, differentRegion].map((character) => ({ characterId: character._id, classID: character.classID, region: character.region })) },
  } });
  const service = new CharacterWclIdentityAuditService();
  assert.equal((await service.enqueueRecentRaiders(1000, now)).queued, 2);
  assert.equal(await CharacterWclIdentityAudit.countDocuments({ characterId: { $in: [differentClass._id, differentRegion._id, unrelated._id] } }), 0);
});

test("without account evidence only the recent raider is queued, without a historical scan", async (t) => {
  t.mock.method(taskTracker, "start", async () => "test");
  t.mock.method(taskTracker, "complete", async () => undefined);
  await CharacterAccountGroup.collection.deleteMany({});
  const service = new CharacterWclIdentityAuditService();
  assert.equal((await service.enqueueRecentRaiders(1000, now)).queued, 1);
  assert.equal(await CharacterWclIdentityAudit.countDocuments({ characterId: oldId }), 0);
});
