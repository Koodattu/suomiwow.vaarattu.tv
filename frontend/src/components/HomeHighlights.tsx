"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FaArrowRight, FaChartSimple, FaCoins, FaNetworkWired, FaRankingStar, FaScaleBalanced } from "react-icons/fa6";
import { usePickems } from "@/lib/queries";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import packStyles from "@/components/ccg/pack-opening.module.css";
import type { CcgCard, CcgSet, PickemSummary } from "@/types";

const HIGHLIGHTED_PICKEM_IDS = ["midnight-s2", "rwf-midnight-s2"] as const;

const CCG_PROMO_SET = {
  id: "6a652d042348af33dde6f6da",
  slug: "march-on-queldanas",
  zoneId: 46,
  raidName: "March on Quel'Danas",
  expansionName: "Midnight",
  state: "legacy",
  kind: "raid",
  enabledAt: "2026-07-26T07:36:23.287Z",
  themeKey: "queldanas",
  theme: { mark: "MQD", accent: "#46CFFF", glow: "rgba(70, 207, 255, 0.35)" },
  customFinish: { key: "void", hardPity: 250 },
  backgroundPath: "/ccg/march-on-queldanas-desktop.jpg",
  packArtOffsetX: 57,
  cardCount: 911,
  ownedCards: 0,
  publicationWave: 1,
  lastPublishedAt: "2026-07-26T07:36:22.092Z",
} satisfies CcgSet;

const CCG_PROMO_YOLOBOLT_CARD = {
  id: "6a65b8f6505fc5b8bd7197ab",
  characterId: "698cd13057d282dad2e1db28",
  setNumber: 519,
  snapshotVersion: 1,
  snapshotKey: "march-on-queldanas:2026-07-26",
  name: "Yolobolt",
  realm: "kazzak",
  region: "eu",
  guildId: "690789b7cac26f9ef1fc4ebd",
  guildName: "Tuju",
  guildRealm: "Kazzak",
  classID: 10,
  specName: "demonology",
  role: "dps",
  metric: "dps",
  itemLevel: 288,
  scores: { performance: 73.1, mechanics: 59.1, combined: 66.1, mythicPlus: 3737.8 },
  tierGrade: "D",
  avatarUrl: "https://render.worldofwarcraft.com/eu/character/kazzak/115/87645299-avatar.jpg",
  renderUrl: "https://render.worldofwarcraft.com/eu/character/kazzak/115/87645299-main-raw.png",
  alternativeArt: null,
  quip: null,
  backgroundCrop: { x: 30.96, y: 46.93, scale: 1.109 },
  performanceSnapshotAt: "2026-07-26T07:36:21.457Z",
  mediaCapturedAt: "2026-07-25T22:37:18.050Z",
  publicationWave: 1,
  publishedAt: "2026-07-26T07:36:22.092Z",
  set: CCG_PROMO_SET,
} satisfies CcgCard;

