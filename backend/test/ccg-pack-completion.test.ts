/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgPackPool from "../src/models/CcgPackPool";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import CcgSet from "../src/models/CcgSet";
import ccgService from "../src/services/ccg.service";

test("pack completion counting skips active-card work through the flat 95-percent range", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const session = {} as mongoose.ClientSession;
  const service = ccgService as any;
  const seriesModel = CcgSeriesOwnership as any;
  const cardModel = CcgCard as any;
  const originals = {
    countDocuments: seriesModel.countDocuments,
    distinct: cardModel.distinct,
  };
  const filters: Record<string, unknown>[] = [];
  let distinctCalled = false;

  try {
    seriesModel.countDocuments = (filter: Record<string, unknown>) => {
      filters.push(filter);
      return {
        session: async (value: unknown) => {
          assert.equal(value, session);
          return 950;
        },
      };
    };
    cardModel.distinct = () => {
      distinctCalled = true;
      throw new Error("active cards should not be queried through 95 percent completion");
    };

    const count = await service.countPackOwnedSeries(
      { ownerType: "user", ownerId },
      setId,
      1_000,
      session,
    );

    assert.equal(count, 950);
    assert.equal(distinctCalled, false);
    assert.deepEqual(filters, [{ ownerType: "user", ownerId, setId }]);
  } finally {
    seriesModel.countDocuments = originals.countDocuments;
    cardModel.distinct = originals.distinct;
  }
});

test("pack completion counting uses active characters above 95 percent", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const activeCharacterIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const session = {} as mongoose.ClientSession;
  const service = ccgService as any;
  const seriesModel = CcgSeriesOwnership as any;
  const cardModel = CcgCard as any;
  const originals = {
    countDocuments: seriesModel.countDocuments,
    distinct: cardModel.distinct,
  };
  const ownershipFilters: Record<string, any>[] = [];
  let cardFilter: Record<string, unknown> | null = null;

  try {
    seriesModel.countDocuments = (filter: Record<string, unknown>) => {
      ownershipFilters.push(filter);
      return {
        session: async (value: unknown) => {
          assert.equal(value, session);
          return ownershipFilters.length === 1 ? 951 : 948;
        },
      };
    };
    cardModel.distinct = (field: string, filter: Record<string, unknown>) => {
      assert.equal(field, "characterId");
      cardFilter = filter;
      return {
        session: async (value: unknown) => {
          assert.equal(value, session);
          return activeCharacterIds;
        },
      };
    };

    const count = await service.countPackOwnedSeries(
      { ownerType: "user", ownerId },
      setId,
      1_000,
      session,
    );

    assert.equal(count, 948);
    assert.deepEqual(cardFilter, { setId, availabilityStatus: { $ne: "archived" } });
    assert.deepEqual(ownershipFilters, [
      { ownerType: "user", ownerId, setId },
      { ownerType: "user", ownerId, setId, characterId: { $in: activeCharacterIds } },
    ]);
  } finally {
    seriesModel.countDocuments = originals.countDocuments;
    cardModel.distinct = originals.distinct;
  }
});

test("all-raids packs skip missing-card protection even when it is requested", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const poolId = new mongoose.Types.ObjectId();
  const session = {} as mongoose.ClientSession;
  const service = ccgService as any;
  const setModel = CcgSet as any;
  const poolModel = CcgPackPool as any;
  const originals = {
    setFind: setModel.find,
    poolAggregate: poolModel.aggregate,
    countPackOwnedSeries: service.countPackOwnedSeries,
  };
  const grades = ["S", "A", "B", "C", "D", "E", "F"] as const;
  const cardByGrade = new Map(grades.map((grade) => [grade, new mongoose.Types.ObjectId()]));
  let aggregateCall = 0;

  try {
    setModel.find = () => ({
      select() { return this; },
      sort() { return this; },
      session() { return this; },
      lean: async () => [{ _id: setId, cardCount: grades.length }],
    });
    poolModel.aggregate = () => ({
      session: async (value: unknown) => {
        assert.equal(value, session);
        aggregateCall += 1;
        return aggregateCall === 1
          ? [{
              _id: poolId,
              setId,
              version: "test",
              counts: grades.map((grade) => ({ grade, count: 1 })),
            }]
          : [{
              _id: poolId,
              buckets: grades.map((grade) => ({ grade, cardIds: [cardByGrade.get(grade)] })),
            }];
      },
    });
    service.countPackOwnedSeries = async () => {
      throw new Error("all-raids packs should not count collection completion");
    };

    const result = await service.selectPackResults(
      session,
      null,
      false,
      true,
      { ownerType: "user", ownerId },
    );

    assert.equal(result.results.length, 5);
    assert.equal(result.results.every((row: any) => row.missingCardAlternatives.length === 0), true);
  } finally {
    setModel.find = originals.setFind;
    poolModel.aggregate = originals.poolAggregate;
    service.countPackOwnedSeries = originals.countPackOwnedSeries;
  }
});
