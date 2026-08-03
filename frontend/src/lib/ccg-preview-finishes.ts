import type { CcgFinish } from "@/types";

export const CCG_STUDIO_PRODUCTION_FINISHES = [
  "standard",
  "foil",
  "golden",
  "prismatic",
  "holographic",
  "negative",
  "void",
  "toxic",
] as const satisfies readonly CcgFinish[];

export const CCG_STUDIO_EXISTING_DEVELOPMENT_FINISHES = [
  "rainbow",
  "kaleidoscope",
  "disco",
  "cosmos",
  "galaxy",
  "radiant",
  "chromaflow",
  "dark",
  "eclipse",
  "paradox",
  "anomaly",
  "infinite",
  "transcendent",
  "singularity",
  "metamorphic",
  "parallax",
  "neon",
] as const;

export const CCG_RAID_PREVIEW_FINISHES = [
  "relic",
  "slagforged",
  "felscorched",
  "nightmare",
  "nightwell",
  "moonfall",
  "worldcore",
  "quarantine",
  "tempest",
  "abyssal",
  "empire",
  "sanguine",
  "runebound",
  "progenitor",
  "primalstorm",
  "shadowflame",
  "emberbloom",
  "royal",
  "jackpot",
  "phaseglass",
] as const;

export const CCG_STUDIO_DEVELOPMENT_FINISHES = [
  ...CCG_STUDIO_EXISTING_DEVELOPMENT_FINISHES,
  ...CCG_RAID_PREVIEW_FINISHES,
] as const;

export type CcgRaidPreviewFinish = (typeof CCG_RAID_PREVIEW_FINISHES)[number];
export type CcgStudioDevelopmentFinish = (typeof CCG_STUDIO_DEVELOPMENT_FINISHES)[number];
export type CcgPreviewFinish = CcgFinish | CcgStudioDevelopmentFinish;

const raidPreviewFinishSet = new Set<string>(CCG_RAID_PREVIEW_FINISHES);

export function isCcgRaidPreviewFinish(finish: CcgPreviewFinish): finish is CcgRaidPreviewFinish {
  return raidPreviewFinishSet.has(finish);
}
