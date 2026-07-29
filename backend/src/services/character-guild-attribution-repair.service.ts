import mongoose from "mongoose";
import Character from "../models/Character";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import logger from "../utils/logger";
import cacheService from "./cache.service";
import taskTracker from "./task-tracker.service";

type GuildIdentity = {
  name: string;
  realm: string;
};

export type GuildEvidenceRange = {
  guildName: string;
  guildRealm: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type LatestGuildObservation = {
  observedAt: Date;
  guild: GuildIdentity | null;
};

export type CharacterGuildRepairInput = {
  guildName?: string | null;
  guildRealm?: string | null;
  guildUpdatedAt?: Date | null;
  guildHistory?: GuildEvidenceRange[];
};

export type CharacterGuildRepairPlan = {
  guildName: string | null;
  guildRealm: string | null;
  guildUpdatedAt: Date | null;
  guildHistory: GuildEvidenceRange[];
  currentGuildChanged: boolean;
  currentGuildCleared: boolean;
  historyEntriesRemoved: number;
  historyEntriesAdded: number;
  historyEntriesRewritten: number;
};

export type CharacterGuildAttributionRepairResult = {
  dryRun: boolean;
  evidenceCharacters: number;
  scannedCharacters: number;
  repairedCharacters: number;
  writtenCharacters: number;
  currentGuildsChanged: number;
  currentGuildsCleared: number;
  historyEntriesRemoved: number;
  historyEntriesAdded: number;
  historyEntriesRewritten: number;
};

type ReportOwnerRangeRow = {
  _id: {
    characterId: mongoose.Types.ObjectId;
    guildName: string;
    guildRealm: string;
  };
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type WclGuildRangeRow = ReportOwnerRangeRow & {
  name: string;
  realm: string;
};

type LatestWclGuildRow = {
  _id: mongoose.Types.ObjectId;
  observedAt: Date;
  guild: GuildIdentity | null;
};

function guildKey(name?: string | null, realm?: string | null): string | null {
  const normalizedName = name?.trim().toLowerCase();
  const normalizedRealm = realm?.trim().toLowerCase();
  return normalizedName && normalizedRealm ? `${normalizedName}\u0000${normalizedRealm}` : null;
}

function dateValue(value?: Date | null): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sameDate(left?: Date | null, right?: Date | null): boolean {
  const leftValue = dateValue(left);
  const rightValue = dateValue(right);
  return leftValue !== null && leftValue === rightValue;
}

function minDate(values: Date[]): Date {
  return new Date(Math.min(...values.map((value) => new Date(value).getTime())));
}

function maxDate(values: Date[]): Date {
  return new Date(Math.max(...values.map((value) => new Date(value).getTime())));
}

function historyEntryChanged(left: GuildEvidenceRange, right: GuildEvidenceRange): boolean {
  return (
    left.guildName !== right.guildName ||
    left.guildRealm !== right.guildRealm ||
    !sameDate(left.firstSeenAt, right.firstSeenAt) ||
    !sameDate(left.lastSeenAt, right.lastSeenAt)
  );
}

export function planCharacterGuildAttributionRepair(
  character: CharacterGuildRepairInput,
  reportOwnerRanges: GuildEvidenceRange[],
  wclGuildRanges: GuildEvidenceRange[],
  latestWclObservation: LatestGuildObservation | null,
): CharacterGuildRepairPlan | null {
  const ownerByGuild = new Map(reportOwnerRanges.map((range) => [guildKey(range.guildName, range.guildRealm), range]));
  const wclByGuild = new Map(wclGuildRanges.map((range) => [guildKey(range.guildName, range.guildRealm), range]));
  const repairedHistoryByGuild = new Map<string, GuildEvidenceRange>();
  let historyEntriesRemoved = 0;
  let historyEntriesAdded = 0;
  let historyEntriesRewritten = 0;

  for (const rawEntry of character.guildHistory || []) {
    const key = guildKey(rawEntry.guildName, rawEntry.guildRealm);
    if (!key) continue;

    const entry: GuildEvidenceRange = {
      guildName: rawEntry.guildName,
      guildRealm: rawEntry.guildRealm,
      firstSeenAt: new Date(rawEntry.firstSeenAt),
      lastSeenAt: new Date(rawEntry.lastSeenAt),
    };
    const ownerRange = ownerByGuild.get(key);
    const wclRange = wclByGuild.get(key);
    const firstCameFromReportOwner = Boolean(ownerRange && sameDate(entry.firstSeenAt, ownerRange.firstSeenAt));
    const lastCameFromReportOwner = Boolean(ownerRange && sameDate(entry.lastSeenAt, ownerRange.lastSeenAt));

    if (ownerRange && (firstCameFromReportOwner || lastCameFromReportOwner)) {
      const supportedDates: Date[] = [];
      if (!firstCameFromReportOwner) supportedDates.push(entry.firstSeenAt);
      if (!lastCameFromReportOwner) supportedDates.push(entry.lastSeenAt);
      if (wclRange) supportedDates.push(wclRange.firstSeenAt, wclRange.lastSeenAt);

      if (supportedDates.length === 0) {
        historyEntriesRemoved += 1;
        continue;
      }

      const repairedEntry = {
        guildName: wclRange?.guildName ?? entry.guildName,
        guildRealm: wclRange?.guildRealm ?? entry.guildRealm,
        firstSeenAt: minDate(supportedDates),
        lastSeenAt: maxDate(supportedDates),
      };
      if (historyEntryChanged(entry, repairedEntry)) historyEntriesRewritten += 1;
      repairedHistoryByGuild.set(key, repairedEntry);
      continue;
    }

    repairedHistoryByGuild.set(key, entry);
  }

  for (const range of wclGuildRanges) {
    const key = guildKey(range.guildName, range.guildRealm);
    if (!key) continue;
    const existing = repairedHistoryByGuild.get(key);
    if (!existing) {
      repairedHistoryByGuild.set(key, {
        guildName: range.guildName,
        guildRealm: range.guildRealm,
        firstSeenAt: new Date(range.firstSeenAt),
        lastSeenAt: new Date(range.lastSeenAt),
      });
      historyEntriesAdded += 1;
      continue;
    }

    const merged = {
      ...existing,
      firstSeenAt: minDate([existing.firstSeenAt, range.firstSeenAt]),
      lastSeenAt: maxDate([existing.lastSeenAt, range.lastSeenAt]),
    };
    if (historyEntryChanged(existing, merged)) historyEntriesRewritten += 1;
    repairedHistoryByGuild.set(key, merged);
  }

  const existingCurrentGuildKey = guildKey(character.guildName, character.guildRealm);
  const currentOwnerRange = existingCurrentGuildKey ? ownerByGuild.get(existingCurrentGuildKey) : null;
  const currentWclRange = existingCurrentGuildKey ? wclByGuild.get(existingCurrentGuildKey) : null;
  const currentGuildUpdatedAt = character.guildUpdatedAt ? new Date(character.guildUpdatedAt) : null;
  const currentGuildWasReportDerived = Boolean(
    currentOwnerRange &&
      sameDate(currentGuildUpdatedAt, currentOwnerRange.lastSeenAt) &&
      (!currentWclRange ||
        dateValue(currentGuildUpdatedAt)! < dateValue(currentWclRange.firstSeenAt)! ||
        dateValue(currentGuildUpdatedAt)! > dateValue(currentWclRange.lastSeenAt)!),
  );
  const latestObservationIsNewer = Boolean(
    latestWclObservation &&
      (!currentGuildUpdatedAt || dateValue(latestWclObservation.observedAt)! >= dateValue(currentGuildUpdatedAt)!),
  );

  let guildName = character.guildName ?? null;
  let guildRealm = character.guildRealm ?? null;
  let guildUpdatedAt = currentGuildUpdatedAt;
  if (latestWclObservation && (currentGuildWasReportDerived || latestObservationIsNewer)) {
    guildName = latestWclObservation.guild?.name ?? null;
    guildRealm = latestWclObservation.guild?.realm ?? null;
    guildUpdatedAt = new Date(latestWclObservation.observedAt);
  }

  const resultingCurrentGuildKey = guildKey(guildName, guildRealm);
  if (resultingCurrentGuildKey && guildUpdatedAt && !currentGuildWasReportDerived && !repairedHistoryByGuild.has(resultingCurrentGuildKey)) {
    repairedHistoryByGuild.set(resultingCurrentGuildKey, {
      guildName: guildName!,
      guildRealm: guildRealm!,
      firstSeenAt: new Date(guildUpdatedAt),
      lastSeenAt: new Date(guildUpdatedAt),
    });
    historyEntriesAdded += 1;
  }

  const guildHistory = Array.from(repairedHistoryByGuild.values()).sort(
    (left, right) => left.firstSeenAt.getTime() - right.firstSeenAt.getTime() || left.guildName.localeCompare(right.guildName),
  );
  const currentGuildChanged = guildKey(guildName, guildRealm) !== existingCurrentGuildKey;
  const timestampsChanged = !sameDate(guildUpdatedAt, currentGuildUpdatedAt) && Boolean(guildUpdatedAt || currentGuildUpdatedAt);
  const historyChanged = historyEntriesRemoved > 0 || historyEntriesAdded > 0 || historyEntriesRewritten > 0;

  if (!currentGuildChanged && !timestampsChanged && !historyChanged) return null;

  return {
    guildName,
    guildRealm,
    guildUpdatedAt,
    guildHistory,
    currentGuildChanged,
    currentGuildCleared: currentGuildChanged && !guildName,
    historyEntriesRemoved,
    historyEntriesAdded,
    historyEntriesRewritten,
  };
}

class CharacterGuildAttributionRepairService {
  private isRunning = false;

  async preview(): Promise<CharacterGuildAttributionRepairResult> {
    if (this.isRunning) throw new Error("Character guild attribution repair is already running");
    this.isRunning = true;
    try {
      return await this.reconcile(true);
    } finally {
      this.isRunning = false;
    }
  }

  trigger(): { started: boolean; message: string } {
    if (this.isRunning) {
      return { started: false, message: "Character guild attribution repair is already running" };
    }

    this.isRunning = true;
    void this.runRepair();
    return { started: true, message: "Character guild attribution repair started in background" };
  }

  private async runRepair(): Promise<void> {
    let taskId = "";
    try {
      taskId = await taskTracker.start("Reconcile Character Guild Attribution", { source: "manual" });
      const result = await this.reconcile(false);
      await taskTracker.complete(taskId, result);
      logger.info(
        `[CharacterGuildAttribution] Repaired ${result.writtenCharacters} characters: ${result.currentGuildsChanged} current guilds changed, ` +
          `${result.historyEntriesRemoved} report-derived history entries removed`,
      );
    } catch (error) {
      logger.error("[CharacterGuildAttribution] Repair failed:", error);
      if (taskId) await taskTracker.fail(taskId, error instanceof Error ? error.message : String(error));
    } finally {
      this.isRunning = false;
    }
  }

  private async reconcile(dryRun: boolean): Promise<CharacterGuildAttributionRepairResult> {
    const [reportOwnerRows, wclGuildRows, latestWclRows] = await Promise.all([
      CharacterReportAppearance.aggregate<ReportOwnerRangeRow>([
        { $match: { characterId: { $type: "objectId" } } },
        {
          $group: {
            _id: {
              characterId: "$characterId",
              guildName: { $toLower: { $trim: { input: "$reportGuildName" } } },
              guildRealm: { $toLower: { $trim: { input: "$reportGuildRealm" } } },
            },
            firstSeenAt: { $min: "$reportStartTime" },
            lastSeenAt: { $max: "$reportStartTime" },
          },
        },
      ]).allowDiskUse(true),
      CharacterReportAppearance.aggregate<WclGuildRangeRow>([
        {
          $match: {
            characterId: { $type: "objectId" },
            appearanceSource: "rankedCharacters",
            updatedAt: { $type: "date" },
            "wclGuilds.0.name": { $type: "string" },
            "wclGuilds.0.realm": { $type: "string" },
          },
        },
        {
          $project: {
            characterId: 1,
            observedAt: "$updatedAt",
            guild: { $arrayElemAt: ["$wclGuilds", 0] },
          },
        },
        { $sort: { observedAt: 1, _id: 1 } },
        {
          $group: {
            _id: {
              characterId: "$characterId",
              guildName: { $toLower: { $trim: { input: "$guild.name" } } },
              guildRealm: { $toLower: { $trim: { input: "$guild.realm" } } },
            },
            name: { $last: "$guild.name" },
            realm: { $last: "$guild.realm" },
            firstSeenAt: { $min: "$observedAt" },
            lastSeenAt: { $max: "$observedAt" },
          },
        },
      ]).allowDiskUse(true),
      CharacterReportAppearance.aggregate<LatestWclGuildRow>([
        {
          $match: {
            characterId: { $type: "objectId" },
            appearanceSource: "rankedCharacters",
            updatedAt: { $type: "date" },
          },
        },
        { $sort: { characterId: 1, updatedAt: 1, _id: 1 } },
        {
          $project: {
            characterId: 1,
            observedAt: "$updatedAt",
            guild: { $ifNull: [{ $arrayElemAt: ["$wclGuilds", 0] }, null] },
          },
        },
        {
          $group: {
            _id: "$characterId",
            observedAt: { $last: "$observedAt" },
            guild: { $last: "$guild" },
          },
        },
      ]).allowDiskUse(true),
    ]);

    const reportOwnersByCharacter = new Map<string, GuildEvidenceRange[]>();
    for (const row of reportOwnerRows) {
      const characterId = String(row._id.characterId);
      const ranges = reportOwnersByCharacter.get(characterId) ?? [];
      ranges.push({
        guildName: row._id.guildName,
        guildRealm: row._id.guildRealm,
        firstSeenAt: new Date(row.firstSeenAt),
        lastSeenAt: new Date(row.lastSeenAt),
      });
      reportOwnersByCharacter.set(characterId, ranges);
    }

    const wclGuildsByCharacter = new Map<string, GuildEvidenceRange[]>();
    for (const row of wclGuildRows) {
      const characterId = String(row._id.characterId);
      const ranges = wclGuildsByCharacter.get(characterId) ?? [];
      ranges.push({
        guildName: row.name,
        guildRealm: row.realm,
        firstSeenAt: new Date(row.firstSeenAt),
        lastSeenAt: new Date(row.lastSeenAt),
      });
      wclGuildsByCharacter.set(characterId, ranges);
    }

    const latestWclByCharacter = new Map<string, LatestGuildObservation>();
    for (const row of latestWclRows) {
      latestWclByCharacter.set(String(row._id), {
        observedAt: new Date(row.observedAt),
        guild: row.guild?.name && row.guild?.realm ? { name: row.guild.name, realm: row.guild.realm } : null,
      });
    }

    const characterIds = Array.from(
      new Set([...reportOwnersByCharacter.keys(), ...wclGuildsByCharacter.keys(), ...latestWclByCharacter.keys()]),
      (characterId) => new mongoose.Types.ObjectId(characterId),
    );
    const result: CharacterGuildAttributionRepairResult = {
      dryRun,
      evidenceCharacters: characterIds.length,
      scannedCharacters: 0,
      repairedCharacters: 0,
      writtenCharacters: 0,
      currentGuildsChanged: 0,
      currentGuildsCleared: 0,
      historyEntriesRemoved: 0,
      historyEntriesAdded: 0,
      historyEntriesRewritten: 0,
    };
    let operations: any[] = [];

    const flush = async () => {
      if (dryRun || operations.length === 0) {
        operations = [];
        return;
      }
      const writeResult = await Character.bulkWrite(operations, { ordered: false });
      result.writtenCharacters += writeResult.modifiedCount;
      operations = [];
    };

    const cursor = Character.find({ _id: { $in: characterIds } })
      .select("_id guildName guildRealm guildUpdatedAt guildHistory")
      .lean()
      .cursor();
    for await (const character of cursor) {
      result.scannedCharacters += 1;
      const characterId = String(character._id);
      const plan = planCharacterGuildAttributionRepair(
        character,
        reportOwnersByCharacter.get(characterId) ?? [],
        wclGuildsByCharacter.get(characterId) ?? [],
        latestWclByCharacter.get(characterId) ?? null,
      );
      if (!plan) continue;

      result.repairedCharacters += 1;
      if (plan.currentGuildChanged) result.currentGuildsChanged += 1;
      if (plan.currentGuildCleared) result.currentGuildsCleared += 1;
      result.historyEntriesRemoved += plan.historyEntriesRemoved;
      result.historyEntriesAdded += plan.historyEntriesAdded;
      result.historyEntriesRewritten += plan.historyEntriesRewritten;
      operations.push({
        updateOne: {
          filter: { _id: character._id },
          update: {
            $set: {
              guildName: plan.guildName,
              guildRealm: plan.guildRealm,
              guildUpdatedAt: plan.guildUpdatedAt,
              guildHistory: plan.guildHistory,
            },
          },
        },
      });
      if (operations.length >= 500) await flush();
    }
    await flush();

    if (!dryRun && result.writtenCharacters > 0) {
      await Promise.all([cacheService.invalidatePattern(/^characters:profile:/), cacheService.invalidatePattern(/^mythic-plus:/)]);
    }
    return result;
  }
}

export default new CharacterGuildAttributionRepairService();
