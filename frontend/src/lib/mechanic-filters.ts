import type { MechanicFilters, MechanicOptions, MechanicRole } from "../types/avoidable-damage";

export type MechanicViewFilters = Omit<MechanicFilters, "outcome">;
export const MECHANIC_ROLES: MechanicRole[] = ["dps", "healer", "tank"];
export const MIN_PULLS = [10, 25, 50, 100];
export const DEFAULT_MECHANIC_FILTERS: MechanicViewFilters = {
  mechanic: "", guildId: undefined, roles: MECHANIC_ROLES, minPulls: 10, sort: "damage", order: "desc", search: "", page: 1,
};

export function readMechanicFilters(params: URLSearchParams): MechanicViewFilters {
  const roleParam = params.get("roles");
  const requestedRoles = roleParam?.split(",");
  const roles = MECHANIC_ROLES.filter((role) => requestedRoles?.includes(role));
  const minPulls = Number(params.get("minPulls"));
  const sort = params.get("sort");
  const page = Number(params.get("page"));
  return {
    mechanic: params.get("mechanic") ?? "",
    guildId: params.get("guildId") || undefined,
    roles: roles.length || roleParam === "" ? roles : MECHANIC_ROLES,
    minPulls: MIN_PULLS.includes(minPulls) ? minPulls : DEFAULT_MECHANIC_FILTERS.minPulls,
    sort: sort === "hits" || sort === "hitsPerPull" ? sort : "damage",
    order: params.get("order") === "asc" ? "asc" : "desc",
    search: (params.get("search") ?? "").slice(0, 60),
    page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
  };
}

export function mechanicSelection(options: MechanicOptions | undefined, filters: MechanicViewFilters) {
  const selected = options?.mechanics.find((entry) => entry.key === filters.mechanic) ?? options?.mechanics[0];
  const guilds = options?.guilds.filter((entry) => selected && entry.mechanicKeys?.includes(selected.key)) ?? [];
  const selectedGuild = guilds.find((entry) => entry.id === filters.guildId);
  return { selected, guilds, selectedGuild };
}

export function mechanicFilterParams(filters: MechanicViewFilters, params = new URLSearchParams()) {
  params.set("mechanic", filters.mechanic);
  params.set("roles", filters.roles.join(","));
  params.set("minPulls", String(filters.minPulls));
  params.set("sort", filters.sort);
  params.set("order", filters.order);
  params.set("page", String(filters.page));
  if (filters.guildId) params.set("guildId", filters.guildId);
  else params.delete("guildId");
  if (filters.search) params.set("search", filters.search);
  else params.delete("search");
  return params;
}
