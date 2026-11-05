"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { foreverApi, foreverCharacterPath, foreverHistory, formatForeverDate, type ForeverCharacter } from "@/lib/forever-api";
import { classColor, ForeverDate, ForeverErrorMessage } from "./ForeverShared";
import styles from "./forever.module.css";

export function useForeverCharacter(identity: string) {
  return useQuery({ queryKey: ["forever", "character", identity], queryFn: () => foreverApi<ForeverCharacter>(`forever/characters/${encodeURIComponent(identity)}`), staleTime: 60_000, refetchInterval: 60_000 });
}

function ProgressChart({ character }: { character: ForeverCharacter }) {
  const t = useTranslations("forever"), chartId = useId(), host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640), [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width)); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const points = foreverHistory(character.history), last = points.at(-1);
  const activeIndex = Math.min(selected ?? points.length - 1, points.length - 1), active = points[activeIndex];
  const left = 32, right = width - 16, top = 16, bottom = 195, height = 228;
  const start = points[0]?.timestamp || 0, end = last?.timestamp || start;
  const x = (time: number) => end === start ? (left + right) / 2 : left + (time - start) / (end - start) * (right - left);
  const y = (level: number) => bottom - (level - 1) / 59 * (bottom - top);
  const line = points.map((point, index) => index === 0 ? `M${x(point.timestamp)},${y(point.level)}` : `H${x(point.timestamp)}V${y(point.level)}`).join(" ");
  const selectNearest = (clientX: number, bounds: DOMRect) => {
    const cursor = (clientX - bounds.left) / bounds.width * width;
    const index = points.reduce((best, point, i) => Math.abs(x(point.timestamp) - cursor) < Math.abs(x(points[best].timestamp) - cursor) ? i : best, 0);
    setSelected(index);
  };
  return <div className={styles.progressChart} ref={host} style={{ "--progress-color": classColor(character.className) } as CSSProperties}>
    <div className={styles.chartHeading}><h3>{t("progress.title")}</h3><span>{t("progress.observationCount", { count: points.length })}</span></div>
    {!last ? <div className={styles.chartEmpty}>{t("progress.noObservations")}</div> : <>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}
        onPointerMove={(event) => { if (event.pointerType === "mouse") selectNearest(event.clientX, event.currentTarget.getBoundingClientRect()); }}
        onPointerDown={(event) => selectNearest(event.clientX, event.currentTarget.getBoundingClientRect())}>
        <title id={`${chartId}-title`}>{t("progress.chartLabel", { name: character.name || character.slug })}</title>
        <desc id={`${chartId}-description`}>{t("progress.chartDescription", { start: points[0].level, end: last.level, count: points.length })} {t("historyNote")}</desc>
        <defs><linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--progress-color)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--progress-color)" stopOpacity=".015" /></linearGradient></defs>
        {[1, 20, 40, 60].map((level) => <g key={level}><line x1={left} x2={right} y1={y(level)} y2={y(level)} className={level === 60 ? styles.chartTarget : styles.chartGrid} /><text x={left - 8} y={y(level) + 4} textAnchor="end" className={level === 60 ? styles.chartTargetLabel : styles.chartAxis}>{level}</text></g>)}
        {points.length > 1 && <><path d={`${line} L${x(last.timestamp)},${bottom} L${x(start)},${bottom} Z`} fill={`url(#${chartId}-fill)`} /><path d={line} fill="none" stroke="var(--progress-color)" strokeWidth="2" strokeLinejoin="round" /></>}
        <line x1={x(active.timestamp)} x2={x(active.timestamp)} y1={top} y2={bottom} className={styles.chartCursor} />
        {points.map((point, index) => <circle key={`${point.timestamp}-${index}`} cx={x(point.timestamp)} cy={y(point.level)} r={index === activeIndex ? 5 : 3} fill={index === activeIndex ? "#f4dfa9" : "var(--progress-color)"} stroke="#151c17" strokeWidth="2" />)}
        <text x={end === start ? x(start) : left} y={height - 8} textAnchor={end === start ? "middle" : "start"} className={styles.chartAxis}>{formatForeverDate(new Date(start).toISOString(), true)}</text>
        {end !== start && <text x={right} y={height - 8} textAnchor="end" className={styles.chartAxis}>{formatForeverDate(new Date(end).toISOString(), true)}</text>}
      </svg>
      <div className={styles.chartObservation}><strong>{t("levelValue", { level: active.level })}</strong><time dateTime={new Date(active.timestamp).toISOString()}>{formatForeverDate(new Date(active.timestamp).toISOString())}</time>
        {points.length > 1 && <div className={styles.observationControl}><label htmlFor={`${chartId}-observation`}>{t("progress.observationPosition", { index: activeIndex + 1, count: points.length })}</label><input id={`${chartId}-observation`} aria-valuetext={`${t("levelValue", { level: active.level })}, ${formatForeverDate(new Date(active.timestamp).toISOString())}`} type="range" min={0} max={points.length - 1} value={activeIndex} onChange={(event) => setSelected(Number(event.target.value))} /></div>}
      </div>
      {points.length === 1 && <p className={styles.chartNote}>{t("progress.firstObservation")}</p>}
    </>}
    <p className={styles.chartNote}>{t("historyNote")}</p>
    {points.length > 0 && <details className={styles.observationTable}><summary>{t("progress.allObservations")}</summary><div className={styles.tableScroll}><table><thead><tr><th scope="col">{t("level")}</th><th scope="col">{t("progress.observedAt")}</th></tr></thead><tbody>{[...points].reverse().map((point, index) => <tr key={`${point.timestamp}-${index}`}><td>{point.level}</td><td>{formatForeverDate(new Date(point.timestamp).toISOString())}</td></tr>)}</tbody></table></div></details>}
  </div>;
}

