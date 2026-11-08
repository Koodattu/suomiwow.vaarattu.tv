"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { foreverApi, type ForeverAnalytics } from "@/lib/forever-api";
import ForeverNav from "@/components/forever/ForeverNav";
import ForeverAnalyticsCharts from "@/components/forever/ForeverAnalyticsCharts";
import { ForeverErrorMessage, ForeverUpdated } from "@/components/forever/ForeverShared";
import world from "@/components/forever/forever.module.css";
import styles from "@/components/forever/analytics.module.css";

const number = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });
export default function ForeverAnalyticsPage() {
  const t = useTranslations("forever");
  const query = useQuery({ queryKey: ["forever", "analytics"], queryFn: () => foreverApi<ForeverAnalytics>("forever/analytics"),
    staleTime: 60_000, refetchInterval: 60_000 });
  const data = query.data;
  return <div className={world.world}><div className={`${world.shell} ${styles.shell}`}>
    <header className={styles.header}>
      <div className={world.heading}>
        <Link href="/forever" className={world.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <h1 className={world.title}>{t("analytics.title")}</h1>
      </div>
      <ForeverNav current="analytics" />
    </header>
    {query.error && <div className={styles.error}><ForeverErrorMessage error={query.error} /><button className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>}
    {query.isPending ? <div className={styles.loading} role="status">{t("loading")}</div> : data && <>
      <dl className={styles.summary}>
        <div><dt>{t("analytics.tracked")}</dt><dd>{number.format(data.total)}</dd></div>
        <div><dt>{t("analytics.active24h")}</dt><dd>{data.historyCharacters ? <>{number.format(data.active24h)} <small>{number.format(100 * data.active24h / data.total)} %</small></> : "—"}</dd></div>
        <div><dt>{t("analytics.medianLevel")}</dt><dd>{data.medianLevel === null ? "—" : number.format(data.medianLevel)}</dd></div>
        <div><dt>{t("statistics.atMaxLevel")}</dt><dd>{number.format(data.atMaxLevel)}</dd></div>
        <div className={styles.updated}><dt>{t("checked")}</dt><dd><ForeverUpdated value={data.generatedAt} /></dd></div>
      </dl>
      {data.total === 0 ? <div className={world.empty}><h2>{t("emptyTitle")}</h2><p>{t("emptyDescription")}</p></div> : <ForeverAnalyticsCharts data={data} />}
    </>}
  </div></div>;
}
