import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterMedia from "../src/models/CharacterMedia";
import CharacterMediaFetchQueue from "../src/models/CharacterMediaFetchQueue";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterTierListEntry from "../src/models/CharacterTierListEntry";
import CcgCard from "../src/models/CcgCard";
import CcgSet from "../src/models/CcgSet";
import CharacterRenderAsset from "../src/models/CharacterRenderAsset";
import TaskLog from "../src/models/TaskLog";
import cacheService from "../src/services/cache.service";
import ccgCardAvailabilityService from "../src/services/ccg-card-availability.service";
import {
  CharacterMediaService,
  getCharacterMediaFailureTransition,
  syncCharacterCardsFromMedia,
} from "../src/services/character-media.service";
import characterRenderStorageService from "../src/services/character-render-storage.service";
import { resolveBlizzardCharacterIdentity } from "../src/utils/character-identity";

type QueueRow = {
  _id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  region: string;
  identityObservedAt?: Date | null;
  blizzardIdentityOverride?: {
    name: string;
    realm: string;
    updatedAt: Date;
  } | null;
};

type TestableCharacterMediaService = {
  enqueueRows(rows: QueueRow[], priority: number, force?: boolean): Promise<number>;
  processItem(item: Record<string, any>): Promise<void>;
};

test("prioritizes missing CCG characters by newest raid before the general character backlog", async () => {
  const characterModel = Character as any;
  const mediaModel = CharacterMedia as any;
  const tierEntryModel = CharacterTierListEntry as any;
  const participationModel = CharacterRaidParticipation as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
    aggregate: characterModel.aggregate,
    countDocuments: characterModel.countDocuments,
    mediaAggregate: mediaModel.aggregate,
    tierFind: tierEntryModel.find,
    participationFind: participationModel.find,
    bulkWrite: queueModel.bulkWrite,
    updateMany: queueModel.updateMany,
  };
  const newestOnly = new mongoose.Types.ObjectId();
  const newestAndOlder = new mongoose.Types.ObjectId();
  const olderOnly = new mongoose.Types.ObjectId();
  const general = new mongoose.Types.ObjectId();
  const rows: QueueRow[] = [
    { _id: newestOnly, name: "Newest", realm: "Draenor", region: "EU" },
    { _id: newestAndOlder, name: "Shared", realm: "Tarren Mill", region: "EU" },
    { _id: olderOnly, name: "Older", realm: "Silvermoon", region: "EU" },
    { _id: general, name: "General", realm: "Kazzak", region: "EU" },
  ];
  const queueWrites: Array<{ ids: string[]; priority: number }> = [];

  try {
    characterModel.aggregate = () => ({
      allowDiskUse() {
        return this;
      },
      option() {
        return this;
      },
      exec: async () => rows,
    });
    characterModel.countDocuments = async () => 17;
    tierEntryModel.find = (filter: { zoneId: number }) => ({
      select() {
        return this;
      },
      maxTimeMS() {
        return this;
      },
      lean: async () => {
        if (filter.zoneId === 46) return [{ characterId: newestOnly }, { characterId: newestAndOlder }];
        if (filter.zoneId === 44) return [{ characterId: newestAndOlder }, { characterId: olderOnly }];
        return [];
      },
    });
    mediaModel.aggregate = () => ({
      allowDiskUse() {
        return this;
      },
      option() {
        return this;
      },
      exec: async () => [],
    });
    participationModel.find = (filter: { zoneId?: number }) => ({
      sort() {
        return this;
      },
      select() {
        return this;
      },
      lean: async () => {
        if (filter.zoneId === undefined) return [];
        const characterIds = filter.zoneId === 46
          ? [newestOnly, newestAndOlder]
          : filter.zoneId === 44
            ? [newestAndOlder, olderOnly]
            : [];
        return characterIds.map((characterId) => ({
          characterId,
          zoneId: filter.zoneId,
          reportGuildId: new mongoose.Types.ObjectId(),
          reportGuildName: "Guild",
          reportGuildRealm: "Realm",
          reportCount: 3,
          mythicReportCount: 3,
          lastSeenAt: new Date(),
        }));
      },
    });
    queueModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      queueWrites.push({
        ids: operations.map((operation) => String(operation.updateOne.filter.characterId)),
        priority: operations[0].updateOne.update.$max.priority,
      });
      return { upsertedCount: operations.length };
    };
    queueModel.updateMany = async () => ({ modifiedCount: 0 });

    const result = await new CharacterMediaService().enqueueMissing();

    assert.deepEqual(queueWrites.map((write) => write.ids), [
      [String(newestOnly), String(newestAndOlder)],
      [String(olderOnly)],
      [String(general)],
    ]);
    assert.ok(queueWrites[0].priority > queueWrites[1].priority);
    assert.ok(queueWrites[1].priority > queueWrites[2].priority);
    assert.equal(result.candidates, 4);
    assert.equal(result.scanned, 17);
    assert.equal(result.eligibleCandidates, 3);
    assert.equal(result.generalCandidates, 1);
    assert.equal(result.queued, 4);
    assert.equal(result.raidSets.find((set) => set.zoneId === 46)?.candidates, 2);
    assert.equal(result.raidSets.find((set) => set.zoneId === 44)?.candidates, 1);
  } finally {
    characterModel.aggregate = originals.aggregate;
    characterModel.countDocuments = originals.countDocuments;
    mediaModel.aggregate = originals.mediaAggregate;
    tierEntryModel.find = originals.tierFind;
    participationModel.find = originals.participationFind;
    queueModel.bulkWrite = originals.bulkWrite;
    queueModel.updateMany = originals.updateMany;
  }
});

