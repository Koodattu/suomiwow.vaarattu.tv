"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { boxReducer, chooseFigure, initialBox } from "@/lib/figurine-box";
import { createFigurineFileCache } from "@/lib/figurine-cache";
import { prefetchFigurineAudio, preloadFigurineSignature, unlockFigurineAudio } from "@/lib/figurine-audio";
import { MACHINE_SLOTS, addToCollection, boostedQuality, castLine, claimQuest, crateState, grantReward, openCrate, spendBoost, spinWheel, startQuestPeriods, type PullSource, bestQuality, changeCollection, collectionShelves, copiesOf, emptyCollection, emptyRecords, machineChanges, machineOutcome, readCollection, readRecords, recordPull, recordRecycle, rollQuality, setShowcaseSlot, showcaseFigure, spare, subscribeCollection, trayGroups, type FigurineMachine, type FigurineQuality, type MachineItem, type MachineOutcome } from "@/lib/figurine-collection";
import { ALL_QUIPS, FIGURINE_SERIES, RELEASED_SERIES, UPCOMING_SERIES, SECRET_SERIES, figureKey, figureQuip, findFigure, type FigurineCharacter } from "@/lib/figurine-series";
import type { StageMachine, StageWorld, WorldView } from "@/app/tools/figurine-lab/FigurineStage";
import type { MachinePick } from "@/lib/figurine-machine";
import { isStation, type Station } from "@/lib/figurine-world";
import WorldPanel, { type PanelResult, type PanelSeries } from "./WorldPanels";
import type { FacilityAction } from "@/lib/figurine-facilities";
import panelStyles from "./world-panels.module.css";
import styles from "@/app/tools/figurine-lab/figurine-lab.module.css";
import SoundMenu from "./SoundMenu";

const FigurineStage = dynamic(() => import("@/app/tools/figurine-lab/FigurineStage"), { ssr: false });
const pad = (number: number) => String(number).padStart(3, "0");
// Where "back" leads: stations return to the centre (to whichever of its views they were left from).
const parentOf = (view: WorldView): WorldView | null => view === "opening" ? null : "opening";
const atCentre = (view: WorldView) => view === "opening" || view === "viewer";
// Keys for the daily stations, beside S, C, M and U.
const STATION_KEYS: Record<string, Station> = { q: "quests", w: "wheel", f: "pond", d: "crate" };

const isMachine = (view: WorldView): view is FigurineMachine => view === "recycler" || view === "forge";
// Every series in shop order: released ones first, then the announced ones.
const ALL_SERIES = [...FIGURINE_SERIES.map((entry) => entry.id), ...UPCOMING_SERIES.map((entry) => entry.id)];
const CATALOG_ORDER = RELEASED_SERIES.flatMap((entry) => entry.characters.map((character) => figureKey(entry.id, character.id)));
const seriesNumber = (id: string) => [...FIGURINE_SERIES, ...UPCOMING_SERIES, SECRET_SERIES].find((entry) => entry.id === id)?.number ?? 0;

