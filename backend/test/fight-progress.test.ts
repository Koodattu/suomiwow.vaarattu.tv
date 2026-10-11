import assert from "node:assert/strict";
import test from "node:test";
import { getBestPullBossHealth, resolveFightProgress } from "../src/utils/fight-progress";

test("summary health comes from the selected pull, even without phase metadata", () => {
  assert.equal(getBestPullBossHealth({
    bestPullReportCode: "best", bestPullFightId: 22,
    pullHistory: [
      { pullNumber: 1, reportCode: "other", fightId: 22, bossPercentage: 1, fightPercentage: 80, isKill: false },
      { pullNumber: 2, reportCode: "best", fightId: 22, bossPercentage: 24.85, fightPercentage: 10.56, isKill: false },
    ],
  }), 24.85);
});

test("summary health uses legacy phase metadata only when the selected history entry is absent", () => {
  const phase = { phaseId: 4, phaseName: "Stage Three", bossHealth: 24.85, fightCompletion: 10.56, displayString: "24.9% P3" };
  assert.equal(getBestPullBossHealth({ bestPullPhase: phase }), 24.85);
  assert.equal(getBestPullBossHealth(), null);
  for (const invalid of [undefined, 0, -1, 155, NaN, Infinity]) {
    assert.equal(getBestPullBossHealth({
      bestPullReportCode: "best", bestPullFightId: 22, bestPullPhase: phase,
      pullHistory: [{ pullNumber: 1, reportCode: "best", fightId: 22, bossPercentage: invalid, fightPercentage: 10.56, isKill: false }],
    }), null);
  }
});

test("resolves kills to zero regardless of reported percentages", () => {
  assert.deepEqual(resolveFightProgress({ isKill: true, fightPercentage: 42, bossPercentage: 37 }), {
    percentage: 0,
    source: "kill",
  });
});

test("prefers a valid fight percentage", () => {
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 41.2, bossPercentage: 53.8 }), {
    percentage: 41.2,
    source: "fight",
  });
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 100, bossPercentage: 100 }), {
    percentage: 100,
    source: "fight",
  });
});

test("falls back to boss health when fight progress is unavailable or invalid", () => {
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 0, bossPercentage: 73.9 }), {
    percentage: 73.9,
    source: "boss",
  });
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 175_062.75, bossPercentage: 79.57 }), {
    percentage: 79.57,
    source: "boss",
  });
});

test("returns unknown when neither reported percentage is usable", () => {
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 0, bossPercentage: 0 }), {
    percentage: null,
    source: "unknown",
  });
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: Number.NaN, bossPercentage: null }), {
    percentage: null,
    source: "unknown",
  });
});