test("requeues renamed characters during cooldown and uses their latest raid identity", async () => {
  const characterModel = Character as any;
  const mediaModel = CharacterMedia as any;
  const tierEntryModel = CharacterTierListEntry as any;
  const participationModel = CharacterRaidParticipation as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
    aggregate: characterModel.aggregate,
    countDocuments: characterModel.countDocuments,
    mediaAggregate: mediaModel.aggregate,
    tierFind: tierEntryModel.find,
    participationFind: participationModel.find,
    bulkWrite: queueModel.bulkWrite,
    updateMany: queueModel.updateMany,
  };
  const characterId = new mongoose.Types.ObjectId();
  const latestIdentity: QueueRow = {
    _id: characterId,
    name: "Nipelf",
    realm: "stormreaver",
    region: "EU",
  };
  let queuedName: string | undefined;

  try {
    characterModel.aggregate = () => ({
      allowDiskUse() {
        return this;
      },
      option() {
        return this;
      },
      exec: async () => [],
    });
    characterModel.countDocuments = async () => 1;
    mediaModel.aggregate = () => ({
      allowDiskUse() {
        return this;
      },
      option() {
        return this;
      },
      exec: async () => [latestIdentity],
    });
    participationModel.find = () => ({
      sort() {
        return this;
      },
      select() {
        return this;
      },
      lean: async () => [{
        characterId,
        characterName: "Nipelf",
        characterRealm: "stormreaver",
        characterRegion: "EU",
      }],
    });
    tierEntryModel.find = () => ({
      select() {
        return this;
      },
      maxTimeMS() {
        return this;
      },
      lean: async () => [],
    });
    queueModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      queuedName = operations[0].updateOne.update.$set.name;
      return { upsertedCount: 0 };
    };
    queueModel.updateMany = async () => ({ modifiedCount: 1 });

    const result = await new CharacterMediaService().enqueueMissing();

    assert.equal(queuedName, "Nipelf");
    assert.equal(result.candidates, 1);
    assert.equal(result.generalCandidates, 1);
    assert.equal(result.queued, 1);
  } finally {
    characterModel.aggregate = originals.aggregate;
    characterModel.countDocuments = originals.countDocuments;
    mediaModel.aggregate = originals.mediaAggregate;
    tierEntryModel.find = originals.tierFind;
    participationModel.find = originals.participationFind;
    queueModel.bulkWrite = originals.bulkWrite;
    queueModel.updateMany = originals.updateMany;
  }
});

test("requeues terminal queue entries with a fresh per-run attempt budget", async () => {
  const participationModel = CharacterRaidParticipation as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
    participationFind: participationModel.find,
    bulkWrite: queueModel.bulkWrite,
    updateMany: queueModel.updateMany,
  };
  const captured: { operations?: Array<Record<string, any>>; filter?: Record<string, any>; update?: Record<string, any> } = {};
  const row: QueueRow = {
    _id: new mongoose.Types.ObjectId(),
    name: "Retryme",
    realm: "Twisting Nether",
    region: "EU",
  };

  try {
    participationModel.find = () => ({
      sort() {
        return this;
      },
      select() {
        return this;
      },
      lean: async () => [],
    });
    queueModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      captured.operations = operations;
      return { upsertedCount: 0 };
    };
    queueModel.updateMany = async (filter: Record<string, any>, update: Record<string, any>) => {
      captured.filter = filter;
      captured.update = update;
      return { modifiedCount: 1 };
    };

    const service = new CharacterMediaService() as unknown as TestableCharacterMediaService;
    const queued = await service.enqueueRows([row], 100, true);

    assert.equal(queued, 1);
    assert.equal(captured.operations?.[0].updateOne.update.$max.priority, 100);
    assert.deepEqual(captured.filter?.status, { $ne: "processing" });
    assert.equal(captured.update?.$set.status, "pending");
    assert.equal(captured.update?.$set.attempts, 0);
    assert.equal(captured.update?.$set.completedAt, null);
  } finally {
    participationModel.find = originals.participationFind;
    queueModel.bulkWrite = originals.bulkWrite;
    queueModel.updateMany = originals.updateMany;
  }
});

