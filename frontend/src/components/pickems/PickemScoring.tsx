"use client";

import { useTranslations } from "next-intl";
import type { LeaderboardEntry } from "@/types";
import { getPickemScoreRows, type PickemScoringRuleset } from "../../lib/pickem-score-rows";

export function PickemScoringRules({ pickem }: { pickem: PickemScoringRuleset }) {
  const t = useTranslations("pickemsPage");
  const { scoringConfig, streakConfig } = pickem;
  const unscored = pickem.type === "regular" && !pickem.scoreOutOfRangeGuilds
    ? t("scoring.outsideTop", { count: pickem.guildCount })
    : t("scoring.unranked");
  const positionRules: [string, number, string][] | undefined = scoringConfig && [
    [t("scoring.exact"), scoringConfig.exactMatch, "text-green-400"],
    [t("scoring.offBy", { count: 1 }), scoringConfig.offByOne, "text-yellow-400"],
    [t("scoring.offBy", { count: 2 }), scoringConfig.offByTwo, "text-orange-400"],
    [t("scoring.offBy", { count: 3 }), scoringConfig.offByThree, "text-orange-500"],
    [t("scoring.offBy", { count: 4 }), scoringConfig.offByFour, "text-red-400"],
    [scoringConfig.offByFiveOrMore === 0 ? t("scoring.offByFiveOrUnscored", { unscored }) : t("scoring.offByFiveOrMore"), scoringConfig.offByFiveOrMore, "text-gray-400"],
    ...(scoringConfig.offByFiveOrMore !== 0 ? [[unscored, 0, "text-gray-400"] as [string, number, string]] : []),
  ];

  return (
    <details className="group mb-3 overflow-hidden rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-left hover:bg-gray-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400">
        <span className="text-sm font-semibold text-gray-300">{t("scoringSystem")}</span>
        <svg aria-hidden="true" className="h-4 w-4 text-gray-400 transition-transform motion-reduce:transition-none group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="space-y-1.5 border-t border-gray-700 px-4 py-3 text-xs text-gray-400">
        {positionRules ? positionRules.map(([label, points, color]) => (
          <p key={label}>• <strong className={color}>{t("scoring.points", { count: points })}:</strong> {label}</p>
        )) : <p>{t("scoring.unavailable")}</p>}
        {streakConfig && <p>• {streakConfig.enabled ? <>
          <strong className="text-emerald-400">{t("scoring.streakPoints", { count: streakConfig.bonusPerGuild })}:</strong>{" "}
          {streakConfig.rule === "exact-consecutive-v1"
            ? t("scoring.exactStreakRule", { count: Math.max(2, streakConfig.minStreak) })
            : t("scoring.streakRule", { count: streakConfig.minStreak })}
        </> : t("scoring.streakDisabled")}</p>}
      </div>
    </details>
  );
}

export function PickemScoreBreakdown({ entry, pickem, scoresPending }: { entry: LeaderboardEntry; pickem: PickemScoringRuleset; scoresPending: boolean }) {
  const t = useTranslations("pickemsPage");
  const scoreRows = scoresPending ? null : getPickemScoreRows(entry, pickem);
  const rows = scoreRows ?? entry.predictions.map((prediction) => ({ prediction, streakBonus: 0, total: 0 }));

  return (
    <div className="mt-1.5 border-t border-gray-700/50 px-2.5 pb-2.5 pt-1">
      <table className="w-full table-fixed text-xs tabular-nums">
        <thead>
          <tr className="text-gray-400">
            <th scope="col" className="py-1 text-left font-normal">{t("scoring.pickColumn")}</th>
            {!scoresPending && <th scope="col" className="w-12 py-1 text-right font-normal">{t("scoring.pointsColumn")}</th>}
            {scoreRows && <>
              <th scope="col" className="w-12 py-1 text-right font-normal" title={t("scoring.runningTotal")}>{t("scoring.total")}</th>
              <th scope="col" className="w-14 py-1 text-right font-normal">{t("scoring.streakColumn")}</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ prediction: pred, streakBonus, total }) => {
            const difference = pred.actualRank === null ? null : Math.abs(pred.actualRank - pred.predictedRank);
            const color = pred.points === 0 ? "bg-red-600" : difference === 0 ? "bg-green-600" : difference !== null && difference <= 2 ? "bg-yellow-600" : "bg-orange-600";
            return (
              <tr key={`${pred.guildName}-${pred.predictedRank}`} className="text-gray-300">
                <td className="py-0.5">
                  <div className="flex min-w-0 gap-1"><span className="shrink-0 text-gray-500">#{pred.predictedRank}:</span><span className="truncate" title={pred.guildName}>{pred.guildName}</span></div>
                </td>
                {!scoresPending && <td className="py-0.5 text-right"><span className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 font-bold text-white ${color}`}>{pred.points}</span></td>}
                {scoreRows && <>
                  <td className="py-0.5 text-right font-medium text-blue-400">{total}</td>
                  <td className={`py-0.5 text-right ${streakBonus ? "text-emerald-400" : "text-gray-500"}`}>{streakBonus ? `+${streakBonus}` : "—"}</td>
                </>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
