"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FaMagnifyingGlassPlus } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import type { CcgRedeemResult, CcgSet } from "@/types";
import CardViewer, { openCardViewer } from "./CardViewer";
import type { CardViewerOriginBounds } from "./CardViewer";
import CollectibleCard from "./CollectibleCard";
import PackBoosterVisual, { getPackTheme } from "./PackBoosterVisual";
import styles from "./ccg.module.css";
import packStyles from "./pack-opening.module.css";

type DialogPhase = "entering" | "open" | "closing";
const MAX_REDEEM_PACK_VISUALS = 100;
type RewardPackLayout = "single" | "pair" | "fan" | "scatter" | "pile";
type RedeemCardReward = Extract<CcgRedeemResult["reward"], { type: "card" }>;
type RedeemCardViewer = RedeemCardReward & {
  originElement: HTMLElement;
  originBounds: CardViewerOriginBounds | null;
  sharedTransition: boolean;
};

function rewardPackHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rewardPackLayout(count: number): RewardPackLayout {
  if (count === 1) return "single";
  if (count === 2) return "pair";
  if (count <= 5) return "fan";
  if (count <= 20) return "scatter";
  return "pile";
}

function rewardPackVisualStyle(layout: RewardPackLayout, index: number, count: number, hash: number): CSSProperties {
  const randomX = ((hash & 0xff) / 255) - 0.5;
  const randomY = (((hash >>> 8) & 0xff) / 255) - 0.5;
  const randomRotation = (((hash >>> 16) & 0xff) / 255) - 0.5;
  const randomScale = (((hash >>> 24) & 0xff) / 255) - 0.5;
  let left = 50;
  let bottom = 1;
  let rotation = randomRotation * 2;
  let scale = 1;
  let zIndex = index + 1;

  if (layout === "pair") {
    left = index === 0 ? 42 : 58;
    bottom = index === 0 ? 0.5 : 1.5;
    rotation = (index === 0 ? -6 : 6) + randomRotation;
    scale = index === 0 ? 0.98 : 1;
  } else if (layout === "fan") {
    const progress = (index - ((count - 1) / 2)) / Math.max((count - 1) / 2, 1);
    const spread = count === 3 ? 15 : count === 4 ? 20 : 23;
    left = 50 + (progress * spread);
    bottom = 0.75 + ((1 - Math.abs(progress)) * 4.5);
    rotation = (progress * 9) + (randomRotation * 1.5);
    scale = 0.93 + ((1 - Math.abs(progress)) * 0.07);
    zIndex = 50 - Math.round(Math.abs(progress) * 10) + index;
  } else if (layout === "scatter" || layout === "pile") {
    const columnProgress = ((index * 0.61803398875) + ((randomX + 0.5) * 0.21)) % 1;
    const depthSeed = ((index * 0.41421356237) + ((randomY + 0.5) * 0.17)) % 1;
    const depthProgress = depthSeed ** 1.45;
    const horizontalInset = layout === "pile" ? 7 : 10;
    const verticalSpread = layout === "pile" ? 46 : 34;

    left = horizontalInset + (columnProgress * (100 - (horizontalInset * 2)));
    bottom = depthProgress * verticalSpread;
    rotation = randomRotation * (layout === "pile" ? 26 : 34);
    scale = layout === "pile"
      ? 0.74 + ((1 - depthProgress) * 0.23) + (randomScale * 0.14)
      : 0.82 + ((1 - depthProgress) * 0.14) + (randomScale * 0.12);
    zIndex = Math.round((1 - depthProgress) * 1000) + index;
  }

  return {
    "--reward-pack-left": `${left}%`,
    "--reward-pack-bottom": `${bottom}%`,
    "--reward-pack-rotation": `${rotation}deg`,
    "--reward-pack-scale": scale,
    "--reward-pack-z": zIndex,
  } as CSSProperties;
}

export function CcgRedeemRewardDialog({
  result,
  sets,
  isInspectingCard,
  onDismiss,
  onInspectCard,
}: {
  result: CcgRedeemResult;
  sets: CcgSet[];
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

  const openPacksHref = "/ccg/open";
  const awardedPackCount = result.reward.type === "packs" ? result.reward.packs : 0;
  const rewardPackCount = Math.min(MAX_REDEEM_PACK_VISUALS, awardedPackCount);
  const rewardPackSets = sets
    .filter((set) => set.kind === "raid" && (set.state === "current" || set.state === "legacy") && set.cardCount > 0)
    .sort((left, right) => rewardPackHash(`${result.code}:set:${left.id}`) - rewardPackHash(`${result.code}:set:${right.id}`));
  const packLayout = rewardPackLayout(rewardPackCount);

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
          <div className={styles.redeemPackRewards}>
            <div className={styles.redeemPackReward}>
              <div
                className={styles.redeemPackPile}
                data-layout={packLayout}
                aria-hidden="true"
              >
                {Array.from({ length: rewardPackCount }, (_, index) => {
                  const layoutHash = rewardPackHash(`${result.code}:layout:${index}`);
                  const rewardSet = rewardPackSets.length > 0 ? rewardPackSets[index % rewardPackSets.length] : undefined;
                  return (
                    <div
                      key={`${result.code}:${index}`}
                      className={`${packStyles.packButton} ${styles.redeemPackVisual}`}
                      data-reward-pack="true"
                      style={{
                        ...getPackTheme(rewardSet, !rewardSet),
                        ...rewardPackVisualStyle(packLayout, index, rewardPackCount, layoutHash),
                      } as CSSProperties}
                    >
                      <PackBoosterVisual
                        title={rewardSet?.raidName ?? ccg("open.allRaids")}
                        cardsLabel={ccg("landing.cards")}
                      />
                    </div>
                  );
                })}
              </div>
              <div className={styles.redeemPackCount}>
                <strong>{t("packs", { count: result.reward.packs })}</strong>
              </div>
            </div>
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

export default function CcgRedeemPanel({ sets }: { sets: CcgSet[] }) {
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
          sets={sets}
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
