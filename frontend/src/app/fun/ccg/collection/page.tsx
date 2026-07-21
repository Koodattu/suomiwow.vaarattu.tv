"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CcgCard, CcgFinish, CcgTierGrade } from "@/types";
import { useCcgCatalog, useCcgSession, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";

const grades: CcgTierGrade[] = ["Crown", "S", "A", "B", "C", "D", "E", "F"];
const finishOrder: CcgFinish[] = ["prismatic", "golden", "standard"];

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
  const [page, setPage] = useState(1);
  const [owned, setOwned] = useState<"all" | "owned" | "missing">("all");
  const [grade, setGrade] = useState("");
  const [viewerCard, setViewerCard] = useState<CcgCard | null>(null);
  const catalogQuery = useCcgCatalog(setSlug, page, owned, grade);
  const selectedSet = sets.find((set) => set.slug === setSlug);

  useEffect(() => {
    if (setSlug || sets.length === 0) return;
    const requested = new URLSearchParams(window.location.search).get("set");
    const next = sets.find((set) => set.slug === requested) ?? sets.find((set) => set.state === "current") ?? sets[0];
    setSetSlug(next.slug);
  }, [sets, setSlug]);

  const completion = useMemo(() => {
    if (!selectedSet?.cardCount) return 0;
    return Math.round((selectedSet.ownedCards / selectedSet.cardCount) * 100);
  }, [selectedSet]);

  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };

  if (sessionQuery.isError || setsQuery.isError) {
    return <CcgShell><div className="mx-auto max-w-3xl px-4 py-12"><CcgLoadError onRetry={() => { void sessionQuery.refetch(); void setsQuery.refetch(); }} /></div></CcgShell>;
  }

  return (
    <CcgShell>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {sessionQuery.data ? <GuestNotice session={sessionQuery.data} /> : null}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className={styles.eyebrow}>{t("nav.collection")}</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">{t("collection.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{t("collection.body")}</p>
          </div>
          {selectedSet ? (
            <div className="min-w-60 text-sm">
              <div className="flex justify-between text-slate-400"><span>{selectedSet.raidName}</span><span className="tabular-nums">{selectedSet.ownedCards}/{selectedSet.cardCount}</span></div>
              <div className={`${styles.progressTrack} mt-2`}><div className={styles.progressFill} style={{ width: `${completion}%`, background: `linear-gradient(90deg, ${selectedSet.theme.accent}, #9478ff)` }} /></div>
            </div>
          ) : null}
        </header>

        <section className="flex gap-3 overflow-x-auto pb-2" aria-label={t("collection.sets")}>
          {sets.map((set) => (
            <button
              type="button"
              aria-pressed={set.slug === setSlug}
              key={set.id}
              onClick={() => { setSetSlug(set.slug); setPage(1); }}
              className={`relative min-h-24 min-w-52 overflow-hidden rounded-lg border bg-cover bg-center p-3 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${set.slug === setSlug ? "border-cyan-300/55" : "border-white/10"}`}
              style={{ backgroundImage: `linear-gradient(180deg, rgba(2,6,15,.22), rgba(2,6,15,.93)), url("${set.backgroundPath}")` }}
            >
              <span className="text-[0.62rem] font-black uppercase tracking-widest" style={{ color: set.theme.accent }}>{set.state === "current" ? t("mode.current") : t("mode.legacy")}</span>
              <span className="mt-5 block text-sm font-black text-white">{set.raidName}</span>
              <span className="mt-1 block text-[0.65rem] tabular-nums text-slate-400">{set.ownedCards}/{set.cardCount}</span>
            </button>
          ))}
        </section>

        <section className={`${styles.panel} flex flex-wrap items-center gap-3 p-4`}>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t("collection.cards")}
            <select value={owned} onChange={(event) => updateFilter(() => setOwned(event.target.value as typeof owned))} className="ml-2 min-h-10 rounded-md border border-white/10 bg-slate-950 px-3 text-sm font-medium normal-case tracking-normal text-slate-200">
              <option value="all">{t("collection.all")}</option>
              <option value="owned">{t("collection.owned")}</option>
              <option value="missing">{t("collection.missing")}</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t("tier")}
            <select value={grade} onChange={(event) => updateFilter(() => setGrade(event.target.value))} className="ml-2 min-h-10 rounded-md border border-white/10 bg-slate-950 px-3 text-sm font-medium normal-case tracking-normal text-slate-200">
              <option value="">{t("collection.allGrades")}</option>
              {grades.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </section>

        <section className={styles.binder} aria-busy={catalogQuery.isLoading}>
          {catalogQuery.isLoading ? (
            <div className={styles.binderGrid}>{Array.from({ length: 9 }, (_, index) => <div key={index} className="aspect-[5/7] animate-pulse rounded-xl bg-white/5" />)}</div>
          ) : catalogQuery.isError ? (
            <div className="grid min-h-80 place-items-center px-5"><CcgLoadError onRetry={() => void catalogQuery.refetch()} /></div>
          ) : catalogQuery.data?.cards.length ? (
            <div className={styles.binderGrid}>
              {catalogQuery.data.cards.map((card) => {
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
              <div><h2 className="text-lg font-black text-white">{t("collection.emptyTitle")}</h2><p className="mt-2 text-sm text-slate-500">{t("collection.emptyBody")}</p></div>
            </div>
          )}
          {catalogQuery.data && catalogQuery.data.pages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button type="button" className={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("collection.previous")}</button>
              <span className="text-xs tabular-nums text-slate-500">{t("collection.page", { page, pages: catalogQuery.data.pages })}</span>
              <button type="button" className={styles.secondaryButton} disabled={page >= catalogQuery.data.pages} onClick={() => setPage((value) => value + 1)}>{t("collection.next")}</button>
            </div>
          ) : null}
        </section>
      </div>
      {viewerCard ? <CardViewer card={viewerCard} initialFinish={bestFinish(viewerCard)?.finish ?? "standard"} onClose={() => setViewerCard(null)} /> : null}
    </CcgShell>
  );
}
