"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import IconImage from "@/components/IconImage";
import type { GuildProfileHighlightMember, GuildProfileHighlightTopPerformer, GuildProfileHighlights as GuildProfileHighlightsData } from "@/types";
import { formatRealmName, getClassInfoById } from "@/lib/utils";

const CLASS_COLORS: Record<string, string> = {
  "Death Knight": "#C41E3A",
  "Demon Hunter": "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

type HighlightCardItem = GuildProfileHighlightMember | GuildProfileHighlightTopPerformer;

function getClassColor(className: string) {
  return CLASS_COLORS[className] ?? "#D1D5DB";
}

function isTopPerformer(item: HighlightCardItem): item is GuildProfileHighlightTopPerformer {
  return "score" in item;
}

function formatShortDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "-";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return "-";
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

function getItemHref(item: HighlightCardItem) {
  if (item.kind === "account" && item.accountSlug) {
    return `/accounts/${encodeURIComponent(item.accountSlug)}`;
  }

  return `/characters/${encodeURIComponent(item.realm)}/${encodeURIComponent(item.name)}?class=${encodeURIComponent(String(item.classID))}`;
}

function HighlightCard({ item }: { item: HighlightCardItem }) {
  const t = useTranslations("guildProfileHighlights");
  const classInfo = getClassInfoById(item.classID);
  const isAccount = item.kind === "account";
  const topPerformer = isTopPerformer(item) ? item : null;
  const href = getItemHref(item);
  const title = isAccount ? `${item.name} (${t("inferredAccount")})` : `${item.name}-${formatRealmName(item.realm)}`;

  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      className="group grid min-h-[74px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-gray-700/70 bg-gray-800/45 px-2.5 py-2 transition-colors hover:border-gray-600 hover:bg-gray-800/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
    >
      <span className="relative h-9 w-9 overflow-hidden rounded">
        <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
      </span>

      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-bold leading-tight" style={{ color: getClassColor(classInfo.name) }}>
            {item.name}
          </span>
          {isAccount ? (
            <span className="shrink-0 rounded bg-blue-950/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-blue-300">{t("account")}</span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-semibold text-gray-500">
          {isAccount ? t("characterCount", { count: item.characterCount }) : formatRealmName(item.realm)}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-gray-400">
          {topPerformer ? (
            <>
              <span className="tabular-nums">{t("pulls", { count: topPerformer.pulls })}</span>
              <span className="truncate">{topPerformer.raidName}</span>
            </>
          ) : (
            <>
              <span>{t("since", { date: formatShortDate(item.firstSeenAt) })}</span>
              <span className="tabular-nums">{t("raids", { count: item.raidCount })}</span>
            </>
          )}
          <span className="tabular-nums">{t("reports", { count: item.reportCount })}</span>
        </span>
      </span>

      <span className="ml-1 flex min-w-[44px] flex-col items-end leading-none">
        {topPerformer ? (
          <>
            <span className="text-base font-bold tabular-nums text-gray-100">{formatScore(topPerformer.score)}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase text-gray-500">{topPerformer.metric}</span>
          </>
        ) : (
          <>
            <span className="text-xs font-bold tabular-nums text-gray-200">{formatShortDate(item.firstSeenAt)}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase text-gray-500">{t("firstSeen")}</span>
          </>
        )}
      </span>
    </Link>
  );
}

function HighlightList({ title, items }: { title: string; items: HighlightCardItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
        <span className="text-[11px] font-semibold tabular-nums text-gray-600">{items.length}/6</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{items.map((item) => <HighlightCard key={`${item.kind}-${item.accountGroupId ?? item.characterId ?? item.name}-${item.realm}`} item={item} />)}</div>
    </div>
  );
}

export default function GuildProfileHighlights({ highlights }: { highlights?: GuildProfileHighlightsData | null }) {
  const t = useTranslations("guildProfileHighlights");
  const mainstays = highlights?.mainstays ?? [];
  const topPerformers = highlights?.topPerformers ?? [];

  if (mainstays.length === 0 && topPerformers.length === 0) {
    return null;
  }

  return (
    <section className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
      <HighlightList title={t("mainstays")} items={mainstays} />
      <HighlightList title={t("topPerformers")} items={topPerformers} />
    </section>
  );
}
