import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterMythicPlusDungeonRun from "../src/models/CharacterMythicPlusDungeonRun";
import CharacterMythicPlusSeasonScore from "../src/models/CharacterMythicPlusSeasonScore";
import { getMythicPlusLeaderboardCacheKey, isMythicPlusLeaderboardQueryCacheable } from "../src/routes/mythic-plus";
import mythicPlusService, { matchesMythicPlusLeaderboardSearch } from "../src/services/mythic-plus.service";

test("Mythic+ leaderboard caches stable views but not free-text searches", () => {
  const query = { season: "season-mn-1", bucket: "ALL", dungeonSort: "score", page: "1", limit: "50" } as any;
  const reorderedQuery = { limit: "50", page: "1", dungeonSort: "score", bucket: "all", season: "season-mn-1" } as any;

  assert.equal(isMythicPlusLeaderboardQueryCacheable(query), true);
  assert.equal(getMythicPlusLeaderboardCacheKey(query), getMythicPlusLeaderboardCacheKey(reorderedQuery));
  assert.equal(isMythicPlusLeaderboardQueryCacheable({ ...query, search: "Lääke-Stormreaver" } as any), false);
  assert.equal(isMythicPlusLeaderboardQueryCacheable({ ...query, characterName: "Lääke" } as any), false);
  assert.equal(isMythicPlusLeaderboardQueryCacheable({ ...query, guildName: "Taikaolennot" } as any), false);
  assert.equal(isMythicPlusLeaderboardQueryCacheable({ ...query, nocache: "true" } as any), false);
});

test("Mythic+ search folds accents and separators across character and guild identities", () => {
  assert.equal(matchesMythicPlusLeaderboardSearch({ name: "Röidy", realm: "Kazzak" }, "röi"), true);
  assert.equal(matchesMythicPlusLeaderboardSearch({ name: "Hammeroid", realm: "Stormreaver" }, "röi"), true);
  assert.equal(matchesMythicPlusLeaderboardSearch({ name: "Décallé", realm: "Hyjal", guildName: "Trois Viandes", guildRealm: "Hyjal" }, "röi"), true);
  assert.equal(matchesMythicPlusLeaderboardSearch({ name: "Lääke", realm: "Storm-Reaver" }, "laake stormreaver"), true);
  assert.equal(matchesMythicPlusLeaderboardSearch({ name: "Röidy", realm: "Kazzak" }, "roidx"), false);
  assert.equal(matchesMythicPlusLeaderboardSearch({ name: "Thor", realm: "Omen" }, "rö"), false);
  assert.equal(matchesMythicPlusLeaderboardSearch({ name: "Unrelated", realm: "Draenor" }, "röi"), false);
});

test("submitted Mythic+ search narrows leaderboard queries to exact character IDs", async (t) => {
  const service = mythicPlusService as any;
  const originalEligibleIds = service.getLeaderboardEligibleCharacterIds;
  const originalSearchIds = service.getLeaderboardSearchCharacterIds;
  const originalSeasonLeaderboard = service.getSeasonLeaderboard;
  const eligibleCharacterId = new mongoose.Types.ObjectId();
  const matchingCharacterId = new mongoose.Types.ObjectId();

  t.after(() => {
    service.getLeaderboardEligibleCharacterIds = originalEligibleIds;
    service.getLeaderboardSearchCharacterIds = originalSearchIds;
    service.getSeasonLeaderboard = originalSeasonLeaderboard;
  });

  service.getLeaderboardEligibleCharacterIds = async () => [eligibleCharacterId, matchingCharacterId];
  service.getLeaderboardSearchCharacterIds = async (eligibleIds: mongoose.Types.ObjectId[], query: string) => {
    assert.deepEqual(eligibleIds, [eligibleCharacterId, matchingCharacterId]);
    assert.equal(query, "röi");
    return [matchingCharacterId];
  };
  let seasonLeaderboardCalls = 0;
  service.getSeasonLeaderboard = async (options: Record<string, any>) => {
    seasonLeaderboardCalls += 1;
    assert.deepEqual(options.eligibleCharacterIds, [matchingCharacterId]);
    return {
      data: [],
      pagination: { totalItems: 0, totalRankedItems: 0, totalPages: 0, currentPage: 1, pageSize: 50 },
    };
  };

  await service.getLeaderboard({ season: "season-mn-1", bucket: "all", page: 1, limit: 50, search: "röi" });

  service.getLeaderboardSearchCharacterIds = async () => [];
  const emptyResponse = await service.getLeaderboard({ season: "season-mn-1", bucket: "all", page: 1, limit: 50, search: "missing" });
  assert.equal(seasonLeaderboardCalls, 1);
  assert.deepEqual(emptyResponse.data, []);
  assert.equal(emptyResponse.pagination.totalItems, 0);
});

