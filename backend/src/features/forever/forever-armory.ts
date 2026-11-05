// Public Armory contracts verified against Blizzard's Forever site on 2026-11-05.
// This is the website's data contract, not a documented Battle.net API.
export const ARMORY_ORIGIN = "https://worldofwarcraft.blizzard.com";
export type ForeverRegion = "eu" | "us";
export interface ForeverIdentity { region: ForeverRegion; slug: string }
export interface ForeverProfile extends ForeverIdentity {
  name: string; level: number; className: string; race: string; faction: string;
  avatarUrl?: string | null;
  ruleset: string; sourceUpdatedAt: Date; guild: (ForeverIdentity & { name: string }) | null;
}
export interface ForeverMember extends ForeverIdentity { name: string; level: number; className: string }
export class ArmoryError extends Error {
  constructor(public code: string, public status = 0, public retryAfterMs = 0) { super(code); }
}

export function normalizeSlug(value: unknown): string {
  if (typeof value !== "string") throw new ArmoryError("invalid_url", 400);
  const slug = value.normalize("NFC").toLowerCase();
  if (slug.length < 2 || slug.length > 100 || !/^[\p{L}\p{M}\d]+(?:[-'][\p{L}\p{M}\d]+)*$/u.test(slug)) {
    throw new ArmoryError("invalid_url", 400);
  }
  return slug;
}

export function parseArmoryUrl(value: unknown): ForeverIdentity {
  if (typeof value !== "string" || value.length > 500) throw new ArmoryError("invalid_url", 400);
  try {
    const url = new URL(value.trim());
    const match = url.pathname.match(/^\/[a-z]{2}-[a-z]{2}\/forever\/(eu|us)\/armory\/character\/([^/]+)\/?$/i);
    if (url.origin !== ARMORY_ORIGIN || url.username || url.password || !match) throw new Error();
    return { region: match[1].toLowerCase() as ForeverRegion, slug: normalizeSlug(decodeURIComponent(match[2])) };
  } catch { throw new ArmoryError("invalid_url", 400); }
}

export function armoryUrl(identity: ForeverIdentity, kind: "character" | "guild" = "character"): string {
  return `${ARMORY_ORIGIN}/en-gb/forever/${identity.region}/armory/${kind}/${encodeURIComponent(identity.slug)}`;
}

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ArmoryError("invalid_data");
  return value as Record<string, any>;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 150) throw new ArmoryError("invalid_data");
  return value;
}
function level(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 60) throw new ArmoryError("invalid_data");
  return value as number;
}

export function parseAvatarUrl(value: unknown, region: ForeverRegion): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://render.worldofwarcraft.com" || url.username || url.password || url.search || url.hash ||
        !new RegExp(`^/forever-${region}/character/\\d+/\\d+-avatar(?:-sd)?\\.jpg$`).test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export function parseCharacterHtml(html: string, expected: ForeverIdentity): ForeverProfile {
  // Parse JSON only; never evaluate code from the upstream page.
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]).find((text) => /^\s*var characterProfileInitialState\s*=/.test(text));
  if (!script) throw new ArmoryError("invalid_data");
  let state: Record<string, any>;
  try { state = record(JSON.parse(script.slice(script.indexOf("{")).replace(/;\s*$/, ""))); }
  catch { throw new ArmoryError("invalid_data"); }
  const character = record(state.character);
  // Blizzard percent-encodes accented names in this path, but not in its slug.
  let characterPath: string;
  try { characterPath = decodeURIComponent(label(character.url)); }
  catch { throw new ArmoryError("identity_mismatch"); }
  if (character.region !== expected.region || normalizeSlug(character.slug) !== expected.slug ||
      characterPath !== `/forever/${expected.region}/armory/character/${expected.slug}/`) throw new ArmoryError("identity_mismatch");
  const timestamp = character.lastUpdatedTimestamp?.epoch;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now() + 300_000 || character.isOutdated === true) {
    throw new ArmoryError("stale_data");
  }
  let guild: ForeverProfile["guild"] = null;
  if (character.guild != null) {
    const source = record(character.guild);
    if (source.region !== expected.region) throw new ArmoryError("identity_mismatch");
    guild = { region: expected.region, slug: normalizeSlug(source.slug), name: label(source.name) };
  }
  return { ...expected, name: `${label(character.name)} ${label(character.surname)}`, level: level(character.level),
    avatarUrl: parseAvatarUrl(character.avatar?.url, expected.region),
    className: label(character.class?.name), race: label(character.race?.name), faction: label(character.faction?.name),
    ruleset: label(character.ruleset?.name), sourceUpdatedAt: new Date(timestamp), guild };
}

export function parseRosterResponse(value: unknown, expected: ForeverIdentity): ForeverMember[] {
  const response = record(value);
  if (response.errors?.length) {
    // The website can return HTTP 200 with a failed guild resolver during launch.
    const internalError = Array.isArray(response.errors) && response.errors.some((error: any) => error?.extensions?.code === "INTERNAL_SERVER_ERROR");
    throw new ArmoryError(internalError ? "upstream_error" : "invalid_data", internalError ? 500 : 0);
  }
  const data = record(response.data);
  // Without the Forever Referer Blizzard returns retail data, even for this same query.
  if (data.GameConstants?.maxLevel !== 60 || data.Guild?._id !== `${expected.region}-none-${expected.slug}` ||
      !Array.isArray(data.Guild.roster) || data.Guild.roster.length > 2000) throw new ArmoryError("identity_mismatch");
  const members = new Map<string, ForeverMember>();
  for (const entry of data.Guild.roster) {
    const character = record(entry.character);
    if (character.region !== expected.region || character.realm != null) throw new ArmoryError("identity_mismatch");
    const name = label(character.name), surname = label(character.surname);
    const slug = normalizeSlug(`${name}-${surname}`);
    if (character._id !== `${expected.region}-${slug}`) throw new ArmoryError("identity_mismatch");
    members.set(slug, { region: expected.region, slug, name: `${name} ${surname}`, level: level(character.level), className: label(character.class?.name) });
  }
  return [...members.values()];
}

export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(ms, 7 * 86400_000)) : 0;
}

async function request(url: string, init: RequestInit = {}): Promise<string> {
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ArmoryError(response.status === 404 ? "not_found" : "upstream_error", response.status, retryAfter(response.headers.get("retry-after")));
    }
    // Bound even chunked responses before decoding; guild rosters can be larger than profiles.
    const reader = response.body?.getReader();
    if (!reader) throw new ArmoryError("invalid_data");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4_000_000) { await reader.cancel(); throw new ArmoryError("invalid_data"); }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (error instanceof ArmoryError) throw error;
    throw new ArmoryError("unavailable");
  }
}

export async function fetchForeverCharacter(identity: ForeverIdentity): Promise<ForeverProfile> {
  return parseCharacterHtml(await request(armoryUrl(identity)), identity);
}
export async function fetchForeverRoster(identity: ForeverIdentity): Promise<ForeverMember[]> {
  const text = await request(`${ARMORY_ORIGIN}/en-gb/graphql`, {
    method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "en-gb", Referer: armoryUrl(identity, "guild") },
    body: JSON.stringify({ operationName: "GetGuildRoster", variables: { guild: { nameSlug: identity.slug, region: identity.region }, showMessageOfTheDay: false, showRoles: false },
      extensions: { persistedQuery: { version: 1, sha256Hash: "5f32b85faa248d321a08645d470fb38b82be64b9abd8b5b5fd2816620546794b" } } }),
  });
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new ArmoryError("invalid_data"); }
  return parseRosterResponse(data, identity);
}
