"use client";

import { useTranslations } from "next-intl";
import { FaCheck, FaDiceD20, FaHeartCrack, FaRotate, FaSkull, FaTriangleExclamation, FaXmark } from "react-icons/fa6";
import type { CcgGameSimulationResult } from "@/types";
import styles from "./ccg-games.module.css";

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, Math.round(seconds % 60));
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function CcgCombatReport({ result, title }: { result: CcgGameSimulationResult; title?: string }) {
  const t = useTranslations("ccg.play");
  const label = (id: string, fallback: string) => t(`labels.${id}` as never) || fallback;
  return (
    <section className={styles.combatReport} aria-labelledby={`combat-report-${result.encounterId}`}>
      <div className={styles.reportHeader}>
        <div>
          <span className={styles.eyebrow}>{t("report.eyebrow")}</span>
          <h2 id={`combat-report-${result.encounterId}`}>{title ?? result.encounterId}</h2>
          <p className={styles.resultVerdict} data-killed={result.killed}>
            {result.killed ? <FaSkull aria-hidden="true" /> : <FaHeartCrack aria-hidden="true" />}
            {result.killed ? t("report.kill") : t("report.wipe", { health: result.bossHealthRemaining })}
          </p>
        </div>
        <dl className={styles.reportStats}>
          <div><dt>{t("report.time")}</dt><dd>{formatTime(result.durationSeconds)}</dd></div>
          <div><dt>{t("report.deaths")}</dt><dd>{result.deaths}</dd></div>
          <div><dt>{t("report.failed")}</dt><dd>{result.failedChecks}</dd></div>
          <div><dt>{t("report.battleRes")}</dt><dd>{result.battleResurrections}</dd></div>
        </dl>
      </div>

      <div className={styles.healthTrack} aria-label={t("report.bossHealth", { health: result.bossHealthRemaining })}>
        <span style={{ width: `${Math.max(0, Math.min(100, result.bossHealthRemaining))}%` }} />
        <strong className={styles.tabular}>{result.bossHealthRemaining.toFixed(1)}%</strong>
      </div>

      <div className={styles.phaseTimeline}>
        {result.phases.map((phase, phaseIndex) => (
          <article className={styles.phaseCard} key={phase.id} style={{ "--phase-delay": `${phaseIndex * 80}ms` } as React.CSSProperties}>
            <header>
              <span>{t("report.phase", { number: phaseIndex + 1 })}</span>
              <h3>{label(phase.id, phase.label)}</h3>
              <small className={styles.tabular}>{phase.bossHealthBefore.toFixed(1)}% → {phase.bossHealthAfter.toFixed(1)}%</small>
            </header>
            <div className={styles.checkList}>
              {phase.checks.map((check) => (
                <details className={styles.checkRow} key={check.id} data-passed={check.passed}>
                  <summary>
                    <span className={styles.checkIcon}>{check.passed ? <FaCheck aria-hidden="true" /> : <FaXmark aria-hidden="true" />}</span>
                    <span className={styles.checkName}><strong>{label(check.id, check.label)}</strong><small>{check.passed ? t("report.passed") : t("report.failedCheck")}</small></span>
                    <span className={styles.dieRoll} title={t("report.dieHint")}><FaDiceD20 aria-hidden="true" /><b className={styles.tabular}>{check.die}</b></span>
                    <span className={styles.checkTotal}><b className={styles.tabular}>{check.total.toFixed(1)}</b><small>{t("report.versus", { difficulty: check.difficulty.toFixed(1) })}</small></span>
                  </summary>
                  <div className={styles.checkBreakdown}>
                    <span>{t("report.rosterContribution")} <b>{check.contribution.toFixed(1)}</b></span>
                    <span>{t("report.utilityBonus")} <b>{check.utilityBonus >= 0 ? "+" : ""}{check.utilityBonus.toFixed(1)}</b></span>
                    <span>{t("report.assignmentBonus")} <b>{check.assignmentBonus >= 0 ? "+" : ""}{check.assignmentBonus.toFixed(1)}</b></span>
                    <span>{t("report.strategyBonus")} <b>{check.strategyBonus >= 0 ? "+" : ""}{check.strategyBonus.toFixed(1)}</b></span>
                    <span>{t("report.dieModifier")} <b>{check.dieModifier >= 0 ? "+" : ""}{check.dieModifier.toFixed(1)}</b></span>
                    {check.deaths > 0 ? <span className={styles.deathNotice}><FaTriangleExclamation aria-hidden="true" />{t("report.rosterLosses", { count: check.deaths })}</span> : null}
                  </div>
                </details>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className={styles.suggestions}>
        <h3><FaRotate aria-hidden="true" />{t("report.adjustments")}</h3>
        <ul>{result.suggestions.map((suggestion) => <li key={suggestion}>{t(`suggestions.${suggestion}` as never)}</li>)}</ul>
      </div>

      <details className={styles.eventLog}>
        <summary>{t("report.textLog")}</summary>
        <ol>
          {result.phases.flatMap((phase) => phase.checks.map((check) => (
            <li key={`${phase.id}-${check.id}`}>{label(phase.id, phase.label)}: {label(check.id, check.label)} — {check.passed ? t("report.passed") : t("report.failedCheck")}, {check.total.toFixed(1)} {t("report.versus", { difficulty: check.difficulty.toFixed(1) })}.{check.deaths > 0 ? ` ${t("report.rosterLosses", { count: check.deaths })}` : ""}</li>
          ))) }
        </ol>
      </details>
    </section>
  );
}
