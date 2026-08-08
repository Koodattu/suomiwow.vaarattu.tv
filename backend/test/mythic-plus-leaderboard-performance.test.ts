import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CharacterMythicPlusDungeonRun from "../src/models/CharacterMythicPlusDungeonRun";
import CharacterMythicPlusSeasonScore from "../src/models/CharacterMythicPlusSeasonScore";
import { getMythicPlusLeaderboardCacheKey, isMythicPlusLeaderboardQueryCacheable } from "../src/routes/mythic-plus";
import mythicPlusService from "../src/services/mythic-plus.service";

test("Mythic+ leaderboard caches stable views but not free-text searches", () => {
  const query = { season: "season-mn-1", bucket: "ALL", dungeonSort: "score", page: "1", limit: "50" } as any;
  const reorderedQuery = { limit: "50", page: "1", dungeonSort: "score", bucket: "all", season: "season-mn-1" } as any;

  assert.equal(isMythicPlusLeaderboardQueryCacheable(query), true);
  assert.equal(getMythicPlusLeaderboardCacheKey(query), getMythicPlusLeaderboardCacheKey(reorderedQuery));
  assert.equal(isMythicPlusLeaderboardQueryCacheable({ ...query, characterName: "Lääke" } as any), false);
  assert.equal(isMythicPlusLeaderboardQueryCacheable({ ...query, guildName: "Taikaolennot" } as any), false);
  assert.equal(isMythicPlusLeaderboardQueryCacheable({ ...query, nocache: "true" } as any), false);
});

test("stored score leaderboards use direct indexed sorting, exact selected identities, and compact projections", async (t) => {
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
    characterName: "Lääke",
    characterRealm: "stormreaver",
  });

  assert.equal(scoreMatch.name, "Lääke");
  assert.equal(scoreMatch.realm, "stormreaver");
  assert.deepEqual(scoreSort, { "scores.all": -1, name: 1 });
  assert.equal(scoreProjection.rawSeason, undefined);
  assert.equal(scoreProjection["scores.all"], 1);
  assert.equal(runProjection.includes("rawRun"), false);
  assert.equal(response.data[0].score.value, 3210);
  assert.deepEqual(response.data[0].dungeonRuns, [{ dungeonId: 42, mythicLevel: 12, score: 178.4 }]);
  assert.equal("scores" in response.data[0], false);
});
