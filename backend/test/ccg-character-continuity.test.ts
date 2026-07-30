/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgCommunityCharacter from "../src/models/CcgCommunityCharacter";
import CcgSet from "../src/models/CcgSet";
import Character from "../src/models/Character";
import CharacterMedia from "../src/models/CharacterMedia";
import CharacterMechanicsLeaderboard from "../src/models/CharacterMechanicsLeaderboard";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterTierListEntry from "../src/models/CharacterTierListEntry";
import ccgPublisherService from "../src/services/ccg-publisher.service";
import ccgService from "../src/services/ccg.service";
import characterContinuityService from "../src/services/character-continuity.service";
import { buildCharacterContinuityGraph } from "../src/utils/character-continuity";

function queryResult<T>(value: T) {
  return {
    collation() {
      return this;
    },
    sort() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => value,
  };
}

test("CCG snapshot population uses the continuity root identity and its available render", async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const targetId = new mongoose.Types.ObjectId();
  const guildId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const graph = buildCharacterContinuityGraph([{ sourceCharacterId: sourceId, targetCharacterId: targetId }]);
  const characterModel = Character as any;
  const tierEntryModel = CharacterTierListEntry as any;
  const participationModel = CharacterRaidParticipation as any;
  const mediaModel = CharacterMedia as any;
  const setModel = CcgSet as any;
  const continuityService = characterContinuityService as any;
  const publisher = ccgPublisherService as any;
  const originals = {
    characterFind: characterModel.find,
    tierEntryFind: tierEntryModel.find,
    participationFind: participationModel.find,
    mediaFind: mediaModel.find,
    setFindOne: setModel.findOne,
    getGraph: continuityService.getGraph,
  };

  try {
    continuityService.getGraph = async () => graph;
    setModel.findOne = async () => ({ _id: setId, zoneId: 24, slug: "nyalotha" });
    tierEntryModel.find = () => queryResult([
      {
        characterId: sourceId,
        characterKey: "canonical:31701589:2",
        wclCanonicalCharacterId: 31701589,
        name: "Shenzinile",
        realm: "outland",
        region: "EU",
        classID: 2,
        pulls: 546,
        score: 42.4,
        parseScore: 23,
        survivalScore: 61.8,
        mythicReportCount: 26,
        reportCount: 35,
      },
      {
        characterId: targetId,
        characterKey: "canonical:67138558:2",
        wclCanonicalCharacterId: 67138558,
        name: "Shenzinile",
        realm: "tarren-mill",
        region: "EU",
        classID: 2,
        pulls: 50,
        score: 30,
        parseScore: 25,
        survivalScore: 35,
        mythicReportCount: 1,
        reportCount: 1,
      },
    ]);
    characterModel.find = () => queryResult([
      {
        _id: targetId,
        wclCanonicalCharacterId: 67138558,
        name: "Shenzinile",
        realm: "tarren-mill",
        region: "EU",
        classID: 2,
      },
    ]);
    participationModel.find = () => queryResult([
      {
        characterId: sourceId,
        zoneId: 24,
        reportGuildId: guildId,
        reportGuildName: "Taikaolennot",
        reportGuildRealm: "Outland",
        reportCount: 35,
        mythicReportCount: 26,
        lastSeenAt: new Date("2021-01-28T17:13:41.245Z"),
      },
      {
        characterId: targetId,
        zoneId: 24,
        reportGuildId: guildId,
        reportGuildName: "Pohjoinen",
        reportGuildRealm: "Kazzak",
        reportCount: 1,
        mythicReportCount: 1,
        lastSeenAt: new Date("2024-02-14T17:02:14.156Z"),
      },
    ]);
    mediaModel.find = () => queryResult([
      {
        characterId: sourceId,
        status: "not_found",
        mainRawUrl: null,
        attemptCount: 1,
        lastErrorCode: "404",
      },
      {
        characterId: targetId,
        status: "available",
        mainRawUrl: "https://render.example/shenzinile.png",
        attemptCount: 1,
      },
    ]);

    const population = await publisher.loadSnapshotPopulation(24, { ensureConfigured: false });
    assert.equal(population.entries.length, 1);
    assert.equal(String(population.entries[0].entry.characterId), String(targetId));
    assert.equal(population.entries[0].entry.realm, "tarren-mill");
    assert.equal(population.entries[0].entry.wclCanonicalCharacterId, 67138558);
    assert.equal(population.participationByCharacter.get(String(targetId)).mythicReportCount, 27);

    const mediaByCharacter = await publisher.loadContinuityMedia(population.continuity);
    assert.equal(String(mediaByCharacter.get(String(targetId)).characterId), String(targetId));
    assert.equal(mediaByCharacter.get(String(targetId)).mainRawUrl, "https://render.example/shenzinile.png");
  } finally {
    characterModel.find = originals.characterFind;
    tierEntryModel.find = originals.tierEntryFind;
    participationModel.find = originals.participationFind;
    mediaModel.find = originals.mediaFind;
    setModel.findOne = originals.setFindOne;
    continuityService.getGraph = originals.getGraph;
  }
});

