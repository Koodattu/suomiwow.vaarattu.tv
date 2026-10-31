"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { boxReducer, chooseFigure, initialBox } from "@/lib/figurine-box";
import { createFigurineFileCache } from "@/lib/figurine-cache";
import { prefetchFigurineAudio, preloadFigurineSignature, unlockFigurineAudio } from "@/lib/figurine-audio";
import { MACHINE_SLOTS, addToCollection, bestQuality, changeCollection, copiesOf, emptyCollection, machineChanges, machineOutcome, readCollection, rollQuality, spare, subscribeCollection, trayGroups, type FigurineQuality, type MachineItem, type MachineOutcome } from "@/lib/figurine-collection";
import { ALL_QUIPS, FIGURINE_SERIES, RELEASED_SERIES, UPCOMING_SERIES, SECRET_SERIES, figureKey, figureQuip, findFigure, type FigurineCharacter } from "@/lib/figurine-series";
import type { Outpost, StageMachine, StageWorld, WorldView } from "@/app/tools/figurine-lab/FigurineStage";
import type { MachinePick } from "@/lib/figurine-machine";
import styles from "@/app/tools/figurine-lab/figurine-lab.module.css";
import SoundMenu from "./SoundMenu";

const FigurineStage = dynamic(() => import("@/app/tools/figurine-lab/FigurineStage"), { ssr: false });
const pad = (number: number) => String(number).padStart(3, "0");
// Where "back" leads: stations return to the centre (to whichever of its views they were left from).
const PARENT: Record<WorldView, WorldView | null> = { shop: "opening", gallery: "opening", machine: "opening", opening: null, viewer: "opening" };
const atCentre = (view: WorldView) => view === "opening" || view === "viewer";
const STATION_VIEWS: WorldView[] = ["shop", "gallery", "machine"];
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
    if (state.phase === "sealed" && drawing) setDraw((current) => current?.series === seriesId && current.round === state.round ? current : { series: seriesId, round: state.round, index: chooseFigure(drawing.characters.length, Math.random()), quality: rollQuality(Math.random()) });
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
  // A tapped station that is not open yet says so for a moment.
  const [soon, setSoon] = useState<Outpost | null>(null);
  useEffect(() => { if (!soon) return; const timer = window.setTimeout(() => setSoon(null), 2400); return () => window.clearTimeout(timer); }, [soon]);

  const navigate = useCallback((next: WorldView) => {
    unlockFigurineAudio();
    // Leaving a finished opening clears the pedestal for the next box.
    if (next !== "opening" && (state.phase === "revealed" || state.phase === "error")) { setOpened(null); dispatch({ type: "reset" }); }
    if (next !== "viewer") { setInspected(null); setUpgraded(null); }
    setHovered(null); setSoon(null);
    if (STATION_VIEWS.includes(next) && atCentre(view)) setOrigin((current) => ({ ...current, [next]: view }));
    setView(next);
  }, [state.phase, view]);
  const back = useCallback(() => { const parent = origin[view] ?? PARENT[view]; if (parent && state.phase !== "loading" && state.phase !== "opening") navigate(parent); }, [view, state.phase, navigate, origin]);
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
      addToCollection(key, finish);
      setOpened({ key, count: copiesOf(readCollection()[key]), quality: finish });
    }
  }
  function inspect(key: string, finish?: FigurineQuality) {
    if (state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); }
    setInspected({ key, quality: finish ?? bestQuality(collection[key]) ?? "standard" }); setUpgraded(null); setView("viewer");
  }

  // The recycler: load three copies from the board, pull the lever, and the machine makes a box
  // of the series most of them came from, or trades three of a kind up a quality.
  const [slots, setSlots] = useState<MachineItem[]>([]);
  const [machineRun, setMachineRun] = useState<{ run: number; output: StageMachine["output"]; outcome: MachineOutcome | null }>({ run: 0, output: null, outcome: null });
  const outcome = useMemo(() => machineOutcome(slots, collection), [slots, collection]);
  const nameOf = useCallback((key: string) => findFigure(key)?.character.name ?? key, []);
  function operateMachine(pick: MachinePick) {
    unlockFigurineAudio();
    if (pick.kind === "tray") {
      if (slots.length < MACHINE_SLOTS && spare(collection, slots, pick) > 0) setSlots([...slots, { key: pick.key, quality: pick.quality }]);
    } else if (pick.kind === "slot") setSlots(slots.filter((_, index) => index !== pick.index));
    else if ((outcome.kind === "box" || outcome.kind === "upgrade") && changeCollection(machineChanges(slots, outcome))) {
      setMachineRun({
        run: machineRun.run + 1, outcome,
        output: outcome.kind === "box" ? { kind: "box", series: outcome.series } : { kind: "figure", key: outcome.key, quality: outcome.quality, name: nameOf(outcome.key) },
      });
      setSlots([]);
    }
  }
  function machineDone() {
    const made = machineRun.outcome;
    if (viewRef.current !== "machine" || !made) return;
    if (made.kind === "box") pickSeries(made.series);
    else if (made.kind === "upgrade") { inspect(made.key, made.quality); setUpgraded({ key: made.key, quality: made.quality }); }
  }
  const qualityName = (finish: FigurineQuality) => t(`quality.${finish}`);
  const machine: StageMachine = useMemo(() => {
    const display = outcome.kind === "box" ? { title: t("machineBox"), detail: t("seriesName", { number: pad(seriesNumber(outcome.series)) }) }
      : outcome.kind === "upgrade" ? { title: t("machineUpgrade"), detail: `${nameOf(outcome.key)} → ${t(`quality.${outcome.quality}`)}` }
      : outcome.kind === "keep" ? { title: t("machineKeep"), detail: nameOf(outcome.key) }
      : { title: t("machineLoad"), detail: `${slots.length} / ${MACHINE_SLOTS}` };
    return {
      ...display, ready: outcome.kind === "box" || outcome.kind === "upgrade", run: machineRun.run, output: machineRun.output,
      tray: trayGroups(collection, CATALOG_ORDER).map((group) => ({ key: group.key, quality: group.quality, name: nameOf(group.key), spare: spare(collection, slots, group) })),
      slots: slots.map((slot) => ({ ...slot, name: nameOf(slot.key) })),
    };
  }, [collection, slots, outcome, machineRun, nameOf, t]);

  // Navigation is in the world; the keyboard mirrors it: Esc back, S shop, C collection, M recycler,
  // number keys pick a series, Enter opens the sealed box.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (event) => {
      if (!revealedWorld || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (key === "escape" || key === "backspace") back();
      else if (atCentre(view) && key === "s") navigate("shop");
      else if (atCentre(view) && key === "c") navigate("gallery");
      else if (atCentre(view) && key === "m") navigate("machine");
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
      trading: t("stationTrading"), fame: t("stationFame"),
    },
  }), [collection, t]);
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
      machine={machine} onMachine={operateMachine} onMachineDone={machineDone} onComingSoon={setSoon}
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
    <div className={styles.worldLoader} data-done={revealedWorld} role="status" aria-hidden={revealedWorld}>
      <span>{t("worldPreparing")}</span>
      <div className={styles.worldLoaderBar}><i style={{ width: `${progress}%` }} /></div>
    </div>
    <div className={styles.showcaseHud}>
      <div className={styles.revealIdentity} aria-live="polite" aria-atomic="true">
        {soon ? <p className={styles.worldHint}>{t(soon === "trading" ? "stationTrading" : "stationFame")} · {t("comingSoon")}</p>
          : view === "opening" && state.phase === "revealed" && drawn ? <>
            {opened && <span className={styles.newBadge}>{opened.count === 1 ? t("newFigure") : t("duplicateFigure", { count: opened.count })}</span>}
            {opened && qualityBadge(opened.quality)}
            <h1>{drawn.name}</h1><p>{label(drawn)}</p>
          </> : view === "opening" && state.phase === "error" ? <><h1>{t("drawErrorTitle")}</h1><p>{t(webglUnavailable ? "webglError" : "drawError")}</p></>
          : view === "viewer" && viewing && inspected ? <>
            {upgraded && <span className={styles.newBadge}>{t("tradedUp")}</span>}
            {qualityBadge(inspected.quality)}
            <h1>{viewing.character.name}</h1><p>{label(viewing.character)}</p><p className={styles.showcaseHint}>{t("inspectFigure")}</p>
          </> : (view === "gallery" || (view === "opening" && state.phase === "sealed")) && hoveredFigure ? <p className={styles.worldHint}>{collection[hovered!] ? hoveredFigure.character.name : t("notCollected")}</p>
          : view === "gallery" || view === "shop" || view === "machine" ? null
          : <span className={styles.srOnly}>{t(state.phase === "loading" ? "drawLoading" : state.phase === "opening" ? "drawOpening" : "mysteryTitle")}</span>}
      </div>
      {view === "opening" && state.phase === "sealed" && <p className={styles.worldHint}>{series ? t("pullToOpen") : `${t("seriesName", { number: pad(seriesNumber(seriesId)) })} · ${t("comingSoon")}`}</p>}
      {view === "opening" && state.phase === "error" && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} onClick={() => { unlockFigurineAudio(); setFiles([]); dispatch({ type: "retry" }); }}>{t("retryBox")}</button>
      </div>}
      {view === "machine" && <p className={styles.showcaseHint}>{machine.tray.length ? t("machineHint") : t("machineEmpty")}</p>}
      {(view === "shop" || view === "gallery" || view === "machine") && <p className={styles.showcaseHint}>{t("tapAwayHint")}</p>}
      {view === "viewer" && (!files.length || filesFor !== wanted?.model) && <p className={styles.showcaseHint}>{t("worldLoading")}</p>}
    </div>
  </main>;
}
