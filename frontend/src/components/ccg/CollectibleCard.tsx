"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties, PointerEvent, SyntheticEvent } from "react";
import type { CcgCard, CcgFinish } from "@/types";
import { formatRealmName, getClassInfoById } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import AlphaFittedCharacterRender from "./AlphaFittedCharacterRender";
import styles from "./card.module.css";

const roleIcons: Record<CcgCard["role"], string> = {
  tank: "/icons/roleicon_tank.png",
  healer: "/icons/roleicon_healer.png",
  dps: "/icons/roleicon_damage.png",
};

const rarityKeys: Record<CcgCard["tierGrade"], "crown" | "legendary" | "epic" | "rare" | "uncommon" | "common"> = {
  Crown: "crown",
  S: "legendary",
  A: "epic",
  B: "rare",
  C: "uncommon",
  D: "common",
  E: "common",
  F: "common",
};

type CollectibleCardProps = {
  card: CcgCard;
  finish?: CcgFinish;
  compact?: boolean;
  quantity?: number;
  onSelect?: () => void;
  className?: string;
};

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(value >= 1000 ? 0 : 1);
}

export default function CollectibleCard({ card, finish = "standard", compact = false, quantity, onSelect, className = "" }: CollectibleCardProps) {
  const t = useTranslations("ccg");
  const classInfo = getClassInfoById(card.classID);
  const rarity = t(`rarity.${rarityKeys[card.tierGrade]}`);
  const cardStyle = {
    "--ccg-accent": card.set.theme.accent,
    "--ccg-glow": card.set.theme.glow,
    "--crop-x": `${card.backgroundCrop.x}%`,
    "--crop-y": `${card.backgroundCrop.y}%`,
    "--crop-scale": card.backgroundCrop.scale,
  } as CSSProperties;
  const interactionStyle = {
    ...cardStyle,
    "--tilt-x": "0deg",
    "--tilt-y": "0deg",
    "--pointer-x": "50%",
    "--pointer-y": "42%",
  } as CSSProperties;

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    event.currentTarget.style.setProperty("--tilt-x", `${((0.5 - y) * 8).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${((x - 0.5) * 9).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--pointer-x", `${(x * 100).toFixed(1)}%`);
    event.currentTarget.style.setProperty("--pointer-y", `${(y * 100).toFixed(1)}%`);
  };

  const resetTilt = (event: SyntheticEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
    event.currentTarget.style.setProperty("--pointer-x", "50%");
    event.currentTarget.style.setProperty("--pointer-y", "42%");
  };

  const content = (
    <span
      className={`${styles.card} ${styles[finish]} ${compact ? styles.compact : ""}`}
      data-grade={card.tierGrade}
      data-finish={finish}
      style={cardStyle}
    >
      <span className={styles.cardWell}>
        <span className={styles.raidArt} style={{ backgroundImage: `url("${card.set.backgroundPath}")` }} />
        <span className={styles.raidTint} />
        <span className={styles.artShade} />

        <span className={styles.cardHeader}>
          <span className={styles.gradeMedallion}>
            <span className={styles.gradeValue}>{card.tierGrade === "Crown" ? "✦" : card.tierGrade}</span>
            <span className={styles.gradeLabel}>{card.tierGrade === "Crown" ? t("rarity.crown") : t("tierShort")}</span>
          </span>
          <span className={styles.titleGroup}>
            <span className={styles.name}>{card.name}</span>
            <span className={styles.specialization}>
              <Image src={roleIcons[card.role]} alt="" width={16} height={16} className={styles.roleIcon} />
              <span>{card.specName} {classInfo.name}</span>
            </span>
          </span>
          <span className={styles.setMark} aria-hidden="true">{card.set.theme.mark}</span>
        </span>

        <span className={styles.raidName}>{card.set.raidName}</span>
        <span className={styles.rarityRibbon}>{rarity}</span>

        <span className={styles.render}>
          {card.renderUrl ? (
            <AlphaFittedCharacterRender src={card.renderUrl} sizes={compact ? "260px" : "460px"} className={styles.renderImage} priority={!compact} />
          ) : (
            <span className={styles.renderFallback}>
              <span className={styles.fallbackIcon}>
                <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
              </span>
            </span>
          )}
        </span>
        <span className={styles.characterGround} />

        <span className={styles.statsPlate}>
          <span className={styles.scores}>
            <span className={styles.score}>
              <span className={styles.scoreLabel}>{card.metric.toUpperCase()}</span>
              <span className={styles.scoreValue}>{score(card.scores.performance)}</span>
            </span>
            <span className={styles.score}>
              <span className={styles.scoreLabel}>{t("score.mechanicsShort")}</span>
              <span className={styles.scoreValue}>{score(card.scores.mechanics)}</span>
            </span>
            <span className={styles.score}>
              <span className={styles.scoreLabel}>{t("score.combinedShort")}</span>
              <span className={styles.scoreValue}>{score(card.scores.combined)}</span>
            </span>
            <span className={styles.score}>
              <span className={styles.scoreLabel}>{t("score.mythicPlusShort")}</span>
              <span className={styles.scoreValue}>{score(card.scores.mythicPlus)}</span>
            </span>
          </span>
          <span className={styles.affiliation}>
            <span>{card.guildName ? `<${card.guildName}>` : t("independent")}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRealmName(card.realm)}</span>
          </span>
          <span className={styles.cardSerial}>{String(card.setNumber).padStart(3, "0")} / {String(card.set.cardCount).padStart(3, "0")}</span>
        </span>
      </span>

      <span className={styles.frameHighlight} />
      <span className={`${styles.frameOrnament} ${styles.ornamentTop}`} aria-hidden="true" />
      <span className={`${styles.frameOrnament} ${styles.ornamentBottom}`} aria-hidden="true" />
      <span className={styles.finishLayer} />
      <span className={styles.foilGlint} />
      {finish !== "standard" ? <span className={styles.finishMark}>{t(`finish.${finish}`)}</span> : null}
      {quantity && quantity > 1 ? <span className={styles.quantity}>×{quantity}</span> : null}
    </span>
  );

  if (!onSelect) return <div className={className}>{content}</div>;

  return (
    <button
      type="button"
      className={`${styles.cardButton} ${className}`}
      style={interactionStyle}
      onPointerMove={onPointerMove}
      onPointerLeave={resetTilt}
      onBlur={resetTilt}
      onClick={onSelect}
      aria-label={`${card.name}, ${rarity}, ${t(`finish.${finish}`)}`}
    >
      {content}
    </button>
  );
}
