import mongoose from "mongoose";
import { TRACKED_RAIDS } from "../../../config/guilds";
import CharacterRaidParticipation from "../../../models/CharacterRaidParticipation";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import { createAccentInsensitiveSearchRegex, normalizeSearchText, scoreSearchCandidate } from "../../../utils/search";
import { funMythicGuildFilter, funMythicParticipationFilter } from "../fun-game.eligibility";
import type { FunGuild, GuildGuessrRound } from "../fun-game.types";
import { canonicalCharacterKey, FunRoundUnavailableError, newRoundBase, shuffle } from "../fun-game.utils";

type GuildCandidate = {
  _id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  raidIds: number[];
  characters: Array<{ wclCanonicalCharacterId: number; classID: number }>;
};

type ConnectedParticipation = {
  reportGuildId: mongoose.Types.ObjectId;
  reportGuildName: string;
  reportGuildRealm: string;
  zoneId: number;
  wclCanonicalCharacterId: number;
  classID: number;
};

export async function generateGuildGuessrRound(): Promise<GuildGuessrRound> {
  const candidates = await CharacterRaidParticipation.aggregate<GuildCandidate>([
    {
      $match: {
        ...funMythicParticipationFilter(),
        wclCanonicalCharacterId: { $type: "number" },
      },
    },
    {
      $group: {
        _id: "$reportGuildId",
        name: { $first: "$reportGuildName" },
        realm: { $first: "$reportGuildRealm" },
        firstSeenAt: { $min: "$firstSeenAt" },
        lastSeenAt: { $max: "$lastSeenAt" },
        raidIds: { $addToSet: "$zoneId" },
        characters: {
          $addToSet: {
            wclCanonicalCharacterId: "$wclCanonicalCharacterId",
            classID: "$classID",
          },
        },
      },
    },
    {
      $match: {
        "raidIds.1": { $exists: true },
        "characters.7": { $exists: true },
      },
    },
  ]).option({ maxTimeMS: 15_000 });

  if (candidates.length === 0) throw new FunRoundUnavailableError("No guild has enough connected history");
  const raids = await Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl -_id").lean();
  const raidById = new Map(raids.map((raid) => [raid.id, raid]));

  for (const candidate of shuffle(candidates).slice(0, 40)) {
    const targetGuildId = String(candidate._id);
    const targetKeys = new Set(candidate.characters.map((character) => canonicalCharacterKey(character.wclCanonicalCharacterId, character.classID)));
    const canonicalIds = Array.from(new Set(candidate.characters.map((character) => character.wclCanonicalCharacterId)));
    const connectedRows = await CharacterRaidParticipation.find({
      ...funMythicParticipationFilter(),
      reportGuildId: { $ne: candidate._id },
      wclCanonicalCharacterId: { $in: canonicalIds },
    })
      .select("reportGuildId reportGuildName reportGuildRealm zoneId wclCanonicalCharacterId classID -_id")
      .lean<ConnectedParticipation[]>();

    const neighbors = new Map<string, { name: string; realm: string; characterKeys: Set<string>; raidIds: Set<number> }>();
    for (const row of connectedRows) {
      const characterKey = canonicalCharacterKey(row.wclCanonicalCharacterId, row.classID);
      if (!targetKeys.has(characterKey)) continue;
      const guildId = String(row.reportGuildId);
      let neighbor = neighbors.get(guildId);
      if (!neighbor) {
        neighbor = { name: row.reportGuildName, realm: row.reportGuildRealm, characterKeys: new Set(), raidIds: new Set() };
        neighbors.set(guildId, neighbor);
      }
      neighbor.characterKeys.add(characterKey);
      neighbor.raidIds.add(row.zoneId);
    }

    const topNeighbors = Array.from(neighbors.entries())
      .filter(([, neighbor]) => neighbor.characterKeys.size > 0)
      .sort((left, right) => right[1].characterKeys.size - left[1].characterKeys.size || left[1].name.localeCompare(right[1].name))
      .slice(0, 4);
    if (topNeighbors.length < 4) continue;

    const [targetGuild, neighborGuildDocuments] = await Promise.all([
      Guild.findOne({ _id: candidate._id, ...funMythicGuildFilter() }).select("name realm faction crest raidSchedule -_id").lean(),
      Guild.find({ _id: { $in: topNeighbors.map(([id]) => id) } }).select("_id faction crest").lean(),
    ]);
    if (!targetGuild) continue;
    const guildDocumentById = new Map(neighborGuildDocuments.map((guild) => [String(guild._id), guild]));

    return {
      ...newRoundBase(),
      game: "guild-guessr",
      neighbors: topNeighbors.map(([id, neighbor]) => ({
        guild: {
          id,
          name: neighbor.name,
          realm: neighbor.realm,
          faction: guildDocumentById.get(id)?.faction ?? null,
          crest: guildDocumentById.get(id)?.crest ?? null,
        },
        sharedCharacters: neighbor.characterKeys.size,
        sharedRaids: Array.from(neighbor.raidIds).map((raidId) => raidById.get(raidId)?.name).filter((name): name is string => Boolean(name)),
      })),
      solution: {
        target: {
          id: targetGuildId,
          name: targetGuild.name,
          realm: targetGuild.realm,
          faction: targetGuild.faction ?? null,
          crest: targetGuild.crest ?? null,
          raidSchedule: targetGuild.raidSchedule ?? null,
          trackedRaids: candidate.raidIds
            .map((raidId) => raidById.get(raidId))
            .filter((raid): raid is NonNullable<typeof raid> => Boolean(raid))
            .map((raid) => ({ id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null })),
          firstSeenAt: candidate.firstSeenAt.toISOString(),
          lastSeenAt: candidate.lastSeenAt.toISOString(),
        },
      },
    };
  }

  throw new FunRoundUnavailableError("No guild has four usable character connections");
}

export async function searchGuildGuessrCandidates(query: string, limit: number): Promise<FunGuild[]> {
  const trimmedQuery = query.trim().slice(0, 60);
  const normalizedQuery = normalizeSearchText(trimmedQuery);
  if (normalizedQuery.length < 2) return [];
  const match = createAccentInsensitiveSearchRegex(trimmedQuery);
  const guilds = await Guild.find({
    ...funMythicGuildFilter(),
    $or: [{ name: match }, { realm: match }],
  })
    .limit(Math.max(limit * 5, 50))
    .select("_id name realm faction crest")
    .lean();

  return guilds
    .map((guild) => ({
      guild: {
        id: String(guild._id),
        name: guild.name,
        realm: guild.realm,
        faction: guild.faction ?? null,
        crest: guild.crest ?? null,
      },
      score: Math.max(
        scoreSearchCandidate(normalizedQuery, normalizeSearchText(guild.name)),
        scoreSearchCandidate(normalizedQuery, normalizeSearchText(`${guild.name} ${guild.realm}`)),
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.guild.name.localeCompare(right.guild.name) || left.guild.realm.localeCompare(right.guild.realm))
    .slice(0, limit)
    .map((candidate) => candidate.guild);
}
