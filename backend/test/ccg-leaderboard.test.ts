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
  CCG_COMPLETE_SET_POINTS_PER_CARD,
  CCG_FINISH_POINTS,
  CCG_GRADE_POINTS,
  bestCcgLeaderboardGrade,
  scoreCcgSeries,
  uniqueCcgLeaderboardFinishes,
} from "../src/utils/ccg-leaderboard";
import CcgJobLock from "../src/models/CcgJobLock";
import CcgLeaderboardEntry from "../src/models/CcgLeaderboardEntry";
import CcgSeriesOwnership from "../src/models/CcgSeriesOwnership";
import CcgSet from "../src/models/CcgSet";
import ccgLeaderboardService, { isCcgSeriesEligibleForSetCompletion } from "../src/services/ccg-leaderboard.service";
import ccgService, { CcgServiceError } from "../src/services/ccg.service";

test("collection leaderboard schedules incremental refreshes on every clock quarter", () => {
  assert.equal(CCG_LEADERBOARD_INCREMENTAL_SCHEDULE.cron, "*/15 * * * *");
  assert.equal(CCG_LEADERBOARD_FULL_SCHEDULE.cron, "7 * * * *");
  assert.equal(CCG_LEADERBOARD_REFRESH_INTERVAL_SECONDS, 15 * 60);
  assert.equal(cron.validate(CCG_LEADERBOARD_INCREMENTAL_SCHEDULE.cron), true);
  assert.equal(cron.validate(CCG_LEADERBOARD_FULL_SCHEDULE.cron), true);
});

test("collection leaderboard strongly rewards completing an entire set", () => {
  assert.equal(CCG_COMPLETE_SET_POINTS_PER_CARD, 100);
});

test("archived series keep their ownership value but do not satisfy live set completion", () => {
  assert.equal(isCcgSeriesEligibleForSetCompletion([{ availabilityStatus: "active" }]), true);
  assert.equal(isCcgSeriesEligibleForSetCompletion([{ availabilityStatus: null }]), true);
  assert.equal(isCcgSeriesEligibleForSetCompletion([{ availabilityStatus: "archived" }]), false);
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
  assert.deepEqual(uniqueCcgLeaderboardFinishes(["foil", "foil", "negative"]), ["foil", "negative"]);
});

test("personal leaderboard reads do not wait for leaderboard initialization", async () => {
  const service = ccgLeaderboardService as any;
  const userId = new mongoose.Types.ObjectId();
  const originals = {
    ensureInitialized: service.ensureInitialized,
    leaderboardFindOne: CcgLeaderboardEntry.findOne,
  };
  let initializationAttempts = 0;
  const leaderboardQueries: Record<string, unknown>[] = [];

  try {
    service.ensureInitialized = async () => {
      initializationAttempts += 1;
      throw new Error("personal reads must not initialize the leaderboard");
    };
    (CcgLeaderboardEntry as any).findOne = async (query: Record<string, unknown>) => {
      leaderboardQueries.push(query);
      return null;
    };

    assert.equal(await ccgLeaderboardService.getUserIfReady(userId), null);
    assert.equal(initializationAttempts, 0);
    assert.equal(leaderboardQueries.length, 1);
    assert.equal(leaderboardQueries[0].userId, userId);
  } finally {
    service.ensureInitialized = originals.ensureInitialized;
    (CcgLeaderboardEntry as any).findOne = originals.leaderboardFindOne;
  }
});

