"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useTranslations } from "next-intl";
import type { ForeverStatistics } from "@/lib/forever-api";
import styles from "./forever.module.css";

const number = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("fi-FI", { style: "percent", maximumFractionDigits: 0 });
const colors: Record<string, string> = { Horde: "#c75750", Alliance: "#5794db", PvP: "#c78956", Normal: "#a5b780", Roleplay: "#b397d0", "Roleplay PvP": "#69b8b0", Hardcore: "#db7979" };
const color = (name: string | null) => colors[name || ""] || "#8c928b";

function Breakdown({ title, entries, total }: {
  title: string; entries: { name: string | null; count: number }[]; total: number;
}) {
  const t = useTranslations("forever");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartData = entries.filter((entry) => entry.count > 0).map((entry) => ({ ...entry,
    label: entry.name === "Horde" || entry.name === "Alliance" ? t(`factions.${entry.name.toLowerCase()}`) : entry.name || t("statistics.unknown"),
  }));
  return <div className={styles.populationGroup}>
    <h2>{title}</h2>
    <div className={styles.populationPieRow}>
      <div className={styles.populationPie}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart aria-label={title}>
            <Tooltip allowEscapeViewBox={{ x: true, y: true }} content={({ active, payload }) => {
              const entry = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
              return active && entry ? <div className={styles.chartTooltip} role="status"><strong>{entry.label}</strong><span>{number.format(entry.count)} ({percent.format(total ? entry.count / total : 0)})</span></div> : null;
            }} />
            <Pie data={chartData} dataKey="count" nameKey="label" outerRadius="95%" stroke="#172018" strokeWidth={1} isAnimationActive={false}
              onMouseEnter={(_, index) => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>
              {chartData.map((entry, index) => <Cell key={entry.name ?? "unknown"} fill={color(entry.name)} opacity={activeIndex === null || activeIndex === index ? 1 : .45} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <dl className={styles.populationLegend}>{entries.map((entry) => <div key={entry.name ?? "unknown"}>
        <dt><i aria-hidden="true" style={{ background: color(entry.name) }} />{entry.name === "Horde" || entry.name === "Alliance" ? t(`factions.${entry.name.toLowerCase()}`) : entry.name || t("statistics.unknown")}</dt>
        <dd><strong>{number.format(entry.count)}</strong><span>{percent.format(total ? entry.count / total : 0)}</span></dd>
      </div>)}</dl>
    </div>
    {entries.length === 0 && <p className={styles.populationEmpty}>{t("statistics.noData")}</p>}
  </div>;
}

export default function ForeverPopulation({ statistics, total, loading, layout = "compact" }: {
  statistics?: ForeverStatistics; total: number; loading: boolean; layout?: "compact" | "analytics";
}) {
  const t = useTranslations("forever");
  if (!statistics) return loading ? <div className={`${styles.population} ${styles.populationLoading}`} aria-label={t("statistics.loading")} aria-busy="true" /> : null;
  const factions = ["Horde", "Alliance"].map((name) => ({ name, count: statistics.factions.find((entry) => entry.name === name)?.count || 0 }));
  const allFactions = [...factions, ...statistics.factions.filter((entry) => entry.name !== "Horde" && entry.name !== "Alliance")];
  const combinations = <>
    <table>
      <caption>{t("statistics.combinations")}</caption>
      <thead><tr><th scope="col">{t("ruleset")}</th>{allFactions.map(({ name }) => <th key={name ?? "unknown"} scope="col" style={{ color: color(name) }}>{name === "Horde" || name === "Alliance" ? t(`factions.${name.toLowerCase()}`) : name || t("statistics.unknown")}</th>)}</tr></thead>
      <tbody>{statistics.rulesets.map((ruleset) => <tr key={ruleset.name ?? "unknown"}>
        <th scope="row">{ruleset.name || t("statistics.unknown")}</th>
        {allFactions.map((faction) => {
          const count = statistics.combinations?.find((entry) => entry.faction === faction.name && entry.ruleset === ruleset.name)?.count || 0;
          return <td key={faction.name ?? "unknown"} data-empty={count === 0} title={percent.format(total ? count / total : 0)}>{number.format(count)}</td>;
        })}
      </tr>)}</tbody>
    </table>
    {!total && <p className={styles.populationEmpty}>{t("statistics.noData")}</p>}
  </>;
  return <section className={`${styles.population} ${layout === "analytics" ? styles.populationAnalytics : ""}`} aria-label={t("statistics.summary", { count: total })}>
    <Breakdown title={t("statistics.factions")} entries={allFactions} total={total} />
    <Breakdown title={t("statistics.rulesets")} entries={statistics.rulesets} total={total} />
    <div className={styles.populationCombinations}>{combinations}</div>
  </section>;
}

export function ForeverBoardSummary({ statistics, total, filtered }: { statistics?: ForeverStatistics; total?: number; filtered: boolean }) {
  const t = useTranslations("forever");
  if (!statistics || total === undefined) return null;
  return <div className={styles.boardSummary}>
    <span><strong>{number.format(total)}</strong> {t("charactersShort")}</span>
    <span>{t(filtered ? "statistics.filtered" : "statistics.all")}</span>
    <span>{t("statistics.averageLevel")} <strong>{statistics.averageLevel === null ? "\u2014" : number.format(statistics.averageLevel)}</strong></span>
    <span>{t("statistics.atMaxLevel")} <strong>{number.format(statistics.atMaxLevel)}</strong></span>
  </div>;
}