test("audits every character with a previously stored render, including purged assets", async () => {
  const assetModel = CharacterRenderAsset as any;
  const characterModel = Character as any;
  const participationModel = CharacterRaidParticipation as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
    assetDistinct: assetModel.distinct,
    characterFind: characterModel.find,
    participationFind: participationModel.find,
    queueBulkWrite: queueModel.bulkWrite,
    queueUpdateMany: queueModel.updateMany,
  };
  const characterIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  let priority: number | undefined;
  let forcedFilter: Record<string, any> | undefined;

  try {
    assetModel.distinct = async () => characterIds;
    characterModel.find = () => ({
      select() { return this; },
      lean: async () => characterIds.map((_id, index) => ({
        _id,
        name: `Stored${index}`,
        realm: "Draenor",
        region: "EU",
      })),
    });
    participationModel.find = () => ({
      sort() { return this; },
      select() { return this; },
      lean: async () => [],
    });
    queueModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      priority = operations[0].updateOne.update.$max.priority;
      return { upsertedCount: 0 };
    };
    queueModel.updateMany = async (filter: Record<string, any>) => {
      forcedFilter = filter;
      return { modifiedCount: 0 };
    };

    const result = await new CharacterMediaService().auditPreviouslySuccessful();

    assert.deepEqual(result, { candidates: 2, queued: 2 });
    assert.equal(priority, 250);
    assert.deepEqual(forcedFilter?.status, { $ne: "processing" });
  } finally {
    assetModel.distinct = originals.assetDistinct;
    characterModel.find = originals.characterFind;
    participationModel.find = originals.participationFind;
    queueModel.bulkWrite = originals.queueBulkWrite;
    queueModel.updateMany = originals.queueUpdateMany;
  }
});

test("validation queues every previously fetched render and existing raid card needing initial WebP storage", async () => {
  const setModel = CcgSet as any;
  const tierListModel = CharacterTierListEntry as any;
  const mediaModel = CharacterMedia as any;
  const cardModel = CcgCard as any;
  const characterModel = Character as any;
  const originals = {
    setDistinct: setModel.distinct,
    tierListDistinct: tierListModel.distinct,
    mediaDistinct: mediaModel.distinct,
    cardDistinct: cardModel.distinct,
    characterFind: characterModel.find,
  };
  const currentDueId = new mongoose.Types.ObjectId();
  const currentMissingId = new mongoose.Types.ObjectId();
  const nonEligibleMediaId = new mongoose.Types.ObjectId();
  const historicalCardId = new mongoose.Types.ObjectId();
  let cardFilter: Record<string, unknown> | undefined;
  const queued: Array<{ ids: string[]; priority: number; force: boolean }> = [];

  try {
    setModel.distinct = async () => [999];
    tierListModel.distinct = async () => [currentDueId, currentMissingId];
    mediaModel.distinct = async (_field: string, filter: Record<string, unknown>) => {
      if (filter.status === "available") return [currentDueId];
      if (filter.mainRawUrl) return [currentDueId, nonEligibleMediaId];
      return [currentDueId];
    };
    cardModel.distinct = async (_field: string, filter: Record<string, unknown>) => {
      cardFilter = filter;
      return [currentDueId, historicalCardId];
    };
    characterModel.find = () => ({
      select() { return this; },
      lean: async () => [currentDueId, currentMissingId, nonEligibleMediaId, historicalCardId].map((_id, index) => ({
        _id,
        name: `Backfill${index}`,
        realm: "Draenor",
        region: "EU",
      })),
    });
    const service = new CharacterMediaService() as any;
    service.enqueueRows = async (rows: QueueRow[], priority: number, force: boolean) => {
      queued.push({ ids: rows.map((row) => String(row._id)), priority, force });
      return rows.length;
    };

    const result = await service.enqueueActiveCurrent();

    assert.deepEqual(result, { candidates: 4, queued: 4, purged: 0 });
    assert.deepEqual(cardFilter, { renderAssetId: null, communityCharacterId: null });
    assert.deepEqual(queued, [
      { ids: [String(currentDueId), String(currentMissingId)], priority: 100, force: true },
      { ids: [String(nonEligibleMediaId), String(historicalCardId)], priority: 50, force: true },
    ]);
  } finally {
    setModel.distinct = originals.setDistinct;
    tierListModel.distinct = originals.tierListDistinct;
    mediaModel.distinct = originals.mediaDistinct;
    cardModel.distinct = originals.cardDistinct;
    characterModel.find = originals.characterFind;
  }
});

