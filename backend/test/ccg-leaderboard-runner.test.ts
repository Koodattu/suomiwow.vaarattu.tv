/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import ccgLeaderboardRunner, { CCG_LEADERBOARD_TASK_NAMES } from "../src/services/ccg-leaderboard-runner.service";
import ccgService from "../src/services/ccg.service";
import taskTracker from "../src/services/task-tracker.service";

test("CCG leaderboard runner tracks automatic builds and rejects overlapping admin builds", async () => {
  const service = ccgService as any;
  const tracker = taskTracker as any;
  const originalStartRefresh = service.startLeaderboardRefresh;
  const originalTaskStart = tracker.start;
  const originalTaskComplete = tracker.complete;
  const originalTaskFail = tracker.fail;

  let releaseRefresh!: () => void;
  const refreshBlocked = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let resolveCompleted!: (metadata: Record<string, unknown>) => void;
  const completed = new Promise<Record<string, unknown>>((resolve) => {
    resolveCompleted = resolve;
  });
  let starts = 0;

  service.startLeaderboardRefresh = async () => {
    starts += 1;
    return {
      started: true,
      completion: refreshBlocked.then(() => ({
        refreshed: true,
        mode: "full",
        participants: 12,
        changedCollectors: 12,
        seriesScanned: 34,
        durationMs: 56,
        calculatedAt: new Date("2026-08-14T10:00:00.000Z"),
      })),
    };
  };
  tracker.start = async (taskName: string, metadata: Record<string, unknown>) => {
    assert.equal(taskName, CCG_LEADERBOARD_TASK_NAMES.full);
    assert.deepEqual(metadata, { source: "cron", requestedMode: "full" });
    return "task-id";
  };
  tracker.complete = async (_taskId: string, metadata: Record<string, unknown>) => resolveCompleted(metadata);
  tracker.fail = async () => assert.fail("leaderboard build should not fail");

  try {
    assert.equal(await ccgLeaderboardRunner.trigger("full", "cron"), true);
    assert.equal(await ccgLeaderboardRunner.trigger("incremental", "admin"), false);
    assert.equal(starts, 1);

    releaseRefresh();
    assert.deepEqual(await completed, {
      mode: "full",
      participants: 12,
      changedCollectors: 12,
      seriesScanned: 34,
      calculatedAt: "2026-08-14T10:00:00.000Z",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    service.startLeaderboardRefresh = originalStartRefresh;
    tracker.start = originalTaskStart;
    tracker.complete = originalTaskComplete;
    tracker.fail = originalTaskFail;
  }
});

test("CCG leaderboard runner does not create a task when the distributed lock is held", async () => {
  const service = ccgService as any;
  const tracker = taskTracker as any;
  const originalStartRefresh = service.startLeaderboardRefresh;
  const originalTaskStart = tracker.start;

  service.startLeaderboardRefresh = async () => ({ started: false });
  tracker.start = async () => assert.fail("a skipped refresh must not create a running task");

  try {
    assert.equal(await ccgLeaderboardRunner.trigger("incremental", "admin"), false);
  } finally {
    service.startLeaderboardRefresh = originalStartRefresh;
    tracker.start = originalTaskStart;
  }
});
