/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgPackOpening from "../src/models/CcgPackOpening";
import CcgPackPool from "../src/models/CcgPackPool";
import CcgSet from "../src/models/CcgSet";
import ccgService from "../src/services/ccg.service";

test("custom pack pools draw only from the selected raids and retain the Community pool", async (t) => {
  const service = ccgService as any;
  const session = {} as mongoose.ClientSession;
  const raids = Array.from({ length: 3 }, () => ({ _id: new mongoose.Types.ObjectId(), cardCount: 1 }));
  const selectedSetIds = raids.slice(0, 2).map((set) => set._id);
  const communitySetId = new mongoose.Types.ObjectId();
  const communityCardId = new mongoose.Types.ObjectId();
  const pools = raids.map((set) => ({
    _id: new mongoose.Types.ObjectId(),
    setId: set._id,
    version: "test",
    counts: [{ grade: "F", count: 1 }],
    buckets: [{ grade: "F", cardIds: [new mongoose.Types.ObjectId()] }],
  }));
  let communityReads = 0;
  t.mock.method(CcgSet, "find", (filter: any) => {
    assert.deepEqual(filter._id, { $in: selectedSetIds });
    assert.equal(filter.kind, "raid");
    assert.deepEqual(filter.enabledAt, { $ne: null });
    assert.deepEqual(filter.state, { $in: ["current", "legacy"] });
    return {
      select() { return this; }, sort() { return this; }, session() { return this; },
      lean: async () => raids.filter((set) => filter._id.$in.some((id: mongoose.Types.ObjectId) => id.equals(set._id))),
    } as any;
  });
  t.mock.method(CcgPackPool, "aggregate", (pipeline: any) => ({
    session: async () => {
      const match = pipeline[0].$match;
      if (match.setId) {
        assert.deepEqual(match.setId.$in, selectedSetIds);
        return pools.filter((pool) => selectedSetIds.some((id) => id.equals(pool.setId)));
      }
      return pools.filter((pool) => match._id.$in.some((id: mongoose.Types.ObjectId) => id.equals(pool._id)));
    },
  }) as any);
  t.mock.method(CcgSet, "findOne", (filter: any) => {
    assert.equal(filter.kind, "community");
    communityReads += 1;
    return { select() { return this; }, session() { return this; }, lean: async () => ({ _id: communitySetId }) } as any;
  });
  t.mock.method(CcgPackPool, "findOne", (filter: any) => {
    assert.ok(filter.setId.equals(communitySetId));
    return {
      select() { return this; }, session() { return this; },
      lean: async () => ({ version: "community", buckets: [{ grade: "H", cardIds: [communityCardId] }] }),
    } as any;
  });

  const allowedCardIds = new Set([...pools.slice(0, 2).map((pool) => String(pool.buckets[0].cardIds[0])), String(communityCardId)]);
  const result = await service.selectPackResults(session, null, true, false, null, selectedSetIds);
  assert.equal(result.results.length, 5);
  assert.ok(result.results.every((row: any) => allowedCardIds.has(String(row.cardId))));
  assert.ok(result.results.every((row: any) => row.missingCardAlternatives.length === 0));
  assert.deepEqual(result.sourceSetIds.map(String), [...selectedSetIds, communitySetId].map(String));
  assert.equal(communityReads, 1);
});

test("custom pack selection rejects unavailable raids instead of silently broadening the pool", async (t) => {
  const service = ccgService as any;
  const availableId = new mongoose.Types.ObjectId();
  t.mock.method(CcgSet, "find", () => ({
    select() { return this; }, sort() { return this; }, session() { return this; },
    lean: async () => [{ _id: availableId, cardCount: 1 }],
  }) as any);
  t.mock.method(CcgPackPool, "aggregate", () => { throw new Error("No pool should be drawn"); });
  await assert.rejects(
    service.selectPackResults({}, null, true, false, null, [availableId, new mongoose.Types.ObjectId()]),
    { status: 409, code: "selected_sets_unavailable" },
  );
});

test("pack opening rejects malformed or conflicting custom selections before reserving a pack", async (t) => {
  const service = ccgService as any;
  const setId = String(new mongoose.Types.ObjectId());
  t.mock.method(service, "resolveOwner", async () => ({ ownerType: "user", ownerId: new mongoose.Types.ObjectId() }));
  t.mock.method(service, "reservePack", async () => { throw new Error("No pack should be reserved"); });
  for (const body of [{ setIds: [] }, { setIds: "invalid" }, { setIds: null }, { setIds: [setId], setId }, { setIds: ["invalid"] }]) {
    await assert.rejects(service.openPack({}, {}, body), (error: any) => error.status === 400);
  }
});

test("custom selections survive storage and serialization for recovery and opening another pack", () => {
  const service = ccgService as any;
  const selectedSetIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const opening = new CcgPackOpening({
    selectionType: "all",
    selectedSetIds,
    sourceSetIds: [...selectedSetIds, new mongoose.Types.ObjectId()],
    results: [],
  });
  const serialized = service.serializeOpeningFromEntities(opening.toObject(), [], [], new Map());
  assert.deepEqual(serialized.selection, { type: "all", setIds: selectedSetIds.map(String) });
  const legacy = service.serializeOpeningFromEntities(new CcgPackOpening({ selectionType: "all", results: [] }).toObject(), [], [], new Map());
  assert.deepEqual(legacy.selection, { type: "all" });
  const targeted = service.serializeOpeningFromEntities(new CcgPackOpening({ selectionType: "raid", targetSetId: selectedSetIds[0], results: [] }).toObject(), [], [], new Map());
  assert.deepEqual(targeted.selection, { type: "raid", setId: String(selectedSetIds[0]) });
});

test("pack opening forwards the deduplicated raid selection with Community cards enabled", async (t) => {
  const service = ccgService as any;
  const owner = { ownerType: "user", ownerId: new mongoose.Types.ObjectId() };
  const setId = new mongoose.Types.ObjectId();
  const stopAfterSelection = new Error("Pool selection reached");
  let ended = false;
  const session = {
    withTransaction: async (action: () => Promise<void>) => action(),
    endSession: async () => { ended = true; },
  };
  t.mock.method(service, "resolveOwner", async () => owner);
  t.mock.method(mongoose, "startSession", async () => session as any);
  t.mock.method(CcgPackOpening, "findOne", () => ({
    lean: async () => null,
    session: async () => null,
  }) as any);
  t.mock.method(service, "reservePack", async () => ({ source: "recharge" }));
  const selection = t.mock.method(service, "selectPackResults", async (...args: any[]) => {
    assert.equal(args[0], session);
    assert.equal(args[1], null);
    assert.equal(args[2], true);
    assert.equal(args[3], false);
    assert.equal(args[4], owner);
    assert.deepEqual(args[5].map(String), [String(setId)]);
    throw stopAfterSelection;
  });
  await assert.rejects(service.openPack({}, {}, {
    setIds: [String(setId), String(setId)],
    idempotencyKey: "custom_pack_selection_test",
  }), (error: unknown) => error === stopAfterSelection);
  assert.equal(selection.mock.callCount(), 1);
  assert.equal(ended, true);
});
