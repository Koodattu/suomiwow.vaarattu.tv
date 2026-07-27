import type { CcgFinish, CcgTierGrade } from "@/types";

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

const CCG_STANDARD_QUALITY_SOUND_GRADES = new Set<CcgTierGrade>(["S", "A", "B", "C", "D"]);

export function hasCcgQualityRevealSound(finish: CcgFinish, tierGrade: CcgTierGrade): boolean {
  return Boolean(CCG_QUALITY_SOUND_FILES[finish]) && (finish !== "standard" || CCG_STANDARD_QUALITY_SOUND_GRADES.has(tierGrade));
}
