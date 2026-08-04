import { randomInt } from "crypto";
import {
  CCG_BASIS_POINT_SCALE,
  CCG_CARDS_PER_PACK,
  CCG_COMMUNITY_CARD_CHANCE_BPS,
  CCG_MISSING_CARD_NUDGE_BPS,
  CCG_REGULAR_TIER_GRADES,
  CCG_WEIGHTED_GRADE_ODDS,
  CcgRegularTierGrade,
  CcgTierGrade,
} from "../config/ccg";

export type CcgPackBucket = { grade: CcgTierGrade; cardIds: Array<{ toString(): string }> };

export type CcgPackPoolSummary = {
  poolId: string;
  setId: string;
  version: string;
  counts: Array<{ grade: CcgTierGrade; count: number }>;
};

export type CcgPackCardPlan = {
  poolId: string;
  setId: string;
  tierGrade: CcgRegularTierGrade;
  bucketOffset: number;
};

export type CcgPackSelectionPlan = CcgPackCardPlan & {
  missingCardAlternative: CcgPackCardPlan | null;
};

export type CcgCardCandidates<T> = {
  primary: T;
  missingCardAlternative: T | null;
};

export function shufflePackResults<T>(results: readonly T[], random: (maximum: number) => number = randomInt): T[] {
  const shuffled = [...results];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = random(index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function weightedGrade(
  weights: Readonly<Record<CcgRegularTierGrade, number>>,
  available: ReadonlySet<CcgRegularTierGrade>,
  random: (maximum: number) => number,
): CcgRegularTierGrade {
  const entries = CCG_REGULAR_TIER_GRADES.map((grade) => [grade, available.has(grade) ? weights[grade] : 0] as const).filter(([, weight]) => weight > 0);
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

function rollBasisPointChance(
  chanceBps: number,
  random: (maximum: number) => number,
): boolean {
  const roll = random(CCG_BASIS_POINT_SCALE);
  if (!Number.isInteger(roll) || roll < 0 || roll >= CCG_BASIS_POINT_SCALE) throw new Error("Random source returned an out-of-range value");
  return roll < chanceBps;
}

export function resolveMissingCardNudge<T>(
  primary: T,
  missingCardAlternative: T | null | undefined,
  isOwned: (candidate: T) => boolean,
): T {
  if (!missingCardAlternative || !isOwned(primary) || isOwned(missingCardAlternative)) return primary;
  return missingCardAlternative;
}

export function selectPackCards<T extends { toString(): string }>(
  buckets: Array<{ grade: CcgTierGrade; cardIds: T[] }>,
  random: (maximum: number) => number = randomInt,
): Array<{ cardId: T; tierGrade: CcgRegularTierGrade }> {
  const bucketMap = new Map(
    buckets
      .filter((bucket): bucket is { grade: CcgRegularTierGrade; cardIds: T[] } => (
        bucket.cardIds.length > 0 && CCG_REGULAR_TIER_GRADES.includes(bucket.grade as CcgRegularTierGrade)
      ))
      .map((bucket) => [bucket.grade, bucket.cardIds]),
  );
  const available = new Set(bucketMap.keys());
  const choose = () => {
    const grade = weightedGrade(CCG_WEIGHTED_GRADE_ODDS, available, random);
    const cards = bucketMap.get(grade)!;
    return { cardId: cards[random(cards.length)], tierGrade: grade };
  };
  return Array.from({ length: CCG_CARDS_PER_PACK }, choose);
}

export function planPackSelections(
  pools: CcgPackPoolSummary[],
  random: (maximum: number) => number = randomInt,
  includeMissingCardAlternatives = true,
): CcgPackSelectionPlan[] {
  const countByPool = new Map(
    pools.map((pool) => [pool.poolId, new Map(pool.counts.filter((row) => row.count > 0).map((row) => [row.grade, row.count]))]),
  );
  const totalByGrade = new Map<CcgRegularTierGrade, number>();
  for (const pool of pools) {
    for (const row of pool.counts) {
      if (!CCG_REGULAR_TIER_GRADES.includes(row.grade as CcgRegularTierGrade)) continue;
      const grade = row.grade as CcgRegularTierGrade;
      totalByGrade.set(grade, (totalByGrade.get(grade) ?? 0) + row.count);
    }
  }
  const available = new Set(Array.from(totalByGrade).filter(([, count]) => count > 0).map(([grade]) => grade));

  const chooseCard = (tierGrade: CcgRegularTierGrade): CcgPackCardPlan => {
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

  const choose = (): CcgPackSelectionPlan => {
    const tierGrade = weightedGrade(CCG_WEIGHTED_GRADE_ODDS, available, random);
    const primary = chooseCard(tierGrade);
    return {
      ...primary,
      missingCardAlternative: includeMissingCardAlternatives && rollBasisPointChance(CCG_MISSING_CARD_NUDGE_BPS, random)
        ? chooseCard(tierGrade)
        : null,
    };
  };

  return Array.from({ length: CCG_CARDS_PER_PACK }, choose);
}

export function selectCommunityCardCandidates<T extends { tierGrade: CcgTierGrade }>(
  communityCards: readonly T[],
  random: (maximum: number) => number = randomInt,
  includeMissingCardAlternative = true,
): CcgCardCandidates<T> | null {
  if (communityCards.length === 0) return null;
  if (!rollBasisPointChance(CCG_COMMUNITY_CARD_CHANCE_BPS, random)) return null;
  const primary = communityCards[random(communityCards.length)];
  if (!includeMissingCardAlternative || !rollBasisPointChance(CCG_MISSING_CARD_NUDGE_BPS, random)) {
    return { primary, missingCardAlternative: null };
  }
  const sameGradeCards = communityCards.filter((card) => card.tierGrade === primary.tierGrade);
  return {
    primary,
    missingCardAlternative: sameGradeCards[random(sameGradeCards.length)],
  };
}
