/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import cron from "node-cron";
import mongoose from "mongoose";
import "express-session";
import {
  CCG_LEADERBOARD_FULL_SCHEDULE,
  CCG_LEADERBOARD_INCREMENTAL_SCHEDULE,
  CCG_LEADERBOARD_REFRESH_INTERVAL_SECONDS,
} from "../src/config/ccg";
import {
  CCG_ALL_FINISHES_BONUS,
  CCG_FINISH_POINTS,
  CCG_GRADE_POINTS,
  bestCcgLeaderboardGrade,
  scoreCcgSeries,
} from "../src/utils/ccg-leaderboard";
import CcgJobLock from "../src/models/CcgJobLock";
import CcgLeaderboardEntry from "../src/models/CcgLeaderboardEntry";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import CcgSet from "../src/models/CcgSet";
import ccgLeaderboardService from "../src/services/ccg-leaderboard.service";
import ccgService, { CcgServiceError } from "../src/services/ccg.service";

test("collection leaderboard schedules incremental refreshes on every clock quarter", () => {
  assert.equal(CCG_LEADERBOARD_INCREMENTAL_SCHEDULE.cron, "*/15 * * * *");
  assert.equal(CCG_LEADERBOARD_FULL_SCHEDULE.cron, "7 * * * *");
  assert.equal(CCG_LEADERBOARD_REFRESH_INTERVAL_SECONDS, 15 * 60);
  assert.equal(cron.validate(CCG_LEADERBOARD_INCREMENTAL_SCHEDULE.cron), true);
  assert.equal(cron.validate(CCG_LEADERBOARD_FULL_SCHEDULE.cron), true);
});

test("collection ownership has an index for finding recently changed collectors", () => {
  const indexes = CcgSeriesOwnership.schema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>;
  assert.ok(indexes.some(([fields, options]) => (
    fields.ownerType === 1
    && fields.lastAcquiredAt === 1
    && fields.ownerId === 1
    && options.name === "ccg_series_leaderboard_dirty_v1"
  )));
});

test("incremental leaderboard refresh uses an overlap window and skips the full aggregation when nobody changed", async () => {
  const baseline = new Date("2026-07-30T10:10:00.000Z");
  let dirtyQuery: Record<string, any> | null = null;
  let advancedTo: Date | null = null;
  const originals = {
    lockDeleteOne: CcgJobLock.deleteOne,
    lockCreate: CcgJobLock.create,
    setFind: CcgSet.find,
    leaderboardFindOne: CcgLeaderboardEntry.findOne,
    leaderboardUpdateMany: CcgLeaderboardEntry.updateMany,
    seriesDistinct: CcgSeriesOwnership.distinct,
    seriesAggregate: CcgSeriesOwnership.aggregate,
  };

  try {
    (CcgJobLock as any).deleteOne = async () => ({ deletedCount: 1 });
    (CcgJobLock as any).create = async () => ({});
    (CcgSet as any).find = () => ({
      select: () => ({
        lean: async () => [{ _id: new mongoose.Types.ObjectId(), kind: "raid", cardCount: 1 }],
      }),
    });
    (CcgLeaderboardEntry as any).findOne = () => ({
      sort() { return this; },
      select() { return this; },
      lean: async () => ({ calculatedAt: baseline }),
    });
    (CcgSeriesOwnership as any).distinct = async (_field: string, query: Record<string, any>) => {
      dirtyQuery = query;
      return [];
    };
    (CcgSeriesOwnership as any).aggregate = () => {
      throw new Error("full aggregation should not run when no collectors changed");
    };
    (CcgLeaderboardEntry as any).updateMany = async (_filter: unknown, update: { $set: { calculatedAt: Date } }) => {
      advancedTo = update.$set.calculatedAt;
      return { matchedCount: 12 };
    };

    const result = await ccgLeaderboardService.refresh("incremental");
    assert.equal(result.mode, "incremental");
    assert.equal(result.participants, 12);
    assert.equal(result.changedCollectors, 0);
    assert.equal(result.seriesScanned, 0);
    const capturedQuery = dirtyQuery as unknown as Record<string, any>;
    const capturedAdvancedTo = advancedTo as unknown as Date;
    assert.equal(capturedQuery.ownerType, "user");
    assert.equal(capturedQuery.setId, undefined);
    assert.equal(capturedQuery.lastAcquiredAt.$gt.toISOString(), "2026-07-30T10:05:00.000Z");
    assert.ok(capturedAdvancedTo instanceof Date);
    assert.equal(result.calculatedAt?.getTime(), capturedAdvancedTo.getTime());
  } finally {
    (CcgJobLock as any).deleteOne = originals.lockDeleteOne;
    (CcgJobLock as any).create = originals.lockCreate;
    (CcgSet as any).find = originals.setFind;
    (CcgLeaderboardEntry as any).findOne = originals.leaderboardFindOne;
    (CcgLeaderboardEntry as any).updateMany = originals.leaderboardUpdateMany;
    (CcgSeriesOwnership as any).distinct = originals.seriesDistinct;
    (CcgSeriesOwnership as any).aggregate = originals.seriesAggregate;
  }
});

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
    ["standard", "foil", "golden", "prismatic", "holographic", "negative", "astral"],
    ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative", "astral"],
  );
  assert.equal(incomplete.allFinishesOwned, false);
  assert.equal(incomplete.allFinishesPoints, 0);

  const complete = scoreCcgSeries(
    ["H"],
    ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative", "astral"],
    ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative", "astral"],
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
