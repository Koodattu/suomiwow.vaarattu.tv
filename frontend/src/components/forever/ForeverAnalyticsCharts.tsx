"use client";

import { useState, type CSSProperties } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { formatForeverDate, type ForeverAnalytics } from "@/lib/forever-api";
import { classColor } from "./ForeverShared";
import styles from "./analytics.module.css";

const number = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });
const percent = (count: number, total: number) => `${number.format(total ? 100 * count / total : 0)} %`;
const axis = { fill: "#b9b4a4", fontSize: 11 };
const factionColors = { alliance: "#5794db", horde: "#c75750", unknown: "#b5be89" };
const date = (timestamp: number) => new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", day: "numeric", month: "numeric" }).format(timestamp);

function PopulationBars({ title, entries, total, colored = false }: {
  title: string; entries: (ForeverAnalytics["classes"][number] | ForeverAnalytics["races"][number])[]; total: number; colored?: boolean;
}) {
  const t = useTranslations("forever"), maximum = Math.max(1, ...entries.map(entry => entry.count));
  return <section className={styles.panel} aria-label={title}>
    <div className={styles.panelHeading}><h2>{title}</h2><span>{t("analytics.charactersAndShare")}</span></div>
    {!colored && <div className={styles.legend}>{(["alliance", "horde"] as const).map(faction => <span key={faction}><i style={{ background: factionColors[faction] }} />{t(`factions.${faction}`)}</span>)}</div>}
    <ol className={styles.bars}>{entries.map(entry => {
      const segments = "factions" in entry ? (Object.keys(factionColors) as (keyof typeof factionColors)[])
        .filter(faction => entry.factions[faction] > 0)
        .map(faction => ({ count: entry.factions[faction], color: factionColors[faction], label: t(faction === "unknown" ? "statistics.unknown" : `factions.${faction}`) })) : null;
      const breakdown = segments?.map(segment => `${segment.label}: ${number.format(segment.count)}`).join(" · ");
      return <li key={entry.name ?? "unknown"}>
      <span className={styles.barName} style={colored ? { color: classColor(entry.name ?? undefined) } : undefined}>{entry.name || t("statistics.unknown")}</span>
      <span className={styles.barTrack} role={segments ? "img" : undefined} aria-label={breakdown} title={breakdown} aria-hidden={segments ? undefined : true}>
        {segments ? segments.map(segment => <i key={segment.label} aria-hidden="true" style={{ width: `${segment.count / maximum * 100}%`, background: segment.color }} />)
          : <i style={{ width: `${entry.count / maximum * 100}%`, background: classColor(entry.name ?? undefined) }} />}
      </span>
      <strong>{number.format(entry.count)}</strong><span className={styles.share}>{percent(entry.count, total)}</span>
    </li>; })}</ol>
  </section>;
}

