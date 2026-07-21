import { createHash, randomInt } from "crypto";
import {
  CCG_FINISH_ODDS,
  CCG_GRADING_VERSION,
  CcgBackgroundSafeCrop,
  CcgFinish,
  CcgTierGrade,
} from "../config/ccg";

export type CcgResolvedCrop = { x: number; y: number; scale: number };

export function gradeForPercentile(index: number, populationSize: number): CcgTierGrade {
  if (populationSize <= 0 || index < 0 || index >= populationSize) throw new Error("Invalid grading population index");
  const percentile = (index + 1) / populationSize;
  if (percentile <= 0.01) return "Crown";
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

export function rollFinish(roll: number = randomInt(10000)): CcgFinish {
  if (roll < CCG_FINISH_ODDS.prismaticBasisPoints) return "prismatic";
  if (roll < CCG_FINISH_ODDS.prismaticBasisPoints + CCG_FINISH_ODDS.goldenBasisPoints) return "golden";
  return "standard";
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
