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

test("default collection paginates the materialized index before hydrating cards and finishes", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const firstCardId = new mongoose.Types.ObjectId();
  const latestCardId = new mongoose.Types.ObjectId();
  const publishedAt = new Date("2026-07-30T10:00:00.000Z");
  const set = {
    _id: setId,
    slug: "read-model-test",
    zoneId: 1,
    raidName: "Read Model Test",
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
  const firstCard = {
    _id: firstCardId,
    setId,
    setNumber: 7,
    snapshotVersion: 1,
    characterId,
    name: "Indexed Card",
    realm: "stormreaver",
    region: "eu",
    classID: 8,
    specName: "Fire",
    role: "dps",
    metric: "dps",
    itemLevel: 639,
    parseScore: 95,
    survivalScore: 90,
    combinedScore: 92,
    tierGrade: "A",
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    performanceSnapshotAt: publishedAt,
    publicationWave: 1,
    publishedAt,
  };
  const latestCard = {
    ...firstCard,
    _id: latestCardId,
    snapshotVersion: 2,
    tierGrade: "S",
    performanceSnapshotAt: new Date("2026-07-31T10:00:00.000Z"),
    publishedAt: new Date("2026-07-31T10:00:00.000Z"),
  };
  const seriesModel = CcgSeriesOwnership as any;
  const ownershipModel = CcgOwnership as any;
  const cardModel = CcgCard as any;
  const setModel = CcgSet as any;
  const service = ccgService as any;
  const originals = {
    seriesFind: seriesModel.find,
    seriesCountDocuments: seriesModel.countDocuments,
    seriesExists: seriesModel.exists,
    seriesAggregate: seriesModel.aggregate,
    ownershipFind: ownershipModel.find,
    cardFind: cardModel.find,
    setFind: setModel.find,
    loadAlternativeArt: service.loadAlternativeArt,
    loadAlternativeArtUnlocks: service.loadAlternativeArtUnlocks,
  };
  let seriesFilter: Record<string, any> | null = null;
  let seriesSort: Record<string, number> | null = null;
  let aggregateCalled = false;

  try {
    setModel.find = () => ({
      select() { return this; },
      lean: async () => [set],
    });
    seriesModel.find = (filter: Record<string, any>) => {
      seriesFilter = filter;
      return {
        sort(value: Record<string, number>) { seriesSort = value; return this; },
        skip() { return this; },
        limit() { return this; },
        select() { return this; },
        lean: async () => [{
          _id: new mongoose.Types.ObjectId(),
          setId,
          characterId,
          unlockedSnapshotVersions: [1, 2],
          collectionCardId: latestCardId,
        }],
      };
    };
    seriesModel.countDocuments = async () => 1;
    seriesModel.exists = async () => null;
    seriesModel.aggregate = () => {
      aggregateCalled = true;
      throw new Error("default collection should not use the full aggregation");
    };
    ownershipModel.find = () => ({
      select() { return this; },
      lean: async () => [{ setId, characterId, finish: "standard", quantity: 2, alternativeQuantity: 0 }],
    });
    cardModel.find = () => ({
      sort() { return this; },
      lean: async () => [latestCard, firstCard],
    });
    service.loadAlternativeArt = async () => new Map();
    service.loadAlternativeArtUnlocks = async () => new Set();

    const result = await service.getCollection(
      { ownerType: "user", ownerId, dateKey: "2026-07-30" },
      { page: 1, limit: 12 },
    );

    assert.equal(aggregateCalled, false);
    assert.equal((seriesFilter as Record<string, any> | null)?.collectionReadModelVersion, 1);
    assert.deepEqual((seriesFilter as Record<string, any> | null)?.setId, { $in: [setId] });
    assert.deepEqual(seriesSort, {
      collectionSortGrade: 1,
      collectionSortSetNumber: 1,
      collectionSortName: 1,
      setId: 1,
      characterId: 1,
    });
    assert.equal(result.total, 1);
    assert.equal(result.cards[0].id, String(latestCardId));
    assert.deepEqual(result.cards[0].variants.map((variant: any) => variant.card.snapshotVersion), [2, 1]);
    assert.equal(result.cards[0].totalQuantity, 2);
  } finally {
    seriesModel.find = originals.seriesFind;
    seriesModel.countDocuments = originals.seriesCountDocuments;
    seriesModel.exists = originals.seriesExists;
    seriesModel.aggregate = originals.seriesAggregate;
    ownershipModel.find = originals.ownershipFind;
    cardModel.find = originals.cardFind;
    setModel.find = originals.setFind;
    service.loadAlternativeArt = originals.loadAlternativeArt;
    service.loadAlternativeArtUnlocks = originals.loadAlternativeArtUnlocks;
  }
});

test("default collection falls back while an owned series still needs materialization", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const seriesModel = CcgSeriesOwnership as any;
  const originals = {
    find: seriesModel.find,
    countDocuments: seriesModel.countDocuments,
    exists: seriesModel.exists,
  };

  try {
    seriesModel.find = () => ({
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      select() { return this; },
      lean: async () => [],
    });
    seriesModel.countDocuments = async () => 0;
    seriesModel.exists = async () => ({ _id: new mongoose.Types.ObjectId() });

    const rows = await (ccgService as any).getDefaultCollectionRows(
      { ownerType: "user", ownerId, dateKey: "2026-07-30" },
      [setId],
      1,
      12,
    );
    assert.equal(rows, null);
  } finally {
    seriesModel.find = originals.find;
    seriesModel.countDocuments = originals.countDocuments;
    seriesModel.exists = originals.exists;
  }
});
