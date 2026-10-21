/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgSet from "../src/models/CcgSet";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import service from "../src/services/ccg.service";

test("set counts exclude only latest archived series without joining every owned card", async t => {
  const setId = new mongoose.Types.ObjectId(), characterId = new mongoose.Types.ObjectId(), ownerId = new mongoose.Types.ObjectId();
  t.mock.method(CcgSet, "find", (() => ({ select() { return this; }, sort() { return this; }, lean: async () => [{ _id: setId, zoneId: 53, theme: {}, customFinish: null }] })) as any);
  t.mock.method(CcgCard, "aggregate", (async (pipeline: any[]) => {
    assert.deepEqual(pipeline[0].$match, { setId: { $in: [setId] }, availabilityStatus: "archived" });
    const lookup = pipeline.find(p => p.$lookup).$lookup;
    assert.deepEqual(lookup.pipeline.find((p: any) => p.$sort).$sort, { snapshotVersion: -1, publishedAt: -1, _id: -1 });
    assert.deepEqual(pipeline[pipeline.length - 2].$match, { "cardAvailability.availabilityStatus": "archived" });
    return [{ _id: { setId, characterId } }];
  }) as any);
  t.mock.method(CcgSeriesOwnership, "aggregate", (async (pipeline: any[]) => {
    assert.deepEqual(pipeline[0].$match, { ownerType: "user", ownerId, setId: { $in: [setId] }, $nor: [{ setId, characterId }] });
    assert.equal(pipeline.some(p => p.$lookup), false);
    return [{ _id: setId, count: 42 }];
  }) as any);
  t.mock.method(service as any, "getRaidIconByZone", async () => new Map());
  const sets = await service.getSets({ ownerType: "user", ownerId, dateKey: "2026-10-21" });
  assert.equal(sets[0].ownedCards, 42);
});

for (const sort of ["alphabetical", "mythic_plus_desc", "quality_desc", "duplicates_desc"]) {
  test(`materialized ${sort} paginates before loading owned snapshot variants`, async t => {
    const owner = { ownerType: "user", ownerId: new mongoose.Types.ObjectId() };
    const match = { ...owner, setId: new mongoose.Types.ObjectId() };
    const cardMatch = { "card.guildId": new mongoose.Types.ObjectId(), "card.tierGrade": "A" };
    const pageRow = { collectionCardId: new mongoose.Types.ObjectId(), unlockedSnapshotVersions: [1] };
    t.mock.method(CcgSeriesOwnership, "exists", (async () => null) as any);
    t.mock.method(CcgSeriesOwnership, "aggregate", (async (pipeline: any[]) => {
      assert.deepEqual(pipeline[0].$match, { ...match, collectionReadModelVersion: 1 });
      assert.deepEqual(pipeline[1].$lookup, { from: "ccgcards", localField: "collectionCardId", foreignField: "_id", as: "card" });
      assert.deepEqual(pipeline[3].$match, cardMatch);
      const lookups = pipeline.filter(p => p.$lookup);
      assert.equal(lookups.length, sort === "quality_desc" || sort === "duplicates_desc" ? 2 : 1);
      const facet = pipeline[pipeline.length - 1].$facet;
      assert.deepEqual(facet.items.slice(0, 2), [{ $skip: 12 }, { $limit: 12 }]);
      return [{ items: [pageRow], count: [{ total: 42 }] }];
    }) as any);
    t.mock.method(service as any, "loadCollectionPage", async (actualOwner: unknown, rows: unknown, total: number) => {
      assert.deepEqual(actualOwner, owner);
      assert.deepEqual(rows, [pageRow]);
      assert.equal(total, 42);
      return { items: rows, count: [{ total }] };
    });
    const result = await (service as any).getMaterializedCollectionRows(owner, match, cardMatch, sort, null, [], 2, 12);
    assert.equal(result.count[0].total, 42);
  });
}

test("sorted collection retains the legacy path until all matched series are materialized", async t => {
  t.mock.method(CcgSeriesOwnership, "exists", (async () => ({ _id: new mongoose.Types.ObjectId() })) as any);
  const aggregate = t.mock.method(CcgSeriesOwnership, "aggregate", (() => { throw Error("unexpected aggregation"); }) as any);
  assert.equal(await (service as any).getMaterializedCollectionRows({}, {}, {}, "alphabetical", null, [], 1, 12), null);
  assert.equal(aggregate.mock.callCount(), 0);
});

for (const state of ["complete", "incomplete", "missing-finish"] as const) {
  test(`default paging preserves fallback behavior for ${state} series`, async t => {
    const owner = { ownerType: "user", ownerId: new mongoose.Types.ObjectId() };
    const setId = new mongoose.Types.ObjectId();
    const characterId = new mongoose.Types.ObjectId();
    t.mock.method(CcgSeriesOwnership, "find", (() => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => [] })) as any);
    t.mock.method(CcgSeriesOwnership, "countDocuments", (async (filter: any) => {
      assert.deepEqual(filter.setId, { $in: [setId] });
      assert.deepEqual(filter.characterId, { $in: [characterId] });
      return filter.collectionReadModelVersion || state === "complete" ? 4 : 5;
    }) as any);
    const fallback = t.mock.method(CcgSeriesOwnership, "exists", (async (filter: any) => {
      assert.equal(filter.collectionReadModelVersion.$ne, 1);
      assert.equal(typeof filter.collectionReadModelIssue.$ne, "string");
      return state === "incomplete" ? { _id: characterId } : null;
    }) as any);
    const result = await (service as any).getDefaultCollectionRows(owner, [setId], 2, 12, [characterId]);
    assert.equal(fallback.mock.callCount(), state === "complete" ? 0 : 1);
    if (state === "incomplete") assert.equal(result, null);
    else assert.deepEqual(result, { items: [], count: [{ total: 4 }] });
  });
}

test("page ownership and alternative lookups qualify for the partial series index", async t => {
  const setId = new mongoose.Types.ObjectId(), characterId = new mongoose.Types.ObjectId();
  const owner = { ownerType: "user", ownerId: new mongoose.Types.ObjectId() };
  const find = t.mock.method(CcgOwnership, "find", ((filter: any) => {
    assert.deepEqual(filter.setId, { $type: "objectId" });
    assert.deepEqual(filter.characterId, { $type: "objectId" });
    assert.deepEqual(filter.$or, [{ setId, characterId }]);
    assert.equal(filter.ownerId, owner.ownerId);
    return { select() { return this; }, lean: async () => [] };
  }) as any);
  t.mock.method(CcgCard, "find", (() => ({ sort() { return this; }, lean: async () => [] })) as any);
  await (service as any).loadCollectionPage(owner, [{ setId, characterId, unlockedSnapshotVersions: [1] }], 1);
  await (service as any).loadAlternativeArtUnlocks(owner, [{ setId, characterId }]);
  assert.equal(find.mock.callCount(), 2);
});
