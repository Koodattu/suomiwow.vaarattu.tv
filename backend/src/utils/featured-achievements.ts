export type FeaturedAchievementType = "cutting_edge" | "ahead_of_the_curve";

export interface FeaturedAchievementCatalogRow {
  id: number;
  name: string;
}

export interface FeaturedAchievementTarget extends FeaturedAchievementCatalogRow {
  type: FeaturedAchievementType;
}

export interface BlizzardAchievementSummaryRow {
  id?: unknown;
  achievement?: {
    id?: unknown;
    name?: unknown;
  };
  completed_timestamp?: unknown;
}

export interface BlizzardAchievementSummaryLike {
  achievements?: BlizzardAchievementSummaryRow[];
}

export interface CompletedFeaturedAchievement {
  achievementId: number;
  name: string;
  type: FeaturedAchievementType;
  completedTimestamp: number;
  completedAt: Date;
}

const CUTTING_EDGE_PREFIX = "cutting edge:";
const AHEAD_OF_THE_CURVE_PREFIX = "ahead of the curve:";

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function classifyFeaturedAchievementName(name: string): FeaturedAchievementType | null {
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName.startsWith(CUTTING_EDGE_PREFIX)) return "cutting_edge";
  if (normalizedName.startsWith(AHEAD_OF_THE_CURVE_PREFIX)) return "ahead_of_the_curve";
  return null;
}

export function buildFeaturedAchievementTargets(catalogRows: FeaturedAchievementCatalogRow[]): FeaturedAchievementTarget[] {
  return catalogRows
    .map((row): FeaturedAchievementTarget | null => {
      const type = classifyFeaturedAchievementName(row.name);
      if (!type) return null;
      return {
        id: row.id,
        name: row.name,
        type,
      };
    })
    .filter((row): row is FeaturedAchievementTarget => row !== null)
    .sort((a, b) => a.id - b.id);
}

export function extractCompletedFeaturedAchievements(
  summary: BlizzardAchievementSummaryLike,
  targets: FeaturedAchievementTarget[],
): CompletedFeaturedAchievement[] {
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const completedById = new Map<number, CompletedFeaturedAchievement>();

  for (const achievement of summary.achievements ?? []) {
    const achievementId = toFiniteNumber(achievement.id ?? achievement.achievement?.id, 0);
    const completedTimestamp = toFiniteNumber(achievement.completed_timestamp, 0);
    const target = targetById.get(achievementId);
    if (!target || completedTimestamp <= 0) continue;

    const completedAt = new Date(completedTimestamp);
    if (Number.isNaN(completedAt.getTime())) continue;

    const existing = completedById.get(achievementId);
    if (existing && existing.completedTimestamp <= completedTimestamp) continue;

    completedById.set(achievementId, {
      achievementId,
      name: target.name,
      type: target.type,
      completedTimestamp,
      completedAt,
    });
  }

  return Array.from(completedById.values()).sort(
    (a, b) => a.completedTimestamp - b.completedTimestamp || a.achievementId - b.achievementId,
  );
}

export function countFeaturedAchievements(achievements: CompletedFeaturedAchievement[]): {
  cuttingEdgeCount: number;
  aheadOfTheCurveCount: number;
  totalCount: number;
} {
  const cuttingEdgeCount = achievements.filter((achievement) => achievement.type === "cutting_edge").length;
  const aheadOfTheCurveCount = achievements.filter((achievement) => achievement.type === "ahead_of_the_curve").length;

  return {
    cuttingEdgeCount,
    aheadOfTheCurveCount,
    totalCount: cuttingEdgeCount + aheadOfTheCurveCount,
  };
}
