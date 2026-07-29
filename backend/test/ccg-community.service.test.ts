import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { buildCharacterContinuityGraph } from "../src/utils/character-continuity";

test("Community character resolution uses the current Blizzard guild for an existing database character", async () => {
  process.env.BLIZZARD_CLIENT_ID ??= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ??= "test-secret";

  const [
    { default: ccgCommunityService },
    { default: blizzardService },
    { default: CcgCard },
    { default: Guild },
    { default: ccgCharacterIdentityService },
  ] = await Promise.all([
    import("../src/services/ccg-community.service"),
    import("../src/services/blizzard.service"),
    import("../src/models/CcgCard"),
    import("../src/models/Guild"),
    import("../src/services/ccg-character-identity.service"),
  ]);

  const service = ccgCommunityService as any;
  const blizzard = blizzardService as any;
  const cardModel = CcgCard as any;
  const guildModel = Guild as any;
  const identityService = ccgCharacterIdentityService as any;
  const originals = {
    getCharacterProfile: blizzard.getCharacterProfile,
    getCharacterMedia: blizzard.getCharacterMedia,
    cardFindOne: cardModel.findOne,
    guildFindOne: guildModel.findOne,
    resolveTrackedCharacter: identityService.resolveTrackedCharacter,
  };
  const linkedCharacterId = "507f1f77bcf86cd799439011";
  const currentGuildId = "507f1f77bcf86cd799439012";
  let profileLookupCount = 0;
  let guildQuery: Record<string, unknown> | undefined;

  try {
    blizzard.getCharacterProfile = async () => {
      profileLookupCount += 1;
      return {
        id: 123,
        name: "Testcharacter",
        realm: { name: "Stormreaver", slug: "stormreaver" },
        character_class: { id: 8, name: "Mage" },
        active_spec: { id: 63, name: "Fire" },
        guild: { name: "Current Guild", realm: { name: "Twisting Nether", slug: "twisting-nether" } },
        level: 80,
      };
    };
    blizzard.getCharacterMedia = async () => ({
      avatarUrl: "https://example.com/avatar.jpg",
      insetUrl: null,
      mainRawUrl: "https://example.com/render.png",
    });
    identityService.resolveTrackedCharacter = async () => ({
      _id: linkedCharacterId,
      name: "Testcharacter",
      realm: "Stormreaver",
      region: "eu",
      guildName: "Stale Guild",
      guildRealm: "Stormreaver",
    });
    guildModel.findOne = (query: Record<string, unknown>) => {
      guildQuery = query;
      return {
        collation() { return this; },
        select() { return this; },
        lean: async () => ({ _id: currentGuildId }),
      };
    };
    cardModel.findOne = () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => null,
    });

    const resolved = await service.resolveCharacter("testcharacter", "stormreaver", "eu");

    assert.equal(profileLookupCount, 1);
    assert.equal(resolved.guildName, "Current Guild");
    assert.equal(resolved.guildRealm, "Twisting Nether");
    assert.deepEqual(guildQuery, { name: "Current Guild", realm: "Twisting Nether", region: "eu" });
  } finally {
    blizzard.getCharacterProfile = originals.getCharacterProfile;
    blizzard.getCharacterMedia = originals.getCharacterMedia;
    cardModel.findOne = originals.cardFindOne;
    guildModel.findOne = originals.guildFindOne;
    identityService.resolveTrackedCharacter = originals.resolveTrackedCharacter;
  }
});

test("Community identity resolution recognizes an active Blizzard identity override", async () => {
  const [
    { default: ccgCharacterIdentityService },
    { default: Character },
    { default: characterContinuityService },
  ] = await Promise.all([
    import("../src/services/ccg-character-identity.service"),
    import("../src/models/Character"),
    import("../src/services/character-continuity.service"),
  ]);
  const identityService = ccgCharacterIdentityService as any;
  const characterModel = Character as any;
  const continuityService = characterContinuityService as any;
  const characterId = new mongoose.Types.ObjectId();
  const character = {
    _id: characterId,
    wclCanonicalCharacterId: 72089934,
    name: "Karstinen",
    realm: "silvermoon",
    region: "EU",
    classID: 3,
    identityObservedAt: new Date("2023-07-19T15:03:12.822Z"),
    blizzardIdentityOverride: {
      name: "Karstinen",
      realm: "tarren-mill",
      updatedAt: new Date("2026-07-26T20:22:41.334Z"),
      updatedBy: "admin",
    },
  };
  const originals = {
    characterFind: characterModel.find,
    characterFindById: characterModel.findById,
    getGraph: continuityService.getGraph,
  };

  try {
    continuityService.getGraph = async () => buildCharacterContinuityGraph([]);
    characterModel.find = () => ({
      collation() { return this; },
      select() { return this; },
      lean: async () => [character],
    });
    characterModel.findById = () => ({
      select() { return this; },
      lean: async () => character,
    });

    const resolved = await identityService.resolveTrackedCharacter({
      name: "Karstinen",
      realm: "Tarren Mill",
      region: "eu",
      classID: 3,
    });

    assert.equal(String(resolved?._id), String(characterId));
  } finally {
    characterModel.find = originals.characterFind;
    characterModel.findById = originals.characterFindById;
    continuityService.getGraph = originals.getGraph;
  }
});

