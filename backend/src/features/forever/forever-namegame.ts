import { ForeverCharacter, ForeverGuild } from "./forever.models";
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

export async function namegameLeaderboard(query: { category?: unknown; page?: unknown }) {
  const { category, page = "1" } = query;
  if (category !== undefined && !NAMEGAME_CATEGORIES.includes(category as HumorCategory)) throw new ForeverError("invalid_input");
  if (typeof page !== "string" || !/^[1-9]\d{0,6}$/.test(page)) throw new ForeverError("invalid_input");
  const pageNumber = Number(page), pageSize = 96;
  const population = await namegamePopulation();
  const filter = { ...population.filter, "nameRating.score": { $gte: 0 },
    ...(typeof category === "string" && { "nameRating.category": category }) };
  const [rows, total] = await Promise.all([
    ForeverCharacter.find(filter).select("nameRating").sort({ "nameRating.score": -1, "nameRating.name": 1, _id: 1 })
      .skip((pageNumber - 1) * pageSize).limit(pageSize).lean(),
    ForeverCharacter.countDocuments(filter),
  ]);
  return { names: rows.map(({ nameRating }) => ({ name: nameRating!.name, category: nameRating!.category, score: nameRating!.score })),
    total, page: pageNumber, pageSize, categories: NAMEGAME_CATEGORIES };
}
