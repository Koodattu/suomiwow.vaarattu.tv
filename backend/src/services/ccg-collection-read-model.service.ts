import mongoose, { ClientSession } from "mongoose";
import { CCG_TIER_GRADES } from "../config/ccg";
import CcgCard from "../models/CcgCard";
import CcgOwnership from "../models/CcgOwnership";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";

export const CCG_COLLECTION_READ_MODEL_VERSION = 1;
export const CCG_COLLECTION_READ_MODEL_INDEX = "ccg_series_collection_default_v1";
export const CCG_COLLECTION_READ_MODEL_MISSING_FINISH = "missing_finish_ownership";

export type CcgCollectionReadModelCard = {
  _id: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  characterId: mongoose.Types.ObjectId;
  snapshotVersion: number;
  tierGrade: string;
  setNumber: number;
  name: string;
  performanceSnapshotAt: Date;
  publishedAt: Date;
};

export type CcgCollectionReadModelFields = {
  collectionReadModelVersion: number;
  collectionCardId: mongoose.Types.ObjectId;
  collectionSnapshotVersion: number;
  collectionSortGrade: number;
  collectionSortSetNumber: number;
  collectionSortName: string;
};

export function createCcgSeriesKey(value: {
  setId: mongoose.Types.ObjectId | string;
  characterId: mongoose.Types.ObjectId | string;
}): string {
  return `${String(value.setId)}:${String(value.characterId)}`;
}

export function createCcgOwnerKey(value: {
  ownerType: string;
  ownerId: mongoose.Types.ObjectId | string;
}): string {
  return `${value.ownerType}:${String(value.ownerId)}`;
}

export function createCcgOwnerSeriesKey(value: {
  ownerType: string;
  ownerId: mongoose.Types.ObjectId | string;
  setId: mongoose.Types.ObjectId | string;
  characterId: mongoose.Types.ObjectId | string;
}): string {
  return `${createCcgOwnerKey(value)}:${createCcgSeriesKey(value)}`;
}

export function compareCcgCollectionCards(
  left: CcgCollectionReadModelCard,
  right: CcgCollectionReadModelCard,
): number {
  return right.snapshotVersion - left.snapshotVersion
    || right.performanceSnapshotAt.getTime() - left.performanceSnapshotAt.getTime()
    || right.publishedAt.getTime() - left.publishedAt.getTime()
    || String(right._id).localeCompare(String(left._id));
}

export function selectCcgCollectionCard(
  cards: readonly CcgCollectionReadModelCard[],
  unlockedSnapshotVersions: readonly number[],
): CcgCollectionReadModelCard | null {
  const unlocked = new Set(unlockedSnapshotVersions);
  return cards
    .filter((card) => unlocked.has(card.snapshotVersion))
    .sort(compareCcgCollectionCards)[0] ?? null;
}

export function buildCcgCollectionReadModel(
  card: CcgCollectionReadModelCard,
): CcgCollectionReadModelFields {
  const grade = CCG_TIER_GRADES.indexOf(card.tierGrade as (typeof CCG_TIER_GRADES)[number]);
  if (grade < 0) throw new Error(`Cannot materialize CCG collection card ${card._id}: invalid tier grade ${card.tierGrade}`);
  return {
    collectionReadModelVersion: CCG_COLLECTION_READ_MODEL_VERSION,
    collectionCardId: card._id,
    collectionSnapshotVersion: card.snapshotVersion,
    collectionSortGrade: grade,
    collectionSortSetNumber: card.setNumber,
    collectionSortName: card.name,
  };
}

export async function refreshCcgCollectionReadModelsForSeries(
  setId: mongoose.Types.ObjectId,
  characterId: mongoose.Types.ObjectId,
  session: ClientSession,
): Promise<number> {
  const [cards, seriesRows, ownershipRows] = await Promise.all([
    CcgCard.find({ setId, characterId })
      .select("_id setId characterId snapshotVersion tierGrade setNumber name performanceSnapshotAt publishedAt")
      .session(session)
      .lean<CcgCollectionReadModelCard[]>(),
    CcgSeriesOwnership.find({ setId, characterId })
      .select("ownerType ownerId setId characterId unlockedSnapshotVersions")
      .session(session)
      .lean(),
    CcgOwnership.find({ setId, characterId, quantity: { $gt: 0 } })
      .select("ownerType ownerId")
      .session(session)
      .lean(),
  ]);
  const ownershipOwners = new Set(ownershipRows.map(createCcgOwnerKey));
  const operations: mongoose.mongo.AnyBulkWriteOperation[] = [];
  let refreshed = 0;

  for (const row of seriesRows) {
    if (!ownershipOwners.has(createCcgOwnerKey(row))) {
      throw new Error(`Cannot refresh owned CCG series ${row._id} without positive finish ownership`);
    }

    const card = selectCcgCollectionCard(cards, row.unlockedSnapshotVersions);
    if (!card) {
      throw new Error(`Cannot materialize owned CCG series ${row._id}: no explicitly unlocked card snapshot exists`);
    }
    refreshed += 1;
    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: buildCcgCollectionReadModel(card),
          $unset: { collectionReadModelIssue: "" },
        },
      },
    });
  }

  if (operations.length > 0) {
    await CcgSeriesOwnership.collection.bulkWrite(operations, { ordered: false, session });
  }
  return refreshed;
}
