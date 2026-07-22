"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import { getCharacterRenderProxyUrl } from "@/lib/character-render";

type AlphaBounds = {
  top: number;
  bottom: number;
  centerX: number;
};

type AlphaFittedCharacterRenderProps = {
  src: string;
  sizes: string;
  className?: string;
  priority?: boolean;
};

const MAX_MEASUREMENT_SIZE = 256;
const ALPHA_THRESHOLD = 1;
const boundsCache = new Map<string, AlphaBounds>();

function measureAlphaBounds(image: HTMLImageElement): AlphaBounds | null {
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
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;

  return {
    top: minY / height,
    bottom: (maxY + 1) / height,
    centerX: (minX + maxX + 1) / (2 * width),
  };
}

export default function AlphaFittedCharacterRender({ src, sizes, className, priority = false }: AlphaFittedCharacterRenderProps) {
  const proxySrc = useMemo(() => getCharacterRenderProxyUrl(src), [src]);
  const [measurement, setMeasurement] = useState<{ src: string; bounds: AlphaBounds } | null>(() => {
    const bounds = boundsCache.get(src);
    return bounds ? { src, bounds } : null;
  });

  useEffect(() => {
    const bounds = boundsCache.get(src);
    setMeasurement(bounds ? { src, bounds } : null);
  }, [src]);

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const cached = boundsCache.get(src);
    if (cached) {
      setMeasurement({ src, bounds: cached });
      return;
    }

    try {
      const bounds = measureAlphaBounds(event.currentTarget);
      if (!bounds) return;
      boundsCache.set(src, bounds);
      setMeasurement({ src, bounds });
    } catch {
      // Leave the render hidden when its pixels cannot be inspected safely.
    }
  };

  const bounds = measurement?.src === src ? measurement.bounds : null;
  const opaqueHeight = bounds ? bounds.bottom - bounds.top : 1;
  const fitStyle = {
    "--render-fit-height": `${100 / opaqueHeight}%`,
    "--render-fit-top": `${bounds ? (-bounds.top / opaqueHeight) * 100 : 0}%`,
    "--render-fit-translate-x": `${bounds ? -bounds.centerX * 100 : -50}%`,
  } as CSSProperties;

  return (
    <Image
      key={proxySrc}
      src={proxySrc}
      alt=""
      fill
      sizes={sizes}
      className={className}
      style={fitStyle}
      data-fit-ready={bounds ? "true" : "false"}
      priority={priority}
      unoptimized
      onLoad={onLoad}
    />
  );
}
