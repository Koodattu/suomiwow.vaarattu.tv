import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacterPerformance, getPerformanceMetrics, selectBossPerformance } from "../src/lib/character-performance.ts";

function boss(encounterId, role, pulls, overrides = {}) {
  return { encounterId, encounterName: `Boss ${encounterId}`, role, metric: role === "healer" ? "hps" : "dps",
    specName: role === "healer" ? "restoration" : "enhancement", pulls, evaluatedPulls: pulls,
    deaths: 0, survivedPulls: pulls, earlyDeaths: 0, averageDeathPercent: null, deathDataAvailable: true,
    rankPercent: 80, parseScore: 80, survivalScore: 90, survivalPercentile: 60, score: 70, allStarsPoints: 100,
    ...overrides };
}

const rows = [boss(3470, "dps", 6), boss(3429, "dps", 2),
  boss(3429, "healer", 172, { rankPercent: null, parseScore: null, allStarsPoints: null, score: null, earlyDeaths: 20 }),
  boss(3379, "healer", 25, { rankPercent: 60, parseScore: 60, survivalPercentile: 100, score: 80, allStarsPoints: 80 }),
  boss(3379, "dps", 3, { rankPercent: 99, score: 99 })];
const parent = { ...boss(null, "healer", 197), zoneId: 53, raidName: "The Venomous Abyss",
  scoreVersion: 6, raidFightCoverage: 1, updatedAt: "2026-11-03T00:00:00Z", profileBossScores: rows };
const profile = { rankings: [{ ...parent, score: 999, partition: 1 }], mechanics: [parent] };

test("All selects the most-played boss role consistently across all three views", () => {
  const result = buildCharacterPerformance(profile, "all");
  assert.deepEqual([...result.selectedBosses.values()].map(row => [row.encounterId, row.role]), [
    [3379, "healer"], [3429, "healer"], [3470, "dps"],
  ]);
  const ranks = result.rankings.filter(row => row.encounterId !== null);
  const mechanics = result.mechanics.filter(row => row.encounterId !== null);
  assert.deepEqual(ranks.map(row => [row.encounterId, row.role, row.metric]), mechanics.map(row => [row.encounterId, row.role, row.metric]));
  assert.equal(ranks.find(row => row.encounterId === 3429).rankPercent, null, "do not fall back to the less-played DPS parse");
  assert.equal(mechanics.find(row => row.encounterId === 3429).score, null);
  const overall = result.mechanics.find(row => row.encounterId === null);
  assert.equal(overall.metric, "mixed");
  assert.equal(overall.pulls, 203);
  assert.equal(overall.earlyDeaths, 20);
  assert.equal(overall.survivalPercentile, 73.3);
  assert.equal(overall.score, 75, "average only complete selected boss scores");
  assert.equal(result.rankings.find(row => row.encounterId === null).score, 180, "sum selected All Star points, never reuse the old raid total");
  assert.equal(parent.score, 70, "selection must not mutate the API input");
});

test("DPS and HPS select alternatives and the available metrics include off-role mechanics", () => {
  const dps = buildCharacterPerformance(profile, "dps");
  const hps = buildCharacterPerformance(profile, "hps");
  assert.ok(dps.mechanics.every(row => row.metric === "dps"));
  assert.equal(dps.mechanics.find(row => row.encounterId === null).pulls, 11);
  assert.ok(hps.mechanics.every(row => row.metric === "hps"));
  assert.equal(hps.selectedBosses.has("53:3470"), false);
  assert.deepEqual([...getPerformanceMetrics(profile)].sort(), ["dps", "hps"]);
  assert.deepEqual([...getPerformanceMetrics({ rankings: [], mechanics: [{ ...parent, profileBossScores: [rows[0]] }] })], ["dps"]);
});

test("equal pull counts use a stable role tie-break rather than the best score", () => {
  const tied = [boss(1, "tank", 10, { score: 99 }), boss(1, "healer", 10), boss(1, "dps", 10, { score: 0 })];
  assert.equal(selectBossPerformance(tied, "all")[0].role, "dps");
  assert.deepEqual(selectBossPerformance(tied, "all"), selectBossPerformance([...tied].reverse(), "all"));
  assert.equal(selectBossPerformance([boss(1, "tank", 20), ...tied], "dps")[0].role, "tank");
});

test("parse-only bosses preserve zero parses and missing mechanics", () => {
  const parsed = boss(1, "dps", 0, { rankPercent: 0, parseScore: 0, allStarsPoints: 0, score: null,
    survivalScore: null, survivalPercentile: null, deathDataAvailable: false });
  const result = buildCharacterPerformance({ rankings: [], mechanics: [{ ...parent, profileBossScores: [parsed] }] }, "all");
  assert.equal(result.rankings.find(row => row.encounterId === 1).rankPercent, 0);
  assert.equal(result.rankings.find(row => row.encounterId === null).score, 0);
  assert.equal(result.mechanics.find(row => row.encounterId === null).score, null);
});

test("historical raids without new data retain their old display and support filtering", () => {
  const historical = { ...parent, zoneId: 42, profileBossScores: undefined };
  const oldRanking = { ...historical, score: 602.6, partition: 1 };
  const input = { rankings: [oldRanking], mechanics: [historical, parent] };
  const result = buildCharacterPerformance(input, "all");
  assert.deepEqual(result.rankings.find(row => row.zoneId === 42), oldRanking);
  assert.deepEqual(result.mechanics.find(row => row.zoneId === 42), historical);
  assert.equal(result.rebuiltZones.has(42), false);
  assert.equal(buildCharacterPerformance(input, "dps").mechanics.some(row => row.zoneId === 42), false);
  assert.deepEqual(buildCharacterPerformance(null, "all").rankings, []);
});
