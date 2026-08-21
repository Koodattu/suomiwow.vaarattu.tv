import { Types } from "mongoose";
import { TRACKED_RAIDS } from "../../config/guilds";
import Character from "../../models/Character";
import CharacterMedia from "../../models/CharacterMedia";
import CharacterRaidParticipation from "../../models/CharacterRaidParticipation";
import CharacterRenderAsset from "../../models/CharacterRenderAsset";
import characterRenderStorageService from "../../services/character-render-storage.service";
import { normalizeSearchText } from "../../utils/search";
import type { BossMechanicCharactersResponse, BossMechanicGuildsResponse, FunGameRound, FunGameSearchResponse, FunGameSearchSlug, FunGameSlug, HigherOrWipeMode } from "./fun-game.types";
import { generateGuildGuessrRound, searchGuildGuessrCandidates } from "./generators/guild-guessr";
import { generateImmaculateRosterRound } from "./generators/immaculate-roster";
import { generateLockItInRound } from "./generators/lock-it-in";
import { generateRaidConnectionsRound } from "./generators/raid-connections";
import { generateRaiderResumeRound, searchRaiderResumeCandidates } from "./generators/raider-resume";
import { generateWipeprintRound } from "./generators/wipeprint";
import { generateSuomidleRound, searchSuomidleCandidates } from "./generators/suomidle";
import { generateHigherOrWipeRound } from "./generators/higher-or-wipe";
import { generateClosestWithoutGoingOverRound } from "./generators/closest-without-going-over";
import { MIN_FUN_CHARACTER_MYTHIC_REPORTS } from "./fun-game.eligibility";
import { FunRoundUnavailableError } from "./fun-game.utils";

const FUN_SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const BOSS_MECHANIC_PLAYER_COUNT = 20;
const BOSS_MECHANIC_CANDIDATE_SAMPLE_SIZE = BOSS_MECHANIC_PLAYER_COUNT * 10;
const BOSS_MECHANIC_RAID_ID = 53;
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

type BossMechanicGuildRow = {
  guildId: Types.ObjectId;
  name: string;
  realm: string;
};

async function loadBossMechanicCharacterRows(
  limit: number,
  options: { includeCharacterIds?: Types.ObjectId[]; excludeCharacterIds?: Types.ObjectId[] } = {},
): Promise<BossMechanicCharacterRow[]> {
  if (limit <= 0 || options.includeCharacterIds?.length === 0) return [];
  const characterId = options.includeCharacterIds
    ? { $in: options.includeCharacterIds }
    : options.excludeCharacterIds?.length
      ? { $nin: options.excludeCharacterIds }
      : undefined;

  return CharacterMedia.aggregate<BossMechanicCharacterRow>([
    { $match: { status: "available", renderAssetId: { $ne: null }, ...(characterId ? { characterId } : {}) } },
    { $sample: { size: BOSS_MECHANIC_CANDIDATE_SAMPLE_SIZE } },
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
    {
      $lookup: {
        from: CharacterRaidParticipation.collection.name,
        let: { characterId: "$characterId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$characterId", "$$characterId"] } } },
          { $match: { zoneId: { $in: TRACKED_RAIDS } } },
          { $group: { _id: "$zoneId", mythicReportCount: { $sum: "$mythicReportCount" } } },
          { $match: { mythicReportCount: { $gte: MIN_FUN_CHARACTER_MYTHIC_REPORTS } } },
          { $limit: 1 },
        ],
        as: "eligibleMythicParticipation",
      },
    },
    { $match: { "eligibleMythicParticipation.0": { $exists: true } } },
    {
      $lookup: {
        from: Character.collection.name,
        localField: "characterId",
        foreignField: "_id",
        as: "character",
      },
    },
    { $unwind: "$character" },
    { $limit: limit },
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
}

export async function loadBossMechanicGuilds(): Promise<BossMechanicGuildsResponse> {
  const rows = await CharacterRaidParticipation.aggregate<BossMechanicGuildRow>([
    { $match: { zoneId: BOSS_MECHANIC_RAID_ID } },
    {
      $group: {
        _id: "$reportGuildId",
        name: { $first: "$reportGuildName" },
        realm: { $first: "$reportGuildRealm" },
      },
    },
    {
      $project: {
        _id: 0,
        guildId: "$_id",
        name: 1,
        realm: 1,
        sortName: { $toLower: "$name" },
        sortRealm: { $toLower: "$realm" },
      },
    },
    { $sort: { sortName: 1, sortRealm: 1, guildId: 1 } },
    { $project: { sortName: 0, sortRealm: 0 } },
  ]).option({ maxTimeMS: 5_000 });

  return {
    guilds: rows.map((row) => ({ id: row.guildId.toString(), name: row.name, realm: row.realm })),
  };
}

export async function loadBossMechanicCharacters(guildId?: string): Promise<BossMechanicCharactersResponse> {
  let rows: BossMechanicCharacterRow[] = [];
  if (guildId) {
    const guildCharacterIds = await CharacterRaidParticipation.distinct("characterId", {
      zoneId: BOSS_MECHANIC_RAID_ID,
      reportGuildId: new Types.ObjectId(guildId),
      characterId: { $ne: null },
    }) as Types.ObjectId[];
    rows = await loadBossMechanicCharacterRows(BOSS_MECHANIC_PLAYER_COUNT, { includeCharacterIds: guildCharacterIds });
  }

  if (rows.length < BOSS_MECHANIC_PLAYER_COUNT) {
    const fillRows = await loadBossMechanicCharacterRows(BOSS_MECHANIC_PLAYER_COUNT - rows.length, {
      excludeCharacterIds: rows.map((row) => row.characterId),
    });
    rows = [...rows, ...fillRows];
  }

  if (rows.length < BOSS_MECHANIC_PLAYER_COUNT) {
    throw new FunRoundUnavailableError("Twenty eligible stored character renders are required for this boss mechanic");
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
