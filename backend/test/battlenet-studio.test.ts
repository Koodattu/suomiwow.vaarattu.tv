process.env.BLIZZARD_CLIENT_ID = "battlenet-studio-test";
process.env.BLIZZARD_CLIENT_SECRET = "battlenet-studio-test";

import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import mongoose from "mongoose";
import User, { IWoWCharacter } from "../src/models/User";
import CcgCard from "../src/models/CcgCard";
import CcgSet from "../src/models/CcgSet";
import battlenet, { BattleNetSyncError } from "../src/services/battlenet-auth.service";
import studio from "../src/services/ccg-supporter.service";
import status from "../src/services/ccg-supporter-status.service";
import identities from "../src/services/ccg-character-identity.service";
import CcgSupporterLimit from "../src/models/CcgSupporterLimit";
import logger from "../src/utils/logger";

function savedRoster(t: TestContext) {
  const character: IWoWCharacter = { id: 1, realmId: 10, name: "Neutral", realm: "Kazzak", realmSlug: "kazzak", class: "Monk", race: "Pandaren", level: 1, faction: "NEUTRAL", selected: true };
  const user = { battlenet: { id: "account", characters: [character], rosterSyncedAt: new Date(), tokenExpiresAt: new Date(0), connectedAt: new Date() } };
  t.mock.method(User, "findById", () => Object.assign(Promise.resolve(user), { select: () => Promise.resolve(user) }) as any);
  t.mock.method(status, "ensureCreator", async () => ({ battlenetId: "account" }) as any);
  t.mock.method(identities, "resolveTrackedCharacter", async () => null);
  t.mock.method(CcgCard, "aggregate", () => ({ collation: async () => [] }) as any);
  t.mock.method(CcgSet, "find", () => ({ lean: async () => [] }) as any);
  return character;
}

test("Card Studio reads saved neutral and low-level characters without another Blizzard request", async (t) => {
  const character = savedRoster(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected Blizzard request"); });
  const result = await studio.getCharacters("user");
  assert.equal(result.rosterError, null);
  assert.equal(result.characters[0].id, character.id);
  assert.equal(result.characters[0].level, 1);
  assert.equal(result.characters[0].realmId, 10);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const [code, expected] of [
  ["BATTLENET_RECONNECT_REQUIRED", "battlenet_reconnect_required"],
  ["BATTLENET_PROFILE_ACCESS_DENIED", "battlenet_profile_access_denied"],
  ["BATTLENET_PROFILE_UNAVAILABLE", "battlenet_profile_unavailable"],
  ["BATTLENET_UNAVAILABLE", "armory_unavailable"],
]) {
  test(`Card Studio preserves characters and reports ${expected}`, async (t) => {
    const character = savedRoster(t);
    t.mock.method(battlenet, "getCharacters", async () => { throw new BattleNetSyncError(code, 409, "Test failure"); });
    const result = await studio.getCharacters("user");
    assert.equal(result.rosterError, expected);
    assert.equal(result.characters[0].id, character.id);
  });
}

function rosterLimit(t: TestContext) {
  const counts = new Map<string, number>();
  t.mock.method(CcgSupporterLimit, "findOneAndUpdate", async (filter: any, _update: any, options?: any) => {
    const count = counts.get(filter.key) ?? 0;
    if (count >= filter.count.$lt) {
      if (options?.upsert) throw new mongoose.mongo.MongoServerError({ code: 11000, message: "Duplicate limit" });
      return null;
    }
    counts.set(filter.key, count + 1);
    return {} as any;
  });
  const refund = t.mock.method(CcgSupporterLimit, "updateOne", async (filter: any, update: any) => {
    if ((counts.get(filter.key) ?? 0) > 0) counts.set(filter.key, counts.get(filter.key)! + update.$inc.count);
    return {} as any;
  });
  return { counts, refund };
}

test("expired-token refreshes keep the reconnect error on retry and leave saved reads usable", async (t) => {
  const character = savedRoster(t);
  const limit = rosterLimit(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected Blizzard request"); });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await studio.getCharacters("user", true);
    assert.equal(result.rosterError, "battlenet_reconnect_required");
    assert.equal(result.characters[0].id, character.id);
  }
  assert.equal(limit.refund.mock.callCount(), 2);
  assert.equal((await studio.getCharacters("user")).rosterError, null);
  assert.equal(fetch.mock.callCount(), 0);
});

test("failed refresh refunds its original window and successful refresh still enforces the cooldown", async (t) => {
  const character = savedRoster(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-24T10:04:59Z") });
  const limit = rosterLimit(t);
  const refresh = t.mock.method(battlenet, "refreshCharacters", async () => {
    t.mock.timers.tick(2000);
    throw new BattleNetSyncError("BATTLENET_UNAVAILABLE", 502, "Test failure", 503);
  });
  const originalWindow = Math.floor(Date.now() / 300_000);
  assert.equal((await studio.getCharacters("user", true)).rosterError, "armory_unavailable");
  assert.equal(limit.counts.get(`roster:user:${originalWindow}`), 0);
  refresh.mock.mockImplementation(async () => [character]);
  assert.equal((await studio.getCharacters("user", true)).rosterError, null);
  const blocked = await studio.getCharacters("user", true);
  assert.equal(blocked.rosterError, "rate_limited");
  assert.equal(blocked.characters[0].id, character.id);
  assert.equal(refresh.mock.callCount(), 2);
  assert.equal(limit.refund.mock.callCount(), 1);
});

test("roster failures log user, operation, upstream status and cache context without raw errors", async (t) => {
  savedRoster(t);
  const warn = t.mock.method(logger, "warn", () => logger);
  t.mock.method(battlenet, "getCharacters", async () => {
    throw new BattleNetSyncError("BATTLENET_PROFILE_ACCESS_DENIED", 409, "private-response-token", 403);
  });
  await studio.getCharacters("user");
  const calls = warn.mock.calls.map((call) => call.arguments as unknown as [string, Record<string, unknown>]);
  const details = calls.find(([message]) => message === "[CCG/Studio] Battle.net roster operation failed")![1];
  assert.equal(details.userId, "user");
  assert.equal(details.operation, "read");
  assert.equal(details.upstreamStatus, 403);
  assert.equal(details.savedCharacterCount, 1);
  assert.ok(details.rosterSyncedAt);
  assert.ok(!JSON.stringify(warn.mock.calls.map((call) => call.arguments)).includes("private-response-token"));
});
