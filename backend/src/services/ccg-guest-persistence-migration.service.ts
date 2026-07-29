import CcgDailyAllowance from "../models/CcgDailyAllowance";
import CcgGuest from "../models/CcgGuest";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgOwnership from "../models/CcgOwnership";
import CcgPackBalance from "../models/CcgPackBalance";
import CcgPackOpening from "../models/CcgPackOpening";
import CcgQualityProgress from "../models/CcgQualityProgress";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import logger from "../utils/logger";

type CollectionIndex = {
  name?: string;
  key?: Record<string, unknown>;
};

const persistentGuestCollections = [
  { collection: CcgGuest.collection, ownerScoped: false },
  { collection: CcgOwnership.collection, ownerScoped: true },
  { collection: CcgSeriesOwnership.collection, ownerScoped: true },
  { collection: CcgPackBalance.collection, ownerScoped: true },
  { collection: CcgDailyAllowance.collection, ownerScoped: true },
  { collection: CcgPackOpening.collection, ownerScoped: true },
  { collection: CcgLedgerEntry.collection, ownerScoped: true },
  { collection: CcgQualityProgress.collection, ownerScoped: true },
] as const;

function isMongoError(error: unknown, code: number, codeName: string): boolean {
  const candidate = error as { code?: number; codeName?: string };
  return candidate?.code === code || candidate?.codeName === codeName;
}

export function isGuestExpiryIndex(index: CollectionIndex): boolean {
  return Boolean(index.key && Object.prototype.hasOwnProperty.call(index.key, "expiresAt"));
}

export async function ensurePersistentCcgGuests(): Promise<void> {
  let droppedIndexes = 0;
  let preservedDocuments = 0;

  for (const target of persistentGuestCollections) {
    let indexes: CollectionIndex[];
    try {
      indexes = await target.collection.indexes();
    } catch (error) {
      if (isMongoError(error, 26, "NamespaceNotFound")) continue;
      throw error;
    }

    for (const index of indexes.filter(isGuestExpiryIndex)) {
      if (!index.name) continue;
      try {
        await target.collection.dropIndex(index.name);
        droppedIndexes += 1;
      } catch (error) {
        if (!isMongoError(error, 27, "IndexNotFound")) throw error;
      }
    }
  }

  for (const target of persistentGuestCollections) {
    const filter = target.ownerScoped
      ? { ownerType: "guest", expiresAt: { $exists: true } }
      : { expiresAt: { $exists: true } };
    try {
      const result = await target.collection.updateMany(filter, { $unset: { expiresAt: "" } });
      preservedDocuments += result.modifiedCount;
    } catch (error) {
      if (!isMongoError(error, 26, "NamespaceNotFound")) throw error;
    }
  }

  logger.info(`[CCG] Guest persistence ready: dropped ${droppedIndexes} expiry index(es), preserved ${preservedDocuments} document(s)`);
}
