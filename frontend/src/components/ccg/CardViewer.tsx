"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { FaVolumeHigh } from "react-icons/fa6";
import type { CcgArtVariant, CcgCard, CcgFinish } from "@/types";
import { bestOwnedFinish, CCG_RARITY_KEYS } from "@/lib/ccg";
import { playCcgInspectSound, playCcgQuip } from "@/lib/ccg-audio";
import { formatRealmName } from "@/lib/utils";
import CollectibleCard from "./CollectibleCard";
import styles from "./ccg.module.css";

type ViewerPhase = "entering" | "open" | "closing";
type ViewTransitionHandle = { finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionHandle;
};

const CARD_VIEW_TRANSITION_NAME = "ccg-card-inspect";
export type CardViewerOriginBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;

function sourceCardElement(originElement: HTMLElement | null): HTMLElement | null {
  return originElement?.querySelector<HTMLElement>("[data-ccg-card]")
    ?? originElement?.querySelector<HTMLElement>("[data-card-surface]")
    ?? originElement;
}

function canUseCardViewTransition(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  return typeof (document as ViewTransitionDocument).startViewTransition === "function"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clearCardViewTransition(element: HTMLElement | null) {
  element?.style.removeProperty("view-transition-name");
  delete document.documentElement.dataset.ccgCardTransition;
}

export function openCardViewer(
  originElement: HTMLElement | null,
  update: (sharedTransition: boolean, originBounds: CardViewerOriginBounds | null) => void,
) {
  playCcgInspectSound();
  const source = sourceCardElement(originElement);
  const viewTransitionDocument = document as ViewTransitionDocument;
  if (!source?.isConnected) {
    update(false, null);
    return;
  }
  const { left, top, width, height } = source.getBoundingClientRect();
  const originBounds = { left, top, width, height };
  if (!canUseCardViewTransition() || !viewTransitionDocument.startViewTransition) {
    update(false, originBounds);
    return;
  }

  source.style.setProperty("view-transition-name", CARD_VIEW_TRANSITION_NAME);
  document.documentElement.dataset.ccgCardTransition = "opening";

  try {
    const transition = viewTransitionDocument.startViewTransition(() => {
      source.style.removeProperty("view-transition-name");
      flushSync(() => update(true, originBounds));
    });
    void transition.finished.finally(() => clearCardViewTransition(source));
  } catch {
    clearCardViewTransition(source);
    update(false, originBounds);
  }
}

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(value >= 1000 ? 0 : 1);
}

