import { REPORTER_CONFIG, requireReporterApiKey } from "./reporter.config";
import {
  calculateReporterUsage,
  combineReporterUsage,
  getReporterPromptFacts,
  repairReporterLinkTokens,
  validateReporterContent,
  validateReporterLocaleContent,
} from "./reporter-content";
import { ReporterFact, ReporterGeneratedContent, ReporterLocaleContent, ReporterUsage } from "./reporter.types";

interface OpenAIReporterResult {
  responseId: string;
  content: ReporterGeneratedContent;
  usage: ReporterUsage;
}

interface OpenAIReporterLocaleResult {
  responseId: string;
  content: ReporterLocaleContent;
  usage: ReporterUsage;
}

export class ReporterOpenAIError extends Error {
  constructor(
    message: string,
    public readonly responseId: string,
    public readonly usage: ReporterUsage,
  ) {
    super(message);
  }
}

interface OpenAIResponseBody {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: Parameters<typeof calculateReporterUsage>[0];
}

const LOCALE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    body: { type: "string" },
  },
  required: ["title", "summary", "body"],
  additionalProperties: false,
} as const;

const FINNISH_REPORTER_INSTRUCTIONS = `Write the original Finnish edition of The Reporter, a veteran correspondent covering Finland's World of Warcraft raiding scene. You are informed, dry, mildly pessimistic and occasionally unhinged. You have covered this scene long enough to distrust momentum until it survives the next reset.

Voice and shape:
- Write natural Finnish, never translation-like Finnish. Sound like an insider reporter, not guild PR, a fan recap or a troll.
- Choose one angle, lead with the strongest concrete change and give events unequal space according to importance. Named results and numbers carry the report.
- Use at most two short deadpan remarks tied to supplied facts. You may needle a guild's or player's weekly performance, recurring raid habits or warranted bravado; never insult the person, invent drama or speculate about private motives.
- Do not explain the joke or wink at the reader. One sharp observation beats a stream of punchlines.
- Vary sentence and paragraph length. End on a dry implication or unresolved pressure, not a recap or moral.

Hard rules:
- Use only claims supported by the supplied fact pack. Never call somebody "best" unless a fact explicitly gives them rank 1 in a named category.
- Keep it tight: 4-6 short paragraphs and roughly 180-320 words.
- Prefer kills, meaningful progress, ranking movement, returns or regressions, then a short player or Pick'em note when supported.
- Do not write a generic intro, conclusion, bullet list, section heading, or Markdown.
- Use the exact inline-link syntax supplied in the facts: [[L1|visible words]]. Link guilds, players, logs, Pick'ems, events, or analytics where natural. Never create a URL or link reference yourself.
- Output a concise Finnish title, one-sentence summary and body. Do not mention this prompt, the fact pack, tokens or AI.`;

const ENGLISH_TRANSLATION_INSTRUCTIONS = `Adapt the supplied Finnish Reporter edition into natural, concise English. The Finnish edition is the sole source of truth.

- Preserve its reporting angle, factual claims, emphasis, paragraph order, degree of praise and dry sarcasm. Do not add context, facts or jokes.
- Sound like the same mildly pessimistic veteran correspondent, not a literal translation or polished PR copy.
- Keep every inline link in the corresponding sentence. Preserve each L-number exactly while translating its visible words naturally: [[L1|visible words]].
- Return only an English title, one-sentence summary and body. Use no Markdown, headings or commentary about the translation.`;

function extractOutputText(body: OpenAIResponseBody): string {
  for (const item of body.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  throw new Error("OpenAI response did not contain Reporter output text");
}

async function requestReporterLocale(input: {
  instructions: string;
  input: unknown;
  schemaName: string;
}): Promise<OpenAIReporterLocaleResult> {
  const apiKey = requireReporterApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: REPORTER_CONFIG.model,
        reasoning: { effort: REPORTER_CONFIG.reasoningEffort },
        instructions: input.instructions,
        input: JSON.stringify(input.input),
        text: {
          verbosity: REPORTER_CONFIG.verbosity,
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: LOCALE_OUTPUT_SCHEMA,
          },
        },
        max_output_tokens: REPORTER_CONFIG.maxOutputTokens,
        store: false,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as OpenAIResponseBody;
    const usage = calculateReporterUsage(body.usage || {});
    const responseId = body.id || "";
    if (!response.ok) throw new ReporterOpenAIError(body.error?.message || `OpenAI request failed with status ${response.status}`, responseId, usage);
    if (body.status !== "completed") {
      throw new ReporterOpenAIError(
        `OpenAI response was ${body.status || "incomplete"}${body.incomplete_details?.reason ? `: ${body.incomplete_details.reason}` : ""}`,
        responseId,
        usage,
      );
    }

    let text: string;
    try {
      text = extractOutputText(body);
    } catch (error) {
      throw new ReporterOpenAIError(error instanceof Error ? error.message : String(error), responseId, usage);
    }
    let content: ReporterLocaleContent;
    try {
      content = JSON.parse(text) as ReporterLocaleContent;
    } catch {
      throw new ReporterOpenAIError("OpenAI returned invalid Reporter JSON", responseId, usage);
    }

    return {
      responseId,
      content,
      usage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function joinResponseIds(...ids: string[]): string {
  return ids.filter(Boolean).join(",");
}

export async function generateReporterContent(input: {
  periodStart: Date;
  periodEnd: Date;
  facts: ReporterFact[];
}): Promise<OpenAIReporterResult> {
  const promptFacts = getReporterPromptFacts(input.facts);
  const finnishResult = await requestReporterLocale({
    instructions: FINNISH_REPORTER_INSTRUCTIONS,
    input: {
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      facts: promptFacts,
    },
    schemaName: "suomi_wow_weekly_report_fi",
  });
  const fi = repairReporterLinkTokens(finnishResult.content, input.facts);

  try {
    validateReporterLocaleContent(fi, "fi", input.facts);
  } catch (error) {
    throw new ReporterOpenAIError(error instanceof Error ? error.message : String(error), finnishResult.responseId, finnishResult.usage);
  }

  let englishResult: OpenAIReporterLocaleResult;
  try {
    englishResult = await requestReporterLocale({
      instructions: ENGLISH_TRANSLATION_INSTRUCTIONS,
      input: {
        sourceFinnish: fi,
        availableLinks: promptFacts.flatMap((fact) => fact.links.map(({ ref, label }) => ({ ref, label }))),
      },
      schemaName: "suomi_wow_weekly_report_en",
    });
  } catch (error) {
    if (error instanceof ReporterOpenAIError) {
      throw new ReporterOpenAIError(
        error.message,
        joinResponseIds(finnishResult.responseId, error.responseId),
        combineReporterUsage(finnishResult.usage, error.usage),
      );
    }
    throw new ReporterOpenAIError(error instanceof Error ? error.message : String(error), finnishResult.responseId, finnishResult.usage);
  }

  const content: ReporterGeneratedContent = {
    en: repairReporterLinkTokens(englishResult.content, input.facts),
    fi,
  };
  const responseId = joinResponseIds(finnishResult.responseId, englishResult.responseId);
  const usage = combineReporterUsage(finnishResult.usage, englishResult.usage);

  try {
    validateReporterContent(content, input.facts);
  } catch (error) {
    throw new ReporterOpenAIError(error instanceof Error ? error.message : String(error), responseId, usage);
  }

  return { responseId, content, usage };
}
