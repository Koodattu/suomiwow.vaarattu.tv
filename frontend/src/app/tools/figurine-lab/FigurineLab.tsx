"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { LabCharacter } from "@/lib/figurine-lab";
import { RELEASED_SERIES, figureKey, findFigure } from "@/lib/figurine-series";
import { QUALITIES, isQuality, type FigurineQuality } from "@/lib/figurine-collection";
import styles from "./figurine-lab.module.css";
import BlindBox from "./BlindBox";

const FigurineStage = dynamic(() => import("./FigurineStage"), { ssr: false });
const ERROR_KEYS = ["invalidInput", "notFound", "rateLimited", "credentialsMissing", "upstreamFailed"] as const;
type ErrorKey = typeof ERROR_KEYS[number];
const MODEL_SERIES = [...RELEASED_SERIES].sort((a, b) => a.number - b.number);

export default function FigurineLab() {
  const t = useTranslations("figurineLab");
  const [name, setName] = useState("Röidy");
  const [realm, setRealm] = useState("kazzak");
  const [character, setCharacter] = useState<LabCharacter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [quality, setQuality] = useState<FigurineQuality>("standard");
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState(false);
  const modelRequest = useRef<AbortController | null>(null);
  const [boxMode, setBoxMode] = useState(false);
  const [open, setOpen] = useState(false);
  const [rotate, setRotate] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); modelRequest.current?.abort(); }, []);

  function importFiles(next: File[]) {
    modelRequest.current?.abort();
    setSelectedModel(""); setModelLoading(false); setModelError(false); setOpen(false); setFiles(next);
  }

  async function selectModel(key: string) {
    importFiles([]);
    const selected = findFigure(key);
    if (!selected) return;
    const controller = new AbortController(); modelRequest.current = controller;
    setSelectedModel(key); setModelLoading(true); setBoxMode(false);
    try {
      const response = await fetch(selected.character.model, { signal: controller.signal });
      if (!response.ok) throw new Error("Model unavailable");
      const blob = await response.blob();
      if (blob.size !== selected.character.bytes) throw new Error("Incomplete model");
      if (!controller.signal.aborted) setFiles([new File([blob], `${selected.character.name}-${selected.character.realm}.glb`)]);
    } catch {
      if (!controller.signal.aborted) { setModelError(true); setSelectedModel(""); }
    } finally { if (!controller.signal.aborted) setModelLoading(false); }
  }

  async function lookup(event: FormEvent) {
    event.preventDefault();
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null); setCharacter(null); importFiles([]); setImageFailed(false);
    try {
      const response = await fetch(`/api/figurine-lab/character?${new URLSearchParams({ name, realm })}`, { signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { setError(ERROR_KEYS.includes(result.error) ? result.error : "upstreamFailed"); return; }
      setCharacter(result);
    } catch { if (!controller.signal.aborted) setError("upstreamFailed"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function saveAppearance() {
    if (!character) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ region: "eu", fetchedAt: character.fetchedAt, appearance: character.appearance }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${character.appearance.character.realm.slug}-${character.name}-appearance.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className={styles.lab}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>{t("eyebrow")}</p><h1>{t("title")}</h1><p className={styles.intro}>{t("intro")}</p></div>
      <span className={styles.badge}>{t("localOnly")}</span>
    </header>
    <BlindBox />
    <form onSubmit={lookup} className={styles.lookup}>
      <label>{t("name")}<input autoComplete="off" required maxLength={12} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{t("realm")}<input autoComplete="off" required maxLength={80} value={realm} onChange={(event) => setRealm(event.target.value)} /></label>
      <span className={styles.region}>{t("region")}</span>
      <button type="submit" className={styles.primary} disabled={busy}>{t(busy ? "loadingCharacter" : "loadCharacter")}</button>
    </form>
    {error && <p role="alert" className={styles.error}>{t(error)}</p>}
    <div className={styles.workbench}>
      <section className={styles.reference} aria-labelledby="reference-title">
        <div className={styles.panelHeading}><span className={styles.step}>01</span><h2 id="reference-title">{t("referenceTitle")}</h2><span className={styles.tag}>{t("imageTag")}</span></div>
        <div className={styles.portrait}>
          {character?.renderUrl && !imageFailed ? <Image src={character.renderUrl} alt={t("renderAlt", { name: character.name })} fill unoptimized sizes="(max-width: 900px) 100vw, 36vw" onError={() => setImageFailed(true)} /> : <div className={styles.emptyPortrait}><span aria-hidden="true">✦</span><p>{t(busy ? "loadingCharacter" : character ? "noImage" : "lookupHint")}</p></div>}
        </div>
        <div className={styles.identity}>{character ? <><h3>{character.name}<small>{character.realm} · EU</small></h3><p>{character.race} · {character.characterClass}</p><p className={styles.fine}>{t("snapshotNote")}</p></> : <p>{t("referenceHint")}</p>}</div>
      </section>
      <section className={styles.viewer} aria-labelledby="viewer-title">
        <div className={styles.panelHeading}><span className={styles.step}>02</span><h2 id="viewer-title">{t("viewerTitle")}</h2><span className={styles.tag}>{t("threeTag")}</span></div>
        <div className={styles.modelPicker}>
          <label htmlFor="workbench-model">{t("bundledModel")}</label>
          <select id="workbench-model" value={selectedModel} onChange={(event) => { void selectModel(event.target.value); }}>
            <option value="">{t("chooseBundledModel")}</option>
            {MODEL_SERIES.map((entry) => <optgroup key={entry.id} label={t("seriesName", { number: String(entry.number).padStart(3, "0") })}>
              {entry.characters.map((figure) => <option key={figure.id} value={figureKey(entry.id, figure.id)}>{figure.name} — {figure.realm} · {t(`races.${figure.raceKey}`)} · {t(`classes.${figure.classKey}`)}</option>)}
            </optgroup>)}
          </select>
          <label htmlFor="workbench-finish">{t("previewFinish")}</label>
          <select id="workbench-finish" value={quality} onChange={(event) => { if (isQuality(event.target.value)) setQuality(event.target.value); }}>
            {QUALITIES.map((finish) => <option key={finish} value={finish}>{t(`quality.${finish}`)}</option>)}
          </select>
          {modelLoading && <p role="status">{t("modelLoading")}</p>}
          {modelError && <p role="alert">{t("bundledModelError")}</p>}
        </div>
        <div className={styles.toolbar}>
          <div className={styles.segmented}><button type="button" aria-pressed={!boxMode} onClick={() => setBoxMode(false)}>{t("figureMode")}</button><button type="button" aria-pressed={boxMode} onClick={() => setBoxMode(true)}>{t("boxMode")}</button></div>
          <label className={styles.check}><input type="checkbox" checked={rotate} onChange={(event) => setRotate(event.target.checked)} />{t("rotate")}</label>
        </div>
        <FigurineStage files={files} quality={quality} boxMode={boxMode} open={open} rotate={rotate} labels={{ loading: t("modelLoading"), ready: t("modelReady"), empty: t("modelEmpty"), error: t("modelError"), webgl: t("webglError"), box: t("boxStatus"), boxTitle: t("boxTitle"), boxSubtitle: t("boxSubtitle") }} />
        <div className={styles.viewerActions}>
          <label className={styles.fileButton}>{t("importModel")}<input type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" onChange={(event) => { importFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
          <label className={styles.fileButton}>{t("importFolder")}<input type="file" multiple {...{ webkitdirectory: "" }} onChange={(event) => { importFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
          {boxMode && <button type="button" className={styles.primary} onClick={() => setOpen(!open)}>{t(open ? "closeBox" : "openBox")}</button>}
          {(files.length > 0 || selectedModel) && <button type="button" onClick={() => importFiles([])}>{t("clearModel")}</button>}
        </div>
        <p className={styles.help}>{t(boxMode ? "boxHint" : "modelHint")}</p>
        <p className={styles.fine}>{t("localFilesNote")}</p>
      </section>
    </div>
    <section className={styles.nextStep}>
      <span className={styles.step}>03</span><div><h2>{t("pipelineTitle")}</h2><p>{t("pipelineHint")}</p></div>
      {character && <button type="button" onClick={saveAppearance}>{t("downloadAppearance")}</button>}
    </section>
    {character && <details className={styles.details}>
      <summary>{t("appearanceDetails", { count: character.appearance.customizations.length })}</summary>
      <p className={styles.fine}>{t("dataSource")}</p>
      <div className={styles.tableScroll}><table><thead><tr><th>{t("slot")}</th><th>{t("equipped")}</th><th>{t("displayed")}</th><th>{t("modifier")}</th><th>{t("secondShoulder")}</th></tr></thead>
        <tbody>{character.equipment.map((item) => <tr key={item.slot}><td>{item.slotName}</td><td>{item.equippedName}<small>{item.equippedId}</small></td><td className={item.transmogged ? styles.transmog : undefined}>{item.visibleName}<small>{item.visibleId}</small></td><td>{item.modifier ?? "—"}</td><td>{item.secondaryId ?? "—"}</td></tr>)}</tbody></table></div>
    </details>}
  </main>;
}
