import mongoose from "mongoose";
import { CHARACTER_ACCOUNT_SIGNAL_VERSION } from "../config/achievement-signals";
import Character, { ICharacter } from "../models/Character";
import CharacterAccountGroup from "../models/CharacterAccountGroup";
import CharacterAchievementFetchQueue from "../models/CharacterAchievementFetchQueue";
import CharacterAchievementFingerprint from "../models/CharacterAchievementFingerprint";
import CharacterMedia from "../models/CharacterMedia";
import CharacterMediaFetchQueue from "../models/CharacterMediaFetchQueue";
import CharacterReportAppearance from "../models/CharacterReportAppearance";
import CcgCard from "../models/CcgCard";
import { resolveBlizzardCharacterIdentity } from "../utils/character-identity";
import { normalizeRealmSlug, toBlizzardRealmSlug } from "../utils/realm";
import characterAchievementService, {
  buildCharacterAchievementSnapshotKey,
  CharacterAchievementTargetedEnqueueResult,
} from "./character-achievement.service";
import { buildObservedIdentityGuard } from "./character-observed-identity.service";
import characterMediaService, { CharacterCardMediaSyncResult, syncCardsFromCurrentMedia } from "./character-media.service";
import cacheService from "./cache.service";
import mythicPlusService, { MythicPlusIdentityRepairResult } from "./mythic-plus.service";

const BATCH_SIZE = 1000;

type Identity = {
  name: string;
  realm: string;
  region: string;
};

type LatestObservedIdentity = Identity & {
  characterId: mongoose.Types.ObjectId;
  observedAt: Date;
};

type CharacterRow = Pick<
  ICharacter,
  "_id" | "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "lastReportSeenAt" | "blizzardIdentityOverride"
>;

type IdentityRepairCandidate = {
  character: CharacterRow;
  latest: LatestObservedIdentity;
  desiredBlizzardIdentity: Identity;
  identityMismatch: boolean;
  timestampNeedsUpdate: boolean;
};

export type CharacterIdentityRepairSample = {
  characterId: string;
  wclCanonicalCharacterId: number;
  classID: number;
  current: Identity;
  latest: Identity;
  observedAt: Date;
};

export type CharacterIdentityRepairAnalysis = {
  charactersWithHistory: number;
  identityDifferences: number;
  identityMismatches: number;
  skippedNewerObservations: number;
  observationTimestampsToSeed: number;
  characterUpdatesPlanned: number;
  mediaRefreshes: number;
  achievementRefreshes: number;
  mediaQueueIdentityRepairs: number;
  achievementQueueIdentityRepairs: number;
  cardsNeedingSync: number;
  accountGroupMembersNeedingRebuild: number;
  accountGroupsNeedingRebuild: number;
  samples: CharacterIdentityRepairSample[];
};

export type CharacterIdentityRepairApplyResult = {
  charactersModified: number;
  cards: CharacterCardMediaSyncResult;
  mediaQueued: number;
  mediaQueueRowsModified: number;
  achievements: CharacterAchievementTargetedEnqueueResult;
  achievementQueueRowsModified: number;
  accountGroupsRebuilt: number;
  mythicPlus: MythicPlusIdentityRepairResult;
};

export type CharacterIdentityRepairResult = {
  mode: "dry-run" | "apply";
  analysis: CharacterIdentityRepairAnalysis;
  applied: CharacterIdentityRepairApplyResult | null;
};

type CharacterIdentityRepairPlan = {
  analysis: CharacterIdentityRepairAnalysis;
  updates: IdentityRepairCandidate[];
  identityMismatches: IdentityRepairCandidate[];
  mediaRefreshCharacterIds: mongoose.Types.ObjectId[];
  achievementRefreshCharacterIds: mongoose.Types.ObjectId[];
  cardSyncCharacterIds: mongoose.Types.ObjectId[];
};

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

function identitiesMatch(left: Identity, right: Identity): boolean {
  return (
    normalizedText(left.name) === normalizedText(right.name) &&
    normalizeRealmSlug(left.realm) === normalizeRealmSlug(right.realm) &&
    normalizedText(left.region) === normalizedText(right.region)
  );
}

