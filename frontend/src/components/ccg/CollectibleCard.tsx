"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CcgCard, CcgFinish } from "@/types";
import { CCG_RARITY_KEYS } from "@/lib/ccg";
import { formatRealmName, formatSpecName, getClassInfoById, getSpecIconUrl } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import AlphaFittedCharacterRender from "./AlphaFittedCharacterRender";
import styles from "./card-prototypes.module.css";

const classColors: Record<string, string> = {
  "Death Knight": "#C41E3A",
  "Demon Hunter": "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

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

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(value >= 1000 ? 0 : 1);
}

function applyCardMaterial(element: HTMLElement, x: number, y: number) {
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
}

type CollectibleCardProps = {
  card: CcgCard;
  finish?: CcgFinish | "void";
  compact?: boolean;
  quantity?: number;
  onSelect?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  className?: string;
  width?: number;
  guides?: boolean;
  hideCornerIcons?: boolean;
  hideBadges?: boolean;
  raidArtOffsetX?: number;
  forcedPointer?: { x: number; y: number };
  viewTransitionName?: string;
  onReady?: () => void;
};

export default function CollectibleCard({
  card,
  finish = "standard",
  compact = false,
  quantity,
  onSelect,
  className = "",
  width,
  guides = false,
  hideCornerIcons = false,
  hideBadges = false,
  raidArtOffsetX,
  forcedPointer,
  viewTransitionName,
  onReady,
}: CollectibleCardProps) {
  const t = useTranslations("ccg");
  const materialFrame = useRef<number | null>(null);
  const pendingMaterial = useRef<{ element: HTMLElement; x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLSpanElement | null>(null);
  const hadForcedPointer = useRef(false);
  const readyAssets = useRef(new Set<"render" | "class" | "spec">());
  const readyCard = useRef<string | null>(null);
  const classInfo = getClassInfoById(card.classID);
  const specIcon = getSpecIconUrl(card.classID, card.specName);
  const rarity = t(`rarity.${CCG_RARITY_KEYS[card.tierGrade]}`);
  const guild = card.guildName ? `<${card.guildName}>` : t("independent");
  const realm = formatRealmName(card.realm);
  const readyKey = `${card.id}:${card.renderUrl ?? ""}:${classInfo.iconUrl ?? ""}:${specIcon ?? ""}`;

  if (readyCard.current !== readyKey) {
    readyCard.current = readyKey;
    readyAssets.current.clear();
  }

  const markReady = useCallback((asset: "render" | "class" | "spec") => {
    readyAssets.current.add(asset);
    if (readyAssets.current.size === 3) onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (!card.renderUrl) markReady("render");
    if (hideCornerIcons) {
      markReady("class");
      markReady("spec");
    }
  }, [card.renderUrl, hideCornerIcons, markReady]);
  const cardStyle = {
    "--lab-accent": card.set.theme.accent,
    "--lab-glow": card.set.theme.glow,
    "--class-color": classColors[classInfo.name] ?? "#ffffff",
    "--lab-art": `url("${card.set.backgroundPath}")`,
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
    viewTransitionName,
  } as CSSProperties;

  useEffect(
    () => () => {
      if (materialFrame.current !== null) cancelAnimationFrame(materialFrame.current);
    },
    [],
  );

  const updateMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
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
    applyCardMaterial(event.currentTarget, 0.5, 0.38);
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
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
    applyCardMaterial(element, 0.5, 0.38);
    element.style.setProperty("--tilt-x", "0deg");
    element.style.setProperty("--tilt-y", "0deg");
  }, [forcedPointer]);

  const cardNode = (
    <span
      ref={cardRef}
      className={`${styles.prototypeCard} ${styles.vaultRelic} ${styles[finish]} ${guides ? styles.guides : ""}`}
      data-grade={card.tierGrade}
      data-finish={finish}
      data-frame="vaultSteel"
      data-ccg-card
      data-forced-hover={forcedPointer ? "true" : undefined}
      style={cardStyle}
      onPointerMove={updateMaterial}
      onPointerLeave={resetMaterial}
      aria-label={`${card.name}, ${guild}, ${realm}, ${card.set.raidName}, ${formatSpecName(card.specName)} ${classInfo.name}, ${rarity}, ${t(`finish.${finish}`)}`}
    >
      <span className={styles.outerFrame} aria-hidden="true" />
      <span className={styles.innerFrame} aria-hidden="true" />
      <FrameGeometry />
      <span className={styles.artworkClip} aria-hidden="true"><span className={styles.raidArt} /><span className={styles.raidShade} /></span>
      <span className={styles.lowerDeck} aria-hidden="true" />
      <span className={styles.renderWindow} aria-hidden="true">
        {card.renderUrl ? <AlphaFittedCharacterRender src={card.renderUrl} sizes={compact ? "280px" : `${width ?? 400}px`} className={styles.renderImage} onReady={() => markReady("render")} /> : null}
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
      {!hideBadges ? <span className={styles.setChip}><span>{card.set.raidName}</span></span> : null}

      {card.set.kind === "community" ? (
        <span className={`${styles.statsPanel} ${styles.communityStats}`}><strong>{t("communityCard")}</strong></span>
      ) : (
        <span className={styles.statsPanel}>
          <span className={styles.stat}><span>{t(card.role === "healer" ? "score.healing" : "score.damage")}</span><strong>{score(card.scores.performance)}</strong></span>
          <span className={styles.stat}><span>{t("score.mechanics")}</span><strong>{score(card.scores.mechanics)}</strong></span>
          <span className={styles.stat}><span>{t("score.combined")}</span><strong>{score(card.scores.combined)}</strong></span>
          <span className={styles.stat}><span>{t("score.mythicPlus")}</span><strong>{score(card.scores.mythicPlus)}</strong></span>
        </span>
      )}

      <span className={`${styles.cardBrand} ${styles.cardBrandLeft}`} aria-hidden="true">SUOMIWOW</span>
      <span className={`${styles.cardBrand} ${styles.cardBrandRight}`} aria-hidden="true">{realm}</span>
      {quantity && quantity > 1 ? <span className={styles.quantity}>×{quantity}</span> : null}
      <span className={styles.finishLayer} aria-hidden="true" />
      <span className={styles.materialLight} aria-hidden="true" />
    </span>
  );

  if (!onSelect) return <span className={`${styles.cardHost} ${className}`}>{cardNode}</span>;
  return <button type="button" className={`${styles.cardButton} ${className}`} onClick={onSelect}>{cardNode}</button>;
}
