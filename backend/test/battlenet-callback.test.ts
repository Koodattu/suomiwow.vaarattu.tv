/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import test from "node:test";
import { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";
import service, { BattleNetSyncError } from "../src/services/battlenet-auth.service";
import discord from "../src/services/discord.service";
import { IWoWCharacter } from "../src/models/User";

test("Battle.net callbacks work from Profile and Card Studio and preserve session/state checks", async (t) => {
  const intervals: ReturnType<typeof setInterval>[] = [];
  const originalSetInterval = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
    const timer = originalSetInterval(...args);
    intervals.push(timer);
    return timer;
  });
  const { default: router } = await import("../src/routes/auth");
  t.after(() => intervals.forEach(clearInterval));
  t.mock.method(service, "isEnabled", () => true);
  t.mock.method(discord, "getUserFromSession", async (id: string) => ({ _id: id }) as any);
  const tokens = { access_token: "test-token", expires_in: 60000, token_type: "bearer", scope: "openid wow.profile", sub: "account" };
  const exchange = t.mock.method(service, "exchangeCode", async () => tokens);
  t.mock.method(service, "getUserInfo", async () => ({ sub: "account", id: 1, battletag: "Test#1234" }));
  const characters: IWoWCharacter[] = [{ id: 1, realmId: 1, name: "Neutral", realm: "Kazzak", realmSlug: "kazzak", class: "Monk", race: "Pandaren", level: 1, faction: "NEUTRAL", selected: false }];
  const roster = t.mock.method(service, "getWoWCharacters", async () => characters);
  const connect = t.mock.method(service, "connectBattleNetAccount", async () => ({}) as any);
  const app = express();
  app.use(session({ secret: "battlenet-callback-test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = String(req.headers["x-test-user"] || "test-user"); next(); });
  app.use("/api/auth", router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/battlenet`;
  const start = async (returnTo: string) => {
    const response = await fetch(`${base}/connect?returnTo=${encodeURIComponent(returnTo)}`);
    assert.equal(response.status, 200);
    const url = new URL((await response.json() as { url: string }).url);
    assert.equal(url.searchParams.get("scope"), "openid wow.profile");
    return url.searchParams.get("state")!;
  };
  const callback = async (state: string, query = "code=test-code", user = "test-user") => {
    const response = await fetch(`${base}/callback?state=${state}&${query}`, { redirect: "manual", headers: { "x-test-user": user } });
    assert.equal(response.status, 302);
    return new URL(response.headers.get("location")!);
  };

  for (const destination of ["/profile", "/ccg/studio"]) {
    const state = await start(destination);
    const result = await callback(state);
    assert.equal(result.pathname, destination);
    assert.equal(result.searchParams.get("connected"), "battlenet");
    assert.deepEqual(roster.mock.calls[roster.mock.callCount() - 1].arguments, ["test-token", false, 0]);
    assert.equal((connect.mock.calls[connect.mock.callCount() - 1].arguments as any[])[3], characters);
    const count = exchange.mock.callCount();
    assert.equal((await callback(state)).searchParams.get("error"), "invalid_state");
    assert.equal(exchange.mock.callCount(), count, "OAuth state cannot be reused");

    for (const code of ["BATTLENET_PERMISSION_REQUIRED", "BATTLENET_PROFILE_ACCESS_DENIED", "BATTLENET_PROFILE_UNAVAILABLE", "BATTLENET_RECONNECT_REQUIRED", "BATTLENET_UNAVAILABLE"]) {
      exchange.mock.mockImplementationOnce(async () => { throw new BattleNetSyncError(code, 409, "Test failure"); });
      const before = connect.mock.callCount();
      const failed = await callback(await start(destination));
      assert.equal(failed.pathname, destination);
      assert.equal(failed.searchParams.get("error"), code.toLowerCase());
      assert.equal(connect.mock.callCount(), before, "Failed authorization must not change the saved connection");
    }
    const denied = await callback(await start(destination), "error=access_denied");
    assert.equal(denied.pathname, destination);
    assert.equal(denied.searchParams.get("error"), "battlenet_permission_required");
    connect.mock.mockImplementationOnce(async () => { throw new Error("This Battle.net account is already connected to another user"); });
    const duplicate = await callback(await start(destination));
    assert.equal(duplicate.pathname, destination);
    assert.equal(duplicate.searchParams.get("error"), "battlenet_already_linked");
  }
  const before = exchange.mock.callCount();
  assert.equal((await callback(await start("/ccg/studio"), "code=test-code", "another-user")).searchParams.get("error"), "invalid_state");
  assert.equal(exchange.mock.callCount(), before, "Callback must belong to the initiating session");
  assert.equal((await callback(await start("https://example.com"))).pathname, "/profile", "Return destination is allowlisted");
});
