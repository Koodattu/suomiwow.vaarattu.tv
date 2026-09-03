import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Fight from "../src/models/Fight";
import FightVodLink from "../src/models/FightVodLink";
import Guild from "../src/models/Guild";
import TwitchVodProfile from "../src/models/TwitchVodProfile";
import fightVodService from "../src/services/fight-vod.service";
import twitchService from "../src/services/twitch.service";

test("resolves least-recently checked VOD links fairly and retires stale no-VOD links", async () => {
  const originalFind = FightVodLink.find;
  const originalIsEnabled = twitchService.isEnabled;
  const originalGetRecentArchiveVideos = twitchService.getRecentArchiveVideos;
  const now = Date.now();
  const savedLinks: Array<Record<string, unknown>> = [];
  let capturedSort: unknown;
  let capturedLimit: number | undefined;
  let archiveLimit: number | undefined;

  const staleLink: any = {
    twitchUserId: "user-1",
    channelName: "channel-one",
    streamId: "stream-1",
    reportCode: "report-1",
    fightId: 1,
    fightStartedAt: new Date(now - 25 * 60 * 60 * 1000),
    streamStartedAt: new Date(now - 26 * 60 * 60 * 1000),
    status: "pending",
    availabilityStatus: "active",
    attempts: 3,
    save: async function save() {
      savedLinks.push(this);
    },
  };
  const recentLink: any = {
    twitchUserId: "user-1",
    channelName: "channel-one",
    streamId: "stream-2",
    reportCode: "report-2",
    fightId: 2,
    fightStartedAt: new Date(now - 2 * 60 * 60 * 1000),
    streamStartedAt: new Date(now - 3 * 60 * 60 * 1000),
    status: "pending",
    availabilityStatus: "active",
    attempts: 3,
    save: async function save() {
      savedLinks.push(this);
    },
  };

  FightVodLink.find = (() => {
    const query = {
      sort: (sort: unknown) => {
        capturedSort = sort;
        return query;
      },
      limit: async (limit: number) => {
        capturedLimit = limit;
        return [staleLink, recentLink];
      },
    };
    return query;
  }) as unknown as typeof FightVodLink.find;
  twitchService.isEnabled = (() => true) as typeof twitchService.isEnabled;
  twitchService.getRecentArchiveVideos = (async (_userId: string, limit?: number) => {
    archiveLimit = limit;
    return [];
  }) as typeof twitchService.getRecentArchiveVideos;

  try {
    const result = await fightVodService.resolvePendingLinks(100);

    assert.deepEqual(capturedSort, { lastCheckedAt: 1, createdAt: 1 });
    assert.equal(capturedLimit, 100);
    assert.equal(archiveLimit, 100);
    assert.deepEqual(result, { checked: 2, resolved: 0, unavailable: 1 });
    assert.equal(staleLink.status, "unavailable");
    assert.equal(staleLink.availabilityStatus, "unavailable");
    assert.equal(recentLink.status, "pending");
    assert.equal(staleLink.attempts, 4);
    assert.equal(recentLink.attempts, 4);
    assert.equal(savedLinks.length, 2);
  } finally {
    FightVodLink.find = originalFind;
    twitchService.isEnabled = originalIsEnabled;
    twitchService.getRecentArchiveVideos = originalGetRecentArchiveVideos;
  }
});

test("historical VOD backfill repairs an existing pending link", async () => {
  const originalGuildFind = Guild.find;
  const originalFightFind = Fight.find;
  const originalVodFind = FightVodLink.find;
  const originalVodUpdateOne = FightVodLink.updateOne;
  const originalProfileFindOne = TwitchVodProfile.findOne;
  const originalProfileUpdateOne = TwitchVodProfile.updateOne;
  const originalIsEnabled = twitchService.isEnabled;
  const originalGetUsersByLogins = twitchService.getUsersByLogins;
  const originalGetArchiveVideosSince = twitchService.getArchiveVideosSince;
  const fightStartedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const streamStartedAt = new Date(fightStartedAt.getTime() - 60 * 60 * 1000);
  const guildId = new mongoose.Types.ObjectId();
  const fight = {
    reportCode: "report-1",
    fightId: 10,
    timestamp: fightStartedAt,
    duration: 5 * 60 * 1000,
    bossPercentage: 50,
    fightPercentage: 50,
    isKill: false,
  };
  const guild: any = {
    _id: guildId,
    name: "Test Guild",
    realm: "test-realm",
    streamers: [{ channelName: "TestChannel", twitchUserId: "user-1" }],
    progress: [
      {
        raidId: 53,
        difficulty: "mythic",
        bosses: [{ bossId: 100, bossName: "Test Boss", pullCount: 1, kills: 0 }],
      },
    ],
  };
  const video: any = {
    id: "video-1",
    stream_id: "stream-1",
    type: "archive",
    created_at: streamStartedAt.toISOString(),
    duration: "4h0m0s",
  };
  let capturedUpdate: any;

  Guild.find = (() => ({ select: async () => [guild] })) as unknown as typeof Guild.find;
  Fight.find = (() => {
    const query = {
      select: () => query,
      sort: () => query,
      limit: () => query,
      lean: async () => [fight],
    };
    return query;
  }) as unknown as typeof Fight.find;
  FightVodLink.find = (() => ({
    select: () => ({
      lean: async () => [{ channelName: "testchannel", status: "pending", streamId: "stale-stream" }],
    }),
  })) as unknown as typeof FightVodLink.find;
  FightVodLink.updateOne = (async (_filter: unknown, update: unknown) => {
    capturedUpdate = update;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }) as unknown as typeof FightVodLink.updateOne;
  TwitchVodProfile.findOne = (() => ({ lean: async () => null })) as unknown as typeof TwitchVodProfile.findOne;
  TwitchVodProfile.updateOne = (async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 })) as unknown as typeof TwitchVodProfile.updateOne;
  twitchService.isEnabled = (() => true) as typeof twitchService.isEnabled;
  twitchService.getUsersByLogins = (async () => new Map([
    ["testchannel", { id: "user-1", login: "testchannel", broadcaster_type: "affiliate" } as any],
  ])) as typeof twitchService.getUsersByLogins;
  twitchService.getArchiveVideosSince = (async () => [video]) as typeof twitchService.getArchiveVideosSince;

  try {
    const result = await fightVodService.backfillRecentBestPullLinks();

    assert.equal(result.matched, 1);
    assert.equal(result.skippedExisting, 0);
    assert.equal(capturedUpdate.$set.status, "resolved");
    assert.equal(capturedUpdate.$set.availabilityStatus, "active");
    assert.equal(capturedUpdate.$set.videoId, "video-1");
    assert.equal(capturedUpdate.$set.streamId, "stream-1");
    assert.equal(capturedUpdate.$set.matchMethod, "vod-window");
    assert.equal(capturedUpdate.$setOnInsert.attempts, 1);
  } finally {
    Guild.find = originalGuildFind;
    Fight.find = originalFightFind;
    FightVodLink.find = originalVodFind;
    FightVodLink.updateOne = originalVodUpdateOne;
    TwitchVodProfile.findOne = originalProfileFindOne;
    TwitchVodProfile.updateOne = originalProfileUpdateOne;
    twitchService.isEnabled = originalIsEnabled;
    twitchService.getUsersByLogins = originalGetUsersByLogins;
    twitchService.getArchiveVideosSince = originalGetArchiveVideosSince;
  }
});
