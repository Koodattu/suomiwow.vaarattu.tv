import mongoose from "mongoose";
import { TRACKED_RAIDS } from "../../../config/guilds";
import CharacterRaidParticipation from "../../../models/CharacterRaidParticipation";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import { funMythicParticipationFilter } from "../fun-game.eligibility";
import type { FunCharacter, RaidConnectionsRound } from "../fun-game.types";
import { canonicalCharacterKey, FunRoundUnavailableError, newRoundBase, sample, shuffle } from "../fun-game.utils";

type ParticipationCharacter = {
  characterId?: mongoose.Types.ObjectId | null;
  wclCanonicalCharacterId: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
};

type GuildRosterAggregate = {
  _id: {
    zoneId: number;
    guildId: mongoose.Types.ObjectId;
    guildName: string;
    guildRealm: string;
  };
  characters: ParticipationCharacter[];
};

export async function generateRaidConnectionsRound(): Promise<RaidConnectionsRound> {
  const [rosters, raids] = await Promise.all([
    CharacterRaidParticipation.aggregate<GuildRosterAggregate>([
      {
        $match: {
          ...funMythicParticipationFilter(),
          wclCanonicalCharacterId: { $type: "number" },
        },
      },
      {
        $project: {
          zoneId: 1,
          reportGuildId: 1,
          reportGuildName: 1,
          reportGuildRealm: 1,
          characterId: 1,
          wclCanonicalCharacterId: 1,
          name: "$characterName",
          realm: "$characterRealm",
          region: "$characterRegion",
          classID: 1,
        },
      },
      {
        $group: {
          _id: {
            zoneId: "$zoneId",
            guildId: "$reportGuildId",
            guildName: "$reportGuildName",
            guildRealm: "$reportGuildRealm",
          },
          characters: { $push: "$$ROOT" },
          characterCount: { $sum: 1 },
        },
      },
      { $match: { characterCount: { $gte: 6 } } },
    ]).option({ maxTimeMS: 15_000 }),
    Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl -_id").lean(),
  ]);

  const raidMeta = new Map(raids.map((raid) => [raid.id, raid]));
  const rostersByRaid = new Map<number, GuildRosterAggregate[]>();
  for (const roster of rosters) {
    const entries = rostersByRaid.get(roster._id.zoneId) ?? [];
    entries.push(roster);
    rostersByRaid.set(roster._id.zoneId, entries);
  }

  for (const raidId of shuffle(Array.from(rostersByRaid.keys()).filter((id) => raidMeta.has(id)))) {
    const raidRosters = rostersByRaid.get(raidId) ?? [];
    if (raidRosters.length < 4) continue;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const selectedRosters = sample(raidRosters, 4);
      const occurrenceCounts = new Map<string, number>();
      for (const roster of selectedRosters) {
        const rosterKeys = new Set(roster.characters.map((character) => canonicalCharacterKey(character.wclCanonicalCharacterId, character.classID)));
        for (const key of rosterKeys) occurrenceCounts.set(key, (occurrenceCounts.get(key) ?? 0) + 1);
      }

      const selectedGroups = selectedRosters.map((roster) => ({
        roster,
        characters: roster.characters.filter(
          (character) => occurrenceCounts.get(canonicalCharacterKey(character.wclCanonicalCharacterId, character.classID)) === 1,
        ),
      }));
      if (selectedGroups.some((group) => group.characters.length < 4)) continue;

      const chosenGroups = selectedGroups.map((group) => ({ ...group, characters: sample(group.characters, 4) }));
      const guildDocuments = await Guild.find({ _id: { $in: chosenGroups.map((group) => group.roster._id.guildId) } })
        .select("_id faction crest")
        .lean();
      const guildDocumentById = new Map(guildDocuments.map((guild) => [String(guild._id), guild]));

      const groups = chosenGroups.map(({ roster, characters }) => {
        const guildId = String(roster._id.guildId);
        const guildDocument = guildDocumentById.get(guildId);
        const guild = {
          id: guildId,
          name: roster._id.guildName,
          realm: roster._id.guildRealm,
          faction: guildDocument?.faction ?? null,
          crest: guildDocument?.crest ?? null,
        };
        const members: FunCharacter[] = characters.map((character) => ({
          key: canonicalCharacterKey(character.wclCanonicalCharacterId, character.classID),
          wclCanonicalCharacterId: character.wclCanonicalCharacterId,
          characterId: character.characterId ? String(character.characterId) : null,
          name: character.name,
          realm: character.realm,
          region: character.region,
          classID: character.classID,
          avatarUrl: null,
        }));
        return { id: guildId, guild, members };
      });
      const raid = raidMeta.get(raidId);
      if (!raid) throw new FunRoundUnavailableError(`Raid ${raidId} is unavailable`);

      return {
        ...newRoundBase(),
        game: "raid-connections",
        raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
        tiles: shuffle(groups.flatMap((group) => group.members)),
        solution: {
          groups: groups.map((group) => ({
            id: group.id,
            guild: group.guild,
            memberKeys: group.members.map((member) => member.key),
          })),
        },
      };
    }
  }

  throw new FunRoundUnavailableError("No raid can form four unambiguous roster groups");
}
