"use client";

import Link from "next/link";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { CcgArtVariant, CcgBaseFinish, CcgCard, CcgFinish, CcgTierGrade } from "@/types";
import { bestOwnedFinish, CCG_BASE_FINISH_ORDER } from "@/lib/ccg";
import { getCcgPlaybackVolume } from "@/lib/ccg-audio";
import { useCcgCatalog, useCcgCollection, useCcgCollectionGuilds, useCcgSession, useCcgSets } from "@/lib/queries";
import { formatRealmName } from "@/lib/utils";
import CcgShell from "@/components/ccg/CcgShell";
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
const cardsPerPage = 12;
const pageWheelThreshold = 24;
const allSetsSlug = "__all__";
const uniqueFinishFilter = "unique";
type CollectionFinishFilter = CcgBaseFinish | typeof uniqueFinishFilter | "";
type CollectionFinishOption = Exclude<CollectionFinishFilter, "">;

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
  artVariant,
  quantity,
  missing,
  onSelect,
}: {
  card: CcgCard;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
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
        artVariant={artVariant}
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
    () => [...(setsQuery.data?.sets ?? [])].sort((a, b) => {
      if (a.kind === "community") return b.kind === "community" ? 0 : 1;
      if (b.kind === "community") return -1;
      return b.zoneId - a.zoneId;
    }),
    [setsQuery.data?.sets],
  );
  const [setSlug, setSetSlug] = useState(allSetsSlug);
  const [guildId, setGuildId] = useState("");
  const [guildSearch, setGuildSearch] = useState("");
  const [includeMissing, setIncludeMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [grade, setGrade] = useState("");
  const [finish, setFinish] = useState<CollectionFinishFilter>("");
  const [viewerCard, setViewerCard] = useState<CcgCard | null>(null);
  const [viewerOriginElement, setViewerOriginElement] = useState<HTMLElement | null>(null);
  const [viewerOriginBounds, setViewerOriginBounds] = useState<CardViewerOriginBounds | null>(null);
  const [viewerSharedTransition, setViewerSharedTransition] = useState(false);
  const setRailRef = useRef<HTMLDivElement>(null);
  const pageFlipAudioRef = useRef<HTMLAudioElement>(null);
  const setRailTargetRef = useRef(0);
  const setRailAnimationRef = useRef<number | null>(null);
  const pageWheelDeltaRef = useRef(0);
  const pageWheelHandledRef = useRef(false);
  const pageWheelResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestedSetAppliedRef = useRef(false);
  const setRailDragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false });
  const suppressSetClickRef = useRef(false);
  const [draggingSetRail, setDraggingSetRail] = useState(false);
  const [canScrollSetsBack, setCanScrollSetsBack] = useState(false);
  const [canScrollSetsForward, setCanScrollSetsForward] = useState(false);
  const allSetsSelected = setSlug === allSetsSlug;
  const selectedSet = sets.find((set) => set.slug === setSlug);
  const finishOptions = useMemo(() => {
    const order: CollectionFinishOption[] = [...CCG_BASE_FINISH_ORDER];
    const hasUniqueFinish = selectedSet
      ? Boolean(selectedSet.customFinish)
      : sets.some((set) => Boolean(set.customFinish));
    if (hasUniqueFinish) order.splice(order.length - 1, 0, uniqueFinishFilter);
    return [...order].reverse();
  }, [selectedSet, sets]);
  const collectionSetSlug = allSetsSelected ? undefined : setSlug;
  const allCardCount = sets.reduce((total, set) => total + set.cardCount, 0);
  const allOwnedCount = sets.reduce((total, set) => total + set.ownedCards, 0);
  const guildsQuery = useCcgCollectionGuilds();
  const setGuildsQuery = useCcgCollectionGuilds(collectionSetSlug, !allSetsSelected);
  const guilds = useMemo(
    () => [...(guildsQuery.data?.guilds ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm)),
    [guildsQuery.data?.guilds],
  );
  const duplicateGuildNames = useMemo(() => {
    const nameCounts = new Map<string, number>();
    guilds.forEach((guild) => {
      const name = guild.name.toLocaleLowerCase();
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    });
    return new Set([...nameCounts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [guilds]);
  const selectedGuild = guilds.find((guild) => guild.id === guildId);
  const filteredGuilds = useMemo(() => {
    const search = guildSearch.trim().toLocaleLowerCase();
    if (!search) return guilds;
    return guilds.filter((guild) => (
      `${guild.name} ${guild.realm} ${formatRealmName(guild.realm)}`.toLocaleLowerCase().includes(search)
    ));
  }, [guildSearch, guilds]);
  const setGuildIds = useMemo(
    () => new Set((setGuildsQuery.data?.guilds ?? []).map((guild) => guild.id)),
    [setGuildsQuery.data?.guilds],
  );
  const guildAvailabilityLoaded = allSetsSelected || Boolean(setGuildsQuery.data);
  const selectedGuildUnavailable = Boolean(guildId) && guildAvailabilityLoaded && !allSetsSelected && !setGuildIds.has(guildId);
  const showCatalog = includeMissing;
  const filtersChanged = includeMissing || Boolean(guildId || grade || finish);
  const ownedQuery = useCcgCollection(
    {
      page,
      limit: cardsPerPage,
      set: collectionSetSlug,
      grade: grade || undefined,
      finish: finish || undefined,
      guild: guildId || undefined,
    },
    Boolean(setSlug) && !showCatalog,
  );
  const catalogQuery = useCcgCatalog(collectionSetSlug, page, "all", grade, guildId, finish, showCatalog, cardsPerPage);
  const cardsQuery = showCatalog ? catalogQuery : ownedQuery;
  const cardsData = cardsQuery.data;
  const cardsLoading = setsQuery.isPending || cardsQuery.isPending;
  const cardsError = cardsQuery.isError;

  useEffect(() => {
    if (requestedSetAppliedRef.current || sets.length === 0) return;
    const requested = new URLSearchParams(window.location.search).get("set");
    const next = sets.find((set) => set.slug === requested);
    if (next) setSetSlug(next.slug);
    requestedSetAppliedRef.current = true;
  }, [sets]);

  useEffect(() => {
    if (!cardsData || page <= cardsData.pages || cardsData.pages === 0) return;
    setPage(cardsData.pages);
  }, [cardsData, page]);

  useEffect(() => {
    if (!finish || finishOptions.includes(finish)) return;
    setFinish("");
    setPage(1);
  }, [finish, finishOptions]);

  useEffect(() => () => {
    if (pageWheelResetRef.current !== null) clearTimeout(pageWheelResetRef.current);
  }, []);

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
    setPage(1);
  };

  const retryCards = () => {
    if (showCatalog) void catalogQuery.refetch();
    else void ownedQuery.refetch();
  };

  const turnPage = (direction: -1 | 1) => {
    const audio = pageFlipAudioRef.current;
    const volume = getCcgPlaybackVolume("effects");
    if (audio && volume > 0) {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = volume;
      void audio.play().catch(() => undefined);
    }
    setPage((value) => value + direction);
  };

  const wheelCardPages = (event: ReactWheelEvent<HTMLElement>) => {
    const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    let deltaUnit = 1;
    if (event.deltaMode === 1) deltaUnit = 16;
    if (event.deltaMode === 2) deltaUnit = event.currentTarget.clientHeight;
    const delta = rawDelta * deltaUnit;
    if (delta === 0) return;

    const direction = delta > 0 ? 1 : -1;
    if (!pageWheelHandledRef.current) {
      if (!cardsData || cardsLoading || cardsData.pages <= 1) return;
      if ((direction < 0 && page <= 1) || (direction > 0 && page >= cardsData.pages)) return;
    }

    event.preventDefault();
    if (pageWheelResetRef.current !== null) clearTimeout(pageWheelResetRef.current);
    pageWheelResetRef.current = setTimeout(() => {
      pageWheelDeltaRef.current = 0;
      pageWheelHandledRef.current = false;
      pageWheelResetRef.current = null;
    }, 160);

    if (pageWheelHandledRef.current) return;
    if (pageWheelDeltaRef.current !== 0 && Math.sign(pageWheelDeltaRef.current) !== Math.sign(delta)) {
      pageWheelDeltaRef.current = 0;
    }
    pageWheelDeltaRef.current += delta;
    if (Math.abs(pageWheelDeltaRef.current) < pageWheelThreshold) return;

    pageWheelHandledRef.current = true;
    pageWheelDeltaRef.current = 0;
    turnPage(direction);
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
    <CcgShell compact>
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
              <button
                type="button"
                aria-pressed={allSetsSelected}
                onClick={() => selectSet(allSetsSlug)}
                className={styles.collectionSet}
                style={{
                  "--set-accent": "#9c7cff",
                  backgroundImage: 'linear-gradient(90deg, rgba(2,6,15,.9), rgba(2,6,15,.54)), url("/ccg/general_wide.webp")',
                } as CSSProperties}
              >
                <span className={styles.collectionSetTitle}>{t("landing.all")}</span>
                <span className={styles.collectionSetProgress}>
                  <small>{allOwnedCount}/{allCardCount}</small>
                  <span className={styles.vaultLegacyTrack} aria-label={`${allOwnedCount}/${allCardCount} ${t("landing.collected")}`}>
                    <i style={{ transform: `scaleX(${allCardCount > 0 ? Math.min(1, allOwnedCount / allCardCount) : 0})` }} />
                  </span>
                </span>
              </button>
              {sets.map((set) => (
                <button
                  type="button"
                  aria-pressed={set.slug === setSlug}
                  key={set.id}
                  onClick={() => selectSet(set.slug)}
                  className={styles.collectionSet}
                  style={{
                    "--set-accent": set.theme.accent,
                    backgroundImage: `linear-gradient(90deg, rgba(2,6,15,.9), rgba(2,6,15,.54)), url("${set.kind === "community" ? "/ccg/general_alt_wide.png" : set.backgroundPath}")`,
                  } as CSSProperties}
                >
                  <span className={styles.collectionSetTitle}>{set.raidName}</span>
                  <span className={styles.collectionSetProgress}>
                    <small>{set.ownedCards}/{set.cardCount}</small>
                    <span className={styles.vaultLegacyTrack} aria-label={`${set.ownedCards}/${set.cardCount} ${t("landing.collected")}`}>
                      <i style={{ transform: `scaleX(${set.cardCount > 0 ? Math.min(1, set.ownedCards / set.cardCount) : 0})` }} />
                    </span>
                  </span>
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

            <Combobox
              value={guildId}
              onChange={(value) => {
                updateFilter(() => setGuildId(value ?? ""));
                setGuildSearch("");
              }}
              onClose={() => setGuildSearch("")}
              disabled={guildsQuery.isLoading}
            >
              {({ open }) => (
                <div className={`${styles.collectionSelect} ${styles.collectionGuildSelect}`}>
                  <ComboboxButton
                    aria-label={t("collection.guild")}
                    className={styles.collectionGuildSelectButton}
                    data-unavailable={selectedGuildUnavailable || undefined}
                  >
                    <span className={styles.collectionGuildText}>
                      {selectedGuild ? (
                        <>
                          {selectedGuild.name}
                          {duplicateGuildNames.has(selectedGuild.name.toLocaleLowerCase()) && (
                            <span className={styles.collectionGuildRealm}>-{formatRealmName(selectedGuild.realm)}</span>
                          )}
                        </>
                      ) : t("collection.allGuilds")}
                    </span>
                  </ComboboxButton>
                  {open && (
                    <div className={styles.collectionGuildPopup}>
                      <ComboboxInput
                        autoFocus
                        aria-label={t("collection.searchGuilds")}
                        autoComplete="off"
                        className={styles.collectionGuildSearch}
                        placeholder={t("collection.searchGuildsPlaceholder")}
                        value={guildSearch}
                        onChange={(event) => setGuildSearch(event.target.value)}
                      />
                      <ComboboxOptions static className={styles.collectionGuildOptions}>
                        {!guildSearch.trim() && (
                          <ComboboxOption value="" className={styles.collectionGuildOption}>
                            <span className={styles.collectionGuildText}>{t("collection.allGuilds")}</span>
                          </ComboboxOption>
                        )}
                        {filteredGuilds.map((guild) => {
                          const unavailable = guildAvailabilityLoaded && !allSetsSelected && !setGuildIds.has(guild.id);
                          return (
                            <ComboboxOption
                              key={guild.id}
                              value={guild.id}
                              className={styles.collectionGuildOption}
                              data-unavailable={unavailable || undefined}
                            >
                              <span className={styles.collectionGuildText}>
                                {guild.name}
                                {duplicateGuildNames.has(guild.name.toLocaleLowerCase()) && (
                                  <span className={styles.collectionGuildRealm}>-{formatRealmName(guild.realm)}</span>
                                )}
                              </span>
                            </ComboboxOption>
                          );
                        })}
                      </ComboboxOptions>
                    </div>
                  )}
                </div>
              )}
            </Combobox>

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
                onChange={(event) => updateFilter(() => setFinish(event.target.value as CollectionFinishFilter))}
              >
                <option value="">{t("collection.allQualities")}</option>
                {finishOptions.map((item) => (
                  <option key={item} value={item} data-finish={item}>
                    {item === uniqueFinishFilter ? t("collection.uniqueQuality") : t(`finish.${item}`)}
                  </option>
                ))}
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

        <section className={styles.collectionBinder} aria-busy={cardsLoading} onWheel={wheelCardPages}>
          <button
            type="button"
            className={styles.collectionPageTurn}
            disabled={!cardsData || page <= 1}
            onClick={() => turnPage(-1)}
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
                      artVariant={ownedFinish?.artVariant ?? "standard"}
                      quantity={ownedFinish?.total}
                      missing={!ownedFinish}
                      onSelect={(event) => {
                        const originElement = event.currentTarget;
                        openCardViewer(originElement, (sharedTransition, originBounds) => {
                          setViewerOriginElement(originElement);
                          setViewerOriginBounds(originBounds);
                          setViewerSharedTransition(sharedTransition);
                          setViewerCard(card);
                        }, event);
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
            onClick={() => turnPage(1)}
            aria-label={t("collection.next")}
          >
            <PageArrow direction="next" />
          </button>
        </section>
      </div>
      <audio ref={pageFlipAudioRef} src="/ccg/audio/page_flip.mp3" preload="auto" aria-hidden="true" />
      {viewerCard ? (
        <CardViewer
          card={viewerCard}
          initialFinish={bestOwnedFinish(viewerCard)?.finish ?? "standard"}
          initialArtVariant={bestOwnedFinish(viewerCard)?.artVariant ?? "standard"}
          originElement={viewerOriginElement}
          originBounds={viewerOriginBounds}
          sharedTransition={viewerSharedTransition}
          missing={!bestOwnedFinish(viewerCard)}
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
