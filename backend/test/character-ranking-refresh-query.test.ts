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
import sift from "sift";

test("nightly refresh recovers active report imports, honors cooldowns, and stays scoped across batches", async (t) => {
  const now = Date.now();
  const due = new Date(now - 1000);
  const inactive = new Date("2100-01-01T00:00:00.000Z");
  const characters = [
    { name: "Imported", lastMythicSeenAt: null, rankingsAvailable: null, nextEligibleRefreshAt: inactive },
    { name: "Returning", lastMythicSeenAt: new Date(0), rankingsAvailable: true, nextEligibleRefreshAt: due },
    { name: "Retry", rankingsAvailable: false, nextEligibleRefreshAt: due },
    { name: "Unscheduled", rankingsAvailable: null },
    { name: "Regular", lastMythicSeenAt: new Date(now), rankingsAvailable: true, nextEligibleRefreshAt: due },
    { name: "CoolingDown", nextEligibleRefreshAt: new Date(now + 3600000) },
    { name: "Hidden", wclProfileHidden: true, nextEligibleRefreshAt: due },
    { name: "Historical", lastMythicSeenAt: new Date(now), nextEligibleRefreshAt: due },
    { name: "HeroicOnly", lastMythicSeenAt: new Date(now), nextEligibleRefreshAt: due },
    { name: "OtherRaid", lastMythicSeenAt: new Date(now), nextEligibleRefreshAt: due },
  ].map((row, index) => ({ _id: new mongoose.Types.ObjectId(), classID: 8, realm: "tarren-mill", region: "eu", wclCanonicalCharacterId: index + 1, ...row }));
  const participation = characters.map((c) => ({
    characterId: c._id,
    zoneId: c.name === "OtherRaid" ? 46 : 53,
    mythicReportCount: c.name === "HeroicOnly" ? 0 : 3,
    lastSeenAt: c.name === "Historical" ? new Date(0) : new Date(now),
  }));
  const requestedNames: string[] = [];
  let batches = 0;
  // sift is Mongoose's existing MongoDB-query evaluator; evaluate the actual service
  // filters against fixtures rather than returning characters regardless of eligibility.
  t.mock.method(CharacterRaidParticipation, "distinct", async (_field: string, filter: any) => participation.filter(sift(filter)).map((p) => p.characterId));
  t.mock.method(Raid, "findOne", () => ({ select: () => ({ lean: async () => ({ partitions: [{ id: 1 }] }) }) }) as any);
  t.mock.method(Character, "countDocuments", async (filter: any) => characters.filter(sift(filter)).length);
  t.mock.method(Character, "aggregate", (async (pipeline: any[]) => {
    batches += 1;
    return characters.filter(sift(pipeline[0].$match)).slice(0, 2);
  }) as any);
  t.mock.method(Character, "findByIdAndUpdate", (async () => ({})) as any);
  t.mock.method(Ranking, "find", () => ({ lean: async () => [] }) as any);
  t.mock.method(Ranking, "deleteMany", (async () => ({ deletedCount: 0 })) as any);
  t.mock.method(rateLimitService, "getPercentUsed", () => 0);
  t.mock.method(wclService, "query", (async (_query: string, variables: any) => {
    requestedNames.push(variables.characterName);
    return { characterData: { character: { hidden: false } } };
  }) as any);

  await characterService.checkAndRefreshCharacterRankings();

  assert.deepEqual(requestedNames, ["Imported", "Returning", "Retry", "Unscheduled", "Regular"]);
  assert.equal(batches, 3);
});

test("nightly ranking refresh queries all specs for every partition and only recent raid participants", async () => {
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
            assassinationRankingsPartition1: { allStars: [], rankings: [ranking] },
            assassinationRankingsPartition2: { allStars: [], rankings: [ranking] },
            outlawRankingsPartition1: { allStars: [], rankings: [] },
            outlawRankingsPartition2: { allStars: [], rankings: [] },
            subtletyRankingsPartition1: { allStars: [], rankings: [] },
            subtletyRankingsPartition2: { allStars: [], rankings: [] },
          },
        },
      };
    };

    await characterService.checkAndRefreshCharacterRankings();

    assert.equal((participationFilter as any)?.zoneId, 53);
    assert.deepEqual((participationFilter as any)?.mythicReportCount, { $gt: 0 });
    assert.ok((participationFilter as any)?.lastSeenAt?.$gte instanceof Date);
    assert.match(capturedQuery, /assassinationRankingsPartition1: zoneRankings\([^\n]+partition: 1, specName: "Assassination"\)/);
    assert.match(capturedQuery, /assassinationRankingsPartition2: zoneRankings\([^\n]+partition: 2, specName: "Assassination"\)/);
    assert.match(capturedQuery, /outlawRankingsPartition1: zoneRankings\([^\n]+partition: 1, specName: "Outlaw"\)/);
    assert.match(capturedQuery, /subtletyRankingsPartition2: zoneRankings\([^\n]+partition: 2, specName: "Subtlety"\)/);
    assert.deepEqual(capturedTracking, { estimatedPoints: 31, sampleRateLimit: true });
    assert.equal(deleteFilters.filter((filter) => filter.metric === "dps" && filter["encounter.id"]?.$nin).length, 2);
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
