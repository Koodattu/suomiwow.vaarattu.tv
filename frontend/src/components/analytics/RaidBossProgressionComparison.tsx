"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRaidBossProgressionComparison } from "@/lib/queries";
import type { RaidBossProgressionComparisonRaid, RaidBossProgressionMilestone, RaidInfo, WeeklyProgressionEntry } from "@/types";

const LINE_COLORS = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#f97316",
  "#84cc16",
  "#818cf8",
  "#2dd4bf",
  "#e879f9",
];

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

type MilestoneKey = "clear" | "final" | `boss-${number}`;

interface SeriesEntry {
  raid: RaidBossProgressionComparisonRaid;
  milestone: RaidBossProgressionMilestone;
  dataKey: string;
  color: string;
  progression: WeeklyProgressionEntry[];
}

interface RaidBossProgressionComparisonProps {
  raids: RaidInfo[];
  enabled: boolean;
}

function buttonClass(active: boolean) {
  return `inline-flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-semibold transition-[background-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] ${
    active
      ? "bg-blue-600 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.35),0_10px_28px_rgba(37,99,235,0.18)]"
      : "bg-gray-950/70 text-gray-400 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-gray-800/80 hover:text-gray-100 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.13)]"
  }`;
}

function clampWeeklyProgression(weeklyData: WeeklyProgressionEntry[], raidStart?: string, raidEnd?: string): WeeklyProgressionEntry[] {
  if (!weeklyData || weeklyData.length === 0 || !raidStart || !raidEnd) return weeklyData;

  const startDate = new Date(raidStart);
  const endDate = new Date(raidEnd);
  const oneYearFromStart = new Date(startDate);
  oneYearFromStart.setFullYear(oneYearFromStart.getFullYear() + 1);

  if (endDate <= oneYearFromStart) return weeklyData;

  const now = new Date();
  const weeksElapsed = Math.max(1, Math.floor((now.getTime() - startDate.getTime()) / MS_PER_WEEK) + 1);

  return weeklyData.slice(0, weeksElapsed);
}

function getMilestone(raid: RaidBossProgressionComparisonRaid, milestoneKey: MilestoneKey): RaidBossProgressionMilestone | undefined {
  if (milestoneKey === "clear") {
    return raid.milestones.find((milestone) => milestone.type === "clear");
  }

  if (milestoneKey === "final") {
    return [...raid.milestones].reverse().find((milestone) => milestone.type === "boss" && milestone.isFinalBoss);
  }

  const bossIndex = Number(milestoneKey.replace("boss-", ""));
  return raid.milestones.find((milestone) => milestone.type === "boss" && milestone.bossIndex === bossIndex);
}

function getValueAtWeek(progression: WeeklyProgressionEntry[], weekNumber: number): number {
  let value = 0;

  for (const entry of progression) {
    if (entry.weekNumber > weekNumber) break;
    value = entry.value;
  }

  return value;
}

