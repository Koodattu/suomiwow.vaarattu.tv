import assert from "node:assert/strict";
import test from "node:test";
import { resolveCcgCharacterMechanicsStatus } from "../src/utils/ccg-character-check";

test("character checker uses the highest complete mechanics pull count instead of a stale tier entry", () => {
  const status = resolveCcgCharacterMechanicsStatus(
    [
      { pulls: 833, score: 72.9, parseScore: 80.8, survivalScore: 65 },
      { pulls: 35, score: 72.2, parseScore: 70.4, survivalScore: 74 },
    ],
    { pulls: 35, score: 72.2, parseScore: 70.4, survivalScore: 74 },
  );

  assert.deepEqual(status, { pulls: 833, scoresReady: true, eligible: true });
});

test("character checker reports real sub-threshold progress from mechanics rows", () => {
  const status = resolveCcgCharacterMechanicsStatus([
    { pulls: 35, score: 72.2, parseScore: 70.4, survivalScore: 74 },
  ]);

  assert.deepEqual(status, { pulls: 35, scoresReady: true, eligible: false });
});

test("character checker falls back to a materialized entry when mechanics rows are unavailable", () => {
  const status = resolveCcgCharacterMechanicsStatus([], {
    pulls: 45,
    score: 67.5,
    parseScore: 63.9,
    survivalScore: 71,
  });

  assert.deepEqual(status, { pulls: 45, scoresReady: true, eligible: true });
});
