import assert from "node:assert/strict";
import test from "node:test";
import { billedProjectCost } from "../src/features/ai-usage/ai-billing";
import { priceUsage } from "../src/features/ai-usage/pricing";

const raw = { input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100,
  cache_write_tokens_details: { ttl_12h_tokens: 20 } }, output_tokens: 150, output_tokens_details: { reasoning_tokens: 100 } };
const model = "gpt-6-luna", host = "api.openai.com";

test("cost uses separate input, cache read, 30m write, 12h write and output rates", () => {
  const expected = { inputTokens: 1000, cachedInputTokens: 200, cacheWriteTokens: 100,
    outputTokens: 150, reasoningTokens: 100, totalTokens: 1150, costNanoUsd: 162_000 };
  assert.deepEqual(priceUsage(raw, model, false, "default", host), expected);
  assert.deepEqual(priceUsage(raw, model, true, "default", host), { ...expected, costNanoUsd: 87_000 });
  assert.equal(priceUsage(raw, model + "-2026-11-01", false, "fast", "eu.api.openai.com")?.costNanoUsd, 356_400);
  assert.equal(priceUsage(raw, model, false, "flex", host)?.costNanoUsd, 81_000);
});

test("long-context rates start above 272K input and missing prices preserve reported tokens", () => {
  const usage = { input_tokens: 272_000, output_tokens: 2 };
  assert.equal(priceUsage(usage, model, false, "default", host)?.costNanoUsd, 27_201_000);
  assert.equal(priceUsage({ ...usage, input_tokens: 272_001 }, model, false, "default", host)?.costNanoUsd, 54_401_700);
  const other = priceUsage(usage, "unpriced-model", false, "default", host);
  assert.equal(other?.costNanoUsd, null);
  assert.equal(other?.totalTokens, 272_002);
  assert.equal(priceUsage(usage, model, false, "unknown", host)?.costNanoUsd, null);
  assert.equal(priceUsage({}, model, false, "default", host), null);
  assert.equal(priceUsage({ input_tokens: 0, output_tokens: 0 }, model, false, "default", host)?.costNanoUsd, 0);
});

test("billing is opt-in, project-scoped, paginated, cached, and distinguishes errors from zero", async t => {
  const { OPENAI_ADMIN_KEY: key, OPENAI_BILLING_PROJECT_ID: project } = process.env;
  const requests: URL[] = [], start = new Date("2026-10-01T00:00:00Z");
  t.after(() => {
    if (key === undefined) delete process.env.OPENAI_ADMIN_KEY; else process.env.OPENAI_ADMIN_KEY = key;
    if (project === undefined) delete process.env.OPENAI_BILLING_PROJECT_ID; else process.env.OPENAI_BILLING_PROJECT_ID = project;
  });
  delete process.env.OPENAI_ADMIN_KEY;
  const mock = t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-billing-key");
    assert.equal(url.origin + url.pathname, "https://api.openai.com/v1/organization/costs");
    assert.ok([...url.searchParams.values()].includes("proj_test"));
    const second = url.searchParams.get("page") === "page-2";
    return Response.json({ object: "page", has_more: !second, next_page: second ? null : "page-2",
      data: [{ results: [{ object: "organization.costs.result", amount: { currency: "usd", value: second ? 0.25 : 0.5 } }] }] });
  });
  assert.deepEqual(await billedProjectCost(start, 7), { status: "unconfigured" });
  assert.equal(requests.length, 0);
  process.env.OPENAI_ADMIN_KEY = "test-billing-key";
  process.env.OPENAI_BILLING_PROJECT_ID = "proj_test";
  const actual = await Promise.all([billedProjectCost(start, 7), billedProjectCost(start, 7)]);
  assert.deepEqual(actual, Array(2).fill({ status: "available", usd: 0.75 }));
  assert.equal(requests.length, 2);
  mock.mock.mockImplementation(async () => Response.json({}, { status: 403 }));
  assert.deepEqual(await billedProjectCost(new Date("2026-10-02T00:00:00Z"), 7), { status: "unavailable" });
  mock.mock.mockImplementation(async () => Response.json({ data: [], has_more: false }));
  assert.deepEqual(await billedProjectCost(new Date("2026-10-03T00:00:00Z"), 7), { status: "available", usd: 0 });
});
