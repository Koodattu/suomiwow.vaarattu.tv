"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { PickemCcgReward } from "@/types";

// Temporary: once the pack-opening promotion ends, set this to false so claimed
// rewards remain in the "Claimed" state instead of linking to the pack opener.
const SHOW_OPEN_PACKS_AFTER_CLAIM = true;
const CLAIMED_CONFIRMATION_DURATION_MS = 1200;

interface PickemCcgRewardCardProps {
  reward: PickemCcgReward;
  isAuthenticated: boolean;
  onClaim: () => Promise<void>;
}

export function PickemCcgRewardCard({ reward, isAuthenticated, onClaim }: PickemCcgRewardCardProps) {
  const t = useTranslations("pickemsPage");
  const [claiming, setClaiming] = useState(false);
  const [showClaimedConfirmation, setShowClaimedConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claimedConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (claimedConfirmationTimeoutRef.current) {
        clearTimeout(claimedConfirmationTimeoutRef.current);
      }
    };
  }, []);

  const claim = async () => {
    setClaiming(true);
    setError(null);
    try {
      await onClaim();
      setShowClaimedConfirmation(true);

      if (SHOW_OPEN_PACKS_AFTER_CLAIM) {
        claimedConfirmationTimeoutRef.current = setTimeout(() => {
          setShowClaimedConfirmation(false);
        }, CLAIMED_CONFIRMATION_DURATION_MS);
      }
    } catch {
      setError(t("ccgRewardClaimFailed"));
    } finally {
      setClaiming(false);
    }
  };

  const claimable = isAuthenticated && reward.eligible && !reward.claimed;

  return (
    <section className="relative overflow-hidden rounded-xl px-4 py-4 shadow-[0_0_0_1px_rgba(125,211,252,0.2),0_14px_34px_rgba(2,8,23,0.28)]">
      <div className="pointer-events-none absolute inset-0 bg-[url('/ccg/general_wide.webp')] bg-cover bg-center" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/75 to-slate-950/40" aria-hidden="true" />

      <div className="relative flex min-h-12 items-center justify-between gap-4">
        <h3 className="min-w-0 text-balance text-base font-semibold text-white sm:text-lg">
          {t("ccgRewardTitle", { count: reward.packs })}
        </h3>

        <div className="shrink-0" aria-live="polite">
          {reward.claimed && (showClaimedConfirmation || !SHOW_OPEN_PACKS_AFTER_CLAIM) ? (
            <span className="inline-flex min-h-11 items-center rounded-lg bg-emerald-950/70 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-[0_0_0_1px_rgba(110,231,183,0.2)]">
              {t("ccgRewardClaimed")}
            </span>
          ) : reward.claimed ? (
            <Link
              href="/ccg/open"
              className="inline-flex min-h-11 items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-[background-color,transform] duration-150 ease-out hover:bg-emerald-500 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none"
            >
              {t("ccgRewardOpenPacks")}
            </Link>
          ) : claimable ? (
            <button
              type="button"
              onClick={() => void claim()}
              disabled={claiming}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-[background-color,transform] duration-150 ease-out hover:bg-sky-500 active:scale-[0.96] disabled:cursor-wait disabled:bg-sky-800 disabled:text-sky-200 motion-reduce:transform-none motion-reduce:transition-none"
            >
              <span className="tabular-nums">
                {claiming ? t("ccgRewardClaiming") : error ? t("retry") : t("ccgRewardClaim")}
              </span>
            </button>
          ) : (
            <span className="inline-flex min-h-10 items-center rounded-lg bg-slate-950/55 px-3 py-2 text-xs font-medium text-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
              {t(isAuthenticated ? "ccgRewardSubmitFirst" : "ccgRewardSignIn")}
            </span>
          )}
        </div>
      </div>

      {error && <p className="relative mt-2 text-pretty text-xs text-red-300" role="alert">{error}</p>}
    </section>
  );
}
