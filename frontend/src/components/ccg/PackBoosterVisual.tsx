import type { CSSProperties } from "react";
import type { CcgSet } from "@/types";
import styles from "./pack-opening.module.css";

type PackPalette = {
  accent: string;
  glow: string;
  title: string;
  brand?: string;
  logo?: string;
};

const RAID_PACK_PALETTES: Readonly<Record<string, PackPalette>> = {
  uldir: {
    accent: "#c99343",
    glow: "rgba(201, 147, 67, 0.4)",
    title: "#e8c378",
    logo: "linear-gradient(145deg, #fff0bd, #d5a34d 58%, #8a5828)",
  },
  "battle-of-dazaralor": {
    accent: "#397fc4",
    glow: "rgba(57, 127, 196, 0.4)",
    title: "#78afe8",
    logo: "linear-gradient(145deg, #d9eeff, #5594d3 58%, #214f91)",
  },
  "the-eternal-palace": {
    accent: "#9565db",
    glow: "rgba(149, 101, 219, 0.42)",
    title: "#c29aed",
    logo: "linear-gradient(145deg, #efe0ff, #a878df 58%, #6344a8)",
  },
  nyalotha: {
    accent: "#a950ba",
    glow: "rgba(169, 80, 186, 0.44)",
    title: "#dc83d5",
    logo: "linear-gradient(145deg, #ffd9f7, #c967c8 56%, #71358e)",
  },
  "castle-nathria": {
    accent: "#c8454f",
    glow: "rgba(200, 69, 79, 0.44)",
    title: "#ef7778",
    logo: "linear-gradient(145deg, #ffd9cd, #d85b60 56%, #772634)",
  },
  "sepulcher-of-the-first-ones": {
    accent: "#c9ab4f",
    glow: "rgba(201, 171, 79, 0.4)",
    title: "#ead47f",
    logo: "linear-gradient(145deg, #fff6c8, #d2b65c 58%, #81703c)",
  },
  "vault-of-the-incarnates": {
    accent: "#9a6645",
    glow: "rgba(154, 102, 69, 0.42)",
    title: "#c89569",
    logo: "linear-gradient(145deg, #f5d5b2, #ad7650 56%, #603d2c)",
  },
  amirdrassil: {
    accent: "#4fae72",
    glow: "rgba(79, 174, 114, 0.4)",
    title: "#83d99d",
    logo: "linear-gradient(145deg, #dcffde, #68c389 58%, #326f4d)",
  },
  "nerubar-palace": {
    accent: "#9c62d4",
    glow: "rgba(156, 98, 212, 0.44)",
    title: "#e49362",
    brand: "#c584e9",
    logo: "linear-gradient(145deg, #e5c5ff, #ba73dd 46%, #e9975f 72%, #914c34)",
  },
  "liberation-of-undermine": {
    accent: "#70bd54",
    glow: "rgba(112, 189, 84, 0.42)",
    title: "#a7e58a",
    logo: "linear-gradient(145deg, #e5ffd5, #8ed36c 58%, #477b38)",
  },
};

export function getPackTheme(set: CcgSet | undefined, randomLegacy = false): CSSProperties {
  const palette = set ? RAID_PACK_PALETTES[set.slug] : undefined;
  const accent = randomLegacy ? "#72d8f3" : (palette?.accent ?? set?.theme.accent ?? "#5baeff");
  const glow = randomLegacy ? "rgba(93, 205, 236, 0.44)" : (palette?.glow ?? set?.theme.glow ?? "rgba(91, 174, 255, 0.38)");
  const title = randomLegacy ? "#9ce9ff" : (palette?.title ?? `color-mix(in srgb, ${accent} 64%, white)`);
  const brand = randomLegacy ? "#9ce9ff" : (palette?.brand ?? title);

  return {
    "--pack-accent": accent,
    "--pack-glow": glow,
    "--pack-title-color": title,
    "--pack-brand-color": brand,
    "--pack-stage-art": randomLegacy ? 'url("/ccg/general_wide.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art": randomLegacy ? 'url("/ccg/general_tall.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art-size": randomLegacy ? "cover" : "auto 100%",
    "--pack-logo-fill": randomLegacy
      ? "linear-gradient(145deg, #edfcff 0%, #9ce9ff 52%, #55bcd9 100%)"
      : (palette?.logo ?? "color-mix(in srgb, var(--pack-accent) 82%, white 18%)"),
    "--pack-logo-glow": glow,
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
