import assert from "node:assert/strict";
import test from "node:test";
import characterRankingBackfillService from "../src/services/character-ranking-backfill.service";
import rateLimitService from "../src/services/rate-limit.service";
import { getWclRankingPartitionIds } from "../src/utils/wcl-ranking-partitions";

test("ranking backfill fetches every class spec even when one spec was already observed", () => {
  const service = characterRankingBackfillService as any;
  const queries = service.buildSpecQueries({
    classID: 13,
    observedSpecNames: ["Augmentation"],
  });

  assert.deepEqual(
    queries.map((query: any) => `${query.specSlug}:${query.metric}`).sort(),
    [
      "augmentation:dps",
      "devastation:dps",
      "preservation:dps",
      "preservation:hps",
    ],
  );
  assert.equal(queries.find((query: any) => query.specSlug === "augmentation")?.source, "observed");
  assert.equal(queries.find((query: any) => query.specSlug === "devastation")?.source, "fallback");
});

test("ranking backfill recognizes WCL spec names whose stored slug contains punctuation", () => {
  const service = characterRankingBackfillService as any;
  const queries = service.buildSpecQueries({
    classID: 3,
    observedSpecNames: ["BeastMastery"],
  });

  assert.equal(queries.find((query: any) => query.specSlug === "beast-mastery")?.source, "observed");
});

test("ranking backfill queries every configured raid partition explicitly", () => {
  const service = characterRankingBackfillService as any;
  const partitionIds = getWclRankingPartitionIds([{ id: 2 }, { id: 1 }, { id: 2 }, { id: 0 }, { id: "3" }]);
  const specQueries = service.buildSpecQueries({ classID: 8, observedSpecNames: ["Assassination"] });
  const partitionQueries = service.buildPartitionQueries(specQueries, partitionIds);
  const query = service.buildWclQuery(partitionQueries);

  assert.deepEqual(partitionIds, [1, 2]);
  assert.equal(partitionQueries.length, specQueries.length * 2);
  assert.match(query, /assassinationDpsRankingsPartition1: zoneRankings\([^\n]+partition: 1/);
  assert.match(query, /assassinationDpsRankingsPartition2: zoneRankings\([^\n]+partition: 2/);
  assert.doesNotMatch(query, /partition: -1/);
});

test("ranking backfill cooperative stop interrupts a rate-limit wait", async () => {
  const service = characterRankingBackfillService as any;
  const rateLimit = rateLimitService as any;
  const originalWaitForReset = rateLimit.waitForReset;
  const originalRunning = service.isRunning;
  const originalStopRequested = service.stopRequested;

  try {
    service.isRunning = true;
    service.stopRequested = false;
    rateLimit.waitForReset = () => new Promise<void>(() => undefined);

    const waiting = service.waitForRateLimitResetOrStop();
    assert.equal(service.requestStop(), true);
    assert.equal(await waiting, false);
  } finally {
    rateLimit.waitForReset = originalWaitForReset;
    service.isRunning = originalRunning;
    service.stopRequested = originalStopRequested;
    service.stopListeners.clear();
  }
});

test("ranking queue cannot be reset from scratch while its worker is still running", async () => {
  const service = characterRankingBackfillService as any;
  const originalRunning = service.isRunning;

  try {
    service.isRunning = true;
    await assert.rejects(
      () => service.triggerBackfill({ reprocessAll: true }),
      /still running/,
    );
  } finally {
    service.isRunning = originalRunning;
    service.stopRequested = false;
  }
});
