import crypto from "crypto";
import { Response } from "express";
import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import GuildNetworkMovementSnapshot from "../models/GuildNetworkMovementSnapshot";
import GuildNetworkMovementSnapshotChunk from "../models/GuildNetworkMovementSnapshotChunk";
import Raid from "../models/Raid";
import Report from "../models/Report";
import logger from "../utils/logger";

const MOVEMENT_SCHEMA_VERSION = 1;
const CHUNK_SIZE = 512 * 1024;
const REPORT_CODE_BATCH_SIZE = 1000;

type StringableId = mongoose.Types.ObjectId | string;

export type MovementReportRow = {
  code: string;
  startTime: number;
  endTime?: number | null;
  guildId: StringableId;
  updatedAt?: Date | null;
};

export type MovementAppearanceRow = {
  characterId?: StringableId | null;
  wclCanonicalCharacterId?: number | null;
  sourceIdentityKey: string;
  appearanceSource: "rankedCharacters" | "reportRankings";
  reportCode: string;
  reportStartTime: Date;
  reportZoneId?: number;
  reportGuildId: StringableId;
  reportGuildName: string;
  reportGuildRealm: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  classID: number;
  hidden: boolean;
  updatedAt?: Date | null;
};

export type MovementAccountGroupRow = {
  displayName?: string | null;
  slug?: string | null;
  characterIds?: StringableId[];
  generatedAt?: Date | null;
};

export type MovementRaidRow = {
  id: number;
  name: string;
  expansion: string;
};

export type GuildNetworkMovementPayload = {
  schemaVersion: number;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  rowCount: number;
  raid: {
    id: number;
    name: string;
    expansion: string;
    start: string | null;
    end: string | null;
  };
  guilds: Array<[key: string, name: string, realm: string]>;
  characters: Array<[key: string, name: string, realm: string, classID: number, aliases?: string[]]>;
  accounts: Array<[displayName: string, slug: string | null, characterIndexes: number[]]>;
  reports: Array<[code: string, startTime: number, endTime: number | null, guildIndex: number, characterIndexes: number[]]>;
};

type MutableCharacter = {
  key: string;
  tempIndex: number;
  name: string;
  realm: string;
  region: string;
  classID: number;
  latestAt: number;
  latestCode: string;
  aliases: Set<string>;
  characterIds: Set<string>;
};

type MutableGuild = {
  key: string;
  name: string;
  realm: string;
  latestAt: number;
};

type CanonicalLinkRow = {
  characterId?: StringableId | null;
  wclCanonicalCharacterId?: number | null;
  classID: number;
  hidden?: boolean;
};

type CanonicalLinks = Map<string, string | null>;

function fallbackIdentity(row: MovementAppearanceRow): string {
  return [
    "f",
    String(row.characterRegion || "").toLowerCase(),
    String(row.characterRealm || "").toLowerCase(),
    String(row.characterName || "").toLowerCase(),
    row.classID,
  ].join(":");
}

function identityForAppearance(row: MovementAppearanceRow, canonicalLinks: CanonicalLinks): string {
  if (row.characterId !== null && row.characterId !== undefined) {
    return `id:${String(row.characterId)}:${row.classID}`;
  }
  if (row.wclCanonicalCharacterId !== null && row.wclCanonicalCharacterId !== undefined) {
    const canonicalKey = `${row.wclCanonicalCharacterId}:${row.classID}`;
    return canonicalLinks.get(canonicalKey) || `c:${canonicalKey}`;
  }
  return fallbackIdentity(row);
}

function sourcePriority(source: MovementAppearanceRow["appearanceSource"]): number {
  return source === "rankedCharacters" ? 0 : 1;
}

function preferAppearance(next: MovementAppearanceRow, current: MovementAppearanceRow): boolean {
  const sourceDifference = sourcePriority(next.appearanceSource) - sourcePriority(current.appearanceSource);
  if (sourceDifference !== 0) return sourceDifference < 0;
  const nextKey = `${next.sourceIdentityKey}\u0000${next.characterName}\u0000${next.characterRealm}`;
  const currentKey = `${current.sourceIdentityKey}\u0000${current.characterName}\u0000${current.characterRealm}`;
  return nextKey.localeCompare(currentKey) < 0;
}

