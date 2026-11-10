import type { ForeverAnalytics, ForeverAnalyticsTimeline } from "./forever-api";

const counts = (map: Map<string | null, number>) => [...map].map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || (a.name || "").localeCompare(b.name || "", "fi"));

/** Fold cached count buckets locally; neither slider performs an API request. */
export function selectForeverAnalytics(timeline: ForeverAnalyticsTimeline, dayIndex: number, minimumLevel: number): ForeverAnalytics {
  const index = Math.max(0, Math.min(timeline.days.length - 1, dayIndex));
  const day = timeline.days[index];
  const minimum = Math.max(1, Math.min(60, Math.floor(minimumLevel)));
  const levels = Array.from({ length: 60 }, (_, i) => ({ level: i + 1, count: 0 }));
  const classes = new Map<string | null, number>(), factions = new Map<string | null, number>(), rulesets = new Map<string | null, number>();
  const races = new Map<string | null, ForeverAnalytics["races"][number]>();
  const combinations = new Map<string, ForeverAnalytics["combinations"][number]>();
  const factionRulesets = new Map<string, ForeverAnalytics["statistics"]["combinations"][number]>();
  let total = 0, sum = 0, active24h = 0, new24h = 0, levelsGained24h = 0, historyCharacters = 0;
  for (const [facetId, level, count, active, added, gains, observed] of day.buckets) {
    if (level < minimum) continue;
    const { race, className, faction, ruleset } = timeline.facets[facetId];
    const affiliation = faction?.toLowerCase();
    const factionKey = affiliation === "alliance" || affiliation === "horde" ? affiliation : "unknown";
    total += count; sum += level * count; levels[level - 1].count += count;
    active24h += active; new24h += added; levelsGained24h += gains; historyCharacters += observed;
    classes.set(className, (classes.get(className) || 0) + count);
    factions.set(faction, (factions.get(faction) || 0) + count);
    rulesets.set(ruleset, (rulesets.get(ruleset) || 0) + count);
    const raceRow = races.get(race) || { name: race, count: 0, factions: { alliance: 0, horde: 0, unknown: 0 } };
    raceRow.count += count; raceRow.factions[factionKey] += count; races.set(race, raceRow);
    const comboKey = JSON.stringify([race, className]);
    const combo = combinations.get(comboKey) || { race, className, count: 0, factions: { alliance: 0, horde: 0, unknown: 0 } };
    combo.count += count; combo.factions[factionKey] += count; combinations.set(comboKey, combo);
    const factionKeyPair = JSON.stringify([faction, ruleset]);
    const factionRow = factionRulesets.get(factionKeyPair) || { faction, ruleset, count: 0 };
    factionRow.count += count; factionRulesets.set(factionKeyPair, factionRow);
  }
  let cumulative = 0;
  const medianAt = (position: number) => {
    cumulative = 0;
    return levels.find(row => (cumulative += row.count) >= position)?.level || 0;
  };
  const activity = timeline.days.slice(0, index + 1).filter(sample => Date.parse(sample.at) >= Date.parse(day.at) - 30 * 86400_000)
    .map(sample => {
      let active = 0, observed = 0;
      for (const [, level, , activeCount, , , observedCount] of sample.buckets) {
        if (level < Math.max(2, minimum)) continue;
        active += activeCount; observed += observedCount;
      }
      return { at: sample.at, active, observed, partial: Date.parse(sample.at) - 86400_000 < Date.parse(timeline.startedAt) };
    });
  return {
    generatedAt: day.at, total, averageLevel: total ? sum / total : null,
    medianLevel: total ? (medianAt(Math.floor((total + 1) / 2)) + medianAt(Math.ceil((total + 1) / 2))) / 2 : null,
    atMaxLevel: levels[59].count, active24h, new24h, levelsGained24h, historyCharacters,
    coverageStart: timeline.startedAt, levels, classes: counts(classes),
    races: [...races.values()].sort((a, b) => b.count - a.count || (a.name || "").localeCompare(b.name || "", "fi")),
    combinations: [...combinations.values()], activity,
    statistics: { factions: counts(factions), rulesets: counts(rulesets), combinations: [...factionRulesets.values()],
      averageLevel: total ? sum / total : null, atMaxLevel: levels[59].count },
  };
}
