import { MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY } from "../../../config/character-eligibility";
import { TRACKED_RAIDS } from "../../../config/guilds";
import CharacterMedia from "../../../models/CharacterMedia";
import CharacterRaidParticipation from "../../../models/CharacterRaidParticipation";
import Guild from "../../../models/Guild";
import Raid from "../../../models/Raid";
import characterService from "../../../services/character.service";
import { funMythicParticipationFilter } from "../fun-game.eligibility";
import type { RaiderResumeCandidate, RaiderResumeRound } from "../fun-game.types";
import { canonicalCharacterKey, FunRoundUnavailableError, newRoundBase, randomItem } from "../fun-game.utils";

type ResumeParticipation = {
  zoneId: number;
  guildName: string;
  guildRealm: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type ResumeAggregate = {
  _id: { wclCanonicalCharacterId: number; classID: number };
  characterId?: unknown;
  name: string;
  realm: string;
  region: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reportCount: number;
  raidIds: number[];
  guildIds: unknown[];
  participations: ResumeParticipation[];
};

function toCandidate(row: ResumeAggregate): RaiderResumeCandidate {
  return {
    key: canonicalCharacterKey(row._id.wclCanonicalCharacterId, row._id.classID),
    name: row.name,
    realm: row.realm,
    region: row.region,
    classID: row._id.classID,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    raidCount: row.raidIds.length,
    guildCount: row.guildIds.length,
    reportCount: row.reportCount,
  };
}

export async function generateRaiderResumeRound(): Promise<RaiderResumeRound> {
  const candidates = await loadResumeCandidates();

  if (candidates.length === 0) throw new FunRoundUnavailableError("No character has enough raid history for a résumé");
  const targetRow = randomItem(candidates);
  const target = toCandidate(targetRow);

  const raidIds = Array.from(new Set(targetRow.raidIds));
  const raids = await Raid.find({ id: { $in: raidIds } }).select("id name expansion iconUrl starts -_id").lean();
  const raidById = new Map(raids.map((raid) => [raid.id, raid]));
  const timeline = raidIds
    .map((raidId) => raidById.get(raidId))
    .filter((raid): raid is NonNullable<typeof raid> => Boolean(raid))
    .sort((left, right) => {
      const leftTime = left.starts?.eu?.getTime() ?? left.id;
      const rightTime = right.starts?.eu?.getTime() ?? right.id;
      return leftTime - rightTime;
    })
    .map((raid) => ({ id: raid.id, name: raid.name, expansion: raid.expansion, iconUrl: raid.iconUrl ?? null }));

  const guildMap = new Map<string, { name: string; realm: string; firstSeenAt: Date; lastSeenAt: Date; raidNames: Set<string> }>();
  for (const participation of targetRow.participations) {
    const key = `${participation.guildName.toLocaleLowerCase("en-US")}\u0000${participation.guildRealm.toLocaleLowerCase("en-US")}`;
    let guild = guildMap.get(key);
    if (!guild) {
      guild = {
        name: participation.guildName,
        realm: participation.guildRealm,
        firstSeenAt: participation.firstSeenAt,
        lastSeenAt: participation.lastSeenAt,
        raidNames: new Set(),
      };
      guildMap.set(key, guild);
    }
    if (participation.firstSeenAt < guild.firstSeenAt) guild.firstSeenAt = participation.firstSeenAt;
    if (participation.lastSeenAt > guild.lastSeenAt) guild.lastSeenAt = participation.lastSeenAt;
    const raidName = raidById.get(participation.zoneId)?.name;
    if (raidName) guild.raidNames.add(raidName);
  }

  const guildValues = Array.from(guildMap.values());
  const [media, guildDocuments] = await Promise.all([
    targetRow.characterId
      ? CharacterMedia.findOne({ characterId: targetRow.characterId, status: "available" }).select("avatarUrl -_id").lean()
      : null,
    guildValues.length > 0
      ? Guild.find({ $or: guildValues.map((guild) => ({ name: guild.name, realm: guild.realm })) }).select("name realm faction crest -_id").lean()
      : [],
  ]);
  const guildDocumentByKey = new Map(
    guildDocuments.map((guild) => [`${guild.name.toLocaleLowerCase("en-US")}\u0000${guild.realm.toLocaleLowerCase("en-US")}`, guild]),
  );

  return {
    ...newRoundBase(),
    game: "raider-resume",
    timeline,
    solution: {
      target: {
        ...target,
        avatarUrl: media?.avatarUrl ?? null,
        guilds: guildValues
          .sort((left, right) => left.firstSeenAt.getTime() - right.firstSeenAt.getTime())
          .map((guild) => {
            const key = `${guild.name.toLocaleLowerCase("en-US")}\u0000${guild.realm.toLocaleLowerCase("en-US")}`;
            const guildDocument = guildDocumentByKey.get(key);
            return {
              name: guild.name,
              realm: guild.realm,
              faction: guildDocument?.faction ?? null,
              crest: guildDocument?.crest ?? null,
              firstSeenAt: guild.firstSeenAt.toISOString(),
              lastSeenAt: guild.lastSeenAt.toISOString(),
              raidNames: Array.from(guild.raidNames),
            };
          }),
      },
    },
  };
}

export async function searchRaiderResumeCandidates(query: string, limit: number): Promise<RaiderResumeCandidate[]> {
  const identities = await characterService.searchCharacters(query, Math.min(Math.max(limit * 2, 10), 20), {
    zoneIds: TRACKED_RAIDS,
    minMythicReportCount: MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_FUN_ELIGIBILITY,
  });
  const canonicalIds = identities.flatMap((identity) => typeof identity.wclCanonicalCharacterId === "number" ? [identity.wclCanonicalCharacterId] : []);
  if (canonicalIds.length === 0) return [];
  const rows = await loadResumeCandidates(canonicalIds);
  const candidateByKey = new Map(rows.map((row) => {
    const candidate = toCandidate(row);
    return [candidate.key, candidate];
  }));
  return identities
    .flatMap((identity): RaiderResumeCandidate[] => {
      if (typeof identity.wclCanonicalCharacterId !== "number") return [];
      const candidate = candidateByKey.get(canonicalCharacterKey(identity.wclCanonicalCharacterId, identity.classID));
      return candidate ? [candidate] : [];
    })
    .slice(0, limit);
}

async function loadResumeCandidates(canonicalIds?: number[]): Promise<ResumeAggregate[]> {
  return CharacterRaidParticipation.aggregate<ResumeAggregate>([
    {
      $match: {
        ...funMythicParticipationFilter(),
        wclCanonicalCharacterId: canonicalIds ? { $in: canonicalIds } : { $type: "number" },
      },
    },
    { $sort: { lastSeenAt: -1 } },
    {
      $group: {
        _id: { wclCanonicalCharacterId: "$wclCanonicalCharacterId", classID: "$classID" },
        characterId: { $first: "$characterId" },
        name: { $first: "$characterName" },
        realm: { $first: "$characterRealm" },
        region: { $first: "$characterRegion" },
        firstSeenAt: { $min: "$firstSeenAt" },
        lastSeenAt: { $max: "$lastSeenAt" },
        reportCount: { $sum: "$mythicReportCount" },
        raidIds: { $addToSet: "$zoneId" },
        guildIds: { $addToSet: "$reportGuildId" },
        participations: {
          $push: {
            zoneId: "$zoneId",
            guildName: "$reportGuildName",
            guildRealm: "$reportGuildRealm",
            firstSeenAt: "$firstSeenAt",
            lastSeenAt: "$lastSeenAt",
          },
        },
      },
    },
    {
      $match: {
        "raidIds.2": { $exists: true },
        reportCount: { $gte: 12 },
      },
    },
  ]).option({ maxTimeMS: 15_000 });
}
