import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterMythicPlusSeasonScore from "../src/models/CharacterMythicPlusSeasonScore";
import mythicPlusService from "../src/services/mythic-plus.service";

test("current-season refresh uses recent eligible participation despite stale character activity", async (t) => {
  const service = mythicPlusService as any;
  const hidden = new mongoose.Types.ObjectId();
  const imported = new mongoose.Types.ObjectId();
  const older = new mongoose.Types.ObjectId();
  const fresh = new mongoose.Types.ObjectId();
  const now = new Date();
  const original = {
    aggregate: CharacterRaidParticipation.aggregate,
    find: Character.find,
    scores: CharacterMythicPlusSeasonScore.find,
    season: service.getCurrentSeasonSlug,
    enqueue: service.enqueueProfileJobs,
    detail: service.enqueueSeasonProgressJobsForCharacters,
  };
  t.after(() => {
    CharacterRaidParticipation.aggregate = original.aggregate;
    Character.find = original.find;
    CharacterMythicPlusSeasonScore.find = original.scores;
    service.getCurrentSeasonSlug = original.season;
    service.enqueueProfileJobs = original.enqueue;
    service.enqueueSeasonProgressJobsForCharacters = original.detail;
  });
  service.getCurrentSeasonSlug = async () => "season-mn-2";
  CharacterRaidParticipation.aggregate = (async (pipeline: any[]) => {
    assert.equal(pipeline[0].$match.reportCount.$gte, 2);
    assert.ok(pipeline[0].$match.lastSeenAt.$gte instanceof Date);
    assert.equal(pipeline[0].$match.characterId.$ne, null);
    assert.deepEqual(pipeline[1], { $group: { _id: "$characterId", lastSeenAt: { $max: "$lastSeenAt" } } });
    assert.deepEqual(pipeline[2], { $sort: { lastSeenAt: -1, _id: 1 } });
    return [hidden, imported, fresh, older].map((_id) => ({ _id, lastSeenAt: now }));
  }) as any;
  Character.find = ((filter: any) => {
    assert.deepEqual(filter, { _id: { $in: [hidden, imported, fresh, older] }, wclProfileHidden: { $ne: true } });
    // Deliberately return out of activity order; hidden characters must not consume the limit.
    return { select: () => ({ lean: async () => [
      { _id: older, lastMythicSeenAt: now },
      { _id: fresh, lastMythicSeenAt: now },
      { _id: imported, lastMythicSeenAt: null },
    ] }) };
  }) as any;
  CharacterMythicPlusSeasonScore.find = ((filter: any) => {
    assert.deepEqual(filter.characterId.$in, [imported, fresh, older]);
    assert.equal(filter.season, "season-mn-2");
    assert.deepEqual(filter.identityStatus, { $ne: "stale" });
    return { select: () => ({ lean: async () => [
      { characterId: fresh, fetchedAt: now, scores: { all: 0 } },
      { characterId: older, fetchedAt: new Date(now.getTime() - 2 * 86400000), scores: { all: 0 } },
    ] }) };
  }) as any;
  service.enqueueProfileJobs = async (options: any) => {
    assert.deepEqual(options, { characterIds: [String(imported), String(older)], refresh: true, targetSeasons: ["season-mn-2"] });
    return { candidates: 2, queued: 0, existing: 2 };
  };
  service.enqueueSeasonProgressJobsForCharacters = async (characters: any[]) => {
    assert.deepEqual(characters, []);
    return 0;
  };
  const result = await service.enqueueCurrentSeasonRefreshJobs({ characterLimit: 2 });
  assert.equal(result.candidates, 2);
  assert.equal(result.profileJobs.candidates, 2);
});
