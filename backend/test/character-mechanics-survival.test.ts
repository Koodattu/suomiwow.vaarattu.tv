import assert from "node:assert/strict";
import { describe, test } from "node:test";
import mongoose from "mongoose";
import characterMechanicsService from "../src/services/character-mechanics.service";

type DeathRecord = { order: number; deathPercent: number; deathTime: number };

type SurvivalStats = {
  pulls: number;
  evaluatedPulls: number;
  deaths: number;
  survivedPulls: number;
  earlyDeaths: number;
  scoreTotal: number;
  deathPercentTotal: number;
  earlyDeathSeverityTotal: number;
};

type TestableCharacterMechanicsService = {
  addSurvivalStats(
    fights: Array<Record<string, unknown>>,
    appearances: Array<Record<string, unknown>>,
    aliases: Array<Record<string, unknown>>,
    reportRegions: Map<string, string>,
    encounterStats: Map<string, SurvivalStats>,
    pullsBySpec: Map<string, Map<string, number>>,
    unknownPulls: Map<string, number>,
  ): void;
  scorePullDeaths(deaths: DeathRecord[]): number;
  capSurvivalScore(rawScore: number, stats: SurvivalStats): number;
  summarizeSurvivalStats(stats?: SurvivalStats): {
    survivalScore: number | null;
    pulls: number;
    evaluatedPulls: number;
    deaths: number;
    survivedPulls: number;
    earlyDeaths: number;
    averageDeathPercent: number | null;
  };
};

type ScenarioFight = {
  deaths?: Array<{ name: string; server: string; timestamp: number; deathTime: number }>;
  duration?: number;
  isKill?: boolean;
  combatantCount?: number;
};

const service = characterMechanicsService as unknown as TestableCharacterMechanicsService;
const ENCOUNTER_ID = 999;
const SERVER = "Kazzak";
let scenarioId = 0;

function death(player: number, deathTime: number) {
  return { name: `P${player}`, server: SERVER, timestamp: deathTime, deathTime };
}

function deathsAt(startPlayer: number, count: number, startTime: number, interval = 0) {
  return Array.from({ length: count }, (_, index) => death(startPlayer + index, startTime + index * interval));
}

function evaluate(
  fights: ScenarioFight[],
  options: { aliasCount?: number } = {},
) {
  scenarioId += 1;
  const aliasCount = options.aliasCount ?? 20;
  const characterIds = Array.from({ length: aliasCount }, () => new mongoose.Types.ObjectId());
  const encounterStats = new Map<string, SurvivalStats>();
  const reportRegions = new Map<string, string>();

  const mechanicsFights = fights.map((fight, index) => {
    const reportCode = `survival-scenario-${scenarioId}-${index + 1}`;
    reportRegions.set(reportCode, "EU");
    const combatantCount = fight.combatantCount ?? 20;
    return {
      reportCode,
      fightId: index + 1,
      encounterID: ENCOUNTER_ID,
      duration: fight.duration ?? 100_000,
      isKill: fight.isKill ?? true,
      combatants: Array.from({ length: combatantCount }, (_, playerIndex) => ({
        name: `P${playerIndex + 1}`,
        server: SERVER,
        specName: "augmentation",
      })),
      deaths: fight.deaths ?? [],
    };
  });

  service.addSurvivalStats(
    mechanicsFights,
    [],
    characterIds.map((characterId, index) => ({
      characterId,
      wclCanonicalCharacterId: index + 1,
      name: `P${index + 1}`,
      realm: SERVER,
      region: "EU",
      classID: 13,
    })),
    reportRegions,
    encounterStats,
    new Map(),
    new Map(),
  );

  return {
    stats(player: number): SurvivalStats {
      const stats = encounterStats.get(`${characterIds[player - 1]}|${ENCOUNTER_ID}`);
      assert.ok(stats, `expected survival stats for P${player}`);
      return stats;
    },
  };
}

