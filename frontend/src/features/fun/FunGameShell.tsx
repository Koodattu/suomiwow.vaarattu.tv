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
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.1),transparent_32%),linear-gradient(to_bottom,#090d18,#111827)] px-4 py-6 text-white sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/fun" className="inline-flex min-h-11 items-center text-sm font-semibold text-slate-400 transition-colors hover:text-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
              <span aria-hidden="true">←</span>&nbsp;{t("common.back")}
            </Link>
            <h1 className="text-balance text-3xl font-black tracking-[-0.03em] sm:text-4xl">{t(`games.${game}.title`)}</h1>
            <p className="mt-1 max-w-3xl text-pretty text-sm leading-6 text-slate-300">{t(`games.${game}.description`)}</p>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading}
            className="min-h-11 shrink-0 rounded-md border border-blue-400/45 bg-blue-600/80 px-5 py-2.5 text-sm font-bold text-white transition-[background-color,transform] hover:bg-blue-500 active:not-disabled:scale-[0.96] disabled:cursor-wait disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
          >
            {loading ? t("common.generating") : hasRound ? t("common.newGame") : t("common.generate")}
          </button>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-400/25 bg-red-950/45 p-4 text-sm text-red-100" role="alert">
            <p>{t("common.generationFailed")}</p>
            <button type="button" onClick={onGenerate} disabled={loading} className="mt-3 min-h-10 rounded-md bg-red-900 px-4 py-2 font-semibold hover:bg-red-800 disabled:opacity-50">
              {t("common.retry")}
            </button>
          </div>
        ) : null}

        {!hasRound && loading ? (
          <div className="mt-5 grid min-h-64 place-items-center rounded-xl border border-white/10 bg-slate-900/60 p-8 text-center text-slate-400" aria-live="polite">
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
