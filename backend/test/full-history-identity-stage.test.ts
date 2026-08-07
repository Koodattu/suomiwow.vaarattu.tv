import assert from "node:assert/strict";
import test from "node:test";

test("full-history refresh recovers character identities before ranking backfill", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const { default: fullHistoryRefreshService } = await import("../src/services/full-history-refresh.service");
  const service = fullHistoryRefreshService as any;
  const originals = {
    getFightDetailsQueueCounts: service.getFightDetailsQueueCounts,
    updateProgress: service.updateProgress,
    advance: service.advance,
  };
  let nextStage: string | null = null;

  try {
    service.getFightDetailsQueueCounts = async () => ({
      pending: 0,
      inProgress: 0,
      paused: 0,
      completed: 10,
      failed: 0,
      active: 0,
      total: 10,
    });
    service.updateProgress = async () => undefined;
    service.advance = async (_run: unknown, stage: string) => {
      nextStage = stage;
    };

    await service.waitForFightDetails({ progress: {} });

    assert.equal(nextStage, "queue_character_identities");
  } finally {
    service.getFightDetailsQueueCounts = originals.getFightDetailsQueueCounts;
    service.updateProgress = originals.updateProgress;
    service.advance = originals.advance;
  }
});

test("identity-recovery restart resets every ranking pair after participation is rebuilt", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [{ default: fullHistoryRefreshService }, { default: characterRankingBackfillService }] = await Promise.all([
    import("../src/services/full-history-refresh.service"),
    import("../src/services/character-ranking-backfill.service"),
  ]);
  const service = fullHistoryRefreshService as any;
  const rankingService = characterRankingBackfillService as any;
  const originals = {
    getStatus: rankingService.getStatus,
    triggerBackfill: rankingService.triggerBackfill,
    advance: service.advance,
  };
  let triggerOptions: any = null;
  let nextStage: string | null = null;

  try {
    rankingService.getStatus = async () => ({
      processor: { isRunning: false },
      queue: { pending: 0, inProgress: 0, completed: 100, skipped: 0, failed: 0 },
    });
    rankingService.triggerBackfill = async (options: Record<string, unknown>) => {
      triggerOptions = options;
      return {
        enqueue: {},
        status: { queue: { pending: 100, inProgress: 0, completed: 0, skipped: 0, failed: 0 } },
      };
    };
    service.advance = async (_run: unknown, stage: string) => {
      nextStage = stage;
    };

    await service.queueRankings({
      progress: {
        characterIdentityResolutionCompleted: true,
        rankingRestartFromScratch: true,
      },
    });

    assert.equal(triggerOptions?.reprocessAll, true);
    assert.equal(triggerOptions?.reprocessCompleted, false);
    assert.equal(nextStage, "rankings");
  } finally {
    rankingService.getStatus = originals.getStatus;
    rankingService.triggerBackfill = originals.triggerBackfill;
    service.advance = originals.advance;
  }
});

test("incremental character-data refresh discovers only missing ranking pairs", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [{ default: fullHistoryRefreshService }, { default: characterRankingBackfillService }] = await Promise.all([
    import("../src/services/full-history-refresh.service"),
    import("../src/services/character-ranking-backfill.service"),
  ]);
  const service = fullHistoryRefreshService as any;
  const rankingService = characterRankingBackfillService as any;
  const originals = {
    triggerBackfill: rankingService.triggerBackfill,
    advance: service.advance,
  };
  let triggerOptions: any = null;

  try {
    rankingService.triggerBackfill = async (options: Record<string, unknown>) => {
      triggerOptions = options;
      return {
        enqueue: { queued: 3 },
        status: { queue: { pending: 3, inProgress: 0, completed: 100, skipped: 0, failed: 0 } },
      };
    };
    service.advance = async () => undefined;

    await service.queueRankings({
      progress: {
        mode: "incremental_character_data",
        characterIdentityResolutionCompleted: true,
      },
    });

    assert.deepEqual(triggerOptions, {
      refreshCandidates: true,
      reprocessCompleted: false,
      reprocessAll: false,
    });
  } finally {
    rankingService.triggerBackfill = originals.triggerBackfill;
    service.advance = originals.advance;
  }
});

