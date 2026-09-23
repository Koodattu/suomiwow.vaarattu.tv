process.env.BLIZZARD_CLIENT_ID = "battlenet-studio-test";
process.env.BLIZZARD_CLIENT_SECRET = "battlenet-studio-test";

import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import User, { IWoWCharacter } from "../src/models/User";
import CcgCard from "../src/models/CcgCard";
import CcgSet from "../src/models/CcgSet";
import battlenet, { BattleNetSyncError } from "../src/services/battlenet-auth.service";
import studio from "../src/services/ccg-supporter.service";
import status from "../src/services/ccg-supporter-status.service";
import identities from "../src/services/ccg-character-identity.service";

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
  ["BATTLENET_RECONNECT_REQUIRED", "battlenet_required"],
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
