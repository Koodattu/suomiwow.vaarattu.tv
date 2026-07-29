import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import characterMechanicsService from "../src/services/character-mechanics.service";

type TestableCharacterMechanicsService = {
  buildOverallEntries(entries: Array<Record<string, unknown>>): Array<Record<string, any>>;
};

function bossEntry(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    characterId: new mongoose.Types.ObjectId("64b000000000000000000001"),
    wclCanonicalCharacterId: 47525254,
    name: "Stygia",
    realm: "outland",
    region: "EU",
    classID: 7,
    metric: "dps",
    role: "dps",
    specName: "shadow",
    bestSpecName: "shadow",
    encounterId: 1,
    encounterName: "Boss",
    score: 70,
    parseScore: 70,
    survivalScore: 70,
    pulls: 1,
    deaths: 0,
    survivedPulls: 1,
    earlyDeaths: 0,
    averageDeathPercent: null,
    deathDataAvailable: true,
    rankPercent: 70,
    totalKills: 1,
    ilvl: 200,
    updatedAt: new Date("2026-06-10T00:00:00.000Z"),
    ...overrides,
  };
}

test("overall mechanics metadata follows the role and spec with the most attributed pulls", () => {
  const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
  const holy = bossEntry({
    encounterId: 2,
    role: "healer",
    specName: "holy",
    bestSpecName: "holy",
    pulls: 35,
    score: 72.2,
  });
  const shadow = bossEntry({ encounterId: 1, pulls: 798, score: 72.9 });

  const [overall] = service.buildOverallEntries([holy, shadow]);
  const [reordered] = service.buildOverallEntries([shadow, holy]);

  assert.equal(overall.role, "dps");
  assert.equal(overall.specName, "shadow");
  assert.equal(overall.bestSpecName, "shadow");
  assert.equal(overall.pulls, 833);
  assert.equal(reordered.role, "dps");
  assert.equal(reordered.specName, "shadow");
});
