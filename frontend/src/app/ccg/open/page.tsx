"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CcgBaseFinish, CcgBootstrapResponse, CcgFinish, CcgOpening } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { CCG_BASE_FINISH_ORDER, CCG_FINISH_ORDER, CCG_FINISH_PITY_LIMITS, CCG_RARITY_KEYS } from "@/lib/ccg";
import {
  getCcgAnnouncerSoundSources,
  getCcgPlaybackVolume,
  playCcgSound,
  preloadCcgSounds,
  resumeCcgAudio,
  type CcgAudioChannel,
} from "@/lib/ccg-audio";
import { CCG_CARD_SLIDE_SOUNDS, CCG_QUALITY_SOUND_FILES, hasCcgQualityRevealSound } from "@/lib/ccg-reveal-audio";
import { applyPackPointerMotion, resetPackMotion } from "@/lib/ccg-pack-motion";
import { queryKeys, useCcgOpening, useCcgSession, useCcgSets } from "@/lib/queries";
import IconImage from "@/components/IconImage";
import CcgShell from "@/components/ccg/CcgShell";
import PackBalance from "@/components/ccg/PackBalance";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer, { openCardViewer } from "@/components/ccg/CardViewer";
import type { CardViewerOriginBounds } from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import { CcgOpenContentSkeleton } from "@/components/ccg/CcgPageSkeletons";
import CcgShareButton from "@/components/ccg/CcgShareButton";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import styles from "@/components/ccg/ccg.module.css";
import packStyles from "@/components/ccg/pack-opening.module.css";

type RevealPhase = "idle" | "holding" | "tearing" | "dealing" | "ready";
type PackSelection = { setId?: string };
type PackRequest = PackSelection & { idempotencyKey: string };

const fanAngles = [-5.5, -2.5, 0, 2.5, 5.5];
const fanOffsets = [24, 5, 0, 5, 24];
const dealOffsets = [
  "calc(200% + var(--card-fan-gap) + var(--card-fan-gap))",
  "calc(100% + var(--card-fan-gap))",
  "0%",
  "calc(-100% - var(--card-fan-gap))",
  "calc(-200% - var(--card-fan-gap) - var(--card-fan-gap))",
];
const ALL_RAIDS = "all";
const MOBILE_REVEAL_BREAKPOINT = "(max-width: 760px)";
const HOVER_SOUND = "/ccg/audio/hover.mp3";
const FADE_OUT_SOUND = "/ccg/audio/fade_out.mp3";
const SHUFFLE_SOUND = "/ccg/audio/shuffle.mp3";
const DRAW_SOUND = "/ccg/audio/draw.mp3";
const protectedFinishes = CCG_BASE_FINISH_ORDER.filter(
  (finish): finish is Exclude<CcgBaseFinish, "standard"> => finish !== "standard",
);
const tearParticles = [
  { x: -132, y: -74, rotate: -34, delay: 90 },
  { x: -98, y: -126, rotate: -18, delay: 120 },
  { x: -48, y: -146, rotate: 12, delay: 145 },
  { x: 24, y: -154, rotate: 28, delay: 110 },
  { x: 86, y: -118, rotate: 46, delay: 135 },
  { x: 138, y: -62, rotate: 65, delay: 95 },
  { x: -142, y: 30, rotate: -58, delay: 150 },
  { x: -82, y: 82, rotate: -26, delay: 170 },
  { x: 88, y: 76, rotate: 34, delay: 160 },
  { x: 146, y: 24, rotate: 62, delay: 130 },
];

function makeIdempotencyKey(): string {
  return `pack_${window.crypto.randomUUID()}`;
}

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return value[0] % length;
}

function getPullStatusKey(result: CcgOpening["results"][number]):
  | "open.completedBonusPack"
  | "open.newCard"
  | "open.newFinish"
  | "open.newSnapshot"
  | "open.duplicate"
  | "open.newPull" {
  if (result.bonusPackReward) return "open.completedBonusPack";
  if (result.isNewCard) return "open.newCard";
  if (result.isNewFinish) return "open.newFinish";
  if (result.isNewSnapshot) return "open.newSnapshot";
  return result.isDuplicate ? "open.duplicate" : "open.newPull";
}

