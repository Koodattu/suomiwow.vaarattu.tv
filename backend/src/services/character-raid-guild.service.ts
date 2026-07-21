import mongoose from "mongoose";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";

export type CharacterRaidGuild = {
  id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
};

export type CharacterRaidGuildParticipation = {
  characterId?: mongoose.Types.ObjectId | string | null;
  zoneId: number;
  reportGuildId: mongoose.Types.ObjectId;
  reportGuildName: string;
  reportGuildRealm: string;
  reportCount: number;
  mythicReportCount: number;
  lastSeenAt: Date;
};

function isPreferredGuild(candidate: CharacterRaidGuildParticipation, current: CharacterRaidGuildParticipation): boolean {
  if (candidate.mythicReportCount !== current.mythicReportCount) return candidate.mythicReportCount > current.mythicReportCount;
  if (candidate.reportCount !== current.reportCount) return candidate.reportCount > current.reportCount;

  const lastSeenDiff = candidate.lastSeenAt.getTime() - current.lastSeenAt.getTime();
  if (lastSeenDiff !== 0) return lastSeenDiff > 0;

  const nameDiff = candidate.reportGuildName.localeCompare(current.reportGuildName);
  if (nameDiff !== 0) return nameDiff < 0;

  return candidate.reportGuildRealm.localeCompare(current.reportGuildRealm) < 0;
}

export function selectPrimaryCharacterRaidGuilds(rows: readonly CharacterRaidGuildParticipation[], zoneId: number): Map<string, CharacterRaidGuild> {
  const selectedRows = new Map<string, CharacterRaidGuildParticipation>();

  for (const row of rows) {
    if (row.zoneId !== zoneId || !row.characterId) continue;

    const characterId = String(row.characterId);
    const current = selectedRows.get(characterId);
    if (!current || isPreferredGuild(row, current)) {
      selectedRows.set(characterId, row);
    }
  }

  return new Map(
    Array.from(selectedRows, ([characterId, row]) => [
      characterId,
      {
        id: row.reportGuildId,
        name: row.reportGuildName,
        realm: row.reportGuildRealm,
      },
    ]),
  );
}

export async function getPrimaryCharacterRaidGuilds(
  zoneId: number,
  characterIds: readonly (mongoose.Types.ObjectId | string)[],
): Promise<Map<string, CharacterRaidGuild>> {
  const uniqueCharacterIds = Array.from(new Set(characterIds.map(String)))
    .filter((characterId) => mongoose.Types.ObjectId.isValid(characterId))
    .map((characterId) => new mongoose.Types.ObjectId(characterId));

  if (uniqueCharacterIds.length === 0) return new Map();

  const rows = await CharacterRaidParticipation.find({
    zoneId,
    characterId: { $in: uniqueCharacterIds },
  })
    .select("characterId zoneId reportGuildId reportGuildName reportGuildRealm reportCount mythicReportCount lastSeenAt -_id")
    .lean<CharacterRaidGuildParticipation[]>();

  return selectPrimaryCharacterRaidGuilds(rows, zoneId);
}
