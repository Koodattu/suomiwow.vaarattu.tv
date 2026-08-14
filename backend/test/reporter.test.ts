/// <reference path="../src/types/express-session.d.ts" />

import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import session from "express-session";
import { REPORTER_CONFIG } from "../src/features/reporter/reporter.config";
import { calculateReporterUsage, combineReporterUsage, getReporterEditorialFactPack, getReporterLinks, getReporterPromptFacts, repairReporterLinkTokens, validateReporterContent, validateReporterLocaleContent } from "../src/features/reporter/reporter-content";
import { generateReporterContent, ReporterOpenAIError } from "../src/features/reporter/reporter-openai";
import { ReporterPost, ReporterSettings } from "../src/features/reporter/reporter.models";
import { DEFAULT_REPORTER_SETTINGS, shouldAutoPublishReporterPost } from "../src/features/reporter/reporter-settings.service";
import reporterService, { buildReporterFacts } from "../src/features/reporter/reporter.service";
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
  const body = `[[${linkRef}|Example Guild]] ${"reported steady progress this week ".repeat(60)}`.trim();
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

test("Reporter usage combines every Finnish-first generation request", () => {
  const first = calculateReporterUsage({ input_tokens: 500, output_tokens: 200, total_tokens: 700 });
  const second = calculateReporterUsage({ input_tokens: 300, output_tokens: 100, total_tokens: 400 });
  const combined = combineReporterUsage(first, second);

  assert.equal(combined.inputTokens, 800);
  assert.equal(combined.outputTokens, 300);
  assert.equal(combined.totalTokens, 1_100);
  assert.equal(combined.estimatedCostUsd, Number((first.estimatedCostUsd + second.estimatedCostUsd).toFixed(8)));
});

test("Reporter content accepts known inline links and rejects invented references", () => {
  assert.doesNotThrow(() => validateReporterContent(validContent(), facts));
  assert.throws(() => validateReporterContent(validContent("L999"), facts), /unknown link L999/);
  assert.deepEqual(getReporterLinks(facts), { L1: { url: "/guilds/example/example", kind: "guild" } });
});

test("Reporter treats Finnish style and link coverage preferences as non-fatal", () => {
  const article = validContent().fi;
  const imperfectBody = article.body.replace("reported", "reached 27,9 prosenttia, then repeated 0.1%, 0.1% and 0.1% before reporting");
  const unlinkedBody = article.body.replace("[[L1|Example Guild]]", "Example Guild");

  assert.doesNotThrow(() => validateReporterLocaleContent({ ...article, body: imperfectBody }, "fi", facts));
  assert.doesNotThrow(() => validateReporterLocaleContent({ ...article, body: unlinkedBody }, "fi", facts));
});

test("Reporter separates lead candidates from supporting developments and background", () => {
  const factPack = getReporterEditorialFactPack([
    { ...facts[0], kind: "progress_trajectory" },
    { ...facts[0], id: "F2", kind: "boss_benchmark" },
    { ...facts[0], id: "F3", kind: "reclear_roundup" },
    { ...facts[0], id: "F4", kind: "player_leaderboard_context" },
  ]);

  assert.deepEqual(factPack.leadCandidates.map((fact) => fact.id), ["F1"]);
  assert.deepEqual(factPack.supportingDevelopments.map((fact) => fact.id), ["F2", "F3"]);
  assert.deepEqual(factPack.background.map((fact) => fact.id), ["F4"]);
});

