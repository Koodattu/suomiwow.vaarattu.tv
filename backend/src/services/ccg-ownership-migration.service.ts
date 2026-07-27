import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { CCG_FINISH_ORDER, CcgFinish } from "../config/ccg";
import CcgCard from "../models/CcgCard";
import CcgJobLock from "../models/CcgJobLock";
import CcgMigration from "../models/CcgMigration";
import CcgOwnership from "../models/CcgOwnership";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import logger from "../utils/logger";

const SERIES_MIGRATION_KEY = "ccg-series-ownership-v1";
const SNAPSHOT_UNLOCK_MIGRATION_KEY = "ccg-explicit-snapshot-unlocks-v2";
const LOCK_DURATION_MS = 10 * 60 * 1000;
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH_SIZE = 500;

type OwnershipGroup = {
  _id: {
    ownerType: "user" | "guest";
    ownerId: mongoose.Types.ObjectId;
    setId: mongoose.Types.ObjectId;
    characterId: mongoose.Types.ObjectId;
    finish: string;
  };
  keeperId: mongoose.Types.ObjectId;
  rowIds: mongoose.Types.ObjectId[];
  cardId: mongoose.Types.ObjectId;
  quantity: number;
  alternativeQuantity: number;
  firstAcquiredAt: Date;
  lastAcquiredAt: Date;
  dateKey?: string | null;
  expiresAt?: Date | null;
  snapshotVersions: number[];
};

type UnresolvedOwnershipRow = {
  cardId?: unknown;
  finish?: unknown;
};