test("initial WebP storage uses the newest saved card render without calling Blizzard", async () => {
  const previousClientId = process.env.BLIZZARD_CLIENT_ID;
  const previousClientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  process.env.BLIZZARD_CLIENT_ID = "test-client";
  process.env.BLIZZARD_CLIENT_SECRET = "test-secret";
  const { default: blizzardService } = await import("../src/services/blizzard.service");
  const mediaModel = CharacterMedia as any;
  const cardModel = CcgCard as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const blizzard = blizzardService as any;
  const storage = characterRenderStorageService as any;
  const availability = ccgCardAvailabilityService as any;
  const cache = cacheService as any;
  const originals = {
    mediaFindOne: mediaModel.findOne,
    mediaFindOneAndUpdate: mediaModel.findOneAndUpdate,
    cardFindOne: cardModel.findOne,
    queueUpdateOne: queueModel.updateOne,
    getCharacterMedia: blizzard.getCharacterMedia,
    ingestExistingSource: storage.ingestExistingSource,
    ingest: storage.ingest,
    noteAvailable: availability.noteAvailable,
    invalidatePattern: cache.invalidatePattern,
  };
  const characterId = new mongoose.Types.ObjectId();
  const assetId = new mongoose.Types.ObjectId();
  const legacyUrl = "https://render.worldofwarcraft.com/eu/legacy-main-raw.png";
  let blizzardCalls = 0;
  let savedSource: string | null | undefined;
  let storedUpdate: Record<string, any> | undefined;

  try {
    mediaModel.findOne = () => ({
      select() { return this; },
      lean: async () => ({ avatarUrl: null, insetUrl: null, mainRawUrl: null, renderAssetId: null }),
    });
    cardModel.findOne = () => ({
      sort() { return this; },
      select() { return this; },
      lean: async () => ({ avatarUrl: "https://example.com/avatar.jpg", renderUrl: legacyUrl }),
    });
    storage.ingestExistingSource = async (_characterId: mongoose.Types.ObjectId, sourceUrl: string | null | undefined) => {
      savedSource = sourceUrl;
      return {
        assetId,
        url: `/api/ccg/media/assets/${assetId}`,
        fit: { top: 0, ground: 1, centerX: 0.5 },
        byteLength: 100,
        width: 100,
        height: 200,
      };
    };
    storage.ingest = async () => { throw new Error("fresh ingest should not run"); };
    blizzard.getCharacterMedia = async () => {
      blizzardCalls += 1;
      throw new Error("Blizzard should not be called");
    };
    mediaModel.findOneAndUpdate = async (_filter: Record<string, unknown>, update: Record<string, any>) => {
      storedUpdate = update;
      return null;
    };
    queueModel.updateOne = async () => ({ modifiedCount: 1 });
    availability.noteAvailable = async () => ({ cardSnapshots: 0, setsRebuilt: 0 });
    cache.invalidatePattern = async () => undefined;

    const service = new CharacterMediaService() as unknown as TestableCharacterMediaService;
    await service.processItem({
      _id: new mongoose.Types.ObjectId(),
      characterId,
      name: "Legacy",
      realm: "Draenor",
      realmSlug: "draenor",
      region: "eu",
      attempts: 1,
      maxAttempts: 5,
    });

    assert.equal(savedSource, legacyUrl);
    assert.equal(blizzardCalls, 0);
    assert.equal(String(storedUpdate?.$set.renderAssetId), String(assetId));
    assert.equal(storedUpdate?.$set.mainRawUrl, legacyUrl);
    assert.equal(storedUpdate?.$set.avatarUrl, "https://example.com/avatar.jpg");
  } finally {
    mediaModel.findOne = originals.mediaFindOne;
    mediaModel.findOneAndUpdate = originals.mediaFindOneAndUpdate;
    cardModel.findOne = originals.cardFindOne;
    queueModel.updateOne = originals.queueUpdateOne;
    blizzard.getCharacterMedia = originals.getCharacterMedia;
    storage.ingestExistingSource = originals.ingestExistingSource;
    storage.ingest = originals.ingest;
    availability.noteAvailable = originals.noteAvailable;
    cache.invalidatePattern = originals.invalidatePattern;
    if (previousClientId === undefined) delete process.env.BLIZZARD_CLIENT_ID;
    else process.env.BLIZZARD_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.BLIZZARD_CLIENT_SECRET;
    else process.env.BLIZZARD_CLIENT_SECRET = previousClientSecret;
  }
});

