"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { FaStar } from "react-icons/fa6";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CcgArtVariant, CcgCard } from "@/types";
import { CCG_CLASS_COLORS, CCG_RARITY_KEYS } from "@/lib/ccg";
import { isCcgRaidPreviewFinish, type CcgPreviewFinish } from "@/lib/ccg-preview-finishes";
import { formatRealmName, formatSpecName, getClassInfoById, getParseColor, getSpecIconUrl } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import AlphaFittedCharacterRender from "./AlphaFittedCharacterRender";
import styles from "./card-prototypes.module.css";

const mythicPlusScoreColors = [
  [4375, "#ff8000"],
  [4215, "#f9763b"],
  [4095, "#f36b5a"],
  [3975, "#ea6175"],
  [3855, "#e05790"],
  [3735, "#d44daa"],
  [3615, "#c543c4"],
  [3495, "#b23ade"],
  [3365, "#9544eb"],
  [3245, "#6d5de5"],
  [3125, "#2a6dde"],
  [2975, "#4183c9"],
  [2855, "#579bb0"],
  [2735, "#5fb395"],
  [2615, "#5ccc77"],
  [2495, "#4de553"],
  [2375, "#1eff00"],
  [2250, "#44ff2a"],
  [2125, "#5aff3f"],
  [2000, "#6cff50"],
  [1875, "#7bff5f"],
  [1750, "#89ff6d"],
  [1625, "#95ff7a"],
  [1500, "#a1ff86"],
  [1375, "#acff92"],
  [1250, "#b6ff9e"],
  [1125, "#c0ffaa"],
  [1000, "#c9ffb5"],
  [875, "#d2ffc1"],
  [750, "#dbffcd"],
  [625, "#e4ffd8"],
  [500, "#ecffe4"],
  [375, "#f4ffef"],
  [250, "#fcfffa"],
  [200, "#ffffff"],
] as const;

const TOUCH_TILT_HOLD_MS = 220;
const TOUCH_TILT_INTENT_THRESHOLD = 8;
const TOUCH_CLICK_SUPPRESSION_MS = 500;

