/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgPackPool from "../src/models/CcgPackPool";
import CcgSet from "../src/models/CcgSet";
import ccgService from "../src/services/ccg.service";

test("CCG promo is owner-neutral and returns the newest current and legacy presentation data", async () => {
  const currentSetId = new mongoose.Types.ObjectId();
  const legacySetId = new mongoose.Types.ObjectId();
  const sCardId = new mongoose.Types.ObjectId();
  const fallbackCardId = new mongoose.Types.ObjectId();
  const now = new Date("2026-08-31T12:00:00.000Z");
  const makeSet = (id: mongoose.Types.ObjectId, state: "current" | "legacy", zoneId: number) => ({
    _id: id,
    slug: `${state}-raid`,
    zoneId,
    raidName: `${state} raid`,
    expansionName: "Midnight",
    state,
    kind: "raid",
    enabledAt: now,
    themeKey: state,
    theme: { mark: state, accent: "#fff", glow: "rgba(255,255,255,.4)" },
    customFinish: null,
    backgroundPath: `/ccg/${state}.webp`,
    packArtOffsetX: 50,
    cardCount: 2,
    publicationWave: 1,
    lastPublishedAt: now,
  });
  const currentSet = makeSet(currentSetId, "current", 50);
  const legacySet = makeSet(legacySetId, "legacy", 46);
  const makeCard = (id: mongoose.Types.ObjectId, tierGrade: "S" | "A", setNumber: number) => ({
    _id: id,
    setId: currentSetId,
    setNumber,
    snapshotVersion: 1,
    snapshotKey: "current-raid:2026-08-31",
    characterId: new mongoose.Types.ObjectId(),
    name: `${tierGrade} card`,
    realm: "stormreaver",
    region: "eu",
    guildId: null,
    guildName: null,
    guildRealm: null,
    classID: 1,
    specName: "arms",
    role: "dps",
    metric: "dps",
    itemLevel: 300,
    parseScore: 90,
    survivalScore: 80,
    combinedScore: 85,
    mythicPlusScore: 3000,
    tierGrade,
    avatarUrl: null,
    renderUrl: null,
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    performanceSnapshotAt: now,
    mediaCapturedAt: now,
    publicationWave: 1,
    publishedAt: now,
  });
  const cards = [makeCard(sCardId, "S", 1), makeCard(fallbackCardId, "A", 2)];
  const setModel = CcgSet as any;
  const poolModel = CcgPackPool as any;
  const cardModel = CcgCard as any;
  const service = ccgService as any;
  const originals = {
    setFindOne: setModel.findOne,
    poolFindOne: poolModel.findOne,
    cardFind: cardModel.find,
    loadAlternativeArt: service.loadAlternativeArt,
    resolveOwner: service.resolveOwner,
  };
  const setSorts: Array<Record<string, number>> = [];
  let requestedCardIds: mongoose.Types.ObjectId[] = [];
  let ownerResolved = false;

  try {
    setModel.findOne = (filter: { state: "current" | "legacy" }) => ({
      select() { return this; },
      sort(value: Record<string, number>) { setSorts.push(value); return this; },
      lean: async () => filter.state === "current" ? currentSet : legacySet,
    });
    poolModel.findOne = () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => ({
        buckets: [
          { grade: "S", cardIds: [sCardId] },
          { grade: "A", cardIds: [fallbackCardId] },
        ],
      }),
    });
    cardModel.find = (filter: { _id: { $in: mongoose.Types.ObjectId[] } }) => {
      requestedCardIds = filter._id.$in;
      return { lean: async () => [...cards].reverse() };
    };
    service.loadAlternativeArt = async () => new Map();
    service.resolveOwner = async () => {
      ownerResolved = true;
      throw new Error("The public promo must not resolve an owner");
    };

    const result = await service.getPromo();

    assert.equal(ownerResolved, false);
    assert.equal(result.currentSetId, String(currentSetId));
    assert.equal(result.legacySetId, String(legacySetId));
    assert.deepEqual(result.sets.map((set: { id: string }) => set.id), [String(currentSetId), String(legacySetId)]);
    assert.deepEqual(result.cards.map((card: { id: string }) => card.id), requestedCardIds.map(String));
    assert.equal(result.cards[0].tierGrade, "S");
    assert.equal(result.cards[1].tierGrade, "A");
    assert.deepEqual(setSorts, [
      { zoneId: -1, _id: -1 },
      { zoneId: -1, _id: -1 },
    ]);
  } finally {
    setModel.findOne = originals.setFindOne;
    poolModel.findOne = originals.poolFindOne;
    cardModel.find = originals.cardFind;
    service.loadAlternativeArt = originals.loadAlternativeArt;
    service.resolveOwner = originals.resolveOwner;
  }
});
