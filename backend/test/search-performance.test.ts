/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import Guild from "../src/models/Guild";
import characterService from "../src/services/character.service";
import searchService from "../src/services/search.service";

test("current-character search avoids the historical participation aggregation", async () => {
  const characterModel = Character as any;
  const service = characterService as any;
  const originalFind = characterModel.find;
  const overrideUpdatedAt = new Date("2026-08-01T12:00:00.000Z");
  const queries: Record<string, any>[] = [];
  let requestedLimit = 0;

  try {
    characterModel.find = (value: Record<string, any>) => {
      queries.push(value);
      return {
        sort() { return this; },
        limit(value: number) { requestedLimit = value; return this; },
        select() { return this; },
        lean: async () => [{
          _id: new mongoose.Types.ObjectId(),
          wclCanonicalCharacterId: 123,
          name: "Currentname",
          realm: "stormreaver",
          region: "eu",
          classID: 8,
          guildName: "Current Guild",
          guildRealm: "stormreaver",
          lastReportSeenAt: overrideUpdatedAt,
          blizzardIdentityOverride: {
            name: "Oldname",
            realm: "tarren-mill",
            updatedAt: overrideUpdatedAt,
            updatedBy: "admin",
          },
        }],
      };
    };

    const results = await service.searchCurrentCharacters("oldname", 5);

    assert.equal(requestedLimit, 5);
    assert.equal(Array.isArray(queries[0]?.$or), true);
    assert.equal(results[0].name, "Currentname");
    assert.equal(results[0].realm, "stormreaver");
    assert.equal(results[0].matchedName, "Oldname");
    assert.equal(results[0].matchedRealm, "tarren-mill");
    assert.deepEqual(results[0].guild, { name: "Current Guild", realm: "stormreaver" });
  } finally {
    characterModel.find = originalFind;
  }
});

test("historical character search limits candidates before current-identity lookups", async () => {
  const participationModel = CharacterRaidParticipation as any;
  const originalAggregate = participationModel.aggregate;
  let pipeline: Array<Record<string, any>> = [];
  let aggregateOptions: Record<string, any> = {};

  try {
    participationModel.aggregate = (value: Array<Record<string, any>>) => {
      pipeline = value;
      return {
        option(value: Record<string, any>) {
          aggregateOptions = value;
          return Promise.resolve([]);
        },
      };
    };

    await characterService.searchCharacters("ka", 5);

    const groupIndex = pipeline.findIndex((stage) => stage.$group);
    const lookupIndex = pipeline.findIndex((stage) => stage.$lookup);
    const candidateLimitIndex = pipeline.findIndex((stage, index) => index > groupIndex && index < lookupIndex && stage.$limit);
    assert.ok(groupIndex >= 0 && candidateLimitIndex > groupIndex && lookupIndex > candidateLimitIndex);
    assert.equal(pipeline[candidateLimitIndex].$limit, 50);
    assert.deepEqual(aggregateOptions, { maxTimeMS: 5_000 });
  } finally {
    participationModel.aggregate = originalAggregate;
  }
});

test("exact historical search uses accent-insensitive indexed equality and deduplicates raid rows", async () => {
  const participationModel = CharacterRaidParticipation as any;
  const originalFind = participationModel.find;
  const canonicalId = 16028126;
  let query: Record<string, unknown> = {};
  let collation: Record<string, unknown> = {};
  let requestedLimit = 0;

  try {
    participationModel.find = (value: Record<string, unknown>) => {
      query = value;
      return {
        collation(value: Record<string, unknown>) { collation = value; return this; },
        sort() { return this; },
        limit(value: number) { requestedLimit = value; return this; },
        select() { return this; },
        lean: async () => [
          {
            wclCanonicalCharacterId: canonicalId,
            characterName: "Lääke",
            characterRealm: "outland",
            characterRegion: "eu",
            classID: 6,
            reportGuildName: "Taikaolennot",
            reportGuildRealm: "Outland",
            lastSeenAt: new Date("2016-12-04T18:04:56.995Z"),
          },
          {
            wclCanonicalCharacterId: canonicalId,
            characterName: "Lääke",
            characterRealm: "outland",
            characterRegion: "eu",
            classID: 6,
            reportGuildName: "Taikaolennot",
            reportGuildRealm: "Outland",
            lastSeenAt: new Date("2016-10-19T18:04:56.995Z"),
          },
        ],
      };
    };

    const results = await characterService.searchExactHistoricalCharacters("laake", 5);

    assert.deepEqual(query, { characterName: "laake" });
    assert.deepEqual(collation, { locale: "en", strength: 1 });
    assert.equal(requestedLimit, 50);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Lääke");
    assert.equal(results[0].realm, "outland");
  } finally {
    participationModel.find = originalFind;
  }
});

