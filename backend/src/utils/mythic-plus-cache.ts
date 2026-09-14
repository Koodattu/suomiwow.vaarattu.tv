export function parseNumberQuery(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseStringQuery(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = String(value).trim();
  return parsed.length > 0 ? parsed : undefined;
}

export function isMythicPlusLeaderboardQueryCacheable(query: Record<string, unknown>): boolean {
  return !parseStringQuery(query.search) && !parseStringQuery(query.characterName) && !parseStringQuery(query.guildName) && !parseStringQuery(query.characterRealm) && !parseStringQuery(query.guildRealm) && parseStringQuery(query.nocache)?.toLowerCase() !== "true";
}

export function getMythicPlusLeaderboardCacheKey(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const season = parseStringQuery(query.season);
  const bucket = parseStringQuery(query.bucket)?.toLowerCase() ?? "all";
  const dungeonId = parseNumberQuery(query.dungeonId);
  const dungeonSort = parseStringQuery(query.dungeonSort)?.toLowerCase() ?? "score";
  const classId = parseNumberQuery(query.classId);
  const specName = parseStringQuery(query.specName)?.toLowerCase();
  const role = parseStringQuery(query.role)?.toLowerCase();
  const page = parseNumberQuery(query.page) ?? 1;
  const limit = parseNumberQuery(query.limit) ?? 100;

  if (season) params.set("season", season);
  params.set("bucket", bucket);
  if (dungeonId !== undefined) params.set("dungeonId", String(dungeonId));
  params.set("dungeonSort", dungeonSort);
  if (classId !== undefined) params.set("classId", String(classId));
  if (specName) params.set("specName", specName);
  if (role) params.set("role", role);
  params.set("page", String(page));
  params.set("limit", String(limit));

  return `mythic-plus:leaderboard:v3:${params.toString()}`;
}

