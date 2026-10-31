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

// Two machines take three figures each. The recycler turns any three spare copies into a blind
// box, as long as one copy of every figure stays; the trade-up forge turns three copies of one
// figure at one quality into a single copy at the next quality.
export const MACHINE_SLOTS = 3;
export type FigurineMachine = "recycler" | "forge";
export type MachineItem = { key: string; quality: FigurineQuality };
export type MachineOutcome =
  | { kind: "incomplete" }
  // The box comes from the series most of the three came from (the first loaded breaks ties).
  | { kind: "box"; series: string }
  | { kind: "upgrade"; key: string; from: FigurineQuality; quality: FigurineQuality }
  // Recycling these would give away the last copy of `key`.
  | { kind: "keep"; key: string }
  // The forge only works on three of a kind below the top quality.
  | { kind: "mismatch" };

// What each machine's board offers, in catalog order. The recycler shows each quality of every
// figure owned more than once; the forge shows each quality held three times that can still go up.
export function trayGroups(collection: FigurineCollection, order: readonly string[], machine: FigurineMachine = "recycler"): (MachineItem & { count: number })[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  return Object.entries(collection)
    .filter(([, copies]) => machine === "forge" || copiesOf(copies) > 1)
    .sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b))
    .flatMap(([key, copies]) => QUALITIES.filter((quality) => machine === "forge" ? (copies[quality] ?? 0) >= MACHINE_SLOTS && nextQuality(quality) : copies[quality])
      .map((quality) => ({ key, quality, count: copies[quality]! })));
}

const same = (a: MachineItem, b: MachineItem) => a.key === b.key && a.quality === b.quality;
// Copies of `item` still on the board once the loaded ones are taken out.
export const spare = (collection: FigurineCollection, slots: readonly MachineItem[], item: MachineItem) =>
  (collection[item.key]?.[item.quality] ?? 0) - slots.filter((slot) => same(slot, item)).length;

