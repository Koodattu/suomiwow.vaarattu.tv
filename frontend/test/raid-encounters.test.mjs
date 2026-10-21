import assert from "node:assert/strict";
import test from "node:test";
import { characterScoringBosses } from "../src/lib/raid-encounters.ts";

test("character columns include Nymrissa despite its lair classification, but exclude Kith'ix", () => {
  const bosses = [3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492, 3379, 3513].map(id => ({
    id, isLair: [3379, 3513].includes(id), countsForCharacterScore: id !== 3513,
  }));
  assert.deepEqual(characterScoringBosses(bosses).map(boss => boss.id), [3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492, 3379]);
  assert.equal(bosses.length, 10, "the individual boss selector must retain both lairs");
});

test("older boss metadata retains its existing character columns", () => {
  const bosses = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(characterScoringBosses(bosses), bosses);
});
