// USD per million tokens. https://developers.openai.com/api/docs/pricing (2026-11-13)
export const LUNA_RATES = { inputPerMillion: 0.10, cachedInputPerMillion: 0.01, cacheWritePerMillion: 0.125, outputPerMillion: 0.50 };
export interface RawUsage {
  input_tokens?: number; output_tokens?: number; total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number;
    cache_write_tokens_details?: { ttl_12h_tokens?: number } };
  output_tokens_details?: { reasoning_tokens?: number };
}

export function usageTokens(raw: RawUsage) {
  const inputTokens = Math.max(0, raw.input_tokens || 0), outputTokens = Math.max(0, raw.output_tokens || 0);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, raw.input_tokens_details?.cached_tokens || 0));
  const cacheWriteTokens = Math.min(inputTokens - cachedInputTokens, Math.max(0, raw.input_tokens_details?.cache_write_tokens || 0));
  const reasoningTokens = Math.min(outputTokens, Math.max(0, raw.output_tokens_details?.reasoning_tokens || 0));
  return { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens,
    totalTokens: raw.total_tokens ?? inputTokens + outputTokens };
}

// A 12-hour write costs twice a 30-minute write. The API includes both in cache_write_tokens.
export function standardLunaCostUsd(raw: RawUsage, tokens: ReturnType<typeof usageTokens>, rates = LUNA_RATES, decisions = false) {
  const longContext = tokens.inputTokens > 272_000;
  const ordinaryInput = tokens.inputTokens - tokens.cachedInputTokens - tokens.cacheWriteTokens;
  const writes12h = Math.min(tokens.cacheWriteTokens, raw.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens || 0);
  const input = ordinaryInput * rates.inputPerMillion + tokens.cachedInputTokens * rates.cachedInputPerMillion
    + (tokens.cacheWriteTokens + writes12h) * rates.cacheWritePerMillion;
  // Reasoning is included in output. Decisions reports output tokens but only bills for input.
  const output = decisions ? 0 : tokens.outputTokens * rates.outputPerMillion;
  return (input * (longContext ? 2 : 1) + output * (longContext ? 1.5 : 1)) / 1_000_000;
}

const tierMultipliers = new Map([["default", 1], ["standard", 1], ["fast", 2], ["priority", 2], ["flex", 0.5]]);

export function priceUsage(raw: RawUsage, model: string, decisions: boolean, tier: string, host: string, rates = LUNA_RATES) {
  if (!Number.isSafeInteger(raw.input_tokens) || !Number.isSafeInteger(raw.output_tokens) || raw.input_tokens! < 0 || raw.output_tokens! < 0) return null;
  const tokens = usageTokens(raw);
  const tierFactor = tierMultipliers.get(tier);
  const regionalFactor = host === "api.openai.com" ? 1 : /^[a-z]+\.api\.openai\.com$/.test(host) ? 1.1 : undefined;
  if (!/^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(model) || !tierFactor || !regionalFactor) return { ...tokens, costNanoUsd: null };
  const usd = standardLunaCostUsd(raw, tokens, rates, decisions) * tierFactor * regionalFactor;
  return { ...tokens, costNanoUsd: Math.round(usd * 1e9) };
}
