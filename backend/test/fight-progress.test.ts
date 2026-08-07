import assert from "node:assert/strict";
import test from "node:test";
import { resolveFightProgress } from "../src/utils/fight-progress";

test("resolves kills to zero regardless of reported percentages", () => {
  assert.deepEqual(resolveFightProgress({ isKill: true, fightPercentage: 42, bossPercentage: 37 }), {
    percentage: 0,
    source: "kill",
  });
});

test("prefers a valid fight percentage", () => {
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 41.2, bossPercentage: 53.8 }), {
    percentage: 41.2,
    source: "fight",
  });
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 100, bossPercentage: 100 }), {
    percentage: 100,
    source: "fight",
  });
});

test("falls back to boss health when fight progress is unavailable or invalid", () => {
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 0, bossPercentage: 73.9 }), {
    percentage: 73.9,
    source: "boss",
  });
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 175_062.75, bossPercentage: 79.57 }), {
    percentage: 79.57,
    source: "boss",
  });
});

test("returns unknown when neither reported percentage is usable", () => {
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: 0, bossPercentage: 0 }), {
    percentage: null,
    source: "unknown",
  });
  assert.deepEqual(resolveFightProgress({ isKill: false, fightPercentage: Number.NaN, bossPercentage: null }), {
    percentage: null,
    source: "unknown",
  });
});
