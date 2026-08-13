import { normalizeCharacterIdentityPart } from "./character-identity-link";
import { normalizeRealmSlug } from "./realm";

export type MythicPlusCharacterIdentity = {
  name: string;
  realm: string;
  region: string;
  classID: number;
};

export function mythicPlusCharacterIdentitiesMatch(
  left: MythicPlusCharacterIdentity,
  right: MythicPlusCharacterIdentity,
): boolean {
  return (
    normalizeCharacterIdentityPart(left.name) === normalizeCharacterIdentityPart(right.name) &&
    normalizeRealmSlug(left.realm) === normalizeRealmSlug(right.realm) &&
    normalizeCharacterIdentityPart(left.region) === normalizeCharacterIdentityPart(right.region) &&
    left.classID === right.classID
  );
}

export type ResolvedMythicPlusSeasonRow = {
  season: string;
  row: any | null;
};

function getSeasonSlug(row: any): string | null {
  const candidates = [row?.season, row?.season_slug, row?.seasonSlug, row?.slug];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function resolveMythicPlusSeasonRows(
  requestedSeasons: readonly string[],
  responseRows: readonly any[],
): ResolvedMythicPlusSeasonRow[] {
  const rowsBySeason = new Map<string, any>();
  for (const row of responseRows) {
    const season = getSeasonSlug(row);
    if (season) rowsBySeason.set(season, row);
  }

  if (responseRows.length === requestedSeasons.length) {
    responseRows.forEach((row, index) => {
      if (!getSeasonSlug(row)) rowsBySeason.set(requestedSeasons[index], row);
    });
  }

  return requestedSeasons.map((season) => ({ season, row: rowsBySeason.get(season) ?? null }));
}

export function getMissingMythicPlusSeasons(
  expectedSeasons: readonly string[],
  storedSeasons: readonly string[],
): string[] {
  const stored = new Set(storedSeasons);
  return expectedSeasons.filter((season) => !stored.has(season));
}

export type MythicPlusSeasonWindow = {
  slug: string;
  starts?: Record<string, string> | null;
  ends?: Record<string, string> | null;
};

function getSeasonBoundary(boundaries: Record<string, string> | null | undefined, region: string): number | null {
  const value = boundaries?.[region.toLowerCase()];
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function hasMythicPlusSeasonStarted(
  season: MythicPlusSeasonWindow,
  region: string,
  now: Date = new Date(),
): boolean {
  const startsAt = getSeasonBoundary(season.starts, region);
  return startsAt === null || startsAt <= now.getTime();
}

export function resolveCurrentMythicPlusSeasonSlug(
  seasons: readonly MythicPlusSeasonWindow[],
  region: string,
  now: Date = new Date(),
): string | null {
  const nowMs = now.getTime();
  const current = seasons.find((season) => {
    const startsAt = getSeasonBoundary(season.starts, region);
    const endsAt = getSeasonBoundary(season.ends, region);
    return (startsAt === null || startsAt <= nowMs) && (endsAt === null || endsAt > nowMs);
  });
  return current?.slug ?? null;
}
