"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CcgBaseFinish, CcgBootstrapResponse, CcgFinish, CcgMode, CcgOpening } from "@/types";
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
import CcgShareButton from "@/components/ccg/CcgShareButton";
import PackBoosterVisual, { getPackTheme } from "@/components/ccg/PackBoosterVisual";
import styles from "@/components/ccg/ccg.module.css";
import packStyles from "@/components/ccg/pack-opening.module.css";

type RevealPhase = "idle" | "holding" | "tearing" | "dealing" | "ready";
type PackSelection = { mode: CcgMode; setId?: string };
type PackRequest = PackSelection & { idempotencyKey: string };

const fanAngles = [-5.5, -2.5, 0, 2.5, 5.5];
const fanOffsets = [15, 5, 0, 5, 15];
const dealOffsets = ["215%", "108%", "0%", "-108%", "-215%"];
const dealAngles = [8, 4, 0, -4, -8];
const RANDOM_LEGACY_SET = "random";
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
  playCcgSound(source, channel, volume, {
    playbackRate,
    interruptKey: channel === "effects" ? undefined : "voice",
  });
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
  const [mode, setMode] = useState<CcgMode>("current");
  const [opening, setOpening] = useState<CcgOpening | null>(null);
  const [recoveryId, setRecoveryId] = useState("");
  const [recoveryInitialized, setRecoveryInitialized] = useState(false);
  const [revealPhase, setRevealPhase] = useState<RevealPhase>("idle");
  const [dealtCards, setDealtCards] = useState(0);
  const [revealedCards, setRevealedCards] = useState<Set<number>>(() => new Set());
  const [activeReveal, setActiveReveal] = useState<{ index: number; x: number; y: number } | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerOriginElement, setViewerOriginElement] = useState<HTMLElement | null>(null);
  const [viewerOriginBounds, setViewerOriginBounds] = useState<CardViewerOriginBounds | null>(null);
  const [viewerSharedTransition, setViewerSharedTransition] = useState(false);
  const [legacySetId, setLegacySetId] = useState(RANDOM_LEGACY_SET);
  const [isPackCycling, setIsPackCycling] = useState(false);
  const [rechargeNow, setRechargeNow] = useState(() => Date.now());
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const qualitySoundTimersRef = useRef<number[]>([]);
  const quipSoundTimersRef = useRef<number[]>([]);
  const announcerSoundTimersRef = useRef<number[]>([]);
  const packDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, dragging: false, suppressClick: false });
  const sealedMotionFrame = useRef<number | null>(null);
  const pendingSealedMotion = useRef<{ element: HTMLButtonElement; x: number; y: number } | null>(null);
  const nextPackTimerRef = useRef<number | null>(null);
  const packRequestPendingRef = useRef(false);
  const recoveryQuery = useCcgOpening(recoveryId, !authLoading && sessionQuery.isSuccess);
  const session = sessionQuery.data;
  const sets = setsQuery.data?.sets;
  const modeSets = useMemo(() => (sets ?? []).filter((set) => set.kind === "raid" && set.state === mode && set.cardCount > 0), [mode, sets]);
  const currentSets = useMemo(() => (sets ?? []).filter((set) => set.kind === "raid" && set.state === "current" && set.cardCount > 0), [sets]);
  const legacySets = useMemo(
    () => (sets ?? [])
      .filter((set) => set.kind === "raid" && set.state === "legacy" && set.cardCount > 0)
      .sort((left, right) => right.zoneId - left.zoneId),
    [sets],
  );
  const currentSet = currentSets[0];
  const selectedLegacySet = legacySets.find((set) => set.id === legacySetId);
  const randomLegacy = mode === "legacy" && !selectedLegacySet;
  const featuredPackSet = mode === "legacy" ? selectedLegacySet : modeSets[0];
  const selectedPackSets = mode === "legacy" && selectedLegacySet ? [selectedLegacySet] : modeSets;
  const hasCustomQualityRow = selectedPackSets.some((set) => Boolean(set.customFinish));
  const qualityRows = useMemo(() => [
    ...protectedFinishes.map((finish) => ({
      key: finish,
      finish,
      counter: session?.qualityProtection[finish] ?? 0,
      hardPity: CCG_FINISH_PITY_LIMITS[finish],
      nextChance: session?.qualityChances[finish] ?? (1 / CCG_FINISH_PITY_LIMITS[finish]),
    })),
    ...selectedPackSets.flatMap((set) => {
      if (!set.customFinish) return [];
      const progress = session?.customQualityProtection?.find((row) => row.setSlug === set.slug);
      return [{
        key: `${set.slug}:${set.customFinish.key}`,
        finish: set.customFinish.key,
        counter: progress?.counter ?? 0,
        hardPity: set.customFinish.hardPity,
        nextChance: progress?.nextChance ?? (1 / set.customFinish.hardPity),
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
  const poolTitle =
    mode === "legacy"
      ? (selectedLegacySet?.raidName ?? t("open.legacyPackTitle"))
      : modeSets.length === 1
        ? modeSets[0].raidName
        : t("open.currentPool", { count: modeSets.length });

  useEffect(() => {
    preloadCcgSounds([HOVER_SOUND, FADE_OUT_SOUND, SHUFFLE_SOUND, DRAW_SOUND, ...CCG_CARD_SLIDE_SOUNDS]);
  }, []);

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
    if (legacySetId !== RANDOM_LEGACY_SET && !legacySets.some((set) => set.id === legacySetId)) {
      setLegacySetId(RANDOM_LEGACY_SET);
    }
  }, [legacySetId, legacySets]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "legacy") setMode("legacy");
    const requestedOpening = params.get("opening");
    if (requestedOpening && /^[a-f\d]{24}$/i.test(requestedOpening)) setRecoveryId(requestedOpening);
    else if (requestedOpening) {
      params.delete("opening");
      const search = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    }
    setRecoveryInitialized(true);
  }, []);

  useEffect(
    () => () => {
      if (sealedMotionFrame.current !== null) cancelAnimationFrame(sealedMotionFrame.current);
      if (nextPackTimerRef.current !== null) window.clearTimeout(nextPackTimerRef.current);
      qualitySoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      quipSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      announcerSoundTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    const recovered = recoveryQuery.data;
    if (!recovered || opening?.id === recovered.id) return;
    setMode(recovered.mode);
    setOpening(recovered);
  }, [opening?.id, recoveryQuery.data]);

  useEffect(() => {
    if (!opening) return;
    const total = opening.results.length;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    if (reduced) {
      playPackSound(SHUFFLE_SOUND, 0.42);
      setRevealPhase("ready");
      setDealtCards(total);
      setRevealedCards(new Set(opening.results.map((_, index) => index)));
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
        mode: request.mode,
        idempotencyKey: request.idempotencyKey,
        setId: request.setId,
      });
      queryClient.setQueryData(queryKeys.ccg.opening(result.id), result);
      const url = new URL(window.location.href);
      url.searchParams.set("mode", result.mode);
      url.searchParams.set("opening", result.id);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      return result;
    },
    onSuccess: (result) => {
      setIsPackCycling(false);
      setRevealPhase("holding");
      setDealtCards(0);
      setRevealedCards(new Set());
      setActiveReveal(null);
      setMode(result.mode);
      if (result.mode === "legacy") setLegacySetId(result.targetSetId ?? RANDOM_LEGACY_SET);
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
              qualityChances: updates.qualityChances,
              customQualityProtection: bootstrap.session.customQualityProtection.map((row) => {
                const update = customUpdates.get(row.setSlug);
                return update ? { ...row, counter: update.counter, nextChance: update.nextChance } : row;
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
  const noPacks = session ? session.packs[mode].totalRemaining <= 0 : false;
  const clearSavedOpening = () => {
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
    setActiveReveal(null);
    setViewerIndex(null);
    setViewerOriginElement(null);
    setViewerOriginBounds(null);
    setRecoveryId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("opening");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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
    if (revealedCards.has(index)) {
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
        return ["S", "A", "B", "C", "D", "E", "F"].indexOf(left.result.card.tierGrade)
          - ["S", "A", "B", "C", "D", "E", "F"].indexOf(right.result.card.tierGrade);
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
  };

  const canOpen = recoveryInitialized && !recoveryId && Boolean(session) && !queryFailed && modeSets.length > 0 && !noPacks && !mutation.isPending;
  const allRevealed = Boolean(opening) && revealedCards.size >= (opening?.results.length ?? 0);
  const hasAnotherPack = Boolean(opening && session && session.packs[opening.mode].totalRemaining > 0);
  const shouldPromptGuestLogin = session?.ownerType === "guest" && !hasAnotherPack;
  const nextPackRemaining = opening && session
    ? Math.max(0, new Date(session.recharge[opening.mode].nextAt).getTime() - rechargeNow)
    : 0;
  const nextPackHours = Math.floor(nextPackRemaining / (60 * 60 * 1000));
  const nextPackMinutes = Math.max(0, Math.ceil((nextPackRemaining % (60 * 60 * 1000)) / (60 * 1000)));
  const nextPackLabel = t("rechargeIn", {
    time: t("rechargeTime", { hours: nextPackHours, minutes: nextPackMinutes }),
  });
  const revealedSummary = useMemo(
    () =>
      opening?.results
        .filter((_, index) => revealedCards.has(index))
        .map((row) => `${row.card.name}, ${t(`finish.${row.finish}`)}, ${row.isDuplicate ? t("open.duplicate") : t("open.newCard")}`)
        .join(". ") ?? "",
    [opening, revealedCards, t],
  );
  const openingSet = opening?.results[0]?.card.set ?? opening?.sets[0] ?? featuredPackSet;
  const openingTargetSet = opening?.targetSetId ? (opening.sets.find((set) => set.id === opening.targetSetId) ?? openingSet) : undefined;
  const openingIsRandomLegacy = opening?.mode === "legacy" && !opening.targetSetId;
  const openingPackName = opening?.mode === "legacy" ? (openingTargetSet?.raidName ?? t("open.legacyPackTitle")) : openingSet?.raidName;
  const cardBackSetScale = Math.min(1.45, Math.max(0.78, 18 / (openingPackName?.trim().length || 18)));
  const stageTheme = opening ? getPackTheme(opening.mode === "legacy" ? openingTargetSet : openingSet, openingIsRandomLegacy) : getPackTheme(featuredPackSet, randomLegacy);

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
    if (!submitPackOpening({ mode, setId: mode === "legacy" ? selectedLegacySet?.id : undefined })) return;
    resumeCcgAudio();
  };

  const openAnotherPack = () => {
    if (!opening || !hasAnotherPack || mutation.isPending || isPackCycling) return;
    const selection = { mode: opening.mode, setId: opening.targetSetId ?? undefined };
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

  return (
    <CcgShell compact onOpenPacksClick={clearSavedOpening}>
      <div className={packStyles.openWorkspace}>
        {!opening ? (
          <div className={packStyles.packChooser}>
            <section className={`${packStyles.packStage} ${packStyles.packChooserStage}`} style={getPackTheme(featuredPackSet, randomLegacy)}>
              <span className={packStyles.stageArt} />
              <span className={packStyles.stageVeil} />
              <span className={packStyles.vaultRing} aria-hidden="true" />
              <span className={packStyles.vaultRingInner} aria-hidden="true" />
              <div className={packStyles.packChooserLayout}>
                <aside className={packStyles.packControls}>
                  <div className={packStyles.modeChoices}>
                    <button type="button" aria-pressed={mode === "current"} onClick={() => setMode("current")} className={packStyles.modeChoice}>
                      <span className={packStyles.modeChoiceIcon}>
                        {currentSet && raidIconByZone.get(currentSet.zoneId) ? (
                          <IconImage iconFilename={raidIconByZone.get(currentSet.zoneId)} alt="" width={40} height={40} />
                        ) : (
                          <span className={packStyles.modeChoiceFallback} aria-hidden="true">
                            C
                          </span>
                        )}
                      </span>
                      <span className={packStyles.modeChoiceCopy}>
                        <small>{t("open.currentTier")}</small>
                        <strong>{currentSet?.raidName ?? t("landing.preparing")}</strong>
                      </span>
                      <span className={packStyles.modeChoiceMark} aria-hidden="true" />
                    </button>
                  </div>

                  <div className={packStyles.packChoiceDivider} aria-hidden="true" />

                  <div className={packStyles.legacyTarget}>
                    <div className={packStyles.raidList} aria-label={t("open.chooseLegacy")}>
                      <button
                        type="button"
                        aria-pressed={mode === "legacy" && legacySetId === RANDOM_LEGACY_SET}
                        className={packStyles.modeChoice}
                        onClick={() => {
                          setMode("legacy");
                          setLegacySetId(RANDOM_LEGACY_SET);
                        }}
                      >
                        <span className={packStyles.modeChoiceIcon}>
                          <ArchiveIcon />
                        </span>
                        <span className={packStyles.modeChoiceCopy}>
                          <small>{t("open.randomLegacyEyebrow")}</small>
                          <strong>{t("open.randomLegacy")}</strong>
                        </span>
                        <span className={packStyles.modeChoiceMark} aria-hidden="true" />
                      </button>
                      {legacySets.map((set) => (
                        <button
                          key={set.id}
                          type="button"
                          aria-pressed={mode === "legacy" && legacySetId === set.id}
                          className={packStyles.modeChoice}
                          onClick={() => {
                            setMode("legacy");
                            setLegacySetId(set.id);
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
                </aside>

                <div className={packStyles.packPresentation}>
                  <span className={packStyles.packMode}>
                    {mode === "legacy"
                      ? selectedLegacySet
                        ? `${t("mode.legacy")} · ${selectedLegacySet.expansionName}`
                        : t("open.legacyPackLabel")
                      : `${t("open.currentTier")} · ${featuredPackSet?.expansionName ?? "SuomiWoW"}`}
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
                    <PackBoosterVisual title={modeSets.length > 0 ? poolTitle : t("landing.preparing")} cardsLabel={t("landing.cards")} />
                  </button>
                  <span className={packStyles.packHint}>{mutation.isPending ? t("open.openingHint") : t("open.packHint")}</span>
                </div>

                  <aside className={packStyles.packBalancePanel}>
                    {session ? <PackBalance session={session} mode={mode} /> : <div className={packStyles.balancePlaceholder} />}
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
                          <h2>{t("open.qualityProgressEyebrow")}</h2>
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
                          <h2>{t("open.qualityChancesEyebrow")}</h2>
                          <dl>
                            {qualityRows.map((row) => (
                              <div key={row.key}>
                                <dt>{t(`finish.${row.finish}`)}</dt>
                                <dd>{t("open.qualityChance", { odds: oddsFormat.format(1 / row.nextChance) })}</dd>
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
            className={`${packStyles.packStage} ${packStyles.revealStage} ${isPackCycling ? packStyles.revealStageCycling : ""}`}
            style={stageTheme}
            aria-busy={isPackCycling || mutation.isPending}
          >
            <span className={packStyles.stageArt} />
            <span className={packStyles.stageVeil} />
            <span className={packStyles.vaultRing} aria-hidden="true" />
            <span className={packStyles.vaultRingInner} aria-hidden="true" />

            <div
              className={`${packStyles.tearSequence} ${revealPhase === "holding" ? packStyles.tearSequenceHolding : ""} ${revealPhase === "ready" ? packStyles.tearSequenceComplete : ""}`}
              aria-hidden="true"
            >
              {revealPhase === "holding" ? (
                <span className={`${packStyles.packButton} ${packStyles.heldPack}`}>
                  <PackBoosterVisual title={openingPackName ?? t("open.legacyPackTitle")} cardsLabel={t("landing.cards")} />
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

            <div className={`${packStyles.revealContent} ${revealPhase === "holding" || revealPhase === "tearing" ? packStyles.revealContentWaiting : ""}`}>
              <div className={packStyles.revealLead}>
                <span>{openingPackName}</span>
                <strong>{allRevealed ? t("open.allRevealed") : t("open.revealPrompt")}</strong>
              </div>

              <div className={packStyles.cardFanScroller}>
                <div className={packStyles.cardFan}>
                  {opening.results.map((result, index) => {
                    const revealed = revealedCards.has(index);
                    const dealt = index < dealtCards;
                    const special = result.finish !== "standard" || result.card.tierGrade === "S";
                    const sealedCardHint = `${t(`finish.${result.finish}`)} · ${t(`rarity.${CCG_RARITY_KEYS[result.card.tierGrade]}`)}`;
                    const cardStyle = {
                      "--fan-angle": `${fanAngles[index] ?? 0}deg`,
                      "--fan-y": `${fanOffsets[index] ?? 0}px`,
                      "--deal-x": dealOffsets[index] ?? "0%",
                      "--deal-angle": `${dealAngles[index] ?? 0}deg`,
                      "--deal-delay": `${index * 58}ms`,
                      "--pack-exit-delay": `${index * 24}ms`,
                    } as CSSProperties;
                    return (
                      <button
                        key={`${result.card.id}-${index}`}
                        type="button"
                        className={`${packStyles.revealSlot} ${dealt ? packStyles.revealSlotDealt : ""} ${revealPhase === "ready" ? packStyles.revealSlotReady : ""} ${revealed ? packStyles.revealSlotRevealed : ""} ${special ? packStyles.revealSlotSpecial : ""}`}
                        style={cardStyle}
                        data-finish={result.finish}
                        data-grade={result.card.tierGrade}
                        ref={(element) => {
                          cardRefs.current[index] = element;
                        }}
                        disabled={!dealt || revealPhase !== "ready" || isPackCycling}
                        onPointerEnter={(event) => {
                          if (event.pointerType === "mouse" && dealt && revealPhase === "ready" && !isPackCycling) {
                            playPackSound(HOVER_SOUND, 0.28);
                          }
                        }}
                        onPointerMove={revealed ? undefined : updateSealedCardMotion}
                        onPointerLeave={(event) => {
                          if (!revealed) resetSealedCardMotion(event);
                          setActiveReveal((current) => (current?.index === index ? null : current));
                        }}
                        onClick={(event) => revealCard(index, event)}
                        aria-label={revealed ? t("open.viewCard", { name: result.card.name }) : `${t("open.revealCard", { position: index + 1 })}. ${sealedCardHint}`}
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
                            <span className={packStyles.cardBackSet} style={{ "--card-back-set-scale": cardBackSetScale } as CSSProperties}>
                              {openingPackName}
                            </span>
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
                        <span className={packStyles.pullStatus} aria-hidden={!revealed}>
                          <strong>{t(result.isDuplicate ? "open.duplicate" : "open.newCard")}</strong>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={packStyles.revealControls}>
                <div className={packStyles.revealActionStack}>
                  <div className={packStyles.revealActionSlot}>
                    {allRevealed && shouldPromptGuestLogin ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => login(`${window.location.pathname}${window.location.search}${window.location.hash}`, { ccgOpeningId: opening.id })}
                      >
                        {t("guest.loginForPacks")}
                      </button>
                    ) : allRevealed ? (
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
                    {!allRevealed ? (
                      <span className={packStyles.revealProgressLabel}>
                        {t("open.revealProgress", { revealed: revealedCards.size, total: opening.results.length })}
                      </span>
                    ) : session ? (
                      <>
                        <strong>{session.packs[opening.mode].totalRemaining}</strong>
                        <span>{t("packsRemaining")}</span>
                      </>
                    ) : null}
                  </div>
                  <div className={packStyles.revealActionSlot}>
                    {!allRevealed ? (
                      <button type="button" className={styles.secondaryButton} onClick={revealAll} disabled={revealPhase !== "ready"}>
                        {t("open.revealAll")}
                      </button>
                    ) : (
                      <button type="button" className={styles.secondaryButton} onClick={clearSavedOpening} disabled={mutation.isPending || isPackCycling}>
                        {t("open.chooseDifferent")}
                      </button>
                    )}
                  </div>
                  <div className={packStyles.revealActionSlot}>
                    {allRevealed ? (
                      <CcgShareButton
                        key={opening.id}
                        target={{ kind: "pack", openingId: opening.id }}
                        className={packStyles.packShareButton}
                        loginRequired={!user}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
              {allRevealed && mutation.error ? (
                <p className={packStyles.packActionError} role="alert">
                  {mutation.error.message}
                </p>
              ) : null}
              {allRevealed && opening.duplicateRewards > 0 ? <p className={packStyles.bonusEarned}>{t("open.bonusEarned", { count: opening.duplicateRewards })}</p> : null}
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
