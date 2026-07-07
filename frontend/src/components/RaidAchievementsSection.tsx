"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { CharacterRaidAchievementEntry, CharacterRaidAchievementSummary, CharacterRaidAchievementType } from "@/types";

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

function getAchievementTooltipText(title: string, achievements: CharacterRaidAchievementEntry[]) {
  if (!achievements.length) return title;

  return [title, ...achievements.map((achievement) => `${achievement.name} (${formatShortDate(achievement.completedAt)})`)].join("\n");
}

export function RaidAchievementMetric({
  type,
  title,
  shortTitle,
  count,
  achievements,
}: {
  type: CharacterRaidAchievementType;
  title: string;
  shortTitle: string;
  count: number | null | undefined;
  achievements: CharacterRaidAchievementEntry[];
}) {
  const hasAchievements = achievements.length > 0;
  const tooltipId = `${useId()}-${type}-achievements-tooltip`;
  const tooltipText = getAchievementTooltipText(title, achievements);

  return (
    <div
      className="group relative min-w-16 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
      tabIndex={hasAchievements ? 0 : undefined}
      aria-describedby={hasAchievements ? tooltipId : undefined}
      aria-label={tooltipText}
    >
      <div className="text-gray-500">{shortTitle}</div>
      <div className={`text-xl font-bold tabular-nums text-gray-100 md:text-2xl ${hasAchievements ? "cursor-help group-hover:text-white" : ""}`}>{count ?? "-"}</div>
      {hasAchievements ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-72 translate-y-1 rounded-md bg-gray-950 px-3 py-2 text-left text-xs leading-snug text-gray-200 opacity-0 shadow-xl ring-1 ring-white/10 transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 sm:w-80"
        >
          <div className="font-semibold text-gray-100">{title}</div>
          <div className="mt-2 space-y-1">
            {achievements.map((achievement) => (
              <div key={achievement.achievementId} className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-gray-300">{achievement.name}</span>
                <span className="shrink-0 tabular-nums text-gray-500">{formatShortDate(achievement.completedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function RaidAchievementsSection({
  summary,
  missingCharacterCount = 0,
}: {
  summary: CharacterRaidAchievementSummary | null;
  missingCharacterCount?: number;
}) {
  const t = useTranslations("raidAchievements");
  const achievements = summary?.achievements ?? [];
  const groups: RaidAchievementGroup[] = [
    {
      type: "cutting_edge" as const,
      title: t("cuttingEdge"),
      achievements: achievements.filter((achievement) => achievement.type === "cutting_edge"),
    },
    {
      type: "ahead_of_the_curve" as const,
      title: t("aheadOfTheCurve"),
      achievements: achievements.filter((achievement) => achievement.type === "ahead_of_the_curve"),
    },
  ].sort((a, b) => achievementTypeOrder(a.type) - achievementTypeOrder(b.type));
  const hasDetailState = !summary || summary.totalCount === 0;

  return (
    <section className="rounded-lg border border-gray-700 bg-gray-900">
      <div className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${hasDetailState ? "border-b border-gray-700" : ""}`}>
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
          {groups.map((group) => (
            <RaidAchievementMetric
              key={group.type}
              type={group.type}
              title={group.title}
              shortTitle={group.type === "cutting_edge" ? t("cuttingEdgeShort") : t("aheadOfTheCurveShort")}
              count={group.type === "cutting_edge" ? summary?.cuttingEdgeCount : summary?.aheadOfTheCurveCount}
              achievements={group.achievements}
            />
          ))}
        </div>
      </div>

      {!summary ? (
        <div className="px-4 py-8 text-center text-gray-400">{t("notFetchedDetail")}</div>
      ) : summary.totalCount === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400">{t("noneFound")}</div>
      ) : null}
    </section>
  );
}