test("initial WebP storage calls Blizzard when the saved render is unusable", async () => {
  const previousClientId = process.env.BLIZZARD_CLIENT_ID;
  const previousClientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  process.env.BLIZZARD_CLIENT_ID = "test-client";
  process.env.BLIZZARD_CLIENT_SECRET = "test-secret";
  const { default: blizzardService } = await import("../src/services/blizzard.service");
  const mediaModel = CharacterMedia as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const blizzard = blizzardService as any;
  const storage = characterRenderStorageService as any;
  const availability = ccgCardAvailabilityService as any;
  const cache = cacheService as any;
  const originals = {
    mediaFindOne: mediaModel.findOne,
    mediaFindOneAndUpdate: mediaModel.findOneAndUpdate,
    queueUpdateOne: queueModel.updateOne,
    getCharacterMedia: blizzard.getCharacterMedia,
    ingestExistingSource: storage.ingestExistingSource,
    ingest: storage.ingest,
    noteAvailable: availability.noteAvailable,
    invalidatePattern: cache.invalidatePattern,
  };
  const characterId = new mongoose.Types.ObjectId();
  const assetId = new mongoose.Types.ObjectId();
  const legacyUrl = "https://render.worldofwarcraft.com/eu/missing-main-raw.png";
  const refreshedUrl = "https://render.worldofwarcraft.com/eu/refreshed-main-raw.png";
  let blizzardCalls = 0;
  let refreshedSource: string | undefined;

  try {
    mediaModel.findOne = () => ({
      select() { return this; },
      lean: async () => ({ avatarUrl: null, insetUrl: null, mainRawUrl: legacyUrl, renderAssetId: null }),
    });
    storage.ingestExistingSource = async () => null;
    blizzard.getCharacterMedia = async () => {
      blizzardCalls += 1;
      return { avatarUrl: null, insetUrl: null, mainRawUrl: refreshedUrl };
    };
    storage.ingest = async (_characterId: mongoose.Types.ObjectId, sourceUrl: string) => {
      refreshedSource = sourceUrl;
      return {
        assetId,
        url: `/api/ccg/media/assets/${assetId}`,
        fit: { top: 0, ground: 1, centerX: 0.5 },
        byteLength: 100,
        width: 100,
        height: 200,
      };
    };
    mediaModel.findOneAndUpdate = async () => null;
    queueModel.updateOne = async () => ({ modifiedCount: 1 });
    availability.noteAvailable = async () => ({ cardSnapshots: 0, setsRebuilt: 0 });
    cache.invalidatePattern = async () => undefined;

    const service = new CharacterMediaService() as unknown as TestableCharacterMediaService;
    await service.processItem({
      _id: new mongoose.Types.ObjectId(),
      characterId,
      name: "Legacy",
      realm: "Draenor",
      realmSlug: "draenor",
      region: "eu",
      attempts: 1,
      maxAttempts: 5,
    });

    assert.equal(blizzardCalls, 1);
    assert.equal(refreshedSource, refreshedUrl);
  } finally {
    mediaModel.findOne = originals.mediaFindOne;
    mediaModel.findOneAndUpdate = originals.mediaFindOneAndUpdate;
    queueModel.updateOne = originals.queueUpdateOne;
    blizzard.getCharacterMedia = originals.getCharacterMedia;
    storage.ingestExistingSource = originals.ingestExistingSource;
    storage.ingest = originals.ingest;
    availability.noteAvailable = originals.noteAvailable;
    cache.invalidatePattern = originals.invalidatePattern;
    if (previousClientId === undefined) delete process.env.BLIZZARD_CLIENT_ID;
    else process.env.BLIZZARD_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.BLIZZARD_CLIENT_SECRET;
    else process.env.BLIZZARD_CLIENT_SECRET = previousClientSecret;
  }
});

test("queues only missing or monthly-due renders before card snapshots", async () => {
  const mediaModel = CharacterMedia as any;
  const originalFind = mediaModel.find;
  const now = new Date("2026-08-06T12:00:00.000Z");
  const currentId = new mongoose.Types.ObjectId();
  const dueId = new mongoose.Types.ObjectId();
  const missingId = new mongoose.Types.ObjectId();
  let queuedIds: mongoose.Types.ObjectId[] = [];
  let queuedPriority = 0;
  let forced = false;

  try {
    mediaModel.find = () => ({
      select() { return this; },
      lean: async () => [
        {
          characterId: currentId,
          renderAssetId: new mongoose.Types.ObjectId(),
          nextMediaRefreshAt: new Date("2026-08-07T12:00:00.000Z"),
        },
        {
          characterId: dueId,
          renderAssetId: new mongoose.Types.ObjectId(),
          nextMediaRefreshAt: new Date("2026-08-05T12:00:00.000Z"),
        },
      ],
    });
    const service = new CharacterMediaService() as any;
    service.enqueueCharacters = async (characterIds: mongoose.Types.ObjectId[], priority: number, force: boolean) => {
      queuedIds = characterIds;
      queuedPriority = priority;
      forced = force;
      return characterIds.length;
    };

    const queued = await service.enqueueDueForCardSnapshots([currentId, dueId, missingId], now);

    assert.equal(queued, 2);
    assert.deepEqual(queuedIds.map(String), [String(dueId), String(missingId)]);
    assert.equal(queuedPriority, 500);
    assert.equal(forced, true);
  } finally {
    mediaModel.find = originalFind;
  }
});

