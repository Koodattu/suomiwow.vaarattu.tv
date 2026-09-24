"use client";

import { useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import type { DeathAnalysisPull } from "@/types/character-deaths";
import { buildDeathTimeline, deathPosition, deathPullKey, deathTimeLabel } from "@/lib/death-timeline";
import styles from "./DeathTimeline.module.css";

export default function DeathTimeline({ pulls, name, update }: { pulls: DeathAnalysisPull[]; name: string; update: (values: Record<string, string>) => void }) {
  const t = useTranslations("deathAnalysis");
  const locale = useLocale();
  const params = useSearchParams();
  const inspectorRef = useRef<HTMLElement>(null);
  const session = params.get("session") ?? "";
  const focus = params.get("focus") ?? "all";
  const axis = params.get("axis") === "percent" ? "percent" : "seconds";
  const cluster = params.has("cluster") ? Number(params.get("cluster")) : null;
  const model = useMemo(() => buildDeathTimeline(pulls, session, focus, axis, cluster), [pulls, session, focus, axis, cluster]);
  const selected = model.visible.find((pull) => deathPullKey(pull) === params.get("pull"));
  const selectedDeathIndex = Math.max(0, Number(params.get("death")) || 0);
  const selectedDeath = selected?.deaths[selectedDeathIndex] ?? selected?.deaths[0];
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const label = (value: number) => axis === "percent" ? `${Math.round(value)}%` : deathTimeLabel(value);
  const position = (time: number, duration: number) => (deathPosition(time, duration, axis) - model.start) / (model.end - model.start) * 100;
  const pullNumber = new Map(pulls.map((pull, index) => [deathPullKey(pull), index + 1]));
  const maxBin = Math.max(1, ...model.bins);
  const selectPull = (pull: DeathAnalysisPull, death = 0) => update({ pull: deathPullKey(pull), death: String(death) });
  const status = (pull: DeathAnalysisPull) => !pull.complete ? t("missingData") : pull.deaths.length ? t("pullDeathCount", { count: pull.deaths.length }) : t("survived");

  return (
    <section className={styles.explorer} aria-label={t("timeline")}>
      <div className={styles.toolbar}>
        <label>{t("session")}<select aria-label={t("session")} value={session} onChange={(event) => update({ session: event.target.value, cluster: "", pull: "", death: "" })}>
          <option value="">{t("allSessions", { count: model.sessions.length })}</option>
          {model.sessions.map((entry) => <option key={entry.code} value={entry.code}>{date(entry.date)} · {entry.code.slice(-4)} · {t("pullCount", { count: entry.pulls })}</option>)}
        </select></label>
        <label>{t("focus")}<select aria-label={t("focus")} value={focus} onChange={(event) => update({ focus: event.target.value, cluster: "", pull: "", death: "" })}>
          <option value="all">{t("allPulls")}</option><option value="early">{t("firstThree")}</option><option value="repeat">{t("repeatDeaths")}</option><option value="survived">{t("survived")}</option><option value="missing">{t("missingData")}</option>
        </select></label>
        <div className={styles.axisSwitch} aria-label={t("timeScale")} role="group">
          {(["seconds", "percent"] as const).map((value) => <button type="button" key={value} aria-pressed={axis === value} onClick={() => update({ axis: value, cluster: "" })}>{t(value === "seconds" ? "elapsedTime" : "relativeTime")}</button>)}
        </div>
      </div>

      <div className={styles.workspace}>
        <div className={styles.chart}>
          <div className={styles.chartHeading}>
            <div><h2>{t("pullMap")}</h2><p>{t("mapHint")}</p></div>
            <span className={styles.count} role="status">{t("visiblePulls", { count: model.visible.length, total: model.scoped.length })}</span>
          </div>
          <div className={styles.densityHeader}><span>{t("deathClusters")}</span><button type="button" disabled={model.activeCluster === null} onClick={() => update({ cluster: "" })}>{t("fullTimeline")}</button></div>
          <div className={styles.density} role="group" aria-label={t("deathClusters")}>
            {model.bins.map((count, index) => <button type="button" key={index} aria-pressed={model.activeCluster === index} disabled={!count && model.activeCluster !== index}
              aria-label={t("clusterLabel", { from: label(index / 16 * model.maximum), to: label((index + 1) / 16 * model.maximum), count })}
              title={t("clusterLabel", { from: label(index / 16 * model.maximum), to: label((index + 1) / 16 * model.maximum), count })}
              style={{ backgroundColor: count ? `rgba(251, 113, 133, ${0.12 + count / maxBin * 0.5})` : undefined }}
              onClick={() => update({ cluster: model.activeCluster === index ? "" : String(index), pull: "", death: "" })}><span>{count || "·"}</span></button>)}
          </div>
          <div className={styles.densityLabels}><span>{label(0)}</span><span>{t("clusterHint")}</span><span>{label(model.maximum)}</span></div>
          <div className={styles.axis}><span>{t("attempt")}</span><div>{[0, 1, 2, 3, 4].map((tick) => <span key={tick} style={{ left: `${tick * 25}%` }}>{label(model.start + (model.end - model.start) * tick / 4)}</span>)}</div><span>{t("outcome")}</span></div>
          <div className={styles.pullList} tabIndex={0} aria-label={t("pullMap")}>
            {!model.visible.length ? <div className={styles.empty}><strong>{t("noMatchingPulls")}</strong><p>{t("emptyMapHint")}</p><button type="button" onClick={() => update({ focus: "", cluster: "", session: "", pull: "", death: "" })}>{t("resetExplorer")}</button></div> : model.visible.map((pull) => {
              const key = deathPullKey(pull);
              const end = Math.max(0, Math.min(100, position(pull.duration, pull.duration)));
              return <button type="button" key={key} className={styles.pull} data-selected={selected && deathPullKey(selected) === key} aria-pressed={selected && deathPullKey(selected) === key ? true : false}
                aria-label={t("pullLabel", { number: pullNumber.get(key) ?? 0, date: date(pull.date), duration: deathTimeLabel(pull.duration), status: status(pull) })}
                onClick={(event) => {
                  const marker = (event.target as HTMLElement).closest<HTMLElement>("[data-death]");
                  const firstVisibleDeath = pull.deaths.findIndex((death) => {
                    const x = position(death.deathTime, pull.duration);
                    return x >= 0 && x <= 100;
                  });
                  selectPull(pull, marker ? Number(marker.dataset.death) : Math.max(0, firstVisibleDeath));
                }}>
                <span className={styles.pullLabel}><strong>#{pullNumber.get(key)}</strong><small>{date(pull.date)}</small></span>
                <span className={styles.track}>
                  {[0, 25, 50, 75, 100].map((tick) => <i key={tick} className={styles.gridline} style={{ left: `${tick}%` }} />)}
                  <span className={styles.lifespan} data-complete={pull.complete} style={{ width: `${end}%` }} />
                  {pull.deaths.map((death, index) => {
                    const x = position(death.deathTime, pull.duration);
                    return x >= 0 && x <= 100 ? <span key={index} data-death={index} className={styles.deathMarker} data-early={death.order !== null && death.order <= 3} style={{ left: `${x}%` }} aria-hidden="true">{death.order !== null && death.order <= 3 ? "◆" : "×"}</span> : null;
                  })}
                  {!pull.complete ? <span className={styles.missingMarker} style={{ left: `${end}%` }}>?</span> : !pull.deaths.length ? <span className={styles.survivalMarker} style={{ left: `${end}%` }}>✓</span> : <i className={styles.endMarker} style={{ left: `${end}%` }} />}
                </span>
                <span className={styles.pullOutcome} data-kill={pull.isKill}>{pull.isKill ? t("kill") : t("wipe")}</span>
              </button>;
            })}
          </div>
          <div className={styles.legend}><span><b className={styles.earlyColor}>◆</b> {t("firstThree")}</span><span><b className={styles.deathColor}>×</b> {t("deathMarker")}</span><span><b className={styles.survivalColor}>✓</b> {t("survived")}</span><span>? {t("missingData")}</span></div>
          {selected && <button type="button" className={styles.mobileInspect} onClick={() => { inspectorRef.current?.scrollIntoView({ block: "start", behavior: "instant" }); inspectorRef.current?.focus({ preventScroll: true }); }}>{t("inspectPull", { number: pullNumber.get(deathPullKey(selected)) ?? 0 })} ↓</button>}
        </div>

        <aside ref={inspectorRef} tabIndex={-1} className={styles.inspector} aria-label={t("pullDetails")}>
          {!selected ? <div className={styles.inspectorEmpty}><span className={styles.emptyGlyph} aria-hidden="true">↖</span><h3>{t("selectPull")}</h3><p>{t("selectPullHint")}</p><p className={styles.capability}>{t("causeCompact")}</p></div> : <>
            <div className={styles.inspectorHeading}><span>{t("attempt")} #{pullNumber.get(deathPullKey(selected))}</span><button type="button" aria-label={t("closeDetails")} onClick={() => update({ pull: "", death: "" })}>×</button></div>
            <h3>{new Date(selected.date).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</h3>
            <p className={styles.pullMeta}>{selected.isKill ? t("kill") : t("wipe")} · {deathTimeLabel(selected.duration)} · {status(selected)}</p>
            {!selected.complete ? <p className={styles.notice}>{t("missingPullHint")}</p> : <>
              {!!selected.deaths.length && <div className={styles.deathPicker} aria-label={t("eventsTitle")} role="group">{selected.deaths.map((death, index) => <button type="button" key={index} aria-pressed={death === selectedDeath} onClick={() => selectPull(selected, index)}>{t("numberedDeath", { number: index + 1 })}<strong>{deathTimeLabel(death.deathTime)}</strong></button>)}</div>}
              {selectedDeath ? <dl className={styles.deathFacts}>
                <div><dt>{t("deathOrder")}</dt><dd>{selectedDeath.order === null ? t("unknown") : `#${selectedDeath.order}`}</dd></div>
                <div><dt>{t("deathPercent")}</dt><dd>{Math.round(selectedDeath.deathTime / selected.duration * 100)}%</dd></div>
                <div><dt>{t("phase")}</dt><dd>{selectedDeath.phase ?? t("unknown")}</dd></div>
              </dl> : <p className={styles.survivalMessage}>✓ {t("survivedPullHint")}</p>}
              <h4>{t("raidContext")}</h4>
              <div className={styles.contextTrack} aria-label={t("raidContext")} role="img">
                <span className={styles.contextLine} />
                {selected.phases.map((phase, index) => <i key={`phase-${index}`} className={styles.contextPhase} style={{ left: `${phase.time / selected.duration * 100}%` }} title={`${phase.name} · ${deathTimeLabel(phase.time)}`} />)}
                {selected.otherDeathTimes.map((time, index) => <i key={index} className={styles.contextOther} style={{ left: `${time / selected.duration * 100}%` }} />)}
                {selected.deaths.map((death, index) => <span key={index} className={styles.contextDeath} data-active={death === selectedDeath} style={{ left: `${death.deathTime / selected.duration * 100}%` }}>×</span>)}
              </div>
              <div className={styles.contextLabels}><span>0:00</span><span>{deathTimeLabel(selected.duration)}</span></div>
              <p className={styles.contextHint}>{t("raidContextHint", { count: selected.otherDeathTimes.length, name })}</p>
              {!selected.rosterComplete && <p className={styles.notice}>{t("partialRosterHint")}</p>}
              {!!selected.phases.length && <details className={styles.phases}><summary>{t("phaseBoundaries")}</summary>{selected.phases.map((phase, index) => <div key={index}><span>{phase.name}</span><span>{deathTimeLabel(phase.time)}</span></div>)}</details>}
            </>}
            <a className={styles.logLink} href={`https://www.warcraftlogs.com/reports/${encodeURIComponent(selected.reportCode)}#fight=${selected.fightId}&type=deaths`} target="_blank" rel="noopener noreferrer">{t("openFullLog")} ↗</a>
            <p className={styles.capability}>{t("causeCompact")}</p>
          </>}
        </aside>
      </div>
    </section>
  );
}
