/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgAlternativeArt from "../src/models/CcgAlternativeArt";
import CcgCard from "../src/models/CcgCard";
import CcgSet from "../src/models/CcgSet";
import Character from "../src/models/Character";
import ccgService from "../src/services/ccg.service";
import { normalizeCommunityRole, normalizeCommunityScores } from "../src/utils/ccg-community";

test("Community roles accept only the supported card roles", () => {
  assert.equal(normalizeCommunityRole("dps"), "dps");
  assert.equal(normalizeCommunityRole("healer"), "healer");
  assert.equal(normalizeCommunityRole("tank"), "tank");
  assert.throws(() => normalizeCommunityRole("support"), /DPS, healer, or tank/);
});

test("Community metrics accept optional and negative card values while enforcing maximums", () => {
  assert.deepEqual(normalizeCommunityScores({
    performance: -98.24,
    mechanics: -12,
    combined: -0.1,
    mythicPlus: -3014,
  }), {
    performance: -98.2,
    mechanics: -12,
    combined: -0.1,
    mythicPlus: -3014,
  });
  assert.deepEqual(normalizeCommunityScores({
    performance: "",
    mechanics: null,
    combined: undefined,
    mythicPlus: 3014,
  }), {
    performance: null,
    mechanics: null,
    combined: null,
    mythicPlus: 3014,
  });
  assert.throws(() => normalizeCommunityScores({ performance: 101 }), /no greater than 100/);
  assert.throws(() => normalizeCommunityScores({ mythicPlus: 100_001 }), /no greater than 100000/);
});

test("Community cards persist negative manual metrics", () => {
  const card = new CcgCard({
    setId: new mongoose.Types.ObjectId(),
    setNumber: 1,
    snapshotVersion: 1,
    characterId: new mongoose.Types.ObjectId(),
    name: "Community Test",
    realm: "stormreaver",
    region: "eu",
    classID: 8,
    specName: "Fire",
    role: "dps",
    metric: "dps",
    itemLevel: 0,
    parseScore: 0,
    survivalScore: 0,
    combinedScore: 0,
    communityScores: { performance: -10, mechanics: -20, combined: -15, mythicPlus: -100 },
    tierGrade: "A",
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    performanceSnapshotAt: new Date(),
    sourcePartition: "community-admin",
    publicationWave: 1,
    gradingVersion: "manual-v1",
    eligibilityVersion: "manual-v1",
    themeVersion: "manual-v1",
    publishedAt: new Date(),
  });

  assert.equal(card.validateSync(), undefined);
});

test("Community cards serialize manual metrics without changing raid score fields", () => {
  const service = ccgService as any;
  const card = {
    _id: new mongoose.Types.ObjectId(),
    characterId: new mongoose.Types.ObjectId(),
    setNumber: 1,
    name: "Community Test",
    realm: "stormreaver",
    region: "eu",
    classID: 8,
    specName: "Fire",
    role: "dps",
    metric: "dps",
    itemLevel: 0,
    parseScore: 0,
    survivalScore: 0,
    combinedScore: 0,
    mythicPlusScore: null,
    communityScores: { performance: 98.2, mechanics: 71.3, combined: 84.8, mythicPlus: 3014 },
    tierGrade: "A",
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    performanceSnapshotAt: new Date(),
    publicationWave: 1,
    publishedAt: new Date(),
  };
  const set = {
    _id: new mongoose.Types.ObjectId(),
    slug: "community",
    zoneId: -1,
    raidName: "Community",
    expansionName: "Community",
    state: "current",
    kind: "community",
    enabledAt: new Date(),
    themeKey: "community",
    theme: { mark: "C", accent: "#fff", glow: "#fff" },
    backgroundPath: "/ccg/community.webp",
    cardCount: 1,
    publicationWave: 1,
  };

  assert.deepEqual(service.serializeCard(card, set).scores, card.communityScores);
  assert.deepEqual(service.serializeCard({ ...card, communityScores: undefined }, set).scores, {
    performance: null,
    mechanics: null,
    combined: null,
    mythicPlus: null,
  });
});