test("keeps the last stored render when Blizzard no longer finds a character", async () => {
  const previousClientId = process.env.BLIZZARD_CLIENT_ID;
  const previousClientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  process.env.BLIZZARD_CLIENT_ID = "test-client";
  process.env.BLIZZARD_CLIENT_SECRET = "test-secret";
  const { default: blizzardService } = await import("../src/services/blizzard.service");
  const mediaModel = CharacterMedia as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const blizzard = blizzardService as any;
  const availability = ccgCardAvailabilityService as any;
  const cache = cacheService as any;
  const originals = {
    mediaFindOne: mediaModel.findOne,
    mediaFindOneAndUpdate: mediaModel.findOneAndUpdate,
    queueUpdateOne: queueModel.updateOne,
    getCharacterMedia: blizzard.getCharacterMedia,
    noteNotFound: availability.noteNotFound,
    invalidatePattern: cache.invalidatePattern,
  };
  const characterId = new mongoose.Types.ObjectId();
  const renderAssetId = new mongoose.Types.ObjectId();
  let mediaUpdate: Record<string, any> | undefined;

  try {
    blizzard.getCharacterMedia = async () => {
      throw new Error("Blizzard character media request returned status 404");
    };
    mediaModel.findOne = () => ({
      select() { return this; },
      lean: async () => ({ renderAssetId }),
    });
    mediaModel.findOneAndUpdate = async (_filter: Record<string, unknown>, update: Record<string, any>) => {
      mediaUpdate = update;
      return null;
    };
    queueModel.updateOne = async () => ({ modifiedCount: 1 });
    availability.noteNotFound = async () => ({ cardSnapshots: 0, setsRebuilt: 0 });
    cache.invalidatePattern = async () => undefined;

    const service = new CharacterMediaService() as unknown as TestableCharacterMediaService;
    await service.processItem({
      _id: new mongoose.Types.ObjectId(),
      characterId,
      name: "Vanished",
      realm: "Draenor",
      realmSlug: "draenor",
      region: "eu",
      attempts: 1,
      maxAttempts: 5,
    });

    assert.equal(mediaUpdate?.$set.status, "available");
    assert.equal(Object.prototype.hasOwnProperty.call(mediaUpdate?.$set, "renderAssetId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(mediaUpdate?.$set, "mainRawUrl"), false);
    assert.ok(mediaUpdate?.$set.nextMediaRefreshAt instanceof Date);
  } finally {
    mediaModel.findOne = originals.mediaFindOne;
    mediaModel.findOneAndUpdate = originals.mediaFindOneAndUpdate;
    queueModel.updateOne = originals.queueUpdateOne;
    blizzard.getCharacterMedia = originals.getCharacterMedia;
    availability.noteNotFound = originals.noteNotFound;
    cache.invalidatePattern = originals.invalidatePattern;
    if (previousClientId === undefined) delete process.env.BLIZZARD_CLIENT_ID;
    else process.env.BLIZZARD_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.BLIZZARD_CLIENT_SECRET;
    else process.env.BLIZZARD_CLIENT_SECRET = previousClientSecret;
  }
});

test("a recent manual Blizzard identity overrides older raid participation when media is queued", async () => {
  const participationModel = CharacterRaidParticipation as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
    participationFind: participationModel.find,
    bulkWrite: queueModel.bulkWrite,
  };
  const characterId = new mongoose.Types.ObjectId();
  let queuedIdentity: { name: string; realm: string } | undefined;

  try {
    participationModel.find = () => ({
      sort() {
        return this;
      },
      select() {
        return this;
      },
      lean: async () => [{
        characterId,
        characterName: "Oldreportname",
        characterRealm: "Old Realm",
        characterRegion: "EU",
        lastSeenAt: new Date("2026-07-25T12:00:00.000Z"),
      }],
    });
    queueModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      queuedIdentity = {
        name: operations[0].updateOne.update.$set.name,
        realm: operations[0].updateOne.update.$set.realm,
      };
      return { upsertedCount: 1 };
    };

    const service = new CharacterMediaService() as unknown as TestableCharacterMediaService;
    await service.enqueueRows([
      {
        _id: characterId,
        name: "Stalebasename",
        realm: "Stale Realm",
        region: "EU",
        blizzardIdentityOverride: {
          name: "Currentname",
          realm: "Current Realm",
          updatedAt: new Date("2026-07-26T12:00:00.000Z"),
        },
      },
    ], 200);

    assert.deepEqual(queuedIdentity, { name: "Currentname", realm: "Current Realm" });
  } finally {
    participationModel.find = originals.participationFind;
    queueModel.bulkWrite = originals.bulkWrite;
  }
});

