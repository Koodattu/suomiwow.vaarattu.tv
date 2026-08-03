import type { CcgFinish } from "@/types";
import { CCG_RAID_FINISHES } from "@/lib/ccg";

export const CCG_STUDIO_PRODUCTION_FINISHES = [
  "standard",
  "foil",
  "golden",
  "prismatic",
  "holographic",
  "negative",
  "void",
  "toxic",
  ...CCG_RAID_FINISHES,
] as const satisfies readonly CcgFinish[];

export const CCG_STUDIO_EXISTING_DEVELOPMENT_FINISHES = [
  "rainbow",
  "kaleidoscope",
  "disco",
  "cosmos",
  "galaxy",
  "astral",
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

export const CCG_RAID_PREVIEW_FINISHES = CCG_RAID_FINISHES;

export const CCG_STUDIO_DEVELOPMENT_FINISHES = CCG_STUDIO_EXISTING_DEVELOPMENT_FINISHES;

export type CcgRaidPreviewFinish = (typeof CCG_RAID_PREVIEW_FINISHES)[number];
export type CcgStudioDevelopmentFinish = (typeof CCG_STUDIO_DEVELOPMENT_FINISHES)[number];
export type CcgPreviewFinish = CcgFinish | CcgStudioDevelopmentFinish;

const raidPreviewFinishSet = new Set<string>(CCG_RAID_PREVIEW_FINISHES);

export function isCcgRaidPreviewFinish(finish: CcgPreviewFinish): finish is CcgRaidPreviewFinish {
  return raidPreviewFinishSet.has(finish);
}
