import { REPORTER_CONFIG } from "./reporter.config";
import { ReporterFact, ReporterGeneratedContent, ReporterLink, ReporterLocaleContent, ReporterResolvedLink, ReporterUsage } from "./reporter.types";

const LINK_TOKEN_PATTERN = /\[\[([A-Z]\d+)\|([^\]\n]{1,80})\]\]/g;
const MARKDOWN_WRAPPED_LINK_TOKEN_PATTERN = /\[([^\]\n]{1,80})\]\(\s*\[\[([A-Z]\d+)\|[^\]\n]{1,80}\]\]\s*\)/g;
const RECOVERABLE_LINK_TOKEN_PATTERN = /\[{1,2}\s*([A-Z]\d+)(?:\s*\|\s*([^\]\n]{0,80}))?\s*\]{1,2}/g;
const UNCLOSED_LINK_TOKEN_PATTERN = /\[\[\s*([A-Z]\d+)\s*\|\s*([^\]\n]{1,80})(?=\n|$)/g;

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

export function combineReporterUsage(...usages: ReporterUsage[]): ReporterUsage {
  const sum = (field: keyof Pick<ReporterUsage, "inputTokens" | "cachedInputTokens" | "cacheWriteTokens" | "outputTokens" | "reasoningTokens" | "totalTokens">) =>
    usages.reduce((total, usage) => total + usage[field], 0);

  return {
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    estimatedCostUsd: Number(usages.reduce((total, usage) => total + usage.estimatedCostUsd, 0).toFixed(8)),
    rates: { ...REPORTER_CONFIG.pricing },
  };
}

export function repairReporterLinkTokens(article: ReporterLocaleContent, facts: ReporterFact[]): ReporterLocaleContent {
  const allowedLinks = new Map(facts.flatMap((fact) => fact.links.map((link) => [link.ref, link.label] as const)));
  const normalize = (_token: string, ref: string, visibleText?: string) => {
    const label = allowedLinks.get(ref);
    const visible = visibleText?.trim() || label || ref;
    return label ? `[[${ref}|${visible}]]` : visible;
  };
  const normalizedBody = article.body
    .replace(MARKDOWN_WRAPPED_LINK_TOKEN_PATTERN, (_token, visibleText: string, ref: string) => normalize(_token, ref, visibleText))
    .replace(RECOVERABLE_LINK_TOKEN_PATTERN, normalize)
    .replace(UNCLOSED_LINK_TOKEN_PATTERN, normalize);
  const validTokens: string[] = [];
  const protectedBody = normalizedBody.replace(LINK_TOKEN_PATTERN, (token) => `\u0000REPORTER_LINK_${validTokens.push(token) - 1}\u0000`);
  const body = protectedBody
    .replaceAll("[[", "")
    .replaceAll("]]", "")
    .replace(/\u0000REPORTER_LINK_(\d+)\u0000/g, (_placeholder: string, index: string) => validTokens[Number(index)] || "");

  return body === article.body ? article : { ...article, body };
}

export function validateReporterLocaleContent(article: ReporterLocaleContent, locale: "en" | "fi", facts: ReporterFact[]): void {
  const allowedLinks = new Set(facts.flatMap((fact) => fact.links.map((link) => link.ref)));

  if (!article || typeof article.title !== "string" || typeof article.summary !== "string" || typeof article.body !== "string") {
    throw new Error(`Reporter returned incomplete ${locale.toUpperCase()} content`);
  }

  const titleLength = article.title.trim().length;
  const summaryLength = article.summary.trim().length;
  const wordCount = article.body.trim().split(/\s+/u).filter(Boolean).length;
  if (titleLength < 5 || titleLength > 140) throw new Error(`Reporter ${locale.toUpperCase()} title has an invalid length`);
  if (summaryLength < 20 || summaryLength > 360) throw new Error(`Reporter ${locale.toUpperCase()} summary has an invalid length`);
  if (wordCount < 120 || wordCount > 600) throw new Error(`Reporter ${locale.toUpperCase()} body must contain 120-600 words`);

  for (const match of article.body.matchAll(LINK_TOKEN_PATTERN)) {
    if (!allowedLinks.has(match[1])) throw new Error(`Reporter ${locale.toUpperCase()} body used unknown link ${match[1]}`);
  }

  const withoutValidLinks = article.body.replace(LINK_TOKEN_PATTERN, "");
  if (withoutValidLinks.includes("[[") || withoutValidLinks.includes("]]")) {
    throw new Error(`Reporter ${locale.toUpperCase()} body contains a malformed link token`);
  }
}

export function validateReporterContent(content: ReporterGeneratedContent, facts: ReporterFact[]): void {
  for (const locale of ["en", "fi"] as const) validateReporterLocaleContent(content[locale], locale, facts);
}

type ReporterPromptLink = Pick<ReporterLink, "ref" | "label" | "url" | "kind"> & {
  presentationHint?: "guild-crest" | "boss-icon" | "boss-icon-with-wcl" | "class-icon" | "raid-icon" | "wcl-icon";
};

type ReporterPromptFact = Omit<ReporterFact, "links"> & { links: ReporterPromptLink[] };

function getReporterLinkPresentationHint(link: ReporterLink): ReporterPromptLink["presentationHint"] {
  if (link.kind === "guild" && link.visual?.type === "guild-crest" && link.visual.crest) return "guild-crest";
  if (link.kind === "character" && link.visual?.type === "icon") return "class-icon";
  if (link.kind === "boss" && link.visual?.type === "icon") return "boss-icon";
  if (link.kind === "log" && link.visual?.type === "icon" && link.visual.provider === "wcl") return "boss-icon-with-wcl";
  if (link.kind === "log") return "wcl-icon";
  if (link.visual?.type === "icon") return "raid-icon";
  return undefined;
}

export function getReporterPromptFacts(facts: ReporterFact[]): ReporterPromptFact[] {
  return facts.map((fact) => ({
    id: fact.id,
    kind: fact.kind,
    summary: fact.summary,
    ...(fact.occurredAt ? { occurredAt: fact.occurredAt } : {}),
    links: fact.links.map((link) => {
      const presentationHint = getReporterLinkPresentationHint(link);
      return {
        ref: link.ref,
        label: link.label,
        url: link.url,
        kind: link.kind,
        ...(presentationHint ? { presentationHint } : {}),
      };
    }),
  }));
}

export function getReporterEditorialFactPack(facts: ReporterFact[]) {
  const promptFacts = getReporterPromptFacts(facts);
  const leadKinds = new Set(["boss_kill", "best_pull", "progress_trajectory", "milestone", "weekly_guild_movement"]);
  const supportingKinds = new Set(["regress", "reproge", "reclear_roundup", "hiatus", "boss_benchmark", "player_leaderboard_change", "pickem_change"]);

  return {
    leadCandidates: promptFacts.filter((fact) => leadKinds.has(fact.kind)),
    supportingDevelopments: promptFacts.filter((fact) => supportingKinds.has(fact.kind)),
    background: promptFacts.filter((fact) => !leadKinds.has(fact.kind) && !supportingKinds.has(fact.kind)),
  };
}

export function getReporterLinks(facts: ReporterFact[]): Record<string, ReporterResolvedLink> {
  return Object.fromEntries(
    facts.flatMap((fact) => fact.links.map((link) => [link.ref, { url: link.url, kind: link.kind, ...(link.visual ? { visual: link.visual } : {}) }])),
  );
}
