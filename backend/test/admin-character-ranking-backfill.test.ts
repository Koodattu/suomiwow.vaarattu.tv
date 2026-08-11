/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";
import { TRACKED_RAIDS } from "../src/config/guilds";

test("all-raid ranking refetch refreshes every tracked raid before queueing", async () => {
  process.env.RAIDER_IO_API_KEY ||= "test";
  process.env.BLIZZARD_CLIENT_ID ||= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test-secret";

  const [{ default: guildService }, { default: rankingService }, { default: discordService }] = await Promise.all([
    import("../src/services/guild.service"),
    import("../src/services/character-ranking-backfill.service"),
    import("../src/services/discord.service"),
  ]);

  const guild = guildService as any;
  const rankings = rankingService as any;
  const discord = discordService as any;
  const originalRefreshRaidPartitions = guild.refreshRaidPartitions;
  const originalTriggerBackfill = rankings.triggerBackfill;
  const originalGetUserFromSession = discord.getUserFromSession;
  const originalIsAdmin = discord.isAdmin;
  const calls: string[] = [];
  let partitionRefreshFails = false;

  guild.refreshRaidPartitions = async (raidIds: number[]) => {
    calls.push("refresh-partitions");
    assert.deepEqual(raidIds, TRACKED_RAIDS);
    return {
      requestedRaidIds: [...raidIds],
      updatedRaidIds: partitionRefreshFails ? raidIds.slice(1) : [...raidIds],
      failures: partitionRefreshFails ? [{ raidId: raidIds[0], reason: "WCL unavailable" }] : [],
    };
  };
  rankings.triggerBackfill = async (options: Record<string, unknown>) => {
    calls.push("queue-rankings");
    assert.deepEqual(options, {
      refreshCandidates: true,
      reprocessCompleted: true,
      zoneIds: undefined,
    });
    return {
      started: true,
      enqueue: {
        candidates: 1,
        queued: 1,
        existing: 0,
        updated: 0,
        skippedWithoutCharacter: 0,
        discoverySkipped: false,
        requeued: 0,
      },
      status: {},
    };
  };
  discord.getUserFromSession = async () => ({ discord: { username: "admin" } });
  discord.isAdmin = () => true;

  const { default: adminRouter } = await import("../src/routes/admin");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "ranking-backfill-test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.session.userId = "admin-session";
    next();
  });
  app.use("/api/admin", adminRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const successResponse = await fetch(`http://127.0.0.1:${port}/api/admin/trigger/backfill-character-rankings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshCandidates: true, reprocessCompleted: true, scope: "all" }),
    });
    const successBody = await successResponse.json() as any;

    assert.equal(successResponse.status, 200);
    assert.deepEqual(calls, ["refresh-partitions", "queue-rankings"]);
    assert.deepEqual(successBody.partitionRefresh.updatedRaidIds, TRACKED_RAIDS);

    calls.length = 0;
    partitionRefreshFails = true;
    const failureResponse = await fetch(`http://127.0.0.1:${port}/api/admin/trigger/backfill-character-rankings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshCandidates: true, reprocessCompleted: true, scope: "all" }),
    });
    const failureBody = await failureResponse.json() as any;

    assert.equal(failureResponse.status, 502);
    assert.deepEqual(calls, ["refresh-partitions"]);
    assert.match(failureBody.error, new RegExp(`raid\\(s\\): ${TRACKED_RAIDS[0]}$`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    guild.refreshRaidPartitions = originalRefreshRaidPartitions;
    rankings.triggerBackfill = originalTriggerBackfill;
    discord.getUserFromSession = originalGetUserFromSession;
    discord.isAdmin = originalIsAdmin;
  }
});
