import assert from "node:assert/strict";
import test from "node:test";
import {
  CCG_A_OR_BETTER_GRADES,
  CCG_CONFIGURED_SETS,
  CCG_INITIAL_PACKS,
  CCG_PACK_STORAGE_CAPS,
} from "../src/config/ccg";
import { emptyFinishPity, finishChanceForCounter, gradeForPercentile, nextFinish, resolveCardCrop, rollProtectedFinish } from "../src/utils/ccg-random";
import { calculateDuplicateProgress, planPackSelections, selectCommunityCard, selectPackCards } from "../src/utils/ccg-pack";
import { createWowCharacterIdentityKey } from "../src/utils/ccg-identity";
import { evaluateCcgReadiness } from "../src/utils/ccg-readiness";
import { applyPackRecharge, getNextPackRechargeAt, getRechargeGrants } from "../src/utils/ccg-recharge";
import { getHelsinkiDateKey, getNextHelsinkiReset } from "../src/utils/helsinki-time";

test("canonical grading maps a 100-card population to the versioned S through F bands", () => {
  const counts = new Map<string, number>();
  for (let index = 0; index < 100; index += 1) {
    const grade = gradeForPercentile(index, 100);
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { S: 5, A: 10, B: 20, C: 20, D: 20, E: 15, F: 10 });
});

test("card crops are deterministic and stay inside each raid's safe flair range", () => {
  for (const set of CCG_CONFIGURED_SETS) {
    const first = resolveCardCrop(`${set.slug}:character`, set.crop);
    const second = resolveCardCrop(`${set.slug}:character`, set.crop);
    assert.deepEqual(first, second);
    assert.ok(first.x >= set.crop.x - set.crop.xJitter && first.x <= set.crop.x + set.crop.xJitter);
    assert.ok(first.y >= set.crop.y - set.crop.yJitter && first.y <= set.crop.y + set.crop.yJitter);
    assert.ok(first.scale >= set.crop.scale && first.scale <= set.crop.scale + 0.03);
  }
});

test("Crucible of Storms is excluded from CCG configuration", () => {
  assert.equal(CCG_CONFIGURED_SETS.some((set) => set.zoneId === 22), false);
});

test("every raid set is pinned to its original Mythic+ season", () => {
  const expectedSeasons = new Map<number, string>([
    [19, "season-bfa-1"],
    [21, "season-bfa-2"],
    [23, "season-bfa-3"],
    [24, "season-bfa-4"],
    [26, "season-sl-1"],
    [28, "season-sl-2"],
    [29, "season-sl-3"],
    [31, "season-df-1"],
    [33, "season-df-2"],
    [35, "season-df-3"],
    [38, "season-tww-1"],
    [42, "season-tww-2"],
    [44, "season-tww-3"],
    [46, "season-mn-1"],
  ]);

  assert.deepEqual(
    CCG_CONFIGURED_SETS.map((set) => [set.zoneId, set.mythicPlusSeason]),
    Array.from(expectedSeasons),
  );
  assert.equal(CCG_CONFIGURED_SETS.some((set) => set.mythicPlusSeason === "season-sl-4" || set.mythicPlusSeason === "season-df-4"), false);
});

test("quality protection follows a quadratic ramp, resets only the awarded finish, and honors duplicate upgrades", () => {
  const first = rollProtectedFinish(emptyFinishPity(), "standard", (maximum) => maximum - 1);
  assert.equal(first.finish, "standard");
  assert.deepEqual(first.pity, { foil: 1, golden: 1, prismatic: 1, holographic: 1, negative: 1 });

  const foilPity = { ...emptyFinishPity(), foil: 4 };
  const guaranteed = rollProtectedFinish(foilPity, "standard", (maximum) => maximum - 1);
  assert.equal(guaranteed.finish, "foil");
  assert.equal(guaranteed.pity.foil, 0);
  assert.equal(guaranteed.pity.golden, 1);

  const upgraded = rollProtectedFinish(emptyFinishPity(), nextFinish("prismatic"), (maximum) => maximum - 1);
  assert.equal(upgraded.finish, "holographic");
  assert.equal(upgraded.pity.holographic, 0);

  const negativePity = { ...emptyFinishPity(), negative: 999 };
  const negative = rollProtectedFinish(negativePity, "standard", (maximum) => maximum - 1);
  const followingCard = rollProtectedFinish(negative.pity, "standard", (maximum) => maximum - 1);
  assert.equal(negative.finish, "negative");
  assert.notEqual(followingCard.finish, "negative");
});

test("quality protection ramps slowly at first and accelerates near hard pity", () => {
  assert.equal(finishChanceForCounter(1, 100), 0.01);
  assert.ok(Math.abs(finishChanceForCounter(10, 100) - 0.018182) < 0.000001);
  assert.ok(Math.abs(finishChanceForCounter(50, 100) - 0.252525) < 0.000001);
  assert.ok(Math.abs(finishChanceForCounter(95, 100) - 0.902525) < 0.000001);
  assert.equal(finishChanceForCounter(100, 100), 1);

  const pity = { ...emptyFinishPity(), golden: 9 };
  let rollIndex = 0;
  const result = rollProtectedFinish(pity, "standard", (maximum) => {
    rollIndex += 1;
    return rollIndex === 2 ? Math.floor(maximum * 0.2) : maximum - 1;
  });
  assert.equal(result.finish, "standard");
  assert.equal(result.pity.golden, 10);
});

