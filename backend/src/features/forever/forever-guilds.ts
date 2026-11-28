import { Types } from "mongoose";
import { ForeverCharacter, ForeverGuild } from "./forever.models";
import { confirmedGuildRuleset } from "./forever-guild-ruleset";
import { visibleForeverCharacters } from "./forever-visibility";
import { armoryUrl, normalizeSlug } from "./forever-armory";
import { ForeverError } from "./forever-errors";
import { ForeverSnapshotCache } from "./forever-snapshot";
import { foreverGuildRecords } from "./forever-records";
import { foreverGuildRaids } from "./forever-raids";

const publicGuildFilter = { status: "approved", hidden: { $ne: true } } as const;
const guildFields = "name region slug lastFetchedAt roster";
const characterFields = "region slug guild faction ruleset rulesetInferredFromGuild sourceUpdatedAt";
type Guild = {
  _id: Types.ObjectId; name: string; region: "eu" | "us"; slug: string; lastFetchedAt?: Date | null;
  roster: { region: "eu" | "us"; slug: string; name?: string | null; level?: number | null;
    className?: string | null; race?: string | null; faction?: string | null; isOutdated?: boolean | null }[];
};
type Character = Parameters<typeof confirmedGuildRuleset>[2][number] & { _id: Types.ObjectId; region: string };

function summary(guild: Guild, characters: Character[]) {
  const classification = confirmedGuildRuleset(guild, guild.roster, characters);
  const factions = new Set(guild.roster.filter(member => !member.isOutdated && member.faction).map(member => member.faction));
  const faction = factions.size === 1 && ["Horde", "Alliance"].includes([...factions][0] || "") ? [...factions][0] : null;
  return {
    _id: String(guild._id), name: guild.name, region: guild.region, slug: guild.slug,
    rosterCount: guild.roster.length, lastFetchedAt: guild.lastFetchedAt ?? null,
    faction: classification?.faction ?? faction, ruleset: classification?.ruleset ?? null,
  };
}

export const foreverGuildsCache = new ForeverSnapshotCache("forever:guilds:v1", async () => {
  const guilds = await ForeverGuild.find(publicGuildFilter).select(guildFields).lean<Guild[]>();
  if (!guilds.length) return { guilds: [] };
  // Fetch profile evidence once for the directory, rather than once per guild.
  const regions = new Map<string, string[]>();
  for (const guild of guilds) {
    const slugs = regions.get(guild.region) ?? [];
    slugs.push(guild.slug);
    regions.set(guild.region, slugs);
  }
  const characters = await ForeverCharacter.find({ status: "tracked", $or: [...regions].map(([region, slugs]) => ({
    region, "guild.region": region, "guild.slug": { $in: slugs },
  })) }).select(characterFields).lean();
  const byGuild = new Map<string, Character[]>();
  for (const character of characters) {
    const key = `${character.region}/${character.guild?.slug}`;
    const members = byGuild.get(key) ?? [];
    members.push(character); byGuild.set(key, members);
  }
  return { guilds: guilds.map(guild => summary(guild, byGuild.get(`${guild.region}/${guild.slug}`) ?? [])) };
});

export function publicGuilds() {
  return foreverGuildsCache.get();
}

/** Accepts a guild ID, or an EU guild slug for links from character profiles. */
export async function publicGuildDetail(id: Types.ObjectId | string) {
  let identity: Record<string, unknown> = { _id: id };
  if (typeof id === "string") {
    try { identity = { region: "eu", slug: normalizeSlug(id) }; } catch { throw new ForeverError("not_found", 404); }
  }
  const guild = await ForeverGuild.findOne({ ...publicGuildFilter, ...identity }).select(guildFields).lean<Guild | null>();
  if (!guild) throw new ForeverError("not_found", 404);
  const characters = await ForeverCharacter.find({
    ...await visibleForeverCharacters(), status: "tracked", region: guild.region,
    slug: { $in: guild.roster.map(member => member.slug) },
  }).select(characterFields).lean();
  const tracked = new Map(characters.map(character => [character.slug, character]));
  const current = guild.roster.filter(member => !member.isOutdated);
  const classes = new Map<string, number>();
  for (const member of current) if (member.level === 60 && member.className) classes.set(member.className, (classes.get(member.className) ?? 0) + 1);
  const [records, raids] = await Promise.all([foreverGuildRecords(guild.slug), foreverGuildRaids(guild.slug)]);
  return {
    ...summary(guild, characters), armoryUrl: armoryUrl(guild, "guild"),
    overview: {
      level60: current.filter(member => member.level === 60).length,
      classes60: [...classes].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      ...records, raids: raids.raids, recentKills: raids.recent,
    },
    roster: guild.roster.map(member => ({
      region: member.region, slug: member.slug, name: member.name || member.slug,
      level: member.level ?? null, className: member.className ?? null, race: member.race ?? null,
      faction: member.faction ?? null, isOutdated: member.isOutdated === true,
      characterId: tracked.has(member.slug) ? String(tracked.get(member.slug)!._id) : null,
    })),
  };
}
