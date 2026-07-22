import type { CcgTierGrade } from "@/types";

export function normalizeCcgTierGrade(grade: CcgTierGrade | "Crown"): CcgTierGrade {
  return grade === "Crown" ? "S" : grade;
}
