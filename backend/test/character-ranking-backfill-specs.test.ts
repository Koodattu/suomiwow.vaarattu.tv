import assert from "node:assert/strict";
import test from "node:test";
import characterRankingBackfillService from "../src/services/character-ranking-backfill.service";
import rateLimitService from "../src/services/rate-limit.service";
import CharacterRankingBackfill from "../src/models/CharacterRankingBackfill";
import Ranking from "../src/models/Ranking";
import wclService from "../src/services/warcraftlogs.service";
import { getWclRankingPartitionIds } from "../src/utils/wcl-ranking-partitions";

test("ranking backfill fetches best DPS across every class spec with one alias", () => {
  const service = characterRankingBackfillService as any;
  const queries = service.buildSpecQueries({
    classID: 13,
    observedSpecNames: ["Augmentation"],
  });

  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0], {
    alias: "allSpecsDpsRankings",
    metric: "dps",
    coveredSpecSlugs: ["devastation", "augmentation", "preservation"],
    source: "observed",
  });
  assert.deepEqual(queries[1], {
    alias: "preservationHpsRankings",
    metric: "hps",
    coveredSpecSlugs: ["preservation"],
    specSlug: "preservation",
    wclName: "Preservation",
    source: "fallback",
  });
});

test("ranking backfill recognizes WCL spec names whose stored slug contains punctuation", () => {
  const service = characterRankingBackfillService as any;
  const queries = service.buildSpecQueries({
    classID: 3,
    observedSpecNames: ["BeastMastery"],
  });

  assert.equal(queries[0]?.source, "observed");
  assert.ok(queries[0]?.coveredSpecSlugs.includes("beast-mastery"));
});

test("ranking backfill queries every configured raid partition explicitly", () => {
  const service = characterRankingBackfillService as any;
  const partitionIds = getWclRankingPartitionIds([{ id: 2 }, { id: 1 }, { id: 2 }, { id: 0 }, { id: "3" }]);
  const specQueries = service.buildSpecQueries({ classID: 8, observedSpecNames: ["Assassination"] });
  const partitionQueries = service.buildPartitionQueries(specQueries, partitionIds);
  const query = service.buildWclQuery(partitionQueries);

  assert.deepEqual(partitionIds, [1, 2]);
  assert.equal(partitionQueries.length, specQueries.length * 2);
  assert.match(query, /allSpecsDpsRankingsPartition1: zoneRankings\([^\n]+partition: 1\)/);
  assert.match(query, /allSpecsDpsRankingsPartition2: zoneRankings\([^\n]+partition: 2\)/);
  assert.doesNotMatch(query, /specName:/);
  assert.doesNotMatch(query, /partition: -1/);
});

test("ranking backfill keeps HPS restricted to healer specs", () => {
  const service = characterRankingBackfillService as any;
  const specQueries = service.buildSpecQueries({ classID: 7, observedSpecNames: ["Holy", "Shadow"] });
  const partitionQueries = service.buildPartitionQueries(specQueries, [1]);
  const query = service.buildWclQuery(partitionQueries);

  assert.equal(specQueries.length, 3);
  assert.match(query, /allSpecsDpsRankingsPartition1: zoneRankings\([^\n]+metric: dps[^\n]+partition: 1\)/);
  assert.match(query, /disciplineHpsRankingsPartition1: zoneRankings\([^\n]+metric: hps[^\n]+specName: "Discipline"\)/);
  assert.match(query, /holyHpsRankingsPartition1: zoneRankings\([^\n]+metric: hps[^\n]+specName: "Holy"\)/);
  assert.doesNotMatch(query, /shadowHpsRankings/);
});

