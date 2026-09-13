import mongoose, { ClientSession } from "mongoose";
import { CCG_TIME_ZONE } from "../config/ccg";
import CcgAnalyticsDaily from "../models/CcgAnalyticsDaily";
import CcgCard from "../models/CcgCard";
import CcgCollectorProfile from "../models/CcgCollectorProfile";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgMigration from "../models/CcgMigration";
import CcgOwnership from "../models/CcgOwnership";
import CcgPackOpening from "../models/CcgPackOpening";
import CcgRedeemClaim from "../models/CcgRedeemClaim";
import CcgRedeemCode from "../models/CcgRedeemCode";
import CcgSet from "../models/CcgSet";
import CcgShare from "../models/CcgShare";
import TwitchCcgOverlayEvent from "../models/TwitchCcgOverlayEvent";
import TwitchCcgRedemption from "../models/TwitchCcgRedemption";
import ccgLeaderboardService from "./ccg-leaderboard.service";

export const CCG_ANTORUS_FINISH_MIGRATION_KEY = "ccg-antorus-felforged-v1";
const MIGRATION_REQUIRED = "CCG Antorus finish migration is required; stop API and workers, then run npm run migrate:ccg-antorus-finish -- --apply --writers-stopped";

type MigrationTarget = {
  name: string;
  collection: mongoose.Collection;
  filter: mongoose.mongo.Filter<mongoose.mongo.Document>;
  update: mongoose.mongo.UpdateFilter<mongoose.mongo.Document>;
  arrayFilters?: mongoose.mongo.Document[];
};

export type CcgAntorusFinishMigrationPlan = {
  setFound: boolean;
  cards: number;
  documents: Record<string, number>;
  analyticsDays: number;
  analyticsResults: number;
  ownershipConflicts: number;
  shareConflicts: number;
  dataMigrated: boolean;
  leaderboardRefreshed: boolean;
};

async function loadPlan(session?: ClientSession) {
  const options = { session };
  const sets = await CcgSet.collection.find({ $or: [{ zoneId: 17 }, { slug: "antorus" }] }, options).toArray();
  if (sets.length > 1 || (sets[0] && (sets[0].zoneId !== 17 || sets[0].slug !== "antorus"))) {
    throw new Error("Antorus set identity is ambiguous; no changes were made");
  }
  const set = sets[0];
  if (set && !["worldcore", "felforged"].includes(set.customFinish?.key)) {
    throw new Error("Antorus has an unexpected custom finish; no changes were made");
  }
  const marker = await CcgMigration.collection.findOne({ key: CCG_ANTORUS_FINISH_MIGRATION_KEY }, options);
  const cards = set ? await CcgCard.collection.find({ setId: set._id }, { ...options, projection: { _id: 1 } }).toArray() : [];
  const cardIds = cards.map((card) => card._id);
  const cardMatch = { $in: cardIds };
  const ledgerCardMatch = { $in: cardIds.map(String) };
  const targets: MigrationTarget[] = [];
  if (set) {
    targets.push({
      name: "set", collection: CcgSet.collection,
      filter: { _id: set._id, "customFinish.key": "worldcore" },
      update: { $set: { "customFinish.key": "felforged" } },
    }, {
      name: "ownership", collection: CcgOwnership.collection,
      filter: { setId: set._id, finish: "worldcore" },
      update: { $set: { finish: "felforged" } },
    });
  }
  for (const [name, collection] of [
    ["shares", CcgShare.collection], ["redeemCodes", CcgRedeemCode.collection],
    ["redeemClaims", CcgRedeemClaim.collection], ["twitchOverlayEvents", TwitchCcgOverlayEvent.collection],
  ] as const) {
    targets.push({ name, collection, filter: { cardId: cardMatch, finish: "worldcore" }, update: { $set: { finish: "felforged" } } });
  }
  for (const [name, collection, path, match] of [
    ["packOpenings", CcgPackOpening.collection, "results", cardMatch],
    ["showcases", CcgCollectorProfile.collection, "showcase", cardMatch],
    ["twitchAssignedCards", TwitchCcgRedemption.collection, "assignedCards", cardMatch],
    ["ledgerCards", CcgLedgerEntry.collection, "metadata.cards", ledgerCardMatch],
  ] as const) {
    targets.push({
      name, collection,
      filter: { [path]: { $elemMatch: { cardId: match, finish: "worldcore" } } },
      update: { $set: { [`${path}.$[card].finish`]: "felforged" } },
      arrayFilters: [{ "card.cardId": match, "card.finish": "worldcore" }],
    });
  }
  for (const [name, collection, path, match] of [
    ["twitchAssignedCard", TwitchCcgRedemption.collection, "assignedCard", cardMatch],
    ["ledgerRewards", CcgLedgerEntry.collection, "metadata", ledgerCardMatch],
  ] as const) {
    targets.push({ name, collection, filter: { [`${path}.cardId`]: match, [`${path}.finish`]: "worldcore" }, update: { $set: { [`${path}.finish`]: "felforged" } } });
  }

  // Keep transaction operations sequential. Counts describe documents, not array elements.
  const documents: Record<string, number> = {};
  for (const target of targets) documents[target.name] = await target.collection.countDocuments(target.filter, options);

  let ownershipConflicts = 0;
  if (set) {
    const conflicts = await CcgOwnership.collection.aggregate([
      { $match: { setId: set._id, finish: { $in: ["worldcore", "felforged"] } } },
      { $group: { _id: { ownerType: "$ownerType", ownerId: "$ownerId", characterId: "$characterId" }, finishes: { $addToSet: "$finish" } } },
      { $match: { finishes: { $all: ["worldcore", "felforged"] } } },
      { $count: "count" },
    ], options).toArray();
    ownershipConflicts = conflicts[0]?.count ?? 0;
  }
  const shareConflicts = await CcgShare.collection.aggregate([
    { $match: { kind: "card", cardId: cardMatch, finish: { $in: ["worldcore", "felforged"] } } },
    { $group: { _id: { userId: "$userId", cardId: "$cardId", artVariant: "$artVariant" }, finishes: { $addToSet: "$finish" } } },
    { $match: { finishes: { $all: ["worldcore", "felforged"] } } },
    { $count: "count" },
  ], options).toArray();

  // Only move already-recorded results. Pending openings will record their new finish later.
  const dailyResults = await CcgPackOpening.collection.aggregate<{ _id: string; count: number }>([
    { $match: { state: "committed", analyticsPending: { $ne: true }, results: { $elemMatch: { cardId: cardMatch, finish: "worldcore" } } } },
    { $unwind: "$results" },
    { $match: { "results.cardId": cardMatch, "results.finish": "worldcore" } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: CCG_TIME_ZONE } }, count: { $sum: 1 } } },
  ], options).toArray();
  const analytics: Array<{ dateKey: string; count: number }> = [];
  for (const day of dailyResults) {
    const bucket = await CcgAnalyticsDaily.collection.findOne({ dateKey: day._id }, options);
    // A database without initialized detailed analytics will build it from migrated openings.
    if (!bucket) continue;
    if ((bucket.finishes?.worldcore ?? 0) < day.count) {
      throw new Error(`Antorus analytics are inconsistent for ${day._id}; no changes were made`);
    }
    analytics.push({ dateKey: day._id, count: day.count });
  }
  const plan: CcgAntorusFinishMigrationPlan = {
    setFound: Boolean(set), cards: cards.length, documents,
    analyticsDays: analytics.length, analyticsResults: analytics.reduce((sum, day) => sum + day.count, 0),
    ownershipConflicts, shareConflicts: shareConflicts[0]?.count ?? 0,
    dataMigrated: Boolean(marker), leaderboardRefreshed: Boolean(marker?.details?.leaderboardRefreshedAt),
  };
  return { plan, targets, analytics };
}