test("Mythic+ search index loads eligible identities once and reuses normalized values", async (t) => {
  const service = mythicPlusService as any;
  const characterModel = Character as any;
  const originalFind = characterModel.find;
  const originalCache = service.leaderboardSearchIndexCache;
  const originalPromise = service.leaderboardSearchIndexPromise;
  const originalEligibilityVersion = service.leaderboardEligibilityVersion;
  const röidyId = new mongoose.Types.ObjectId();
  const lääkeId = new mongoose.Types.ObjectId();
  const newRöiId = new mongoose.Types.ObjectId();
  const eligibleIds = [röidyId, lääkeId];
  let findCalls = 0;

  t.after(() => {
    characterModel.find = originalFind;
    service.leaderboardSearchIndexCache = originalCache;
    service.leaderboardSearchIndexPromise = originalPromise;
    service.leaderboardEligibilityVersion = originalEligibilityVersion;
  });

  service.leaderboardSearchIndexCache = null;
  service.leaderboardSearchIndexPromise = null;
  characterModel.find = (filter: Record<string, any>) => {
    findCalls += 1;
    const requestedIds = filter._id.$in;
    if (findCalls === 1) assert.deepEqual(requestedIds, eligibleIds);
    else assert.deepEqual(requestedIds, [newRöiId]);
    return {
      select() {
        return this;
      },
      lean: async () => findCalls === 1
        ? [
            { _id: röidyId, name: "Röidy", realm: "Kazzak", guildName: "Tuju", guildRealm: "Kazzak" },
            { _id: lääkeId, name: "Lääke", realm: "Storm-Reaver", guildName: "Taikaolennot", guildRealm: "Storm-Reaver" },
          ]
        : [{ _id: newRöiId, name: "Röimir", realm: "Draenor", guildName: "New Guild", guildRealm: "Draenor" }],
    };
  };

  const [röiMatches, lääkeMatches] = await Promise.all([
    service.getLeaderboardSearchCharacterIds(eligibleIds, "röi"),
    service.getLeaderboardSearchCharacterIds(eligibleIds, "laake-stormreaver"),
  ]);
  const cachedMatches = await service.getLeaderboardSearchCharacterIds(eligibleIds, "taika olennot");
  const removedEligibilityMatches = await service.getLeaderboardSearchCharacterIds([lääkeId], "röi");
  service.leaderboardEligibilityVersion += 1;
  const refreshedEligibilityMatches = await service.getLeaderboardSearchCharacterIds([newRöiId], "röi");

  assert.equal(findCalls, 2);
  assert.deepEqual(röiMatches, [röidyId]);
  assert.deepEqual(lääkeMatches, [lääkeId]);
  assert.deepEqual(cachedMatches, [lääkeId]);
  assert.deepEqual(removedEligibilityMatches, []);
  assert.deepEqual(refreshedEligibilityMatches, [newRöiId]);
});

test("stored score leaderboards use direct indexed sorting and compact projections", async (t) => {
  const scoreModel = CharacterMythicPlusSeasonScore as any;
  const runModel = CharacterMythicPlusDungeonRun as any;
  const originalScoreFind = scoreModel.find;
  const originalScoreCount = scoreModel.countDocuments;
  const originalRunFind = runModel.find;
  const characterId = new mongoose.Types.ObjectId();
  let scoreMatch: Record<string, any> = {};
  let scoreSort: Record<string, any> = {};
  let scoreProjection: Record<string, any> = {};
  let runProjection = "";

  t.after(() => {
    scoreModel.find = originalScoreFind;
    scoreModel.countDocuments = originalScoreCount;
    runModel.find = originalRunFind;
  });

  scoreModel.countDocuments = async () => 1;
  scoreModel.find = (match: Record<string, any>) => {
    scoreMatch = match;
    const query = {
      sort(value: Record<string, any>) {
        scoreSort = value;
        return query;
      },
      skip() {
        return query;
      },
      limit() {
        return query;
      },
      select(value: Record<string, any>) {
        scoreProjection = value;
        return query;
      },
      lean: async () => [
        {
          characterId,
          wclCanonicalCharacterId: 123,
          name: "Lääke",
          realm: "stormreaver",
          region: "eu",
          classID: 6,
          guildName: "Taikaolennot",
          guildRealm: "stormreaver",
          season: "season-mn-1",
          scores: { all: 3210 },
          bestSpecName: "Frost",
          bestSpecSlug: "frost",
          bestSpecScore: 3210,
        },
      ],
    };
    return query;
  };
  runModel.find = () => {
    const query = {
      select(value: string) {
        runProjection = value;
        return query;
      },
      lean: async () => [{ characterId, raiderIoDungeonId: 42, mythicLevel: 12, score: 178.4 }],
    };
    return query;
  };

  const response = await (mythicPlusService as any).getSeasonLeaderboard({
    season: "season-mn-1",
    bucket: "all",
    pageSize: 50,
    currentPage: 1,
    skip: 0,
    eligibleCharacterIds: [characterId],
  });

  assert.deepEqual(scoreMatch.characterId.$in, [characterId]);
  assert.equal(scoreMatch.$or, undefined);
  assert.deepEqual(scoreSort, { "scores.all": -1, name: 1 });
  assert.equal(scoreProjection.rawSeason, undefined);
  assert.equal(scoreProjection["scores.all"], 1);
  assert.equal(runProjection.includes("rawRun"), false);
  assert.equal(response.data[0].score.value, 3210);
  assert.deepEqual(response.data[0].dungeonRuns, [{ dungeonId: 42, mythicLevel: 12, score: 178.4 }]);
  assert.equal("scores" in response.data[0], false);
});