function recordCanonicalLink(canonicalLinks: CanonicalLinks, row: CanonicalLinkRow): void {
  if (
    row.hidden ||
    row.characterId === null ||
    row.characterId === undefined ||
    row.wclCanonicalCharacterId === null ||
    row.wclCanonicalCharacterId === undefined
  ) {
    return;
  }

  const canonicalKey = `${row.wclCanonicalCharacterId}:${row.classID}`;
  const linkedIdentity = `id:${String(row.characterId)}:${row.classID}`;
  if (!canonicalLinks.has(canonicalKey)) {
    canonicalLinks.set(canonicalKey, linkedIdentity);
    return;
  }
  if (canonicalLinks.get(canonicalKey) !== linkedIdentity) {
    canonicalLinks.set(canonicalKey, null);
  }
}

class MovementPayloadBuilder {
  private readonly orderedReports: MovementReportRow[];
  private readonly reportByCode: Map<string, MovementReportRow>;
  private readonly charactersByKey = new Map<string, MutableCharacter>();
  private readonly guildsByKey = new Map<string, MutableGuild>();
  private readonly characterIndexesByReport = new Map<string, Set<number>>();
  private sourceUpdatedAt: Date | null = null;
  private rowCount = 0;

  constructor(
    private readonly raid: MovementRaidRow,
    reports: MovementReportRow[],
    private readonly accountGroups: MovementAccountGroupRow[],
    private readonly canonicalLinks: CanonicalLinks,
    private readonly generatedAt = new Date(),
  ) {
    this.orderedReports = reports
      .filter((report) => Number.isFinite(report.startTime))
      .slice()
      .sort((a, b) => a.startTime - b.startTime || a.code.localeCompare(b.code));
    this.reportByCode = new Map(this.orderedReports.map((report) => [report.code, report]));
    for (const report of reports) this.considerSourceDate(report.updatedAt);
    for (const group of accountGroups) this.considerSourceDate(group.generatedAt);
  }

  addAppearances(appearances: MovementAppearanceRow[]): void {
    const selectedAppearances = new Map<string, { identity: string; row: MovementAppearanceRow }>();
    for (const row of appearances) {
      this.considerSourceDate(row.updatedAt);
      if (row.hidden || row.reportZoneId !== undefined && row.reportZoneId !== this.raid.id) continue;
      const report = this.reportByCode.get(row.reportCode);
      if (!report || String(report.guildId) !== String(row.reportGuildId)) continue;
      const identity = identityForAppearance(row, this.canonicalLinks);
      const key = `${identity}\u0000${row.reportCode}`;
      const current = selectedAppearances.get(key);
      if (!current || preferAppearance(row, current.row)) selectedAppearances.set(key, { identity, row });
    }

    for (const { identity, row } of selectedAppearances.values()) {
      this.addSelectedAppearance(identity, row);
    }
  }