function getRaidShortName(raidName: string): string {
  return raidName
    .replace(/^The\s+/i, "")
    .replace(/,\s*the\s+/i, " ")
    .replace(/\s+of\s+the\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMilestoneDisplayName(milestone: RaidBossProgressionMilestone, fullClearLabel: string): string {
  return milestone.type === "clear" ? fullClearLabel : milestone.bossName;
}

export default function RaidBossProgressionComparison({ raids, enabled }: RaidBossProgressionComparisonProps) {
  const t = useTranslations("raidAnalyticsPage");
  const { data, isLoading, error } = useRaidBossProgressionComparison(enabled);
  const [milestoneKey, setMilestoneKey] = useState<MilestoneKey>("final");
  const [visibleRaidIds, setVisibleRaidIds] = useState<number[] | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const raidInfoById = useMemo(() => new Map(raids.map((raid) => [raid.id, raid])), [raids]);
  const comparisonRaids = data?.raids ?? [];

  const defaultVisibleRaidIds = useMemo(() => {
    const currentRaidIds = comparisonRaids.filter((raid) => raidInfoById.get(raid.raidId)?.isCurrent).map((raid) => raid.raidId);
    if (currentRaidIds.length > 0) return currentRaidIds;

    return comparisonRaids.slice(0, Math.min(6, comparisonRaids.length)).map((raid) => raid.raidId);
  }, [comparisonRaids, raidInfoById]);

  const activeRaidIds = visibleRaidIds ?? defaultVisibleRaidIds;
  const activeRaidIdSet = useMemo(() => new Set(activeRaidIds), [activeRaidIds]);
  const maxBosses = useMemo(() => comparisonRaids.reduce((max, raid) => Math.max(max, raid.totalBosses), 0), [comparisonRaids]);

  const milestoneOptions = useMemo(
    () => [
      { key: "clear" as const, label: t("fullClear") },
      { key: "final" as const, label: t("finalBoss") },
      ...Array.from({ length: maxBosses }, (_, index) => ({
        key: `boss-${index + 1}` as MilestoneKey,
        label: t("bossNumber", { number: index + 1 }),
      })),
    ],
    [maxBosses, t],
  );

  const allSeries = useMemo<SeriesEntry[]>(() => {
    return comparisonRaids
      .map((raid, index) => {
        const milestone = getMilestone(raid, milestoneKey);
        if (!milestone) return null;

        const progression = clampWeeklyProgression(milestone.weeklyProgression ?? [], raid.raidStart, raid.raidEnd);

        return {
          raid,
          milestone,
          dataKey: `raid_${raid.raidId}`,
          color: LINE_COLORS[index % LINE_COLORS.length],
          progression,
        };
      })
      .filter((series): series is SeriesEntry => Boolean(series));
  }, [comparisonRaids, milestoneKey]);

  const visibleSeries = useMemo(() => allSeries.filter((series) => activeRaidIdSet.has(series.raid.raidId)), [activeRaidIdSet, allSeries]);
  const maxWeek = useMemo(() => Math.max(1, ...visibleSeries.map((series) => series.progression.length)), [visibleSeries]);
  const activeWeek = Math.min(selectedWeek ?? maxWeek, maxWeek);

  const chartData = useMemo(() => {
    return Array.from({ length: maxWeek }, (_, index) => {
      const weekNumber = index + 1;
      const row: Record<string, number | string | undefined> = {
        weekNumber,
        label: `W${weekNumber}`,
      };

      for (const series of visibleSeries) {
        if (weekNumber <= series.progression.length) {
          row[series.dataKey] = getValueAtWeek(series.progression, weekNumber);
        }
      }

      return row;
    });
  }, [maxWeek, visibleSeries]);

  const selectedWeekValue = String(activeWeek);

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-900/60 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="text-sm text-gray-500">{t("loadingBossProgression")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-950/30 p-4 shadow-[0_0_0_1px_rgba(248,113,113,0.22)]">
        <div className="text-sm text-red-300">{t("failedToLoadBossProgression")}</div>
      </div>
    );
  }

  if (!data || comparisonRaids.length === 0) {
    return (
      <div className="rounded-lg bg-gray-900/60 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="text-sm text-gray-500">{t("noBossProgressionData")}</div>
      </div>
    );
  }

  const selectPreset = (preset: "current" | "recent" | "all") => {
    if (preset === "current") {
      const currentRaidIds = comparisonRaids.filter((raid) => raidInfoById.get(raid.raidId)?.isCurrent).map((raid) => raid.raidId);
      setVisibleRaidIds(currentRaidIds.length > 0 ? currentRaidIds : defaultVisibleRaidIds);
      return;
    }

    if (preset === "recent") {
      setVisibleRaidIds(comparisonRaids.slice(0, Math.min(6, comparisonRaids.length)).map((raid) => raid.raidId));
      return;
    }

    setVisibleRaidIds(comparisonRaids.map((raid) => raid.raidId));
  };

  const toggleRaid = (raidId: number) => {
    const nextIds = new Set(activeRaidIds);
    if (nextIds.has(raidId)) {
      nextIds.delete(raidId);
    } else {
      nextIds.add(raidId);
    }
    setVisibleRaidIds([...nextIds]);
  };

  const seriesByDataKey = new Map(visibleSeries.map((series) => [series.dataKey, series]));
  const fullClearLabel = t("fullClear");

  return (
    <section className="rounded-lg bg-gray-900/60 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white text-balance">{t("bossTimelineTitle")}</h2>
          <p className="mt-1 text-sm text-gray-500 text-pretty">{t("bossTimelineSubtitle")}</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t("milestone")}</span>
            <select
              value={milestoneKey}
              onChange={(event) => setMilestoneKey(event.target.value as MilestoneKey)}
              className="min-h-10 rounded-md bg-gray-950/80 px-3 text-sm font-semibold text-gray-100 shadow-[0_0_0_1px_rgba(255,255,255,0.1)] outline-none transition-[box-shadow] duration-150 ease-out focus-visible:shadow-[0_0_0_2px_rgba(96,165,250,0.65)]"
            >
              {milestoneOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t("week")}</span>
            <input
              type="range"
              min={1}
              max={maxWeek}
              value={selectedWeekValue}
              onChange={(event) => setSelectedWeek(Number(event.target.value))}
              className="h-10 w-48 accent-blue-500"
            />
          </label>
          <div className="flex min-h-10 items-center rounded-md bg-gray-950/70 px-3 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] tabular-nums">
            {t("weekNumber", { week: activeWeek })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={buttonClass(activeRaidIds.length === defaultVisibleRaidIds.length && activeRaidIds.every((id) => defaultVisibleRaidIds.includes(id)))} onClick={() => selectPreset("current")}>
          {t("currentRaids")}
        </button>
        <button type="button" className={buttonClass(activeRaidIds.length === Math.min(6, comparisonRaids.length) && activeRaidIds.every((id) => comparisonRaids.slice(0, Math.min(6, comparisonRaids.length)).some((raid) => raid.raidId === id)))} onClick={() => selectPreset("recent")}>
          {t("recentRaids")}
        </button>
        <button type="button" className={buttonClass(activeRaidIds.length === comparisonRaids.length)} onClick={() => selectPreset("all")}>
          {t("allRaids")}
        </button>
      </div>

      <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
        {allSeries.map((series) => {
          const active = activeRaidIdSet.has(series.raid.raidId);
          return (
            <button
              key={series.raid.raidId}
              type="button"
              aria-pressed={active}
              onClick={() => toggleRaid(series.raid.raidId)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-xs font-semibold transition-[background-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] ${
                active
                  ? "bg-gray-800 text-gray-100 shadow-[0_0_0_1px_rgba(255,255,255,0.13)]"
                  : "bg-gray-950/55 text-gray-500 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] hover:bg-gray-900 hover:text-gray-300"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} aria-hidden="true" />
              <span className="max-w-36 truncate">{getRaidShortName(series.raid.raidName)}</span>
            </button>
          );
        })}
      </div>

      {visibleSeries.length === 0 ? (
        <div className="mt-4 rounded-md bg-gray-950/60 px-4 py-8 text-center text-sm text-gray-500 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          {t("selectAtLeastOneRaid")}
        </div>
      ) : (
        <>
          <div className="mt-4 h-80 min-h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
                onMouseMove={(state) => {
                  const activeIndex = Number(state?.activeTooltipIndex);
                  const weekNumber = Number(Number.isInteger(activeIndex) ? chartData[activeIndex]?.weekNumber : undefined);
                  if (Number.isFinite(weekNumber) && weekNumber > 0) {
                    setSelectedWeek(weekNumber);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.28} />
                <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} allowDecimals={false} width={34} />
                <Tooltip
                  cursor={{ stroke: "#94A3B8", strokeOpacity: 0.35 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;

                    const items = payload
                      .map((item) => {
                        const dataKey = String(item.dataKey);
                        const series = seriesByDataKey.get(dataKey);
                        if (!series || typeof item.value !== "number") return null;

                        return {
                          series,
                          value: item.value,
                        };
                      })
                      .filter((item): item is { series: SeriesEntry; value: number } => Boolean(item))
                      .sort((a, b) => b.value - a.value);

                    if (items.length === 0) return null;

                    return (
                      <div className="max-w-sm rounded-md bg-gray-950 px-3 py-2 text-xs shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_18px_50px_rgba(0,0,0,0.45)]">
                        <div className="font-bold text-white">{label}</div>
                        <div className="mt-2 max-h-60 space-y-1 overflow-y-auto pr-1">
                          {items.map(({ series, value }) => (
                            <div key={series.raid.raidId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                              <div className="min-w-0">
                                <div className="truncate text-gray-200">{series.raid.raidName}</div>
                                <div className="truncate text-[10px] text-gray-500">{getMilestoneDisplayName(series.milestone, fullClearLabel)}</div>
                              </div>
                              <div className="text-right font-semibold text-blue-300 tabular-nums">{value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }}
                />
                {visibleSeries.map((series) => (
                  <Line
                    key={series.dataKey}
                    type="monotone"
                    dataKey={series.dataKey}
                    stroke={series.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-x-auto rounded-md bg-gray-950/45 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-gray-500">
                  <th className="sticky left-0 z-10 bg-gray-950/95 px-3 py-2 font-semibold">{t("raidTier")}</th>
                  {Array.from({ length: maxBosses }, (_, index) => (
                    <th key={index + 1} className="px-2 py-2 text-right font-semibold">
                      {t("bossShort", { number: index + 1 })}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-semibold">{t("clearShort")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleSeries.map((series) => {
                  const clearMilestone = getMilestone(series.raid, "clear");

                  return (
                    <tr key={series.raid.raidId} className="border-t border-white/[0.06]">
                      <td className="sticky left-0 z-10 max-w-64 bg-gray-950/95 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: series.color }} />
                          <span className="truncate font-semibold text-gray-200">{series.raid.raidName}</span>
                        </div>
                      </td>
                      {Array.from({ length: maxBosses }, (_, index) => {
                        const milestone = getMilestone(series.raid, `boss-${index + 1}`);
                        const progression = milestone ? clampWeeklyProgression(milestone.weeklyProgression ?? [], series.raid.raidStart, series.raid.raidEnd) : [];
                        const value = milestone ? getValueAtWeek(progression, activeWeek) : null;

                        return (
                          <td key={index + 1} className="px-2 py-2 text-right text-gray-300 tabular-nums" title={milestone ? getMilestoneDisplayName(milestone, fullClearLabel) : undefined}>
                            {value === null ? <span className="text-gray-700">-</span> : value}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right font-semibold text-green-300 tabular-nums">
                        {clearMilestone ? getValueAtWeek(clampWeeklyProgression(clearMilestone.weeklyProgression ?? [], series.raid.raidStart, series.raid.raidEnd), activeWeek) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
