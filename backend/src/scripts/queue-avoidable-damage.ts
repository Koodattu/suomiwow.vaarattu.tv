import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import avoidableDamageService from "../services/avoidable-damage.service";

async function main() {
  const args = process.argv.slice(2);
  const guildId = args.find((arg) => arg.startsWith("--guild="))?.slice("--guild=".length);
  const mechanicKeys = args.find((arg) => arg.startsWith("--mechanics="))?.slice("--mechanics=".length).split(",");
  if (args.some((arg) => arg !== "--retry-unavailable" && !arg.startsWith("--guild=") && !arg.startsWith("--mechanics=")) ||
      (guildId !== undefined && !mongoose.isObjectIdOrHexString(guildId))) {
    throw new Error("Usage: node dist/scripts/queue-avoidable-damage.js [--guild=<MongoDB guild ID>] [--mechanics=<comma-separated keys>] [--retry-unavailable]");
  }
  await connectDB();
  try {
    const result = await avoidableDamageService.queueBackfill({ guildId, mechanicKeys, retryUnavailable: args.includes("--retry-unavailable") });
    console.log(`Queued ${result.queued} guild(s). The existing background worker will collect the events.`);
  } finally {
    await mongoose.disconnect();
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Could not queue mechanic backfill"); process.exitCode = 1; });
