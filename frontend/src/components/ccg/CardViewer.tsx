"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { CcgCard, CcgFinish } from "@/types";
import { bestOwnedFinish, CCG_RARITY_KEYS } from "@/lib/ccg";
import { formatRealmName } from "@/lib/utils";
import CollectibleCard from "./CollectibleCard";
import styles from "./ccg.module.css";

type ViewerPhase = "entering" | "open" | "closing";

function sourceCardElement(originElement: HTMLElement | null): HTMLElement | null {
  return originElement?.querySelector<HTMLElement>("[data-ccg-card]")
    ?? originElement?.querySelector<HTMLElement>("[data-card-surface]")
    ?? originElement;
}

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(value >= 1000 ? 0 : 1);
}

export default function CardViewer({
  card,
  initialFinish = "standard",
  originElement = null,
  onClose,
}: {
  card: CcgCard;
  initialFinish?: CcgFinish;
  originElement?: HTMLElement | null;
  onClose: () => void;
}) {
  const t = useTranslations("ccg");
  const locale = useLocale();
  const [finish, setFinish] = useState<CcgFinish>(initialFinish);
  const [variantIndex, setVariantIndex] = useState(0);
  const [phase, setPhase] = useState<ViewerPhase>("entering");
  const viewerRef = useRef<HTMLDivElement>(null);
  const cardMotionRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const enterFrameRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const variants = card.variants?.length ? card.variants : [{ card, ownership: card.ownership ?? [], totalQuantity: card.totalQuantity ?? 0 }];
  const selectedVariant = variants[Math.min(variantIndex, variants.length - 1)];
  const displayedCard = selectedVariant.card;
  const ownedFinishes = variantIndex === 0 ? (card.ownership ?? selectedVariant.ownership) : selectedVariant.ownership;
  const isOwned = ownedFinishes.length > 0;
  const quantity = ownedFinishes.find((row) => row.finish === finish)?.quantity ?? 0;
  const characterHref = `/characters/${encodeURIComponent(displayedCard.realm)}/${encodeURIComponent(displayedCard.name)}?class=${encodeURIComponent(String(displayedCard.classID))}`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const setOriginTransform = useCallback(() => {
    const motionElement = cardMotionRef.current;
    const targetElement = motionElement?.querySelector<HTMLElement>("[data-ccg-card]");
    const origin = sourceCardElement(originElement);
    if (!motionElement || !targetElement || !origin?.isConnected) return;

    const sourceBounds = origin.getBoundingClientRect();
    const targetBounds = targetElement.getBoundingClientRect();
    if (!sourceBounds.width || !targetBounds.width) return;

    const sourceX = sourceBounds.left + sourceBounds.width / 2;
    const sourceY = sourceBounds.top + sourceBounds.height / 2;
    const targetX = targetBounds.left + targetBounds.width / 2;
    const targetY = targetBounds.top + targetBounds.height / 2;
    const scale = Math.min(1, sourceBounds.width / targetBounds.width);

    motionElement.style.setProperty("--viewer-origin-x", `${sourceX - targetX}px`);
    motionElement.style.setProperty("--viewer-origin-y", `${sourceY - targetY}px`);
    motionElement.style.setProperty("--viewer-origin-scale", String(scale));
  }, [originElement]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onCloseRef.current();
      return;
    }

    setOriginTransform();
    setPhase("closing");
    closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), 340);
  }, [setOriginTransform]);

  useLayoutEffect(() => {
    setOriginTransform();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("open");
      return;
    }

    enterFrameRef.current = window.requestAnimationFrame(() => {
      enterFrameRef.current = window.requestAnimationFrame(() => setPhase("open"));
    });
  }, [setOriginTransform]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    viewerRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !viewerRef.current) return;
      const focusable = Array.from(
        viewerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!viewerRef.current.contains(document.activeElement)) {
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
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (enterFrameRef.current !== null) window.cancelAnimationFrame(enterFrameRef.current);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [requestClose]);

  const phaseClass = phase === "open" ? styles.viewerBackdropOpen : phase === "closing" ? styles.viewerBackdropClosing : "";
  const motionStyle = {
    "--viewer-origin-x": "0px",
    "--viewer-origin-y": "1.25rem",
    "--viewer-origin-scale": 0.82,
  } as CSSProperties;

  return (
    <div
      className={`${styles.viewerBackdrop} ${phaseClass}`}
      onPointerDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        ref={viewerRef}
        className={styles.viewerInspect}
        role="dialog"
        aria-modal="true"
        aria-label={displayedCard.name}
        aria-describedby="ccg-card-viewer-hint"
        tabIndex={-1}
      >
        <p id="ccg-card-viewer-hint" className="sr-only">{t("inspectCloseHint")}</p>
        <div ref={cardMotionRef} className={styles.viewerCardMotion} style={motionStyle}>
          <CollectibleCard card={displayedCard} finish={finish} quantity={isOwned ? quantity : undefined} width={520} className={styles.viewerCard} />
        </div>

        <div className={styles.viewerInfo}>
          <div className={styles.viewerSet}>{t("cardNumber", { number: String(displayedCard.setNumber).padStart(3, "0") })} · {displayedCard.set.raidName}</div>
          <h2>{displayedCard.name}</h2>
          <p className={styles.viewerIdentity}>{displayedCard.guildName ? `<${displayedCard.guildName}> · ` : ""}{formatRealmName(displayedCard.realm)}</p>

          <Link href={characterHref} className={`${styles.primaryButton} ${styles.viewerCharacterLink}`}>
            {t("viewCharacter", { name: `@${displayedCard.name}` })}
          </Link>

          {variants.length > 1 ? (
            <section className={styles.viewerControls} aria-labelledby="ccg-viewer-snapshots">
              <h3 id="ccg-viewer-snapshots">{t("collection.ownedSnapshots")}</h3>
              <div>
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
            </section>
          ) : null}

          {isOwned ? (
            <section className={styles.viewerControls} aria-labelledby="ccg-viewer-finishes">
              <h3 id="ccg-viewer-finishes">{t("finish.label")}</h3>
              <div>
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
            </section>
          ) : (
            <p className={styles.viewerNotCollected}>{t("collection.notCollected")}</p>
          )}

          <dl className={styles.viewerFacts}>
            <div><dt>{t("snapshot")}</dt><dd>{new Date(displayedCard.performanceSnapshotAt).toLocaleDateString(locale)}</dd></div>
            <div><dt>{t("collection.rarity")}</dt><dd>{t(`rarity.${CCG_RARITY_KEYS[displayedCard.tierGrade]}`)}</dd></div>
            <div><dt>{t(displayedCard.role === "healer" ? "score.healing" : "score.damage")}</dt><dd>{score(displayedCard.scores.performance)}</dd></div>
            <div><dt>{t("score.mechanics")}</dt><dd>{score(displayedCard.scores.mechanics)}</dd></div>
            <div><dt>{t("score.combined")}</dt><dd>{score(displayedCard.scores.combined)}</dd></div>
            <div><dt>{t("score.mythicPlus")}</dt><dd>{score(displayedCard.scores.mythicPlus)}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}
