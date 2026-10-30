"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { boxReducer, chooseFigure, initialBox } from "@/lib/figurine-box";
import { getFigurineAudioMuted, preloadFigurineSignature, setFigurineAudioMuted, unlockFigurineAudio } from "@/lib/figurine-audio";
import { addToCollection, emptyCollection, readCollection, subscribeCollection } from "@/lib/figurine-collection";
import { FIGURINE_SERIES, figureKey, findFigure, findSeries, type FigurineCharacter } from "@/lib/figurine-series";
import type { StageWorld, WorldView } from "../figurine-lab/FigurineStage";
import styles from "../figurine-lab/figurine-lab.module.css";

const FigurineStage = dynamic(() => import("../figurine-lab/FigurineStage"), { ssr: false });
const pad = (number: number) => String(number).padStart(3, "0");
// Where "back" leads from each view, unless the view was entered from somewhere else.
const PARENT: Record<WorldView, WorldView | null> = { menu: null, shop: "menu", opening: "shop", gallery: "menu", viewer: "gallery" };

export default function FigurineWorld() {
  const t = useTranslations("figurineLab");
  const [view, setView] = useState<WorldView>("menu");
  const [seriesId, setSeriesId] = useState(FIGURINE_SERIES[0].id);
  const [state, dispatch] = useReducer(boxReducer, initialBox);
  const [files, setFiles] = useState<File[]>([]);
  const [inspected, setInspected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ key: string; count: number } | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  // Boxes and figures can be picked straight from the hub, so "back" returns to where they were picked.
  const [origin, setOrigin] = useState<Partial<Record<WorldView, WorldView>>>({});
  const [muted, setMuted] = useState(false);
  useEffect(() => { setMuted(getFigurineAudioMuted()); }, []);
  const collection = useSyncExternalStore(subscribeCollection, readCollection, emptyCollection);
  const action = useRef<HTMLButtonElement>(null);

  const series = findSeries(seriesId);
  const drawn = state.selected === null ? null : series.characters[state.selected];
  const viewing = inspected ? findFigure(inspected) : null;
  // The stage loads whichever figure the current view shows: the inspected one, or the one being opened.
  const wanted: FigurineCharacter | null = view === "viewer" ? viewing?.character ?? null : drawn;
  useEffect(() => {
    if (!wanted) { setFiles([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { if (view !== "viewer") dispatch({ type: "failed" }); controller.abort(); }, 30_000);
    void (async () => {
      try {
        const response = await fetch(wanted.model, { signal: controller.signal });
        if (!response.ok) throw new Error("Model unavailable");
        const blob = await response.blob();
        if (blob.size !== wanted.bytes) throw new Error("Incomplete model");
        if (!controller.signal.aborted) setFiles([new File([blob], "collectible.glb")]);
      } catch { if (!controller.signal.aborted && view !== "viewer") dispatch({ type: "failed" }); }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [wanted, state.round, view]);

  const navigate = useCallback((next: WorldView) => {
    unlockFigurineAudio();
    // Leaving a finished opening clears the pedestal for the next box.
    if (next !== "opening" && (state.phase === "revealed" || state.phase === "error")) { setOpened(null); dispatch({ type: "reset" }); }
    if (next !== "viewer") setInspected(null);
    setHovered(null);
    if ((next === "opening" || next === "viewer") && next !== view) setOrigin((current) => ({ ...current, [next]: view === "viewer" ? "menu" : view }));
    setView(next);
  }, [state.phase, view]);
  const back = useCallback(() => { const parent = origin[view] ?? PARENT[view]; if (parent && state.phase !== "loading" && state.phase !== "opening") navigate(parent); }, [view, state.phase, navigate, origin]);
  useEffect(() => { action.current?.focus({ preventScroll: true }); }, [view, state.phase, state.round]);

  function pickSeries(id: string) {
    unlockFigurineAudio();
    if (id !== seriesId || state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); }
    if (view !== "opening") setOrigin((current) => ({ ...current, opening: view === "viewer" ? "menu" : view }));
    setSeriesId(id); setView("opening");
  }
  function open() {
    unlockFigurineAudio();
    const selected = chooseFigure(series.characters.length, Math.random());
    preloadFigurineSignature(series.characters[selected].classKey);
    dispatch({ type: "open", selected });
  }
  function revealed() {
    dispatch({ type: "revealed" });
    if (drawn) { const key = figureKey(series.id, drawn.id); setOpened({ key, count: addToCollection(key) }); }
  }
  function another() { unlockFigurineAudio(); setOpened(null); setFiles([]); dispatch({ type: "reset" }); }
  function inspect(key: string) { if (state.phase === "revealed" || state.phase === "error") { setOpened(null); dispatch({ type: "reset" }); } setInspected(key); if (view !== "viewer") setOrigin((current) => ({ ...current, viewer: view })); setView("viewer"); }
  // Navigation is in the world; the keyboard mirrors it: Esc back, S shop, C collection,
  // number keys pick a series, Enter opens the sealed box.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (key === "escape" || key === "backspace") back();
      else if (view === "menu" && key === "s") navigate("shop");
      else if (view === "menu" && key === "c") navigate("gallery");
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
    <FigurineStage immersive files={files} boxMode open={view !== "viewer" && (state.phase === "opening" || state.phase === "revealed")} charging={state.phase === "loading"}
      interactive={view === "opening" && state.phase === "sealed" && !webglUnavailable} round={state.round} onBoxTap={open} rotate={view === "viewer"}
      view={view} series={series.id} world={world} figureKey={drawn ? figureKey(series.id, drawn.id) : undefined}
      onNavigate={navigate} onBack={back} onPickSeries={pickSeries} onInspect={inspect} onHoverFigure={setHovered}
      onStatus={(status) => { setWebglUnavailable(status === "webgl"); if (status === "ready") dispatch({ type: "loaded" }); else if ((status === "error" || status === "webgl") && view !== "viewer") dispatch({ type: "failed" }); }}
      onRevealed={revealed} signature={drawn?.classKey}
      labels={{ loading: t("modelLoading"), ready: t("modelReady"), empty: t("modelEmpty"), error: t("modelError"), webgl: t("webglError"), box: t("boxStatus"), boxTitle: t("boxTitle"), boxSubtitle: t("boxSubtitle"), series: t("navCollection"), packaging }} />
    <div className={styles.showcaseHud}>
      <div className={styles.revealIdentity} aria-live="polite" aria-atomic="true">
        {view === "opening" && state.phase === "revealed" && drawn ? <>
          {opened && <span className={styles.newBadge}>{opened.count === 1 ? t("newFigure") : t("duplicateFigure", { count: opened.count })}</span>}
          <h1>{drawn.name}</h1><p>{label(drawn)}</p>
        </> : view === "opening" && state.phase === "error" ? <><h1>{t("drawErrorTitle")}</h1><p>{t(webglUnavailable ? "webglError" : "drawError")}</p></>
          : view === "viewer" && viewing ? <><h1>{viewing.character.name}</h1><p>{label(viewing.character)}</p><p className={styles.showcaseHint}>{t("inspectFigure")}</p></>
          : (view === "gallery" || view === "menu") && hoveredFigure ? <p className={styles.worldHint}>{collection[hovered!] ? hoveredFigure.character.name : t("notCollected")}</p>
          : view === "gallery" || view === "menu" || view === "shop" ? null
          : <span className={styles.srOnly}>{t(state.phase === "loading" ? "drawLoading" : state.phase === "opening" ? "drawOpening" : "mysteryTitle")}</span>}
      </div>
      {view === "opening" && state.phase === "sealed" && <p className={styles.worldHint}>{t("pullToOpen")}</p>}
      {view === "opening" && state.phase === "error" && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} onClick={() => { unlockFigurineAudio(); setFiles([]); dispatch({ type: "retry" }); }}>{t("retryBox")}</button>
      </div>}
      {view === "opening" && state.phase === "revealed" && <button ref={action} type="button" className={styles.newBox} onClick={another}>{t("anotherBox")}</button>}
      {view !== "menu" && view !== "opening" && <p className={styles.showcaseHint}>{t("tapAwayHint")}</p>}
      {view === "viewer" && !files.length && <p className={styles.showcaseHint}>{t("worldLoading")}</p>}
    </div>
  </main>;
}
