import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Guild from "../src/models/Guild";
import bossKillPredictionService, {
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
  assert.ok(normal.optimisticKillPull < normal.estimatedKillPull);
  assert.ok(normal.pessimisticKillPull > normal.estimatedKillPull);
  assert.ok(withOutlier.pessimisticKillPull < 200);
  assert.equal(normal.confidence, "medium");
  assert.equal(normal.medianKillPull, 80);
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
  assert.ok(result.optimisticKillPull > 200);
  assert.ok(result.optimisticKillPull < result.estimatedKillPull);
  assert.ok(result.pessimisticKillPull > result.estimatedKillPull);
  assert.equal(result.confidence, "low");
});

test("returns null when the target has no pulls", () => {
  assert.equal(estimateBossKillPull(target({ pullCount: 0 }), []), null);
});

test("returns the exact-boss prediction facts from aggregated counts", async () => {
  const originalAggregate = Guild.aggregate;
  const targetGuildId = new Types.ObjectId();
  const capturedPipelines: unknown[][] = [];
  let aggregateCalls = 0;

  Guild.aggregate = ((pipeline: unknown[]) => {
    capturedPipelines.push(pipeline);
    aggregateCalls += 1;

    if (aggregateCalls === 1) {
      return {
        collation: async () => [
          {
            guildId: targetGuildId,
            guildName: "Test Guild",
            raidName: "Test Raid",
            bossName: "Test Boss",
            kills: 0,
            pullCount: 50,
            bestPercent: 25,
            phaseCounts: [
              { phase: "P1", count: 30 },
              { phase: "P2", count: 20 },
            ],
          },
        ],
      };
    }

    return Promise.resolve([
      { guildId: targetGuildId, kills: 0, pullCount: 50, phaseCounts: [] },
      { guildId: new Types.ObjectId(), kills: 1, pullCount: 70, phaseCounts: [] },
      { guildId: new Types.ObjectId(), kills: 1, pullCount: 80, phaseCounts: [] },
      { guildId: new Types.ObjectId(), kills: 1, pullCount: 90, phaseCounts: [] },
      { guildId: new Types.ObjectId(), kills: 0, pullCount: 60, phaseCounts: [] },
    ]);
  }) as unknown as typeof Guild.aggregate;

  try {
    const result = await bossKillPredictionService.predictForGuildBoss("Realm", "Test Guild", 46, 123, "mythic");

    assert.equal(result.available, true);
    if (!result.available) return;

    assert.equal(result.boss.name, "Test Boss");
    assert.equal(result.facts.currentPulls, 50);
    assert.equal(result.facts.bestPercent, 25);
    assert.deepEqual(result.facts.phaseCounts, [
      { phase: "P1", count: 30 },
      { phase: "P2", count: 20 },
    ]);
    assert.equal(result.facts.killedGuilds, 3);
    assert.equal(result.facts.progressingGuilds, 1);
    assert.equal(result.facts.medianKillPull, 80);
    assert.ok(result.estimate.optimisticKillPull < result.estimate.killPull);
    assert.ok(result.estimate.pessimisticKillPull > result.estimate.killPull);
    assert.deepEqual((capturedPipelines[0][0] as { $match: { excludedRaidIds: unknown } }).$match.excludedRaidIds, { $ne: 46 });
  } finally {
    Guild.aggregate = originalAggregate;
  }
});

test("does not query peers when the exact boss has no active pulls", async () => {
  const originalAggregate = Guild.aggregate;
  const targetGuildId = new Types.ObjectId();
  let aggregateCalls = 0;

  Guild.aggregate = (() => {
    aggregateCalls += 1;
    return {
      collation: async () => [
        {
          guildId: targetGuildId,
          guildName: "Test Guild",
          raidName: "Test Raid",
          bossName: "Test Boss",
          kills: 0,
          pullCount: 0,
          bestPercent: 100,
          phaseCounts: [],
        },
      ],
    };
  }) as unknown as typeof Guild.aggregate;

  try {
    const result = await bossKillPredictionService.predictForGuildBoss("Realm", "Test Guild", 46, 123, "mythic");

    assert.deepEqual(result, { available: false, reason: "boss_not_progressing" });
    assert.equal(aggregateCalls, 1);
  } finally {
    Guild.aggregate = originalAggregate;
  }
});
