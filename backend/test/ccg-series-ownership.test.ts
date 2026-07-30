/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import {
  buildCcgSeriesOwnershipArchiveDocument,
  isValidUnresolvedCardReference,
  resolveUnlockedSnapshotVersions,
} from "../src/services/ccg-ownership-migration.service";
import {
  buildCcgCollectionReadModel,
  refreshCcgCollectionReadModelsForSeries,
  selectCcgCollectionCard,
} from "../src/services/ccg-collection-read-model.service";
import ccgService from "../src/services/ccg.service";

test("ownership migration preserves malformed rows but fails on valid missing card references", () => {
  assert.equal(isValidUnresolvedCardReference({ cardId: null, finish: null }), false);
  assert.equal(isValidUnresolvedCardReference({ cardId: "not-an-object-id", finish: "standard" }), false);
  assert.equal(isValidUnresolvedCardReference({ cardId: new mongoose.Types.ObjectId(), finish: null }), false);
  assert.equal(isValidUnresolvedCardReference({ cardId: new mongoose.Types.ObjectId(), finish: "standard" }), true);
});

test("snapshot migration keeps only explicitly acquired versions", () => {
  assert.deepEqual(resolveUnlockedSnapshotVersions({
    unlockedFromSnapshotVersion: 1,
    unlockedSnapshotVersions: [3],
    originCards: [{ snapshotVersion: 1 }, { snapshotVersion: 3 }],
  }), [1, 3]);
});

test("collection read model selects the newest explicitly unlocked immutable snapshot", () => {
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const first = {
    _id: new mongoose.Types.ObjectId(),
    setId,
    characterId,
    snapshotVersion: 1,
    tierGrade: "A",
    setNumber: 25,
    name: "Series Test",
    performanceSnapshotAt: new Date("2026-07-01T00:00:00.000Z"),
    publishedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
  const latest = {
    ...first,
    _id: new mongoose.Types.ObjectId(),
    snapshotVersion: 3,
    tierGrade: "S",
    performanceSnapshotAt: new Date("2026-07-20T00:00:00.000Z"),
    publishedAt: new Date("2026-07-20T00:00:00.000Z"),
  };

  assert.equal(selectCcgCollectionCard([first, latest], [1])?._id, first._id);
  assert.equal(selectCcgCollectionCard([first, latest], [1, 3])?._id, latest._id);
  assert.deepEqual(buildCcgCollectionReadModel(latest), {
    collectionReadModelVersion: 1,
    collectionCardId: latest._id,
    collectionSnapshotVersion: 3,
    collectionSortGrade: 1,
    collectionSortSetNumber: 25,
    collectionSortName: "Series Test",
  });
});

test("inconsistent series archival preserves the complete source document", () => {
  const archivedAt = new Date("2026-07-30T12:00:00.000Z");
  const sourceDocument = {
    _id: new mongoose.Types.ObjectId(),
    ownerType: "user" as const,
    ownerId: new mongoose.Types.ObjectId(),
    setId: new mongoose.Types.ObjectId(),
    characterId: new mongoose.Types.ObjectId(),
    unlockedSnapshotVersions: [2],
    firstAcquiredAt: new Date("2026-07-01T00:00:00.000Z"),
    lastAcquiredAt: new Date("2026-07-02T00:00:00.000Z"),
    legacyField: { preserved: true },
  };

  assert.deepEqual(buildCcgSeriesOwnershipArchiveDocument(sourceDocument, archivedAt), {
    _id: sourceDocument._id,
    sourceDocument,
    reason: "missing_finish_ownership",
    migrationKey: "ccg-collection-read-model-v3",
    archivedAt,
  });
});

test("collection read-model refresh rejects a series without finish ownership", async () => {
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const seriesModel = CcgSeriesOwnership as any;
  const cardModel = CcgCard as any;
  const ownershipModel = CcgOwnership as any;
  const originals = {
    seriesFind: seriesModel.find,
    cardFind: cardModel.find,
    ownershipFind: ownershipModel.find,
  };

  try {
    cardModel.find = () => ({
      select() { return this; },
      session() { return this; },
      lean: async () => [],
    });
    seriesModel.find = () => ({
      select() { return this; },
      session() { return this; },
      lean: async () => [{
        _id: new mongoose.Types.ObjectId(),
        ownerType: "user",
        ownerId: new mongoose.Types.ObjectId(),
        setId,
        characterId,
        unlockedSnapshotVersions: [1],
      }],
    });
    ownershipModel.find = () => ({
      select() { return this; },
      session() { return this; },
      lean: async () => [],
    });

    await assert.rejects(
      refreshCcgCollectionReadModelsForSeries(setId, characterId, {} as mongoose.ClientSession),
      /without positive finish ownership/,
    );
  } finally {
    seriesModel.find = originals.seriesFind;
    cardModel.find = originals.cardFind;
    ownershipModel.find = originals.ownershipFind;
  }
});

test("alternative art unlock lookup keeps identical characters scoped to their raid set", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const unlockedSetId = new mongoose.Types.ObjectId();
  const lockedSetId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const ownershipModel = CcgOwnership as any;
  const originalFind = ownershipModel.find;
  let filter: Record<string, any> | null = null;

  try {
    ownershipModel.find = (value: Record<string, any>) => {
      filter = value;
      return {
        select() { return this; },
        lean: async () => [{ setId: unlockedSetId, characterId }],
      };
    };

    const unlocks = await (ccgService as any).loadAlternativeArtUnlocks(
      { ownerType: "user", ownerId },
      [
        { setId: unlockedSetId, characterId },
        { setId: lockedSetId, characterId },
      ],
    );

    assert.deepEqual(filter, {
      ownerType: "user",
      ownerId,
      $or: [
        { setId: unlockedSetId, characterId },
        { setId: lockedSetId, characterId },
      ],
      alternativeQuantity: { $gt: 0 },
    });
    assert.deepEqual([...unlocks], [`${unlockedSetId}:${characterId}`]);
    assert.equal(unlocks.has(`${lockedSetId}:${characterId}`), false);
  } finally {
    ownershipModel.find = originalFind;
  }
});

