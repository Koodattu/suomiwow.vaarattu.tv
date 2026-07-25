import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterMedia from "../src/models/CharacterMedia";
import CharacterMediaFetchQueue from "../src/models/CharacterMediaFetchQueue";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterTierListEntry from "../src/models/CharacterTierListEntry";
import {
  CharacterMediaService,
  getCharacterMediaFailureTransition,
} from "../src/services/character-media.service";

type QueueRow = {
  _id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  region: string;
};

type TestableCharacterMediaService = {
  enqueueRows(rows: QueueRow[], priority: number, force?: boolean): Promise<number>;
};

test("prioritizes missing CCG characters by newest raid before the general character backlog", async () => {
  const characterModel = Character as any;
  const tierEntryModel = CharacterTierListEntry as any;
  const participationModel = CharacterRaidParticipation as any;
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
    aggregate: characterModel.aggregate,
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
    participationModel.find = (filter: { zoneId: number }) => ({
      select() {
        return this;
      },
      lean: async () => {
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
    assert.equal(result.eligibleCandidates, 3);
    assert.equal(result.generalCandidates, 1);
    assert.equal(result.queued, 4);
    assert.equal(result.raidSets.find((set) => set.zoneId === 46)?.candidates, 2);
    assert.equal(result.raidSets.find((set) => set.zoneId === 44)?.candidates, 1);
  } finally {
    characterModel.aggregate = originals.aggregate;
    tierEntryModel.find = originals.tierFind;
    participationModel.find = originals.participationFind;
    queueModel.bulkWrite = originals.bulkWrite;
    queueModel.updateMany = originals.updateMany;
  }
});

test("requeues terminal queue entries with a fresh per-run attempt budget", async () => {
  const queueModel = CharacterMediaFetchQueue as any;
  const originals = {
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
    assert.deepEqual(captured.filter?.status, { $in: ["completed", "failed", "not_found"] });
    assert.equal(captured.update?.$set.status, "pending");
    assert.equal(captured.update?.$set.attempts, 0);
    assert.equal(captured.update?.$set.completedAt, null);
  } finally {
    queueModel.bulkWrite = originals.bulkWrite;
    queueModel.updateMany = originals.updateMany;
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
