import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import mongoose from "mongoose";
import GuildNetworkSnapshot from "../src/models/GuildNetworkSnapshot";
import GuildNetworkSnapshotChunk from "../src/models/GuildNetworkSnapshotChunk";
import guildNetworkMovementService from "../src/services/guild-network-movement.service";
import guildNetworkService from "../src/services/guild-network.service";

const service = guildNetworkService as any;
const movementService = guildNetworkMovementService as any;
const snapshotModel = GuildNetworkSnapshot as any;
const snapshotChunkModel = GuildNetworkSnapshotChunk as any;

const originals = {
  buildUniversePayload: service.buildUniversePayload,
  pruneOldSnapshots: service.pruneOldSnapshots,
  rebuildBatch: movementService.rebuildBatch,
  discardBatch: movementService.discardBatch,
  snapshotCreate: snapshotModel.create,
  snapshotUpdateMany: snapshotModel.updateMany,
  snapshotDeleteOne: snapshotModel.deleteOne,
  chunkInsertMany: snapshotChunkModel.insertMany,
  chunkDeleteMany: snapshotChunkModel.deleteMany,
};

function universePayload() {
  return {
    schemaVersion: 3,
    generatedAt: "2026-07-19T12:00:00.000Z",
    sourceUpdatedAt: null,
    rowCount: 0,
    tiers: [
      {
        id: 46,
        name: "Test Raid",
        expansion: "Midnight",
        start: null,
        end: null,
        participations: 0,
      },
    ],
    realms: [],
    guilds: [],
    guildKeys: [],
    characters: [],
    accounts: [],
  };
}

afterEach(() => {
  service.buildUniversePayload = originals.buildUniversePayload;
  service.pruneOldSnapshots = originals.pruneOldSnapshots;
  service.isRebuilding = false;
  movementService.rebuildBatch = originals.rebuildBatch;
  movementService.discardBatch = originals.discardBatch;
  snapshotModel.create = originals.snapshotCreate;
  snapshotModel.updateMany = originals.snapshotUpdateMany;
  snapshotModel.deleteOne = originals.snapshotDeleteOne;
  snapshotChunkModel.insertMany = originals.chunkInsertMany;
  snapshotChunkModel.deleteMany = originals.chunkDeleteMany;
});

test("discards a movement batch when parent snapshot creation fails", async () => {
  let builtBatchId: string | null = null;
  let discardedBatchId: string | null = null;
  const failure = new Error("snapshot create failed");

  service.buildUniversePayload = async () => universePayload();
  movementService.rebuildBatch = async (batchId: string) => {
    builtBatchId = batchId;
    return { raidCount: 1, reportCount: 0, rowCount: 0 };
  };
  movementService.discardBatch = async (batchId: string) => {
    discardedBatchId = batchId;
  };
  snapshotModel.create = async () => {
    throw failure;
  };

  await assert.rejects(service.rebuildSnapshot(), failure);
  assert.ok(builtBatchId);
  assert.equal(discardedBatchId, builtBatchId);
});

test("removes an unpublished parent snapshot and movement batch when chunk insertion fails", async () => {
  const snapshotId = new mongoose.Types.ObjectId();
  let builtBatchId: string | null = null;
  let discardedBatchId: string | null = null;
  let deletedChunkSnapshotId: string | null = null;
  let deletedSnapshotId: string | null = null;
  const failure = new Error("chunk insertion failed");

  service.buildUniversePayload = async () => universePayload();
  movementService.rebuildBatch = async (batchId: string) => {
    builtBatchId = batchId;
    return { raidCount: 1, reportCount: 0, rowCount: 0 };
  };
  movementService.discardBatch = async (batchId: string) => {
    discardedBatchId = batchId;
  };
  snapshotModel.create = async (values: Record<string, unknown>) => ({ ...values, _id: snapshotId });
  snapshotChunkModel.insertMany = async () => {
    throw failure;
  };
  snapshotChunkModel.deleteMany = async ({ snapshotId: id }: { snapshotId: mongoose.Types.ObjectId }) => {
    deletedChunkSnapshotId = String(id);
  };
  snapshotModel.deleteOne = async ({ _id }: { _id: mongoose.Types.ObjectId }) => {
    deletedSnapshotId = String(_id);
  };

  await assert.rejects(service.rebuildSnapshot(), failure);
  assert.equal(deletedChunkSnapshotId, String(snapshotId));
  assert.equal(deletedSnapshotId, String(snapshotId));
  assert.equal(discardedBatchId, builtBatchId);
});

test("publishes the replacement before deactivating older snapshots", async () => {
  const snapshotId = new mongoose.Types.ObjectId();
  const events: string[] = [];

  service.buildUniversePayload = async () => universePayload();
  movementService.rebuildBatch = async () => ({ raidCount: 1, reportCount: 0, rowCount: 0 });
  movementService.discardBatch = async () => {
    events.push("discard");
  };
  snapshotModel.create = async (values: Record<string, unknown>) => ({
    ...values,
    _id: snapshotId,
    save: async () => {
      events.push("save");
    },
  });
  snapshotChunkModel.insertMany = async () => {
    events.push("chunks");
  };
  snapshotModel.updateMany = async () => {
    events.push("deactivate");
  };
  service.pruneOldSnapshots = async () => {
    events.push("prune");
  };

  const result = await service.rebuildSnapshot();

  assert.equal(result.movementReady, true);
  assert.ok(events.indexOf("save") > events.indexOf("chunks"));
  assert.ok(events.indexOf("deactivate") > events.indexOf("save"));
  assert.ok(events.indexOf("prune") > events.indexOf("deactivate"));
  assert.equal(events.includes("discard"), false);
});
