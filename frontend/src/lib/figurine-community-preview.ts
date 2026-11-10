import { FISH, catchScore, fishRarity, type FigurineQuality, type FishId, type MachineItem } from "@/lib/figurine-collection";

// Fictional collectors for the community preview: a town's worth of them, generated the same way
// every time, with their finds, firsts, standings and catches. Nothing is persisted or exchanged
// with another player, and these actions never consume the player's collection.
const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// Every released figure, as its catalogue key (a test checks these against the series data).
export const PREVIEW_ROSTER = [
  ...["roidy", "yolobolt", "laku", "jannu", "vesipuhveli", "turrilol", "karstinen", "kahvishock", "stablol", "suursmurffi", "rmp", "violetmw", "shippyboi", "abiw", "chipie", "ovelakettu"].map((id) => `community-001:${id}`),
  ...["ajotettu", "eppugrip", "zetabeach", "np", "zetacmi", "hirvihotline", "tonza", "thrusbard", "jampton", "morinicar", "mightyhuu", "kuurankukka", "ragge", "chipi", "rookiheal", "galardodric"].map((id) => `community-002:${id}`),
] as const;
const NAMES = ["Lumi", "Naava", "Kaiku", "Tuisku", "Kipinä", "Havu", "Sisu", "Usva", "Routa", "Halla", "Myrsky", "Kaarna", "Pihla", "Otso", "Ukko", "Aalto", "Säde", "Ruska", "Kuura", "Tähti", "Varjo", "Hiisi", "Louhi", "Tapio", "Ahti", "Ilmari", "Väinö", "Mielikki", "Tuoni", "Kelo", "Suvi", "Talvi", "Loimu", "Vesa", "Kanerva", "Sammal", "Korpi", "Nokka", "Pyry", "Sade"];
const TAGS = ["", "x", "TV", "92", "fi", "HD"];
const nameOf = (index: number) => `${NAMES[index % NAMES.length]}${TAGS[Math.floor(index / NAMES.length) % TAGS.length]}`;

// The gifting post keeps its own small sample inventory, by index.
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

// The town's last twenty golden and galaxy pulls, newest first.
export type PreviewFind = { id: string; collector: string; item: MachineItem; source: "fromBox" | "fromForge" | "fromWheel" | "fromPond"; minutes: number; cheers: number };
export const PREVIEW_FEED: readonly PreviewFind[] = (() => {
  const random = seeded(20261110), sources = ["fromBox", "fromBox", "fromBox", "fromForge", "fromWheel", "fromPond"] as const;
  let minutes = 0;
  return Array.from({ length: 20 }, (_, index) => {
    minutes += 2 + Math.floor(random() * (6 + index * 3));
    const galaxy = random() < 0.22;
    return { id: `pull-${index + 1}`, collector: nameOf(Math.floor(random() * 90)), item: { key: PREVIEW_ROSTER[Math.floor(random() * PREVIEW_ROSTER.length)], quality: galaxy ? "galaxy" as const : "golden" as const },
      source: sources[Math.floor(random() * sources.length)], minutes, cheers: Math.floor(random() * (galaxy ? 40 : 16)) + (galaxy ? 8 : 0) };
  });
})();

// The standings: the same five at the top as ever, and the rest of the town behind them.
export type RankMetric = "unique" | "galaxy" | "golden" | "opened";
export type PreviewCollector = { name: string; avatar: MachineItem } & Record<RankMetric, number>;
const LEADERS: PreviewCollector[] = [
  { name: "Lumi", avatar: PREVIEW_FIGURES[1], unique: 31, galaxy: 4, golden: 19, opened: 248 },
  { name: "Naava", avatar: PREVIEW_FIGURES[3], unique: 29, galaxy: 6, golden: 14, opened: 212 },
  { name: "Kaiku", avatar: PREVIEW_FIGURES[4], unique: 27, galaxy: 2, golden: 21, opened: 194 },
  { name: "Tuisku", avatar: PREVIEW_FIGURES[2], unique: 25, galaxy: 3, golden: 12, opened: 176 },
  { name: "Kipinä", avatar: PREVIEW_FIGURES[0], unique: 23, galaxy: 1, golden: 10, opened: 158 },
];
export const PREVIEW_COLLECTORS: readonly PreviewCollector[] = (() => {
  const random = seeded(4711), total = 149;
  return [...LEADERS, ...Array.from({ length: total - LEADERS.length }, (_, index) => {
    const depth = index / (total - LEADERS.length), unique = Math.max(1, Math.round(22 * (1 - depth) ** 1.25 + random() * 1.5));
    const golden = Math.min(unique, Math.round(unique * (0.2 + random() * 0.4))), galaxy = random() < 0.35 * (1 - depth) ? 1 + Math.floor(random() * 2) : 0;
    const quality: FigurineQuality = galaxy && random() < 0.5 ? "galaxy" : golden && random() < 0.5 ? "golden" : "standard";
    return { name: nameOf(index + LEADERS.length), avatar: { key: PREVIEW_ROSTER[Math.floor(random() * PREVIEW_ROSTER.length)], quality }, unique, galaxy, golden, opened: Math.round(unique * (5 + random() * 3) + random() * 12) };
  })];
})();
export const previewRankings = (metric: RankMetric) => [...PREVIEW_COLLECTORS].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));

