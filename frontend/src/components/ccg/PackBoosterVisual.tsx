import type { CSSProperties } from "react";
import type { CcgSet } from "@/types";
import styles from "./pack-opening.module.css";

export function getPackTheme(set: CcgSet | undefined, randomLegacy = false): CSSProperties {
  return {
    "--pack-accent": randomLegacy ? "#9c7cff" : (set?.theme.accent ?? "#5baeff"),
    "--pack-glow": randomLegacy ? "rgba(126, 105, 255, 0.42)" : (set?.theme.glow ?? "rgba(91, 174, 255, 0.38)"),
    "--pack-stage-art": randomLegacy ? 'url("/ccg/general_wide.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art": randomLegacy ? 'url("/ccg/general_tall.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art-size": randomLegacy ? "cover" : "auto 100%",
    "--pack-logo-fill": randomLegacy
      ? "linear-gradient(145deg, #e6fbff 0%, #7ed8ef 58%, #d2aa61 100%)"
      : "color-mix(in srgb, var(--pack-accent) 82%, white 18%)",
    "--pack-logo-glow": randomLegacy ? "rgba(92, 207, 238, 0.46)" : "var(--pack-glow)",
  } as CSSProperties;
}

export default function PackBoosterVisual({ title, cardsLabel }: { title: string; cardsLabel: string }) {
  return (
    <>
      <span className={styles.packShadow} />
      <span className={styles.booster}>
        <span className={styles.wrapperArt} />
        <span className={styles.wrapperShade} />
        <span className={styles.wrapperFoil} />
        <span className={`${styles.crimp} ${styles.crimpTop}`} />
        <span className={`${styles.crimp} ${styles.crimpBottom}`} />
        <span className={styles.packBrand}>
          SuomiWoW <strong>CCG</strong>
        </span>
        <span className={styles.packTitle}>{title}</span>
        <span className={styles.packSigil} aria-hidden="true">
          <span />
        </span>
        <span className={styles.packCount}>
          <strong>5</strong>
          <span>{cardsLabel}</span>
        </span>
      </span>
    </>
  );
}
