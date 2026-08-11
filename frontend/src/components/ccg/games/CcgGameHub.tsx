"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FaArrowRight,
  FaCheck,
  FaDiceD20,
  FaFlagCheckered,
  FaMasksTheater,
  FaMountain,
  FaPeopleGroup,
  FaPlay,
  FaRotate,
  FaWandMagicSparkles,
  FaXmark,
} from "react-icons/fa6";
import CcgShell from "@/components/ccg/CcgShell";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import { ApiError, api } from "@/lib/api";
import { bestOwnedFinish } from "@/lib/ccg";
import type {
  CcgArtVariant,
  CcgExpeditionLeaderboardResponse,
  CcgExpeditionResult,
  CcgFinish,
  CcgGameAssignments,
  CcgGamesBootstrapResponse,
  CcgRaceEntry,
  CcgRaidResult,
  CcgStyleLeaderboardResponse,
  CcgStylePairResponse,
} from "@/types";
import CcgCombatReport from "./CcgCombatReport";
import CcgEncounterReplay from "./CcgEncounterReplay";
import CcgRosterBuilder, { CcgRosterOption, getCcgMercenaries } from "./CcgRosterBuilder";
import CcgTacticsPanel, { EMPTY_ASSIGNMENTS } from "./CcgTacticsPanel";
import styles from "./ccg-games.module.css";

export type CcgPlayableMode = "expedition" | "raid-night" | "raid-race" | "transmog-ring";

type CombatView = "plan" | "replay" | "debrief";
type StyleMotion = "idle" | "entering" | "saved" | "voting";

const MODES: Array<{ id: CcgPlayableMode; icon: typeof FaMountain }> = [
  { id: "expedition", icon: FaMountain },
  { id: "raid-night", icon: FaPeopleGroup },
  { id: "raid-race", icon: FaFlagCheckered },
  { id: "transmog-ring", icon: FaMasksTheater },
];

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function cloneEmptyAssignments(): CcgGameAssignments {
  return { ...EMPTY_ASSIGNMENTS, interruptCardIds: [], soakCardIds: [] };
}

function toRosterOption(bootstrap: CcgGamesBootstrapResponse, card: CcgGamesBootstrapResponse["collection"]["cards"][number]): CcgRosterOption {
  return {
    id: card.id,
    identityId: card.characterId,
    name: card.name,
    realm: card.realm,
    role: card.role,
    classID: card.classID,
    specName: card.specName,
    tierGrade: card.tierGrade,
    performance: card.scores.performance ?? 0,
    mechanics: card.scores.mechanics ?? 0,
    combined: card.scores.combined ?? ((card.scores.performance ?? 0) + (card.scores.mechanics ?? 0)) / 2,
    avatarUrl: card.avatarUrl,
    utilities: bootstrap.utilitiesByCardId[card.id] ?? [],
    card,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return fallback;
}

function presentationDelay(duration: number): Promise<void> {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return new Promise((resolve) => window.setTimeout(resolve, reduced ? 0 : duration));
}

function ModeNavigation({ mode }: { mode: CcgPlayableMode }) {
  const t = useTranslations("ccg.play");
  return (
    <nav className={styles.modeNav} aria-label={t("modeNavLabel")}>
      {MODES.map((item) => {
        const Icon = item.icon;
        return (
          <Link href={`/ccg/play/${item.id}`} key={item.id} data-active={mode === item.id} aria-current={mode === item.id ? "page" : undefined}>
            <Icon aria-hidden="true" />
            <span><strong>{t(`modes.${item.id}.title`)}</strong><small>{t(`modes.${item.id}.short`)}</small></span>
          </Link>
        );
      })}
    </nav>
  );
}

function WorkflowStrip({ rosterReady, assignmentsReady }: { rosterReady: boolean; assignmentsReady: boolean }) {
  const t = useTranslations("ccg.play");
  const states = [true, rosterReady, assignmentsReady, rosterReady && assignmentsReady];
  return (
    <ol className={styles.workflowStrip} aria-label={t("readiness.planProgress")}>
      {(["briefing", "formation", "assignments", "ready"] as const).map((step, index) => (
        <li key={step} data-complete={states[index]} data-active={!states[index] && (index === 0 || states[index - 1])}>
          <span>{states[index] ? <FaCheck aria-hidden="true" /> : index + 1}</span>
          <strong>{t(`replay.steps.${step}`)}</strong>
        </li>
      ))}
    </ol>
  );
}

function CommandHeader({
  mode,
  heading,
  description,
  metrics,
  phases,
  rosterReady,
  assignmentsReady,
}: {
  mode: CcgPlayableMode;
  heading: string;
  description: string;
  metrics: Array<{ label: string; value: string }>;
  phases: Array<{ id: string; label: string }>;
  rosterReady: boolean;
  assignmentsReady: boolean;
}) {
  const t = useTranslations("ccg.play");
  return (
    <header className={styles.commandHeader} data-mode={mode}>
      <div className={styles.commandHeading}>
        <span className={styles.commandLabel}>{t(`modes.${mode}.eyebrow`)}</span>
        <h1>{heading}</h1>
        <p>{description}</p>
      </div>
      <dl className={styles.commandMetrics}>
        {metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd className={styles.tabular}>{metric.value}</dd></div>)}
      </dl>
      {phases.length > 0 ? (
        <ol className={styles.routeLine} aria-label={t("readiness.encounterRoute")}>
          {phases.map((phase, index) => (
            <li key={`${phase.id}-${index}`} data-current={index === 0}>
              <span>{index + 1}</span><strong>{phase.label}</strong>
            </li>
          ))}
        </ol>
      ) : null}
      {mode !== "transmog-ring" ? <WorkflowStrip rosterReady={rosterReady} assignmentsReady={assignmentsReady} /> : null}
    </header>
  );
}

