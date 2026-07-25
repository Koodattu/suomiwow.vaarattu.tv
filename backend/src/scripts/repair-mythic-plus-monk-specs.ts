import { isDeepStrictEqual } from "node:util";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { CLASSES } from "../config/classes";
import Cache from "../models/Cache";
import CharacterMythicPlusDungeonRun from "../models/CharacterMythicPlusDungeonRun";
import CharacterMythicPlusSeasonScore from "../models/CharacterMythicPlusSeasonScore";
import mythicPlusService from "../services/mythic-plus.service";

(dotenv.config as (options?: { quiet?: boolean }) => void)({ quiet: true });

const BATCH_SIZE = 500;
const MONK_CLASS_ID = CLASSES.find((entry) => entry.name === "Monk")?.id;

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function comparableSpecScores(specScores: any[]) {
  return specScores.map((entry) => ({
    field: entry.field,
    blizzardSpecId: entry.blizzardSpecId ?? null,
    blizzardSpecIndex: entry.blizzardSpecIndex ?? null,
    specName: entry.specName ?? null,
    specSlug: entry.specSlug ?? null,
    role: entry.role ?? null,
    score: entry.score,
    color: entry.color ?? null,
  }));
}

async function flushScoreOperations(operations: any[]): Promise<number> {
  if (operations.length === 0) return 0;
  const result = await CharacterMythicPlusSeasonScore.bulkWrite(operations, { ordered: false });
  operations.length = 0;
  return result.modifiedCount;
}

async function repairSeasonScores(apply: boolean): Promise<{ inspected: number; affected: number; modified: number }> {
  if (!MONK_CLASS_ID) throw new Error("Monk is missing from the local class configuration.");

  let inspected = 0;
  let affected = 0;
  let modified = 0;
  const operations: any[] = [];
  const cursor = CharacterMythicPlusSeasonScore.find({ classID: MONK_CLASS_ID })
    .select("_id scores segments specScores bestSpecField bestSpecName bestSpecSlug bestSpecScore")
    .lean()
    .cursor();

  for await (const row of cursor) {
    inspected += 1;
    const specScores = mythicPlusService.mapSpecScores(MONK_CLASS_ID, row.scores, row.segments ?? {});
    const bestSpec = specScores.filter((entry) => entry.specName).sort((a, b) => b.score - a.score)[0] ?? null;
    const currentMetadata = {
      specScores: comparableSpecScores(row.specScores ?? []),
      bestSpecField: row.bestSpecField ?? null,
      bestSpecName: row.bestSpecName ?? null,
      bestSpecSlug: row.bestSpecSlug ?? null,
      bestSpecScore: row.bestSpecScore ?? 0,
    };
    const repairedMetadata = {
      specScores: comparableSpecScores(specScores),
      bestSpecField: bestSpec?.field ?? null,
      bestSpecName: bestSpec?.specName ?? null,
      bestSpecSlug: bestSpec?.specSlug ?? null,
      bestSpecScore: bestSpec?.score ?? 0,
    };

    if (isDeepStrictEqual(currentMetadata, repairedMetadata)) continue;
    affected += 1;
    if (!apply) continue;

    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: repairedMetadata },
      },
    });
    if (operations.length >= BATCH_SIZE) modified += await flushScoreOperations(operations);
  }

  if (apply) modified += await flushScoreOperations(operations);
  return { inspected, affected, modified };
}

async function repairDungeonRuns(apply: boolean): Promise<{ affected: number; modified: number }> {
  if (!MONK_CLASS_ID) throw new Error("Monk is missing from the local class configuration.");

  let affected = 0;
  let modified = 0;
  for (const bucket of ["spec_1", "spec_2"] as const) {
    const context = mythicPlusService.getBucketContext(MONK_CLASS_ID, bucket);
    const repairedMetadata = {
      bucketType: context.bucketType,
      role: context.role,
      specName: context.specName,
      specSlug: context.specSlug,
      blizzardSpecId: context.blizzardSpecId,
      blizzardSpecIndex: context.blizzardSpecIndex,
    };
    const filter = {
      classID: MONK_CLASS_ID,
      bucket,
      $or: Object.entries(repairedMetadata).map(([field, value]) => ({ [field]: { $ne: value } })),
    };
    affected += await CharacterMythicPlusDungeonRun.countDocuments(filter);
    if (!apply) continue;

    const result = await CharacterMythicPlusDungeonRun.updateMany(filter, {
      $set: repairedMetadata,
    });
    modified += result.modifiedCount;
  }

  return { affected, modified };
}

async function main(): Promise<void> {
  const apply = hasFlag("apply");
  const mongoUri = getArg("mongo") || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wow_guild_tracker";

  await mongoose.connect(mongoUri);
  try {
    const seasonScores = await repairSeasonScores(apply);
    const dungeonRuns = await repairDungeonRuns(apply);

    if (apply && (seasonScores.modified > 0 || dungeonRuns.modified > 0)) {
      await Cache.deleteMany({ key: { $regex: /^(mythic-plus:|characters:profile:)/ } });
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? "apply" : "dry-run",
          seasonScores,
          dungeonRuns,
          note: apply
            ? "Persistent Mythic+ caches were invalidated. Restart running backend instances to clear their in-memory caches."
            : "No data was changed. Re-run with --apply to repair the affected rows.",
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
