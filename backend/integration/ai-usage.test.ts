/// <reference path="../src/types/express-session.d.ts" />
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import OpenAI from "openai";
import { AiCall, meteredFetch } from "../src/features/ai-usage/ai-usage";

const uri = process.env.AI_USAGE_TEST_MONGODB_URI;
test("HTTP attempts, background billing, admin access, filtering and pagination", { skip: !uri }, async t => {
  process.env.BLIZZARD_CLIENT_ID ??= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ??= "test-secret";
  const { aiUsageRouter, usageReport } = await import("../src/features/ai-usage/ai-usage.routes");
  const { default: discord } = await import("../src/services/discord.service");
  await mongoose.connect(uri!, { dbName: "ai_usage_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  await AiCall.init();
  assert.equal((await usageReport(7, 1)).totals.calls, 0);

  const model = "gpt-6-luna", options = { model, input: "private prompt" };
  let count = 0;
  const client = new OpenAI({ apiKey: "private-key", maxRetries: 0,
    fetch: meteredFetch("namegame", model, async () => {
      const status = ["queued", "in_progress", "completed", "completed"][count++];
      return Response.json({ object: "response", id: "resp_original", model, status, output: [],
        usage: status === "completed" ? { input_tokens: 200, output_tokens: 25, output_tokens_details: { reasoning_tokens: 20 } } : null,
      }, { headers: { "x-request-id": "req_" + count } });
    }),
  });
  await client.responses.create({ ...options, background: true });
  await client.responses.retrieve("resp_original");
  assert.equal((await usageReport(7, 1, "namegame")).totals.unpriced, 1);
  await Promise.all([client.responses.retrieve("resp_original"), client.responses.retrieve("resp_original")]);
  const decision = meteredFetch("guildLanguage", model, async () => Response.json({ answers: ["private answer"], model,
    usage: { input_tokens: 100, output_tokens: 8, output_tokens_details: { reasoning_tokens: 4 },
      input_tokens_details: { cached_tokens: 10, cache_write_tokens: 6, cache_write_tokens_details: { ttl_12h_tokens: 2 } } },
  }, { headers: { "x-request-id": "req_decision" } }));
  const res = await decision("https://api.openai.com/v1/decisions", { method: "POST" });
  assert.deepEqual((await res.json() as { answers: string[] }).answers, ["private answer"]);
  const fail = meteredFetch("reporterEn", model, async () => Response.json({ error: { message: "private failure" } }, { status: 429 }));
  await fail("https://api.openai.com/v1/responses", { method: "POST" });
  const timeout = meteredFetch("twitchCurse", model, async () => { throw new Error("private timeout"); });
  await assert.rejects(timeout("https://api.openai.com/v1/responses", { method: "POST" }), /private timeout/);

  const summary = await usageReport(7, 1);
  assert.deepEqual(summary.totals, { calls: 7, polls: 3, failures: 2, unpriced: 2, inputTokens: 300, outputTokens: 33,
    cachedInputTokens: 10, cacheWriteTokens: 6, reasoningTokens: 24, totalTokens: 333, costNanoUsd: 42_000 });
  assert.equal(summary.calls.find(c => c.endpoint === "decisions")?.cacheWrite12hTokens, 2);
  assert.equal(summary.byFeature[0]._id, "namegame");
  const original = summary.calls.find(c => c._id === "resp_original");
  assert.equal(original?.requestId, "req_1");
  assert.equal(original?.status, "completed");
  assert.equal(original?.costNanoUsd, 32_500);
  assert.equal(summary.calls.filter(c => c.endpoint === "poll" && c.costNanoUsd === 0).length, 3);
  assert.doesNotMatch(JSON.stringify(summary), /private/);

  // Cross midnight UTC and both sides of the page boundary with deterministic entries.
  const midnight = new Date("2025-01-02T00:00:00Z");
  await AiCall.insertMany(Array.from({ length: 27 }, (_, i) => ({ _id: "history_" + i, at: new Date(midnight.getTime() + i - 1),
    feature: "supporterArt", endpoint: "responses", status: "completed", costNanoUsd: 0 })));
  const end = new Date("2025-01-02T12:00:00Z");
  const [p1, p2] = await Promise.all([usageReport(1, 1, "supporterArt", end), usageReport(1, 2, "supporterArt", end)]);
  assert.equal(p1.totals.calls, 26);
  assert.equal(p1.calls.length, 25);
  assert.deepEqual(p2.calls.map(c => c._id), ["history_1"]);
  assert.equal((await usageReport(7, 1, "guildLanguage")).totals.calls, 1);

  t.mock.method(discord, "getUserFromSession", async (id: string) => ({ discord: { username: id } }));
  t.mock.method(discord, "isAdmin", (id: string) => id === "admin");
  const app = express();
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = req.get("x-test-user"); next(); });
  app.use("/api/admin/ai-usage", aiUsageRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api/admin/ai-usage";
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { "x-test-user": "member" } })).status, 403);
  const admin = { headers: { "x-test-user": "admin" } };
  for (const invalid of ["days=2", "page=0", "feature=bad"]) assert.equal((await fetch(url + "?" + invalid, admin)).status, 400);
  const report = await fetch(url + "?days=7&feature=namegame", admin);
  assert.equal(report.status, 200);
  assert.match(report.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal((await report.json() as typeof summary).totals.calls, 4);
});
