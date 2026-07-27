/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import mongoose from "mongoose";
import { CCG_PACK_BALANCE_VERSION } from "../src/config/ccg";
import CcgPackBalance from "../src/models/CcgPackBalance";
import CcgPackPool from "../src/models/CcgPackPool";
import CcgRollover from "../src/models/CcgRollover";
import CcgSet from "../src/models/CcgSet";
import ccgPublisherService from "../src/services/ccg-publisher.service";
import ccgService from "../src/services/ccg.service";

test("collection guild facets are consolidated by set and reused from memory", async () => {
  const firstSetId = new mongoose.Types.ObjectId();
  const secondSetId = new mongoose.Types.ObjectId();
  const sharedGuildId = new mongoose.Types.ObjectId();
  const secondGuildId = new mongoose.Types.ObjectId();
  const builtAt = new Date("2026-07-27T10:00:00.000Z");
  const sets = [
    {
      _id: firstSetId,
      slug: "first",
      collectionGuildsBuiltAt: builtAt,
      collectionGuilds: [{ guildId: sharedGuildId, name: "Shared", realm: "Realm" }],
    },
    {
      _id: secondSetId,
      slug: "second",
      collectionGuildsBuiltAt: builtAt,
      collectionGuilds: [
        { guildId: sharedGuildId, name: "Shared", realm: "Realm" },
        { guildId: secondGuildId, name: "Second", realm: "Realm" },
      ],
    },
  ];
  const setModel = CcgSet as any;
  const publisher = ccgPublisherService as any;
  const service = ccgService as any;
  const originals = {
    find: setModel.find,
    materialize: publisher.ensureCollectionGuildsMaterialized,
    cache: service.collectionGuildsCache,
    promise: service.collectionGuildsPromise,
  };
  let findCalls = 0;

  try {
    service.collectionGuildsCache = null;
    service.collectionGuildsPromise = null;
    setModel.find = () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => {
        findCalls += 1;
        return sets;
      },
    });
    publisher.ensureCollectionGuildsMaterialized = async () => {
      throw new Error("materialization should not run for built facets");
    };

    const all = await service.getCollectionGuilds();
    const second = await service.getCollectionGuilds("second");

    assert.equal(findCalls, 1);
    assert.deepEqual(all.guilds, [
      { id: String(secondGuildId), name: "Second", realm: "Realm", setIds: [String(secondSetId)] },
      { id: String(sharedGuildId), name: "Shared", realm: "Realm", setIds: [String(firstSetId), String(secondSetId)] },
    ]);
    assert.deepEqual(second.guilds.map((guild: { id: string }) => guild.id), [String(secondGuildId), String(sharedGuildId)]);
  } finally {
    setModel.find = originals.find;
    publisher.ensureCollectionGuildsMaterialized = originals.materialize;
    service.collectionGuildsCache = originals.cache;
    service.collectionGuildsPromise = originals.promise;
  }
});

test("active catalog card ids use complete pack pools and fail closed on a mismatch", async () => {
  const setId = new mongoose.Types.ObjectId();
  const cardIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const poolModel = CcgPackPool as any;
  const service = ccgService as any;
  const originalFind = poolModel.find;
  let totalCards = 2;

  try {
    poolModel.find = () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => [{
        setId,
        totalCards,
        updatedAt: new Date(),
        buckets: [{ grade: "S", cardIds }],
      }],
    });

    assert.deepEqual(await service.getActiveCatalogCardIds([{ _id: setId, cardCount: 2 }]), cardIds);
    totalCards = 1;
    assert.equal(await service.getActiveCatalogCardIds([{ _id: setId, cardCount: 2 }]), null);
  } finally {
    poolModel.find = originalFind;
  }
});

test("session pack state skips reconciliation when balance metadata is current", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const now = new Date("2026-07-27T10:00:00.000Z");
  const balanceModel = CcgPackBalance as any;
  const rolloverModel = CcgRollover as any;
  const service = ccgService as any;
  const originals = {
    balanceFindOne: balanceModel.findOne,
    rolloverFindOne: rolloverModel.findOne,
    credits: service.getPackCreditBalances,
    reconcile: service.ensurePackBalance,
  };

  try {
    balanceModel.findOne = () => ({
      lean: async () => ({
        currentRemaining: 4,
        legacyRemaining: 3,
        lastRechargeAt: now,
        lastRolloverSequence: 7,
        grantVersion: CCG_PACK_BALANCE_VERSION,
        hasPlayed: true,
      }),
    });
    rolloverModel.findOne = () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => ({ sequence: 7 }),
    });
    service.getPackCreditBalances = async () => ({ current: 1, legacy: 2 });
    service.ensurePackBalance = async () => {
      throw new Error("steady-state session should not open a transaction");
    };

    const state = await service.getSessionPackState({ ownerType: "user", ownerId, dateKey: "2026-07-27" }, now);
    assert.deepEqual(state.balance, {
      currentRemaining: 4,
      legacyRemaining: 3,
      lastRechargeAt: now,
      lastRolloverSequence: 7,
      grantVersion: CCG_PACK_BALANCE_VERSION,
      hasPlayed: true,
    });
    assert.deepEqual(state.creditBalances, { current: 1, legacy: 2 });
  } finally {
    balanceModel.findOne = originals.balanceFindOne;
    rolloverModel.findOne = originals.rolloverFindOne;
    service.getPackCreditBalances = originals.credits;
    service.ensurePackBalance = originals.reconcile;
  }
});
