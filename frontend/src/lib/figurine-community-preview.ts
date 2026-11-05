import type { FigurineQuality, MachineItem } from "./figurine-collection";

// Fictional collectors and a separate inventory for the community preview. Nothing is persisted
// or exchanged with another player, and these actions never consume the player's collection.
export const PREVIEW_FIGURES: MachineItem[] = [
  { key: "community-001:roidy", quality: "standard" },
  { key: "community-001:violetmw", quality: "golden" },
  { key: "community-002:ajotettu", quality: "standard" },
  { key: "community-001:kahvishock", quality: "galaxy" },
  { key: "community-002:rookiheal", quality: "golden" },
  { key: "community-002:galardodric", quality: "standard" },
];
export const PREVIEW_GIFTS = [
  { id: "welcome", collector: "Tuisku", figure: 2, note: "welcome" },
  { id: "lucky", collector: "Lumi", figure: 4, note: "lucky" },
] as const;
export const PREVIEW_FEED = [
  { id: "pull-1", collector: "Lumi", figure: 3, source: "fromBox", minutes: 4, cheers: 18 },
  { id: "pull-2", collector: "Kaiku", figure: 1, source: "fromForge", minutes: 12, cheers: 9 },
  { id: "pull-3", collector: "Tuisku", figure: 4, source: "fromWheel", minutes: 28, cheers: 12 },
  { id: "pull-4", collector: "Naava", figure: 3, source: "fromPond", minutes: 46, cheers: 24 },
] as const;
export const PREVIEW_COLLECTORS = [
  { name: "Lumi", avatar: 1, unique: 31, galaxy: 4, golden: 19, opened: 248 },
  { name: "Naava", avatar: 3, unique: 29, galaxy: 6, golden: 14, opened: 212 },
  { name: "Kaiku", avatar: 4, unique: 27, galaxy: 2, golden: 21, opened: 194 },
  { name: "Tuisku", avatar: 2, unique: 25, galaxy: 3, golden: 12, opened: 176 },
  { name: "Kipinä", avatar: 0, unique: 23, galaxy: 1, golden: 10, opened: 158 },
] as const;
export const PREVIEW_HONOURS = [
  { id: "galaxy", collector: "Naava", figure: 3, date: "2026-10-01T12:00:00Z" },
  { id: "complete", collector: "Lumi", figure: 1, date: "2026-10-04T12:00:00Z" },
  { id: "secret", collector: "Kaiku", figure: 4, date: "2026-10-09T12:00:00Z" },
  { id: "goldenSeries", collector: null, figure: 1, date: null },
] as const;
export type PreviewState = {
  inventory: number[]; claimed: string[]; cheers: string[];
  sent: { id: number; recipient: string; figure: number; message: string }[];
};
export const createCommunityPreview = (): PreviewState => ({ inventory: [3, 1, 2, 0, 0, 1], claimed: [], cheers: [], sent: [] });
export type PreviewAction = { type: "claim"; id: string } | { type: "cheer"; id: string }
  | { type: "send"; recipient: string; figure: number; message: string };
export function communityPreviewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  if (action.type === "claim") {
    const gift = PREVIEW_GIFTS.find(entry => entry.id === action.id);
    if (!gift || state.claimed.includes(gift.id)) return state;
    const inventory = [...state.inventory]; inventory[gift.figure]++;
    return { ...state, inventory, claimed: [...state.claimed, gift.id] };
  }
  if (action.type === "cheer") {
    if (!PREVIEW_FEED.some(entry => entry.id === action.id)) return state;
    return { ...state, cheers: state.cheers.includes(action.id) ? state.cheers.filter(id => id !== action.id) : [...state.cheers, action.id] };
  }
  const recipient = action.recipient.trim();
  if (!recipient || recipient.length > 40 || action.message.length > 240 || !PREVIEW_FIGURES[action.figure] || !state.inventory[action.figure]) return state;
  const inventory = [...state.inventory]; inventory[action.figure]--;
  return { ...state, inventory, sent: [{ id: state.sent.length + 1, recipient, figure: action.figure, message: action.message.trim() }, ...state.sent] };
}
export type RankMetric = "unique" | "galaxy" | "golden" | "opened";
export const previewRankings = (metric: RankMetric) => [...PREVIEW_COLLECTORS].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));
export const matchesPreviewQuality = (figure: number, quality: FigurineQuality | "all") => quality === "all" || PREVIEW_FIGURES[figure].quality === quality;
