import assert from "node:assert/strict";
import test from "node:test";
import { priceUsage } from "../src/features/ai-usage/pricing";

const raw = { input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100,
  cache_write_tokens_details: { ttl_12h_tokens: 20 } }, output_tokens: 150, output_tokens_details: { reasoning_tokens: 100 } };
const model = "gpt-6-luna", host = "api.openai.com";

test("cost uses separate input, cache read, 30m write, 12h write and output rates", () => {
  const expected = { inputTokens: 1000, cachedInputTokens: 200, cacheWriteTokens: 100, cacheWrite12hTokens: 20,
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