test("record boards rank every collector and expose only positive top-three results", async () => {
  const service = ccgLeaderboardService as any;
  const originals = {
    ensureInitialized: service.ensureInitialized,
    leaderboardFind: CcgLeaderboardEntry.find,
    setFind: CcgSet.find,
  };
  let finishSetSort: Record<string, number> | null = null;
  const firstCollectedAt = new Date("2026-01-01T00:00:00.000Z");
  const calculatedAt = new Date("2026-08-04T12:00:00.000Z");
  const candidate = (
    username: string,
    score: number,
    cardsOwned: number,
    finishesOwned: number,
    completedSets: number,
    negative: number,
    astral: number,
    toxic: number,
    voidFinish: number,
    relic: number,
  ) => ({
    userId: new mongoose.Types.ObjectId(),
    username,
    avatarUrl: `https://example.com/${username}.png`,
    score,
    cardsOwned,
    finishesOwned,
    completedSets,
    finishCounts: { negative, astral, toxic, void: voidFinish, relic },
    firstCollectedAt,
    calculatedAt,
  });

  try {
    service.ensureInitialized = async () => undefined;
    (CcgLeaderboardEntry as any).find = () => ({
      select() { return this; },
      lean: async () => [
        candidate("Fourth", 9000, 10, 10, 0, 1, 0, 0, 0, 0),
        candidate("First", 5000, 40, 55, 2, 7, 1, 3, 5, 3),
        candidate("Second", 7000, 30, 50, 2, 7, 0, 2, 4, 2),
        candidate("Third", 6000, 20, 45, 1, 4, 0, 1, 3, 1),
      ],
    });
    (CcgSet as any).find = () => ({
      select() { return this; },
      sort(value: Record<string, number>) { finishSetSort = value; return this; },
      lean: async () => [
        { raidName: "March on Quel'Danas", customFinish: { key: "void" } },
        { raidName: "Highmaul", customFinish: { key: "relic" } },
      ],
    });

    const records = await ccgLeaderboardService.listRecords();
    assert.equal(records.calculatedAt?.toISOString(), calculatedAt.toISOString());
    assert.deepEqual(finishSetSort, { zoneId: -1 });
    assert.deepEqual(records.boards.map((board) => board.key), [
      "uniqueCards",
      "finishes",
      "completedSets",
      "finish:negative",
      "finish:astral",
      "finish:toxic",
      "finish:void",
      "finish:relic",
    ]);
    assert.deepEqual(records.boards[0].entries.map((entry) => entry.username), ["First", "Second", "Third"]);
    assert.deepEqual(records.boards[3].entries.map((entry) => entry.username), ["Second", "First", "Third"]);
    assert.deepEqual(records.boards[4].entries.map((entry) => entry.username), ["First"]);
    assert.deepEqual(records.boards[5].entries.map((entry) => entry.username), ["First", "Second", "Third"]);
    assert.equal(records.boards[5].kind, "finish");
    if (records.boards[5].kind === "finish") assert.equal(records.boards[5].raidName, "The Venomous Abyss");
    assert.equal(records.boards[6].kind, "finish");
    if (records.boards[6].kind === "finish") assert.equal(records.boards[6].raidName, "March on Quel'Danas");
    assert.equal(records.boards[7].kind, "finish");
    if (records.boards[7].kind === "finish") assert.equal(records.boards[7].raidName, "Highmaul");
  } finally {
    service.ensureInitialized = originals.ensureInitialized;
    (CcgLeaderboardEntry as any).find = originals.leaderboardFind;
    (CcgSet as any).find = originals.setFind;
  }
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

test("compact leaderboard responses keep full cards only for highlighted collectors", async () => {
  const service = ccgService as any;
  const leaderboardService = ccgLeaderboardService as any;
  const entries = Array.from({ length: 7 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    rank: index + 1,
    username: `Collector ${index + 1}`,
    avatarUrl: `https://example.com/${index + 1}.png`,
    score: 1000 - index,
    cardsOwned: 10,
    snapshotsOwned: 10,
    finishesOwned: 10,
    premiumFinishesOwned: 2,
    completedCards: 1,
    completedSets: 0,
    breakdown: { collection: 1, rarity: 2, finishes: 3, completedCards: 4, completedSets: 5 },
    calculatedAt: new Date("2026-08-14T10:00:00.000Z"),
  }));
  const fullShowcases = new Map(entries.map((entry) => [String(entry.userId), [{ card: { id: `full-${entry.rank}` }, finish: "foil", artVariant: "standard" }]]));
  const summaries = new Map(entries.map((entry) => [String(entry.userId), [{ card: { id: `summary-${entry.rank}` }, finish: "foil", artVariant: "standard" }]]));
  const fullShowcaseRequests: string[][] = [];
  const originals = {
    list: leaderboardService.list,
    loadShowcases: service.loadLeaderboardShowcases,
    loadSummaries: service.loadLeaderboardShowcaseSummaries,
  };

  try {
    leaderboardService.list = async () => entries;
    service.loadLeaderboardShowcases = async (userIds: mongoose.Types.ObjectId[]) => {
      fullShowcaseRequests.push(userIds.map(String));
      return new Map(userIds.map((userId) => [String(userId), fullShowcases.get(String(userId)) ?? []]));
    };
    service.loadLeaderboardShowcaseSummaries = async () => summaries;

    const compact = await ccgService.getLeaderboard({ compactShowcases: true }) as any;
    assert.deepEqual(fullShowcaseRequests[0], entries.slice(0, 6).map((entry) => String(entry.userId)));
    assert.equal(compact.entries[0].collectorId, String(entries[0]._id));
    assert.equal(compact.entries[0].showcase[0].card.id, "summary-1");
    assert.equal(compact.entries[0].showcaseCards[0].card.id, "full-1");
    assert.deepEqual(compact.entries[6].showcaseCards, []);

    const legacy = await ccgService.getLeaderboard() as any;
    assert.deepEqual(fullShowcaseRequests[1], entries.map((entry) => String(entry.userId)));
    assert.equal(legacy.entries[6].showcase[0].card.id, "full-7");
    assert.equal(legacy.entries[6].collectorId, undefined);
  } finally {
    leaderboardService.list = originals.list;
    service.loadLeaderboardShowcases = originals.loadShowcases;
    service.loadLeaderboardShowcaseSummaries = originals.loadSummaries;
  }
});

test("public leaderboard showcase lookup uses a stable entry ID", async () => {
  const service = ccgService as any;
  const leaderboardService = ccgLeaderboardService as any;
  const entryId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const originals = {
    getPublicEntryIfReady: leaderboardService.getPublicEntryIfReady,
    loadShowcases: service.loadLeaderboardShowcases,
  };

  try {
    leaderboardService.getPublicEntryIfReady = async (requestedId: mongoose.Types.ObjectId) => {
      assert.equal(String(requestedId), String(entryId));
      return { _id: entryId, userId };
    };
    service.loadLeaderboardShowcases = async () => new Map([[String(userId), [{ card: { id: "full-card" }, finish: "foil", artVariant: "standard" }]]]);

    const response = await ccgService.getLeaderboardShowcase(String(entryId)) as any;
    assert.equal(response.showcase[0].card.id, "full-card");

    leaderboardService.getPublicEntryIfReady = async () => null;
    await assert.rejects(
      () => ccgService.getLeaderboardShowcase(String(entryId)),
      (error: unknown) => error instanceof CcgServiceError && error.status === 404 && error.code === "leaderboard_collector_not_found",
    );
  } finally {
    leaderboardService.getPublicEntryIfReady = originals.getPublicEntryIfReady;
    service.loadLeaderboardShowcases = originals.loadShowcases;
  }
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
