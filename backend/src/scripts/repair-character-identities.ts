import dotenv from "dotenv";
import mongoose from "mongoose";
import characterIdentityRepairService from "../services/character-identity-repair.service";

(dotenv.config as (options?: { quiet?: boolean }) => void)({ quiet: true });

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const apply = hasFlag("apply");
  const mongoUri = getArg("mongo") || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";

  await mongoose.connect(mongoUri);
  try {
    const result = await characterIdentityRepairService.run(apply);
    console.log(
      JSON.stringify(
        {
          database: mongoose.connection.name,
          ...result,
          note: apply
            ? "Canonical identities and dependent snapshots were repaired. Keep the backend running to drain queued Blizzard refreshes, then restart backend instances to clear any process-local cache entries."
            : "No data was changed. Review the counts and samples, then re-run the same build with --apply.",
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
