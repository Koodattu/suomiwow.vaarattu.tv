"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FaMagnifyingGlassPlus } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { applyPackPointerMotion, resetPackMotion } from "@/lib/ccg-pack-motion";
import type { CcgRedeemResult, CcgSet } from "@/types";
import CardViewer, { openCardViewer } from "./CardViewer";
import type { CardViewerOriginBounds } from "./CardViewer";
import CollectibleCard from "./CollectibleCard";
import PackBoosterVisual, { getPackTheme } from "./PackBoosterVisual";
import styles from "./ccg.module.css";
import packStyles from "./pack-opening.module.css";

type DialogPhase = "entering" | "open" | "closing";
type RedeemCardReward = Extract<CcgRedeemResult["reward"], { type: "card" }>;
type RedeemCardViewer = RedeemCardReward & {
  originElement: HTMLElement;
  originBounds: CardViewerOriginBounds | null;
  sharedTransition: boolean;
};

function CcgRedeemRewardDialog({
  result,
  currentSet,
  isInspectingCard,
  onDismiss,
  onInspectCard,
}: {
  result: CcgRedeemResult;
  currentSet?: CcgSet;
  isInspectingCard: boolean;
  onDismiss: () => void;
  onInspectCard: (viewer: RedeemCardViewer) => void;
}) {
  const t = useTranslations("ccg.redeem");
  const ccg = useTranslations("ccg");
  const [phase, setPhase] = useState<DialogPhase>("entering");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const inspectingCardRef = useRef(isInspectingCard);

  useEffect(() => {
    inspectingCardRef.current = isInspectingCard;
  }, [isInspectingCard]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDismiss();
      return;
    }
    setPhase("closing");
    closeTimerRef.current = window.setTimeout(onDismiss, 170);
  }, [onDismiss]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPhase("open"));
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (inspectingCardRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === dialogRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
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
      window.cancelAnimationFrame(frame);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!inspectingCardRef.current && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [requestClose]);

  const inspectCard = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const reward = result.reward;
    if (reward.type !== "card") return;
    const originElement = event.currentTarget;
    openCardViewer(originElement, (sharedTransition, originBounds) => {
      inspectingCardRef.current = true;
      onInspectCard({
        ...reward,
        originElement,
        originBounds,
        sharedTransition,
      });
    }, event);
  };

  const openPacksHref = result.reward.type === "packs"
    ? result.reward.currentPacks > 0 && result.reward.legacyPacks === 0
      ? "/ccg/open?mode=current"
      : result.reward.legacyPacks > 0 && result.reward.currentPacks === 0
        ? "/ccg/open?mode=legacy"
        : "/ccg/open"
    : "/ccg/open";
  const awardedPackCount = result.reward.type === "packs"
    ? result.reward.currentPacks + result.reward.legacyPacks
    : 0;

  const updatePackMotion = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    applyPackPointerMotion(event.currentTarget, event.clientX, event.clientY);
  };

  return (
    <div
      className={styles.redeemDialogBackdrop}
      data-phase={phase}
      inert={isInspectingCard ? true : undefined}
      onPointerDown={requestClose}
    >
      <div
        ref={dialogRef}
        className={styles.redeemDialog}
        role="dialog"
        aria-modal={isInspectingCard ? undefined : "true"}
        aria-labelledby="ccg-redeem-reward-title"
        aria-describedby="ccg-redeem-reward-hint"
        tabIndex={-1}
      >
        <div className={styles.redeemDialogHeading}>
          <h2 id="ccg-redeem-reward-title">{t("successTitle")}</h2>
          <p>{t("successSummary", { code: result.code })}</p>
        </div>

        {result.reward.type === "packs" ? (
          <div className={styles.redeemPackRewards} data-reward-count={awardedPackCount}>
            {result.reward.currentPacks > 0 ? (
              <div className={styles.redeemPackReward} data-mode="current">
                <div
                  className={`${packStyles.packButton} ${styles.redeemPackVisual}`}
                  style={{ ...getPackTheme(currentSet), cursor: "pointer" }}
                  onPointerMove={updatePackMotion}
                  onPointerLeave={(event) => resetPackMotion(event.currentTarget)}
                  onPointerCancel={(event) => resetPackMotion(event.currentTarget)}
                  aria-hidden="true"
                >
                  <PackBoosterVisual title={currentSet?.raidName ?? ccg("open.currentTier")} cardsLabel={ccg("landing.cards")} />
                </div>
                <div className={styles.redeemPackCount}>
                  <strong>{result.reward.currentPacks}</strong>
                  <span>{t("currentPacks", { count: result.reward.currentPacks })}</span>
                </div>
              </div>
            ) : null}
            {result.reward.legacyPacks > 0 ? (
              <div className={styles.redeemPackReward} data-mode="legacy">
                <div
                  className={`${packStyles.packButton} ${styles.redeemPackVisual}`}
                  style={{ ...getPackTheme(undefined, true), cursor: "pointer" }}
                  onPointerMove={updatePackMotion}
                  onPointerLeave={(event) => resetPackMotion(event.currentTarget)}
                  onPointerCancel={(event) => resetPackMotion(event.currentTarget)}
                  aria-hidden="true"
                >
                  <PackBoosterVisual title={ccg("open.legacyPackTitle")} cardsLabel={ccg("landing.cards")} />
                </div>
                <div className={styles.redeemPackCount}>
                  <strong>{result.reward.legacyPacks}</strong>
                  <span>{t("legacyPacks", { count: result.reward.legacyPacks })}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.redeemCardReward}>
            <button
              type="button"
              className={styles.redeemRewardCardButton}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={inspectCard}
              aria-label={t("inspectCard", { name: result.reward.card.name })}
            >
              <CollectibleCard card={result.reward.card} finish={result.reward.finish} artVariant={result.reward.artVariant} compact />
              <span className={styles.redeemInspectHint}><FaMagnifyingGlassPlus aria-hidden="true" /> {t("tapToInspect")}</span>
            </button>
          </div>
        )}

        <div className={styles.redeemDialogActions} onPointerDown={(event) => event.stopPropagation()}>
          {result.reward.type === "packs" ? (
            <Link href={openPacksHref} className={styles.primaryButton}>{t("openPacks")}</Link>
          ) : (
            <Link href="/ccg/collection" className={styles.primaryButton}>{t("viewCollection")}</Link>
          )}
          <button
            type="button"
            className={styles.secondaryButton}
            onPointerDown={(event) => {
              event.stopPropagation();
              requestClose();
            }}
            onClick={requestClose}
          >
            {t("closeAction")}
          </button>
        </div>
        <p id="ccg-redeem-reward-hint" className={styles.redeemDialogHint}>{t("tapAnywhereToClose")}</p>
      </div>
    </div>
  );
}

