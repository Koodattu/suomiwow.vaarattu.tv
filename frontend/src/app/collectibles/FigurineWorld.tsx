"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { boxReducer, chooseFigure, createFigurineDrawQueue, initialBox } from "@/lib/figurine-box";
import { createFigurineFileCache } from "@/lib/figurine-cache";
import { playFigurineCue, prefetchFigurineAudio, preloadFigurineSignature, unlockFigurineAudio } from "@/lib/figurine-audio";
import { MACHINE_SLOTS, addToCollection, boostedQuality, canSpin, claimQuest, COIN_INTERVAL_MS, crateState, dailyCatchesLeft, dayKey, fishOf, fishRarity, grantReward, landCatch, moveFavorite, openCrate, questBoard, rollCatch, setFavoriteQuality, showcaseOf, spendBoost, initializeCoins, spendCoin, spinWheel, startQuestPeriods, toggleFavorite, type CatchRoll, type PullSource, bestQuality, changeCollection, collectionShelves, copiesOf, emptyCollection, emptyRecords, machineChanges, machineOutcome, readCollection, readRecords, recordPull, recordRecycle, rollQuality, spare, subscribeCollection, trayGroups, type FigurineMachine, type FigurineQuality, type MachineItem, type MachineOutcome } from "@/lib/figurine-collection";
import { ALL_QUIPS, FIGURINE_SERIES, RELEASED_SERIES, UPCOMING_SERIES, SECRET_SERIES, figureKey, figureQuip, findFigure, type FigurineCharacter } from "@/lib/figurine-series";
import type { StageMachine, StagePoke, StageWorld, WorldView } from "@/app/tools/figurine-lab/FigurineStage";
import type { MachinePick, MachineSource } from "@/lib/figurine-machine";
import { DISTRICTS, districtOf, isDistrict, isStation, type District, type Station } from "@/lib/figurine-world";
import WorldPanel, { type LinePhase, type PanelResult, type PanelSeries } from "./WorldPanels";
import PondHud, { type PondPart, type PondSheet } from "./PondHud";
import ChestHud from "./ChestHud";
import RewardLayer, { BoostPrize, FigurePrize, Wallet, flyCoins, holdCoins, presentCoins, presentPrize, releaseCoins, type RewardPoint } from "./RewardLayer";
import DistrictHud, { type DistrictOption } from "./DistrictHud";
import OverviewHud, { OverviewBack } from "./OverviewHud";
import WheelHud, { WHEEL_PRIZES } from "./WheelHud";
import type { ActionCue, CastResult, CatchVisual, FacilityAction } from "@/lib/figurine-facilities";
import panelStyles from "./world-panels.module.css";
import styles from "@/app/tools/figurine-lab/figurine-lab.module.css";
import SoundMenu from "./SoundMenu";
import { onFigurinePointerExit } from "@/lib/figurine-pointer";
import { useTradingPost } from "./TradingPost";
import FacilityOverlay, { nextTurn } from "./FacilityOverlay";
import { isOverlayStation } from "@/lib/figurine-facility-views";
import { PREVIEW_FEED, PREVIEW_GIFTS, PREVIEW_HONOURS, communityPreviewReducer, createCommunityPreview, type PreviewAction } from "@/lib/figurine-community-preview";
import { PLAYER_OFFERS } from "@/lib/figurine-trading";

const FigurineStage = dynamic(() => import("@/app/tools/figurine-lab/FigurineStage"), { ssr: false });
const pad = (number: number) => String(number).padStart(3, "0");
// The overview is home, a station steps back to its district, and inspected figures can return to
// the view they came from.
const parentOf = (view: WorldView): WorldView | null => view === "overview" ? null : isStation(view) ? districtOf(view) ?? "overview" : "overview";
const atCentre = (view: WorldView) => view === "opening" || view === "viewer";
// Keys for the daily stations, beside S, C, M and U.
const STATION_KEYS: Record<string, Station> = { q: "quests", w: "wheel", f: "pond", d: "crate" };
// After this many boxes opened by hand, a button can open one without pulling the tape.
const QUICK_OPEN_AFTER = 5;
// The collection's catalogue docks wide on desktop, with its station framed beside it.
const catalogueWidth = (viewport: number) => Math.min(900, viewport * 0.6);

// How long after the player is back in the square their find rings out.
const BELL_DELAY_MS = 900;
const isMachine = (view: WorldView): view is FigurineMachine => view === "recycler" || view === "forge";
// Every series in shop order: released ones first, then the announced ones.
const ALL_SERIES = [...FIGURINE_SERIES.map((entry) => entry.id), ...UPCOMING_SERIES.map((entry) => entry.id)];
const FIGURE_BYTES = new Map(RELEASED_SERIES.flatMap((entry) => entry.characters.map((character) => [character.model, character.bytes] as const)));
const CATALOG_ORDER = RELEASED_SERIES.flatMap((entry) => entry.characters.map((character) => figureKey(entry.id, character.id)));
const seriesNumber = (id: string) => [...FIGURINE_SERIES, ...UPCOMING_SERIES, SECRET_SERIES].find((entry) => entry.id === id)?.number ?? 0;

