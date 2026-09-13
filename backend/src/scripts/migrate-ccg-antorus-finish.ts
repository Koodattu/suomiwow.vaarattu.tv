import "dotenv/config";
import mongoose from "mongoose";
import {
  assertCcgAntorusFinishReady,
  migrateCcgAntorusFinish,
  planCcgAntorusFinishMigration,
  refreshCcgAntorusMigrationLeaderboard,
} from "../services/ccg-antorus-finish-migration.service";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--dry-run", "--apply", "--writers-stopped"].includes(arg)) || (args.includes("--dry-run") && args.includes("--apply"))) {
    throw new Error("Use --dry-run (default), or --apply --writers-stopped");
  }
  const apply = args.includes("--apply");
  if (apply && !args.includes("--writers-stopped")) throw new Error("Stop all API and worker processes, then pass --apply --writers-stopped");
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI must be configured for the target database");
  // Dry runs must not create collections or indexes through Mongoose initialization.
  await mongoose.connect(mongoUri, { autoIndex: false, autoCreate: false });
  try {
    const plan = await planCcgAntorusFinishMigration();
    console.log(`[CCG] Antorus finish migration ${apply ? "preflight" : "dry run"}`);
    console.log(JSON.stringify(plan, null, 2));
    if (!apply) return;
    await migrateCcgAntorusFinish();
    await refreshCcgAntorusMigrationLeaderboard();
    await assertCcgAntorusFinishReady();
    const verified = await planCcgAntorusFinishMigration();
    if (Object.values(verified.documents).some((count) => count > 0)) throw new Error("Old Antorus finish references remain; keep services stopped");
    console.log("[CCG] Antorus migration verified; leaderboard refreshed. Start API and workers on the new build.");
    console.log(JSON.stringify(verified, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  // Driver errors can contain connection details; never print the URI or driver payload.
  console.error(error instanceof Error && error.name === "Error" ? error.message : "Antorus migration failed at the database connection or transaction stage. Keep services stopped and inspect the database locally.");
  process.exitCode = 1;
});
