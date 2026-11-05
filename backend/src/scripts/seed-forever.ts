import dotenv from "dotenv";
import mongoose from "mongoose";
import { foreverSeedRecords, seedForeverCharacters } from "../features/forever/forever-seed";

dotenv.config({ quiet: true });
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ apply: false, characters: foreverSeedRecords() }, null, 2));
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);
  try { console.log(JSON.stringify(await seedForeverCharacters())); }
  finally { await mongoose.disconnect(); }
}
main().catch(() => { console.error("Forever seed failed. Check database access and configuration."); process.exitCode = 1; });
