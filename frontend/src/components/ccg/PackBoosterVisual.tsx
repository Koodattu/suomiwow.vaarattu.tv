import { useId } from "react";
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
  const geometryId = useId().replaceAll(":", "");
  const sealGradientId = `pack-seal-${geometryId}`;
  const sideGradientId = `pack-side-${geometryId}`;

  return (
    <>
      <span className={styles.packShadow} />
      <span className={styles.booster}>
        <span className={styles.wrapperSurface}>
          <span className={styles.wrapperBody}>
            <span className={styles.wrapperArt} />
            <span className={styles.wrapperShade} />
            <span className={styles.wrapperMetal} />
            <span className={styles.wrapperCreases} />
            <span className={styles.wrapperGlare} />
          </span>
          <span className={styles.wrapperStructure} aria-hidden="true">
            <svg viewBox="0 0 300 455" preserveAspectRatio="none">
              <defs>
                <linearGradient id={sealGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#020713" stopOpacity="0.9" />
                  <stop offset="0.08" stopColor="#dff4ff" stopOpacity="0.08" />
                  <stop offset="0.2" stopColor="#01040d" stopOpacity="0.84" />
                  <stop offset="0.48" stopColor="var(--pack-accent)" stopOpacity="0.18" />
                  <stop offset="0.72" stopColor="#01040c" stopOpacity="0.86" />
                  <stop offset="0.91" stopColor="#cfeaff" stopOpacity="0.06" />
                  <stop offset="1" stopColor="#01030a" stopOpacity="0.92" />
                </linearGradient>
                <linearGradient id={sideGradientId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#dff5ff" stopOpacity="0.3" />
                  <stop offset="0.22" stopColor="var(--pack-accent)" stopOpacity="0.32" />
                  <stop offset="0.62" stopColor="#020713" stopOpacity="0.62" />
                  <stop offset="1" stopColor="#020713" stopOpacity="0" />
                </linearGradient>
              </defs>

              <path
                className={styles.wrapperSideFold}
                d="M10 27 C18 38 21 54 19 78 L15 126 C13 147 10 164 7 178 L6 236 C8 206 12 184 14 158 C16 125 17 76 10 27 Z"
                fill={`url(#${sideGradientId})`}
              />
              <path
                className={`${styles.wrapperSideFold} ${styles.wrapperSideFoldRight}`}
                d="M290 27 C282 38 279 54 281 78 L285 126 C287 147 290 164 293 178 L294 236 C292 206 288 184 286 158 C284 125 283 76 290 27 Z"
                fill={`url(#${sideGradientId})`}
              />
              <path
                className={styles.wrapperSideFold}
                d="M7 178 C11 212 12 272 10 313 C9 353 8 391 10 428 L6 399 L6 236 Z"
                fill={`url(#${sideGradientId})`}
              />
              <path
                className={`${styles.wrapperSideFold} ${styles.wrapperSideFoldRight}`}
                d="M293 178 C289 212 288 272 290 313 C291 353 292 391 290 428 L294 399 L294 236 Z"
                fill={`url(#${sideGradientId})`}
              />

              <path
                className={styles.wrapperSeal}
                d="M3 8 Q4 4 10 4 Q150 -1 290 4 Q296 4 297 8 L299 21 Q299 24 295 25 L290 27 C240 25 60 25 10 27 L5 25 Q1 24 1 21 Z"
                fill={`url(#${sealGradientId})`}
              />
              <path
                className={styles.wrapperSeal}
                d="M10 428 C60 430 240 430 290 428 L295 430 Q299 431 299 434 L296 447 Q295 451 290 451 Q150 456 10 451 Q5 451 4 447 L1 434 Q1 431 5 430 Z"
                fill={`url(#${sealGradientId})`}
              />

              <g className={styles.wrapperSealRelief}>
                <path d="M3 8 Q150 4 297 8" />
                <path d="M2 13 Q150 9 298 13" />
                <path d="M2 18 Q150 14 298 18" />
                <path d="M2 23 Q150 19 298 23" />
                <path d="M2 433 Q150 437 298 433" />
                <path d="M3 438 Q150 442 297 438" />
                <path d="M4 443 Q150 447 296 443" />
                <path d="M6 448 Q150 452 294 448" />
              </g>

              <g className={styles.wrapperPleats}>
                <path d="M5 25 L10 27 C25 35 35 45 45 58 C29 46 18 37 5 25 Z" />
                <path d="M295 25 L290 27 C275 35 265 45 255 58 C271 46 282 37 295 25 Z" />
                <path d="M5 430 L10 428 C24 419 35 409 45 397 C29 409 18 419 5 430 Z" />
                <path d="M295 430 L290 428 C276 419 265 409 255 397 C271 409 282 419 295 430 Z" />
              </g>
              <g className={styles.wrapperWrinkles}>
                <path d="M10 27 C23 36 34 46 45 58" />
                <path d="M290 27 C277 36 266 46 255 58" />
                <path d="M10 428 C23 418 34 408 45 397" />
                <path d="M290 428 C277 418 266 408 255 397" />
                <path d="M15 74 C23 101 18 132 11 158" />
                <path d="M285 74 C277 101 282 132 289 158" />
              </g>
              <path className={styles.wrapperSealSeam} d="M5 25 L10 27 C60 25 240 25 290 27 L295 25" />
              <path className={styles.wrapperSealSeam} d="M5 430 L10 428 C60 430 240 430 290 428 L295 430" />
              <path className={styles.wrapperSideSeam} d="M10 27 C16 109 6 178 6 239 C6 312 14 375 10 428" />
              <path className={styles.wrapperSideSeam} d="M290 27 C284 109 294 178 294 239 C294 312 286 375 290 428" />
              <path
                className={styles.wrapperInnerContour}
                d="M10 27 C17 46 19 61 17 80 M10 428 C17 409 18 394 17 377 M290 27 C283 46 281 61 283 80 M290 428 C283 409 282 394 283 377"
              />
            </svg>
          </span>
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
      </span>
    </>
  );
}
