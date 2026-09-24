import assert from "node:assert/strict";
import test from "node:test";
import { createAccountTimeline, positionOnTimeline, timelineRange, packTimelineRanges, timelineTicks } from "../src/lib/account-raid-timeline.ts";

const now = Date.parse("2026-01-01");
const activity = (start, end, characterId = "one") => ({ characterId, firstSeenAt: start, lastSeenAt: end, reportCount: 4, specs: ["frost"] });
const raid = (id, start, end, characters = []) => ({ id, name: `Raid ${id}`, expansion: "Expansion", starts: { eu: start }, ends: { eu: end }, characters });

test("one calendar aligns the same date across overlapping raid tiers", () => {
  const rows = [raid(1, "2025-01-01", "2025-05-01", [activity("2025-02-01", "2025-04-01")]), raid(2, "2025-03-01", "2025-06-01", [activity("2025-03-01", "2025-05-01")])];
  const scale = createAccountTimeline(rows, "EU", true, now);
  assert.equal(scale.sections.length, 1);
  assert.equal(scale.sections[0].compressed, false);
  assert.equal(positionOnTimeline(scale, Date.parse("2025-03-01")), timelineRange(scale, Date.parse("2025-03-01"), Date.parse("2025-05-01")).left);
  assert.equal(scale.start, Date.parse("2025-01-01"));
  assert.equal(scale.end, Date.parse("2025-06-01"));
});

test("compresses inactive intervals while preserving active-time proportions", () => {
  const rows = [raid(1, "2024-01-01", "2024-02-01", [activity("2024-01-10", "2024-01-20")]), raid(2, "2024-02-01", "2025-01-01"), raid(3, "2025-01-01", "2025-02-01", [activity("2025-01-10", "2025-01-20", "alt")])];
  const scale = createAccountTimeline(rows, "eu", true, now);
  assert.deepEqual(scale.sections.map((section) => section.compressed), [false, true, false]);
  assert.equal(scale.sections[1].length, 30 * 86400000);
  assert.equal(scale.sections[0].length, scale.sections[2].length);
  assert.equal(timelineRange(scale, Date.parse("2024-01-01"), Date.parse("2024-02-01")).width, timelineRange(scale, Date.parse("2025-01-01"), Date.parse("2025-02-01")).width);
  const expanded = createAccountTimeline(rows, "eu", false, now);
  assert.equal(expanded.length, expanded.end - expanded.start);
  assert.ok(expanded.sections.every((section) => !section.compressed));
});

test("an inactive side raid does not collapse an overlapping active raid", () => {
  const scale = createAccountTimeline([raid(1, "2025-01-01", "2025-06-01", [activity("2025-02-01", "2025-05-01")]), raid(2, "2025-02-01", "2025-04-01")], "eu", true, now);
  assert.ok(scale.sections.every((section) => !section.compressed));
});

test("keeps farming activity after a raid ends at its actual calendar position", () => {
  const scale = createAccountTimeline([raid(1, "2025-01-01", "2025-02-01", [activity("2025-04-01", "2025-05-01")])], "eu", true, now);
  assert.equal(scale.end, Date.parse("2025-05-01"));
  assert.ok(positionOnTimeline(scale, Date.parse("2025-04-01")) > positionOnTimeline(scale, Date.parse("2025-02-01")));
  assert.equal(positionOnTimeline(scale, Date.parse("2025-05-01")), 100);
});

test("uses regional dates and falls back to observations when release dates are unknown", () => {
  const row = raid(1, "2025-01-03", "2025-05-01", [activity("2025-02-01", "2025-03-01")]);
  row.starts.us = "2025-01-02";
  row.ends.us = "2025-05-02";
  assert.equal(createAccountTimeline([row], "US", true, now).raids[0].start, Date.parse("2025-01-02"));
  const missing = createAccountTimeline([{ ...row, starts: {}, ends: {} }], "eu", true, now);
  assert.equal(missing.raids[0].start, Date.parse("2025-02-01"));
  assert.equal(missing.raids[0].end, Date.parse("2025-03-01"));
});

test("handles empty activity, unreleased raids, and an open current tier", () => {
  assert.equal(createAccountTimeline([], "eu", true, now), null);
  assert.equal(createAccountTimeline([raid(1, "2025-01-01", "2025-02-01")], "eu", true, now), null);
  const current = raid(1, "2025-01-01", undefined, [activity("2025-02-01", "2025-03-01")]);
  const scale = createAccountTimeline([current, raid(2, "2027-01-01", "2027-05-01")], "eu", true, now);
  assert.equal(scale.raids.length, 1);
  assert.equal(scale.raids[0].end, now);
});

test("single observations have finite positions and zero-duration spans", () => {
  const row = { ...raid(1, undefined, undefined, [activity("2025-01-01", "2025-01-01")]), starts: {}, ends: {} };
  const scale = createAccountTimeline([row], "eu", true, now);
  assert.deepEqual(timelineRange(scale, Date.parse("2025-01-01"), Date.parse("2025-01-01")), { left: 0, width: 0 });
});

test("packs simultaneous activity separately and reuses lanes when intervals end", () => {
  const packed = packTimelineRanges([{ left: 20, width: 10 }, { left: 0, width: 20 }, { left: 10, width: 15 }, { left: 30, width: 5 }]);
  assert.deepEqual(packed.map((range) => range.lane), [0, 1, 0, 0]);
});

test("calendar ticks increase monotonically and omit compressed interiors", () => {
  const scale = createAccountTimeline([raid(1, "2023-01-01", "2023-03-01", [activity("2023-01-10", "2023-02-01")]), raid(2, "2025-01-01", "2025-04-01", [activity("2025-02-01", "2025-03-01")])], "eu", true, now);
  const ticks = timelineTicks(scale);
  assert.ok(ticks.every((tick, index) => index === 0 || tick.left > ticks[index - 1].left));
  assert.ok(!ticks.some((tick) => new Date(tick.time).getUTCFullYear() === 2024));
  assert.ok(ticks.some((tick) => tick.major));
});
