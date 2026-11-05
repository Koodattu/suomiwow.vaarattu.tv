import seeds from "./forever-seeds.json";
import { normalizeSlug } from "./forever-armory";
import { normalizeTwitchChannel } from "./forever-twitch";
import { ForeverCharacter } from "./forever.models";

export function foreverSeedRecords() {
  return seeds.map((entry) => ({
    region: entry.region as "eu", slug: normalizeSlug(entry.name.trim().replace(/\s+/g, "-")), name: entry.name,
    ...(entry.twitchChannel ? { twitchChannel: normalizeTwitchChannel(entry.twitchChannel)! } : {}),
  }));
}

export async function seedForeverCharacters() {
  await ForeverCharacter.init();
  const records = foreverSeedRecords();
  const now = new Date();
  const result = await ForeverCharacter.bulkWrite(records.map((entry) => ({ updateOne: {
    filter: { region: entry.region, slug: entry.slug },
    // Re-running never resumes a pause/rejection, resets progress, or overrides an admin's channel.
    update: { $setOnInsert: { ...entry, status: "tracked", source: "seed", nextFetchAt: now, createdAt: now, updatedAt: now } }, upsert: true, timestamps: false,
  } })));
  return { total: records.length, inserted: result.upsertedCount, existing: records.length - result.upsertedCount };
}
