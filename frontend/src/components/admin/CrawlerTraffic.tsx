import { useFormatter, useTranslations } from "next-intl";
import type { AnalyticsDaily } from "@/types";

const categories = ["googlebot", "bingbot", "suspected"] as const;

export default function CrawlerTraffic({ days }: { days: AnalyticsDaily[] }) {
  const t = useTranslations("siteAnalytics");
  const format = useFormatter();
  const measured = days.flatMap(({ date, crawlerCounts }) => crawlerCounts ? [{ date, crawlerCounts }] : []);
  const totals = { googlebot: 0, bingbot: 0, suspected: 0 };
  let assessed = 0;
  for (const { crawlerCounts } of measured) {
    for (const category of categories) totals[category] += crawlerCounts[category];
    assessed += Object.values(crawlerCounts).reduce((sum, count) => sum + count, 0);
  }

  return <section className="mt-4 border-t border-slate-700 pt-3">
    <h3 className="text-sm font-semibold text-slate-200">{t("crawlerRequests")}</h3>
    {measured.length === 0 ? <p className="mt-1 text-xs text-slate-400">{t("noCrawlerCoverage")}</p> : <>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        {categories.map(category => <div key={category}>
          <dt className="text-xs text-slate-400">{t(category)}</dt>
          <dd className="font-semibold tabular-nums text-slate-100">{format.number(totals[category])}</dd>
        </div>)}
      </dl>
      <p className="mt-2 text-xs text-slate-400">{t("crawlerCoverage", { assessed, total: days.reduce((sum, day) => sum + day.requests, 0) })}</p>
      <details className="mt-2 text-xs text-slate-300">
        <summary className="cursor-pointer">{t("dailyCrawlerCounts")}</summary>
        <p className="my-2 text-slate-400">{t("crawlerMethod")}</p>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-right tabular-nums">
            <thead className="sticky top-0 bg-slate-800"><tr>
              <th scope="col" className="p-1 text-left">{t("crawlerDate")}</th>
              {categories.map(category => <th scope="col" key={category} className="p-1">{t(category)}</th>)}
            </tr></thead>
            <tbody>{measured.slice().reverse().map(day => <tr key={day.date} className="border-b border-slate-700/50">
              <th scope="row" className="p-1 text-left font-normal whitespace-nowrap">{format.dateTime(new Date(day.date), { dateStyle: "short", timeZone: "UTC" })}</th>
              {categories.map(category => <td key={category} className="p-1">{format.number(day.crawlerCounts[category])}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </>}
  </section>;
}