// The hall of fame: thirty firsts and records across everything the town does. Some still wait.
export const HONOUR_GROUPS = ["collecting", "fishing", "crafting", "trading", "daily"] as const;
export type HonourGroup = (typeof HONOUR_GROUPS)[number];
export type PreviewHonour = { id: string; group: HonourGroup; collector: string | null; date: string | null; item?: MachineItem; fish?: FishId; detail?: string };
const HONOURS: [HonourGroup, string, { fish?: FishId; quality?: FigurineQuality; detail?: string; open?: true }?][] = [
  ["collecting", "firstGolden", { quality: "golden" }], ["collecting", "galaxy", { quality: "galaxy" }], ["collecting", "complete"], ["collecting", "goldenSeries", { quality: "golden", open: true }],
  ["collecting", "galaxySeries", { quality: "galaxy", open: true }], ["collecting", "secret"], ["collecting", "allSeries", { open: true }], ["collecting", "hundred"],
  ["collecting", "thousandBoxes", { open: true }], ["collecting", "tripleGalaxy", { quality: "galaxy" }],
  ["fishing", "firstEpic", { fish: "mightfish" }], ["fishing", "goldenFish", { fish: "salmon", quality: "golden" }], ["fishing", "galaxyFish", { fish: "eel", quality: "galaxy" }], ["fishing", "fullLog"],
  ["fishing", "heaviest", { fish: "mightfish", detail: "39.2 lb" }], ["fishing", "goldenBoot", { fish: "boot", quality: "golden" }], ["fishing", "angler1000", { open: true }],
  ["crafting", "firstForge", { quality: "golden" }], ["crafting", "forgeGalaxy", { quality: "galaxy" }], ["crafting", "recycle100"], ["crafting", "forge50", { open: true }],
  ["trading", "firstTrade"], ["trading", "trades100", { open: true }], ["trading", "firstGift"], ["trading", "gifts50", { open: true }],
  ["daily", "streak7"], ["daily", "streak30"], ["daily", "wheelGalaxy", { quality: "galaxy" }], ["daily", "quests100"], ["daily", "cheers100", { open: true }],
];
export const PREVIEW_HONOURS: readonly PreviewHonour[] = (() => {
  const random = seeded(1010);
  return HONOURS.map(([group, id, { fish, quality = "standard" as FigurineQuality, detail, open } = {}], index) => {
    const key = PREVIEW_ROSTER[Math.floor(random() * PREVIEW_ROSTER.length)], name = nameOf(Math.floor(random() * 30)), day = 1 + Math.floor(random() * 27);
    return { id, group, collector: open ? null : name, date: open ? null : `2026-${index % 2 ? "10" : "09"}-${String(day).padStart(2, "0")}T12:00:00Z`, fish, detail, item: fish ? undefined : { key, quality } };
  });
})();

// The anglers' standings: each angler's ten best catches, scored like the player's own.
export type PreviewCatch = { fish: FishId; weight: number; quality: FigurineQuality; score: number };
export type PreviewAngler = { name: string; score: number; catches: PreviewCatch[] };
export const PREVIEW_ANGLERS: readonly PreviewAngler[] = (() => {
  const random = seeded(77), kinds = FISH.filter((fish) => fishRarity(fish) !== "junk");
  return Array.from({ length: 79 }, (_, index) => {
    const skill = 1 - index / 79;
    const catches = Array.from({ length: 10 }, (): PreviewCatch => {
      // Better anglers have fished longer: rarer kinds, bigger ones, and more that shine.
      const fish = kinds[Math.min(kinds.length - 1, Math.floor(random() ** (1.6 - skill) * kinds.length))], [low, high] = fish.weight;
      const weight = Math.round((low + (high - low) * Math.min(1, random() * (0.5 + skill * 0.6))) * 10) / 10, shine = random();
      const quality: FigurineQuality = shine < 0.03 * skill ? "galaxy" : shine < 0.04 + 0.2 * skill ? "golden" : "standard";
      return { fish: fish.id, weight, quality, score: catchScore(fish.id, weight, quality) };
    }).sort((a, b) => b.score - a.score);
    return { name: nameOf(index * 7 % 120), score: catches.reduce((sum, entry) => sum + entry.score, 0), catches };
  }).sort((a, b) => b.score - a.score);
})();

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
