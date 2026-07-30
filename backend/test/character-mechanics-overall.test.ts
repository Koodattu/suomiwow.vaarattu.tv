import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import characterMechanicsService from "../src/services/character-mechanics.service";

type TestableCharacterMechanicsService = {
  buildOverallEntries(entries: Array<Record<string, unknown>>): Array<Record<string, any>>;
  getDominantSpecByCharacter(pulls: Map<string, Map<string, number>>): Map<string, string>;
  addSurvivalStats(
    fights: Array<Record<string, unknown>>,
    appearances: Array<Record<string, unknown>>,
    aliases: Array<Record<string, unknown>>,
    reportRegions: Map<string, string>,
    encounterStats: Map<string, any>,
    overallStats: Map<string, any>,
    pullsBySpec: Map<string, Map<string, number>>,
    expectedDurations: Map<number, number>,
  ): void;
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

test("overall mechanics rows never combine pulls from different specs", () => {
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

  const overall = service.buildOverallEntries([holy, shadow]);
  const reordered = service.buildOverallEntries([shadow, holy]);
  const shadowOverall = overall.find((entry) => entry.specName === "shadow");
  const holyOverall = overall.find((entry) => entry.specName === "holy");

  assert.equal(overall.length, 2);
  assert.equal(shadowOverall?.role, "dps");
  assert.equal(shadowOverall?.pulls, 798);
  assert.equal(holyOverall?.role, "healer");
  assert.equal(holyOverall?.pulls, 35);
  assert.deepEqual(reordered.map((entry) => entry.specName).sort(), ["holy", "shadow"]);
});

test("dominant raid spec is selected strictly by Mythic pull count", () => {
  const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
  const dominant = service.getDominantSpecByCharacter(new Map([
    ["violetcar", new Map([
      ["preservation", 150],
      ["augmentation", 199],
      ["devastation", 4],
    ])],
  ]));

  assert.equal(dominant.get("violetcar"), "augmentation");
});

test("wipe-only reports count exact CombatantInfo specs through canonical character aliases", () => {
  const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
  const characterId = new mongoose.Types.ObjectId("64b000000000000000000002");
  const encounterStats = new Map<string, any>();
  const overallStats = new Map<string, any>();
  const pullsBySpec = new Map<string, Map<string, number>>();

  service.addSurvivalStats(
    [{
      reportCode: "wipe-only",
      fightId: 1,
      encounterID: 999,
      duration: 120_000,
      deaths: [],
      combatants: [{ name: "Violetcar", server: "Kazzak", specID: 1473, specName: "augmentation" }],
    }],
    [],
    [{ characterId, wclCanonicalCharacterId: 1, name: "Violetcar", realm: "kazzak", region: "EU", classID: 13 }],
    new Map([["wipe-only", "EU"]]),
    encounterStats,
    overallStats,
    pullsBySpec,
    new Map([[999, 120_000]]),
  );

  assert.equal(pullsBySpec.get(String(characterId))?.get("augmentation"), 1);
  assert.equal([...encounterStats.values()][0]?.pulls, 1);
  assert.equal([...overallStats.values()][0]?.pulls, 1);
});
