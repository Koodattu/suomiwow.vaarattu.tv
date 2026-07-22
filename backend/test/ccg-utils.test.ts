import assert from "node:assert/strict";
import test from "node:test";
import {
  CCG_A_OR_BETTER_GRADES,
  CCG_CONFIGURED_SETS,
  CCG_DAILY_PACKS_PER_MODE,
  CCG_GUEST_CLAIM_CARD_LIMIT_PER_MODE,
} from "../src/config/ccg";
import { emptyFinishPity, gradeForPercentile, nextFinish, resolveCardCrop, rollProtectedFinish } from "../src/utils/ccg-random";
import { calculateDuplicateProgress, countGuestClaimPulls, guestClaimIsWithinLimit, planPackSelections, selectPackCards } from "../src/utils/ccg-pack";
import { evaluateCcgReadiness } from "../src/utils/ccg-readiness";
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

test("quality protection grows per card, resets only the awarded finish, and honors duplicate upgrades", () => {
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

test("guest claim limits count pull instances rather than unique cards", () => {
  assert.equal(CCG_DAILY_PACKS_PER_MODE, 10);
  assert.equal(CCG_GUEST_CLAIM_CARD_LIMIT_PER_MODE, 50);
  const currentResults = Array.from({ length: 50 }, () => ({ cardId: "same-card" }));
  const pulls = countGuestClaimPulls([{ mode: "current", results: currentResults }, { mode: "legacy", results: Array(50).fill(null) }]);
  assert.deepEqual(pulls, { current: 50, legacy: 50 });
  assert.equal(guestClaimIsWithinLimit(pulls), true);
  assert.equal(guestClaimIsWithinLimit({ current: 51, legacy: 50 }), false);
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
