/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";
import router, { parseMechanicBackfill } from "../src/routes/admin-avoidable-damage";
import service, { MechanicBackfillOptions } from "../src/services/avoidable-damage.service";
import discord from "../src/services/discord.service";
import { activeAvoidableMechanics } from "../src/config/avoidable-mechanics";
import mongoose from "mongoose";
import Fight from "../src/models/Fight";
import Guild from "../src/models/Guild";
import AvoidableDamageFight from "../src/models/AvoidableDamageFight";

test("admin mechanic requests require an explicit valid bounded selection", () => {
  const valid = { mechanicKeys: ["sszorak-tempest"] };
  assert.deepEqual(parseMechanicBackfill(valid), { ...valid, guildId: undefined, retryUnavailable: false });
  assert.deepEqual(parseMechanicBackfill({ mechanicKeys: ["sszorak-tempest", "sszorak-tempest"] })?.mechanicKeys, valid.mechanicKeys);
  const allKeys = activeAvoidableMechanics().map((entry) => entry.key);
  assert.deepEqual(parseMechanicBackfill({ mechanicKeys: allKeys })?.mechanicKeys, allKeys);
  const sameBoss = ["sarkareth-scorching-bomb", "sarkareth-abyssal-breath", "sarkareth-scouring-eternity"];
  assert.deepEqual(parseMechanicBackfill({ mechanicKeys: sameBoss })?.mechanicKeys, sameBoss);
  for (const body of [null, [], {}, { mechanicKeys: [] }, { mechanicKeys: "sszorak-tempest" }, { mechanicKeys: ["removed"] },
    { mechanicKeys: [{ $ne: null }] }, { ...valid, guildId: { $ne: null } }, { ...valid, guildId: "x" },
    { ...valid, retryUnavailable: "false" }, { mechanicKeys: Array(100).fill("sszorak-tempest") }]) assert.equal(parseMechanicBackfill(body), null);
});

test("queueing reads lean guild metadata without loading embedded pull histories", async (t) => {
  const [includedId, excludedId] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const keys = ["sszorak-tempest", "coiled-altar-axegrinder"];
  const queued: Array<{ guildId: string; keys: string[] }> = [];
  t.mock.method(Fight, "distinct", async (field: string, filter: Record<string, unknown>) => {
    assert.equal(field, "guildId");
    assert.equal(filter.difficulty, 5);
    assert.deepEqual(filter.$or, [{ zoneId: 53, encounterID: 3420 }, { zoneId: 53, encounterID: 3429 }]);
    return [includedId, excludedId];
  });
  // Use a real Mongoose query so projection and lean are checked at execution,
  // before any database data could be transferred or hydrated.
  const query = Guild.find();
  t.mock.method(query, "exec", async () => {
    assert.deepEqual(query.projection(), { _id: 1, name: 1, realm: 1, region: 1, excludedRaidIds: 1 });
    assert.equal(query.mongooseOptions().lean, true);
    return [
      { _id: includedId, name: "Included", realm: "realm", region: "EU", excludedRaidIds: [] },
      { _id: excludedId, name: "Excluded", realm: "realm", region: "EU", excludedRaidIds: [53] },
    ];
  });
  t.mock.method(Guild, "find", (filter: unknown) => {
    assert.deepEqual(filter, { _id: { $in: [includedId, excludedId] }, logSourceMigrationLockToken: { $exists: false } });
    return query;
  });
  t.mock.method(AvoidableDamageFight, "updateMany", async () => { assert.fail("A normal queue request must not reset collected data"); });
  t.mock.method(service, "enqueueGuild", async (guild: { _id: unknown }, selected: string[]) => {
    queued.push({ guildId: String(guild._id), keys: selected });
    return {};
  });
  assert.deepEqual(await service.queueBackfill({ mechanicKeys: keys }), { queued: 1, retried: 0, mechanicKeys: keys });
  assert.deepEqual(queued, [{ guildId: String(includedId), keys }]);
});

test("admin endpoints enforce authorization and only enqueue the selected scope", async (t) => {
  let authenticated = false;
  let admin = false;
  const calls: unknown[] = [];
  t.mock.method(discord, "getUserFromSession", async () => ({ discord: { username: "fixture" } }));
  t.mock.method(discord, "isAdmin", () => admin);
  t.mock.method(service, "queueBackfill", async (options?: MechanicBackfillOptions) => { calls.push(options); return { queued: 1, retried: 0, mechanicKeys: options?.mechanicKeys ?? [] }; });
  t.mock.method(service, "getCollectionStatus", async (guildId?: string) => { calls.push(guildId); return { fixture: true }; });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "mechanic-admin-test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { if (authenticated) req.session.userId = "fixture"; next(); });
  app.use("/api/admin/avoidable-damage", router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/avoidable-damage`;
  const request = (body: unknown) => fetch(`${url}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await request({ mechanicKeys: ["sszorak-tempest"] })).status, 401);
    authenticated = true;
    assert.equal((await request({ mechanicKeys: ["sszorak-tempest"] })).status, 403);
    assert.equal(calls.length, 0);
    admin = true;
    assert.equal((await request({})).status, 400);
    assert.equal((await fetch(`${url}?guildId[evil]=1`)).status, 400);
    assert.equal(calls.length, 0);
    const scope = { mechanicKeys: ["sszorak-tempest"], guildId: "000000000000000000000001", retryUnavailable: true };
    const response = await request(scope);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json() as { queued: number }).queued, 1);
    assert.deepEqual(calls, [scope]);
    assert.equal((await fetch(`${url}?guildId=${scope.guildId}`)).status, 200);
    assert.deepEqual(calls, [scope, scope.guildId]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
