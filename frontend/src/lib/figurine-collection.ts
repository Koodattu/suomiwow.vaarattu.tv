// Figure qualities, from plain to rarest. Every box rolls one; three copies of the same figure at
// one quality trade up to the next in the recycler.
export const QUALITIES = ["standard", "golden", "galaxy"] as const;
export type FigurineQuality = (typeof QUALITIES)[number];
// Mutually exclusive chances per box; the remaining 89% are standard.
export const QUALITY_ODDS: Readonly<Record<Exclude<FigurineQuality, "standard">, number>> = { golden: 0.1, galaxy: 0.01 };

export const isQuality = (value: unknown): value is FigurineQuality => QUALITIES.includes(value as FigurineQuality);
export const qualityRank = (quality: FigurineQuality) => QUALITIES.indexOf(quality);
export const nextQuality = (quality: FigurineQuality): FigurineQuality | null => QUALITIES[qualityRank(quality) + 1] ?? null;

export function rollQuality(random: number): FigurineQuality {
  if (!(random >= 0 && random < 1)) throw new Error("Invalid roll");
  if (random < QUALITY_ODDS.galaxy) return "galaxy";
  return random < QUALITY_ODDS.galaxy + QUALITY_ODDS.golden ? "golden" : "standard";
}

// Session-long collection of opened figures: figure key -> copies owned per quality. Client side
// only; it lasts for the browser tab's session and is never sent anywhere.
export type FigurineCopies = Readonly<Partial<Record<FigurineQuality, number>>>;
export type FigurineCollection = Readonly<Record<string, FigurineCopies>>;
export type CollectionChange = { key: string; quality: FigurineQuality; delta: number };

export const COLLECTION_KEY = "suomiwow-figurine-collection-v2";
// The first prototype counted openings per figure (standard only); it is read once and carried over.
const LEGACY_KEY = "suomiwow-figurine-collection-v1";
const CHANGE_EVENT = "figurine-collection-change";
const EMPTY: FigurineCollection = Object.freeze({});
let cached: FigurineCollection | null = null;

type Store = Pick<Storage, "getItem" | "setItem">;
const sessionStore = (): Store | null => { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } };
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

// A hidden series is discovered by owning a figure from a completed opening,
// never by selecting its box. Missing models cannot unlock an empty shelf.
export function collectionShelves<T extends { id: string; number: string; hidden?: boolean; released: boolean; keys: string[] }>(series: readonly T[], collection: FigurineCollection): T[] {
  const hidden = series.filter((entry) => entry.hidden && entry.released && entry.keys.some((key) => copiesOf(collection[key]) > 0))
    .sort((a, b) => Number(a.number) - Number(b.number));
  const released = [...hidden, ...series.filter((entry) => !entry.hidden && entry.released)];
  const upcoming = series.filter((entry) => !entry.hidden && !entry.released);
  return [...released, ...upcoming.slice(0, (5 - released.length % 5) % 5)];
}

export const copiesOf = (entry: FigurineCopies | undefined) => QUALITIES.reduce((total, quality) => total + (entry?.[quality] ?? 0), 0);
// The finest quality owned, or null for a figure not in the collection.
export function bestQuality(entry: FigurineCopies | undefined): FigurineQuality | null {
  for (let rank = QUALITIES.length - 1; rank >= 0; rank--) if (entry?.[QUALITIES[rank]]) return QUALITIES[rank];
  return null;
}

export function parseCollection(raw: string | null): FigurineCollection {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
    const entries: [string, FigurineCopies][] = [];
    for (const [key, stored] of Object.entries(value)) {
      if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(key)) continue;
      // A bare number is the legacy shape: that many standard copies.
      const copies = count(stored) ? { standard: stored as number }
        : stored && typeof stored === "object" && !Array.isArray(stored) ? Object.fromEntries(Object.entries(stored).filter(([quality, n]) => isQuality(quality) && count(n))) : {};
      if (Object.keys(copies).length) entries.push([key, Object.freeze(copies)]);
    }
    return Object.freeze(Object.fromEntries(entries));
  } catch { return EMPTY; }
}

export function readCollection(store: Store | null = sessionStore()): FigurineCollection {
  if (store === sessionStore() && cached) return cached;
  let raw: string | null = null;
  try { raw = store?.getItem(COLLECTION_KEY) ?? store?.getItem(LEGACY_KEY) ?? null; } catch { /* storage blocked: the session starts empty */ }
  const collection = parseCollection(raw);
  if (store === sessionStore()) cached = collection;
  return collection;
}

