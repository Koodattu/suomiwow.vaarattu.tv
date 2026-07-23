"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { CcgCard, CcgTierGrade } from "@/types";
import { bestOwnedFinish } from "@/lib/ccg";
import { useCcgCatalog, useCcgCollection, useCcgSession, useCcgSetGuilds, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";

const grades: CcgTierGrade[] = ["S", "A", "B", "C", "D", "E", "F"];
const cardsPerPage = 10;
type CollectionView = "all" | "guild";

function PageArrow({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={direction === "previous" ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CcgCollectionPage() {
  const t = useTranslations("ccg");
  const sessionQuery = useCcgSession();
  const setsQuery = useCcgSets();
  const sets = setsQuery.data?.sets ?? [];
  const [setSlug, setSetSlug] = useState("");
  const [view, setView] = useState<CollectionView>("all");
  const [guildId, setGuildId] = useState("");
  const [includeMissing, setIncludeMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [grade, setGrade] = useState("");
  const [viewerCard, setViewerCard] = useState<CcgCard | null>(null);
  const selectedSet = sets.find((set) => set.slug === setSlug);
  const guildsQuery = useCcgSetGuilds(setSlug, view === "guild");
  const guilds = useMemo(
    () => [...(guildsQuery.data?.guilds ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm)),
    [guildsQuery.data?.guilds],
  );
  const showCatalog = view === "guild" && includeMissing;
  const ownedQuery = useCcgCollection(
    {
      page,
      limit: cardsPerPage,
      set: setSlug || undefined,
      grade: grade || undefined,
      guild: view === "guild" ? guildId || undefined : undefined,
    },
    Boolean(setSlug) && !showCatalog,
  );
  const catalogQuery = useCcgCatalog(setSlug, page, "all", grade, guildId, showCatalog, cardsPerPage);
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
    setPage(1);
  }, [guildId, guilds]);

  useEffect(() => {
    if (!cardsData || page <= cardsData.pages || cardsData.pages === 0) return;
    setPage(cardsData.pages);
  }, [cardsData, page]);

  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };

  const selectSet = (nextSlug: string) => {
    setSetSlug(nextSlug);
    setGuildId("");
    setIncludeMissing(false);
    setPage(1);
  };

  const selectView = (nextView: CollectionView) => {
    setView(nextView);
    setGuildId("");
    setIncludeMissing(false);
    setPage(1);
  };

  const retryCards = () => {
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
    <CcgShell
      compact
      context={(
        <div className={styles.openHeaderContext}>
          <header className={styles.openHeaderIntro}>
            <div className={styles.eyebrow}>{t("nav.collection")}</div>
            <h1 className={styles.openHeaderTitle}>{t("collection.title")}</h1>
            <p className={styles.openHeaderBody}>{t("collection.body")}</p>
          </header>
          {sessionQuery.data ? <GuestNotice session={sessionQuery.data} compact /> : null}
        </div>
      )}
    >
      <div className={styles.collectionPage}>
        <section className={styles.collectionToolbar}>
          <div className={styles.collectionSetRail} role="group" aria-label={t("collection.sets")}>
            {sets.map((set) => (
              <button
                type="button"
                aria-pressed={set.slug === setSlug}
                key={set.id}
                onClick={() => selectSet(set.slug)}
                className={styles.collectionSet}
                style={{
                  "--set-accent": set.theme.accent,
                  backgroundImage: `linear-gradient(90deg, rgba(2,6,15,.9), rgba(2,6,15,.54)), url("${set.backgroundPath}")`,
                } as CSSProperties}
              >
                <span>{set.raidName}</span>
                <small>{set.ownedCards}/{set.cardCount}</small>
              </button>
            ))}
          </div>

          <div className={styles.collectionFilters}>
            <div className={styles.collectionSegment} role="group" aria-label={t("collection.viewLabel")}>
              {(["all", "guild"] as CollectionView[]).map((option) => (
                <button key={option} type="button" aria-pressed={view === option} onClick={() => selectView(option)}>
                  {t(option === "all" ? "collection.allView" : "collection.guildView")}
                </button>
              ))}
            </div>

            {view === "guild" ? (
              <>
                <label className={styles.collectionSelect}>
                  <span>{t("collection.guild")}</span>
                  <select value={guildId} onChange={(event) => updateFilter(() => setGuildId(event.target.value))} disabled={guildsQuery.isLoading}>
                    <option value="">{t("collection.allGuilds")}</option>
                    {guilds.map((guild) => (
                      <option key={guild.id} value={guild.id}>
                        {t("collection.guildOption", { name: guild.name, realm: guild.realm, collected: guild.collectedCards, total: guild.cardCount })}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.collectionSegment} role="group" aria-label={t("collection.cardVisibility")}>
                  <button type="button" aria-pressed={!includeMissing} onClick={() => updateFilter(() => setIncludeMissing(false))}>
                    {t("collection.collectedOnly")}
                  </button>
                  <button type="button" aria-pressed={includeMissing} onClick={() => updateFilter(() => setIncludeMissing(true))}>
                    {t("collection.showMissing")}
                  </button>
                </div>
              </>
            ) : null}

            <label className={styles.collectionSelect}>
              <span>{t("tier")}</span>
              <select value={grade} onChange={(event) => updateFilter(() => setGrade(event.target.value))}>
                <option value="">{t("collection.allGrades")}</option>
                {grades.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            {cardsData && cardsData.pages > 0 ? (
              <span className={styles.collectionPageCount}>{t("collection.page", { page, pages: cardsData.pages })}</span>
            ) : null}
          </div>
        </section>

        <section className={styles.collectionBinder} aria-busy={cardsLoading}>
          <button
            type="button"
            className={styles.collectionPageTurn}
            disabled={!cardsData || page <= 1}
            onClick={() => setPage((value) => value - 1)}
            aria-label={t("collection.previous")}
          >
            <PageArrow direction="previous" />
          </button>

          <div className={styles.collectionBinderBody}>
            {cardsLoading ? (
              <div className={styles.collectionBinderGrid}>
                {Array.from({ length: cardsPerPage }, (_, index) => <div key={index} className={styles.collectionSkeleton} />)}
              </div>
            ) : cardsError ? (
              <div className={styles.collectionEmpty}><CcgLoadError onRetry={retryCards} /></div>
            ) : cardsData?.cards.length ? (
              <div className={styles.collectionBinderGrid}>
                {cardsData.cards.map((card) => {
                  const ownedFinish = bestOwnedFinish(card);
                  return (
                    <div className={styles.collectionCardSlot} key={card.id}>
                      <CollectibleCard
                        card={card}
                        finish={ownedFinish?.finish ?? "standard"}
                        quantity={ownedFinish?.total}
                        compact
                        className={ownedFinish ? "" : styles.collectionMissingCard}
                        onSelect={() => setViewerCard(card)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.collectionEmpty}>
                <div>
                  <h2>{t(view === "all" ? "collection.emptyOwnedTitle" : "collection.emptyGuildTitle")}</h2>
                  <p>{t(view === "all" ? "collection.emptyOwnedBody" : includeMissing ? "collection.emptyGuildMissingBody" : "collection.emptyGuildBody")}</p>
                  {view === "all" ? (
                    <Link href={`/fun/ccg/open?mode=${selectedSet?.state === "legacy" ? "legacy" : "current"}`} className={`${styles.primaryButton} mt-4`}>
                      {t("collection.openPacks")}
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.collectionPageTurn}
            disabled={!cardsData || page >= cardsData.pages}
            onClick={() => setPage((value) => value + 1)}
            aria-label={t("collection.next")}
          >
            <PageArrow direction="next" />
          </button>
        </section>
      </div>
      {viewerCard ? <CardViewer card={viewerCard} initialFinish={bestOwnedFinish(viewerCard)?.finish ?? "standard"} onClose={() => setViewerCard(null)} /> : null}
    </CcgShell>
  );
}
