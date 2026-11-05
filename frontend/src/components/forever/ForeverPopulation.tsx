"use client";

import { useTranslations } from "next-intl";
import type { ForeverStatistics } from "@/lib/forever-api";
import styles from "./forever.module.css";

const number = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("fi-FI", { style: "percent", maximumFractionDigits: 0 });
const colors: Record<string, string> = { Horde: "#c75750", Alliance: "#5794db", PvP: "#c78956", Normal: "#a5b780", Roleplay: "#b397d0", Hardcore: "#db7979" };

function Breakdown({ title, entries, total, scope }: {
  title: string; entries: { name: string | null; count: number }[]; total: number; scope?: string;
}) {
  const t = useTranslations("forever");
  return <div className={styles.populationGroup}>
    <div className={styles.populationHeading}><h2>{title}</h2>{scope && <span>{scope}</span>}</div>
    <div className={styles.populationBar} aria-hidden="true">{entries.filter((entry) => entry.count > 0).map((entry) => <span key={entry.name ?? "unknown"}
      style={{ width: `${total ? entry.count / total * 100 : 0}%`, background: colors[entry.name || ""] || "#8c928b" }} />)}</div>
    <dl className={styles.populationLegend}>{entries.map((entry) => <div key={entry.name ?? "unknown"}>
      <dt><i aria-hidden="true" style={{ background: colors[entry.name || ""] || "#8c928b" }} />{entry.name === "Horde" || entry.name === "Alliance" ? t(`factions.${entry.name.toLowerCase()}`) : entry.name || t("statistics.unknown")}</dt>
      <dd><strong>{number.format(entry.count)}</strong><span>{percent.format(total ? entry.count / total : 0)}</span></dd>
    </div>)}</dl>
    {entries.length === 0 && <p className={styles.populationEmpty}>{t("statistics.noData")}</p>}
  </div>;
}

export default function ForeverPopulation({ statistics, total, filtered, loading }: {
  statistics?: ForeverStatistics; total: number; filtered: boolean; loading: boolean;
}) {
  const t = useTranslations("forever.statistics");
  if (!statistics) return loading ? <div className={`${styles.population} ${styles.populationLoading}`} aria-label={t("loading")} aria-busy="true" /> : null;
  const factions = ["Horde", "Alliance"].map((name) => ({ name, count: statistics.factions.find((entry) => entry.name === name)?.count || 0 }));
  const allFactions = [...factions, ...statistics.factions.filter((entry) => entry.name !== "Horde" && entry.name !== "Alliance")];
  return <section className={styles.population} aria-label={t("summary", { count: total })}>
    <Breakdown title={t("factions")} entries={allFactions} total={total} scope={t(filtered ? "filtered" : "all")} />
    <Breakdown title={t("rulesets")} entries={statistics.rulesets} total={total} />
    <dl className={styles.populationLevels}>
      <div><dt>{t("averageLevel")}</dt><dd>{statistics.averageLevel === null ? "—" : number.format(statistics.averageLevel)}</dd></div>
      <div><dt>{t("atMaxLevel")}</dt><dd>{number.format(statistics.atMaxLevel)}<span>{percent.format(total ? statistics.atMaxLevel / total : 0)}</span></dd></div>
    </dl>
  </section>;
}
