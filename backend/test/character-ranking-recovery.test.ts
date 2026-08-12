/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";

test("ranking recovery respects full-history ownership and resumes interrupted work", async () => {
  process.env.RAIDER_IO_API_KEY ||= "test";
  process.env.BLIZZARD_CLIENT_ID ||= "test";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test";

  const [{ default: scheduler }, { default: FullHistoryRefresh }, { default: rankingService }] = await Promise.all([
    import("../src/services/scheduler.service"),
    import("../src/models/FullHistoryRefresh"),
    import("../src/services/character-ranking-backfill.service"),
  ]);
  const schedulerService = scheduler as any;
  const fullHistoryModel = FullHistoryRefresh as any;
  const rankings = rankingService as any;
  const originalFindOne = fullHistoryModel.findOne;
  const originalResume = rankings.resumeInterruptedBackfill;
  const resumeArguments: Array<number | undefined> = [];
  let activeStage: string | null = "character_identities";

  fullHistoryModel.findOne = () => ({
    select: () => ({
      lean: async () => activeStage ? { stage: activeStage } : null,
    }),
  });
  rankings.resumeInterruptedBackfill = async (staleAfterMs?: number) => {
    resumeArguments.push(staleAfterMs);
    return true;
  };

  try {
    await schedulerService.resumeCharacterRankingBackfill("watchdog");
    assert.deepEqual(resumeArguments, []);

    activeStage = "rankings";
    await schedulerService.resumeCharacterRankingBackfill("watchdog");
    assert.deepEqual(resumeArguments, [undefined]);

    activeStage = null;
    await schedulerService.resumeCharacterRankingBackfill("startup");
    assert.deepEqual(resumeArguments, [undefined, 0]);
  } finally {
    fullHistoryModel.findOne = originalFindOne;
    rankings.resumeInterruptedBackfill = originalResume;
  }
});
