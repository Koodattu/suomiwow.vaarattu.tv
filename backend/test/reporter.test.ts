/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";
import { REPORTER_CONFIG } from "../src/features/reporter/reporter.config";
import { calculateReporterUsage, getReporterLinks, getReporterPromptFacts, validateReporterContent } from "../src/features/reporter/reporter-content";
import { generateReporterContent } from "../src/features/reporter/reporter-openai";
import { ReporterPost, ReporterSettings } from "../src/features/reporter/reporter.models";
import { DEFAULT_REPORTER_SETTINGS, shouldAutoPublishReporterPost } from "../src/features/reporter/reporter-settings.service";
import reporterService from "../src/features/reporter/reporter.service";
import { ReporterFact, ReporterGeneratedContent } from "../src/features/reporter/reporter.types";

const facts: ReporterFact[] = [
  {
    id: "F1",
    kind: "boss_kill",
    summary: "Example Guild killed Example Boss.",
    links: [{ ref: "L1", label: "Example Guild", url: "/guilds/example/example", kind: "guild" }],
  },
];

function validContent(linkRef = "L1"): ReporterGeneratedContent {
  const body = `[[${linkRef}|Example Guild]] ${"reported steady progress this week ".repeat(30)}`.trim();
  return {
    en: { title: "A valid weekly report", summary: "A concise summary of the tracked weekly scene.", body },
    fi: { title: "Kelvollinen viikkoraportti", summary: "Tiivis yhteenveto seuratun viikon tapahtumista.", body },
  };
}

test("Reporter usage separates cached, cache-write, regular input and output cost", () => {
  const usage = calculateReporterUsage({
    input_tokens: 1_000_000,
    input_tokens_details: { cached_tokens: 200_000, cache_write_tokens: 100_000 },
    output_tokens: 100_000,
    output_tokens_details: { reasoning_tokens: 25_000 },
    total_tokens: 1_100_000,
  });
  const expected =
    0.7 * REPORTER_CONFIG.pricing.inputPerMillion +
    0.2 * REPORTER_CONFIG.pricing.cachedInputPerMillion +
    0.1 * REPORTER_CONFIG.pricing.cacheWritePerMillion +
    0.1 * REPORTER_CONFIG.pricing.outputPerMillion;

  assert.equal(usage.inputTokens, 1_000_000);
  assert.equal(usage.outputTokens, 100_000);
  assert.equal(usage.reasoningTokens, 25_000);
  assert.equal(usage.estimatedCostUsd, Number(expected.toFixed(8)));
});

test("Reporter content accepts known inline links and rejects invented references", () => {
  assert.doesNotThrow(() => validateReporterContent(validContent(), facts));
  assert.throws(() => validateReporterContent(validContent("L999"), facts), /unknown link L999/);
  assert.deepEqual(getReporterLinks(facts), { L1: { url: "/guilds/example/example", kind: "guild" } });
});

test("Reporter keeps trusted link visuals out of the OpenAI fact pack", () => {
  const visualFacts: ReporterFact[] = [
    {
      ...facts[0],
      links: [
        {
          ...facts[0].links[0],
          visual: { type: "icon", iconUrl: "example-boss.jpg", provider: "wcl" },
        },
      ],
    },
  ];

  assert.deepEqual(getReporterLinks(visualFacts), {
    L1: {
      url: "/guilds/example/example",
      kind: "guild",
      visual: { type: "icon", iconUrl: "example-boss.jpg", provider: "wcl" },
    },
  });
  assert.equal(getReporterPromptFacts(visualFacts)[0].links[0].visual, undefined);

  const post = new ReporterPost({
    weekKey: "2026-08-10",
    slug: "visual-link-test",
    status: "draft",
    periodStart: new Date("2026-08-03T00:00:00Z"),
    periodEnd: new Date("2026-08-10T00:00:00Z"),
    snapshotId: "507f1f77bcf86cd799439011",
    generationId: "507f1f77bcf86cd799439012",
    facts: visualFacts,
    content: validContent(),
    usage: calculateReporterUsage({}),
  });
  assert.equal(post.facts[0].links[0].visual?.iconUrl, "example-boss.jpg");
});

test("Reporter database switches default off and only scheduled runs may auto-publish", () => {
  const settings = new ReporterSettings({ key: "global" });
  assert.deepEqual(
    {
      featureEnabled: settings.featureEnabled,
      automationEnabled: settings.automationEnabled,
      autoPublish: settings.autoPublish,
    },
    DEFAULT_REPORTER_SETTINGS,
  );
  const enabled = { featureEnabled: true, automationEnabled: true, autoPublish: true };
  assert.equal(shouldAutoPublishReporterPost("admin", enabled), false);
  assert.equal(shouldAutoPublishReporterPost("cron", enabled), true);
  assert.equal(shouldAutoPublishReporterPost("cron", { ...enabled, automationEnabled: false }), false);
});

test("Reporter deletion validates the article ID before querying MongoDB", async () => {
  await assert.rejects(reporterService.deletePost("not-an-object-id"), /Invalid Reporter post ID/);
});

test("Reporter OpenAI request pins Luna, medium reasoning, low verbosity and structured output", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  let requestBody: Record<string, any> | null = null;
  global.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: "resp_reporter_test",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validContent()) }] }],
        usage: {
          input_tokens: 500,
          input_tokens_details: { cached_tokens: 100, cache_write_tokens: 0 },
          output_tokens: 200,
          output_tokens_details: { reasoning_tokens: 50 },
          total_tokens: 700,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const result = await generateReporterContent({ periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-08-08T00:00:00Z"), facts });
    const sentRequest = requestBody as unknown as {
      model: string;
      reasoning: { effort: string };
      input: string;
      text: { verbosity: string; format: { type: string } };
      store: boolean;
    };
    assert.equal(sentRequest.model, "gpt-5.6-luna");
    assert.equal(sentRequest.reasoning.effort, "medium");
    assert.equal(sentRequest.text.verbosity, "low");
    assert.equal(sentRequest.text.format.type, "json_schema");
    assert.equal(sentRequest.store, false);
    assert.equal(JSON.parse(sentRequest.input).facts[0].links[0].visual, undefined);
    assert.equal(result.responseId, "resp_reporter_test");
    assert.equal(result.usage.inputTokens, 500);
    assert.equal(result.usage.outputTokens, 200);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("Reporter admin and trigger routes reject unauthenticated requests", async () => {
  const [{ default: adminRouter }, { default: triggerRouter }] = await Promise.all([
    import("../src/features/reporter/reporter-admin.routes"),
    import("../src/features/reporter/reporter-trigger.routes"),
  ]);
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "reporter-auth-test", resave: false, saveUninitialized: false }));
  app.use("/api/admin/reporter", adminRouter);
  app.use("/api/admin/trigger/reporter", triggerRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    for (const request of [
      { method: "GET", path: "/api/admin/reporter/status" },
      { method: "GET", path: "/api/admin/reporter/posts" },
      { method: "PATCH", path: "/api/admin/reporter/settings" },
      { method: "PATCH", path: "/api/admin/reporter/posts/507f1f77bcf86cd799439011/status" },
      { method: "DELETE", path: "/api/admin/reporter/posts/507f1f77bcf86cd799439011" },
      { method: "POST", path: "/api/admin/trigger/reporter/generate" },
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${request.path}`, {
        method: request.method,
        headers: request.method === "GET" ? undefined : { "Content-Type": "application/json" },
        body: request.method === "GET" ? undefined : JSON.stringify({ status: "published" }),
      });
      assert.equal(response.status, 401, `${request.method} ${request.path} must require admin authentication`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
