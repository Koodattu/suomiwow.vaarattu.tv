import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterMythicPlusDungeonRun from "../src/models/CharacterMythicPlusDungeonRun";
import CharacterMythicPlusFetchJob from "../src/models/CharacterMythicPlusFetchJob";
import CharacterMythicPlusSeasonScore from "../src/models/CharacterMythicPlusSeasonScore";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import cacheService from "../src/services/cache.service";
import mythicPlusService from "../src/services/mythic-plus.service";

test("missing Mythic+ profile jobs exclude tracked jobs and reopen eligibility-skipped jobs", async (t) => {
  const withScore = new mongoose.Types.ObjectId();
  const withJob = new mongoose.Types.ObjectId();
  const skipped = new mongoose.Types.ObjectId();
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

  CharacterRaidParticipation.distinct = (async () => [withScore, withJob, skipped, missing]) as unknown as typeof CharacterRaidParticipation.distinct;
  CharacterMythicPlusSeasonScore.distinct = (async () => [withScore]) as unknown as typeof CharacterMythicPlusSeasonScore.distinct;
  CharacterMythicPlusFetchJob.distinct = (async (_field: string, filter: Record<string, unknown>) => {
    assert.deepEqual(filter, {
      characterId: { $in: [withScore, withJob, skipped, missing] },
      jobType: "profile",
      season: null,
      status: { $ne: "skipped" },
    });
    return [withJob];
  }) as unknown as typeof CharacterMythicPlusFetchJob.distinct;
  mythicPlusService.enqueueProfileJobs = (async (options: Parameters<typeof mythicPlusService.enqueueProfileJobs>[0]) => {
    assert.deepEqual(options, { characterIds: [String(skipped), String(missing)], refresh: true, targetSeasons: [], fetchSeasonProgress: false });
    return { candidates: 2, queued: 1, existing: 1 };
  }) as unknown as typeof mythicPlusService.enqueueProfileJobs;

  assert.deepEqual(await mythicPlusService.enqueueMissingProfileJobs(), { candidates: 2, queued: 1, existing: 1 });
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

test("claimed Mythic+ jobs refresh their identity from the active Blizzard override", async (t) => {
  const characterId = new mongoose.Types.ObjectId();
  const jobId = new mongoose.Types.ObjectId();
  const characterModel = Character as any;
  const jobModel = CharacterMythicPlusFetchJob as any;
  const originalCharacterFindById = characterModel.findById;
  const originalJobFindByIdAndUpdate = jobModel.findByIdAndUpdate;
  let savedUpdate: Record<string, any> | null = null;

  t.after(() => {
    characterModel.findById = originalCharacterFindById;
    jobModel.findByIdAndUpdate = originalJobFindByIdAndUpdate;
  });

  characterModel.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: characterId,
        wclCanonicalCharacterId: 123,
        name: "Holyjamal",
        realm: "stormreaver",
        region: "eu",
        classID: 2,
        guildName: "Kultzipuppelit",
        guildRealm: "stormreaver",
        identityObservedAt: new Date("2026-06-01T00:00:00.000Z"),
        blizzardIdentityOverride: {
          name: "Pulladiini",
          realm: "tarren-mill",
          updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        },
      }),
    }),
  });
  jobModel.findByIdAndUpdate = async (_id: mongoose.Types.ObjectId, update: Record<string, any>) => {
    assert.equal(String(_id), String(jobId));
    savedUpdate = update;
  };
  const job: any = {
    _id: jobId,
    characterId,
    wclCanonicalCharacterId: 123,
    name: "Holyjamal",
    realm: "stormreaver",
    region: "eu",
    classID: 2,
    guildName: "Kultzipuppelit",
    guildRealm: "stormreaver",
  };

  const resolved = await (mythicPlusService as any).refreshJobCharacterIdentity(job);

  assert.equal(resolved.name, "Pulladiini");
  assert.equal(resolved.realm, "tarren-mill");
  assert.equal(job.name, "Pulladiini");
  assert.equal(job.realm, "tarren-mill");
  assert.equal((savedUpdate as any)?.$set.name, "Pulladiini");
});

test("Mythic+ job completion cannot overwrite a requeued identity", async (t) => {
  const jobModel = CharacterMythicPlusFetchJob as any;
  const originalFindOneAndUpdate = jobModel.findOneAndUpdate;
  let completionFilter: Record<string, any> | null = null;

  t.after(() => {
    jobModel.findOneAndUpdate = originalFindOneAndUpdate;
  });

  jobModel.findOneAndUpdate = async (filter: Record<string, any>) => {
    completionFilter = filter;
    return null;
  };
  const job: any = {
    _id: new mongoose.Types.ObjectId(),
    name: "Maisie",
    realm: "tarren-mill",
    region: "eu",
    classID: 6,
  };

  await (mythicPlusService as any).markJob(job, "completed");

  assert.deepEqual(completionFilter, {
    _id: job._id,
    status: "in_progress",
    name: "Maisie",
    realm: "tarren-mill",
    region: "eu",
    classID: 6,
  });
});

