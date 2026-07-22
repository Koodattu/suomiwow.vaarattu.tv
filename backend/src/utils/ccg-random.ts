import { createHash, randomInt } from "crypto";
import {
  CCG_FINISH_ORDER,
  CCG_FINISH_PITY_LIMITS,
  CCG_GRADING_VERSION,
  CcgBackgroundSafeCrop,
  CcgFinish,
  CcgProtectedFinish,
  CcgTierGrade,
} from "../config/ccg";

export type CcgResolvedCrop = { x: number; y: number; scale: number };

export function gradeForPercentile(index: number, populationSize: number): CcgTierGrade {
  if (populationSize <= 0 || index < 0 || index >= populationSize) throw new Error("Invalid grading population index");
  const percentile = (index + 1) / populationSize;
  if (percentile <= 0.05) return "S";
  if (percentile <= 0.15) return "A";
  if (percentile <= 0.35) return "B";
  if (percentile <= 0.55) return "C";
  if (percentile <= 0.75) return "D";
  if (percentile <= 0.9) return "E";
  return "F";
}

function seededUnit(seed: string, offset: number): number {
  const digest = createHash("sha256").update(`${CCG_GRADING_VERSION}:${seed}:${offset}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export function resolveCardCrop(seed: string, safe: CcgBackgroundSafeCrop): CcgResolvedCrop {
  const x = safe.x + (seededUnit(seed, 0) * 2 - 1) * safe.xJitter;
  const y = safe.y + (seededUnit(seed, 1) * 2 - 1) * safe.yJitter;
  const scaleVariation = 0.03 * seededUnit(seed, 2);
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    scale: Number((safe.scale + scaleVariation).toFixed(3)),
  };
}

export type CcgFinishPity = Record<CcgProtectedFinish, number>;

export const emptyFinishPity = (): CcgFinishPity => ({ foil: 0, golden: 0, prismatic: 0, holographic: 0, negative: 0 });

export function compareFinish(left: CcgFinish, right: CcgFinish): number {
  return CCG_FINISH_ORDER.indexOf(left) - CCG_FINISH_ORDER.indexOf(right);
}

export function nextFinish(finish: CcgFinish): CcgFinish {
  return CCG_FINISH_ORDER[Math.min(CCG_FINISH_ORDER.length - 1, CCG_FINISH_ORDER.indexOf(finish) + 1)];
}

export function rollProtectedFinish(
  pity: CcgFinishPity,
  minimum: CcgFinish = "standard",
  random: (maximum: number) => number = randomInt,
): { finish: CcgFinish; pity: CcgFinishPity } {
  const next = emptyFinishPity();
  const hits: CcgProtectedFinish[] = [];
  for (const finish of Object.keys(CCG_FINISH_PITY_LIMITS) as CcgProtectedFinish[]) {
    const limit = CCG_FINISH_PITY_LIMITS[finish];
    const counter = Math.min(limit, Math.max(0, Math.floor(pity[finish])) + 1);
    next[finish] = counter;
    const roll = random(limit);
    if (!Number.isInteger(roll) || roll < 0 || roll >= limit) throw new Error("Random source returned an out-of-range value");
    if (roll < counter) hits.push(finish);
  }
  const rolled = hits.reduce<CcgFinish>((best, finish) => (compareFinish(finish, best) > 0 ? finish : best), "standard");
  const finish = compareFinish(minimum, rolled) > 0 ? minimum : rolled;
  if (finish !== "standard") next[finish] = 0;
  return { finish, pity: next };
}

export function selectWeighted<T extends string>(weights: Readonly<Record<T, number>>): T {
  const entries = (Object.entries(weights) as Array<[T, number]>).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) throw new Error("Weighted selection has no positive entries");
  let cursor = randomInt(total);
  for (const [value, weight] of entries) {
    if (cursor < weight) return value;
    cursor -= weight;
  }
  return entries[entries.length - 1][0];
}
