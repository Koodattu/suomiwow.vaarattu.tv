"use client";

import { useEffect, useState, useRef } from "react";
import { GuildDistributionEntry, Distribution, WeeklyProgressionEntry } from "@/types";
import { useTranslations } from "next-intl";
import { useRaids, useBosses, useRaidAnalyticsRaids, useRaidAnalytics, useAllRaidAnalytics } from "@/lib/queries";
import RaidSelector from "@/components/RaidSelector";
import IconImage from "@/components/IconImage";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

// Format seconds to hours and minutes
function formatTime(seconds: number): string {
  if (seconds === 0) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatPullCount(value: number): string {
  return `${Math.round(value)}`;
}

// Format date for display
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// If raidEnd is a placeholder (>1 year from raidStart), clamp weekly data to current week
function clampWeeklyProgression(weeklyData: WeeklyProgressionEntry[], raidStart?: string, raidEnd?: string): WeeklyProgressionEntry[] {
  if (!weeklyData || weeklyData.length === 0 || !raidStart || !raidEnd) return weeklyData;

  const startDate = new Date(raidStart);
  const endDate = new Date(raidEnd);
  const oneYearFromStart = new Date(startDate);
  oneYearFromStart.setFullYear(oneYearFromStart.getFullYear() + 1);

  if (endDate <= oneYearFromStart) return weeklyData; // date looks real, no clamping

  // Placeholder end date — cap at the week containing today
  const now = new Date();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const weeksElapsed = Math.max(1, Math.floor((now.getTime() - startDate.getTime()) / MS_PER_WEEK) + 1);

  return weeklyData.slice(0, weeksElapsed);
}

// Generate gradient colors for chart bars
function getColor(index: number, total: number): string {
  const hue = 200 + (index / Math.max(total - 1, 1)) * 60; // Blue to cyan
  return `hsl(${hue}, 70%, 50%)`;
}

// Compact inline stat - single line with label, average (large), min (small green), max (small amber)
function CompactStat({ label, average, min, max, formatValue }: { label: string; average: number; min: number; max: number; formatValue: (val: number) => string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-gray-500 min-w-[100px]">{label}</span>
      <span className="text-2xl font-bold text-white">{formatValue(average)}</span>
      <span className="text-xs text-gray-600">•</span>
      <span className="text-sm text-green-400">{formatValue(min)}</span>
      <span className="text-xs text-gray-600">to</span>
      <span className="text-sm text-amber-400">{formatValue(max)}</span>
    </div>
  );
}

// Distribution chart - bar chart showing guild count in pre-calculated buckets
function DistributionChart({
  buckets,
  title,
  valueFormatter = formatPullCount,
}: {
  buckets: { label: string; count: number; guilds: GuildDistributionEntry[] }[];
  title: string;
  valueFormatter?: (value: number) => string;
}) {
  const t = useTranslations("raidAnalyticsPage");

  if (!buckets || buckets.length === 0) {
    return (
      <div className="p-3">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">{title}</div>
        <div className="text-xs text-gray-600">{t("noData")}</div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">{title}</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={buckets} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
          <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 10 }} />
          <YAxis tick={{ fill: "#9CA3AF", fontSize: 10 }} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs max-w-xs">
                    <div className="text-white font-bold mb-1">{data.label}</div>
                    <div className="text-blue-400 mb-1">{t("guildCount", { count: data.count })}</div>
                    {data.guilds && Array.isArray(data.guilds) && data.guilds.length > 0 && (
                      <div className="text-gray-400 text-[10px] max-h-32 overflow-y-auto">
                        {data.guilds.map((guild: GuildDistributionEntry, idx: number) => (
                          <div key={idx} className="flex min-w-0 items-center justify-between gap-3">
                            <span className="truncate">
                              {guild.name}-{guild.realm}
                            </span>
                            {typeof guild.value === "number" && <span className="shrink-0 text-gray-500 tabular-nums">{valueFormatter(guild.value)}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} activeBar={{ filter: "brightness(1.3)" }}>
            {buckets.map((_, index) => (
              <Cell key={`cell-${index}`} fill={getColor(index, buckets.length)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Compact progression chart using pre-calculated weekly data
function ProgressionChart({ weeklyData, label }: { weeklyData: WeeklyProgressionEntry[]; label: string }) {
  const t = useTranslations("raidAnalyticsPage");

  if (!weeklyData || weeklyData.length === 0) {
    return (
      <div className="p-3">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">{label}</div>
        <div className="text-xs text-gray-600">{t("noData")}</div>
      </div>
    );
  }

  return (
    <div className=" border-gray-800/50 p-3">
      <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">{label}</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={weeklyData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
          <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 10 }} />
          <YAxis tick={{ fill: "#9CA3AF", fontSize: 10 }} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs">
                    <div className="text-white font-bold">Week {data.weekNumber}</div>
                    <div className="text-blue-400">{data.value} guilds</div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} activeBar={{ filter: "brightness(1.3)" }}>
            {weeklyData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={getColor(index, weeklyData.length)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Stats section with distribution and progression charts
function StatsSection({
  pullDistribution,
  timeDistribution,
  progressRaidTimeDistribution,
  weeklyProgression,
  progressionLabel,
  raidStart,
  raidEnd,
}: {
  pullDistribution?: Distribution;
  timeDistribution?: Distribution;
  progressRaidTimeDistribution?: Distribution;
  weeklyProgression?: WeeklyProgressionEntry[];
  progressionLabel: string;
  raidStart?: string;
  raidEnd?: string;
}) {
  const t = useTranslations("raidAnalyticsPage");

  // Handle undefined or missing distribution data
  const safePullDistribution = pullDistribution?.buckets ?? [];
  const safeTimeDistribution = timeDistribution?.buckets ?? [];
  const safeProgressRaidTimeDistribution = progressRaidTimeDistribution?.buckets ?? [];
  const safeWeeklyProgression = clampWeeklyProgression(weeklyProgression ?? [], raidStart, raidEnd);
  const hasProgressRaidTimeDistribution = safeProgressRaidTimeDistribution.length > 0;
  const gridClassName = hasProgressRaidTimeDistribution ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" : "grid grid-cols-1 gap-4 lg:grid-cols-3";

  return (
    <div className={gridClassName}>
      {/* Pull Distribution Chart */}
      <DistributionChart buckets={safePullDistribution} title={t("pullDistribution")} valueFormatter={formatPullCount} />

      {/* Time Distribution Chart */}
      <DistributionChart buckets={safeTimeDistribution} title={t("progressTimeDistribution")} valueFormatter={formatTime} />

      {/* Progress Raid Time Distribution Chart */}
      {hasProgressRaidTimeDistribution && (
        <DistributionChart buckets={safeProgressRaidTimeDistribution} title={t("progressTimeWithBreaksDistribution")} valueFormatter={formatTime} />
      )}

      {/* Progression Chart */}
      <ProgressionChart weeklyData={safeWeeklyProgression} label={progressionLabel} />
    </div>
  );
}

export default function RaidAnalyticsPage() {
  const t = useTranslations("raidAnalyticsPage");
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const initializedRef = useRef(false);

  // Data fetching via React Query
  const { data: raids = [], isLoading: raidsLoading } = useRaids();
  const { data: raidAnalyticsRaids, isLoading: analyticsRaidsLoading } = useRaidAnalyticsRaids();
  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useRaidAnalytics(selectedRaidId);
  const { data: allAnalytics, isLoading: allAnalyticsLoading, error: allAnalyticsError } = useAllRaidAnalytics(selectedRaidId === null);
  const { data: bosses = [] } = useBosses(selectedRaidId);

  // Set initial selectedRaidId when raid analytics list loads (only once)
  useEffect(() => {
    if (!initializedRef.current && raidAnalyticsRaids && raidAnalyticsRaids.length > 0 && raids.length > 0) {
      initializedRef.current = true;
      const analyticsRaidIds = new Set(raidAnalyticsRaids.map((raid) => raid.raidId));
      const primaryRaidId = raids.find((raid) => raid.isPrimary && analyticsRaidIds.has(raid.id))?.id;
      setSelectedRaidId(primaryRaidId ?? raidAnalyticsRaids[0].raidId);
    }
  }, [raidAnalyticsRaids, raids]);

  // Derive loading and error states
  const loading = raidsLoading || analyticsRaidsLoading;
  const dataLoading = selectedRaidId === null ? allAnalyticsLoading : analyticsLoading;
  const rawError = selectedRaidId === null ? allAnalyticsError : analyticsError;
  const error = rawError ? (rawError.message.includes("No analytics") ? t("noAnalyticsAvailable") : t("failedToLoad")) : null;

  const handleRaidSelect = (raidId: number | null) => {
    setSelectedRaidId(raidId);
  };

  const getBossIconUrl = (bossId: number, bossName: string): string | undefined => {
    const boss = bosses.find((b) => b.id === bossId) ?? bosses.find((b) => b.name === bossName);
    return boss?.iconUrl;
  };

  const getRaidIconUrl = (raidId: number): string | undefined => {
    const raid = raids.find((r) => r.id === raidId);
    return raid?.iconUrl;
  };

  const getRaidInfo = (raidId: number) => {
    return raids.find((r) => r.id === raidId);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <div className="text-gray-400">{t("loading")}</div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 md:px-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white">{t("title")}</h1>
          <p className="text-gray-500 text-sm">{t("subtitle")}</p>
        </div>
        <RaidSelector raids={raids} selectedRaidId={selectedRaidId} onRaidSelect={handleRaidSelect} showOverall={true} />
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-900/20 border border-red-800/50 rounded px-3 py-2 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {dataLoading && (
        <div className="flex justify-center items-center min-h-64">
          <div className="text-gray-500">{t("loadingAnalytics")}</div>
        </div>
      )}

      {/* Single raid analytics */}
      {!dataLoading && analytics && (
        <div className="space-y-4">
          {/* Meta info - inline */}
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span>
              {t("lastCalculated")}: {formatDate(analytics.lastCalculated)}
            </span>
            {analytics.raidStart && (
              <>
                <span>•</span>
                <span>
                  {formatDate(analytics.raidStart)}
                  {analytics.raidEnd ? ` - ${formatDate(analytics.raidEnd)}` : ` - ${t("ongoing")}`}
                </span>
              </>
            )}
          </div>

          {/* Overall stats section with summary */}
          <div className="bg-gray-900/60 rounded border border-gray-800/50 p-2">
            {/* Raid header with icon and inline stats */}
            <div className="flex items-center gap-4 mb-2 pb-2 border-b border-gray-800/50">
              {getRaidIconUrl(analytics.raidId) && (
                <IconImage iconFilename={getRaidIconUrl(analytics.raidId)} alt={analytics.raidName} width={40} height={40} className="rounded" />
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-white">{analytics.raidName}</h2>
                <p className="text-xs text-gray-500">{t("overallStatistics")}</p>
              </div>
              {/* Summary stats - inline with header */}
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-xs text-gray-500">Cleared</span>
                  <span className="text-xl font-bold text-green-400">{analytics.overall.guildsCleared}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xs text-gray-500">Progressing</span>
                  <span className="text-xl font-bold text-yellow-400">{analytics.overall.guildsProgressing}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xs text-gray-500">Avg Pulls</span>
                  <span className="text-xl font-bold text-white">{analytics.overall.pullCount.average || "-"}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xs text-gray-500">Avg Time</span>
                  <span className="text-xl font-bold text-white">{formatTime(analytics.overall.timeSpent.average)}</span>
                </div>
              </div>
            </div>

            <StatsSection
              pullDistribution={analytics.overall.pullDistribution}
              timeDistribution={analytics.overall.timeDistribution}
              progressRaidTimeDistribution={analytics.overall.progressRaidTimeDistribution}
              weeklyProgression={analytics.overall.weeklyProgression}
              progressionLabel={t("clearProgression")}
              raidStart={analytics.raidStart}
              raidEnd={analytics.raidEnd}
            />
          </div>

          {/* Boss breakdown */}
          {analytics.bosses && analytics.bosses.length > 0 && (
            <div>
              <h2 className="text-base font-bold text-white mb-3">{t("bossBreakdown")}</h2>
              <div className="space-y-2">
                {analytics.bosses.map((boss, index) => {
                  const bossIcon = getBossIconUrl(boss.bossId, boss.bossName);
                  return (
                    <div key={boss.bossId} className="bg-gray-900/60 rounded border border-gray-800/50 overflow-hidden hover:border-gray-700/50 transition-colors">
                      {/* Boss header with inline stats */}
                      <div className="flex items-center gap-3 px-3 py-2 bg-gray-800/30 border-b border-gray-800/50">
                        <span className="text-gray-600 font-mono text-xs w-5">#{index + 1}</span>
                        <IconImage iconFilename={bossIcon} alt={boss.bossName} width={28} height={28} className="rounded" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-white truncate">{boss.bossName}</h3>
                        </div>
                        {boss.guildsKilled > 0 && (
                          <div className="flex items-center gap-5">
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-gray-500">Killed</span>
                              <span className="text-base font-bold text-green-400">{boss.guildsKilled}</span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-gray-500">Progressing</span>
                              <span className="text-base font-bold text-yellow-400">{boss.guildsProgressing}</span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-gray-500">Avg Pulls</span>
                              <span className="text-base font-bold text-white">{boss.pullCount.average || "-"}</span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-gray-500">Avg Time</span>
                              <span className="text-base font-bold text-white">{formatTime(boss.timeSpent.average)}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Boss stats */}
                      <div className="px-3 py-3">
                        {boss.guildsKilled > 0 ? (
                          <>
                            <StatsSection
                              pullDistribution={boss.pullDistribution}
                              timeDistribution={boss.timeDistribution}
                              weeklyProgression={boss.weeklyProgression}
                              progressionLabel={t("killProgression")}
                              raidStart={analytics.raidStart}
                              raidEnd={analytics.raidEnd}
                            />
                          </>
                        ) : (
                          <div className="text-gray-600 text-xs">{t("noBossKills")}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* All raids view */}
      {!dataLoading && selectedRaidId === null && allAnalytics && allAnalytics.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            {t("showingOverallStatsForAllRaids")} ({allAnalytics.length} raids)
          </div>

          {allAnalytics.map((raidAnalytics) => (
            <div key={raidAnalytics.raidId} className="bg-gray-900/60 rounded border border-gray-800/50 overflow-hidden">
              {/* Raid header with inline stats */}
              <div className="px-4 py-3 bg-gray-800/30 border-b border-gray-800/50">
                <div className="flex items-center gap-4">
                  {getRaidIconUrl(raidAnalytics.raidId) && (
                    <IconImage iconFilename={getRaidIconUrl(raidAnalytics.raidId)} alt={raidAnalytics.raidName} width={32} height={32} className="rounded" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3">
                      <h2 className="text-lg font-bold text-white">{raidAnalytics.raidName}</h2>
                      {raidAnalytics.raidStart && (
                        <span className="text-xs text-gray-500">
                          {formatDate(raidAnalytics.raidStart)}
                          {raidAnalytics.raidEnd ? ` - ${formatDate(raidAnalytics.raidEnd)}` : ` - ${t("ongoing")}`}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Summary stats - inline with header */}
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-gray-500">Cleared</span>
                      <span className="text-xl font-bold text-green-400">{raidAnalytics.overall.guildsCleared}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-gray-500">Progressing</span>
                      <span className="text-xl font-bold text-yellow-400">{raidAnalytics.overall.guildsProgressing}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-gray-500">Avg Pulls</span>
                      <span className="text-xl font-bold text-white">{raidAnalytics.overall.pullCount.average || "-"}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-gray-500">Avg Time</span>
                      <span className="text-xl font-bold text-white">{formatTime(raidAnalytics.overall.timeSpent.average)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Stats */}
                <StatsSection
                  pullDistribution={raidAnalytics.overall.pullDistribution}
                  timeDistribution={raidAnalytics.overall.timeDistribution}
                  progressRaidTimeDistribution={raidAnalytics.overall.progressRaidTimeDistribution}
                  weeklyProgression={raidAnalytics.overall.weeklyProgression}
                  progressionLabel={t("clearProgression")}
                  raidStart={raidAnalytics.raidStart}
                  raidEnd={raidAnalytics.raidEnd}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No data state */}
      {!dataLoading && !analytics && !allAnalytics && !error && (
        <div className="text-center py-12">
          <p className="text-gray-500">{t("selectRaidToView")}</p>
        </div>
      )}
    </div>
  );
}
