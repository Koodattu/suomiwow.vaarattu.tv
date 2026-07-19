import crypto from "crypto";
import { Response } from "express";
import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import { TRACKED_RAIDS } from "../config/guilds";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import GuildNetworkSnapshot, { IGuildNetworkSnapshot } from "../models/GuildNetworkSnapshot";
import GuildNetworkSnapshotChunk from "../models/GuildNetworkSnapshotChunk";
import Raid from "../models/Raid";
import logger from "../utils/logger";
import guildNetworkMovementService from "./guild-network-movement.service";

const SCHEMA_VERSION = 3;
const CHUNK_SIZE = 512 * 1024;
const RETAIN_SNAPSHOTS = 3;

type UniverseTier = {
  id: number;
  name: string;
  expansion: string;
  start: string | null;
  end: string | null;
  participations: number;
};

type CharacterEntry = [string, number, number, number[], string[]?];
type AccountEntry = [string, string | null, number[]];

type ParticipationRow = {
  characterId?: mongoose.Types.ObjectId | string | null;
  wclCanonicalCharacterId?: number | null;
  zoneId: number;
  reportGuildId: mongoose.Types.ObjectId | string;
  reportGuildName: string;
  reportGuildRealm: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  classID: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reportCount: number;
};

type MutableCharacter = {
  name: string;
  realm: number;
  classID: number;
  nameSeen: Date | null;
  aliases: Set<string>;
  mem: Map<number, number>;
  characterIds: Set<string>;
};

type GuildNetworkMeta = {
  schemaVersion: number;
  generatedAt: Date;
  sourceUpdatedAt?: Date | null;
  rowCount: number;
  tierCount: number;
  guildCount: number;
  characterCount: number;
  byteLength: number;
  chunkCount: number;
  etag: string;
  movementReady: boolean;
};

class GuildNetworkService {
  private isRebuilding = false;

  async getActiveSnapshot(): Promise<IGuildNetworkSnapshot | null> {
    return GuildNetworkSnapshot.findOne({ active: true }).sort({ generatedAt: -1, _id: -1 });
  }

  async getActiveMeta(): Promise<GuildNetworkMeta | null> {
    const snapshot = await GuildNetworkSnapshot.findOne({ active: true }).sort({ generatedAt: -1, _id: -1 }).lean();
    if (!snapshot) return null;

    return {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      rowCount: snapshot.rowCount,
      tierCount: snapshot.tierCount,
      guildCount: snapshot.guildCount,
      characterCount: snapshot.characterCount,
      byteLength: snapshot.byteLength,
      chunkCount: snapshot.chunkCount,
      etag: snapshot.etag,
      movementReady: Boolean(snapshot.movementBatchId),
    };
  }

