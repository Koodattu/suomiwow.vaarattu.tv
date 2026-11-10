"use client";

import { useTranslations } from "next-intl";
import { LuPackageOpen } from "react-icons/lu";
import { OverviewBack } from "./OverviewHud";
import controls from "./pond-hud.module.css";
import styles from "./chest-hud.module.css";

// The week's streak: each opened day filled, today's waiting, and the seventh worth the most.
function Streak({ day, today }: { day: number; today: boolean }) {
  const t = useTranslations("figurineLab.world.crate");
  const opened = today ? day - 1 : day;
  return <ol className={styles.streak} aria-label={t("day", { day })}>{Array.from({ length: 7 }, (_, index) => {
    const number = index + 1;
    return <li key={number} data-state={number <= opened ? "done" : today && number === day ? "today" : undefined} data-final={number === 7 || undefined}>{number === 7 ? t("day7") : number}</li>;
  })}</ol>;
}

// The chest stays in full view: the streak, and one big button that doubles as the countdown.
export default function ChestHud({ ready, day, remainingMs, bonusReady, busy, onOpen, onBack }: {
  ready: boolean; day: number; remainingMs: number; bonusReady: boolean; busy: boolean; onOpen: () => void; onBack: () => void;
}) {
  const t = useTranslations("figurineLab.world.crate");
  const minutes = Math.ceil(remainingMs / 60000);
  return <>
    <div className={styles.title}><h1>{t("title")}</h1></div>
    <div className={styles.reward} role="status"><Streak day={day} today={bonusReady} /></div>
    <nav className={controls.bar} aria-label={t("controls")}>
      <div className={controls.left}><OverviewBack inline onBack={onBack} /></div>
      <button type="button" className={`${controls.action} ${styles.action}`} data-ready={ready && !busy || undefined} disabled={busy || !ready} onClick={onOpen}>
        <LuPackageOpen className={controls.glyph} aria-hidden="true" />
        {busy ? t("opening") : ready ? t("action") : t("comeBack", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })}
      </button>
      <div className={controls.right} />
    </nav>
  </>;
}
