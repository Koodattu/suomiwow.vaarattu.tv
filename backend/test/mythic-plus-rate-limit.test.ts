import assert from "node:assert/strict";
import test from "node:test";
import { Response } from "node-fetch";
import mythicPlusService from "../src/services/mythic-plus.service";

test("Mythic+ requests use the app bucket only when the access key is attached", async (t) => {
  const service = mythicPlusService as any;
  const originalApiKey = service.apiKey;
  const originalFetchJson = service.fetchJson;
  const calls: Array<{ url: string; bucket: string }> = [];

  t.after(() => {
    service.apiKey = originalApiKey;
    service.fetchJson = originalFetchJson;
  });

  service.apiKey = "test-key";
  service.fetchJson = async (url: string, _label: string, bucket: string) => {
    calls.push({ url, bucket });
    return { ok: true, status: 200, data: {} };
  };

  await mythicPlusService.fetchCharacterProfileScores({ name: "Maisie", realm: "Tarren Mill", region: "EU" }, ["season-test"]);
  await mythicPlusService.fetchCharacterSeasonProgress({ name: "Maisie", realm: "Tarren Mill", region: "EU" }, "season-test");
  service.apiKey = "";
  await mythicPlusService.fetchCharacterProfileScores({ name: "Maisie", realm: "Tarren Mill", region: "EU" }, ["season-test"]);

  assert.equal(calls[0].bucket, "app");
  assert.match(calls[0].url, /[?&]access_key=test-key(?:&|$)/);
  assert.equal(calls[1].bucket, "public");
  assert.doesNotMatch(calls[1].url, /[?&]access_key=/);
  assert.equal(calls[2].bucket, "public");
  assert.doesNotMatch(calls[2].url, /[?&]access_key=/);
});

test("Mythic+ fetches remain sequential across overlapping callers", async (t) => {
  const service = mythicPlusService as any;
  const originalFetchJsonSequential = service.fetchJsonSequential;
  const originalFetchQueue = service.fetchQueue;
  let active = 0;
  let maxActive = 0;
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  t.after(() => {
    service.fetchJsonSequential = originalFetchJsonSequential;
    service.fetchQueue = originalFetchQueue;
  });

  service.fetchQueue = Promise.resolve();
  service.fetchJsonSequential = async (_url: string, label: string) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (label === "first") await firstGate;
    active -= 1;
    return { ok: true, status: 200, data: {} };
  };

  const first = service.fetchJson("https://example.test/first", "first", "app");
  const second = service.fetchJson("https://example.test/second", "second", "public");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(active, 1);
  releaseFirst?.();
  await Promise.all([first, second]);
  assert.equal(maxActive, 1);
});

test("Mythic+ rate limits adapt to response headers and Retry-After", () => {
  const service = mythicPlusService as any;
  const bucket = service.rateLimitBuckets.public;
  const originalState = { ...bucket, requestTimestamps: [...bucket.requestTimestamps] };

  try {
    const response = new Response("", {
      status: 429,
      headers: {
        "Retry-After": "17",
        "X-RateLimit-Limit": "250",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil((Date.now() + 10_000) / 1000)),
      },
    });

    service.recordRateLimitHeaders("public", response);

    assert.equal(bucket.observedMaxRequestsPerMinute, 250);
    assert.equal(bucket.observedRemaining, 0);
    assert.equal(service.effectiveMaxRequestsPerMinute(bucket), 250);
    assert.equal(service.retryAfterMs(response), 17_000);
    assert.equal(service.retryAfterMs(new Response("", { status: 429 })), 60_000);
    assert.ok(bucket.blockedUntil > Date.now());
  } finally {
    Object.assign(bucket, originalState);
  }
});
