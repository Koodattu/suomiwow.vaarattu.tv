// Session-long collection of opened figures: figure key -> times opened. Client side only;
// it lasts for the browser tab's session and is never sent anywhere.
export type FigurineCollection = Readonly<Record<string, number>>;

export const COLLECTION_KEY = "suomiwow-figurine-collection-v1";
const CHANGE_EVENT = "figurine-collection-change";
const EMPTY: FigurineCollection = Object.freeze({});
let cached: FigurineCollection | null = null;

type Store = Pick<Storage, "getItem" | "setItem">;
const sessionStore = (): Store | null => { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } };

export function parseCollection(raw: string | null): FigurineCollection {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
    const entries = Object.entries(value).filter(([key, count]) => /^[a-z0-9-]+:[a-z0-9-]+$/.test(key) && Number.isSafeInteger(count) && (count as number) > 0);
    return Object.freeze(Object.fromEntries(entries) as Record<string, number>);
  } catch { return EMPTY; }
}

export function readCollection(store: Store | null = sessionStore()): FigurineCollection {
  if (store === sessionStore() && cached) return cached;
  let raw: string | null = null;
  try { raw = store?.getItem(COLLECTION_KEY) ?? null; } catch { /* storage blocked: the session starts empty */ }
  const collection = parseCollection(raw);
  if (store === sessionStore()) cached = collection;
  return collection;
}

// Records one opening and returns how many times this figure has now been opened.
export function addToCollection(key: string, store: Store | null = sessionStore()): number {
  const current = readCollection(store);
  const next = Object.freeze({ ...current, [key]: (current[key] ?? 0) + 1 });
  try { store?.setItem(COLLECTION_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: keep it in memory */ }
  if (store === sessionStore()) {
    cached = next;
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return next[key];
}

export function subscribeCollection(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
export const emptyCollection = () => EMPTY;
