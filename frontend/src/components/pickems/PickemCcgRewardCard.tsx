"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PickemCcgReward } from "@/types";

interface PickemCcgRewardCardProps {
  reward: PickemCcgReward;
  isAuthenticated: boolean;
  onClaim: () => Promise<void>;
}

export function PickemCcgRewardCard({ reward, isAuthenticated, onClaim }: PickemCcgRewardCardProps) {
  const t = useTranslations("pickemsPage");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    setClaiming(true);
    setError(null);
    try {
      await onClaim();
    } catch {
      setError(t("ccgRewardClaimFailed"));
    } finally {
      setClaiming(false);
    }
  };

  const claimable = isAuthenticated && reward.eligible && !reward.claimed;

  return (
    <section className="relative overflow-hidden rounded-xl bg-gradient-to-br from-sky-950 via-slate-900 to-gray-900 p-4 shadow-[0_0_0_1px_rgba(125,211,252,0.2),0_14px_34px_rgba(2,8,23,0.28)]">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-36 opacity-35" aria-hidden="true">
        <div className="absolute -right-5 top-3 h-32 w-24 rotate-[11deg] rounded-lg bg-[url('/ccg/general_tall.webp')] bg-cover bg-center shadow-2xl" />
        <div className="absolute right-12 top-8 h-28 w-20 -rotate-[8deg] rounded-lg bg-[url('/ccg/general_tall.webp')] bg-cover bg-center shadow-xl" />
        <div className="absolute inset-0 bg-gradient-to-l from-transparent via-slate-950/10 to-slate-950" />
      </div>

      <div className="relative max-w-[75%]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">{t("ccgRewardEyebrow")}</p>
        <h3 className="mt-1 text-balance text-lg font-semibold text-white">
          {t("ccgRewardTitle", { count: reward.packs })}
        </h3>

        <div className="mt-3" aria-live="polite">
          {reward.claimed ? (
            <div>
              <p className="text-pretty text-sm font-medium text-emerald-300">
                {t("ccgRewardClaimed", { count: reward.packs })}
              </p>
              <Link
                href="/ccg/open"
                className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-emerald-500 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none"
              >
                {t("ccgRewardOpenPacks")}
              </Link>
            </div>
          ) : claimable ? (
            <button
              type="button"
              onClick={() => void claim()}
              disabled={claiming}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-[background-color,transform] duration-150 ease-out hover:bg-sky-500 active:scale-[0.96] disabled:cursor-wait disabled:bg-sky-800 disabled:text-sky-200 motion-reduce:transform-none motion-reduce:transition-none"
            >
              <span className="tabular-nums">
                {claiming ? t("ccgRewardClaiming") : t("ccgRewardClaim", { count: reward.packs })}
              </span>
            </button>
          ) : (
            <p className="text-pretty text-sm text-slate-300">
              {t(isAuthenticated ? "ccgRewardSubmitFirst" : "ccgRewardSignIn")}
            </p>
          )}

          {error && (
            <div className="mt-3" role="alert">
              <p className="text-pretty text-sm text-red-300">{error}</p>
              <button
                type="button"
                onClick={() => void claim()}
                className="mt-2 min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-red-200 underline underline-offset-2 transition-[color,transform] duration-150 hover:text-white active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none"
              >
                {t("retry")}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
