"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { boxReducer, chooseFigure, initialBox } from "@/lib/figurine-box";
import { getFigurineAudioMuted, preloadFigurineSignature, setFigurineAudioMuted, unlockFigurineAudio } from "@/lib/figurine-audio";
import catalog from "@/data/figurines/community-001.json";
import styles from "./figurine-lab.module.css";

const FigurineStage = dynamic(() => import("./FigurineStage"), { ssr: false });
const lineup = catalog.characters.map((character) => character.name);
const silhouettes = `/figurines/${catalog.id}/silhouettes.png`;

export default function BlindBox({ immersive = false }: { immersive?: boolean }) {
  const t = useTranslations("figurineLab");
  const [state, dispatch] = useReducer(boxReducer, initialBox);
  const [files, setFiles] = useState<File[]>([]);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [muted, setMuted] = useState(false);
  useEffect(() => { setMuted(getFigurineAudioMuted()); }, []);
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state.phase === "revealed" || state.phase === "error" || (state.phase === "sealed" && state.round > 0)) action.current?.focus({ preventScroll: true });
  }, [state.phase, state.round]);
  const figure = state.selected === null ? null : catalog.characters[state.selected];
  useEffect(() => {
    if (!figure) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { dispatch({ type: "failed" }); controller.abort(); }, 30_000);
    void (async () => {
      try {
        const response = await fetch(figure.model, { signal: controller.signal });
        if (!response.ok) throw new Error("Model unavailable");
        const blob = await response.blob();
        if (blob.size !== figure.bytes) throw new Error("Incomplete model");
        if (!controller.signal.aborted) setFiles([new File([blob], "collectible.glb")]);
      } catch { if (!controller.signal.aborted) dispatch({ type: "failed" }); }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [figure, state.round]);

  const packaging = useMemo(() => ({ blind: t("boxBlind"), collect: t("boxCollect", { count: lineup.length }), contents: t("boxContents"), openHere: t("boxOpenHere") }), [t]);
  function open() {
    unlockFigurineAudio();
    const selected = chooseFigure(catalog.characters.length, Math.random());
    preloadFigurineSignature(catalog.characters[selected].classKey);
    dispatch({ type: "open", selected });
  }
  function reset() { unlockFigurineAudio(); setFiles([]); dispatch({ type: "reset" }); }
  function toggleSound() { unlockFigurineAudio(); setFigurineAudioMuted(!muted); setMuted(!muted); }
  // The immersive stage keeps one renderer across rounds and replays the box's entrance itself.
  const stage = <FigurineStage key={immersive ? undefined : state.round} immersive={immersive} files={files} boxMode open={state.phase === "opening" || state.phase === "revealed"} charging={state.phase === "loading"}
        interactive={state.phase === "sealed" && !webglUnavailable} round={state.round} onBoxTap={open} rotate={!immersive}
        onStatus={(status) => { setWebglUnavailable(status === "webgl"); if (status === "ready") dispatch({ type: "loaded" }); else if (status === "error" || status === "webgl") dispatch({ type: "failed" }); }}
        onRevealed={() => dispatch({ type: "revealed" })}
        labels={{ loading: t("modelLoading"), ready: t("modelReady"), empty: t("modelEmpty"), error: t("modelError"), webgl: t("webglError"), box: t("boxStatus"), boxTitle: t("boxTitle"), boxSubtitle: t("boxSubtitle"), series: t("communitySeries"), packaging }} lineup={lineup} silhouettes={silhouettes} signature={figure?.classKey} />;
  const actions = <div className={styles.drawActions}>
    {state.phase === "sealed" && <button ref={action} className={styles.primary} disabled={webglUnavailable} onClick={open}>{t("openBox")}</button>}
    {(state.phase === "loading" || state.phase === "opening") && <button className={styles.primary} disabled>{t(state.phase === "loading" ? "drawLoading" : "drawOpening")}</button>}
    {state.phase === "error" && <button ref={action} className={styles.primary} onClick={() => { unlockFigurineAudio(); setFiles([]); dispatch({ type: "retry" }); }}>{t("retryBox")}</button>}
    {(state.phase === "revealed" || state.phase === "error") && <button ref={state.phase === "revealed" ? action : undefined} className={state.phase === "revealed" ? styles.primary : undefined} onClick={reset}>{t("anotherBox")}</button>}
  </div>;
  if (immersive) return <main className={styles.showcase} data-phase={state.phase}>
    <header className={styles.showcaseHeader}><span>{t("boxTitle")}</span><p>{t("communitySeries")} <span aria-hidden="true">/</span> {t("seriesCount", { count: catalog.characters.length })}</p></header>
    <button type="button" className={styles.soundToggle} aria-pressed={!muted} onClick={toggleSound}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />{muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}</svg>
      <span>{t(muted ? "soundOff" : "soundOn")}</span>
    </button>
    {stage}
    <div className={styles.showcaseHud}>
      <div className={styles.revealIdentity} aria-live="polite" aria-atomic="true">
        {state.phase === "revealed" && figure ? <><h1>{figure.name}</h1><p>{figure.realm} · {t(`races.${figure.raceKey}`)} · {t(`classes.${figure.classKey}`)}</p></>
          : state.phase === "error" ? <><h1>{t("drawErrorTitle")}</h1><p>{t(webglUnavailable ? "webglError" : "drawError")}</p></>
          : <span className={styles.srOnly}>{t(state.phase === "loading" ? "drawLoading" : state.phase === "opening" ? "drawOpening" : "mysteryTitle")}</span>}
      </div>
      {state.phase === "sealed" && <button ref={action} type="button" className={styles.tapHint} disabled={webglUnavailable} onClick={open}>{t("pullToOpen")}</button>}
      {state.phase === "error" && <div className={styles.drawActions}>
        <button ref={action} className={styles.primary} onClick={() => { unlockFigurineAudio(); setFiles([]); dispatch({ type: "retry" }); }}>{t("retryBox")}</button>
        <button onClick={reset}>{t("anotherBox")}</button>
      </div>}
      {state.phase === "revealed" && <button ref={action} type="button" className={styles.newBox} onClick={reset}>{t("anotherBox")}</button>}
    </div>
  </main>;
  return <section className={styles.collectibles} aria-labelledby="collectibles-title">
    <div className={styles.panelHeading}><span className={styles.step}>✦</span><h2 id="collectibles-title">{t("collectiblesTitle")}</h2><span className={styles.tag}>{t("seriesCount", { count: catalog.characters.length })}</span></div>
    <div className={styles.collectiblesGrid}>
      {stage}
      <div className={styles.collectibleInfo}>
        <p className={styles.eyebrow}>{t("communitySeries")}</p>
        <div aria-live="polite" aria-atomic="true">
          {state.phase === "revealed" && figure ? <><h3>{figure.name}</h3><p>{figure.realm} · EU</p><p>{t(`races.${figure.raceKey}`)} · {t(`classes.${figure.classKey}`)}</p><p className={styles.fine}>{t("collectibleSize", { size: (figure.bytes / 1_000_000).toFixed(2) })}</p></> : <><h3>{t("mysteryTitle")}</h3><p>{t(state.phase === "error" ? "drawError" : state.phase === "loading" ? "drawLoading" : state.phase === "opening" ? "drawOpening" : "drawHint")}</p></>}
        </div>
        {actions}
        <p className={styles.fine}>{t("drawOdds", { count: catalog.characters.length })}</p>
        <p className={styles.fine}>{t("prototypeNote")}</p>
      </div>
    </div>
  </section>;
}
