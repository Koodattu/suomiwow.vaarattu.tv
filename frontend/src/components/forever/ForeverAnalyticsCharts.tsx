"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
  title: string; entries: ((ForeverAnalytics["classes"][number] | ForeverAnalytics["races"][number]) & { key?: string })[]; total: number; colored?: boolean;
}) {
  const t = useTranslations("forever"), maximum = Math.max(1, ...entries.map(entry => entry.count));
  return <section className={styles.panel} aria-label={title}>
    <div className={styles.panelHeading}><h2>{title}</h2></div>
    <ol className={styles.bars}>{entries.map(entry => {
      const segments = "factions" in entry ? (Object.keys(factionColors) as (keyof typeof factionColors)[])
        .filter(faction => entry.factions[faction] > 0)
        .map(faction => ({ count: entry.factions[faction], color: factionColors[faction], label: t(faction === "unknown" ? "statistics.unknown" : `factions.${faction}`) })) : null;
      const breakdown = segments?.map(segment => `${segment.label}: ${number.format(segment.count)}`).join(" · ");
      return <li key={entry.key ?? entry.name ?? "unknown"}>
      <span className={styles.barName} style={colored ? { color: classColor(entry.name ?? undefined) } : undefined}>{entry.name || t("statistics.unknown")}</span>
      <span className={styles.barTrack} role={segments ? "img" : undefined} aria-label={breakdown} title={breakdown} aria-hidden={segments ? undefined : true}>
        {segments ? segments.map(segment => <i key={segment.label} aria-hidden="true" style={{ width: `${segment.count / maximum * 100}%`, background: segment.color }} />)
          : <i style={{ width: `${entry.count / maximum * 100}%`, background: classColor(entry.name ?? undefined) }} />}
      </span>
      <strong>{number.format(entry.count)}</strong><span className={styles.share}>{percent(entry.count, total)}</span>
    </li>; })}</ol>
  </section>;
}