test("Reporter consolidates progress and reclears while naming raids in player and hiatus facts", () => {
  const raidName = "VS / DR / MQD";
  const periodEnd = new Date("2026-08-10T12:00:00Z");
  const progress = {
    raidId: 46,
    raidName,
    iconUrl: "raid.jpg",
    difficulty: "mythic" as const,
    bossesDefeated: 8,
    totalBosses: 9,
    bosses: [
      {
        bossId: 101,
        bossName: "Midnight Falls",
        iconUrl: "boss.jpg",
        kills: 0,
        bestPercent: 15.1,
        pullCount: 396,
        bestPullReportCode: "REPORT",
        bestPullFightId: 17,
        totalPhases: 4,
        bestPullPhase: {
          phaseId: 4,
          phaseName: "Stage Three: Midnight Falls",
          bossHealth: 0.1,
          fightCompletion: 15.1,
          displayString: "0.1% Stage Three: Midnight Falls",
        },
      },
    ],
  };
  const event = (type: string, guildName: string, timestamp: string, data: Record<string, unknown>, bossId = 101, bossName = "Midnight Falls") => ({
    type,
    guildId: guildName === "Kaaos" ? "kaaos" : guildName.toLowerCase(),
    guildName,
    guildRealm: "Stormreaver",
    raidId: 46,
    raidName,
    bossId,
    bossName,
    difficulty: "mythic",
    data,
    timestamp: new Date(timestamp),
  });
  const factInput = {
    currentGuilds: [{ guildId: "kaaos", name: "Kaaos", realm: "Argent-Dawn", progress: [progress] }],
    previousGuilds: [],
    currentPlayers: [
      {
        category: "dps",
        rank: 1,
        name: "Chijing",
        realm: "Stormreaver",
        classId: 10,
        role: "dps",
        specName: "windwalker",
        score: 1058.7,
      },
    ],
    previousPlayers: [],
    pickems: [],
    raids: [
      {
        id: 46,
        name: raidName,
        iconUrl: "raid.jpg",
        starts: { eu: new Date("2026-03-18T04:00:00Z") },
        ends: { eu: new Date("2026-12-17T04:00:00Z") },
        bosses: [
          { id: 101, name: "Midnight Falls", iconUrl: "boss.jpg" },
          { id: 102, name: "Crown of the Cosmos", iconUrl: "crown.jpg" },
        ],
      },
    ],
    raidAnalytics: [
      {
        raidId: 46,
        bosses: [{ bossId: 101, bossName: "Midnight Falls", guildsKilled: 8, pullCount: { average: 248, lowest: 103, highest: 421 } }],
      },
    ],
    mythicPlus: {
      seasonSlug: "midnight-season-2",
      seasonName: "Midnight Season 2",
      leaders: [{ rank: 1, name: "Keymaster", realm: "Stormreaver", classId: 10, score: 3210.4, specName: "windwalker" }],
    },
    events: [
      event("best_pull", "Kaaos", "2026-08-09T20:00:00Z", { bestPercent: 15.1, pullCount: 396, progressDisplay: "0.1% Stage Three: Midnight Falls" }),
      event("reproge", "Slack", "2026-08-09T19:00:00Z", {}, 102, "Crown of the Cosmos"),
      event("reproge", "Noni", "2026-08-09T18:00:00Z", {}),
      event("hiatus", "Tuju", "2026-08-09T17:00:00Z", { hiatusDays: 30 }),
      event("best_pull", "Kaaos", "2026-08-08T20:00:00Z", { bestPercent: 52.9, pullCount: 323, progressDisplay: "44.5% Stage Three: Midnight Falls" }),
    ],
    periodStart: new Date("2026-08-03T12:00:00Z"),
    periodEnd,
  };
  const reporterFacts = buildReporterFacts(factInput as any);

  const trajectory = reporterFacts.find((fact) => fact.kind === "progress_trajectory");
  const reclears = reporterFacts.find((fact) => fact.kind === "reclear_roundup");
  const hiatus = reporterFacts.find((fact) => fact.kind === "hiatus");
  const player = reporterFacts.find((fact) => fact.kind === "player_leaderboard_context");
  const benchmark = reporterFacts.find((fact) => fact.kind === "boss_benchmark");
  const mythicPlus = reporterFacts.find((fact) => fact.kind === "mythic_plus_leaderboard_context");
  assert.match(trajectory?.summary || "", /52\.9% overall fight progress remaining at 323 total pulls; 15\.1% overall fight progress remaining at 396 total pulls/);
  assert.match(trajectory?.summary || "", /15\.1% overall fight progress remained.*boss health was 0\.1%.*P3 of 4.*P3 was not the final phase; P4, the final phase, remained/i);
  assert.doesNotMatch(trajectory?.summary || "", /P4 of 5/);
  assert.equal(reporterFacts.filter((fact) => fact.kind === "progress_trajectory").length, 1);
  assert.match(benchmark?.summary || "", /average first-kill total of 248 pulls.*range of 103-421.*396 total recorded pulls without a kill/i);
  assert.match(reclears?.summary || "", /2 tracked guild-boss reclears/);
  assert.doesNotMatch(reclears?.summary || "", /2 bosses/);
  assert.ok(reclears?.links.some((link) => link.kind === "boss" && link.label === "Crown of the Cosmos" && link.visual?.iconUrl === "crown.jpg"));
  assert.ok(reclears?.links.some((link) => link.kind === "boss" && link.label === "Midnight Falls" && link.visual?.iconUrl === "boss.jpg"));
  assert.equal(
    getReporterPromptFacts([reclears!])[0].links.find((link) => link.label === "Crown of the Cosmos")?.presentationHint,
    "boss-icon",
  );
  assert.ok(hiatus?.links.some((link) => link.label === raidName && link.visual?.iconUrl === "raid.jpg"));
  assert.match(player?.summary || "", new RegExp(raidName.replaceAll("/", "\\/")));
  assert.doesNotMatch(player?.summary || "", /raid 46/);
  assert.ok(player?.links.some((link) => link.url === "/tierlists/characters"));
  assert.match(mythicPlus?.summary || "", /Midnight Season 2.*Keymaster.*3210\.4.*not a claimed weekly change/i);
  assert.ok(mythicPlus?.links.some((link) => link.url === "/characters?tab=mythic-plus"));

  delete (progress.bosses[0].bestPullPhase as any).fightCompletion;
  delete (progress.bosses[0].bestPullPhase as any).bossHealth;
  const partialSnapshotFacts = buildReporterFacts(factInput as any);
  const partialTrajectory = partialSnapshotFacts.find((fact) => fact.kind === "progress_trajectory");
  assert.match(partialTrajectory?.summary || "", /latest best reached P3 of 4.*P4, the final phase, remained/i);
});

