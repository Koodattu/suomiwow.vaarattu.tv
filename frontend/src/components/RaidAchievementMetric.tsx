"use client";

import { useId } from "react";
import type { CharacterRaidAchievementEntry, CharacterRaidAchievementType } from "@/types";

function formatShortDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "-";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

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
    <div className="min-w-16">
      <div className="text-gray-500">{shortTitle}</div>
      <div className="group relative inline-block rounded-sm focus-within:outline focus-within:outline-2 focus-within:outline-blue-400">
        <div
          className={`text-xl font-bold tabular-nums text-gray-100 md:text-2xl ${hasAchievements ? "cursor-help group-hover:text-white" : ""}`}
          tabIndex={hasAchievements ? 0 : undefined}
          aria-describedby={hasAchievements ? tooltipId : undefined}
          aria-label={tooltipText}
        >
          {count ?? "-"}
        </div>
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
    </div>
  );
}
