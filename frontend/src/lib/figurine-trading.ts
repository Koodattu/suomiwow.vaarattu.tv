import type { FigurineCollection, MachineItem } from "./figurine-collection";
import { PREVIEW_ROSTER } from "@/lib/figurine-community-preview";

export type TradeAsset = { kind: "coins"; amount: number } | ({ kind: "figure" } & MachineItem);
// `give` is what the player hands over and `receive` what comes back: coins for a figure (buying),
// a figure for coins (selling), or one figure for another (a swap).
export type TradeOffer = { id: string; collector: string; give: TradeAsset; receive: TradeAsset; bargain?: boolean };
export type TradeKind = "buy" | "sell" | "swap";
export const tradeKind = (offer: TradeOffer): TradeKind => offer.give.kind === "figure" ? offer.receive.kind === "figure" ? "swap" : "sell" : "buy";
// The figures the sample market deals in: three standard, two golden and a galaxy.
const figures: MachineItem[] = [
  { key: "community-001:roidy", quality: "standard" },
  { key: "community-002:ajotettu", quality: "standard" },
  { key: "community-002:galardodric", quality: "standard" },
  { key: "community-001:violetmw", quality: "golden" },
  { key: "community-002:rookiheal", quality: "golden" },
  { key: "community-001:kahvishock", quality: "galaxy" },
];
const figure = (index: number): TradeAsset => ({ kind: "figure", ...figures[index % figures.length] });
const coins = (amount: number): TradeAsset => ({ kind: "coins", amount });
const value = (index: number) => [2, 2, 2, 5, 5, 12][index % figures.length];
export const canAffordTrade = (asset: TradeAsset, balance: number, collection: FigurineCollection) => asset.kind === "coins"
  ? balance >= asset.amount : (collection[asset.key]?.[asset.quality] ?? 0) > 0;

// The merchant's four deals: one of each kind, and a golden figure under the market's price.
// Stable for a local calendar day; refreshing advances the selection without touching a server.
export function dailyDeals(day: string, refresh = 0): TradeOffer[] {
  const seed = [...day].reduce((sum, char) => sum + char.charCodeAt(0), 0) + refresh;
  const standard = seed % 3, premium = 3 + seed % 2;
  // The swap asks for any standard figure of the roster and gives another back.
  const wanted = PREVIEW_ROSTER[seed * 7 % PREVIEW_ROSTER.length], offered = PREVIEW_ROSTER[(seed * 7 + 5 + seed % 11) % PREVIEW_ROSTER.length];
  return [
    { id: `${day}:${refresh}:buy`, collector: "", give: coins(1), receive: figure(standard), bargain: true },
    { id: `${day}:${refresh}:sell`, collector: "", give: figure((standard + 1) % 3), receive: coins(3), bargain: true },
    { id: `${day}:${refresh}:premium`, collector: "", give: coins(4), receive: figure(premium), bargain: true },
    { id: `${day}:${refresh}:swap`, collector: "", give: { kind: "figure", key: wanted, quality: "standard" }, receive: { kind: "figure", key: offered, quality: "standard" }, bargain: true },
  ];
}
const COLLECTORS = ["Lumi", "Naava", "Kaiku", "Tuisku", "Kipinä", "Havu", "Sisu", "Usva"];
// The players' board: buying, selling and swapping in turn.
export const PLAYER_OFFERS: TradeOffer[] = Array.from({ length: 28 }, (_, index) => {
  const item = index % figures.length, price = value(item) + Math.floor(index / 6) % 2, kind = index % 4;
  const other: TradeAsset = { kind: "figure", key: PREVIEW_ROSTER[(index * 5 + 3) % PREVIEW_ROSTER.length], quality: figures[item].quality };
  return { id: `player-${index}`, collector: COLLECTORS[index % COLLECTORS.length],
    give: kind === 1 ? figure(item) : kind === 3 ? other : coins(price), receive: kind === 1 ? coins(price) : figure(item) };
});
