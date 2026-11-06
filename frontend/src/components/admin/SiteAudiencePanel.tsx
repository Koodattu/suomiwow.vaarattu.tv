"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

export default function SiteAudiencePanel({ days }: { days: number }) {
  const t = useTranslations("siteAnalytics");
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ["admin-audience", days], queryFn: () => api.getAnalyticsAudience(days), staleTime: 30000 });
  return <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
    <h2 className="mb-2 text-xl font-semibold text-amber-400">{t("audience")}</h2>
    {isPending ? <p role="status">{t("loading")}</p> : isError ? <div role="alert">{t("loadError")} <button className="underline" onClick={() => void refetch()}>{t("retry")}</button></div> : data && <>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(["pageViews", "visitors", "sessions", "signedInUsers"] as const).map(key => <div key={key}>
          <dt className="text-sm text-slate-300">{t(key)}</dt><dd className="text-3xl font-semibold tabular-nums text-white">{data[key].toLocaleString("fi-FI")}</dd>
        </div>)}
      </dl>
      <p className="mt-3 text-xs text-slate-400">{t("coverage", { date: data.startedAt ? new Date(data.startedAt).toLocaleString("fi-FI") : "—", days: Math.min(days, data.retentionDays), excluded: data.excludedAutomatedViews })}</p>
      <details className="mt-3 text-sm text-slate-400">
        <summary className="cursor-pointer">{t("method")}</summary>
        <p className="mt-2">{t("estimateNote")}</p>
      </details>
      <details className="mt-4" open>
        <summary className="cursor-pointer text-sm font-medium text-white">{t("pages")}</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 text-slate-300"><tr><th className="p-2 text-left">{t("page")}</th><th className="p-2 text-right">{t("pageViews")}</th><th className="p-2 text-right">{t("visitors")}</th></tr></thead>
            <tbody>{data.pages.map(page => <tr key={page.path} className="border-t border-slate-700/50"><td className="break-all p-2 font-mono text-slate-200">{page.path}</td><td className="p-2 text-right tabular-nums">{page.views.toLocaleString("fi-FI")}</td><td className="p-2 text-right tabular-nums">{page.visitors.toLocaleString("fi-FI")}</td></tr>)}</tbody>
          </table>
          {data.pages.length === 0 && <p className="p-3 text-slate-400">{t("noVisits")}</p>}
        </div>
      </details>
    </>}
  </section>;
}
