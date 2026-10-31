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
// the sixteen showcase slots (whose figures stand about the world), the day's crate, spin and
// catch, the quests' periods, and rewards earned but not yet used.
export type PullSource = "box" | "forge" | "wheel" | "pond";
export type FeedEntry = { key: string; quality: FigurineQuality; at: string; source: PullSource };
export const STAT_NAMES = ["opened", "recycled", "tradedUp", "spins", "fish", "galaxy", "crates"] as const;
export type FigurineStats = Record<(typeof STAT_NAMES)[number], number>;
// Rewards: boxes banked for when boxes are limited, and a boost the next box opened rolls at least.
export type Boons = { boxes: number; boost: FigurineQuality | null };
// The day each daily thing was last done (local "YYYY-MM-DD"), and the crate's streak (1-7).
export type Daily = { crate: string | null; streak: number; spin: string | null; catch: string | null };
export type QuestPeriod = "daily" | "weekly" | "monthly";
// Each period's quests count from the stats as they were when the period began.
export type QuestState = Record<QuestPeriod, { key: string; base: FigurineStats; claimed: string[] }>;
export type FigurineRecords = {
  acquired: Readonly<Record<string, string>>; feed: readonly FeedEntry[]; stats: FigurineStats; showcase: readonly (MachineItem | null)[];
  boons: Boons; daily: Daily; quests: QuestState | null; catches: { best: number };
};
export const SHOWCASE_SLOTS = 16, FEED_LENGTH = 10;
export const RECORDS_KEY = "suomiwow-figurine-records-v1";
const ZERO_STATS = Object.freeze(Object.fromEntries(STAT_NAMES.map((name) => [name, 0]))) as FigurineStats;
const EMPTY_RECORDS: FigurineRecords = Object.freeze({
  acquired: {}, feed: [], stats: ZERO_STATS, showcase: Array(SHOWCASE_SLOTS).fill(null),
  boons: { boxes: 0, boost: null }, daily: { crate: null, streak: 0, spin: null, catch: null }, quests: null, catches: { best: 0 },
});
let cachedRecords: FigurineRecords | null = null;
const FIGURE_KEY = /^[a-z0-9-]+:[a-z0-9-]+$/;
const isItem = (value: unknown): value is MachineItem => !!value && typeof value === "object" && FIGURE_KEY.test((value as MachineItem).key) && isQuality((value as MachineItem).quality);
const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const whole = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
const statsOf = (value: unknown) => Object.fromEntries(STAT_NAMES.map((name) => [name, whole((value as Record<string, unknown> | undefined)?.[name])])) as FigurineStats;
export const acquiredId = (key: string, quality: FigurineQuality) => `${key}|${quality}`;