function ReadinessPanel({
  rosterReady,
  assignmentsReady,
  busy,
  disabled,
  actionLabel,
  onStart,
}: {
  rosterReady: boolean;
  assignmentsReady: boolean;
  busy: boolean;
  disabled: boolean;
  actionLabel: string;
  onStart: () => void;
}) {
  const t = useTranslations("ccg.play");
  const count = Number(rosterReady) + Number(assignmentsReady);
  return (
    <section className={styles.readinessPanel} aria-labelledby="readiness-title">
      <div className={styles.readinessTitle}>
        <span><strong id="readiness-title">{t("readiness.title")}</strong><small>{t(count === 2 ? "readiness.readyHint" : "readiness.incompleteHint")}</small></span>
        <b className={styles.tabular} data-ready={count === 2}>{count}/2</b>
      </div>
      <ul>
        <li data-ready={rosterReady}>{rosterReady ? <FaCheck aria-hidden="true" /> : <FaXmark aria-hidden="true" />}{t("readiness.roster")}</li>
        <li data-ready={assignmentsReady}>{assignmentsReady ? <FaCheck aria-hidden="true" /> : <FaXmark aria-hidden="true" />}{t("readiness.calls")}</li>
      </ul>
      <button type="button" className={styles.primaryButton} onClick={onStart} disabled={disabled} aria-busy={busy}>
        {busy ? <FaDiceD20 aria-hidden="true" /> : <FaPlay aria-hidden="true" />}{busy ? t("simulating") : actionLabel}
      </button>
      {!assignmentsReady && rosterReady ? <p>{t("readiness.callsOptional")}</p> : null}
    </section>
  );
}