test("Reporter repairs malformed known link tokens and degrades unknown tokens to plain text", () => {
  const source = validContent();
  const broken = {
    ...source.fi,
    body: `[[ L1 | Example Guild] ${"reported steady progress this week ".repeat(60)} [[L999|Unknown target]] [[unfinished note]]`.trim(),
  };
  const repaired = repairReporterLinkTokens(broken, facts);

  assert.match(repaired.body, /\[\[L1\|Example Guild\]\]/);
  assert.doesNotMatch(repaired.body, /L999|\[\[unfinished/);
  assert.doesNotThrow(() => validateReporterContent({ en: { ...source.en, body: repaired.body }, fi: repaired }, facts));
});

test("Reporter unwraps Markdown mistakenly placed around an inline Reporter link", () => {
  const source = validContent();
  const wrapped = {
    ...source.fi,
    body: `[Kaaokselle]([[L1|Example Guild]]) ${"reported steady progress this week ".repeat(60)}`.trim(),
  };
  const repaired = repairReporterLinkTokens(wrapped, facts);

  assert.match(repaired.body, /^\[\[L1\|Kaaokselle\]\]/);
  assert.doesNotMatch(repaired.body, /\[Kaaokselle\]\(/);
  assert.doesNotThrow(() => validateReporterLocaleContent(repaired, "fi", facts));
});

test("Reporter keeps trusted visual data out of the prompt while exposing presentation hints", () => {
  const visualFacts: ReporterFact[] = [
    {
      ...facts[0],
      links: [
        {
          ...facts[0].links[0],
          label: "Example Boss log",
          url: "https://www.warcraftlogs.com/reports/example#fight=1",
          kind: "log",
          visual: { type: "icon", iconUrl: "example-boss.jpg", provider: "wcl" },
        },
      ],
    },
  ];

  assert.deepEqual(getReporterLinks(visualFacts), {
    L1: {
      url: "https://www.warcraftlogs.com/reports/example#fight=1",
      kind: "log",
      visual: { type: "icon", iconUrl: "example-boss.jpg", provider: "wcl" },
    },
  });
  assert.equal("visual" in getReporterPromptFacts(visualFacts)[0].links[0], false);
  assert.equal(getReporterPromptFacts(visualFacts)[0].links[0].presentationHint, "boss-icon-with-wcl");

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

test("Reporter does not discard usable copy when optional visual links are omitted", () => {
  const visualFacts: ReporterFact[] = [
    {
      id: "F1",
      kind: "best_pull",
      summary: "Example Guild reached Example Boss.",
      links: [
        {
          ref: "L1",
          label: "Example Guild",
          url: "/guilds/example/example",
          kind: "guild",
          visual: {
            type: "guild-crest",
            crest: {
              emblem: { id: 1, imageName: "emblem.png", color: { r: 1, g: 2, b: 3, a: 1 } },
              border: { id: 1, imageName: "border.png", color: { r: 1, g: 2, b: 3, a: 1 } },
              background: { color: { r: 1, g: 2, b: 3, a: 1 } },
            },
          },
        },
        {
          ref: "L2",
          label: "Example Boss log",
          url: "https://www.warcraftlogs.com/reports/example#fight=1",
          kind: "log",
          visual: { type: "icon", iconUrl: "example-boss.jpg", provider: "wcl" },
        },
      ],
    },
    {
      id: "F2",
      kind: "player_leaderboard_context",
      summary: "Example Player is rank 1.",
      links: [
        {
          ref: "L3",
          label: "Example Player",
          url: "/characters/example/example-player",
          kind: "character",
          visual: { type: "icon", iconUrl: "class-icon.jpg" },
        },
        {
          ref: "L4",
          label: "Example Raid",
          url: "/raid-analytics",
          kind: "analytics",
          visual: { type: "icon", iconUrl: "raid-icon.jpg" },
        },
      ],
    },
  ];
  const prose = "reported steady progress this week ".repeat(60);
  const completeBody = `[[L1|Example Guild]] reached [[L2|Example Boss]] in [[L4|Example Raid]], while [[L3|Example Player]] led the player note. ${prose}`;
  const missingBossBody = `[[L1|Example Guild]] reported progress in [[L4|Example Raid]], while [[L3|Example Player]] led the player note. ${prose}`;
  const missingPlayerBody = `[[L1|Example Guild]] reached [[L2|Example Boss]] in [[L4|Example Raid]]. ${prose}`;
  const missingRaidBody = `[[L1|Example Guild]] reached [[L2|Example Boss]], while [[L3|Example Player]] led the player note. ${prose}`;

  assert.doesNotThrow(() => validateReporterLocaleContent({ ...validContent().fi, body: completeBody }, "fi", visualFacts));
  assert.doesNotThrow(() => validateReporterLocaleContent({ ...validContent().fi, body: missingBossBody }, "fi", visualFacts));
  assert.doesNotThrow(() => validateReporterLocaleContent({ ...validContent().fi, body: missingPlayerBody }, "fi", visualFacts));
  assert.doesNotThrow(() => validateReporterLocaleContent({ ...validContent().fi, body: missingRaidBody }, "fi", visualFacts));
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

test("Reporter writes Finnish first, translates it to English and totals both OpenAI requests", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const requestBodies: Array<Record<string, any>> = [];
  const generated = validContent();
  global.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    const isFinnishRequest = requestBodies.length === 1;
    return new Response(
      JSON.stringify({
        id: isFinnishRequest ? "resp_reporter_fi" : "resp_reporter_en",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(isFinnishRequest ? generated.fi : generated.en) }] }],
        usage: isFinnishRequest
          ? {
              input_tokens: 500,
              input_tokens_details: { cached_tokens: 100, cache_write_tokens: 0 },
              output_tokens: 200,
              output_tokens_details: { reasoning_tokens: 50 },
              total_tokens: 700,
            }
          : {
              input_tokens: 300,
              input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
              output_tokens: 100,
              output_tokens_details: { reasoning_tokens: 20 },
              total_tokens: 400,
            },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const previousDispatch = { title: "Edellisen viikon otsikko", summary: "Edellisen viikon tiivis mutta riittävän pitkä yhteenveto." };
    const result = await generateReporterContent({
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-08-08T00:00:00Z"),
      facts,
      previousDispatch,
    });
    const finnishRequest = requestBodies[0] as unknown as {
      model: string;
      reasoning: { effort: string };
      instructions: string;
      input: string;
      text: { verbosity: string; format: { type: string; name: string } };
      store: boolean;
    };
    const englishRequest = requestBodies[1] as typeof finnishRequest;
    assert.equal(requestBodies.length, 2);
    assert.equal(finnishRequest.model, "gpt-5.6-luna");
    assert.equal(finnishRequest.reasoning.effort, "medium");
    assert.equal(finnishRequest.text.verbosity, "low");
    assert.equal(finnishRequest.text.format.type, "json_schema");
    assert.equal(finnishRequest.text.format.name, "suomi_wow_weekly_report_fi");
    assert.equal(finnishRequest.store, false);
    assert.match(finnishRequest.instructions, /mildly pessimistic/);
    assert.match(finnishRequest.instructions, /fact pack is a menu, not a checklist/i);
    assert.match(finnishRequest.instructions, /use roughly 6-10 facts/);
    assert.match(finnishRequest.instructions, /passiivisuusmerkintä/);
    assert.match(finnishRequest.instructions, /one compact paragraph naming 2-3 players/);
    assert.match(finnishRequest.instructions, /27\.9%/);
    assert.match(finnishRequest.instructions, /boss-icon-with-wcl/);
    assert.equal(JSON.parse(finnishRequest.input).factPack.leadCandidates[0].links[0].visual, undefined);
    assert.equal(JSON.parse(finnishRequest.input).reportingAsOf.utc, "2026-08-08T00:00:00.000Z");
    assert.equal(JSON.parse(finnishRequest.input).reportingAsOf.timeZone, "Europe/Helsinki");
    assert.match(JSON.parse(finnishRequest.input).reportingAsOf.helsinkiLocal, /2026-08-08.*03[.:]00/);
    assert.deepEqual(JSON.parse(finnishRequest.input).previousDispatch, previousDispatch);
    assert.equal(englishRequest.text.format.name, "suomi_wow_weekly_report_en");
    assert.match(englishRequest.instructions, /Finnish edition is the sole source of truth/);
    assert.match(englishRequest.instructions, /Never translate, anglicize or otherwise rewrite a guild name/);
    assert.deepEqual(JSON.parse(englishRequest.input).sourceFinnish, generated.fi);
    assert.equal(JSON.parse(englishRequest.input).facts, undefined);
    assert.deepEqual(JSON.parse(englishRequest.input).canonicalEntities, [{ kind: "guild", name: "Example Guild" }]);
    assert.deepEqual(JSON.parse(englishRequest.input).sourceFacts, [{ id: "F1", kind: "boss_kill", summary: "Example Guild killed Example Boss." }]);
    assert.deepEqual(JSON.parse(englishRequest.input).availableLinks, [{ ref: "L1", label: "Example Guild", kind: "guild" }]);
    assert.equal(result.responseId, "resp_reporter_fi,resp_reporter_en");
    assert.deepEqual(result.content, generated);
    assert.equal(result.usage.inputTokens, 800);
    assert.equal(result.usage.outputTokens, 300);
    assert.equal(result.usage.totalTokens, 1_100);
    assert.equal(REPORTER_CONFIG.promptVersion, "reporter-v6");
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("Reporter retains Finnish request usage when the English translation fails", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  let requestCount = 0;
  global.fetch = (async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(
        JSON.stringify({
          id: "resp_partial_fi",
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validContent().fi) }] }],
          usage: { input_tokens: 500, output_tokens: 200, total_tokens: 700 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        id: "resp_partial_en",
        status: "failed",
        error: { message: "translation failed" },
        usage: { input_tokens: 300, output_tokens: 50, total_tokens: 350 },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      generateReporterContent({ periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-08-08T00:00:00Z"), facts }),
      (error: unknown) => {
        assert.ok(error instanceof ReporterOpenAIError);
        assert.equal(error.responseId, "resp_partial_fi,resp_partial_en");
        assert.equal(error.usage.inputTokens, 800);
        assert.equal(error.usage.outputTokens, 250);
        assert.equal(error.usage.totalTokens, 1_050);
        return true;
      },
    );
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
