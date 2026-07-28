/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import "express-session";
import {
  CCG_ALL_FINISHES_BONUS,
  CCG_FINISH_POINTS,
  CCG_GRADE_POINTS,
  bestCcgLeaderboardGrade,
  scoreCcgSeries,
} from "../src/utils/ccg-leaderboard";
import ccgService, { CcgServiceError } from "../src/services/ccg.service";

test("collection leaderboard uses the rarest unlocked snapshot without counting snapshots twice", () => {
  assert.equal(bestCcgLeaderboardGrade(["C", "S", "A"]), "S");
  const score = scoreCcgSeries(["C", "S", "A"], ["standard", "foil", "foil"], ["standard", "foil"]);
  assert.equal(score.rarityPoints, CCG_GRADE_POINTS.S);
  assert.equal(score.finishPoints, CCG_FINISH_POINTS.foil);
  assert.equal(score.finishesOwned, 2);
  assert.equal(score.allFinishesPoints, CCG_ALL_FINISHES_BONUS);
});

test("collection leaderboard awards card completion only for every obtainable finish", () => {
  const incomplete = scoreCcgSeries(
    ["H"],
    ["standard", "foil", "golden", "prismatic", "holographic", "negative"],
    ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative"],
  );
  assert.equal(incomplete.allFinishesOwned, false);
  assert.equal(incomplete.allFinishesPoints, 0);

  const complete = scoreCcgSeries(
    ["H"],
    ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative"],
    ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative"],
  );
  assert.equal(complete.allFinishesOwned, true);
  assert.equal(complete.allFinishesPoints, CCG_ALL_FINISHES_BONUS);
});

test("leaderboard participation and showcase updates require a logged-in user", async () => {
  const request = { session: {} } as any;
  await assert.rejects(
    () => ccgService.getLeaderboardMe(request),
    (error: unknown) => error instanceof CcgServiceError && error.status === 401 && error.code === "authentication_required",
  );
  await assert.rejects(
    () => ccgService.updateLeaderboardShowcase(request, { cards: [] }),
    (error: unknown) => error instanceof CcgServiceError && error.status === 401 && error.code === "authentication_required",
  );
});

test("showcases allow at most three distinct cards", () => {
  const service = ccgService as any;
  const cardId = "64b64b64b64b64b64b64b641";
  assert.throws(
    () => service.validateShowcase(Array.from({ length: 4 }, (_, index) => ({
      cardId: `64b64b64b64b64b64b64b64${index}`,
      finish: "standard",
      artVariant: "standard",
    }))),
    /up to 3/,
  );
  assert.throws(
    () => service.validateShowcase([
      { cardId, finish: "standard", artVariant: "standard" },
      { cardId, finish: "foil", artVariant: "standard" },
    ]),
    /only appear once/,
  );
});
