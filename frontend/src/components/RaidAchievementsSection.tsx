"use client";

import { useTranslations } from "next-intl";
import { CharacterRaidAchievementSummary, CharacterRaidAchievementType } from "@/types";

function formatShortDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "-";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function achievementTypeOrder(type: CharacterRaidAchievementType) {
  return type === "cutting_edge" ? 0 : 1;
}

type RaidAchievementGroup = {
  type: CharacterRaidAchievementType;
  title: string;
  achievements: CharacterRaidAchievementSummary["achievements"];
};

export default function RaidAchievementsSection({
  summary,
  missingCharacterCount = 0,
}: {
  summary: CharacterRaidAchievementSummary | null;
  missingCharacterCount?: number;
}) {
  const t = useTranslations("raidAchievements");
  const groups: RaidAchievementGroup[] = summary
    ? [
        {
          type: "cutting_edge" as const,
          title: t("cuttingEdge"),
          achievements: summary.achievements.filter((achievement) => achievement.type === "cutting_edge"),
        },
        {
          type: "ahead_of_the_curve" as const,
          title: t("aheadOfTheCurve"),
          achievements: summary.achievements.filter((achievement) => achievement.type === "ahead_of_the_curve"),
        },
      ].sort((a, b) => achievementTypeOrder(a.type) - achievementTypeOrder(b.type))
    : [];

  return (
    <section className="rounded-lg border border-gray-700 bg-gray-900">
      <div className="flex flex-col gap-3 border-b border-gray-700 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{t("title")}</h2>
          <p className="text-sm text-gray-400">
            {summary
              ? missingCharacterCount > 0
                ? t("partialSubtitle", { updatedAt: formatShortDate(summary.fetchedAt), count: missingCharacterCount })
                : t("subtitle", { updatedAt: formatShortDate(summary.fetchedAt) })
              : t("notFetched")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-right text-sm">
          <div>
            <div className="text-gray-500">{t("cuttingEdgeShort")}</div>
            <div className="text-xl font-bold tabular-nums text-gray-100">{summary?.cuttingEdgeCount ?? "-"}</div>
          </div>
          <div>
            <div className="text-gray-500">{t("aheadOfTheCurveShort")}</div>
            <div className="text-xl font-bold tabular-nums text-gray-100">{summary?.aheadOfTheCurveCount ?? "-"}</div>
          </div>
        </div>
      </div>

      {!summary ? (
        <div className="px-4 py-8 text-center text-gray-400">{t("notFetchedDetail")}</div>
      ) : summary.totalCount === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400">{t("noneFound")}</div>
      ) : (
        <div className="grid gap-0 md:grid-cols-2">
          {groups.map((group) => (
            <div key={group.type} className="border-b border-gray-800 p-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-gray-100">{group.title}</h3>
                <span className="text-sm font-semibold tabular-nums text-gray-400">{group.achievements.length}</span>
              </div>
              {group.achievements.length ? (
                <div className="space-y-2">
                  {group.achievements.map((achievement) => (
                    <div key={achievement.achievementId} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-gray-300" title={achievement.name}>
                        {achievement.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-gray-500">{formatShortDate(achievement.completedAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">{t("noneForType")}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
