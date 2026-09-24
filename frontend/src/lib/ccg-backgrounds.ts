import backgrounds from "./ccg-backgrounds.json";

export function getCcgBackground(source: string, variant: "tile" | "display" = "display"): string {
  return (backgrounds as Record<string, { tile: string; display: string }>)[source]?.[variant] ?? source;
}
