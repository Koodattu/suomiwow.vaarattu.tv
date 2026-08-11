"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FaArrowRight, FaDiceD20, FaFlagCheckered, FaMasksTheater, FaMountain, FaPeopleGroup, FaPlay, FaRotate } from "react-icons/fa6";
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
import CcgRosterBuilder, { CcgRosterOption, getCcgMercenaries } from "./CcgRosterBuilder";
import CcgTacticsPanel, { EMPTY_ASSIGNMENTS } from "./CcgTacticsPanel";
import styles from "./ccg-games.module.css";

export type CcgPlayableMode = "expedition" | "raid-night" | "raid-race" | "transmog-ring";

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

export default function CcgGameHub({ mode }: { mode: CcgPlayableMode }) {
  const t = useTranslations("ccg.play");
  const [bootstrap, setBootstrap] = useState<CcgGamesBootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [raidBossIndex, setRaidBossIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getCcgGamesBootstrap();
      setBootstrap(response);
      setRaceEntry(response.race.entry);
      setRaidBossIndex(response.raid.lockout?.bossIndex ?? 0);
      if (response.raid.lockout) {
        setRaidActive(response.raid.lockout.activeCardIds);
        setRaidBench(response.raid.lockout.rosterCardIds.filter((id) => !response.raid.lockout?.activeCardIds.includes(id)));
        setDifficulty(response.raid.lockout.difficulty);
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
  }, [t]);

  useEffect(() => { void load(); }, [load]);
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

  const submitExpedition = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.runCcgExpedition({ idempotencyKey: idempotencyKey("expedition"), cardIds: expeditionActive, route, pullSize, boon, assignments: expeditionAssignments });
      setExpeditionResult(result);
      setLeaderboard(await api.getCcgExpeditionLeaderboard());
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.run"))); }
    finally { setBusy(false); }
  };

  const submitRaid = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.pullCcgRaid({ idempotencyKey: idempotencyKey("raid"), rosterCardIds: [...raidActive, ...raidBench], activeCardIds: raidActive, difficulty, assignments: raidAssignments });
      setRaidResult(result);
      setRaidBossIndex(result.bossIndex);
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.run"))); }
    finally { setBusy(false); }
  };

  const submitRace = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.enterCcgRaidRace({ idempotencyKey: idempotencyKey("race"), activeCardIds: raidActive, assignments: raidAssignments });
      setRaceEntry(result);
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.run"))); }
    finally { setBusy(false); }
  };

  const selectStyleCard = (cardId: string) => {
    const card = bootstrap?.collection.cards.find((item) => item.id === cardId);
    const owned = card ? bestOwnedFinish(card) : null;
    setStyleCardId(cardId);
    setStyleFinish(owned?.finish ?? "standard");
    setStyleArt(owned?.artVariant ?? "standard");
  };

  const submitStyle = async () => {
    if (!styleCardId) return;
    setBusy(true); setError(null);
    try {
      await api.submitCcgStyle({ cardId: styleCardId, finish: styleFinish, artVariant: styleArt });
      setStyleSubmitted(true);
      setStylePair(await api.getCcgStylePair());
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.style"))); }
    finally { setBusy(false); }
  };

  const voteStyle = async (winnerId: string) => {
    if (!stylePair?.pair) return;
    setBusy(true); setError(null);
    try {
      await api.voteCcgStyle(stylePair.pair.map((entry) => entry.id), winnerId);
      const [pair, standings] = await Promise.all([api.getCcgStylePair(), api.getCcgStyleLeaderboard()]);
      setStylePair(pair); setStyleLeaderboard(standings);
    } catch (requestError) { setError(getErrorMessage(requestError, t("errors.vote"))); }
    finally { setBusy(false); }
  };

  if (loading) return <CcgShell><div className={styles.loadingState}><FaDiceD20 aria-hidden="true" /><p>{t("loading")}</p></div></CcgShell>;
  if (!bootstrap) return <CcgShell><div className={styles.errorState}><p>{error ?? t("errors.load")}</p><button type="button" onClick={() => void load()}>{t("retry")}</button></div></CcgShell>;

  const selectedStyleCard = bootstrap.collection.cards.find((card) => card.id === styleCardId) ?? null;
  const styleFinishes = selectedStyleCard?.ownership ?? [];
  const pageError = error ? <div className={styles.inlineError} role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label={t("dismiss")}>×</button></div> : null;

  return (
    <CcgShell>
      <div className={styles.gamePage}>
        <header className={styles.gameHero}>
          <div>
            <span className={styles.eyebrow}>{t("eyebrow")}</span>
            <h1>{t("title")}</h1>
            <p>{t("subtitle")}</p>
          </div>
          <div className={styles.diceRule}>
            <FaDiceD20 aria-hidden="true" />
            <span><strong>{t("dice.title")}</strong><small>{t("dice.description")}</small></span>
          </div>
        </header>

        <nav className={styles.modeNav} aria-label={t("modeNavLabel")}>
          {MODES.map((item) => {
            const Icon = item.icon;
            return <Link href={`/ccg/play/${item.id}`} key={item.id} data-active={mode === item.id}><Icon aria-hidden="true" /><span><strong>{t(`modes.${item.id}.title`)}</strong><small>{t(`modes.${item.id}.short`)}</small></span></Link>;
          })}
        </nav>
        {pageError}

        {mode === "expedition" ? (
          <>
            <section className={styles.modeIntro}>
              <div><span className={styles.eyebrow}>{t("modes.expedition.eyebrow")}</span><h2>{t("modes.expedition.heading")}</h2><p>{t("modes.expedition.description")}</p></div>
              <dl><div><dt>{t("week")}</dt><dd>{bootstrap.weeklyKey}</dd></div><div><dt>{t("modes.expedition.timer")}</dt><dd>{formatTime(bootstrap.expedition.timerSeconds)}</dd></div><div><dt>{t("modes.expedition.key")}</dt><dd>+{bootstrap.expedition.keyLevel}</dd></div></dl>
            </section>
            <CcgRosterBuilder cards={rosterCards} activeIds={expeditionActive} benchIds={[]} formation={{ tank: 1, healer: 1, dps: 3 }} rosterLimit={5} allowMercenaries onChange={(active) => { setExpeditionActive(active); setExpeditionAssignments(cloneEmptyAssignments()); }} />
            <section className={styles.runOptions}>
              <label><span>{t("expedition.route")}</span><select value={route} onChange={(event) => setRoute(event.target.value as typeof route)}><option value="safe">{t("expedition.safeRoute")}</option><option value="score">{t("expedition.scoreRoute")}</option></select></label>
              <label><span>{t("expedition.pullSize")}</span><select value={pullSize} onChange={(event) => setPullSize(event.target.value as typeof pullSize)}><option value="small">{t("expedition.small")}</option><option value="standard">{t("expedition.standard")}</option><option value="large">{t("expedition.large")}</option></select></label>
              <label><span>{t("expedition.boon")}</span><select value={boon} onChange={(event) => setBoon(event.target.value as typeof boon)}><option value="refreshing-kick">{t("expedition.refreshingKick")}</option><option value="guardian-echo">{t("expedition.guardianEcho")}</option><option value="farshot">{t("expedition.farshot")}</option></select></label>
            </section>
            <CcgTacticsPanel cards={expeditionCards} assignments={expeditionAssignments} phases={expeditionPhases} raidSize={false} onChange={setExpeditionAssignments} />
            <div className={styles.launchRow}><button type="button" className={styles.primaryButton} onClick={() => void submitExpedition()} disabled={busy || expeditionActive.length !== 5}><FaPlay aria-hidden="true" />{busy ? t("simulating") : t("expedition.start")}</button></div>
            {expeditionResult ? <section className={styles.expeditionResults}><div className={styles.runSummary} data-timed={expeditionResult.timed}><strong>{expeditionResult.completed ? expeditionResult.timed ? t("expedition.timed") : t("expedition.completed") : t("expedition.depleted")}</strong><span>{t("expedition.score", { score: expeditionResult.score })}</span><span>{formatTime(expeditionResult.durationSeconds)} · {t("expedition.deathCount", { count: expeditionResult.deaths })}</span></div>{expeditionResult.encounters.map((result, index) => <CcgCombatReport key={result.encounterId} result={result} title={bootstrap.expedition.encounters[index]?.name} />)}</section> : null}
            {leaderboard ? <section className={styles.leaderboard}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{t("leaderboard.eyebrow")}</span><h2>{t("leaderboard.title")}</h2></div></div>{leaderboard.entries.length > 0 ? <ol>{leaderboard.entries.map((entry) => <li key={`${entry.rank}-${entry.collector}`} data-me={entry.isMe}><span>{entry.rank}</span><strong>{entry.collector}</strong><small>{entry.timed ? t("leaderboard.timed") : t("leaderboard.untimed")} · {formatTime(entry.durationSeconds)}</small><b>{entry.score.toLocaleString()}</b></li>)}</ol> : <p>{t("leaderboard.empty")}</p>}</section> : null}
          </>
        ) : null}

        {mode === "raid-night" || mode === "raid-race" ? (
          <>
            <section className={styles.modeIntro}>
              <div><span className={styles.eyebrow}>{t(`modes.${mode}.eyebrow`)}</span><h2>{t(`modes.${mode}.heading`)}</h2><p>{t(`modes.${mode}.description`)}</p></div>
              <dl>{mode === "raid-night" ? <><div><dt>{t("raid.boss")}</dt><dd>{currentRaidEncounter?.name ?? t("raid.complete")}</dd></div><div><dt>{t("raid.progress")}</dt><dd>{Math.min(raidBossIndex, bootstrap.raid.encounters.length)}/{bootstrap.raid.encounters.length}</dd></div></> : <><div><dt>{t("race.budget")}</dt><dd>{raidRosterCost}/{bootstrap.race.rosterBudget}</dd></div><div><dt>{t("week")}</dt><dd>{bootstrap.weeklyKey}</dd></div></>}</dl>
            </section>
            <CcgRosterBuilder cards={rosterCards} activeIds={raidActive} benchIds={mode === "raid-night" ? raidBench : []} formation={{ tank: 2, healer: 4, dps: 14 }} rosterLimit={mode === "raid-night" ? 25 : 20} allowMercenaries={mode === "raid-night" && difficulty !== "heroic"} onChange={(active, bench) => { setRaidActive(active); setRaidBench(bench); setRaidAssignments(cloneEmptyAssignments()); }} />
            {mode === "raid-night" ? <section className={styles.runOptions}><label><span>{t("raid.difficulty")}</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="story">{t("raid.story")}</option><option value="normal">{t("raid.normal")}</option><option value="heroic">{t("raid.heroic")}</option></select></label></section> : <div className={raidRosterCost <= bootstrap.race.rosterBudget ? styles.budgetOkay : styles.budgetExceeded}>{t("race.cost", { cost: raidRosterCost, budget: bootstrap.race.rosterBudget })}</div>}
            <CcgTacticsPanel cards={raidCards} assignments={raidAssignments} phases={raidPhases} raidSize onChange={setRaidAssignments} />
            <div className={styles.launchRow}><button type="button" className={styles.primaryButton} onClick={() => void (mode === "raid-night" ? submitRaid() : submitRace())} disabled={busy || raidActive.length !== 20 || (mode === "raid-race" && (raidCards.length !== 20 || raidRosterCost > bootstrap.race.rosterBudget))}><FaPlay aria-hidden="true" />{busy ? t("simulating") : t(mode === "raid-night" ? "raid.pull" : "race.submit")}</button></div>
            {mode === "raid-night" && raidResult ? <><div className={styles.progressBanner} data-complete={raidResult.raidComplete}>{raidResult.raidComplete ? t("raid.cleared") : raidResult.simulation.killed ? t("raid.nextBoss") : t("raid.pullAgain")}</div><CcgCombatReport result={raidResult.simulation} title={bootstrap.raid.encounters.find((encounter) => encounter.id === raidResult.simulation.encounterId)?.name} /></> : null}
            {mode === "raid-race" && raceEntry ? <section className={styles.raceResult}><div className={styles.raceStatus} data-outcome={raceEntry.outcome ?? raceEntry.status}><strong>{raceEntry.status === "queued" ? t("race.waiting") : t(`race.${raceEntry.outcome}`)}</strong><small>{raceEntry.status === "queued" ? t("race.waitingHint") : t("race.matchedHint")}</small></div><div className={styles.raceReports}><CcgCombatReport result={raceEntry.result} title={t("race.yourPull")} />{raceEntry.opponent ? <CcgCombatReport result={raceEntry.opponent.result} title={t("race.opponentPull")} /> : null}</div></section> : null}
          </>
        ) : null}

        {mode === "transmog-ring" ? (
          <>
            <section className={styles.modeIntro}><div><span className={styles.eyebrow}>{t("modes.transmog-ring.eyebrow")}</span><h2>{t("modes.transmog-ring.heading")}</h2><p>{t("modes.transmog-ring.description")}</p></div><dl><div><dt>{t("style.theme")}</dt><dd>{bootstrap.style.theme}</dd></div><div><dt>{t("style.format")}</dt><dd>{t("style.async")}</dd></div></dl></section>
            <section className={styles.styleEntry}>
              <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{t("style.entryEyebrow")}</span><h2>{t("style.entryTitle")}</h2></div></div>
              <div className={styles.styleEntryLayout}>
                <div className={styles.styleCardPicker}>{bootstrap.collection.cards.map((card) => <button type="button" key={card.id} data-selected={styleCardId === card.id} onClick={() => selectStyleCard(card.id)}><span>{card.name}</span><small>{card.set.raidName}</small></button>)}</div>
                <div className={styles.stylePreview}>
                  {selectedStyleCard ? <><CollectibleCard card={selectedStyleCard} finish={styleFinish} artVariant={styleArt} width={245} ambientMaterial /><div className={styles.styleControls}><label><span>{t("style.finish")}</span><select value={styleFinish} onChange={(event) => setStyleFinish(event.target.value as CcgFinish)}>{[...new Set(styleFinishes.map((row) => row.finish))].map((finish) => <option value={finish} key={finish}>{finish}</option>)}</select></label><label><span>{t("style.art")}</span><select value={styleArt} onChange={(event) => setStyleArt(event.target.value as CcgArtVariant)}><option value="standard">{t("style.standardArt")}</option>{styleFinishes.some((row) => row.artVariant === "alternative") ? <option value="alternative">{t("style.alternativeArt")}</option> : null}</select></label><button type="button" className={styles.primaryButton} onClick={() => void submitStyle()} disabled={busy}>{styleSubmitted ? t("style.update") : t("style.submit")}</button></div></> : <div className={styles.styleEmpty}>{t("style.choose")}</div>}
                </div>
              </div>
            </section>
            <section className={styles.runway}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{t("style.voteEyebrow")}</span><h2>{t("style.voteTitle")}</h2><p>{t("style.voteHint")}</p></div>{stylePair?.pair ? <button type="button" className={styles.iconButton} onClick={() => void api.getCcgStylePair().then(setStylePair)} aria-label={t("style.refresh")}><FaRotate aria-hidden="true" /></button> : null}</div>{stylePair?.pair ? <div className={styles.runwayPair}>{stylePair.pair.map((entry) => <button type="button" key={entry.id} onClick={() => void voteStyle(entry.id)} disabled={busy}><CollectibleCard card={entry.card} finish={entry.finish} artVariant={entry.artVariant} width={250} compact effectsPaused anonymous /><span>{t("style.voteFor")}</span></button>)}</div> : <div className={styles.runwayEmpty}><FaMasksTheater aria-hidden="true" /><strong>{t("style.noPair")}</strong><p>{t("style.noPairHint")}</p></div>}</section>
            <section className={styles.styleStandings}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{t("style.standingsEyebrow")}</span><h2>{t("style.standings")}</h2></div></div>{styleLeaderboard?.entries.length ? <ol>{styleLeaderboard.entries.map((entry, index) => <li key={entry.id}><span>{index + 1}</span><CollectibleCard card={entry.card} finish={entry.finish} artVariant={entry.artVariant} width={110} compact effectsPaused /><strong>{t("style.winRate", { rate: Math.round(entry.winRate * 100) })}</strong><small>{t("style.voteCount", { count: entry.votes })}</small></li>)}</ol> : <p>{t("style.standingsEmpty", { count: styleLeaderboard?.minimumVotes ?? 3 })}</p>}</section>
          </>
        ) : null}

        <footer className={styles.gameFooter}><span>{t("footer.rules", { version: bootstrap.rulesVersion })}</span><Link href="/ccg/collection">{t("footer.collection")}<FaArrowRight aria-hidden="true" /></Link></footer>
      </div>
    </CcgShell>
  );
}