test("finish grants update one series entitlement and one shared series finish", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const cardId = new mongoose.Types.ObjectId();
  const seriesModel = CcgSeriesOwnership as any;
  const cardModel = CcgCard as any;
  const ownershipModel = CcgOwnership as any;
  const originalSeriesBulkWrite = seriesModel.bulkWrite;
  const originalSeriesFind = seriesModel.find;
  const originalCardFind = cardModel.find;
  const originalOwnershipBulkWrite = ownershipModel.bulkWrite;
  let seriesOperations: Array<Record<string, any>> = [];
  let ownershipOperations: Array<Record<string, any>> = [];

  try {
    seriesModel.find = () => ({
      select() { return this; },
      session() { return this; },
      lean: async () => [],
    });
    cardModel.find = () => ({
      select() { return this; },
      session() { return this; },
      lean: async () => [{
        _id: cardId,
        setId,
        characterId,
        snapshotVersion: 2,
        tierGrade: "A",
        setNumber: 10,
        name: "Grant Test",
        performanceSnapshotAt: new Date("2026-07-27T00:00:00.000Z"),
        publishedAt: new Date("2026-07-27T00:00:00.000Z"),
      }],
    });
    seriesModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      seriesOperations = operations;
      return {};
    };
    ownershipModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      ownershipOperations = operations;
      return {};
    };

    await (ccgService as any).addOwnership(
      { ownerType: "user", ownerId, dateKey: "2026-07-27" },
      [{
        cardId,
        setId,
        characterId,
        snapshotVersion: 2,
        finish: "foil",
        artVariant: "standard",
      }],
      {} as mongoose.ClientSession,
    );

    assert.equal(seriesOperations.length, 1);
    assert.deepEqual(seriesOperations[0].updateOne.filter, {
      ownerType: "user",
      ownerId,
      setId,
      characterId,
    });
    assert.deepEqual(seriesOperations[0].updateOne.update.$addToSet, {
      unlockedSnapshotVersions: { $each: [2] },
    });
    assert.equal(seriesOperations[0].updateOne.update.$set.collectionReadModelVersion, 1);
    assert.equal(seriesOperations[0].updateOne.update.$set.collectionCardId, cardId);
    assert.equal(seriesOperations[0].updateOne.update.$set.collectionSnapshotVersion, 2);
    assert.equal(seriesOperations[0].updateOne.update.$set.collectionSortGrade, 2);
    assert.equal(seriesOperations[0].updateOne.update.$set.collectionSortSetNumber, 10);
    assert.equal(seriesOperations[0].updateOne.update.$set.collectionSortName, "Grant Test");
    assert.deepEqual(seriesOperations[0].updateOne.update.$unset, { collectionReadModelIssue: "" });

    assert.equal(ownershipOperations.length, 1);
    assert.deepEqual(ownershipOperations[0].updateOne.filter, {
      ownerType: "user",
      ownerId,
      setId,
      characterId,
      finish: "foil",
    });
    assert.equal(ownershipOperations[0].updateOne.filter.cardId, undefined);
    assert.equal(ownershipOperations[0].updateOne.update.$setOnInsert.cardId, cardId);
  } finally {
    seriesModel.bulkWrite = originalSeriesBulkWrite;
    seriesModel.find = originalSeriesFind;
    cardModel.find = originalCardFind;
    ownershipModel.bulkWrite = originalOwnershipBulkWrite;
  }
});

test("an exact historical reward unlocks only that snapshot version", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const seriesModel = CcgSeriesOwnership as any;
  const cardModel = CcgCard as any;
  const ownershipModel = CcgOwnership as any;
  const originalSeriesBulkWrite = seriesModel.bulkWrite;
  const originalSeriesFind = seriesModel.find;
  const originalCardFind = cardModel.find;
  const originalOwnershipBulkWrite = ownershipModel.bulkWrite;
  let seriesOperations: Array<Record<string, any>> = [];

  try {
    const cardId = new mongoose.Types.ObjectId();
    seriesModel.find = () => ({
      select() { return this; },
      session() { return this; },
      lean: async () => [],
    });
    cardModel.find = () => ({
      select() { return this; },
      session() { return this; },
      lean: async () => [{
        _id: cardId,
        setId,
        characterId,
        snapshotVersion: 1,
        tierGrade: "A",
        setNumber: 11,
        name: "Historical Test",
        performanceSnapshotAt: new Date("2026-07-27T00:00:00.000Z"),
        publishedAt: new Date("2026-07-27T00:00:00.000Z"),
      }],
    });
    seriesModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      seriesOperations = operations;
      return {};
    };
    ownershipModel.bulkWrite = async () => ({});

    await (ccgService as any).addOwnership(
      { ownerType: "user", ownerId, dateKey: "2026-07-27" },
      [{
        cardId,
        setId,
        characterId,
        snapshotVersion: 1,
        finish: "standard",
        artVariant: "standard",
      }],
      {} as mongoose.ClientSession,
    );

    assert.deepEqual(seriesOperations[0].updateOne.update.$addToSet, {
      unlockedSnapshotVersions: { $each: [1] },
    });
  } finally {
    seriesModel.bulkWrite = originalSeriesBulkWrite;
    seriesModel.find = originalSeriesFind;
    cardModel.find = originalCardFind;
    ownershipModel.bulkWrite = originalOwnershipBulkWrite;
  }
});
