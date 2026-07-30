import "dotenv/config";
import mongoose from "mongoose";
import {
  migrateCcgUnifiedPacks,
  planCcgUnifiedPackMigration,
} from "../services/ccg-pack-migration.service";

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";
  await mongoose.connect(mongoUri);
  try {
    const dryRun = process.argv.includes("--dry-run");
    const result = dryRun
      ? await planCcgUnifiedPackMigration()
      : await migrateCcgUnifiedPacks();
    console.log(`[CCG] Unified pack migration ${dryRun ? "preview" : "ready"}: ${result.balances} balances, ${result.regularPacksAfter} regular packs, ${result.bonusPacks} bonus packs, ${result.redeemCodes} redeem codes`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
