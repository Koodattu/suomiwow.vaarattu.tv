import mongoose, { ClientSession } from "mongoose";
import CcgAlternativeArt from "../models/CcgAlternativeArt";
import CcgCard from "../models/CcgCard";
import CcgCommunityCharacter from "../models/CcgCommunityCharacter";
import CcgOwnership from "../models/CcgOwnership";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import CcgSet from "../models/CcgSet";
import Character, { ICharacter } from "../models/Character";
import CharacterContinuityLink from "../models/CharacterContinuityLink";
import TwitchCcgRedemption from "../models/TwitchCcgRedemption";
import { isBlizzardIdentityOverrideActive } from "../utils/character-identity";
import { CharacterContinuityGraph } from "../utils/character-continuity";
import { createCharacterCollectorKey, createWowCharacterIdentityKey } from "../utils/ccg-identity";
import logger from "../utils/logger";
import characterContinuityService from "./character-continuity.service";

const CASE_INSENSITIVE_COLLATION = { locale: "en", strength: 2 } as const;

type TrackedCharacter = Pick<
  ICharacter,
  "_id" | "wclCanonicalCharacterId" | "name" | "realm" | "region" | "classID" | "identityObservedAt" | "blizzardIdentityOverride"
>;

export type CcgCharacterIdentityReconciliation = {
  scannedCommunityCharacters: number;
  linkedCommunityCharacters: number;
  normalizedContinuityClusters: number;
  migratedOwnershipRows: number;
  migratedSeriesRows: number;
  skippedAmbiguousCommunityCharacters: number;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function characterIdentityKeys(character: TrackedCharacter): string[] {
  const keys = [createWowCharacterIdentityKey(character.region, character.realm, character.name)];
  if (character.blizzardIdentityOverride && isBlizzardIdentityOverrideActive(character)) {
    keys.push(createWowCharacterIdentityKey(
      character.region,
      character.blizzardIdentityOverride.realm,
      character.blizzardIdentityOverride.name,
    ));
  }
  return keys;
}

function ownershipKey(row: { ownerType: string; ownerId: unknown; finish: string }): string {
  return `${row.ownerType}:${row.ownerId}:${row.finish}`;
}

function seriesOwnershipKey(row: { ownerType: string; ownerId: unknown }): string {
  return `${row.ownerType}:${row.ownerId}`;
}

class CcgCharacterIdentityService {
  async resolveTrackedCharacter(input: {
    name: string;
    realm: string;
    region: string;
    classID: number;
    preferredCharacterId?: mongoose.Types.ObjectId | string | null;
  }, continuityGraph?: CharacterContinuityGraph): Promise<TrackedCharacter | null> {
    const graph = continuityGraph ?? await characterContinuityService.getGraph();
    if (input.preferredCharacterId && mongoose.Types.ObjectId.isValid(String(input.preferredCharacterId))) {
      const root = await Character.findById(graph.resolveRoot(input.preferredCharacterId))
        .select("wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
        .lean<TrackedCharacter>();
      if (root) return root;
    }

    const namePattern = new RegExp(`^${escapeRegex(input.name)}$`, "i");
    const candidates = await Character.find({
      region: input.region,
      classID: input.classID,
      $or: [
        { name: namePattern },
        { "blizzardIdentityOverride.name": namePattern },
      ],
    })
      .collation(CASE_INSENSITIVE_COLLATION)
      .select("wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
      .lean<TrackedCharacter[]>();
    const identityKey = createWowCharacterIdentityKey(input.region, input.realm, input.name);
    const rootIds = [...new Set(candidates
      .filter((candidate) => characterIdentityKeys(candidate).includes(identityKey))
      .map((candidate) => graph.resolveRoot(candidate._id)))];
    if (rootIds.length === 0) return null;
    if (rootIds.length > 1) {
      throw new Error(`Multiple tracked characters resolve to ${input.name}-${input.realm}; combine them before linking the Community card`);
    }
    return Character.findById(rootIds[0])
      .select("wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
      .lean<TrackedCharacter>();
  }

  private async mergeAlternativeArt(sourceCollectorKeys: Iterable<string>, targetCollectorKey: string, session: ClientSession): Promise<void> {
    for (const sourceCollectorKey of new Set(sourceCollectorKeys)) {
      if (!sourceCollectorKey || sourceCollectorKey === targetCollectorKey) continue;
      const [source, target] = await Promise.all([
        CcgAlternativeArt.findOne({ collectorKey: sourceCollectorKey }).session(session).lean(),
        CcgAlternativeArt.findOne({ collectorKey: targetCollectorKey }).session(session).lean(),
      ]);
      if (!source) continue;
      if (!target) {
        await CcgAlternativeArt.collection.updateOne(
          { _id: source._id },
          { $set: { collectorKey: targetCollectorKey } },
          { session },
        );
        continue;
      }

      const characterArtFilename = target.characterArtFilename ?? source.characterArtFilename ?? null;
      const backgroundArtFilename = target.backgroundArtFilename ?? source.backgroundArtFilename ?? null;
      await CcgAlternativeArt.collection.updateOne(
        { _id: target._id },
        {
          $set: {
            characterArtFilename,
            characterArtEnabled: Boolean(characterArtFilename && (target.characterArtEnabled || source.characterArtEnabled)),
            backgroundArtFilename,
            backgroundArtEnabled: Boolean(backgroundArtFilename && (target.backgroundArtEnabled || source.backgroundArtEnabled)),
            quipText: target.quipText ?? source.quipText ?? null,
            quipAudioFilename: target.quipAudioFilename ?? source.quipAudioFilename ?? null,
          },
        },
        { session },
      );
      await CcgAlternativeArt.collection.deleteOne({ _id: source._id }, { session });
    }
  }

  private async normalizeContinuityCluster(
    rootCharacterId: mongoose.Types.ObjectId,
    memberCharacterIds: mongoose.Types.ObjectId[],
    session: ClientSession,
  ): Promise<mongoose.Types.ObjectId[]> {
    const collectorKey = createCharacterCollectorKey(rootCharacterId);
    const cards = await CcgCard.find({ characterId: { $in: memberCharacterIds } })
      .select("setId characterId collectorKey")
      .session(session)
      .lean();
    if (cards.length === 0) return [];

    await this.mergeAlternativeArt(cards.map((card) => card.collectorKey ?? createCharacterCollectorKey(card.characterId)), collectorKey, session);
    await CcgCard.collection.updateMany(
      { characterId: { $in: memberCharacterIds }, collectorKey: { $ne: collectorKey } },
      { $set: { collectorKey } },
      { session },
    );
    await CcgCommunityCharacter.updateMany(
      { linkedCharacterId: { $in: memberCharacterIds } },
      { $set: { linkedCharacterId: rootCharacterId, collectorKey } },
      { session },
    );
    return [...new Map(cards.map((card) => [String(card.setId), card.setId])).values()];
  }

  private async migrateOwnership(
    cardId: mongoose.Types.ObjectId,
    setId: mongoose.Types.ObjectId,
    sourceCharacterId: mongoose.Types.ObjectId,
    targetCharacterId: mongoose.Types.ObjectId,
    session: ClientSession,
  ): Promise<{ ownershipRows: number; seriesRows: number }> {
    if (sourceCharacterId.equals(targetCharacterId)) return { ownershipRows: 0, seriesRows: 0 };

    const sourceOwnershipRows = await CcgOwnership.find({ setId, characterId: sourceCharacterId })
      .session(session)
      .lean();
    const targetOwnershipRows = sourceOwnershipRows.length > 0
      ? await CcgOwnership.find({
          setId,
          characterId: targetCharacterId,
          $or: sourceOwnershipRows.map((row) => ({ ownerType: row.ownerType, ownerId: row.ownerId, finish: row.finish })),
        }).session(session).lean()
      : [];
    const targetOwnershipByKey = new Map(targetOwnershipRows.map((row) => [ownershipKey(row), row]));
    const ownershipOperations: mongoose.mongo.AnyBulkWriteOperation[] = [];
    for (const source of sourceOwnershipRows) {
      const target = targetOwnershipByKey.get(ownershipKey(source));
      if (target) {
        ownershipOperations.push({
          updateOne: {
            filter: { _id: target._id },
            update: {
              $inc: { quantity: source.quantity, alternativeQuantity: source.alternativeQuantity ?? 0 },
              $min: { firstAcquiredAt: source.firstAcquiredAt },
              $max: { lastAcquiredAt: source.lastAcquiredAt },
            },
          },
        });
        ownershipOperations.push({ deleteOne: { filter: { _id: source._id } } });
      } else {
        ownershipOperations.push({
          updateOne: {
            filter: { _id: source._id },
            update: { $set: { characterId: targetCharacterId } },
          },
        });
      }
    }
    if (ownershipOperations.length > 0) {
      await CcgOwnership.collection.bulkWrite(ownershipOperations, { ordered: true, session });
    }

    const sourceSeriesRows = await CcgSeriesOwnership.find({ setId, characterId: sourceCharacterId })
      .session(session)
      .lean();
    const targetSeriesRows = sourceSeriesRows.length > 0
      ? await CcgSeriesOwnership.find({
          setId,
          characterId: targetCharacterId,
          $or: sourceSeriesRows.map((row) => ({ ownerType: row.ownerType, ownerId: row.ownerId })),
        }).session(session).lean()
      : [];
    const targetSeriesByKey = new Map(targetSeriesRows.map((row) => [seriesOwnershipKey(row), row]));
    const seriesOperations: mongoose.mongo.AnyBulkWriteOperation[] = [];
    for (const source of sourceSeriesRows) {
      const target = targetSeriesByKey.get(seriesOwnershipKey(source));
      if (target) {
        seriesOperations.push({
          updateOne: {
            filter: { _id: target._id },
            update: {
              $addToSet: { unlockedSnapshotVersions: { $each: source.unlockedSnapshotVersions } },
              $min: { firstAcquiredAt: source.firstAcquiredAt },
              $max: { lastAcquiredAt: source.lastAcquiredAt },
            },
          },
        });
        seriesOperations.push({ deleteOne: { filter: { _id: source._id } } });
      } else {
        seriesOperations.push({
          updateOne: {
            filter: { _id: source._id },
            update: { $set: { characterId: targetCharacterId } },
          },
        });
      }
    }
    if (seriesOperations.length > 0) {
      await CcgSeriesOwnership.collection.bulkWrite(seriesOperations, { ordered: true, session });
    }

    await Promise.all([
      TwitchCcgRedemption.collection.updateMany(
        { "assignedCard.cardId": cardId },
        { $set: { "assignedCard.characterId": targetCharacterId } },
        { session },
      ),
      TwitchCcgRedemption.collection.updateMany(
        { "assignedCards.cardId": cardId },
        { $set: { "assignedCards.$[card].characterId": targetCharacterId } },
        { arrayFilters: [{ "card.cardId": cardId }], session },
      ),
    ]);
    return { ownershipRows: sourceOwnershipRows.length, seriesRows: sourceSeriesRows.length };
  }

  private async reconcileCommunityCharacter(
    communityId: mongoose.Types.ObjectId,
    targetCharacter: TrackedCharacter,
    graph: CharacterContinuityGraph,
    session: ClientSession,
  ): Promise<{ changed: boolean; ownershipRows: number; seriesRows: number }> {
    const community = await CcgCommunityCharacter.findById(communityId).session(session).lean();
    if (!community) return { changed: false, ownershipRows: 0, seriesRows: 0 };
    const rootCharacterId = new mongoose.Types.ObjectId(graph.resolveRoot(targetCharacter._id));
    const rootCharacter = String(targetCharacter._id) === String(rootCharacterId)
      ? targetCharacter
      : await Character.findById(rootCharacterId)
          .select("wclCanonicalCharacterId name realm region classID identityObservedAt blizzardIdentityOverride")
          .session(session)
          .lean<TrackedCharacter>();
    if (!rootCharacter || rootCharacter.classID !== community.classID) {
      throw new Error(`Community character ${community.name}-${community.realm} does not match the tracked character class`);
    }

    const memberCharacterIds = graph.getMemberIds(rootCharacterId).map((id) => new mongoose.Types.ObjectId(id));
    const collectorKey = createCharacterCollectorKey(rootCharacterId);
    const changedSetIds = await this.normalizeContinuityCluster(rootCharacterId, memberCharacterIds, session);
    const card = community.cardId
      ? await CcgCard.findById(community.cardId).session(session).lean()
      : null;
    let migrated = { ownershipRows: 0, seriesRows: 0 };
    if (card) {
      const sourceCharacterId = new mongoose.Types.ObjectId(String(card.characterId));
      if (!sourceCharacterId.equals(rootCharacterId)) {
        const conflict = await CcgCard.findOne({
          _id: { $ne: card._id },
          setId: card.setId,
          characterId: rootCharacterId,
          snapshotVersion: card.snapshotVersion,
        }).session(session).select("_id").lean();
        if (conflict) {
          throw new Error(`Community character ${community.name}-${community.realm} already has another card for the linked identity`);
        }
        migrated = await this.migrateOwnership(card._id, card.setId, sourceCharacterId, rootCharacterId, session);
      }
      await this.mergeAlternativeArt([community.collectorKey, card.collectorKey ?? ""], collectorKey, session);
      await CcgCard.collection.updateOne(
        { _id: card._id },
        {
          $set: {
            characterId: rootCharacterId,
            collectorKey,
            wclCanonicalCharacterId: rootCharacter.wclCanonicalCharacterId,
          },
        },
        { session },
      );
      changedSetIds.push(card.setId);
    }

    const changed = String(community.linkedCharacterId ?? "") !== String(rootCharacterId)
      || community.collectorKey !== collectorKey
      || Boolean(card && (String(card.characterId) !== String(rootCharacterId) || card.collectorKey !== collectorKey));
    await CcgCommunityCharacter.updateOne(
      { _id: community._id },
      { $set: { linkedCharacterId: rootCharacterId, collectorKey } },
      { session },
    );
    if (changedSetIds.length > 0) {
      await CcgSet.updateMany(
        { _id: { $in: [...new Map(changedSetIds.map((id) => [String(id), id])).values()] } },
        { $set: { collectionCharactersBuiltAt: null } },
        { session },
      );
    }
    return { changed, ...migrated };
  }

  async reconcileCommunityById(communityId: mongoose.Types.ObjectId | string): Promise<{
    changed: boolean;
    ownershipRows: number;
    seriesRows: number;
  }> {
    const graph = await characterContinuityService.getGraph();
    const community = await CcgCommunityCharacter.findById(communityId)
      .select("_id linkedCharacterId name realm region classID")
      .lean();
    if (!community) return { changed: false, ownershipRows: 0, seriesRows: 0 };
    const target = await this.resolveTrackedCharacter({
      name: community.name,
      realm: community.realm,
      region: community.region,
      classID: community.classID,
      preferredCharacterId: community.linkedCharacterId,
    }, graph);
    if (!target) return { changed: false, ownershipRows: 0, seriesRows: 0 };

    const session = await mongoose.startSession();
    try {
      let reconciliation = { changed: false, ownershipRows: 0, seriesRows: 0 };
      await session.withTransaction(async () => {
        reconciliation = await this.reconcileCommunityCharacter(community._id, target, graph, session);
      });
      return reconciliation;
    } finally {
      await session.endSession();
    }
  }

  async reconcileAll(): Promise<CcgCharacterIdentityReconciliation> {
    const [graph, continuityLinks, communityCharacters] = await Promise.all([
      characterContinuityService.getGraph(),
      CharacterContinuityLink.find({}).select("sourceCharacterId targetCharacterId").lean(),
      CcgCommunityCharacter.find({}).select("_id linkedCharacterId name realm region classID").lean(),
    ]);
    const result: CcgCharacterIdentityReconciliation = {
      scannedCommunityCharacters: communityCharacters.length,
      linkedCommunityCharacters: 0,
      normalizedContinuityClusters: 0,
      migratedOwnershipRows: 0,
      migratedSeriesRows: 0,
      skippedAmbiguousCommunityCharacters: 0,
    };

    const continuityRoots = new Map<string, mongoose.Types.ObjectId[]>();
    for (const link of continuityLinks) {
      const rootId = graph.resolveRoot(link.targetCharacterId);
      continuityRoots.set(rootId, graph.getMemberIds(rootId).map((id) => new mongoose.Types.ObjectId(id)));
    }
    for (const community of communityCharacters) {
      if (!community.linkedCharacterId) continue;
      const rootId = graph.resolveRoot(community.linkedCharacterId);
      continuityRoots.set(rootId, graph.getMemberIds(rootId).map((id) => new mongoose.Types.ObjectId(id)));
    }
    for (const [rootId, memberIds] of continuityRoots) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const changedSets = await this.normalizeContinuityCluster(new mongoose.Types.ObjectId(rootId), memberIds, session);
          if (changedSets.length > 0) {
            await CcgSet.updateMany(
              { _id: { $in: changedSets } },
              { $set: { collectionCharactersBuiltAt: null } },
              { session },
            );
          }
        });
        result.normalizedContinuityClusters += 1;
      } finally {
        await session.endSession();
      }
    }

    for (const community of communityCharacters) {
      let target: TrackedCharacter | null;
      try {
        target = await this.resolveTrackedCharacter({
          name: community.name,
          realm: community.realm,
          region: community.region,
          classID: community.classID,
          preferredCharacterId: community.linkedCharacterId,
        }, graph);
      } catch (error) {
        result.skippedAmbiguousCommunityCharacters += 1;
        logger.warn(`[CCG] Skipping ambiguous Community identity ${community.name}-${community.realm}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!target) continue;

      const session = await mongoose.startSession();
      try {
        let reconciliation = { changed: false, ownershipRows: 0, seriesRows: 0 };
        await session.withTransaction(async () => {
          reconciliation = await this.reconcileCommunityCharacter(community._id, target!, graph, session);
        });
        if (reconciliation.changed) result.linkedCommunityCharacters += 1;
        result.migratedOwnershipRows += reconciliation.ownershipRows;
        result.migratedSeriesRows += reconciliation.seriesRows;
      } finally {
        await session.endSession();
      }
    }
    return result;
  }
}

export const ccgCharacterIdentityService = new CcgCharacterIdentityService();
export default ccgCharacterIdentityService;
