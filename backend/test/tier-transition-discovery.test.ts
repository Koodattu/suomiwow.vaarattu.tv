/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import { TIER_TRANSITION_PREVIOUS_RAID_IDS } from "../src/config/guilds";

process.env.RAIDER_IO_API_KEY ||= "test";
process.env.BLIZZARD_CLIENT_ID ||= "test";
process.env.BLIZZARD_CLIENT_SECRET ||= "test";

test("tier transition discovery uses only the previous main raid", () => {
  assert.deepEqual(TIER_TRANSITION_PREVIOUS_RAID_IDS, [46]);
  assert.equal(TIER_TRANSITION_PREVIOUS_RAID_IDS.includes(50), false);
});

test("tier transition discovery is active only for the first fourteen days", async () => {
  const { isTierTransitionDiscoveryActive } = await import("../src/services/scheduler.service");
  const start = new Date("2026-08-19T04:00:00Z");

  assert.equal(isTierTransitionDiscoveryActive(start, new Date("2026-08-19T03:59:59Z")), false);
  assert.equal(isTierTransitionDiscoveryActive(start, start), true);
  assert.equal(isTierTransitionDiscoveryActive(start, new Date("2026-09-02T03:59:59Z")), true);
  assert.equal(isTierTransitionDiscoveryActive(start, new Date("2026-09-02T04:00:00Z")), false);
  assert.equal(isTierTransitionDiscoveryActive(null, start), false);
});

test("scheduled transition candidates must be due and inside the saved raid window", async () => {
  const { selectTierTransitionScheduledCandidates } = await import("../src/services/scheduler.service");
  const now = new Date("2026-08-19T15:00:00Z");
  const scheduledWednesday = {
    name: "Due",
    lastFetched: new Date(now.getTime() - 16 * 60 * 1000),
    raidSchedule: {
      sourceRaidId: 46,
      days: [{ day: "Wednesday", startHour: 19, endHour: 22, raidCount: 8 }],
    },
  };
  const recentlyFetched = {
    ...scheduledWednesday,
    name: "Recent",
    lastFetched: new Date(now.getTime() - 5 * 60 * 1000),
  };
  const wrongDay = {
    ...scheduledWednesday,
    name: "Thursday",
    raidSchedule: {
      sourceRaidId: 46,
      days: [{ day: "Thursday", startHour: 19, endHour: 22, raidCount: 8 }],
    },
  };
  const neverFetched = {
    ...scheduledWednesday,
    name: "Never",
    lastFetched: undefined,
  };

  const selected = selectTierTransitionScheduledCandidates(
    [scheduledWednesday, recentlyFetched, wrongDay, neverFetched],
    { weekday: "Wednesday", hour: 18 },
    now,
    15 * 60 * 1000,
    2,
  );

  assert.deepEqual(selected.map((guild) => guild.name), ["Never", "Due"]);
});

test("the previous schedule survives until the new raid has a stable replacement", async () => {
  const { shouldPreservePreviousRaidSchedule } = await import("../src/services/guild.service");
  const previousSchedule = {
    sourceRaidId: 46,
    days: [{ day: "Wednesday", startHour: 19, endHour: 22, raidCount: 8 }],
  };
  const legacyScheduleWithoutSource = {
    days: [{ day: "Wednesday", startHour: 19, endHour: 22, raidCount: 8 }],
  };

  assert.equal(shouldPreservePreviousRaidSchedule(previousSchedule, 53), true);
  assert.equal(shouldPreservePreviousRaidSchedule(legacyScheduleWithoutSource, 53), true);
  assert.equal(shouldPreservePreviousRaidSchedule({ ...previousSchedule, sourceRaidId: 53 }, 53), false);
  assert.equal(shouldPreservePreviousRaidSchedule({ sourceRaidId: 46, days: [] }, 53), false);
});

