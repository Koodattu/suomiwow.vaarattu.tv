/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgSet from "../src/models/CcgSet";
import ccgService from "../src/services/ccg.service";

test("owned collection consolidates ownership before card lookup and attaches sets after pagination", async () => {
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
  const ownershipModel = CcgOwnership as any;
  const setModel = CcgSet as any;
  const service = ccgService as any;
  const originals = {
    aggregate: ownershipModel.aggregate,
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
    ownershipModel.aggregate = (value: Array<Record<string, any>>) => {
      pipeline = value;
      return Promise.resolve([{
        items: [{
          _id: { setId: raidSetId, characterId },
          totalQuantity: 2,
          finishes: [{ finish: "standard", quantity: 2, alternativeQuantity: 0 }],
          card,
          variants: [{
            card,
            finishes: [{ finish: "standard", quantity: 2, alternativeQuantity: 0 }],
            totalQuantity: 2,
          }],
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

    const ownershipGroupIndex = pipeline.findIndex((stage) => stage.$group?._id === "$cardId");
    const cardLookupIndex = pipeline.findIndex((stage) => stage.$lookup?.from === "ccgcards");
    assert.ok(ownershipGroupIndex >= 0);
    assert.ok(cardLookupIndex > ownershipGroupIndex);
    assert.equal(pipeline.some((stage) => stage.$lookup?.from === "ccgsets"), false);
    assert.deepEqual(pipeline[ownershipGroupIndex].$group, {
      _id: "$cardId",
      totalQuantity: { $sum: "$quantity" },
      finishes: { $push: { finish: "$finish", quantity: "$quantity", alternativeQuantity: { $ifNull: ["$alternativeQuantity", 0] } } },
    });

    const enabledSetMatch = pipeline.find((stage) => stage.$match?.["card.setId"]);
    assert.deepEqual(enabledSetMatch?.$match["card.setId"].$in, [raidSetId, communitySetId]);
    const scoreStage = pipeline.find((stage) => stage.$set?.sortValue);
    assert.deepEqual(scoreStage?.$set.sortValue.$cond[0], { $in: ["$card.setId", [communitySetId]] });
    const facet = pipeline.find((stage) => stage.$facet);
    assert.deepEqual(facet?.$facet.items, [{ $skip: 12 }, { $limit: 12 }]);

    assert.equal(result.cards[0].set.id, String(raidSetId));
    assert.equal(result.cards[0].variants[0].card.set.id, String(raidSetId));
    assert.equal(result.cards[0].totalQuantity, 2);
  } finally {
    ownershipModel.aggregate = originals.aggregate;
    setModel.find = originals.setFind;
    service.loadAlternativeArt = originals.loadAlternativeArt;
    service.loadAlternativeArtUnlocks = originals.loadAlternativeArtUnlocks;
  }
});
