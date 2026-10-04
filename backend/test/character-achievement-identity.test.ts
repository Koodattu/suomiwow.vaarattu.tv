import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CharacterAchievementFingerprint from "../src/models/CharacterAchievementFingerprint";
import CharacterRaidAchievementSummary from "../src/models/CharacterRaidAchievementSummary";
import { CharacterAchievementService } from "../src/services/character-achievement.service";
import { getWclClassIdFromBlizzardClassId } from "../src/utils/blizzard-character-class";
import { hasCopiedAchievementFingerprint } from "../src/scripts/repair-character-account-collisions";

const rogueProfile = { id: 145295547, name: "Jappe", character_class: { id: 4, name: "Rogue" }, realm: { slug: "stormreaver" } };
const queueItem = () => ({ _id: new mongoose.Types.ObjectId(), characterId: new mongoose.Types.ObjectId(), wclCanonicalCharacterId: 72802025, classID: 8, name: "Jappe", realm: "stormreaver", region: "eu" });

test("maps Blizzard classes to WCL classes without comparing their numeric IDs directly", () => {
  const expected = [11, 6, 3, 8, 7, 1, 9, 4, 10, 5, 2, 12, 13];
  expected.forEach((wclClass, index) => assert.equal(getWclClassIdFromBlizzardClassId(index + 1), wclClass));
  for (const value of [undefined, null, "4", 0, 99, 4.5]) assert.equal(getWclClassIdFromBlizzardClassId(value), null);
});

test("historical Jappe warlock cannot consume the current rogue's achievements", async (t) => {
  const service = new CharacterAchievementService() as any;
  service.fetchCharacterProfile = async () => rogueProfile;
  service.fetchAchievementSummary = async () => assert.fail("Must reject the class before fetching achievements");
  t.mock.method(CharacterAchievementFingerprint, "findOneAndUpdate", () => assert.fail("Must not write a fingerprint"));
  t.mock.method(CharacterRaidAchievementSummary, "findOneAndUpdate", () => assert.fail("Must not write raid achievements"));
  await assert.rejects(service.processItem({ ...queueItem(), classID: 10 }), {
    errorCode: "character_class_mismatch", permanent: true, retryable: false,
  });
});

test("the matching rogue still stores achievements and updates account matching", async (t) => {
  const service = new CharacterAchievementService() as any;
  const item = queueItem();
  service.fetchCharacterProfile = async () => rogueProfile;
  service.fetchAchievementSummary = async () => ({ character: { id: rogueProfile.id }, achievements: [{ id: 15, completed_timestamp: 1325932200000 }] });
  service.getFeaturedAchievementTargets = async () => [];
  t.mock.method(CharacterAchievementFingerprint, "findOne", (() => ({ lean: async () => null })) as any);
  const fingerprintWrite = t.mock.method(CharacterAchievementFingerprint, "findOneAndUpdate", (async () => null) as any);
  const summaryWrite = t.mock.method(CharacterRaidAchievementSummary, "findOneAndUpdate", (async () => null) as any);
  const tokens: unknown[] = [];
  service.updateTokenIndex = async (...args: unknown[]) => { tokens.push(args); };
  service.updateMatchesForCharacter = async (...args: unknown[]) => { tokens.push(args); };
  const outcome = await service.processItem(item);
  assert.equal(outcome.status, "completed");
  assert.equal(fingerprintWrite.mock.callCount(), 1);
  assert.equal((fingerprintWrite.mock.calls[0].arguments as any)[1].$set.classID, 8);
  assert.equal(summaryWrite.mock.callCount(), 1);
  assert.equal(tokens.length, 2);
});

test("missing or changed achievement character IDs fail before any stored evidence is touched", async (t) => {
  t.mock.method(CharacterAchievementFingerprint, "findOne", () => assert.fail("Must validate before reading or replacing evidence"));
  for (const character of [undefined, {}, { id: 123 }, { id: String(rogueProfile.id) }]) {
    const service = new CharacterAchievementService() as any;
    service.fetchCharacterProfile = async () => rogueProfile;
    service.fetchAchievementSummary = async () => ({ character, achievements: [] });
    await assert.rejects(service.processItem(queueItem()), { errorCode: "achievement_character_mismatch", retryable: true, permanent: false });
  }
});

test("unknown profile classes and missing profile IDs are retried without importing achievements", async () => {
  for (const profile of [{ ...rogueProfile, character_class: { id: 99 } }, { ...rogueProfile, id: undefined }]) {
    const service = new CharacterAchievementService() as any;
    service.fetchCharacterProfile = async () => profile;
    service.fetchAchievementSummary = async () => assert.fail("Must reject incomplete identity");
    await assert.rejects(service.processItem(queueItem()), { errorCode: "invalid_character_profile", retryable: true });
  }
});

test("profile request failures propagate without writing account evidence", async () => {
  const service = new CharacterAchievementService() as any;
  service.fetchCharacterProfile = async () => { throw new Error("Blizzard unavailable"); };
  service.fetchAchievementSummary = async () => assert.fail("Must stop after profile failure");
  await assert.rejects(service.processItem(queueItem()), /Blizzard unavailable/);
});

test("repair requires substantial identical evidence from the current class at the same route", () => {
  const old = { ...queueItem(), classID: 10, fetchedAt: new Date(), signalTokens: Array.from({ length: 60 }, (_, i) => `${i}:123456789`) };
  const current = { ...old, classID: 8, name: "jappe", realm: "Stormreaver", region: "EU", signalTokens: [...old.signalTokens].reverse() };
  assert.equal(hasCopiedAchievementFingerprint(old as any, [current] as any, 8), true);
  assert.equal(hasCopiedAchievementFingerprint(current as any, [current] as any, 8), false);
  assert.equal(hasCopiedAchievementFingerprint(old as any, [{ ...current, realm: "kazzak" }] as any, 8), false);
  assert.equal(hasCopiedAchievementFingerprint(old as any, [{ ...current, region: "us" }] as any, 8), false);
  assert.equal(hasCopiedAchievementFingerprint(old as any, [{ ...current, signalTokens: current.signalTokens.slice(1) }] as any, 8), false);
  assert.equal(hasCopiedAchievementFingerprint(old as any, [] as any, 8), false);
  assert.equal(hasCopiedAchievementFingerprint({ ...old, signalTokens: [] } as any, [{ ...current, signalTokens: [] }] as any, 8), false);
});
