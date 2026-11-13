import { LUNA_RATES } from "../ai-usage/pricing";

export const REPORTER_CONFIG = {
  schedule: process.env.REPORTER_WEEKLY_SCHEDULE || "30 23 * * 3",
  timeZone: "Europe/Helsinki",
  model: "gpt-6-luna",
  reasoningEffort: "medium" as const,
  verbosity: "low" as const,
  maxOutputTokens: 5000,
  promptVersion: "reporter-v7",
  pricing: LUNA_RATES,
} as const;

export function requireReporterApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to generate Reporter articles");
  }
  return apiKey;
}