export function CharacterDetails({ character, showCharacterLink = true }: { character: ForeverCharacter; showCharacterLink?: boolean }) {
  const t = useTranslations("forever"), { user } = useAuth();
  const [busy, setBusy] = useState(false), [queued, setQueued] = useState(false), [error, setError] = useState<unknown>(null);
  const points = foreverHistory(character.history), first = points[0], last = points.at(-1);
  const gained = first && last ? last.level - first.level : null;
  return <div className={styles.characterDetails}>
    <ProgressChart character={character} />
    <aside className={styles.progressAside}>
      <div className={styles.progressStats}>
        <div><strong>{gained === null ? "—" : `+${gained}`}</strong><span>{t("progress.levelsObserved")}</span></div>
        <div><strong>{character.level == null ? "—" : Math.max(0, 60 - character.level)}</strong><span>{t("progress.toGo")}</span></div>
      </div>
      <dl className={styles.progressFacts}>
        <div><dt>{t("progress.firstSeen")}</dt><dd><ForeverDate value={first ? new Date(first.timestamp).toISOString() : undefined} compact /></dd></div>
        <div><dt>{t("sourceUpdated")}</dt><dd><ForeverDate value={character.sourceUpdatedAt} compact /></dd></div>
      </dl>
      {character.errorCode && <p className={styles.chartNote}>{t("retrying")}</p>}
      <div className={styles.progressActions}>
        <a className={styles.button} href={character.armoryUrl} target="_blank" rel="noreferrer">{t("openArmory")}</a>
        {showCharacterLink && <Link className={styles.detailLink} href={foreverCharacterPath(character)}>{t("progress.characterLink")} ↗</Link>}
        {user && <button className={styles.detailLink} disabled={busy || queued || !!character.errorCode} onClick={async () => {
          setBusy(true); setError(null);
          try { await foreverApi(`forever/characters/${character._id}/refresh`, "POST"); setQueued(true); }
          catch (caught) { setError(caught); } finally { setBusy(false); }
        }}>{t(queued ? "refreshQueued" : "refresh")}</button>}
      </div>
      {error != null && <ForeverErrorMessage error={error} />}
    </aside>
  </div>;
}

export function CharacterDetailsLoader({ identity }: { identity: string }) {
  const t = useTranslations("forever"), query = useForeverCharacter(identity);
  if (query.isPending) return <div className={styles.detailsLoading} role="status">{t("loading")}</div>;
  if (query.error) return <div className={styles.detailsLoading}><ForeverErrorMessage error={query.error} /><button className={styles.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>;
  return query.data ? <CharacterDetails character={query.data} /> : null;
}
