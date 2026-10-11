import type { BossProgress } from "@/types";

// These encounters cannot be described reliably by the active unit's health:
// Belo'ren repeats the same phases; Sun King's Salvation is a healing encounter.
const FIGHT_PERCENTAGE_BOSSES = new Set([3182, 2402]);
const WORD_NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function shortProgressPhase(value?: string): string | undefined {
  if (!value) return undefined;
  const heading = value.split(":")[0];
  const compact = heading.match(/\b([PI])(\d+)\b/i);
  if (compact) return `${compact[1].toUpperCase()}${compact[2]}`;

  // Only read the phase heading, not numbers in a mechanic's descriptive name.
  const phase = heading.match(/\b(phase|stage|intermission)(?:\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten))?\b/i);
  if (!phase) return undefined;
  const number = phase[2] ? (/^\d+$/.test(phase[2]) ? Number(phase[2]) : WORD_NUMBERS.indexOf(phase[2].toLowerCase()) + 1) : undefined;
  if (!number && phase[1].toLowerCase() !== "intermission") return undefined;
  return `${phase[1].toLowerCase() === "intermission" ? "I" : "P"}${number || 1}`;
}

function usablePercentage(value?: number | null): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined;
}

export function formatPullProgressLabel(input: {
  bossId?: number;
  bossPercentage?: number | null;
  fightPercentage?: number | null;
  progressPercentage?: number | null;
  phase?: string;
  progressDisplay?: string;
}): string {
  const boss = usablePercentage(input.bossPercentage);
  const fight = usablePercentage(input.fightPercentage) ?? usablePercentage(input.progressPercentage);
  const percentage = FIGHT_PERCENTAGE_BOSSES.has(input.bossId ?? 0) ? fight ?? boss : boss ?? fight;
  // Legacy history can synthesize phase numbers from absolute IDs (including
  // intermissions). Prefer the recorded display heading when it is available.
  const phase = shortProgressPhase(input.progressDisplay || input.phase);
  const percentLabel = percentage === undefined ? "-" : `${percentage.toFixed(1)}%`;
  return phase ? `${percentLabel} ${phase}` : percentLabel;
}

export function formatBossProgressLabel(boss: BossProgress): string {
  const pull = boss.bestPullReportCode && boss.bestPullFightId !== undefined
    ? boss.pullHistory?.find((entry) => entry.reportCode === boss.bestPullReportCode && entry.fightId === boss.bestPullFightId)
    : undefined;
  return formatPullProgressLabel({
    bossId: boss.bossId,
    bossPercentage: boss.bestPullBossHealth !== undefined ? boss.bestPullBossHealth : pull ? pull.bossPercentage : boss.bestPullPhase?.bossHealth,
    fightPercentage: pull?.fightPercentage,
    // 100 without a selected pull is the backend's initial, unknown best value.
    progressPercentage: boss.bestPercent < 100 || boss.bestPullReportCode ? boss.bestPercent : null,
    phase: pull ? pull.phase : boss.bestPullPhase?.phaseName || boss.bestPullPhase?.displayString,
    progressDisplay: pull ? pull.progressDisplay : undefined,
  });
}
