"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { FaSpinner } from "react-icons/fa6";
import { useLocale, useTranslations } from "next-intl";
import { CCG_CLASS_COLORS, CCG_RARITY_KEYS } from "@/lib/ccg";
import { formatSpecName, getClassInfoById } from "@/lib/utils";
import type { CcgCustomFinish, CcgTierGrade } from "@/types";
import type { StudioCreation, StudioDraft, StudioState } from "@/types/ccg-studio";
import CollectibleCard from "./CollectibleCard";
import SupporterMediaUploader from "./SupporterMediaUploader";
import type { StudioFeedback } from "./StudioAccounts";
import styles from "./studio.module.css";
import cardStyles from "./ccg.module.css";

export default function StudioEditor({ source, data, pending, action, run, onDirty, feedback }: { source: StudioCreation; data: StudioState; pending: boolean; action: string | null; onDirty: (dirty: boolean) => void; feedback: StudioFeedback | null;
  run: (path: string, body?: Record<string, unknown>, method?: string) => Promise<unknown> }) {
  const t = useTranslations("ccg");
  const locale = useLocale();
  const [confirm, setConfirm] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirm) {
      confirmationRef.current?.focus({ preventScroll: true });
      confirmationRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [confirm]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const initialBackground = data.backgrounds.find((entry) => entry.path === (source.preview?.backgroundPath ?? source.preview?.set.backgroundPath)) ?? data.backgrounds[0];
  const original: StudioDraft = { backgroundId: initialBackground.id, backgroundOffsetX: source.preview?.backgroundCrop.x ?? initialBackground.crop.x,
    ...(source.draft ?? { specName: source.preview!.specName, role: source.preview!.role,
    tierGrade: source.tierGrade!, creatorFinish: source.creatorFinish!, performance: source.preview!.scores.performance,
    mechanics: source.preview!.scores.mechanics, mythicPlus: source.preview!.scores.mythicPlus }) };
  const [form, setForm] = useState<StudioDraft>(original);
  const [revision, setRevision] = useState(source.revision);
  if (revision !== source.revision) {
    setRevision(source.revision);
    setForm(original);
    setConfirm(false);
  }
  const [alternativePreview, setAlternativePreview] = useState<string | null>(null);
  const [hasLocalFiles, setHasLocalFiles] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const unsaved = dirty || hasLocalFiles;
  useEffect(() => {
    onDirty(unsaved);
    const preventLoss = (event: BeforeUnloadEvent) => { if (unsaved) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", preventLoss);
    return () => { window.removeEventListener("beforeunload", preventLoss); onDirty(false); };
  }, [unsaved, onDirty]);
  const owned = data.characters.some((character) => character.id === source.characterId && character.realmId === source.realmId);
  const disabled = pending || !owned || source.editsFrozen;
  const valid = (["performance", "mechanics", "mythicPlus"] as const).every((key) => form[key] === null || (Number.isFinite(form[key]) && form[key]! >= 0 && form[key]! <= (key === "mythicPlus" ? 100000 : 100)));
  const path = `drafts/${source.id}`;
  const specs = data.classes.find((entry) => entry.id === source.classID)?.specs ?? [];
  const combined = form.performance === null || form.mechanics === null ? null : Math.round((form.performance + form.mechanics) * 5) / 10;
  const background = data.backgrounds.find((entry) => entry.id === form.backgroundId) ?? initialBackground;
  const preview = source.preview ? { ...source.preview, tierGrade: form.tierGrade, specName: form.specName, role: form.role,
    backgroundPath: background.path, backgroundCrop: { ...background.crop, x: form.backgroundOffsetX ?? background.crop.x },
    alternativeArt: alternativePreview ? { characterArtPath: alternativePreview, characterArtFilename: null, characterArtEnabled: true,
      backgroundArtPath: null, backgroundArtFilename: null, backgroundArtEnabled: false } : null,
    metric: form.role === "healer" ? "hps" as const : "dps" as const,
    scores: { performance: form.performance, mechanics: form.mechanics, combined, mythicPlus: form.mythicPlus } } : null;
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const changeScore = (key: "performance" | "mechanics" | "mythicPlus", value: string) => {
    setConfirm(false);
    setForm((previous) => ({ ...previous, [key]: value === "" ? null : Number(value) }));
  };

  return <section className={styles.editor} aria-label={t("studio.editor")} aria-busy={pending} style={{ "--class-color": CCG_CLASS_COLORS[source.classID] ?? "#c4cddd" } as CSSProperties}>
    <div className={styles.preview}>
      {preview && <div className={styles.previewCard}><CollectibleCard card={preview} finish={form.creatorFinish} artVariant={alternativePreview ? "alternative" : "standard"} compact className={cardStyles.scaledCardTypography} /></div>}
      <span className={styles.previewLabel}>{t("studio.livePreview")}</span>
      {source.draft && <div className={styles.renderFeedback}>
        {source.renderError && <p className={styles.inlineError} role="status">{t("studio.appearanceFailed")}</p>}
        <button type="button" disabled={disabled || dirty || Date.parse(source.nextRenderRefreshAt) > now} onClick={() => void run(`${path}/render`)}>{action === `${path}/render` && <FaSpinner className={styles.spinner} aria-hidden="true" />}{t(action === `${path}/render` ? "studio.refreshing" : source.renderError ? "studio.retryAppearance" : "studio.refreshRender")}</button>
        {Date.parse(source.nextRenderRefreshAt) > now && <small>{t("studio.renderCooldown", { date: date(source.nextRenderRefreshAt) })}</small>}
        {source.renderUnchanged && <p>{t("studio.renderUnchanged")}</p>}
        {feedback?.path === `${path}/render` && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? styles.inlineError : styles.success}>{feedback.message}</p>}
      </div>}
      {source.cardId && <Link href={`/ccg/collection?set=supporter&character=${source.preview?.characterId}`}>{t("studio.viewCollection")}</Link>}
    </div>
    <div className={styles.form}>
      <div className={styles.editorHeading}><div><h2 className={styles.className}>{source.name}</h2><small>{source.realm} · {getClassInfoById(source.classID).name}</small></div>
        <span className={styles.badge} data-tone={source.cardId && !source.draft ? "success" : "draft"}>{t(source.cardId ? source.draft ? "studio.unpublishedChanges" : "studio.published" : "studio.draft")}</span></div>
      {(!owned || source.editsFrozen) && <p role="status">{t(source.editsFrozen ? "studio.errors.editing_frozen" : "studio.errors.ownership_required")}</p>}
      <fieldset disabled={disabled}>
        <div className={styles.fields}>
          <label>{t("studio.spec")}<select value={form.specName} onChange={(event) => {
            const spec = specs.find((entry) => entry.name === event.target.value)!;
            setForm((previous) => ({ ...previous, specName: spec.name, role: spec.role })); setConfirm(false);
          }}>{specs.map((spec) => <option key={spec.name} value={spec.name}>{formatSpecName(spec.name)} · {t(`role.${spec.role}`)}</option>)}</select></label>
          <label>{t("studio.rarity")}<select value={form.tierGrade} disabled={Boolean(source.cardId)} onChange={(event) => {
            setForm((previous) => ({ ...previous, tierGrade: event.target.value as CcgTierGrade })); setConfirm(false);
          }}>{Object.entries(CCG_RARITY_KEYS).map(([grade, key]) => <option key={grade} value={grade}>{t(`rarity.${key}`)}</option>)}</select></label>
          <label>{t("studio.finish")}<select value={form.creatorFinish} disabled={Boolean(source.cardId)} onChange={(event) => {
            setForm((previous) => ({ ...previous, creatorFinish: event.target.value as CcgCustomFinish })); setConfirm(false);
          }}>{data.finishes.map((finish) => <option key={finish} value={finish}>{t(`finish.${finish}`)}</option>)}</select></label>
          <label>{t("studio.background")}<select value={form.backgroundId} onChange={(event) => {
            const selected = data.backgrounds.find((entry) => entry.id === event.target.value)!;
            setForm((previous) => ({ ...previous, backgroundId: selected.id, backgroundOffsetX: selected.crop.x })); setConfirm(false);
          }}>{data.backgrounds.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>{t("studio.backgroundOffset")}<input type="range" min={0} max={100} step={1} value={form.backgroundOffsetX ?? background.crop.x} onChange={(event) => {
            setForm((previous) => ({ ...previous, backgroundOffsetX: Number(event.target.value) })); setConfirm(false);
          }} /></label>
        </div>
        {source.cardId && <p className={styles.hint}>{t("studio.locked")}</p>}
        <div className={styles.sectionHeading}><h3>{t("studio.scores")}</h3><button type="button" className={styles.textButton} onClick={() => { setForm((previous) => ({ ...previous, performance: Math.floor(Math.random() * 101), mechanics: Math.floor(Math.random() * 101), mythicPlus: Math.floor(Math.random() * 4001) })); setConfirm(false); }}>{t("studio.randomize")}</button></div>
        <div className={styles.scoreFields}>
          {(["performance", "mechanics", "mythicPlus"] as const).map((key) => <label key={key}>{t(`studio.${key}`)}
            <input type="number" min={0} max={key === "mythicPlus" ? 100000 : 100} step="0.1" value={form[key] ?? ""}
              onChange={(event) => changeScore(key, event.target.value)} />
          </label>)}
          <label>{t("studio.combined")}<output>{combined ?? "—"}</output></label>
        </div>
      </fieldset>
      {!valid && <p className={styles.inlineError} role="alert">{t("studio.errors.invalid_scores")}</p>}
      <div className={styles.saveBar}><span className={styles.hint} role="status">{t(dirty ? "studio.unsavedShort" : source.draft ? "studio.savedDraft" : "studio.published")}</span>
        <button type="button" className={dirty ? styles.primary : undefined} disabled={disabled || !valid || (!dirty && Boolean(source.draft))} onClick={() => void run(path, { ...form, revision: source.revision }, "PATCH")}>
          {action === path && pending && <FaSpinner className={styles.spinner} aria-hidden="true" />}{t(action === path && pending ? "studio.saving" : source.draft || dirty ? "studio.save" : "studio.edit")}</button>
      </div>
      {feedback?.path === path && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? styles.inlineError : styles.success}>{feedback.message}</p>}
      {source.draft && <>
        {dirty && <p role="status">{t("studio.unsaved")}</p>}
        {!source.cardId && data.allowance.available < 1 && <p className={styles.hint}>{t("studio.noPublishSlots")}</p>}
        {Date.parse(source.nextEditAt) > now && <p>{t("studio.editCooldown", { date: date(source.nextEditAt) })}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={disabled || dirty || !preview?.renderUrl || Date.parse(source.nextEditAt) > now || (!source.cardId && data.allowance.available < 1)} onClick={() => setConfirm(true)}>{t(source.cardId ? "studio.apply" : "studio.publish")}</button>
          <button type="button" disabled={pending} onClick={() => { if (window.confirm(t("studio.confirmDiscard"))) void run(path, { revision: source.revision }, "DELETE"); }}>{t("studio.discard")}</button>
        </div>
        {confirm && <div ref={confirmationRef} tabIndex={-1} className={styles.confirm} role="alert">
          <p>{t(source.cardId ? "studio.confirmApply" : "studio.confirmPublish")}</p>
          <div className={styles.actions}><button className={styles.primary} disabled={pending} onClick={() => void run(`${path}/publish`, { revision: source.revision })}>{pending && <FaSpinner className={styles.spinner} aria-hidden="true" />}{t(pending ? "studio.publishing" : source.cardId ? "studio.apply" : "studio.publish")}</button>
            <button disabled={pending} onClick={() => setConfirm(false)}>{t("studio.cancel")}</button></div>
        </div>}
      </>}
      {feedback?.path === `${path}/publish` && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? styles.inlineError : styles.success}>{feedback.message}</p>}
    </div>
    <SupporterMediaUploader source={source} media={data.media ?? []} disabled={disabled} onPreview={setAlternativePreview} onSelectionChange={setHasLocalFiles} />
  </section>;
}