const CCG_PROMO_LAKU_CARD = {
  id: "6a65b8f6505fc5b8bd7195d2",
  characterId: "69caa03355d67a743ef46daf",
  setNumber: 46,
  snapshotVersion: 1,
  snapshotKey: "march-on-queldanas:2026-07-26",
  name: "Laku",
  realm: "stormreaver",
  region: "eu",
  guildId: "690bc8fc9c728d953ba60d9b",
  guildName: "Tony Halme Pro Skater",
  guildRealm: "Stormreaver",
  classID: 4,
  specName: "frost",
  role: "dps",
  metric: "dps",
  itemLevel: 290,
  scores: { performance: 97, mechanics: 64.9, combined: 81, mythicPlus: 2868 },
  tierGrade: "S",
  avatarUrl: "https://render.worldofwarcraft.com/eu/character/stormreaver/117/186501237-avatar.jpg",
  renderUrl: "https://render.worldofwarcraft.com/eu/character/stormreaver/117/186501237-main-raw.png",
  alternativeArt: {
    characterArtFilename: "laku_clap.png",
    characterArtPath: "/ccg/alternative/character/laku_clap.png",
    characterArtEnabled: true,
    backgroundArtFilename: null,
    backgroundArtPath: null,
    backgroundArtEnabled: false,
  },
  quip: { text: "Boom", audioFilename: "lakuclap.mp3", audioPath: "/ccg/audio/quips/lakuclap.mp3" },
  backgroundCrop: { x: 26.36, y: 45.3, scale: 1.122 },
  performanceSnapshotAt: "2026-07-26T07:36:21.457Z",
  mediaCapturedAt: "2026-07-25T22:06:39.054Z",
  publicationWave: 1,
  publishedAt: "2026-07-26T07:36:22.092Z",
  set: CCG_PROMO_SET,
} satisfies CcgCard;

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
  const formattedGold = new Intl.NumberFormat(locale).format(goldPool);
  const goldLabel =
    goldPool > 0 ? t("prizePool", { amount: formattedGold }) : t(pickem.type === "rwf" ? "rwfPickem" : "regularPickem");
  const mobileGoldLabel = goldPool > 0 ? t("mobilePrizePool", { amount: formattedGold }) : null;
  const mobileName = t(pickem.type === "rwf" ? "mobileRwfPickem" : "mobileSuomiPickem");

  return (
    <Link
      href={`/pickems?pickem=${encodeURIComponent(pickem.id)}`}
      title={t("openPickem", { name: pickem.name })}
      aria-label={t("openPickem", { name: pickem.name })}
      className="group grid min-h-[54px] grid-cols-[28px_minmax(0,1fr)] items-center gap-1.5 rounded border border-emerald-800/70 bg-emerald-950/20 px-2 py-1.5 transition-[background-color,border-color,transform] duration-150 hover:border-emerald-600/70 hover:bg-emerald-950/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[68px] sm:grid-cols-[36px_minmax(0,1fr)_16px] sm:gap-2.5 sm:px-2.5 sm:py-2"
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-400/20 sm:h-9 sm:w-9">
        <FaCoins className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
      </span>

      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-gray-100 transition-colors group-hover:text-white sm:text-sm">
          <span className="sm:hidden">{mobileName}</span>
          <span className="hidden sm:inline">{pickem.name}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] font-medium sm:text-[11px]">
          <span className="flex shrink-0 items-center gap-1.5 font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="sm:hidden">{t("mobileOpen")}</span>
            <span className="hidden sm:inline">{t("openNow")}</span>
          </span>
          <span className="truncate text-amber-200/80">
            <span className="sm:hidden">{mobileGoldLabel}</span>
            <span className="hidden sm:inline">{goldLabel}</span>
          </span>
        </span>
      </span>

      <FaArrowRight
        className="hidden h-3.5 w-3.5 text-gray-500 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-emerald-300 motion-reduce:transform-none motion-reduce:transition-none sm:block"
        aria-hidden="true"
      />
    </Link>
  );
}