export default function FigurineWorld() {
  const t = useTranslations("figurineLab");
  const nav = useTranslations("ccg.nav");
  const [view, setView] = useState<WorldView>("opening");
  const [seriesId, setSeriesId] = useState(FIGURINE_SERIES[0].id);
  const [state, dispatch] = useReducer(boxReducer, initialBox);
  const [files, setFiles] = useState<File[]>([]);
  // Which figure `files` holds (its model URL), so the stage never shows one figure in another's place.
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{ key: string; quality: FigurineQuality } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ key: string; count: number; quality: FigurineQuality } | null>(null);
  const [upgraded, setUpgraded] = useState<{ key: string; quality: FigurineQuality } | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  // Stations remember which centre view they were entered from.
  const [origin, setOrigin] = useState<Partial<Record<WorldView, WorldView>>>({});
  const collection = useSyncExternalStore(subscribeCollection, readCollection, emptyCollection);
  const records = useSyncExternalStore(subscribeCollection, readRecords, emptyRecords);
  // The opening shot plays to its end before the keyboard can move the camera.
  const [introDone, setIntroDone] = useState(false);
  // Stations carry no signs: the one under the pointer is named in the HUD.
  const [pointed, setPointed] = useState<Station | null>(null);
  // The clock the daily things go by, ticking each minute so a new day shows without a reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer); }, []);
  const stationName = (station: Station) => station === "shop" ? t("navShop") : station === "recycler" ? t("stationRecycler") : station === "forge" ? t("stationForge") : t(`world.stations.${station}`);
  const action = useRef<HTMLButtonElement>(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  // An announced series' box can be picked and shaken but never opened: it has no figures yet.
  const series = RELEASED_SERIES.find((entry) => entry.id === seriesId) ?? null;
  // The figure inside each sealed box (and its finish) is drawn as the box arrives and preloaded
  // while it waits, so opening never stalls on a download or parse.
  const [draw, setDraw] = useState<{ series: string; round: number; index: number; quality: FigurineQuality } | null>(null);
  useEffect(() => {
    const drawing = RELEASED_SERIES.find((entry) => entry.id === seriesId);
    if (state.phase === "sealed" && drawing) setDraw((current) => current?.series === seriesId && current.round === state.round ? current : { series: seriesId, round: state.round, index: chooseFigure(drawing.characters.length, Math.random()), quality: boostedQuality(rollQuality(Math.random()), readRecords().boons.boost) });
  }, [seriesId, state.round, state.phase]);
  const currentDraw = series && draw?.series === seriesId && draw.round === state.round ? draw : null;
  const sealedDraw = currentDraw?.index ?? null;
  const drawn = series && state.selected !== null ? series.characters[state.selected] : null;
  const viewing = inspected ? findFigure(inspected.key) : null;
  // The stage loads whichever figure the current view shows: the inspected one, or the box's.
  const wanted: FigurineCharacter | null = view === "viewer" ? viewing?.character ?? null : drawn ?? (series && sealedDraw !== null ? series.characters[sealedDraw] : null);
  const quality: FigurineQuality = view === "viewer" ? inspected?.quality ?? "standard" : currentDraw?.quality ?? "standard";
  const [model, setModel] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [refetch, setRefetch] = useState(0);
  // Download the finite catalog once. Keep compressed files, rather than all decoded GPU textures.
  const fetched = useRef<ReturnType<typeof createFigurineFileCache> | null>(null);
  const [fileProgress, setFileProgress] = useState(0);
  useEffect(() => {
    const cache = createFigurineFileCache(); fetched.current = cache;
    const characters = RELEASED_SERIES.flatMap((entry) => entry.characters);
    let next = 0, completed = 0, cancelled = false;
    const worker = async () => {
      while (!cancelled && next < characters.length) {
        const character = characters[next++];
        try { await cache.get(character.model, character.bytes); } catch { /* Selection retries failed downloads. */ }
        if (!cancelled) setFileProgress(++completed / characters.length);
      }
    };
    void Promise.all(Array.from({ length: 4 }, worker));
    return () => { cancelled = true; cache.dispose(); if (fetched.current === cache) fetched.current = null; };
  }, []);
  useEffect(() => {
    if (!wanted) { setFiles([]); setFilesFor(null); setModel("idle"); return; }
    let cancelled = false;
    setModel("loading");
    const fail = () => { setModel("failed"); if (viewRef.current !== "viewer") dispatch({ type: "failed" }); };
    void (async () => {
      try {
        const file = await fetched.current!.get(wanted.model, wanted.bytes);
        if (cancelled) return;
        setFiles([file]); setFilesFor(wanted.model);
      } catch { if (!cancelled) fail(); }
    })();
    return () => { cancelled = true; };
  }, [wanted, state.round, refetch]);

  // Start-up loading: scenery, box prints, portraits, sounds, all compressed figures, and the first prepared figure.
  const [stageProgress, setStageProgress] = useState(0), [stageLoaded, setStageLoaded] = useState(false), [audioProgress, setAudioProgress] = useState(0);
  useEffect(() => { void prefetchFigurineAudio([...new Set(FIGURINE_SERIES.flatMap((entry) => entry.characters.map((character) => character.classKey)))], ALL_QUIPS.map(({ file }) => file), setAudioProgress).then(() => setAudioProgress(1)); }, []);
  const figureSettled = model === "ready" || model === "failed" || (sealedDraw === null && view !== "viewer");
  const loaded = stageLoaded && audioProgress >= 1 && fileProgress >= 1 && figureSettled;
  const [revealedWorld, setRevealedWorld] = useState(false);
  useEffect(() => { if (loaded || webglUnavailable) setRevealedWorld(true); }, [loaded, webglUnavailable]);
  const progress = Math.round(100 * (0.4 * stageProgress + 0.25 * audioProgress + 0.2 * fileProgress + 0.15 * (figureSettled ? 1 : 0)));
  // Each series pick drops its box onto the pedestal again.
  const [arrival, setArrival] = useState(0);

  const navigate = useCallback((next: WorldView) => {
    unlockFigurineAudio();
    // Leaving a finished opening clears the pedestal for the next box.
    if (next !== "opening" && (state.phase === "revealed" || state.phase === "error")) { setOpened(null); dispatch({ type: "reset" }); }
    if (next !== "viewer") { setInspected(null); setUpgraded(null); }
    setHovered(null);
    if (isStation(next) && atCentre(view)) setOrigin((current) => ({ ...current, [next]: view }));
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
    if (!series) return;
    unlockFigurineAudio();
    const selected = sealedDraw ?? chooseFigure(series.characters.length, Math.random());
    preloadFigurineSignature(series.characters[selected].classKey, figureQuip(figureKey(series.id, series.characters[selected].id))?.file);
    if (model === "failed") setRefetch((current) => current + 1);
    dispatch({ type: "open", selected, ready: sealedDraw !== null && model === "ready" && filesFor === wanted?.model });
  }
  function revealed() {
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
    if (state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); }
    setInspected({ key, quality: finish ?? bestQuality(collection[key]) ?? "standard" }); setUpgraded(null); setView("viewer");
  }

  // Two machines take three figures each. The recycler grinds any three spare copies into a box of
  // the series most of them came from; the forge trades three of a kind up a quality.
  const [slots, setSlots] = useState<Record<FigurineMachine, MachineItem[]>>({ recycler: [], forge: [] });
  type MachineRun = { run: number; output: StageMachine["output"]; outcome: MachineOutcome | null };
  const [machineRuns, setMachineRuns] = useState<Record<FigurineMachine, MachineRun>>({ recycler: { run: 0, output: null, outcome: null }, forge: { run: 0, output: null, outcome: null } });
  const outcomes = useMemo(() => ({ recycler: machineOutcome("recycler", slots.recycler, collection), forge: machineOutcome("forge", slots.forge, collection) }), [slots, collection]);
  const nameOf = useCallback((key: string) => findFigure(key)?.character.name ?? key, []);

  // The daily stations. Each action plays in the world first (the crate bursts, the wheel spins, the
  // line is cast); what it brought shows, and a prize figure joins the collection, once it has.
  const [facilityAction, setFacilityAction] = useState<{ run: number; station: "crate" | "wheel" | "pond"; action: FacilityAction } | null>(null);
  const [pending, setPending] = useState<{ run: number; result: PanelResult; source?: PullSource } | null>(null);
  const [result, setResult] = useState<PanelResult | null>(null);
  const busy = !!pending;
  // A prize figure: any figure of a released series, at a rolled quality.
  const prizeFigure = (): MachineItem => {
    const drawn = FIGURINE_SERIES[Math.floor(Math.random() * FIGURINE_SERIES.length)], character = drawn.characters[chooseFigure(drawn.characters.length, Math.random())];
    return { key: figureKey(drawn.id, character.id), quality: rollQuality(Math.random()) };
  };
  const act = (station: "crate" | "wheel" | "pond", next: FacilityAction, outcome: PanelResult, source?: PullSource) => {
    unlockFigurineAudio();
    const run = (facilityAction?.run ?? 0) + 1;
    setFacilityAction({ run, station, action: next }); setPending({ run, result: outcome, source }); setResult(null);
  };
  function actionDone(run: number) {
    if (!pending || pending.run !== run) return;
    const outcome = pending.result, figure = "figure" in outcome ? outcome.figure : undefined;
    const reward = outcome.station === "pond" ? (outcome.caught.kind === "daily" ? outcome.caught.reward : null) : outcome.reward;
    if (reward) grantReward(reward);
    if (figure && pending.source) { addToCollection(figure.key, figure.quality); recordPull(figure, pending.source); }
    setResult(pending.result); setPending(null);
  }
  const crate = crateState(records, now);
  const streak = useMemo(() => ({ opened: crate.ready ? crate.day - 1 : crate.day, today: crate.ready ? crate.day : null }), [crate.ready, crate.day]);
  const completeSeries = FIGURINE_SERIES.some((entry) => entry.characters.every((character) => collection[figureKey(entry.id, character.id)]));
  const panelActions = {
    busy, result, now,
    onCrate: () => { const opened = openCrate(now); if (opened) act("crate", { kind: "open" }, { station: "crate", ...opened }); },
    onSpin: () => {
      const spun = spinWheel(Math.random(), now);
      if (spun) act("wheel", { kind: "spin", segment: spun.segment }, { station: "wheel", reward: spun.reward, figure: spun.reward.figure ? prizeFigure() : undefined }, "wheel");
    },
    onCast: () => {
      const caught = castLine(Math.random, now);
      act("pond", { kind: "cast" }, { station: "pond", caught, figure: caught.kind === "daily" ? prizeFigure() : undefined }, "pond");
    },
    onClaim: (id: string) => { unlockFigurineAudio(); claimQuest(id, completeSeries, now); },
  };
  // Quests count from the start of the session, and each new day, week or month from its turn.
  useEffect(() => { startQuestPeriods(now); }, [now]);
  const loadSlots = (kind: FigurineMachine, next: MachineItem[]) => setSlots((current) => ({ ...current, [kind]: next }));
  // A card chosen in the picker. The forge works on three of one kind, so it places all three at once.
  function pickCard(kind: FigurineMachine, item: MachineItem) {
    unlockFigurineAudio();
    const loaded = slots[kind];
    if (kind === "forge") { if (spare(collection, [], item) >= MACHINE_SLOTS) loadSlots(kind, Array.from({ length: MACHINE_SLOTS }, () => item)); }
    else if (loaded.length < MACHINE_SLOTS && spare(collection, loaded, item) > 0) loadSlots(kind, [...loaded, item]);
  }
  function operateMachine(kind: FigurineMachine, pick: MachinePick) {
    unlockFigurineAudio();
    const loaded = slots[kind], outcome = outcomes[kind], load = (next: MachineItem[]) => loadSlots(kind, next);
    if (pick.kind === "slot") load(kind === "forge" ? [] : loaded.filter((_, index) => index !== pick.index));
    else if ((outcome.kind === "box" || outcome.kind === "upgrade") && changeCollection(machineChanges(loaded, outcome))) {
      if (outcome.kind === "upgrade") recordPull({ key: outcome.key, quality: outcome.quality }, "forge"); else recordRecycle();
      setMachineRuns((current) => ({ ...current, [kind]: {
        run: current[kind].run + 1, outcome,
        output: outcome.kind === "box" ? { kind: "box", series: outcome.series } : { kind: "figure", key: outcome.key, quality: outcome.quality, name: nameOf(outcome.key) },
      } }));
      load([]);
    }
  }
  function machineDone(kind: FigurineMachine) {
    const made = machineRuns[kind].outcome;
    if (viewRef.current !== kind || !made) return;
    if (made.kind === "box") pickSeries(made.series);
    else if (made.kind === "upgrade") { inspect(made.key, made.quality); setUpgraded({ key: made.key, quality: made.quality }); }
  }
  const qualityName = (finish: FigurineQuality) => t(`quality.${finish}`);
  const machines: Record<FigurineMachine, StageMachine> = useMemo(() => {
    const view = (kind: FigurineMachine): StageMachine => {
      const outcome = outcomes[kind], loaded = slots[kind];
      const display = outcome.kind === "box" ? { title: t("machineBox"), detail: t("seriesName", { number: pad(seriesNumber(outcome.series)) }) }
        : outcome.kind === "upgrade" ? { title: t("machineUpgrade"), detail: `${nameOf(outcome.key)} → ${t(`quality.${outcome.quality}`)}` }
        : outcome.kind === "keep" ? { title: t("machineKeep"), detail: nameOf(outcome.key) }
        : outcome.kind === "mismatch" ? { title: t("forgeMismatch"), detail: "" }
        : { title: t(kind === "forge" ? "forgeLoad" : "machineLoad"), detail: `${loaded.length} / ${MACHINE_SLOTS}` };
      return {
        ...display, ready: outcome.kind === "box" || outcome.kind === "upgrade", run: machineRuns[kind].run, output: machineRuns[kind].output,
        accent: outcome.kind === "upgrade" ? outcome.quality : undefined,
        slots: loaded.map((slot) => ({ ...slot, name: nameOf(slot.key) })),
      };
    };
    return { recycler: view("recycler"), forge: view("forge") };
  }, [slots, outcomes, machineRuns, nameOf, t]);

  // Navigation is in the world; the keyboard mirrors it: Esc back, S shop, C collection, M recycler, U forge,
  // number keys pick a series, Enter opens the sealed box.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (event) => {
      if (!revealedWorld || !introDone || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (key === "escape" || key === "backspace") back();
      else if (atCentre(view) && key === "s") navigate("shop");
      else if (atCentre(view) && key === "c") navigate("gallery");
      else if (atCentre(view) && key === "m") navigate("recycler");
      else if (atCentre(view) && key === "u") navigate("forge");
      else if (atCentre(view) && STATION_KEYS[key]) navigate(STATION_KEYS[key]);
      else if (view === "shop" && /^[1-9]$/.test(key) && ALL_SERIES[Number(key) - 1]) pickSeries(ALL_SERIES[Number(key) - 1]);
      else if (view === "opening" && state.phase === "sealed" && series && !webglUnavailable && (key === "enter" || key === " ") && !(event.target instanceof Element && event.target.closest("button, a"))) { event.preventDefault(); open(); }
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
    showcase: records.showcase.map((entry) => showcaseFigure(entry, collection)),
    streak,
  }), [collection, records.showcase, streak, t]);
  // The collection lists released series, a secret one once found, then the announced ones.
  const panelSeries: PanelSeries[] = useMemo(() => [...collectionShelves(world.series, collection).filter((entry) => entry.released), ...world.series.filter((entry) => !entry.hidden && !entry.released)]
    .map(({ id, number, released, hidden, keys }) => ({ id, number, released, hidden, keys })), [world.series, collection]);
  const machineKind = isMachine(view) ? view : null;
  const machinePanel = machineKind ? {
    kind: machineKind, slots: slots[machineKind],
    groups: trayGroups(collection, CATALOG_ORDER, machineKind).map((group) => ({ key: group.key, quality: group.quality, spare: machineKind === "forge" ? group.count : spare(collection, slots[machineKind], group) })),
    onPick: (item: MachineItem) => pickCard(machineKind, item), onClear: () => loadSlots(machineKind, []),
  } : undefined;
  const boxCount = series?.characters.length ?? 16;
  const packaging = useMemo(() => ({ blind: t("boxBlind"), collect: t("boxCollect", { count: boxCount }), contents: t("boxContents"), openHere: t("boxOpenHere") }), [t, boxCount]);
  const label = (figure: FigurineCharacter) => `${figure.realm} · ${t(`races.${figure.raceKey}`)} · ${t(`classes.${figure.classKey}`)}`;
  const hoveredFigure = hovered ? findFigure(hovered) : null;
  const qualityBadge = (finish: FigurineQuality) => finish !== "standard" && <span className={styles.qualityBadge} data-quality={finish}>{qualityName(finish)}</span>;

  return <main className={styles.showcase} data-phase={state.phase} data-view={view}>
    <Link href="/" className={styles.worldHomeLink} aria-label={nav("backToMain")}>
      <Image src="/logo.png" alt="SuomiWoW" width={112} height={51} priority />
    </Link>
    <SoundMenu />
    <FigurineStage immersive files={files} filesFor={filesFor} showing={wanted?.model ?? null} boxMode open={view !== "viewer" && (state.phase === "opening" || state.phase === "revealed")} charging={state.phase === "loading"}
      interactive={revealedWorld && view === "opening" && state.phase === "sealed" && !webglUnavailable} locked={!series} round={state.round} onBoxTap={open} rotate={view === "viewer" || view === "opening"} ready={revealedWorld}
      view={view} series={seriesId} world={world} figureKey={drawn && series ? figureKey(series.id, drawn.id) : undefined} quality={quality}
      machines={machines} onMachine={operateMachine} onMachineDone={machineDone} onIntroDone={() => setIntroDone(true)} onHoverStation={setPointed} action={facilityAction} onActionDone={actionDone}
      onNavigate={navigate} onBack={back} onPickSeries={pickSeries} onInspect={(key) => inspect(key)} onHoverFigure={setHovered}
      onStatus={(status) => {
        setWebglUnavailable(status === "webgl");
        if (status === "loading") setModel("loading");
        else if (status === "ready") { setModel("ready"); dispatch({ type: "loaded" }); }
        else if (status === "error" || status === "webgl") { setModel("failed"); if (view !== "viewer") dispatch({ type: "failed" }); }
      }}
      onProgress={setStageProgress} onLoaded={() => setStageLoaded(true)} arrival={arrival}
      onRevealed={revealed} signature={drawn?.classKey} quip={drawn && series ? figureQuip(figureKey(series.id, drawn.id)) : undefined}
      labels={{ loading: t("modelLoading"), ready: t("modelReady"), empty: t("modelEmpty"), error: t("modelError"), webgl: t("webglError"), box: t("boxStatus"), boxTitle: t("boxTitle"), boxSubtitle: t("boxSubtitle"), series: t("navCollection"), packaging }} />
    {(records.boons.boxes > 0 || records.boons.boost) && revealedWorld && <p className={panelStyles.hudBoons}>
      {records.boons.boxes > 0 && <span>{t("world.rewards.banked", { count: records.boons.boxes })}</span>}
      {records.boons.boost && <span data-quality={records.boons.boost}>{t("world.rewards.boostNext", { quality: t(`quality.${records.boons.boost}`) })}</span>}
    </p>}
    {isStation(view) && view !== "shop" && <WorldPanel view={view} collection={collection} records={records} series={panelSeries} onClose={back} actions={panelActions}
      onInspect={(key, finish) => inspect(key, finish)} onShowcase={(slot, item) => setShowcaseSlot(slot, item)} machine={machinePanel} />}
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
          : pointed && pointed !== view && !(view === "opening" && state.phase !== "sealed") ? <p className={styles.worldHint}>{stationName(pointed)}</p>
          : view === "viewer" && viewing && inspected ? <>
            {upgraded && <span className={styles.newBadge}>{t("tradedUp")}</span>}
            {qualityBadge(inspected.quality)}
            <h1>{viewing.character.name}</h1><p>{label(viewing.character)}</p><p className={styles.showcaseHint}>{t("inspectFigure")}</p>
          </> : (view === "gallery" || (view === "opening" && state.phase === "sealed")) && hoveredFigure ? <p className={styles.worldHint}>{collection[hovered!] ? hoveredFigure.character.name : t("notCollected")}</p>
          : !atCentre(view) ? null
          : <span className={styles.srOnly}>{t(state.phase === "loading" ? "drawLoading" : state.phase === "opening" ? "drawOpening" : "mysteryTitle")}</span>}
      </div>
      {view === "opening" && state.phase === "sealed" && <p className={styles.worldHint}>{series ? t("pullToOpen") : `${t("seriesName", { number: pad(seriesNumber(seriesId)) })} · ${t("comingSoon")}`}</p>}
      {view === "opening" && state.phase === "error" && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} onClick={() => { unlockFigurineAudio(); setFiles([]); dispatch({ type: "retry" }); }}>{t("retryBox")}</button>
      </div>}
      {view === "shop" && <p className={styles.showcaseHint}>{t("tapAwayHint")}</p>}
      {view === "viewer" && (!files.length || filesFor !== wanted?.model) && <p className={styles.showcaseHint}>{t("worldLoading")}</p>}
    </div>
  </main>;
}