test("Mythic+ identity repair quarantines stale scores and queues the resolved identity", async (t) => {
  const characterId = new mongoose.Types.ObjectId();
  const characterModel = Character as any;
  const jobModel = CharacterMythicPlusFetchJob as any;
  const scoreModel = CharacterMythicPlusSeasonScore as any;
  const runModel = CharacterMythicPlusDungeonRun as any;
  const originalCharacterFind = characterModel.find;
  const originalJobAggregate = jobModel.aggregate;
  const originalJobBulkWrite = jobModel.bulkWrite;
  const originalScoreAggregate = scoreModel.aggregate;
  const originalScoreUpdateMany = scoreModel.updateMany;
  const originalRunAggregate = runModel.aggregate;
  const originalRunUpdateMany = runModel.updateMany;
  const originalEnqueueProfileJobs = mythicPlusService.enqueueProfileJobs;
  const originalGetStartedMainSeasonSlugs = mythicPlusService.getStartedMainSeasonSlugs;
  const originalInvalidatePattern = cacheService.invalidatePattern;
  let scoreUpdate: { filter: Record<string, unknown>; update: Record<string, unknown> } | null = null;
  let jobOperations: any[] = [];
  let enqueueOptions: Parameters<typeof mythicPlusService.enqueueProfileJobs>[0] | null = null;

  t.after(() => {
    characterModel.find = originalCharacterFind;
    jobModel.aggregate = originalJobAggregate;
    jobModel.bulkWrite = originalJobBulkWrite;
    scoreModel.aggregate = originalScoreAggregate;
    scoreModel.updateMany = originalScoreUpdateMany;
    runModel.aggregate = originalRunAggregate;
    runModel.updateMany = originalRunUpdateMany;
    mythicPlusService.enqueueProfileJobs = originalEnqueueProfileJobs;
    mythicPlusService.getStartedMainSeasonSlugs = originalGetStartedMainSeasonSlugs;
    cacheService.invalidatePattern = originalInvalidatePattern;
  });

  const staleIdentity = { name: "Maisie", realm: "tarren-mill", region: "eu", classID: 6 };
  jobModel.aggregate = async () => [{ _id: characterId, identities: [staleIdentity] }];
  scoreModel.aggregate = async () => [{ _id: characterId, identities: [staleIdentity] }];
  runModel.aggregate = async () => [];
  characterModel.find = () => ({
    select: () => ({
      lean: async () => [
        {
          _id: characterId,
          wclCanonicalCharacterId: 56487347,
          name: "Maisié",
          realm: "stormreaver",
          region: "eu",
          classID: 6,
          guildName: "Kultzipuppelit",
          guildRealm: "stormreaver",
          identityObservedAt: new Date("2026-06-02T14:46:41.665Z"),
        },
      ],
    }),
  });
  scoreModel.updateMany = async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    scoreUpdate = { filter, update };
    return { modifiedCount: 20 };
  };
  runModel.updateMany = async () => ({ modifiedCount: 0 });
  jobModel.bulkWrite = async (operations: any[]) => {
    jobOperations = operations;
    return { modifiedCount: 1 };
  };
  mythicPlusService.getStartedMainSeasonSlugs = async () => ["season-mn-1", "season-tww-3"];
  mythicPlusService.enqueueProfileJobs = (async (options: Parameters<typeof mythicPlusService.enqueueProfileJobs>[0]) => {
    enqueueOptions = options;
    return { candidates: 1, queued: 0, existing: 1 };
  }) as typeof mythicPlusService.enqueueProfileJobs;
  cacheService.invalidatePattern = async () => undefined;

  const result = await mythicPlusService.reconcileCharacterIdentities({ characterIds: [characterId], limit: 1 });

  assert.deepEqual(result, {
    scannedCharacters: 1,
    identityDriftCandidates: 1,
    processedCharacters: 1,
    jobsSynchronized: 1,
    staleScoreRows: 20,
    staleDungeonRuns: 0,
    queued: 1,
  });
  assert.deepEqual((scoreUpdate as any)?.update, { $set: { identityStatus: "stale" } });
  assert.deepEqual((scoreUpdate as any)?.filter, {
    identityStatus: { $ne: "stale" },
    $or: [{ characterId, ...staleIdentity }],
  });
  assert.equal(jobOperations[0].updateMany.update.$set.name, "Maisié");
  assert.equal(jobOperations[0].updateMany.update.$set.realm, "stormreaver");
  assert.deepEqual(enqueueOptions, {
    characterIds: [String(characterId)],
    refresh: true,
    targetSeasons: ["season-mn-1", "season-tww-3"],
    fetchSeasonProgress: false,
  });
});