function write(next: FigurineCollection, store: Store | null) {
  try { store?.setItem(COLLECTION_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: keep it in memory */ }
  if (store === sessionStore()) {
    cached = next;
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

// Applies every change at once, or none: returns false if any copy it takes is not owned.
export function changeCollection(changes: readonly CollectionChange[], store: Store | null = sessionStore()): boolean {
  const next: Record<string, Partial<Record<FigurineQuality, number>>> = Object.fromEntries(Object.entries(readCollection(store)).map(([key, copies]) => [key, { ...copies }]));
  for (const { key, quality, delta } of changes) {
    if (!Number.isSafeInteger(delta) || !isQuality(quality)) return false;
    const copies = next[key] ??= {}, total = (copies[quality] ?? 0) + delta;
    if (total < 0) return false;
    if (total) copies[quality] = total; else delete copies[quality];
    if (!Object.keys(copies).length) delete next[key];
  }
  write(Object.freeze(Object.fromEntries(Object.entries(next).map(([key, copies]) => [key, Object.freeze(copies)]))), store);
  return true;
}

// Records one opening and returns how many copies of the figure, at that quality, are now owned.
export function addToCollection(key: string, quality: FigurineQuality = "standard", store: Store | null = sessionStore()): number {
  changeCollection([{ key, quality, delta: 1 }], store);
  return readCollection(store)[key]?.[quality] ?? 1;
}

export function subscribeCollection(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
export const emptyCollection = () => EMPTY;

// The recycler: three figures go in. Three copies of one figure at one quality trade up to the
// next quality; any other three become a blind box, as long as one copy of every figure stays.
export const MACHINE_SLOTS = 3;
export type MachineItem = { key: string; quality: FigurineQuality };
export type MachineOutcome =
  | { kind: "incomplete" }
  // The box comes from the series most of the three came from (the first loaded breaks ties).
  | { kind: "box"; series: string }
  | { kind: "upgrade"; key: string; from: FigurineQuality; quality: FigurineQuality }
  // Recycling these would give away the last copy of `key`.
  | { kind: "keep"; key: string };

// What the tray offers: each quality of every figure owned more than once, in catalog order.
export function trayGroups(collection: FigurineCollection, order: readonly string[]): (MachineItem & { count: number })[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  return Object.entries(collection)
    .filter(([, copies]) => copiesOf(copies) > 1)
    .sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b))
    .flatMap(([key, copies]) => QUALITIES.filter((quality) => copies[quality]).map((quality) => ({ key, quality, count: copies[quality]! })));
}

const same = (a: MachineItem, b: MachineItem) => a.key === b.key && a.quality === b.quality;
// Copies of `item` still in the tray once the loaded ones are taken out.
export const spare = (collection: FigurineCollection, slots: readonly MachineItem[], item: MachineItem) =>
  (collection[item.key]?.[item.quality] ?? 0) - slots.filter((slot) => same(slot, item)).length;

export function machineOutcome(slots: readonly MachineItem[], collection: FigurineCollection): MachineOutcome {
  if (slots.length < MACHINE_SLOTS) return { kind: "incomplete" };
  const [first] = slots, upgrade = nextQuality(first.quality);
  if (upgrade && slots.every((slot) => same(slot, first))) return { kind: "upgrade", key: first.key, from: first.quality, quality: upgrade };
  for (const { key } of slots) if (slots.filter((slot) => slot.key === key).length >= copiesOf(collection[key])) return { kind: "keep", key };
  const votes = new Map<string, number>();
  for (const { key } of slots) { const series = key.split(":")[0]; votes.set(series, (votes.get(series) ?? 0) + 1); }
  const top = Math.max(...votes.values());
  return { kind: "box", series: [...votes].find(([, count]) => count === top)![0] };
}

// The collection changes a finished run makes: the inputs go, an upgrade adds its new copy.
export function machineChanges(slots: readonly MachineItem[], outcome: MachineOutcome): CollectionChange[] {
  if (outcome.kind !== "box" && outcome.kind !== "upgrade") return [];
  const changes: CollectionChange[] = slots.map(({ key, quality }) => ({ key, quality, delta: -1 }));
  if (outcome.kind === "upgrade") changes.push({ key: outcome.key, quality: outcome.quality, delta: 1 });
  return changes;
}