  async streamActiveUniverse(reqEtag: string | undefined, res: Response): Promise<boolean> {
    const snapshot = await this.getActiveSnapshot();
    if (!snapshot) {
      return false;
    }

    if (reqEtag && reqEtag === snapshot.etag) {
      res.status(304).end();
      return true;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=86400");
    res.setHeader("ETag", snapshot.etag);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("X-Guild-Network-Generated-At", snapshot.generatedAt.toISOString());
    res.setHeader("X-Guild-Network-Schema-Version", String(snapshot.schemaVersion));

    const cursor = GuildNetworkSnapshotChunk.find({ snapshotId: snapshot._id }).sort({ index: 1 }).select("data -_id").lean().cursor();
    for await (const chunk of cursor) {
      res.write(chunk.data);
    }
    res.end();
    return true;
  }

  async streamActiveRaidMovement(raidId: number, reqEtag: string | undefined, res: Response): Promise<boolean> {
    const snapshot = await this.getActiveSnapshot();
    if (!snapshot?.movementBatchId) return false;
    return guildNetworkMovementService.streamSnapshot(snapshot.movementBatchId, raidId, reqEtag, res);
  }

  triggerRebuild(): boolean {
    if (this.isRebuilding) return false;
    this.rebuildSnapshot()
      .then((meta) => logger.info(`[GuildNetwork] Snapshot rebuild completed: ${meta.characterCount} characters, ${meta.guildCount} guilds, ${(meta.byteLength / 1024 / 1024).toFixed(1)} MB`))
      .catch((error) => logger.error("[GuildNetwork] Snapshot rebuild failed:", error));
    return true;
  }

  async rebuildSnapshot(): Promise<GuildNetworkMeta> {
    if (this.isRebuilding) {
      throw new Error("Guild network snapshot rebuild is already running");
    }

    this.isRebuilding = true;
    const startedAt = Date.now();
    let movementBatchId: string | null = null;
    let snapshotId: mongoose.Types.ObjectId | null = null;
    let published = false;
    try {
      logger.info("[GuildNetwork] Building universe snapshot from CharacterRaidParticipation");
      const payload = await this.buildUniversePayload();
      movementBatchId = crypto.randomUUID();
      logger.info(`[GuildNetwork] Building movement snapshot batch ${movementBatchId}`);
      await guildNetworkMovementService.rebuildBatch(
        movementBatchId,
        payload.tiers.map((tier) => tier.id),
      );
      const json = JSON.stringify(payload);
      const etag = `"${crypto.createHash("sha256").update(json).digest("hex")}"`;
      const byteLength = Buffer.byteLength(json, "utf8");
      const chunkCount = Math.ceil(json.length / CHUNK_SIZE);

      const snapshot = await GuildNetworkSnapshot.create({
        schemaVersion: SCHEMA_VERSION,
        active: false,
        generatedAt: new Date(payload.generatedAt),
        sourceUpdatedAt: payload.sourceUpdatedAt ? new Date(payload.sourceUpdatedAt) : null,
        rowCount: payload.rowCount,
        tierCount: payload.tiers.length,
        guildCount: payload.guilds.length,
        characterCount: payload.characters.length,
        byteLength,
        chunkCount,
        chunkSize: CHUNK_SIZE,
        etag,
        movementBatchId,
      });

      snapshotId = snapshot._id as mongoose.Types.ObjectId;
      const chunks = [];
      for (let index = 0; index < chunkCount; index += 1) {
        chunks.push({
          snapshotId,
          index,
          data: json.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
        });
      }
      if (chunks.length > 0) {
        await GuildNetworkSnapshotChunk.insertMany(chunks, { ordered: true });
      }

      snapshot.active = true;
      await snapshot.save();
      published = true;
      try {
        await GuildNetworkSnapshot.updateMany(
          {
            _id: { $ne: snapshotId },
            active: true,
            $or: [
              { generatedAt: { $lt: snapshot.generatedAt } },
              { generatedAt: snapshot.generatedAt, _id: { $lt: snapshotId } },
            ],
          },
          { $set: { active: false } },
        );
      } catch (deactivationError) {
        logger.error("[GuildNetwork] New snapshot is live, but older active snapshots could not be deactivated:", deactivationError);
      }
      try {
        await this.pruneOldSnapshots();
      } catch (pruneError) {
        logger.error("[GuildNetwork] New snapshot is live, but stale snapshot pruning failed:", pruneError);
      }

      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      logger.info(`[GuildNetwork] Active snapshot ready in ${duration}s (${(byteLength / 1024 / 1024).toFixed(1)} MB, ${chunkCount} chunks)`);

      return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: snapshot.generatedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        rowCount: snapshot.rowCount,
        tierCount: snapshot.tierCount,
        guildCount: snapshot.guildCount,
        characterCount: snapshot.characterCount,
        byteLength: snapshot.byteLength,
        chunkCount: snapshot.chunkCount,
        etag: snapshot.etag,
        movementReady: true,
      };
    } catch (error) {
      if (!published) {
        try {
          if (snapshotId) {
            await GuildNetworkSnapshotChunk.deleteMany({ snapshotId });
            await GuildNetworkSnapshot.deleteOne({ _id: snapshotId });
          }
          if (movementBatchId) {
            await guildNetworkMovementService.discardBatch(movementBatchId);
          }
        } catch (cleanupError) {
          logger.error("[GuildNetwork] Failed to clean up an unpublished snapshot:", cleanupError);
        }
      }
      throw error;
    } finally {
      this.isRebuilding = false;
    }
  }