function ArchiveIcon() {
  return (
    <span className={packStyles.archiveIcon} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function playSound(source: string | null | undefined, channel: CcgAudioChannel, volume: number, playbackRate = 1): void {
  playCcgSound(source, channel, volume, { playbackRate });
}

function playPackSound(source: string | null | undefined, volume: number, playbackRate = 1): void {
  playSound(source, "effects", volume, playbackRate);
}

function playRandomPackSound(sources: readonly string[], volume: number): void {
  playPackSound(sources[randomIndex(sources.length)], volume);
}

export default function CcgOpenPage() {
  const t = useTranslations("ccg");
  const locale = useLocale() === "fi" ? "fi" : "en";
  const { login, user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const sessionQuery = useCcgSession(!authLoading);
  const setsQuery = useCcgSets(!authLoading);
  const [selectedSetId, setSelectedSetId] = useState(ALL_RAIDS);
  const [opening, setOpening] = useState<CcgOpening | null>(null);
  const [recoveryId, setRecoveryId] = useState("");
  const [recoveryInitialized, setRecoveryInitialized] = useState(false);
  const [revealPhase, setRevealPhase] = useState<RevealPhase>("idle");
  const [dealtCards, setDealtCards] = useState(0);
  const [revealedCards, setRevealedCards] = useState<Set<number>>(() => new Set());
  const [mobileAdvancedCards, setMobileAdvancedCards] = useState<Set<number>>(() => new Set());
  const [mobileSummaryVisible, setMobileSummaryVisible] = useState(false);
  const [isMobileRevealViewport, setIsMobileRevealViewport] = useState(false);
  const [isMobileRevealAllHolding, setIsMobileRevealAllHolding] = useState(false);
  const [isMobileAutoRevealing, setIsMobileAutoRevealing] = useState(false);
  const [activeReveal, setActiveReveal] = useState<{ index: number; x: number; y: number } | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerOriginElement, setViewerOriginElement] = useState<HTMLElement | null>(null);
  const [viewerOriginBounds, setViewerOriginBounds] = useState<CardViewerOriginBounds | null>(null);
  const [viewerSharedTransition, setViewerSharedTransition] = useState(false);
  const [packSelectorOpen, setPackSelectorOpen] = useState(false);
  const [isPackCycling, setIsPackCycling] = useState(false);
  const [rechargeNow, setRechargeNow] = useState(() => Date.now());
  const cardFanScrollerRef = useRef<HTMLDivElement | null>(null);
  const packSelectorDialogRef = useRef<HTMLDivElement | null>(null);
  const packSelectorToggleRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const qualitySoundTimersRef = useRef<number[]>([]);
  const quipSoundTimersRef = useRef<number[]>([]);
  const announcerSoundTimersRef = useRef<number[]>([]);
  const packDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, dragging: false, suppressClick: false });
  const sealedMotionFrame = useRef<number | null>(null);
  const pendingSealedMotion = useRef<{ element: HTMLButtonElement; x: number; y: number } | null>(null);
  const nextPackTimerRef = useRef<number | null>(null);
  const mobileSummaryTimerRef = useRef<number | null>(null);
  const mobileRevealAllHoldTimerRef = useRef<number | null>(null);
  const mobileAutoRevealTimersRef = useRef<number[]>([]);
  const mobileRevealAllPointerActiveRef = useRef(false);
  const packRequestPendingRef = useRef(false);
  const revealedRecoveryIdRef = useRef<string | null>(null);
  const mobileCardGestureRef = useRef({
    pointerId: -1,
    index: -1,
    startX: 0,
    startY: 0,
    dragging: false,
    suppressClick: false,
  });
  const recoveryQuery = useCcgOpening(recoveryId, !authLoading && sessionQuery.isSuccess);
  const session = sessionQuery.data;
  const sets = setsQuery.data?.sets;
  const raidSets = useMemo(
    () => (sets ?? [])
      .filter((set) => set.kind === "raid" && (set.state === "current" || set.state === "legacy") && set.cardCount > 0)
      .sort((left, right) => Number(right.state === "current") - Number(left.state === "current") || right.zoneId - left.zoneId),
    [sets],
  );
  const currentSets = useMemo(() => raidSets.filter((set) => set.state === "current"), [raidSets]);
  const currentSet = currentSets[0];
  const selectedSet = raidSets.find((set) => set.id === selectedSetId);
  const allRaids = !selectedSet;
  const featuredPackSet = selectedSet ?? currentSet;
  const selectorSet = selectedSet;
  const selectedPackSets = selectedSet ? [selectedSet] : raidSets;
  const hasCustomQualityRow = selectedPackSets.some((set) => Boolean(set.customFinish));
  const qualityRows = useMemo(() => [
    ...protectedFinishes.map((finish) => ({
      key: finish,
      finish,
      counter: session?.qualityProtection[finish] ?? 0,
      hardPity: CCG_FINISH_PITY_LIMITS[finish],
    })),
    ...selectedPackSets.flatMap((set) => {
      if (!set.customFinish) return [];
      const progress = session?.customQualityProtection?.find((row) => row.setSlug === set.slug);
      return [{
        key: `${set.slug}:${set.customFinish.key}`,
        finish: set.customFinish.key,
        counter: progress?.counter ?? 0,
        hardPity: set.customFinish.hardPity,
      }];
    }),
  ], [selectedPackSets, session]);
  const oddsFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    [locale],
  );
  const selectedPackCardCount = selectedPackSets.reduce((total, set) => total + set.cardCount, 0);
  const selectedPackOwnedCount = selectedPackSets.reduce((total, set) => total + set.ownedCards, 0);
  const selectedPackProgress = selectedPackCardCount > 0 ? Math.min(1, selectedPackOwnedCount / selectedPackCardCount) : 0;
  const raidIconByZone = useMemo(() => new Map((sets ?? []).map((set) => [set.zoneId, set.iconUrl ?? undefined])), [sets]);
  const poolTitle = selectedSet?.raidName ?? t("open.allRaids");

  useEffect(() => {
    const mobileViewport = window.matchMedia(MOBILE_REVEAL_BREAKPOINT);
    const updateMobileViewport = () => setIsMobileRevealViewport(mobileViewport.matches);
    updateMobileViewport();
    mobileViewport.addEventListener("change", updateMobileViewport);
    return () => mobileViewport.removeEventListener("change", updateMobileViewport);
  }, []);

  const clearMobileRevealAllTimers = () => {
    if (mobileRevealAllHoldTimerRef.current !== null) {
      window.clearTimeout(mobileRevealAllHoldTimerRef.current);
      mobileRevealAllHoldTimerRef.current = null;
    }
    mobileAutoRevealTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    mobileAutoRevealTimersRef.current = [];
  };

  const closePackSelector = () => {
    setPackSelectorOpen(false);
    window.requestAnimationFrame(() => packSelectorToggleRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    preloadCcgSounds([HOVER_SOUND, FADE_OUT_SOUND, SHUFFLE_SOUND, DRAW_SOUND, ...CCG_CARD_SLIDE_SOUNDS]);
  }, []);

  useEffect(() => {
    if (!packSelectorOpen) return;

    const mobileViewport = window.matchMedia("(max-width: 760px)");
    if (!mobileViewport.matches) {
      setPackSelectorOpen(false);
      return;
    }

    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscroll = root.style.overscrollBehavior;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    const focusFrame = window.requestAnimationFrame(() => {
      const selectedChoice = packSelectorDialogRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      selectedChoice?.focus({ preventScroll: true });
      selectedChoice?.scrollIntoView({ block: "center" });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPackSelectorOpen(false);
        window.requestAnimationFrame(() => packSelectorToggleRef.current?.focus({ preventScroll: true }));
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = packSelectorDialogRef.current;
      const focusable = dialog
        ? Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter((button) => button.offsetParent !== null)
        : [];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setPackSelectorOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    mobileViewport.addEventListener("change", handleViewportChange);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      mobileViewport.removeEventListener("change", handleViewportChange);
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscroll;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [packSelectorOpen]);

  useEffect(() => {
    if (!opening) return;
    preloadCcgSounds(opening.results.flatMap((result) => {
      const qualitySound = CCG_QUALITY_SOUND_FILES[result.finish];
      const qualitySource = qualitySound && hasCcgQualityRevealSound(result.finish, result.card.tierGrade)
        ? `/ccg/audio/quality/${qualitySound}`
        : null;
      return [
        qualitySource,
        result.card.quip?.audioPath,
        ...getCcgAnnouncerSoundSources(locale, result.finish, result.card.tierGrade, result.artVariant),
      ];
    }));
  }, [locale, opening]);

  useEffect(() => {
    if (!sets) return;
    if (selectedSetId !== ALL_RAIDS && !raidSets.some((set) => set.id === selectedSetId)) {
      setSelectedSetId(ALL_RAIDS);
    }
  }, [raidSets, selectedSetId, sets]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedSet = params.get("set");
    if (requestedSet) setSelectedSetId(requestedSet);
    const requestedOpening = params.get("opening");
    if (requestedOpening && /^[a-f\d]{24}$/i.test(requestedOpening)) {
      setRecoveryId(requestedOpening);
      revealedRecoveryIdRef.current = params.get("revealed") === "true" ? requestedOpening : null;
    }
    else if (requestedOpening) {
      params.delete("opening");
      params.delete("revealed");
      const search = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    }
    setRecoveryInitialized(true);
  }, []);

  useEffect(
    () => () => {
      if (sealedMotionFrame.current !== null) cancelAnimationFrame(sealedMotionFrame.current);
      if (nextPackTimerRef.current !== null) window.clearTimeout(nextPackTimerRef.current);
      if (mobileSummaryTimerRef.current !== null) window.clearTimeout(mobileSummaryTimerRef.current);
      if (mobileRevealAllHoldTimerRef.current !== null) window.clearTimeout(mobileRevealAllHoldTimerRef.current);
      mobileAutoRevealTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      qualitySoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      quipSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      announcerSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    const recovered = recoveryQuery.data;
    if (!recovered || opening?.id === recovered.id) return;
    setSelectedSetId(recovered.selection.type === "raid" ? recovered.selection.setId : ALL_RAIDS);
    setOpening(recovered);
  }, [opening?.id, recoveryQuery.data]);

  useEffect(() => {
    if (!opening) return;
    cardFanScrollerRef.current?.scrollTo({ left: 0 });
    const total = opening.results.length;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealImmediately = opening.id === revealedRecoveryIdRef.current;
    qualitySoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    qualitySoundTimersRef.current = [];
    quipSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    quipSoundTimersRef.current = [];
    announcerSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    announcerSoundTimersRef.current = [];
    setViewerIndex(null);
    setViewerOriginElement(null);
    setViewerOriginBounds(null);
    setActiveReveal(null);
    setMobileAdvancedCards(new Set());
    setMobileSummaryVisible(false);
    setIsMobileRevealAllHolding(false);
    setIsMobileAutoRevealing(false);
    if (reduced || revealImmediately) {
      if (reduced && !revealImmediately) playPackSound(SHUFFLE_SOUND, 0.42);
      setRevealPhase("ready");
      setDealtCards(total);
      setRevealedCards(new Set(opening.results.map((_, index) => index)));
      setMobileAdvancedCards(new Set(opening.results.map((_, index) => index)));
      setMobileSummaryVisible(true);
      return;
    }

    setRevealPhase("holding");
    setDealtCards(0);
    setRevealedCards(new Set());
    let tearTimer: number | undefined;
    let readyTimer: number | undefined;
    const drawSoundTimers: number[] = [];
    const holdTimer = window.setTimeout(() => {
      playPackSound(SHUFFLE_SOUND, 0.42);
      setRevealPhase("tearing");
      tearTimer = window.setTimeout(() => {
        setRevealPhase("dealing");
        setDealtCards(total);
        Array.from({ length: total }).forEach((_, index) => {
          drawSoundTimers.push(window.setTimeout(() => playPackSound(DRAW_SOUND, 0.32, [0.96, 1.02, 0.99, 1.04, 0.97][index] ?? 1), index * 58));
        });
        readyTimer = window.setTimeout(() => setRevealPhase("ready"), 780);
      }, 640);
    }, 240);

    return () => {
      window.clearTimeout(holdTimer);
      if (tearTimer) window.clearTimeout(tearTimer);
      if (readyTimer) window.clearTimeout(readyTimer);
      drawSoundTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [opening]);

  useEffect(() => {
    if (revealPhase !== "ready" || revealedCards.size > 0) return;
    cardRefs.current[0]?.focus({ preventScroll: true });
  }, [revealPhase, revealedCards.size]);

  const mutation = useMutation({
    mutationFn: async (request: PackRequest) => {
      const result = await api.openCcgPack({
        idempotencyKey: request.idempotencyKey,
        setId: request.setId,
      });
      queryClient.setQueryData(queryKeys.ccg.opening(result.id), result);
      const url = new URL(window.location.href);
      url.searchParams.delete("mode");
      if (result.selection.type === "raid") url.searchParams.set("set", result.selection.setId);
      else url.searchParams.delete("set");
      url.searchParams.set("opening", result.id);
      url.searchParams.delete("revealed");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      return result;
    },
    onSuccess: (result) => {
      revealedRecoveryIdRef.current = null;
      setIsPackCycling(false);
      setRevealPhase("holding");
      setDealtCards(0);
      setRevealedCards(new Set());
      setActiveReveal(null);
      setSelectedSetId(result.selection.type === "raid" ? result.selection.setId : ALL_RAIDS);
      setOpening(result);
      const updates = result.cacheUpdates;
      if (updates) {
        queryClient.setQueryData<CcgBootstrapResponse>(queryKeys.ccg.bootstrap, (bootstrap) => {
          if (!bootstrap) return bootstrap;
          const customUpdates = new Map(updates.customQualityProtection.map((row) => [row.setSlug, row]));
          return {
            session: {
              ...bootstrap.session,
              packs: updates.packs,
              qualityProtection: updates.qualityProtection,
              customQualityProtection: bootstrap.session.customQualityProtection.map((row) => {
                const update = customUpdates.get(row.setSlug);
                return update ? { ...row, counter: update.counter } : row;
              }),
              ownedFinishes: bootstrap.session.ownedFinishes + updates.ownedFinishesDelta,
            },
            sets: bootstrap.sets.map((set) => ({
              ...set,
              ownedCards: set.ownedCards + (updates.ownedCardsBySetDelta[set.id] ?? 0),
            })),
          };
        });
      } else {
        queryClient.invalidateQueries({ queryKey: queryKeys.ccg.bootstrap });
      }
      queryClient.invalidateQueries({ queryKey: ["ccg", "catalog"] });
      queryClient.invalidateQueries({ queryKey: ["ccg", "collection"] });
      queryClient.invalidateQueries({ queryKey: ["ccg", "featured"] });
    },
    onError: () => setIsPackCycling(false),
    onSettled: () => {
      packRequestPendingRef.current = false;
    },
  });

  const submitPackOpening = (selection: PackSelection, delayMs = 0): boolean => {
    if (packRequestPendingRef.current) return false;
    packRequestPendingRef.current = true;
    const request: PackRequest = { ...selection, idempotencyKey: makeIdempotencyKey() };
    if (delayMs === 0) {
      mutation.mutate(request);
    } else {
      nextPackTimerRef.current = window.setTimeout(() => {
        nextPackTimerRef.current = null;
        mutation.mutate(request);
      }, delayMs);
    }
    return true;
  };

  const queryFailed = sessionQuery.isError || setsQuery.isError;
  const bootstrapLoading = authLoading
    || sessionQuery.isPending
    || setsQuery.isPending
    || !recoveryInitialized
    || (Boolean(recoveryId) && recoveryQuery.isPending);
  const noPacks = session ? session.packs.totalRemaining <= 0 : false;
  const clearSavedOpening = () => {
    clearMobileRevealAllTimers();
    qualitySoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    qualitySoundTimersRef.current = [];
    quipSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    quipSoundTimersRef.current = [];
    announcerSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    announcerSoundTimersRef.current = [];
    setOpening(null);
    setRevealPhase("idle");
    setDealtCards(0);
    setRevealedCards(new Set());
    setMobileAdvancedCards(new Set());
    setMobileSummaryVisible(false);
    setIsMobileRevealAllHolding(false);
    setIsMobileAutoRevealing(false);
    setActiveReveal(null);
    setViewerIndex(null);
    setViewerOriginElement(null);
    setViewerOriginBounds(null);
    setRecoveryId("");
    revealedRecoveryIdRef.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("opening");
    url.searchParams.delete("revealed");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const allRevealed = Boolean(opening) && revealedCards.size >= (opening?.results.length ?? 0);
  const packComplete = allRevealed && (!isMobileRevealViewport || mobileSummaryVisible);
  const mobileActiveCardIndex = opening
    ? opening.results.findIndex((_, index) => !mobileAdvancedCards.has(index))
    : -1;
  const mobileActiveCardRevealed = mobileActiveCardIndex >= 0 && revealedCards.has(mobileActiveCardIndex);
  const summaryRankByIndex = useMemo(() => {
    if (!opening) return new Map<number, number>();
    const gradeOrder = ["H", "S", "A", "B", "C", "D", "E", "F"];
    const ranked = opening.results
      .map((result, index) => ({ result, index }))
      .sort((left, right) => {
        const finishDifference = CCG_FINISH_ORDER.indexOf(right.result.finish) - CCG_FINISH_ORDER.indexOf(left.result.finish);
        if (finishDifference !== 0) return finishDifference;
        return gradeOrder.indexOf(left.result.card.tierGrade) - gradeOrder.indexOf(right.result.card.tierGrade);
      });
    return new Map(ranked.map(({ index }, rank) => [index, rank]));
  }, [opening]);

  useEffect(() => {
    if (!isMobileRevealViewport || mobileActiveCardIndex < 0 || revealPhase !== "ready") return;
    const focusFrame = window.requestAnimationFrame(() => cardRefs.current[mobileActiveCardIndex]?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(focusFrame);
  }, [isMobileRevealViewport, mobileActiveCardIndex, revealPhase]);

  const advanceMobileCard = (index: number) => {
    if (!opening || index !== mobileActiveCardIndex || !revealedCards.has(index) || mobileSummaryVisible) return;
    setMobileAdvancedCards((current) => new Set(current).add(index));
    if (mobileAdvancedCards.size >= opening.results.length - 1) {
      if (mobileSummaryTimerRef.current !== null) window.clearTimeout(mobileSummaryTimerRef.current);
      mobileSummaryTimerRef.current = window.setTimeout(() => {
        mobileSummaryTimerRef.current = null;
        setMobileSummaryVisible(true);
      }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
    }
  };

  const playQualitySoundAfterFlip = (index: number) => {
    const result = opening?.results[index];
    if (!result || !hasCcgQualityRevealSound(result.finish, result.card.tierGrade)) return;
    const soundFile = CCG_QUALITY_SOUND_FILES[result.finish];
    if (!soundFile) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
    const timer = window.setTimeout(() => playPackSound(`/ccg/audio/quality/${soundFile}`, 0.4), delay);
    qualitySoundTimersRef.current.push(timer);
  };

  const playQuipAfterFlip = (index: number) => {
    const result = opening?.results[index];
    const source = result?.card.quip?.audioPath;
    if (!source || getCcgPlaybackVolume("quips", 0.9) <= 0) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220;
    const timer = window.setTimeout(() => playSound(source, "quips", 0.9), delay);
    quipSoundTimersRef.current.push(timer);
  };

  const playAnnouncerAfterFlip = (index: number) => {
    const result = opening?.results[index];
    const available = result
      ? getCcgAnnouncerSoundSources(locale, result.finish, result.card.tierGrade, result.artVariant)
      : [];
    if (available.length === 0) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360;
    const timer = window.setTimeout(
      () => playSound(available[randomIndex(available.length)], "announcer", 0.78),
      delay,
    );
    announcerSoundTimersRef.current.push(timer);
  };

  const revealCard = (index: number, event?: ReactMouseEvent<HTMLButtonElement>) => {
    if (revealPhase !== "ready" || index >= dealtCards) return;
    if (isMobileRevealViewport && mobileCardGestureRef.current.suppressClick) {
      mobileCardGestureRef.current.suppressClick = false;
      return;
    }
    if (isMobileRevealViewport && !packComplete && index !== mobileActiveCardIndex) return;
    if (revealedCards.has(index)) {
      if (isMobileRevealViewport && !packComplete) {
        advanceMobileCard(index);
        return;
      }
      const originElement = event?.currentTarget ?? cardRefs.current[index];
      openCardViewer(originElement, (sharedTransition, originBounds) => {
        setViewerOriginElement(originElement);
        setViewerOriginBounds(originBounds);
        setViewerSharedTransition(sharedTransition);
        setViewerIndex(index);
      }, event);
      return;
    }
    if (event && event.detail > 0 && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const surface = event.currentTarget.querySelector<HTMLElement>("[data-card-surface]");
      const bounds = (surface ?? event.currentTarget).getBoundingClientRect();
      setActiveReveal({
        index,
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      });
    }
    playRandomPackSound(CCG_CARD_SLIDE_SOUNDS, 0.36);
    playQualitySoundAfterFlip(index);
    playQuipAfterFlip(index);
    if (!opening?.results[index]?.card.quip?.audioPath) playAnnouncerAfterFlip(index);
    setRevealedCards((current) => new Set(current).add(index));
  };

  const revealAll = () => {
    if (!opening || revealPhase !== "ready") return;
    setActiveReveal(null);
    playRandomPackSound(CCG_CARD_SLIDE_SOUNDS, 0.32);
    opening.results.forEach((result, index) => {
      if (!revealedCards.has(index) && hasCcgQualityRevealSound(result.finish, result.card.tierGrade)) playQualitySoundAfterFlip(index);
    });
    const prioritizedResults = opening.results
      .map((result, index) => ({ result, index }))
      .filter(({ index }) => !revealedCards.has(index))
      .sort((left, right) => {
        const finishDifference = CCG_FINISH_ORDER.indexOf(right.result.finish) - CCG_FINISH_ORDER.indexOf(left.result.finish);
        if (finishDifference !== 0) return finishDifference;
        return ["H", "S", "A", "B", "C", "D", "E", "F"].indexOf(left.result.card.tierGrade)
          - ["H", "S", "A", "B", "C", "D", "E", "F"].indexOf(right.result.card.tierGrade);
      });
    const voiceResult = prioritizedResults.find(({ result }) => (
      result.card.quip?.audioPath
        ? getCcgPlaybackVolume("quips", 0.9) > 0
        : getCcgPlaybackVolume("announcer", 0.78) > 0
          && getCcgAnnouncerSoundSources(locale, result.finish, result.card.tierGrade, result.artVariant).length > 0
    ));
    if (voiceResult?.result.card.quip?.audioPath) playQuipAfterFlip(voiceResult.index);
    else if (voiceResult) playAnnouncerAfterFlip(voiceResult.index);
    setRevealedCards(new Set(opening.results.map((_, index) => index)));
    setMobileAdvancedCards(new Set(opening.results.map((_, index) => index)));
    setMobileSummaryVisible(true);
  };

  const runMobileRevealAll = () => {
    if (!opening || revealPhase !== "ready" || isMobileAutoRevealing) return;
    clearMobileRevealAllTimers();
    setIsMobileRevealAllHolding(false);
    setIsMobileAutoRevealing(true);
    const remaining = opening.results
      .map((result, index) => ({ result, index }))
      .filter(({ index }) => !mobileAdvancedCards.has(index));
    if (remaining.length === 0) {
      setMobileSummaryVisible(true);
      setIsMobileAutoRevealing(false);
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stepDuration = reducedMotion ? 0 : 280;
    const advanceDelay = reducedMotion ? 0 : 210;
    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(callback, delay);
      mobileAutoRevealTimersRef.current.push(timer);
    };

    remaining.forEach(({ result, index }, position) => {
      const revealDelay = position * stepDuration;
      if (!revealedCards.has(index)) {
        schedule(() => {
          playRandomPackSound(CCG_CARD_SLIDE_SOUNDS, 0.3);
          if (hasCcgQualityRevealSound(result.finish, result.card.tierGrade)) playQualitySoundAfterFlip(index);
          setRevealedCards((current) => new Set(current).add(index));
        }, revealDelay);
      }
      schedule(() => {
        setMobileAdvancedCards((current) => new Set(current).add(index));
      }, revealDelay + (revealedCards.has(index) ? Math.min(80, advanceDelay) : advanceDelay));
    });

    const prioritizedResult = [...remaining].sort((left, right) => {
      const finishDifference = CCG_FINISH_ORDER.indexOf(right.result.finish) - CCG_FINISH_ORDER.indexOf(left.result.finish);
      if (finishDifference !== 0) return finishDifference;
      return ["H", "S", "A", "B", "C", "D", "E", "F"].indexOf(left.result.card.tierGrade)
        - ["H", "S", "A", "B", "C", "D", "E", "F"].indexOf(right.result.card.tierGrade);
    })[0];
    const completionDelay = (remaining.length - 1) * stepDuration + advanceDelay + (reducedMotion ? 0 : 120);
    schedule(() => {
      if (prioritizedResult?.result.card.quip?.audioPath) playQuipAfterFlip(prioritizedResult.index);
      else if (prioritizedResult) playAnnouncerAfterFlip(prioritizedResult.index);
      setMobileSummaryVisible(true);
      setIsMobileAutoRevealing(false);
      mobileAutoRevealTimersRef.current = [];
    }, completionDelay);
  };

  const startMobileRevealAllHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isMobileRevealViewport || isMobileAutoRevealing || revealPhase !== "ready") return;
    clearMobileRevealAllTimers();
    mobileRevealAllPointerActiveRef.current = true;
    setIsMobileRevealAllHolding(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    mobileRevealAllHoldTimerRef.current = window.setTimeout(() => {
      mobileRevealAllHoldTimerRef.current = null;
      runMobileRevealAll();
    }, 480);
  };

  const cancelMobileRevealAllHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isMobileRevealViewport) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (mobileRevealAllHoldTimerRef.current !== null) {
      window.clearTimeout(mobileRevealAllHoldTimerRef.current);
      mobileRevealAllHoldTimerRef.current = null;
    }
    setIsMobileRevealAllHolding(false);
    window.setTimeout(() => {
      mobileRevealAllPointerActiveRef.current = false;
    }, 0);
  };

  const canOpen = recoveryInitialized && !recoveryId && Boolean(session) && !queryFailed && raidSets.length > 0 && !noPacks && !mutation.isPending;
  const hasAnotherPack = Boolean(opening && session && session.packs.totalRemaining > 0);
  const shouldPromptGuestLogin = session?.ownerType === "guest" && !hasAnotherPack;
  const nextPackRemaining = opening && session
    ? Math.max(0, new Date(session.recharge.nextAt).getTime() - rechargeNow)
    : 0;
  const nextPackMinutes = Math.ceil(nextPackRemaining / (60 * 1000));
  const nextPackLabel = t("rechargeIn", {
    time: t("rechargeTime", { minutes: nextPackMinutes }),
  });
  const revealedSummary = useMemo(
    () =>
      opening?.results
        .filter((_, index) => revealedCards.has(index))
        .map((row) => `${row.card.name}, ${t(`finish.${row.finish}`)}, ${t(getPullStatusKey(row))}`)
        .join(". ") ?? "",
    [opening, revealedCards, t],
  );
  const openingTargetSetId = opening?.selection.type === "raid" ? opening.selection.setId : null;
  const openingTargetSet = openingTargetSetId
    ? sets?.find((set) => set.id === openingTargetSetId) ?? opening?.sets.find((set) => set.id === openingTargetSetId)
    : undefined;
  const openingIsAllRaids = opening?.selection.type === "all";
  const openingPackSet = openingTargetSet ?? currentSet;
  const openingPackName = openingTargetSet?.raidName ?? t("open.allRaids");
  const openingCollectionSets = openingTargetSet ? [openingTargetSet] : openingIsAllRaids ? raidSets : [];
  const openingCollectionSetIds = new Set(openingCollectionSets.map((set) => set.id));
  const openingCollectionCardCount = openingCollectionSets.reduce((total, set) => total + set.cardCount, 0);
  const openingCollectionOwnedCount = openingCollectionSets.reduce((total, set) => total + set.ownedCards, 0);
  const openingCollectionDelta = opening
    ? opening.cacheUpdates
      ? Object.entries(opening.cacheUpdates.ownedCardsBySetDelta)
        .reduce((total, [setId, delta]) => total + (openingCollectionSetIds.has(setId) ? delta : 0), 0)
      : opening.results.reduce((total, result) => (
        total + (result.isNewCard && openingCollectionSetIds.has(result.card.set.id) ? 1 : 0)
      ), 0)
    : 0;
  const openingCollectionPreviousCount = Math.max(0, openingCollectionOwnedCount - openingCollectionDelta);
  const openingCollectionProgressFrom = openingCollectionCardCount > 0
    ? Math.min(1, openingCollectionPreviousCount / openingCollectionCardCount)
    : 0;
  const openingCollectionProgressTo = openingCollectionCardCount > 0
    ? Math.min(1, openingCollectionOwnedCount / openingCollectionCardCount)
    : 0;
  const openingCollectionName = openingPackName;
  const openingCollectionIcon = openingIsAllRaids ? undefined : openingPackSet?.iconUrl ?? undefined;
  const stageTheme = opening ? getPackTheme(openingPackSet, openingIsAllRaids) : getPackTheme(featuredPackSet, allRaids);

  const updatePackLight = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const target = event.currentTarget;
    applyPackPointerMotion(target, event.clientX, event.clientY);

    const drag = packDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) >= 7) drag.dragging = true;
    if (!drag.dragging) return;
    event.preventDefault();
    target.dataset.dragging = "true";
    target.style.setProperty("--pack-drag-x", `${Math.max(-76, Math.min(76, dx)).toFixed(1)}px`);
    target.style.setProperty("--pack-drag-y", `${Math.max(-52, Math.min(52, dy)).toFixed(1)}px`);
  };

  const applySealedCardMotion = (element: HTMLButtonElement, x: number, y: number) => {
    element.style.setProperty("--sealed-tilt-x", `${((0.5 - y) * 2.4).toFixed(2)}deg`);
    element.style.setProperty("--sealed-tilt-y", `${((x - 0.5) * 3.2).toFixed(2)}deg`);
    element.style.setProperty("--sealed-finish-x", `${(50 + (x - 0.5) * 34).toFixed(1)}%`);
    element.style.setProperty("--sealed-finish-y", `${(50 + (y - 0.5) * 24).toFixed(1)}%`);
  };

  const updateSealedCardMotion = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    pendingSealedMotion.current = { element: event.currentTarget, x, y };
    if (sealedMotionFrame.current !== null) return;
    sealedMotionFrame.current = requestAnimationFrame(() => {
      const motion = pendingSealedMotion.current;
      if (motion) applySealedCardMotion(motion.element, motion.x, motion.y);
      pendingSealedMotion.current = null;
      sealedMotionFrame.current = null;
    });
  };

  const resetSealedCardMotion = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (sealedMotionFrame.current !== null) cancelAnimationFrame(sealedMotionFrame.current);
    sealedMotionFrame.current = null;
    pendingSealedMotion.current = null;
    applySealedCardMotion(event.currentTarget, 0.5, 0.5);
  };

  const startMobileCardTilt = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isMobileRevealViewport || packComplete || index !== mobileActiveCardIndex || event.button !== 0) return;
    mobileCardGestureRef.current = {
      pointerId: event.pointerId,
      index,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      suppressClick: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateMobileCardTilt = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = mobileCardGestureRef.current;
    if (!isMobileRevealViewport || gesture.pointerId !== event.pointerId || gesture.index !== index) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) >= 6) gesture.dragging = true;
    if (!gesture.dragging) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    applySealedCardMotion(event.currentTarget, x, y);
  };

  const finishMobileCardTilt = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = mobileCardGestureRef.current;
    if (gesture.pointerId !== event.pointerId || gesture.index !== index) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    gesture.suppressClick = gesture.dragging;
    gesture.pointerId = -1;
    gesture.index = -1;
    gesture.dragging = false;
    applySealedCardMotion(event.currentTarget, 0.5, 0.5);
    if (gesture.suppressClick) {
      window.setTimeout(() => {
        mobileCardGestureRef.current.suppressClick = false;
      }, 0);
    }
  };

  const cancelMobileCardTilt = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = mobileCardGestureRef.current;
    if (gesture.pointerId !== event.pointerId || gesture.index !== index) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    gesture.pointerId = -1;
    gesture.index = -1;
    gesture.dragging = false;
    gesture.suppressClick = false;
    applySealedCardMotion(event.currentTarget, 0.5, 0.5);
  };

  const startPackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canOpen || event.button !== 0 || event.pointerType !== "mouse") return;
    packDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      suppressClick: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishPackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = packDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.suppressClick = drag.dragging;
    drag.pointerId = -1;
    drag.dragging = false;
    resetPackMotion(event.currentTarget);
  };

  const cancelPackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = packDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.pointerId = -1;
    drag.dragging = false;
    drag.suppressClick = false;
    resetPackMotion(event.currentTarget);
  };

  const openPack = () => {
    if (packDragRef.current.suppressClick) {
      packDragRef.current.suppressClick = false;
      return;
    }
    if (!submitPackOpening({ setId: selectedSet?.id })) return;
    resumeCcgAudio();
  };

  const openAnotherPack = () => {
    if (!opening || !hasAnotherPack || mutation.isPending || isPackCycling) return;
    const selection = { setId: opening.selection.type === "raid" ? opening.selection.setId : undefined };
    const delayMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 470;
    if (!submitPackOpening(selection, delayMs)) return;
    setRecoveryId("");
    setActiveReveal(null);
    setIsPackCycling(true);
    resumeCcgAudio();
    playPackSound(FADE_OUT_SOUND, 0.42);

  };

  useEffect(() => {
    if (!opening || hasAnotherPack) return;
    setRechargeNow(Date.now());
    const timer = window.setInterval(() => setRechargeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [opening, hasAnotherPack]);

  if (queryFailed) {
    return (
      <CcgShell>
        <div className="mx-auto max-w-3xl px-4 py-12">
          <CcgLoadError
            onRetry={() => {
              void sessionQuery.refetch();
              void setsQuery.refetch();
            }}
          />
        </div>
      </CcgShell>
    );
  }

  if (bootstrapLoading) {
    return <CcgShell compact><CcgOpenContentSkeleton label={t("loading")} /></CcgShell>;
  }

  return (
    <CcgShell compact immersiveOnMobile={Boolean(opening)} onOpenPacksClick={clearSavedOpening}>
      <div className={`${packStyles.openWorkspace} ${packSelectorOpen ? packStyles.openWorkspacePickerOpen : ""}`}>
        {!opening ? (
          <div className={packStyles.packChooser}>
            <section className={`${packStyles.packStage} ${packStyles.packChooserStage}`} style={getPackTheme(featuredPackSet, allRaids)}>
              <span className={packStyles.stageArt} />
              <span className={packStyles.stageVeil} />
              <span className={packStyles.vaultRing} aria-hidden="true" />
              <span className={packStyles.vaultRingInner} aria-hidden="true" />
              <div className={packStyles.packChooserLayout}>
                <aside className={packStyles.packControls}>
                  <div className={`${packStyles.packSelector} ${packSelectorOpen ? packStyles.packSelectorOpen : ""}`}>
                    <button
                      ref={packSelectorToggleRef}
                      type="button"
                      className={packStyles.mobilePackSelectorSummary}
                      aria-expanded={packSelectorOpen}
                      aria-controls="ccg-pack-selector-options"
                      onClick={() => setPackSelectorOpen((open) => !open)}
                    >
                      <span className={packStyles.modeChoiceIcon}>
                        {allRaids ? (
                          <ArchiveIcon />
                        ) : selectorSet && raidIconByZone.get(selectorSet.zoneId) ? (
                          <IconImage iconFilename={raidIconByZone.get(selectorSet.zoneId)} alt="" width={40} height={40} />
                        ) : (
                          <span className={packStyles.modeChoiceFallback} aria-hidden="true">
                            R
                          </span>
                        )}
                      </span>
                      <span className={packStyles.mobilePackSelectorCopy}>
                        <strong>
                          {selectedSet?.raidName ?? t("open.allRaids")}
                        </strong>
                        <small>{t("open.changeRaidSet")}</small>
                      </span>
                      <span className={packStyles.mobilePackSelectorChevron} aria-hidden="true" />
                    </button>

                    <div
                      ref={packSelectorDialogRef}
                      id="ccg-pack-selector-options"
                      className={packStyles.packSelectorOptions}
                      role={packSelectorOpen ? "dialog" : undefined}
                      aria-modal={packSelectorOpen || undefined}
                      aria-labelledby={packSelectorOpen ? "ccg-pack-selector-title" : undefined}
                    >
                      <header className={packStyles.mobilePackSelectorHeader}>
                        <span className={packStyles.mobilePackSelectorHeading}>
                          <small>{t("open.chooseMode")}</small>
                          <strong id="ccg-pack-selector-title">{t("open.chooseRaidSet")}</strong>
                        </span>
                        <button
                          type="button"
                          className={packStyles.mobilePackSelectorClose}
                          onClick={closePackSelector}
                          aria-label={t("open.closeRaidSetPicker")}
                        >
                          <span aria-hidden="true" />
                        </button>
                      </header>

                      <div className={packStyles.packSelectorBody}>
                        <div className={packStyles.modeChoices}>
                          <button
                            type="button"
                            aria-pressed={selectedSetId === ALL_RAIDS}
                            onClick={() => {
                              setSelectedSetId(ALL_RAIDS);
                              closePackSelector();
                            }}
                            className={packStyles.modeChoice}
                          >
                            <span className={packStyles.modeChoiceIcon}>
                              <ArchiveIcon />
                            </span>
                            <span className={packStyles.modeChoiceCopy}>
                              <small>{t("open.allRaidsEyebrow")}</small>
                              <strong>{t("open.allRaids")}</strong>
                            </span>
                            <span className={packStyles.modeChoiceMark} aria-hidden="true" />
                          </button>
                        </div>

                        <div className={packStyles.packChoiceDivider} aria-hidden="true" />

                        <div className={packStyles.legacyTarget}>
                          <div className={packStyles.raidList} aria-label={t("open.chooseRaidSet")}>
                            {raidSets.map((set) => (
                              <button
                                key={set.id}
                                type="button"
                                aria-pressed={selectedSetId === set.id}
                                className={packStyles.modeChoice}
                                onClick={() => {
                                  setSelectedSetId(set.id);
                                  closePackSelector();
                                }}
                              >
                                <span className={packStyles.modeChoiceIcon}>
                                  {raidIconByZone.get(set.zoneId) ? <IconImage iconFilename={raidIconByZone.get(set.zoneId)} alt="" width={40} height={40} /> : <ArchiveIcon />}
                                </span>
                                <span className={packStyles.modeChoiceCopy}>
                                  <small>{set.expansionName}</small>
                                  <strong>{set.raidName}</strong>
                                </span>
                                <span className={packStyles.modeChoiceMark} aria-hidden="true" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>

                <div className={packStyles.packPresentation}>
                  <span className={packStyles.packMode}>
                    {selectedSet ? selectedSet.expansionName : t("open.allRaidsEyebrow")}
                  </span>
                  <button
                    type="button"
                    className={`${packStyles.packButton} ${mutation.isPending ? packStyles.packButtonOpening : ""}`}
                    disabled={!canOpen}
                    onClick={openPack}
                    onPointerDown={startPackDrag}
                    onPointerMove={updatePackLight}
                    onPointerUp={finishPackDrag}
                    onPointerCancel={cancelPackDrag}
                    onPointerLeave={(event) => {
                      if (packDragRef.current.pointerId === -1) resetPackMotion(event.currentTarget);
                    }}
                    onBlur={(event) => resetPackMotion(event.currentTarget)}
                    aria-label={t("open.openPack")}
                    aria-busy={mutation.isPending}
                  >
                    <PackBoosterVisual title={raidSets.length > 0 ? poolTitle : t("landing.preparing")} cardsLabel={t("landing.cards")} />
                  </button>
                  <span className={packStyles.packHint}>
                    {mutation.isPending ? t("open.openingHint") : isMobileRevealViewport ? t("open.mobilePackHint") : t("open.packHint")}
                  </span>
                </div>

                  <aside className={packStyles.packBalancePanel}>
                    <div className={packStyles.packBalanceSummary}>
                      {session ? <PackBalance session={session} stripOnMobile /> : <div className={packStyles.balancePlaceholder} />}
                    </div>
                    {session ? (
                      <div className={packStyles.qualityDetails}>
                        {selectedPackCardCount > 0 ? (
                          <section className={packStyles.qualityDetail}>
                            <h2>{t("open.collectionProgressEyebrow")}</h2>
                            <div className={packStyles.collectionProgressSummary}>
                              <span>{poolTitle}</span>
                              <strong>{selectedPackOwnedCount} / {selectedPackCardCount}</strong>
                            </div>
                            <div
                              className={packStyles.collectionProgressTrack}
                              role="progressbar"
                              aria-label={`${poolTitle}: ${selectedPackOwnedCount}/${selectedPackCardCount} ${t("landing.collected")}`}
                              aria-valuemin={0}
                              aria-valuemax={selectedPackCardCount}
                              aria-valuenow={selectedPackOwnedCount}
                            >
                              <span style={{ transform: `scaleX(${selectedPackProgress})` }} />
                            </div>
                          </section>
                        ) : null}
                        <section className={packStyles.qualityDetail}>
                          <h2>{t("open.badLuckProtectionEyebrow")}</h2>
                          <dl>
                            {qualityRows.map((row) => (
                              <div key={row.key}>
                                <dt>{t(`finish.${row.finish}`)}</dt>
                                <dd>{row.counter} / {row.hardPity}</dd>
                              </div>
                            ))}
                            {!hasCustomQualityRow ? (
                              <div className={packStyles.qualityRowPlaceholder} aria-hidden="true">
                                <dt>&nbsp;</dt>
                                <dd>&nbsp;</dd>
                              </div>
                            ) : null}
                          </dl>
                        </section>
                        <section className={packStyles.qualityDetail}>
                          <h2>{t("open.baseRatesEyebrow")}</h2>
                          <dl>
                            {qualityRows.map((row) => (
                              <div key={row.key}>
                                <dt>{t(`finish.${row.finish}`)}</dt>
                                <dd>{t("open.baseRate", { odds: oddsFormat.format(row.hardPity) })}</dd>
                              </div>
                            ))}
                            {!hasCustomQualityRow ? (
                              <div className={packStyles.qualityRowPlaceholder} aria-hidden="true">
                                <dt>&nbsp;</dt>
                                <dd>&nbsp;</dd>
                              </div>
                            ) : null}
                          </dl>
                        </section>
                      </div>
                    ) : null}
                    {recoveryQuery.isError ? (
                    <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/[0.05] p-3" role="alert">
                      <p className="text-sm leading-5 text-amber-100">{t("open.recoveryFailed")}</p>
                      <button type="button" className={`${styles.secondaryButton} mt-3 w-full`} onClick={clearSavedOpening}>
                        {t("open.dismissRecovery")}
                      </button>
                    </div>
                  ) : null}
                  {mutation.error ? (
                    <p className="mt-4 text-sm text-red-300" role="alert">
                      {mutation.error.message}
                    </p>
                  ) : null}
                </aside>
              </div>
            </section>
          </div>
        ) : (
          <section
            className={`${packStyles.packStage} ${packStyles.revealStage} ${packComplete ? packStyles.revealStageComplete : ""} ${isMobileAutoRevealing ? packStyles.revealStageAutoRevealing : ""} ${isPackCycling ? packStyles.revealStageCycling : ""}`}
            style={stageTheme}
            aria-busy={isPackCycling || mutation.isPending || isMobileAutoRevealing}
          >
            <span className={packStyles.stageArt} />
            <span className={packStyles.stageVeil} />
            <span className={packStyles.vaultRing} aria-hidden="true" />
            <span className={packStyles.vaultRingInner} aria-hidden="true" />
            <button type="button" className={packStyles.mobileRevealExit} onClick={clearSavedOpening} aria-label={t("open.closeOpening")}>
              <span aria-hidden="true" />
            </button>

            <div
              className={`${packStyles.tearSequence} ${revealPhase === "holding" ? packStyles.tearSequenceHolding : ""} ${revealPhase === "ready" ? packStyles.tearSequenceComplete : ""}`}
              aria-hidden="true"
            >
              {revealPhase === "holding" ? (
                <span className={`${packStyles.packButton} ${packStyles.heldPack}`}>
                  <PackBoosterVisual title={openingPackName ?? t("open.allRaids")} cardsLabel={t("landing.cards")} />
                </span>
              ) : null}
              <span className={`${packStyles.tornHalf} ${packStyles.tornHalfLeft}`}>
                <span />
              </span>
              <span className={`${packStyles.tornHalf} ${packStyles.tornHalfRight}`}>
                <span />
              </span>
              <span className={packStyles.tearParticles}>
                {tearParticles.map((particle, index) => (
                  <i
                    key={index}
                    style={
                      {
                        "--particle-x": `${particle.x}px`,
                        "--particle-y": `${particle.y}px`,
                        "--particle-rotate": `${particle.rotate}deg`,
                        "--particle-delay": `${particle.delay}ms`,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
              <span className={packStyles.tearShardOne} />
              <span className={packStyles.tearShardTwo} />
              <span className={packStyles.tearShardThree} />
            </div>

            <div className={`${packStyles.revealContent} ${packComplete ? packStyles.revealContentSummary : ""} ${revealPhase === "holding" || revealPhase === "tearing" ? packStyles.revealContentWaiting : ""}`}>
              <div className={packStyles.revealLead}>
                <span>{openingPackName}</span>
                <strong>
                  {packComplete
                    ? t("open.allRevealed")
                    : isMobileRevealViewport
                      ? mobileActiveCardRevealed ? t("open.mobileAdvancePrompt") : t("open.mobileRevealPrompt")
                      : t("open.revealPrompt")}
                </strong>
              </div>

              <div ref={cardFanScrollerRef} className={`${packStyles.cardFanScroller} ${packComplete ? packStyles.cardFanScrollerSummary : ""}`}>
                <div className={`${packStyles.cardFan} ${packComplete ? packStyles.cardFanSummary : ""}`}>
                  {opening.results.map((result, index) => {
                    const revealed = revealedCards.has(index);
                    const dealt = index < dealtCards;
                    const special = result.finish !== "standard" || result.card.tierGrade === "S";
                    const mobileStackPosition = Math.max(0, index - Math.max(0, mobileActiveCardIndex));
                    const mobileCardState = packComplete
                      ? "summary"
                      : mobileAdvancedCards.has(index)
                        ? "advanced"
                        : index === mobileActiveCardIndex ? "active" : "queued";
                    const summaryRank = summaryRankByIndex.get(index) ?? index;
                    const sealedCardHint = `${t(`finish.${result.finish}`)} · ${t(`rarity.${CCG_RARITY_KEYS[result.card.tierGrade]}`)}`;
                    const cardBackSetName = result.card.set.raidName;
                    const cardStyle = {
                      ...getPackTheme(result.card.set),
                      "--fan-angle": `${fanAngles[index] ?? 0}deg`,
                      "--fan-y": `${fanOffsets[index] ?? 0}px`,
                      "--deal-x": dealOffsets[index] ?? "0%",
                      "--deal-angle": "0deg",
                      "--deal-delay": `${index * 58}ms`,
                      "--pack-exit-delay": `${index * 24}ms`,
                      "--mobile-stack-position": mobileStackPosition,
                      "--summary-rank": summaryRank,
                    } as CSSProperties;
                    return (
                      <button
                        key={`${opening.id}-${result.card.id}-${index}`}
                        type="button"
                        className={`${packStyles.revealSlot} ${dealt ? packStyles.revealSlotDealt : ""} ${revealPhase === "ready" ? packStyles.revealSlotReady : ""} ${revealed ? packStyles.revealSlotRevealed : ""} ${special ? packStyles.revealSlotSpecial : ""}`}
                        style={cardStyle}
                        data-finish={result.finish}
                        data-grade={result.card.tierGrade}
                        data-mobile-state={mobileCardState}
                        data-summary-rank={summaryRank}
                        ref={(element) => {
                          cardRefs.current[index] = element;
                        }}
                        disabled={!dealt || revealPhase !== "ready" || isPackCycling || isMobileAutoRevealing
                          || (isMobileRevealViewport && !packComplete && index !== mobileActiveCardIndex)}
                        onPointerDown={(event) => startMobileCardTilt(index, event)}
                        onPointerEnter={(event) => {
                          if (event.pointerType === "mouse" && dealt && revealPhase === "ready" && !isPackCycling) {
                            playPackSound(HOVER_SOUND, 0.28);
                          }
                        }}
                        onPointerMove={(event) => {
                          if (isMobileRevealViewport) updateMobileCardTilt(index, event);
                          else if (!revealed) updateSealedCardMotion(event);
                        }}
                        onPointerUp={(event) => finishMobileCardTilt(index, event)}
                        onPointerCancel={(event) => cancelMobileCardTilt(index, event)}
                        onPointerLeave={(event) => {
                          if (!isMobileRevealViewport && !revealed) resetSealedCardMotion(event);
                          setActiveReveal((current) => (current?.index === index ? null : current));
                        }}
                        onClick={(event) => revealCard(index, event)}
                        aria-label={revealed
                          ? isMobileRevealViewport && !packComplete
                            ? t("open.advanceCard", { name: result.card.name })
                            : t("open.viewCard", { name: result.card.name })
                          : `${t("open.revealCard", { position: index + 1 })}. ${sealedCardHint}`}
                      >
                        <span className={packStyles.sealedAura} aria-hidden="true" />
                        <span className={packStyles.cardFlip} data-card-surface>
                          <span className={`${packStyles.cardFace} ${packStyles.cardBack}`} aria-hidden={revealed}>
                            <span className={packStyles.cardBackField} />
                            <span className={packStyles.cardBackFinish} />
                            <span className={packStyles.cardBackSigil} aria-hidden="true">
                              <span />
                            </span>
                            <span className={packStyles.cardBackBrand}>
                              <span>SUOMIWOW</span>
                              <strong>CCG</strong>
                            </span>
                            <span className={packStyles.cardBackSet}>{cardBackSetName}</span>
                          </span>
                          <span className={`${packStyles.cardFace} ${packStyles.cardFront}`} aria-hidden={!revealed}>
                            <CollectibleCard
                              card={result.card}
                              finish={result.finish}
                              artVariant={result.artVariant}
                              compact
                              renderPriority
                              className={packStyles.openedCard}
                              forcedPointer={activeReveal?.index === index ? activeReveal : undefined}
                            />
                          </span>
                        </span>
                        <span className={packStyles.revealFlare} aria-hidden="true" />
                        <span className={packStyles.revealCeremony} aria-hidden="true">
                          <span className={packStyles.revealRays} />
                          <span className={packStyles.revealRings}>
                            <i />
                            <i />
                            <i />
                            <i />
                            <i />
                            <i />
                          </span>
                          <span className={packStyles.revealMotes} />
                        </span>
                        <span className={`${packStyles.pullStatus} ${result.bonusPackReward ? packStyles.pullStatusReward : ""}`} aria-hidden={!revealed}>
                          <strong>{t(getPullStatusKey(result))}</strong>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={packStyles.revealControls}>
                <div className={packStyles.revealActionStack}>
                  <div className={packStyles.revealActionSlot}>
                    {packComplete && shouldPromptGuestLogin ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => login(`${window.location.pathname}${window.location.search}${window.location.hash}`, { ccgOpeningId: opening.id })}
                      >
                        {t("guest.loginForPacks")}
                      </button>
                    ) : packComplete ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={openAnotherPack}
                        disabled={!hasAnotherPack || mutation.isPending || isPackCycling}
                      >
                        {mutation.isPending || isPackCycling ? t("open.opening") : hasAnotherPack ? t("open.openAnother") : nextPackLabel}
                      </button>
                    ) : null}
                  </div>
                  <div className={packStyles.revealStatusSlot}>
                    {!packComplete ? (
                      <span className={packStyles.revealProgressLabel}>
                        {t("open.revealProgress", { revealed: revealedCards.size, total: opening.results.length })}
                      </span>
                    ) : session ? (
                      <>
                        <strong>{session.packs.totalRemaining}</strong>
                        <span>{t("packsRemaining")}</span>
                      </>
                    ) : null}
                  </div>
                  <div className={packStyles.revealActionSlot}>
                    {!allRevealed ? (
                      <button
                        type="button"
                        className={`${styles.secondaryButton} ${packStyles.revealAllButton}`}
                        data-holding={isMobileRevealAllHolding ? "true" : undefined}
                        onPointerDown={startMobileRevealAllHold}
                        onPointerUp={cancelMobileRevealAllHold}
                        onPointerCancel={cancelMobileRevealAllHold}
                        onKeyDown={(event) => {
                          if (isMobileRevealViewport && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            runMobileRevealAll();
                          }
                        }}
                        onClick={(event) => {
                          if (isMobileRevealViewport) {
                            if (!mobileRevealAllPointerActiveRef.current) runMobileRevealAll();
                            return;
                          }
                          revealAll();
                        }}
                        disabled={revealPhase !== "ready" || isMobileAutoRevealing}
                      >
                        {isMobileRevealViewport ? t("open.holdToRevealAll") : t("open.revealAll")}
                      </button>
                    ) : isMobileRevealViewport && !packComplete ? (
                      <button
                        type="button"
                        className={`${styles.secondaryButton} ${packStyles.revealAllPlaceholder}`}
                        aria-hidden="true"
                        tabIndex={-1}
                        disabled
                      >
                        {t("open.holdToRevealAll")}
                      </button>
                    ) : packComplete ? (
                      <button type="button" className={styles.secondaryButton} onClick={clearSavedOpening} disabled={mutation.isPending || isPackCycling}>
                        {t("open.chooseDifferent")}
                      </button>
                    ) : null}
                  </div>
                  <div className={packStyles.revealActionSlot}>
                    {packComplete ? (
                      <CcgShareButton
                        key={opening.id}
                        target={{ kind: "pack", openingId: opening.id }}
                        className={packStyles.packShareButton}
                        loginRequired={!user}
                      />
                    ) : null}
                  </div>
                </div>
                <div className={packStyles.revealCollectionProgressSlot}>
                  {packComplete && openingCollectionCardCount > 0 ? (
                    <div
                      className={packStyles.revealCollectionProgress}
                      style={{
                        "--collection-progress-from": openingCollectionProgressFrom,
                        "--collection-progress-to": openingCollectionProgressTo,
                      } as CSSProperties}
                    >
                      <span className={packStyles.revealCollectionIcon} aria-hidden="true">
                        {openingCollectionIcon ? (
                          <IconImage
                            iconFilename={openingCollectionIcon}
                            alt=""
                            width={36}
                            height={36}
                            className={packStyles.revealCollectionIconImage}
                          />
                        ) : (
                          <ArchiveIcon />
                        )}
                      </span>
                      <span className={packStyles.revealCollectionDetails}>
                        <span className={packStyles.revealCollectionHeading}>
                          <strong>{openingCollectionName}</strong>
                          <small aria-hidden="true">
                            {openingCollectionDelta > 0 ? <em>+{openingCollectionDelta}</em> : null}
                            {openingCollectionOwnedCount >= openingCollectionCardCount
                              ? t("open.setComplete")
                              : <><b>{openingCollectionOwnedCount}</b> / {openingCollectionCardCount}</>}
                          </small>
                        </span>
                        <span
                          className={packStyles.revealCollectionTrack}
                          role="progressbar"
                          aria-label={`${openingCollectionName}: ${openingCollectionOwnedCount}/${openingCollectionCardCount} ${t("landing.collected")}`}
                          aria-valuemin={0}
                          aria-valuemax={openingCollectionCardCount}
                          aria-valuenow={openingCollectionOwnedCount}
                        >
                          <i />
                        </span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              {packComplete && mutation.error ? (
                <p className={packStyles.packActionError} role="alert">
                  {mutation.error.message}
                </p>
              ) : null}
            </div>
            <div
              className={`${packStyles.burstOverlay} ${revealPhase === "holding" ? packStyles.tearSequenceHolding : ""} ${revealPhase === "ready" ? packStyles.tearSequenceComplete : ""}`}
              aria-hidden="true"
            >
              <span className={packStyles.tearFlash} />
              <span className={packStyles.tearBurst} />
              <span className={packStyles.tearShockwaves}>
                <i />
                <i />
                <i />
              </span>
            </div>
            <p className="sr-only" aria-live="polite">
              {revealPhase === "ready" && revealedCards.size === 0 ? t("open.cardsReady") : revealedSummary}
            </p>
          </section>
        )}
      </div>
      {opening && viewerIndex !== null ? (
        <CardViewer
          card={{
            ...opening.results[viewerIndex].card,
            ownership: [{
              finish: opening.results[viewerIndex].finish,
              artVariant: opening.results[viewerIndex].artVariant,
              quantity: 1,
            }],
          }}
          initialFinish={opening.results[viewerIndex].finish}
          initialArtVariant={opening.results[viewerIndex].artVariant}
          originElement={viewerOriginElement}
          originBounds={viewerOriginBounds}
          sharedTransition={viewerSharedTransition}
          showFinishControls={false}
          onClose={() => {
            setViewerIndex(null);
            setViewerOriginElement(null);
            setViewerOriginBounds(null);
            setViewerSharedTransition(false);
          }}
        />
      ) : null}
    </CcgShell>
  );
}
