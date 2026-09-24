import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountTimeline, getActivityPosition } from "../src/lib/account-raid-timeline.ts";

const now = Date.parse("2026-01-01");
const activity = { characterId: "one", firstSeenAt: "2025-02-01", lastSeenAt: "2025-03-01", reportCount: 4, specs: ["frost"] };
const raid = (id, active = false) => ({ id, name: `Raid ${id}`, expansion: "Expansion", starts: { eu: `2025-0${id}-01` }, ends: { eu: `2025-0${id + 1}-01` }, characters: active ? [activity] : [] });

test("orders raids chronologically and compresses consecutive gaps, including the edges", () => {
  const result = buildAccountTimeline([raid(5), raid(3), raid(2, true), raid(1), raid(4)], "EU", now);
  assert.deepEqual(result.map((segment) => segment.type === "raid" ? segment.raid.id : segment.raids.map((entry) => entry.id)), [[1], 2, [3, 4, 5]]);
});

test("activity by any account character keeps a tier expanded", () => {
  const result = buildAccountTimeline([raid(1, true), { ...raid(2), characters: [{ ...activity, characterId: "alt" }] }], "eu", now);
  assert.deepEqual(result.map((segment) => segment.type), ["raid", "raid"]);
});

test("undated legacy raids remain near their release neighbors instead of appearing after recent raids", () => {
  const result = buildAccountTimeline([raid(3, true), { ...raid(1), starts: undefined }, raid(2, true)], "eu", now);
  assert.equal(result[0].type, "gap");
  assert.equal(result[0].raids[0].id, 1);
  assert.equal(result[0].raids[0].start, null);
});

test("does not label unreleased tiers inactive and handles an empty history", () => {
  assert.deepEqual(buildAccountTimeline([], "eu", now), []);
  assert.deepEqual(buildAccountTimeline([{ ...raid(1), starts: { eu: "2027-01-01" } }], "eu", now), []);
  assert.equal(buildAccountTimeline([raid(1), raid(2)], "eu", now).length, 1);
});

test("uses the account region and leaves unavailable dates unknown", () => {
  const [result] = buildAccountTimeline([{ ...raid(1, true), starts: { us: "2025-01-02", eu: "2025-01-03" } }], "US", now);
  assert.equal(result.raid.start, Date.parse("2025-01-02"));
  const [missing] = buildAccountTimeline([{ ...raid(1, true), starts: { us: "2025-01-02" } }], "eu", now);
  assert.equal(missing.raid.start, null);
});

test("clips spans to tier bounds without moving out-of-tier activity into the tier", () => {
  const tier = { start: Date.parse("2025-01-01"), end: Date.parse("2025-01-11") };
  assert.deepEqual(getActivityPosition(tier, "2024-12-25", "2025-01-06", now), { left: 0, width: 50 });
  assert.deepEqual(getActivityPosition(tier, "2025-01-06", "2025-01-20", now), { left: 50, width: 50 });
  assert.equal(getActivityPosition(tier, "2025-02-01", "2025-02-02", now), null);
  assert.equal(getActivityPosition(tier, "invalid", "2025-01-02", now), null);
});

test("single observations, missing dates, and open tiers have well-defined spans", () => {
  const tier = { start: Date.parse("2025-01-01"), end: Date.parse("2025-01-11") };
  assert.deepEqual(getActivityPosition(tier, "2025-01-06", "2025-01-06", now), { left: 50, width: 0 });
  assert.equal(getActivityPosition({ start: null, end: null }, "2025-01-06", "2025-01-06", now), null);
  assert.deepEqual(getActivityPosition({ ...tier, end: null }, "2025-01-01", "2025-01-11", tier.end), { left: 0, width: 100 });
});