  private async buildUniversePayload(): Promise<{
    schemaVersion: number;
    generatedAt: string;
    sourceUpdatedAt: string | null;
    rowCount: number;
    tiers: UniverseTier[];
    realms: string[];
    guilds: Array<[string, number]>;
    guildKeys: string[];
    characters: CharacterEntry[];
    accounts: AccountEntry[];
  }> {
    const [rows, raids, latestParticipation, accountGroups] = await Promise.all([
      CharacterRaidParticipation.find({ zoneId: { $in: TRACKED_RAIDS } })
        .select("characterId wclCanonicalCharacterId zoneId reportGuildId reportGuildName reportGuildRealm characterName characterRealm characterRegion classID firstSeenAt lastSeenAt reportCount -_id")
        .lean<ParticipationRow[]>(),
      Raid.find({ id: { $in: TRACKED_RAIDS } }).select("id name expansion -_id").lean(),
      CharacterRaidParticipation.findOne({ zoneId: { $in: TRACKED_RAIDS } }).sort({ updatedAt: -1 }).select("updatedAt -_id").lean<{ updatedAt?: Date }>(),
      CharacterAccountGroup.find({ signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION }).select("displayName slug characterIds -_id").lean<Array<{ displayName?: string | null; slug?: string | null; characterIds?: Array<mongoose.Types.ObjectId | string> }>>(),
    ]);

    const tierAgg = new Map<number, { rows: number; first: Date | null; last: Date | null }>();
    for (const row of rows) {
      let entry = tierAgg.get(row.zoneId);
      if (!entry) {
        entry = { rows: 0, first: null, last: null };
        tierAgg.set(row.zoneId, entry);
      }

      entry.rows += 1;
      if (row.firstSeenAt && (!entry.first || row.firstSeenAt < entry.first)) entry.first = row.firstSeenAt;
      if (row.lastSeenAt && (!entry.last || row.lastSeenAt > entry.last)) entry.last = row.lastSeenAt;
    }

    const raidMeta = new Map(raids.map((raid) => [raid.id, raid]));
    const tiers = Array.from(tierAgg.entries())
      .sort((a, b) => (a[1].first?.getTime() ?? 0) - (b[1].first?.getTime() ?? 0))
      .map(([id, entry]) => {
        const meta = raidMeta.get(id);
        return {
          id,
          name: meta?.name || `Raid ${id}`,
          expansion: meta?.expansion || "Unknown",
          start: entry.first ? entry.first.toISOString() : null,
          end: entry.last ? entry.last.toISOString() : null,
          participations: entry.rows,
        };
      });
    const tierIndex = new Map(tiers.map((tier, index) => [tier.id, index]));

    const realms: string[] = [];
    const realmIndexes = new Map<string, number>();
    const realmIndex = (value: string | null | undefined): number => {
      const display = String(value || "Unknown");
      const key = display.toLowerCase().replace(/[^a-z]/g, "");
      const existing = realmIndexes.get(key);
      if (existing !== undefined) return existing;
      const next = realms.length;
      realms.push(display);
      realmIndexes.set(key, next);
      return next;
    };

    const guilds: Array<[string, number]> = [];
    const guildKeys: string[] = [];
    const guildIndexes = new Map<string, number>();
    const guildIndex = (row: ParticipationRow): number => {
      const key = String(row.reportGuildId);
      const existing = guildIndexes.get(key);
      if (existing !== undefined) return existing;
      const next = guilds.length;
      guilds.push([row.reportGuildName || "Unknown", realmIndex(row.reportGuildRealm)]);
      guildKeys.push(key);
      guildIndexes.set(key, next);
      return next;
    };

    const chars = new Map<string, MutableCharacter>();
    for (const row of rows) {
      const t = tierIndex.get(row.zoneId);
      if (t === undefined) continue;

      const g = guildIndex(row);
      const id = this.identityForRow(row);
      let entry = chars.get(id);
      if (!entry) {
        entry = {
          name: row.characterName || "Unknown",
          realm: realmIndex(row.characterRealm),
          classID: row.classID || 0,
          nameSeen: row.lastSeenAt || null,
          aliases: new Set<string>(),
          mem: new Map<number, number>(),
          characterIds: new Set<string>(),
        };
        chars.set(id, entry);
      }

      if (row.characterId !== null && row.characterId !== undefined) {
        entry.characterIds.add(String(row.characterId));
      }

      if (row.characterName) entry.aliases.add(row.characterName);
      if (row.characterRealm) entry.aliases.add(row.characterRealm);
      if (row.characterName || row.characterRealm) {
        entry.aliases.add(`${row.characterName || ""} ${row.characterRealm || ""}`);
      }

      if (row.lastSeenAt && (!entry.nameSeen || row.lastSeenAt > entry.nameSeen)) {
        entry.nameSeen = row.lastSeenAt;
        if (row.characterName) entry.name = row.characterName;
        entry.realm = realmIndex(row.characterRealm);
      }

      const memKey = t * 100000 + g;
      entry.mem.set(memKey, (entry.mem.get(memKey) || 0) + (row.reportCount || 0));
    }

    const characters: CharacterEntry[] = [];
    const characterIndexesById = new Map<string, number[]>();
    for (const entry of chars.values()) {
      const flat: number[] = [];
      const keys = Array.from(entry.mem.keys()).sort((a, b) => a - b);
      for (const key of keys) {
        flat.push(Math.floor(key / 100000), key % 100000, entry.mem.get(key) || 0);
      }

      const currentRealm = realms[entry.realm] || "";
      const aliases = Array.from(entry.aliases).filter((value) => value && value !== entry.name && value !== currentRealm && value !== `${entry.name} ${currentRealm}`);
      const characterIndex = characters.length;
      characters.push(aliases.length ? [entry.name, entry.realm, entry.classID, flat, aliases] : [entry.name, entry.realm, entry.classID, flat]);
      for (const characterId of entry.characterIds) {
        const indexes = characterIndexesById.get(characterId) || [];
        indexes.push(characterIndex);
        characterIndexesById.set(characterId, indexes);
      }
    }

    const accounts: AccountEntry[] = [];
    for (const group of accountGroups) {
      const indexes: number[] = [];
      const seen = new Set<number>();
      for (const characterId of group.characterIds || []) {
        for (const index of characterIndexesById.get(String(characterId)) || []) {
          if (seen.has(index)) continue;
          seen.add(index);
          indexes.push(index);
        }
      }
      if (indexes.length < 2) continue;
      indexes.sort((a, b) => a - b);
      accounts.push([group.displayName || "Account", group.slug || null, indexes]);
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: latestParticipation?.updatedAt ? latestParticipation.updatedAt.toISOString() : null,
      rowCount: rows.length,
      tiers,
      realms,
      guilds,
      guildKeys,
      characters,
      accounts,
    };
  }

