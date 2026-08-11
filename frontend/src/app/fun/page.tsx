"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { FunGameSlug } from "@/types";

const GAMES: Array<{ slug: FunGameSlug; symbol: string; accent: string }> = [
  { slug: "immaculate-roster", symbol: "▦", accent: "from-emerald-500/15" },
  { slug: "guild-guessr", symbol: "⌘", accent: "from-violet-500/15" },
  { slug: "wipeprint", symbol: "⌁", accent: "from-cyan-500/15" },
  { slug: "raider-resume", symbol: "◉", accent: "from-amber-500/15" },
  { slug: "raid-connections", symbol: "⌗", accent: "from-fuchsia-500/15" },
  { slug: "lock-it-in", symbol: "↕", accent: "from-orange-500/15" },
  { slug: "suomidle", symbol: "◎", accent: "from-sky-500/15" },
  { slug: "higher-or-wipe", symbol: "⇅", accent: "from-rose-500/15" },
  { slug: "closest-without-going-over", symbol: "≤", accent: "from-blue-500/15" },
];

export default function FunPortalPage() {
  const t = useTranslations("fun");

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.1),transparent_30%),linear-gradient(to_bottom,#090d18,#111827)] px-4 py-7 text-white sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <h1 className="text-balance text-4xl font-black tracking-[-0.03em] sm:text-5xl">{t("portal.title")}</h1>
          <p className="max-w-xl text-pretty text-sm leading-6 text-slate-300 sm:text-right">{t("portal.description")}</p>
        </header>

        <Link
          href="/ccg"
          className="group relative mt-6 block min-h-36 overflow-hidden rounded-xl border border-violet-300/20 bg-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300"
        >
          <span className="absolute inset-0 bg-[url('/ccg/general_wide.webp')] bg-cover bg-center opacity-45 transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none" aria-hidden="true" />
          <span className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-slate-950/20" aria-hidden="true" />
          <span className="relative flex min-h-36 max-w-2xl flex-col justify-center p-5 sm:p-6">
            <span className="text-2xl font-black sm:text-3xl">{t("ccg.title")}</span>
            <span className="mt-1 text-sm leading-6 text-slate-300">{t("ccg.description")}</span>
            <span className="mt-2 inline-flex min-h-10 items-center text-sm font-bold text-violet-200 group-hover:text-white">
              {t("ccg.open")} <span className="ml-2" aria-hidden="true">→</span>
            </span>
          </span>
        </Link>

        <section className="mt-6" aria-label={t("portal.gamesLabel")}>
          <h2 className="text-lg font-black">{t("portal.allGames")}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GAMES.map(({ slug, symbol, accent }) => (
              <Link
                key={slug}
                href={`/fun/${slug}`}
                className={`group relative flex min-h-36 overflow-hidden rounded-xl bg-gradient-to-br ${accent} to-slate-900/70 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-[background-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_12px_34px_rgba(15,23,42,0.5),0_0_0_1px_rgba(147,197,253,0.3)] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300 motion-reduce:transform-none motion-reduce:transition-none`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-xl font-black text-blue-200 ring-1 ring-blue-300/15 transition-transform duration-200 ease-out group-hover:scale-110 group-hover:-rotate-3 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true">{symbol}</span>
                    <span className="text-balance text-lg font-black">{t(`games.${slug}.title`)}</span>
                  </span>
                  <span className="mt-3 text-pretty text-sm leading-5 text-slate-300/80">{t(`games.${slug}.description`)}</span>
                  <span className="mt-auto inline-flex items-center gap-2 pt-3 text-xs font-black uppercase tracking-wider text-blue-200">
                    {t("portal.play")} <span className="transition-transform duration-200 ease-out group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true">→</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
