/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PICK_EM_RWF_GUILDS } from "../src/config/guilds";
import Pickem from "../src/models/Pickem";
import User from "../src/models/User";
import pickemsRouter from "../src/routes/pickems";
import cacheService from "../src/services/cache.service";
import pickemService from "../src/services/pickem.service";
import { getRwfFinalRankingsCount } from "../src/utils/pickemRankings";

const guilds = [...new Set(PICK_EM_RWF_GUILDS)];

for (const [guildCount, finalRankingsCount, expectedCount] of [
  [1, 0, 6],
  [5, 0, 10],
  [10, 0, 15],
  [10, 10, 15],
  [10, 20, 20],
  [25, 0, guilds.length],
]) {
  test(`finalizes ${guildCount} RWF picks with ${expectedCount} rankings (setting ${finalRankingsCount})`, async (t) => {
    const pickem = new Pickem({ pickemId: "rwf-test", type: "rwf", guildCount, finalRankingsCount });
    t.mock.method(Pickem, "findOne", async () => pickem);
    const save = t.mock.method(pickem, "save", async () => pickem);

    assert.equal(getRwfFinalRankingsCount(pickem), expectedCount);
    const tooShort = await pickemService.finalizeRwfPickem(pickem.pickemId, guilds.slice(0, expectedCount - 1));
    assert.deepEqual(tooShort, { success: false, error: `Expected ${expectedCount} guilds in rankings, got ${expectedCount - 1}` });
    assert.equal(pickem.finalized, false);
    assert.equal(save.mock.callCount(), 0);

    const rankings = guilds.slice(0, expectedCount);
    const result = await pickemService.finalizeRwfPickem(pickem.pickemId, rankings);
    assert.equal(result.success, true);
    assert.deepEqual(result.pickem?.finalRankings, rankings);
    assert.equal(result.pickem?.guildCount, guildCount);
    assert.equal(result.pickem?.finalized, true);
    assert.ok(result.pickem?.finalizedAt instanceof Date);
    assert.equal(save.mock.callCount(), 1);
  });
}

test("rejects too many, duplicate, and unknown RWF final rankings without saving", async (t) => {
  const pickem = new Pickem({ pickemId: "rwf-test", type: "rwf", guildCount: 10 });
  t.mock.method(Pickem, "findOne", async () => pickem);
  const save = t.mock.method(pickem, "save", async () => pickem);

  for (const [rankings, error] of [
    [guilds.slice(0, 16), "Expected 15 guilds in rankings, got 16"],
    [[...guilds.slice(0, 14), guilds[0]], "Duplicate guilds in rankings"],
    [[...guilds.slice(0, 14), "Unknown guild"], "Invalid guilds in rankings: Unknown guild"],
  ] as const) {
    assert.deepEqual(await pickemService.finalizeRwfPickem(pickem.pickemId, [...rankings]), { success: false, error });
  }
  assert.equal(save.mock.callCount(), 0);
});

test("keeps the recorded scoring range for previously finalized RWF pickems", async (t) => {
  const pickem = new Pickem({ pickemId: "old-rwf", type: "rwf", guildCount: 10, finalized: true, finalRankings: guilds.slice(0, 10) });
  t.mock.method(Pickem, "findOne", async () => pickem);
  assert.equal(getRwfFinalRankingsCount(pickem), 10);
  assert.deepEqual(await pickemService.finalizeRwfPickem(pickem.pickemId, guilds.slice(0, 15)), {
    success: false,
    error: "Pickem has already been finalized",
  });
});

test("RWF leaderboard scores nearby finishes beyond the prediction range after finalization", async (t) => {
  const pickem = new Pickem({
    pickemId: "rwf-scoring",
    name: "RWF scoring",
    type: "rwf",
    guildCount: 10,
    votingStart: new Date("2020-01-01"),
    votingEnd: new Date("2020-01-02"),
    ccgRewardPacks: 0,
    streakConfig: { enabled: false },
  });
  t.mock.method(Pickem, "findOne", async () => pickem);
  t.mock.method(pickem, "save", async () => pickem);
  t.mock.method(pickemService, "getPickemById", async () => pickem.toObject());
  t.mock.method(cacheService, "get", async () => null);
  t.mock.method(cacheService, "set", async () => undefined);
  // Each participant predicts one boundary guild at 10th; the other picks are
  // omitted from these stored fixtures to isolate each position score.
  t.mock.method(User, "find", () => ({
    lean: async () => [11, 14, 15, 16].map((rank) => ({
      discord: { id: String(rank), username: `rank-${rank}`, avatar: null },
      pickems: [{ pickemId: pickem.pickemId, predictions: [{ guildName: guilds[rank - 1], realm: "RWF", position: 10 }] }],
    })),
  }));

  const app = express();
  app.use(session({ secret: "rwf-finalization-test", resave: false, saveUninitialized: false }));
  app.use("/pickems", pickemsRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pickems/${pickem.pickemId}`;

  const pendingResponse = await fetch(url);
  assert.equal(pendingResponse.status, 200);
  const pending = await pendingResponse.json() as any;
  assert.equal(pending.finalRankingsCount, 15);
  assert.ok(pending.leaderboard.every((entry: any) => entry.totalPoints === 0));

  assert.equal((await pickemService.finalizeRwfPickem(pickem.pickemId, guilds.slice(0, 15))).success, true);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.finalRankingsCount, 15);
  assert.equal(body.guildRankings.length, 15);
  for (const [rank, expectedPoints] of [[11, 8], [14, 2], [15, 0], [16, 0]]) {
    const entry = body.leaderboard.find((row: any) => row.username === `rank-${rank}`);
    assert.equal(entry.predictions[0].actualRank, rank <= 15 ? rank : null);
    assert.equal(entry.totalPoints, expectedPoints);
  }

  pickem.scoringConfig.offByFiveOrMore = 1;
  const customResponse = await fetch(url);
  assert.equal(customResponse.status, 200);
  const custom = await customResponse.json() as any;
  assert.equal(custom.leaderboard.find((entry: any) => entry.username === "rank-15").totalPoints, 1);
  assert.equal(custom.leaderboard.find((entry: any) => entry.username === "rank-16").totalPoints, 0);
});
