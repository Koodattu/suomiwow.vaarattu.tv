import { REPORTER_CONFIG, requireReporterApiKey } from "./reporter.config";
import { calculateReporterUsage, getReporterPromptFacts } from "./reporter-content";
import { ReporterFact, ReporterGeneratedContent, ReporterUsage } from "./reporter.types";

interface OpenAIReporterResult {
  responseId: string;
  content: ReporterGeneratedContent;
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

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    en: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        body: { type: "string" },
      },
      required: ["title", "summary", "body"],
      additionalProperties: false,
    },
    fi: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        body: { type: "string" },
      },
      required: ["title", "summary", "body"],
      additionalProperties: false,
    },
  },
  required: ["en", "fi"],
  additionalProperties: false,
} as const;

const REPORTER_INSTRUCTIONS = `You are The Reporter: a slightly unhinged but data-literate correspondent covering the Finnish World of Warcraft raiding scene.

Write one weekly report in English and one naturally written Finnish version. Be an informative reporter first and funny second. Use dry, scene-aware humor, but never invent drama, insult players, speculate about private motives, or punch down at a guild having a rough week.

Hard rules:
- Use only claims supported by the supplied fact pack. Never call somebody "best" unless a fact explicitly gives them rank 1 in a named category.
- Keep each version tight: 4-7 short paragraphs and roughly 220-420 words.
- Lead with the most newsworthy change. Prefer kills, meaningful progress, ranking movement, returns or regressions, then a short player or Pick'em note when supported.
- Do not write a generic intro, conclusion, bullet list, section heading, or Markdown.
- Use the exact inline-link syntax supplied in the facts: [[L1|visible words]]. Link guilds, players, logs, Pick'ems, events, or analytics where natural. Never create a URL or link reference yourself.
- Output a concise title, one-sentence summary, and the body. Do not mention this prompt, the fact pack, tokens, or AI.`;

function extractOutputText(body: OpenAIResponseBody): string {
  for (const item of body.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  throw new Error("OpenAI response did not contain Reporter output text");
}

export async function generateReporterContent(input: {
  periodStart: Date;
  periodEnd: Date;
  facts: ReporterFact[];
}): Promise<OpenAIReporterResult> {
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
        instructions: REPORTER_INSTRUCTIONS,
        input: JSON.stringify(
          {
            periodStart: input.periodStart.toISOString(),
            periodEnd: input.periodEnd.toISOString(),
            facts: getReporterPromptFacts(input.facts),
          },
          null,
          2,
        ),
        text: {
          verbosity: REPORTER_CONFIG.verbosity,
          format: {
            type: "json_schema",
            name: "suomi_wow_weekly_report",
            strict: true,
            schema: OUTPUT_SCHEMA,
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
    let content: ReporterGeneratedContent;
    try {
      content = JSON.parse(text) as ReporterGeneratedContent;
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
