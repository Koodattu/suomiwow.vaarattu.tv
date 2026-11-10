"use client";

import { useTranslations } from "next-intl";
import type { ForeverAnalyticsTimeline } from "@/lib/forever-api";
import styles from "./analytics.module.css";

export const analyticsDate = (date: string) => new Intl.DateTimeFormat("fi-FI", {
  timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", year: "numeric",
}).format(new Date(`${date}T12:00:00Z`));

export default function ForeverAnalyticsControls({ timeline, index, minimum, onDate, onMinimum }: {
  timeline: ForeverAnalyticsTimeline; index: number; minimum: number;
  onDate: (date: string | null) => void; onMinimum: (level: number) => void;
}) {
  const t = useTranslations("forever.analytics");
  const last = timeline.days.length - 1;
  const current = index === last;
  const dateLabel = current ? t("today") : analyticsDate(timeline.days[index].date);
  return <section className={styles.controls} aria-label={t("explore")}>
    <div className={styles.control}>
      <div className={styles.controlLabel}><label htmlFor="analytics-date">{t("date")}</label>
        <output htmlFor="analytics-date">{dateLabel}</output></div>
      <input id="analytics-date" type="range" min={0} max={last} step={1} value={index} disabled={last === 0}
        aria-valuetext={dateLabel} onChange={event => { const next = Number(event.target.value); onDate(next === last ? null : timeline.days[next].date); }} />
      <button className={styles.controlReset} onClick={() => onDate(null)} disabled={current}>{t("today")}</button>
    </div>
    <div className={styles.control}>
      <div className={styles.controlLabel}><label htmlFor="analytics-minimum">{t("minimumLevel")}</label>
        <output htmlFor="analytics-minimum">{minimum}+</output></div>
      <input id="analytics-minimum" type="range" min={1} max={60} step={1} value={minimum}
        aria-valuetext={t("levelAndAbove", { level: minimum })} onChange={event => onMinimum(Number(event.target.value))} />
      <button className={styles.controlReset} onClick={() => onMinimum(1)} disabled={minimum === 1}>{t("allLevels")}</button>
    </div>
  </section>;
}
