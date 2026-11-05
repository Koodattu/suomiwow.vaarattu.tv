"use client";

import { useTranslations } from "next-intl";
import type { PanelResult } from "./WorldPanels";
import { OverviewBack } from "./OverviewHud";
import controls from "./pond-hud.module.css";
import styles from "./chest-hud.module.css";

// A coin hanging before the camera: any tap collects it.
export function CoinReward({ count, note, onDismiss }: { count: number; note?: string; onDismiss: () => void }) {
  const t = useTranslations("figurineLab.world.crate");
  return <>
    <button type="button" className={controls.catchDismiss} onClick={onDismiss} aria-label={t("dismissReward")} />
    <div className={controls.banner} role="status"><div>
      <b>{t("reward", { count })}</b>
      {note && <span>{note}</span>}
      <span>{t("dismissReward")}</span>
    </div></div>
  </>;
}

// The week's streak: each opened day filled, today's waiting, and the seventh worth the most.
function Streak({ day, today }: { day: number; today: boolean }) {
  const t = useTranslations("figurineLab.world.crate");
  const opened = today ? day - 1 : day;
  return <ol className={styles.streak} aria-label={t("day", { day })}>{Array.from({ length: 7 }, (_, index) => {
    const number = index + 1;
    return <li key={number} data-state={number <= opened ? "done" : today && number === day ? "today" : undefined} data-final={number === 7 || undefined}>{number === 7 ? t("day7") : number}</li>;
  })}</ol>;
}

export default function ChestHud({ ready, day, remainingMs, bonusReady, busy, result, onOpen, onDismiss, onBack }: {
  ready: boolean; day: number; remainingMs: number; bonusReady: boolean; busy: boolean;
  result: Extract<PanelResult, { station: "crate" }> | null;
  onOpen: () => void; onDismiss: () => void; onBack: () => void;
}) {
  const t = useTranslations("figurineLab.world.crate");
  const minutes = Math.ceil(remainingMs / 60000);
  return <>
    <div className={styles.title}><h1>{t("title")}</h1></div>
    {result ? <CoinReward count={result.reward.coins ?? 0} note={(result.reward.coins ?? 0) > 1 ? t(result.day === 7 ? "weeklyBonus" : "dailyBonus") : undefined} onDismiss={onDismiss} />
    : <div className={styles.reward} role="status">
      <Streak day={day} today={bonusReady} />
      {!ready && !busy && <small>{t("comeBack", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })}</small>}
    </div>}
    <nav className={controls.bar} aria-label={t("controls")}>
      <div className={controls.left}><OverviewBack inline onBack={onBack} /></div>
      <button type="button" className={`${controls.action} ${styles.action}`} disabled={busy || (!ready && !result)} onClick={result ? onDismiss : onOpen}>
        <svg className={controls.glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11V8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v3M3 11h18v10H3zM8 3v18M16 3v18"/><path d="M10 10h4v5h-4z"/></svg>
        {result ? t("collect") : busy ? t("opening") : ready ? t("action") : t("claimed")}
      </button>
      <div className={controls.right}/>
    </nav>
  </>;
}
