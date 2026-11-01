import type { CSSProperties } from "react";
import type { FigurineQuality } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { portraitStyle } from "@/lib/figurine-portraits";
import styles from "./world-panels.module.css";

// A figure's baked portrait, finished like its quality: gold toned, or a nebula through its outline.
export default function Portrait({ figureKey, quality, locked = false, className }: { figureKey: string; quality?: FigurineQuality | null; locked?: boolean; className?: string }) {
  const found = findFigure(figureKey);
  if (!found) return <span className={`${styles.portrait} ${className ?? ""}`} />;
  const sprite = portraitStyle(found.series.id, found.series.characters.indexOf(found.character), found.series.characters.length);
  const vars = { ...sprite, "--sprite": sprite.backgroundImage, "--size": sprite.backgroundSize, "--pos": sprite.backgroundPosition } as CSSProperties;
  return <span className={`${styles.portrait} ${className ?? ""}`} style={vars} data-quality={locked ? undefined : quality ?? undefined} data-locked={locked} role="img" aria-label={found.character.name} />;
}
