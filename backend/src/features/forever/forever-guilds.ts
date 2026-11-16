import { Types } from "mongoose";
import { ForeverCharacter, ForeverGuild } from "./forever.models";
import { confirmedGuildRuleset } from "./forever-guild-ruleset";
import { visibleForeverCharacters } from "./forever-visibility";
import { armoryUrl } from "./forever-armory";
import { ForeverError } from "./forever-errors";
import { ForeverSnapshotCache } from "./forever-snapshot";

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
  const characters = await ForeverCharacter.find({ status: "tracked", $or: guilds.map(guild => ({
    region: guild.region, "guild.region": guild.region, "guild.slug": guild.slug,
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

export async function publicGuildDetail(id: Types.ObjectId) {
  const guild = await ForeverGuild.findOne({ ...publicGuildFilter, _id: id }).select(guildFields).lean<Guild | null>();
  if (!guild) throw new ForeverError("not_found", 404);
  const characters = await ForeverCharacter.find({
    ...await visibleForeverCharacters(), status: "tracked", region: guild.region,
    slug: { $in: guild.roster.map(member => member.slug) },
  }).select(characterFields).lean();
  const tracked = new Map(characters.map(character => [character.slug, character]));
  return {
    ...summary(guild, characters), armoryUrl: armoryUrl(guild, "guild"),
    roster: guild.roster.map(member => ({
      region: member.region, slug: member.slug, name: member.name || member.slug,
      level: member.level ?? null, className: member.className ?? null, race: member.race ?? null,
      faction: member.faction ?? null, isOutdated: member.isOutdated === true,
      characterId: tracked.has(member.slug) ? String(tracked.get(member.slug)!._id) : null,
    })),
  };
}
