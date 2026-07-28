"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FaArrowRight, FaChartSimple, FaCoins, FaNetworkWired, FaRankingStar, FaScaleBalanced } from "react-icons/fa6";
import { usePickems } from "@/lib/queries";
import type { PickemSummary } from "@/types";

const HIGHLIGHTED_PICKEM_IDS = ["midnight-s2", "rwf-midnight-s2"] as const;

const FEATURE_HIGHLIGHTS = [
  {
    id: "compare",
    href: "/analytics/compare",
    Icon: FaScaleBalanced,
    iconClassName: "bg-amber-500/10 text-amber-300 ring-amber-400/20",
  },
  {
    id: "tierLists",
    href: "/tierlists/characters",
    Icon: FaChartSimple,
    iconClassName: "bg-blue-500/10 text-blue-300 ring-blue-400/20",
  },
  {
    id: "mythicPlus",
    href: "/characters?tab=mythic-plus",
    Icon: FaRankingStar,
    iconClassName: "bg-purple-500/10 text-purple-300 ring-purple-400/20",
  },
  {
    id: "network",
    href: "/analytics/network",
    Icon: FaNetworkWired,
    iconClassName: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20",
  },
] as const;

function PickemHighlight({ pickem }: { pickem: PickemSummary }) {
  const t = useTranslations("homeHighlights");
  const locale = useLocale();
  const goldPool = pickem.prizeConfig?.enabled ? pickem.prizeConfig.goldPool : 0;
  const goldLabel =
    goldPool > 0 ? t("prizePool", { amount: new Intl.NumberFormat(locale).format(goldPool) }) : t(pickem.type === "rwf" ? "rwfPickem" : "regularPickem");

  return (
    <Link
      href={`/pickems?pickem=${encodeURIComponent(pickem.id)}`}
      title={t("openPickem", { name: pickem.name })}
      aria-label={t("openPickem", { name: pickem.name })}
      className="group grid min-h-[74px] min-w-[min(82vw,19rem)] snap-start grid-cols-[36px_minmax(0,1fr)_16px] items-center gap-2.5 rounded border border-emerald-800/70 bg-emerald-950/20 px-2.5 py-2 transition-[background-color,border-color,transform] duration-150 hover:border-emerald-600/70 hover:bg-emerald-950/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none sm:min-w-0"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-400/20">
        <FaCoins className="h-4 w-4" aria-hidden="true" />
      </span>

      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-gray-100 transition-colors group-hover:text-white">{pickem.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] font-medium">
          <span className="flex shrink-0 items-center gap-1.5 font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            {t("openNow")}
          </span>
          <span className="truncate text-amber-200/80">{goldLabel}</span>
        </span>
      </span>

      <FaArrowRight
        className="h-3.5 w-3.5 text-gray-500 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-emerald-300 motion-reduce:transform-none motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}

function PickemSkeleton() {
  return (
    <div
      className="grid min-h-[74px] min-w-[min(82vw,19rem)] snap-start grid-cols-[36px_minmax(0,1fr)] items-center gap-2.5 rounded bg-gray-800/35 px-2.5 py-2 ring-1 ring-inset ring-gray-700/60 sm:min-w-0"
      aria-hidden="true"
    >
      <span className="h-9 w-9 animate-pulse rounded-md bg-gray-700/70 motion-reduce:animate-none" />
      <span className="min-w-0 space-y-1.5">
        <span className="block h-2.5 w-16 animate-pulse rounded bg-gray-700/70 motion-reduce:animate-none" />
        <span className="block h-3.5 w-2/3 animate-pulse rounded bg-gray-700/70 motion-reduce:animate-none" />
        <span className="block h-2.5 w-1/2 animate-pulse rounded bg-gray-700/50 motion-reduce:animate-none" />
      </span>
    </div>
  );
}

export default function HomeHighlights() {
  const t = useTranslations("homeHighlights");
  const { data: pickems = [], isLoading } = usePickems();
  const pickemById = new Map(pickems.map((pickem) => [pickem.id, pickem]));
  const highlightedPickems = HIGHLIGHTED_PICKEM_IDS.map((id) => pickemById.get(id)).filter((pickem): pickem is PickemSummary => Boolean(pickem?.isVotingOpen));
  const showPickems = isLoading || highlightedPickems.length > 0;

  return (
    <section className="mb-3">
      <div
        className={`grid gap-2.5 xl:grid-rows-2 ${
          showPickems
            ? "xl:grid-cols-[minmax(12rem,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
            : "xl:grid-cols-[minmax(12rem,1.15fr)_repeat(2,minmax(0,1fr))]"
        }`}
      >
        <Link
          href="/ccg"
          className="group relative flex min-h-[132px] overflow-hidden rounded border border-blue-400/35 bg-slate-950 shadow-[0_8px_30px_rgba(15,23,42,0.35)] transition-[border-color,box-shadow,transform] duration-150 hover:border-blue-300/60 hover:shadow-[0_10px_36px_rgba(37,99,235,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none xl:row-span-2 xl:min-h-0"
        >
          <Image
            src="/ccg/general_wide.webp"
            alt=""
            fill
            sizes="(min-width: 1280px) 22vw, 100vw"
            className="object-cover opacity-55 transition-[opacity,transform] duration-300 ease-out group-hover:scale-[1.03] group-hover:opacity-65 motion-reduce:transform-none motion-reduce:transition-none"
          />
          <span className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-slate-950/70 to-blue-950/30" aria-hidden="true" />

          <span className="relative z-10 flex w-full flex-col justify-between p-3.5">
            <span className="flex items-start justify-between gap-3">
              <Image src="/ccg/ccg_logo.png" alt="" width={491} height={351} className="h-10 w-auto" />
              <span className="rounded-full bg-blue-400/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-200 ring-1 ring-inset ring-blue-300/25">
                {t("features.ccg.eyebrow")}
              </span>
            </span>

            <span className="mt-5 flex items-end justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-base font-bold text-balance text-white">{t("features.ccg.title")}</span>
                <span className="mt-1 block text-xs leading-5 text-pretty text-blue-100/75">{t("features.ccg.description")}</span>
              </span>
              <FaArrowRight
                className="mb-1 h-4 w-4 shrink-0 text-blue-200 transition-transform duration-150 ease-out group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none"
                aria-hidden="true"
              />
            </span>
          </span>
        </Link>

        {showPickems && (
          <div className="min-w-0 xl:row-span-2">
            <div className="flex snap-x gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:h-full xl:grid-cols-1 xl:grid-rows-2">
              {isLoading ? (
                <>
                  <PickemSkeleton />
                  <PickemSkeleton />
                </>
              ) : (
                highlightedPickems.map((pickem) => <PickemHighlight key={pickem.id} pickem={pickem} />)
              )}
            </div>
          </div>
        )}

        <div className="min-w-0 xl:col-span-2 xl:row-span-2">
          <div className="flex snap-x gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:h-full xl:grid-rows-2">
            {FEATURE_HIGHLIGHTS.map(({ id, href, Icon, iconClassName }) => (
              <Link
                key={id}
                href={href}
                className="group grid min-h-[74px] min-w-[min(68vw,16rem)] snap-start grid-cols-[32px_minmax(0,1fr)_16px] items-center gap-2 rounded border border-gray-700/70 bg-gray-800/45 px-2.5 py-2 transition-[background-color,border-color,transform] duration-150 hover:border-gray-600 hover:bg-gray-800/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none sm:min-w-0"
              >
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-inset ${iconClassName}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-gray-100 transition-colors group-hover:text-white motion-reduce:transition-none">
                    {t(`features.${id}.title`)}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-gray-400">{t(`features.${id}.description`)}</span>
                </span>
                <FaArrowRight
                  className="h-3.5 w-3.5 text-gray-500 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-gray-300 motion-reduce:transform-none motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
