export interface ForeverCharacter {
  _id: string; region: string; slug: string; status?: string; source?: string;
  rank?: number; name?: string; level?: number; className?: string; race?: string; faction?: string; ruleset?: string; avatarUrl?: string | null;
  lastLevelAt?: string; estimatedLevel60At?: string;
  twitchChannel?: string; twitchIsLive?: boolean; twitchCheckedAt?: string;
  guild?: { name: string; slug: string; region: string } | null;
  refreshRequestedAt?: string; lastFetchedAt?: string; lastAttemptAt?: string; nextFetchAt?: string; sourceUpdatedAt?: string; errorCode?: string; failures?: number;
  history?: { level: number; observedAt: string; sourceUpdatedAt?: string }[]; armoryUrl?: string;
  profile?: ForeverProfile | null;
}
export interface ForeverGearItem {
  slot: string; id: number; name: string; quality: string; icon: string | null; inventoryType: string | null;
  subclass: string | null; set: string | null; requiredLevel: number | null; lines: string[]; itemLevel: number | null;
}
export type ForeverRecordKey = "epicsEquipped" | "epicsAcquired" | "mounts" | "exalted" | "battlegroundsPlayed" | "battlegroundsWon"
  | "duelsWon" | "duelsLost" | "totalKills" | "deathsFromPlayers" | "dungeonsEntered" | "raidsEntered";
export interface ForeverBossKill { boss: string; instance: string; raid: boolean; count: number; lastKillAt: string; firstKillAt: string | null }
export interface ForeverProfile {
  armoryFetchedAt: string | null; statsFetchedAt: string | null;
  gear: ForeverGearItem[]; itemLevel: { average: number; unknown: number } | null;
  specs: { name: string; points: number; icon: string | null; talents: { id: number; name: string; rank: number; icon: string | null }[] }[];
  professions: { name: string; icon: string | null; skill: number; max: number; primary: boolean }[];
  honorableKills: number | null; pvpRank: number | null; renderUrl: string | null;
  records: Partial<Record<ForeverRecordKey, number>> | null;
  achievements: { id: number; name: string; completedAt: string }[]; achievementCount: number;
  bosses: ForeverBossKill[];
}
export interface ForeverKillEvent {
  boss: string; instance: string; raid: boolean; at: string;
  guild: { id: string | null; name: string; slug: string } | null;
  participants: { id: string; slug: string; name: string; className: string | null }[];
}
export interface ForeverRaidProgress {
  instance: string; bosses: number;
  guilds: { guild: { id: string | null; name: string; slug: string }; killed: number; reachedAt: string; lastKillAt: string;
    bosses: { boss: string; firstKillAt: string; participants: number }[] }[];
}
export interface ForeverRaids { raids: ForeverRaidProgress[]; recent: ForeverKillEvent[]; groupKills: number; trackedCharacters: number }
export const foreverRecordBoards = ["itemLevel", "epicsEquipped", "achievements", "mounts", "exalted", "battlegroundsWon", "honorableKills", "duelsWon", "totalKills"] as const;
export type ForeverRecordBoard = typeof foreverRecordBoards[number];
export interface ForeverRecordRow {
  id: string; region: string; slug: string; name: string; className: string | null; race: string | null; faction: string | null;
  ruleset: string | null; level: number | null; avatarUrl: string | null; guild: { name: string; slug: string } | null;
  values: Partial<Record<ForeverRecordBoard, number>>; itemLevelUnknown: number | null; rank: number;
}
export interface ForeverRecordsPage {
  board: ForeverRecordBoard; total: number; ranked: number; page: number; pageSize: number; rows: ForeverRecordRow[];
  filterOptions: { className: string[]; ruleset: string[]; faction: string[]; guild: { slug: string; name: string }[] };
}
export function foreverRace(race?: string): string {
  return race === "Windshaper Skyborne" || race === "High Order Skyborne" ? "Skyborne" : race || "—";
}
export function foreverCharacterPath(character: Pick<ForeverCharacter, "slug" | "region" | "_id"> | string): string {
  const identity = typeof character === "string" ? character : character.region === "eu" ? character.slug : character._id;
  return `/forever/characters/${encodeURIComponent(identity)}`;
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
export function formatForeverDate(value: string, layout: boolean | "stacked" = false): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("fi-FI", {
    timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
  if (layout === "stacked") return `${parts.day}.${parts.month}.\n${parts.hour}:${parts.minute}`;
  return `${parts.day}.${parts.month}.${layout ? "" : parts.year} ${parts.hour}.${parts.minute}`;
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
  _id: string; name: string; region: string; slug: string; status: string; hidden?: boolean;
  autoReview?: { action: "approved" | "rejected"; reviewedAt: string; structured: number; decision: number };
  lastFetchedAt?: string; lastAttemptAt?: string; nextFetchAt?: string; errorCode?: string; failures?: number; rosterCount?: number;
  roster?: { region: string; slug: string; name: string; level: number; className: string; trackingStatus?: string }[];
  languageAssessment?: {
    structured: number | null;
    decision: { percent: number; yes: boolean; confidence: "low" | "medium" | "high" } | null;
    assessedAt: string; nameCount: number; source: "roster" | "profiles";
  };
}
export interface ForeverWorker { lastTickAt?: string; lastSuccessAt?: string; nextRequestAt?: string; errorCode?: string }
export interface ForeverStatistics {
  factions: { name: string | null; count: number }[];
  rulesets: { name: string | null; count: number }[];
  combinations: { faction: string | null; ruleset: string | null; count: number }[];
  averageLevel: number | null;
  atMaxLevel: number;
}
export interface ForeverBoard {
  generatedAt?: string;
  characters: ForeverCharacter[]; total: number; totalRanked: number; pending: number;
  statistics: ForeverStatistics;
  filterOptions: Record<"race" | "className" | "faction" | "ruleset" | "guild", string[]>;
  page: number; pageSize: number; worker: ForeverWorker | null; enabled: boolean;
}
export interface ForeverAnalytics {
  timeline?: ForeverAnalyticsTimeline;
  generatedAt: string; total: number; historyCharacters: number; averageLevel: number | null; medianLevel: number | null;
  atMaxLevel: number; active24h: number; coverageStart: string | null;
  new24h: number; levelsGained24h: number; statistics: ForeverStatistics;
  levels: { level: number; count: number }[];
  classes: { name: string | null; count: number }[];
  races: { name: string | null; count: number; factions: { alliance: number; horde: number; unknown: number } }[];
  combinations: { race: string | null; className: string | null; count: number; factions: { alliance: number; horde: number; unknown: number } }[];
  activity: { at: string; active: number; observed: number; partial: boolean }[];
}
export interface ForeverAnalyticsTimeline {
  startedAt: string;
  facets: { race: string | null; className: string | null; faction: string | null; ruleset: string | null }[];
  days: { date: string; at: string;
    buckets: [facet: number, level: number, count: number, active: number, added: number, gains: number, observed: number][] }[];
}
export interface ForeverAdminData {
  characters: ForeverCharacter[]; guilds: ForeverGuild[]; worker: ForeverWorker | null;
  totalCharacters: number; totalGuilds: number; enabled: boolean;
  languagePending: number;
  characterCounts: Record<string, number>; guildCounts: Record<string, number>;
}
export class ForeverApiError extends Error { constructor(public code: string) { super(code); } }
export async function foreverApi<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/${path}`, {
    method, signal, credentials: "include", headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ForeverApiError(data.code || "unavailable");
  }
  return response.json();
}
