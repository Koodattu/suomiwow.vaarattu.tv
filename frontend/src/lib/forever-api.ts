export interface ForeverCharacter {
  _id: string; region: string; slug: string; status?: string; source?: string;
  name?: string; level?: number; className?: string; race?: string; faction?: string; ruleset?: string; avatarUrl?: string | null;
  twitchChannel?: string; twitchIsLive?: boolean; twitchCheckedAt?: string;
  guild?: { name: string; slug: string; region: string } | null;
  refreshRequestedAt?: string; lastFetchedAt?: string; lastAttemptAt?: string; nextFetchAt?: string; sourceUpdatedAt?: string; errorCode?: string; failures?: number;
  history?: { level: number; observedAt: string; sourceUpdatedAt?: string }[]; armoryUrl?: string;
}
export function foreverRace(race?: string): string {
  return race === "Windshaper Skyborne" || race === "High Order Skyborne" ? "Skyborne" : race || "—";
}
export function foreverCharacterPath(character: Pick<ForeverCharacter, "slug" | "region" | "_id">): string {
  return `/forever/characters/${encodeURIComponent(character.region === "eu" ? character.slug : character._id)}`;
}
export function foreverRouteIdentity(segment: string): string {
  // Next's dynamic route segment may retain percent escapes; API callers use plain identities.
  try { return decodeURIComponent(segment); } catch { return segment; }
}
export function foreverHistory(history: ForeverCharacter["history"]) {
  return (history || []).map((entry) => ({ level: entry.level, timestamp: Date.parse(entry.observedAt) }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isInteger(point.level) && point.level >= 1 && point.level <= 60)
    .sort((a, b) => a.timestamp - b.timestamp);
}
export function isForeverStreamLive(character: Pick<ForeverCharacter, "twitchIsLive" | "twitchCheckedAt">, now: number): boolean {
  const checkedAt = Date.parse(character.twitchCheckedAt || "");
  return character.twitchIsLive === true && checkedAt <= now && now - checkedAt < 5 * 60_000;
}
export function formatForeverDate(value: string, compact = false): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("fi-FI", {
    timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.day}.${parts.month}.${compact ? "" : parts.year} ${parts.hour}.${parts.minute}`;
}
export function foreverUpdateAge(value: string | null | undefined, now: number): { unit: "now" | "minutes" | "hours" | "days"; count: number } | null {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return { unit: "now", count: 0 };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  if (minutes < 1440) return { unit: "hours", count: Math.floor(minutes / 60) };
  return { unit: "days", count: Math.floor(minutes / 1440) };
}
export interface ForeverGuild {
  _id: string; name: string; region: string; slug: string; status: string;
  lastFetchedAt?: string; lastAttemptAt?: string; nextFetchAt?: string; errorCode?: string; failures?: number; rosterCount?: number;
  roster?: { region: string; slug: string; name: string; level: number; className: string; trackingStatus?: string }[];
}
export interface ForeverWorker { lastTickAt?: string; lastSuccessAt?: string; nextRequestAt?: string; errorCode?: string }
export interface ForeverStatistics {
  factions: { name: string | null; count: number }[];
  rulesets: { name: string | null; count: number }[];
  averageLevel: number | null;
  atMaxLevel: number;
}
export interface ForeverBoard {
  characters: ForeverCharacter[]; total: number; pending: number;
  statistics: ForeverStatistics;
  filterOptions: Record<"race" | "className" | "faction" | "ruleset" | "guild", string[]>;
  page: number; pageSize: number; worker: ForeverWorker | null; enabled: boolean;
}
export interface ForeverAdminData {
  characters: ForeverCharacter[]; guilds: ForeverGuild[]; worker: ForeverWorker | null;
  totalCharacters: number; totalGuilds: number; enabled: boolean;
  characterCounts: Record<string, number>; guildCounts: Record<string, number>;
}
export class ForeverApiError extends Error { constructor(public code: string) { super(code); } }
export async function foreverApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/${path}`, {
    method, credentials: "include", headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ForeverApiError(data.code || "unavailable");
  }
  return response.json();
}
