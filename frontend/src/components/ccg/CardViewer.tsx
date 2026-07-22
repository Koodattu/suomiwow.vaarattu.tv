"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CcgCard, CcgFinish } from "@/types";
import { normalizeCcgTierGrade } from "@/lib/ccg";
import { formatRealmName } from "@/lib/utils";
import CollectibleCard from "./CollectibleCard";
import styles from "./ccg.module.css";

export default function CardViewer({ card, initialFinish = "standard", onClose }: { card: CcgCard; initialFinish?: CcgFinish; onClose: () => void }) {
  const t = useTranslations("ccg");
  const locale = useLocale();
  const [finish, setFinish] = useState<CcgFinish>(initialFinish);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const ownedFinishes = card.ownership ?? [];
  const isOwned = ownedFinishes.length > 0;
  const quantity = ownedFinishes.find((row) => row.finish === finish)?.quantity ?? 0;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className={styles.viewerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className={styles.viewer} role="dialog" aria-modal="true" aria-label={card.name}>
        <div className="flex justify-end">
          <button ref={closeButtonRef} type="button" onClick={onClose} className={styles.secondaryButton}>{t("close")}</button>
        </div>
        <div className="mt-3 grid gap-6 md:grid-cols-[minmax(240px,360px)_1fr] md:items-center">
          <CollectibleCard card={card} finish={finish} quantity={isOwned ? quantity : undefined} />
          <div>
            <div className={styles.eyebrow}>#{String(card.setNumber).padStart(3, "0")} · {card.set.raidName}</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-white">{card.name}</h2>
            <p className="mt-1 text-sm text-slate-400">{card.guildName ? `<${card.guildName}> · ` : ""}{formatRealmName(card.realm)}</p>
            {isOwned ? (
              <div className="mt-5 flex flex-wrap gap-2" aria-label={t("finish.label")}>
                {ownedFinishes.map((row) => (
                  <button
                    type="button"
                    aria-pressed={finish === row.finish}
                    key={row.finish}
                    onClick={() => setFinish(row.finish)}
                    className={finish === row.finish ? styles.primaryButton : styles.secondaryButton}
                  >
                    {t(`finish.${row.finish}`)} <span className="tabular-nums">×{row.quantity}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-slate-300">
                {t("collection.notCollected")}
              </div>
            )}
            <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{t("snapshot")}</dt><dd className="mt-1 text-slate-300">{new Date(card.performanceSnapshotAt).toLocaleDateString(locale)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{t("tier")}</dt><dd className="mt-1 font-bold text-slate-100">{normalizeCcgTierGrade(card.tierGrade)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{card.metric.toUpperCase()}</dt><dd className="mt-1 tabular-nums text-slate-300">{card.scores.performance.toFixed(1)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{t("mechanics")}</dt><dd className="mt-1 tabular-nums text-slate-300">{card.scores.mechanics.toFixed(1)}</dd></div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
