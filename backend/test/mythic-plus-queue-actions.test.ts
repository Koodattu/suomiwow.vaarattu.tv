import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CharacterMythicPlusFetchJob from "../src/models/CharacterMythicPlusFetchJob";
import CharacterMythicPlusSeasonScore from "../src/models/CharacterMythicPlusSeasonScore";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import mythicPlusService from "../src/services/mythic-plus.service";

test("missing Mythic+ profile jobs exclude characters with scores or an existing profile job", async (t) => {
  const withScore = new mongoose.Types.ObjectId();
  const withJob = new mongoose.Types.ObjectId();
  const missing = new mongoose.Types.ObjectId();
  const originalParticipationDistinct = CharacterRaidParticipation.distinct;
  const originalScoreDistinct = CharacterMythicPlusSeasonScore.distinct;
  const originalJobDistinct = CharacterMythicPlusFetchJob.distinct;
  const originalEnqueueProfileJobs = mythicPlusService.enqueueProfileJobs;

  t.after(() => {
    CharacterRaidParticipation.distinct = originalParticipationDistinct;
    CharacterMythicPlusSeasonScore.distinct = originalScoreDistinct;
    CharacterMythicPlusFetchJob.distinct = originalJobDistinct;
    mythicPlusService.enqueueProfileJobs = originalEnqueueProfileJobs;
  });

  CharacterRaidParticipation.distinct = (async () => [withScore, withJob, missing]) as unknown as typeof CharacterRaidParticipation.distinct;
  CharacterMythicPlusSeasonScore.distinct = (async () => [withScore]) as unknown as typeof CharacterMythicPlusSeasonScore.distinct;
  CharacterMythicPlusFetchJob.distinct = (async (_field: string, filter: Record<string, unknown>) => {
    assert.deepEqual(filter, {
      characterId: { $in: [withScore, withJob, missing] },
      jobType: "profile",
      season: null,
    });
    return [withJob];
  }) as unknown as typeof CharacterMythicPlusFetchJob.distinct;
  mythicPlusService.enqueueProfileJobs = (async (options: Parameters<typeof mythicPlusService.enqueueProfileJobs>[0]) => {
    assert.deepEqual(options, { characterIds: [String(missing)], targetSeasons: [], fetchSeasonProgress: false });
    return { candidates: 1, queued: 1, existing: 0 };
  }) as unknown as typeof mythicPlusService.enqueueProfileJobs;

  assert.deepEqual(await mythicPlusService.enqueueMissingProfileJobs(), { candidates: 1, queued: 1, existing: 0 });
});

test("failed Mythic+ retry resets only failed profile score jobs", async (t) => {
  const failed = new mongoose.Types.ObjectId();
  const originalJobDistinct = CharacterMythicPlusFetchJob.distinct;
  const originalEnqueueProfileJobs = mythicPlusService.enqueueProfileJobs;

  t.after(() => {
    CharacterMythicPlusFetchJob.distinct = originalJobDistinct;
    mythicPlusService.enqueueProfileJobs = originalEnqueueProfileJobs;
  });

  CharacterMythicPlusFetchJob.distinct = (async (_field: string, filter: Record<string, unknown>) => {
    assert.deepEqual(filter, {
      jobType: "profile",
      season: null,
      status: "failed",
    });
    return [failed];
  }) as unknown as typeof CharacterMythicPlusFetchJob.distinct;
  mythicPlusService.enqueueProfileJobs = (async (options: Parameters<typeof mythicPlusService.enqueueProfileJobs>[0]) => {
    assert.deepEqual(options, { characterIds: [String(failed)], refresh: true, targetSeasons: [], fetchSeasonProgress: false });
    return { candidates: 1, queued: 0, existing: 1 };
  }) as unknown as typeof mythicPlusService.enqueueProfileJobs;

  assert.deepEqual(await mythicPlusService.retryFailedProfileJobs(), { candidates: 1, queued: 0, existing: 1 });
});
