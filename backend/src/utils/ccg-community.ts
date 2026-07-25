import type { CcgCommunityScores } from "../models/CcgCard";

function validCommunityScore(value: unknown, field: string, maximum: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${field} must be a number between 0 and ${maximum}`);
  }
  return Math.round(value * 10) / 10;
}

export function normalizeCommunityScores(value: unknown): CcgCommunityScores {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Community metrics must be an object");
  }
  const scores = value as Record<string, unknown>;
  return {
    performance: validCommunityScore(scores.performance, "performance", 100),
    mechanics: validCommunityScore(scores.mechanics, "mechanics", 100),
    combined: validCommunityScore(scores.combined, "combined", 100),
    mythicPlus: validCommunityScore(scores.mythicPlus, "mythic plus", 100_000),
  };
}
