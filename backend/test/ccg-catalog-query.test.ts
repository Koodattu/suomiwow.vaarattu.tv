/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import CcgSet from "../src/models/CcgSet";
import ccgService from "../src/services/ccg.service";

test("missing-card catalog filtering uses series ownership and avoids finish ownership work", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const cardId = new mongoose.Types.ObjectId();
  const publishedAt = new Date("2026-07-27T12:00:00.000Z");
  const set = {
    _id: setId,
    slug: "test-raid",
    zoneId: 1,
    raidName: "Test Raid",
    expansionName: "Test",
    state: "current",
    kind: "raid",
    enabledAt: publishedAt,
    themeKey: "test",
    theme: { mark: "T", accent: "#fff", glow: "#fff" },
    backgroundPath: "/ccg/test.webp",
    cardCount: 1,
    publicationWave: 1,
  };
  const card = {
    _id: cardId,
    setId,
    setNumber: 1,
    snapshotVersion: 2,
    characterId,
    name: "Catalog Test",
    realm: "stormreaver",
    region: "eu",
    classID: 8,
    specName: "Fire",
    role: "dps",
    metric: "dps",
    itemLevel: 639,
    parseScore: 98,
    survivalScore: 90,
    combinedScore: 94,
    mythicPlusScore: 3000,
    tierGrade: "S",
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    performanceSnapshotAt: publishedAt,
    publicationWave: 1,
    publishedAt,
  };
  const cardModel = CcgCard as any;
  const ownershipModel = CcgOwnership as any;
  const seriesOwnershipModel = CcgSeriesOwnership as any;
  const setModel = CcgSet as any;
  const service = ccgService as any;
  const originals = {
    aggregate: cardModel.aggregate,
    ownershipFind: ownershipModel.find,
    seriesOwnershipFind: seriesOwnershipModel.find,
    setFind: setModel.find,
    getActiveCatalogCardIds: service.getActiveCatalogCardIds,
    loadAlternativeArt: service.loadAlternativeArt,
    loadAlternativeArtUnlocks: service.loadAlternativeArtUnlocks,
  };
  let pipeline: Array<Record<string, any>> = [];
  let ownershipFindCalls = 0;
  let alternativeUnlockCalls = 0;

  try {
    setModel.find = () => ({
      select() { return this; },
      lean: async () => [set],
    });
    service.getActiveCatalogCardIds = async () => [cardId];
    cardModel.aggregate = (value: Array<Record<string, any>>) => {
      pipeline = value;
      return Promise.resolve([{ items: [card], count: [{ total: 1 }] }]);
    };
    ownershipModel.find = () => {
      ownershipFindCalls += 1;
      return {
        lean: async () => [{
          setId,
          characterId,
          cardId,
          finish: "standard",
          quantity: 2,
          alternativeQuantity: 0,
        }],
      };
    };
    seriesOwnershipModel.find = () => ({
      select() { return this; },
      lean: async () => [{ setId, characterId, unlockedSnapshotVersions: [1] }],
    });
    service.loadAlternativeArt = async () => new Map();
    service.loadAlternativeArtUnlocks = async () => {
      alternativeUnlockCalls += 1;
      return new Set();
    };

    const result = await service.getCatalog(
      { ownerType: "user", ownerId },
      undefined,
      { owned: "missing", sort: "quality_desc" },
    );

    assert.equal(pipeline.some((stage) => stage.$lookup?.from === "ccgseriesownerships"), true);
    assert.equal(pipeline.some((stage) => stage.$lookup?.from === "ccgownerships"), false);
    const seriesLookup = pipeline.find((stage) => stage.$lookup?.from === "ccgseriesownerships");
    const seriesMatch = seriesLookup?.$lookup.pipeline.find((stage: Record<string, any>) => stage.$match?.$expr);
    assert.deepEqual(seriesMatch.$match.$expr.$and, [
      { $eq: ["$setId", "$$setId"] },
      { $eq: ["$characterId", "$$characterId"] },
    ]);
    assert.equal(ownershipFindCalls, 0);
    assert.equal(alternativeUnlockCalls, 0);
    assert.deepEqual(result.sets.map((responseSet: any) => responseSet.id), [String(setId)]);
    assert.equal(result.cards[0].setId, String(setId));
    assert.equal("set" in result.cards[0], false);
    assert.equal(result.cards[0].seriesOwned, true);
    assert.equal(result.cards[0].snapshotOwned, false);
    assert.deepEqual(result.cards[0].ownership, []);
  } finally {
    cardModel.aggregate = originals.aggregate;
    ownershipModel.find = originals.ownershipFind;
    seriesOwnershipModel.find = originals.seriesOwnershipFind;
    setModel.find = originals.setFind;
    service.getActiveCatalogCardIds = originals.getActiveCatalogCardIds;
    service.loadAlternativeArt = originals.loadAlternativeArt;
    service.loadAlternativeArtUnlocks = originals.loadAlternativeArtUnlocks;
  }
});
