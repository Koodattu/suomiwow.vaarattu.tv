import { ForeverCharacter } from "./forever.models";
import { visibleForeverCharacters } from "./forever-visibility";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
interface AnalyticsCharacter {
  level?: number | null; race?: string | null; className?: string | null; faction?: string | null; ruleset?: string | null;
  history?: { level: number; observedAt: Date }[];
}
const raceName = (name?: string | null) => ["Windshaper Skyborne", "High Order Skyborne"].includes(name || "") ? "Skyborne" : name?.trim() || null;
const namedCounts = (counts: Map<string | null, number>) => [...counts].map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || (a.name || "").localeCompare(b.name || "", "fi"));

/** Current visible EU cohort; a first observation or observed gain starts a 24h active window.
 * First observations contribute no invented level gains. This does not measure logins. */
export function buildForeverAnalytics(characters: AnalyticsCharacter[], now = Date.now()) {
  const levels = Array.from({ length: 60 }, (_, index) => ({ level: index + 1, count: 0 }));
  const classes = new Map<string | null, number>(), races = new Map<string | null, number>();
  const factions = new Map<string | null, number>(), rulesets = new Map<string | null, number>();
  const factionRulesets = new Map<string, { faction: string | null; ruleset: string | null; count: number }>();
  const raceFactions = new Map<string | null, { alliance: number; horde: number; unknown: number }>();
  const combinations = new Map<string, { race: string | null; className: string | null; count: number; factions: { alliance: number; horde: number; unknown: number } }>();
  const events: { at: number; active: number; observed: number }[] = [];
  let total = 0, levelSum = 0, historyCharacters = 0, new24h = 0, levelsGained24h = 0, coverageStart: number | null = null;
  for (const character of characters) {
    if (!Number.isInteger(character.level) || character.level! < 1 || character.level! > 60) continue;
    const level = character.level!, race = raceName(character.race), className = character.className?.trim() || null;
    total++; levelSum += level; levels[level - 1].count++;
    classes.set(className, (classes.get(className) || 0) + 1); races.set(race, (races.get(race) || 0) + 1);
    const factionName = character.faction?.trim() || null, ruleset = character.ruleset?.trim() || null;
    factions.set(factionName, (factions.get(factionName) || 0) + 1); rulesets.set(ruleset, (rulesets.get(ruleset) || 0) + 1);
    const factionRulesetKey = JSON.stringify([factionName, ruleset]);
    const factionRuleset = factionRulesets.get(factionRulesetKey) || { faction: factionName, ruleset, count: 0 };
    factionRuleset.count++; factionRulesets.set(factionRulesetKey, factionRuleset);
    const raceFactionCounts = raceFactions.get(race) || { alliance: 0, horde: 0, unknown: 0 };
    const faction = character.faction?.trim().toLowerCase();
    const factionKey = faction === "alliance" || faction === "horde" ? faction : "unknown";
    raceFactionCounts[factionKey]++;
    raceFactions.set(race, raceFactionCounts);
    const key = JSON.stringify([race, className]);
    const combination = combinations.get(key) || { race, className, count: 0, factions: { alliance: 0, horde: 0, unknown: 0 } };
    combination.count++; combination.factions[factionKey]++; combinations.set(key, combination);

    const history = (character.history || []).map(point => ({ level: point.level, at: new Date(point.observedAt).getTime() }))
      .filter(point => Number.isInteger(point.level) && point.level >= 1 && point.level <= 60 && Number.isFinite(point.at) && point.at <= now)
      .sort((a, b) => a.at - b.at || a.level - b.level);
    if (!history.length) continue;
    if (history[0].at > now - DAY) new24h++;
    // Level-one characters remain in population/new-arrival statistics, but not activity.
    if (level === 1) continue;
    historyCharacters++;
    coverageStart = Math.min(coverageStart ?? history[0].at, history[0].at);
    events.push({ at: history[0].at, active: 0, observed: 1 });
    let highest = history[0].level;
    let interval = { start: history[0].at, end: history[0].at + DAY };
    // Merge overlapping windows per character so multiple gains count only once.
    for (const point of history.slice(1)) {
      if (point.level <= highest) continue;
      if (point.at > now - DAY) levelsGained24h += point.level - highest;
      highest = point.level;
      if (point.at <= interval.end) interval.end = point.at + DAY;
      else {
        events.push({ at: interval.start, active: 1, observed: 0 }, { at: interval.end, active: -1, observed: 0 });
        interval = { start: point.at, end: point.at + DAY };
      }
    }
    events.push({ at: interval.start, active: 1, observed: 0 }, { at: interval.end, active: -1, observed: 0 });
  }
  events.sort((a, b) => a.at - b.at);
  const activity: { at: string; active: number; observed: number; partial: boolean }[] = [];
  let active = 0, observed = 0, cursor = 0;
  if (coverageStart !== null) {
    const start = Math.max(coverageStart, now - 30 * DAY);
    const times = [start];
    for (let at = Math.floor(start / (6 * HOUR)) * 6 * HOUR + 6 * HOUR; at < now; at += 6 * HOUR) times.push(at);
    if (times[times.length - 1] !== now) times.push(now);
    for (const at of times) {
      while (cursor < events.length && events[cursor].at <= at) {
        active += events[cursor].active; observed += events[cursor].observed; cursor++;
      }
      activity.push({ at: new Date(at).toISOString(), active, observed, partial: at - DAY < coverageStart });
    }
  }
  let cumulative = 0;
  const middle = (total + 1) / 2;
  const lowerMiddle = levels.find(entry => (cumulative += entry.count) >= Math.floor(middle))?.level;
  cumulative = 0;
  const upperMiddle = levels.find(entry => (cumulative += entry.count) >= Math.ceil(middle))?.level;
  return {
    generatedAt: new Date(now).toISOString(), total, historyCharacters,
    averageLevel: total ? levelSum / total : null,
    medianLevel: total ? (lowerMiddle! + upperMiddle!) / 2 : null,
    atMaxLevel: levels[59].count, active24h: active, new24h, levelsGained24h,
    statistics: { factions: namedCounts(factions), rulesets: namedCounts(rulesets),
      combinations: [...factionRulesets.values()].sort((a, b) => b.count - a.count ||
        `${a.faction} ${a.ruleset}`.localeCompare(`${b.faction} ${b.ruleset}`, "fi")),
      averageLevel: total ? levelSum / total : null, atMaxLevel: levels[59].count },
    coverageStart: coverageStart === null ? null : new Date(coverageStart).toISOString(),
    levels, classes: namedCounts(classes), races: namedCounts(races).map(race => ({ ...race, factions: raceFactions.get(race.name)! })),
    combinations: [...combinations.values()].sort((a, b) => b.count - a.count ||
      `${a.race} ${a.className}`.localeCompare(`${b.race} ${b.className}`, "fi")), activity,
  };
}

type Analytics = ReturnType<typeof buildForeverAnalytics>;
let cached: { visibility: string; expiresAt: number; data: Analytics } | undefined;
let pending: { visibility: string; promise: Promise<Analytics> } | undefined;

export async function foreverAnalytics() {
  const visible = await visibleForeverCharacters(), visibility = JSON.stringify(visible);
  if (cached?.visibility === visibility && cached.expiresAt > Date.now()) return cached.data;
  if (pending?.visibility === visibility) return pending.promise;
  const promise = (async () => {
    const characters = await ForeverCharacter.find({ ...visible, region: "eu", status: "tracked", level: { $gte: 1, $lte: 60 } })
      .select("-_id level race className faction ruleset history.level history.observedAt").lean();
    const data = buildForeverAnalytics(characters);
    cached = { visibility, expiresAt: Date.now() + 60_000, data };
    return data;
  })();
  pending = { visibility, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}