function redeemErrorMessage(error: unknown, t: ReturnType<typeof useTranslations<"ccg.redeem">>): string {
  if (!(error instanceof ApiError)) return t("errors.generic");
  if (error.code === "authentication_required") return t("errors.login");
  if (error.code === "invalid_redeem_code") return t("errors.invalid");
  if (error.code === "redeem_code_not_found") return t("errors.notFound");
  if (error.code === "redeem_code_already_used") return t("errors.alreadyUsed");
  if (error.code === "rate_limited") return t("errors.rateLimited");
  if (error.code === "reward_unavailable") return t("errors.rewardUnavailable");
  return t("errors.generic");
}

export default function CcgRedeemPanel({ currentSet }: { currentSet?: CcgSet }) {
  const t = useTranslations("ccg.redeem");
  const { user, isLoading: authLoading, login } = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [result, setResult] = useState<CcgRedeemResult | null>(null);
  const [cardViewer, setCardViewer] = useState<RedeemCardViewer | null>(null);

  const redeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    if (!user || normalizedCode.length < 3 || redeeming) return;
    setRedeeming(true);
    setError(null);
    try {
      const redeemed = await api.redeemCcgCode(normalizedCode);
      setCode("");
      setResult(redeemed);
      void queryClient.invalidateQueries({ queryKey: ["ccg"] });
    } catch (redeemError) {
      setError(redeemErrorMessage(redeemError, t));
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <>
      <div className={styles.redeemPanel}>
        <div className={styles.redeemPanelCopy}>
          <h2>{t("title")}</h2>
          <p>{user ? t("description") : t("guestDescription")}</p>
        </div>
        {authLoading ? (
          <div className={styles.redeemPanelSkeleton} aria-label={t("loading")} />
        ) : user ? (
          <form className={styles.redeemForm} onSubmit={redeem}>
            <label className="sr-only" htmlFor="ccg-redeem-code">{t("codeLabel")}</label>
            <input
              id="ccg-redeem-code"
              type="text"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                if (error) setError(null);
              }}
              placeholder={t("placeholder")}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              disabled={redeeming}
              aria-describedby={error ? "ccg-redeem-error" : undefined}
            />
            <button type="submit" className={`${styles.primaryButton} ${styles.redeemSubmitButton}`} disabled={code.trim().length < 3 || redeeming}>{redeeming ? t("redeeming") : t("action")}</button>
          </form>
        ) : (
          <button type="button" className={`${styles.secondaryButton} ${styles.redeemLoginButton}`} onClick={() => void login("/ccg")}>{t("login")}</button>
        )}
        {error ? <p id="ccg-redeem-error" className={styles.redeemError} role="alert">{error}</p> : null}
      </div>
      {result ? (
        <CcgRedeemRewardDialog
          result={result}
          currentSet={currentSet}
          isInspectingCard={Boolean(cardViewer)}
          onDismiss={() => setResult(null)}
          onInspectCard={setCardViewer}
        />
      ) : null}
      {cardViewer ? (
        <CardViewer
          card={cardViewer.card}
          initialFinish={cardViewer.finish}
          initialArtVariant={cardViewer.artVariant}
          originElement={cardViewer.originElement}
          originBounds={cardViewer.originBounds}
          sharedTransition={cardViewer.sharedTransition}
          onClose={() => setCardViewer(null)}
        />
      ) : null}
    </>
  );
}
