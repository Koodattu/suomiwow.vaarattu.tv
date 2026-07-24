import { randomInt } from "crypto";
import {
  CCG_CARDS_PER_PACK,
  CCG_DUPLICATES_PER_BONUS_PACK,
  CCG_GUARANTEED_GRADE_ODDS,
  CCG_TIER_GRADES,
  CCG_WEIGHTED_GRADE_ODDS,
  CcgTierGrade,
} from "../config/ccg";

export type CcgPackBucket = { grade: CcgTierGrade; cardIds: Array<{ toString(): string }> };

export type CcgPackPoolSummary = {
  poolId: string;
  setId: string;
  version: string;
  counts: Array<{ grade: CcgTierGrade; count: number }>;
};

export type CcgPackSelectionPlan = {
  poolId: string;
  setId: string;
  tierGrade: CcgTierGrade;
  bucketOffset: number;
};

export function calculateDuplicateProgress(remainder: number, addedDuplicates: number): { remainder: number; earned: number } {
  if (!Number.isInteger(remainder) || remainder < 0 || remainder >= CCG_DUPLICATES_PER_BONUS_PACK) throw new Error("Invalid duplicate remainder");
  if (!Number.isInteger(addedDuplicates) || addedDuplicates < 0) throw new Error("Invalid duplicate count");
  const total = remainder + addedDuplicates;
  return {
    remainder: total % CCG_DUPLICATES_PER_BONUS_PACK,
    earned: Math.floor(total / CCG_DUPLICATES_PER_BONUS_PACK),
  };
}

function weightedGrade(
  weights: Readonly<Record<CcgTierGrade, number>>,
  available: ReadonlySet<CcgTierGrade>,
  random: (maximum: number) => number,
): CcgTierGrade {
  const entries = CCG_TIER_GRADES.map((grade) => [grade, available.has(grade) ? weights[grade] : 0] as const).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) throw new Error("The CCG pack pool has no eligible cards");
  let cursor = random(total);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= total) throw new Error("Random source returned an out-of-range value");
  for (const [grade, weight] of entries) {
    if (cursor < weight) return grade;
    cursor -= weight;
  }
  return entries[entries.length - 1][0];
}

export function selectPackCards<T extends { toString(): string }>(
  buckets: Array<{ grade: CcgTierGrade; cardIds: T[] }>,
  random: (maximum: number) => number = randomInt,
): Array<{ cardId: T; tierGrade: CcgTierGrade }> {
  const bucketMap = new Map(buckets.filter((bucket) => bucket.cardIds.length > 0).map((bucket) => [bucket.grade, bucket.cardIds]));
  const available = new Set(bucketMap.keys());
  const choose = (guaranteed: boolean) => {
    const grade = weightedGrade(guaranteed ? CCG_GUARANTEED_GRADE_ODDS : CCG_WEIGHTED_GRADE_ODDS, available, random);
    const cards = bucketMap.get(grade)!;
    return { cardId: cards[random(cards.length)], tierGrade: grade };
  };
  return Array.from({ length: CCG_CARDS_PER_PACK }, (_, index) => choose(index === CCG_CARDS_PER_PACK - 1));
}

export function planPackSelections(
  pools: CcgPackPoolSummary[],
  random: (maximum: number) => number = randomInt,
): CcgPackSelectionPlan[] {
  const countByPool = new Map(
    pools.map((pool) => [pool.poolId, new Map(pool.counts.filter((row) => row.count > 0).map((row) => [row.grade, row.count]))]),
  );
  const totalByGrade = new Map<CcgTierGrade, number>();
  for (const pool of pools) {
    for (const row of pool.counts) totalByGrade.set(row.grade, (totalByGrade.get(row.grade) ?? 0) + row.count);
  }
  const available = new Set(Array.from(totalByGrade).filter(([, count]) => count > 0).map(([grade]) => grade));

  const choose = (guaranteed: boolean): CcgPackSelectionPlan => {
    const tierGrade = weightedGrade(guaranteed ? CCG_GUARANTEED_GRADE_ODDS : CCG_WEIGHTED_GRADE_ODDS, available, random);
    const total = totalByGrade.get(tierGrade) ?? 0;
    let offset = random(total);
    if (!Number.isInteger(offset) || offset < 0 || offset >= total) throw new Error("Random source returned an out-of-range value");
    for (const pool of pools) {
      const count = countByPool.get(pool.poolId)?.get(tierGrade) ?? 0;
      if (offset < count) return { poolId: pool.poolId, setId: pool.setId, tierGrade, bucketOffset: offset };
      offset -= count;
    }
    throw new Error("The CCG pack pool plan could not resolve a card bucket");
  };

  return Array.from({ length: CCG_CARDS_PER_PACK }, (_, index) => choose(index === CCG_CARDS_PER_PACK - 1));
}

export function selectCommunityCard<T>(
  normalCount: number,
  communityCards: readonly T[],
  random: (maximum: number) => number = randomInt,
): T | null {
  if (normalCount <= 0 || communityCards.length === 0) return null;
  if (random(normalCount + communityCards.length) < normalCount) return null;
  if (random(2) !== 0) return null;
  return communityCards[random(communityCards.length)];
}
