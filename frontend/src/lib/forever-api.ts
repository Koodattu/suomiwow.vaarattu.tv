export interface ForeverCharacter {
  _id: string; region: string; slug: string; status?: string; source?: string;
  name?: string; level?: number; className?: string; race?: string; faction?: string; ruleset?: string; avatarUrl?: string | null;
  guild?: { name: string; slug: string; region: string } | null;
  lastFetchedAt?: string; lastAttemptAt?: string; nextFetchAt?: string; sourceUpdatedAt?: string; errorCode?: string;
  history?: { level: number; observedAt: string; sourceUpdatedAt: string }[]; armoryUrl?: string;
}
export interface ForeverGuild {
  _id: string; name: string; region: string; slug: string; status: string;
  lastFetchedAt?: string; nextFetchAt?: string; errorCode?: string;
  roster?: { region: string; slug: string; name: string; level: number; className: string }[];
}
export interface ForeverWorker { lastTickAt?: string; lastSuccessAt?: string; nextRequestAt?: string; errorCode?: string }
export interface ForeverBoard {
  characters: ForeverCharacter[]; total: number; pending: number; rulesets: string[];
  page: number; pageSize: number; worker: ForeverWorker | null; enabled: boolean;
}
export interface ForeverAdminData {
  characters: ForeverCharacter[]; guilds: ForeverGuild[]; worker: ForeverWorker | null;
  totalCharacters: number; totalGuilds: number; enabled: boolean;
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
