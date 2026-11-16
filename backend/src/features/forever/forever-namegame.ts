import { SharedSnapshotCacheService } from "../../services/shared-snapshot-cache.service";
import { ForeverCharacter, ForeverGuild, ForeverWorker } from "./forever.models";
import { ForeverLeaderboardCache, ForeverLeaderboardLease } from "./forever-leaderboard.models";
import { ForeverError } from "./forever-errors";
import { NAMEGAME_CATEGORIES, type HumorCategory } from "./forever-namegame-rating";
import { visibleForeverCharacters } from "./forever-visibility";

// A roster snapshot is authoritative for guild imports. Their cached character.guild can survive a departure.
// A direct profile may establish membership before a guild's first roster arrives.
export async function namegamePopulation() {
  const guilds = await ForeverGuild.find({ status: "approved", hidden: { $ne: true } })
    .select("region slug name lastFetchedAt roster.slug roster.name").lean();
  const roster = new Map<string, { name?: string | null; guild: string }>();
  for (const guild of guilds) {
    for (const member of guild.roster) roster.set(guild.region + "/" + member.slug, { name: member.name, guild: guild.name });
  }
  const filter: Record<string, unknown> = { ...await visibleForeverCharacters(), status: "tracked", $or: [
    { independentlyTracked: true }, { source: { $in: ["admin", "seed"] } },
    ...guilds.map(guild => guild.lastFetchedAt || guild.roster.length
      ? { region: guild.region, slug: { $in: guild.roster.map(member => member.slug) },
        $or: [{ "guild.slug": guild.slug }, { guild: null }] }
      : { region: guild.region, "guild.slug": guild.slug }),
  ] };
  return { filter, roster };
}

const FRESH_MS = 60_000;
const shared = new SharedSnapshotCacheService("Forever Namegame", () => 0, { cache: ForeverLeaderboardCache, leases: ForeverLeaderboardLease });
async function buildSnapshot() {
  const population = await namegamePopulation();
  const rows = await ForeverCharacter.find({ ...population.filter, "nameRating.score": { $gte: 0 } })
    .select("nameRating").sort({ "nameRating.score": -1, "nameRating.name": 1, _id: 1 }).lean().maxTimeMS(10_000);
  return { generatedAt: new Date().toISOString(), names: rows.map(({ nameRating }, index) => ({
    name: nameRating!.name, category: nameRating!.category, score: nameRating!.score, rank: index + 1,
  })) };
}
type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;
let local: { key: string; data: Snapshot } | undefined;
let pending: { key: string; promise: Promise<Snapshot> } | undefined;
async function snapshot() {
  // This indexed revision read applies moderation across API processes, including to warm caches.
  const worker = await ForeverWorker.findById("armory").select("leaderboardRevision").lean();
  const key = `forever:namegame:v1:${worker?.leaderboardRevision || 0}`;
  if (local?.key === key && Date.parse(local.data.generatedAt) > Date.now() - FRESH_MS) return local.data;
  if (pending?.key === key) return pending.promise;
  const promise = shared.get(key, buildSnapshot, FRESH_MS).then(data => {
    local = { key, data };
    return data;
  }).finally(() => { if (pending?.promise === promise) pending = undefined; });
  pending = { key, promise };
  return promise;
}

export async function namegameLeaderboard(query: { category?: unknown; page?: unknown; search?: unknown; sort?: unknown }) {
  const { category, page = "1", search = "", sort = "score-desc" } = query;
  if (category !== undefined && category !== "" && !NAMEGAME_CATEGORIES.includes(category as HumorCategory)) throw new ForeverError("invalid_input");
  if (typeof page !== "string" || !/^[1-9]\d{0,6}$/.test(page)) throw new ForeverError("invalid_input");
  if (typeof search !== "string" || search.length > 100 || typeof sort !== "string" || !["score-desc", "score-asc", "name"].includes(sort)) throw new ForeverError("invalid_input");
  const data = await snapshot(), needle = search.trim().toLocaleLowerCase("fi");
  const ranked = category ? data.names.filter(entry => entry.category === category).map((entry, index) => ({ ...entry, rank: index + 1 })) : data.names;
  const names = ranked.filter(entry => !needle || entry.name.toLocaleLowerCase("fi").includes(needle));
  if (sort === "score-asc") names.sort((a, b) => a.score - b.score || a.rank - b.rank);
  else if (sort === "name") names.sort((a, b) => a.name.localeCompare(b.name, "fi") || a.rank - b.rank);
  const pageSize = 48, pageNumber = Math.min(Number(page), Math.max(1, Math.ceil(names.length / pageSize)));
  return { generatedAt: data.generatedAt, names: names.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
    total: names.length, page: pageNumber, pageSize, categories: NAMEGAME_CATEGORIES };
}

export async function namegameOverview() {
  const data = await snapshot();
  return { generatedAt: data.generatedAt, total: data.names.length, boards: ["", ...NAMEGAME_CATEGORIES].map(category => {
    const names = category ? data.names.filter(entry => entry.category === category) : data.names;
    return { category, total: names.length, names: names.slice(0, 5).map((entry, index) => ({ ...entry, rank: index + 1 })) };
  }) };
}
