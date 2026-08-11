import dotenv from "dotenv";
import mongoose from "mongoose";
import characterWclIdentityAuditService from "../services/character-wcl-identity-audit.service";

(dotenv.config as (options?: { quiet?: boolean }) => void)({ quiet: true });

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const mongoUri = getArg("mongo") || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";
  const requestedLimit = Number(getArg("max-candidates"));
  const maxCandidates = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined;

  await mongoose.connect(mongoUri);
  try {
    const trigger = await characterWclIdentityAuditService.triggerBackfill({
      maxCandidates,
      reprocessFailed: hasFlag("reprocess-failed"),
    });
    console.log(JSON.stringify({ phase: "started", database: mongoose.connection.name, ...trigger.enqueue }, null, 2));

    const status = await characterWclIdentityAuditService.waitUntilIdle();
    console.log(JSON.stringify({ phase: "completed", database: mongoose.connection.name, ...status }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