function PickemSkeleton() {
  return (
    <div
      className="grid min-h-[54px] grid-cols-[28px_minmax(0,1fr)] items-center gap-1.5 rounded bg-gray-800/35 px-2 py-1.5 ring-1 ring-inset ring-gray-700/60 sm:min-h-[68px] sm:grid-cols-[36px_minmax(0,1fr)] sm:gap-2.5 sm:px-2.5 sm:py-2"
      aria-hidden="true"
    >
      <span className="h-7 w-7 animate-pulse rounded-md bg-gray-700/70 motion-reduce:animate-none sm:h-9 sm:w-9" />
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
  const ccg = useTranslations("ccg");
  const { data: pickems = [], isLoading } = usePickems();
  const pickemById = new Map(pickems.map((pickem) => [pickem.id, pickem]));
  const highlightedPickems = HIGHLIGHTED_PICKEM_IDS.map((id) => pickemById.get(id)).filter((pickem): pickem is PickemSummary => Boolean(pickem?.isVotingOpen));
  const showPickems = isLoading || highlightedPickems.length > 0;

  return (
    <section className="mb-3">
      <div
        className={`grid gap-2 sm:gap-2.5 xl:grid-rows-2 ${
          showPickems
            ? "xl:grid-cols-[minmax(12rem,1.43fr)_minmax(0,1fr)_minmax(0,0.86fr)_minmax(0,0.86fr)]"
            : "xl:grid-cols-[minmax(12rem,1.43fr)_repeat(2,minmax(0,0.86fr))]"
        }`}
      >
        <Link
          href="/ccg"
          className="group relative z-0 flex min-h-[102px] rounded border border-blue-400/35 bg-slate-950 shadow-[0_8px_30px_rgba(15,23,42,0.35)] transition-[border-color,box-shadow,transform] duration-150 hover:z-10 hover:border-blue-300/60 hover:shadow-[0_10px_36px_rgba(37,99,235,0.22)] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[124px] xl:row-span-2 xl:min-h-0"
        >
          <span className="absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
            <Image
              src="/ccg/general_wide.webp"
              alt=""
              fill
              sizes="(min-width: 1280px) 22vw, 100vw"
              className="object-cover opacity-75 transition-opacity duration-300 ease-out group-hover:opacity-85 motion-reduce:transition-none"
            />
            <span className="absolute inset-0 bg-gradient-to-br from-slate-950/85 via-slate-950/45 to-blue-950/10" />
          </span>

          <span className="pointer-events-none absolute -top-4 right-6 z-20 h-[calc(100%+1.5rem)] w-36 sm:-right-3 sm:w-[17rem] xl:right-2" aria-hidden="true">
            <span className="absolute bottom-3 left-0 z-10 h-[7.4rem] w-[4.9rem] -rotate-[9deg] drop-shadow-[0_9px_9px_rgba(0,0,0,0.55)] transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:-rotate-[12deg] motion-reduce:transform-none motion-reduce:transition-none sm:bottom-2 sm:-left-2">
              <span className="absolute bottom-0 left-0 w-[300px] origin-bottom-left scale-[0.225] sm:scale-[0.316]">
                <span className={packStyles.packButton} style={getPackTheme(CCG_PROMO_SET)}>
                  <PackBoosterVisual title={CCG_PROMO_SET.raidName} cardsLabel={ccg("landing.cards")} />
                </span>
              </span>
            </span>

            <span className="absolute bottom-2 left-[4.75rem] z-20 hidden h-[7.7rem] w-[5.5rem] -rotate-[1deg] drop-shadow-[0_10px_10px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-out group-hover:-translate-y-2 motion-reduce:transform-none motion-reduce:transition-none sm:block">
              <span className="absolute bottom-0 left-0 w-[410px] origin-bottom-left scale-[0.261]">
                <CollectibleCard card={CCG_PROMO_LAKU_CARD} finish="golden" width={400} forcedPointer={{ x: 0.4, y: 0.24 }} />
              </span>
            </span>

            <span className="absolute -right-2 bottom-2 z-30 h-[7.7rem] w-[5.5rem] rotate-[5deg] sm:hidden">
              <span className="absolute right-0 bottom-0 w-[410px] origin-bottom-right scale-[0.2]">
                <CollectibleCard card={CCG_PROMO_YOLOBOLT_CARD} finish="standard" width={400} renderPriority />
              </span>
            </span>

            <span className="absolute right-0 bottom-2 z-30 hidden h-[7.7rem] w-[5.5rem] rotate-[9deg] drop-shadow-[0_10px_10px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:rotate-[12deg] motion-reduce:transform-none motion-reduce:transition-none sm:block">
              <span className="absolute right-0 bottom-0 w-[410px] origin-bottom-right scale-[0.261]">
                <CollectibleCard card={CCG_PROMO_YOLOBOLT_CARD} finish="prismatic" width={400} forcedPointer={{ x: 0.7, y: 0.28 }} renderPriority />
              </span>
            </span>
          </span>

          <span className="relative z-10 flex w-full flex-col justify-between p-2.5 pr-36 sm:p-3.5 sm:pr-[7.25rem]">
            <span className="flex items-center gap-2">
              <Image src="/logo.png" alt="" width={1187} height={536} className="h-8 w-auto sm:h-10" />
              <Image src="/ccg/ccg_logo.png" alt="" width={491} height={351} className="h-8 w-auto sm:h-10" />
            </span>

            <span className="mt-2 flex items-end justify-between gap-3 sm:mt-5">
              <span className="min-w-0">
                <span className="block text-base font-bold text-balance text-white">{t("features.ccg.title")}</span>
                <span className="mt-1 block text-xs leading-5 text-pretty text-blue-100/75">{t("features.ccg.description")}</span>
              </span>
              <FaArrowRight
                className="mb-1 hidden h-4 w-4 shrink-0 text-blue-200 transition-transform duration-150 ease-out group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none sm:block"
                aria-hidden="true"
              />
            </span>
          </span>
        </Link>

        {showPickems && (
          <div className="min-w-0 xl:row-span-2">
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 xl:h-full xl:grid-cols-1 xl:grid-rows-2">
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
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2 xl:h-full xl:grid-rows-2">
            {FEATURE_HIGHLIGHTS.map(({ id, href, Icon, iconClassName }) => (
              <Link
                key={id}
                href={href}
                className="group grid min-h-[50px] grid-cols-[28px_minmax(0,1fr)] items-center gap-1.5 rounded border border-gray-700/70 bg-gray-800/45 px-2 py-1 transition-[background-color,border-color,transform] duration-150 hover:border-gray-600 hover:bg-gray-800/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[68px] sm:grid-cols-[32px_minmax(0,1fr)_16px] sm:gap-2 sm:px-2.5 sm:py-2"
              >
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset sm:h-8 sm:w-8 ${iconClassName}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs leading-4 font-semibold text-gray-100 transition-colors group-hover:text-white motion-reduce:transition-none sm:text-[13px]">
                    {t(`features.${id}.title`)}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] leading-3 text-gray-400 sm:text-[11px] sm:leading-normal">
                    <span className="sm:hidden">{t(`features.${id}.mobileDescription`)}</span>
                    <span className="hidden sm:inline">{t(`features.${id}.description`)}</span>
                  </span>
                </span>
                <FaArrowRight
                  className="hidden h-3.5 w-3.5 text-gray-500 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-gray-300 motion-reduce:transform-none motion-reduce:transition-none sm:block"
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
