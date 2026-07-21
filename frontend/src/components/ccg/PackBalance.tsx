"use client";

import { useTranslations } from "next-intl";
import type { CcgMode, CcgSession } from "@/types";
import styles from "./ccg.module.css";

export default function PackBalance({ session, mode }: { session: CcgSession; mode: CcgMode }) {
  const t = useTranslations("ccg");
  const packs = session.packs[mode];
  const progress = session.duplicates[mode];
  const progressPercent = Math.min(100, (progress.remainder / progress.needed) * 100);

  return (
    <div className={styles.balanceCard}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t(`mode.${mode}`)}</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-white">{packs.totalRemaining}</div>
          <div className="text-xs text-slate-500">{t("packsRemaining")}</div>
        </div>
        {packs.bonusRemaining > 0 ? (
          <span className="rounded-md bg-violet-400/10 px-2 py-1 text-xs font-semibold text-violet-200 ring-1 ring-violet-300/20">
            +{packs.bonusRemaining} {t("bonus")}
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-between text-[0.68rem] text-slate-500">
        <span>{t("duplicateMeter")}</span>
        <span className="tabular-nums">{progress.remainder}/{progress.needed}</span>
      </div>
      <div className={`${styles.progressTrack} mt-1.5`} aria-label={t("duplicateMeter")}>
        <div className={styles.progressFill} style={{ transform: `scaleX(${progressPercent / 100})` }} />
      </div>
    </div>
  );
}
