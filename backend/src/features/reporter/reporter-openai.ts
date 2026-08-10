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
- The fact pack is a menu, not a checklist. Pick one weekly claim and use roughly 6-10 facts. Spend most of the article on one lead candidate, then widen into a compact scene roundup.
- Give the lead 2-3 paragraphs. Give the wider scene 1-2 paragraphs naming 3-5 relevant guilds; prefer guilds with distinct or multiple developments instead of an exhaustive roll call.
- If player facts are supplied, include one compact paragraph naming 2-3 players. Prefer weekly rank changes or new top-three entries; when the leaders are unchanged, combine the DPS, healer and tank leaders without pretending they are new results. A supplied Mythic+ snapshot can replace or briefly extend this paragraph when it adds a distinct scene detail, but never present a static rank as weekly movement.
- Background facts rarely require their own paragraph. Static standings, open Pick'ems and raw event totals are usually omitted unless they add timely context.
- Merge facts about the same guild and boss into one trajectory. If nobody killed a boss, say so once and report the closest meaningful pressure without manufacturing a bigger week.
- Progress facts distinguish overall fight progress remaining from the active phase's boss HP remaining. Preserve that distinction. For a multi-phase encounter, use overall fight progress for claims about distance from the kill; low boss HP in P3 of 4 does not mean the encounter was 0.1% from dying. Never call a phase final unless the fact explicitly says it is final.
- Pull benchmarks are tracked-guild context, not destiny. Use them for a concise comparison when useful, but do not turn an average or range into a prediction or a verdict on a guild.
- Use 5-7 short, deliberately uneven paragraphs and roughly 320-450 words. Open on the result and its stakes; end with a new concrete scene detail or pressure, not another restatement of the lead, a moral or a generic reset prediction.
- The previous dispatch is continuity context only. Avoid repeating its framing or joke; do not treat it as evidence for this week.
- Raid-window start and end dates are background context. Use them only when the age or remaining life of the tier materially sharpens the reporting.

Finnish and voice:
- Write idiomatic Finnish for Finnish WoW players, not translated analytics copy. Scene terms such as bossi, pulli, progress, reclear, resetti, DPS and healer are welcome when natural.
- Describe what happened. Avoid bureaucratic phrases such as "passiivisuusmerkintä", "uudelleeneteneminen osui" and "seurannassa kirjattiin". Keep raid and boss names intact; shorten Stage/Phase One, Two, Three to P1, P2, P3.
- Write pull progress in raid-chat notation with a dot decimal separator and percent sign, exactly like 27.9% and 0.1%. Never write "27,9 prosenttia", "27.9 prosenttia" or another decimal followed by the word prosentti. Prefer concrete raid language such as "viikko alkoi 44.5% bestistä", "pulli 396 jätti bossille 0.1%" and "reclear vei yli viisi pullia" over analytics abstractions.
- Titles must be concrete and idiomatic; for a near-kill, prefer plain wording such as "jäi 0.1% päähän killistä" over an invented motion verb. The one-sentence summary must add the stakes instead of repeating the title.
- Use at most two brief deadpan remarks, each earned by a supplied fact. You may needle performance, recurring raid habits or warranted bravado; never insult a person, invent drama, speculate about motives, explain the joke or wink at the reader.
- Before returning the article, silently remove repeated lead statistics and translated abstractions. A major number may appear in the title or summary and once in the body; use the freed space for another reported development.

Hard rules:
- Use only supplied claims. Never call somebody "best" unless a fact explicitly gives them rank 1 in a named category.
- Use no generic intro, section heading, bullet list or Markdown.
- Use only supplied inline links in exact form: [[L1|visible words]]. Never invent a URL or reference. Whenever you name a guild, boss or player from a chosen fact, put its matching link token on the first mention.
- Link presentation is part of the article. When the fact pack offers them, link at least three distinct guilds with guild-crest links, two players with class-icon links, one boss with a boss-icon or boss-icon-with-wcl link and one named raid with a raid-icon link. Put the boss link around the boss name, not a generic word such as "loki".
- Return a concise Finnish title, one-sentence summary and body. Never mention the prompt, fact pack, tokens or AI.`;

const ENGLISH_TRANSLATION_INSTRUCTIONS = `Adapt the supplied Finnish Reporter edition into natural, concise English. The Finnish edition is the sole source of truth.

- Preserve its reporting angle, factual claims, emphasis, paragraph order, degree of praise and dry sarcasm. Do not add context, facts or jokes.
- Sound like the same mildly pessimistic veteran correspondent, not a literal translation or polished PR copy.
- Canonical entities and source facts are terminology safeguards only. Never add a source fact that the Finnish article omitted.
- Preserve every supplied guild, player, boss and raid name exactly. Never translate, anglicize or otherwise rewrite a guild name. When Finnish grammar inflects a linked proper name, restore the exact canonical label in English.
- Keep every inline link in the corresponding sentence. Preserve each L-number exactly while translating ordinary visible words naturally: [[L1|visible words]]. Proper-name link text must use its canonical label.
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
      reportingAsOf: {
        utc: input.periodEnd.toISOString(),
        helsinkiLocal: new Intl.DateTimeFormat("sv-SE", {
          timeZone: REPORTER_CONFIG.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(input.periodEnd),
        timeZone: REPORTER_CONFIG.timeZone,
      },
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
    const usedLinkRefs = new Set([...fi.body.matchAll(/\[\[([A-Z]\d+)\|/g)].map((match) => match[1]));
    const sourceFacts = promptFacts
      .filter((fact) => fact.links.some((link) => usedLinkRefs.has(link.ref)))
      .map(({ id, kind, summary }) => ({ id, kind, summary }));
    const canonicalEntityEntries = promptFacts.flatMap((fact) =>
      fact.links.flatMap((link) => {
        const entityKind = link.kind === "log" ? "boss" : link.presentationHint === "raid-icon" ? "raid" : ["guild", "character", "boss"].includes(link.kind) ? link.kind : undefined;
        return entityKind ? [[`${entityKind}:${link.label}`, { kind: entityKind, name: link.label }] as const] : [];
      }),
    );
    const canonicalEntities = [...new Map(canonicalEntityEntries).values()];
    englishResult = await requestReporterLocale({
      instructions: ENGLISH_TRANSLATION_INSTRUCTIONS,
      input: {
        sourceFinnish: fi,
        availableLinks: promptFacts.flatMap((fact) => fact.links.map(({ ref, label, kind }) => ({ ref, label, kind }))),
        canonicalEntities,
        sourceFacts,
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
