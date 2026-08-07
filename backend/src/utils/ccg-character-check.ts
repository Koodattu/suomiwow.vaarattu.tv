import {
  COMPLETE_CCG_SCORE_FILTER,
  MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
} from "../config/character-eligibility";

export type CcgCharacterMechanicsRow = {
  pulls?: number | null;
  score?: number | null;
  parseScore?: number | null;
  survivalScore?: number | null;
  survivalPercentile?: number | null;
};

export function resolveCcgCharacterMechanicsStatus(
  mechanicsRows: CcgCharacterMechanicsRow[],
  fallbackEntry?: CcgCharacterMechanicsRow | null,
): { pulls: number; scoresReady: boolean; eligible: boolean } {
  const candidates = mechanicsRows.length > 0 ? mechanicsRows : fallbackEntry ? [fallbackEntry] : [];
  const completeCandidates = candidates.filter(
    (row) =>
      typeof row.score === "number"
      && row.score >= COMPLETE_CCG_SCORE_FILTER.score.$gte
      && typeof row.parseScore === "number"
      && row.parseScore >= COMPLETE_CCG_SCORE_FILTER.parseScore.$gte
      && typeof row.survivalScore === "number"
      && row.survivalScore >= COMPLETE_CCG_SCORE_FILTER.survivalScore.$gte
      && typeof row.survivalPercentile === "number"
      && row.survivalPercentile >= COMPLETE_CCG_SCORE_FILTER.survivalPercentile.$gte,
  );
  const selectedCandidates = completeCandidates.length > 0 ? completeCandidates : candidates;
  const selected = selectedCandidates.slice().sort((left, right) => {
    const pullsDiff = Math.max(right.pulls ?? 0, 0) - Math.max(left.pulls ?? 0, 0);
    if (pullsDiff !== 0) return pullsDiff;
    return (right.score ?? -1) - (left.score ?? -1);
  })[0];
  const pulls = Math.max(selected?.pulls ?? 0, 0);
  const scoresReady = completeCandidates.length > 0;

  return {
    pulls,
    scoresReady,
    eligible: scoresReady && pulls >= MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
  };
}
