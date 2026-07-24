"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { CcgCard, CcgFinish, CcgTierGrade } from "@/types";
import { bestOwnedFinish } from "@/lib/ccg";
import { useCcgCatalog, useCcgCollection, useCcgSession, useCcgSetGuilds, useCcgSets } from "@/lib/queries";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer, { openCardViewer } from "@/components/ccg/CardViewer";
import type { CardViewerOriginBounds } from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";

const rarities: Array<{ grade: CcgTierGrade; label: "artifact" | "legendary" | "epic" | "rare" | "uncommon" | "common" | "poor" }> = [
  { grade: "S", label: "artifact" },
  { grade: "A", label: "legendary" },
  { grade: "B", label: "epic" },
  { grade: "C", label: "rare" },
  { grade: "D", label: "uncommon" },
  { grade: "E", label: "common" },
  { grade: "F", label: "poor" },
];
const finishes: CcgFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "negative"];
const cardsPerPage = 12;

function PageArrow({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={direction === "previous" ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollectionCard({
  card,
  finish,
  quantity,
  missing,
  onSelect,
}: {
  card: CcgCard;
  finish: CcgFinish;
  quantity?: number;
  missing: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);

  return (
    <div className={styles.collectionCardSlot} aria-busy={!ready}>
      <div
        className={`${styles.collectionSkeleton} ${styles.collectionCardSkeleton} ${ready ? styles.collectionCardSkeletonHidden : ""}`}
        aria-hidden="true"
      />
      <CollectibleCard
        card={card}
        finish={finish}
        quantity={quantity}
        compact
        className={`${styles.collectionCardAsset} ${ready ? "" : styles.collectionCardAssetLoading} ${missing ? styles.collectionMissingCard : ""}`}
        onReady={markReady}
        onSelect={onSelect}
      />
    </div>
  );
}

export default function CcgCollectionPage() {
  const t = useTranslations("ccg");
  const sessionQuery = useCcgSession();
  const setsQuery = useCcgSets();
  const sets = useMemo(
    () => [...(setsQuery.data?.sets ?? [])].sort((a, b) => b.zoneId - a.zoneId),
    [setsQuery.data?.sets],
  );
  const [setSlug, setSetSlug] = useState("");
  const [guildId, setGuildId] = useState("");
  const [includeMissing, setIncludeMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [grade, setGrade] = useState("");
  const [finish, setFinish] = useState<CcgFinish | "">("");
  const [viewerCard, setViewerCard] = useState<CcgCard | null>(null);
  const [viewerOriginElement, setViewerOriginElement] = useState<HTMLElement | null>(null);
  const [viewerOriginBounds, setViewerOriginBounds] = useState<CardViewerOriginBounds | null>(null);
  const [viewerSharedTransition, setViewerSharedTransition] = useState(false);
  const setRailRef = useRef<HTMLDivElement>(null);
  const setRailTargetRef = useRef(0);
  const setRailAnimationRef = useRef<number | null>(null);
  const setRailDragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false });
  const suppressSetClickRef = useRef(false);
  const [draggingSetRail, setDraggingSetRail] = useState(false);
  const [canScrollSetsBack, setCanScrollSetsBack] = useState(false);
  const [canScrollSetsForward, setCanScrollSetsForward] = useState(false);
  const selectedSet = sets.find((set) => set.slug === setSlug);
  const guildsQuery = useCcgSetGuilds(setSlug);
  const guilds = useMemo(
    () => [...(guildsQuery.data?.guilds ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm)),
    [guildsQuery.data?.guilds],
  );
  const showCatalog = includeMissing;
  const filtersChanged = includeMissing || Boolean(guildId || grade || finish);
  const ownedQuery = useCcgCollection(
    {
      page,
      limit: cardsPerPage,
      set: setSlug || undefined,
      grade: grade || undefined,
      finish: finish || undefined,
      guild: guildId || undefined,
    },
    Boolean(setSlug) && !showCatalog,
  );
  const catalogQuery = useCcgCatalog(setSlug, page, "all", grade, guildId, finish, showCatalog, cardsPerPage);
  const cardsQuery = showCatalog ? catalogQuery : ownedQuery;
  const cardsData = cardsQuery.data;
  const cardsLoading = setsQuery.isPending || (sets.length > 0 && !setSlug) || (Boolean(setSlug) && cardsQuery.isPending);
  const cardsError = cardsQuery.isError;

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

  const updateSetRailControls = useCallback(() => {
    const rail = setRailRef.current;
    if (!rail) return;
    if (setRailAnimationRef.current === null) setRailTargetRef.current = rail.scrollLeft;
    const remaining = rail.scrollWidth - rail.clientWidth;
    setCanScrollSetsBack(rail.scrollLeft > 2);
    setCanScrollSetsForward(remaining - rail.scrollLeft > 2);
  }, []);

  useEffect(() => {
    const rail = setRailRef.current;
    if (!rail) return;
    const resizeObserver = new ResizeObserver(updateSetRailControls);
    resizeObserver.observe(rail);
    updateSetRailControls();
    rail.addEventListener("scroll", updateSetRailControls, { passive: true });
    return () => {
      if (setRailAnimationRef.current !== null) {
        cancelAnimationFrame(setRailAnimationRef.current);
        setRailAnimationRef.current = null;
      }
      resizeObserver.disconnect();
      rail.removeEventListener("scroll", updateSetRailControls);
    };
  }, [sets, updateSetRailControls]);

  const animateSetRail = useCallback(() => {
    const rail = setRailRef.current;
    if (!rail) {
      setRailAnimationRef.current = null;
      return;
    }
    const distance = setRailTargetRef.current - rail.scrollLeft;
    if (Math.abs(distance) < 0.5) {
      rail.scrollLeft = setRailTargetRef.current;
      setRailAnimationRef.current = null;
      return;
    }
    rail.scrollLeft += distance * 0.22;
    setRailAnimationRef.current = requestAnimationFrame(animateSetRail);
  }, []);

  const scrollSetRail = (direction: -1 | 1) => {
    const rail = setRailRef.current;
    if (!rail) return;
    if (setRailAnimationRef.current !== null) {
      cancelAnimationFrame(setRailAnimationRef.current);
      setRailAnimationRef.current = null;
    }
    rail.scrollBy({
      left: direction * Math.max(176, rail.clientWidth * 0.72),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const wheelSetRail = (event: ReactWheelEvent<HTMLDivElement>) => {
    const rail = setRailRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const maximum = rail.scrollWidth - rail.clientWidth;
    const target = Math.max(0, Math.min(maximum, setRailTargetRef.current + delta * 0.85));
    if (target === setRailTargetRef.current) return;
    event.preventDefault();
    setRailTargetRef.current = target;
    if (setRailAnimationRef.current === null) {
      setRailAnimationRef.current = requestAnimationFrame(animateSetRail);
    }
  };

  const startSetRailDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rail = setRailRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    if (setRailAnimationRef.current !== null) {
      cancelAnimationFrame(setRailAnimationRef.current);
      setRailAnimationRef.current = null;
    }
    setRailDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: rail.scrollLeft,
      moved: false,
    };
  };

  const moveSetRailDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rail = setRailRef.current;
    const drag = setRailDragRef.current;
    if (!rail || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < 4) return;
    if (!drag.moved) rail.setPointerCapture(event.pointerId);
    drag.moved = true;
    setDraggingSetRail(true);
    rail.scrollLeft = drag.startScrollLeft - delta;
    setRailTargetRef.current = rail.scrollLeft;
    event.preventDefault();
  };

  const finishSetRailDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rail = setRailRef.current;
    const drag = setRailDragRef.current;
    if (!rail || drag.pointerId !== event.pointerId) return;
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      suppressSetClickRef.current = true;
      window.setTimeout(() => {
        suppressSetClickRef.current = false;
      }, 0);
    }
    setRailDragRef.current = { pointerId: -1, startX: 0, startScrollLeft: 0, moved: false };
    setDraggingSetRail(false);
  };

  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };

  const resetFilters = () => {
    setIncludeMissing(false);
    setGuildId("");
    setGrade("");
    setFinish("");
    setPage(1);
  };

  const selectSet = (nextSlug: string) => {
    setSetSlug(nextSlug);
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
      context={sessionQuery.data ? <GuestNotice session={sessionQuery.data} /> : null}
    >
      <div className={styles.collectionPage}>
        <section className={styles.collectionToolbar}>
          <div className={styles.collectionSetRailViewport}>
            <button
              type="button"
              className={styles.collectionSetRailArrow}
              data-direction="previous"
              disabled={!canScrollSetsBack}
              onClick={() => scrollSetRail(-1)}
              aria-label={t("collection.previous")}
            >
              <PageArrow direction="previous" />
            </button>
            <div
              ref={setRailRef}
              className={styles.collectionSetRail}
              data-dragging={draggingSetRail || undefined}
              role="group"
              aria-label={t("collection.sets")}
              onWheel={wheelSetRail}
              onPointerDown={startSetRailDrag}
              onPointerMove={moveSetRailDrag}
              onPointerUp={finishSetRailDrag}
              onPointerCancel={finishSetRailDrag}
              onClickCapture={(event) => {
                if (!suppressSetClickRef.current) return;
                event.preventDefault();
                event.stopPropagation();
              }}
            >
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
            <button
              type="button"
              className={styles.collectionSetRailArrow}
              data-direction="next"
              disabled={!canScrollSetsForward}
              onClick={() => scrollSetRail(1)}
              aria-label={t("collection.next")}
            >
              <PageArrow direction="next" />
            </button>
          </div>

          <div className={styles.collectionFilters}>
            <button
              type="button"
              className={styles.collectionResetButton}
              onClick={resetFilters}
              disabled={!filtersChanged}
            >
              {t("collection.resetFilters")}
            </button>

            <label className={`${styles.collectionMissingToggle} ${includeMissing ? styles.collectionMissingToggleActive : ""}`}>
              <input
                type="checkbox"
                checked={includeMissing}
                onChange={(event) => updateFilter(() => setIncludeMissing(event.target.checked))}
              />
              <span>{t("collection.showMissing")}</span>
            </label>

            <label className={styles.collectionSelect}>
              <select
                aria-label={t("collection.guild")}
                value={guildId}
                onChange={(event) => updateFilter(() => setGuildId(event.target.value))}
                disabled={guildsQuery.isLoading}
              >
                <option value="">{t("collection.allGuilds")}</option>
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>{guild.name}</option>
                ))}
              </select>
            </label>

            <label className={styles.collectionSelect}>
              <select
                aria-label={t("collection.rarity")}
                className={styles.collectionRaritySelect}
                data-grade={grade || undefined}
                value={grade}
                onChange={(event) => updateFilter(() => setGrade(event.target.value))}
              >
                <option value="">{t("collection.allRarities")}</option>
                {rarities.map((item) => <option key={item.grade} value={item.grade} data-grade={item.grade}>{t(`rarity.${item.label}`)}</option>)}
              </select>
            </label>

            <label className={styles.collectionSelect}>
              <select
                aria-label={t("collection.quality")}
                className={styles.collectionQualitySelect}
                data-finish={finish || undefined}
                value={finish}
                onChange={(event) => updateFilter(() => setFinish(event.target.value as CcgFinish | ""))}
              >
                <option value="">{t("collection.allQualities")}</option>
                {finishes.map((item) => <option key={item} value={item} data-finish={item}>{t(`finish.${item}`)}</option>)}
              </select>
            </label>

            <span className={styles.collectionPageCount}>
              {t("collection.page", {
                page: cardsData && cardsData.pages > 0 ? page : 0,
                pages: cardsData?.pages ?? 0,
              })}
            </span>
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
            <div className={styles.collectionBinderLines} aria-hidden="true">
              {Array.from({ length: cardsPerPage }, (_, index) => <span key={index} />)}
            </div>
            {cardsLoading ? (
              <div className={styles.collectionBinderGrid}>
                {Array.from({ length: cardsPerPage }, (_, index) => (
                  <div key={index} className={styles.collectionCardSlot}>
                    <div className={`${styles.collectionSkeleton} ${styles.collectionCardSkeleton}`} />
                  </div>
                ))}
              </div>
            ) : cardsError ? (
              <div className={styles.collectionEmpty}><CcgLoadError onRetry={retryCards} /></div>
            ) : cardsData?.cards.length ? (
              <div className={styles.collectionBinderGrid}>
                {cardsData.cards.map((card) => {
                  const ownedFinish = bestOwnedFinish(card);
                  return (
                    <CollectionCard
                      key={`${card.id}:${card.renderUrl ?? ""}`}
                      card={card}
                      finish={ownedFinish?.finish ?? "standard"}
                      quantity={ownedFinish?.total}
                      missing={!ownedFinish}
                      onSelect={(event) => {
                        const originElement = event.currentTarget;
                        openCardViewer(originElement, (sharedTransition, originBounds) => {
                          setViewerOriginElement(originElement);
                          setViewerOriginBounds(originBounds);
                          setViewerSharedTransition(sharedTransition);
                          setViewerCard(card);
                        });
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className={styles.collectionEmpty}>
                <div>
                  <h2>{t(guildId ? "collection.emptyGuildTitle" : includeMissing ? "collection.emptyMissingTitle" : "collection.emptyOwnedTitle")}</h2>
                  <p>{t(guildId ? includeMissing ? "collection.emptyGuildMissingBody" : "collection.emptyGuildBody" : includeMissing ? "collection.emptyMissingBody" : "collection.emptyOwnedBody")}</p>
                  {!guildId && !includeMissing ? (
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
      {viewerCard ? (
        <CardViewer
          card={viewerCard}
          initialFinish={bestOwnedFinish(viewerCard)?.finish ?? "standard"}
          originElement={viewerOriginElement}
          originBounds={viewerOriginBounds}
          sharedTransition={viewerSharedTransition}
          onClose={() => {
            setViewerCard(null);
            setViewerOriginElement(null);
            setViewerOriginBounds(null);
            setViewerSharedTransition(false);
          }}
        />
      ) : null}
    </CcgShell>
  );
}
