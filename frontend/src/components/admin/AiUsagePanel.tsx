"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { AiUsageTotals } from "@/types/ai-usage";

const panel = "rounded-xl border border-gray-700 bg-gray-800/60";
const control = "rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 disabled:opacity-40";
const head = "px-3 py-2 text-right font-medium whitespace-nowrap";
const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

export default function AiUsagePanel() {
  const t = useTranslations("admin.aiUsage");
  const locale = useLocale();
  const [days, setDays] = useState(7);
  const [feature, setFeature] = useState("");
  const [page, setPage] = useState(1);
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["admin-ai-usage", days, page, feature],
    queryFn: ({ signal }) => api.getAiUsage(days, page, feature, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const number = new Intl.NumberFormat(locale);
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 9 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const amount = (nano?: number | null) => nano == null ? t("unknown") : currency.format(nano / 1e9);
  const subtotal = (v: AiUsageTotals) => v.calls > 0 && v.unpriced === v.calls ? t("unknown") : amount(v.costNanoUsd);
  const pages = data ? Math.max(1, Math.ceil(data.totals.calls / data.pageSize)) : 1;
  const features = data?.features ?? (feature ? [feature] : []);
  const card = (label: string, value: string, note: string) => <div className={`${panel} p-4`}>
    <dt className="text-sm text-gray-300">{label}</dt>
    <dd className="mt-2 break-words text-2xl font-semibold tabular-nums text-white">{value}</dd>
    <dd className="mt-1 text-xs text-gray-400">{note}</dd>
  </div>;

  return <section className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-amber-400">{t("title")}</h2>
        {data?.firstRecordedAt && <p className="mt-1 text-sm text-gray-400">{t("since", { date: date.format(new Date(data.firstRecordedAt)) })}</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-gray-300">{t("period")}
          <select className={control} value={days} onChange={e => { setDays(Number(e.target.value)); setPage(1); }}>
            {[1, 7, 30, 90].map(value => <option key={value} value={value}>{value === 1 ? t("today") : t("days", { days: value })}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-gray-300">{t("feature")}
          <select className={control} value={feature} onChange={e => { setFeature(e.target.value); setPage(1); }}>
            <option value="">{t("all")}</option>
            {features.map(key => <option key={key} value={key}>{t(`features.${key}`)}</option>)}
          </select>
        </label>
        <button className={control} disabled={isFetching} onClick={() => void refetch()}>{t("refresh")}</button>
      </div>
    </div>
    {isError && <p role="alert" className="text-red-300">{t("error")}</p>}
    {!data && isFetching && <p role="status">{t("loading")}</p>}
    {data && <>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {card(t("estimated"), subtotal(data.totals), data.totals.unpriced ? t("unpriced", { count: data.totals.unpriced }) : t("estimatedNote"))}
        {card(t("tokens"), number.format(data.totals.totalTokens), t("tokenCounts", { input: data.totals.inputTokens, output: data.totals.outputTokens }))}
        {card(t("reasoningTokens"), number.format(data.totals.reasoningTokens), t("reasoningNote"))}
        {card(t("calls"), number.format(data.totals.calls), t("callCounts", { polls: data.totals.polls, failures: data.totals.failures }))}
      </dl>
      <section className={panel}>
        <h3 className="px-4 pt-4 text-lg font-medium">{t("breakdown")}</h3>
        {data.byFeature.length ? <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-300"><tr>
              <th scope="col" className="px-3 py-2 text-left">{t("feature")}</th>
              {(["estimated", "calls", "input", "cached", "written", "output", "reasoning"] as const).map(k => <th key={k} scope="col" className={head}>{t(k)}</th>)}
            </tr></thead>
            <tbody>{data.byFeature.map(row => <tr key={row._id} className="border-t border-gray-700">
              <th scope="row" className="px-3 py-2 text-left font-medium">{t(`features.${row._id}`)}</th>
              <td className={`${cell} text-amber-300`}>{subtotal(row)}</td>
              {[row.calls, row.inputTokens, row.cachedInputTokens, row.cacheWriteTokens, row.outputTokens, row.reasoningTokens].map((v, i) => <td className={cell} key={i}>{number.format(v)}</td>)}
            </tr>)}</tbody>
          </table>
          <p className="px-3 py-2 text-xs text-gray-400">{t("subsets")}</p>
        </div> : <p className="p-4 text-sm text-gray-400">{t("empty")}</p>}
      </section>
      <section className={panel}>
        <h3 className="p-4 text-lg font-medium">{t("history")}</h3>
        {data.calls.length ? <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-300"><tr>
              {(["time", "feature", "endpoint", "status"] as const).map(k => <th key={k} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">{t(k)}</th>)}
              {(["input", "output", "reasoning", "tokens", "estimated"] as const).map(k => <th key={k} scope="col" className={head}>{t(k)}</th>)}
            </tr></thead>
            <tbody>{data.calls.map(row => <tr key={row._id} className="border-t border-gray-700">
              <td className="whitespace-nowrap px-3 py-2"><time dateTime={row.at}>{date.format(new Date(row.at))}</time></td>
              <td className="px-3 py-2">{t(`features.${row.feature}`)}</td>
              <td className="px-3 py-2"><details>
                <summary className="cursor-pointer whitespace-nowrap">{t(`endpoints.${row.endpoint}`)}</summary>
                <dl className="mt-1 space-y-1 text-xs text-gray-300">
                  <div><dt>{t("model")}</dt><dd>{row.model} · {row.tier}</dd></div>
                  {row.requestId && <div><dt>{t("requestId")}</dt><dd className="break-all font-mono">{row.requestId}</dd></div>}
                  {row.inputTokens != null && <div><dt>{t("tokenDetails")}</dt><dd>{t("tokenDetailsValue", { cached: row.cachedInputTokens ?? 0, written: row.cacheWriteTokens ?? 0 })}</dd>
                    {row.cacheWrite12hTokens != null && !!row.cacheWriteTokens && <dd>{t("longCacheWrites", { count: row.cacheWrite12hTokens })}</dd>}</div>}
                </dl>
              </details></td>
              <td className="whitespace-nowrap px-3 py-2">{t.has(`statuses.${row.status}`) ? t(`statuses.${row.status}`) : row.status} {row.httpStatus}</td>
              <td className={cell}>{row.inputTokens == null ? "—" : number.format(row.inputTokens)}</td>
              <td className={cell}>{row.outputTokens == null ? "—" : number.format(row.outputTokens)}</td>
              <td className={cell}>{row.reasoningTokens == null ? "—" : number.format(row.reasoningTokens)}</td>
              <td className={cell}>{row.totalTokens == null ? "—" : number.format(row.totalTokens)}</td>
              <td className={`${cell} text-amber-300`}>{amount(row.costNanoUsd)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="px-4 pb-4 text-sm text-gray-400">{t("empty")}</p>}
        {pages > 1 && <div className="flex items-center justify-end gap-3 border-t border-gray-700 p-3 text-sm">
          <button className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>{t("previous")}</button>
          <span>{t("page", { page, pages })}</span>
          <button className={control} disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("next")}</button>
        </div>}
      </section>
    </>}
  </section>;
}
