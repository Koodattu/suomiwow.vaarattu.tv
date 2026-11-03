"use client";

import { useTranslations } from "next-intl";
import type { PanelResult } from "./WorldPanels";
import controls from "./pond-hud.module.css";
import styles from "./chest-hud.module.css";

export default function ChestHud({ ready, day, busy, result, onOpen, onBack }: {
  ready: boolean; day: number; busy: boolean;
  result: Extract<PanelResult, { station: "crate" }> | null;
  onOpen: () => void; onBack: () => void;
}) {
  const t = useTranslations("figurineLab.world.crate");
  return <>
    <div className={styles.title}><span>{t("day", { day })}</span><h1>{t("title")}</h1></div>
    <div className={controls.story} role="status">
      <p>{busy ? t("opening") : result ? t("reward") : ready ? t("invitation") : t("claimed")}</p>
      <small>{result?.reward.boost ? t("goldenReward") : busy ? t("anticipation") : ready ? t("hint") : t("comeBack")}</small>
    </div>
    <nav className={controls.bar} aria-label={t("controls")}>
      <div className={controls.left}><button type="button" className={controls.back} onClick={onBack}>{t("back")}</button></div>
      <button type="button" className={`${controls.action} ${styles.action}`} disabled={busy || !ready} onClick={onOpen}>
        <svg className={controls.glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11V8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v3M3 11h18v10H3zM8 3v18M16 3v18"/><path d="M10 10h4v5h-4z"/></svg>
        {busy ? t("opening") : ready ? t("action") : t("claimed")}
      </button>
      <div className={controls.right}/>
    </nav>
  </>;
}