export default function ForeverAnalyticsCharts({ data }: { data: ForeverAnalytics }) {
  const t = useTranslations("forever"), [days, setDays] = useState(7);
  const cutoff = Date.parse(data.generatedAt) - days * 86400_000;
  const activity = data.activity.filter(point => Date.parse(point.at) >= cutoff).map(point => ({ ...point, timestamp: Date.parse(point.at) }));
  const combinations = data.combinations.filter(entry => entry.race && entry.className);
  const popular = combinations.slice(0, 5);
  const rare = [...combinations].sort((a, b) => a.count - b.count || `${a.race} ${a.className}`.localeCompare(`${b.race} ${b.className}`, "fi")).slice(0, 5);
  const maximum = Math.max(1, ...data.combinations.map(entry => entry.count));
  const cells = new Map(data.combinations.map(entry => [JSON.stringify([entry.race, entry.className]), entry.count]));
  const activityNote = t("analytics.activityNote");
  return <div className={styles.grid}>
    <section className={`${styles.panel} ${styles.full}`} aria-labelledby="forever-levels-title">
      <div className={styles.panelHeading}><h2 id="forever-levels-title">{t("analytics.levelDistribution")}</h2><span>{t("analytics.levelRange")}</span></div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={data.levels} margin={{ top: 12, right: 6, left: 0, bottom: 0 }} aria-label={t("analytics.levelDistribution")}>
            <CartesianGrid vertical={false} stroke="#afc2a625" strokeDasharray="3 4" />
            <XAxis dataKey="level" ticks={[1, 10, 20, 30, 40, 50, 60]} interval={0} tick={axis} tickLine={false} stroke="#494f40" />
            <YAxis allowDecimals={false} width={42} tick={axis} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: "#d7b87513" }} content={({ active, payload }) => {
              const point = payload?.[0]?.payload as ForeverAnalytics["levels"][number] | undefined;
              return active && point ? <div className={styles.tooltip} role="status"><strong>{t("levelValue", { level: point.level })}</strong><span>{t("analytics.characterCount", { count: point.count })} · {percent(point.count, data.total)}</span></div> : null;
            }} />
            <Bar dataKey="count" fill="#d7b875" isAnimationActive={false} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className={styles.dataTable}><summary>{t("analytics.viewData")}</summary><div className={styles.scroll} tabIndex={0} role="region" aria-label={t("analytics.levelDistribution")}><table>
        <thead><tr><th scope="col">{t("level")}</th><th scope="col">{t("charactersShort")}</th></tr></thead>
        <tbody>{data.levels.map(entry => <tr key={entry.level}><th scope="row">{entry.level}</th><td>{number.format(entry.count)}</td></tr>)}</tbody>
      </table></div></details>
    </section>
    <PopulationBars title={t("analytics.classes")} entries={data.classes} total={data.total} colored />
    <PopulationBars title={t("analytics.races")} entries={data.races} total={data.total} />
    <section className={`${styles.panel} ${styles.full}`} aria-labelledby="forever-matrix-title">
      <div className={styles.panelHeading}><h2 id="forever-matrix-title">{t("analytics.raceClass")}</h2>
        <span className={styles.heatLegend}><i aria-hidden="true" />0–{number.format(maximum)} {t("charactersShort")}</span></div>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={t("analytics.matrixScroll")}>
        <table className={styles.matrix}>
          <thead><tr><th scope="col">{t("race")}</th>{data.classes.map(entry => <th key={entry.name ?? "unknown"} scope="col" style={{ color: classColor(entry.name ?? undefined) }}>{entry.name || t("statistics.unknown")}</th>)}</tr></thead>
          <tbody>{data.races.map(race => <tr key={race.name ?? "unknown"}><th scope="row">{race.name || t("statistics.unknown")}</th>
            {data.classes.map(classEntry => {
              const count = cells.get(JSON.stringify([race.name, classEntry.name])) || 0;
              const ratio = count / maximum;
              return <td key={classEntry.name ?? "unknown"} style={{ "--heat": `${Math.round(ratio * 100)}%`, color: ratio > .52 ? "#000" : "#fff" } as CSSProperties} data-zero={count === 0}>
                <span title={`${race.name || t("statistics.unknown")} · ${classEntry.name || t("statistics.unknown")}: ${number.format(count)} (${percent(count, data.total)})`}>{number.format(count)}</span>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <p className={styles.note}>{t("analytics.matrixNote")}</p>
      <div className={styles.combinations}>{[{ title: t("analytics.mostCommon"), entries: popular }, { title: t("analytics.rarest"), entries: rare }].map(group => <div key={group.title}>
        <h3>{group.title}</h3><ol>{group.entries.map(entry => <li key={`${entry.race}-${entry.className}`}><span>{entry.race} <strong style={{ color: classColor(entry.className!) }}>{entry.className}</strong></span><span>{number.format(entry.count)} <small>{percent(entry.count, data.total)}</small></span></li>)}</ol>
        {!group.entries.length && <p className={styles.note}>{t("statistics.noData")}</p>}
      </div>)}</div>
    </section>
    <section className={`${styles.panel} ${styles.full}`} aria-labelledby="forever-activity-title">
      <div className={styles.panelHeading}><div><h2 id="forever-activity-title">{t("analytics.activity")}</h2><p>{t("analytics.activeDefinition")}</p></div>
        <div className={styles.range} role="group" aria-label={t("analytics.timeRange")}>{[7, 30].map(value => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{t("analytics.days", { count: value })}</button>)}</div>
      </div>
      {activity.length ? <>
        <div className={styles.legend}><span><i style={{ background: "#d7b875" }} />{t("analytics.active")}</span><span><i style={{ background: "#849b93" }} />{t("analytics.observed")}</span></div>
        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={activity} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} aria-label={t("analytics.activity")}>
              <CartesianGrid vertical={false} stroke="#afc2a625" strokeDasharray="3 4" />
              <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={date} tickCount={7} minTickGap={40} tick={axis} tickLine={false} stroke="#494f40" />
              <YAxis allowDecimals={false} domain={[0, "auto"]} width={42} tick={axis} axisLine={false} tickLine={false} />
              <Tooltip content={({ active, payload }) => {
                const point = payload?.[0]?.payload as (typeof activity)[number] | undefined;
                return active && point ? <div className={styles.tooltip} role="status"><strong>{formatForeverDate(point.at)}</strong><span>{t("analytics.active")}: {number.format(point.active)} · {percent(point.active, point.observed)}</span><span>{t("analytics.observed")}: {number.format(point.observed)}</span>{point.partial && <small>{t("analytics.partialWindow")}</small>}</div> : null;
              }} />
              <Line dataKey="observed" type="linear" stroke="#849b93" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="active" type="linear" stroke="#d7b875" strokeWidth={2.5} dot={activity.length === 1 ? { r: 4 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className={styles.note}>{activityNote}{activity.some(point => point.partial) && ` ${t("analytics.partialWindow")}`}</p>
        <details className={styles.dataTable}><summary>{t("analytics.viewData")}</summary><div className={styles.scroll} tabIndex={0} role="region" aria-label={t("analytics.activity")}><table>
          <thead><tr><th scope="col">{t("progress.observedAt")}</th><th scope="col">{t("analytics.active")}</th><th scope="col">{t("analytics.observed")}</th></tr></thead>
          <tbody>{activity.map(point => <tr key={point.at}><th scope="row">{formatForeverDate(point.at)}{point.partial && <small> · {t("analytics.partialWindow")}</small>}</th><td>{number.format(point.active)}</td><td>{number.format(point.observed)}</td></tr>)}</tbody>
        </table></div></details>
      </> : <p className={styles.note}>{t("analytics.noHistory")}</p>}
    </section>
  </div>;
}
