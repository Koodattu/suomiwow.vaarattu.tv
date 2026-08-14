"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import GuildCrest from "@/components/GuildCrest";
import IconImage from "@/components/IconImage";
import RaidSelector from "@/components/RaidSelector";
import { useRaidCompare, useRaids } from "@/lib/queries";
import { getLeaderboardRankColor, getWorldRankColor } from "@/lib/utils";
import { CompareGuildBossMetric, CompareGuildMetric, RaidCompare } from "@/types";

type ViewMode = "table" | "visual";

type MetricEntry = {
  guild: CompareGuildMetric;
  value: number;
};

type MetricOption = {
  id: string;
  label: string;
  subtitle?: string;
  entries: MetricEntry[];
  valueFormatter: (value: number) => string;
};

type SortDirection = "asc" | "desc";

type SortState = {
  key: string;
  direction: SortDirection;
} | null;

type CompareBossAverage = {
  pulls: number | null;
  timeSpent: number | null;
};

type CompareTableAverages = {
  totalPulls: number | null;
  progressTime: number | null;
  progressRaidTime: number | null;
  bosses: Map<number, CompareBossAverage>;
};

type MetricPointShapeProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: {
    guildName: string;
    valueLabel: string;
  };
};

function formatTime(seconds: number): string {
  if (!seconds) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatNumber(value?: number): string {
  if (!value) return "-";
  return value.toLocaleString("en-US");
}

function formatAverageNumber(value?: number | null): string {
  if (!value) return "-";
  return Math.round(value).toLocaleString("en-US");
}

function formatAverageTime(value?: number | null): string {
  if (!value) return "-";
  return formatTime(Math.round(value));
}

function formatChartNumber(value?: number): string {
  if (!value) return "-";
  return String(Math.round(value));
}

function guildHref(guild: CompareGuildMetric): string {
  return `/guilds/${encodeURIComponent(guild.realm)}/${encodeURIComponent(guild.name)}`;
}

function bossMetric(guild: CompareGuildMetric, bossId: number) {
  return guild.bosses.find((boss) => boss.bossId === bossId);
}

function isFullClear(guild: CompareGuildMetric): boolean {
  return guild.totalBosses > 0 && guild.bossesDefeated >= guild.totalBosses;
}

function averagePositiveValues(values: number[]): number | null {
  const validValues = values.filter((value) => Number.isFinite(value) && value > 0);
  if (validValues.length === 0) return null;
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function calculateCompareTableAverages(compare: RaidCompare): CompareTableAverages {
  const clearedGuilds = compare.guilds.filter(isFullClear);
  const bosses = new Map<number, CompareBossAverage>();

  for (const boss of compare.raid.bosses) {
    const killedMetrics = compare.guilds
      .map((guild) => bossMetric(guild, boss.id))
      .filter((metric): metric is CompareGuildBossMetric => !!metric && metric.kills > 0);

    bosses.set(boss.id, {
      pulls: averagePositiveValues(killedMetrics.map((metric) => metric.pulls)),
      timeSpent: averagePositiveValues(killedMetrics.map((metric) => metric.timeSpent)),
    });
  }

  return {
    totalPulls: averagePositiveValues(clearedGuilds.map((guild) => guild.totalPulls)),
    progressTime: averagePositiveValues(clearedGuilds.map((guild) => guild.totalTimeSpent)),
    progressRaidTime: averagePositiveValues(clearedGuilds.map((guild) => guild.progressRaidTimeSpent)),
    bosses,
  };
}

function defaultGuildCompare(a: CompareGuildMetric, b: CompareGuildMetric): number {
  const rankCompare = (a.guildRank ?? 99999) - (b.guildRank ?? 99999);
  if (rankCompare !== 0) return rankCompare;
  return a.name.localeCompare(b.name);
}

function getTableSortValue(guild: CompareGuildMetric, key: string): string | number | null {
  if (key === "guild") return guild.name.toLowerCase();
  if (key === "rank") return guild.guildRank ?? null;
  if (key === "worldRank") return guild.worldRank ?? null;
  if (key === "progress") return guild.totalBosses > 0 ? guild.bossesDefeated : null;
  if (key === "totalPulls") return guild.totalPulls > 0 ? guild.totalPulls : null;
  if (key === "progressTime") return guild.totalTimeSpent > 0 ? guild.totalTimeSpent : null;
  if (key === "progressRaidTime") return guild.progressRaidTimeSpent > 0 ? guild.progressRaidTimeSpent : null;

  const bossMatch = key.match(/^boss:(\d+):(pulls|time)$/);
  if (!bossMatch) return null;

  const boss = bossMetric(guild, Number(bossMatch[1]));
  const value = bossMatch[2] === "pulls" ? boss?.pulls : boss?.timeSpent;
  return value && value > 0 ? value : null;
}

function sortGuildsForTable(guilds: CompareGuildMetric[], sort: SortState): CompareGuildMetric[] {
  if (!sort) return guilds;

  return [...guilds].sort((a, b) => {
    const aValue = getTableSortValue(a, sort.key);
    const bValue = getTableSortValue(b, sort.key);
    const aMissing = aValue === null || aValue === undefined || aValue === "";
    const bMissing = bValue === null || bValue === undefined || bValue === "";

    if (aMissing && bMissing) return defaultGuildCompare(a, b);
    if (aMissing) return 1;
    if (bMissing) return -1;

    let result = 0;
    if (typeof aValue === "string" && typeof bValue === "string") {
      result = aValue.localeCompare(bValue);
    } else {
      result = Number(aValue) - Number(bValue);
    }

    if (result === 0) return defaultGuildCompare(a, b);
    return sort.direction === "asc" ? result : -result;
  });
}

function getGuildColor(rank?: number): string {
  if (rank === 1) return "#facc15";
  if (rank === 2) return "#d1d5db";
  if (rank === 3) return "#fb923c";
  return "#60a5fa";
}

function assignClusteredLanes(entries: MetricEntry[], lanes: number): Map<string, number> {
  const laneByGuildId = new Map<string, number>();
  if (entries.length === 0) return laneByGuildId;

  const values = entries.map((entry) => entry.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const clusterGap = Math.max((max - min) * 0.065, 1);
  const primaryLanes = [2, 4, 6, 8, 10, 12].filter((lane) => lane <= lanes);
  const secondaryLanes = [1, 3, 5, 7, 9, 11].filter((lane) => lane <= lanes);

  const laneSequenceForCluster = (clusterIndex: number) => {
    const first = clusterIndex % 2 === 0 ? primaryLanes : secondaryLanes;
    const second = clusterIndex % 2 === 0 ? secondaryLanes : primaryLanes;
    return [...first, ...second];
  };

  let currentCluster: MetricEntry[] = [];
  let previousValue = entries[0].value;
  let clusterIndex = 0;

  const flushCluster = () => {
    const sequence = laneSequenceForCluster(clusterIndex);
    currentCluster.forEach((entry, index) => {
      laneByGuildId.set(entry.guild.id, sequence[index % sequence.length] ?? ((index % lanes) + 1));
    });
    currentCluster = [];
    clusterIndex++;
  };

  for (const entry of entries) {
    if (currentCluster.length > 0 && entry.value - previousValue > clusterGap) {
      flushCluster();
    }

    currentCluster.push(entry);
    previousValue = entry.value;
  }

  if (currentCluster.length > 0) {
    flushCluster();
  }

  return laneByGuildId;
}

function MetricPointShape({ cx = 0, cy = 0, payload }: MetricPointShapeProps) {
  return (
    <g>
      <text x={cx} y={cy - 3} textAnchor="middle" fill="#e5e7eb" fontSize={10} fontWeight={600} stroke="#0f172a" strokeWidth={3} paintOrder="stroke">
        {payload?.guildName ?? ""}
      </text>
      <text x={cx} y={cy + 9} textAnchor="middle" fill="#93c5fd" fontSize={10} fontWeight={700} stroke="#0f172a" strokeWidth={3} paintOrder="stroke">
        {payload?.valueLabel ?? ""}
      </text>
    </g>
  );
}

function MetricScatterChart({
  title,
  subtitle,
  entries,
  valueFormatter,
  emptyLabel,
  iconUrl,
  iconAlt,
}: {
  title: string;
  subtitle?: string;
  entries: MetricEntry[];
  valueFormatter: (value: number) => string;
  emptyLabel: string;
  iconUrl?: string;
  iconAlt?: string;
}) {
  const visibleEntries = entries.filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
  const valueSortedEntries = [...visibleEntries].sort((a, b) => a.value - b.value);
  const values = visibleEntries.map((entry) => entry.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const domainPadding = Math.max(max * 0.025, 0.5);
  const axisMax = max + domainPadding;
  const lanes = 12;
  const laneByGuildId = assignClusteredLanes(valueSortedEntries, lanes);
  const chartData = visibleEntries.map((entry) => ({
    ...entry,
    value: entry.value,
    valueLabel: valueFormatter(entry.value),
    lane: laneByGuildId.get(entry.guild.id) ?? 1,
    guildName: entry.guild.name,
    realm: entry.guild.realm,
    guildRank: entry.guild.guildRank,
  }));

  return (
    <section className="bg-gray-900/60 border border-gray-800/70 rounded p-4">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {iconUrl && <IconImage iconFilename={iconUrl} alt={iconAlt ?? title} width={28} height={28} className="rounded" />}
            <h3 className="text-base font-bold text-white truncate">{title}</h3>
          </div>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {visibleEntries.length > 0 && (
          <div className="text-xs text-gray-500">
            {valueFormatter(min)} to {valueFormatter(max)}
          </div>
        )}
      </div>

      {visibleEntries.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center">{emptyLabel}</div>
      ) : (
        <div className="h-[235px]">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 18, bottom: 14, left: 18 }}>
              <CartesianGrid stroke="#374151" strokeDasharray="3 3" opacity={0.35} vertical={true} horizontal={false} />
              <XAxis
                type="number"
                dataKey="value"
                domain={[-domainPadding, axisMax]}
                ticks={[0, max]}
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                tickFormatter={(value) => (Number(value) === 0 ? "0" : valueFormatter(Number(value)))}
                stroke="#4b5563"
                height={24}
              />
              <YAxis type="number" dataKey="lane" domain={[0, lanes + 1]} hide />
              <Tooltip
                cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload;
                  if (!active || !point) return null;

                  return (
                    <div className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs shadow-xl">
                      <div className="font-semibold text-white">
                        #{point.guildRank ?? "-"} {point.guildName}
                      </div>
                      <div className="text-gray-500">{point.realm}</div>
                      <div className="mt-1 text-blue-300">{valueFormatter(point.value)}</div>
                    </div>
                  );
                }}
              />
              <Scatter data={chartData} shape={(props: MetricPointShapeProps) => <MetricPointShape {...props} />}>
                {chartData.map((entry) => (
                  <Cell key={entry.guild.id} fill={getGuildColor(entry.guild.guildRank)} stroke="#0f172a" strokeWidth={1.5} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function MetricToggleChart({
  title,
  iconUrl,
  iconAlt,
  options,
  emptyLabel,
  actions,
}: {
  title: string;
  iconUrl?: string;
  iconAlt?: string;
  options: MetricOption[];
  emptyLabel: string;
  actions?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? "");
  const selected = options.find((option) => option.id === selectedId) ?? options[0];

  if (!selected) return null;

  return (
    <div className="relative">
      <div className="absolute right-4 top-4 z-10 flex flex-wrap items-center justify-end gap-3">
        {actions}
        <div className="flex rounded bg-gray-950/80 border border-gray-800 p-1">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelectedId(option.id)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${selected.id === option.id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <MetricScatterChart
        title={title}
        iconUrl={iconUrl}
        iconAlt={iconAlt}
        subtitle={selected.subtitle}
        entries={selected.entries}
        valueFormatter={selected.valueFormatter}
        emptyLabel={emptyLabel}
      />
    </div>
  );
}

function StackedHeaderLabel({ label }: { label: string }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      {label.split(" ").map((word, index) => (
        <span key={`${word}-${index}`}>{word}</span>
      ))}
    </span>
  );
}

function SortableHeader({
  sortKey,
  children,
  className = "",
  sort,
  onToggleSort,
}: {
  sortKey: string;
  children: ReactNode;
  className?: string;
  sort: SortState;
  onToggleSort: (key: string) => void;
}) {
  const isActive = sort?.key === sortKey;

  return (
    <button
      type="button"
      onClick={() => onToggleSort(sortKey)}
      className={`inline-flex w-full cursor-pointer items-center gap-1 transition-colors hover:text-white ${className}`}
      aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <span>{children}</span>
      {isActive && (
        <svg className={`h-3 w-3 text-blue-300 ${sort.direction === "asc" ? "" : "rotate-180"}`} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M6 2 2 7h8L6 2Z" />
        </svg>
      )}
    </button>
  );
}

function CompareTable({ compare, t }: { compare: RaidCompare; t: ReturnType<typeof useTranslations> }) {
  const [sort, setSort] = useState<SortState>(null);
  const sortedGuilds = useMemo(() => sortGuildsForTable(compare.guilds, sort), [compare.guilds, sort]);
  const averages = useMemo(() => calculateCompareTableAverages(compare), [compare]);
  const tableCellHoverClass = "group-hover:bg-gray-900/50";
  const averageCellClass = "bg-sky-950/25";

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const sortableHeaderProps = { sort, onToggleSort: toggleSort };

  return (
    <div className="overflow-x-auto border border-gray-800 rounded bg-gray-950/40">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-900 text-xs uppercase text-gray-400">
            <th rowSpan={2} className="sticky left-0 z-20 bg-gray-900 px-3 pb-2 pt-3 text-left align-bottom font-semibold">
              <SortableHeader {...sortableHeaderProps} sortKey="guild">{t("guild")}</SortableHeader>
            </th>
            <th rowSpan={2} className="px-3 pb-2 pt-3 text-right align-bottom font-semibold">
              <SortableHeader {...sortableHeaderProps} sortKey="rank" className="justify-end"><StackedHeaderLabel label={t("rank")} /></SortableHeader>
            </th>
            <th rowSpan={2} className="px-3 pb-2 pt-3 text-right align-bottom font-semibold">
              <SortableHeader {...sortableHeaderProps} sortKey="worldRank" className="justify-end"><StackedHeaderLabel label={t("worldRank")} /></SortableHeader>
            </th>
            <th rowSpan={2} className="px-3 pb-2 pt-3 text-right align-bottom font-semibold">
              <SortableHeader {...sortableHeaderProps} sortKey="progress" className="justify-end"><StackedHeaderLabel label={t("progress")} /></SortableHeader>
            </th>
            <th rowSpan={2} className="px-3 pb-2 pt-3 text-right align-bottom font-semibold">
              <SortableHeader {...sortableHeaderProps} sortKey="totalPulls" className="justify-end"><StackedHeaderLabel label={t("totalPulls")} /></SortableHeader>
            </th>
            <th rowSpan={2} className="px-3 pb-2 pt-3 text-right align-bottom font-semibold">
              <SortableHeader {...sortableHeaderProps} sortKey="progressTime" className="justify-end"><StackedHeaderLabel label={t("progressTime")} /></SortableHeader>
            </th>
            <th rowSpan={2} className="px-3 pb-2 pt-3 text-right align-bottom font-semibold">
              <SortableHeader {...sortableHeaderProps} sortKey="progressRaidTime" className="justify-end"><StackedHeaderLabel label={t("progressTimeWithBreaks")} /></SortableHeader>
            </th>
            {compare.raid.bosses.map((boss) => (
              <th key={boss.id} colSpan={2} className="border-l border-gray-800 px-2 py-2 text-center font-semibold" title={boss.name}>
                <span className="flex justify-center">
                  {boss.iconUrl ? (
                    <IconImage iconFilename={boss.iconUrl} alt={boss.name} width={28} height={28} className="rounded" />
                  ) : (
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-gray-800 text-[10px] text-gray-400">{boss.name.slice(0, 2)}</span>
                  )}
                </span>
                <span className="sr-only">{boss.name}</span>
              </th>
            ))}
          </tr>
          <tr className="bg-gray-900/80 text-[11px] uppercase text-gray-500">
            {compare.raid.bosses.map((boss) => (
              <Fragment key={boss.id}>
                <th key={`${boss.id}-pulls`} className="border-l border-gray-800 px-3 py-2 text-right font-medium">
                  <SortableHeader {...sortableHeaderProps} sortKey={`boss:${boss.id}:pulls`} className="justify-end">{t("pulls")}</SortableHeader>
                </th>
                <th key={`${boss.id}-time`} className="px-3 py-2 text-right font-medium">
                  <SortableHeader {...sortableHeaderProps} sortKey={`boss:${boss.id}:time`} className="justify-end">{t("time")}</SortableHeader>
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-sky-900/40">
            <td className={`sticky left-0 z-10 px-3 py-3 text-gray-300 ${averageCellClass}`}>{t("average")}</td>
            <td className={`px-3 py-3 text-right text-gray-500 ${averageCellClass}`}>-</td>
            <td className={`px-3 py-3 text-right text-gray-500 ${averageCellClass}`}>-</td>
            <td className={`px-3 py-3 text-right text-gray-500 ${averageCellClass}`}>-</td>
            <td className={`px-3 py-3 text-right tabular-nums text-gray-200 ${averageCellClass}`}>{formatAverageNumber(averages.totalPulls)}</td>
            <td className={`px-3 py-3 text-right tabular-nums text-gray-200 ${averageCellClass}`}>{formatAverageTime(averages.progressTime)}</td>
            <td className={`px-3 py-3 text-right tabular-nums text-gray-200 ${averageCellClass}`}>{formatAverageTime(averages.progressRaidTime)}</td>
            {compare.raid.bosses.map((boss) => {
              const bossAverage = averages.bosses.get(boss.id);

              return (
                <Fragment key={`average-${boss.id}`}>
                  <td className={`border-l border-gray-800 px-3 py-3 text-right tabular-nums text-gray-200 ${averageCellClass}`}>{formatAverageNumber(bossAverage?.pulls)}</td>
                  <td className={`px-3 py-3 text-right tabular-nums text-gray-200 ${averageCellClass}`}>{formatAverageTime(bossAverage?.timeSpent)}</td>
                </Fragment>
              );
            })}
          </tr>
          {sortedGuilds.map((guild) => (
            <tr key={guild.id} className="group border-t border-gray-800/80">
              <td className={`sticky left-0 z-10 bg-gray-950 px-3 py-3 ${tableCellHoverClass}`}>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 shrink-0">
                    <GuildCrest crest={guild.crest} faction={guild.faction} size={128} className="scale-[0.25] origin-top-left" />
                  </div>
                  <div className="min-w-0">
                    <Link href={guildHref(guild)} className="block truncate font-medium text-white hover:text-blue-300 transition-colors">
                      {guild.name}
                    </Link>
                    <div className="truncate text-xs text-gray-500">{guild.parentGuild ? `${guild.parentGuild} - ` : ""}{guild.realm}</div>
                  </div>
                </div>
              </td>
              <td className={`px-3 py-3 text-right tabular-nums font-semibold ${tableCellHoverClass} ${guild.guildRank ? getLeaderboardRankColor(guild.guildRank) : "text-gray-500"}`}>{guild.guildRank ?? "-"}</td>
              <td className={`px-3 py-3 text-right tabular-nums font-semibold ${tableCellHoverClass}`} style={{ color: guild.worldRank ? getWorldRankColor(guild.worldRank) : "var(--rank-gray)" }}>
                {guild.worldRank ? formatNumber(guild.worldRank) : "-"}
              </td>
              <td className={`px-3 py-3 text-right tabular-nums text-gray-300 ${tableCellHoverClass}`}>{guild.totalBosses > 0 ? `${guild.bossesDefeated}/${guild.totalBosses}` : "-"}</td>
              <td className={`px-3 py-3 text-right tabular-nums text-gray-300 ${tableCellHoverClass}`}>{formatNumber(guild.totalPulls)}</td>
              <td className={`px-3 py-3 text-right tabular-nums text-gray-300 ${tableCellHoverClass}`}>{formatTime(guild.totalTimeSpent)}</td>
              <td className={`px-3 py-3 text-right tabular-nums text-gray-300 ${tableCellHoverClass}`}>{formatTime(guild.progressRaidTimeSpent)}</td>
              {compare.raid.bosses.map((boss) => {
                const metric = bossMetric(guild, boss.id);
                const killed = (metric?.kills ?? 0) > 0;

                return (
                  <Fragment key={`${guild.id}-${boss.id}`}>
                    <td key={`${guild.id}-${boss.id}-pulls`} className={`border-l border-gray-800 px-3 py-3 text-right tabular-nums ${tableCellHoverClass} ${killed ? "text-gray-200" : "text-gray-500"}`}>
                      {metric?.pulls ? formatNumber(metric.pulls) : "-"}
                    </td>
                    <td key={`${guild.id}-${boss.id}-time`} className={`px-3 py-3 text-right tabular-nums ${tableCellHoverClass} ${killed ? "text-gray-200" : "text-gray-500"}`}>
                      {metric?.timeSpent ? formatTime(metric.timeSpent) : "-"}
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ComparePage() {
  const t = useTranslations("comparePage");
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [showAllTotalEffort, setShowAllTotalEffort] = useState(false);
  const [showAllWorldRanks, setShowAllWorldRanks] = useState(false);
  const { data: raids = [], isLoading: raidsLoading } = useRaids();
  const { data: compare, isLoading: compareLoading, error } = useRaidCompare(selectedRaidId);

  useEffect(() => {
    if (selectedRaidId === null && raids.length > 0) {
      setSelectedRaidId(raids.find((raid) => raid.isPrimary)?.id ?? raids[0].id);
    }
  }, [raids, selectedRaidId]);

  const sortedGuilds = useMemo(() => {
    return [...(compare?.guilds ?? [])].sort((a, b) => (a.guildRank ?? 99999) - (b.guildRank ?? 99999));
  }, [compare?.guilds]);

  const totalEffortGuilds = useMemo(() => {
    if (showAllTotalEffort) return sortedGuilds;
    return sortedGuilds.filter((guild) => guild.totalBosses > 0 && guild.bossesDefeated >= guild.totalBosses);
  }, [showAllTotalEffort, sortedGuilds]);

  const worldRankGuilds = useMemo(() => {
    if (showAllWorldRanks) return sortedGuilds;
    return sortedGuilds.filter((guild) => guild.worldRank && guild.worldRank <= 5000);
  }, [showAllWorldRanks, sortedGuilds]);

  const loading = raidsLoading || (selectedRaidId !== null && compareLoading);

  return (
    <div className="w-full px-4 md:px-6">
      <div className="flex flex-col gap-4 mb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-white">{t("title")}</h1>
          <p className="text-sm text-gray-500">{t("subtitle")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end lg:shrink-0">
          <div className="flex shrink-0 self-start rounded bg-gray-900 border border-gray-800 p-1 sm:self-end">
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-2 text-sm rounded transition-colors ${viewMode === "table" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {t("table")}
            </button>
            <button
              onClick={() => setViewMode("visual")}
              className={`px-3 py-2 text-sm rounded transition-colors ${viewMode === "visual" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {t("visual")}
            </button>
          </div>
          <RaidSelector raids={raids} selectedRaidId={selectedRaidId} onRaidSelect={setSelectedRaidId} />
        </div>
      </div>

      {loading && <div className="flex min-h-64 items-center justify-center text-gray-500">{t("loading")}</div>}

      {!loading && error && <div className="rounded border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{t("error")}</div>}

      {!loading && compare && (
        <div className="space-y-5">
          {compare.guilds.length === 0 ? (
            <div className="rounded border border-gray-800 bg-gray-900/50 py-12 text-center text-gray-500">{t("noGuilds")}</div>
          ) : viewMode === "table" ? (
            <CompareTable compare={compare} t={t} />
          ) : (
            <div className="space-y-5">
              <div className="space-y-4">
                <MetricToggleChart
                  title={t("worldRank")}
                  actions={
                    <label className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/80 px-2.5 py-1 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={showAllWorldRanks}
                        onChange={(event) => setShowAllWorldRanks(event.target.checked)}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      <span>{t("showAllGuilds")}</span>
                    </label>
                  }
                  options={[
                    {
                      id: "rank",
                      label: t("rank"),
                      subtitle: t("worldRankFilterSubtitle"),
                      entries: worldRankGuilds.map((guild) => ({ guild, value: guild.worldRank ?? 0 })),
                      valueFormatter: formatChartNumber,
                    },
                  ]}
                  emptyLabel={t("noMetricData")}
                />
                <MetricToggleChart
                  title={t("totalEffort")}
                  actions={
                    <label className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/80 px-2.5 py-1 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={showAllTotalEffort}
                        onChange={(event) => setShowAllTotalEffort(event.target.checked)}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      <span>{t("showAllGuilds")}</span>
                    </label>
                  }
                  options={[
                    {
                      id: "pulls",
                      label: t("pulls"),
                      subtitle: t("combatPullsSubtitle"),
                      entries: totalEffortGuilds.map((guild) => ({ guild, value: guild.totalPulls })),
                      valueFormatter: formatChartNumber,
                    },
                    {
                      id: "time",
                      label: t("time"),
                      subtitle: t("combatTimeSubtitle"),
                      entries: totalEffortGuilds.map((guild) => ({ guild, value: guild.totalTimeSpent })),
                      valueFormatter: formatTime,
                    },
                  ]}
                  emptyLabel={t("noMetricData")}
                />
              </div>

              <div className="space-y-4">
                {compare.raid.bosses.map((boss) => {
                  const killedEntries = sortedGuilds
                    .map((guild) => ({ guild, metric: bossMetric(guild, boss.id) }))
                    .filter(({ metric }) => (metric?.kills ?? 0) > 0);

                  return (
                    <MetricToggleChart
                      key={boss.id}
                      title={boss.name}
                      iconUrl={boss.iconUrl}
                      iconAlt={boss.name}
                      options={[
                        {
                          id: "pulls",
                          label: t("pulls"),
                          subtitle: t("killedGuildsOnly"),
                          entries: killedEntries.map(({ guild, metric }) => ({ guild, value: metric?.pulls ?? 0 })),
                          valueFormatter: formatChartNumber,
                        },
                        {
                          id: "time",
                          label: t("time"),
                          subtitle: t("killedGuildsOnly"),
                          entries: killedEntries.map(({ guild, metric }) => ({ guild, value: metric?.timeSpent ?? 0 })),
                          valueFormatter: formatTime,
                        },
                      ]}
                      emptyLabel={t("noBossKills")}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