function blizzardMediaIdentityMatches(
  media: { characterName?: string | null; realmSlug?: string | null; region?: string | null },
  identity: Identity,
): boolean {
  return (
    normalizedText(media.characterName) === normalizedText(identity.name) &&
    normalizedText(media.realmSlug) === toBlizzardRealmSlug(identity.realm) &&
    normalizedText(media.region) === normalizedText(identity.region)
  );
}

function observedTimestamp(character: CharacterRow): number {
  return (character.identityObservedAt ?? character.lastReportSeenAt)?.getTime() ?? 0;
}

function uniqueObjectIds(ids: readonly mongoose.Types.ObjectId[]): mongoose.Types.ObjectId[] {
  return [...new Map(ids.map((id) => [String(id), id])).values()];
}

export class CharacterIdentityRepairService {
  async run(apply = false): Promise<CharacterIdentityRepairResult> {
    const plan = await this.buildPlan();
    if (!apply) return { mode: "dry-run", analysis: plan.analysis, applied: null };

    let charactersModified = 0;
    const operations = plan.updates.map((candidate) => ({
      updateOne: {
        filter: {
          _id: candidate.character._id,
          ...buildObservedIdentityGuard(candidate.latest.observedAt),
        },
        update: {
          $set: {
            name: candidate.latest.name,
            realm: candidate.latest.realm,
            region: candidate.latest.region,
            identityObservedAt: candidate.latest.observedAt,
          },
        },
      },
    }));
    for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
      const result = await Character.bulkWrite(operations.slice(offset, offset + BATCH_SIZE), { ordered: false });
      charactersModified += result.modifiedCount ?? 0;
    }

    const safeMismatchIds = await this.findSafelyRepairedMismatchIds(plan.identityMismatches);
    const safeMismatchIdSet = new Set(safeMismatchIds.map(String));
    const safeCardSyncIds = plan.cardSyncCharacterIds.filter((id) => safeMismatchIdSet.has(String(id)));
    const safeMediaRefreshIds = plan.mediaRefreshCharacterIds.filter((id) => safeMismatchIdSet.has(String(id)));
    const safeAchievementRefreshIds = plan.achievementRefreshCharacterIds.filter((id) => safeMismatchIdSet.has(String(id)));

    const queueRowsModified = await this.syncDependentQueueIdentities(plan.identityMismatches, safeMismatchIdSet);
    const cards = await syncCardsFromCurrentMedia(safeCardSyncIds);
    const mediaQueued = await characterMediaService.enqueueCharacters(safeMediaRefreshIds, 200, true);
    const achievements = await characterAchievementService.enqueueCharacters(safeAchievementRefreshIds, 1);
    const mythicPlus =
      safeMismatchIds.length > 0
        ? await mythicPlusService.reconcileCharacterIdentities({ characterIds: safeMismatchIds, limit: safeMismatchIds.length })
        : {
            scannedCharacters: 0,
            identityDriftCandidates: 0,
            processedCharacters: 0,
            jobsSynchronized: 0,
            staleScoreRows: 0,
            staleDungeonRuns: 0,
            queued: 0,
          };
    const accountGroups =
      plan.analysis.identityMismatches > 0 ? await characterAchievementService.rebuildAccountGroups() : null;

    await Promise.all([
      cacheService.invalidatePattern(/^characters:profile:/),
      cacheService.invalidatePattern(/^accounts:/),
      ...(cards.modified > 0 ? [cacheService.invalidatePattern(/^ccg:/)] : []),
    ]);

