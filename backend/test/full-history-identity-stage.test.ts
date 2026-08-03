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
