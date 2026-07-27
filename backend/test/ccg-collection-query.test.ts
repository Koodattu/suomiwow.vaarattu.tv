/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import CcgSet from "../src/models/CcgSet";
import ccgService from "../src/services/ccg.service";

test("owned collection shares finishes across explicitly unlocked snapshots", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const raidSetId = new mongoose.Types.ObjectId();
  const communitySetId = new mongoose.Types.ObjectId();
  const cardId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const publishedAt = new Date("2026-07-26T12:00:00.000Z");
  const raidSet = {
    _id: raidSetId,
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
  const communitySet = {
    ...raidSet,
    _id: communitySetId,
    slug: "community",
    zoneId: -1,
    raidName: "Community",
    kind: "community",
  };
  const card = {
    _id: cardId,
    setId: raidSetId,
    setNumber: 1,
    snapshotVersion: 1,
    characterId,
    name: "Collection Test",
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
    tierGrade: "A",
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    performanceSnapshotAt: publishedAt,
    publicationWave: 1,
    publishedAt,
  };
  const latestCard = {
    ...card,
    _id: new mongoose.Types.ObjectId(),
    snapshotVersion: 2,
    tierGrade: "S",
    performanceSnapshotAt: new Date("2026-08-02T12:00:00.000Z"),
    publishedAt: new Date("2026-08-02T12:00:00.000Z"),
  };
  const seriesOwnershipModel = CcgSeriesOwnership as any;
  const setModel = CcgSet as any;
  const service = ccgService as any;
  const originals = {
    aggregate: seriesOwnershipModel.aggregate,
    setFind: setModel.find,
    loadAlternativeArt: service.loadAlternativeArt,
    loadAlternativeArtUnlocks: service.loadAlternativeArtUnlocks,
  };
  let pipeline: Array<Record<string, any>> = [];

  try {
    setModel.find = () => ({
      select() { return this; },
      lean: async () => [raidSet, communitySet],
    });
    seriesOwnershipModel.aggregate = (value: Array<Record<string, any>>) => {
      pipeline = value;
      return Promise.resolve([{
        items: [{
          _id: { setId: raidSetId, characterId },
          totalQuantity: 2,
          finishes: [{ finish: "standard", quantity: 2, alternativeQuantity: 0 }],
          card: latestCard,
          accessibleCards: [latestCard, card],
        }],
        count: [{ total: 1 }],
      }]);
    };
    service.loadAlternativeArt = async () => new Map();
    service.loadAlternativeArtUnlocks = async () => new Set();

    const result = await service.getCollection(
      { ownerType: "user", ownerId },
      { page: 2, limit: 12, sort: "damage_desc" },
    );

    const ownershipLookupIndex = pipeline.findIndex((stage) => stage.$lookup?.from === "ccgownerships");
    const cardLookupIndex = pipeline.findIndex((stage) => stage.$lookup?.from === "ccgcards");
    assert.ok(ownershipLookupIndex >= 0);
    assert.ok(cardLookupIndex > ownershipLookupIndex);
    assert.equal(pipeline.some((stage) => stage.$lookup?.from === "ccgsets"), false);
    assert.deepEqual(pipeline[ownershipLookupIndex].$lookup.let, { setId: "$setId", characterId: "$characterId" });
    const snapshotMatch = pipeline[cardLookupIndex].$lookup.pipeline.find((stage: Record<string, any>) => stage.$match?.$expr);
    assert.deepEqual(snapshotMatch.$match.$expr.$and[2], { $in: ["$snapshotVersion", "$$unlockedSnapshotVersions"] });

    const enabledSetMatch = pipeline.find((stage) => stage.$match?.setId);
    assert.deepEqual(enabledSetMatch?.$match.setId.$in, [raidSetId, communitySetId]);
    const scoreStage = pipeline.find((stage) => stage.$set?.sortValue);
    assert.deepEqual(scoreStage?.$set.sortValue.$cond[0], { $in: ["$card.setId", [communitySetId]] });
    const facet = pipeline.find((stage) => stage.$facet);
    assert.deepEqual(facet?.$facet.items, [{ $skip: 12 }, { $limit: 12 }]);

    assert.equal(result.cards[0].set.id, String(raidSetId));
    assert.equal(result.cards[0].variants[0].card.set.id, String(raidSetId));
    assert.equal(result.cards[0].totalQuantity, 2);
    assert.deepEqual(result.cards[0].variants.map((variant: any) => variant.card.snapshotVersion), [2, 1]);
    assert.deepEqual(result.cards[0].variants[0].ownership, result.cards[0].variants[1].ownership);
  } finally {
    seriesOwnershipModel.aggregate = originals.aggregate;
    setModel.find = originals.setFind;
    service.loadAlternativeArt = originals.loadAlternativeArt;
    service.loadAlternativeArtUnlocks = originals.loadAlternativeArtUnlocks;
  }
});