test("incremental character-data refresh does not reopen every historical identity skip", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [{ default: fullHistoryRefreshService }, { default: characterIdentityResolutionService }] = await Promise.all([
    import("../src/services/full-history-refresh.service"),
    import("../src/services/character-identity-resolution.service"),
  ]);
  const service = fullHistoryRefreshService as any;
  const identityService = characterIdentityResolutionService as any;
  const originals = {
    trigger: identityService.trigger,
    advance: service.advance,
  };
  let triggerOptions: any = null;

  try {
    identityService.trigger = async (options: Record<string, unknown>) => {
      triggerOptions = options;
      return { enqueue: { queued: 10 }, status: { queue: { pending: 10 } } };
    };
    service.advance = async () => undefined;

    await service.queueCharacterIdentities({ progress: { mode: "incremental_character_data" } });

    assert.deepEqual(triggerOptions, {
      refreshCandidates: true,
      reprocessSkipped: false,
      reprocessSkippedWithNewEvidence: true,
    });
  } finally {
    identityService.trigger = originals.trigger;
    service.advance = originals.advance;
  }
});

test("incremental identity recovery reopens only terminal identities with newer report appearances", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [
    { default: characterIdentityResolutionService },
    { default: CharacterIdentityResolution },
    { default: CharacterReportAppearance },
  ] = await Promise.all([
    import("../src/services/character-identity-resolution.service"),
    import("../src/models/CharacterIdentityResolution"),
    import("../src/models/CharacterReportAppearance"),
  ]);
  const service = characterIdentityResolutionService as any;
  const originals = {
    aggregate: CharacterReportAppearance.aggregate,
    updateMany: CharacterIdentityResolution.updateMany,
  };
  let savedFilter: Record<string, unknown> | null = null;
  let savedUpdate: Record<string, unknown> | null = null;

  try {
    CharacterReportAppearance.aggregate = (() => ({ allowDiskUse: async () => [{ _id: "report-ranking:eu:lightbringer:dixi:9" }] })) as any;
    CharacterIdentityResolution.updateMany = (async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      savedFilter = filter;
      savedUpdate = update;
      return { modifiedCount: 1 };
    }) as any;

    assert.equal(await service.requeueTerminalItemsWithNewAppearances(), 1);
    assert.deepEqual(savedFilter, {
      sourceIdentityKey: { $in: ["report-ranking:eu:lightbringer:dixi:9"] },
      status: { $in: ["skipped", "failed"] },
    });
    assert.equal((savedUpdate as any)?.$set.status, "pending");
    assert.equal((savedUpdate as any)?.$set.attempts, 0);
  } finally {
    CharacterReportAppearance.aggregate = originals.aggregate;
    CharacterIdentityResolution.updateMany = originals.updateMany;
  }
});