test("the transition scheduler queries raid 46 candidates without including Sporefall", async () => {
  const [{ default: scheduler }, { default: Raid }, { default: Guild }, { default: guildService }, { default: taskTracker }] = await Promise.all([
    import("../src/services/scheduler.service"),
    import("../src/models/Raid"),
    import("../src/models/Guild"),
    import("../src/services/guild.service"),
    import("../src/services/task-tracker.service"),
  ]);
  const schedulerService = scheduler as any;
  const raidModel = Raid as any;
  const guildModel = Guild as any;
  const guildUpdates = guildService as any;
  const tasks = taskTracker as any;
  const originals = {
    raidFind: raidModel.find,
    guildFind: guildModel.find,
    updateGuildProgress: guildUpdates.updateGuildProgress,
    taskStart: tasks.start,
    taskComplete: tasks.complete,
    taskFail: tasks.fail,
    getHelsinkiTime: schedulerService.getHelsinkiTime,
    lastSampleTime: schedulerService.lastTierTransitionUnscheduledSampleTime,
    lastRioSampleTime: schedulerService.lastTierTransitionRioSampleTime,
  };
  const filters: any[] = [];
  const updatedGuildIds: string[] = [];
  const candidate = {
    _id: "returning-guild",
    name: "Returning Guild",
    lastFetched: new Date("2026-08-18T14:00:00Z"),
    raidSchedule: {
      sourceRaidId: 46,
      days: [{ day: "Wednesday", startHour: 19, endHour: 22, raidCount: 8 }],
    },
  };

  raidModel.find = () => ({
    select: () => ({
      lean: async () => [
        { id: 53, slug: "the-venomous-abyss", starts: { eu: new Date("2026-08-19T04:00:00Z") } },
        { id: 46, slug: "vs-dr-mqd", starts: { eu: new Date("2026-03-18T04:00:00Z") } },
      ],
    }),
  });
  guildModel.find = (filter: any) => {
    filters.push(filter);
    if (filter.activityStatus === "inactive") return Promise.resolve([candidate]);
    return {
      sort: () => ({
        limit: async () => [],
      }),
    };
  };
  guildUpdates.updateGuildProgress = async (guildId: string) => {
    updatedGuildIds.push(guildId);
    return { guild: candidate, hasNewData: false, raidingStatusChanged: false, isInitialFetch: false };
  };
  tasks.start = async () => "transition-task";
  tasks.complete = async () => undefined;
  tasks.fail = async () => undefined;
  schedulerService.getHelsinkiTime = () => ({ weekday: "Wednesday", hour: 18 });
  const transitionNow = new Date("2026-08-19T15:00:00.000Z");
  schedulerService.lastTierTransitionUnscheduledSampleTime = transitionNow.getTime();
  schedulerService.lastTierTransitionRioSampleTime = 0;

  try {
    await schedulerService.updateTierTransitionDiscovery(transitionNow);

    assert.deepEqual(updatedGuildIds, ["returning-guild"]);
    const wclFilter = filters.find((filter) => filter.activityStatus === "inactive");
    assert.deepEqual(wclFilter["progress.raidId"], { $in: [46], $nin: [53] });
    assert.equal(wclFilter["progress.raidId"].$in.includes(50), false);
    const rioFilter = filters.find((filter) => filter.wclStatus === "not_found");
    assert.deepEqual(rioFilter.officialProgress.$elemMatch.raidTierSlug.$in, ["vs-dr-mqd"]);
  } finally {
    raidModel.find = originals.raidFind;
    guildModel.find = originals.guildFind;
    guildUpdates.updateGuildProgress = originals.updateGuildProgress;
    tasks.start = originals.taskStart;
    tasks.complete = originals.taskComplete;
    tasks.fail = originals.taskFail;
    schedulerService.getHelsinkiTime = originals.getHelsinkiTime;
    schedulerService.lastTierTransitionUnscheduledSampleTime = originals.lastSampleTime;
    schedulerService.lastTierTransitionRioSampleTime = originals.lastRioSampleTime;
    schedulerService.isUpdatingTierTransitionDiscovery = false;
  }
});
