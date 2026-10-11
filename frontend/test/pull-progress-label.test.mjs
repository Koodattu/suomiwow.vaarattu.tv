import assert from "node:assert/strict";
import test from "node:test";
import { formatBossProgressLabel, formatPullProgressLabel, shortProgressPhase } from "../src/lib/pull-progress-label.ts";

test("ordinary bosses show health on the selected pull, not overall fight remaining", () => {
  assert.equal(formatPullProgressLabel({ bossId: 3429, bossPercentage: 24.85, progressPercentage: 10.56, phase: "Stage Three: Coiled Union" }), "24.9% P3");
  assert.equal(formatPullProgressLabel({ bossId: 3134, bossPercentage: 30.74, fightPercentage: 17.91, progressDisplay: "30.7% Stage Three: World in Twilight" }), "30.7% P3");
});

test("repeating and healing encounters show fight remaining, including summary payloads", () => {
  assert.equal(formatPullProgressLabel({ bossId: 3182, bossPercentage: 96.8, fightPercentage: 0.62, phase: "Stage One: Phoenix Reborn" }), "0.6% P1");
  assert.equal(formatPullProgressLabel({ bossId: 3182, bossPercentage: 59.92, progressPercentage: 32.09, phase: "Stage One: Phoenix Reborn" }), "32.1% P1");
  assert.equal(formatPullProgressLabel({ bossId: 2402, bossPercentage: 80, fightPercentage: 20 }), "20.0%");
});

test("unavailable and invalid measurements fall back without inventing a zero-percent wipe", () => {
  for (const invalid of [undefined, null, 0, -1, 155, NaN, Infinity]) {
    assert.equal(formatPullProgressLabel({ bossPercentage: 73.9, fightPercentage: invalid }), "73.9%");
    assert.equal(formatPullProgressLabel({ bossPercentage: invalid, fightPercentage: 41.2 }), "41.2%");
    assert.equal(formatPullProgressLabel({ bossId: 3182, bossPercentage: 73.9, fightPercentage: invalid }), "73.9%");
    assert.equal(formatPullProgressLabel({ bossPercentage: invalid, fightPercentage: invalid, progressDisplay: "0.0% Phase 3" }), "- P3");
  }
  assert.equal(formatPullProgressLabel({ bossPercentage: 100 }), "100.0%");
  assert.equal(formatPullProgressLabel({}), "-");
});

test("phase and intermission numbers remain compact and distinct", () => {
  for (const [input, expected] of [
    ["Stage Three: Coiled Union", "P3"], ["Phase Three", "P3"], ["Phase 10", "P10"],
    ["Intermission Three: Something", "I3"], ["Intermission 3", "I3"], ["45.0% I3", "I3"],
    ["P2: A named phase", "P2"], ["Intermission: The Shattering", "I1"],
    ["Stage: 3 enemies", undefined], ["Phoenix Reborn", undefined],
  ]) assert.equal(shortProgressPhase(input), expected);
  assert.equal(formatPullProgressLabel({ bossPercentage: 65.03, phase: "I3", progressDisplay: "65.0% I1" }), "65.0% I1");
  assert.equal(formatPullProgressLabel({ bossPercentage: 60, phase: "P1", progressDisplay: "60.0% Phoenix Reborn" }), "60.0%");
});

test("boss rows use the linked best pull, including health without phase metadata", () => {
  const boss = {
    bossId: 3429, bestPercent: 10.56, bestPullReportCode: "best", bestPullFightId: 22,
    bestPullPhase: { bossHealth: 60, phaseName: "Stage Two" },
    pullHistory: [
      { reportCode: "other", fightId: 22, bossPercentage: 1, fightPercentage: 80, phase: "P1" },
      { reportCode: "best", fightId: 22, bossPercentage: 24.85, fightPercentage: 10.56, phase: "P3" },
    ],
  };
  assert.equal(formatBossProgressLabel(boss), "24.9% P3");
  assert.equal(formatBossProgressLabel({ ...boss, bestPullPhase: undefined, pullHistory: [{ ...boss.pullHistory[1], phase: undefined }] }), "24.9%");
  assert.equal(formatBossProgressLabel({ bossId: 1, bestPercent: 100 }), "-");
  assert.equal(formatBossProgressLabel({ bossId: 1, bestPercent: 79.5 }), "79.5%");
  assert.equal(formatBossProgressLabel({ bossId: 3429, bestPercent: 10.56, bestPullBossHealth: 24.85 }), "24.9%");
  assert.equal(formatBossProgressLabel({ bossId: 3429, bestPercent: 10.56, bestPullBossHealth: null, bestPullPhase: { bossHealth: 60 } }), "10.6%");
});