test("every selected pack has five cards and an A-or-better guaranteed slot", () => {
  const grades = ["S", "A", "B", "C", "D", "E", "F"] as const;
  const buckets = grades.map((grade, index) => ({ grade, cardIds: [`card-${index}`] }));
  const selected = selectPackCards(buckets, (maximum) => maximum - 1);
  assert.equal(selected.length, 5);
  assert.equal(CCG_A_OR_BETTER_GRADES.has(selected[4].tierGrade), true);
  assert.equal(selected[0].tierGrade, "F");
});

test("a pack cannot be produced when no A-or-better card exists", () => {
  assert.throws(() => selectPackCards([{ grade: "F", cardIds: ["only-card"] }], () => 0), /no eligible cards/);
});

test("ten exact duplicates award a pack while preserving the remainder", () => {
  assert.deepEqual(calculateDuplicateProgress(4, 5), { remainder: 9, earned: 0 });
  assert.deepEqual(calculateDuplicateProgress(9, 1), { remainder: 0, earned: 1 });
  assert.deepEqual(calculateDuplicateProgress(8, 23), { remainder: 1, earned: 3 });
});

test("first-time pack grants distinguish guest and authenticated storage", () => {
  assert.deepEqual(CCG_PACK_STORAGE_CAPS, { current: 25, legacy: 25 });
  assert.deepEqual(CCG_INITIAL_PACKS.guest, { current: 5, legacy: 5 });
  assert.deepEqual(CCG_INITIAL_PACKS.user, { current: 25, legacy: 25 });
});

test("pack recharge follows shared Helsinki hour boundaries and respects storage caps", () => {
  const grants = getRechargeGrants(new Date("2026-01-01T07:00:00.000Z"), new Date("2026-01-01T10:05:00.000Z"));
  assert.deepEqual(grants, { current: 2, legacy: 3 });
  assert.equal(getNextPackRechargeAt("current", new Date("2026-07-24T10:30:00.000Z")).toISOString(), "2026-07-24T11:00:00.000Z");
  assert.equal(getNextPackRechargeAt("legacy", new Date("2026-07-24T10:30:00.000Z")).toISOString(), "2026-07-24T11:00:00.000Z");

  const recharged = applyPackRecharge(
    { current: CCG_PACK_STORAGE_CAPS.current - 1, legacy: CCG_PACK_STORAGE_CAPS.legacy - 1 },
    new Date("2026-01-01T07:00:00.000Z"),
    new Date("2026-01-01T10:05:00.000Z"),
  );
  assert.deepEqual(recharged.balances, CCG_PACK_STORAGE_CAPS);
  assert.equal(recharged.lastRechargeAt.toISOString(), "2026-01-01T10:00:00.000Z");
});

test("a mode-wide pack plan can draw cards from multiple raid pools", () => {
  const values = [0, 0, 0, 2, 0, 1, 0, 4, 0, 0];
  let cursor = 0;
  const plan = planPackSelections(
    [
      { poolId: "pool-a", setId: "raid-a", version: "1", counts: [{ grade: "A", count: 2 }] },
      { poolId: "pool-b", setId: "raid-b", version: "1", counts: [{ grade: "A", count: 3 }] },
    ],
    (maximum) => values[cursor++] % maximum,
  );
  assert.equal(plan.length, 5);
  assert.equal(plan.every((row) => row.tierGrade === "A"), true);
  assert.deepEqual(new Set(plan.map((row) => row.setId)), new Set(["raid-a", "raid-b"]));
});

test("a targeted pack plan stays inside its selected raid pool", () => {
  const plan = planPackSelections(
    [{ poolId: "pool-a", setId: "raid-a", version: "1", counts: [{ grade: "A", count: 5 }] }],
    () => 0,
  );
  assert.equal(plan.length, 5);
  assert.equal(plan.every((row) => row.poolId === "pool-a" && row.setId === "raid-a"), true);
});

test("community cards pass a second 50/50 gate after their pool roll", () => {
  assert.equal(selectCommunityCard(9, ["community"], () => 0), null);

  const rejectedRolls = [9, 1];
  assert.equal(selectCommunityCard(9, ["community"], () => rejectedRolls.shift()!), null);

  const acceptedRolls = [9, 0, 0];
  assert.equal(selectCommunityCard(9, ["community"], () => acceptedRolls.shift()!), "community");
});

test("community identity matches display and slug forms of a realm", () => {
  assert.equal(
    createWowCharacterIdentityKey("EU", "Twisting Nether", "Example"),
    createWowCharacterIdentityKey("eu", "twisting-nether", "example"),
  );
});

test("raid activation readiness fails closed and becomes irreversible after enablement", () => {
  assert.deepEqual(evaluateCcgReadiness({ eligible: 99, mediaReady: 49, enabled: false }).blockers, [
    "eligible_population",
    "media_ready",
    "media_coverage",
  ]);
  assert.equal(evaluateCcgReadiness({ eligible: 100, mediaReady: 75, enabled: false }).readyToEnable, true);
  assert.deepEqual(evaluateCcgReadiness({ eligible: 100, mediaReady: 75, enabled: true }).blockers, ["already_enabled"]);
});

test("Helsinki day keys and next reset follow daylight-saving transitions", () => {
  const springMidnight = new Date("2026-03-28T22:00:00.000Z");
  assert.equal(getHelsinkiDateKey(springMidnight), "2026-03-29");
  assert.equal(getNextHelsinkiReset(springMidnight).toISOString(), "2026-03-29T21:00:00.000Z");

  const autumnMidnight = new Date("2026-10-24T21:00:00.000Z");
  assert.equal(getHelsinkiDateKey(autumnMidnight), "2026-10-25");
  assert.equal(getNextHelsinkiReset(autumnMidnight).toISOString(), "2026-10-25T22:00:00.000Z");
});
