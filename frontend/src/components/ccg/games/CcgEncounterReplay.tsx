"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  FaArrowRight,
  FaCheck,
  FaDiceD20,
  FaForward,
  FaGaugeHigh,
  FaHeartPulse,
  FaList,
  FaPause,
  FaPlay,
  FaRotateLeft,
  FaSkull,
  FaTriangleExclamation,
  FaXmark,
} from "react-icons/fa6";
import type { CcgGameCheckResult, CcgGameSimulationResult } from "@/types";
import type { CcgRosterOption } from "./CcgRosterBuilder";
import styles from "./ccg-games.module.css";

type ReplayEncounter = {
  result: CcgGameSimulationResult;
  title: string;
};

type ReplayEvent = {
  id: string;
  encounterIndex: number;
  phaseIndex: number;
  checkIndex: number;
  time: number;
  encounterTitle: string;
  phaseId: string;
  phaseLabel: string;
  bossHealth: number;
  check: CcgGameCheckResult | null;
  kind: "pull" | "pass" | "warning" | "wipe" | "kill";
};

type Props = {
  encounters: ReplayEncounter[];
  roster: CcgRosterOption[];
  onAdjust: () => void;
  onDebrief: () => void;
};

const SPEEDS = [1, 2, 4] as const;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, Math.round(seconds % 60));
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function buildReplayEvents(encounters: ReplayEncounter[]): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  let elapsed = 0;

  encounters.forEach(({ result, title }, encounterIndex) => {
    events.push({
      id: `${result.encounterId}-pull`,
      encounterIndex,
      phaseIndex: 0,
      checkIndex: -1,
      time: elapsed,
      encounterTitle: title,
      phaseId: result.phases[0]?.id ?? result.encounterId,
      phaseLabel: result.phases[0]?.label ?? title,
      bossHealth: 100,
      check: null,
      kind: "pull",
    });

    result.phases.forEach((phase, phaseIndex) => {
      const phaseStart = elapsed;
      const checks = phase.checks.length || 1;
      phase.checks.forEach((check, checkIndex) => {
        const isLastCheck = phaseIndex === result.phases.length - 1 && checkIndex === phase.checks.length - 1;
        const time = phaseStart + phase.durationSeconds * ((checkIndex + 1) / checks);
        events.push({
          id: `${result.encounterId}-${phase.id}-${check.id}`,
          encounterIndex,
          phaseIndex,
          checkIndex,
          time,
          encounterTitle: title,
          phaseId: phase.id,
          phaseLabel: phase.label,
          bossHealth: phase.bossHealthBefore + (phase.bossHealthAfter - phase.bossHealthBefore) * ((checkIndex + 1) / checks),
          check,
          kind: isLastCheck ? (result.killed ? "kill" : "wipe") : check.passed ? "pass" : "warning",
        });
      });
      elapsed += phase.durationSeconds;
    });
  });

  return events;
}