export function isValidUnresolvedCardReference(row: UnresolvedOwnershipRow): boolean {
  return mongoose.Types.ObjectId.isValid(row.cardId as string)
    && CCG_FINISH_ORDER.includes(row.finish as CcgFinish);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function acquireLock(migrationKey: string): Promise<string | null> {
  const owner = randomUUID();
  const lockKey = `migration:${migrationKey}`;
  const now = new Date();
  await CcgJobLock.deleteOne({ key: lockKey, expiresAt: { $lte: now } });
  try {
    await CcgJobLock.create({ key: lockKey, owner, expiresAt: new Date(now.getTime() + LOCK_DURATION_MS) });
    return owner;
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

async function flushGroups(groups: OwnershipGroup[]): Promise<{ rows: number; sourceRows: number; merged: number }> {
  if (groups.length === 0) return { rows: 0, sourceRows: 0, merged: 0 };
  const ownershipOperations: mongoose.AnyBulkWriteOperation[] = [];
  const seriesOperations: mongoose.AnyBulkWriteOperation[] = [];
  let merged = 0;

  for (const group of groups) {
    const duplicateIds = group.rowIds.filter((id) => !id.equals(group.keeperId));
    if (duplicateIds.length > 0) {
      merged += duplicateIds.length;
      ownershipOperations.push({ deleteMany: { filter: { _id: { $in: duplicateIds } } } });
    }
    ownershipOperations.push({
      updateOne: {
        filter: { _id: group.keeperId },
        update: {
          $set: {
            setId: group._id.setId,
            characterId: group._id.characterId,
            cardId: group.cardId,
            quantity: group.quantity,
            alternativeQuantity: group.alternativeQuantity,
            firstAcquiredAt: group.firstAcquiredAt,
            lastAcquiredAt: group.lastAcquiredAt,
            dateKey: group.dateKey ?? null,
            expiresAt: group.expiresAt ?? null,
          },
        },
      },
    });
    seriesOperations.push({
      updateOne: {
        filter: {
          ownerType: group._id.ownerType,
          ownerId: group._id.ownerId,
          setId: group._id.setId,
          characterId: group._id.characterId,
        },
        update: {
          $addToSet: {
            unlockedSnapshotVersions: { $each: group.snapshotVersions },
          },
          $min: {
            firstAcquiredAt: group.firstAcquiredAt,
          },
          $max: { lastAcquiredAt: group.lastAcquiredAt },
          $set: {
            dateKey: group.dateKey ?? null,
            expiresAt: group.expiresAt ?? null,
          },
        },
        upsert: true,
      },
    });
  }

  await CcgOwnership.bulkWrite(ownershipOperations, { ordered: true });
  await CcgSeriesOwnership.bulkWrite(seriesOperations, { ordered: false });
  return {
    rows: groups.length,
    sourceRows: groups.reduce((total, group) => total + group.rowIds.length, 0),
    merged,
  };
}

async function runMigration(): Promise<{ rows: number; merged: number; ignoredMalformedRows: number }> {
  const sourceRowCount = await CcgOwnership.countDocuments({});
  const cursor = CcgOwnership.aggregate<OwnershipGroup>([
    {
      $lookup: {
        from: CcgCard.collection.name,
        localField: "cardId",
        foreignField: "_id",
        as: "card",
      },
    },
    { $unwind: "$card" },
    { $sort: { firstAcquiredAt: 1, _id: 1 } },
    {
      $group: {
        _id: {
          ownerType: "$ownerType",
          ownerId: "$ownerId",
          setId: { $ifNull: ["$setId", "$card.setId"] },
          characterId: { $ifNull: ["$characterId", "$card.characterId"] },
          finish: "$finish",
        },
        keeperId: { $first: "$_id" },
        rowIds: { $push: "$_id" },
        cardId: { $first: "$cardId" },
        quantity: { $sum: "$quantity" },
        alternativeQuantity: { $max: { $ifNull: ["$alternativeQuantity", 0] } },
        firstAcquiredAt: { $min: "$firstAcquiredAt" },
        lastAcquiredAt: { $max: "$lastAcquiredAt" },
        dateKey: { $first: "$dateKey" },
        expiresAt: { $max: "$expiresAt" },
        snapshotVersions: { $addToSet: { $ifNull: ["$card.snapshotVersion", 1] } },
      },
    },
  ]).allowDiskUse(true).cursor({ batchSize: BATCH_SIZE });

  let rows = 0;
  let sourceRows = 0;
  let merged = 0;
  let batch: OwnershipGroup[] = [];
  for await (const group of cursor) {
    batch.push(group);
    if (batch.length < BATCH_SIZE) continue;
    const result = await flushGroups(batch);
    rows += result.rows;
    sourceRows += result.sourceRows;
    merged += result.merged;
    batch = [];
  }
  const result = await flushGroups(batch);
  rows += result.rows;
  sourceRows += result.sourceRows;
  merged += result.merged;

  const unresolvedRows = await CcgOwnership.aggregate<{ _id: mongoose.Types.ObjectId } & UnresolvedOwnershipRow>([
    {
      $lookup: {
        from: CcgCard.collection.name,
        localField: "cardId",
        foreignField: "_id",
        as: "card",
      },
    },
    { $match: { card: { $size: 0 } } },
    { $project: { cardId: 1, finish: 1 } },
  ]);
  const unresolvedCardReferences = unresolvedRows.filter(isValidUnresolvedCardReference);
  if (unresolvedCardReferences.length > 0) {
    throw new Error(`CCG ownership migration could not resolve ${unresolvedCardReferences.length} card references`);
  }
  if (sourceRows + unresolvedRows.length !== sourceRowCount) {
    throw new Error("CCG ownership changed while its series migration was running");
  }
  if (unresolvedRows.length > 0) {
    logger.warn(`[CCG] Preserved ${unresolvedRows.length} malformed ownership rows without a card or finish; they are excluded from collections`);
  }

  await CcgOwnership.collection.createIndex(
    { ownerType: 1, ownerId: 1, setId: 1, characterId: 1, finish: 1 },
    {
      unique: true,
      name: "ccg_ownership_owner_series_finish",
      partialFilterExpression: { setId: { $type: "objectId" }, characterId: { $type: "objectId" } },
    },
  );
  await CcgSeriesOwnership.createIndexes();
  return { rows, merged, ignoredMalformedRows: unresolvedRows.length };
}

type SnapshotUnlockMigrationRow = {
  _id: mongoose.Types.ObjectId;
  unlockedSnapshotVersions?: unknown;
  unlockedFromSnapshotVersion?: unknown;
  originCards?: Array<{ snapshotVersion?: unknown }>;
};

export function resolveUnlockedSnapshotVersions(row: Omit<SnapshotUnlockMigrationRow, "_id">): number[] {
  const versions = [
    ...(Array.isArray(row.unlockedSnapshotVersions) ? row.unlockedSnapshotVersions : []),
    row.unlockedFromSnapshotVersion,
    ...(row.originCards ?? []).map((card) => card.snapshotVersion),
  ].filter((version): version is number => Number.isSafeInteger(version) && Number(version) >= 1);
  return Array.from(new Set(versions)).sort((left, right) => left - right);
}

async function flushSnapshotUnlockRows(rows: SnapshotUnlockMigrationRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const operations = rows.map((row) => {
    const versions = resolveUnlockedSnapshotVersions(row);
    if (versions.length === 0) {
      throw new Error(`CCG snapshot unlock migration could not resolve ownership ${row._id}`);
    }
    return {
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: { unlockedSnapshotVersions: versions },
          $unset: { unlockedFromSnapshotVersion: "" },
        },
      },
    };
  });
  await CcgSeriesOwnership.collection.bulkWrite(operations, { ordered: false });
  return rows.length;
}

async function runSnapshotUnlockMigration(): Promise<{ rows: number }> {
  const cursor = CcgSeriesOwnership.collection.aggregate<SnapshotUnlockMigrationRow>([
    {
      $lookup: {
        from: CcgOwnership.collection.name,
        let: {
          ownerType: "$ownerType",
          ownerId: "$ownerId",
          setId: "$setId",
          characterId: "$characterId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$ownerType", "$$ownerType"] },
                  { $eq: ["$ownerId", "$$ownerId"] },
                  { $eq: ["$setId", "$$setId"] },
                  { $eq: ["$characterId", "$$characterId"] },
                ],
              },
            },
          },
          { $project: { cardId: 1 } },
        ],
        as: "originOwnership",
      },
    },
    {
      $lookup: {
        from: CcgCard.collection.name,
        localField: "originOwnership.cardId",
        foreignField: "_id",
        as: "originCards",
      },
    },
    {
      $project: {
        unlockedSnapshotVersions: 1,
        unlockedFromSnapshotVersion: 1,
        "originCards.snapshotVersion": 1,
      },
    },
  ], { allowDiskUse: true }).batchSize(BATCH_SIZE);

  let migratedRows = 0;
  let batch: SnapshotUnlockMigrationRow[] = [];
  for await (const row of cursor) {
    batch.push(row);
    if (batch.length < BATCH_SIZE) continue;
    migratedRows += await flushSnapshotUnlockRows(batch);
    batch = [];
  }
  migratedRows += await flushSnapshotUnlockRows(batch);
  return { rows: migratedRows };
}