  build(): GuildNetworkMovementPayload {
    const mutableGuilds = Array.from(this.guildsByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
    const guildIndexByKey = new Map(mutableGuilds.map((guild, index) => [guild.key, index]));
    const guilds: GuildNetworkMovementPayload["guilds"] = mutableGuilds.map((guild) => [guild.key, guild.name, guild.realm]);

    const mutableCharacters = Array.from(this.charactersByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
    const finalIndexByTemp: number[] = [];
    const characters: GuildNetworkMovementPayload["characters"] = mutableCharacters.map((character, index) => {
      finalIndexByTemp[character.tempIndex] = index;
      const aliases = Array.from(character.aliases)
        .filter((alias) => alias && alias !== character.name && alias !== character.realm && alias !== `${character.name} ${character.realm}`)
        .sort((a, b) => a.localeCompare(b));
      return aliases.length
        ? [character.key, character.name, character.realm, character.classID, aliases]
        : [character.key, character.name, character.realm, character.classID];
    });

    const reportRows: GuildNetworkMovementPayload["reports"] = [];
    for (const report of this.orderedReports) {
      const tempIndexes = this.characterIndexesByReport.get(report.code);
      if (!tempIndexes?.size) continue;
      const guildIndex = guildIndexByKey.get(String(report.guildId));
      if (guildIndex === undefined) continue;
      const characterIndexes = Array.from(tempIndexes)
        .map((tempIndex) => finalIndexByTemp[tempIndex])
        .filter((index): index is number => index !== undefined)
        .sort((a, b) => a - b);
      if (!characterIndexes.length) continue;
      reportRows.push([report.code, report.startTime, report.endTime ?? null, guildIndex, characterIndexes]);
    }

    const indexesByCharacterId = new Map<string, number[]>();
    mutableCharacters.forEach((character, index) => {
      for (const characterId of character.characterIds) {
        const indexes = indexesByCharacterId.get(characterId) || [];
        indexes.push(index);
        indexesByCharacterId.set(characterId, indexes);
      }
    });

    const accounts: GuildNetworkMovementPayload["accounts"] = [];
    for (const group of this.accountGroups) {
      const indexes = new Set<number>();
      for (const characterId of group.characterIds || []) {
        for (const index of indexesByCharacterId.get(String(characterId)) || []) indexes.add(index);
      }
      if (!indexes.size) continue;
      accounts.push([group.displayName || "Account", group.slug || null, Array.from(indexes).sort((a, b) => a - b)]);
    }
    accounts.sort((a, b) => (a[1] || a[0]).localeCompare(b[1] || b[0]));

    const firstReport = reportRows[0];
    const lastReport = reportRows[reportRows.length - 1];
    return {
      schemaVersion: MOVEMENT_SCHEMA_VERSION,
      generatedAt: this.generatedAt.toISOString(),
      sourceUpdatedAt: this.sourceUpdatedAt ? this.sourceUpdatedAt.toISOString() : null,
      rowCount: this.rowCount,
      raid: {
        id: this.raid.id,
        name: this.raid.name,
        expansion: this.raid.expansion,
        start: firstReport ? new Date(firstReport[1]).toISOString() : null,
        end: lastReport ? new Date(lastReport[2] ?? lastReport[1]).toISOString() : null,
      },
      guilds,
      characters,
      accounts,
      reports: reportRows,
    };
  }

  private addSelectedAppearance(identity: string, row: MovementAppearanceRow): void {
    const report = this.reportByCode.get(row.reportCode);
    if (!report) return;
    const observedAt = report.startTime;
    const guildKey = String(report.guildId);
    const existingGuild = this.guildsByKey.get(guildKey);
    if (!existingGuild) {
      this.guildsByKey.set(guildKey, {
        key: guildKey,
        name: row.reportGuildName || "Unknown",
        realm: row.reportGuildRealm || "Unknown",
        latestAt: observedAt,
      });
    } else if (observedAt >= existingGuild.latestAt) {
      existingGuild.name = row.reportGuildName || existingGuild.name;
      existingGuild.realm = row.reportGuildRealm || existingGuild.realm;
      existingGuild.latestAt = observedAt;
    }

    let character = this.charactersByKey.get(identity);
    if (!character) {
      character = {
        key: identity,
        tempIndex: this.charactersByKey.size,
        name: row.characterName || "Unknown",
        realm: row.characterRealm || "Unknown",
        region: row.characterRegion || "",
        classID: row.classID || 0,
        latestAt: observedAt,
        latestCode: row.reportCode,
        aliases: new Set<string>(),
        characterIds: new Set<string>(),
      };
      this.charactersByKey.set(identity, character);
    }
    if (row.characterId !== null && row.characterId !== undefined) character.characterIds.add(String(row.characterId));
    if (row.characterName) character.aliases.add(row.characterName);
    if (row.characterRealm) character.aliases.add(row.characterRealm);
    if (row.characterName || row.characterRealm) character.aliases.add(`${row.characterName || ""} ${row.characterRealm || ""}`.trim());
    if (observedAt > character.latestAt || observedAt === character.latestAt && row.reportCode.localeCompare(character.latestCode) > 0) {
      character.name = row.characterName || character.name;
      character.realm = row.characterRealm || character.realm;
      character.region = row.characterRegion || character.region;
      character.latestAt = observedAt;
      character.latestCode = row.reportCode;
    }

    const reportCharacterIndexes = this.characterIndexesByReport.get(row.reportCode) || new Set<number>();
    if (!reportCharacterIndexes.has(character.tempIndex)) {
      reportCharacterIndexes.add(character.tempIndex);
      this.rowCount += 1;
    }
    this.characterIndexesByReport.set(row.reportCode, reportCharacterIndexes);
  }

  private considerSourceDate(value: Date | null | undefined): void {
    if (value && (!this.sourceUpdatedAt || value > this.sourceUpdatedAt)) this.sourceUpdatedAt = value;
  }
}

export function buildGuildNetworkMovementPayload(
  raid: MovementRaidRow,
  reports: MovementReportRow[],
  appearances: MovementAppearanceRow[],
  accountGroups: MovementAccountGroupRow[],
  generatedAt = new Date(),
): GuildNetworkMovementPayload {
  const canonicalLinks: CanonicalLinks = new Map();
  for (const row of appearances) recordCanonicalLink(canonicalLinks, row);
  const builder = new MovementPayloadBuilder(raid, reports, accountGroups, canonicalLinks, generatedAt);
  builder.addAppearances(appearances);
  return builder.build();
}

class GuildNetworkMovementService {
  async rebuildBatch(batchId: string, raidIds: number[]): Promise<{ raidCount: number; reportCount: number; rowCount: number }> {
    const [raids, accountGroups] = await Promise.all([
      Raid.find({ id: { $in: raidIds } }).select("id name expansion -_id").lean<MovementRaidRow[]>(),
      CharacterAccountGroup.find({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION })
        .select("displayName slug characterIds generatedAt -_id")
        .lean<MovementAccountGroupRow[]>(),
    ]);
    const raidsById = new Map(raids.map((raid) => [raid.id, raid]));
    let totalReports = 0;
    let totalRows = 0;

    try {
      for (const raidId of raidIds) {
        const raid = raidsById.get(raidId) || { id: raidId, name: `Raid ${raidId}`, expansion: "Unknown" };
        const reports = await Report.find({
          zoneId: raidId,
          "fightSequence.difficulty": { $in: [4, 5] },
        })
          .select("code startTime endTime guildId updatedAt -_id")
          .lean<MovementReportRow[]>();
        const reportCodes = reports.map((report) => report.code);
        const canonicalLinks: CanonicalLinks = new Map();
        for (let offset = 0; offset < reportCodes.length; offset += REPORT_CODE_BATCH_SIZE) {
          const codeBatch = reportCodes.slice(offset, offset + REPORT_CODE_BATCH_SIZE);
          const linkedRows = await CharacterReportAppearance.find({
            reportZoneId: raidId,
            reportCode: { $in: codeBatch },
            hidden: { $ne: true },
            characterId: { $ne: null },
            wclCanonicalCharacterId: { $ne: null },
          })
            .select("characterId wclCanonicalCharacterId classID hidden -_id")
            .lean<CanonicalLinkRow[]>();
          for (const row of linkedRows) recordCanonicalLink(canonicalLinks, row);
        }

        const builder = new MovementPayloadBuilder(raid, reports, accountGroups, canonicalLinks);
        for (let offset = 0; offset < reportCodes.length; offset += REPORT_CODE_BATCH_SIZE) {
          const codeBatch = reportCodes.slice(offset, offset + REPORT_CODE_BATCH_SIZE);
          const appearances = await CharacterReportAppearance.find({
            reportZoneId: raidId,
            reportCode: { $in: codeBatch },
            hidden: { $ne: true },
          })
            .select(
              "characterId wclCanonicalCharacterId sourceIdentityKey appearanceSource reportCode reportStartTime reportZoneId reportGuildId reportGuildName reportGuildRealm characterName characterRealm characterRegion classID hidden updatedAt -_id",
            )
            .lean<MovementAppearanceRow[]>();
          builder.addAppearances(appearances);
        }

        const payload = builder.build();
        const persisted = await this.persistSnapshot(batchId, payload);
        totalReports += payload.reports.length;
        totalRows += payload.rowCount;
        logger.info(
          `[GuildNetworkMovement] ${raid.name}: ${payload.reports.length} reports, ${payload.rowCount} appearances, ${(persisted.byteLength / 1024 / 1024).toFixed(1)} MB`,
        );
      }
    } catch (error) {
      await this.deleteBatches([batchId]);
      throw error;
    }

    logger.info(`[GuildNetworkMovement] Built ${raidIds.length} raid snapshots (${totalReports} reports, ${totalRows} appearances)`);
    return { raidCount: raidIds.length, reportCount: totalReports, rowCount: totalRows };
  }

  async streamSnapshot(batchId: string, raidId: number, reqEtag: string | undefined, res: Response): Promise<boolean> {
    const snapshot = await GuildNetworkMovementSnapshot.findOne({ batchId, raidId });
    if (!snapshot) return false;

    if (reqEtag && reqEtag === snapshot.etag) {
      res.status(304).end();
      return true;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=86400");
    res.setHeader("ETag", snapshot.etag);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("X-Guild-Network-Movement-Generated-At", snapshot.generatedAt.toISOString());
    res.setHeader("X-Guild-Network-Movement-Schema-Version", String(snapshot.schemaVersion));

    const cursor = GuildNetworkMovementSnapshotChunk.find({ snapshotId: snapshot._id }).sort({ index: 1 }).select("data -_id").lean().cursor();
    for await (const chunk of cursor) res.write(chunk.data);
    res.end();
    return true;
  }

  async pruneBatches(keepBatchIds: string[]): Promise<void> {
    const staleSnapshots = await GuildNetworkMovementSnapshot.find({ batchId: { $nin: keepBatchIds } }).select("_id batchId").lean();
    if (!staleSnapshots.length) return;
    const staleIds = staleSnapshots.map((snapshot) => snapshot._id);
    await GuildNetworkMovementSnapshotChunk.deleteMany({ snapshotId: { $in: staleIds } });
    await GuildNetworkMovementSnapshot.deleteMany({ _id: { $in: staleIds } });
    logger.info(`[GuildNetworkMovement] Pruned ${staleSnapshots.length} stale raid snapshots`);
  }

  async discardBatch(batchId: string): Promise<void> {
    await this.deleteBatches([batchId]);
  }

  private async persistSnapshot(batchId: string, payload: GuildNetworkMovementPayload): Promise<{ byteLength: number }> {
    const json = JSON.stringify(payload);
    const etag = `"${crypto.createHash("sha256").update(json).digest("hex")}"`;
    const byteLength = Buffer.byteLength(json, "utf8");
    const chunkCount = Math.ceil(json.length / CHUNK_SIZE);
    const snapshot = await GuildNetworkMovementSnapshot.create({
      batchId,
      raidId: payload.raid.id,
      schemaVersion: MOVEMENT_SCHEMA_VERSION,
      generatedAt: new Date(payload.generatedAt),
      sourceUpdatedAt: payload.sourceUpdatedAt ? new Date(payload.sourceUpdatedAt) : null,
      rowCount: payload.rowCount,
      reportCount: payload.reports.length,
      guildCount: payload.guilds.length,
      characterCount: payload.characters.length,
      byteLength,
      chunkCount,
      chunkSize: CHUNK_SIZE,
      etag,
    });
    const snapshotId = snapshot._id as mongoose.Types.ObjectId;
    const chunks = [];
    for (let index = 0; index < chunkCount; index += 1) {
      chunks.push({
        snapshotId,
        index,
        data: json.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
      });
    }
    if (chunks.length) await GuildNetworkMovementSnapshotChunk.insertMany(chunks, { ordered: true });
    return { byteLength };
  }

  private async deleteBatches(batchIds: string[]): Promise<void> {
    const snapshots = await GuildNetworkMovementSnapshot.find({ batchId: { $in: batchIds } }).select("_id").lean();
    if (!snapshots.length) return;
    const snapshotIds = snapshots.map((snapshot) => snapshot._id);
    await GuildNetworkMovementSnapshotChunk.deleteMany({ snapshotId: { $in: snapshotIds } });
    await GuildNetworkMovementSnapshot.deleteMany({ _id: { $in: snapshotIds } });
  }
}

export default new GuildNetworkMovementService();
