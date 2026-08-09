import { TRACKED_RAIDS } from "../../../config/guilds";
import { CLASSES } from "../../../config/classes";
import CharacterRaidParticipation from "../../../models/CharacterRaidParticipation";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import { funMythicParticipationFilter } from "../fun-game.eligibility";
import type { ImmaculateRosterRound } from "../fun-game.types";
import { canonicalCharacterKey, findDistinctAssignments, FunRoundUnavailableError, newRoundBase, sample, shuffle } from "../fun-game.utils";

type CellAggregate = {
  _id: {
    zoneId: number;
    guildId: unknown;
    guildName: string;
    guildRealm: string;
    classID: number;
  };
  characters: Array<{ wclCanonicalCharacterId: number; classID: number; name: string; realm: string }>;
};

type GuildCandidate = {
  id: string;
  name: string;
  realm: string;
  answersByClass: Map<number, Array<{ key: string; name: string; realm: string }>>;
};

export async function generateImmaculateRosterRound(): Promise<ImmaculateRosterRound> {
  const [cells, raids] = await Promise.all([
    CharacterRaidParticipation.aggregate<CellAggregate>([
      {
        $match: {
          ...funMythicParticipationFilter(),
          wclCanonicalCharacterId: { $type: "number" },
        },
      },
      {
        $group: {
          _id: {
            zoneId: "$zoneId",
            guildId: "$reportGuildId",
            guildName: "$reportGuildName",
            guildRealm: "$reportGuildRealm",
            classID: "$classID",
          },
          characters: {
            $addToSet: {
              wclCanonicalCharacterId: "$wclCanonicalCharacterId",
              classID: "$classID",
              name: "$characterName",
              realm: "$characterRealm",
            },
          },
        },
      },
      { $match: { "characters.1": { $exists: true } } },
    ]).option({ maxTimeMS: 15_000 }),
    Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion iconUrl -_id").lean(),
  ]);

  const raidMeta = new Map(raids.map((raid) => [raid.id, raid]));
  const guildsByRaid = new Map<number, Map<string, GuildCandidate>>();

  for (const cell of cells) {
    const guildId = String(cell._id.guildId);
    let guildMap = guildsByRaid.get(cell._id.zoneId);
    if (!guildMap) {
      guildMap = new Map();
      guildsByRaid.set(cell._id.zoneId, guildMap);
    }
    let guild = guildMap.get(guildId);
    if (!guild) {
      guild = {
        id: guildId,
        name: cell._id.guildName,
        realm: cell._id.guildRealm,
        answersByClass: new Map(),
      };
      guildMap.set(guildId, guild);
    }
    guild.answersByClass.set(
      cell._id.classID,
      cell.characters.map((character) => ({
        key: canonicalCharacterKey(character.wclCanonicalCharacterId, character.classID),
        name: character.name,
        realm: character.realm,
      })),
    );
  }

  const eligibleRaidIds = shuffle(Array.from(guildsByRaid.keys()).filter((raidId) => raidMeta.has(raidId)));
  for (const raidId of eligibleRaidIds) {
    const guilds = Array.from(guildsByRaid.get(raidId)?.values() ?? []).filter((guild) => guild.answersByClass.size >= 3);
    if (guilds.length < 3) continue;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const selectedGuilds = sample(guilds, 3);
      const commonClasses = Array.from(selectedGuilds[0].answersByClass.keys()).filter((classID) =>
        selectedGuilds.every((guild) => guild.answersByClass.has(classID)),
      );
      if (commonClasses.length < 3) continue;

      const classIDs = sample(commonClasses, 3);
      const exampleAssignments = findDistinctAssignments(
        selectedGuilds.flatMap((guild) =>
          classIDs.map((classID) => ({ id: `${guild.id}:${classID}`, candidates: guild.answersByClass.get(classID) ?? [] })),
        ),
      );
      if (!exampleAssignments) continue;

      const raid = raidMeta.get(raidId)!;
      const guildDocuments = await Guild.find({ _id: { $in: selectedGuilds.map((guild) => guild.id) } })
        .select("_id faction crest")
        .lean();
      const guildDocumentById = new Map(guildDocuments.map((guild) => [String(guild._id), guild]));
      const validCharacterKeysByCell: Record<string, string[]> = {};
      const exampleAnswerByCell: Record<string, { key: string; name: string; realm: string }> = {};
      for (const guild of selectedGuilds) {
        for (const classID of classIDs) {
          const cellKey = `${guild.id}:${classID}`;
          validCharacterKeysByCell[cellKey] = (guild.answersByClass.get(classID) ?? []).map((answer) => answer.key);
          const example = exampleAssignments[cellKey];
          if (example) exampleAnswerByCell[cellKey] = example;
        }
      }

      return {
        ...newRoundBase(),
        game: "immaculate-roster",
        raid: { id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null },
        rows: selectedGuilds.map((guild) => ({
          id: guild.id,
          guild: {
            id: guild.id,
            name: guild.name,
            realm: guild.realm,
            faction: guildDocumentById.get(guild.id)?.faction ?? null,
            crest: guildDocumentById.get(guild.id)?.crest ?? null,
          },
        })),
        columns: classIDs.map((classID) => {
          const classInfo = CLASSES.find((candidate) => candidate.id === classID);
          if (!classInfo) throw new FunRoundUnavailableError(`Unknown class ${classID}`);
          return { classID, name: classInfo.name, iconUrl: `${classInfo.iconUrl}.jpg` };
        }),
        solution: { validCharacterKeysByCell, exampleAnswerByCell },
      };
    }
  }

  throw new FunRoundUnavailableError("No raid can form a complete immaculate roster grid");
}
