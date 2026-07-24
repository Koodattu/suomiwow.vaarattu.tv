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
