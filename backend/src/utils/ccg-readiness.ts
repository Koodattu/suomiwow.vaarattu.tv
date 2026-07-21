import {
  CCG_ENABLE_MIN_ELIGIBLE_CHARACTERS,
  CCG_ENABLE_MIN_MEDIA_COVERAGE,
  CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS,
} from "../config/ccg";

export type CcgReadinessBlocker = "eligible_population" | "media_ready" | "media_coverage" | "already_enabled";

export function evaluateCcgReadiness(input: { eligible: number; mediaReady: number; enabled: boolean }): {
  mediaCoverage: number;
  readyToEnable: boolean;
  blockers: CcgReadinessBlocker[];
} {
  const mediaCoverage = input.eligible > 0 ? input.mediaReady / input.eligible : 0;
  const blockers: CcgReadinessBlocker[] = [];
  if (input.enabled) blockers.push("already_enabled");
  if (input.eligible < CCG_ENABLE_MIN_ELIGIBLE_CHARACTERS) blockers.push("eligible_population");
  if (input.mediaReady < CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS) blockers.push("media_ready");
  if (mediaCoverage < CCG_ENABLE_MIN_MEDIA_COVERAGE) blockers.push("media_coverage");
  return { mediaCoverage, readyToEnable: blockers.length === 0, blockers };
}