function isWebmArtwork(path: string | null): path is string {
  return Boolean(path && /\.webm(?:$|[?#])/i.test(path));
}

const frameRingPath = [
  "M 24 4 H 476 Q 496 4 496 24 V 676 Q 496 696 476 696",
  "H 24 Q 4 696 4 676 V 24 Q 4 4 24 4 Z",
  "M 82 14 H 418 Q 422 14 422 18 V 66 Q 422 74 430 74 H 470 Q 486 74 486 90",
  "V 676 Q 486 686 476 686",
  "H 377 C 367 686 365 668 355 668 H 145 C 135 668 133 686 123 686",
  "H 24 Q 14 686 14 676 V 90 Q 14 74 30 74 H 70 Q 78 74 78 66",
  "V 18 Q 78 14 82 14 Z",
].join(" ");

const frameInnerEdgePath = [
  "M 82 14 H 418 Q 422 14 422 18 V 66 Q 422 74 430 74 H 470 Q 486 74 486 90",
  "V 676 Q 486 686 476 686",
  "H 377 C 367 686 365 668 355 668 H 145 C 135 668 133 686 123 686",
  "H 24 Q 14 686 14 676 V 90 Q 14 74 30 74 H 70 Q 78 74 78 66",
  "V 18 Q 78 14 82 14 Z",
].join(" ");

function FrameGeometry() {
  const gradientId = `vault-frame-${useId().replace(/:/g, "")}`;

  return (
    <svg className={styles.frameGeometry} viewBox="0 0 500 700" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(-90 0.5 0.5)">
          <stop offset="0" stopColor="var(--metal-light)" />
          <stop offset="0.13" stopColor="var(--metal-dark)" />
          <stop offset="0.28" stopColor="var(--metal-mid)" />
          <stop offset="0.48" stopColor="#030507" />
          <stop offset="0.66" stopColor="color-mix(in srgb, var(--lab-accent) 25%, var(--metal-light))" />
          <stop offset="0.84" stopColor="var(--metal-dark)" />
          <stop offset="1" stopColor="var(--metal-mid)" />
        </linearGradient>
      </defs>
      <path d={frameRingPath} fill={`url(#${gradientId})`} fillRule="evenodd" />
      <rect x="4.75" y="4.75" width="490.5" height="690.5" rx="19.25" fill="none" stroke="rgba(255, 255, 255, 0.38)" strokeWidth="1.5" />
      <path d={frameInnerEdgePath} fill="none" stroke="color-mix(in srgb, var(--lab-accent) 42%, rgba(255, 255, 255, 0.34))" strokeWidth="1.5" />
    </svg>
  );
}

function MetamorphicSurfaceFilter({ id }: { id: string }) {
  return (
    <svg className={styles.surfaceFilterDefinition} width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id={id} x="-6%" y="-4%" width="112%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.11" numOctaves="2" seed="31" result="surfaceNoise" />
          <feGaussianBlur in="surfaceNoise" stdDeviation="0.22" result="softNoise" />
          <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="4.2" xChannelSelector="R" yChannelSelector="B" result="warped" />
          <feSpecularLighting in="softNoise" surfaceScale="2.2" specularConstant="0.22" specularExponent="18" lightingColor="#dffcff" result="surfaceLight">
            <feDistantLight azimuth="225" elevation="48" />
          </feSpecularLighting>
          <feComposite in="surfaceLight" in2="SourceAlpha" operator="in" result="clippedLight" />
          <feBlend in="warped" in2="clippedLight" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(value >= 1000 ? 0 : 1);
}

function raidScoreColor(value: number | null): string {
  return getParseColor(value === null ? 0 : Math.round(value));
}

function mythicPlusScoreColor(value: number | null): string {
  if (value === null) return "#ffffff";
  return mythicPlusScoreColors.find(([minimum]) => value >= minimum)?.[1] ?? "#ffffff";
}

export function applyCardMaterial(element: HTMLElement, x: number, y: number) {
  const distance = Math.min(1, Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2);
  element.style.setProperty("--tilt-x", `${((0.5 - y) * 7).toFixed(2)}deg`);
  element.style.setProperty("--tilt-y", `${((x - 0.5) * 8).toFixed(2)}deg`);
  element.style.setProperty("--pointer-x", `${(x * 100).toFixed(1)}%`);
  element.style.setProperty("--pointer-y", `${(y * 100).toFixed(1)}%`);
  element.style.setProperty("--pointer-left", x.toFixed(3));
  element.style.setProperty("--pointer-top", y.toFixed(3));
  element.style.setProperty("--pointer-distance", distance.toFixed(3));
  element.style.setProperty("--foil-x", `${(50 + (x - 0.5) * 54).toFixed(1)}%`);
  element.style.setProperty("--foil-y", `${(50 + (y - 0.5) * 46).toFixed(1)}%`);
  element.style.setProperty("--foil-x-reverse", `${(50 - (x - 0.5) * 76).toFixed(1)}%`);
  element.style.setProperty("--foil-y-reverse", `${(50 - (y - 0.5) * 64).toFixed(1)}%`);
  element.style.setProperty("--foil-angle", `${(118 + (x - 0.5) * 18 - (y - 0.5) * 10).toFixed(1)}deg`);
  if (element.dataset.finish === "parallax") {
    element.style.setProperty("--parallax-background-x", `${((0.5 - x) * 19.2).toFixed(3)}%`);
    element.style.setProperty("--parallax-background-y", `${((0.38 - y) * 6.4).toFixed(3)}%`);
    element.style.setProperty("--parallax-character-x", `${((x - 0.5) * 1.05).toFixed(3)}%`);
    element.style.setProperty("--parallax-character-y", `${((y - 0.38) * 0.6).toFixed(3)}%`);
  }
}

export function resetCardMaterial(element: HTMLElement) {
  applyCardMaterial(element, 0.5, 0.38);
  element.style.setProperty("--tilt-x", "0deg");
  element.style.setProperty("--tilt-y", "0deg");
}

type CollectibleCardProps = {
  card: CcgCard;
  finish?: CcgPreviewFinish;
  artVariant?: CcgArtVariant;
  compact?: boolean;
  quantity?: number;
  favorite?: boolean;
  onSelect?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  className?: string;
  width?: number;
  guides?: boolean;
  hideCornerIcons?: boolean;
  hideBadges?: boolean;
  raidArtOffsetX?: number;
  forcedPointer?: { x: number; y: number };
  ambientMaterial?: boolean;
  viewTransitionName?: string;
  renderPriority?: boolean;
  onReady?: () => void;
};

export default function CollectibleCard({
  card,
  finish = "standard",
  artVariant = "standard",
  compact = false,
  quantity,
  favorite = false,
  onSelect,
  className = "",
  width,
  guides = false,
  hideCornerIcons = false,
  hideBadges = false,
  raidArtOffsetX,
  forcedPointer,
  ambientMaterial = false,
  viewTransitionName,
  renderPriority = false,
  onReady,
}: CollectibleCardProps) {
  const t = useTranslations("ccg");
  const metamorphicFilterId = `vault-metamorphic-${useId().replace(/:/g, "")}`;
  const materialFrame = useRef<number | null>(null);
  const pendingMaterial = useRef<{ element: HTMLElement; x: number; y: number } | null>(null);
  const touchGesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    inspecting: boolean;
  } | null>(null);
  const touchTiltTimer = useRef<number | null>(null);
  const suppressTouchClickUntil = useRef(0);
  const cardRef = useRef<HTMLSpanElement | null>(null);
  const hadForcedPointer = useRef(false);
  const readyAssets = useRef(new Set<"render" | "class" | "spec">());
  const readyCard = useRef<string | null>(null);
  const classInfo = getClassInfoById(card.classID);
  const specIcon = getSpecIconUrl(card.classID, card.specName);
  const rarity = t(`rarity.${CCG_RARITY_KEYS[card.tierGrade]}`);
  const guild = card.guildName ? `<${card.guildName}>` : t("independent");
  const realm = formatRealmName(card.realm);
  const raidPreviewFinish = isCcgRaidPreviewFinish(finish);
  const alternativeActive = artVariant === "alternative";
  const renderUrl = alternativeActive && card.alternativeArt?.characterArtPath
    ? card.alternativeArt.characterArtPath
    : card.renderUrl;
  const backgroundPath = alternativeActive && card.set.kind === "community" && card.alternativeArt?.backgroundArtPath
    ? card.alternativeArt.backgroundArtPath
    : card.set.backgroundPath;
  const renderIsVideo = isWebmArtwork(renderUrl);
  const backgroundIsVideo = isWebmArtwork(backgroundPath);
  const readyKey = `${card.id}:${artVariant}:${renderUrl ?? ""}:${classInfo.iconUrl ?? ""}:${specIcon ?? ""}`;

  if (readyCard.current !== readyKey) {
    readyCard.current = readyKey;
    readyAssets.current.clear();
  }

  const markReady = useCallback((asset: "render" | "class" | "spec") => {
    readyAssets.current.add(asset);
    if (readyAssets.current.size === 3) onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (!renderUrl) markReady("render");
    if (hideCornerIcons) {
      markReady("class");
      markReady("spec");
    }
  }, [hideCornerIcons, markReady, renderUrl]);
  const cardStyle = {
    "--lab-accent": card.set.theme.accent,
    "--lab-glow": card.set.theme.glow,
    "--class-color": CCG_CLASS_COLORS[card.classID] ?? "#ffffff",
    "--lab-art": backgroundIsVideo ? "none" : `url("${backgroundPath}")`,
    "--crop-x": `${raidArtOffsetX ?? card.backgroundCrop.x}%`,
    "--crop-y": `${card.backgroundCrop.y}%`,
    "--crop-scale": card.backgroundCrop.scale,
    "--card-width": compact ? "100%" : `${width ?? 400}px`,
    "--tilt-x": "0deg",
    "--tilt-y": "0deg",
    "--pointer-x": "50%",
    "--pointer-y": "38%",
    "--pointer-left": 0.5,
    "--pointer-top": 0.38,
    "--pointer-distance": 0,
    "--foil-x": "50%",
    "--foil-y": "50%",
    "--foil-x-reverse": "50%",
    "--foil-y-reverse": "50%",
    "--foil-angle": "118deg",
    "--surface-filter": finish === "metamorphic" ? `url(#${metamorphicFilterId})` : "none",
    "--parallax-background-x": "0%",
    "--parallax-background-y": "0%",
    "--parallax-character-x": "0%",
    "--parallax-character-y": "0%",
    viewTransitionName,
  } as CSSProperties;

  useEffect(
    () => () => {
      if (materialFrame.current !== null) cancelAnimationFrame(materialFrame.current);
      if (touchTiltTimer.current !== null) window.clearTimeout(touchTiltTimer.current);
    },
    [],
  );

  const clearTouchTiltTimer = () => {
    if (touchTiltTimer.current === null) return;
    window.clearTimeout(touchTiltTimer.current);
    touchTiltTimer.current = null;
  };

  const updateMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary) return;
    const gesture = touchGesture.current;
    if (event.pointerType === "touch") {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (!gesture.inspecting) {
        if (distance >= TOUCH_TILT_INTENT_THRESHOLD) {
          gesture.moved = true;
          clearTouchTiltTimer();
        }
        return;
      }
      gesture.moved = true;
      event.preventDefault();
      event.stopPropagation();
    }
    event.currentTarget.dataset.pointerActive = "true";
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    pendingMaterial.current = { element: event.currentTarget, x, y };
    if (materialFrame.current !== null) return;
    materialFrame.current = requestAnimationFrame(() => {
      const material = pendingMaterial.current;
      if (material) applyCardMaterial(material.element, material.x, material.y);
      pendingMaterial.current = null;
      materialFrame.current = null;
    });
  };

  const resetMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (materialFrame.current !== null) cancelAnimationFrame(materialFrame.current);
    materialFrame.current = null;
    pendingMaterial.current = null;
    delete event.currentTarget.dataset.pointerActive;
    resetCardMaterial(event.currentTarget);
  };

  const startMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") {
      clearTouchTiltTimer();
      touchGesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        inspecting: false,
      };
      suppressTouchClickUntil.current = 0;
      const element = event.currentTarget;
      const pointerId = event.pointerId;
      touchTiltTimer.current = window.setTimeout(() => {
        touchTiltTimer.current = null;
        const gesture = touchGesture.current;
        if (!gesture || gesture.pointerId !== pointerId || gesture.moved || !element.isConnected) return;
        gesture.inspecting = true;
        suppressTouchClickUntil.current = Date.now() + TOUCH_CLICK_SUPPRESSION_MS;
        element.dataset.pointerActive = "true";
        const bounds = element.getBoundingClientRect();
        applyCardMaterial(
          element,
          Math.max(0, Math.min(1, (gesture.startX - bounds.left) / bounds.width)),
          Math.max(0, Math.min(1, (gesture.startY - bounds.top) / bounds.height)),
        );
      }, TOUCH_TILT_HOLD_MS);
      return;
    }
    updateMaterial(event);
  };

  const finishMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    clearTouchTiltTimer();
    const gesture = touchGesture.current;
    if (gesture?.pointerId === event.pointerId && (gesture.moved || gesture.inspecting)) {
      suppressTouchClickUntil.current = Date.now() + TOUCH_CLICK_SUPPRESSION_MS;
    }
    if (gesture?.pointerId === event.pointerId && gesture.inspecting) {
      event.preventDefault();
      event.stopPropagation();
    }
    touchGesture.current = null;
    resetMaterial(event);
  };

  const cancelMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    clearTouchTiltTimer();
    touchGesture.current = null;
    resetMaterial(event);
  };

  const leaveMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") {
      clearTouchTiltTimer();
      const gesture = touchGesture.current;
      if (gesture?.pointerId === event.pointerId) gesture.moved = true;
    }
    resetMaterial(event);
  };

  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    if (forcedPointer) {
      hadForcedPointer.current = true;
      applyCardMaterial(element, forcedPointer.x, forcedPointer.y);
      return;
    }
    if (!hadForcedPointer.current) return;
    hadForcedPointer.current = false;
    resetCardMaterial(element);
  }, [forcedPointer]);

  const cardNode = (
    <span
      ref={cardRef}
      className={`${styles.prototypeCard} ${styles.vaultRelic} ${styles[finish]} ${guides ? styles.guides : ""}`}
      data-grade={card.tierGrade}
      data-finish={finish}
      data-raid-preview-finish={raidPreviewFinish ? "true" : undefined}
      data-art-variant={artVariant}
      data-frame="vaultSteel"
      data-ccg-card
      data-forced-hover={forcedPointer ? "true" : undefined}
      data-ambient-material={ambientMaterial ? "true" : undefined}
      style={cardStyle}
      onPointerEnter={updateMaterial}
      onPointerDown={startMaterial}
      onPointerMove={updateMaterial}
      onPointerLeave={leaveMaterial}
      onPointerUp={finishMaterial}
      onPointerCancel={cancelMaterial}
      aria-label={`${card.name}, ${guild}, ${realm}, ${card.set.raidName}, ${formatSpecName(card.specName)} ${classInfo.name}, ${rarity}, ${t(`finish.${finish}`)}, ${t(`artwork.${artVariant}`)}${favorite ? `, ${t("collection.favoriteCard")}` : ""}`}
    >
      <span className={styles.outerFrame} aria-hidden="true" />
      <span className={styles.innerFrame} aria-hidden="true" />
      {finish === "metamorphic" ? <MetamorphicSurfaceFilter id={metamorphicFilterId} /> : null}
      <FrameGeometry />
      <span className={styles.artworkClip} aria-hidden="true">
        {backgroundIsVideo ? (
          <video src={backgroundPath} autoPlay loop muted playsInline preload={renderPriority ? "auto" : "metadata"} className={styles.raidArtVideo} />
        ) : <span className={styles.raidArt} />}
        <span className={styles.raidShade} />
      </span>
      <span className={styles.lowerDeck} aria-hidden="true" />
      <span className={styles.renderWindow} aria-hidden="true">
        {renderIsVideo ? (
          <video
            src={renderUrl}
            autoPlay
            loop
            muted
            playsInline
            preload={renderPriority ? "auto" : "metadata"}
            className={`${styles.renderImage} ${styles.renderVideo}`}
            data-fit-ready="true"
            onLoadedData={() => markReady("render")}
          />
        ) : renderUrl ? (
          <AlphaFittedCharacterRender src={renderUrl} className={styles.renderImage} priority={renderPriority} onReady={() => markReady("render")} />
        ) : null}
      </span>

      <span className={styles.identity}><strong className={styles.characterName}>{card.name}</strong><span className={styles.guildName}>{guild}</span></span>

      {!hideCornerIcons ? (
        <>
          <span className={`${styles.cornerCrest} ${styles.classCrest}`}><IconImage iconFilename={classInfo.iconUrl} alt="" width={40} height={40} onReady={() => markReady("class")} /><span>{classInfo.name}</span></span>
          <span className={`${styles.cornerCrest} ${styles.specCrest}`}><IconImage iconFilename={specIcon} alt="" width={40} height={40} onReady={() => markReady("spec")} /><span>{formatSpecName(card.specName)}</span></span>
        </>
      ) : null}

      <span className={styles.rarityPlate} data-quality={finish}><span className={styles.qualityLabel}>{t(`finish.${finish}`)}</span><strong>{rarity}</strong></span>
      <span className={styles.characterMeta}><span>{formatSpecName(card.specName)}</span><span>{classInfo.name}</span></span>
      {!hideBadges ? <span className={styles.setChip}><span>{card.set.raidName.toLowerCase()}</span></span> : null}

      <span className={styles.statsPanel}>
        <span className={styles.stat}><span>{t(card.role === "healer" ? "score.healing" : "score.damage")}</span><strong style={{ color: raidScoreColor(card.scores.performance) }}>{score(card.scores.performance)}</strong></span>
        <span className={styles.stat}><span>{t("score.mechanics")}</span><strong style={{ color: raidScoreColor(card.scores.mechanics) }}>{score(card.scores.mechanics)}</strong></span>
        <span className={styles.stat}><span>{t("score.combined")}</span><strong style={{ color: raidScoreColor(card.scores.combined) }}>{score(card.scores.combined)}</strong></span>
        <span className={styles.stat}><span>{t("score.mythicPlus")}</span><strong style={{ color: mythicPlusScoreColor(card.scores.mythicPlus) }}>{score(card.scores.mythicPlus)}</strong></span>
      </span>

      <span className={`${styles.cardBrand} ${styles.cardBrandLeft}`} aria-hidden="true">SUOMIWOW</span>
      <span className={`${styles.cardBrand} ${styles.cardBrandRight}`} aria-hidden="true">{realm}</span>
      {favorite ? <span className={styles.favoriteMark} aria-hidden="true"><FaStar /></span> : null}
      {quantity && quantity > 1 ? <span className={styles.quantity}>×{quantity}</span> : null}
      <span className={styles.finishLayer} aria-hidden="true" />
      <span className={styles.materialLight} aria-hidden="true" />
    </span>
  );

  if (!onSelect) return <span className={`${styles.cardHost} ${className}`}>{cardNode}</span>;
  return (
    <button
      type="button"
      className={`${styles.cardButton} ${className}`}
      onClick={(event) => {
        if (Date.now() < suppressTouchClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onSelect(event);
      }}
    >
      {cardNode}
    </button>
  );
}