  private identityForRow(row: ParticipationRow): string {
    if (row.characterId !== null && row.characterId !== undefined) {
      return `id:${String(row.characterId)}:${row.classID}`;
    }
    if (row.wclCanonicalCharacterId !== null && row.wclCanonicalCharacterId !== undefined) {
      return `c:${row.wclCanonicalCharacterId}:${row.classID}`;
    }
    return ["f", String(row.characterRegion || "").toLowerCase(), String(row.characterRealm || "").toLowerCase(), String(row.characterName || "").toLowerCase(), row.classID].join(":");
  }

  private async pruneOldSnapshots(): Promise<void> {
    const keep = await GuildNetworkSnapshot.find().sort({ generatedAt: -1, _id: -1 }).limit(RETAIN_SNAPSHOTS).select("_id").lean();
    const keepIds = keep.map((snapshot) => snapshot._id);
    const retainedSnapshots = await GuildNetworkSnapshot.find({ _id: { $in: keepIds } }).select("movementBatchId -_id").lean<Array<{ movementBatchId?: string | null }>>();
    const keepMovementBatchIds = retainedSnapshots.map((snapshot) => snapshot.movementBatchId).filter((batchId): batchId is string => Boolean(batchId));
    const oldSnapshots = await GuildNetworkSnapshot.find({ _id: { $nin: keepIds }, active: false }).select("_id").lean();
    const oldIds = oldSnapshots.map((snapshot) => snapshot._id);
    if (oldIds.length > 0) {
      await GuildNetworkSnapshotChunk.deleteMany({ snapshotId: { $in: oldIds } });
      await GuildNetworkSnapshot.deleteMany({ _id: { $in: oldIds } });
      logger.info(`[GuildNetwork] Pruned ${oldIds.length} old snapshots`);
    }
    await guildNetworkMovementService.pruneBatches(keepMovementBatchIds);
  }
}

export default new GuildNetworkService();
