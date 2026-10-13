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

test("recency lookup can restrict to mythic without changing prediction's default difficulty scope", async (t) => {
  const queries: Array<Array<Record<string, any>>> = [];
  t.mock.method(Guild, "aggregate", async (pipeline: Array<Record<string, any>>) => {
    queries.push(pipeline);
    return [{ raidId: 53, difficulty: "mythic", bossId: 3429 }];
  });
  const guildId = new Types.ObjectId();
  await bossKillPredictionService.findMostRecentlyPulledBoss(guildId, [53]);
  const target = await bossKillPredictionService.findMostRecentlyPulledBoss(guildId, [53], "mythic");
  assert.equal(target?.bossId, 3429);
  assert.ok(!queries[0].some((stage) => stage.$match?.["progress.difficulty"]));
  const difficultyFilter = queries[1].findIndex((stage) => stage.$match?.["progress.difficulty"] === "mythic");
  const sort = queries[1].findIndex((stage) => stage.$sort);
  assert.ok(difficultyFilter > 0 && difficultyFilter < sort, "filter difficulty before selecting the newest boss");
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
  assert.equal(normal.confidence, "low");
  assert.equal(normal.medianKillPull, 80);
});

test("unfinished guilds never impose a floor on another guild", () => {
  const baseline = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1)]);
  const withEarlierProgressingGuild = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1), peer(40, 0)]);
  const withLaterProgressingGuild = estimateBossKillPull(target(), [peer(70, 1), peer(80, 1), peer(90, 1), peer(120, 0)]);

  assert.ok(baseline);
  assert.ok(withEarlierProgressingGuild);
  assert.ok(withLaterProgressingGuild);
  assert.equal(withEarlierProgressingGuild.estimatedKillPull, baseline.estimatedKillPull);
  assert.equal(withLaterProgressingGuild.estimatedKillPull, baseline.estimatedKillPull);
});

test("predicts fewer remaining pulls for a better best pull when peer data is equal", () => {
  const peers = [peer(100, 1), peer(120, 1), peer(140, 1)];
  const early = estimateBossKillPull(target({ bestPercent: 70 }), peers);
  const deep = estimateBossKillPull(target({ bestPercent: 10 }), peers);

  assert.ok(early);
  assert.ok(deep);
  assert.ok(deep.estimatedRemainingPulls < early.estimatedRemainingPulls);
});

test("reproduces the Twin Fangs inflation regression without letting one unfinished guild dominate", () => {
  const killed = [10, 39, 40, 42, 54, 65, 71, 71, 73, 76, 77, 80, 92, 93, 109].map((pulls) => peer(pulls, 1));
  const current = target({ pullCount: 44, bestPercent: 7.37 });
  const result = estimateBossKillPull(current, [...killed, peer(122, 0)]);
  assert.ok(result);
  assert.equal(result.estimatedKillPull, 69);
  assert.equal(result.estimatedKillPull, estimateBossKillPull(current, killed)?.estimatedKillPull);
  assert.equal(result.confidence, "low");
  assert.equal(result.method, "pull_count");
  assert.equal(result.matchedGuilds, 0);
  assert.ok(estimateBossKillPull({ ...current, bestPercent: 40 }, killed)!.estimatedKillPull > result.estimatedKillPull);
});

const historyPeer = (killPull: number): BossPredictionSample => ({
  ...peer(killPull, 1),
  pullHistory: Array.from({ length: killPull }, (_, index) => ({
    pullNumber: index + 1,
    fightPercentage: [90, 75, 50, 25, 10][index] ?? 10,
    isKill: index + 1 === killPull,
  })),
});

const historyTarget = (recent = [90, 75, 50, 25, 10]): BossPredictionTarget => target({
  pullCount: 44,
  bestPercent: 10,
  pullHistory: recent.map((fightPercentage, index) => ({ pullNumber: 40 + index, fightPercentage, isKill: false })),
});

test("compares remaining pulls after similar progress, including earlier kills", () => {
  const result = estimateBossKillPull(historyTarget(), [historyPeer(8), historyPeer(10), historyPeer(14)]);
  assert.ok(result);
  // Peers first reached 10% on pull 5: 3, 5 and 9 pulls remained.
  assert.equal(result.estimatedKillPull, 49);
  assert.equal(result.optimisticKillPull, 47);
  assert.equal(result.pessimisticKillPull, 53);
  assert.equal(result.method, "similar_progress");
  assert.equal(result.matchedGuilds, 3);
  assert.equal(result.usedRecentConsistency, true);
  assert.equal(result.confidence, "low");
});

