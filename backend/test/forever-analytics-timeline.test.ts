import assert from "node:assert/strict";
import test from "node:test";
import { buildForeverAnalyticsTimeline } from "../src/features/forever/forever-analytics-timeline";

const point = (level: number, at: string) => ({ level, observedAt: new Date(at) });
const now = Date.parse("2026-11-09T10:00:00Z");

test("Helsinki daily snapshots use only observations available that day, carrying levels across gaps", () => {
  const result = buildForeverAnalyticsTimeline([
    { level: 30, race: "Orc", history: [point(30, "2026-11-09T09:00:00Z"), point(10, "2026-11-06T22:30:00Z")] },
    { level: 20, history: [point(20, "2026-11-08T22:00:00Z")] },
    { level: 40, history: [] }, // No invented presence before today.
  ], now);
  assert.deepEqual(result.days.map(day => day.date), ["2026-11-07", "2026-11-08", "2026-11-09"]);
  assert.equal(result.days[0].at, "2026-11-07T21:59:59.999Z");
  assert.deepEqual(result.days[0].buckets, [[0, 10, 1, 1, 1, 0, 1]]);
  assert.deepEqual(result.days[1].buckets, [[0, 10, 1, 0, 0, 0, 1]]);
  assert.deepEqual(result.days[2].buckets, [[0, 30, 1, 1, 0, 20, 1], [1, 20, 1, 1, 1, 0, 1], [1, 40, 1, 0, 0, 0, 0]]);
});

test("counts combine identical facets, keep level one out of activity and preserve unknown metadata", () => {
  const result = buildForeverAnalyticsTimeline([
    { level: 1, race: "Windshaper Skyborne", history: [point(1, "2026-11-09T08:00:00Z")] },
    { level: 1, race: "High Order Skyborne", history: [point(1, "2026-11-09T09:00:00Z")] },
    { level: 2, history: [point(1, "2026-11-08T08:00:00Z"), point(2, "2026-11-09T09:00:00Z")] },
    { level: 0 }, { level: null }, { level: 61 },
  ], now);
  assert.deepEqual(result.facets[0], { race: "Skyborne", className: null, faction: null, ruleset: null });
  assert.deepEqual(result.days[result.days.length - 1].buckets, [[0, 1, 2, 0, 2, 0, 0], [1, 2, 1, 1, 0, 1, 1]]);
});

test("24h expiry is exact; repeats, regressions, invalid and future observations do not create gains", () => {
  const result = buildForeverAnalyticsTimeline([
    { level: 20, history: [point(20, "2026-11-08T10:00:00Z"), point(20, "2026-11-09T09:00:00Z"), point(19, "2026-11-09T09:01:00Z"), point(21, "2026-11-10T00:00:00Z"), point(61, "2026-11-09T09:30:00Z"), point(30, "invalid")] },
    { level: 25, history: [point(10, "2026-11-07T10:00:00Z"), point(20, "2026-11-08T10:00:00Z"), point(25, "2026-11-09T09:00:00Z")] },
  ], now);
  assert.deepEqual(result.days[result.days.length - 1].buckets, [[0, 20, 1, 0, 0, 0, 1], [0, 25, 1, 1, 0, 5, 1]]);
});

test("daily endpoints respect Helsinki DST and year boundaries", () => {
  for (const [first, last, endpoints] of [
    ["2026-03-28T12:00:00Z", "2026-03-30T12:00:00Z", ["2026-03-28T21:59:59.999Z", "2026-03-29T20:59:59.999Z"]],
    ["2026-10-24T12:00:00Z", "2026-10-26T12:00:00Z", ["2026-10-24T20:59:59.999Z", "2026-10-25T21:59:59.999Z"]],
    ["2026-12-31T12:00:00Z", "2027-01-02T12:00:00Z", ["2026-12-31T21:59:59.999Z", "2027-01-01T21:59:59.999Z"]],
  ] as const) {
    const result = buildForeverAnalyticsTimeline([{ level: 10, history: [point(10, first)] }], Date.parse(last));
    assert.deepEqual(result.days.slice(0, -1).map(day => day.at), endpoints);
  }
});

test("empty datasets still expose today, without invented history or character records", () => {
  const result = buildForeverAnalyticsTimeline([], now);
  assert.deepEqual(result.days, [{ date: "2026-11-09", at: new Date(now).toISOString(), buckets: [] }]);
  assert.deepEqual(result.facets, []);
});
