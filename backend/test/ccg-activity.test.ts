/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import CcgPackOpening from "../src/models/CcgPackOpening";
import TwitchCcgRedemption from "../src/models/TwitchCcgRedemption";
import { resolveCcgActivityFilter, resolveCcgActivityPackSetId } from "../src/services/ccg.service";

test("CCG activity accepts only supported filters", () => {
  assert.equal(resolveCcgActivityFilter(undefined), "all");
  assert.equal(resolveCcgActivityFilter("packs"), "packs");
  assert.equal(resolveCcgActivityFilter("codes"), "codes");
  assert.equal(resolveCcgActivityFilter("twitch"), "twitch");
  assert.equal(resolveCcgActivityFilter("rewards"), null);
});

test("CCG activity sources have account history indexes", () => {
  const openingIndexes = CcgPackOpening.schema.indexes();
  const twitchIndexes = TwitchCcgRedemption.schema.indexes();

  assert.ok(openingIndexes.some((entry: [Record<string, 1 | -1>, Record<string, unknown>]) => (
    entry[0].claimedByUserId === 1 && entry[0].createdAt === -1
  )));
  assert.ok(twitchIndexes.some((entry: [Record<string, 1 | -1>, Record<string, unknown>]) => (
    entry[0].grantedUserId === 1 && entry[0].grantStatus === 1 && entry[0].redeemedAt === -1
  )));
});

test("CCG activity uses the opened pack source instead of the first pulled card", () => {
  const currentSetId = new mongoose.Types.ObjectId();
  const communitySetId = new mongoose.Types.ObjectId();
  const targetedLegacySetId = new mongoose.Types.ObjectId();

  assert.equal(String(resolveCcgActivityPackSetId("raid", null, [currentSetId, communitySetId])), String(currentSetId));
  assert.equal(String(resolveCcgActivityPackSetId("raid", targetedLegacySetId, [targetedLegacySetId, communitySetId])), String(targetedLegacySetId));
  assert.equal(resolveCcgActivityPackSetId("all", null, [targetedLegacySetId, communitySetId]), null);
  assert.equal(resolveCcgActivityPackSetId(undefined, null, [currentSetId, communitySetId]), null);
});

test("CCG activity requires an authenticated user", async () => {
  const { default: ccgRouter } = await import("../src/routes/ccg");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "ccg-activity-auth-test", resave: false, saveUninitialized: false }));
  app.use("/api/ccg", ccgRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ccg/activity`);
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code?: string }).code, "authentication_required");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