test("ranking backfill removes stale explicit-spec DPS rows after an all-spec response", async () => {
  const service = characterRankingBackfillService as any;
  const rankingModel = Ranking as any;
  const wcl = wclService as any;
  const originals = {
    query: wcl.query,
    bulkWrite: rankingModel.bulkWrite,
    deleteMany: rankingModel.deleteMany,
    rebuildLeaderboardForCharacterZone: service.rebuildLeaderboardForCharacterZone,
  };
  let cleanupFilter: Record<string, any> | null = null;

  try {
    wcl.query = async () => ({
      characterData: {
        character: {
          canonicalID: 123,
          allSpecsDpsRankingsPartition1: {
            rankings: [{
              encounter: { id: 1, name: "Test Boss" },
              spec: "Assassination",
              bestSpec: "Assassination",
              bestAmount: 1000,
              rankPercent: 95,
              medianPercent: 90,
              totalKills: 2,
              allStars: { points: 100, possiblePoints: 110 },
            }],
          },
        },
      },
    });
    rankingModel.bulkWrite = async () => ({ upsertedCount: 1 });
    rankingModel.deleteMany = async (filter: Record<string, any>) => {
      cleanupFilter = filter;
      return { deletedCount: 1 };
    };
    service.rebuildLeaderboardForCharacterZone = async () => 1;

    const specQueries = service.buildSpecQueries({ classID: 8, observedSpecNames: ["Assassination"] });
    const outcome = await service.processItem(
      {
        characterId: "507f1f77bcf86cd799439011",
        wclCanonicalCharacterId: 123,
        name: "Testrogue",
        realm: "stormreaver",
        region: "eu",
        classID: 8,
        zoneId: 10,
      },
      service.buildPartitionQueries(specQueries, [1]),
    );

    assert.equal(outcome.status, "completed");
    assert.equal((cleanupFilter as any)?.metric, "dps");
    assert.equal(Object.prototype.hasOwnProperty.call(cleanupFilter ?? {}, "specName"), false);
    assert.deepEqual((cleanupFilter as any)?.$nor, [{ "encounter.id": 1, specName: "assassination" }]);
  } finally {
    wcl.query = originals.query;
    rankingModel.bulkWrite = originals.bulkWrite;
    rankingModel.deleteMany = originals.deleteMany;
    service.rebuildLeaderboardForCharacterZone = originals.rebuildLeaderboardForCharacterZone;
  }
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

test("ranking backfill continues after the WCL quota resets", async () => {
  const service = characterRankingBackfillService as any;
  const rateLimit = rateLimitService as any;
  const originals = {
    refreshSharedState: rateLimit.refreshSharedState,
    canProceedBackground: rateLimit.canProceedBackground,
    getBackgroundCapacity: rateLimit.getBackgroundCapacity,
    getSharedStatus: rateLimit.getSharedStatus,
    waitForReset: rateLimit.waitForReset,
    stopRequested: service.stopRequested,
    isWaitingForRateLimit: service.isWaitingForRateLimit,
  };
  let resetCompleted = false;
  let waits = 0;

  try {
    service.stopRequested = false;
    rateLimit.refreshSharedState = async () => undefined;
    rateLimit.canProceedBackground = () => resetCompleted;
    rateLimit.getBackgroundCapacity = () => resetCompleted ? 100 : 0;
    rateLimit.getSharedStatus = async () => ({ resetInSeconds: 60 });
    rateLimit.waitForReset = async () => {
      waits += 1;
      resetCompleted = true;
    };

    await service.waitForBackgroundCapacity(25, "quota reset test");

    assert.equal(waits, 1);
    assert.equal(service.isWaitingForRateLimit, false);
  } finally {
    rateLimit.refreshSharedState = originals.refreshSharedState;
    rateLimit.canProceedBackground = originals.canProceedBackground;
    rateLimit.getBackgroundCapacity = originals.getBackgroundCapacity;
    rateLimit.getSharedStatus = originals.getSharedStatus;
    rateLimit.waitForReset = originals.waitForReset;
    service.stopRequested = originals.stopRequested;
    service.isWaitingForRateLimit = originals.isWaitingForRateLimit;
    service.stopListeners.clear();
  }
});

test("ranking backfill startup recovery requeues an interrupted item and starts pending work", async () => {
  const service = characterRankingBackfillService as any;
  const model = CharacterRankingBackfill as any;
  const originals = {
    updateMany: model.updateMany,
    countDocuments: model.countDocuments,
    startProcessing: service.startProcessing,
    isRunning: service.isRunning,
  };
  let resetFilter: Record<string, unknown> | null = null;
  let starts = 0;

  try {
    service.isRunning = false;
    model.updateMany = async (filter: Record<string, unknown>) => {
      resetFilter = filter;
      return { modifiedCount: 1 };
    };
    model.countDocuments = async () => 1;
    service.startProcessing = () => {
      starts += 1;
      return true;
    };

    assert.equal(await service.resumeInterruptedBackfill(0), true);
    assert.equal((resetFilter as any)?.status, "in_progress");
    assert.ok((resetFilter as any)?.lastActivityAt?.$lt instanceof Date);
    assert.equal(starts, 1);
  } finally {
    model.updateMany = originals.updateMany;
    model.countDocuments = originals.countDocuments;
    service.startProcessing = originals.startProcessing;
    service.isRunning = originals.isRunning;
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
