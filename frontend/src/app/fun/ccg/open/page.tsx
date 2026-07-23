"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CcgMode, CcgOpening, CcgSet } from "@/types";
import { api } from "@/lib/api";
import { CCG_RARITY_KEYS } from "@/lib/ccg";
import { getCharacterRenderProxyUrl } from "@/lib/character-render";
import { queryKeys, useCcgOpening, useCcgSession, useCcgSets, useRaids } from "@/lib/queries";
import IconImage from "@/components/IconImage";
import CcgShell from "@/components/ccg/CcgShell";
import GuestNotice from "@/components/ccg/GuestNotice";
import PackBalance from "@/components/ccg/PackBalance";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import CardViewer, { openCardViewer } from "@/components/ccg/CardViewer";
import type { CardViewerOriginBounds } from "@/components/ccg/CardViewer";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import styles from "@/components/ccg/ccg.module.css";
import packStyles from "@/components/ccg/pack-opening.module.css";

type RevealPhase = "idle" | "holding" | "tearing" | "dealing" | "ready";
type PackSelection = { mode: CcgMode; setId?: string };

const fanAngles = [-5.5, -2.5, 0, 2.5, 5.5];
const fanOffsets = [15, 5, 0, 5, 15];
const dealOffsets = ["215%", "108%", "0%", "-108%", "-215%"];
const dealAngles = [8, 4, 0, -4, -8];
const RANDOM_LEGACY_SET = "random";
const cardSlideSounds = Array.from({ length: 8 }, (_, index) => `/ccg/audio/card-slide-${index + 1}.ogg`);
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

