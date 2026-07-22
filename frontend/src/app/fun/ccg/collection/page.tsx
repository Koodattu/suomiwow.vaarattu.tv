"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CcgCard, CcgFinish, CcgTierGrade } from "@/types";
import { useCcgCatalog, useCcgCollection, useCcgSession, useCcgSetGuilds, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";

const grades: CcgTierGrade[] = ["S", "A", "B", "C", "D", "E", "F"];
const finishOrder: CcgFinish[] = ["prismatic", "golden", "standard"];

type CollectionView = "all" | "guild";

function bestFinish(card: CcgCard): { finish: CcgFinish; quantity: number; total: number } | null {
  if (!card.ownership?.length) return null;
  const row = finishOrder.map((finish) => card.ownership!.find((item) => item.finish === finish)).find(Boolean);
  return row ? { finish: row.finish, quantity: row.quantity, total: card.ownership.reduce((sum, item) => sum + item.quantity, 0) } : null;
}

export default function CcgCollectionPage() {
  const t = useTranslations("ccg");
  const sessionQuery = useCcgSession();
  const setsQuery = useCcgSets();
  const sets = setsQuery.data?.sets ?? [];
  const [setSlug, setSetSlug] = useState("");
  const [view, setView] = useState<CollectionView>("all");
  const [guildId, setGuildId] = useState("");
  const [guildSearch, setGuildSearch] = useState("");
  const [includeMissing, setIncludeMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [grade, setGrade] = useState("");
  const [viewerCard, setViewerCard] = useState<CcgCard | null>(null);
  const selectedSet = sets.find((set) => set.slug === setSlug);
  const guildsQuery = useCcgSetGuilds(setSlug, view === "guild");
  const guilds = guildsQuery.data?.guilds ?? [];
  const canLoadCards = view === "all" || Boolean(guildId);
  const showCatalog = view === "guild" && Boolean(guildId) && includeMissing;
  const ownedQuery = useCcgCollection(
    {
      page,
      limit: 9,
      set: setSlug || undefined,
      grade: grade || undefined,
      guild: view === "guild" ? guildId || undefined : undefined,
    },
    Boolean(setSlug) && canLoadCards && !showCatalog,
  );
  const catalogQuery = useCcgCatalog(setSlug, page, "all", grade, guildId, showCatalog);
  const cardsData = showCatalog ? catalogQuery.data : ownedQuery.data;
  const cardsLoading = showCatalog ? catalogQuery.isLoading : ownedQuery.isLoading;
  const cardsError = showCatalog ? catalogQuery.isError : ownedQuery.isError;

  useEffect(() => {
    if (setSlug || sets.length === 0) return;
    const requested = new URLSearchParams(window.location.search).get("set");
    const next = sets.find((set) => set.slug === requested) ?? sets.find((set) => set.state === "current") ?? sets[0];
    setSetSlug(next.slug);
  }, [sets, setSlug]);

  useEffect(() => {
    if (!guildId || guilds.some((guild) => guild.id === guildId)) return;
    setGuildId("");
    setIncludeMissing(false);
    setPage(1);
  }, [guildId, guilds]);

  const completion = useMemo(() => {
    if (!selectedSet?.cardCount) return 0;
    return Math.round((selectedSet.ownedCards / selectedSet.cardCount) * 100);
  }, [selectedSet]);

  const guildOptions = useMemo(() => {
    const query = guildSearch.trim().toLocaleLowerCase();
    const filtered = query
      ? guilds.filter((guild) => `${guild.name} ${guild.realm}`.toLocaleLowerCase().includes(query))
      : guilds;
    const selected = guilds.find((guild) => guild.id === guildId);
    return selected && !filtered.some((guild) => guild.id === selected.id) ? [selected, ...filtered] : filtered;
  }, [guildId, guildSearch, guilds]);

  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };

  const selectSet = (nextSlug: string) => {
    setSetSlug(nextSlug);
    setGuildId("");
    setGuildSearch("");
    setIncludeMissing(false);
    setPage(1);
  };

  const selectView = (nextView: CollectionView) => {
    setView(nextView);
    setIncludeMissing(false);
    setPage(1);
  };

  const retryCards = () => {
    if (guildsQuery.isError) {
      void guildsQuery.refetch();
      return;
    }
    if (showCatalog) void catalogQuery.refetch();
    else void ownedQuery.refetch();
  };

  if (sessionQuery.isError || setsQuery.isError) {
    return (
      <CcgShell>
        <div className="mx-auto max-w-3xl px-4 py-12">
          <CcgLoadError onRetry={() => { void sessionQuery.refetch(); void setsQuery.refetch(); }} />
        </div>
      </CcgShell>
    );
  }

  return (
    <CcgShell>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {sessionQuery.data ? <GuestNotice session={sessionQuery.data} /> : null}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className={styles.eyebrow}>{t("nav.collection")}</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-white [text-wrap:balance] sm:text-4xl">{t("collection.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 [text-wrap:pretty]">{t("collection.body")}</p>
          </div>
          {selectedSet ? (
            <div className="min-w-60 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>{selectedSet.raidName}</span>
                <span className="tabular-nums">{selectedSet.ownedCards}/{selectedSet.cardCount}</span>
              </div>
              <div className={`${styles.progressTrack} mt-2`}>
                <div className={styles.progressFill} style={{ transform: `scaleX(${completion / 100})`, background: `linear-gradient(90deg, ${selectedSet.theme.accent}, #9478ff)` }} />
              </div>
            </div>
          ) : null}
        </header>

        <section className="flex gap-3 overflow-x-auto pb-2" aria-label={t("collection.sets")}>
          {sets.map((set) => (
            <button
              type="button"
              aria-pressed={set.slug === setSlug}
              key={set.id}
              onClick={() => selectSet(set.slug)}
              className={`relative min-h-24 min-w-52 overflow-hidden rounded-lg border bg-cover bg-center p-3 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${set.slug === setSlug ? "border-cyan-300/55" : "border-white/10"}`}
              style={{ backgroundImage: `linear-gradient(180deg, rgba(2,6,15,.22), rgba(2,6,15,.93)), url("${set.backgroundPath}")` }}
            >
              <span className="text-[0.62rem] font-black uppercase tracking-widest" style={{ color: set.theme.accent }}>{set.state === "current" ? t("mode.current") : t("mode.legacy")}</span>
              <span className="mt-5 block text-sm font-black text-white">{set.raidName}</span>
              <span className="mt-1 block text-[0.65rem] tabular-nums text-slate-400">{set.ownedCards}/{set.cardCount}</span>
            </button>
          ))}
        </section>

        <section className={`${styles.panel} space-y-4 p-4`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("collection.viewLabel")}</div>
              <div className="mt-2 flex gap-2" role="group" aria-label={t("collection.viewLabel")}>
                {(["all", "guild"] as CollectionView[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    className={view === option ? styles.primaryButton : styles.secondaryButton}
                    onClick={() => selectView(option)}
                  >
                    {t(option === "all" ? "collection.allView" : "collection.guildView")}
                  </button>
                ))}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-5 text-slate-400">
                {t(view === "all" ? "collection.allViewBody" : "collection.guildViewBody")}
              </p>
            </div>

            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {t("tier")}
              <select
                value={grade}
                onChange={(event) => updateFilter(() => setGrade(event.target.value))}
                className="ml-2 min-h-10 rounded-md border border-white/10 bg-slate-950 px-3 text-sm font-medium normal-case tracking-normal text-slate-200"
              >
                <option value="">{t("collection.allGrades")}</option>
                {grades.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>

          {view === "guild" ? (
            <div className="grid gap-3 border-t border-white/10 pt-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(280px,1.3fr)_auto] lg:items-end">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t("collection.searchGuilds")}
                <input
                  type="search"
                  value={guildSearch}
                  onChange={(event) => setGuildSearch(event.target.value)}
                  placeholder={t("collection.searchGuildsPlaceholder")}
                  className="mt-2 block min-h-11 w-full rounded-md border border-white/10 bg-slate-950 px-3 text-sm font-medium normal-case tracking-normal text-slate-100 placeholder:text-slate-500"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t("collection.guild")}
                <select
                  value={guildId}
                  onChange={(event) => updateFilter(() => { setGuildId(event.target.value); setIncludeMissing(false); })}
                  className="mt-2 block min-h-11 w-full rounded-md border border-white/10 bg-slate-950 px-3 text-sm font-medium normal-case tracking-normal text-slate-200"
                >
                  <option value="">{t("collection.selectGuild")}</option>
                  {guildOptions.map((guild) => (
                    <option key={guild.id} value={guild.id}>
                      {t("collection.guildOption", {
                        name: guild.name,
                        realm: guild.realm,
                        collected: guild.collectedCards,
                        total: guild.cardCount,
                      })}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2" role="group" aria-label={t("collection.cardVisibility")}>
                <button
                  type="button"
                  disabled={!guildId}
                  aria-pressed={!includeMissing}
                  className={!includeMissing ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => updateFilter(() => setIncludeMissing(false))}
                >
                  {t("collection.collectedOnly")}
                </button>
                <button
                  type="button"
                  disabled={!guildId}
                  aria-pressed={includeMissing}
                  className={includeMissing ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => updateFilter(() => setIncludeMissing(true))}
                >
                  {t("collection.showMissing")}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className={styles.binder} aria-busy={cardsLoading}>
          {view === "guild" && guildsQuery.isLoading ? (
            <div className={styles.binderGrid}>{Array.from({ length: 6 }, (_, index) => <div key={index} className="aspect-[5/7] animate-pulse rounded-xl bg-white/5" />)}</div>
          ) : view === "guild" && guildsQuery.isError ? (
            <div className="grid min-h-80 place-items-center px-5"><CcgLoadError onRetry={retryCards} /></div>
          ) : view === "guild" && !guildId ? (
            <div className="grid min-h-80 place-items-center px-5 text-center">
              <div>
                <h2 className="text-lg font-black text-white">{t(guilds.length ? "collection.selectGuildTitle" : "collection.noGuildsTitle")}</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{t(guilds.length ? "collection.selectGuildBody" : "collection.noGuildsBody")}</p>
              </div>
            </div>
          ) : cardsLoading ? (
            <div className={styles.binderGrid}>{Array.from({ length: 9 }, (_, index) => <div key={index} className="aspect-[5/7] animate-pulse rounded-xl bg-white/5" />)}</div>
          ) : cardsError ? (
            <div className="grid min-h-80 place-items-center px-5"><CcgLoadError onRetry={retryCards} /></div>
          ) : cardsData?.cards.length ? (
            <div className={styles.binderGrid}>
              {cardsData.cards.map((card) => {
                const ownedFinish = bestFinish(card);
                return (
                  <div className={styles.binderPocket} key={card.id}>
                    {ownedFinish ? (
                      <CollectibleCard card={card} finish={ownedFinish.finish} quantity={ownedFinish.total} compact onSelect={() => setViewerCard(card)} />
                    ) : (
                      <button type="button" className={`${styles.missingCard} w-full`} onClick={() => setViewerCard(card)} aria-label={`${t("collection.missing")} #${card.setNumber}`}>
                        <span>#{String(card.setNumber).padStart(3, "0")}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-80 place-items-center px-5 text-center">
              <div>
                <h2 className="text-lg font-black text-white">{t(view === "all" ? "collection.emptyOwnedTitle" : "collection.emptyGuildTitle")}</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                  {t(view === "all" ? "collection.emptyOwnedBody" : includeMissing ? "collection.emptyGuildMissingBody" : "collection.emptyGuildBody")}
                </p>
                {view === "all" ? (
                  <Link href={`/fun/ccg/open?mode=${selectedSet?.state === "legacy" ? "legacy" : "current"}`} className={`${styles.primaryButton} mt-4`}>
                    {t("collection.openPacks")}
                  </Link>
                ) : null}
              </div>
            </div>
          )}
          {cardsData && cardsData.pages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button type="button" className={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("collection.previous")}</button>
              <span className="text-xs tabular-nums text-slate-500">{t("collection.page", { page, pages: cardsData.pages })}</span>
              <button type="button" className={styles.secondaryButton} disabled={page >= cardsData.pages} onClick={() => setPage((value) => value + 1)}>{t("collection.next")}</button>
            </div>
          ) : null}
        </section>
      </div>
      {viewerCard ? <CardViewer card={viewerCard} initialFinish={bestFinish(viewerCard)?.finish ?? "standard"} onClose={() => setViewerCard(null)} /> : null}
    </CcgShell>
  );
}
