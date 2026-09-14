import assert from "node:assert/strict";
import test, { after, before, beforeEach, mock } from "node:test";
import mongoose from "mongoose";
import { getCcgPackFinishOrder } from "../src/config/ccg";
import CcgCard from "../src/models/CcgCard";
import CcgJobLock from "../src/models/CcgJobLock";
import CcgLeaderboardEntry from "../src/models/CcgLeaderboardEntry";
import CcgOwnership from "../src/models/CcgOwnership";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import CcgSet from "../src/models/CcgSet";
import User from "../src/models/User";
import leaderboard from "../src/services/ccg-leaderboard.service";

// Only the dedicated disposable MongoDB port is used; never load deployment credentials.
const database = `ccg_leaderboard_test_${process.pid}`;
const models = [CcgCard, CcgJobLock, CcgLeaderboardEntry, CcgOwnership, CcgSeriesOwnership, CcgSet, User];
const id = () => new mongoose.Types.ObjectId();
const owners = [1, 2, 3, 4].map((value) => new mongoose.Types.ObjectId(value.toString(16).padStart(24, "0")));
const deletedOwner = id();
const raid = id(), community = id(), disabled = id();
const characters = [id(), id(), id()];
const acquiredAt = new Date("2026-09-01T00:00:00Z");
const allRaidFinishes = getCcgPackFinishOrder("raid", "felforged");

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27138/${database}?directConnection=true`, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000,
  });
  for (const model of models) await model.createCollection();
  for (const model of [CcgCard, CcgJobLock, CcgLeaderboardEntry, CcgOwnership, CcgSeriesOwnership]) {
    await model.createIndexes();
  }
});

after(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  for (const model of models) await model.collection.deleteMany({});
  await CcgSet.collection.insertMany([
    { _id: raid, kind: "raid", customFinish: { key: "felforged" }, cardCount: 2, enabledAt: acquiredAt },
    { _id: community, kind: "community", cardCount: 1, enabledAt: acquiredAt },
    { _id: disabled, kind: "raid", cardCount: 1, enabledAt: null },
  ]);
  const cards = [
    { _id: id(), setId: raid, characterId: characters[0], setNumber: 1, snapshotVersion: 1, tierGrade: "S", availabilityStatus: "active" },
    { _id: id(), setId: raid, characterId: characters[0], setNumber: 1, snapshotVersion: 2, tierGrade: "B", availabilityStatus: "archived" },
    { _id: id(), setId: raid, characterId: characters[0], setNumber: 1, snapshotVersion: 3, tierGrade: "H", availabilityStatus: "active" },
    { _id: id(), setId: raid, characterId: characters[1], setNumber: 2, snapshotVersion: 1, tierGrade: "F", availabilityStatus: null },
    { _id: id(), setId: raid, characterId: characters[2], setNumber: 3, snapshotVersion: 1, tierGrade: "H", availabilityStatus: "archived" },
    { _id: id(), setId: community, characterId: characters[0], setNumber: 1, snapshotVersion: 1, tierGrade: "C" },
    { _id: id(), setId: disabled, characterId: characters[0], setNumber: 1, snapshotVersion: 1, tierGrade: "H" },
  ];
  await CcgCard.collection.insertMany(cards);
  await User.collection.insertMany(owners.map((ownerId, index) => ({
    _id: ownerId, discord: { id: String(index + 1000), username: `Collector ${index}`, avatar: null },
  })));
  for (const ownerId of [...owners.slice(0, 3), deletedOwner]) {
    for (const card of [cards[0], cards[3], cards[4], cards[5], cards[6]]) {
      const firstAcquiredAt = ownerId.equals(owners[2]) ? new Date(acquiredAt.getTime() - 1000) : acquiredAt;
      await CcgSeriesOwnership.collection.insertOne({
        ownerType: "user", ownerId, setId: card.setId, characterId: card.characterId,
        unlockedSnapshotVersions: card === cards[0] ? [1, 2, 2, 99] : [1], firstAcquiredAt, lastAcquiredAt: acquiredAt,
      });
      for (const finish of card === cards[0] ? allRaidFinishes : ["standard"]) {
        await CcgOwnership.collection.insertOne({
          ownerType: "user", ownerId, setId: card.setId, characterId: card.characterId, cardId: card._id,
          finish, quantity: 10, alternativeQuantity: 4, firstAcquiredAt, lastAcquiredAt: acquiredAt,
        });
      }
    }
  }
  // Sharing a character and even an owner ID must not leak a guest's finish into a user score.
  await CcgOwnership.collection.insertOne({ ownerType: "guest", ownerId: owners[0], setId: community, characterId: characters[0], cardId: cards[5]._id, finish: "astral" });
  await CcgSeriesOwnership.collection.insertMany([
    { ownerType: "guest", ownerId: owners[3], setId: raid, characterId: characters[0], unlockedSnapshotVersions: [3], firstAcquiredAt: acquiredAt },
    // A series with no matching finish ownership is omitted.
    { ownerType: "user", ownerId: owners[3], setId: community, characterId: characters[1], unlockedSnapshotVersions: [1], firstAcquiredAt: acquiredAt },
    // An owned archived-only series retains score but cannot complete the live raid.
    { ownerType: "user", ownerId: owners[3], setId: raid, characterId: characters[2], unlockedSnapshotVersions: [1], firstAcquiredAt: acquiredAt, lastAcquiredAt: acquiredAt },
  ]);
  await CcgOwnership.collection.insertOne({ ownerType: "user", ownerId: owners[3], setId: raid, characterId: characters[2], cardId: cards[4]._id, finish: "standard", firstAcquiredAt: acquiredAt });
});

async function entries() {
  return CcgLeaderboardEntry.collection.find({}, { projection: { _id: 0, calculatedAt: 0 } }).sort({ rank: 1 }).toArray();
}

test("optimized full rebuild preserves original scores, snapshots, completion and tie breaks", async () => {
  const originalAggregate = CcgSeriesOwnership.aggregate;
  const baseline = mock.method(CcgSeriesOwnership, "aggregate", (pipeline: mongoose.PipelineStage[] = []) => {
    const stages = pipeline.map((stage: any) => {
      if (stage.$lookup?.as !== "finishes") return stage;
      const match = stage.$lookup.pipeline[0].$match;
      const { setId: _setType, characterId: _characterType, ...originalMatch } = match;
      return { $lookup: { ...stage.$lookup, pipeline: [{ $match: originalMatch }, ...stage.$lookup.pipeline.slice(1)] } };
    });
    return originalAggregate.call(CcgSeriesOwnership, stages);
  });
  let beforeEntries;
  try {
    await leaderboard.refresh("full");
    beforeEntries = await entries();
  } finally {
    baseline.mock.restore();
  }
  const result = await leaderboard.refresh("full");
  const afterEntries = await entries();
  assert.deepEqual(afterEntries, beforeEntries);
  assert.equal(result.participants, 4);
  assert.deepEqual(afterEntries.map((entry) => String(entry.userId)), [owners[2], owners[0], owners[1], owners[3]].map(String));
  const main = afterEntries[0];
  assert.equal(main.cardsOwned, 4);
  assert.equal(main.snapshotsOwned, 6);
  assert.equal(main.breakdown.rarity, 70); // Best explicitly unlocked grade, including archived-only ownership.
  assert.equal(main.breakdown.collection, 400);
  assert.equal(main.completedCards, 1);
  assert.equal(main.completedSets, 2);
  assert.equal(main.breakdown.completedSets, 300);
  assert.equal(main.finishesOwned, allRaidFinishes.length + 3);
  assert.equal(main.finishCounts.astral, 1);
  assert.equal(afterEntries[3].completedSets, 0);
  assert.equal(afterEntries[3].cardsOwned, 1);
  assert.equal(await CcgJobLock.countDocuments({}), 0);
});

test("incremental recalculation and a subsequent full rebuild produce the same ranks and values", async () => {
  await leaderboard.refresh("full");
  await CcgOwnership.collection.updateOne(
    { ownerType: "user", ownerId: owners[0], setId: community }, { $set: { finish: "astral" } },
  );
  await CcgSeriesOwnership.collection.updateOne(
    { ownerType: "user", ownerId: owners[0], setId: community }, { $set: { lastAcquiredAt: new Date() } },
  );
  const result = await leaderboard.refresh("incremental");
  assert.equal(result.mode, "incremental");
  assert.equal(result.changedCollectors, 1);
  const incremental = await entries();
  await leaderboard.refresh("full");
  assert.deepEqual(await entries(), incremental);
  assert.equal(String(incremental[0].userId), String(owners[0]));
  assert.equal(incremental[0].finishCounts.astral, 2);
});

test("finish lookup uses the existing partial compound index without scanning other collectors", async () => {
  const originalAggregate = CcgSeriesOwnership.aggregate;
  let captured: mongoose.PipelineStage[] = [];
  const capture = mock.method(CcgSeriesOwnership, "aggregate", (pipeline: mongoose.PipelineStage[] = []) => {
    captured = pipeline;
    return originalAggregate.call(CcgSeriesOwnership, pipeline);
  });
  try {
    await leaderboard.refresh("full");
  } finally {
    capture.mock.restore();
  }
  const explanation = await CcgSeriesOwnership.collection.aggregate(captured, { maxTimeMS: 10_000 }).explain("executionStats");
  const finishJoin = explanation.stages.find((stage: any) => stage.$lookup?.as === "finishes");
  assert.ok(finishJoin.indexesUsed.includes("ccg_ownership_owner_series_finish"));
  assert.equal(finishJoin.collectionScans, 0);
  assert.ok(finishJoin.totalDocsExamined <= await CcgOwnership.countDocuments({ ownerType: "user" }));
});