export default function CcgEncounterReplay({ encounters, roster, onAdjust, onDebrief }: Props) {
  const t = useTranslations("ccg.play");
  const headingId = useId();
  const events = useMemo(() => buildReplayEvents(encounters), [encounters]);
  const [cursor, setCursor] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const displayCursor = reducedMotion ? Math.max(0, events.length - 1) : cursor;
  const current = events[Math.min(displayCursor, Math.max(0, events.length - 1))];
  const complete = events.length === 0 || displayCursor >= events.length - 1;
  const revealed = events.slice(0, displayCursor + 1);
  const progress = events.length <= 1 ? 100 : (displayCursor / (events.length - 1)) * 100;
  const activeEncounter = encounters[current?.encounterIndex ?? 0];
  const activeResult = activeEncounter?.result;
  const activeSuggestion = activeResult?.suggestions[0];

  const label = (id: string, fallback: string) => {
    const translated = t(`labels.${id}` as never);
    return translated || fallback;
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused || complete || reducedMotion || events.length < 2) return;
    const baseDuration = Math.max(500, Math.min(1100, 12000 / Math.max(1, events.length - 1)));
    const nextKind = events[Math.min(events.length - 1, cursor + 1)]?.kind;
    const dramaticHold = nextKind === "kill" || nextKind === "wipe" ? 1.5 : nextKind === "warning" ? 1.2 : 1;
    const timer = window.setTimeout(
      () => setCursor((value) => Math.min(events.length - 1, value + 1)),
      (baseDuration * dramaticHold) / speed,
    );
    return () => window.clearTimeout(timer);
  }, [complete, cursor, events, paused, reducedMotion, speed]);

  const restart = () => {
    setCursor(0);
    setPaused(false);
  };

  if (!current || !activeResult) return null;

  return (
    <section className={styles.replayShell} aria-labelledby={headingId} data-event-kind={current.kind}>
      <div className={styles.replayFlow} aria-label={t("replay.flowLabel")}>
        <ol>
          {(["briefing", "formation", "assignments", "ready", "pull", "debrief"] as const).map((step, index) => {
            const active = complete ? index === 5 : index === 4;
            const done = complete ? index < 5 : index < 4;
            return (
              <li key={step} data-active={active} data-done={done}>
                <span>{done ? <FaCheck aria-hidden="true" /> : index + 1}</span>
                <strong>{t(`replay.steps.${step}`)}</strong>
              </li>
            );
          })}
        </ol>

        <div className={styles.replayRoster}>
          <div className={styles.replayRailHeading}>
            <span>{t("replay.roster")}</span>
            <strong className={styles.tabular}>{roster.length}</strong>
          </div>
          <div className={styles.replayRosterFrames}>
            {roster.slice(0, 20).map((card) => (
              <div key={card.id} className={styles.replayRosterFrame} data-role={card.role}>
                {card.avatarUrl ? <Image src={card.avatarUrl} alt="" width={28} height={28} /> : <span aria-hidden="true">{card.name.slice(0, 1)}</span>}
                <span><strong>{card.name}</strong><small>{card.specName}</small></span>
              </div>
            ))}
          </div>
          <button type="button" className={styles.quietButton} onClick={onAdjust}>
            <FaRotateLeft aria-hidden="true" />{t("replay.adjust")}
          </button>
        </div>
      </div>

      <div className={styles.encounterStage}>
        <header className={styles.encounterHeader}>
          <div>
            <span className={styles.commandLabel}>{t("replay.live")}</span>
            <h1 id={headingId}>{current.encounterTitle}</h1>
            <p>{t("replay.phasePosition", { current: current.phaseIndex + 1, total: activeResult.phases.length })} · {label(current.phaseId, current.phaseLabel)}</p>
          </div>
          <div className={styles.bossReadout}>
            <span>{t("replay.bossHealth")}</span>
            <strong className={styles.tabular}>{current.bossHealth.toFixed(1)}%</strong>
          </div>
        </header>

        <div className={styles.replayHealth} aria-label={t("report.bossHealth", { health: Number(current.bossHealth.toFixed(1)) })}>
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(100, current.bossHealth)) / 100})` }} />
        </div>

        <div className={styles.mechanicStage} data-passed={current.check?.passed ?? undefined}>
          <div className={styles.mechanicPulse} aria-hidden="true"><span /><span /><span /></div>
          <div className={styles.mechanicFocus}>
            {current.check ? (current.check.passed ? <FaCheck aria-hidden="true" /> : <FaTriangleExclamation aria-hidden="true" />) : <FaPlay aria-hidden="true" />}
            <span className={styles.commandLabel}>{current.check ? t("replay.mechanic") : t("replay.pullStarting")}</span>
            <h2>{current.check ? label(current.check.id, current.check.label) : current.encounterTitle}</h2>
            {current.check ? (
              <div className={styles.mechanicNumbers}>
                <span title={t("report.dieHint")}><FaDiceD20 aria-hidden="true" /><b className={styles.tabular}>{current.check.die}</b></span>
                <span><b className={styles.tabular}>{current.check.total.toFixed(1)}</b><small>{t("report.versus", { difficulty: current.check.difficulty.toFixed(1) })}</small></span>
              </div>
            ) : <p>{t("replay.countdown")}</p>}
            {current.check?.deaths ? <p className={styles.lossNotice}><FaSkull aria-hidden="true" />{t("report.rosterLosses", { count: current.check.deaths })}</p> : null}
          </div>
          <div className={styles.stageMetrics}>
            <span><FaHeartPulse aria-hidden="true" />{t("report.deaths")} <b className={styles.tabular}>{activeResult.deaths}</b></span>
            <span><FaGaugeHigh aria-hidden="true" />{t("report.battleRes")} <b className={styles.tabular}>{activeResult.battleResurrections}</b></span>
          </div>
        </div>

        <div className={styles.replayTimeline}>
          <div className={styles.timelineMarkers} aria-hidden="true">
            {events.map((event, index) => <span key={event.id} data-kind={event.kind} data-revealed={index <= displayCursor} style={{ left: `${events.length <= 1 ? 100 : (index / (events.length - 1)) * 100}%` }} />)}
          </div>
          <div className={styles.timelineTrack}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
          <div className={styles.timelineMeta}>
            <span><small>{t("replay.elapsed")}</small><strong className={styles.tabular}>{formatTime(current.time)}</strong></span>
            <span className={styles.tabular}>{displayCursor + 1}/{events.length}</span>
          </div>
          <div className={styles.replayControls}>
            <button type="button" onClick={() => setPaused((value) => !value)} disabled={complete || reducedMotion}>
              {paused ? <FaPlay aria-hidden="true" /> : <FaPause aria-hidden="true" />}{paused ? t("replay.resume") : t("replay.pause")}
            </button>
            <div role="group" aria-label={t("replay.speedLabel")} className={styles.speedControls}>
              {SPEEDS.map((value) => <button type="button" key={value} data-active={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}
            </div>
            <button type="button" onClick={() => setCursor(events.length - 1)} disabled={complete}>
              <FaForward aria-hidden="true" />{t("replay.skip")}
            </button>
            {complete ? <button type="button" className={styles.replayPrimary} onClick={onDebrief}>{t("replay.debrief")}<FaArrowRight aria-hidden="true" /></button> : null}
          </div>
        </div>
      </div>

      <aside className={styles.eventRail} aria-label={t("replay.eventsLabel")}>
        <div className={styles.replayRailHeading}>
          <span>{t("replay.events")}</span>
          <strong className={styles.tabular}>{revealed.length}/{events.length}</strong>
        </div>
        <div className={styles.liveAnnouncement} aria-live="polite" aria-atomic="true">
          {current.check ? `${label(current.phaseId, current.phaseLabel)}: ${label(current.check.id, current.check.label)} — ${current.check.passed ? t("report.passed") : t("report.failedCheck")}.` : t("replay.countdown")}
        </div>
        <ol className={styles.eventFeed}>
          {revealed.slice(-8).map((event) => (
            <li key={event.id} data-kind={event.kind} data-current={event.id === current.id}>
              <span className={styles.eventIcon}>{event.kind === "pass" || event.kind === "kill" ? <FaCheck aria-hidden="true" /> : event.kind === "pull" ? <FaPlay aria-hidden="true" /> : <FaXmark aria-hidden="true" />}</span>
              <span><small className={styles.tabular}>{formatTime(event.time)}</small><strong>{event.check ? label(event.check.id, event.check.label) : t("replay.pullBegins")}</strong><em>{event.check ? (event.check.passed ? t("report.passed") : t("report.failedCheck")) : event.encounterTitle}</em></span>
            </li>
          ))}
        </ol>
        <div className={styles.whyPanel}>
          <span><FaList aria-hidden="true" />{t("replay.why")}</span>
          <p>{current.check ? (current.check.passed ? t("replay.passedWhy", { margin: Math.abs(current.check.margin).toFixed(1) }) : t("replay.failedWhy", { margin: Math.abs(current.check.margin).toFixed(1) })) : t("replay.planLocked")}</p>
          {activeSuggestion ? <small>{t(`suggestions.${activeSuggestion}` as never)}</small> : null}
        </div>
        <details className={styles.replayTextLog}>
          <summary>{t("report.textLog")}</summary>
          <ol>{events.map((event) => <li key={`text-${event.id}`}>{formatTime(event.time)} — {event.check ? `${label(event.phaseId, event.phaseLabel)}: ${label(event.check.id, event.check.label)}, ${event.check.passed ? t("report.passed") : t("report.failedCheck")}.` : `${event.encounterTitle}: ${t("replay.pullBegins")}.`}</li>)}</ol>
        </details>
        {complete ? <button type="button" className={styles.quietButton} onClick={restart}><FaRotateLeft aria-hidden="true" />{t("replay.watchAgain")}</button> : null}
      </aside>
    </section>
  );
}
