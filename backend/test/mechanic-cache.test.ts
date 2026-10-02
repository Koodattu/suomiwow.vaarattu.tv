/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { activeAvoidableMechanics, AvoidableMechanic } from "../src/config/avoidable-mechanics";
import service from "../src/services/avoidable-damage.service";
import router from "../src/routes/avoidable-damage";
import type { MechanicSnapshot } from "../src/utils/mechanic-leaderboard";
import { deferred, mockSnapshotStorage } from "./helpers/snapshot-cache";

const builder = service as unknown as {
  buildOptions: typeof service.getOptions;
  buildLeaderboardSnapshot(mechanic: AvoidableMechanic): Promise<MechanicSnapshot>;
};

test("warming covers options and every enabled mechanic before the first HTTP visitor", async (t) => {
  mockSnapshotStorage(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-02T10:00:00Z") });
  const mechanics = activeAvoidableMechanics();
  const builds: string[] = [];
  let optionBuilds = 0;
  t.mock.method(builder, "buildOptions", async () => { optionBuilds++; return { mechanics, raids: [], guilds: [] }; });
  t.mock.method(builder, "buildLeaderboardSnapshot", async (mechanic: AvoidableMechanic) => {
    builds.push(mechanic.key);
    return { mechanic, rows: [], coverage: [] };
  });
  await service.warmLeaderboardCaches();
  assert.deepEqual(builds, mechanics.map((mechanic) => mechanic.key));
  assert.equal(optionBuilds, 1);
  await service.warmLeaderboardCaches();
  assert.equal(builds.length, mechanics.length);
  assert.equal(optionBuilds, 1);

  // Several refresh cycles without a reader must keep all choices ready to serve.
  for (let cycle = 0; cycle < 4; cycle++) {
    t.mock.timers.tick(4 * 60_000);
    await service.warmLeaderboardCaches();
  }
  assert.equal(optionBuilds, 5);
  assert.equal(builds.length, mechanics.length * 5);
  const app = express();
  app.use("/mechanics", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mechanics`;
  const options = await fetch(`${url}/options`);
  assert.equal(options.status, 200);
  assert.equal((await options.json() as { mechanics: unknown[] }).mechanics.length, mechanics.length);
  for (const mechanic of [mechanics[0], mechanics[mechanics.length - 1]]) {
    for (const query of ["", "&roles=tank&sort=hits&order=asc&minPulls=50&page=2"]) {
      const response = await fetch(`${url}?mechanic=${mechanic.key}${query}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control")!, /stale-while-revalidate/);
      await response.json();
    }
  }
  assert.equal(builds.length, mechanics.length * 5, "HTTP filters must reuse the warmed snapshot");
  assert.equal(optionBuilds, 5, "the first options request must not build the catalogue");
});

test("collection refresh replaces fresh data and a failed mechanic cannot prevent the rest warming", async (t) => {
  const { entries } = mockSnapshotStorage(t);
  const mechanics = activeAvoidableMechanics().slice(0, 2);
  t.mock.method(builder, "buildOptions", async () => ({ mechanics, raids: [], guilds: [] }));
  let generation = 1;
  let failFirst = false;
  const builds: string[] = [];
  t.mock.method(builder, "buildLeaderboardSnapshot", async (mechanic: AvoidableMechanic) => {
    builds.push(mechanic.key);
    if (failFirst && mechanic.key === mechanics[0].key) throw new Error("fixture aggregation failure");
    return { mechanic, rows: [], coverage: [{ guildId: "guild", isKill: false, status: "fetched", fights: generation, updatedAt: null }] };
  });
  const keys = mechanics.map((mechanic) => mechanic.key);
  await service.warmLeaderboardCaches(keys);
  generation = 2;
  failFirst = true;
  await service.warmLeaderboardCaches(keys, true);
  assert.equal(builds.length, 4);
  const snapshot = (mechanic: AvoidableMechanic) => entries.get(`avoidable-damage:snapshot:v3:${mechanic.key}:${mechanic.version}`)!.data as MechanicSnapshot;
  assert.equal(snapshot(mechanics[0]).coverage[0].fights, 1, "a failed build retains existing data");
  assert.equal(snapshot(mechanics[1]).coverage[0].fights, 2, "subsequent mechanics still refresh");
});

test("scheduled mechanics warming avoids overlapping work, yields to maintenance, and recovers after failure", async (t) => {
  process.env.RAIDER_IO_API_KEY ||= "test";
  process.env.BLIZZARD_CLIENT_ID ||= "test";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test";
  const { default: scheduler } = await import("../src/services/scheduler.service");
  const scheduling = scheduler as unknown as {
    refreshMechanicCache(): Promise<void>;
    getBlockingDatabaseMaintenanceJob(): string | null;
  };
  const gate = deferred<void>();
  let runs = 0;
  const warm = t.mock.method(service, "warmLeaderboardCaches", async () => { runs++; await gate.promise; });
  const maintenance = t.mock.method(scheduling, "getBlockingDatabaseMaintenanceJob", () => null);
  const first = scheduling.refreshMechanicCache();
  await scheduling.refreshMechanicCache();
  assert.equal(runs, 1);
  gate.resolve();
  await first;
  maintenance.mock.mockImplementation(() => "maintenance");
  await scheduling.refreshMechanicCache();
  assert.equal(runs, 1);
  maintenance.mock.mockImplementation(() => null);
  warm.mock.mockImplementation(async () => { runs++; throw new Error("fixture refresh failure"); });
  await scheduling.refreshMechanicCache();
  warm.mock.mockImplementation(async () => { runs++; });
  await scheduling.refreshMechanicCache();
  assert.equal(runs, 3, "a failure must not disable later scheduled refreshes");
});
