import assert from "node:assert/strict";
import test from "node:test";
import Character from "../src/models/Character";
import CharacterLeaderboard from "../src/models/CharacterLeaderboard";
import CharacterMechanicsLeaderboard from "../src/models/CharacterMechanicsLeaderboard";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import Raid from "../src/models/Raid";
import characterService from "../src/services/character.service";

function queryResult(value: unknown) {
  return {
    collation() { return this; },
    select() { return this; },
    sort() { return this; },
    lean: async () => value,
  };
}

test("character profiles preserve missing combined scores and distinguish them from real zeros", async (t) => {
  const character = { name: "Dirlandaa", realm: "sylvanas", region: "EU", classID: 9, wclCanonicalCharacterId: 59226008 };
  const rows = [null, 0, 74.4].map((score, index) => ({
    ...character, zoneId: 53, type: "boss", encounterId: index + 1, encounterName: `Boss ${index + 1}`,
    role: "dps", metric: "dps", specName: "enhancement", score,
    parseScore: score === null ? null : index === 1 ? 0 : 99.7,
    survivalScore: 90, survivalPercentile: 49.1, deathDataAvailable: true, pulls: 7, evaluatedPulls: 7,
  }));
  t.mock.method(characterService as any, "findCanonicalRouteCharacters", async () => [character]);
  t.mock.method(characterService as any, "resolveContinuityContext", async () => ({
    isCombined: false, rootCharacter: null, requestedCharacterId: null, canonicalIds: [character.wclCanonicalCharacterId],
  }));
  t.mock.method(CharacterRaidParticipation, "aggregate", () => ({ collation: async () => [] }));
  t.mock.method(CharacterReportAppearance, "aggregate", () => ({ collation: async () => [] }));
  t.mock.method(CharacterRaidParticipation, "find", () => queryResult([]) as any);
  t.mock.method(CharacterLeaderboard, "find", () => queryResult([]) as any);
  t.mock.method(CharacterMechanicsLeaderboard, "find", () => queryResult(rows) as any);
  t.mock.method(Character, "findOne", () => queryResult(null) as any);
  t.mock.method(Raid, "find", () => queryResult([{ id: 53, name: "The Venomous Abyss" }]) as any);

  const profile = await characterService.getCharacterProfileByRealmName(character.realm, character.name);
  assert.equal(profile?.type, "profile");
  assert.ok(profile && profile.type === "profile");
  const byBoss = new Map(profile.mechanics.map((row) => [row.encounterId, row]));
  assert.equal(byBoss.get(1)?.score, null);
  assert.equal(byBoss.get(1)?.parseScore, null);
  assert.equal(byBoss.get(2)?.score, 0);
  assert.equal(byBoss.get(2)?.parseScore, 0);
  assert.equal(byBoss.get(3)?.score, 74.4);
});
