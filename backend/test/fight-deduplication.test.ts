import assert from "node:assert/strict";
import test from "node:test";
import { FightDeduplicationBuckets, findDuplicateFight } from "../src/utils/fight-deduplication";

type TestFight = {
  id: string;
  encounterID: number;
  difficulty: number;
  bossPercentage: number;
  fightPercentage: number;
  duration: number;
};

function createBuckets(): FightDeduplicationBuckets<TestFight> {
  return new Map<string, TestFight>();
}

test("deduplicates fights within percentage and duration tolerances", () => {
  const buckets = createBuckets();
  const canonical: TestFight = {
    id: "canonical",
    encounterID: 100,
    difficulty: 5,
    bossPercentage: 50.005,
    fightPercentage: 49.995,
    duration: 120_050,
  };

  assert.equal(findDuplicateFight(canonical, buckets), undefined);
  assert.equal(
    findDuplicateFight(
      {
        ...canonical,
        id: "duplicate",
        bossPercentage: 50.014,
        fightPercentage: 49.986,
        duration: 120_149,
      },
      buckets,
    ),
    canonical,
  );
});

test("does not merge fights outside a tolerance or from another encounter", () => {
  const buckets = createBuckets();
  const canonical: TestFight = {
    id: "canonical",
    encounterID: 100,
    difficulty: 5,
    bossPercentage: 50,
    fightPercentage: 50,
    duration: 120_000,
  };

  assert.equal(findDuplicateFight(canonical, buckets), undefined);
  assert.equal(findDuplicateFight({ ...canonical, id: "percentage", fightPercentage: 50.011 }, buckets), undefined);
  assert.equal(findDuplicateFight({ ...canonical, id: "duration", duration: 120_101 }, buckets), undefined);
  assert.equal(findDuplicateFight({ ...canonical, id: "encounter", encounterID: 101 }, buckets), undefined);
});
