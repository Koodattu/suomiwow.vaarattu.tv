"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { foreverApi, type ForeverAnalytics } from "@/lib/forever-api";
import ForeverNav from "@/components/forever/ForeverNav";
import ForeverAnalyticsCharts from "@/components/forever/ForeverAnalyticsCharts";
import ForeverPopulation from "@/components/forever/ForeverPopulation";
import ForeverAnalyticsControls, { analyticsDate } from "@/components/forever/ForeverAnalyticsControls";
import { selectForeverAnalytics } from "@/lib/forever-analytics";
import { foreverLevelingRefetchInterval } from "@/lib/forever-leveling-query";
import { ForeverErrorMessage, ForeverUpdated } from "@/components/forever/ForeverShared";
import world from "@/components/forever/forever.module.css";
import styles from "@/components/forever/analytics.module.css";

const number = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });
export default function ForeverAnalyticsPage() {
  const t = useTranslations("forever");
  // A null date follows today across refetches and midnight; past selections stay put.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [minimum, setMinimum] = useState(1);
  const query = useQuery({ queryKey: ["forever", "analytics"], queryFn: () => foreverApi<ForeverAnalytics>("forever/analytics"),
    staleTime: 15_000, refetchInterval: query => foreverLevelingRefetchInterval(query.state.data) });
  const timeline = query.data?.timeline;
  const last = (timeline?.days.length || 1) - 1;
  const index = selectedDate && timeline ? Math.max(0, timeline.days.findIndex(day => day.date === selectedDate)) : last;
  const population = useMemo(() => timeline?.days.length ? selectForeverAnalytics(timeline, index, 1) : query.data,
    [timeline, index, query.data]);
  const data = useMemo(() => timeline?.days.length && minimum > 1 ? selectForeverAnalytics(timeline, index, minimum) : population,
    [timeline, index, minimum, population]);
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
        <div><dt>{t("analytics.new24h")}</dt><dd>{data.new24h == null ? "—" : number.format(data.new24h)}</dd></div>
        <div><dt>{t("analytics.levelsGained24h")}</dt><dd>{data.levelsGained24h == null ? "—" : number.format(data.levelsGained24h)}</dd></div>
        <div><dt>{t("analytics.medianLevel")}</dt><dd>{data.medianLevel === null ? "—" : number.format(data.medianLevel)}</dd></div>
        <div><dt>{t("statistics.atMaxLevel")}</dt><dd>{number.format(data.atMaxLevel)}</dd></div>
        <div className={styles.updated}><dt>{index < last ? t("analytics.dayEnd") : t("checked")}</dt><dd>{index < last && timeline ? analyticsDate(timeline.days[index].date) : <ForeverUpdated value={data.generatedAt} />}</dd></div>
      </dl>
      {data.total > 0 && <ForeverPopulation statistics={data.statistics} total={data.total} loading={false} layout="analytics" />}
      <ForeverAnalyticsCharts data={data} distribution={population?.levels} minimumLevel={minimum}
        controls={timeline && <ForeverAnalyticsControls timeline={timeline} index={index} minimum={minimum} onDate={setSelectedDate} onMinimum={setMinimum} />} />
    </>}
  </div></div>;
}
