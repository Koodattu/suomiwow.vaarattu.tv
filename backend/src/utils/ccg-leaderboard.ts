import {
  CCG_CUSTOM_FINISHES,
  CCG_FINISH_ORDER,
  CCG_TIER_GRADES,
  CcgFinish,
  CcgTierGrade,
} from "../config/ccg";

export const CCG_COLLECTION_SCORE_VERSION = "collection-v3-records";
export const CCG_SERIES_BASE_POINTS = 100;
export const CCG_ALL_FINISHES_BONUS = 25;
export const CCG_COMPLETE_SET_POINTS_PER_CARD = 10;

export const CCG_GRADE_POINTS: Readonly<Record<CcgTierGrade, number>> = {
  H: 40,
  S: 25,
  A: 15,
  B: 9,
  C: 5,
  D: 3,
  E: 1,
  F: 0,
};

export const CCG_FINISH_POINTS: Readonly<Record<CcgFinish, number>> = {
  standard: 0,
  foil: 2,
  golden: 5,
  prismatic: 7,
  holographic: 10,
  ...Object.fromEntries(CCG_CUSTOM_FINISHES.map((finish) => [finish, 16])) as Record<(typeof CCG_CUSTOM_FINISHES)[number], number>,
  negative: 32,
  astral: 48,
};

export type CcgSeriesScore = {
  rarityPoints: number;
  finishPoints: number;
  allFinishesPoints: number;
  finishesOwned: number;
  premiumFinishesOwned: number;
  allFinishesOwned: boolean;
};

export function bestCcgLeaderboardGrade(grades: readonly CcgTierGrade[]): CcgTierGrade {
  return grades.reduce<CcgTierGrade>((best, grade) => (
    CCG_TIER_GRADES.indexOf(grade) < CCG_TIER_GRADES.indexOf(best) ? grade : best
  ), "F");
}

export function uniqueCcgLeaderboardFinishes(finishes: readonly CcgFinish[]): CcgFinish[] {
  return Array.from(new Set(finishes)).filter((finish) => CCG_FINISH_ORDER.includes(finish));
}

export function scoreCcgSeries(
  grades: readonly CcgTierGrade[],
  finishes: readonly CcgFinish[],
  requiredFinishes: readonly CcgFinish[],
): CcgSeriesScore {
  const uniqueFinishes = uniqueCcgLeaderboardFinishes(finishes);
  const allFinishesOwned = requiredFinishes.every((finish) => uniqueFinishes.includes(finish));
  return {
    rarityPoints: CCG_GRADE_POINTS[bestCcgLeaderboardGrade(grades)],
    finishPoints: uniqueFinishes.reduce((total, finish) => total + CCG_FINISH_POINTS[finish], 0),
    allFinishesPoints: allFinishesOwned ? CCG_ALL_FINISHES_BONUS : 0,
    finishesOwned: uniqueFinishes.length,
    premiumFinishesOwned: uniqueFinishes.filter((finish) => finish !== "standard").length,
    allFinishesOwned,
  };
}

export function getCcgLeaderboardScoringRules(): Record<string, unknown> {
  return {
    version: CCG_COLLECTION_SCORE_VERSION,
    seriesBase: CCG_SERIES_BASE_POINTS,
    grades: CCG_GRADE_POINTS,
    finishes: CCG_FINISH_POINTS,
    allFinishesBonus: CCG_ALL_FINISHES_BONUS,
    completeSetPerCard: CCG_COMPLETE_SET_POINTS_PER_CARD,
  };
}
