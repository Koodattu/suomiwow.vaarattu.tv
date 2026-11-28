import { averageItemLevel, type ForeverRecords } from "./forever-details";
import { ForeverCharacterDetail, ForeverItem } from "./forever-details.models";
import { ForeverError } from "./forever-errors";
import { ForeverCharacter } from "./forever.models";
import { foreverVisibility } from "./forever-visibility";
import { ForeverSnapshotCache } from "./forever-snapshot";

export const RECORD_BOARDS = ["itemLevel", "epicsEquipped", "achievements", "mounts", "exalted",
  "battlegroundsWon", "honorableKills", "duelsWon", "totalKills"] as const;
export type RecordBoard = typeof RECORD_BOARDS[number];
const PAGE_SIZE = 50;
// Newer Forever items are missing from Blizzard's item catalogs until it publishes them.
// Averages over the known slots are ranked while at most two are unknown; each row shows its count.
const MAX_UNKNOWN_SLOTS = 2;

export interface ForeverRecordRow {
  id: string; region: string; slug: string; name: string; className: string | null; race: string | null;
  faction: string | null; ruleset: string | null; level: number | null; avatarUrl: string | null;
  guild: { name: string; slug: string } | null;
  values: Partial<Record<RecordBoard, number>>; itemLevelUnknown: number | null;
}

export async function itemLevels(ids: readonly number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const rows = await ForeverItem.find({ _id: { $in: [...new Set(ids)] }, level: { $ne: null } }).select("level").lean();
  return new Map(rows.map(row => [row._id as number, row.level as number]));
}

export async function buildForeverRecords(): Promise<{ rows: ForeverRecordRow[] }> {
  const visibility = await foreverVisibility();
  const characters = (await ForeverCharacter.find({ region: "eu", status: "tracked", level: { $gte: 40 } })
    .select("region slug name className race faction ruleset level avatarUrl guild source independentlyTracked").lean()).filter(visibility.includes);
  const details = await ForeverCharacterDetail.find({ _id: { $in: characters.map(character => character._id) } })
    .select("armory.gear.id armory.gear.slot armory.gear.inventoryType armory.honorableKills blizzard.records blizzard.achievementCount").lean();
  const levels = await itemLevels(details.flatMap(detail => (detail.armory?.gear ?? []).map(item => (item as { id: number }).id)));
  const byId = new Map(details.map(detail => [String(detail._id), detail]));
  const rows = characters.flatMap(character => {
    const detail = byId.get(String(character._id));
    if (!detail) return [];
    const records = (detail.blizzard?.records ?? {}) as ForeverRecords;
    const gear = (detail.armory?.gear ?? []) as { id: number; slot: string; inventoryType?: string | null }[];
    // Item level compares finished characters; leveling gear is not the race.
    const itemLevel = character.level === 60 ? averageItemLevel(gear, levels) : null;
    const values: ForeverRecordRow["values"] = {};
    if (itemLevel && itemLevel.unknown <= MAX_UNKNOWN_SLOTS) values.itemLevel = itemLevel.average;
    for (const key of ["epicsEquipped", "mounts", "exalted", "battlegroundsWon", "duelsWon", "totalKills"] as const) {
      if (typeof records[key] === "number") values[key] = records[key];
    }
    // Forever achievements award no points, so completed achievements are counted instead.
    if (typeof detail.blizzard?.achievementCount === "number") values.achievements = detail.blizzard.achievementCount;
    if (typeof detail.armory?.honorableKills === "number") values.honorableKills = detail.armory.honorableKills;
    return [{
      id: String(character._id), region: character.region, slug: character.slug, name: character.name || character.slug,
      className: character.className ?? null, race: character.race ?? null, faction: character.faction ?? null,
      ruleset: character.ruleset ?? null, level: character.level ?? null, avatarUrl: character.avatarUrl ?? null,
      guild: character.guild?.name ? { name: character.guild.name, slug: character.guild.slug } : null,
      values, itemLevelUnknown: itemLevel?.unknown ?? null,
    }];
  });
  return { rows };
}

export const foreverRecordsCache = new ForeverSnapshotCache("forever:records:v1", buildForeverRecords);

const filterValue = (value: unknown) => {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 100) throw new ForeverError("invalid_input");
  return value;
};

export async function foreverRecords(query: { board?: unknown; className?: unknown; guild?: unknown; ruleset?: unknown; faction?: unknown; page?: unknown }) {
  const board = (query.board ?? "itemLevel") as RecordBoard;
  if (!RECORD_BOARDS.includes(board)) throw new ForeverError("invalid_input");
  const filters = { className: filterValue(query.className), guild: filterValue(query.guild), ruleset: filterValue(query.ruleset), faction: filterValue(query.faction) };
  const { rows } = await foreverRecordsCache.get();
  const ranked = rows.filter(row => row.values[board] !== undefined && row.values[board]! > 0)
    .sort((a, b) => b.values[board]! - a.values[board]! || a.name.localeCompare(b.name, "fi") || a.id.localeCompare(b.id));
  // Ranks stay global so a filtered view still shows each character's standing.
  const withRank = ranked.map((row, index) => ({ ...row, rank: index + 1 }));
  const filtered = withRank.filter(row => (!filters.className || row.className === filters.className)
    && (!filters.guild || row.guild?.slug === filters.guild) && (!filters.ruleset || row.ruleset === filters.ruleset)
    && (!filters.faction || row.faction === filters.faction));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1));
  const options = (key: "className" | "ruleset" | "faction") => [...new Set(ranked.map(row => row[key]).filter((value): value is string => !!value))].sort();
  const guilds = new Map(ranked.flatMap(row => row.guild ? [[row.guild.slug, row.guild.name] as const] : []));
  return {
    board, total: filtered.length, ranked: ranked.length, page, pageSize: PAGE_SIZE,
    rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    filterOptions: { className: options("className"), ruleset: options("ruleset"), faction: options("faction"),
      guild: [...guilds].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name, "fi")) },
  };
}

/** Gear and record highlights for one guild's tracked members. */
export async function foreverGuildRecords(slug: string) {
  const { rows } = await foreverRecordsCache.get();
  const members = rows.filter(row => row.guild?.slug === slug);
  const geared = members.filter(row => row.values.itemLevel !== undefined).sort((a, b) => b.values.itemLevel! - a.values.itemLevel!);
  const average = geared.length ? Math.round(geared.reduce((sum, row) => sum + row.values.itemLevel!, 0) / geared.length * 10) / 10 : null;
  return { averageItemLevel: average, gearedMembers: geared.length, topGeared: geared.slice(0, 5) };
}
