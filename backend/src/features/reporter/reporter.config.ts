const parsePositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const REPORTER_CONFIG = {
  schedule: process.env.REPORTER_WEEKLY_SCHEDULE || "30 23 * * 3",
  timeZone: "Europe/Helsinki",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium" as const,
  verbosity: "low" as const,
  maxOutputTokens: 5000,
  promptVersion: "reporter-v6",
  pricing: {
    inputPerMillion: parsePositiveNumber(process.env.REPORTER_INPUT_COST_PER_MILLION, 0.2),
    cachedInputPerMillion: parsePositiveNumber(process.env.REPORTER_CACHED_INPUT_COST_PER_MILLION, 0.02),
    cacheWritePerMillion: parsePositiveNumber(process.env.REPORTER_CACHE_WRITE_COST_PER_MILLION, 0.25),
    outputPerMillion: parsePositiveNumber(process.env.REPORTER_OUTPUT_COST_PER_MILLION, 1.2),
  },
} as const;

export function requireReporterApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to generate Reporter articles");
  }
  return apiKey;
}
