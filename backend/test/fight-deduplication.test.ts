import assert from "node:assert/strict";
import test from "node:test";
import { groupPulls, groupSortedPulls, isSamePull, PullIdentity } from "../src/utils/fight-deduplication";
import { turtlesPulls } from "./fixtures/pull-fixtures";

const roster = Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, server: "Test Realm" }));
const pull = (patch: Partial<PullIdentity> = {}): PullIdentity => ({ reportCode: "A", fightId: 1, guildId: "guild", zoneId: 53, encounterID: 3492,
  difficulty: 5, reportStartTime: 1_000_000, fightStartTime: 10_000, duration: 120_000, isKill: false, bossPercentage: 50,
  combatants: roster, combatantInfoRosterComplete: true, ...patch });

test("TURTLES recordings produce 292 pulls, preserving the genuine October attempts", () => {
  const fights = turtlesPulls();
  assert.equal(fights.length, 306);
  const groups = groupPulls(fights);
  assert.equal(groups.length, 292);
  assert.equal(groups.filter(group => group.length === 2).length, 14);
  assert.equal(groups.filter(group => group[0].isKill).length, 1);
  for (const fightId of [6, 38]) assert.equal(groups.find(group => group.some(fight => fight.reportCode === "8QkMJXGNqLpP3WV6" && fight.fightId === fightId))?.length, 1);
  assert.deepEqual(groupPulls([...fights].reverse()), groups);
});

test("recordings within timing tolerance match across rounding boundaries", () => {
  const a = pull({ timestamp: new Date(1_010_499) });
  assert.equal(isSamePull(a, { ...a, reportCode: "B", timestamp: new Date(1_010_501), duration: 120_124 }), true);
});

test("different guilds, raids, bosses, difficulties, outcomes and same-report attempts stay distinct", () => {
  for (const patch of [{ guildId: "other" }, { zoneId: 52 }, { encounterID: 1 }, { difficulty: 4 }, { isKill: true }, { reportCode: "A", fightId: 2 }]) {
    assert.equal(isSamePull(pull(), pull({ reportCode: "B", ...patch })), false, JSON.stringify(patch));
  }
  assert.equal(isSamePull(pull(), pull({ reportCode: "B", fightStartTime: 7_010_000 })), false);
});

test("kill and wipe with default zero health never merge", () => {
  assert.equal(isSamePull(pull({ bossPercentage: 0 }), pull({ reportCode: "B", bossPercentage: 0, isKill: true })), false);
});

test("Heroic variable rosters support wider matching without assuming 20 players", () => {
  for (const size of [10, 15, 25, 30]) {
    const combatants = Array.from({ length: size }, (_, i) => ({ name: `P${i}`, server: "Test Realm" }));
    const a = pull({ difficulty: 4, combatants });
    assert.equal(isSamePull(a, { ...a, reportCode: "B", fightStartTime: 15_000 }), true);
    assert.equal(isSamePull(a, { ...a, reportCode: "B", fightStartTime: 15_000, combatants: combatants.slice(1) }), false);
  }
});

test("missing rosters allow only narrow matching; invalid or contradictory evidence is rejected", () => {
  const a = pull({ combatants: undefined, combatantInfoRosterComplete: false });
  assert.equal(isSamePull(a, { ...a, reportCode: "B", fightStartTime: 10_500 }), true);
  assert.equal(isSamePull(a, { ...a, reportCode: "B", fightStartTime: 12_500 }), false);
  assert.equal(isSamePull(a, { ...a, reportCode: "B", duration: 121_001 }), false);
  assert.equal(isSamePull(a, { ...a, reportCode: "B", bossPercentage: 50.011 }), false);
  for (const patch of [{ duration: NaN }, { duration: 0 }, { timestamp: new Date(NaN) }, { encounterID: undefined }]) {
    const invalid = pull(patch);
    assert.equal(isSamePull(invalid, { ...invalid, reportCode: "B" }), false);
  }
});

test("short reset pulls remain separate and non-transitive matches do not chain", () => {
  assert.equal(isSamePull(pull({ duration: 1000 }), pull({ reportCode: "B", fightStartTime: 10_800, duration: 1000 })), false);
  const a = pull({ duration: 500_000 }), b = { ...a, reportCode: "B", duration: 504_000 }, c = { ...a, reportCode: "C", duration: 496_000 };
  assert.deepEqual(groupPulls([c, b, a]), [[a, b], [c]]);
});

test("streaming groups span consumer batches, isolate scopes and agree with array grouping", async () => {
  const fights = turtlesPulls();
  async function* cursor() { for (const fight of fights) { await Promise.resolve(); yield fight; } }
  const groups = [];
  for await (const group of groupSortedPulls(cursor())) groups.push(group);
  assert.deepEqual(groups, groupPulls(fights));
  const a = pull(), other = pull({ guildId: "other", fightStartTime: 11_000 }), b = pull({ reportCode: "B", fightStartTime: 12_000 });
  assert.deepEqual(groupPulls([a, other, b]), [[a, b], [other]]);
});

test("streaming rejects out-of-order input rather than silently double counting", async () => {
  async function* cursor() { yield pull({ fightStartTime: 20_000 }); yield pull(); }
  await assert.rejects(async () => { for await (const group of groupSortedPulls(cursor())) void group; }, /chronological/);
});

test("repeated exact source records count once without hiding distinct fight IDs", () => {
  const a = pull();
  assert.deepEqual(groupPulls([a, a, { ...a, fightId: 2 }]), [[a, a], [{ ...a, fightId: 2 }]]);
});

test("a recording that matches two distinct same-report attempts stays ambiguous", () => {
  const a = pull(), b = pull({ fightId: 2, fightStartTime: 10_500 }), c = pull({ reportCode: "B", fightStartTime: 11_000 });
  assert.deepEqual(groupPulls([a, b, c]), [[a], [b], [c]]);
});