function packTheme(set: CcgSet | undefined, randomLegacy = false): CSSProperties {
  return {
    "--pack-accent": randomLegacy ? "#9c7cff" : set?.theme.accent ?? "#5baeff",
    "--pack-glow": randomLegacy ? "rgba(126, 105, 255, 0.42)" : set?.theme.glow ?? "rgba(91, 174, 255, 0.38)",
    "--pack-stage-art": randomLegacy ? 'url("/ccg/general_wide.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art": randomLegacy ? 'url("/ccg/general_tall.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art-size": randomLegacy ? "cover" : "auto 100%",
    "--pack-logo-fill": randomLegacy
      ? "linear-gradient(145deg, #e6fbff 0%, #7ed8ef 58%, #d2aa61 100%)"
      : "color-mix(in srgb, var(--pack-accent) 82%, white 18%)",
    "--pack-logo-glow": randomLegacy ? "rgba(92, 207, 238, 0.46)" : "var(--pack-glow)",
  } as CSSProperties;
}

function ArchiveIcon() {
  return (
    <span className={packStyles.archiveIcon} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function PackBoosterVisual({ title, cardsLabel }: { title: string; cardsLabel: string }) {
  return (
    <>
      <span className={packStyles.packShadow} />
      <span className={packStyles.booster}>
        <span className={packStyles.wrapperArt} />
        <span className={packStyles.wrapperShade} />
        <span className={packStyles.wrapperFoil} />
        <span className={`${packStyles.crimp} ${packStyles.crimpTop}`} />
        <span className={`${packStyles.crimp} ${packStyles.crimpBottom}`} />
        <span className={packStyles.packBrand}>SuomiWoW <strong>CCG</strong></span>
        <span className={packStyles.packTitle}>{title}</span>
        <span className={packStyles.packSigil} aria-hidden="true"><span /></span>
        <span className={packStyles.packCount}><strong>5</strong><span>{cardsLabel}</span></span>
      </span>
    </>
  );
}

function playPackSound(audio: HTMLAudioElement | null, volume: number, playbackRate = 1): void {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.volume = volume;
  audio.playbackRate = playbackRate;
  void audio.play().catch(() => undefined);
}

function playRandomPackSound(audios: Array<HTMLAudioElement | null>, volume: number): void {
  const available = audios.filter((audio): audio is HTMLAudioElement => audio !== null);
  playPackSound(available[randomIndex(available.length)] ?? null, volume);
}

export default function CcgOpenPage() {
  const t = useTranslations("ccg");
  const queryClient = useQueryClient();
  const sessionQuery = useCcgSession();
  const setsQuery = useCcgSets();
  const raidsQuery = useRaids();
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
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shuffleAudioRef = useRef<HTMLAudioElement | null>(null);
  const cardSlideAudioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const drawAudioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const packDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, dragging: false, suppressClick: false });
  const sealedMotionFrame = useRef<number | null>(null);
  const pendingSealedMotion = useRef<{ element: HTMLButtonElement; x: number; y: number } | null>(null);
  const nextPackTimerRef = useRef<number | null>(null);
  const recoveryQuery = useCcgOpening(recoveryId);
  const session = sessionQuery.data;
  const sets = setsQuery.data?.sets;
  const modeSets = useMemo(() => (sets ?? []).filter((set) => set.state === mode && set.cardCount > 0), [mode, sets]);
  const currentSets = useMemo(() => (sets ?? []).filter((set) => set.state === "current" && set.cardCount > 0), [sets]);
  const legacySets = useMemo(() => (sets ?? []).filter((set) => set.state === "legacy" && set.cardCount > 0), [sets]);
  const currentSet = currentSets[0];
  const selectedLegacySet = legacySets.find((set) => set.id === legacySetId);
  const randomLegacy = mode === "legacy" && !selectedLegacySet;
  const featuredPackSet = mode === "legacy" ? selectedLegacySet : modeSets[0];
  const raidIconByZone = useMemo(
    () => new Map((raidsQuery.data ?? []).map((raid) => [raid.id, raid.iconUrl])),
    [raidsQuery.data],
  );
  const poolTitle =
    mode === "legacy"
      ? selectedLegacySet?.raidName ?? t("open.legacyPackTitle")
      : modeSets.length === 1
        ? modeSets[0].raidName
        : t("open.currentPool", { count: modeSets.length });

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
    setViewerIndex(null);
    setViewerOriginElement(null);
    setViewerOriginBounds(null);
    setActiveReveal(null);
    if (reduced) {
      playPackSound(shuffleAudioRef.current, 0.42);
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
      playPackSound(shuffleAudioRef.current, 0.42);
      setRevealPhase("tearing");
      tearTimer = window.setTimeout(() => {
        setRevealPhase("dealing");
        setDealtCards(total);
        drawAudioRefs.current.slice(0, total).forEach((audio, index) => {
          drawSoundTimers.push(window.setTimeout(
            () => playPackSound(audio, 0.32, [0.96, 1.02, 0.99, 1.04, 0.97][index] ?? 1),
            index * 58,
          ));
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
    mutationFn: async (selection: PackSelection) => {
      const result = await api.openCcgPack({
        mode: selection.mode,
        idempotencyKey: makeIdempotencyKey(),
        setId: selection.setId,
      });
      queryClient.setQueryData(queryKeys.ccg.opening(result.id), result);
      const url = new URL(window.location.href);
      url.searchParams.set("mode", result.mode);
      url.searchParams.set("opening", result.id);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      result.results.forEach((row) => {
        if (!row.card.renderUrl) return;
        const image = new window.Image();
        image.src = getCharacterRenderProxyUrl(row.card.renderUrl);
      });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.ccg.session });
      queryClient.invalidateQueries({ queryKey: ["ccg", "catalog"] });
      queryClient.invalidateQueries({ queryKey: ["ccg", "collection"] });
      queryClient.invalidateQueries({ queryKey: ["ccg", "guilds"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.ccg.sets });
    },
    onError: () => setIsPackCycling(false),
  });

  const queryFailed = sessionQuery.isError || setsQuery.isError;
  const noPacks = session ? session.packs[mode].totalRemaining <= 0 : false;
  const clearSavedOpening = () => {
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

  const revealCard = (index: number, event?: ReactMouseEvent<HTMLButtonElement>) => {
    if (revealPhase !== "ready" || index >= dealtCards) return;
    if (revealedCards.has(index)) {
      const originElement = event?.currentTarget ?? cardRefs.current[index];
      openCardViewer(originElement, (sharedTransition, originBounds) => {
        setViewerOriginElement(originElement);
        setViewerOriginBounds(originBounds);
        setViewerSharedTransition(sharedTransition);
        setViewerIndex(index);
      });
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
    playRandomPackSound(cardSlideAudioRefs.current, 0.36);
    setRevealedCards((current) => new Set(current).add(index));
  };

  const revealAll = () => {
    if (!opening || revealPhase !== "ready") return;
    setActiveReveal(null);
    playRandomPackSound(cardSlideAudioRefs.current, 0.32);
    setRevealedCards(new Set(opening.results.map((_, index) => index)));
  };

  const canOpen = recoveryInitialized && !recoveryId && Boolean(session) && !queryFailed && modeSets.length > 0 && !noPacks && !mutation.isPending;
  const allRevealed = Boolean(opening) && revealedCards.size >= (opening?.results.length ?? 0);
  const hasAnotherPack = Boolean(opening && session && session.packs[opening.mode].totalRemaining > 0);
  const revealedSummary = useMemo(
    () => opening?.results
      .filter((_, index) => revealedCards.has(index))
      .map((row) => `${row.card.name}, ${t(`finish.${row.finish}`)}, ${row.isDuplicate ? t("open.duplicate") : t("open.newCard")}`)
      .join(". ") ?? "",
    [opening, revealedCards, t],
  );
  const openingSet = opening?.results[0]?.card.set ?? opening?.sets[0] ?? featuredPackSet;
  const openingTargetSet = opening?.targetSetId ? opening.sets.find((set) => set.id === opening.targetSetId) ?? openingSet : undefined;
  const openingIsRandomLegacy = opening?.mode === "legacy" && !opening.targetSetId;
  const openingPackName = opening?.mode === "legacy"
    ? openingTargetSet?.raidName ?? t("open.legacyPackTitle")
    : openingSet?.raidName;
  const cardBackSetScale = Math.min(1.45, Math.max(0.78, 18 / (openingPackName?.trim().length || 18)));
  const stageTheme = opening
    ? packTheme(opening.mode === "legacy" ? openingTargetSet : openingSet, openingIsRandomLegacy)
    : packTheme(featuredPackSet, randomLegacy);

  const resetPackMotion = (target: HTMLButtonElement) => {
    delete target.dataset.dragging;
    target.style.setProperty("--pack-drag-x", "0px");
    target.style.setProperty("--pack-drag-y", "0px");
    target.style.setProperty("--pack-tilt-x", "0deg");
    target.style.setProperty("--pack-tilt-y", "0deg");
    target.style.setProperty("--pack-shine-x", "50%");
    target.style.setProperty("--pack-shine-y", "38%");
  };

  const updatePackLight = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    target.style.setProperty("--pack-tilt-x", `${((0.5 - y) * 16).toFixed(2)}deg`);
    target.style.setProperty("--pack-tilt-y", `${((x - 0.5) * 18).toFixed(2)}deg`);
    target.style.setProperty("--pack-shine-x", `${(x * 100).toFixed(1)}%`);
    target.style.setProperty("--pack-shine-y", `${(y * 100).toFixed(1)}%`);

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
    mutation.mutate({ mode, setId: mode === "legacy" ? selectedLegacySet?.id : undefined });
  };

  const openAnotherPack = () => {
    if (!opening || mutation.isPending || isPackCycling) return;
    const selection = { mode: opening.mode, setId: opening.targetSetId ?? undefined };
    setRecoveryId("");
    setActiveReveal(null);
    setIsPackCycling(true);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      mutation.mutate(selection);
      return;
    }

    nextPackTimerRef.current = window.setTimeout(() => {
      nextPackTimerRef.current = null;
      mutation.mutate(selection);
    }, 470);
  };

  if (queryFailed) {
    return <CcgShell><div className="mx-auto max-w-3xl px-4 py-12"><CcgLoadError onRetry={() => { void sessionQuery.refetch(); void setsQuery.refetch(); }} /></div></CcgShell>;
  }

  return (
    <CcgShell
      compact
      context={session ? <GuestNotice session={session} /> : null}
    >
      <div className={packStyles.openWorkspace}>
        {!opening ? (
          <div className={packStyles.packChooser}>
            <section className={`${packStyles.packStage} ${packStyles.packChooserStage}`} style={packTheme(featuredPackSet, randomLegacy)}>
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
                        ) : <span className={packStyles.modeChoiceFallback} aria-hidden="true">C</span>}
                      </span>
                      <span className={packStyles.modeChoiceCopy}>
                        <small>{t("open.currentTier")}</small>
                        <strong>{currentSet?.raidName ?? t("landing.preparing")}</strong>
                      </span>
                      <span className={packStyles.modeChoiceMark} aria-hidden="true" />
                    </button>
                    <button type="button" aria-pressed={mode === "legacy"} onClick={() => setMode("legacy")} className={packStyles.modeChoice}>
                      <span className={packStyles.modeChoiceIcon}><ArchiveIcon /></span>
                      <span className={packStyles.modeChoiceCopy}>
                        <small>{t("mode.legacy")}</small>
                        <strong>{t("open.legacyRaids", { count: legacySets.length })}</strong>
                      </span>
                      <span className={packStyles.modeChoiceMark} aria-hidden="true" />
                    </button>
                  </div>

                  <div className={packStyles.legacyTarget} data-disabled={mode === "current"}>
                    <div className={packStyles.raidList} role="listbox" aria-label={t("open.chooseLegacy")} aria-disabled={mode === "current"}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={legacySetId === RANDOM_LEGACY_SET}
                        disabled={mode === "current"}
                        className={packStyles.raidOption}
                        onClick={() => setLegacySetId(RANDOM_LEGACY_SET)}
                      >
                        <span className={packStyles.raidOptionIcon}><ArchiveIcon /></span>
                        <span className={packStyles.raidOptionCopy}>
                          <small>{t("open.randomLegacyEyebrow")}</small>
                          <strong>{t("open.randomLegacy")}</strong>
                        </span>
                        <span className={packStyles.raidOptionCheck} aria-hidden="true">✓</span>
                      </button>
                      {legacySets.map((set) => (
                        <button
                          key={set.id}
                          type="button"
                          role="option"
                          aria-selected={legacySetId === set.id}
                          disabled={mode === "current"}
                          className={packStyles.raidOption}
                          onClick={() => setLegacySetId(set.id)}
                        >
                          <span className={packStyles.raidOptionIcon}>
                            {raidIconByZone.get(set.zoneId) ? <IconImage iconFilename={raidIconByZone.get(set.zoneId)} alt="" width={34} height={34} /> : <ArchiveIcon />}
                          </span>
                          <span className={packStyles.raidOptionCopy}>
                            <small>{set.expansionName}</small>
                            <strong>{set.raidName}</strong>
                          </span>
                          <span className={packStyles.raidOptionCheck} aria-hidden="true">✓</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>

                <div className={packStyles.packPresentation}>
                  <span className={packStyles.packMode}>
                    {mode === "legacy"
                      ? selectedLegacySet ? `${t("mode.legacy")} · ${selectedLegacySet.expansionName}` : t("open.legacyPackLabel")
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
                    <PackBoosterVisual
                      title={modeSets.length > 0 ? poolTitle : t("landing.preparing")}
                      cardsLabel={t("landing.cards")}
                    />
                  </button>
                  <span className={packStyles.packHint}>{mutation.isPending ? t("open.openingHint") : t("open.packHint")}</span>
                </div>

                <aside className={packStyles.packBalancePanel}>
                  {session ? <PackBalance session={session} mode={mode} /> : <div className={packStyles.balancePlaceholder} />}
                  {noPacks ? <p className="mt-4 text-sm text-amber-200">{t("open.noPacks")}</p> : null}
                  {recoveryQuery.isError ? (
                    <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/[0.05] p-3" role="alert">
                      <p className="text-sm leading-5 text-amber-100">{t("open.recoveryFailed")}</p>
                      <button type="button" className={`${styles.secondaryButton} mt-3 w-full`} onClick={clearSavedOpening}>
                        {t("open.dismissRecovery")}
                      </button>
                    </div>
                  ) : null}
                  {mutation.error ? <p className="mt-4 text-sm text-red-300" role="alert">{mutation.error.message}</p> : null}
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

            <div className={`${packStyles.tearSequence} ${revealPhase === "holding" ? packStyles.tearSequenceHolding : ""} ${revealPhase === "ready" ? packStyles.tearSequenceComplete : ""}`} aria-hidden="true">
              {revealPhase === "holding" ? (
                <span className={`${packStyles.packButton} ${packStyles.heldPack}`}>
                  <PackBoosterVisual title={openingPackName ?? t("open.legacyPackTitle")} cardsLabel={t("landing.cards")} />
                </span>
              ) : null}
              <span className={`${packStyles.tornHalf} ${packStyles.tornHalfLeft}`}><span /></span>
              <span className={`${packStyles.tornHalf} ${packStyles.tornHalfRight}`}><span /></span>
              <span className={packStyles.tearParticles}>
                {tearParticles.map((particle, index) => (
                  <i
                    key={index}
                    style={{
                      "--particle-x": `${particle.x}px`,
                      "--particle-y": `${particle.y}px`,
                      "--particle-rotate": `${particle.rotate}deg`,
                      "--particle-delay": `${particle.delay}ms`,
                    } as CSSProperties}
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
                        ref={(element) => { cardRefs.current[index] = element; }}
                        disabled={!dealt || revealPhase !== "ready" || isPackCycling}
                        onPointerMove={revealed ? undefined : updateSealedCardMotion}
                        onPointerLeave={(event) => {
                          if (!revealed) resetSealedCardMotion(event);
                          setActiveReveal((current) => current?.index === index ? null : current);
                        }}
                        onClick={(event) => revealCard(index, event)}
                        aria-label={revealed ? t("open.viewCard", { name: result.card.name }) : `${t("open.revealCard", { position: index + 1 })}. ${sealedCardHint}`}
                      >
                        <span className={packStyles.sealedAura} aria-hidden="true" />
                        <span className={packStyles.cardFlip} data-card-surface>
                          <span className={`${packStyles.cardFace} ${packStyles.cardBack}`} aria-hidden={revealed}>
                            <span className={packStyles.cardBackField} />
                            <span className={packStyles.cardBackFinish} />
                            <span className={packStyles.cardBackSigil} aria-hidden="true"><span /></span>
                            <span className={packStyles.cardBackBrand}><span>SUOMIWOW</span><strong>CCG</strong></span>
                            <span
                              className={packStyles.cardBackSet}
                              style={{ "--card-back-set-scale": cardBackSetScale } as CSSProperties}
                            >
                              {openingPackName}
                            </span>
                          </span>
                          <span className={`${packStyles.cardFace} ${packStyles.cardFront}`} aria-hidden={!revealed}>
                            <CollectibleCard
                              card={result.card}
                              finish={result.finish}
                              compact
                              className={packStyles.openedCard}
                              forcedPointer={activeReveal?.index === index ? activeReveal : undefined}
                            />
                          </span>
                        </span>
                        <span className={packStyles.revealFlare} aria-hidden="true" />
                        <span className={packStyles.revealCeremony} aria-hidden="true">
                          <span className={packStyles.revealRays} />
                          <span className={packStyles.revealRings}><i /><i /><i /><i /></span>
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
                {!allRevealed ? (
                  <div className={packStyles.revealProgress}>
                    <span>{t("open.revealProgress", { revealed: revealedCards.size, total: opening.results.length })}</span>
                    <button type="button" className={styles.secondaryButton} onClick={revealAll} disabled={revealPhase !== "ready"}>
                      {t("open.revealAll")}
                    </button>
                  </div>
                ) : (
                  <div className={packStyles.nextPackActions}>
                    {hasAnotherPack ? (
                      <button type="button" className={styles.primaryButton} onClick={openAnotherPack} disabled={mutation.isPending || isPackCycling}>
                        {mutation.isPending || isPackCycling ? t("open.opening") : t("open.openAnother")}
                      </button>
                    ) : null}
                    <button type="button" className={styles.secondaryButton} onClick={clearSavedOpening} disabled={mutation.isPending || isPackCycling}>
                      {t("open.chooseDifferent")}
                    </button>
                  </div>
                )}
              </div>
              {allRevealed && mutation.error ? <p className={packStyles.packActionError} role="alert">{mutation.error.message}</p> : null}
              {allRevealed && opening.duplicateRewards > 0 ? <p className={packStyles.bonusEarned}>{t("open.bonusEarned", { count: opening.duplicateRewards })}</p> : null}
            </div>
            <div className={`${packStyles.burstOverlay} ${revealPhase === "holding" ? packStyles.tearSequenceHolding : ""} ${revealPhase === "ready" ? packStyles.tearSequenceComplete : ""}`} aria-hidden="true">
              <span className={packStyles.tearFlash} />
              <span className={packStyles.tearBurst} />
              <span className={packStyles.tearShockwaves}><i /><i /><i /></span>
            </div>
            <p className="sr-only" aria-live="polite">{revealPhase === "ready" && revealedCards.size === 0 ? t("open.cardsReady") : revealedSummary}</p>
          </section>
        )}
      </div>
      {opening && viewerIndex !== null ? (
        <CardViewer
          card={{ ...opening.results[viewerIndex].card, ownership: [{ finish: opening.results[viewerIndex].finish, quantity: 1 }] }}
          initialFinish={opening.results[viewerIndex].finish}
          originElement={viewerOriginElement}
          originBounds={viewerOriginBounds}
          sharedTransition={viewerSharedTransition}
          onClose={() => {
            setViewerIndex(null);
            setViewerOriginElement(null);
            setViewerOriginBounds(null);
            setViewerSharedTransition(false);
          }}
        />
      ) : null}
      <audio ref={shuffleAudioRef} src="/ccg/audio/shuffle.wav" preload="auto" aria-hidden="true" />
      {cardSlideSounds.map((src, index) => (
        <audio
          key={src}
          ref={(element) => { cardSlideAudioRefs.current[index] = element; }}
          src={src}
          preload="auto"
          aria-hidden="true"
        />
      ))}
      {Array.from({ length: 5 }, (_, index) => (
        <audio
          key={index}
          ref={(element) => { drawAudioRefs.current[index] = element; }}
          src="/ccg/audio/draw.wav"
          preload="auto"
          aria-hidden="true"
        />
      ))}
    </CcgShell>
  );
}
