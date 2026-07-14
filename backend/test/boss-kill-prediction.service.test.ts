import assert from "node:assert/strict";
import test from "node:test";
import {
  BossPredictionPhaseCount,
  BossPredictionSample,
  BossPredictionTarget,
  estimateBossKillPull,
} from "../src/services/boss-kill-prediction.service";

const target = (overrides: Partial<BossPredictionTarget> = {}): BossPredictionTarget => ({
  pullCount: 50,
  bestPercent: 30,
  phaseCounts: [],
  ...overrides,
});

const peer = (pullCount: number, kills: number, phaseCounts: BossPredictionPhaseCount[] = []): BossPredictionSample => ({
  pullCount,
  kills,
  phaseCounts,
});

test("uses the median of later kill samples instead of being pulled by an outlier", () => {
  const normal = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1)]);
  const withOutlier = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1), peer(1000, 1)]);

  assert.ok(normal);
  assert.ok(withOutlier);
  assert.ok(withOutlier.estimatedKillPull < 200);
  assert.equal(normal.confidence, "medium");
});

test("uses progressing guilds only as a floor when they have survived longer", () => {
  const baseline = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1)]);
  const withEarlierProgressingGuild = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1), peer(40, 0)]);
  const withLaterProgressingGuild = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1), peer(120, 0)]);

  assert.ok(baseline);
  assert.ok(withEarlierProgressingGuild);
  assert.ok(withLaterProgressingGuild);
  assert.equal(withEarlierProgressingGuild.estimatedKillPull, baseline.estimatedKillPull);
  assert.ok(withLaterProgressingGuild.estimatedKillPull > baseline.estimatedKillPull);
});

test("predicts fewer remaining pulls for a better best pull when peer data is equal", () => {
  const peers = [peer(100, 1), peer(120, 1), peer(140, 1)];
  const early = estimateBossKillPull(target({ bestPercent: 70 }), peers);
  const deep = estimateBossKillPull(target({ bestPercent: 10 }), peers);

  assert.ok(early);
  assert.ok(deep);
  assert.ok(deep.estimatedRemainingPulls < early.estimatedRemainingPulls);
});

test("uses later terminal phases as a bounded adjustment", () => {
  const peers = [
    peer(100, 1, [
      { phase: "P1", count: 30 },
      { phase: "P2", count: 20 },
      { phase: "P3", count: 10 },
    ]),
    peer(120, 1, [
      { phase: "P1", count: 35 },
      { phase: "P2", count: 20 },
      { phase: "P3", count: 10 },
    ]),
    peer(140, 1, [
      { phase: "P1", count: 40 },
      { phase: "P2", count: 25 },
      { phase: "P3", count: 10 },
    ]),
  ];
  const early = estimateBossKillPull(target({ phaseCounts: [{ phase: "P1", count: 50 }] }), peers);
  const deep = estimateBossKillPull(target({ phaseCounts: [{ phase: "P3", count: 50 }] }), peers);

  assert.ok(early);
  assert.ok(deep);
  assert.equal(early.usedPhaseData, true);
  assert.equal(deep.usedPhaseData, true);
  assert.ok(deep.estimatedRemainingPulls < early.estimatedRemainingPulls);
});

test("ignores phase zero and still produces a low-confidence fallback without kills", () => {
  const result = estimateBossKillPull(target({ phaseCounts: [{ phase: "P0", count: 50 }] }), [peer(75, 0, [{ phase: "P0", count: 75 }])]);

  assert.ok(result);
  assert.equal(result.confidence, "low");
  assert.equal(result.killedGuilds, 0);
  assert.equal(result.progressingGuilds, 1);
  assert.equal(result.usedPhaseData, false);
  assert.ok(result.estimatedKillPull > 50);
});

test("always predicts at least one more pull after the target has passed every kill sample", () => {
  const result = estimateBossKillPull(target({ pullCount: 200, bestPercent: 1 }), [peer(50, 1), peer(75, 1), peer(100, 1)]);

  assert.ok(result);
  assert.ok(result.estimatedRemainingPulls >= 1);
  assert.ok(result.estimatedKillPull > 200);
  assert.equal(result.confidence, "low");
});

test("returns null when the target has no pulls", () => {
  assert.equal(estimateBossKillPull(target({ pullCount: 0 }), []), null);
});
