import type { FigurineCollection, MachineItem } from "./figurine-collection";

export type TradeAsset = { kind: "coins"; amount: number } | ({ kind: "figure" } & MachineItem);
export type TradeOffer = { id: string; collector: string; give: TradeAsset; receive: TradeAsset; bargain?: boolean };
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

// Stable for a local calendar day; refreshing advances the selection without touching a server.
export function dailyDeals(day: string, refresh = 0): TradeOffer[] {
  const seed = [...day].reduce((sum, char) => sum + char.charCodeAt(0), 0) + refresh;
  const standard = seed % 3, premium = 3 + seed % 2;
  return [
    { id: `${day}:${refresh}:buy`, collector: "", give: coins(1), receive: figure(standard), bargain: true },
    { id: `${day}:${refresh}:sell`, collector: "", give: figure((standard + 1) % 3), receive: coins(3), bargain: true },
    { id: `${day}:${refresh}:premium`, collector: "", give: coins(4), receive: figure(premium), bargain: true },
  ];
}
export const PLAYER_OFFERS: TradeOffer[] = Array.from({ length: 24 }, (_, index) => {
  const item = index % figures.length, price = value(item) + Math.floor(index / 6) % 2;
  return { id: `player-${index}`, collector: ["Lumi", "Naava", "Kaiku", "Tuisku", "Kipinä", "Havu", "Sisu", "Usva"][index % 8],
    give: index % 3 === 1 ? figure(item) : coins(price), receive: index % 3 === 1 ? coins(price) : figure(item) };
});
