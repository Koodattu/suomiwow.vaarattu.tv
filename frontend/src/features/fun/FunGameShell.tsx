"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { FunGameSlug } from "@/types";

type FunGameShellProps = {
  game: FunGameSlug;
  loading: boolean;
  error: string | null;
  hasRound: boolean;
  onGenerate: () => void;
  children: ReactNode;
};

export default function FunGameShell({ game, loading, error, hasRound, onGenerate, children }: FunGameShellProps) {
  const t = useTranslations("fun");

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0b1020] px-4 py-5 text-white sm:py-7">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-white/10 pb-4">
          <div className="flex items-center justify-between gap-4">
            <Link href="/fun" className="inline-flex min-h-10 items-center text-sm font-semibold text-slate-400 transition-colors hover:text-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
              <span aria-hidden="true">←</span>&nbsp;{t("common.back")}
            </Link>
            <button
              type="button"
              onClick={onGenerate}
              disabled={loading}
              className="min-h-10 shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] hover:bg-blue-500 active:not-disabled:scale-[0.97] disabled:cursor-wait disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
            >
              {loading ? t("common.generating") : hasRound ? t("common.newGame") : t("common.generate")}
            </button>
          </div>
          <h1 className="mt-1 text-balance text-3xl font-black tracking-[-0.03em] sm:text-4xl">{t(`games.${game}.title`)}</h1>
          <p className="mt-1 max-w-3xl text-pretty text-sm leading-5 text-slate-300">{t(`games.${game}.description`)}</p>
        </header>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-400/25 bg-red-950/45 p-4 text-sm text-red-100" role="alert">
            <p>{t("common.generationFailed")}</p>
            <button type="button" onClick={onGenerate} disabled={loading} className="mt-3 min-h-10 rounded-md bg-red-900 px-4 py-2 font-semibold hover:bg-red-800 disabled:opacity-50">
              {t("common.retry")}
            </button>
          </div>
        ) : null}

        {!hasRound && loading ? (
          <div className="mt-5 grid min-h-48 place-items-center border-y border-white/10 py-8 text-center text-slate-400" aria-live="polite">
            <div>
              <div className="mx-auto size-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-300 motion-reduce:animate-none" aria-hidden="true" />
              <p className="mt-4 text-sm font-semibold">{t("common.generating")}</p>
            </div>
          </div>
        ) : (
          <div className={loading && hasRound ? "pointer-events-none opacity-60" : ""} aria-busy={loading}>
            {children}
          </div>
        )}
      </div>
    </main>
  );
}