test("admin CCG search matches the current name once while preserving variant snapshot names", async () => {
  const characterId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const cards = [1, 2].map((setNumber) => ({
    _id: new mongoose.Types.ObjectId(),
    setId,
    setNumber,
    characterId,
    collectorKey: null,
    name: "Ezclap",
    realm: "stormreaver",
    region: "eu",
    guildName: "Test Guild",
    publishedAt: new Date(`2026-07-2${setNumber}T12:00:00.000Z`),
    performanceSnapshotAt: new Date(`2026-07-2${setNumber}T12:00:00.000Z`),
    backgroundCrop: { x: 50, y: 50, scale: 1 },
  }));
  const set = {
    _id: setId,
    slug: "test-raid",
    zoneId: 1,
    raidName: "Test Raid",
    expansionName: "Test",
    state: "legacy",
    kind: "raid",
    enabledAt: new Date(),
    themeKey: "test",
    theme: { mark: "T", accent: "#fff", glow: "#fff" },
    backgroundPath: "/ccg/test.webp",
    cardCount: cards.length,
    publicationWave: 1,
  };
  const cardModel = CcgCard as any;
  const characterModel = Character as any;
  const setModel = CcgSet as any;
  const alternativeArtModel = CcgAlternativeArt as any;
  const service = ccgService as any;
  const originals = {
    cardFind: cardModel.find,
    characterFind: characterModel.find,
    setFind: setModel.find,
    alternativeArtFind: alternativeArtModel.find,
  };

  try {
    service.adminCardSearchCache = null;
    cardModel.find = (query: Record<string, unknown>) => query._id
      ? { sort() { return this; }, lean: async () => cards }
      : { select() { return this; }, lean: async () => cards };
    characterModel.find = () => ({
      select() { return this; },
      lean: async () => [{ _id: characterId, name: "Laku" }],
    });
    setModel.find = () => ({ lean: async () => [set] });
    alternativeArtModel.find = () => ({
      lean: async () => [{
        collectorKey: `character:${characterId}`,
        quipText: "We go again.",
        quipAudioFilename: "lakuclap.mp3",
      }],
    });

    const currentNameResult = await service.searchCardsForAdmin("laku", 10);
    assert.equal(currentNameResult.cards.length, 1);
    assert.equal(currentNameResult.cards[0].name, "Laku");
    assert.equal(currentNameResult.cards[0].variants.length, 2);
    assert.equal(currentNameResult.cards[0].variants.every((variant: any) => variant.card.name === "Ezclap"), true);
    assert.deepEqual(currentNameResult.cards[0].quip, {
      text: "We go again.",
      audioFilename: "lakuclap.mp3",
      audioPath: "/ccg/audio/quips/lakuclap.mp3",
    });

    const historicalNameResult = await service.searchCardsForAdmin("ezclap", 10);
    assert.equal(historicalNameResult.cards.length, 1);
    assert.equal(historicalNameResult.cards[0].name, "Laku");
  } finally {
    service.adminCardSearchCache = null;
    cardModel.find = originals.cardFind;
    characterModel.find = originals.characterFind;
    setModel.find = originals.setFind;
    alternativeArtModel.find = originals.alternativeArtFind;
  }
});

test("collection character search requires two characters and returns cached published CCG identities", async () => {
  const characterId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const builtAt = new Date("2026-07-25T12:00:00.000Z");
  const set = {
    _id: setId,
    collectionCharactersBuiltAt: builtAt,
    collectionCharacters: [{
      collectorKey: `character:${characterId}`,
      characterId,
      name: "Laku",
      realm: "stormreaver",
      classID: 8,
      publishedAt: builtAt,
      searchText: ["laku", "laku stormreaver", "ezclap", "ezclap stormreaver"],
    }],
  };
  const setModel = CcgSet as any;
  const service = ccgService as any;
  const originalSetFind = setModel.find;
  let metadataReads = 0;
  let materializedReads = 0;

  try {
    service.collectionCharacterSearchCache = null;
    service.collectionCharacterSearchPromise = null;
    setModel.find = () => {
      let selection = "";
      return {
        select(value: string) { selection = value; return this; },
        sort() { return this; },
        lean: async () => {
          if (selection === "collectionCharacters") {
            materializedReads += 1;
            return [set];
          }
          metadataReads += 1;
          return [set];
        },
      };
    };

    const shortResult = await service.searchCollectionCharacters("l", 10);
    assert.deepEqual(shortResult, { search: "l", characters: [] });
    assert.equal(metadataReads, 0);

    const currentNameResult = await service.searchCollectionCharacters("laku", 10);
    assert.deepEqual(currentNameResult.characters, [{
      id: String(characterId),
      name: "Laku",
      realm: "stormreaver",
      classID: 8,
    }]);

    const historicalNameResult = await service.searchCollectionCharacters("ezclap", 10);
    assert.equal(historicalNameResult.characters[0].id, String(characterId));

    const guildNameResult = await service.searchCollectionCharacters("test guild", 10);
    assert.deepEqual(guildNameResult.characters, []);
    assert.equal(metadataReads, 1);
    assert.equal(materializedReads, 1);

    set.collectionCharactersBuiltAt = new Date("2026-07-26T12:00:00.000Z");
    set.collectionCharacters[0].name = "Lakuclap";
    set.collectionCharacters[0].searchText.push("lakuclap", "lakuclap stormreaver");
    service.collectionCharacterSearchCache.versionCheckedUntil = 0;
    const refreshedResult = await service.searchCollectionCharacters("lakuclap", 10);
    assert.equal(refreshedResult.characters[0].name, "Lakuclap");
    assert.equal(metadataReads, 2);
    assert.equal(materializedReads, 2);
  } finally {
    service.collectionCharacterSearchCache = null;
    service.collectionCharacterSearchPromise = null;
    setModel.find = originalSetFind;
  }
});
