import { SharedSnapshotCacheService } from "../../services/shared-snapshot-cache.service";
import logger from "../../utils/logger";
import { ForeverCharacter, ForeverWorker } from "./forever.models";
import { visibleForeverCharacters } from "./forever-visibility";
import { ForeverError } from "./forever-errors";
import { compareForeverLevels } from "./forever-level60";
import { ForeverLeaderboardCache, ForeverLeaderboardLease } from "./forever-leaderboard.models";

export const FOREVER_PUBLIC_FIELDS = "region slug name level className race faction ruleset avatarUrl guild lastFetchedAt lastAttemptAt nextFetchAt sourceUpdatedAt lastLevelAt estimatedLevel60At errorCode twitchChannel twitchIsLive twitchCheckedAt";
const FRESH_MS = 30_000;
const fields = ["race", "className", "faction", "ruleset", "guild"] as const;
const skyborneRaces = ["Skyborne", "Windshaper Skyborne", "High Order Skyborne"];
const displayRace = (race: string) => skyborneRaces.includes(race) ? "Skyborne" : race;
// The same cross-process snapshot/lease mechanism as M+, with no stale grace period.
const shared = new SharedSnapshotCacheService("Forever leaderboard", () => 0, { cache: ForeverLeaderboardCache, leases: ForeverLeaderboardLease });

async function buildSnapshot() {
  const visible = await visibleForeverCharacters();
  const [characters, pending] = await Promise.all([
    ForeverCharacter.find({ ...visible, region: "eu", status: "tracked", level: { $gte: 1 } })
      .select(FOREVER_PUBLIC_FIELDS).sort({ level: -1, lastLevelAt: 1, _id: 1 }).readConcern("snapshot").lean().maxTimeMS(10_000),
    ForeverCharacter.countDocuments({ ...visible, region: "eu", status: "tracked", level: { $exists: false } }).maxTimeMS(10_000),
  ]);
  // Rank once, before any filtering or pagination. Histories never enter the snapshot.
  const ranked = characters.sort(compareForeverLevels).map((character, index) => ({ ...character, rank: index + 1 }));
  const filterOptions = Object.fromEntries(fields.map(field => [field, [...new Set(ranked.map(character => {
    const value = field === "guild" ? character.guild?.name : character[field];
    return field === "race" && value ? displayRace(value) : value;
  }).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "en"))]));
  return { generatedAt: new Date().toISOString(), characters: ranked, pending, filterOptions };
}

type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;
type Query = { page?: unknown; race?: unknown; className?: unknown; faction?: unknown; ruleset?: unknown; guild?: unknown; twitch?: unknown; search?: unknown };
let local: { key: string; data: Snapshot } | undefined;
let pendingBuild: { key: string; promise: Promise<Snapshot> } | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

async function snapshot(warm = false) {
  // This small indexed read also prevents stale L1 data across API processes after moderation.
  const worker = await ForeverWorker.findById("armory").select("leaderboardRevision lastTickAt lastSuccessAt nextRequestAt errorCode").lean();
  const key = `forever:leaderboard:v2:${worker?.leaderboardRevision || 0}`;
  const freshAfter = Date.now() - (warm ? FRESH_MS / 2 : FRESH_MS);
  if (local?.key === key && Date.parse(local.data.generatedAt) > freshAfter) return { data: local.data, worker };
  let promise = pendingBuild?.key === key ? pendingBuild.promise : undefined;
  if (!promise) {
    promise = shared.get(key, buildSnapshot, FRESH_MS, warm).then(data => {
      local = { key, data };
      return data;
    }).finally(() => { if (pendingBuild?.promise === promise) pendingBuild = undefined; });
    pendingBuild = { key, promise };
  }
  return { data: await promise, worker };
}

export async function invalidateForeverLeaderboard() {
  // Versioned keys prevent a pre-moderation build from publishing into the new view.
  await ForeverWorker.updateOne({ _id: "armory" }, { $inc: { leaderboardRevision: 1 } }, { upsert: true });
  local = undefined;
}

export function startForeverLeaderboard() {
  if (timer) return;
  const warm = () => { void snapshot(true).catch(error => logger.error("[Forever] Leaderboard warm-up failed", error)); };
  warm();
  timer = setInterval(warm, FRESH_MS / 2);
  timer.unref();
}

export async function stopForeverLeaderboard() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await pendingBuild?.promise.catch(() => undefined);
  local = undefined;
}

function parseQuery(query: Query) {
  const page = Math.min(1000, Math.max(1, Number.parseInt(String(query.page), 10) || 1));
  const filters: Partial<Record<typeof fields[number], string>> = {};
  for (const field of fields) {
    const value = query[field];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || value.length > (field === "guild" ? 150 : 80)) throw new ForeverError("invalid_input");
    filters[field] = value;
  }
  if (query.search !== undefined && (typeof query.search !== "string" || query.search.length > 100)) throw new ForeverError("invalid_input");
  if (query.twitch !== undefined && query.twitch !== "" && query.twitch !== "only") throw new ForeverError("invalid_input");
  return { page, filters, search: ((query.search as string) || "").trim().toLowerCase(), twitchOnly: query.twitch === "only" };
}

const namedCounts = (counts: Map<string | null, number>) => [...counts].map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || (a.name || "").localeCompare(b.name || "", "en"));

export async function leaderboard(query: Query = {}) {
  const { page, filters, search, twitchOnly } = parseQuery(query);
  const { data, worker } = await snapshot();
  const characters = data.characters.filter(character => {
    if (twitchOnly && !character.twitchChannel) return false;
    if (search && !character.name?.toLowerCase().includes(search) && !character.guild?.name?.toLowerCase().includes(search)) return false;
    return fields.every(field => {
      if (!filters[field]) return true;
      const value = field === "guild" ? character.guild?.name : character[field];
      return field === "race" && filters[field] === "Skyborne" ? !!value && skyborneRaces.includes(value) : value === filters[field];
    });
  });
  const factions = new Map<string | null, number>(), rulesets = new Map<string | null, number>();
  const combinations = new Map<string, { faction: string | null; ruleset: string | null; count: number }>();
  let levels = 0, atMaxLevel = 0;
  for (const character of characters) {
    const faction = character.faction || null, ruleset = character.ruleset || null;
    factions.set(faction, (factions.get(faction) || 0) + 1);
    rulesets.set(ruleset, (rulesets.get(ruleset) || 0) + 1);
    const key = JSON.stringify([faction, ruleset]);
    const combination = combinations.get(key) || { faction, ruleset, count: 0 };
    combination.count++; combinations.set(key, combination);
    levels += character.level!;
    if (character.level === 60) atMaxLevel++;
  }
  return {
    generatedAt: data.generatedAt,
    characters: characters.slice((page - 1) * 50, page * 50), total: characters.length, totalRanked: data.characters.length,
    statistics: {
      factions: namedCounts(factions), rulesets: namedCounts(rulesets),
      combinations: [...combinations.values()].sort((a, b) => b.count - a.count || (a.faction || "").localeCompare(b.faction || "", "en") || (a.ruleset || "").localeCompare(b.ruleset || "", "en")),
      averageLevel: characters.length ? levels / characters.length : null, atMaxLevel,
    },
    pending: data.pending, filterOptions: data.filterOptions, page, pageSize: 50, worker, enabled: true,
  };
}