test("incremental character-data refresh queues Mythic+ profiles for affected guild characters", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [
    { default: fullHistoryRefreshService },
    { default: characterService },
    { default: CharacterRaidParticipation },
    { default: mythicPlusService },
  ] = await Promise.all([
    import("../src/services/full-history-refresh.service"),
    import("../src/services/character.service"),
    import("../src/models/CharacterRaidParticipation"),
    import("../src/services/mythic-plus.service"),
  ]);
  const service = fullHistoryRefreshService as any;
  const originals = {
    rebuildParticipation: characterService.rebuildCharacterRaidParticipations,
    participationDistinct: CharacterRaidParticipation.distinct,
    enqueueProfiles: mythicPlusService.enqueueProfileJobs,
    startMythicPlus: mythicPlusService.startProcessing,
    advance: service.advance,
  };
  const characterId = "6a75a6206089e7de1f229ac6";
  let enqueueOptions: Record<string, unknown> | null = null;
  let savedProgress: Record<string, unknown> | null = null;

  try {
    characterService.rebuildCharacterRaidParticipations = async () => ({ deleted: 10, inserted: 12 });
    CharacterRaidParticipation.distinct = (async () => [characterId]) as unknown as typeof CharacterRaidParticipation.distinct;
    mythicPlusService.enqueueProfileJobs = (async (options: Record<string, unknown>) => {
      enqueueOptions = options;
      return { candidates: 1, queued: 1, existing: 0 };
    }) as typeof mythicPlusService.enqueueProfileJobs;
    mythicPlusService.startProcessing = () => true;
    service.advance = async (_run: unknown, _stage: string, progress: Record<string, unknown>) => {
      savedProgress = progress;
    };

    await service.rebuildCharacterParticipation({
      progress: {
        mode: "incremental_character_data",
        targetGuildIds: ["6a75a6f46089e7de1f22bd18"],
      },
    });

    assert.deepEqual(enqueueOptions, {
      characterIds: [characterId],
      refresh: true,
      targetSeasons: [],
      fetchSeasonProgress: false,
    });
    assert.deepEqual((savedProgress as any)?.mythicPlus, {
      started: true,
      enqueue: { candidates: 1, queued: 1, existing: 0 },
    });
  } finally {
    characterService.rebuildCharacterRaidParticipations = originals.rebuildParticipation;
    CharacterRaidParticipation.distinct = originals.participationDistinct;
    mythicPlusService.enqueueProfileJobs = originals.enqueueProfiles;
    mythicPlusService.startProcessing = originals.startMythicPlus;
    service.advance = originals.advance;
  }
});

test("identity-recovery restart waits for the ranking worker to stop before advancing", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [{ default: fullHistoryRefreshService }, { default: characterRankingBackfillService }] = await Promise.all([
    import("../src/services/full-history-refresh.service"),
    import("../src/services/character-ranking-backfill.service"),
  ]);
  const service = fullHistoryRefreshService as any;
  const rankingService = characterRankingBackfillService as any;
  const originals = {
    requestStop: rankingService.requestStop,
    getStatus: rankingService.getStatus,
    updateProgress: service.updateProgress,
    advance: service.advance,
  };
  let running = true;
  let nextStage: string | null = null;

  try {
    rankingService.requestStop = () => true;
    rankingService.getStatus = async () => ({
      processor: { isRunning: running },
      leaderboardRebuild: { isRunning: false },
      queue: { pending: 100, inProgress: running ? 1 : 0, completed: 20, skipped: 0, failed: 0 },
    });
    service.updateProgress = async () => undefined;
    service.advance = async (_run: unknown, stage: string) => {
      nextStage = stage;
    };

    await service.stopRankingsForIdentityRecovery({ progress: {} });
    assert.equal(nextStage, null);

    running = false;
    await service.stopRankingsForIdentityRecovery({ progress: {} });
    assert.equal(nextStage, "queue_character_identities");
  } finally {
    rankingService.requestStop = originals.requestStop;
    rankingService.getStatus = originals.getStatus;
    service.updateProgress = originals.updateProgress;
    service.advance = originals.advance;
  }
});

test("an older in-progress ranking stage rewinds immediately instead of draining its old queue", async () => {
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";
  process.env.RAIDER_IO_API_KEY ||= "test-key";
  const [{ default: fullHistoryRefreshService }, { default: characterRankingBackfillService }] = await Promise.all([
    import("../src/services/full-history-refresh.service"),
    import("../src/services/character-ranking-backfill.service"),
  ]);
  const service = fullHistoryRefreshService as any;
  const rankingService = characterRankingBackfillService as any;
  const originals = {
    rewindToIdentityRecovery: service.rewindToIdentityRecovery,
    resumeInterruptedBackfill: rankingService.resumeInterruptedBackfill,
  };
  let rewound = false;
  let resumed = false;

  try {
    service.rewindToIdentityRecovery = async () => {
      rewound = true;
    };
    rankingService.resumeInterruptedBackfill = async () => {
      resumed = true;
    };

    await service.waitForRankings({ progress: {} });

    assert.equal(rewound, true);
    assert.equal(resumed, false);
  } finally {
    service.rewindToIdentityRecovery = originals.rewindToIdentityRecovery;
    rankingService.resumeInterruptedBackfill = originals.resumeInterruptedBackfill;
  }
});
