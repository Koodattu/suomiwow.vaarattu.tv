import { REPORTER_CONFIG } from "./reporter.config";
import { ReporterFact, ReporterGeneratedContent, ReporterUsage } from "./reporter.types";

const LINK_TOKEN_PATTERN = /\[\[([A-Z]\d+)\|([^\]\n]{1,80})\]\]/g;

export function calculateReporterUsage(rawUsage: {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
}): ReporterUsage {
  const inputTokens = Math.max(0, rawUsage.input_tokens || 0);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, rawUsage.input_tokens_details?.cached_tokens || 0));
  const cacheWriteTokens = Math.min(inputTokens - cachedInputTokens, Math.max(0, rawUsage.input_tokens_details?.cache_write_tokens || 0));
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens);
  const outputTokens = Math.max(0, rawUsage.output_tokens || 0);
  const reasoningTokens = Math.min(outputTokens, Math.max(0, rawUsage.output_tokens_details?.reasoning_tokens || 0));
  const rates = { ...REPORTER_CONFIG.pricing };
  const estimatedCostUsd =
    (uncachedInputTokens * rates.inputPerMillion +
      cachedInputTokens * rates.cachedInputPerMillion +
      cacheWriteTokens * rates.cacheWritePerMillion +
      outputTokens * rates.outputPerMillion) /
    1_000_000;

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: Math.max(0, rawUsage.total_tokens || inputTokens + outputTokens),
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    rates,
  };
}

export function validateReporterContent(content: ReporterGeneratedContent, facts: ReporterFact[]): void {
  const allowedLinks = new Set(facts.flatMap((fact) => fact.links.map((link) => link.ref)));

  for (const locale of ["en", "fi"] as const) {
    const article = content[locale];
    if (!article || typeof article.title !== "string" || typeof article.summary !== "string" || typeof article.body !== "string") {
      throw new Error(`Reporter returned incomplete ${locale.toUpperCase()} content`);
    }

    const titleLength = article.title.trim().length;
    const summaryLength = article.summary.trim().length;
    const wordCount = article.body.trim().split(/\s+/u).filter(Boolean).length;
    if (titleLength < 5 || titleLength > 140) throw new Error(`Reporter ${locale.toUpperCase()} title has an invalid length`);
    if (summaryLength < 20 || summaryLength > 360) throw new Error(`Reporter ${locale.toUpperCase()} summary has an invalid length`);
    if (wordCount < 120 || wordCount > 600) throw new Error(`Reporter ${locale.toUpperCase()} body must contain 120-600 words`);

    let linkCount = 0;
    for (const match of article.body.matchAll(LINK_TOKEN_PATTERN)) {
      linkCount += 1;
      if (!allowedLinks.has(match[1])) throw new Error(`Reporter ${locale.toUpperCase()} body used unknown link ${match[1]}`);
    }
    if (linkCount === 0) throw new Error(`Reporter ${locale.toUpperCase()} body must include at least one source link`);

    const withoutValidLinks = article.body.replace(LINK_TOKEN_PATTERN, "");
    if (withoutValidLinks.includes("[[") || withoutValidLinks.includes("]]")) {
      throw new Error(`Reporter ${locale.toUpperCase()} body contains a malformed link token`);
    }
  }
}

export function getReporterLinks(facts: ReporterFact[]): Record<string, { url: string; kind: ReporterFact["links"][number]["kind"] }> {
  return Object.fromEntries(facts.flatMap((fact) => fact.links.map((link) => [link.ref, { url: link.url, kind: link.kind }])));
}
