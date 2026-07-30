"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CCG_RARITY_KEYS } from "@/lib/ccg";
import { api } from "@/lib/api";
import type { CcgAdminAnalyticsRange } from "@/types";

const ranges: CcgAdminAnalyticsRange[] = [7, 30, 90];
const qualityColors = ["#94a3b8", "#38bdf8", "#f59e0b", "#a78bfa", "#f472b6", "#e2e8f0"];
const rarityColors = ["#00ccff", "#e879f9", "#fb923c", "#a78bfa", "#60a5fa", "#34d399", "#94a3b8", "#78716c"];

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

function DistributionList({
  items,
  colors,
  label,
  numberFormat,
  percentFormat,
}: {
  items: Array<{ key: string; count: number; rate: number }>;
  colors: string[];
  label: (key: string) => string;
  numberFormat: Intl.NumberFormat;
  percentFormat: Intl.NumberFormat;
}) {
  return (
    <div className="mt-5 space-y-3">
      {items.map((item, index) => (
        <div key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-gray-300">{label(item.key)}</span>
            <span className="tabular-nums text-gray-400">
              {percentFormat.format(item.rate)} <span className="text-gray-600">·</span> {numberFormat.format(item.count)}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-950/80" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, item.rate * 100))}%`, backgroundColor: colors[index] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CcgAdminAnalytics() {
  const t = useTranslations("admin.ccg.analytics");
  const ccg = useTranslations("ccg");
  const locale = useLocale();
  const [days, setDays] = useState<CcgAdminAnalyticsRange>(30);
  const analyticsQuery = useQuery({
    queryKey: ["admin", "ccg", "analytics", days],
    queryFn: () => api.getAdminCcgAnalytics(days),
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const decimalFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const percentFormat = useMemo(() => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }), [locale]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }), [locale]);
  const fullDateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", year: "numeric", month: "short", day: "numeric" }),
    [locale],
  );
  const data = analyticsQuery.data;
  const hasActivity = data?.series.some((point) => point.packOpenings > 0 || point.activeUsers > 0) ?? false;

  if (analyticsQuery.isPending && !data) {
    return (
      <div className="space-y-4" aria-label={t("loading")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-lg bg-gray-800" />)}
        </div>
        <div className="h-80 animate-pulse rounded-lg bg-gray-800" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-80 animate-pulse rounded-lg bg-gray-800" />
          <div className="h-80 animate-pulse rounded-lg bg-gray-800" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg bg-red-950/50 p-5 text-sm text-red-200 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.3)]" role="alert">
        <p>{t("loadError")}</p>
        <button
          type="button"
          className="mt-4 min-h-10 rounded-md bg-gray-800 px-3 py-2 font-semibold text-gray-200 transition-transform duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 active:scale-[0.96]"
          onClick={() => void analyticsQuery.refetch()}
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <section className={`space-y-4 ${analyticsQuery.isFetching ? "opacity-80" : "opacity-100"}`} aria-labelledby="ccg-analytics-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="ccg-analytics-title" className="text-xl font-bold text-white text-balance">{t("title")}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>
        </div>
        <div className="flex rounded-[0.625rem] bg-gray-900/80 p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" aria-label={t("rangeLabel")}>
          {ranges.map((range) => (
            <button
              key={range}
              type="button"
              className={`min-h-10 min-w-14 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${days === range ? "bg-cyan-950 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,.25)]" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}
              onClick={() => setDays(range)}
              aria-pressed={days === range}
            >
              {t("range", { days: range })}
            </button>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg bg-gray-800/75 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <dt className="text-xs font-medium text-gray-400">{t("packsOpened")}</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{numberFormat.format(data.totals.packOpenings)}</dd>
        </div>
        <div className="rounded-lg bg-gray-800/75 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <dt className="text-xs font-medium text-gray-400">{t("cardsRevealed")}</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{numberFormat.format(data.totals.cardsRevealed)}</dd>
        </div>
        <div className="rounded-lg bg-gray-800/75 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <dt className="text-xs font-medium text-gray-400">{t("activeToday")}</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{numberFormat.format(data.totals.activeUsersToday)}</dd>
        </div>
        <div className="rounded-lg bg-gray-800/75 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <dt className="text-xs font-medium text-gray-400">{t("dailyAverage")}</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{decimalFormat.format(data.totals.averageDailyOpenings)}</dd>
        </div>
      </dl>

      <article className="rounded-lg bg-gray-800/65 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
        <div>
          <h4 className="font-bold text-white text-balance">{t("activityTitle")}</h4>
          <p className="mt-1 text-sm text-gray-400 text-pretty">{t("activityDescription")}</p>
        </div>
        {hasActivity ? (
          <div className="mt-4 h-72 w-full [&_*:focus-visible]:outline-none [&_*:focus]:outline-none [&_.recharts-surface]:outline-none">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.series} margin={{ top: 8, right: 10, bottom: 4, left: 0 }} accessibilityLayer>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.65} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value: string) => dateFormat.format(parseDateKey(value))}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  stroke="#4b5563"
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis yAxisId="packs" allowDecimals={false} tick={{ fill: "#9ca3af", fontSize: 11 }} stroke="#4b5563" width={44} tickLine={false} />
                <YAxis yAxisId="users" orientation="right" allowDecimals={false} tick={{ fill: "#67e8f9", fontSize: 11 }} stroke="#155e75" width={44} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "0.5rem" }}
                  labelStyle={{ color: "#9ca3af" }}
                  labelFormatter={(value: string | number) => fullDateFormat.format(parseDateKey(String(value)))}
                  formatter={(value: string | number | undefined, name: string | number | undefined) => [
                    numberFormat.format(Number(value ?? 0)),
                    name === "packOpenings" ? t("packsOpened") : t("activeUsers"),
                  ]}
                />
                <Bar yAxisId="packs" dataKey="packOpenings" name="packOpenings" fill="#f59e0b" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="users" type="monotone" dataKey="activeUsers" name="activeUsers" stroke="#22d3ee" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="mt-4 flex h-52 items-center justify-center text-sm text-gray-500">{t("empty")}</div>}
      </article>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg bg-gray-800/65 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <h4 className="font-bold text-white text-balance">{t("qualityTitle")}</h4>
          <p className="mt-1 text-sm text-gray-400 text-pretty">{t("qualityDescription")}</p>
          <DistributionList
            items={data.qualities}
            colors={qualityColors}
            label={(key) => ccg(`finish.${key}`)}
            numberFormat={numberFormat}
            percentFormat={percentFormat}
          />
        </article>
        <article className="rounded-lg bg-gray-800/65 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <h4 className="font-bold text-white text-balance">{t("rarityTitle")}</h4>
          <p className="mt-1 text-sm text-gray-400 text-pretty">{t("rarityDescription")}</p>
          <DistributionList
            items={data.rarities}
            colors={rarityColors}
            label={(key) => ccg(`rarity.${CCG_RARITY_KEYS[key as keyof typeof CCG_RARITY_KEYS]}`)}
            numberFormat={numberFormat}
            percentFormat={percentFormat}
          />
        </article>
      </div>
    </section>
  );
}
