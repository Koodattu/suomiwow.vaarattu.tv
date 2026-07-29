import assert from "node:assert/strict";
import test from "node:test";
import ccgPublisherService from "../src/services/ccg-publisher.service";
import ccgSnapshotRunner from "../src/services/ccg-snapshot-runner.service";
import taskTracker from "../src/services/task-tracker.service";

test("CCG snapshot runner processes every enabled set once and rejects overlapping runs", async () => {
  const publisher = ccgPublisherService as any;
  const tracker = taskTracker as any;
  const originalGetEnabledRaidSets = publisher.getEnabledRaidSets;
  const originalBuildSnapshot = publisher.buildSnapshot;
  const originalStart = tracker.start;
  const originalComplete = tracker.complete;
  const originalFail = tracker.fail;

  let releaseFirstSnapshot!: () => void;
  const firstSnapshotBlocked = new Promise<void>((resolve) => {
    releaseFirstSnapshot = resolve;
  });
  let resolveCompleted!: (metadata: Record<string, unknown>) => void;
  const completed = new Promise<Record<string, unknown>>((resolve) => {
    resolveCompleted = resolve;
  });
  const builtZoneIds: number[] = [];

  publisher.getEnabledRaidSets = async () => [
    { zoneId: 300, slug: "newer-raid" },
    { zoneId: 200, slug: "older-raid" },
  ];
  publisher.buildSnapshot = async (zoneId: number) => {
    builtZoneIds.push(zoneId);
    if (zoneId === 300) await firstSnapshotBlocked;
    return {
      snapshotKey: `raid-${zoneId}:2026-07-29`,
      candidates: zoneId,
      ready: zoneId - 1,
      missingMedia: 1,
      gradeDistribution: {},
    };
  };
  tracker.start = async () => "task-id";
  tracker.complete = async (_taskId: string, metadata: Record<string, unknown>) => resolveCompleted(metadata);
  tracker.fail = async () => assert.fail("snapshot run should not fail");

  try {
    assert.equal(ccgSnapshotRunner.trigger("admin"), true);
    assert.equal(ccgSnapshotRunner.trigger("cron"), false);

    releaseFirstSnapshot();
    const completion = await completed;
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(builtZoneIds, [300, 200]);
    assert.deepEqual(
      (completion.sets as Array<{ zoneId: number; slug: string }>).map(({ zoneId, slug }) => ({ zoneId, slug })),
      [
        { zoneId: 300, slug: "newer-raid" },
        { zoneId: 200, slug: "older-raid" },
      ],
    );
  } finally {
    publisher.getEnabledRaidSets = originalGetEnabledRaidSets;
    publisher.buildSnapshot = originalBuildSnapshot;
    tracker.start = originalStart;
    tracker.complete = originalComplete;
    tracker.fail = originalFail;
  }
});
