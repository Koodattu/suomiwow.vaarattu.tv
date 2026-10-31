import first from "@/data/figurines/community-001.json";
import second from "@/data/figurines/community-002.json";
import secret from "@/data/figurines/community-000.json";
import quips from "@/data/figurines/quips.json";
import firstSilhouettes from "../../public/figurines/community-001/silhouettes.png";
import secondSilhouettes from "../../public/figurines/community-002/silhouettes.png";

export type FigurineCharacter = { id: string; name: string; realm: string; model: string; bytes: number; raceKey: string; classKey: string };
// Theme keys resolve to print palettes in figurine-packaging, which stays out of the page bundle.
export type FigurineSeries = { id: string; number: number; theme: "amethyst" | "verdigris"; characters: FigurineCharacter[]; silhouettes: string };

// Static imports give each bake a content-hashed URL, so roster/pose updates cannot reuse a stale atlas.
const series = (catalog: { id: string; characters: FigurineCharacter[] }, number: number, theme: FigurineSeries["theme"], silhouettes: string): FigurineSeries => ({
  id: catalog.id, number, theme, silhouettes,
  characters: catalog.characters.map(({ id, name, realm, model, bytes, raceKey, classKey }) => ({ id, name, realm, model, bytes, raceKey, classKey })),
});

export const FIGURINE_SERIES: readonly FigurineSeries[] = [series(first, 1, "amethyst", firstSilhouettes.src), series(second, 2, "verdigris", secondSilhouettes.src)];
// Announced series: their boxes already stand in the shop (greyed, sealed shut) and their shelves
// wait in the case. Each prints in its own colour, a hue on the packaging colour wheel.
export type UpcomingSeries = { id: string; number: number; hue: number; size: number };
const UPCOMING_HUES = [18, 206, 140, 338, 42, 192, 4, 96, 280, 30, 220, 54, 300, 156, 234, 118, 318, 75];
export const UPCOMING_SERIES: readonly UpcomingSeries[] = UPCOMING_HUES.map((hue, index) => ({ id: `community-${String(index + 3).padStart(3, "0")}`, number: index + 3, hue, size: 16 }));
// Prepared separately: never added to shop order, announcements, or released draw pools.
export const SECRET_SERIES = { id: secret.id, number: secret.number, hue: secret.hue, size: secret.characters.length, hidden: secret.hidden };
export const TOTAL_FIGURES = FIGURINE_SERIES.reduce((total, entry) => total + entry.characters.length, 0);

export const figureKey = (seriesId: string, figureId: string) => `${seriesId}:${figureId}`;
// The figure's CCG card quip (its voice line), when the card has one.
export type FigurineQuip = { file: string; gain: number };
const QUIPS: Readonly<Record<string, FigurineQuip>> = quips.quips;
export const figureQuip = (key: string): FigurineQuip | undefined => QUIPS[key];
export const ALL_QUIPS: readonly FigurineQuip[] = Object.values(QUIPS);
export const findSeries = (id: string) => FIGURINE_SERIES.find((entry) => entry.id === id) ?? FIGURINE_SERIES[0];
export function findFigure(key: string) {
  const [seriesId, figureId] = key.split(":");
  const owner = FIGURINE_SERIES.find((entry) => entry.id === seriesId);
  const character = owner?.characters.find((entry) => entry.id === figureId);
  return owner && character ? { series: owner, character } : null;
}