test("character checker combines linked raid data with the current character media", async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const targetId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const graph = buildCharacterContinuityGraph([{ sourceCharacterId: sourceId, targetCharacterId: targetId }]);
  const characterModel = Character as any;
  const tierEntryModel = CharacterTierListEntry as any;
  const mechanicsModel = CharacterMechanicsLeaderboard as any;
  const participationModel = CharacterRaidParticipation as any;
  const mediaModel = CharacterMedia as any;
  const cardModel = CcgCard as any;
  const setModel = CcgSet as any;
  const continuityService = characterContinuityService as any;
  const originals = {
    characterFindOne: characterModel.findOne,
    characterFind: characterModel.find,
    tierEntryFind: tierEntryModel.find,
    mechanicsFind: mechanicsModel.find,
    participationFind: participationModel.find,
    mediaFind: mediaModel.find,
    cardFind: cardModel.find,
    setFind: setModel.find,
    getGraph: continuityService.getGraph,
  };

  try {
    continuityService.getGraph = async () => graph;
    characterModel.findOne = () => queryResult({
      _id: sourceId,
      name: "Shenzinile",
      realm: "outland",
      region: "EU",
      classID: 2,
      guildName: "Taikaolennot",
      lastReportSeenAt: new Date("2021-01-28T17:13:41.245Z"),
    });
    characterModel.find = () => queryResult([
      {
        _id: sourceId,
        name: "Shenzinile",
        realm: "outland",
        region: "EU",
        classID: 2,
        guildName: "Taikaolennot",
        lastReportSeenAt: new Date("2021-01-28T17:13:41.245Z"),
      },
      {
        _id: targetId,
        name: "Shenzinile",
        realm: "tarren-mill",
        region: "EU",
        classID: 2,
        guildName: "Pohjoinen",
        lastReportSeenAt: new Date("2024-02-14T17:02:14.156Z"),
      },
    ]);
    tierEntryModel.find = () => queryResult([
      { characterId: sourceId, zoneId: 24, pulls: 546, score: 42.4, parseScore: 23, survivalScore: 61.8 },
    ]);
    mechanicsModel.find = () => queryResult([
      { characterId: sourceId, zoneId: 24, pulls: 546, score: 42.4, parseScore: 23, survivalScore: 61.8 },
    ]);
    participationModel.find = () => queryResult([
      { characterId: sourceId, zoneId: 24, reportCount: 35, mythicReportCount: 26 },
    ]);
    mediaModel.find = () => queryResult([
      { characterId: sourceId, status: "not_found", avatarUrl: null, mainRawUrl: null, lastErrorCode: "404" },
      {
        characterId: targetId,
        status: "available",
        avatarUrl: "https://render.example/shenzinile-avatar.jpg",
        mainRawUrl: "https://render.example/shenzinile.png",
        lastErrorCode: null,
      },
    ]);
    cardModel.find = () => queryResult([]);
    setModel.find = () => queryResult([
      {
        _id: setId,
        slug: "nyalotha",
        zoneId: 24,
        raidName: "Ny'alotha",
        state: "legacy",
        kind: "raid",
        enabledAt: new Date("2026-07-26T07:38:34.930Z"),
        cardCount: 700,
      },
    ]);

    const result = await ccgService.checkCharacter("Shenzinile", "Outland") as any;
    assert.equal(result.found, true);
    assert.equal(result.character.id, String(targetId));
    assert.equal(result.character.realm, "tarren-mill");
    assert.equal(result.character.avatarUrl, "https://render.example/shenzinile-avatar.jpg");
    assert.equal(result.media.ready, true);
    assert.equal(result.eligible, true);
    assert.equal(result.ready, true);
    assert.equal(result.raids[0].zoneId, 24);
    assert.equal(result.raids[0].mythicReports, 26);
    assert.equal(result.raids[0].pulls, 546);
  } finally {
    characterModel.findOne = originals.characterFindOne;
    characterModel.find = originals.characterFind;
    tierEntryModel.find = originals.tierEntryFind;
    mechanicsModel.find = originals.mechanicsFind;
    participationModel.find = originals.participationFind;
    mediaModel.find = originals.mediaFind;
    cardModel.find = originals.cardFind;
    setModel.find = originals.setFind;
    continuityService.getGraph = originals.getGraph;
  }
});

test("collection character filters include continuity members and their Community card identity", async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const targetId = new mongoose.Types.ObjectId();
  const communityId = new mongoose.Types.ObjectId();
  const graph = buildCharacterContinuityGraph([{ sourceCharacterId: sourceId, targetCharacterId: targetId }]);
  const communityModel = CcgCommunityCharacter as any;
  const continuityService = characterContinuityService as any;
  const service = ccgService as any;
  const originals = {
    communityFind: communityModel.find,
    getGraph: continuityService.getGraph,
  };

  try {
    continuityService.getGraph = async () => graph;
    communityModel.find = () => queryResult([{ _id: communityId }]);

    const ids = await service.resolveCollectionCharacterIds(String(sourceId));
    assert.deepEqual(new Set(ids.map(String)), new Set([String(sourceId), String(targetId), String(communityId)]));
  } finally {
    communityModel.find = originals.communityFind;
    continuityService.getGraph = originals.getGraph;
  }
});