export function parseRecords(raw: string | null): FigurineRecords {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return EMPTY_RECORDS;
    const acquired = Object.fromEntries(Object.entries(value.acquired ?? {}).filter(([id, at]) => { const [key, quality] = id.split("|"); return FIGURE_KEY.test(key) && isQuality(quality) && isDate(at); })) as Record<string, string>;
    const sources: PullSource[] = ["box", "forge", "wheel", "pond"];
    const feed = (Array.isArray(value.feed) ? value.feed : []).filter((entry: FeedEntry) => isItem(entry) && isDate(entry.at) && sources.includes(entry.source)).slice(0, FEED_LENGTH);
    const showcase = Array.from({ length: SHOWCASE_SLOTS }, (_, index) => isItem(value.showcase?.[index]) ? { key: value.showcase[index].key, quality: value.showcase[index].quality } : null);
    const boons = { boxes: whole(value.boons?.boxes), boost: isQuality(value.boons?.boost) && value.boons.boost !== "standard" ? value.boons.boost : null };
    const daily = { crate: isDay(value.daily?.crate) ? value.daily.crate : null, streak: Math.min(7, whole(value.daily?.streak)), spin: isDay(value.daily?.spin) ? value.daily.spin : null, catch: isDay(value.daily?.catch) ? value.daily.catch : null };
    const period = (entry: { key?: unknown; base?: unknown; claimed?: unknown } | undefined) => entry && typeof entry.key === "string"
      ? { key: entry.key, base: statsOf(entry.base), claimed: Array.isArray(entry.claimed) ? entry.claimed.filter((id): id is string => typeof id === "string") : [] } : null;
    const periods = value.quests && { daily: period(value.quests.daily), weekly: period(value.quests.weekly), monthly: period(value.quests.monthly) };
    const quests = periods && periods.daily && periods.weekly && periods.monthly ? periods as QuestState : null;
    return { acquired, feed, stats: statsOf(value.stats), showcase, boons, daily, quests, catches: { best: Number.isFinite(value.catches?.best) ? Math.max(0, value.catches.best) : 0 } };
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
const updateRecords = (change: (records: FigurineRecords) => FigurineRecords, store: Store | null) => { const next = change(readRecords(store)); writeRecords(next, store); return next; };
const bump = (stats: FigurineStats, changes: Partial<FigurineStats>) => Object.fromEntries(STAT_NAMES.map((name) => [name, stats[name] + (changes[name] ?? 0)])) as FigurineStats;
export const emptyRecords = () => EMPTY_RECORDS;

// A figure arrived (from a box, the forge, the wheel or the pond): stamps its first acquisition at
// that quality, counts it, and puts golden and galaxy pulls at the top of the feed.
export function recordPull({ key, quality }: MachineItem, source: PullSource, now = new Date(), store: Store | null = sessionStore()) {
  const at = now.toISOString(), id = acquiredId(key, quality);
  updateRecords((records) => ({
    ...records,
    acquired: records.acquired[id] ? records.acquired : { ...records.acquired, [id]: at },
    feed: quality === "standard" ? records.feed : [{ key, quality, at, source }, ...records.feed].slice(0, FEED_LENGTH),
    stats: bump(records.stats, { opened: source === "box" ? 1 : 0, tradedUp: source === "forge" ? 1 : 0, galaxy: quality === "galaxy" ? 1 : 0 }),
  }), store);
}
export function recordRecycle(store: Store | null = sessionStore()) {
  updateRecords((records) => ({ ...records, stats: bump(records.stats, { recycled: 1 }) }), store);
}
// Puts a figure on a showcase slot (or clears it with null). A figure stands on one spot only:
// placing it again moves it.
export function setShowcaseSlot(slot: number, item: MachineItem | null, store: Store | null = sessionStore()) {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= SHOWCASE_SLOTS || (item && !isItem(item))) return false;
  updateRecords((records) => {
    const showcase = records.showcase.map((entry) => entry && item && entry.key === item.key ? null : entry);
    showcase[slot] = item && { key: item.key, quality: item.quality };
    return { ...records, showcase };
  }, store);
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

// Days, weeks and months in the player's own time zone.
const pad2 = (value: number) => String(value).padStart(2, "0");
export const dayKey = (now: Date) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
const yesterday = (now: Date) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
// ISO week: the week of the Thursday in it.
export function weekKey(now: Date) {
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())), weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const week = Math.ceil(((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${pad2(week)}`;
}
export const monthKey = (now: Date) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
const higher = (a: FigurineQuality | null, b: FigurineQuality | null) => !a ? b : !b ? a : qualityRank(a) >= qualityRank(b) ? a : b;
const grant = (boons: Boons, reward: Reward): Boons => ({ boxes: boons.boxes + (reward.boxes ?? 0), boost: higher(boons.boost, reward.boost ?? null) });
export type Reward = { boxes?: number; boost?: FigurineQuality; figure?: boolean };
// Banks a reward's boxes and boost. The daily actions mark themselves done at once but grant
// this way when their animation has played, so nothing gives away what is coming.
export function grantReward(reward: Reward, store: Store | null = sessionStore()) {
  updateRecords((records) => ({ ...records, boons: grant(records.boons, reward) }), store);
}

// The daily crate: once a day, a box; days in a row build a streak to seven, whose crate also
// guarantees a golden roll, and then it starts over. A missed day starts it over too.
export function crateState({ daily }: FigurineRecords, now = new Date()) {
  const today = dayKey(now), continues = daily.crate === yesterday(now) && daily.streak < 7;
  return { ready: daily.crate !== today, day: daily.crate === today ? daily.streak : continues ? daily.streak + 1 : 1 };
}
export const crateReward = (day: number): Reward => day >= 7 ? { boxes: 1, boost: "golden" } : { boxes: 1 };
export function openCrate(now = new Date(), store: Store | null = sessionStore()): { day: number; reward: Reward } | null {
  const state = crateState(readRecords(store), now);
  if (!state.ready) return null;
  const reward = crateReward(state.day);
  updateRecords((records) => ({ ...records, daily: { ...records.daily, crate: dayKey(now), streak: state.day }, stats: bump(records.stats, { crates: 1 }) }), store);
  return { day: state.day, reward };
}

// The lucky wheel: eight segments, one spin a day. The pointer is at the top; segment 0 starts there
// and they run clockwise. Weights favour banked boxes; galaxy is rare.
export const WHEEL = [
  { prize: { boxes: 1 }, weight: 24 }, { prize: { boost: "golden" }, weight: 9 }, { prize: { boxes: 2 }, weight: 12 }, { prize: { figure: true }, weight: 10 },
  { prize: { boxes: 1 }, weight: 24 }, { prize: { boost: "golden" }, weight: 9 }, { prize: { boost: "galaxy" }, weight: 2 }, { prize: { boxes: 3 }, weight: 10 },
] as const satisfies readonly { prize: Reward; weight: number }[];
export function wheelSegment(random: number) {
  if (!(random >= 0 && random < 1)) throw new Error("Invalid roll");
  let left = random * WHEEL.reduce((total, { weight }) => total + weight, 0);
  return WHEEL.findIndex(({ weight }) => (left -= weight) < 0);
}
export const canSpin = ({ daily }: FigurineRecords, now = new Date()) => daily.spin !== dayKey(now);
// Spins (once a day). The reward is the caller's to grant (and a figure prize to draw and add).
export function spinWheel(random: number, now = new Date(), store: Store | null = sessionStore()): { segment: number; reward: Reward } | null {
  if (!canSpin(readRecords(store), now)) return null;
  const segment = wheelSegment(random), reward: Reward = WHEEL[segment].prize;
  updateRecords((records) => ({ ...records, daily: { ...records.daily, spin: dayKey(now) }, stats: bump(records.stats, { spins: 1 }) }), store);
  return { segment, reward };
}

// The fishing pond: the day's first cast lands a box and a figure; after that, fish, for fun.
// Classic Azeroth catches, smallest to largest (pounds).
export const FISH = [
  { name: "Raw Brilliant Smallfish", weight: [0.2, 0.6] }, { name: "Raw Longjaw Mud Snapper", weight: [0.5, 1.4] }, { name: "Raw Bristle Whisker Catfish", weight: [1, 2.6] },
  { name: "Oily Blackmouth", weight: [1.2, 3] }, { name: "Firefin Snapper", weight: [1.5, 3.4] }, { name: "Raw Rainbow Fin Albacore", weight: [2, 4.5] },
  { name: "Raw Spotted Yellowtail", weight: [3, 6] }, { name: "Stonescale Eel", weight: [4, 8] }, { name: "Deviate Fish", weight: [1, 5] }, { name: "Raw Whitescale Salmon", weight: [6, 12] },
] as const;
export type Catch = { kind: "daily"; reward: Reward } | { kind: "fish"; fish: number; weight: number; best: boolean };
export const dailyCatchReady = ({ daily }: FigurineRecords, now = new Date()) => daily.catch !== dayKey(now);
export function castLine(random: () => number, now = new Date(), store: Store | null = sessionStore()): Catch {
  const records = readRecords(store);
  if (dailyCatchReady(records, now)) {
    const reward: Reward = { boxes: 1, figure: true };
    updateRecords((current) => ({ ...current, daily: { ...current.daily, catch: dayKey(now) }, stats: bump(current.stats, { fish: 1 }) }), store);
    return { kind: "daily", reward };
  }
  // Bigger fish are rarer: the square of a roll leans the pick toward the small end.
  const fish = Math.min(FISH.length - 1, Math.floor(random() ** 2 * FISH.length)), [low, high] = FISH[fish].weight;
  const weight = Math.round((low + (high - low) * random()) * 10) / 10, best = weight > records.catches.best;
  updateRecords((current) => ({ ...current, catches: { best: Math.max(current.catches.best, weight) }, stats: bump(current.stats, { fish: 1 }) }), store);
  return { kind: "fish", fish, weight, best };
}

// Using a boost: the next box opened rolls at least this quality.
export const boostedQuality = (rolled: FigurineQuality, boost: FigurineQuality | null) => higher(rolled, boost) ?? rolled;
export function spendBoost(store: Store | null = sessionStore()) {
  updateRecords((records) => ({ ...records, boons: { ...records.boons, boost: null } }), store);
}

// Quests: daily, weekly and monthly, each counted from the period's start. A finished quest is
// claimed for banked boxes. `stat` counts up; `complete` is checked against the collection.
export type Quest = { id: string; period: QuestPeriod; goal: number; reward: number; stat?: keyof FigurineStats; complete?: true };
export const QUESTS: readonly Quest[] = [
  { id: "open3", period: "daily", stat: "opened", goal: 3, reward: 1 },
  { id: "recycle1", period: "daily", stat: "recycled", goal: 1, reward: 1 },
  { id: "spin1", period: "daily", stat: "spins", goal: 1, reward: 1 },
  { id: "fish3", period: "daily", stat: "fish", goal: 3, reward: 1 },
  { id: "open20", period: "weekly", stat: "opened", goal: 20, reward: 3 },
  { id: "tradeUp3", period: "weekly", stat: "tradedUp", goal: 3, reward: 2 },
  { id: "crates5", period: "weekly", stat: "crates", goal: 5, reward: 2 },
  { id: "open60", period: "monthly", stat: "opened", goal: 60, reward: 8 },
  { id: "galaxy", period: "monthly", stat: "galaxy", goal: 1, reward: 5 },
  { id: "series", period: "monthly", complete: true, goal: 1, reward: 5 },
];
const periodKeys = (now: Date): Record<QuestPeriod, string> => ({ daily: dayKey(now), weekly: weekKey(now), monthly: monthKey(now) });
// The quest state for now: a period that has turned over starts again from the current stats.
export function questState(records: FigurineRecords, now = new Date()): QuestState {
  const keys = periodKeys(now);
  return Object.fromEntries((Object.keys(keys) as QuestPeriod[]).map((period) => {
    const current = records.quests?.[period];
    return [period, current && current.key === keys[period] ? current : { key: keys[period], base: records.stats, claimed: [] }];
  })) as QuestState;
}
export function questBoard(records: FigurineRecords, completeSeries: boolean, now = new Date()) {
  const state = questState(records, now);
  return QUESTS.map((quest) => {
    const progress = quest.complete ? (completeSeries ? 1 : 0) : records.stats[quest.stat!] - state[quest.period].base[quest.stat!];
    return { ...quest, progress: Math.min(progress, quest.goal), done: progress >= quest.goal, claimed: state[quest.period].claimed.includes(quest.id) };
  });
}
export function claimQuest(id: string, completeSeries: boolean, now = new Date(), store: Store | null = sessionStore()): number {
  const records = readRecords(store), quest = questBoard(records, completeSeries, now).find((entry) => entry.id === id);
  if (!quest || !quest.done || quest.claimed) return 0;
  const state = questState(records, now);
  updateRecords((current) => ({
    ...current, boons: grant(current.boons, { boxes: quest.reward }),
    quests: { ...state, [quest.period]: { ...state[quest.period], claimed: [...state[quest.period].claimed, id] } },
  }), store);
  return quest.reward;
}
// Fixes each period's start the first time the world sees it, so progress counts from then.
export function startQuestPeriods(now = new Date(), store: Store | null = sessionStore()) {
  const records = readRecords(store), state = questState(records, now);
  if (JSON.stringify(state) !== JSON.stringify(records.quests)) writeRecords({ ...records, quests: state }, store);
}
