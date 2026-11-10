const DAY = 86_400_000;
const helsinkiDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" });
const helsinkiHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", hourCycle: "h23" });

export interface TimelineCharacter {
  level?: number | null; race?: string | null; className?: string | null; faction?: string | null; ruleset?: string | null;
  history?: { level: number; observedAt: Date }[];
}
// Sparse counts, not character records. A facet identifies race/class/faction/ruleset.
type Bucket = [facet: number, level: number, count: number, active: number, added: number, gains: number, observed: number];

/** One sweep over each history, sampled at Helsinki day ends (today ends at now).
 * Metadata is current: only levels and observation timestamps are historized. */
export function buildForeverAnalyticsTimeline(characters: TimelineCharacter[], now = Date.now()) {
  const facets: { race: string | null; className: string | null; faction: string | null; ruleset: string | null }[] = [];
  const facetIds = new Map<string, number>();
  const validLevel = (level?: number | null): level is number => Number.isInteger(level) && level! >= 1 && level! <= 60;
  let first = now;
  const states = characters.filter(character => validLevel(character.level)).map(character => {
    const facet = { race: ["Windshaper Skyborne", "High Order Skyborne"].includes(character.race || "") ? "Skyborne" : character.race?.trim() || null,
      className: character.className?.trim() || null, faction: character.faction?.trim() || null, ruleset: character.ruleset?.trim() || null };
    const key = JSON.stringify(facet);
    let id = facetIds.get(key);
    if (id === undefined) { id = facets.length; facets.push(facet); facetIds.set(key, id); }
    const history = (character.history || []).map(point => ({ level: point.level, at: new Date(point.observedAt).getTime() }))
      .filter(point => validLevel(point.level) && Number.isFinite(point.at) && point.at <= now)
      .sort((a, b) => a.at - b.at || a.level - b.level);
    if (history.length) first = Math.min(first, history[0].at);
    return { character, facet: id, history, cursor: 0, level: 0, highest: 0, lastActive: -Infinity,
      gains: [] as { at: number; amount: number }[], gainCursor: 0, gainTotal: 0 };
  });
  const today = helsinkiDate.format(now);
  const days: { date: string; at: string; buckets: Bucket[] }[] = [];
  for (let day = Date.parse(`${helsinkiDate.format(first)}T00:00:00Z`); ; day += DAY) {
    const date = new Date(day).toISOString().slice(0, 10), current = date === today;
    // Helsinki changes DST at 03:00/04:00, so the next UTC midnight gives the
    // offset of the next local midnight, including 23- and 25-hour days.
    const at = current ? now : day + DAY - Number(helsinkiHour.format(day + DAY)) * 3_600_000 - 1;
    const buckets = new Map<number, Bucket>();
    for (const state of states) {
      const { history } = state;
      while (state.cursor < history.length && history[state.cursor].at <= at) {
        const point = history[state.cursor];
        if (state.cursor === 0) state.lastActive = point.at;
        else if (point.level > state.highest) {
          const amount = point.level - state.highest;
          state.gains.push({ at: point.at, amount }); state.gainTotal += amount;
          state.lastActive = point.at;
        }
        state.highest = Math.max(state.highest, point.level);
        state.level = point.level; state.cursor++;
      }
      while (state.gainCursor < state.gains.length && state.gains[state.gainCursor].at <= at - DAY) {
        state.gainTotal -= state.gains[state.gainCursor++].amount;
      }
      // No history means no evidence of presence on a past day.
      if (!current && !state.cursor) continue;
      const level = current ? state.character.level! : state.level;
      const key = state.facet * 60 + level - 1;
      const bucket = buckets.get(key) || [state.facet, level, 0, 0, 0, 0, 0] as Bucket;
      bucket[2]++;
      if (state.cursor) {
        if (history[0].at > at - DAY) bucket[4]++;
        if (level > 1) {
          bucket[6]++;
          if (state.lastActive > at - DAY) bucket[3]++;
          bucket[5] += state.gainTotal;
        }
      }
      buckets.set(key, bucket);
    }
    days.push({ date, at: new Date(at).toISOString(), buckets: [...buckets.values()] });
    if (current) break;
  }
  return { startedAt: new Date(first).toISOString(), facets, days };
}
