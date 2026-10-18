import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type twitchService from "../src/services/twitch.service";

const logger = { info() {}, warn() {}, error() {} };
function loadService(filename: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, "../src/services", filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports: { default?: unknown } = {};
  runInNewContext(compiled, {
    exports, URLSearchParams, Error,
    process: { env: { TWITCH_CLIENT_ID: "test-client", TWITCH_CLIENT_SECRET: "test-secret" } },
    require(name: string) { return dependencies[name] || {}; },
  });
  return exports.default;
}

function response(status: number, body: unknown = {}) {
  return { status, ok: status >= 200 && status < 300, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) };
}
const token = (value: string) => response(200, { access_token: value, expires_in: 3600 });
const live = response(200, { data: [{ user_login: "streamer", user_id: "1", id: "stream-1", type: "live", game_name: "World of Warcraft", started_at: "2026-10-18T16:00:00Z" }] });

function fixture(responses: Array<ReturnType<typeof response> | Error>) {
  const calls: Array<{ url: string; authorization?: string }> = [];
  const service = loadService("twitch.service.ts", {
    "../utils/logger": logger,
    "node-fetch": async (url: string, options: { headers: Record<string, string> }) => {
      calls.push({ url, authorization: options.headers.Authorization });
      const next = responses.shift();
      assert.ok(next, `Unexpected request: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
  }) as typeof twitchService;
  return { service, calls };
}

test("replaces a rejected cached token, retries once, and caches the replacement", async () => {
  const { service, calls } = fixture([token("old"), live, response(401), token("new"), live, live]);
  await service.getStreamStatus(["Streamer"]);
  const statuses = await service.getStreamStatus(["Streamer", "offline"]);
  assert.equal(statuses.get("streamer")?.isLive, true);
  assert.equal(statuses.get("streamer")?.isPlayingWoW, true);
  assert.equal(statuses.get("offline")?.isLive, false);
  await service.getStreamStatus(["Streamer"]);
  assert.deepEqual(calls.map(call => call.authorization), [undefined, "Bearer old", "Bearer old", undefined, "Bearer new", "Bearer new"]);
});

test("stops after a second 401 and discards the rejected replacement token", async () => {
  const { service, calls } = fixture([token("old"), response(401), token("rejected"), response(401), token("valid"), live]);
  await assert.rejects(service.getStreamStatus(["streamer"]), /Twitch API error: 401/);
  assert.equal(calls.length, 4);
  assert.equal((await service.getStreamStatus(["streamer"])).get("streamer")?.isLive, true);
  assert.equal(calls[5].authorization, "Bearer valid");
});

for (const failure of [response(500), response(429), new Error("network failure")]) {
  test(`propagates ${failure instanceof Error ? "network" : failure.status} failures instead of reporting offline`, async () => {
    const { service, calls } = fixture([token("valid"), failure]);
    await assert.rejects(service.getStreamStatus(["streamer"]));
    assert.equal(calls.length, 2);
  });
}

test("propagates token acquisition failure after 401", async () => {
  const { service, calls } = fixture([token("old"), response(401), response(400)]);
  await assert.rejects(service.getStreamStatus(["streamer"]), /Failed to get Twitch access token: 400/);
  assert.equal(calls.length, 3);
});

test("successful empty stream response still marks channels offline", async () => {
  const { service } = fixture([token("valid"), response(200, { data: [] })]);
  const statuses = await service.getStreamStatus(["Streamer"]);
  assert.equal(statuses.get("streamer")?.isLive, false);
  assert.equal(statuses.get("streamer")?.isPlayingWoW, false);
});

for (const [name, request] of [
  ["recent archives", (service: typeof twitchService) => service.getRecentArchiveVideos("1")],
  ["historical archives", (service: typeof twitchService) => service.getArchiveVideosSince("1", new Date())],
  ["videos by ID", (service: typeof twitchService) => service.getVideosByIds(["1"])],
  ["users", (service: typeof twitchService) => service.getUsersByLogins(["streamer"])],
] as const) {
  test(`${name} recovers from a rejected app token`, async () => {
    const { service, calls } = fixture([token("old"), response(401), token("new"), response(200, { data: [] })]);
    await request(service);
    assert.equal(calls.length, 4);
    assert.equal(calls[3].authorization, "Bearer new");
  });
}

test("scheduler preserves stored live status and records failure when Twitch is unavailable", async () => {
  const { service } = fixture([token("valid"), response(503)]);
  const streamer = { channelName: "streamer", isLive: true, isPlayingWoW: true };
  const failures: string[] = [];
  let writes = 0;
  let completions = 0;
  const scheduler = loadService("scheduler.service.ts", {
    "../utils/logger": logger,
    "./twitch.service": service,
    "../models/Guild": {
      find: async () => [{ _id: "guild", streamers: [streamer] }],
      updateOne: async () => { writes++; },
    },
    "./task-tracker.service": {
      start: async () => "task",
      complete: async () => { completions++; },
      fail: async (_id: string, message: string) => { failures.push(message); },
    },
  }) as { updateTwitchStreamStatus(): Promise<void>; isUpdatingTwitchStreams: boolean };
  await scheduler.updateTwitchStreamStatus();
  assert.equal(writes, 0);
  assert.equal(streamer.isLive, true);
  assert.equal(completions, 0);
  assert.deepEqual(failures, ["Twitch API error: 503 503"]);
  assert.equal(scheduler.isUpdatingTwitchStreams, false);
});
