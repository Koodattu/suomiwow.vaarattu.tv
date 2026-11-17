import assert from "node:assert/strict";
import test from "node:test";
import { foreverDistributionMaximum, selectForeverAnalytics } from "../src/lib/forever-analytics.ts";

const timeline = {
  startedAt: "2026-11-07T20:00:00Z",
  facets: [
    { race: "Skyborne", className: "Mage", faction: "Horde", ruleset: "PvP" },
    { race: "Skyborne", className: "Druid", faction: "Alliance", ruleset: "Normal" },
    { race: null, className: null, faction: null, ruleset: null },
  ],
  days: [
    { date: "2026-11-07", at: "2026-11-07T21:59:59.999Z", buckets: [[0, 1, 3, 0, 3, 0, 0], [1, 10, 1, 1, 1, 0, 1]] },
    { date: "2026-11-08", at: "2026-11-08T21:59:59.999Z", buckets: [[0, 20, 3, 3, 0, 57, 3], [1, 30, 1, 1, 0, 20, 1]] },
    { date: "2026-11-09", at: "2026-11-09T10:00:00Z", buckets: [[0, 20, 3, 0, 0, 0, 3], [1, 60, 1, 1, 0, 30, 1], [2, 1, 1, 0, 1, 0, 0]] },
  ],
};

test("activity retains every day from the start through the selected day beyond thirty days", () => {
  const days = Array.from({ length: 45 }, (_, index) => {
    const at = new Date(Date.parse("2026-09-01T21:00:00Z") + index * 86400_000).toISOString();
    return { date: at.slice(0, 10), at, buckets: [[0, 20, 3, 2, 0, 0, 3]] };
  });
  const history = { ...timeline, startedAt: days[0].at, days };
  const latest = selectForeverAnalytics(history, 44, 1);
  assert.equal(latest.activity.length, 45);
  assert.equal(latest.activity[0].at, days[0].at);
  assert.equal(latest.activity.at(-1).at, days[44].at);
  const past = selectForeverAnalytics(history, 35, 1);
  assert.equal(past.activity.length, 36);
  assert.equal(past.activity[0].at, days[0].at);
  assert.equal(past.activity.at(-1).at, days[35].at);
});

test("distribution ceiling uses the latest counts and fits larger historical level totals across facets", () => {
  const latest = [{ level: 1, count: 0 }, { level: 60, count: 589 }];
  assert.equal(foreverDistributionMaximum(latest, timeline), 600);
  const history = { ...timeline, days: [{ ...timeline.days[0], buckets: [[0, 20, 420], [1, 20, 281], [1, 30, 50]] }] };
  assert.equal(foreverDistributionMaximum(latest, history), 800);
  assert.equal(foreverDistributionMaximum([{ level: 60, count: 810 }], history), 900);
  assert.equal(foreverDistributionMaximum([]), 1);
});

test("date and minimum level filter every population aggregate using counts rather than number of buckets", () => {
  const all = selectForeverAnalytics(timeline, 2, 1);
  assert.equal(all.total, 5); assert.equal(all.averageLevel, 24.2); assert.equal(all.medianLevel, 20);
  assert.deepEqual(all.races.find(row => row.name === "Skyborne").factions, { horde: 3, alliance: 1, unknown: 0 });
  const high = selectForeverAnalytics(timeline, 2, 21);
  assert.equal(high.total, 1); assert.equal(high.active24h, 1); assert.equal(high.levelsGained24h, 30);
  assert.equal(high.new24h, 0); assert.equal(high.atMaxLevel, 1); assert.equal(high.medianLevel, 60);
  assert.deepEqual(high.classes, [{ name: "Druid", count: 1 }]);
  assert.deepEqual(high.statistics.combinations, [{ faction: "Alliance", ruleset: "Normal", count: 1 }]);
  assert.equal(high.combinations[0].count, 1);
  assert.equal(high.levels[19].count, 0); assert.equal(high.levels[59].count, 1);
  const past = selectForeverAnalytics(timeline, 1, 20);
  assert.equal(past.total, 4); assert.equal(past.medianLevel, 20); assert.equal(past.levelsGained24h, 77);
  assert.equal(past.activity.length, 2); assert.equal(past.activity[0].active, 0);
  assert.equal(past.activity[1].active, 4); assert.equal(past.activity[1].observed, 4);
  assert.equal(past.generatedAt, timeline.days[1].at);
});

test("activity uses each day's level cutoff, excludes level one, and never includes future days", () => {
  const first = selectForeverAnalytics(timeline, 0, 1);
  assert.equal(first.total, 4); assert.equal(first.new24h, 4); assert.equal(first.historyCharacters, 1);
  assert.deepEqual(first.activity, [{ at: timeline.days[0].at, active: 1, observed: 1, partial: true }]);
  const filtered = selectForeverAnalytics(timeline, 2, 30);
  assert.deepEqual(filtered.activity.map(point => point.observed), [0, 1, 1]);
  assert.deepEqual(filtered.activity.map(point => point.partial), [true, false, false]);
});

test("empty filtered view has zero counts, no invented median, and does not mutate cached data", () => {
  const before = JSON.stringify(timeline);
  const empty = selectForeverAnalytics(timeline, 0, 60);
  assert.equal(empty.total, 0); assert.equal(empty.medianLevel, null); assert.equal(empty.averageLevel, null);
  assert.equal(empty.levels.length, 60); assert.ok(empty.levels.every(level => level.count === 0));
  assert.deepEqual(empty.classes, []); assert.deepEqual(empty.combinations, []);
  selectForeverAnalytics(timeline, 2, 20);
  assert.equal(JSON.stringify(timeline), before);
});

test("median averages the two middle levels in an even population", () => {
  assert.equal(selectForeverAnalytics({ ...timeline, days: [{ ...timeline.days[0], buckets: [[0, 10, 2, 0, 0, 0, 2], [1, 30, 2, 0, 0, 0, 2]] }] }, 0, 1).medianLevel, 20);
});
