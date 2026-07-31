"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FaRegStar, FaStar } from "react-icons/fa6";
import { LuCircleDashed, LuEye, LuEyeOff, LuFilter, LuImage, LuImages, LuRotateCcw, LuX } from "react-icons/lu";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { CcgArtVariant, CcgBaseFinish, CcgCard, CcgCharacterFacet, CcgCollectionSort, CcgFinish, CcgGuildFacet, CcgTierGrade } from "@/types";
import { bestOwnedFinish, CCG_BASE_FINISH_ORDER } from "@/lib/ccg";
import { playCcgSound, preloadCcgSounds } from "@/lib/ccg-audio";
import { useCcgCatalog, useCcgCollection, useCcgCollectionCharacterSearch, useCcgCollectionGuilds, useCcgLeaderboardMe, useCcgSession, useCcgSets } from "@/lib/queries";
import { formatRealmName } from "@/lib/utils";
import CcgShell from "@/components/ccg/CcgShell";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer, { openCardViewer } from "@/components/ccg/CardViewer";
import type { CardViewerOriginBounds } from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";

const rarities: Array<{ grade: CcgTierGrade; label: "heirloom" | "artifact" | "legendary" | "epic" | "rare" | "uncommon" | "common" | "poor" }> = [
  { grade: "H", label: "heirloom" },
  { grade: "S", label: "artifact" },
  { grade: "A", label: "legendary" },
  { grade: "B", label: "epic" },
  { grade: "C", label: "rare" },
  { grade: "D", label: "uncommon" },
  { grade: "E", label: "common" },
  { grade: "F", label: "poor" },
];
const fullPageSize = 12;
const shortMobilePageSize = 9;
const pageWheelThreshold = 24;
const pageSwipeThreshold = 44;
const pageFlipSound = "/ccg/audio/page_flip.mp3";
const allSetsSlug = "__all__";
const uniqueFinishFilter = "unique";
type CollectionFinishFilter = CcgBaseFinish | typeof uniqueFinishFilter | "";
type CollectionFinishOption = Exclude<CollectionFinishFilter, "">;
type CollectionVisibility = "owned" | "all" | "missing";
const collectionSortOptions: Array<{ value: CcgCollectionSort; label: string }> = [
  { value: "duplicates_desc", label: "sortMostDuplicatesFirst" },
  { value: "alphabetical", label: "sortAlphabetical" },
  { value: "reverse_alphabetical", label: "sortReverseAlphabetical" },
  { value: "rarity_desc", label: "sortMostRareFirst" },
  { value: "rarity_asc", label: "sortLeastRareFirst" },
  { value: "quality_desc", label: "sortHighestQualityFirst" },
  { value: "quality_asc", label: "sortLowestQualityFirst" },
  { value: "damage_desc", label: "sortHighestDamageFirst" },
  { value: "damage_asc", label: "sortLowestDamageFirst" },
  { value: "mechanics_desc", label: "sortHighestMechanicsFirst" },
  { value: "mechanics_asc", label: "sortLowestMechanicsFirst" },
  { value: "combined_desc", label: "sortHighestCombinedFirst" },
  { value: "combined_asc", label: "sortLowestCombinedFirst" },
  { value: "mythic_plus_desc", label: "sortHighestMythicPlusFirst" },
  { value: "mythic_plus_asc", label: "sortLowestMythicPlusFirst" },
];

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
  favorite,
  missing,
  onSelect,
}: {
  card: CcgCard;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  quantity?: number;
  favorite: boolean;
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
        favorite={favorite}
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
  const searchParams = useSearchParams();
  const sessionQuery = useCcgSession();
  const signedIn = sessionQuery.data?.ownerType === "user";
  const favoritesQuery = useCcgLeaderboardMe(signedIn);
  const setsQuery = useCcgSets();
  const sets = useMemo(
    () => [...(setsQuery.data?.sets ?? [])].sort((a, b) => {
      if (a.kind === "community") return b.kind === "community" ? 0 : 1;
      if (b.kind === "community") return -1;
      return b.zoneId - a.zoneId;
    }),
    [setsQuery.data?.sets],
  );
  const requestedSetSlug = searchParams.get("set");
  const [setSlug, setSetSlug] = useState(() => requestedSetSlug || allSetsSlug);
  const [guildId, setGuildId] = useState("");
  const [guildSearch, setGuildSearch] = useState("");
  const [guildInputFocused, setGuildInputFocused] = useState(false);
  const [guildsRequested, setGuildsRequested] = useState(false);
  const guildInputRef = useRef<HTMLInputElement>(null);
  const mobileGuildInputRef = useRef<HTMLInputElement>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<CcgCharacterFacet | null>(null);
  const [characterSearch, setCharacterSearch] = useState("");
  const [debouncedCharacterSearch, setDebouncedCharacterSearch] = useState("");
  const [characterInputFocused, setCharacterInputFocused] = useState(false);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const mobileCharacterInputRef = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<CollectionVisibility>("owned");
  const [alternativeOnly, setAlternativeOnly] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [cardsPerPage, setCardsPerPage] = useState(fullPageSize);
  const [pageCountCache, setPageCountCache] = useState({ scope: "", pages: 0 });
  const [grade, setGrade] = useState("");
  const [finish, setFinish] = useState<CollectionFinishFilter>("");
  const [sort, setSort] = useState<CcgCollectionSort | "">("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [viewerCard, setViewerCard] = useState<CcgCard | null>(null);
  const [viewerOriginElement, setViewerOriginElement] = useState<HTMLElement | null>(null);
  const [viewerOriginBounds, setViewerOriginBounds] = useState<CardViewerOriginBounds | null>(null);
  const [viewerSharedTransition, setViewerSharedTransition] = useState(false);
  const setRailRef = useRef<HTMLDivElement>(null);
  const setRailTargetRef = useRef(0);
  const setRailAnimationRef = useRef<number | null>(null);
  const pageWheelDeltaRef = useRef(0);
  const pageWheelHandledRef = useRef(false);
  const pageWheelResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSwipeRef = useRef({ pointerId: -1, startX: 0, startY: 0, moved: false });
  const suppressCardClickRef = useRef(false);
  const setRailDragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false });
  const suppressSetClickRef = useRef(false);
  const [draggingSetRail, setDraggingSetRail] = useState(false);
  const [canScrollSetsBack, setCanScrollSetsBack] = useState(false);
  const [canScrollSetsForward, setCanScrollSetsForward] = useState(false);
  const allSetsSelected = setSlug === allSetsSlug;
  const selectedSet = sets.find((set) => set.slug === setSlug);
  const setSelectionReady = setsQuery.isSuccess && (allSetsSelected || Boolean(selectedSet));
  const finishOptions = useMemo(() => {
    const order: CollectionFinishOption[] = [...CCG_BASE_FINISH_ORDER];
    const hasUniqueFinish = selectedSet
      ? selectedSet.kind === "community" || Boolean(selectedSet.customFinish)
      : sets.some((set) => set.kind === "community" || Boolean(set.customFinish));
    if (hasUniqueFinish) order.splice(order.length - 1, 0, uniqueFinishFilter);
    return [...order].reverse();
  }, [selectedSet, sets]);
  const collectionSetSlug = allSetsSelected ? undefined : setSlug;
  const allCardCount = sets.reduce((total, set) => total + set.cardCount, 0);
  const allOwnedCount = sets.reduce((total, set) => total + set.ownedCards, 0);
  const guildsQuery = useCcgCollectionGuilds(undefined, guildsRequested);
  const guilds = useMemo(
    () => [...(guildsQuery.data?.guilds ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm)),
    [guildsQuery.data?.guilds],
  );

  useEffect(() => preloadCcgSounds([pageFlipSound]), []);
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
    () => new Set(selectedSet
      ? guilds.filter((guild) => guild.setIds.includes(selectedSet.id)).map((guild) => guild.id)
      : []),
    [guilds, selectedSet],
  );
  const guildAvailabilityLoaded = allSetsSelected || Boolean(guildsQuery.data);
  const selectedGuildUnavailable = Boolean(guildId) && guildAvailabilityLoaded && !allSetsSelected && !setGuildIds.has(guildId);
  const trimmedCharacterSearch = characterSearch.trim();
  const characterSearchQuery = useCcgCollectionCharacterSearch(debouncedCharacterSearch);
  const characterResultsCurrent = debouncedCharacterSearch === trimmedCharacterSearch;
  const characterResults = characterResultsCurrent ? (characterSearchQuery.data?.characters ?? []) : [];
  const characterSearchLoading = trimmedCharacterSearch.length >= 2
    && (!characterResultsCurrent || characterSearchQuery.isFetching);
  const characterId = selectedCharacter?.id ?? "";
  const showCatalog = visibility !== "owned";
  const showMissingOnly = visibility === "missing";
  const catalogOwnership = showMissingOnly ? "missing" : "all";
  const nextVisibility: CollectionVisibility = visibility === "owned" ? "all" : visibility === "all" ? "missing" : "owned";
  const visibilityAction = visibility === "owned"
    ? "collection.showOwnedAndMissingCards"
    : visibility === "all"
      ? "collection.showOnlyMissingCards"
      : "collection.showOnlyOwnedCards";
  const favoriteCardIds = useMemo(
    () => new Set((favoritesQuery.data?.showcase ?? []).map((item) => item.card.id)),
    [favoritesQuery.data?.showcase],
  );
  const filtersChanged = visibility !== "owned" || alternativeOnly || favoriteOnly || Boolean(characterId || guildId || grade || finish || sort);
  const advancedFilterCount = [alternativeOnly, characterId, guildId, grade, finish].filter(Boolean).length;
  const ownedQuery = useCcgCollection(
    {
      page,
      limit: cardsPerPage,
      set: collectionSetSlug,
      grade: grade || undefined,
      finish: finish || undefined,
      guild: guildId || undefined,
      character: characterId || undefined,
      sort: sort || undefined,
      alternative: alternativeOnly || undefined,
      favorite: favoriteOnly || undefined,
    },
    setSelectionReady && !showCatalog,
  );
  const catalogQuery = useCcgCatalog(collectionSetSlug, page, catalogOwnership, grade, guildId, characterId, finish, sort, setSelectionReady && showCatalog, cardsPerPage);
  const cardsQuery = showCatalog ? catalogQuery : ownedQuery;
  const cardsData = cardsQuery.data;
  const cardsLoading = setsQuery.isPending || cardsQuery.isPending;
  const cardsError = cardsQuery.isError;
  const pageCountScope = JSON.stringify([setSlug, characterId, guildId, grade, finish, sort, visibility, alternativeOnly, favoriteOnly, cardsPerPage]);
  const displayedPageCount = cardsData?.pages
    ?? (pageCountCache.scope === pageCountScope ? pageCountCache.pages : 0);

  useEffect(() => {
    if (trimmedCharacterSearch.length < 2) {
      setDebouncedCharacterSearch("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedCharacterSearch(trimmedCharacterSearch), 180);
    return () => window.clearTimeout(timer);
  }, [trimmedCharacterSearch]);

  useEffect(() => {
    if (!setsQuery.isSuccess || setSlug === allSetsSlug || selectedSet) return;
    setSetSlug(allSetsSlug);
  }, [selectedSet, setSlug, setsQuery.isSuccess]);

  useEffect(() => {
    if (!cardsData || page <= cardsData.pages || cardsData.pages === 0) return;
    setPage(cardsData.pages);
  }, [cardsData, page]);

  useEffect(() => {
    if (!cardsData) return;
    setPageCountCache({ scope: pageCountScope, pages: cardsData.pages });
  }, [cardsData, pageCountScope]);

  useEffect(() => {
    if (!finish || finishOptions.includes(finish)) return;
    setFinish("");
    setPage(1);
  }, [finish, finishOptions]);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const mobileViewport = window.matchMedia("(max-width: 760px)");
    if (!mobileViewport.matches) {
      setMobileFiltersOpen(false);
      return;
    }
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileFiltersOpen(false);
    };
    mobileViewport.addEventListener("change", handleViewportChange);
    return () => mobileViewport.removeEventListener("change", handleViewportChange);
  }, [mobileFiltersOpen]);

  useEffect(() => {
    const shortMobileViewport = window.matchMedia("(max-width: 760px) and (max-height: 760px)");
    const updatePageSize = () => {
      const nextPageSize = shortMobileViewport.matches ? shortMobilePageSize : fullPageSize;
      setCardsPerPage(nextPageSize);
      setPage(1);
    };
    updatePageSize();
    shortMobileViewport.addEventListener("change", updatePageSize);
    return () => shortMobileViewport.removeEventListener("change", updatePageSize);
  }, []);

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
    setVisibility("owned");
    setAlternativeOnly(false);
    setFavoriteOnly(false);
    setSelectedCharacter(null);
    setCharacterSearch("");
    setGuildId("");
    setGrade("");
    setFinish("");
    setSort("");
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
    if (!cardsData || cardsLoading || cardsData.pages <= 1) return;
    if ((direction < 0 && page <= 1) || (direction > 0 && page >= cardsData.pages)) return;
    playCcgSound(pageFlipSound, "effects", 1, { interruptKey: "page-flip" });
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

  const startCardPageSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || !window.matchMedia("(max-width: 760px)").matches) return;
    pageSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const moveCardPageSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = pageSwipeRef.current;
    if (swipe.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - swipe.startX, event.clientY - swipe.startY);
    if (swipe.moved || distance < 8) return;
    swipe.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishCardPageSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = pageSwipeRef.current;
    if (swipe.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    const horizontal = Math.abs(deltaX) >= Math.abs(deltaY);
    const distance = horizontal ? Math.abs(deltaX) : Math.abs(deltaY);
    pageSwipeRef.current = { pointerId: -1, startX: 0, startY: 0, moved: false };
    if (distance < pageSwipeThreshold) return;

    suppressCardClickRef.current = true;
    window.setTimeout(() => {
      suppressCardClickRef.current = false;
    }, 0);

    const direction = horizontal
      ? (deltaX > 0 ? 1 : -1)
      : (deltaY > 0 ? 1 : -1);
    turnPage(direction);
  };

  const cancelCardPageSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    if (pageSwipeRef.current.pointerId !== event.pointerId) return;
    pageSwipeRef.current = { pointerId: -1, startX: 0, startY: 0, moved: false };
  };

  const renderMobileAdvancedFilters = () => {
    return (
      <>
        <div className={`${styles.collectionAdvancedFilterItem} ${styles.collectionAlternativeFilterItem}`}>
          <span className={styles.collectionMobileFilterLabel}>{t("collection.alternativeArtwork")}</span>
          <button
            type="button"
            className={`${styles.collectionIconToggle} ${alternativeOnly ? styles.collectionIconToggleActive : ""}`}
            title={t(alternativeOnly ? "collection.showAllOwnedArtworkCards" : "collection.showAlternativeArtworkCards")}
            aria-label={t(alternativeOnly ? "collection.showAllOwnedArtworkCards" : "collection.showAlternativeArtworkCards")}
            aria-pressed={alternativeOnly}
            onClick={() => updateFilter(() => {
              const nextAlternativeOnly = !alternativeOnly;
              setAlternativeOnly(nextAlternativeOnly);
              if (nextAlternativeOnly) setVisibility("owned");
            })}
          >
            <span className={styles.collectionToggleIcon} aria-hidden="true">
              <LuImage className={alternativeOnly ? styles.collectionToggleIconHidden : styles.collectionToggleIconVisible} />
              <LuImages className={alternativeOnly ? styles.collectionToggleIconVisible : styles.collectionToggleIconHidden} />
            </span>
          </button>
        </div>

        <div className={styles.collectionAdvancedFilterItem}>
          <span className={styles.collectionMobileFilterLabel}>{t("collection.characters")}</span>
          <Combobox
            value={selectedCharacter}
            by="id"
            onChange={(character) => {
              updateFilter(() => setSelectedCharacter(character));
              setCharacterSearch("");
              if (character) {
                window.requestAnimationFrame(() => {
                  window.requestAnimationFrame(() => mobileCharacterInputRef.current?.blur());
                });
              }
            }}
            onClose={() => {
              setCharacterSearch("");
              setCharacterInputFocused(false);
            }}
            immediate
          >
            <div className={`${styles.collectionSelect} ${styles.collectionCharacterSelect}`}>
              <ComboboxInput
                ref={mobileCharacterInputRef}
                aria-label={t("collection.searchCharacters")}
                autoComplete="off"
                className={`${styles.collectionGuildSelectInput} ${selectedCharacter ? styles.collectionGuildSelectInputWithSelection : ""}`}
                placeholder={characterInputFocused ? t("collection.typeToSearch") : t("collection.allCharacters")}
                value={characterSearch}
                onChange={(event) => setCharacterSearch(event.target.value)}
                onFocus={() => setCharacterInputFocused(true)}
                onBlur={() => setCharacterInputFocused(false)}
              />
              {selectedCharacter && (
                <span className={styles.collectionGuildSelection} aria-hidden="true">
                  <span className={`${styles.collectionGuildText} ${styles.collectionCharacterText}`}>
                    <span className={styles.collectionCharacterName}>{selectedCharacter.name}</span>
                    <span className={`${styles.collectionGuildRealm} ${styles.collectionCharacterRealm}`}>
                      -{formatRealmName(selectedCharacter.realm)}
                    </span>
                  </span>
                </span>
              )}
              <ComboboxButton
                aria-label={t("collection.selectCharacter")}
                className={styles.collectionGuildSelectToggle}
              />
              <ComboboxOptions
                anchor={{ to: "bottom start", gap: 4, padding: 8 }}
                portal
                modal={false}
                className={`${styles.collectionGuildOptions} ${styles.collectionCharacterOptions}`}
                aria-live="polite"
              >
                {!trimmedCharacterSearch && selectedCharacter && (
                  <ComboboxOption value={null} className={styles.collectionGuildOption}>
                    <span className={styles.collectionGuildText}>{t("collection.allCharacters")}</span>
                  </ComboboxOption>
                )}
                {trimmedCharacterSearch.length < 2 ? (
                  <div className={styles.collectionCharacterSearchStatus}>{t("collection.typeTwoCharacters")}</div>
                ) : characterSearchLoading ? (
                  <div className={styles.collectionCharacterSearchStatus}>{t("collection.searchingCharacters")}</div>
                ) : characterResultsCurrent && characterSearchQuery.isError ? (
                  <div className={`${styles.collectionCharacterSearchStatus} ${styles.collectionCharacterSearchError}`} role="alert">
                    {t("collection.characterSearchError")}
                  </div>
                ) : characterResults.length === 0 ? (
                  <div className={styles.collectionCharacterSearchStatus}>{t("collection.noCharactersFound")}</div>
                ) : characterResults.map((character) => (
                  <ComboboxOption key={character.id} value={character} className={styles.collectionGuildOption}>
                    <span className={`${styles.collectionGuildText} ${styles.collectionCharacterText}`}>
                      <span className={styles.collectionCharacterName}>{character.name}</span>
                      <span className={`${styles.collectionGuildRealm} ${styles.collectionCharacterRealm}`}>
                        -{formatRealmName(character.realm)}
                      </span>
                    </span>
                  </ComboboxOption>
                ))}
              </ComboboxOptions>
            </div>
          </Combobox>
        </div>

        <div className={styles.collectionAdvancedFilterItem}>
          <span className={styles.collectionMobileFilterLabel}>{t("collection.guilds")}</span>
          <Combobox
            value={selectedGuild ?? null}
            by="id"
            onChange={(guild) => {
              updateFilter(() => setGuildId(guild?.id ?? ""));
              setGuildSearch("");
              if (guild) {
                window.requestAnimationFrame(() => {
                  window.requestAnimationFrame(() => mobileGuildInputRef.current?.blur());
                });
              }
            }}
            onClose={() => {
              setGuildSearch("");
              setGuildInputFocused(false);
            }}
            immediate
          >
            <div className={`${styles.collectionSelect} ${styles.collectionGuildSelect}`}>
              <ComboboxInput
                ref={mobileGuildInputRef}
                aria-label={t("collection.searchGuilds")}
                autoComplete="off"
                className={`${styles.collectionGuildSelectInput} ${selectedGuild ? styles.collectionGuildSelectInputWithSelection : ""}`}
                data-unavailable={selectedGuildUnavailable || undefined}
                displayValue={(guild: CcgGuildFacet | null) => !guildInputFocused && guild
                  ? `${guild.name}${duplicateGuildNames.has(guild.name.toLocaleLowerCase()) ? `-${formatRealmName(guild.realm)}` : ""}`
                  : ""}
                placeholder={guildInputFocused ? t("collection.typeToSearch") : t("collection.allGuilds")}
                onChange={(event) => setGuildSearch(event.target.value)}
                onFocus={() => {
                  setGuildInputFocused(true);
                  setGuildsRequested(true);
                }}
                onBlur={() => setGuildInputFocused(false)}
              />
              {selectedGuild && (
                <span className={styles.collectionGuildSelection} aria-hidden="true">
                  <span className={`${styles.collectionGuildText} ${styles.collectionGuildIdentityText}`}>
                    <span className={styles.collectionGuildName}>{selectedGuild.name}</span>
                    {duplicateGuildNames.has(selectedGuild.name.toLocaleLowerCase()) && (
                      <span className={`${styles.collectionGuildRealm} ${styles.collectionGuildRealmOverflow}`}>
                        -{formatRealmName(selectedGuild.realm)}
                      </span>
                    )}
                  </span>
                </span>
              )}
              <ComboboxButton
                aria-label={t("collection.selectGuild")}
                className={styles.collectionGuildSelectToggle}
                onClick={() => setGuildsRequested(true)}
              />
              <ComboboxOptions
                anchor={{ to: "bottom start", gap: 4, padding: 8 }}
                portal
                modal={false}
                className={styles.collectionGuildOptions}
              >
                {!guildSearch.trim() && (
                  <ComboboxOption value={null} className={styles.collectionGuildOption}>
                    <span className={styles.collectionGuildText}>{t("collection.allGuilds")}</span>
                  </ComboboxOption>
                )}
                {filteredGuilds.map((guild) => {
                  const unavailable = guildAvailabilityLoaded && !allSetsSelected && !setGuildIds.has(guild.id);
                  return (
                    <ComboboxOption
                      key={guild.id}
                      value={guild}
                      className={styles.collectionGuildOption}
                      data-unavailable={unavailable || undefined}
                    >
                      <span className={`${styles.collectionGuildText} ${styles.collectionGuildIdentityText}`}>
                        <span className={styles.collectionGuildName}>{guild.name}</span>
                        {duplicateGuildNames.has(guild.name.toLocaleLowerCase()) && (
                          <span className={`${styles.collectionGuildRealm} ${styles.collectionGuildRealmOverflow}`}>
                            -{formatRealmName(guild.realm)}
                          </span>
                        )}
                      </span>
                    </ComboboxOption>
                  );
                })}
              </ComboboxOptions>
            </div>
          </Combobox>
        </div>

        <div className={styles.collectionAdvancedFilterItem}>
          <span className={styles.collectionMobileFilterLabel}>{t("collection.rarities")}</span>
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
        </div>

        <div className={styles.collectionAdvancedFilterItem}>
          <span className={styles.collectionMobileFilterLabel}>{t("collection.qualities")}</span>
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
        </div>
      </>
    );
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
                disabled={setsQuery.isPending}
                onClick={() => selectSet(allSetsSlug)}
                className={`${styles.collectionSet} ${setsQuery.isPending ? styles.collectionSetSkeleton : ""}`}
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
              {setsQuery.isPending ? Array.from({ length: 5 }, (_, index) => (
                <span key={index} className={`${styles.collectionSet} ${styles.collectionSetSkeleton}`} aria-hidden="true" />
              )) : sets.map((set) => (
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
              aria-label={t("collection.resetFiltersLabel")}
              title={t("collection.resetFiltersLabel")}
            >
              <LuRotateCcw aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`${styles.collectionIconToggle} ${visibility === "all" ? styles.collectionIconToggleActive : ""} ${showMissingOnly ? styles.collectionMissingToggleMissingOnly : ""}`}
              title={t(visibilityAction)}
              aria-label={t(visibilityAction)}
              onClick={() => updateFilter(() => {
                setVisibility(nextVisibility);
                setAlternativeOnly(false);
                setFavoriteOnly(false);
                if (nextVisibility === "missing") setFinish("");
              })}
            >
              <span className={styles.collectionToggleIcon} aria-hidden="true">
                <LuEyeOff className={visibility === "owned" ? styles.collectionToggleIconVisible : styles.collectionToggleIconHidden} />
                <LuEye className={visibility === "all" ? styles.collectionToggleIconVisible : styles.collectionToggleIconHidden} />
                <LuCircleDashed className={showMissingOnly ? styles.collectionToggleIconVisible : styles.collectionToggleIconHidden} />
              </span>
            </button>

            <div className={styles.collectionAdvancedFilters}>
            <button
              type="button"
              className={`${styles.collectionIconToggle} ${alternativeOnly ? styles.collectionIconToggleActive : ""}`}
              title={t(alternativeOnly ? "collection.showAllOwnedArtworkCards" : "collection.showAlternativeArtworkCards")}
              aria-label={t(alternativeOnly ? "collection.showAllOwnedArtworkCards" : "collection.showAlternativeArtworkCards")}
              aria-pressed={alternativeOnly}
              onClick={() => updateFilter(() => {
                const nextAlternativeOnly = !alternativeOnly;
                setAlternativeOnly(nextAlternativeOnly);
                if (nextAlternativeOnly) setVisibility("owned");
              })}
            >
              <span className={styles.collectionToggleIcon} aria-hidden="true">
                <LuImage className={alternativeOnly ? styles.collectionToggleIconHidden : styles.collectionToggleIconVisible} />
                <LuImages className={alternativeOnly ? styles.collectionToggleIconVisible : styles.collectionToggleIconHidden} />
              </span>
            </button>

            {signedIn ? (
              <button
                type="button"
                className={`${styles.collectionIconToggle} ${favoriteOnly ? styles.collectionFavoriteToggleActive : ""} ${favoritesQuery.isPending ? styles.collectionIconToggleDisabled : ""}`}
                title={t(favoriteOnly ? "collection.showNonFavoriteCards" : "collection.showFavoriteCards")}
                aria-label={t(favoriteOnly ? "collection.showNonFavoriteCards" : "collection.showFavoriteCards")}
                aria-pressed={favoriteOnly}
                disabled={favoritesQuery.isPending}
                onClick={() => updateFilter(() => {
                  const nextFavoriteOnly = !favoriteOnly;
                  setFavoriteOnly(nextFavoriteOnly);
                  if (nextFavoriteOnly) setVisibility("owned");
                })}
              >
                <span className={styles.collectionToggleIcon} aria-hidden="true">
                  <FaRegStar className={favoriteOnly ? styles.collectionToggleIconHidden : styles.collectionToggleIconVisible} />
                  <FaStar className={favoriteOnly ? styles.collectionToggleIconVisible : styles.collectionToggleIconHidden} />
                </span>
              </button>
            ) : null}

            <Combobox
              value={selectedCharacter}
              by="id"
              onChange={(character) => {
                updateFilter(() => setSelectedCharacter(character));
                setCharacterSearch("");
                if (character) {
                  window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(() => characterInputRef.current?.blur());
                  });
                }
              }}
              onClose={() => {
                setCharacterSearch("");
                setCharacterInputFocused(false);
              }}
              immediate
            >
              <div className={`${styles.collectionSelect} ${styles.collectionCharacterSelect}`}>
                <ComboboxInput
                  ref={characterInputRef}
                  aria-label={t("collection.searchCharacters")}
                  autoComplete="off"
                  className={`${styles.collectionGuildSelectInput} ${selectedCharacter ? styles.collectionGuildSelectInputWithSelection : ""}`}
                  placeholder={characterInputFocused ? t("collection.typeToSearch") : t("collection.allCharacters")}
                  value={characterSearch}
                  onChange={(event) => setCharacterSearch(event.target.value)}
                  onFocus={() => setCharacterInputFocused(true)}
                  onBlur={() => setCharacterInputFocused(false)}
                />
                {selectedCharacter && (
                  <span className={styles.collectionGuildSelection} aria-hidden="true">
                    <span className={`${styles.collectionGuildText} ${styles.collectionCharacterText}`}>
                      <span className={styles.collectionCharacterName}>{selectedCharacter.name}</span>
                      <span className={`${styles.collectionGuildRealm} ${styles.collectionCharacterRealm}`}>
                        -{formatRealmName(selectedCharacter.realm)}
                      </span>
                    </span>
                  </span>
                )}
                <ComboboxButton
                  aria-label={t("collection.selectCharacter")}
                  className={styles.collectionGuildSelectToggle}
                />
                <ComboboxOptions
                  anchor={{ to: "bottom start", gap: 4, padding: 8 }}
                  portal
                  modal={false}
                  className={`${styles.collectionGuildOptions} ${styles.collectionCharacterOptions}`}
                  aria-live="polite"
                >
                  {!trimmedCharacterSearch && selectedCharacter && (
                    <ComboboxOption value={null} className={styles.collectionGuildOption}>
                      <span className={styles.collectionGuildText}>{t("collection.allCharacters")}</span>
                    </ComboboxOption>
                  )}
                  {trimmedCharacterSearch.length < 2 ? (
                    <div className={styles.collectionCharacterSearchStatus}>{t("collection.typeTwoCharacters")}</div>
                  ) : characterSearchLoading ? (
                    <div className={styles.collectionCharacterSearchStatus}>{t("collection.searchingCharacters")}</div>
                  ) : characterResultsCurrent && characterSearchQuery.isError ? (
                    <div className={`${styles.collectionCharacterSearchStatus} ${styles.collectionCharacterSearchError}`} role="alert">
                      {t("collection.characterSearchError")}
                    </div>
                  ) : characterResults.length === 0 ? (
                    <div className={styles.collectionCharacterSearchStatus}>{t("collection.noCharactersFound")}</div>
                  ) : characterResults.map((character) => (
                    <ComboboxOption key={character.id} value={character} className={styles.collectionGuildOption}>
                      <span className={`${styles.collectionGuildText} ${styles.collectionCharacterText}`}>
                        <span className={styles.collectionCharacterName}>{character.name}</span>
                        <span className={`${styles.collectionGuildRealm} ${styles.collectionCharacterRealm}`}>
                          -{formatRealmName(character.realm)}
                        </span>
                      </span>
                    </ComboboxOption>
                  ))}
                </ComboboxOptions>
              </div>
            </Combobox>

            <Combobox
              value={selectedGuild ?? null}
              by="id"
              onChange={(guild) => {
                updateFilter(() => setGuildId(guild?.id ?? ""));
                setGuildSearch("");
                if (guild) {
                  window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(() => guildInputRef.current?.blur());
                  });
                }
              }}
              onClose={() => {
                setGuildSearch("");
                setGuildInputFocused(false);
              }}
              immediate
            >
              <div className={`${styles.collectionSelect} ${styles.collectionGuildSelect}`}>
                <ComboboxInput
                  ref={guildInputRef}
                  aria-label={t("collection.searchGuilds")}
                  autoComplete="off"
                  className={`${styles.collectionGuildSelectInput} ${selectedGuild ? styles.collectionGuildSelectInputWithSelection : ""}`}
                  data-unavailable={selectedGuildUnavailable || undefined}
                  displayValue={(guild: CcgGuildFacet | null) => !guildInputFocused && guild
                    ? `${guild.name}${duplicateGuildNames.has(guild.name.toLocaleLowerCase()) ? `-${formatRealmName(guild.realm)}` : ""}`
                    : ""}
                  placeholder={guildInputFocused ? t("collection.typeToSearch") : t("collection.allGuilds")}
                  onChange={(event) => setGuildSearch(event.target.value)}
                  onFocus={() => {
                    setGuildInputFocused(true);
                    setGuildsRequested(true);
                  }}
                  onBlur={() => setGuildInputFocused(false)}
                />
                {selectedGuild && (
                  <span className={styles.collectionGuildSelection} aria-hidden="true">
                    <span className={`${styles.collectionGuildText} ${styles.collectionGuildIdentityText}`}>
                      <span className={styles.collectionGuildName}>{selectedGuild.name}</span>
                      {duplicateGuildNames.has(selectedGuild.name.toLocaleLowerCase()) && (
                        <span className={`${styles.collectionGuildRealm} ${styles.collectionGuildRealmOverflow}`}>
                          -{formatRealmName(selectedGuild.realm)}
                        </span>
                      )}
                    </span>
                  </span>
                )}
                <ComboboxButton
                  aria-label={t("collection.selectGuild")}
                  className={styles.collectionGuildSelectToggle}
                  onClick={() => setGuildsRequested(true)}
                />
                <ComboboxOptions
                  anchor={{ to: "bottom start", gap: 4, padding: 8 }}
                  portal
                  modal={false}
                  className={styles.collectionGuildOptions}
                >
                  {!guildSearch.trim() && (
                    <ComboboxOption value={null} className={styles.collectionGuildOption}>
                      <span className={styles.collectionGuildText}>{t("collection.allGuilds")}</span>
                    </ComboboxOption>
                  )}
                  {filteredGuilds.map((guild) => {
                    const unavailable = guildAvailabilityLoaded && !allSetsSelected && !setGuildIds.has(guild.id);
                    return (
                      <ComboboxOption
                        key={guild.id}
                        value={guild}
                        className={styles.collectionGuildOption}
                        data-unavailable={unavailable || undefined}
                      >
                        <span className={`${styles.collectionGuildText} ${styles.collectionGuildIdentityText}`}>
                          <span className={styles.collectionGuildName}>{guild.name}</span>
                          {duplicateGuildNames.has(guild.name.toLocaleLowerCase()) && (
                            <span className={`${styles.collectionGuildRealm} ${styles.collectionGuildRealmOverflow}`}>
                              -{formatRealmName(guild.realm)}
                            </span>
                          )}
                        </span>
                      </ComboboxOption>
                    );
                  })}
                </ComboboxOptions>
              </div>
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
            </div>

            <label className={`${styles.collectionSelect} ${styles.collectionSortControl}`}>
              <select
                aria-label={t("collection.sort")}
                className={styles.collectionSortSelect}
                value={sort}
                onChange={(event) => updateFilter(() => setSort(event.target.value as CcgCollectionSort | ""))}
              >
                <option value="">{t("collection.sortDefault")}</option>
                {collectionSortOptions.map((item) => (
                  <option key={item.value} value={item.value}>{t(`collection.${item.label}`)}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={`${styles.collectionMobileFilterButton} ${advancedFilterCount > 0 ? styles.collectionMobileFilterButtonActive : ""}`}
              onClick={() => setMobileFiltersOpen(true)}
              aria-label={t("collection.openFilters")}
              title={t("collection.openFilters")}
              aria-haspopup="dialog"
              aria-expanded={mobileFiltersOpen}
            >
              <LuFilter aria-hidden="true" />
              {advancedFilterCount > 0 ? <span aria-hidden="true">{advancedFilterCount}</span> : null}
            </button>

            <span
              className={styles.collectionPageCount}
              aria-label={t("collection.page", {
                page: displayedPageCount > 0 ? page : 0,
                pages: displayedPageCount,
              })}
              aria-live="polite"
            >
              <span>{displayedPageCount > 0 ? page : 0}</span>
              <small>{t("collection.pageTotal", { pages: displayedPageCount })}</small>
            </span>
          </div>
        </section>

        <section
          className={styles.collectionBinder}
          data-page-size={cardsPerPage}
          aria-busy={cardsLoading}
          onWheel={wheelCardPages}
          onPointerDown={startCardPageSwipe}
          onPointerMove={moveCardPageSwipe}
          onPointerUp={finishCardPageSwipe}
          onPointerCancel={cancelCardPageSwipe}
          onClickCapture={(event) => {
            if (!suppressCardClickRef.current) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
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
                  const favorite = favoriteCardIds.has(card.id)
                    || Boolean(card.variants?.some((variant) => favoriteCardIds.has(variant.card.id)));
                  return (
                    <CollectionCard
                      key={`${card.id}:${card.renderUrl ?? ""}`}
                      card={card}
                      finish={ownedFinish?.finish ?? "standard"}
                      artVariant={ownedFinish?.artVariant ?? "standard"}
                      quantity={ownedFinish?.total}
                      favorite={favorite}
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
                  <h2>{t(favoriteOnly ? "collection.emptyFavoriteTitle" : alternativeOnly ? "collection.emptyAlternativeTitle" : guildId ? "collection.emptyGuildTitle" : showCatalog ? "collection.emptyMissingTitle" : "collection.emptyOwnedTitle")}</h2>
                  <p>{t(favoriteOnly ? "collection.emptyFavoriteBody" : alternativeOnly ? "collection.emptyAlternativeBody" : guildId ? showCatalog ? "collection.emptyGuildMissingBody" : "collection.emptyGuildBody" : showCatalog ? "collection.emptyMissingBody" : "collection.emptyOwnedBody")}</p>
                  {favoriteOnly ? (
                    <div className={styles.collectionEmptyActions}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => updateFilter(() => {
                          setFavoriteOnly(false);
                          setAlternativeOnly(false);
                        })}
                      >
                        {t("collection.showAllOwnedArtworkCards")}
                      </button>
                    </div>
                  ) : !guildId && !showCatalog ? (
                    <div className={styles.collectionEmptyActions}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => updateFilter(() => {
                          setVisibility("missing");
                          setAlternativeOnly(false);
                          setFinish("");
                        })}
                      >
                        {t("collection.showMissing")}
                      </button>
                      <Link href={`/ccg/open?mode=${selectedSet?.state === "legacy" ? "legacy" : "current"}`} className={styles.secondaryButton}>
                        {t("collection.openPacks")}
                      </Link>
                    </div>
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

      <Dialog open={mobileFiltersOpen} onClose={setMobileFiltersOpen} className={styles.collectionMobileFilterDialogRoot}>
        <DialogBackdrop transition className={styles.collectionMobileFilterDialogBackdrop} />
        <div className={styles.collectionMobileFilterDialogFrame}>
          <DialogPanel transition className={styles.collectionMobileFilterDialog}>
            <header className={styles.collectionMobileFilterDialogHeader}>
              <DialogTitle className={styles.collectionMobileFilterDialogTitle}>{t("collection.filters")}</DialogTitle>
              <button
                autoFocus
                type="button"
                className={styles.collectionMobileFilterDialogClose}
                onClick={() => setMobileFiltersOpen(false)}
                aria-label={t("collection.closeFilters")}
              >
                <LuX aria-hidden="true" />
              </button>
            </header>
            <div className={styles.collectionMobileFilterDialogBody}>
              <p className={styles.collectionMobileFilterDescription}>{t("collection.filterChangesImmediate")}</p>
              <div className={styles.collectionMobileFilterFields}>
                {renderMobileAdvancedFilters()}
              </div>
            </div>
            <footer className={styles.collectionMobileFilterDialogFooter}>
              <button
                type="button"
                className={`${styles.primaryButton} ${styles.collectionMobileFilterDone}`}
                onClick={() => setMobileFiltersOpen(false)}
              >
                {t("collection.done")}
              </button>
            </footer>
          </DialogPanel>
        </div>
      </Dialog>

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