export default function CardViewer({
  card,
  initialFinish = "standard",
  initialArtVariant = "standard",
  originElement = null,
  originBounds = null,
  sharedTransition = false,
  onClose,
}: {
  card: CcgCard;
  initialFinish?: CcgFinish;
  initialArtVariant?: CcgArtVariant;
  originElement?: HTMLElement | null;
  originBounds?: CardViewerOriginBounds | null;
  sharedTransition?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("ccg");
  const locale = useLocale();
  const variants = card.variants?.length ? card.variants : [{ card, ownership: card.ownership ?? [], totalQuantity: card.totalQuantity ?? 0 }];
  const clickedVariantIndex = Math.max(0, variants.findIndex((variant) => variant.card.id === card.id));
  const initialVariant = variants[clickedVariantIndex];
  const requestedInitialOwnership = initialVariant.ownership.find((row) => row.finish === initialFinish && row.artVariant === initialArtVariant);
  const bestInitialOwnership = bestOwnedFinish({ ...initialVariant.card, ownership: initialVariant.ownership });
  const [finish, setFinish] = useState<CcgFinish>(requestedInitialOwnership?.finish ?? bestInitialOwnership?.finish ?? initialFinish);
  const [artVariant, setArtVariant] = useState<CcgArtVariant>(requestedInitialOwnership?.artVariant ?? bestInitialOwnership?.artVariant ?? initialArtVariant);
  const [variantIndex, setVariantIndex] = useState(clickedVariantIndex);
  const [phase, setPhase] = useState<ViewerPhase>(sharedTransition ? "open" : "entering");
  const viewerRef = useRef<HTMLDivElement>(null);
  const cardMotionRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const enterFrameRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const selectedVariant = variants[Math.min(variantIndex, variants.length - 1)];
  const displayedCard = selectedVariant.card;
  const ownership = selectedVariant.ownership;
  const ownedArtVariants = (["standard", "alternative"] as const).filter((value) => ownership.some((row) => row.artVariant === value));
  const ownedFinishes = ownership.filter((row) => row.artVariant === artVariant);
  const isOwned = ownership.length > 0;
  const quantity = ownedFinishes.find((row) => row.finish === finish)?.quantity ?? 0;
  const characterHref = `/characters/${encodeURIComponent(displayedCard.realm)}/${encodeURIComponent(displayedCard.name)}?class=${encodeURIComponent(String(displayedCard.classID))}`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!card.quip?.audioPath) return;
    const timer = window.setTimeout(() => playCcgQuip(card.quip?.audioPath), sharedTransition ? 240 : 360);
    return () => window.clearTimeout(timer);
  }, [card.quip?.audioPath, sharedTransition]);

  const setOriginTransform = useCallback(() => {
    const motionElement = cardMotionRef.current;
    const targetElement = motionElement?.querySelector<HTMLElement>("[data-ccg-card]");
    const origin = sourceCardElement(originElement);
    if (!motionElement || !targetElement) return;

    const sourceBounds = originBounds ?? (origin?.isConnected ? origin.getBoundingClientRect() : null);
    const targetBounds = targetElement.getBoundingClientRect();
    if (!sourceBounds?.width || !targetBounds.width) return;

    const sourceX = sourceBounds.left + sourceBounds.width / 2;
    const sourceY = sourceBounds.top + sourceBounds.height / 2;
    const targetX = targetBounds.left + targetBounds.width / 2;
    const targetY = targetBounds.top + targetBounds.height / 2;
    const scale = Math.min(1, sourceBounds.width / targetBounds.width);

    motionElement.style.setProperty("--viewer-origin-x", `${sourceX - targetX}px`);
    motionElement.style.setProperty("--viewer-origin-y", `${sourceY - targetY}px`);
    motionElement.style.setProperty("--viewer-origin-scale", String(scale));
  }, [originBounds, originElement]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    playCcgInspectSound();

    const origin = sourceCardElement(originElement);
    const target = cardMotionRef.current?.querySelector<HTMLElement>("[data-ccg-card]");
    const viewTransitionDocument = document as ViewTransitionDocument;
    if (
      sharedTransition
      && origin?.isConnected
      && target
      && canUseCardViewTransition()
      && viewTransitionDocument.startViewTransition
    ) {
      document.documentElement.dataset.ccgCardTransition = "closing";
      try {
        const transition = viewTransitionDocument.startViewTransition(() => {
          origin.style.setProperty("view-transition-name", CARD_VIEW_TRANSITION_NAME);
          flushSync(() => onCloseRef.current());
        });
        void transition.finished.finally(() => clearCardViewTransition(origin));
        return;
      } catch {
        clearCardViewTransition(origin);
      }
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onCloseRef.current();
      return;
    }

    setOriginTransform();
    setPhase("closing");
    closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), 340);
  }, [originElement, setOriginTransform, sharedTransition]);

  useLayoutEffect(() => {
    const source = sourceCardElement(originElement);
    const hiddenOrigin = source?.closest<HTMLElement>("button") ?? source;
    const originVisibility = hiddenOrigin?.style.visibility ?? "";
    if (hiddenOrigin?.isConnected) {
      hiddenOrigin.style.visibility = "hidden";
    }

    if (!sharedTransition) {
      setOriginTransform();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setPhase("open");
      } else {
        enterFrameRef.current = window.requestAnimationFrame(() => {
          enterFrameRef.current = window.requestAnimationFrame(() => setPhase("open"));
        });
      }
    }

    return () => {
      if (hiddenOrigin?.isConnected) hiddenOrigin.style.visibility = originVisibility;
    };
  }, [originElement, setOriginTransform, sharedTransition]);

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
          <CollectibleCard
            card={displayedCard}
            finish={finish}
            artVariant={artVariant}
            quantity={isOwned ? quantity : undefined}
            width={520}
            className={styles.viewerCard}
            viewTransitionName={sharedTransition ? CARD_VIEW_TRANSITION_NAME : undefined}
          />
        </div>

        <div className={styles.viewerInfo}>
          <div className={styles.viewerSet}>{t("cardNumber", { number: String(displayedCard.setNumber).padStart(3, "0") })} · {displayedCard.set.raidName}</div>
          <h2>{displayedCard.name}</h2>
          <p className={styles.viewerIdentity}>{displayedCard.guildName ? `<${displayedCard.guildName}> · ` : ""}{formatRealmName(displayedCard.realm)}</p>

          {displayedCard.quip ? (
            <div className={styles.viewerQuip}>
              {displayedCard.quip.text ? <blockquote>{displayedCard.quip.text}</blockquote> : null}
              {displayedCard.quip.audioPath ? (
                <button
                  type="button"
                  className={styles.viewerQuipButton}
                  onClick={() => playCcgQuip(displayedCard.quip?.audioPath)}
                  aria-label={t("playQuip", { name: displayedCard.name })}
                  title={t("playQuip", { name: displayedCard.name })}
                >
                  <FaVolumeHigh aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

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
                      const best = bestOwnedFinish({ ...variant.card, ownership: variant.ownership });
                      setVariantIndex(index);
                      setFinish(best?.finish ?? "standard");
                      setArtVariant(best?.artVariant ?? "standard");
                    }}
                    className={variantIndex === index ? styles.primaryButton : styles.secondaryButton}
                  >
                    {variant.card.set.raidName}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {ownedArtVariants.length > 1 ? (
            <section className={styles.viewerControls} aria-labelledby="ccg-viewer-artwork">
              <h3 id="ccg-viewer-artwork">{t("artwork.label")}</h3>
              <div>
                {ownedArtVariants.map((value) => (
                  <button
                    type="button"
                    aria-pressed={artVariant === value}
                    key={value}
                    onClick={() => {
                      const sameFinish = ownership.find((row) => row.artVariant === value && row.finish === finish);
                      const best = bestOwnedFinish({ ...displayedCard, ownership }, value);
                      setArtVariant(value);
                      setFinish(sameFinish?.finish ?? best?.finish ?? "standard");
                    }}
                    className={artVariant === value ? styles.primaryButton : styles.secondaryButton}
                  >
                    {t(`artwork.${value}`)}
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
            {displayedCard.set.kind === "community" ? <div><dt>{t("cardType")}</dt><dd>{t("communityCard")}</dd></div> : null}
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