test("newer raid participation supersedes a manual Blizzard identity override", () => {
  const character = {
    name: "Storedname",
    realm: "Stored Realm",
    region: "EU",
    blizzardIdentityOverride: {
      name: "Manualname",
      realm: "Manual Realm",
      updatedAt: new Date("2026-07-20T12:00:00.000Z"),
    },
  };

  assert.deepEqual(
    resolveBlizzardCharacterIdentity(character, {
      name: "Newraidname",
      realm: "New Raid Realm",
      region: "EU",
      observedAt: new Date("2026-07-21T12:00:00.000Z"),
    }),
    { name: "Newraidname", realm: "New Raid Realm", region: "EU" },
  );
});

test("a newer canonical observation supersedes older raid participation", () => {
  const character = {
    name: "Currentname",
    realm: "Current Realm",
    region: "EU",
    identityObservedAt: new Date("2026-07-22T12:00:00.000Z"),
  };

  assert.deepEqual(
    resolveBlizzardCharacterIdentity(character, {
      name: "Oldname",
      realm: "Old Realm",
      region: "EU",
      observedAt: new Date("2026-07-21T12:00:00.000Z"),
    }),
    { name: "Currentname", realm: "Current Realm", region: "EU" },
  );
});

test("a newer canonical observation also expires an older manual override", () => {
  const character = {
    name: "Currentname",
    realm: "Current Realm",
    region: "EU",
    identityObservedAt: new Date("2026-07-22T12:00:00.000Z"),
    blizzardIdentityOverride: {
      name: "Manualname",
      realm: "Manual Realm",
      updatedAt: new Date("2026-07-21T18:00:00.000Z"),
    },
  };

  assert.deepEqual(
    resolveBlizzardCharacterIdentity(character, {
      name: "Oldreportname",
      realm: "Old Report Realm",
      region: "EU",
      observedAt: new Date("2026-07-21T12:00:00.000Z"),
    }),
    { name: "Currentname", realm: "Current Realm", region: "EU" },
  );
});

test("backfills immutable render asset references onto URL-only CCG cards", async () => {
  const cardCollection = CcgCard.collection as any;
  const originalUpdateMany = cardCollection.updateMany;
  const characterId = new mongoose.Types.ObjectId();
  let capturedFilter: Record<string, any> | undefined;
  let capturedUpdate: Record<string, any> | undefined;

  try {
    cardCollection.updateMany = async (filter: Record<string, any>, update: Record<string, any>) => {
      capturedFilter = filter;
      capturedUpdate = update;
      return { modifiedCount: 3 };
    };

    const modified = await syncCharacterCardsFromMedia(characterId, {
      renderAssetId: new mongoose.Types.ObjectId("64f000000000000000000001"),
      renderFit: { top: 0, ground: 0.92, centerX: 0.48 },
      avatarUrl: "https://example.test/current-avatar.jpg",
      fetchedAt: new Date("2026-07-29T12:00:00.000Z"),
    });

    assert.equal(modified, 3);
    assert.equal(String(capturedFilter?.characterId), String(characterId));
    assert.equal(capturedFilter?.renderAssetId, null);
    assert.equal(capturedUpdate?.$set.renderUrl, "/api/ccg/media/assets/64f000000000000000000001");
    assert.equal(String(capturedUpdate?.$set.renderAssetId), "64f000000000000000000001");
    assert.deepEqual(capturedUpdate?.$set.renderFit, { top: 0, ground: 0.92, centerX: 0.48 });
    assert.equal(capturedUpdate?.$set.avatarUrl, "https://example.test/current-avatar.jpg");
  } finally {
    cardCollection.updateMany = originalUpdateMany;
  }
});

