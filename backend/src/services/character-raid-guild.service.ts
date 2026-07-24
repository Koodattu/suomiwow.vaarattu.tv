import mongoose from "mongoose";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";

export type CharacterRaidGuild = {
  id: mongoose.Types.ObjectId;
  name: string;
  realm: string;
};

export type CharacterRaidParticipationSummary = {
  guild: CharacterRaidGuild;
  reportCount: number;
  mythicReportCount: number;
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
  return new Map(
    Array.from(summarizeCharacterRaidParticipation(rows, zoneId), ([characterId, summary]) => [characterId, summary.guild]),
  );
}

export function summarizeCharacterRaidParticipation(
  rows: readonly CharacterRaidGuildParticipation[],
  zoneId: number,
): Map<string, CharacterRaidParticipationSummary> {
  const selectedRows = new Map<string, CharacterRaidGuildParticipation>();
  const totals = new Map<string, { reportCount: number; mythicReportCount: number }>();

  for (const row of rows) {
    if (row.zoneId !== zoneId || !row.characterId) continue;

    const characterId = String(row.characterId);
    const total = totals.get(characterId) ?? { reportCount: 0, mythicReportCount: 0 };
    total.reportCount += Math.max(0, row.reportCount ?? 0);
    total.mythicReportCount += Math.max(0, row.mythicReportCount ?? 0);
    totals.set(characterId, total);

    const current = selectedRows.get(characterId);
    if (!current || isPreferredGuild(row, current)) {
      selectedRows.set(characterId, row);
    }
  }

  return new Map(
    Array.from(selectedRows, ([characterId, row]) => [
      characterId,
      {
        guild: {
          id: row.reportGuildId,
          name: row.reportGuildName,
          realm: row.reportGuildRealm,
        },
        reportCount: totals.get(characterId)?.reportCount ?? 0,
        mythicReportCount: totals.get(characterId)?.mythicReportCount ?? 0,
      },
    ]),
  );
}

export async function getCharacterRaidParticipationSummaries(
  zoneId: number,
  characterIds: readonly (mongoose.Types.ObjectId | string)[],
): Promise<Map<string, CharacterRaidParticipationSummary>> {
  const uniqueCharacterIds = normalizeCharacterIds(characterIds);
  if (uniqueCharacterIds.length === 0) return new Map();

  const rows = await CharacterRaidParticipation.find({
    zoneId,
    characterId: { $in: uniqueCharacterIds },
  })
    .select("characterId zoneId reportGuildId reportGuildName reportGuildRealm reportCount mythicReportCount lastSeenAt -_id")
    .lean<CharacterRaidGuildParticipation[]>();

  return summarizeCharacterRaidParticipation(rows, zoneId);
}

export async function getPrimaryCharacterRaidGuilds(
  zoneId: number,
  characterIds: readonly (mongoose.Types.ObjectId | string)[],
): Promise<Map<string, CharacterRaidGuild>> {
  const summaries = await getCharacterRaidParticipationSummaries(zoneId, characterIds);
  return new Map(Array.from(summaries, ([characterId, summary]) => [characterId, summary.guild]));
}

function normalizeCharacterIds(characterIds: readonly (mongoose.Types.ObjectId | string)[]): mongoose.Types.ObjectId[] {
  return Array.from(new Set(characterIds.map(String)))
    .filter((characterId) => mongoose.Types.ObjectId.isValid(characterId))
    .map((characterId) => new mongoose.Types.ObjectId(characterId));
}