export default function FigurineWorld() {
  const t = useTranslations("figurineLab");
  const nav = useTranslations("ccg.nav");
  const [view, setView] = useState<WorldView>("overview");
  const [navHover, setNavHover] = useState<Station | District | "opening" | null>(null);
  const [communityPreview, dispatchCommunityPreview] = useReducer(communityPreviewReducer, undefined, createCommunityPreview);
  const [seriesId, setSeriesId] = useState(FIGURINE_SERIES[0].id);
  const [state, dispatch] = useReducer(boxReducer, initialBox);
  const paidOpening = useRef(false);
  const coinIcon = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (state.phase === "error" && paidOpening.current) { paidOpening.current = false; grantReward({ coins: 1 }); }
  }, [state.phase]);
  const [files, setFiles] = useState<File[]>([]);
  // Which figure `files` holds (its model URL), so the stage never shows one figure in another's place.
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{ key: string; quality: FigurineQuality } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ key: string; count: number; quality: FigurineQuality } | null>(null);
  const [upgraded, setUpgraded] = useState<{ key: string; quality: FigurineQuality } | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [revealedWorld, setRevealedWorld] = useState(false);
  // Inspecting a collected figure remembers its source view.
  const [origin, setOrigin] = useState<Partial<Record<WorldView, WorldView>>>({});
  const collection = useSyncExternalStore(subscribeCollection, readCollection, emptyCollection);
  const records = useSyncExternalStore(subscribeCollection, readRecords, emptyRecords);
  // The opening shot plays to its end before the keyboard can move the camera.
  const [introDone, setIntroDone] = useState(false);
  // Stations carry no signs: the one under the pointer is named in the HUD.
  const [pointed, setPointed] = useState<Station | District | null>(null);
  // The viewport's width, for the docked panel's.
  const [viewport, setViewport] = useState(1280), [portrait, setPortrait] = useState(false);
  // On a screen taller than wide a district shows one station at a time: this one.
  const [focus, setFocus] = useState<Station | null>(null);
  useEffect(() => { const measure = () => { setViewport(window.innerWidth); setPortrait(window.innerHeight > window.innerWidth); }; measure(); window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, []);
  // The collection's catalogue and the workbench dock beside their stations.
  const panelWidth = view === "recycler" || view === "forge" ? 544 : catalogueWidth(viewport);
  // Refresh daily rewards each minute and the chest at its exact cooldown boundary.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 60000);
    const remaining = records.daily.crateAt ? Date.parse(records.daily.crateAt) + COIN_INTERVAL_MS - Date.now() : 0;
    const chestTimer = remaining > 0 ? window.setTimeout(refresh, remaining) : undefined;
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.clearTimeout(chestTimer); window.removeEventListener("focus", refresh); };
  }, [records.daily.crateAt]);
  const stationName = (station: Station | District) => isDistrict(station) ? t(`world.overview.labels.${station}`) : station === "shop" ? t("navShop") : station === "recycler" ? t("stationRecycler") : station === "forge" ? t("stationForge") : t(`world.stations.${station}`);
  const action = useRef<HTMLButtonElement>(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  // An announced series' box can be picked and shaken but never opened: it has no figures yet.
  const series = RELEASED_SERIES.find((entry) => entry.id === seriesId) ?? null;
  // The figure inside each sealed box (and its finish) is drawn as the box arrives and preloaded
  // while it waits, so opening never stalls on a download or parse.
  const [draw, setDraw] = useState<{ series: string; round: number; index: number; quality: FigurineQuality } | null>(null);
  const [drawQueue] = useState(createFigurineDrawQueue);
  useEffect(() => {
    const drawing = RELEASED_SERIES.find((entry) => entry.id === seriesId);
    if (state.phase === "sealed" && drawing) {
      const next = drawQueue.current(seriesId, state.round, drawing.characters.length);
      setDraw((current) => current?.series === seriesId && current.round === state.round ? current : { series: seriesId, round: state.round, index: next.index, quality: boostedQuality(rollQuality(next.qualityRoll), readRecords().boons.boost) });
    }
  }, [seriesId, state.round, state.phase, drawQueue]);
  const currentDraw = series && draw?.series === seriesId && draw.round === state.round ? draw : null;
  const sealedDraw = currentDraw?.index ?? null;
  const drawn = series && state.selected !== null ? series.characters[state.selected] : null;
  const viewing = inspected ? findFigure(inspected.key) : null;
  // The stage loads whichever figure the current view shows: the inspected one, or the box's.
  const wanted: FigurineCharacter | null = view === "viewer" ? viewing?.character ?? null : drawn ?? (series && sealedDraw !== null ? series.characters[sealedDraw] : null);
  const quality: FigurineQuality = view === "viewer" ? inspected?.quality ?? "standard" : currentDraw?.quality ?? "standard";
  const [model, setModel] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [refetch, setRefetch] = useState(0);
  // Shared, bounded compressed-file cache for the selected figure, next draw and display models.
  const fetched = useRef<ReturnType<typeof createFigurineFileCache> | null>(null);
  // Child scene effects can request saved display figures before this component's effects run.
  const loadFigureFile = useCallback((url: string, bytes?: number) => {
    fetched.current ??= createFigurineFileCache();
    return fetched.current.get(url, bytes ?? FIGURE_BYTES.get(url));
  }, []);
  useEffect(() => () => { fetched.current?.dispose(); fetched.current = null; }, []);
  useEffect(() => {
    if (state.phase !== "opening" || !series || webglUnavailable) return;
    const next = drawQueue.next(series.id, series.characters.length);
    const character = series.characters[next.index];
    void loadFigureFile(character.model, character.bytes).catch(() => { /* Selection retries. */ });
  }, [state.phase, series, drawQueue, webglUnavailable, loadFigureFile]);
  useEffect(() => {
    if (!wanted) { setFiles([]); setFilesFor(null); setModel("idle"); return; }
    let cancelled = false;
    setModel("loading");
    const fail = () => { setModel("failed"); if (viewRef.current !== "viewer") dispatch({ type: "failed" }); };
    void (async () => {
      try {
        const file = await loadFigureFile(wanted.model, wanted.bytes);
        if (cancelled) return;
        setFiles([file]); setFilesFor(wanted.model);
      } catch { if (!cancelled) fail(); }
    })();
    return () => { cancelled = true; };
  }, [wanted, state.round, refetch, loadFigureFile]);

  // Entry still waits for the scenery and first figure's GPU preparation. Optional
  // sounds preload concurrently, but a slow sound request must never block play.
  const [stageProgress, setStageProgress] = useState(0), [stageLoaded, setStageLoaded] = useState(false);
  useEffect(() => { void prefetchFigurineAudio([...new Set(FIGURINE_SERIES.flatMap((entry) => entry.characters.map((character) => character.classKey)))], ALL_QUIPS.map(({ file }) => file)); }, []);
  const figureSettled = wanted !== null && (model === "ready" || model === "failed");
  const loaded = stageLoaded && figureSettled;
  useEffect(() => { if (loaded || webglUnavailable) setRevealedWorld(true); }, [loaded, webglUnavailable]);
  const progress = Math.round(100 * (0.85 * stageProgress + 0.15 * (figureSettled ? 1 : 0)));
  // Each series pick drops its box onto the pedestal again.
  const [arrival, setArrival] = useState(0);

  const navigate = useCallback((next: WorldView) => {
    unlockFigurineAudio();
    // Leaving a finished opening clears the pedestal for the next box.
    if (next !== "opening" && (state.phase === "revealed" || state.phase === "error")) { setOpened(null); dispatch({ type: "reset" }); }
    if (next !== "viewer") { setInspected(null); setUpgraded(null); }
    setHovered(null); setPointed(null); setNavHover(null);
    // Stepping back from a station keeps it in view; arriving fresh picks whatever is ready.
    if (isDistrict(next)) setFocus(isStation(view) && districtOf(view) === next ? view : null);
    setView(next);
  }, [state.phase, view]);
  const back = useCallback(() => { const parent = origin[view] ?? parentOf(view); if (parent && state.phase !== "loading" && state.phase !== "opening") navigate(parent); }, [view, state.phase, navigate, origin]);
  useEffect(() => { action.current?.focus({ preventScroll: true }); }, [view, state.phase, state.round]);

  function pickSeries(id: string) {
    unlockFigurineAudio();
    if (id !== seriesId || state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); }
    setSeriesId(id); setView("opening"); setInspected(null); setUpgraded(null); setArrival((current) => current + 1);
  }
  function open() {
    if (!series || state.phase !== "sealed" || paidOpening.current || !spendCoin()) return;
    paidOpening.current = true;
    if (view === "overview") navigate("opening");
    unlockFigurineAudio();
    const selected = sealedDraw ?? chooseFigure(series.characters.length, Math.random());
    preloadFigurineSignature(series.characters[selected].classKey, figureQuip(figureKey(series.id, series.characters[selected].id))?.file);
    if (model === "failed") setRefetch((current) => current + 1);
    dispatch({ type: "open", selected, ready: sealedDraw !== null && model === "ready" && filesFor === wanted?.model });
  }
  function revealed() {
    if (!paidOpening.current || state.phase !== "opening") return;
    paidOpening.current = false;
    dispatch({ type: "revealed" });
    if (series && drawn) {
      const key = figureKey(series.id, drawn.id), finish = currentDraw?.quality ?? "standard";
      addToCollection(key, finish); recordPull({ key, quality: finish }, "box");
      // A boost lifts one box: the one just opened.
      if (readRecords().boons.boost) spendBoost();
      setOpened({ key, count: copiesOf(readCollection()[key]), quality: finish });
    }
  }
  function inspect(key: string, finish?: FigurineQuality) {
    if (view !== "viewer") setOrigin((current) => ({ ...current, viewer: view }));
    if (state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); }
    setInspected({ key, quality: finish ?? bestQuality(collection[key]) ?? "standard" }); setUpgraded(null); setView("viewer");
  }

  // Two machines take three figures each. The recycler smelts any three spare copies into a coin;
  // the forge trades three of a kind up a quality.
  const [slots, setSlots] = useState<Record<FigurineMachine, MachineItem[]>>({ recycler: [], forge: [] });
  type MachineRun = StageMachine & { outcome: MachineOutcome | null };
  const machineLocks = useRef(new Set<FigurineMachine>());
  const [runningMachines, setRunningMachines] = useState({ recycler: false, forge: false });
  const [machineRuns, setMachineRuns] = useState<Record<FigurineMachine, MachineRun>>({ recycler: { run: 0, cards: [], sources: [], output: null, outcome: null }, forge: { run: 0, cards: [], sources: [], output: null, outcome: null } });
  const outcomes = useMemo(() => ({ recycler: machineOutcome("recycler", slots.recycler, collection), forge: machineOutcome("forge", slots.forge, collection) }), [slots, collection]);

  // The daily stations. Each action plays in the world first (the crate bursts, the wheel spins, the
  // line is cast); what it brought shows, and a prize figure joins the collection, once it has.
  const [facilityAction, setFacilityAction] = useState<{ run: number; station: "crate" | "wheel" | "pond"; action: FacilityAction } | null>(null);
  // A cast carries what is on the line (and the figure, for the figure prize) until it is hooked or lost.
  const [pending, setPending] = useState<{ run: number; result: PanelResult | null; source?: PullSource; roll?: CatchRoll; figure?: MachineItem } | null>(null);
  const chestClaiming = useRef(false);
  // Development fishing prizes restart on reload without spending the saved daily allowance.
  const [previewPondCaught, setPreviewPondCaught] = useState(0);
  const pondRecords = process.env.NODE_ENV === "development"
    ? { ...records, daily: { ...records.daily, catch: dayKey(now), caught: previewPondCaught } } : records;
  const [line, setLine] = useState<LinePhase | null>(null);
  // The wheel segment under the pointer, and when the last peg passed.
  const [wheelAt, setWheelAt] = useState<number | null>(null), wheelTick = useRef(0);
  const [poke, setPoke] = useState<StagePoke | null>(null);
  // The pond's sheets (the fish log from its bucket, the anglers' board from the board on the bank,
  // or either's button), and the tackle under the pointer.
  const [pondSheet, setPondSheet] = useState<PondSheet | null>(null);
  const [hoverPart, setHoverPart] = useState<PondPart | null>(null);
  const [buttonPart, setButtonPart] = useState<PondPart | null>(null);
  useEffect(() => onFigurinePointerExit(() => {
    setNavHover(null); setPointed(null); setHovered(null);
    setHoverPart(null); setButtonPart(null);
  }), []);
  const [result, setResult] = useState<PanelResult | null>(null);
  const busy = !!pending;
  // A prize figure: any figure of a released series, at a rolled quality.
  const prizeFigure = (): MachineItem => {
    const drawn = FIGURINE_SERIES[Math.floor(Math.random() * FIGURINE_SERIES.length)], character = drawn.characters[chooseFigure(drawn.characters.length, Math.random())];
    return { key: figureKey(drawn.id, character.id), quality: rollQuality(Math.random()) };
  };
  const act = (station: "crate" | "wheel" | "pond", next: FacilityAction, outcome: PanelResult | null, source?: PullSource, extra: { roll?: CatchRoll; figure?: MachineItem } = {}) => {
    unlockFigurineAudio();
    const run = (facilityAction?.run ?? 0) + 1;
    setFacilityAction({ run, station, action: next }); setPending({ run, result: outcome, source, ...extra }); setResult(null);
  };
  function actionDone(run: number, cast: CastResult | undefined, from: RewardPoint | null) {
    if (!pending || pending.run !== run) return;
    if (pending.result?.station === "crate") chestClaiming.current = false;
    let outcome = pending.result;
    // A cast lands its catch only if it was hooked in time.
    if (pending.roll) {
      setLine(null);
      if (cast !== "caught") { if (cast === "spooked") playFigurineCue("escape", { intensity: 0.6 }); setResult({ station: "pond", missed: cast ?? "missed" }); setPending(null); return; }
      const roll = pending.roll;
      const previewPrize = process.env.NODE_ENV === "development" && roll.kind === "daily";
      if (previewPrize) setPreviewPondCaught((count) => count + 1);
      outcome = { station: "pond", caught: previewPrize ? roll : landCatch(roll, new Date()), figure: pending.figure };
    }
    setPending(null);
    if (!outcome) return;
    const figure = "figure" in outcome ? outcome.figure : undefined;
    const reward = outcome.station === "pond" ? ("caught" in outcome && outcome.caught.kind === "daily" ? outcome.caught.reward : null) : outcome.reward;
    if (reward && outcome.station !== "crate") grantReward(reward);
    if (figure && pending.source) { addToCollection(figure.key, figure.quality); recordPull(figure, pending.source); }
    const figureName = figure ? findFigure(figure.key)?.character.name ?? "" : "", finish = (quality: FigurineQuality) => t(`quality.${quality}`);
    // Coins always pay out the same way; anything else is shown where it was won.
    if (outcome.station === "crate") presentCoins(reward?.coins ?? 0, { origin: from, held: true, title: t("world.crate.title"), note: (reward?.coins ?? 0) > 1 ? t(outcome.day === 7 ? "world.crate.weeklyBonus" : "world.crate.dailyBonus") : undefined });
    else if (outcome.station === "wheel") {
      const title = t("world.stations.wheel");
      if (reward?.coins) presentCoins(reward.coins, { origin: from, title, cue: "winSmall" });
      else if (figure) presentPrize(<FigurePrize figure={figure} name={figureName} detail={`${figure.quality !== "standard" ? `${finish(figure.quality)} · ` : ""}${t("world.pond.banner.joins")}`} />, { title, cue: "winBig" });
      else if (reward?.boost) presentPrize(<BoostPrize quality={reward.boost} name={t("world.rewards.boost", { quality: finish(reward.boost) })} detail={t("world.rewards.boostNext", { quality: finish(reward.boost) })} />, { title, cue: "winBoost" });
    } else if ("caught" in outcome) {
      const caught = outcome.caught;
      if (caught.kind === "daily" && !figure) { presentCoins(caught.reward.coins ?? 1, { origin: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, title: t("world.pond.banner.treasure") }); return; }
      // A fish slaps down; a rare one, a shiny one or a first of its kind earns a jingle on top.
      if (caught.kind === "fish") {
        const rarity = fishRarity(fishOf(caught.fish)!);
        playFigurineCue("flop");
        if (caught.quality !== "standard" || rarity === "epic") playFigurineCue("winBig");
        else if (rarity === "rare" || caught.first || caught.best) playFigurineCue("winSmall");
        else if (rarity !== "junk") playFigurineCue("sparkle", { intensity: 0.5 });
      } else playFigurineCue("winBig");
      setResult(outcome);
    }
  }
  // The line's progress, from the pond's own cues.
  function actionCue(run: number, cue: ActionCue, detail?: number) {
    // The wheel: its reel follows the pointer, and once it slows each segment sounds its own note.
    if (cue === "tick" && detail !== undefined && pending?.run === run) {
      const now = performance.now(), prize = WHEEL_PRIZES[detail];
      if (now - wheelTick.current > 110) playFigurineCue("blip", { intensity: 0.7, rate: prize === "galaxy" ? 1.68 : prize === "golden" ? 1.5 : prize === "figure" ? 1.33 : 0.9 + 0.12 * Number(prize.slice(4)) });
      wheelTick.current = now; setWheelAt(detail);
      return;
    }
    if (!pending?.roll || pending.run !== run) return;
    if (cue === "splash") setLine("wait");
    else if (cue === "nibble") setLine("nibble");
    else if (cue === "bite") setLine("bite");
    else if (cue === "escape") setLine(null);
  }
  // Cast: what is on the line is rolled now (a fish's size from its weight), landed only if hooked.
  function cast() {
    if (pending) return;
    const roll = rollCatch(process.env.NODE_ENV === "development" ? pondRecords : readRecords(), Math.random, now);
    const figure = roll.kind === "daily" && roll.reward.figure ? prizeFigure() : undefined;
    let visual: CatchVisual = figure ? { kind: "figure", model: findFigure(figure.key)!.character.model, quality: figure.quality } : { kind: "coin" };
    if (roll.kind === "fish") {
      const kind = fishOf(roll.fish)!, [low, high] = kind.weight;
      visual = { kind: "fish", fish: roll.fish, quality: roll.quality, length: kind.length * (0.85 + 0.3 * (roll.weight - low) / Math.max(0.1, high - low)) };
    }
    act("pond", { kind: "cast", catch: visual }, null, "pond", { roll, figure });
    setLine("cast");
  }
  const hook = () => { if (pending?.roll) setPoke((current) => ({ n: (current?.n ?? 0) + 1, station: "pond", kind: "hook" })); };
  // The town bell rings when a collector is cheered, and for the player's own golden and galaxy
  // pulls, once they are back out in the square to hear it.
  const ringBell = useCallback((quality?: FigurineQuality) => setPoke((current) => ({ n: (current?.n ?? 0) + 1, station: "feed", kind: "ring", quality })), []);
  const communityAction = (action: PreviewAction) => {
    const cheered = action.type === "cheer" && !communityPreview.cheers.includes(action.id) ? PREVIEW_FEED.find((entry) => entry.id === action.id) : null;
    if (cheered) { unlockFigurineAudio(); ringBell(cheered.item.quality); }
    dispatchCommunityPreview(action);
  };
  const newestFind = records.feed[0], rungFind = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!revealedWorld) return;
    if (rungFind.current === undefined) rungFind.current = newestFind?.at ?? null;
    if (view !== "overview" || !newestFind || newestFind.at === rungFind.current) return;
    const timer = window.setTimeout(() => { rungFind.current = newestFind.at; ringBell(newestFind.quality); }, BELL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [revealedWorld, view, newestFind, ringBell]);
  const dismissCatch = useCallback(() => {
    setResult(null);
    setPoke((current) => ({ n: (current?.n ?? 0) + 1, station: "pond", kind: "dismiss" }));
  }, []);
  // A nibble passes: the line goes back to waiting.
  useEffect(() => {
    if (line !== "nibble") return;
    const timer = window.setTimeout(() => setLine((current) => current === "nibble" ? "wait" : current), 900);
    return () => window.clearTimeout(timer);
  }, [line]);
  // A tap on the rod or the bobber: cast when the line is in, strike when it is out.
  const fishTap = () => { unlockFigurineAudio(); if (pending?.roll) hook(); else cast(); };
  // The pond's tackle: the rod and bobber fish, the bucket opens the fish log, the board the rankings.
  const openSheet = (sheet: PondSheet | null) => { unlockFigurineAudio(); setPondSheet(sheet); };
  const pondPart = (part: string) => { if (part === "bucket") openSheet("log"); else if (part === "board") openSheet("board"); else if (part === "rod" || part === "bobber" || part === "water") fishTap(); };
  const leavePond = () => { setPondSheet(null); back(); };
  const prizes = dailyCatchesLeft(pondRecords, now);
  const crate = crateState(records, now);
  const openDailyChest = () => {
    if (busy || chestClaiming.current || !crate.ready) return;
    chestClaiming.current = true;
    const claimedAt = new Date(), opened = openCrate(claimedAt);
    if (!opened) { chestClaiming.current = false; return; }
    setNow(claimedAt);
    // The coins are the player's from this tap, but the wallet waits for them to come out of the chest.
    holdCoins(opened.reward.coins ?? 0);
    act("crate", { kind: "open" }, { station: "crate", ...opened });
  };
  const streak = useMemo(() => ({ opened: crate.bonusReady ? crate.day - 1 : crate.day, today: crate.bonusReady ? crate.day : null }), [crate.bonusReady, crate.day]);
  const completeSeries = FIGURINE_SERIES.some((entry) => entry.characters.every((character) => collection[figureKey(entry.id, character.id)]));
  const panelActions = {
    busy, result, now,
    onSpin: () => {
      const spun = spinWheel(Math.random(), now);
      if (spun) act("wheel", { kind: "spin", segment: spun.segment }, { station: "wheel", reward: spun.reward, figure: spun.reward.figure ? prizeFigure() : undefined }, "wheel");
    },
    // The stamp comes down, and the quest's coins fly from where it was claimed.
    onClaim: (id: string, from: RewardPoint | null = null) => { unlockFigurineAudio(); const coins = claimQuest(id, completeSeries, now); if (coins) { playFigurineCue("stamp"); flyCoins(coins, from); } },
  };
  // Quests count from the start of the session, and each new day, week or month from its turn.
  useEffect(() => { startQuestPeriods(now); initializeCoins(now); }, [now]);
  const loadSlots = (kind: FigurineMachine, next: MachineItem[]) => setSlots((current) => ({ ...current, [kind]: next }));
  // A card chosen in the picker. The forge works on three of one kind, so it places all three at once.
  function pickCard(kind: FigurineMachine, item: MachineItem) {
    if (machineLocks.current.has(kind)) return;
    unlockFigurineAudio();
    const loaded = slots[kind];
    if (kind === "forge") { if (spare(collection, [], item) >= MACHINE_SLOTS) loadSlots(kind, Array.from({ length: MACHINE_SLOTS }, () => item)); }
    else if (loaded.length < MACHINE_SLOTS && spare(collection, loaded, item) > 0) loadSlots(kind, [...loaded, item]);
  }
  function operateMachine(kind: FigurineMachine, pick: MachinePick, sources: MachineSource[] = []) {
    if (machineLocks.current.has(kind)) return;
    unlockFigurineAudio();
    const loaded = slots[kind], outcome = outcomes[kind], load = (next: MachineItem[]) => loadSlots(kind, next);
    if (pick.kind === "slot") load(kind === "forge" ? [] : loaded.filter((_, index) => index !== pick.index));
    else if ((outcome.kind === "coin" || outcome.kind === "upgrade") && changeCollection(machineChanges(loaded, outcome))) {
      machineLocks.current.add(kind);
      setRunningMachines(current => ({ ...current, [kind]: true }));
      if (outcome.kind === "upgrade") recordPull({ key: outcome.key, quality: outcome.quality }, "forge"); else { recordRecycle(); grantReward({ coins: 1 }); holdCoins(1); }
      setMachineRuns((current) => ({ ...current, [kind]: {
        run: current[kind].run + 1, outcome, cards: loaded, sources,
        output: outcome.kind === "coin" ? { kind: "coin" } : { kind: "figure", key: outcome.key, quality: outcome.quality },
      } }));
      load([]);
    }
  }
  function machineDone(kind: FigurineMachine, from: RewardPoint | null) {
    machineLocks.current.delete(kind);
    setRunningMachines(current => ({ ...current, [kind]: false }));
    const made = machineRuns[kind].outcome;
    // A coin nobody is there to see is simply in the wallet.
    if (viewRef.current !== kind || !made) { if (made?.kind === "coin") releaseCoins(1); return; }
    if (made.kind === "coin") presentCoins(1, { origin: from, held: true, title: t("stationRecycler") });
    else if (made.kind === "upgrade") { inspect(made.key, made.quality); setUpgraded({ key: made.key, quality: made.quality }); }
  }
  const qualityName = (finish: FigurineQuality) => t(`quality.${finish}`);
  // Navigation is in the world; the keyboard mirrors it: Esc back, S shop, C collection, M recycler, U forge,
  // number keys pick a series, Enter opens the sealed box.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (event) => {
      if (!revealedWorld || !introDone || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      // The pond's sheets close before anything else; while one is open the pond waits.
      if (pondSheet && view === "pond") { if (key === "escape" || key === (pondSheet === "log" ? "l" : "b")) setPondSheet(null); return; }
      if (view === "pond" && result?.station === "pond" && "caught" in result && key === "escape") { event.preventDefault(); dismissCatch(); return; }
      if (key === "escape" || key === "backspace") back();
      else if (isDistrict(view) && /^[1-3]$/.test(key) && DISTRICTS[view][Number(key) - 1]) navigate(DISTRICTS[view][Number(key) - 1]);
      else if ((atCentre(view) || view === "overview") && key === "s") navigate("shop");
      else if ((atCentre(view) || view === "overview") && key === "c") navigate("gallery");
      else if ((atCentre(view) || view === "overview") && key === "m") navigate("recycler");
      else if ((atCentre(view) || view === "overview") && key === "u") navigate("forge");
      else if ((atCentre(view) || view === "overview") && STATION_KEYS[key]) navigate(STATION_KEYS[key]);
      else if (view === "shop" && /^[1-9]$/.test(key) && ALL_SERIES[Number(key) - 1]) pickSeries(ALL_SERIES[Number(key) - 1]);
      else if (view === "opening" && state.phase === "sealed" && series && !webglUnavailable && (key === "enter" || key === " ") && !(event.target instanceof Element && event.target.closest("button, a"))) { event.preventDefault(); open(); }
      // At the pond, Space casts, and strikes once the line is out.
      else if (view === "crate" && key === " " && !(event.target instanceof Element && event.target.closest("button, a"))) { event.preventDefault(); openDailyChest(); }
      else if (view === "pond" && key === " " && !(event.target instanceof Element && event.target.closest("button, a"))) { event.preventDefault(); fishTap(); }
      else if (view === "pond" && key === "l") openSheet("log");
      else if (view === "pond" && key === "b") openSheet("board");
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const world: StageWorld = useMemo(() => ({
    collection,
    series: [
      { id: SECRET_SERIES.id, number: pad(SECRET_SERIES.number), hue: SECRET_SERIES.hue, hidden: true, released: true, silhouettes: SECRET_SERIES.silhouettes, keys: SECRET_SERIES.characters.map((character) => figureKey(SECRET_SERIES.id, character.id)), names: SECRET_SERIES.characters.map((character) => character.name), models: SECRET_SERIES.characters.map((character) => character.model) },
      ...FIGURINE_SERIES.map((entry) => ({
        id: entry.id, number: pad(entry.number), theme: entry.theme, released: true, silhouettes: entry.silhouettes,
        keys: entry.characters.map((character) => figureKey(entry.id, character.id)),
        names: entry.characters.map((character) => character.name), models: entry.characters.map((character) => character.model),
      })),
      ...UPCOMING_SERIES.map((entry) => ({ id: entry.id, number: pad(entry.number), hue: entry.hue, released: false, keys: [], names: Array.from({ length: entry.size }, () => "?"), models: [] })),
    ],
    labels: {
      sign: t("navShop"), series: (number) => t("seriesName", { number }),
      collected: (owned, total) => t("seriesCollected", { got: owned, total }), comingSoon: t("comingSoon"),
    },
    showcase: showcaseOf(records.favorites, collection),
    streak, chestReady: crate.ready, prizes,
  }), [collection, records.favorites, streak, crate.ready, prizes, t]);
  // The collection lists released series, a secret one once found, then the announced ones.
  const panelSeries: PanelSeries[] = useMemo(() => [...collectionShelves(world.series, collection).filter((entry) => entry.released), ...world.series.filter((entry) => !entry.hidden && !entry.released)]
    .map(({ id, number, released, hidden, keys }) => ({ id, number, released, hidden, keys })), [world.series, collection]);
  const trading = useTradingPost(now);
  const machineKind = isMachine(view) ? view : null;
  const away = !!machineKind && runningMachines[machineKind];
  const machinePanel = machineKind ? {
    kind: machineKind, slots: slots[machineKind],
    groups: trayGroups(collection, CATALOG_ORDER, machineKind).map((group) => ({ key: group.key, quality: group.quality, spare: machineKind === "forge" ? group.count : spare(collection, slots[machineKind], group) })),
    onPick: (item: MachineItem) => pickCard(machineKind, item), onClear: () => { if (!machineLocks.current.has(machineKind)) loadSlots(machineKind, []); },
    onRemove: (index: number) => operateMachine(machineKind, { kind: "slot", index }),
    onRun: (sources: MachineSource[]) => operateMachine(machineKind, { kind: "trigger" }, sources),
    outcome: outcomes[machineKind], busy: runningMachines[machineKind],
  } : undefined;
  // How each station of a district stands, for its card, and what is waiting to be collected.
  const waitTime = (ms: number) => { const minutes = Math.ceil(ms / 60000); return t("world.crate.comeBack", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }); };
  const quests = questBoard(records, completeSeries, now), questsReady = quests.filter((quest) => quest.done && !quest.claimed).length;
  const spinReady = canSpin(records, now), done = new Set(trading.completed.map((item) => item.id));
  const forgeSets = trayGroups(collection, CATALOG_ORDER, "forge").length, spares = trayGroups(collection, CATALOG_ORDER, "recycler").reduce((sum, group) => sum + spare(collection, [], group), 0);
  const giftsLeft = PREVIEW_GIFTS.filter((gift) => !communityPreview.claimed.includes(gift.id)).length;
  const districtOptions: Record<District, DistrictOption[]> = {
    fair: [
      { station: "crate", ready: crate.ready, status: crate.ready ? t("world.district.ready") : waitTime(crate.remainingMs) },
      { station: "quests", ready: questsReady > 0, status: questsReady ? t("world.district.toClaim", { count: questsReady }) : t("world.district.questsDone", { done: quests.filter((quest) => quest.claimed).length, total: quests.length }) },
      { station: "wheel", ready: spinReady, status: spinReady ? t("world.district.freeSpin") : waitTime(nextTurn("daily", now).getTime() - now.getTime()) },
    ],
    yard: [
      { station: "forge", ready: forgeSets > 0, status: t("world.district.sets", { count: forgeSets }) },
      { station: "recycler", status: t("world.district.spares", { count: spares }) },
    ],
    market: [
      { station: "trading", status: t("world.district.offers", { count: PLAYER_OFFERS.filter((offer) => !done.has(offer.id)).length }) },
      { station: "mail", ready: giftsLeft > 0, status: t("world.district.gifts", { count: giftsLeft }) },
      { station: "merchant", status: t("world.district.deals", { count: trading.deals.filter((offer) => !done.has(offer.id)).length }) },
    ],
    honours: [
      { station: "feed", status: t("world.district.finds", { count: records.feed.length }) },
      { station: "fame", status: t("world.district.firsts", { done: PREVIEW_HONOURS.filter((honour) => honour.collector).length, total: PREVIEW_HONOURS.length }) },
      { station: "leaderboard", status: t("world.district.figures", { count: Object.keys(collection).length }) },
    ],
  };
  const focused = !portrait || !isDistrict(view) ? null : focus && (DISTRICTS[view] as readonly Station[]).includes(focus) ? focus : (districtOptions[view].find((option) => option.ready) ?? districtOptions[view][0]).station;
  const alerts = Object.fromEntries((Object.keys(districtOptions) as District[]).map((name) => [name, districtOptions[name].some((option) => option.ready)]));
  const boxCount = series?.characters.length ?? 16;
  const packaging = useMemo(() => ({ blind: t("boxBlind"), collect: t("boxCollect", { count: boxCount }), contents: t("boxContents"), openHere: t("boxOpenHere") }), [t, boxCount]);
  const label = (figure: FigurineCharacter) => `${figure.realm} · ${t(`races.${figure.raceKey}`)} · ${t(`classes.${figure.classKey}`)}`;
  const hoveredFigure = hovered ? findFigure(hovered) : null;
  const qualityBadge = (finish: FigurineQuality) => finish !== "standard" && <span className={styles.qualityBadge} data-quality={finish}>{qualityName(finish)}</span>;

  return <main className={styles.showcase} data-phase={state.phase} data-view={view} data-panel={view === "gallery" || (isOverlayStation(view) && view !== "wheel") || undefined}>
    <Link href="/" className={styles.worldHomeLink} aria-label={nav("backToMain")}>
      <Image src="/logo.png" alt="SuomiWoW" width={112} height={51} priority />
    </Link>
    <SoundMenu />
    {revealedWorld && <Wallet className={styles.coinBalance} balance={records.boons.coins} label={t("coinsLabel")} title={t("coinsHelp")} icon={coinIcon} />}
    <RewardLayer collect={t("world.crate.collect")} tapToCollect={t("world.crate.dismissReward")} />
    <FigurineStage immersive files={files} filesFor={filesFor} showing={wanted?.model ?? null} loadFigureFile={loadFigureFile} boxMode open={view !== "viewer" && (state.phase === "opening" || state.phase === "revealed")} charging={state.phase === "loading"}
      interactive={revealedWorld && (view === "overview" || view === "opening") && state.phase === "sealed" && !webglUnavailable} locked={!series || records.boons.coins < 1} round={state.round} onBoxTap={open} rotate={view === "overview" || view === "viewer" || view === "opening"} ready={revealedWorld}
      view={view} series={seriesId} world={world} figureKey={drawn && series ? figureKey(series.id, drawn.id) : undefined} quality={quality}
      machines={machineRuns} workshopBusy={away} onMachineDone={machineDone} onIntroDone={() => setIntroDone(true)} onHoverStation={setPointed} action={facilityAction} onActionDone={actionDone} onActionCue={actionCue} poke={poke} panelWidth={panelWidth} focus={focused}
      onFacilityPart={(station, part) => { if (station === "pond") pondPart(part); else if (station === "crate" && part === "chest") openDailyChest(); }} onHoverPart={(part) => setHoverPart(part === "water" ? "rod" : part as PondPart | null)} highlightedPart={view === "pond" && !pondSheet ? buttonPart : null}
      onNavigate={navigate} onBack={back} onPickSeries={pickSeries} onInspect={(key) => inspect(key)} onHoverFigure={setHovered}
      highlightedStation={view === "overview" || isDistrict(view) ? navHover : null}
      onStatus={(status) => {
        setWebglUnavailable(status === "webgl");
        if (status === "loading") setModel("loading");
        else if (status === "ready") { setModel("ready"); dispatch({ type: "loaded" }); }
        else if (status === "error" || status === "webgl") { setModel("failed"); if (view !== "viewer") dispatch({ type: "failed" }); }
      }}
      onProgress={setStageProgress} onLoaded={() => setStageLoaded(true)} arrival={arrival}
      onRevealed={revealed} signature={drawn?.classKey} quip={drawn && series ? figureQuip(figureKey(series.id, drawn.id)) : undefined}
      labels={{ loading: t("modelLoading"), ready: t("modelReady"), empty: t("modelEmpty"), error: t("modelError"), webgl: t("webglError"), box: t("boxStatus"), boxTitle: t("boxTitle"), boxSubtitle: t("boxSubtitle"), series: t("navCollection"), packaging }} />
    {records.boons.boost && revealedWorld && <p className={panelStyles.hudBoons}>
      {records.boons.boost && <span data-quality={records.boons.boost}>{t("world.rewards.boostNext", { quality: t(`quality.${records.boons.boost}`) })}</span>}
    </p>}
    {view === "pond" && revealedWorld && <PondHud records={records} line={line} result={result?.station === "pond" ? result : null} busy={busy} hovered={hoverPart} sheet={pondSheet} onHover={setButtonPart}
      onCast={cast} onHook={hook} onDismiss={dismissCatch} onSheet={openSheet} onBack={leavePond} />}
    {view === "overview" && revealedWorld && <OverviewHud onNavigate={navigate} onHover={setNavHover} hovered={pointed} alerts={alerts} />}
    {isDistrict(view) && revealedWorld && <DistrictHud district={view} options={districtOptions[view]} hovered={navHover && navHover !== "opening" ? navHover : pointed} focused={focused} onFocus={setFocus} onOpen={navigate} onHover={setNavHover} onBack={back} />}
    {revealedWorld && view !== "overview" && view !== "pond" && view !== "crate" && view !== "wheel" && !isDistrict(view) && (!isOverlayStation(view) || away) && <OverviewBack onBack={back} disabled={state.phase === "loading" || state.phase === "opening"} />}
    {view === "crate" && revealedWorld && <ChestHud ready={crate.ready} day={crate.day} remainingMs={crate.remainingMs} bonusReady={crate.bonusReady} busy={busy} onOpen={openDailyChest} onBack={back} />}
    {view === "wheel" && revealedWorld && <WheelHud ready={spinReady} busy={busy} turn={nextTurn("daily", now)} now={now} at={wheelAt} onSpin={panelActions.onSpin} onBack={back} />}
    {revealedWorld && isOverlayStation(view) && view !== "wheel" && <FacilityOverlay away={away} machine={machinePanel} trading={trading} view={view} collection={collection} records={records} series={panelSeries} actions={panelActions} preview={communityPreview} dispatch={communityAction} onClose={back} />}
    {isStation(view) && !isOverlayStation(view) && view !== "shop" && view !== "pond" && view !== "crate" && <WorldPanel view={view} collection={collection} records={records} series={panelSeries} onClose={back}
      onInspect={(key, finish) => inspect(key, finish)}
      onFavorite={(item) => { unlockFigurineAudio(); toggleFavorite(item); }} onMoveFavorite={(key, to) => moveFavorite(key, to)} onFavoriteQuality={(key, finish) => setFavoriteQuality(key, finish)} />}
    <div className={styles.worldLoader} data-done={revealedWorld} role="status" aria-hidden={revealedWorld}>
      <span>{t("worldPreparing")}</span>
      <div className={styles.worldLoaderBar}><i style={{ width: `${progress}%` }} /></div>
    </div>
    <div className={styles.showcaseHud}>
      <div className={styles.revealIdentity} aria-live="polite" aria-atomic="true">
        {view === "opening" && state.phase === "revealed" && drawn ? <>
            {opened && <span className={styles.newBadge}>{opened.count === 1 ? t("newFigure") : t("duplicateFigure", { count: opened.count })}</span>}
            {opened && qualityBadge(opened.quality)}
            <h1>{drawn.name}</h1><p>{label(drawn)}</p>
          </> : view === "opening" && state.phase === "error" ? <><h1>{t("drawErrorTitle")}</h1><p>{t(webglUnavailable ? "webglError" : "drawError")}</p></>
          : view !== "overview" && pointed && pointed !== view && !(view === "opening" && state.phase !== "sealed") ? <p className={styles.worldHint}>{stationName(pointed)}</p>
          : view === "viewer" && viewing && inspected ? <>
            {upgraded && <span className={styles.newBadge}>{t("tradedUp")}</span>}
            {qualityBadge(inspected.quality)}
            <h1>{viewing.character.name}</h1><p>{label(viewing.character)}</p><p className={styles.showcaseHint}>{t("inspectFigure")}</p>
          </> : (view === "gallery" || (view === "opening" && state.phase === "sealed")) && hoveredFigure ? <p className={styles.worldHint}>{collection[hovered!] ? hoveredFigure.character.name : t("notCollected")}</p>
          : !atCentre(view) ? null
          : <span className={styles.srOnly}>{t(state.phase === "loading" ? "drawLoading" : state.phase === "opening" ? "drawOpening" : "mysteryTitle")}</span>}
      </div>
      {view === "opening" && state.phase === "sealed" && <p className={styles.worldHint}>{series ? t(records.boons.coins > 0 ? "pullToOpenCoin" : "noCoins") : `${t("seriesName", { number: pad(seriesNumber(seriesId)) })} · ${t("comingSoon")}`}</p>}
      {view === "opening" && state.phase === "sealed" && series && introDone && records.stats.opened >= QUICK_OPEN_AFTER && !webglUnavailable && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} disabled={records.boons.coins < 1} onClick={open}>{t("openBoxCoin")}</button>
      </div>}
      {view === "opening" && state.phase === "revealed" && series && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} onClick={() => pickSeries(seriesId)}>{t("openAnother")}</button>
      </div>}
      {view === "opening" && state.phase === "error" && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} disabled={records.boons.coins < 1} onClick={() => { if (paidOpening.current || !spendCoin()) return; paidOpening.current = true; unlockFigurineAudio(); setFiles([]); dispatch({ type: "retry" }); }}>{t("retryBox")}</button>
      </div>}
      {view === "shop" && <p className={styles.showcaseHint}>{t("tapAwayHint")}</p>}
      {view === "viewer" && (!files.length || filesFor !== wanted?.model) && <p className={styles.showcaseHint}>{t("worldLoading")}</p>}
    </div>
  </main>;
}
