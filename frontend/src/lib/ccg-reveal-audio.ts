import { isCcgRaidFinish } from "@/lib/ccg";
import type { CcgArtVariant, CcgFinish, CcgTierGrade } from "@/types";

export const CCG_CARD_SLIDE_SOUNDS = Array.from({ length: 8 }, (_, index) => `/ccg/audio/card-slide-${index + 1}.mp3`);

export const CCG_QUALITY_SOUND_FILES: Partial<Record<CcgFinish, string>> = {
  standard: "1-standard.mp3",
  foil: "2-foil.mp3",
  golden: "3-golden.mp3",
  prismatic: "4-prismatic.mp3",
  holographic: "5-holographic.mp3",
  void: "7-void.mp3",
  negative: "6-negative.mp3",
};

const CCG_STANDARD_QUALITY_SOUND_GRADES = new Set<CcgTierGrade>(["H", "S", "A", "B", "C", "D"]);
const CCG_UNIQUE_QUALITY_SOUND_FILE = "10-unique.mp3";

export function getCcgQualityRevealSoundFile(
  finish: CcgFinish,
  artVariant: CcgArtVariant = "standard",
): string | undefined {
  return artVariant === "alternative" || isCcgRaidFinish(finish)
    ? CCG_UNIQUE_QUALITY_SOUND_FILE
    : CCG_QUALITY_SOUND_FILES[finish];
}

export function hasCcgQualityRevealSound(
  finish: CcgFinish,
  tierGrade: CcgTierGrade,
  artVariant: CcgArtVariant = "standard",
): boolean {
  const unique = artVariant === "alternative" || isCcgRaidFinish(finish);
  return Boolean(getCcgQualityRevealSoundFile(finish, artVariant))
    && (unique || finish !== "standard" || CCG_STANDARD_QUALITY_SOUND_GRADES.has(tierGrade));
}
