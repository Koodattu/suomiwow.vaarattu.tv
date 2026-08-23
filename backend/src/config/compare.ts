export const COMPARE_DIFFICULTIES = ["mythic", "heroic"] as const;

export type CompareDifficulty = (typeof COMPARE_DIFFICULTIES)[number];
