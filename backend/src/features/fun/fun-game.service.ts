import { normalizeSearchText } from "../../utils/search";
import type { FunGameRound, FunGameSearchResponse, FunGameSearchSlug, FunGameSlug, HigherOrWipeMode } from "./fun-game.types";
import { generateGuildGuessrRound, searchGuildGuessrCandidates } from "./generators/guild-guessr";
import { generateImmaculateRosterRound } from "./generators/immaculate-roster";
import { generateLockItInRound } from "./generators/lock-it-in";
import { generateRaidConnectionsRound } from "./generators/raid-connections";
import { generateRaiderResumeRound, searchRaiderResumeCandidates } from "./generators/raider-resume";
import { generateWipeprintRound } from "./generators/wipeprint";
import { generateSuomidleRound, searchSuomidleCandidates } from "./generators/suomidle";
import { generateHigherOrWipeRound } from "./generators/higher-or-wipe";
import { generateClosestWithoutGoingOverRound } from "./generators/closest-without-going-over";

const FUN_SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const funSearchCache = new Map<string, { expiresAt: number; response: FunGameSearchResponse }>();
const funSearchPromises = new Map<string, Promise<FunGameSearchResponse>>();

export async function generateFunGameRound(
  game: FunGameSlug,
  options: { higherOrWipeMode?: HigherOrWipeMode } = {},
): Promise<FunGameRound> {
  switch (game) {
    case "immaculate-roster":
      return generateImmaculateRosterRound();
    case "guild-guessr":
      return generateGuildGuessrRound();
    case "wipeprint":
      return generateWipeprintRound();
    case "raider-resume":
      return generateRaiderResumeRound();
    case "raid-connections":
      return generateRaidConnectionsRound();
    case "lock-it-in":
      return generateLockItInRound();
    case "suomidle":
      return generateSuomidleRound();
    case "higher-or-wipe":
      return generateHigherOrWipeRound(options.higherOrWipeMode);
    case "closest-without-going-over":
      return generateClosestWithoutGoingOverRound();
  }
}

export async function searchFunGameCandidates(game: FunGameSearchSlug, query: string, requestedLimit = 10): Promise<FunGameSearchResponse> {
  const trimmedQuery = query.trim().slice(0, 60);
  const normalizedQuery = normalizeSearchText(trimmedQuery);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 10, 1), 20);
  if (normalizedQuery.length < 2) return emptyFunSearchResponse(game);

  const cacheKey = `${game}:${normalizedQuery}:${limit}`;
  const cached = funSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  const pending = funSearchPromises.get(cacheKey);
  if (pending) return pending;

  const searchPromise = (async (): Promise<FunGameSearchResponse> => {
    switch (game) {
      case "guild-guessr":
        return { game, candidates: await searchGuildGuessrCandidates(trimmedQuery, limit) };
      case "raider-resume":
        return { game, candidates: await searchRaiderResumeCandidates(trimmedQuery, limit) };
      case "suomidle":
        return { game, candidates: await searchSuomidleCandidates(trimmedQuery, limit) };
    }
  })()
    .then((response) => {
      if (funSearchCache.size >= 300) {
        const oldestKey = funSearchCache.keys().next().value;
        if (oldestKey) funSearchCache.delete(oldestKey);
      }
      funSearchCache.set(cacheKey, { expiresAt: Date.now() + FUN_SEARCH_CACHE_TTL_MS, response });
      return response;
    })
    .finally(() => funSearchPromises.delete(cacheKey));
  funSearchPromises.set(cacheKey, searchPromise);
  return searchPromise;
}

function emptyFunSearchResponse(game: FunGameSearchSlug): FunGameSearchResponse {
  switch (game) {
    case "guild-guessr":
      return { game, candidates: [] };
    case "raider-resume":
      return { game, candidates: [] };
    case "suomidle":
      return { game, candidates: [] };
  }
}
