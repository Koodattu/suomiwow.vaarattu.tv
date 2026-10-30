"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { boxReducer, chooseFigure, initialBox } from "@/lib/figurine-box";
import { getFigurineAudioMuted, prefetchFigurineAudio, preloadFigurineSignature, setFigurineAudioMuted, unlockFigurineAudio } from "@/lib/figurine-audio";
import { addToCollection, emptyCollection, readCollection, subscribeCollection } from "@/lib/figurine-collection";
import { ALL_QUIPS, FIGURINE_SERIES, figureKey, figureQuip, findFigure, findSeries, type FigurineCharacter } from "@/lib/figurine-series";
import type { StageWorld, WorldView } from "../figurine-lab/FigurineStage";
import styles from "../figurine-lab/figurine-lab.module.css";

const FigurineStage = dynamic(() => import("../figurine-lab/FigurineStage"), { ssr: false });
const pad = (number: number) => String(number).padStart(3, "0");
// Where "back" leads: stations return to the centre (to whichever of its views they were left from).
const PARENT: Record<WorldView, WorldView | null> = { shop: "opening", gallery: "opening", opening: null, viewer: "opening" };
const atCentre = (view: WorldView) => view === "opening" || view === "viewer";

export default function FigurineWorld() {
  const t = useTranslations("figurineLab");
  const [view, setView] = useState<WorldView>("opening");
  const [seriesId, setSeriesId] = useState(FIGURINE_SERIES[0].id);
  const [state, dispatch] = useReducer(boxReducer, initialBox);
  const [files, setFiles] = useState<File[]>([]);
  // Which figure `files` holds (its model URL), so the stage never shows one figure in another's place.
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ key: string; count: number } | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  // Stations remember which centre view they were entered from.
  const [origin, setOrigin] = useState<Partial<Record<WorldView, WorldView>>>({});
  const [muted, setMuted] = useState(false);
  useEffect(() => { setMuted(getFigurineAudioMuted()); }, []);
  const collection = useSyncExternalStore(subscribeCollection, readCollection, emptyCollection);
  const action = useRef<HTMLButtonElement>(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const series = findSeries(seriesId);
  // The figure inside each sealed box is drawn as the box arrives and preloaded while it waits,
  // so opening never stalls on a download or parse.
  const [draw, setDraw] = useState<{ series: string; round: number; index: number } | null>(null);
  useEffect(() => {
    if (state.phase === "sealed") setDraw((current) => current?.series === seriesId && current.round === state.round ? current : { series: seriesId, round: state.round, index: chooseFigure(findSeries(seriesId).characters.length, Math.random()) });
  }, [seriesId, state.round, state.phase]);
  const sealedDraw = draw?.series === seriesId && draw.round === state.round ? draw.index : null;
  const drawn = state.selected === null ? null : series.characters[state.selected];
  const viewing = inspected ? findFigure(inspected) : null;
  // The stage loads whichever figure the current view shows: the inspected one, or the box's.
  const wanted: FigurineCharacter | null = view === "viewer" ? viewing?.character ?? null : drawn ?? (sealedDraw === null ? null : series.characters[sealedDraw]);
  const [model, setModel] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [refetch, setRefetch] = useState(0);
  // Recently fetched figure files, so stepping into the viewer and back does not download again.
  const fetched = useRef(new Map<string, File>());
  useEffect(() => {
    if (!wanted) { setFiles([]); setFilesFor(null); setModel("idle"); return; }
    const remembered = fetched.current.get(wanted.model);
    if (remembered) { setFiles([remembered]); setFilesFor(wanted.model); setModel("loading"); return; }
    const controller = new AbortController();
    setModel("loading");
    const fail = () => { setModel("failed"); if (viewRef.current !== "viewer") dispatch({ type: "failed" }); };
    const timeout = window.setTimeout(() => { fail(); controller.abort(); }, 30_000);
    void (async () => {
      try {
        const response = await fetch(wanted.model, { signal: controller.signal });
        if (!response.ok) throw new Error("Model unavailable");
        const blob = await response.blob();
        if (blob.size !== wanted.bytes) throw new Error("Incomplete model");
        if (controller.signal.aborted) return;
        const file = new File([blob], "collectible.glb");
        fetched.current.set(wanted.model, file);
        if (fetched.current.size > 6) fetched.current.delete(fetched.current.keys().next().value!);
        setFiles([file]); setFilesFor(wanted.model);
      } catch { if (!controller.signal.aborted) fail(); }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [wanted, state.round, refetch]);

  // Start-up loading: the stage's scenery, boxes, portraits and shaders, every sound, and the first box's figure.
  const [stageProgress, setStageProgress] = useState(0), [stageLoaded, setStageLoaded] = useState(false), [audioProgress, setAudioProgress] = useState(0);
  useEffect(() => { void prefetchFigurineAudio([...new Set(FIGURINE_SERIES.flatMap((entry) => entry.characters.map((character) => character.classKey)))], ALL_QUIPS.map(({ file }) => file), setAudioProgress).then(() => setAudioProgress(1)); }, []);
  const figureSettled = model === "ready" || model === "failed" || (sealedDraw === null && view !== "viewer");
  const loaded = stageLoaded && audioProgress >= 1 && figureSettled;
  const [revealedWorld, setRevealedWorld] = useState(false);
  useEffect(() => { if (loaded || webglUnavailable) setRevealedWorld(true); }, [loaded, webglUnavailable]);
  const progress = Math.round(100 * (0.6 * stageProgress + 0.25 * audioProgress + 0.15 * (figureSettled ? 1 : 0)));
  // Each series pick drops its box onto the pedestal again.
  const [arrival, setArrival] = useState(0);

  const navigate = useCallback((next: WorldView) => {
    unlockFigurineAudio();
    // Leaving a finished opening clears the pedestal for the next box.
    if (next !== "opening" && (state.phase === "revealed" || state.phase === "error")) { setOpened(null); dispatch({ type: "reset" }); }
    if (next !== "viewer") setInspected(null);
    setHovered(null);
    if ((next === "shop" || next === "gallery") && atCentre(view)) setOrigin((current) => ({ ...current, [next]: view }));
    setView(next);
  }, [state.phase, view]);
  const back = useCallback(() => { const parent = origin[view] ?? PARENT[view]; if (parent && state.phase !== "loading" && state.phase !== "opening") navigate(parent); }, [view, state.phase, navigate, origin]);
  useEffect(() => { action.current?.focus({ preventScroll: true }); }, [view, state.phase, state.round]);

  function pickSeries(id: string) {
    unlockFigurineAudio();
    if (id !== seriesId || state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); }
    setSeriesId(id); setView("opening"); setArrival((current) => current + 1);
  }
  function open() {
    unlockFigurineAudio();
    const selected = sealedDraw ?? chooseFigure(series.characters.length, Math.random());
    preloadFigurineSignature(series.characters[selected].classKey, figureQuip(figureKey(series.id, series.characters[selected].id))?.file);
    if (model === "failed") setRefetch((current) => current + 1);
    dispatch({ type: "open", selected, ready: sealedDraw !== null && model === "ready" });
  }
  function revealed() {
    dispatch({ type: "revealed" });
    if (drawn) { const key = figureKey(series.id, drawn.id); setOpened({ key, count: addToCollection(key) }); }
  }
  function inspect(key: string) { if (state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); } setInspected(key); setView("viewer"); }
  // Navigation is in the world; the keyboard mirrors it: Esc back, S shop, C collection,
  // number keys pick a series, Enter opens the sealed box.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (key === "escape" || key === "backspace") back();
      else if (atCentre(view) && key === "s") navigate("shop");
      else if (atCentre(view) && key === "c") navigate("gallery");
      else if (view === "shop" && /^[1-9]$/.test(key) && FIGURINE_SERIES[Number(key) - 1]) pickSeries(FIGURINE_SERIES[Number(key) - 1].id);
      else if (view === "opening" && state.phase === "sealed" && !webglUnavailable && (key === "enter" || key === " ") && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); open(); }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  function toggleSound() { unlockFigurineAudio(); setFigurineAudioMuted(!muted); setMuted(!muted); }

  const world: StageWorld = useMemo(() => ({
    collection,
    series: FIGURINE_SERIES.map((entry) => ({
      id: entry.id, number: pad(entry.number), theme: entry.theme, silhouettes: entry.silhouettes,
      keys: entry.characters.map((character) => figureKey(entry.id, character.id)),
      names: entry.characters.map((character) => character.name), models: entry.characters.map((character) => character.model),
    })),
    labels: {
      sign: t("navShop"), series: (number) => t("seriesName", { number }),
      collected: (owned, total) => t("seriesCollected", { got: owned, total }),
    },
  }), [collection, t]);
  const packaging = useMemo(() => ({ blind: t("boxBlind"), collect: t("boxCollect", { count: series.characters.length }), contents: t("boxContents"), openHere: t("boxOpenHere") }), [t, series.characters.length]);
  const label = (figure: FigurineCharacter) => `${figure.realm} · ${t(`races.${figure.raceKey}`)} · ${t(`classes.${figure.classKey}`)}`;
  const hoveredFigure = hovered ? findFigure(hovered) : null;

  return <main className={styles.showcase} data-phase={state.phase} data-view={view}>
    <button type="button" className={styles.soundToggle} aria-pressed={!muted} onClick={toggleSound}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />{muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}</svg>
      <span>{t(muted ? "soundOff" : "soundOn")}</span>
    </button>
    <FigurineStage immersive files={files} filesFor={filesFor} showing={wanted?.model ?? null} boxMode open={view !== "viewer" && (state.phase === "opening" || state.phase === "revealed")} charging={state.phase === "loading"}
      interactive={view === "opening" && state.phase === "sealed" && !webglUnavailable} round={state.round} onBoxTap={open} rotate={view === "viewer" || view === "opening"} ready={revealedWorld}
      view={view} series={series.id} world={world} figureKey={drawn ? figureKey(series.id, drawn.id) : undefined}
      onNavigate={navigate} onBack={back} onPickSeries={pickSeries} onInspect={inspect} onHoverFigure={setHovered}
      onStatus={(status) => {
        setWebglUnavailable(status === "webgl");
        if (status === "ready") { setModel("ready"); dispatch({ type: "loaded" }); }
        else if (status === "error" || status === "webgl") { setModel("failed"); if (view !== "viewer") dispatch({ type: "failed" }); }
      }}
      onProgress={setStageProgress} onLoaded={() => setStageLoaded(true)} arrival={arrival}
      onRevealed={revealed} signature={drawn?.classKey} quip={drawn ? figureQuip(figureKey(series.id, drawn.id)) : undefined}
      labels={{ loading: t("modelLoading"), ready: t("modelReady"), empty: t("modelEmpty"), error: t("modelError"), webgl: t("webglError"), box: t("boxStatus"), boxTitle: t("boxTitle"), boxSubtitle: t("boxSubtitle"), series: t("navCollection"), packaging }} />
    <div className={styles.worldLoader} data-done={revealedWorld} role="status" aria-hidden={revealedWorld}>
      <span>{t("worldPreparing")}</span>
      <div className={styles.worldLoaderBar}><i style={{ width: `${progress}%` }} /></div>
    </div>
    <div className={styles.showcaseHud}>
      <div className={styles.revealIdentity} aria-live="polite" aria-atomic="true">
        {view === "opening" && state.phase === "revealed" && drawn ? <>
          {opened && <span className={styles.newBadge}>{opened.count === 1 ? t("newFigure") : t("duplicateFigure", { count: opened.count })}</span>}
          <h1>{drawn.name}</h1><p>{label(drawn)}</p>
        </> : view === "opening" && state.phase === "error" ? <><h1>{t("drawErrorTitle")}</h1><p>{t(webglUnavailable ? "webglError" : "drawError")}</p></>
          : view === "viewer" && viewing ? <><h1>{viewing.character.name}</h1><p>{label(viewing.character)}</p><p className={styles.showcaseHint}>{t("inspectFigure")}</p></>
          : (view === "gallery" || (view === "opening" && state.phase === "sealed")) && hoveredFigure ? <p className={styles.worldHint}>{collection[hovered!] ? hoveredFigure.character.name : t("notCollected")}</p>
          : view === "gallery" || view === "shop" ? null
          : <span className={styles.srOnly}>{t(state.phase === "loading" ? "drawLoading" : state.phase === "opening" ? "drawOpening" : "mysteryTitle")}</span>}
      </div>
      {view === "opening" && state.phase === "sealed" && <p className={styles.worldHint}>{t("pullToOpen")}</p>}
      {view === "opening" && state.phase === "error" && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} onClick={() => { unlockFigurineAudio(); setFiles([]); dispatch({ type: "retry" }); }}>{t("retryBox")}</button>
      </div>}
      {(view === "shop" || view === "gallery") && <p className={styles.showcaseHint}>{t("tapAwayHint")}</p>}
      {view === "viewer" && (!files.length || filesFor !== wanted?.model) && <p className={styles.showcaseHint}>{t("worldLoading")}</p>}
    </div>
  </main>;
}
