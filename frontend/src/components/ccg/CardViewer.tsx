"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CcgCard, CcgFinish } from "@/types";
import { bestOwnedFinish } from "@/lib/ccg";
import { formatRealmName } from "@/lib/utils";
import CollectibleCard from "./CollectibleCard";
import styles from "./ccg.module.css";

export default function CardViewer({ card, initialFinish = "standard", onClose }: { card: CcgCard; initialFinish?: CcgFinish; onClose: () => void }) {
  const t = useTranslations("ccg");
  const locale = useLocale();
  const [finish, setFinish] = useState<CcgFinish>(initialFinish);
  const [variantIndex, setVariantIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const variants = card.variants?.length ? card.variants : [{ card, ownership: card.ownership ?? [], totalQuantity: card.totalQuantity ?? 0 }];
  const selectedVariant = variants[Math.min(variantIndex, variants.length - 1)];
  const displayedCard = selectedVariant.card;
  const ownedFinishes = variantIndex === 0 ? (card.ownership ?? selectedVariant.ownership) : selectedVariant.ownership;
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
      <section ref={dialogRef} className={styles.viewer} role="dialog" aria-modal="true" aria-label={displayedCard.name}>
        <div className="flex justify-end">
          <button ref={closeButtonRef} type="button" onClick={onClose} className={styles.secondaryButton}>{t("close")}</button>
        </div>
        <div className="mt-3 grid gap-6 md:grid-cols-[minmax(240px,360px)_1fr] md:items-center">
          <CollectibleCard card={displayedCard} finish={finish} quantity={isOwned ? quantity : undefined} width={340} />
          <div>
            <div className={styles.eyebrow}>#{String(displayedCard.setNumber).padStart(3, "0")} · {displayedCard.set.raidName}</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-white">{displayedCard.name}</h2>
            <p className="mt-1 text-sm text-slate-400">{displayedCard.guildName ? `<${displayedCard.guildName}> · ` : ""}{formatRealmName(displayedCard.realm)}</p>
            {variants.length > 1 ? (
              <div className="mt-5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("collection.ownedSnapshots")}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {variants.map((variant, index) => (
                    <button
                      type="button"
                      aria-pressed={variantIndex === index}
                      key={variant.card.id}
                      onClick={() => {
                        setVariantIndex(index);
                        setFinish((index === 0 ? bestOwnedFinish(card) : bestOwnedFinish({ ...variant.card, ownership: variant.ownership }))?.finish ?? "standard");
                      }}
                      className={variantIndex === index ? styles.primaryButton : styles.secondaryButton}
                    >
                      {variant.card.set.raidName}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
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
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{t("snapshot")}</dt><dd className="mt-1 text-slate-300">{new Date(displayedCard.performanceSnapshotAt).toLocaleDateString(locale)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{t("tier")}</dt><dd className="mt-1 font-bold text-slate-100">{displayedCard.tierGrade}</dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{displayedCard.metric.toUpperCase()}</dt><dd className="mt-1 tabular-nums text-slate-300">{displayedCard.scores.performance.toFixed(1)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-slate-500">{t("mechanics")}</dt><dd className="mt-1 tabular-nums text-slate-300">{displayedCard.scores.mechanics.toFixed(1)}</dd></div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
