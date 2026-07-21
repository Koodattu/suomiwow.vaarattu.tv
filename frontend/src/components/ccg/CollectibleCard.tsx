"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties, PointerEvent, SyntheticEvent } from "react";
import type { CcgCard, CcgFinish } from "@/types";
import { getClassInfoById } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import styles from "./ccg.module.css";

const roleIcons: Record<CcgCard["role"], string> = {
  tank: "/icons/roleicon_tank.png",
  healer: "/icons/roleicon_healer.png",
  dps: "/icons/roleicon_damage.png",
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
  const cardStyle = {
    "--ccg-accent": card.set.theme.accent,
    "--ccg-glow": card.set.theme.glow,
    "--crop-x": `${card.backgroundCrop.x}%`,
    "--crop-y": `${card.backgroundCrop.y}%`,
    "--crop-scale": card.backgroundCrop.scale,
  } as CSSProperties;

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty("--tilt-x", `${(-y * 7).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${(x * 8).toFixed(2)}deg`);
  };

  const resetTilt = (event: SyntheticEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  };

  const content = (
    <span
      className={`${styles.card} ${styles[finish]} ${compact ? styles.compact : ""}`}
      data-grade={card.tierGrade}
      style={cardStyle}
    >
      <span className={styles.raidArt} style={{ backgroundImage: `url("${card.set.backgroundPath}")` }} />
      <span className={styles.artShade} />
      <span className={styles.render}>
        {card.renderUrl ? (
          <Image src={card.renderUrl} alt="" fill sizes={compact ? "240px" : "420px"} className="object-contain object-bottom" priority={!compact} />
        ) : (
          <span className={styles.renderFallback}>
            <span className="relative block h-20 w-20 overflow-hidden rounded-full ring-1 ring-white/20">
              <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
            </span>
          </span>
        )}
      </span>
      <span className={styles.finishLayer} />
      <span className={styles.topRail}>
        <span className={styles.grade}>{card.tierGrade}</span>
        <span className={styles.setMark}>{card.set.theme.mark}</span>
      </span>
      {finish !== "standard" ? <span className={styles.finishMark}>{t(`finish.${finish}`)}</span> : null}
      {quantity && quantity > 1 ? <span className={styles.quantity}>×{quantity}</span> : null}
      <span className={styles.identity}>
        <span className={styles.name}>{card.name}</span>
        <span className={styles.affiliation}>
          {card.guildName ? `<${card.guildName}> · ` : ""}{card.realm}
        </span>
        <span className={styles.characterMeta}>
          <Image src={roleIcons[card.role]} alt={t(`role.${card.role}`)} width={16} height={16} className={styles.roleIcon} />
          <span>{card.specName} {classInfo.name}</span>
          <span aria-hidden="true">·</span>
          <span>{card.set.raidName}</span>
        </span>
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
      </span>
    </span>
  );

  if (!onSelect) return <div className={className}>{content}</div>;

  return (
    <button
      type="button"
      className={`${styles.cardButton} ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={resetTilt}
      onBlur={resetTilt}
      onClick={onSelect}
      aria-label={`${card.name}, ${card.tierGrade}, ${t(`finish.${finish}`)}`}
    >
      {content}
    </button>
  );
}
