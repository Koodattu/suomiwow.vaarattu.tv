import assert from "node:assert/strict";
import test from "node:test";
import { buildDeathTimeline } from "../src/lib/death-timeline.ts";

const pull = (patch = {}) => ({ reportCode: "one", fightId: 1, date: "2026-09-01T18:00:00Z", duration: 120000, isKill: false, complete: true, rosterComplete: true, deaths: [], otherDeathTimes: [], phases: [], ...patch });
const death = (deathTime, order = 1) => ({ deathTime, order, phase: null });

test("full timeline keeps survival and missing data distinct, and sessions count all attempts", () => {
  const pulls = [pull(), pull({ fightId: 2, complete: false }), pull({ reportCode: "two", deaths: [death(10000), death(30000)] })];
  assert.equal(buildDeathTimeline(pulls, "", "all", "seconds", null).visible.length, 3);
  assert.equal(buildDeathTimeline(pulls, "", "survived", "seconds", null).visible.length, 1);
  assert.equal(buildDeathTimeline(pulls, "", "missing", "seconds", null).visible[0].complete, false);
  assert.equal(buildDeathTimeline(pulls, "", "repeat", "seconds", null).visible[0].reportCode, "two");
  const session = buildDeathTimeline(pulls, "one", "all", "seconds", null);
  assert.equal(session.visible.length, 2);
  assert.equal(session.sessions.find((entry) => entry.code === "one").pulls, 2);
});

test("early focus excludes unknown order and cluster focus preserves the full density overview", () => {
  const pulls = [pull({ deaths: [death(15000)] }), pull({ fightId: 2, deaths: [death(30000, null)] }), pull({ fightId: 3, deaths: [death(120000, 4)] })];
  assert.equal(buildDeathTimeline(pulls, "", "early", "seconds", null).visible.length, 1);
  const all = buildDeathTimeline(pulls, "", "all", "seconds", null);
  const zoomed = buildDeathTimeline(pulls, "", "all", "seconds", 15);
  assert.deepEqual(all.bins, zoomed.bins);
  assert.equal(zoomed.visible.length, 1);
  assert.equal(zoomed.visible[0].fightId, 3);
  assert.equal(zoomed.end, 120000);
});

test("percentage scale compares different durations and invalid windows reset safely", () => {
  const pulls = [pull({ deaths: [death(60000)] }), pull({ fightId: 2, duration: 240000, deaths: [death(120000)] })];
  const relative = buildDeathTimeline(pulls, "", "all", "percent", 8);
  assert.equal(relative.visible.length, 2);
  assert.equal(relative.bins[8], 2);
  for (const cluster of [-1, 16, NaN, 1.5]) assert.equal(buildDeathTimeline(pulls, "", "all", "percent", cluster).activeCluster, null);
  assert.equal(buildDeathTimeline([], "", "all", "seconds", null).maximum, 60000);
});