test("uses bounded retries followed by weekly transient and monthly not-found cooldowns", () => {
  assert.deepEqual(getCharacterMediaFailureTransition(1, 5, null), {
    queueStatus: "retry",
    delayMs: 2 * 60 * 1000,
  });
  assert.deepEqual(getCharacterMediaFailureTransition(5, 5, null), {
    queueStatus: "failed",
    delayMs: 7 * 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(getCharacterMediaFailureTransition(1, 5, 404), {
    queueStatus: "not_found",
    delayMs: 30 * 24 * 60 * 60 * 1000,
  });
});

test("moves an exhausted stale request into cooldown instead of leaving an unclaimable retry", async () => {
  const mediaModel = CharacterMedia as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
    queueFind: queueModel.find,
    queueUpdateMany: queueModel.updateMany,
    mediaDistinct: mediaModel.distinct,
    mediaBulkWrite: mediaModel.bulkWrite,
  };
  const characterId = new mongoose.Types.ObjectId();
  const queueId = new mongoose.Types.ObjectId();
  const captured: { mediaOperations?: Array<Record<string, any>>; queueUpdates: Array<Record<string, any>> } = { queueUpdates: [] };

  try {
    queueModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [{
        _id: queueId,
        characterId,
        name: "Stuck",
        realmSlug: "draenor",
        region: "eu",
        attempts: 5,
      }],
    });
    mediaModel.distinct = async () => [];
    mediaModel.bulkWrite = async (operations: Array<Record<string, any>>) => {
      captured.mediaOperations = operations;
      return { upsertedCount: 1 };
    };
    queueModel.updateMany = async (_filter: Record<string, any>, update: Record<string, any>) => {
      captured.queueUpdates.push(update);
      return { modifiedCount: captured.queueUpdates.length === 1 ? 1 : 0 };
    };

    const recovered = await new CharacterMediaService().recoverStaleProcessing();

    assert.equal(recovered, 1);
    assert.equal(captured.mediaOperations?.[0].updateOne.update.$set.status, "failed");
    assert.equal(captured.mediaOperations?.[0].updateOne.update.$set.lastErrorCode, "stale_processing");
    assert.equal(captured.queueUpdates[0].$set.status, "failed");
    assert.equal(captured.queueUpdates[0].$set.lastErrorCode, "stale_processing");
  } finally {
    queueModel.find = originals.queueFind;
    queueModel.updateMany = originals.queueUpdateMany;
    mediaModel.distinct = originals.mediaDistinct;
    mediaModel.bulkWrite = originals.mediaBulkWrite;
  }
});

test("reports live queue totals and the latest persisted discovery progress", async () => {
  const mediaModel = CharacterMedia as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const taskLogModel = TaskLog as any;
  const originals = {
    queueAggregate: queueModel.aggregate,
    queueFind: queueModel.find,
    mediaAggregate: mediaModel.aggregate,
    taskFindOne: taskLogModel.findOne,
    cardAggregate: (CcgCard as any).aggregate,
    assetGetStats: characterRenderStorageService.getStats,
  };
  const startedAt = new Date("2026-07-26T01:30:00.000Z");

  try {
    queueModel.aggregate = async () => [
      { _id: "pending", count: 8 },
      { _id: "completed", count: 21 },
      { _id: "failed", count: 2 },
    ];
    mediaModel.aggregate = async () => [{ _id: "available", count: 19 }];
    (CcgCard as any).aggregate = async () => [
      { _id: 0, count: 16 },
      { _id: 1, count: 2 },
      { _id: 2, count: 1 },
    ];
    queueModel.find = () => ({
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      select() {
        return this;
      },
      lean: async () => [],
    });
    taskLogModel.findOne = () => ({
      sort() {
        return this;
      },
      lean: async () => ({
        status: "completed",
        startedAt,
        completedAt: new Date(startedAt.getTime() + 12_000),
        durationMs: 12_000,
        metadata: { scanned: 100, candidates: 31, queued: 29, eligibleCandidates: 11, generalCandidates: 20 },
      }),
    });
    characterRenderStorageService.getStats = async () => ({
      active: 19,
      activeBytes: 1_234,
      expired: 1,
      expiringWithinSevenDays: 2,
      purged: 3,
    });

    const status = await new CharacterMediaService().getStatus();

    assert.deepEqual(status.queue, { pending: 8, completed: 21, failed: 2 });
    assert.deepEqual(status.media, { available: 19 });
    assert.equal(status.discoveryRunning, false);
    assert.equal(status.lastDiscovery?.status, "completed");
    assert.equal(status.lastDiscovery?.scanned, 100);
    assert.equal(status.lastDiscovery?.candidates, 31);
    assert.equal(status.lastDiscovery?.queued, 29);
    assert.equal(status.assets.active, 19);
    assert.deepEqual(status.cardSeries, { active: 16, verificationPending: 2, archived: 1 });
  } finally {
    queueModel.aggregate = originals.queueAggregate;
    queueModel.find = originals.queueFind;
    mediaModel.aggregate = originals.mediaAggregate;
    taskLogModel.findOne = originals.taskFindOne;
    (CcgCard as any).aggregate = originals.cardAggregate;
    characterRenderStorageService.getStats = originals.assetGetStats;
  }
});
