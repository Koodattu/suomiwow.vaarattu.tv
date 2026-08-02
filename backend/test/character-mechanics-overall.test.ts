import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import characterMechanicsService from "../src/services/character-mechanics.service";
import { resolveCharacterRaidIdentity } from "../src/utils/character-raid-identity";

type TestableCharacterMechanicsService = {
  buildOverallEntries(entries: Array<Record<string, unknown>>): Array<Record<string, any>>;
  normalizeBossSurvivalScores(entries: Array<Record<string, any>>): void;
  addSurvivalStats(
    fights: Array<Record<string, unknown>>,
    appearances: Array<Record<string, unknown>>,
    aliases: Array<Record<string, unknown>>,
    reportRegions: Map<string, string>,
    encounterStats: Map<string, any>,
    pullsBySpec: Map<string, Map<string, number>>,
    unknownPulls: Map<string, number>,
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
    survivalPercentile: 50,
    pulls: 1,
    evaluatedPulls: 1,
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

test("combined score uses role-and-boss survival percentiles after sample shrinkage", () => {
  const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
  const entries = [
    bossEntry({ characterId: new mongoose.Types.ObjectId(), survivalScore: 40, survivalPercentile: null, evaluatedPulls: 40 }),
    bossEntry({ characterId: new mongoose.Types.ObjectId(), survivalScore: 60, survivalPercentile: null, evaluatedPulls: 80 }),
    bossEntry({ characterId: new mongoose.Types.ObjectId(), survivalScore: 80, survivalPercentile: null, evaluatedPulls: 400 }),
  ] as Array<Record<string, any>>;

  service.normalizeBossSurvivalScores(entries);

  assert.deepEqual(entries.map((entry) => entry.survivalPercentile), [0, 50, 100]);
  assert.deepEqual(entries.map((entry) => entry.score), [35, 60, 85]);
});

test("overall survival equal-weights bosses instead of progression pull counts", () => {
  const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
  const overall = service.buildOverallEntries([
    bossEntry({ encounterId: 1, pulls: 800, evaluatedPulls: 600, survivalScore: 40, survivalPercentile: 0 }),
    bossEntry({ encounterId: 2, pulls: 40, evaluatedPulls: 30, survivalScore: 80, survivalPercentile: 100 }),
  ]);

  assert.equal(overall[0].survivalScore, 60);
  assert.equal(overall[0].survivalPercentile, 50);
  assert.equal(overall[0].score, 60);
});

test("dominant raid spec is selected strictly by exact Mythic pull count", () => {
  const identity = resolveCharacterRaidIdentity({
    classID: 13,
    specPulls: new Map([
      ["preservation", 150],
      ["augmentation", 199],
      ["devastation", 4],
    ]),
    parseEvidence: [],
  });

  assert.equal(identity?.specName, "augmentation");
  assert.equal(identity?.method, "fight_roster");
  assert.equal(identity?.confidence, "exact");
});

test("missing pull specs use raid-only killed bosses and role-compatible parse quality", () => {
  const identity = resolveCharacterRaidIdentity({
    classID: 13,
    unknownSpecPulls: 50,
    parseEvidence: [
      ...[1, 2, 3, 4].map((encounterId) => ({ specName: "augmentation", metric: "dps" as const, encounterId, rankPercent: 90, totalKills: 5 })),
      ...[1, 2, 3, 4].map((encounterId) => ({ specName: "devastation", metric: "dps" as const, encounterId, rankPercent: 35, totalKills: 1 })),
      ...[1, 2, 3].map((encounterId) => ({ specName: "preservation", metric: "hps" as const, encounterId, rankPercent: 15, totalKills: 4 })),
      { specName: "preservation", metric: "dps", encounterId: 4, rankPercent: 99, totalKills: 10 },
    ],
  });

  assert.equal(identity?.specName, "augmentation");
  assert.equal(identity?.method, "parse_quality");
  assert.equal(identity?.role, "dps");
});

test("wipe-only reports count exact CombatantInfo specs through canonical character aliases", () => {
  const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
  const characterId = new mongoose.Types.ObjectId("64b000000000000000000002");
  const encounterStats = new Map<string, any>();
  const pullsBySpec = new Map<string, Map<string, number>>();
  const unknownPulls = new Map<string, number>();

  service.addSurvivalStats(
    [{
      reportCode: "wipe-only",
      fightId: 1,
      encounterID: 999,
      duration: 120_000,
      isKill: false,
      deaths: [],
      combatants: [{ name: "Violetcar", server: "Kazzak", specID: 1473, specName: "augmentation" }],
    }],
    [],
    [{ characterId, wclCanonicalCharacterId: 1, name: "Violetcar", realm: "kazzak", region: "EU", classID: 13 }],
    new Map([["wipe-only", "EU"]]),
    encounterStats,
    pullsBySpec,
    unknownPulls,
    new Map([[999, 120_000]]),
  );

  assert.equal(pullsBySpec.get(String(characterId))?.get("augmentation"), 1);
  assert.equal([...encounterStats.values()][0]?.pulls, 1);
  assert.equal([...encounterStats.values()][0]?.evaluatedPulls, 1);
});

test("terminal wipe deaths are neutral while a pre-collapse death remains penalized", () => {
  const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
  const earlyCharacterId = new mongoose.Types.ObjectId();
  const cascadeCharacterId = new mongoose.Types.ObjectId();
  const encounterStats = new Map<string, any>();
  const combatants = Array.from({ length: 10 }, (_, index) => ({
    name: `P${index + 1}`,
    server: "Kazzak",
    specName: "augmentation",
  }));

  service.addSurvivalStats(
    [{
      reportCode: "cascade",
      fightId: 1,
      encounterID: 999,
      duration: 120_000,
      isKill: false,
      combatants,
      deaths: [
        { name: "P1", server: "Kazzak", timestamp: 40_000, deathTime: 40_000 },
        ...Array.from({ length: 5 }, (_, index) => ({
          name: `P${index + 2}`,
          server: "Kazzak",
          timestamp: 110_000 + index * 1_000,
          deathTime: 110_000 + index * 1_000,
        })),
      ],
    }],
    [],
    [
      { characterId: earlyCharacterId, wclCanonicalCharacterId: 1, name: "P1", realm: "Kazzak", region: "EU", classID: 13 },
      { characterId: cascadeCharacterId, wclCanonicalCharacterId: 2, name: "P2", realm: "Kazzak", region: "EU", classID: 13 },
    ],
    new Map([["cascade", "EU"]]),
    encounterStats,
    new Map(),
    new Map(),
    new Map([[999, 120_000]]),
  );

  assert.equal(encounterStats.get(`${earlyCharacterId}|999`)?.evaluatedPulls, 1);
  assert.equal(encounterStats.get(`${earlyCharacterId}|999`)?.deaths, 1);
  assert.equal(encounterStats.get(`${cascadeCharacterId}|999`)?.pulls, 1);
  assert.equal(encounterStats.get(`${cascadeCharacterId}|999`)?.evaluatedPulls, 0);
});
