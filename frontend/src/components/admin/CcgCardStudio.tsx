"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import { api } from "@/lib/api";
import { formatRealmName } from "@/lib/utils";
import type { CcgCard, CcgFinish, CcgTierGrade } from "@/types";

type PreviewFinish = CcgFinish | "void";

const finishes: readonly PreviewFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "negative", "void"];
const grades: readonly CcgTierGrade[] = ["S", "A", "B", "C", "D", "E", "F"];
const fieldClass = "min-h-10 w-full rounded-md border border-white/10 bg-gray-950/75 px-3 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/15";

export default function CcgCardStudio() {
  const t = useTranslations("admin.ccg.studio");
  const ccg = useTranslations("ccg");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cards, setCards] = useState<CcgCard[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finish, setFinish] = useState<PreviewFinish>("standard");
  const [tierGrade, setTierGrade] = useState<CcgTierGrade>("C");
  const [cardWidth, setCardWidth] = useState(400);
  const [guides, setGuides] = useState(false);
  const [hideCornerIcons, setHideCornerIcons] = useState(false);
  const [hideBadges, setHideBadges] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.searchAdminCcgCards(debouncedSearch, 30)
      .then((result) => {
        if (cancelled) return;
        setCards(result.cards);
        setSelectedId((current) => result.cards.some((card) => card.id === current) ? current : (result.cards[0]?.id ?? ""));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, t]);

  const selectedCard = cards.find((card) => card.id === selectedId) ?? cards[0] ?? null;
  useEffect(() => {
    if (selectedCard) setTierGrade(selectedCard.tierGrade);
  }, [selectedCard?.id]);
  const previewCard = useMemo(() => selectedCard ? { ...selectedCard, tierGrade } : null, [selectedCard, tierGrade]);

  return (
    <section className="grid min-h-[42rem] overflow-hidden rounded-lg bg-gray-900/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] xl:grid-cols-[22rem_minmax(34rem,1fr)]" aria-labelledby="ccg-card-studio-title">
      <div className="flex min-w-0 flex-col border-b border-white/8 p-4 xl:border-b-0 xl:border-r">
        <div>
          <h3 id="ccg-card-studio-title" className="text-lg font-bold text-white">{t("title")}</h3>
          <p className="mt-1 text-sm leading-6 text-gray-400">{t("description")}</p>
        </div>

        <label className="mt-4 grid gap-1.5 text-xs font-semibold text-gray-400">
          {t("search")}
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={fieldClass}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
          />
        </label>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md bg-gray-950/55 p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" aria-live="polite">
          {loading ? (
            <div className="space-y-1 p-1" aria-label={t("loading")}>
              {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded bg-gray-800/80" />)}
            </div>
          ) : error ? (
            <p className="p-3 text-sm text-red-300" role="alert">{error}</p>
          ) : cards.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {cards.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(card.id)}
                    className={`w-full rounded px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 ${selectedCard?.id === card.id ? "bg-cyan-950/65 text-white" : "text-gray-300 hover:bg-white/5"}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <strong className="truncate text-sm">{card.name} <span className="font-medium text-gray-500">· {formatRealmName(card.realm)}</span></strong>
                      <span className="shrink-0 text-xs font-bold text-cyan-300">{ccg(`rarity.${({ S: "artifact", A: "legendary", B: "epic", C: "rare", D: "uncommon", E: "common", F: "poor" } as const)[card.tierGrade]}`)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-gray-500">{card.guildName ?? ccg("independent")} · {card.set.raidName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs font-semibold text-gray-400">
            {t("quality")}
            <select className={fieldClass} value={finish} onChange={(event) => setFinish(event.target.value as PreviewFinish)}>
              {finishes.map((value) => <option key={value} value={value}>{ccg(`finish.${value}`)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-gray-400">
            {t("rarity")}
            <select className={fieldClass} value={tierGrade} onChange={(event) => setTierGrade(event.target.value as CcgTierGrade)}>
              {grades.map((grade) => <option key={grade} value={grade}>{t(`rarityNames.${grade}`)}</option>)}
            </select>
          </label>
          <label className="col-span-2 grid gap-1 text-xs font-semibold text-gray-400">
            {t("size")}
            <select className={fieldClass} value={cardWidth} onChange={(event) => setCardWidth(Number(event.target.value))}>
              {[320, 360, 400, 440].map((value) => <option key={value} value={value}>{value} px</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-gray-300">
          {[
            [t("showGuides"), guides, setGuides],
            [t("hideCornerIcons"), hideCornerIcons, setHideCornerIcons],
            [t("hideBadges"), hideBadges, setHideBadges],
          ].map(([label, checked, setter]) => (
            <label key={String(label)} className="flex min-h-9 items-center gap-2 rounded px-2 hover:bg-white/4">
              <input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="h-4 w-4 accent-cyan-500" />
              <span>{String(label)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="relative grid min-h-[42rem] place-items-center overflow-hidden bg-gray-950 p-6 [perspective:1300px]">
        <div className="absolute inset-0 opacity-20" style={previewCard ? { background: `radial-gradient(circle at 50% 45%, ${previewCard.set.theme.glow}, transparent 55%), url(${previewCard.set.backgroundPath}) center/cover` } : undefined} aria-hidden="true" />
        {previewCard ? (
          <div className="relative z-10">
            <CollectibleCard card={previewCard} finish={finish} width={cardWidth} guides={guides} hideCornerIcons={hideCornerIcons} hideBadges={hideBadges} />
          </div>
        ) : (
          <p className="relative z-10 text-sm text-gray-500">{t("selectCard")}</p>
        )}
        <p className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-xs text-gray-500">{t("previewOnly")}</p>
      </div>
    </section>
  );
}
