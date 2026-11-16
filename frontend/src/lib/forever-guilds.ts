export interface PublicForeverGuild {
  _id: string; name: string; region: string; slug: string; rosterCount: number;
  lastFetchedAt: string | null; faction: string | null; ruleset: string | null;
}
export interface ForeverRosterMember {
  region: string; slug: string; name: string; level: number | null; className: string | null;
  race: string | null; faction: string | null; isOutdated: boolean; characterId: string | null;
}
export interface PublicForeverGuildDetail extends PublicForeverGuild {
  armoryUrl: string; roster: ForeverRosterMember[];
}
export const guildSorts = ["sizeDesc", "sizeAsc", "nameAsc", "nameDesc"] as const;
export type GuildSort = typeof guildSorts[number];
export const rosterSorts = ["levelDesc", "levelAsc", "nameAsc", "nameDesc"] as const;
export type RosterSort = typeof rosterSorts[number];
export const emptyGuildFilters = { search: "", faction: "", ruleset: "" };

export function filterForeverGuilds(guilds: PublicForeverGuild[], filters: typeof emptyGuildFilters, sort: GuildSort, locale: string) {
  const search = filters.search.trim().normalize("NFC").toLocaleLowerCase(locale);
  const byName = (a: PublicForeverGuild, b: PublicForeverGuild) => a.name.localeCompare(b.name, locale) || a._id.localeCompare(b._id);
  return guilds.filter(guild => (!search || guild.name.normalize("NFC").toLocaleLowerCase(locale).includes(search)) &&
    (!filters.faction || (guild.faction || "unknown") === filters.faction) &&
    (!filters.ruleset || (guild.ruleset || "unknown") === filters.ruleset))
    .sort((a, b) => sort === "sizeDesc" ? b.rosterCount - a.rosterCount || byName(a, b) :
      sort === "sizeAsc" ? a.rosterCount - b.rosterCount || byName(a, b) : sort === "nameDesc" ? -byName(a, b) : byName(a, b));
}

export function filterForeverRoster(roster: ForeverRosterMember[], search: string, sort: RosterSort, locale: string) {
  const term = search.trim().normalize("NFC").toLocaleLowerCase(locale);
  const byName = (a: ForeverRosterMember, b: ForeverRosterMember) => a.name.localeCompare(b.name, locale) || a.slug.localeCompare(b.slug);
  return roster.filter(member => member.name.normalize("NFC").toLocaleLowerCase(locale).includes(term)).sort((a, b) => {
    if (sort === "nameAsc") return byName(a, b);
    if (sort === "nameDesc") return -byName(a, b);
    if (a.level === null || b.level === null) return a.level === b.level ? byName(a, b) : a.level === null ? 1 : -1;
    return (sort === "levelAsc" ? a.level - b.level : b.level - a.level) || byName(a, b);
  });
}
