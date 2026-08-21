"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import { getCharacterRenderImageUrl } from "@/lib/character-render";

export type AlphaBounds = {
  top: number;
  ground: number;
  centerX: number;
};

type AlphaFitMode = "silhouette" | "stance";

type AlphaFittedCharacterRenderProps = {
  src: string;
  className?: string;
  fitMode?: AlphaFitMode;
  fit?: AlphaBounds | null;
  priority?: boolean;
  draggable?: boolean;
  onReady?: () => void;
};

const MAX_MEASUREMENT_SIZE = 256;
const ALPHA_THRESHOLD = 1;
const STANCE_SCAN_HALF_WIDTH_RATIO = 0.1;
const STANCE_GROUND_ALPHA_THRESHOLD = 32;
const STANCE_GROUND_PERCENTILE = 0.85;
const boundsCache = new Map<string, AlphaBounds>();

function measureAlphaBounds(image: HTMLImageElement, fitMode: AlphaFitMode): AlphaBounds | null {
  const scale = Math.min(1, MAX_MEASUREMENT_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let minY = height;
  let maxY = -1;
  let alphaMass = 0;
  let weightedX = 0;
  const horizontalAlphaMass = new Uint32Array(width);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      alphaMass += alpha;
      weightedX += (x + 0.5) * alpha;
      horizontalAlphaMass[x] += alpha;
    }
  }

  if (alphaMass === 0 || maxY < minY) return null;

  if (fitMode === "silhouette") {
    return {
      top: minY / height,
      ground: (maxY + 1) / height,
      centerX: weightedX / alphaMass / width,
    };
  }

  let accumulatedAlpha = 0;
  let stanceCenterX = width / 2;
  for (let x = 0; x < width; x += 1) {
    accumulatedAlpha += horizontalAlphaMass[x];
    if (accumulatedAlpha < alphaMass / 2) continue;
    stanceCenterX = x + 0.5;
    break;
  }

  const stanceHalfWidth = Math.max(1, Math.round(width * STANCE_SCAN_HALF_WIDTH_RATIO));
  const stanceStartX = Math.max(0, Math.floor(stanceCenterX - stanceHalfWidth));
  const stanceEndX = Math.min(width - 1, Math.ceil(stanceCenterX + stanceHalfWidth));
  const stanceColumnBottoms: number[] = [];
  const leftColumnBottoms: number[] = [];
  const rightColumnBottoms: number[] = [];
  const leftEndX = Math.floor(stanceCenterX - 0.5);
  const rightStartX = Math.ceil(stanceCenterX + 0.5);

  for (let x = 0; x < width; x += 1) {
    for (let y = maxY; y >= minY; y -= 1) {
      if (pixels[(y * width + x) * 4 + 3] < STANCE_GROUND_ALPHA_THRESHOLD) continue;
      if (x >= stanceStartX && x <= stanceEndX) stanceColumnBottoms.push(y);
      if (x <= leftEndX) leftColumnBottoms.push(y);
      if (x >= rightStartX) rightColumnBottoms.push(y);
      break;
    }
  }
  stanceColumnBottoms.sort((a, b) => a - b);
  leftColumnBottoms.sort((a, b) => a - b);
  rightColumnBottoms.sort((a, b) => a - b);
  const groundAtPercentile = (bottoms: number[]) => bottoms[
    Math.round((bottoms.length - 1) * STANCE_GROUND_PERCENTILE)
  ];
  const centralGroundY = groundAtPercentile(stanceColumnBottoms) ?? maxY;
  const leftGroundY = groundAtPercentile(leftColumnBottoms) ?? centralGroundY;
  const rightGroundY = groundAtPercentile(rightColumnBottoms) ?? centralGroundY;
  // A deeper ground must have support on both sides of the character. This
  // catches wide stances without letting a low side-held weapon set the floor.
  const groundY = Math.max(centralGroundY, Math.min(leftGroundY, rightGroundY));

  return {
    top: minY / height,
    ground: (groundY + 1) / height,
    centerX: weightedX / alphaMass / width,
  };
}

export default function AlphaFittedCharacterRender({ src, className, fitMode = "stance", fit, priority = false, draggable, onReady }: AlphaFittedCharacterRenderProps) {
  const imageSrc = useMemo(() => getCharacterRenderImageUrl(src), [src]);
  const cacheKey = `${fitMode}:${src}`;
  const [measurement, setMeasurement] = useState<{ key: string; bounds: AlphaBounds } | null>(() => {
    const bounds = boundsCache.get(cacheKey);
    return bounds ? { key: cacheKey, bounds } : null;
  });

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    if (fit) {
      onReady?.();
      return;
    }
    const cached = boundsCache.get(cacheKey);
    if (cached) {
      setMeasurement({ key: cacheKey, bounds: cached });
      onReady?.();
      return;
    }

    try {
      const bounds = measureAlphaBounds(event.currentTarget, fitMode);
      if (!bounds) return;
      boundsCache.set(cacheKey, bounds);
      setMeasurement({ key: cacheKey, bounds });
      onReady?.();
    } catch {
      // Leave the render hidden when its pixels cannot be inspected safely.
    }
  };

  const bounds = fit ?? (measurement?.key === cacheKey ? measurement.bounds : null);
  const opaqueHeight = bounds ? bounds.ground - bounds.top : 1;
  const fitStyle = {
    "--render-fit-height": `${100 / opaqueHeight}%`,
    "--render-fit-top": `${bounds ? (-bounds.top / opaqueHeight) * 100 : 0}%`,
    "--render-fit-translate-x": `${bounds ? -bounds.centerX * 100 : -50}%`,
  } as CSSProperties;

  return (
    <Image
      key={cacheKey}
      src={imageSrc}
      alt=""
      fill
      className={className}
      style={fitStyle}
      data-fit-ready={bounds ? "true" : "false"}
      priority={priority}
      unoptimized
      draggable={draggable}
      onLoad={onLoad}
      onError={onReady}
    />
  );
}