test("site search ranks an accent-equivalent historical exact match ahead of current partial matches", async () => {
  const guildModel = Guild as any;
  const currentSearch = (characterService as any).searchCurrentCharacters;
  const historicalSearch = (characterService as any).searchCharacters;
  const exactHistoricalSearch = (characterService as any).searchExactHistoricalCharacters;
  const service = searchService as any;
  const originalGuildFind = guildModel.find;
  const originalCache = service.siteSearchCache;
  const originalPromises = service.siteSearchPromises;
  let currentSearchCalls = 0;

  try {
    service.siteSearchCache = new Map();
    service.siteSearchPromises = new Map();
    guildModel.find = () => ({
      collation() { return this; },
      sort() { return this; },
      limit() { return this; },
      select() { return this; },
      lean: async () => [],
    });
    (characterService as any).searchCurrentCharacters = async () => {
      currentSearchCalls += 1;
      return [{
        wclCanonicalCharacterId: 123,
        name: "Astmalääke",
        realm: "stormreaver",
        region: "eu",
        classID: 9,
        guild: null,
      }];
    };
    (characterService as any).searchExactHistoricalCharacters = async () => [{
      wclCanonicalCharacterId: 16028126,
      name: "Lääke",
      realm: "outland",
      region: "eu",
      classID: 6,
      guild: { name: "Taikaolennot", realm: "Outland" },
      lastReportSeenAt: new Date("2016-12-04T18:04:56.995Z"),
    }];
    (characterService as any).searchCharacters = async () => {
      throw new Error("current matches should skip historical search");
    };

    const [first, second] = await Promise.all([
      service.searchSite("laake", 5),
      service.searchSite("Lääke", 5),
    ]);
    const cached = await service.searchSite("laake", 5);

    assert.equal(currentSearchCalls, 1);
    assert.deepEqual(second, first);
    assert.deepEqual(cached, first);
    assert.equal(first[0].name, "Lääke");
    assert.equal(first[0].href, "/characters/outland/L%C3%A4%C3%A4ke");
  } finally {
    guildModel.find = originalGuildFind;
    (characterService as any).searchCurrentCharacters = currentSearch;
    (characterService as any).searchCharacters = historicalSearch;
    (characterService as any).searchExactHistoricalCharacters = exactHistoricalSearch;
    service.siteSearchCache = originalCache;
    service.siteSearchPromises = originalPromises;
  }
});

test("two-letter full search uses current prefixes and skips broad historical aggregation", async () => {
  const guildModel = Guild as any;
  const currentSearch = (characterService as any).searchCurrentCharacters;
  const historicalSearch = (characterService as any).searchCharacters;
  const exactHistoricalSearch = (characterService as any).searchExactHistoricalCharacters;
  const service = searchService as any;
  const originalGuildFind = guildModel.find;
  const originalCache = service.siteSearchCache;
  const originalPromises = service.siteSearchPromises;
  let currentOptions: Record<string, unknown> = {};
  let historicalCalls = 0;

  try {
    service.siteSearchCache = new Map();
    service.siteSearchPromises = new Map();
    guildModel.find = () => ({
      collation() { return this; },
      sort() { return this; },
      limit() { return this; },
      select() { return this; },
      lean: async () => [],
    });
    (characterService as any).searchExactHistoricalCharacters = async () => [];
    (characterService as any).searchCurrentCharacters = async (_query: string, _limit: number, options: Record<string, unknown>) => {
      currentOptions = options;
      return [];
    };
    (characterService as any).searchCharacters = async () => {
      historicalCalls += 1;
      return [];
    };

    await service.searchSite("ab", 20, { includeHistorical: true });

    assert.deepEqual(currentOptions, { prefix: true });
    assert.equal(historicalCalls, 0);
  } finally {
    guildModel.find = originalGuildFind;
    (characterService as any).searchCurrentCharacters = currentSearch;
    (characterService as any).searchCharacters = historicalSearch;
    (characterService as any).searchExactHistoricalCharacters = exactHistoricalSearch;
    service.siteSearchCache = originalCache;
    service.siteSearchPromises = originalPromises;
  }
});
