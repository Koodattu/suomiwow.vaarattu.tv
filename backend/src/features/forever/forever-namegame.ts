import { ForeverCharacter, ForeverGuild } from "./forever.models";
import { ForeverSnapshotCache } from "./forever-snapshot";
import { ForeverError } from "./forever-errors";
import { NAMEGAME_CATEGORIES, type HumorCategory } from "./forever-namegame-rating";
import { foreverVisibility } from "./forever-visibility";

// A roster snapshot is authoritative for guild imports. Their cached character.guild can survive a departure.
// A direct profile may establish membership before a guild's first roster arrives.
export async function namegamePopulation() {
  const guilds = await ForeverGuild.find({ status: "approved", hidden: { $ne: true } })
    .select("region slug name lastFetchedAt roster.slug roster.name").lean();
  const roster = new Map<string, { name?: string | null; guild: string }>();
  for (const guild of guilds) {
    for (const member of guild.roster) roster.set(guild.region + "/" + member.slug, { name: member.name, guild: guild.name });
  }
  const visibility = await foreverVisibility();
  const memberships = new Map<string, Set<string> | null>();
  const guildFilters = guilds.map(guild => {
    const slugs = guild.roster.map(member => member.slug);
    const authoritative = !!guild.lastFetchedAt || slugs.length > 0;
    memberships.set(guild.region + "/" + guild.slug, authoritative ? new Set(slugs) : null);
    return authoritative ? { region: guild.region, slug: { $in: slugs }, $or: [{ "guild.slug": guild.slug }, { guild: null }] }
      : { region: guild.region, "guild.slug": guild.slug };
  });
  const filter: Record<string, unknown> = { ...visibility.filter, status: "tracked", $or: [
    { independentlyTracked: true }, { source: { $in: ["admin", "seed"] } }, ...guildFilters,
  ] };
  function includes(row: { region: string; slug: string; source: string; independentlyTracked?: boolean | null; guild?: { slug: string } | null }) {
    if (!visibility.includes(row)) return false;
    if (row.independentlyTracked || row.source === "admin" || row.source === "seed") return true;
    if (!row.guild) return roster.has(row.region + "/" + row.slug);
    const members = memberships.get(row.region + "/" + row.guild.slug);
    return members === null || members?.has(row.slug) === true;
  }
  return { filter, roster, includes };
}

async function buildSnapshot() {
  const population = await namegamePopulation();
  const rows = await ForeverCharacter.find({ status: "tracked", "nameRating.score": { $gte: 0 } })
    .select("nameRating region slug source independentlyTracked guild.slug").sort({ "nameRating.score": -1, "nameRating.name": 1, _id: 1 }).lean().maxTimeMS(10_000);
  return { generatedAt: new Date().toISOString(), names: rows.filter(population.includes).map(({ nameRating }, index) => ({
    name: nameRating!.name, category: nameRating!.category, score: nameRating!.score, rank: index + 1,
  })) };
}
export const foreverNamegameCache = new ForeverSnapshotCache("forever:namegame:v2", buildSnapshot, "namegameRevision");

export async function namegameLeaderboard(query: { category?: unknown; page?: unknown; search?: unknown; sort?: unknown }) {
  const { category, page = "1", search = "", sort = "score-desc" } = query;
  if (category !== undefined && category !== "" && !NAMEGAME_CATEGORIES.includes(category as HumorCategory)) throw new ForeverError("invalid_input");
  if (typeof page !== "string" || !/^[1-9]\d{0,6}$/.test(page)) throw new ForeverError("invalid_input");
  if (typeof search !== "string" || search.length > 100 || typeof sort !== "string" || !["score-desc", "score-asc", "name"].includes(sort)) throw new ForeverError("invalid_input");
  const data = await foreverNamegameCache.get(), needle = search.trim().toLocaleLowerCase("fi");
  const ranked = category ? data.names.filter(entry => entry.category === category).map((entry, index) => ({ ...entry, rank: index + 1 })) : data.names;
  const names = ranked.filter(entry => !needle || entry.name.toLocaleLowerCase("fi").includes(needle));
  if (sort === "score-asc") names.sort((a, b) => a.score - b.score || a.rank - b.rank);
  else if (sort === "name") names.sort((a, b) => a.name.localeCompare(b.name, "fi") || a.rank - b.rank);
  const pageSize = 48, pageNumber = Math.min(Number(page), Math.max(1, Math.ceil(names.length / pageSize)));
  return { generatedAt: data.generatedAt, names: names.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
    total: names.length, page: pageNumber, pageSize, categories: NAMEGAME_CATEGORIES };
}

export async function namegameOverview() {
  const data = await foreverNamegameCache.get();
  return { generatedAt: data.generatedAt, total: data.names.length, boards: ["", ...NAMEGAME_CATEGORIES].map(category => {
    const names = category ? data.names.filter(entry => entry.category === category) : data.names;
    return { category, total: names.length, names: names.slice(0, 5).map((entry, index) => ({ ...entry, rank: index + 1 })) };
  }) };
}
