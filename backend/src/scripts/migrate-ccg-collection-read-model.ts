import "dotenv/config";
import mongoose from "mongoose";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import CcgSeriesOwnershipArchive from "../models/CcgSeriesOwnershipArchive";
import {
  CCG_COLLECTION_READ_MODEL_INDEX,
  CCG_COLLECTION_READ_MODEL_MISSING_FINISH,
  CCG_COLLECTION_READ_MODEL_VERSION,
} from "../services/ccg-collection-read-model.service";
import { ensureCcgSeriesOwnershipMigration } from "../services/ccg-ownership-migration.service";

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";
  await mongoose.connect(mongoUri);
  try {
    await ensureCcgSeriesOwnershipMigration();
    const [rows, materialized, inconsistent, archived, indexExists] = await Promise.all([
      CcgSeriesOwnership.countDocuments({}),
      CcgSeriesOwnership.countDocuments({ collectionReadModelVersion: CCG_COLLECTION_READ_MODEL_VERSION }),
      CcgSeriesOwnership.countDocuments({ collectionReadModelIssue: CCG_COLLECTION_READ_MODEL_MISSING_FINISH }),
      CcgSeriesOwnershipArchive.countDocuments({ reason: CCG_COLLECTION_READ_MODEL_MISSING_FINISH }),
      CcgSeriesOwnership.collection.indexExists(CCG_COLLECTION_READ_MODEL_INDEX),
    ]);
    if (materialized !== rows || inconsistent !== 0 || !indexExists) {
      throw new Error(
        `CCG collection read model verification failed: ${rows} active, ${materialized} materialized, ${inconsistent} inconsistent, ${archived} archived, index=${indexExists}`,
      );
    }
    console.log(`[CCG] Collection read model ready: ${materialized} materialized, ${archived} archived, ${rows} active`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
