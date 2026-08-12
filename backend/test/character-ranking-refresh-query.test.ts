/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import Raid from "../src/models/Raid";
import Ranking from "../src/models/Ranking";
import characterService from "../src/services/character.service";
import rateLimitService from "../src/services/rate-limit.service";
import wclService from "../src/services/warcraftlogs.service";

test("nightly ranking refresh queries only recent participants with one all-spec DPS alias per partition", async () => {
  const characterId = new mongoose.Types.ObjectId();
  const characterModel = Character as any;
  const participationModel = CharacterRaidParticipation as any;
  const raidModel = Raid as any;
  const rankingModel = Ranking as any;
  const rateLimit = rateLimitService as any;
  const wcl = wclService as any;
  const originals = {
    raidFindOne: raidModel.findOne,
    participationDistinct: participationModel.distinct,
    characterCountDocuments: characterModel.countDocuments,
    characterAggregate: characterModel.aggregate,
    characterFindByIdAndUpdate: characterModel.findByIdAndUpdate,
    rankingFind: rankingModel.find,
    rankingFindOneAndUpdate: rankingModel.findOneAndUpdate,
    rankingDeleteMany: rankingModel.deleteMany,
    getPercentUsed: rateLimit.getPercentUsed,
    query: wcl.query,
  };
  let participationFilter: Record<string, any> | null = null;
  let aggregateCalls = 0;
  let capturedQuery = "";
  let capturedTracking: Record<string, unknown> | null = null;
  const deleteFilters: Array<Record<string, any>> = [];

  try {
    raidModel.findOne = () => ({
      select: () => ({
        lean: async () => ({ partitions: [{ id: 1 }, { id: 2 }] }),
      }),
    });
    participationModel.distinct = async (_field: string, filter: Record<string, any>) => {
      participationFilter = filter;
      return [characterId];
    };
    characterModel.countDocuments = async () => 1;
    characterModel.aggregate = async () => {
      aggregateCalls += 1;
      return aggregateCalls === 1
        ? [{
            _id: characterId,
            wclCanonicalCharacterId: 12345,
            name: "Testrogue",
            realm: "stormreaver",
            region: "eu",
            classID: 8,
          }]
        : [];
    };
    characterModel.findByIdAndUpdate = async () => ({ acknowledged: true });
    rankingModel.find = () => ({ lean: async () => [] });
    rankingModel.findOneAndUpdate = async () => ({ _id: new mongoose.Types.ObjectId() });
    rankingModel.deleteMany = async (filter: Record<string, any>) => {
      deleteFilters.push(filter);
      return { deletedCount: 0 };
    };
    rateLimit.getPercentUsed = () => 0;
    wcl.query = async (query: string, _variables: Record<string, unknown>, _retry: boolean, _retries: number, tracking: Record<string, unknown>) => {
      capturedQuery = query;
      capturedTracking = tracking;
      const ranking = {
        encounter: { id: 1, name: "Test Boss" },
        rankPercent: 95,
        medianPercent: 90,
        lockedIn: true,
        totalKills: 2,
        allStars: { points: 100, possiblePoints: 110 },
        spec: "Assassination",
        bestSpec: "Assassination",
        bestAmount: 1000,
        bestRank: { ilvl: 700 },
      };
      return {
        characterData: {
          character: {
            id: 12345,
            canonicalID: 12345,
            name: "Testrogue",
            classID: 8,
            hidden: false,
            allSpecsDpsRankingsPartition1: { allStars: [], rankings: [ranking] },
            allSpecsDpsRankingsPartition2: { allStars: [], rankings: [ranking] },
          },
        },
      };
    };

    await characterService.checkAndRefreshCharacterRankings();

    assert.equal((participationFilter as any)?.zoneId, 46);
    assert.deepEqual((participationFilter as any)?.mythicReportCount, { $gt: 0 });
    assert.ok((participationFilter as any)?.lastSeenAt?.$gte instanceof Date);
    assert.match(capturedQuery, /allSpecsDpsRankingsPartition1: zoneRankings\([^\n]+partition: 1\)/);
    assert.match(capturedQuery, /allSpecsDpsRankingsPartition2: zoneRankings\([^\n]+partition: 2\)/);
    assert.doesNotMatch(capturedQuery, /specName:/);
    assert.deepEqual(capturedTracking, { estimatedPoints: 11, sampleRateLimit: true });
    assert.equal(deleteFilters.filter((filter) => filter.metric === "dps" && filter.$nor).length, 2);
  } finally {
    raidModel.findOne = originals.raidFindOne;
    participationModel.distinct = originals.participationDistinct;
    characterModel.countDocuments = originals.characterCountDocuments;
    characterModel.aggregate = originals.characterAggregate;
    characterModel.findByIdAndUpdate = originals.characterFindByIdAndUpdate;
    rankingModel.find = originals.rankingFind;
    rankingModel.findOneAndUpdate = originals.rankingFindOneAndUpdate;
    rankingModel.deleteMany = originals.rankingDeleteMany;
    rateLimit.getPercentUsed = originals.getPercentUsed;
    wcl.query = originals.query;
  }
});