    return {
      mode: "apply",
      analysis: plan.analysis,
      applied: {
        charactersModified,
        cards,
        mediaQueued,
        mediaQueueRowsModified: queueRowsModified.media,
        achievements,
        achievementQueueRowsModified: queueRowsModified.achievements,
        accountGroupsRebuilt: accountGroups?.groups ?? 0,
        mythicPlus,
      },
    };
  }

  private async buildPlan(): Promise<CharacterIdentityRepairPlan> {
    const latestRows = await CharacterReportAppearance.aggregate<{
      _id: mongoose.Types.ObjectId;
      name: string;
      realm: string;
      region: string;
      observedAt: Date;
    }>([
      { $match: { characterId: { $type: "objectId" } } },
      { $sort: { reportStartTime: -1, _id: -1 } },
      {
        $group: {
          _id: "$characterId",
          name: { $first: "$characterName" },
          realm: { $first: "$characterRealm" },
          region: { $first: "$characterRegion" },
          observedAt: { $first: "$reportStartTime" },
        },
      },
    ]).allowDiskUse(true);
    const latestByCharacterId = new Map<string, LatestObservedIdentity>(
      latestRows.map((row) => [
        String(row._id),
        { characterId: row._id, name: row.name, realm: row.realm, region: row.region, observedAt: row.observedAt },
      ]),
    );
    const characters = await Character.find({ _id: { $in: latestRows.map((row) => row._id) } })
      .select("_id wclCanonicalCharacterId name realm region classID identityObservedAt lastReportSeenAt blizzardIdentityOverride")
      .lean<CharacterRow[]>();

    const updates: IdentityRepairCandidate[] = [];
    const identityMismatches: IdentityRepairCandidate[] = [];
    const identityDifferenceRows: IdentityRepairCandidate[] = [];
    let skippedNewerObservations = 0;
    let observationTimestampsToSeed = 0;

    for (const character of characters) {
      const latest = latestByCharacterId.get(String(character._id));
      if (!latest) continue;
      const identityMismatch = !identitiesMatch(character, latest);
      const latestTimestamp = latest.observedAt.getTime();
      const hasNewerStoredObservation = observedTimestamp(character) > latestTimestamp;
      const timestampNeedsUpdate = character.identityObservedAt?.getTime() !== latestTimestamp;
      const repairedCharacter = {
        ...character,
        name: latest.name,
        realm: latest.realm,
        region: latest.region,
        identityObservedAt: latest.observedAt,
      };
      const candidate: IdentityRepairCandidate = {
        character,
        latest,
        desiredBlizzardIdentity: resolveBlizzardCharacterIdentity(repairedCharacter, latest),
        identityMismatch,
        timestampNeedsUpdate,
      };

      if (identityMismatch) identityDifferenceRows.push(candidate);
      if (hasNewerStoredObservation) {
        if (identityMismatch) skippedNewerObservations += 1;
        continue;
      }
      if (timestampNeedsUpdate) observationTimestampsToSeed += 1;
      if (identityMismatch) identityMismatches.push(candidate);
      if (identityMismatch || timestampNeedsUpdate) updates.push(candidate);
    }

    const mismatchIds = identityMismatches.map((candidate) => candidate.character._id as mongoose.Types.ObjectId);
    const [mediaRows, fingerprintRows, cardRows, accountMemberRows, mediaQueueRows, achievementQueueRows] = await Promise.all([
      CharacterMedia.find({ characterId: { $in: mismatchIds } })
        .select("characterId characterName realmSlug region status mainRawUrl avatarUrl")
        .lean<Array<{
          characterId: mongoose.Types.ObjectId;
          characterName: string;
          realmSlug: string;
          region: string;
          status: string;
          mainRawUrl?: string | null;
          avatarUrl?: string | null;
        }>>(),
      CharacterAchievementFingerprint.find({
        characterId: { $in: mismatchIds },
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      })
        .select("characterId name realm region")
        .lean<Array<{ characterId: mongoose.Types.ObjectId; name: string; realm: string; region: string }>>(),
      CcgCard.find({ characterId: { $in: mismatchIds } })
        .select("characterId renderUrl avatarUrl")
        .lean<Array<{ characterId: mongoose.Types.ObjectId; renderUrl?: string | null; avatarUrl?: string | null }>>(),
      CharacterAccountGroup.aggregate<{
        groupId: mongoose.Types.ObjectId;
        characterId: mongoose.Types.ObjectId;
        name: string;
        realm: string;
        region: string;
      }>([
        { $match: { "members.characterId": { $in: mismatchIds } } },
        { $unwind: "$members" },
        { $match: { "members.characterId": { $in: mismatchIds } } },
        {
          $project: {
            _id: 0,
            groupId: "$_id",
            characterId: "$members.characterId",
            name: "$members.name",
            realm: "$members.realm",
            region: "$members.region",
          },
        },
      ]),
      CharacterMediaFetchQueue.find({ characterId: { $in: mismatchIds } })
        .select("characterId name realm realmSlug region")
        .lean<Array<{ characterId: mongoose.Types.ObjectId; name: string; realm: string; realmSlug: string; region: string }>>(),
      CharacterAchievementFetchQueue.find({
        characterId: { $in: mismatchIds },
        signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
      })
        .select("characterId name realm region snapshotKey")
        .lean<Array<{ characterId: mongoose.Types.ObjectId; name: string; realm: string; region: string; snapshotKey: string }>>(),
    ]);

    const mismatchByCharacterId = new Map(identityMismatches.map((candidate) => [String(candidate.character._id), candidate]));
    const mediaByCharacterId = new Map(mediaRows.map((row) => [String(row.characterId), row]));
    const fingerprintByCharacterId = new Map(fingerprintRows.map((row) => [String(row.characterId), row]));
    const cardCharacterIdSet = new Set(cardRows.map((row) => String(row.characterId)));
    const mediaRefreshCharacterIds: mongoose.Types.ObjectId[] = [];
    const achievementRefreshCharacterIds: mongoose.Types.ObjectId[] = [];
    const cardSyncCharacterIdSet = new Set<string>();
    let cardsNeedingSync = 0;

    for (const candidate of identityMismatches) {
      const characterId = candidate.character._id as mongoose.Types.ObjectId;
      const media = mediaByCharacterId.get(String(characterId));
      const mediaMatches = Boolean(
        media &&
          media.status === "available" &&
          media.mainRawUrl &&
          blizzardMediaIdentityMatches(media, candidate.desiredBlizzardIdentity),
      );
      const hasDependentCards = cardCharacterIdSet.has(String(characterId));
      const existingMediaIdentityMismatch = Boolean(media && !blizzardMediaIdentityMatches(media, candidate.desiredBlizzardIdentity));
      if (existingMediaIdentityMismatch || (hasDependentCards && !mediaMatches)) mediaRefreshCharacterIds.push(characterId);

      const fingerprint = fingerprintByCharacterId.get(String(characterId));
      if (fingerprint && !identitiesMatch(fingerprint, candidate.desiredBlizzardIdentity)) {
        achievementRefreshCharacterIds.push(characterId);
      }
    }

    for (const card of cardRows) {
      const candidate = mismatchByCharacterId.get(String(card.characterId));
      const media = mediaByCharacterId.get(String(card.characterId));
      if (!candidate || !media || !media.mainRawUrl || !blizzardMediaIdentityMatches(media, candidate.desiredBlizzardIdentity)) continue;
      if (card.renderUrl !== media.mainRawUrl || (card.avatarUrl ?? null) !== (media.avatarUrl ?? null)) {
        cardsNeedingSync += 1;
        cardSyncCharacterIdSet.add(String(card.characterId));
      }
    }

    const staleAccountMembers = accountMemberRows.filter((member) => {
      const candidate = mismatchByCharacterId.get(String(member.characterId));
      return candidate ? !identitiesMatch(member, candidate.latest) : false;
    });
    const accountGroupIds = new Set(staleAccountMembers.map((member) => String(member.groupId)));
    const mediaQueueIdentityRepairs = mediaQueueRows.filter((row) => {
      const candidate = mismatchByCharacterId.get(String(row.characterId));
      return candidate ? !blizzardMediaIdentityMatches({ characterName: row.name, realmSlug: row.realmSlug, region: row.region }, candidate.desiredBlizzardIdentity) : false;
    }).length;
    const achievementQueueIdentityRepairs = achievementQueueRows.filter((row) => {
      const candidate = mismatchByCharacterId.get(String(row.characterId));
      if (!candidate) return false;
      const desired = {
        ...candidate.character,
        ...candidate.desiredBlizzardIdentity,
      };
      return !identitiesMatch(row, candidate.desiredBlizzardIdentity) || row.snapshotKey !== buildCharacterAchievementSnapshotKey(desired);
    }).length;
    const samples = identityMismatches
      .slice()
      .sort((left, right) => left.latest.name.localeCompare(right.latest.name))
      .slice(0, 20)
      .map((candidate) => ({
        characterId: String(candidate.character._id),
        wclCanonicalCharacterId: candidate.character.wclCanonicalCharacterId,
        classID: candidate.character.classID,
        current: { name: candidate.character.name, realm: candidate.character.realm, region: candidate.character.region },
        latest: { name: candidate.latest.name, realm: candidate.latest.realm, region: candidate.latest.region },
        observedAt: candidate.latest.observedAt,
      }));

    return {
      analysis: {
        charactersWithHistory: characters.length,
        identityDifferences: identityDifferenceRows.length,
        identityMismatches: identityMismatches.length,
        skippedNewerObservations,
        observationTimestampsToSeed,
        characterUpdatesPlanned: updates.length,
        mediaRefreshes: mediaRefreshCharacterIds.length,
        achievementRefreshes: achievementRefreshCharacterIds.length,
        mediaQueueIdentityRepairs,
        achievementQueueIdentityRepairs,
        cardsNeedingSync,
        accountGroupMembersNeedingRebuild: staleAccountMembers.length,
        accountGroupsNeedingRebuild: accountGroupIds.size,
        samples,
      },
      updates,
      identityMismatches,
      mediaRefreshCharacterIds: uniqueObjectIds(mediaRefreshCharacterIds),
      achievementRefreshCharacterIds: uniqueObjectIds(achievementRefreshCharacterIds),
      cardSyncCharacterIds: [...cardSyncCharacterIdSet].map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  private async findSafelyRepairedMismatchIds(candidates: IdentityRepairCandidate[]): Promise<mongoose.Types.ObjectId[]> {
    if (candidates.length === 0) return [];
    const candidateById = new Map(candidates.map((candidate) => [String(candidate.character._id), candidate]));
    const rows = await Character.find({ _id: { $in: candidates.map((candidate) => candidate.character._id) } })
      .select("_id name realm region identityObservedAt")
      .lean<Array<Pick<ICharacter, "_id" | "name" | "realm" | "region" | "identityObservedAt">>>();
    return rows
      .filter((row) => {
        const candidate = candidateById.get(String(row._id));
        return (
          candidate &&
          identitiesMatch(row, candidate.latest) &&
          (row.identityObservedAt?.getTime() ?? 0) >= candidate.latest.observedAt.getTime()
        );
      })
      .map((row) => row._id as mongoose.Types.ObjectId);
  }

  private async syncDependentQueueIdentities(
    candidates: IdentityRepairCandidate[],
    safeMismatchIdSet: ReadonlySet<string>,
  ): Promise<{ media: number; achievements: number }> {
    const safeCandidates = candidates.filter((candidate) => safeMismatchIdSet.has(String(candidate.character._id)));
    const mediaOperations = safeCandidates.map((candidate) => ({
      updateOne: {
        filter: { characterId: candidate.character._id },
        update: {
          $set: {
            name: candidate.desiredBlizzardIdentity.name,
            realm: candidate.desiredBlizzardIdentity.realm,
            realmSlug: toBlizzardRealmSlug(candidate.desiredBlizzardIdentity.realm),
            region: candidate.desiredBlizzardIdentity.region.toLowerCase(),
          },
        },
      },
    }));
    const achievementOperations = safeCandidates.map((candidate) => {
      const desired = { ...candidate.character, ...candidate.desiredBlizzardIdentity };
      return {
        updateOne: {
          filter: {
            characterId: candidate.character._id,
            signalVersion: CHARACTER_ACCOUNT_SIGNAL_VERSION,
          },
          update: {
            $set: {
              wclCanonicalCharacterId: candidate.character.wclCanonicalCharacterId,
              name: desired.name,
              realm: desired.realm,
              region: desired.region,
              classID: candidate.character.classID,
              snapshotKey: buildCharacterAchievementSnapshotKey(desired),
            },
          },
        },
      };
    });

    let media = 0;
    let achievements = 0;
    for (let offset = 0; offset < mediaOperations.length; offset += BATCH_SIZE) {
      const result = await CharacterMediaFetchQueue.bulkWrite(mediaOperations.slice(offset, offset + BATCH_SIZE), { ordered: false });
      media += result.modifiedCount ?? 0;
    }
    for (let offset = 0; offset < achievementOperations.length; offset += BATCH_SIZE) {
      const result = await CharacterAchievementFetchQueue.bulkWrite(achievementOperations.slice(offset, offset + BATCH_SIZE), { ordered: false });
      achievements += result.modifiedCount ?? 0;
    }
    return { media, achievements };
  }
}

const characterIdentityRepairService = new CharacterIdentityRepairService();

export default characterIdentityRepairService;
