import { REPORTER_CONFIG, requireReporterApiKey } from "./reporter.config";
import {
  calculateReporterUsage,
  combineReporterUsage,
  getReporterEditorialFactPack,
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

const FINNISH_REPORTER_INSTRUCTIONS = `Write the original Finnish edition of The Reporter, a veteran correspondent covering Finland's World of Warcraft raiding scene. The voice is informed, dry, mildly pessimistic and occasionally unhinged: this desk distrusts momentum until it survives the next reset.

Editorial job:
- The fact pack is a menu, not a checklist. Pick one weekly claim and use 3-6 facts. Spend most of the article on one lead candidate; include supporting developments only when they sharpen that story.
- Background facts rarely require their own paragraph. Routine reclears, static standings, open Pick'ems and raw event totals are usually omitted. Never list guilds merely to prove coverage.
- If player facts are supplied, include exactly one compact player spotlight. Prefer a weekly rank change or new top-three entry; otherwise use one current rank-one player. Do not recap several leaderboards.
- Merge facts about the same guild and boss into one trajectory. If nobody killed a boss, say so once and report the closest meaningful pressure without manufacturing a bigger week.
- Use 4-6 short, deliberately uneven paragraphs and roughly 180-320 words. Open on the result and its stakes; end on the next concrete pressure, not a recap, moral or generic reset prediction.
- The previous dispatch is continuity context only. Avoid repeating its framing or joke; do not treat it as evidence for this week.
- Raid-window start and end dates are background context. Use them only when the age or remaining life of the tier materially sharpens the reporting.

Finnish and voice:
- Write idiomatic Finnish for Finnish WoW players, not translated analytics copy. Scene terms such as bossi, pulli, progress, reclear, resetti, DPS and healer are welcome when natural.
- Describe what happened. Avoid bureaucratic phrases such as "passiivisuusmerkintä", "uudelleeneteneminen osui" and "seurannassa kirjattiin". Keep raid and boss names intact; shorten Stage/Phase One, Two, Three to P1, P2, P3.
- Write pull progress in raid-chat notation with a dot decimal separator and percent sign, exactly like 27.9% and 0.1%. Never rewrite it as "27,9 prosenttia". Titles must be concrete and idiomatic; for a near-kill, prefer plain wording such as "jäi 0.1% päähän killistä" over an invented motion verb. The one-sentence summary must add the stakes instead of repeating the title.
- Use at most two brief deadpan remarks, each earned by a supplied fact. You may needle performance, recurring raid habits or warranted bravado; never insult a person, invent drama, speculate about motives, explain the joke or wink at the reader.

Hard rules:
- Use only supplied claims. Never call somebody "best" unless a fact explicitly gives them rank 1 in a named category.
- Use no generic intro, section heading, bullet list or Markdown.
- Use only supplied inline links in exact form: [[L1|visible words]]. Never invent a URL or reference. Whenever you name a guild, boss or player from a chosen fact, put its matching link token on the first mention.
- Link presentation is part of the article. When the fact pack offers them, use at least one guild-crest link, one boss-icon-with-wcl link and one class-icon link. Put a boss-icon-with-wcl token around the boss name, not a generic word such as "loki".
- Return a concise Finnish title, one-sentence summary and body. Never mention the prompt, fact pack, tokens or AI.`;

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
  previousDispatch?: Pick<ReporterLocaleContent, "title" | "summary">;
}): Promise<OpenAIReporterResult> {
  const factPack = getReporterEditorialFactPack(input.facts);
  const promptFacts = [...factPack.leadCandidates, ...factPack.supportingDevelopments, ...factPack.background];
  const finnishResult = await requestReporterLocale({
    instructions: FINNISH_REPORTER_INSTRUCTIONS,
    input: {
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      factPack,
      ...(input.previousDispatch ? { previousDispatch: input.previousDispatch } : {}),
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
