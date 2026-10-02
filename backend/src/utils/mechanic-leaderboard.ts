import type { AvoidableMechanic } from "../config/avoidable-mechanics";
import type { Role } from "../config/specs";
import type { DamageTotals } from "./avoidable-damage";

export const MECHANIC_ROLES: Role[] = ["dps", "healer", "tank"];
export const MECHANIC_MIN_PULLS = [0, 10, 25, 50, 100];

export interface MechanicLeaderboardFilters {
  mechanic: string;
  guildId?: string;
  outcome: "all" | "kills" | "wipes";
  sort: "damage" | "hits" | "hitsPerPull";
  order?: "asc" | "desc";
  roles?: Role[];
  minPulls?: number;
  page: number;
  limit: number;
}

export interface MechanicSnapshotRow extends DamageTotals {
  key: string;
  name: string;
  realm: string;
  region: string;
  classId: number;
  guildId: string;
  guildName: string;
  isKill: boolean;
  role: Role | null;
  pulls: number;
  reportCode: string;
  fightId: number;
  actorId: number;
  timestamp: number;
}

type CoverageStatus = "pending" | "fetched" | "failed" | "archived" | "unavailable" | "duplicate";
export interface MechanicSnapshot {
  mechanic: AvoidableMechanic;
  rows: MechanicSnapshotRow[];
  coverage: { guildId: string; isKill: boolean; status: CoverageStatus; fights: number; updatedAt: string | null }[];
}

type LeaderboardRow = Omit<MechanicSnapshotRow, "guildId" | "isKill" | "role" | "timestamp"> & { hitsPerPull: number };

/** Filter the shared snapshot before merging characters, calculating totals or paging. */
export function selectMechanicLeaderboard(snapshot: MechanicSnapshot, filters: MechanicLeaderboardFilters) {
  const inScope = (row: { guildId: string; isKill: boolean }) =>
    (!filters.guildId || row.guildId === filters.guildId) && (filters.outcome === "all" || row.isKill === (filters.outcome === "kills"));
  const roles = filters.roles ?? MECHANIC_ROLES;
  const includeUnknown = MECHANIC_ROLES.every((role) => roles.includes(role));
  const players = new Map<string, { row: LeaderboardRow; timestamp: number }>();
  for (const entry of snapshot.rows) {
    if (!inScope(entry) || (entry.role ? !roles.includes(entry.role) : !includeUnknown)) continue;
    const { guildId: _guildId, isKill: _isKill, role: _role, timestamp, ...values } = entry;
    const existing = players.get(entry.key);
    if (!existing) {
      players.set(entry.key, { row: { ...values, hitsPerPull: 0 }, timestamp });
      continue;
    }
    const totals = {
      damage: existing.row.damage + entry.damage, hits: existing.row.hits + entry.hits,
      directHits: existing.row.directHits + entry.directHits, ticks: existing.row.ticks + entry.ticks,
      pulls: existing.row.pulls + entry.pulls,
    };
    if (timestamp > existing.timestamp) {
      existing.row = { ...values, ...totals, hitsPerPull: 0 };
      existing.timestamp = timestamp;
    } else Object.assign(existing.row, totals);
  }
  const rows = [...players.values()].map(({ row }) => ({ ...row, hitsPerPull: row.hits / row.pulls }))
    .filter((row) => row.pulls >= (filters.minPulls ?? 0));
  const direction = filters.order === "asc" ? 1 : -1;
  rows.sort((a, b) => direction * (a[filters.sort] - b[filters.sort]) || b.damage - a.damage || a.key.localeCompare(b.key));
  const totals = rows.reduce((sum, row) => ({
    players: sum.players + 1, damage: sum.damage + row.damage, hits: sum.hits + row.hits,
    maxDamage: Math.max(sum.maxDamage, row.damage), maxHits: Math.max(sum.maxHits, row.hits), maxHitsPerPull: Math.max(sum.maxHitsPerPull, row.hitsPerPull),
  }), { players: 0, damage: 0, hits: 0, maxDamage: 0, maxHits: 0, maxHitsPerPull: 0 });
  const coverage: Record<CoverageStatus, number> = { pending: 0, fetched: 0, failed: 0, archived: 0, unavailable: 0, duplicate: 0 };
  let updatedAt: string | null = null;
  for (const entry of snapshot.coverage) {
    if (!inScope(entry)) continue;
    coverage[entry.status] += entry.fights;
    if (entry.updatedAt && (!updatedAt || entry.updatedAt > updatedAt)) updatedAt = entry.updatedAt;
  }
  return {
    mechanic: snapshot.mechanic, rows: rows.slice((filters.page - 1) * filters.limit, filters.page * filters.limit),
    totals, coverage, updatedAt, page: filters.page, limit: filters.limit, totalPages: Math.ceil(rows.length / filters.limit),
  };
}