describe("character mechanics survival scoring", () => {
  describe("ordinary deaths", () => {
    test("clean and failed pulls both contribute to the denominator", () => {
      const result = evaluate([
        { deaths: [] },
        { deaths: [death(1, 20_000)] },
      ]);
      const stats = result.stats(1);

      assert.equal(stats.pulls, 2);
      assert.equal(stats.evaluatedPulls, 2);
      assert.equal(stats.survivedPulls, 1);
      assert.equal(stats.deaths, 1);
      assert.equal(stats.earlyDeaths, 1);
      assert.ok(stats.scoreTotal >= 100 && stats.scoreTotal < 200);
    });

    test("the first three unique deaths are early and a repeat does not consume another position", () => {
      const result = evaluate([{
        deaths: [
          death(1, 10_000),
          death(1, 12_000),
          death(2, 20_000),
          death(3, 30_000),
          death(4, 40_000),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 2);
      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(2).earlyDeaths, 1);
      assert.equal(result.stats(3).earlyDeaths, 1);
      assert.equal(result.stats(4).earlyDeaths, 0);
    });

    test("players tied at the third unique death share third place", () => {
      const result = evaluate([{
        deaths: [
          death(1, 10_000),
          death(2, 20_000),
          death(3, 30_000),
          death(4, 30_000),
        ],
      }]);

      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(2).earlyDeaths, 1);
      assert.equal(result.stats(3).earlyDeaths, 1);
      assert.equal(result.stats(4).earlyDeaths, 1);
      assert.equal(result.stats(3).scoreTotal, result.stats(4).scoreTotal);
    });

    test("death-event input order cannot change results for timestamp ties", () => {
      const orderedDeaths = [
        death(1, 10_000),
        death(2, 20_000),
        death(3, 30_000),
        death(4, 30_000),
      ];
      const ordered = evaluate([{ deaths: orderedDeaths }]);
      const reversed = evaluate([{ deaths: [...orderedDeaths].reverse() }]);

      for (let player = 1; player <= 4; player += 1) {
        assert.deepEqual(reversed.stats(player), ordered.stats(player));
      }
    });

    test("deaths from unmapped raid members still affect a tracked player's raid order", () => {
      const result = evaluate([{
        deaths: [
          death(21, 10_000),
          death(22, 20_000),
          death(23, 30_000),
          death(1, 40_000),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(1).earlyDeaths, 0);
    });

    test("early-death classification is independent of elapsed fight percentage and short pulls", () => {
      const lateFirst = evaluate([{ deaths: [death(1, 95_000)] }]).stats(1);
      const shortFirst = evaluate([{ duration: 20_000, deaths: [death(1, 19_000)] }]).stats(1);

      assert.equal(lateFirst.earlyDeaths, 1);
      assert.equal(shortFirst.evaluatedPulls, 1);
      assert.equal(shortFirst.earlyDeaths, 1);
    });

    test("timing, raid order, and repeat deaths independently affect the pull score", () => {
      const earlyFirst = service.scorePullDeaths([{ order: 1, deathPercent: 0.2, deathTime: 20_000 }]);
      const lateFirst = service.scorePullDeaths([{ order: 1, deathPercent: 0.8, deathTime: 80_000 }]);
      const lateFourth = service.scorePullDeaths([{ order: 4, deathPercent: 0.8, deathTime: 80_000 }]);
      const repeated = service.scorePullDeaths([
        { order: 4, deathPercent: 0.8, deathTime: 80_000 },
        { order: 4, deathPercent: 0.9, deathTime: 90_000 },
      ]);

      assert.ok(earlyFirst < lateFirst);
      assert.ok(lateFirst < lateFourth);
      assert.ok(repeated < lateFourth);
    });

    test("all repeat deaths contribute to the displayed average death timing", () => {
      const stats = evaluate([{
        deaths: [death(1, 25_000), death(1, 75_000)],
      }]).stats(1);
      const summary = service.summarizeSurvivalStats(stats);

      assert.equal(stats.deaths, 2);
      assert.equal(summary.averageDeathPercent, 50);
    });

    test("death timing is measured against the actual pull duration", () => {
      const stats = evaluate([{ duration: 120_000, deaths: [death(1, 60_000)] }]).stats(1);

      assert.equal(stats.deathPercentTotal, 0.5);
      assert.equal(service.summarizeSurvivalStats(stats).averageDeathPercent, 50);
    });

    test("a fourth death at ninety percent scores better than one at forty percent", () => {
      const earlyFourth = evaluate([{
        deaths: [death(1, 10_000), death(2, 20_000), death(3, 30_000), death(4, 40_000)],
      }]);
      const lateFourth = evaluate([{
        deaths: [death(1, 10_000), death(2, 20_000), death(3, 30_000), death(4, 90_000)],
      }]);

      assert.ok(lateFourth.stats(4).scoreTotal > earlyFourth.stats(4).scoreTotal);
      assert.equal(earlyFourth.stats(4).earlyDeaths, 0);
      assert.equal(lateFourth.stats(4).earlyDeaths, 0);
    });

    test("invalid and exact duplicate death records do not create penalties", () => {
      const result = evaluate([{
        duration: 100_000,
        deaths: [
          death(1, Number.NaN),
          death(1, -1),
          death(1, 100_001),
          death(2, 20_000),
          death(2, 20_000),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 0);
      assert.equal(result.stats(1).survivedPulls, 1);
      assert.equal(result.stats(2).deaths, 1);
    });
  });

  describe("raid-wide death bursts", () => {
    test("a Lura-shaped half-raid burst is ignored even when the pull continues", () => {
      const result = evaluate([{
        duration: 32_000,
        deaths: [
          ...deathsAt(1, 10, 9_150, 10),
          death(11, 20_000),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 0);
      assert.equal(result.stats(1).survivedPulls, 1);
      assert.equal(result.stats(10).deaths, 0);
      assert.equal(result.stats(11).deaths, 0);
      assert.equal(result.stats(11).survivedPulls, 1);
    });

    test("exactly half the observed roster within one second reaches the threshold", () => {
      const result = evaluate([{
        deaths: deathsAt(1, 10, 10_000, 100),
      }]);

      assert.equal(result.stats(1).deaths, 0);
      assert.equal(result.stats(10).deaths, 0);
    });

    test("a sub-threshold simultaneous group remains individually scored", () => {
      const result = evaluate([{
        deaths: deathsAt(1, 9, 10_000),
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(9).deaths, 1);
      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(9).earlyDeaths, 1);
    });

    test("the one-second burst boundary is inclusive but a wider group is not a burst", () => {
      const inclusive = evaluate([{
        deaths: [death(1, 10_000), ...deathsAt(2, 9, 11_000)],
      }]);
      const outside = evaluate([{
        deaths: [death(1, 10_000), ...deathsAt(2, 9, 11_001)],
      }]);

      assert.equal(inclusive.stats(1).deaths, 0);
      assert.equal(outside.stats(1).deaths, 1);
      assert.equal(outside.stats(2).deaths, 1);
    });

    test("the first raid-wide burst ends individual death observation for the pull", () => {
      const result = evaluate([{
        deaths: [
          ...deathsAt(1, 10, 20_000, 25),
          ...deathsAt(11, 10, 50_000, 25),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 0);
      assert.equal(result.stats(20).deaths, 0);
      assert.equal(result.stats(1).survivedPulls, 1);
      assert.equal(result.stats(20).survivedPulls, 1);
    });

    test("a real earlier death is retained when that resurrected player also dies in a later burst", () => {
      const result = evaluate([{
        deaths: [
          death(1, 10_000),
          death(1, 50_000),
          ...deathsAt(2, 9, 50_000, 25),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(2).deaths, 0);
    });

    test("duplicate events from one player cannot satisfy a raid-wide threshold", () => {
      const result = evaluate([{
        deaths: Array.from({ length: 10 }, () => death(1, 10_000)),
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(1).earlyDeaths, 1);
    });
  });

  describe("pull outcomes and the observation endpoint", () => {
    test("a gradual collapse is scored the same way on a wipe and a kill", () => {
      const wipe = evaluate([{
        duration: 100_000,
        isKill: false,
        deaths: deathsAt(1, 10, 85_000, 500),
      }]);
      const kill = evaluate([{
        duration: 100_000,
        isKill: true,
        deaths: deathsAt(1, 10, 85_000, 500),
      }]);

      assert.equal(wipe.stats(1).deaths, 1);
      assert.equal(wipe.stats(10).deaths, 1);
      assert.deepEqual(wipe.stats(1), kill.stats(1));
      assert.deepEqual(wipe.stats(10), kill.stats(10));
    });

    test("a gradual group far from the pull end remains scored", () => {
      const result = evaluate([{
        duration: 100_000,
        isKill: false,
        deaths: deathsAt(1, 10, 20_000, 500),
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(10).deaths, 1);
    });

    test("an isolated precursor is retained when the rest die in a raid-wide burst", () => {
      const result = evaluate([{
        duration: 36_000,
        isKill: false,
        deaths: [
          death(1, 30_000),
          ...deathsAt(2, 19, 35_000, 25),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(2).deaths, 0);
      assert.equal(result.stats(2).survivedPulls, 1);
    });

    test("resurrected players can trigger the observation endpoint without a second penalty", () => {
      const result = evaluate([{
        duration: 100_000,
        isKill: false,
        combatantCount: 20,
        deaths: [
          death(1, 10_000),
          death(2, 20_000),
          death(3, 30_000),
          death(4, 40_000),
          death(5, 50_000),
          death(6, 60_000),
          death(7, 70_000),
          death(8, 80_000),
          death(9, 85_000),
          death(10, 90_000),
          ...deathsAt(1, 10, 95_000, 100),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(10).deaths, 1);
      assert.equal(result.stats(10).earlyDeaths, 0);
    });
  });

  describe("likely resets", () => {
    test("a non-kill with no deaths is neutral regardless of duration", () => {
      const short = evaluate([{ duration: 10_000, isKill: false }]).stats(1);
      const long = evaluate([{ duration: 90_000, isKill: false }]).stats(1);

      for (const stats of [short, long]) {
        assert.equal(stats.pulls, 1);
        assert.equal(stats.evaluatedPulls, 0);
        assert.equal(stats.scoreTotal, 0);
      }
    });

    test("a short non-kill with at most two deaths is neutral", () => {
      const result = evaluate([{
        duration: 20_000,
        isKill: false,
        deaths: [death(1, 5_000), death(2, 10_000)],
      }]);

      assert.equal(result.stats(1).evaluatedPulls, 0);
      assert.equal(result.stats(1).deaths, 0);
      assert.equal(result.stats(2).earlyDeaths, 0);
    });

    test("two early failures followed by an instant raid wipe remain a valid pull", () => {
      const result = evaluate([{
        duration: 10_000,
        isKill: false,
        deaths: [
          death(1, 1_000),
          death(2, 2_000),
          ...deathsAt(3, 18, 9_000, 25),
        ],
      }]);

      assert.equal(result.stats(1).evaluatedPulls, 1);
      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(2).deaths, 1);
      assert.equal(result.stats(2).earlyDeaths, 1);
      assert.equal(result.stats(3).deaths, 0);
      assert.equal(result.stats(3).survivedPulls, 1);
    });

    test("three deaths make a short non-kill a scored pull", () => {
      const result = evaluate([{
        duration: 20_000,
        isKill: false,
        deaths: [death(1, 5_000), death(2, 10_000), death(3, 15_000)],
      }]);

      assert.equal(result.stats(1).evaluatedPulls, 1);
      assert.equal(result.stats(1).earlyDeaths, 1);
      assert.equal(result.stats(2).earlyDeaths, 1);
      assert.equal(result.stats(3).earlyDeaths, 1);
    });

    test("a kill is evaluated even when nobody dies", () => {
      const stats = evaluate([{ duration: 10_000, isKill: true }]).stats(1);

      assert.equal(stats.evaluatedPulls, 1);
      assert.equal(stats.survivedPulls, 1);
      assert.equal(stats.scoreTotal, 100);
    });
  });

  describe("data coverage and aggregate caps", () => {
    test("an incomplete small roster cannot turn ordinary deaths into a raid-wide burst", () => {
      const result = evaluate([{
        combatantCount: 6,
        deaths: deathsAt(1, 3, 10_000),
      }], { aliasCount: 6 });

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(2).deaths, 1);
      assert.equal(result.stats(3).deaths, 1);
    });

    test("death identities supplement an incomplete legacy combatant roster for burst thresholds", () => {
      const result = evaluate([{
        combatantCount: 6,
        deaths: [
          ...deathsAt(1, 3, 10_000),
          ...deathsAt(4, 17, 20_000, 2_000),
        ],
      }]);

      assert.equal(result.stats(1).deaths, 1);
      assert.equal(result.stats(2).deaths, 1);
      assert.equal(result.stats(3).deaths, 1);
    });

    test("only early-death frequency caps the timing-sensitive aggregate score", () => {
      const base: SurvivalStats = {
        pulls: 10,
        evaluatedPulls: 10,
        deaths: 0,
        survivedPulls: 10,
        earlyDeaths: 0,
        scoreTotal: 1_000,
        deathPercentTotal: 0,
        earlyDeathSeverityTotal: 0,
      };

      assert.equal(service.capSurvivalScore(92, { ...base, deaths: 20, survivedPulls: 0 }), 92);
      assert.equal(service.capSurvivalScore(100, { ...base, deaths: 5, survivedPulls: 5, earlyDeathSeverityTotal: 5 }), 55);
      assert.equal(service.capSurvivalScore(100, base), 100);
    });

    test("large repeat-death penalties cannot push a pull score outside zero to one hundred", () => {
      const deaths = Array.from({ length: 20 }, (_, index) => ({
        order: 1,
        deathPercent: index / 20,
        deathTime: index * 5_000,
      }));

      assert.equal(service.scorePullDeaths([]), 100);
      assert.equal(service.scorePullDeaths(deaths), 0);
    });
  });
});