test("repeated deep pulls predict fewer remaining pulls than one lucky best", () => {
  const peers = [historyPeer(8), historyPeer(10), historyPeer(14)];
  const result = estimateBossKillPull(historyTarget([15, 14, 13, 12, 10]), peers);
  assert.ok(result);
  // The median of the last five first drops below 13% on peer pull 7.
  assert.equal(result.estimatedRemainingPulls, 3);
  assert.ok(result.estimatedRemainingPulls < estimateBossKillPull(historyTarget(), peers)!.estimatedRemainingPulls);
});

test("missing histories use a rough fallback and sparse matches cannot imply confidence", () => {
  const result = estimateBossKillPull(historyTarget(), [historyPeer(8), historyPeer(10), peer(14, 1)]);
  assert.ok(result);
  assert.equal(result.method, "pull_count");
  assert.equal(result.matchedGuilds, 2);
  assert.equal(result.usedRecentConsistency, false);
  assert.equal(result.confidence, "low");
});

test("zero wipe percentages are unknown, boss percentage fallback remains usable, and kills never match", () => {
  const peers = [8, 10, 14].map(historyPeer);
  for (const sample of peers) {
    for (const pull of sample.pullHistory!) {
      pull.bossPercentage = pull.fightPercentage;
      pull.fightPercentage = 0;
    }
  }
  assert.equal(estimateBossKillPull(historyTarget(), peers)?.estimatedKillPull, 49);
  for (const sample of peers) {
    for (const pull of sample.pullHistory!) pull.bossPercentage = 0;
  }
  assert.equal(estimateBossKillPull(historyTarget(), peers)?.matchedGuilds, 0);
});

test("incomplete kill records and post-kill pulls cannot be used as progress matches", () => {
  const peers = [8, 10, 14].map(historyPeer);
  for (const sample of peers) {
    sample.pullHistory = [
      { pullNumber: 1, fightPercentage: 99, isKill: false },
      { pullNumber: 2, fightPercentage: 0, isKill: true },
      { pullNumber: 3, fightPercentage: 1, isKill: false },
    ];
  }
  assert.equal(estimateBossKillPull(historyTarget(), peers)?.matchedGuilds, 0);
});

test("gaps or stale target history disable recent consistency instead of reusing old wipes", () => {
  const peers = [8, 10, 14].map(historyPeer);
  const current = historyTarget();
  current.pullHistory![2].pullNumber = 39;
  assert.equal(estimateBossKillPull(current, peers)?.usedRecentConsistency, false);
  current.pullHistory = historyTarget().pullHistory!.slice(0, 4);
  assert.equal(estimateBossKillPull(current, peers)?.usedRecentConsistency, false);
});

test("identical peer outcomes show their actual spread", () => {
  const result = estimateBossKillPull(historyTarget(), [historyPeer(8), historyPeer(8), historyPeer(8)]);
  assert.equal(result?.optimisticKillPull, 47);
  assert.equal(result?.pessimisticKillPull, 47);
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

test("both API and chat predictions use the target and peer pull histories", async (t) => {
  const guildId = new Types.ObjectId();
  const samples = [
    { ...historyTarget(), guildId, kills: 0, guildName: "Test Guild", raidName: "Test Raid", bossName: "Test Boss" },
    ...[8, 10, 14].map((pulls) => ({ ...historyPeer(pulls), guildId: new Types.ObjectId() })),
  ];
  let queries = 0;
  t.mock.method(Guild, "aggregate", () => {
    queries += 1;
    return queries === 1 ? { collation: async () => [samples[0]] } : Promise.resolve(samples);
  });
  const response = await bossKillPredictionService.predictForGuildBoss("Realm", "Test Guild", 53, 3421, "mythic");
  assert.ok(response.available);
  assert.equal(response.estimate.killPull, 49);
  assert.equal(response.facts.method, "similar_progress");
  assert.equal(response.facts.matchedGuilds, 3);
  assert.equal(response.facts.usedRecentConsistency, true);
  const chat = await bossKillPredictionService.predict({
    targetGuildId: guildId, raidId: 53, bossId: 3421, difficulty: "mythic",
    target: { pullCount: 44, bestPercent: 10 },
  });
  assert.equal(chat?.estimatedKillPull, response.estimate.killPull);
  assert.equal(chat?.usedRecentConsistency, true);
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
