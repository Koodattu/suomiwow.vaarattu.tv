import { useId } from "react";
import type { CSSProperties } from "react";
import type { CcgSet } from "@/types";
import styles from "./pack-opening.module.css";

type PackPalette = {
  title: string;
  brand?: string;
  logo?: string;
};

const RAID_PACK_PALETTES: Readonly<Record<string, PackPalette>> = {
  highmaul: {
    title: "#f0aa6d",
    logo: "linear-gradient(145deg, #ffd7aa, #dd8548 54%, #72506f)",
  },
  "blackrock-foundry": {
    title: "#ff9468",
    logo: "linear-gradient(145deg, #b9e4ff, #ff9a4d 52%, #9d2f24)",
  },
  "hellfire-citadel": {
    title: "#aeea62",
    logo: "linear-gradient(145deg, #e4ff9b, #8edb45 56%, #365d24)",
  },
  "emerald-nightmare": {
    title: "#f47770",
    logo: "linear-gradient(145deg, #ffb481, #e44c6f 54%, #70205f)",
  },
  nighthold: {
    title: "#aebfff",
    logo: "linear-gradient(145deg, #ffd0c0, #a889e9 52%, #4b6fc3)",
  },
  "tomb-of-sargeras": {
    title: "#b9ef71",
    logo: "linear-gradient(145deg, #c8f5ff, #9eea4d 52%, #356b50)",
  },
  antorus: {
    title: "#91ed89",
    logo: "linear-gradient(145deg, #dfff91, #63e074 54%, #16766c)",
  },
  uldir: {
    title: "#e8c378",
    logo: "linear-gradient(145deg, #fff0bd, #d5a34d 58%, #8a5828)",
  },
  "battle-of-dazaralor": {
    title: "#78afe8",
    logo: "linear-gradient(145deg, #d9eeff, #5594d3 58%, #214f91)",
  },
  "the-eternal-palace": {
    title: "#c29aed",
    logo: "linear-gradient(145deg, #efe0ff, #a878df 58%, #6344a8)",
  },
  nyalotha: {
    title: "#dc83d5",
    logo: "linear-gradient(145deg, #ffd9f7, #c967c8 56%, #71358e)",
  },
  "castle-nathria": {
    title: "#ef7778",
    logo: "linear-gradient(145deg, #ffd9cd, #d85b60 56%, #772634)",
  },
  "sanctum-of-domination": {
    title: "#9fb5ff",
    logo: "linear-gradient(145deg, #e0e8ff, #7898f3 56%, #384c9b)",
  },
  "sepulcher-of-the-first-ones": {
    title: "#ead47f",
    logo: "linear-gradient(145deg, #fff6c8, #d2b65c 58%, #81703c)",
  },
  "vault-of-the-incarnates": {
    title: "#c89569",
    logo: "linear-gradient(145deg, #f5d5b2, #ad7650 56%, #603d2c)",
  },
  aberrus: {
    title: "#ae9cff",
    logo: "linear-gradient(145deg, #ffc09b, #e55e42 48%, #6250ad)",
  },
  amirdrassil: {
    title: "#83d99d",
    logo: "linear-gradient(145deg, #dcffde, #68c389 58%, #326f4d)",
  },
  "nerubar-palace": {
    title: "#e49362",
    brand: "#c584e9",
    logo: "linear-gradient(145deg, #e5c5ff, #ba73dd 46%, #e9975f 72%, #914c34)",
  },
  "liberation-of-undermine": {
    title: "#a7e58a",
    logo: "linear-gradient(145deg, #e5ffd5, #8ed36c 58%, #477b38)",
  },
  "manaforge-omega": {
    title: "#b2a2ff",
    logo: "linear-gradient(145deg, #d9d4ff, #a567ed 50%, #315fc6)",
  },
  "march-on-queldanas": {
    title: "#7ee4ff",
    logo: "linear-gradient(145deg, #fff0ae, #65ddff 48%, #3768c6)",
  },
};

export function getPackTheme(
  set: Pick<CcgSet, "slug" | "theme" | "backgroundPath" | "packArtOffsetX"> | undefined,
  combinedPool = false,
): CSSProperties {
  const palette = set ? RAID_PACK_PALETTES[set.slug] : undefined;
  const accent = combinedPool ? "#72d8f3" : (set?.theme.accent ?? "#5baeff");
  const glow = combinedPool ? "rgba(93, 205, 236, 0.44)" : (set?.theme.glow ?? "rgba(91, 174, 255, 0.38)");
  const title = combinedPool ? "#9ce9ff" : (palette?.title ?? `color-mix(in srgb, ${accent} 64%, white)`);
  const brand = combinedPool ? "#9ce9ff" : (palette?.brand ?? title);

  return {
    "--pack-accent": accent,
    "--pack-glow": glow,
    "--pack-title-color": title,
    "--pack-brand-color": brand,
    "--pack-stage-art": combinedPool ? 'url("/ccg/general_wide.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art": combinedPool ? 'url("/ccg/general_tall.webp")' : set ? `url("${set.backgroundPath}")` : "none",
    "--pack-art-size": combinedPool ? "cover" : "auto 100%",
    "--pack-art-position-x": `${combinedPool ? 50 : (set?.packArtOffsetX ?? 50)}%`,
    "--pack-logo-fill": combinedPool
      ? "linear-gradient(145deg, #edfcff 0%, #9ce9ff 52%, #55bcd9 100%)"
      : (palette?.logo ?? `linear-gradient(145deg, color-mix(in srgb, ${accent} 34%, white), ${accent} 58%, color-mix(in srgb, ${accent} 62%, black))`),
    "--pack-logo-glow": glow,
  } as CSSProperties;
}

export default function PackBoosterVisual({ title, cardsLabel, minimal = false }: { title: string; cardsLabel: string; minimal?: boolean }) {
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

              <g className={styles.wrapperSerratedEdge}>
                <path d="M10 5 L17 0 L24 5 L31 0 L38 5 L45 0 L52 5 L59 0 L66 5 L73 0 L80 5 L87 0 L94 5 L101 0 L108 5 L115 0 L122 5 L129 0 L136 5 L143 0 L150 5 L157 0 L164 5 L171 0 L178 5 L185 0 L192 5 L199 0 L206 5 L213 0 L220 5 L227 0 L234 5 L241 0 L248 5 L255 0 L262 5 L269 0 L276 5 L283 0 L290 5" />
                <path d="M10 450 L17 455 L24 450 L31 455 L38 450 L45 455 L52 450 L59 455 L66 450 L73 455 L80 450 L87 455 L94 450 L101 455 L108 450 L115 455 L122 450 L129 455 L136 450 L143 455 L150 450 L157 455 L164 450 L171 455 L178 450 L185 455 L192 450 L199 455 L206 450 L213 455 L220 450 L227 455 L234 450 L241 455 L248 450 L255 455 L262 450 L269 455 L276 450 L283 455 L290 450" />
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
          {minimal ? null : (
            <>
              <span className={styles.packBrand}>
                SuomiWoW <strong>CCG</strong>
              </span>
              <span className={styles.packTitle}>{title}</span>
            </>
          )}
          <span className={styles.packSigil} aria-hidden="true">
            <span />
          </span>
          {minimal ? null : (
            <span className={styles.packCount}>
              <strong>5</strong>
              <span>{cardsLabel}</span>
            </span>
          )}
        </span>
      </span>
    </>
  );
}
