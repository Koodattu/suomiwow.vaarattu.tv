import type { ForeverKillEvent, ForeverRecordRow } from "./forever-api";
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
  overview?: {
    level60: number; classes60: { name: string; count: number }[];
    averageItemLevel: number | null; gearedMembers: number; topGeared: ForeverRecordRow[];
    raids: { key: string; instance: string; size: number | null; bossCount: number; killed: number; clearedAt: string | null;
      bosses: { name: string; kill: { name: string; at: string; approximate: boolean } | null }[] }[];
    recentKills: ForeverKillEvent[];
  };
}
export const guildSorts = ["sizeDesc", "sizeAsc", "nameAsc", "nameDesc"] as const;
export type GuildSort = typeof guildSorts[number];
export const rosterSorts = ["levelDesc", "levelAsc", "nameAsc", "nameDesc"] as const;
export type RosterSort = typeof rosterSorts[number];
export const emptyGuildFilters = { search: "", faction: "", ruleset: "" };

export function readGuildDirectoryQuery(params: Pick<URLSearchParams, "get">) {
  const sort = params.get("sort"), page = params.get("page") || "1";
  return {
    search: (params.get("search") || "").slice(0, 100), faction: params.get("faction") || "", ruleset: params.get("ruleset") || "",
    sort: guildSorts.includes(sort as GuildSort) ? sort as GuildSort : "sizeDesc" as GuildSort,
    page: /^[1-9]\d{0,6}$/.test(page) ? Number(page) : 1,
  };
}

export function guildDirectoryQuery(state: ReturnType<typeof readGuildDirectoryQuery>) {
  const params = new URLSearchParams();
  for (const field of ["search", "faction", "ruleset"] as const) if (state[field]) params.set(field, state[field]);
  if (state.sort !== "sizeDesc") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  return params.size ? `?${params}` : "";
}

export function filterForeverGuilds(guilds: PublicForeverGuild[], filters: typeof emptyGuildFilters, sort: GuildSort, locale: string) {
  const search = filters.search.trim().normalize("NFC").toLocaleLowerCase(locale);
  const byName = (a: PublicForeverGuild, b: PublicForeverGuild) => a.name.localeCompare(b.name, locale) || a._id.localeCompare(b._id);
  return guilds.filter(guild => (!search || guild.name.normalize("NFC").toLocaleLowerCase(locale).includes(search)) &&
    (!filters.faction || (guild.faction || "unknown") === filters.faction) &&
    (!filters.ruleset || (guild.ruleset || "unknown") === filters.ruleset))
    .sort((a, b) => {
      if (sort === "nameAsc") return byName(a, b);
      if (sort === "nameDesc") return -byName(a, b);
      // An unfetched roster is unknown, not a zero-member guild.
      if (!a.lastFetchedAt && !b.lastFetchedAt) return byName(a, b);
      if (!a.lastFetchedAt) return 1;
      if (!b.lastFetchedAt) return -1;
      return (sort === "sizeDesc" ? b.rosterCount - a.rosterCount : a.rosterCount - b.rosterCount) || byName(a, b);
    });
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
