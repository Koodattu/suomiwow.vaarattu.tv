import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterMedia from "../src/models/CharacterMedia";
import CharacterMediaFetchQueue from "../src/models/CharacterMediaFetchQueue";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterTierListEntry from "../src/models/CharacterTierListEntry";
import CcgCard from "../src/models/CcgCard";
import TaskLog from "../src/models/TaskLog";
import {
  CharacterMediaService,
  getCharacterMediaFailureTransition,
  syncCharacterCardsFromMedia,
} from "../src/services/character-media.service";
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

test("propagates corrected character media to existing CCG cards", async () => {
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
      mainRawUrl: "https://example.test/current-main.jpg",
      avatarUrl: "https://example.test/current-avatar.jpg",
      fetchedAt: new Date("2026-07-29T12:00:00.000Z"),
    });

    assert.equal(modified, 3);
    assert.equal(String(capturedFilter?.characterId), String(characterId));
    assert.equal(capturedUpdate?.$set.renderUrl, "https://example.test/current-main.jpg");
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
  };
  const startedAt = new Date("2026-07-26T01:30:00.000Z");

  try {
    queueModel.aggregate = async () => [
      { _id: "pending", count: 8 },
      { _id: "completed", count: 21 },
      { _id: "failed", count: 2 },
    ];
    mediaModel.aggregate = async () => [{ _id: "available", count: 19 }];
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

    const status = await new CharacterMediaService().getStatus();

    assert.deepEqual(status.queue, { pending: 8, completed: 21, failed: 2 });
    assert.deepEqual(status.media, { available: 19 });
    assert.equal(status.discoveryRunning, false);
    assert.equal(status.lastDiscovery?.status, "completed");
    assert.equal(status.lastDiscovery?.scanned, 100);
    assert.equal(status.lastDiscovery?.candidates, 31);
    assert.equal(status.lastDiscovery?.queued, 29);
  } finally {
    queueModel.aggregate = originals.queueAggregate;
    queueModel.find = originals.queueFind;
    mediaModel.aggregate = originals.mediaAggregate;
    taskLogModel.findOne = originals.taskFindOne;
  }
});
