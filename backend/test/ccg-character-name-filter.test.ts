/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgCommunityCharacter from "../src/models/CcgCommunityCharacter";
import ccgService from "../src/services/ccg.service";
import characterContinuityService from "../src/services/character-continuity.service";

test("collection character name filtering is substring-only and diacritic-insensitive", async () => {
  const exactCharacterId = new mongoose.Types.ObjectId();
  const substringCharacterId = new mongoose.Types.ObjectId();
  const realmOnlyCharacterId = new mongoose.Types.ObjectId();
  const communityCharacterId = new mongoose.Types.ObjectId();
  const publishedAt = new Date("2026-08-02T12:00:00.000Z");
  const communityModel = CcgCommunityCharacter as any;
  const service = ccgService as any;
  const continuityService = characterContinuityService as any;
  const originals = {
    communityFind: communityModel.find,
    getCandidates: service.getCollectionCharacterSearchCandidates,
    getContinuityGraph: continuityService.getGraph,
  };
  let linkedCharacterIds: mongoose.Types.ObjectId[] = [];

  try {
    service.getCollectionCharacterSearchCandidates = async () => [
      {
        collectorKey: `character:${exactCharacterId}`,
        characterId: exactCharacterId,
        name: "Fälsu",
        realm: "stormreaver",
        classID: 8,
        publishedAt,
        characterSearchText: ["falsu", "falsu stormreaver"],
      },
      {
        collectorKey: `character:${substringCharacterId}`,
        characterId: substringCharacterId,
        name: "Alfalsux",
        realm: "stormreaver",
        classID: 2,
        publishedAt,
        characterSearchText: ["alfalsux", "alfalsux stormreaver"],
      },
      {
        collectorKey: `character:${realmOnlyCharacterId}`,
        characterId: realmOnlyCharacterId,
        name: "Other",
        realm: "falsu",
        classID: 1,
        publishedAt,
        characterSearchText: ["other", "other falsu"],
      },
    ];
    continuityService.getGraph = async () => ({
      getMemberIds: (characterId: mongoose.Types.ObjectId) => [String(characterId)],
    });
    communityModel.find = (filter: Record<string, any>) => {
      linkedCharacterIds = filter.linkedCharacterId.$in;
      return {
        select() { return this; },
        lean: async () => [{ _id: communityCharacterId }],
      };
    };

    const result = await service.resolveCollectionCharacterNameIds("fálsu");

    assert.deepEqual(linkedCharacterIds.map(String), [String(exactCharacterId), String(substringCharacterId)]);
    assert.deepEqual(result.map(String), [String(exactCharacterId), String(substringCharacterId), String(communityCharacterId)]);
  } finally {
    communityModel.find = originals.communityFind;
    service.getCollectionCharacterSearchCandidates = originals.getCandidates;
    continuityService.getGraph = originals.getContinuityGraph;
  }
});