export default function CcgGameHub({ mode }: { mode: CcgPlayableMode }) {
  const t = useTranslations("ccg.play");
  const [bootstrap, setBootstrap] = useState<CcgGamesBootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [combatView, setCombatView] = useState<CombatView>("plan");
  const [expeditionActive, setExpeditionActive] = useState<string[]>([]);
  const [raidActive, setRaidActive] = useState<string[]>([]);
  const [raidBench, setRaidBench] = useState<string[]>([]);
  const [expeditionAssignments, setExpeditionAssignments] = useState<CcgGameAssignments>(cloneEmptyAssignments);
  const [raidAssignments, setRaidAssignments] = useState<CcgGameAssignments>(cloneEmptyAssignments);
  const [route, setRoute] = useState<"safe" | "score">("safe");
  const [pullSize, setPullSize] = useState<"small" | "standard" | "large">("standard");
  const [boon, setBoon] = useState<"refreshing-kick" | "guardian-echo" | "farshot">("refreshing-kick");
  const [difficulty, setDifficulty] = useState<"story" | "normal" | "heroic">("normal");
  const [expeditionResult, setExpeditionResult] = useState<CcgExpeditionResult | null>(null);
  const [raidResult, setRaidResult] = useState<CcgRaidResult | null>(null);
  const [raceEntry, setRaceEntry] = useState<CcgRaceEntry | null>(null);
  const [leaderboard, setLeaderboard] = useState<CcgExpeditionLeaderboardResponse | null>(null);
  const [stylePair, setStylePair] = useState<CcgStylePairResponse | null>(null);
  const [styleLeaderboard, setStyleLeaderboard] = useState<CcgStyleLeaderboardResponse | null>(null);
  const [styleCardId, setStyleCardId] = useState<string | null>(null);
  const [styleFinish, setStyleFinish] = useState<CcgFinish>("standard");
  const [styleArt, setStyleArt] = useState<CcgArtVariant>("standard");
  const [styleSubmitted, setStyleSubmitted] = useState(false);
  const [styleMotion, setStyleMotion] = useState<StyleMotion>("idle");
  const [styleVoteWinner, setStyleVoteWinner] = useState<string | null>(null);
  const [styleSearch, setStyleSearch] = useState("");
  const [raidBossIndex, setRaidBossIndex] = useState(0);
  const viewAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousCombatView = useRef<CombatView>("plan");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getCcgGamesBootstrap();
      setBootstrap(response);
      setRaceEntry(response.race.entry);
      setRaidBossIndex(response.raid.lockout?.bossIndex ?? 0);
      if (mode === "raid-night" && response.raid.lockout) {
        setRaidActive(response.raid.lockout.activeCardIds);
        setRaidBench(response.raid.lockout.rosterCardIds.filter((id) => !response.raid.lockout?.activeCardIds.includes(id)));
        setDifficulty(response.raid.lockout.difficulty);
      } else if (mode === "raid-race") {
        setRaidActive([]);
        setRaidBench([]);
        setRaidAssignments(cloneEmptyAssignments());
      }
      if (response.style.submission) {
        setStyleCardId(response.style.submission.cardId);
        setStyleFinish(response.style.submission.finish);
        setStyleArt(response.style.submission.artVariant);
        setStyleSubmitted(true);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("errors.load")));
    } finally {
      setLoading(false);
    }
  }, [mode, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setCombatView("plan");
    setError(null);
  }, [mode]);
  useEffect(() => {
    if (previousCombatView.current === combatView) return;
    previousCombatView.current = combatView;
    const frame = window.requestAnimationFrame(() => {
      viewAnchorRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [combatView]);
  useEffect(() => {
    if (mode === "expedition") void api.getCcgExpeditionLeaderboard().then(setLeaderboard).catch(() => undefined);
    if (mode === "transmog-ring") {
      void Promise.all([api.getCcgStylePair(), api.getCcgStyleLeaderboard()]).then(([pair, standings]) => {
        setStylePair(pair);
        setStyleLeaderboard(standings);
      }).catch(() => undefined);
    }
  }, [mode]);

  const rosterCards = useMemo(() => bootstrap?.collection.cards
    .filter((card) => card.set.kind === "raid" && card.scores.performance !== null && card.scores.mechanics !== null)
    .map((card) => toRosterOption(bootstrap, card)) ?? [], [bootstrap]);
  const expeditionOptionById = useMemo(() => new Map([...rosterCards, ...getCcgMercenaries({ tank: 1, healer: 1, dps: 3 })].map((card) => [card.id, card])), [rosterCards]);
  const raidOptionById = useMemo(() => new Map([...rosterCards, ...getCcgMercenaries({ tank: 2, healer: 4, dps: 14 })].map((card) => [card.id, card])), [rosterCards]);
  const expeditionCards = expeditionActive.map((id) => expeditionOptionById.get(id)).filter((card): card is CcgRosterOption => Boolean(card));
  const raidCards = raidActive.map((id) => raidOptionById.get(id)).filter((card): card is CcgRosterOption => Boolean(card));
  const currentRaidEncounter = bootstrap?.raid.encounters[Math.min(raidBossIndex, Math.max(0, (bootstrap?.raid.encounters.length ?? 1) - 1))];
  const expeditionPhases = bootstrap?.expedition.encounters.flatMap((encounter) => encounter.phases).map((phase) => ({ id: phase.id, label: t(`labels.${phase.id}` as never) })) ?? [];
  const raidPhases = currentRaidEncounter?.phases.map((phase) => ({ id: phase.id, label: t(`labels.${phase.id}` as never) })) ?? [];
  const raidRosterCost = raidCards.reduce((total, card) => total + (bootstrap?.gradeCosts[card.tierGrade as keyof typeof bootstrap.gradeCosts] ?? 4), 0);
  const expeditionRosterReady = expeditionActive.length === 5;
  const raidRosterReady = raidActive.length === 20;
  const expeditionAssignmentsReady = expeditionAssignments.interruptCardIds.length > 0 && expeditionAssignments.soakCardIds.length > 0;
  const raidAssignmentsReady = raidAssignments.interruptCardIds.length > 0 && raidAssignments.soakCardIds.length > 0;

  const submitExpedition = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.runCcgExpedition({ idempotencyKey: idempotencyKey("expedition"), cardIds: expeditionActive, route, pullSize, boon, assignments: expeditionAssignments });
      setExpeditionResult(result);
      setCombatView("replay");
      void api.getCcgExpeditionLeaderboard().then(setLeaderboard).catch(() => undefined);
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.run"))); }
    finally { setBusy(false); }
  };

  const submitRaid = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.pullCcgRaid({ idempotencyKey: idempotencyKey("raid"), rosterCardIds: [...raidActive, ...raidBench], activeCardIds: raidActive, difficulty, assignments: raidAssignments });
      setRaidResult(result);
      setRaidBossIndex(result.bossIndex);
      setCombatView("replay");
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.run"))); }
    finally { setBusy(false); }
  };

  const submitRace = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.enterCcgRaidRace({ idempotencyKey: idempotencyKey("race"), activeCardIds: raidActive, assignments: raidAssignments });
      setRaceEntry(result);
      setCombatView("replay");
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.run"))); }
    finally { setBusy(false); }
  };

  const selectStyleCard = (cardId: string) => {
    const card = bootstrap?.collection.cards.find((item) => item.id === cardId);
    const owned = card ? bestOwnedFinish(card) : null;
    setStyleCardId(cardId);
    setStyleFinish(owned?.finish ?? "standard");
    setStyleArt(owned?.artVariant ?? "standard");
    setStyleMotion("idle");
  };

  const submitStyle = async () => {
    if (!styleCardId) return;
    setBusy(true); setError(null); setStyleMotion("entering");
    try {
      await Promise.all([api.submitCcgStyle({ cardId: styleCardId, finish: styleFinish, artVariant: styleArt }), presentationDelay(700)]);
      setStyleSubmitted(true);
      setStyleMotion("saved");
      setStylePair(await api.getCcgStylePair());
    } catch (requestError) { setStyleMotion("idle"); setError(getErrorMessage(requestError, t("errors.style"))); }
    finally { setBusy(false); }
  };

  const voteStyle = async (winnerId: string) => {
    if (!stylePair?.pair) return;
    setBusy(true); setError(null); setStyleVoteWinner(winnerId); setStyleMotion("voting");
    try {
      await Promise.all([api.voteCcgStyle(stylePair.pair.map((entry) => entry.id), winnerId), presentationDelay(700)]);
      const [pair, standings] = await Promise.all([api.getCcgStylePair(), api.getCcgStyleLeaderboard()]);
      setStylePair(pair); setStyleLeaderboard(standings); setStyleVoteWinner(null); setStyleMotion("idle");
    } catch (requestError) { setStyleVoteWinner(null); setStyleMotion("idle"); setError(getErrorMessage(requestError, t("errors.vote"))); }
    finally { setBusy(false); }
  };

  if (loading) return <CcgShell><div className={styles.loadingState}><FaDiceD20 aria-hidden="true" /><p>{t("loading")}</p></div></CcgShell>;
  if (!bootstrap) return <CcgShell><div className={styles.errorState}><p>{error ?? t("errors.load")}</p><button type="button" onClick={() => void load()}>{t("retry")}</button></div></CcgShell>;

  const selectedStyleCard = bootstrap.collection.cards.find((card) => card.id === styleCardId) ?? null;
  const styleFinishes = selectedStyleCard?.ownership ?? [];
  const filteredStyleCards = bootstrap.collection.cards.filter((card) => `${card.name} ${card.set.raidName}`.toLocaleLowerCase().includes(styleSearch.trim().toLocaleLowerCase()));
  const pageError = error ? <div className={styles.inlineError} role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label={t("dismiss")}>×</button></div> : null;

  const replayEncounters = mode === "expedition" && expeditionResult
    ? expeditionResult.encounters.map((result, index) => ({ result, title: bootstrap.expedition.encounters[index]?.name ?? result.encounterId }))
    : mode === "raid-night" && raidResult
      ? [{ result: raidResult.simulation, title: bootstrap.raid.encounters.find((encounter) => encounter.id === raidResult.simulation.encounterId)?.name ?? raidResult.simulation.encounterId }]
      : mode === "raid-race" && raceEntry
        ? [{ result: raceEntry.result, title: t("race.yourPull") }]
        : [];
  const replayRoster = mode === "expedition" ? expeditionCards : raidCards;

  const modeHeading = mode === "raid-night"
    ? currentRaidEncounter?.name ?? t("raid.complete")
    : t(`modes.${mode}.heading`);
  const modeDescription = t(`modes.${mode}.description`);
  const modePhases = mode === "expedition" ? expeditionPhases : mode === "raid-night" || mode === "raid-race" ? raidPhases : [];
  const modeMetrics = mode === "expedition"
    ? [{ label: t("week"), value: bootstrap.weeklyKey }, { label: t("modes.expedition.timer"), value: formatTime(bootstrap.expedition.timerSeconds) }, { label: t("modes.expedition.key"), value: `+${bootstrap.expedition.keyLevel}` }]
    : mode === "raid-night"
      ? [{ label: t("raid.progress"), value: `${Math.min(raidBossIndex, bootstrap.raid.encounters.length)}/${bootstrap.raid.encounters.length}` }, { label: t("raid.difficulty"), value: t(`raid.${difficulty}`) }]
      : mode === "raid-race"
        ? [{ label: t("race.budget"), value: `${raidRosterCost}/${bootstrap.race.rosterBudget}` }, { label: t("week"), value: bootstrap.weeklyKey }]
        : [{ label: t("style.theme"), value: bootstrap.style.theme }, { label: t("style.format"), value: t("style.async") }];

  const renderDebrief = () => (
    <section className={styles.debriefView}>
      <header className={styles.debriefHeader}>
        <div><span className={styles.commandLabel}>{t("replay.steps.debrief")}</span><h1>{t("debrief.title")}</h1><p>{t("debrief.description")}</p></div>
        <div><button type="button" className={styles.secondaryButton} onClick={() => setCombatView("replay")}><FaPlay aria-hidden="true" />{t("debrief.replay")}</button><button type="button" className={styles.primaryButton} onClick={() => setCombatView("plan")}><FaRotate aria-hidden="true" />{t("debrief.adjust")}</button></div>
      </header>
      {mode === "expedition" && expeditionResult ? <><div className={styles.runSummary} data-timed={expeditionResult.timed}><strong>{expeditionResult.completed ? expeditionResult.timed ? t("expedition.timed") : t("expedition.completed") : t("expedition.depleted")}</strong><span>{t("expedition.score", { score: expeditionResult.score })}</span><span>{formatTime(expeditionResult.durationSeconds)} · {t("expedition.deathCount", { count: expeditionResult.deaths })}</span></div>{expeditionResult.encounters.map((result, index) => <CcgCombatReport key={result.encounterId} result={result} title={bootstrap.expedition.encounters[index]?.name} />)}</> : null}
      {mode === "raid-night" && raidResult ? <><div className={styles.progressBanner} data-complete={raidResult.raidComplete}>{raidResult.raidComplete ? t("raid.cleared") : raidResult.simulation.killed ? t("raid.nextBoss") : t("raid.pullAgain")}</div><CcgCombatReport result={raidResult.simulation} title={bootstrap.raid.encounters.find((encounter) => encounter.id === raidResult.simulation.encounterId)?.name} /></> : null}
      {mode === "raid-race" && raceEntry ? <section className={styles.raceResult}><div className={styles.raceStatus} data-outcome={raceEntry.outcome ?? raceEntry.status}><strong>{raceEntry.status === "queued" ? t("race.waiting") : t(`race.${raceEntry.outcome}`)}</strong><small>{raceEntry.status === "queued" ? t("race.waitingHint") : t("race.matchedHint")}</small></div><div className={styles.raceReports}><CcgCombatReport result={raceEntry.result} title={t("race.yourPull")} />{raceEntry.opponent ? <CcgCombatReport result={raceEntry.opponent.result} title={t("race.opponentPull")} /> : null}</div></section> : null}
      {mode === "expedition" && leaderboard ? <section className={styles.leaderboard}><div className={styles.sectionHeading}><div><span className={styles.commandLabel}>{t("leaderboard.eyebrow")}</span><h2>{t("leaderboard.title")}</h2></div></div>{leaderboard.entries.length > 0 ? <ol>{leaderboard.entries.map((entry) => <li key={`${entry.rank}-${entry.collector}`} data-me={entry.isMe}><span>{entry.rank}</span><strong>{entry.collector}</strong><small>{entry.timed ? t("leaderboard.timed") : t("leaderboard.untimed")} · {formatTime(entry.durationSeconds)}</small><b>{entry.score.toLocaleString()}</b></li>)}</ol> : <p>{t("leaderboard.empty")}</p>}</section> : null}
    </section>
  );

  return (
    <CcgShell>
      <div className={styles.gamePage} data-mode={mode} data-view={mode === "transmog-ring" ? "style" : combatView}>
        <ModeNavigation mode={mode} />
        <CommandHeader
          mode={mode}
          heading={modeHeading}
          description={modeDescription}
          metrics={modeMetrics}
          phases={modePhases}
          rosterReady={mode === "expedition" ? expeditionRosterReady : mode === "transmog-ring" ? Boolean(styleCardId) : raidRosterReady}
          assignmentsReady={mode === "expedition" ? expeditionAssignmentsReady : mode === "transmog-ring" ? styleSubmitted : raidAssignmentsReady}
        />
        <div ref={viewAnchorRef} className={styles.viewAnchor} aria-hidden="true" />
        {pageError}

        {mode !== "transmog-ring" && combatView === "replay" && replayEncounters.length > 0 ? <CcgEncounterReplay encounters={replayEncounters} roster={replayRoster} onAdjust={() => setCombatView("plan")} onDebrief={() => setCombatView("debrief")} /> : null}
        {mode !== "transmog-ring" && combatView === "debrief" ? renderDebrief() : null}

        {mode === "expedition" && combatView === "plan" ? (
          <div className={styles.commandGrid}>
            <CcgRosterBuilder cards={rosterCards} activeIds={expeditionActive} benchIds={[]} formation={{ tank: 1, healer: 1, dps: 3 }} rosterLimit={5} allowMercenaries onChange={(active) => { setExpeditionActive(active); setExpeditionAssignments(cloneEmptyAssignments()); }} />
            <aside className={styles.commandRail} aria-label={t("readiness.commandRail")}>
              <section className={styles.runOptions}>
                <div className={styles.railSectionHeading}><span className={styles.commandLabel}>{t("readiness.routeAndRisk")}</span></div>
                <label><span>{t("expedition.route")}</span><select value={route} onChange={(event) => setRoute(event.target.value as typeof route)}><option value="safe">{t("expedition.safeRoute")}</option><option value="score">{t("expedition.scoreRoute")}</option></select></label>
                <label><span>{t("expedition.pullSize")}</span><select value={pullSize} onChange={(event) => setPullSize(event.target.value as typeof pullSize)}><option value="small">{t("expedition.small")}</option><option value="standard">{t("expedition.standard")}</option><option value="large">{t("expedition.large")}</option></select></label>
                <label><span>{t("expedition.boon")}</span><select value={boon} onChange={(event) => setBoon(event.target.value as typeof boon)}><option value="refreshing-kick">{t("expedition.refreshingKick")}</option><option value="guardian-echo">{t("expedition.guardianEcho")}</option><option value="farshot">{t("expedition.farshot")}</option></select></label>
              </section>
              <CcgTacticsPanel cards={expeditionCards} assignments={expeditionAssignments} phases={expeditionPhases} raidSize={false} onChange={setExpeditionAssignments} />
              <ReadinessPanel rosterReady={expeditionRosterReady} assignmentsReady={expeditionAssignmentsReady} busy={busy} disabled={busy || !expeditionRosterReady} actionLabel={t("expedition.start")} onStart={() => void submitExpedition()} />
            </aside>
          </div>
        ) : null}

        {(mode === "raid-night" || mode === "raid-race") && combatView === "plan" ? (
          <div className={styles.commandGrid}>
            <CcgRosterBuilder cards={rosterCards} activeIds={raidActive} benchIds={mode === "raid-night" ? raidBench : []} formation={{ tank: 2, healer: 4, dps: 14 }} rosterLimit={mode === "raid-night" ? 25 : 20} allowMercenaries={mode === "raid-night" && difficulty !== "heroic"} onChange={(active, bench) => { setRaidActive(active); setRaidBench(bench); setRaidAssignments(cloneEmptyAssignments()); }} />
            <aside className={styles.commandRail} aria-label={t("readiness.commandRail")}>
              {mode === "raid-night" ? <section className={styles.runOptions}><div className={styles.railSectionHeading}><span className={styles.commandLabel}>{t("raid.difficulty")}</span></div><label><span>{t("raid.difficulty")}</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="story">{t("raid.story")}</option><option value="normal">{t("raid.normal")}</option><option value="heroic">{t("raid.heroic")}</option></select></label></section> : <div className={raidRosterCost <= bootstrap.race.rosterBudget ? styles.budgetOkay : styles.budgetExceeded}>{t("race.cost", { cost: raidRosterCost, budget: bootstrap.race.rosterBudget })}</div>}
              <CcgTacticsPanel cards={raidCards} assignments={raidAssignments} phases={raidPhases} raidSize onChange={setRaidAssignments} />
              <ReadinessPanel rosterReady={raidRosterReady} assignmentsReady={raidAssignmentsReady} busy={busy} disabled={busy || !raidRosterReady || (mode === "raid-race" && raidRosterCost > bootstrap.race.rosterBudget)} actionLabel={t(mode === "raid-night" ? "raid.pull" : "race.submit")} onStart={() => void (mode === "raid-night" ? submitRaid() : submitRace())} />
              {mode === "raid-race" && raceEntry ? <button type="button" className={styles.savedResultButton} onClick={() => setCombatView("debrief")}><FaFlagCheckered aria-hidden="true" />{t("race.viewSaved")}</button> : null}
            </aside>
          </div>
        ) : null}

        {mode === "transmog-ring" ? (
          <>
            <section className={styles.styleCommand}>
              <div className={styles.stylePickerPanel}>
                <div className={styles.sectionHeading}><div><span className={styles.commandLabel}>{t("style.entryEyebrow")}</span><h2>{t("style.entryTitle")}</h2></div></div>
                <label className={styles.styleSearch}><span className="sr-only">{t("style.search")}</span><input value={styleSearch} onChange={(event) => setStyleSearch(event.target.value)} placeholder={t("style.search")} /></label>
                <div className={styles.styleCardPicker}>{filteredStyleCards.map((card) => <button type="button" key={card.id} data-selected={styleCardId === card.id} onClick={() => selectStyleCard(card.id)}><span>{card.name}</span><small>{card.set.raidName}</small></button>)}</div>
              </div>
              <div className={styles.stylePreview} data-motion={styleMotion}>
                <div className={styles.runwayLights} aria-hidden="true"><span /><span /><span /></div>
                {selectedStyleCard ? <><div className={styles.styleCardStage}><CollectibleCard card={selectedStyleCard} finish={styleFinish} artVariant={styleArt} width={260} ambientMaterial /></div><div className={styles.styleControls}><span className={styles.commandLabel}>{bootstrap.style.theme}</span><label><span>{t("style.finish")}</span><select value={styleFinish} onChange={(event) => setStyleFinish(event.target.value as CcgFinish)}>{[...new Set(styleFinishes.map((row) => row.finish))].map((finish) => <option value={finish} key={finish}>{finish}</option>)}</select></label><label><span>{t("style.art")}</span><select value={styleArt} onChange={(event) => setStyleArt(event.target.value as CcgArtVariant)}><option value="standard">{t("style.standardArt")}</option>{styleFinishes.some((row) => row.artVariant === "alternative") ? <option value="alternative">{t("style.alternativeArt")}</option> : null}</select></label><button type="button" className={styles.primaryButton} onClick={() => void submitStyle()} disabled={busy}>{busy ? t("style.entering") : styleSubmitted ? t("style.update") : t("style.submit")}</button><p role="status" aria-live="polite">{styleMotion === "saved" ? t("style.saved") : t("style.stageHint")}</p></div></> : <div className={styles.styleEmpty}><FaWandMagicSparkles aria-hidden="true" /><strong>{t("style.chooseTitle")}</strong><p>{t("style.choose")}</p></div>}
              </div>
            </section>

            <section className={styles.runway}>
              <div className={styles.sectionHeading}><div><span className={styles.commandLabel}>{t("style.voteEyebrow")}</span><h2>{t("style.voteTitle")}</h2><p>{t("style.voteHint")}</p></div>{stylePair?.pair ? <button type="button" className={styles.iconButton} onClick={() => void api.getCcgStylePair().then(setStylePair)} aria-label={t("style.refresh")}><FaRotate aria-hidden="true" /></button> : null}</div>
              {stylePair?.pair ? <div className={styles.runwayPair} data-voting={styleMotion === "voting"}>{stylePair.pair.map((entry) => <button type="button" key={entry.id} data-selected={styleVoteWinner === entry.id} onClick={() => void voteStyle(entry.id)} disabled={busy}><span className={styles.runwaySpotlight} aria-hidden="true" /><CollectibleCard card={entry.card} finish={entry.finish} artVariant={entry.artVariant} width={260} compact effectsPaused anonymous /><span>{styleVoteWinner === entry.id ? t("style.voteLocked") : t("style.voteFor")}</span></button>)}</div> : <div className={styles.runwayEmpty}><FaMasksTheater aria-hidden="true" /><strong>{t("style.noPair")}</strong><p>{t("style.noPairHint")}</p></div>}
            </section>

            <section className={styles.styleStandings}><div className={styles.sectionHeading}><div><span className={styles.commandLabel}>{t("style.standingsEyebrow")}</span><h2>{t("style.standings")}</h2></div></div>{styleLeaderboard?.entries.length ? <ol>{styleLeaderboard.entries.map((entry, index) => <li key={entry.id}><span className={styles.tabular}>{index + 1}</span><CollectibleCard card={entry.card} finish={entry.finish} artVariant={entry.artVariant} width={104} compact effectsPaused /><strong>{t("style.winRate", { rate: Math.round(entry.winRate * 100) })}</strong><small>{t("style.voteCount", { count: entry.votes })}</small></li>)}</ol> : <p>{t("style.standingsEmpty", { count: styleLeaderboard?.minimumVotes ?? 3 })}</p>}</section>
          </>
        ) : null}

        <footer className={styles.gameFooter}><span>{t("footer.rules", { version: bootstrap.rulesVersion })}</span><Link href="/ccg/collection">{t("footer.collection")}<FaArrowRight aria-hidden="true" /></Link></footer>
      </div>
    </CcgShell>
  );
}