export function machineOutcome(machine: FigurineMachine, slots: readonly MachineItem[], collection: FigurineCollection): MachineOutcome {
  if (slots.length < MACHINE_SLOTS) return { kind: "incomplete" };
  const [first] = slots;
  if (machine === "forge") {
    const upgrade = nextQuality(first.quality);
    return upgrade && slots.every((slot) => same(slot, first)) && spare(collection, slots, first) >= 0 ? { kind: "upgrade", key: first.key, from: first.quality, quality: upgrade } : { kind: "mismatch" };
  }
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

// Records kept beside the collection, session-only like it: when each figure was first acquired at
// each quality (the museum), the newest golden and galaxy pulls (the feed), counters for quests,
// and the sixteen showcase slots, whose figures stand on the numbered statue spots round the plaza.
export type PullSource = "box" | "forge";
export type FeedEntry = { key: string; quality: FigurineQuality; at: string; source: PullSource };
export type FigurineStats = { opened: number; recycled: number; tradedUp: number };
export type FigurineRecords = { acquired: Readonly<Record<string, string>>; feed: readonly FeedEntry[]; stats: FigurineStats; showcase: readonly (MachineItem | null)[] };
export const SHOWCASE_SLOTS = 16, FEED_LENGTH = 10;
export const RECORDS_KEY = "suomiwow-figurine-records-v1";
const EMPTY_RECORDS: FigurineRecords = Object.freeze({ acquired: {}, feed: [], stats: { opened: 0, recycled: 0, tradedUp: 0 }, showcase: Array(SHOWCASE_SLOTS).fill(null) });
let cachedRecords: FigurineRecords | null = null;
const FIGURE_KEY = /^[a-z0-9-]+:[a-z0-9-]+$/;
const isItem = (value: unknown): value is MachineItem => !!value && typeof value === "object" && FIGURE_KEY.test((value as MachineItem).key) && isQuality((value as MachineItem).quality);
const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
export const acquiredId = (key: string, quality: FigurineQuality) => `${key}|${quality}`;

export function parseRecords(raw: string | null): FigurineRecords {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return EMPTY_RECORDS;
    const acquired = Object.fromEntries(Object.entries(value.acquired ?? {}).filter(([id, at]) => { const [key, quality] = id.split("|"); return FIGURE_KEY.test(key) && isQuality(quality) && isDate(at); })) as Record<string, string>;
    const feed = (Array.isArray(value.feed) ? value.feed : []).filter((entry: FeedEntry) => isItem(entry) && isDate(entry.at) && (entry.source === "box" || entry.source === "forge")).slice(0, FEED_LENGTH);
    const stats = Object.fromEntries((["opened", "recycled", "tradedUp"] as const).map((name) => [name, count(value.stats?.[name]) ? value.stats[name] : 0])) as FigurineStats;
    const showcase = Array.from({ length: SHOWCASE_SLOTS }, (_, index) => isItem(value.showcase?.[index]) ? { key: value.showcase[index].key, quality: value.showcase[index].quality } : null);
    return { acquired, feed, stats, showcase };
  } catch { return EMPTY_RECORDS; }
}
export function readRecords(store: Store | null = sessionStore()): FigurineRecords {
  if (store === sessionStore() && cachedRecords) return cachedRecords;
  let raw: string | null = null;
  try { raw = store?.getItem(RECORDS_KEY) ?? null; } catch { /* storage blocked: start empty */ }
  const records = parseRecords(raw);
  if (store === sessionStore()) cachedRecords = records;
  return records;
}
function writeRecords(next: FigurineRecords, store: Store | null) {
  try { store?.setItem(RECORDS_KEY, JSON.stringify(next)); } catch { /* keep it in memory */ }
  if (store === sessionStore()) {
    cachedRecords = next;
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}
export const emptyRecords = () => EMPTY_RECORDS;

// A figure arrived (from a box, or from the forge one quality up): stamps its first acquisition at
// that quality, counts an opened box, and puts golden and galaxy pulls at the top of the feed.
export function recordPull({ key, quality }: MachineItem, source: PullSource, now = new Date(), store: Store | null = sessionStore()) {
  const records = readRecords(store), at = now.toISOString(), id = acquiredId(key, quality);
  writeRecords({
    ...records,
    acquired: records.acquired[id] ? records.acquired : { ...records.acquired, [id]: at },
    feed: quality === "standard" ? records.feed : [{ key, quality, at, source }, ...records.feed].slice(0, FEED_LENGTH),
    stats: { ...records.stats, opened: records.stats.opened + (source === "box" ? 1 : 0), tradedUp: records.stats.tradedUp + (source === "forge" ? 1 : 0) },
  }, store);
}
export function recordRecycle(store: Store | null = sessionStore()) {
  const records = readRecords(store);
  writeRecords({ ...records, stats: { ...records.stats, recycled: records.stats.recycled + 1 } }, store);
}
// Puts a figure on a showcase slot (or clears it with null). A figure stands on one spot only:
// placing it again moves it.
export function setShowcaseSlot(slot: number, item: MachineItem | null, store: Store | null = sessionStore()) {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= SHOWCASE_SLOTS || (item && !isItem(item))) return false;
  const showcase = readRecords(store).showcase.map((entry) => entry && item && entry.key === item.key ? null : entry);
  showcase[slot] = item && { key: item.key, quality: item.quality };
  writeRecords({ ...readRecords(store), showcase }, store);
  return true;
}
// What a showcase slot shows now: its figure at the stored quality, or at the finest still owned,
// or nothing once no copy is left.
export function showcaseFigure(entry: MachineItem | null, collection: FigurineCollection): MachineItem | null {
  if (!entry) return null;
  if (collection[entry.key]?.[entry.quality]) return entry;
  const best = bestQuality(collection[entry.key]);
  return best ? { key: entry.key, quality: best } : null;
}
