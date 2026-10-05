import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test, { TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import express, { RequestHandler } from "express";
import ts from "typescript";
import { deferred } from "./helpers/snapshot-cache";

const entrypoint = path.join(__dirname, "../src/index.ts");
const compiled = ts.transpileModule(readFileSync(entrypoint, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

// Exercise the real entrypoint and HTTP health routes without opening database
// connections, loading local credentials, or starting external background jobs.
function boot(t: TestContext, mode: "api" | "both", failWarmup = false) {
  const warmup = deferred<void>();
  const warmupStarted = deferred<void>();
  const warmupFinished = deferred<"completed" | "failed">();
  const backgroundFinished = deferred<void>();
  const servers: Server[] = [];
  const errors: unknown[][] = [];
  let listeningWhenWarmupStarted = false;
  let warmupRuns = 0;
  const noop = async () => {};
  const middleware: RequestHandler = (_req, _res, next) => next();
  const expressFactory = Object.assign(() => {
    const app = express();
    const listen = app.listen.bind(app);
    app.listen = ((_port: unknown, callback: () => void) => {
      const server = listen(0, "127.0.0.1", callback);
      servers.push(server);
      return server;
    }) as typeof app.listen;
    return app;
  }, express);
  const dependencies: Record<string, unknown> = {
    dotenv: { config() {} },
    express: expressFactory,
    cors: () => middleware,
    "cookie-parser": () => middleware,
    "express-session": () => middleware,
    "connect-mongo": { create() {} },
    path,
    "./utils/logger": {
      info(message: string) {
        if (message.includes("Background initialization complete")) backgroundFinished.resolve();
      },
      warn() {},
      error(...args: unknown[]) { errors.push(args); },
    },
    "./config/database": noop,
    "./config/ccg": { CCG_FEATURE_ENABLED: false },
    "./services/cache.service": { initialize: noop },
    "./services/pickem.service": { ensureCcgRewardDefaults: noop },
    "./services/ccg-guest-persistence-migration.service": { ensurePersistentCcgGuests: noop },
    "./services/ccg-ownership-migration.service": { ensureCcgSeriesOwnershipMigration: noop },
    "./services/ccg-pack-migration.service": { assertCcgUnifiedPacksReady: noop },
    "./services/ccg-antorus-finish-migration.service": { assertCcgAntorusFinishReady: noop },
    "./services/ccg-character-identity.service": { reconcileAll: noop },
    "./services/ccg-publisher.service": { ensureConfiguredSets: noop },
    "./middleware/analytics.middleware": { analyticsMiddleware: middleware, flushAnalytics: noop },
    "./services/avoidable-damage.service": {
      async warmLeaderboardCaches() {
        warmupRuns++;
        listeningWhenWarmupStarted = servers.some((server) => server.listening);
        warmupStarted.resolve();
        await warmup.promise;
        if (failWarmup) throw new Error("fixture warmup failure");
      },
    },
    "./services/task-tracker.service": {
      async start(task: string) { return task; },
      async complete(task: string) {
        if (task === "Startup: Warm mechanic caches") warmupFinished.resolve("completed");
      },
      async fail(task: string) {
        if (task === "Startup: Warm mechanic caches") warmupFinished.resolve("failed");
      },
    },
    "./services/blizzard.service": { initializeIfNeeded: noop, retryMissingBossIcons: noop },
    "./services/guild.service": {
      syncRaidsFromWCL: noop, initializeGuilds: noop, syncGuildConfigData: noop,
      recalculateExistingGuildStatistics: noop, migrateGuildsWarcraftLogsId: noop,
    },
    "./services/guild-log-source.service": { ensurePrimarySourcesForAllGuilds: noop },
    "./services/scheduler.service": { start() {}, ensureGuildNetworkSnapshotOnStartup: noop },
    "./features/reporter/reporter-scheduler.service": { start() {} },
    "./services/background-guild-processor.service": { start() {} },
    "./services/full-history-refresh.service": { start() {} },
    "./services/discord-bot.service": { registerCommands: noop, startEventPublisher() {} },
    "./services/twitch-chat-bot.service": { start() {} },
    "./services/cache-warmer.service": { warmAllCaches: () => warmup.promise },
  };
  const startup = runInNewContext(compiled, {
    exports: {},
    __dirname: path.dirname(entrypoint),
    process: {
      env: { WORKER_MODE: mode, NODE_ENV: "test" },
      on() {},
      exit(code: number) { assert.fail(`Startup exited with ${code}: ${errors.flat().join(" ")}`); },
    },
    require(name: string) {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
      if (name.startsWith("./routes/") || name.endsWith(".routes")) return express.Router();
      throw new Error(`Unexpected startup dependency: ${name}`);
    },
  }, { filename: entrypoint }) as Promise<void>;
  t.after(async () => {
    warmup.resolve();
    await startup;
    if (mode === "both") await backgroundFinished.promise;
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
  });
  return {
    startup, warmup, warmupStarted, warmupFinished, backgroundFinished, errors,
    get warmupRuns() { return warmupRuns; },
    get listeningWhenWarmupStarted() { return listeningWhenWarmupStarted; },
    get url() { return `http://127.0.0.1:${(servers[0].address() as AddressInfo).port}`; },
  };
}

for (const mode of ["api", "both"] as const) {
  test(`${mode} mode serves HTTP while startup mechanic warming is still pending`, { timeout: 5000 }, async (t) => {
    const server = boot(t, mode);
    await server.warmupStarted.promise;
    assert.equal(server.listeningWhenWarmupStarted, true, "warmup must start after the HTTP listener");
    await server.startup;

    const health = await fetch(`${server.url}/health${mode === "api" ? "?strict=true" : ""}`);
    assert.equal(health.status, 200, "pending warmup must not prevent HTTP service or API-only readiness");
    assert.equal((await health.json() as { startupStatus: string }).startupStatus, mode === "api" ? "ready" : "initializing");
    const pending = await fetch(`${server.url}/health/startup`).then((response) => response.json()) as { completedTasks: string[] };
    assert.ok(!pending.completedTasks.includes("Warm mechanic caches"));

    server.warmup.resolve();
    assert.equal(await server.warmupFinished.promise, "completed");
    if (mode === "both") await server.backgroundFinished.promise;
    const ready = await fetch(`${server.url}/health?strict=true`);
    assert.equal(ready.status, 200);
    await ready.json();
    const completed = await fetch(`${server.url}/health/startup`).then((response) => response.json()) as { completedTasks: string[] };
    assert.ok(completed.completedTasks.includes("Warm mechanic caches"));
    assert.equal(server.warmupRuns, 1);
    assert.deepEqual(server.errors, []);
  });
}

test("a background mechanic warmup failure is recorded without taking the API out of service", { timeout: 5000 }, async (t) => {
  const server = boot(t, "api", true);
  await server.warmupStarted.promise;
  await server.startup;
  server.warmup.resolve();
  assert.equal(await server.warmupFinished.promise, "failed");
  const health = await fetch(`${server.url}/health?strict=true`);
  assert.equal(health.status, 200);
  await health.json();
  const status = await fetch(`${server.url}/health/startup`).then((response) => response.json()) as {
    failedTasks: { task: string; error: string }[];
  };
  assert.equal(status.failedTasks.length, 1);
  assert.equal(status.failedTasks[0].task, "Warm mechanic caches");
  assert.match(status.failedTasks[0].error, /fixture warmup failure/);
  assert.ok(server.errors.some((args) => String(args[0]).includes("fixture warmup failure")));
});