export default function ForeverAnalyticsCharts({ data, distribution = data.levels, minimumLevel = 1, controls }: {
  data: ForeverAnalytics; distribution?: ForeverAnalytics["levels"]; minimumLevel?: number; controls?: ReactNode;
}) {
  const t = useTranslations("forever"), [days, setDays] = useState(7);
  const distributionTotal = distribution.reduce((sum, entry) => sum + entry.count, 0);
  const cutoff = Date.parse(data.generatedAt) - days * 86400_000;
  const activity = data.activity.filter(point => Date.parse(point.at) >= cutoff).map(point => ({ ...point, timestamp: Date.parse(point.at) }));
  const latestActivity = activity[activity.length - 1];
  const activeShare = latestActivity?.observed ? Math.round(1000 * latestActivity.active / latestActivity.observed) / 10 : null;
  const cells = new Map(data.combinations.map(entry => [JSON.stringify([entry.race, entry.className]), entry]));
  const raceRows = data.races.flatMap(race => {
    const factions = race.name === "Skyborne"
      ? (Object.keys(factionColors) as (keyof typeof factionColors)[]).filter(faction => race.factions[faction] > 0)
      : [null];
    return factions.map(faction => ({
      key: JSON.stringify([race.name, faction]),
      name: race.name || t("statistics.unknown"),
      accessibleName: faction ? `${race.name} · ${t(faction === "unknown" ? "statistics.unknown" : `factions.${faction}`)}` : race.name || t("statistics.unknown"),
      race: race.name, faction,
      count: faction ? race.factions[faction] : race.count,
      factions: faction ? { alliance: 0, horde: 0, unknown: 0, [faction]: race.factions[faction] } : race.factions,
      counts: data.classes.map(classEntry => {
        const combination = cells.get(JSON.stringify([race.name, classEntry.name]));
        return (faction ? combination?.factions[faction] : combination?.count) || 0;
      }),
    }));
  });
  const raceBars = [...raceRows].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fi"));
  const matrixCounts = raceRows.flatMap(row => row.counts).filter(count => count > 0);
  const maximum = Math.max(1, ...matrixCounts);
  const minimum = Math.min(maximum, ...matrixCounts);
  const raceStyles = new Map(data.races.map(race => {
    const { alliance, horde } = race.factions;
    const style: CSSProperties = alliance && horde
      ? { backgroundImage: `linear-gradient(90deg, ${factionColors.alliance} 50%, ${factionColors.horde} 50%)`, backgroundClip: "text", color: "transparent" }
      : { color: alliance ? factionColors.alliance : horde ? factionColors.horde : factionColors.unknown };
    return [race.name, style];
  }));
  return <div className={styles.grid}>
    <section className={`${styles.panel} ${styles.full}`} aria-labelledby="forever-levels-title">
      <div className={styles.panelHeading}><h2 id="forever-levels-title">{t("analytics.levelDistribution")}</h2></div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={distribution} margin={{ top: 12, right: 6, left: 0, bottom: 0 }} aria-label={t("analytics.levelDistribution")}>
            <CartesianGrid vertical={false} stroke="#afc2a625" strokeDasharray="3 4" />
            <XAxis dataKey="level" ticks={[1, 10, 20, 30, 40, 50, 60]} interval={0} tick={axis} tickLine={false} stroke="#494f40" />
            <YAxis allowDecimals={false} width={42} tick={axis} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: "#d7b87513" }} content={({ active, payload }) => {
              const point = payload?.[0]?.payload as ForeverAnalytics["levels"][number] | undefined;
              return active && point ? <div className={styles.tooltip} role="status"><strong>{t("levelValue", { level: point.level })}</strong><span>{t("analytics.characterCount", { count: point.count })} · {percent(point.count, distributionTotal)}</span></div> : null;
            }} />
            <Bar dataKey="count" fill="#d7b875" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {distribution.map(entry => <Cell key={entry.level} fill={entry.level < minimumLevel ? "#62685f" : "#d7b875"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {controls}
    </section>
    {data.total === 0 ? <p className={`${styles.full} ${styles.note}`}>{t(distributionTotal ? "analytics.noMatches" : "emptyTitle")}</p> : <>
    <PopulationBars title={t("analytics.classes")} entries={data.classes} total={data.total} colored />
    <PopulationBars title={t("analytics.races")} entries={raceBars} total={data.total} />
    <section className={`${styles.panel} ${styles.full}`} aria-labelledby="forever-matrix-title">
      <div className={styles.panelHeading}><h2 id="forever-matrix-title">{t("analytics.raceClass")}</h2>
        <span className={styles.heatLegend}><i aria-hidden="true" />{minimum === maximum ? number.format(maximum) : `${number.format(minimum)}–${number.format(maximum)}`} {t("charactersShort")}</span></div>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={t("analytics.matrixScroll")}>
        <table className={styles.matrix}>
          <thead><tr><th scope="col">{t("race")}</th>{data.classes.map(entry => <th key={entry.name ?? "unknown"} scope="col" style={{ color: classColor(entry.name ?? undefined) }}>{entry.name || t("statistics.unknown")}</th>)}</tr></thead>
          <tbody>{raceRows.map(row => <tr key={row.key}><th scope="row" aria-label={row.accessibleName}><span style={row.faction ? { color: factionColors[row.faction] } : raceStyles.get(row.race)}>{row.name}</span></th>
            {data.classes.map((classEntry, index) => {
              const count = row.counts[index];
              const ratio = maximum === minimum ? 1 : (count - minimum) / (maximum - minimum);
              return <td key={classEntry.name ?? "unknown"} style={count ? { "--heat": `${Math.round(ratio * 100)}%` } as CSSProperties : undefined} data-zero={count === 0}>
                {count > 0 && <span title={`${row.accessibleName} · ${classEntry.name || t("statistics.unknown")}: ${number.format(count)} (${percent(count, data.total)})`}>{number.format(count)}</span>}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className={`${styles.panel} ${styles.full}`} aria-labelledby="forever-activity-title">
      <div className={`${styles.panelHeading} ${styles.activityHeading}`}><h2 id="forever-activity-title">{t("analytics.activity")}</h2>
        <dl className={styles.activityFacts}>
          <div><dt>{t("analytics.activeShort")}</dt><dd title={t("analytics.characterCount", { count: latestActivity?.active || 0 })}>{activeShare === null ? "—" : `${number.format(activeShare)} %`}</dd></div>
          <div><dt>{t("analytics.inactiveShort")}</dt><dd title={t("analytics.characterCount", { count: latestActivity ? latestActivity.observed - latestActivity.active : 0 })}>{activeShare === null ? "—" : `${number.format(100 - activeShare)} %`}</dd></div>
        </dl>
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
      </> : <p className={styles.note}>{t("analytics.noHistory")}</p>}
    </section>
    </>}
  </div>;
}