export async function planCcgAntorusFinishMigration(): Promise<CcgAntorusFinishMigrationPlan> {
  return (await loadPlan()).plan;
}

export async function migrateCcgAntorusFinish(): Promise<CcgAntorusFinishMigrationPlan> {
  const session = await mongoose.startSession();
  let completedPlan: CcgAntorusFinishMigrationPlan | undefined;
  try {
    await session.withTransaction(async () => {
      const { plan, targets, analytics } = await loadPlan(session);
      if (!plan.setFound) throw new Error("Antorus set was not found; no changes were made");
      if (plan.ownershipConflicts || plan.shareConflicts) {
        throw new Error("Conflicting Antorus Worldcore/Felforged ownership or shares exist; resolve them before migration. No records were deleted or merged");
      }
      if (plan.dataMigrated) {
        if (Object.values(plan.documents).some((count) => count > 0)) {
          throw new Error("Antorus migration marker exists but old references remain; stop all old writers and investigate");
        }
        completedPlan = plan;
        return;
      }
      for (const target of targets) {
        const result = await target.collection.updateMany(target.filter, target.update, { session, arrayFilters: target.arrayFilters });
        if (result.modifiedCount !== plan.documents[target.name]) throw new Error(`Antorus migration verification failed for ${target.name}`);
      }
      for (const day of analytics) {
        const result = await CcgAnalyticsDaily.collection.updateOne(
          { dateKey: day.dateKey, "finishes.worldcore": { $gte: day.count } },
          { $inc: { "finishes.worldcore": -day.count, "finishes.felforged": day.count } },
          { session },
        );
        if (result.modifiedCount !== 1) throw new Error("Antorus analytics changed during migration");
      }
      for (const target of targets) {
        if (await target.collection.countDocuments(target.filter, { session })) throw new Error(`Antorus migration left old references in ${target.name}`);
      }
      await CcgMigration.collection.insertOne({ key: CCG_ANTORUS_FINISH_MIGRATION_KEY, completedAt: new Date(), details: plan }, { session });
      completedPlan = { ...plan, dataMigrated: true };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
  if (!completedPlan) throw new Error("Antorus finish migration did not complete");
  return completedPlan;
}

export async function refreshCcgAntorusMigrationLeaderboard(): Promise<void> {
  const marker = await CcgMigration.collection.findOne({ key: CCG_ANTORUS_FINISH_MIGRATION_KEY });
  if (!marker) throw new Error("Migrate Antorus data before refreshing its leaderboard");
  if (marker.details?.leaderboardRefreshedAt) return;
  const result = await ccgLeaderboardService.refresh("full");
  if (!result.refreshed) throw new Error("Antorus data migrated, but leaderboard refresh is locked; keep writers stopped and rerun the migration after the lock expires");
  await CcgMigration.collection.updateOne(
    { key: CCG_ANTORUS_FINISH_MIGRATION_KEY },
    { $set: { "details.leaderboardRefreshedAt": new Date() } },
  );
}

export async function assertCcgAntorusFinishReady(): Promise<void> {
  const set = await CcgSet.collection.findOne({ zoneId: 17 });
  if (!set) return;
  if (set.customFinish?.key !== "felforged") throw new Error(MIGRATION_REQUIRED);
  const ownership = await CcgOwnership.collection.findOne({ setId: set._id, finish: "worldcore" }, { projection: { _id: 1 } });
  const marker = await CcgMigration.collection.findOne({ key: CCG_ANTORUS_FINISH_MIGRATION_KEY });
  if (ownership || (marker && !marker.details?.leaderboardRefreshedAt)) throw new Error(MIGRATION_REQUIRED);
}
