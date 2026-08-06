import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Guild, { IRaidProgress } from "../src/models/Guild";
import Report from "../src/models/Report";
import bossKillPredictionService from "../src/services/boss-kill-prediction.service";
import twitchChatCommandService, { selectPredictionTarget } from "../src/services/twitch-chat-command.service";

const raidProgress = (raidId: number, bossId: number, bossName: string): IRaidProgress => ({
  raidId,
  raidName: `Raid ${raidId}`,
  difficulty: "mythic",
  bossesDefeated: 0,
  totalBosses: 2,
  totalTimeSpent: 0,
  bosses: [
    {
      bossId,
      bossName,
      kills: 0,
      bestPercent: 25,
      pullCount: 20,
      timeSpent: 0,
      lastUpdated: new Date(),
    },
  ],
  lastUpdated: new Date(),
});

test("parses both prediction command aliases into one canonical command", () => {
  assert.deepEqual(twitchChatCommandService.parse("!prediction"), { name: "prediction", args: "" });
  assert.deepEqual(twitchChatCommandService.parse("  !EnNuStUs Tuju  "), { name: "prediction", args: "Tuju" });
});

test("does not parse partial prediction command names", () => {
  assert.equal(twitchChatCommandService.parse("!predictions"), null);
  assert.equal(twitchChatCommandService.parse("!ennustusnyt"), null);
});

test("keeps the existing command aliases unchanged", () => {
  assert.deepEqual(twitchChatCommandService.parse("!paras"), { name: "best", args: "" });
  assert.deepEqual(twitchChatCommandService.parse("!search Tuju"), { name: "search", args: "Tuju" });
});

test("parses both live log command aliases", () => {
  assert.deepEqual(twitchChatCommandService.parse("!log"), { name: "log", args: "" });
  assert.deepEqual(twitchChatCommandService.parse("  !RePoRt Tuju  "), { name: "log", args: "Tuju" });
});

test("returns the fresh Warcraft Logs report for a raiding channel guild", async () => {
  const originalGuildFind = Guild.find;
  const originalReportFindOne = Report.findOne;
  const guildId = new Types.ObjectId();
  const now = Date.parse("2026-08-06T18:00:00.000Z");
  const originalDateNow = Date.now;
  let reportFilter: Record<string, unknown> | undefined;

  Guild.find = (() => ({
    select: () => ({
      lean: async () => [
        {
          _id: guildId,
          name: "Test Guild",
          realm: "Test Realm",
          region: "EU",
          isCurrentlyRaiding: true,
          progress: [],
          officialProgress: [],
          streamers: [{ channelName: "testchannel", isLive: true, isPlayingWoW: true }],
        },
      ],
    }),
  })) as unknown as typeof Guild.find;
  Report.findOne = ((filter: Record<string, unknown>) => {
    reportFilter = filter;
    return {
      sort: () => ({
        select: () => ({
          lean: async () => ({ code: "FreshReport123" }),
        }),
      }),
    };
  }) as unknown as typeof Report.findOne;
  Date.now = () => now;

  try {
    const response = await twitchChatCommandService.handle({ name: "log", args: "" }, "testchannel", { includeUrl: false });

    assert.equal(response, "Test Guild live log: https://www.warcraftlogs.com/reports/FreshReport123");
    assert.deepEqual(reportFilter, {
      guildId,
      endTime: { $gte: now - 30 * 60 * 1000 },
    });
  } finally {
    Guild.find = originalGuildFind;
    Report.findOne = originalReportFindOne;
    Date.now = originalDateNow;
  }
});

test("does not fall back to an old report when a raiding guild has no fresh stored report", async () => {
  const originalGuildFind = Guild.find;
  const originalReportFindOne = Report.findOne;

  Guild.find = (() => ({
    select: () => ({
      lean: async () => [
        {
          _id: new Types.ObjectId(),
          name: "Test Guild",
          realm: "Test Realm",
          region: "EU",
          isCurrentlyRaiding: true,
          progress: [],
          officialProgress: [],
          streamers: [{ channelName: "testchannel", isLive: true, isPlayingWoW: true }],
        },
      ],
    }),
  })) as unknown as typeof Guild.find;
  Report.findOne = (() => ({
    sort: () => ({
      select: () => ({
        lean: async () => null,
      }),
    }),
  })) as unknown as typeof Report.findOne;

  try {
    const response = await twitchChatCommandService.handle({ name: "log", args: "" }, "testchannel", { includeUrl: true });

    assert.equal(response, "Test Guild: no live Warcraft Logs report right now.");
  } finally {
    Guild.find = originalGuildFind;
    Report.findOne = originalReportFindOne;
  }
});

test("selects the most recently pulled boss across current raids", () => {
  const primaryRaid = raidProgress(46, 1001, "Primary raid boss");
  const secondaryRaid = raidProgress(50, 2001, "Secondary raid boss");
  secondaryRaid.bosses.push({ ...secondaryRaid.bosses[0], bossId: 2002, bossName: "Most recent boss" });

  const fallback = selectPredictionTarget([primaryRaid, secondaryRaid], null);
  const recent = selectPredictionTarget([primaryRaid, secondaryRaid], {
    raidId: secondaryRaid.raidId,
    difficulty: secondaryRaid.difficulty,
    bossId: 2002,
  });

  assert.equal(fallback?.boss?.bossName, "Primary raid boss");
  assert.equal(recent?.boss?.bossName, "Most recent boss");
});

test("returns a visible unavailable reply when prediction lookups fail", async () => {
  const originalFind = Guild.find;
  const originalFindMostRecentlyPulledBoss = bossKillPredictionService.findMostRecentlyPulledBoss;
  const originalPredict = bossKillPredictionService.predict;
  const progress = raidProgress(46, 1001, "Test Boss");

  Guild.find = (() => ({
    select: () => ({
      lean: async () => [
        {
          _id: new Types.ObjectId(),
          name: "Test Guild",
          realm: "Test Realm",
          region: "EU",
          isCurrentlyRaiding: true,
          progress: [progress],
          officialProgress: [],
          streamers: [{ channelName: "testchannel", isLive: true, isPlayingWoW: true }],
        },
      ],
    }),
  })) as unknown as typeof Guild.find;
  bossKillPredictionService.findMostRecentlyPulledBoss = (async () => {
    throw new Error("recency lookup failed");
  }) as typeof bossKillPredictionService.findMostRecentlyPulledBoss;
  bossKillPredictionService.predict = (async () => {
    throw new Error("prediction lookup failed");
  }) as typeof bossKillPredictionService.predict;

  try {
    const response = await twitchChatCommandService.handle({ name: "prediction", args: "" }, "testchannel", { includeUrl: false });

    assert.equal(response, "Test Guild: prediction for Test Boss is temporarily unavailable. Try again soon.");
  } finally {
    Guild.find = originalFind;
    bossKillPredictionService.findMostRecentlyPulledBoss = originalFindMostRecentlyPulledBoss;
    bossKillPredictionService.predict = originalPredict;
  }
});