async function ensureMigration(
  migrationKey: string,
  run: () => Promise<Record<string, number>>,
  describe: (details: Record<string, number>) => string,
): Promise<void> {
  if (await CcgMigration.exists({ key: migrationKey })) return;
  const lockOwner = await acquireLock(migrationKey);
  if (!lockOwner) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
      if (await CcgMigration.exists({ key: migrationKey })) return;
      await wait(250);
    }
    throw new Error(`Timed out waiting for CCG migration ${migrationKey}`);
  }

  try {
    if (await CcgMigration.exists({ key: migrationKey })) return;
    const details = await run();
    await CcgMigration.create({ key: migrationKey, completedAt: new Date(), details });
    logger.info(describe(details));
  } finally {
    await CcgJobLock.deleteOne({ key: `migration:${migrationKey}`, owner: lockOwner })
      .catch((error) => logger.error("[CCG] Failed to release the ownership migration lock:", error));
  }
}

export async function ensureCcgSeriesOwnershipMigration(): Promise<void> {
  await ensureMigration(
    SERIES_MIGRATION_KEY,
    runMigration,
    (details) => `[CCG] Migrated ${details.rows} finish ownership rows to card-series ownership (${details.merged} merged, ${details.ignoredMalformedRows} malformed rows preserved)`,
  );
  await ensureMigration(
    SNAPSHOT_UNLOCK_MIGRATION_KEY,
    runSnapshotUnlockMigration,
    (details) => `[CCG] Migrated ${details.rows} card series to explicit snapshot unlocks`,
  );
}
