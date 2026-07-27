/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import {
  isValidUnresolvedCardReference,
  resolveUnlockedSnapshotVersions,
} from "../src/services/ccg-ownership-migration.service";
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

test("finish grants update one series entitlement and one shared series finish", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const cardId = new mongoose.Types.ObjectId();
  const seriesModel = CcgSeriesOwnership as any;
  const ownershipModel = CcgOwnership as any;
  const originalSeriesBulkWrite = seriesModel.bulkWrite;
  const originalOwnershipBulkWrite = ownershipModel.bulkWrite;
  let seriesOperations: Array<Record<string, any>> = [];
  let ownershipOperations: Array<Record<string, any>> = [];

  try {
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
    ownershipModel.bulkWrite = originalOwnershipBulkWrite;
  }
});

test("an exact historical reward unlocks only that snapshot version", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const seriesModel = CcgSeriesOwnership as any;
  const ownershipModel = CcgOwnership as any;
  const originalSeriesBulkWrite = seriesModel.bulkWrite;
  const originalOwnershipBulkWrite = ownershipModel.bulkWrite;
  let seriesOperations: Array<Record<string, any>> = [];

  try {
    seriesModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      seriesOperations = operations;
      return {};
    };
    ownershipModel.bulkWrite = async () => ({});

    await (ccgService as any).addOwnership(
      { ownerType: "user", ownerId, dateKey: "2026-07-27" },
      [{
        cardId: new mongoose.Types.ObjectId(),
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
    ownershipModel.bulkWrite = originalOwnershipBulkWrite;
  }
});
