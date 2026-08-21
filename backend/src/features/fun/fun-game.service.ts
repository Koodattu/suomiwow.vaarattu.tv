import type { Types } from "mongoose";
import Character from "../../models/Character";
import CharacterMedia from "../../models/CharacterMedia";
import CharacterRenderAsset from "../../models/CharacterRenderAsset";
import characterRenderStorageService from "../../services/character-render-storage.service";
import { normalizeSearchText } from "../../utils/search";
import type { BossMechanicCharactersResponse, FunGameRound, FunGameSearchResponse, FunGameSearchSlug, FunGameSlug, HigherOrWipeMode } from "./fun-game.types";
import { generateGuildGuessrRound, searchGuildGuessrCandidates } from "./generators/guild-guessr";
import { generateImmaculateRosterRound } from "./generators/immaculate-roster";
import { generateLockItInRound } from "./generators/lock-it-in";
import { generateRaidConnectionsRound } from "./generators/raid-connections";
import { generateRaiderResumeRound, searchRaiderResumeCandidates } from "./generators/raider-resume";
import { generateWipeprintRound } from "./generators/wipeprint";
import { generateSuomidleRound, searchSuomidleCandidates } from "./generators/suomidle";
import { generateHigherOrWipeRound } from "./generators/higher-or-wipe";
import { generateClosestWithoutGoingOverRound } from "./generators/closest-without-going-over";
import { FunRoundUnavailableError } from "./fun-game.utils";

const FUN_SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const BOSS_MECHANIC_PLAYER_COUNT = 20;
const funSearchCache = new Map<string, { expiresAt: number; response: FunGameSearchResponse }>();
const funSearchPromises = new Map<string, Promise<FunGameSearchResponse>>();

type BossMechanicCharacterRow = {
  characterId: Types.ObjectId;
  characterName: string;
  realmSlug: string;
  region: string;
  classID: number;
  renderAssetId: Types.ObjectId;
  renderFit: { top: number; ground: number; centerX: number };
};

export async function loadBossMechanicCharacters(): Promise<BossMechanicCharactersResponse> {
  const rows = await CharacterMedia.aggregate<BossMechanicCharacterRow>([
    { $match: { status: "available", renderAssetId: { $ne: null } } },
    {
      $lookup: {
        from: CharacterRenderAsset.collection.name,
        localField: "renderAssetId",
        foreignField: "_id",
        as: "renderAsset",
      },
    },
    { $unwind: "$renderAsset" },
    { $match: { "renderAsset.status": "active" } },
    { $sample: { size: BOSS_MECHANIC_PLAYER_COUNT } },
    {
      $lookup: {
        from: Character.collection.name,
        localField: "characterId",
        foreignField: "_id",
        as: "character",
      },
    },
    { $unwind: "$character" },
    {
      $project: {
        _id: 0,
        characterId: 1,
        characterName: 1,
        realmSlug: 1,
        region: 1,
        classID: "$character.classID",
        renderAssetId: "$renderAsset._id",
        renderFit: "$renderAsset.stanceFit",
      },
    },
  ]).option({ maxTimeMS: 10_000 });

  if (rows.length < BOSS_MECHANIC_PLAYER_COUNT) {
    throw new FunRoundUnavailableError("Twenty stored character renders are required for this boss mechanic");
  }

  return {
    characters: rows.map((row) => ({
      id: row.characterId.toString(),
      name: row.characterName,
      realm: row.realmSlug,
      region: row.region,
      classID: row.classID,
      renderUrl: characterRenderStorageService.getPublicUrl(row.renderAssetId),
      renderFit: row.renderFit,
    })),
  };
}

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