test("Community identity reconciliation preserves and merges already-awarded ownership", async () => {
  const [
    { default: ccgCharacterIdentityService },
    { default: CcgOwnership },
    { default: CcgSeriesOwnership },
    { default: TwitchCcgRedemption },
  ] = await Promise.all([
    import("../src/services/ccg-character-identity.service"),
    import("../src/models/CcgOwnership"),
    import("../src/models/CcgSeriesOwnership"),
    import("../src/models/TwitchCcgRedemption"),
  ]);
  const service = ccgCharacterIdentityService as any;
  const ownershipModel = CcgOwnership as any;
  const seriesModel = CcgSeriesOwnership as any;
  const twitchModel = TwitchCcgRedemption as any;
  const sourceCharacterId = new mongoose.Types.ObjectId();
  const targetCharacterId = new mongoose.Types.ObjectId();
  const setId = new mongoose.Types.ObjectId();
  const cardId = new mongoose.Types.ObjectId();
  const ownerA = new mongoose.Types.ObjectId();
  const ownerB = new mongoose.Types.ObjectId();
  const sourceOwnershipRows = [
    {
      _id: new mongoose.Types.ObjectId(), ownerType: "user", ownerId: ownerA, finish: "normal",
      quantity: 2, alternativeQuantity: 1, firstAcquiredAt: new Date("2026-07-01"), lastAcquiredAt: new Date("2026-07-10"),
    },
    {
      _id: new mongoose.Types.ObjectId(), ownerType: "user", ownerId: ownerB, finish: "holo",
      quantity: 3, alternativeQuantity: 0, firstAcquiredAt: new Date("2026-07-02"), lastAcquiredAt: new Date("2026-07-11"),
    },
  ];
  const targetOwnershipRows = [{
    _id: new mongoose.Types.ObjectId(), ownerType: "user", ownerId: ownerA, finish: "normal",
    quantity: 4, alternativeQuantity: 0, firstAcquiredAt: new Date("2026-07-03"), lastAcquiredAt: new Date("2026-07-09"),
  }];
  const sourceSeriesRows = [{
    _id: new mongoose.Types.ObjectId(), ownerType: "user", ownerId: ownerA, unlockedSnapshotVersions: [1],
    firstAcquiredAt: new Date("2026-07-01"), lastAcquiredAt: new Date("2026-07-10"),
  }];
  const targetSeriesRows = [{
    _id: new mongoose.Types.ObjectId(), ownerType: "user", ownerId: ownerA, unlockedSnapshotVersions: [2],
    firstAcquiredAt: new Date("2026-07-03"), lastAcquiredAt: new Date("2026-07-09"),
  }];
  const ownershipBulkWrites: any[][] = [];
  const seriesBulkWrites: any[][] = [];
  let twitchUpdates = 0;
  const originals = {
    ownershipFind: ownershipModel.find,
    ownershipBulkWrite: ownershipModel.collection.bulkWrite,
    seriesFind: seriesModel.find,
    seriesBulkWrite: seriesModel.collection.bulkWrite,
    twitchUpdateMany: twitchModel.collection.updateMany,
  };
  const queryResult = (rows: any[]) => ({
    session() { return this; },
    lean: async () => rows,
  });

  try {
    ownershipModel.find = (query: any) => query.characterId.equals(sourceCharacterId)
      ? queryResult(sourceOwnershipRows)
      : queryResult(targetOwnershipRows);
    seriesModel.find = (query: any) => query.characterId.equals(sourceCharacterId)
      ? queryResult(sourceSeriesRows)
      : queryResult(targetSeriesRows);
    ownershipModel.collection.bulkWrite = async (operations: any[]) => { ownershipBulkWrites.push(operations); };
    seriesModel.collection.bulkWrite = async (operations: any[]) => { seriesBulkWrites.push(operations); };
    twitchModel.collection.updateMany = async () => { twitchUpdates += 1; };

    const migrated = await service.migrateOwnership(
      cardId,
      setId,
      sourceCharacterId,
      targetCharacterId,
      {} as mongoose.ClientSession,
    );

    assert.deepEqual(migrated, { ownershipRows: 2, seriesRows: 1 });
    assert.equal(ownershipBulkWrites.length, 1);
    assert.deepEqual(ownershipBulkWrites[0][0].updateOne.update.$inc, { quantity: 2, alternativeQuantity: 1 });
    assert.deepEqual(ownershipBulkWrites[0][1], { deleteOne: { filter: { _id: sourceOwnershipRows[0]._id } } });
    assert.equal(String(ownershipBulkWrites[0][2].updateOne.update.$set.characterId), String(targetCharacterId));
    assert.deepEqual(seriesBulkWrites[0][0].updateOne.update.$addToSet, {
      unlockedSnapshotVersions: { $each: [1] },
    });
    assert.deepEqual(seriesBulkWrites[0][1], { deleteOne: { filter: { _id: sourceSeriesRows[0]._id } } });
    assert.equal(twitchUpdates, 2);
  } finally {
    ownershipModel.find = originals.ownershipFind;
    ownershipModel.collection.bulkWrite = originals.ownershipBulkWrite;
    seriesModel.find = originals.seriesFind;
    seriesModel.collection.bulkWrite = originals.seriesBulkWrite;
    twitchModel.collection.updateMany = originals.twitchUpdateMany;
  }
});
