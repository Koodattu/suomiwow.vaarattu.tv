import mongoose from "mongoose";
import { CLASSES } from "../config/classes";
import { CCG_COMMUNITY_SET, CCG_GRADING_VERSION, CCG_MEDIA_REFRESH_MS, CCG_POOL_VERSION, CCG_THEME_VERSION, CCG_TIER_GRADES, CcgTierGrade } from "../config/ccg";
import CcgCard, { type CcgCommunityScores } from "../models/CcgCard";
import CcgCommunityCharacter from "../models/CcgCommunityCharacter";
import CcgSet from "../models/CcgSet";
import Guild from "../models/Guild";
import { createCharacterCollectorKey, createWowCharacterIdentityKey } from "../utils/ccg-identity";
import { normalizeCommunityRole, normalizeCommunityScores } from "../utils/ccg-community";
import { resolveCardCrop } from "../utils/ccg-random";
import { resolveRole } from "../utils/spec";
import logger from "../utils/logger";
import blizzardService from "./blizzard.service";
import ccgCardAvailabilityService from "./ccg-card-availability.service";
import ccgCharacterIdentityService from "./ccg-character-identity.service";
import ccgPublisherService from "./ccg-publisher.service";
import characterRenderStorageService from "./character-render-storage.service";
import cacheService from "./cache.service";

export class CcgCommunityError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcgCommunityError";
  }
}

type CreateCommunityCharacterInput = {
  name: string;
  realmSlug: string;
  region: string;
  tierGrade?: unknown;
  createdBy: mongoose.Types.ObjectId;
};

type UpdateCommunityCharacterInput = {
  tierGrade?: unknown;
  role?: unknown;
  scores?: unknown;
  active?: unknown;
  refresh?: unknown;
};

function requiredSlug(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CcgCommunityError(400, `invalid_${field}`, `${field} is required`);
  return value.trim().toLowerCase();
}

function validTierGrade(value: unknown): CcgTierGrade {
  if (!CCG_TIER_GRADES.includes(value as CcgTierGrade)) {
    throw new CcgCommunityError(400, "invalid_rarity", "A valid card rarity is required");
  }
  return value as CcgTierGrade;
}

function validId(value: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new CcgCommunityError(400, "invalid_community_id", "A valid Community character ID is required");
  return new mongoose.Types.ObjectId(value);
}

class CcgCommunityService {
  private serialize(row: Record<string, any>, scores?: CcgCommunityScores | null): Record<string, unknown> {
    return {
      id: String(row._id),
      cardId: row.cardId ? String(row.cardId) : null,
      name: row.name,
      realm: row.realm,
      realmSlug: row.realmSlug,
      region: row.region,
      classID: row.classID,
      specName: row.specName,
      role: row.role,
      guildName: row.guildName ?? null,
      guildRealm: row.guildRealm ?? null,
      tierGrade: row.tierGrade,
      scores: {
        performance: scores?.performance ?? null,
        mechanics: scores?.mechanics ?? null,
        combined: scores?.combined ?? null,
        mythicPlus: scores?.mythicPlus ?? null,
      },
      linkedCharacterId: row.linkedCharacterId ? String(row.linkedCharacterId) : null,
      avatarUrl: row.avatarUrl ?? null,
      renderUrl: row.renderUrl,
      renderFit: row.renderFit ?? null,
      active: row.active !== false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async resolveCharacter(
    name: string,
    realmSlug: string,
    region: string,
    preferredCharacterId?: mongoose.Types.ObjectId | string | null,
  ) {
    let profile;
    let media;
    try {
      [profile, media] = await Promise.all([
        blizzardService.getCharacterProfile(name, realmSlug, region),
        blizzardService.getCharacterMedia(name, realmSlug, region),
      ]);
    } catch (error) {
      throw new CcgCommunityError(422, "character_lookup_failed", error instanceof Error ? error.message : "Blizzard character lookup failed");
    }
    if (!media.mainRawUrl) throw new CcgCommunityError(422, "character_render_missing", "Blizzard did not return a character render");

    const classInfo = CLASSES.find((entry) => entry.name.toLowerCase() === profile.character_class.name.toLowerCase());
    if (!classInfo) throw new CcgCommunityError(422, "class_not_supported", `Unsupported character class: ${profile.character_class.name}`);
    const specName = profile.active_spec.name;
    const role = resolveRole(classInfo.id, specName);
    let linkedCharacter;
    try {
      linkedCharacter = await ccgCharacterIdentityService.resolveTrackedCharacter({
        name: profile.name,
        realm: profile.realm.slug,
        region,
        classID: classInfo.id,
        preferredCharacterId,
      });
    } catch (error) {
      throw new CcgCommunityError(409, "community_identity_ambiguous", error instanceof Error ? error.message : "Community character identity is ambiguous");
    }
    const guildName = profile.guild?.name ?? null;
    const guildRealm = profile.guild?.realm?.name ?? (guildName ? profile.realm.name : null);
    const guild = guildName && guildRealm
      ? await Guild.findOne({ name: guildName, realm: guildRealm, region }).collation({ locale: "en", strength: 2 }).select("_id").lean()
      : null;
    return {
      profile,
      media,
      classInfo,
      specName,
      role,
      linkedCharacter,
      guildName,
      guildRealm,
      guild,
      collectorKey: linkedCharacter
        ? createCharacterCollectorKey(linkedCharacter._id)
        : createWowCharacterIdentityKey(region, realmSlug, name),
    };
  }

  async list(): Promise<Array<Record<string, unknown>>> {
    const rows = await CcgCommunityCharacter.find().sort({ createdAt: -1 }).lean();
    const cardIds = rows.flatMap((row) => row.cardId ? [row.cardId] : []);
    const cards = cardIds.length > 0
      ? await CcgCard.find({ _id: { $in: cardIds }, sourcePartition: "community-admin" }).select("_id communityScores").lean()
      : [];
    const scoresByCardId = new Map(cards.map((card) => [String(card._id), card.communityScores ?? null]));
    return rows.map((row) => this.serialize(row, row.cardId ? scoresByCardId.get(String(row.cardId)) : null));
  }

  async create(input: CreateCommunityCharacterInput): Promise<Record<string, unknown>> {
    const name = requiredSlug(input.name, "name");
    const realmSlug = requiredSlug(input.realmSlug, "realm");
    const region = requiredSlug(input.region, "region");
    if (!new Set(["eu", "us", "kr", "tw"]).has(region)) throw new CcgCommunityError(400, "invalid_region", "Unsupported Blizzard region");
    const tierGrade = input.tierGrade === undefined ? "H" : validTierGrade(input.tierGrade);

    const identityKey = createWowCharacterIdentityKey(region, realmSlug, name);
    if (await CcgCommunityCharacter.exists({ identityKey })) {
      throw new CcgCommunityError(409, "community_character_exists", "This character is already in the Community set");
    }

    const resolved = await this.resolveCharacter(name, realmSlug, region);
    const { profile, media, classInfo, specName, role, linkedCharacter, guildName, guildRealm, guild, collectorKey } = resolved;

    await ccgPublisherService.ensureConfiguredSets();
    const set = await CcgSet.findOne({ zoneId: CCG_COMMUNITY_SET.zoneId });
    if (!set) throw new CcgCommunityError(503, "community_set_unavailable", "The Community set is not available");
    const sourceId = linkedCharacter?._id ?? new mongoose.Types.ObjectId();
    const now = new Date();
    let storedRender;
    try {
      storedRender = await characterRenderStorageService.ingest(sourceId, media.mainRawUrl!, now);
    } catch (error) {
      throw new CcgCommunityError(422, "character_render_store_failed", error instanceof Error ? error.message : "Character render could not be stored");
    }
    const community = new CcgCommunityCharacter({
      _id: linkedCharacter ? undefined : sourceId,
      identityKey,
      collectorKey,
      blizzardCharacterId: profile.id,
      linkedCharacterId: linkedCharacter?._id ?? null,
      name: profile.name,
      realm: profile.realm.name,
      realmSlug: profile.realm.slug,
      region,
      classID: classInfo.id,
      specName,
      role,
      guildId: guild?._id ?? null,
      guildName,
      guildRealm,
      tierGrade,
      avatarUrl: media.avatarUrl,
      renderUrl: storedRender.url,
      renderAssetId: storedRender.assetId,
      nextRenderRefreshAt: new Date(now.getTime() + CCG_MEDIA_REFRESH_MS),
      renderFit: storedRender.fit,
      active: true,
      createdBy: input.createdBy,
    });
    const card = new CcgCard({
      setId: set._id,
      setNumber: 0,
      characterId: sourceId,
      collectorKey,
      communityCharacterId: community._id,
      wclCanonicalCharacterId: linkedCharacter?.wclCanonicalCharacterId ?? null,
      name: profile.name,
      realm: profile.realm.name,
      region,
      guildId: guild?._id ?? null,
      guildName,
      guildRealm,
      classID: classInfo.id,
      specName,
      role,
      metric: role === "healer" ? "hps" : "dps",
      itemLevel: 0,
      parseScore: 0,
      survivalScore: 0,
      survivalPercentile: 0,
      combinedScore: 0,
      scoreVersion: 1,
      mythicPlusScore: null,
      communityScores: {
        performance: null,
        mechanics: null,
        combined: null,
        mythicPlus: null,
      },
      tierGrade,
      avatarUrl: media.avatarUrl,
      renderUrl: storedRender.url,
      renderAssetId: storedRender.assetId,
      renderFit: storedRender.fit,
      backgroundCrop: resolveCardCrop(`${set.slug}:${identityKey}`, set.backgroundSafeCrop),
      pulls: 0,
      deaths: 0,
      reportCount: 0,
      mythicReportCount: 0,
      totalKills: 0,
      performanceSnapshotAt: now,
      mediaCapturedAt: now,
      sourcePartition: "community-admin",
      publicationWave: 0,
      gradingVersion: CCG_GRADING_VERSION,
      eligibilityVersion: "community-admin-v1",
      themeVersion: CCG_THEME_VERSION,
      publishedAt: now,
    });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const nextSet = await CcgSet.findOneAndUpdate(
          { _id: set._id, kind: "community" },
          { $set: { lastPublishedAt: now }, $inc: { cardCount: 1, publicationWave: 1 } },
          { returnDocument: "after", session },
        );
        if (!nextSet) throw new CcgCommunityError(503, "community_set_unavailable", "The Community set is not available");
        card.setNumber = nextSet.cardCount;
        card.publicationWave = nextSet.publicationWave;
        await community.save({ session });
        await card.save({ session });
        community.cardId = card._id;
        await community.save({ session });
        await ccgPublisherService.rebuildPool(
          set._id,
          `${CCG_POOL_VERSION}-community-${card.publicationWave}`,
          session,
        );
      });
    } catch (error: any) {
      if (error?.code === 11000) throw new CcgCommunityError(409, "community_character_exists", "This character is already in the Community set");
      throw error;
    } finally {
      await session.endSession();
    }

    return (await this.list()).find((row) => row.id === String(community._id))!;
  }

  async update(id: string, input: UpdateCommunityCharacterInput): Promise<Record<string, unknown>> {
    const communityId = validId(id);
    const community = await CcgCommunityCharacter.findById(communityId);
    if (!community) throw new CcgCommunityError(404, "community_character_not_found", "Community character not found");
    if (!community.cardId) throw new CcgCommunityError(409, "community_card_missing", "The Community card is unavailable");
    const cardId = community.cardId;

    const tierGrade = input.tierGrade === undefined ? community.tierGrade : validTierGrade(input.tierGrade);
    let role = community.role;
    try {
      role = input.role === undefined ? community.role : normalizeCommunityRole(input.role);
    } catch (error) {
      throw new CcgCommunityError(400, "invalid_role", error instanceof Error ? error.message : "Invalid Community role");
    }
    let scores: CcgCommunityScores | undefined;
    try {
      scores = input.scores === undefined ? undefined : normalizeCommunityScores(input.scores);
    } catch (error) {
      throw new CcgCommunityError(400, "invalid_scores", error instanceof Error ? error.message : "Invalid Community metrics");
    }
    if (input.active !== undefined && typeof input.active !== "boolean") {
      throw new CcgCommunityError(400, "invalid_active_state", "Active must be true or false");
    }
    if (input.refresh !== undefined && typeof input.refresh !== "boolean") {
      throw new CcgCommunityError(400, "invalid_refresh_state", "Refresh must be true or false");
    }
    const active = typeof input.active === "boolean" ? input.active : community.active !== false;
    const resolved = input.refresh === true
      ? await this.resolveCharacter(community.name, community.realmSlug, community.region, community.linkedCharacterId)
      : null;
    const now = new Date();
    let refreshedRender = null;
    if (resolved) {
      try {
        refreshedRender = await characterRenderStorageService.ingest(
          community.linkedCharacterId ?? community._id,
          resolved.media.mainRawUrl!,
          now,
        );
      } catch (error) {
        throw new CcgCommunityError(422, "character_render_store_failed", error instanceof Error ? error.message : "Character render could not be stored");
      }
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        community.tierGrade = tierGrade;
        community.role = role;
        community.active = active;
        if (resolved) {
          community.identityKey = createWowCharacterIdentityKey(
            community.region,
            resolved.profile.realm.slug,
            resolved.profile.name,
          );
          community.blizzardCharacterId = resolved.profile.id;
          community.name = resolved.profile.name;
          community.realm = resolved.profile.realm.name;
          community.realmSlug = resolved.profile.realm.slug;
          community.classID = resolved.classInfo.id;
          community.specName = resolved.specName;
          community.guildId = resolved.guild?._id ?? null;
          community.guildName = resolved.guildName;
          community.guildRealm = resolved.guildRealm;
          community.avatarUrl = resolved.media.avatarUrl;
          community.renderUrl = refreshedRender!.url;
          community.renderAssetId = refreshedRender!.assetId;
          community.nextRenderRefreshAt = new Date(now.getTime() + CCG_MEDIA_REFRESH_MS);
          community.renderFit = refreshedRender!.fit;
        }
        await community.save({ session });

        const cardUpdate: Record<string, unknown> = {
          tierGrade,
          role,
          metric: role === "healer" ? "hps" : "dps",
        };
        if (scores !== undefined) cardUpdate.communityScores = scores;
        if (resolved) {
          Object.assign(cardUpdate, {
            name: resolved.profile.name,
            realm: resolved.profile.realm.name,
            guildId: resolved.guild?._id ?? null,
            guildName: resolved.guildName,
            guildRealm: resolved.guildRealm,
            classID: resolved.classInfo.id,
            specName: resolved.specName,
            avatarUrl: resolved.media.avatarUrl,
            renderUrl: refreshedRender!.url,
            renderAssetId: refreshedRender!.assetId,
            renderFit: refreshedRender!.fit,
            mediaCapturedAt: now,
          });
        }
        // Community cards are admin-managed records; raid snapshot cards remain immutable through the model hooks.
        const cardResult = await CcgCard.collection.updateOne(
          { _id: cardId, communityCharacterId: community._id, sourcePartition: "community-admin" },
          { $set: cardUpdate },
          { session },
        );
        if (cardResult.matchedCount !== 1) throw new CcgCommunityError(409, "community_card_missing", "The Community card is unavailable");

        const set = await CcgSet.findOne({ zoneId: CCG_COMMUNITY_SET.zoneId, kind: "community" }).session(session);
        if (!set) throw new CcgCommunityError(503, "community_set_unavailable", "The Community set is not available");
        set.lastPublishedAt = now;
        set.publicationWave += 1;
        await set.save({ session });
        await ccgPublisherService.rebuildPool(
          set._id,
          `${CCG_POOL_VERSION}-community-admin-${set.publicationWave}`,
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    if (resolved) {
      await ccgCardAvailabilityService.noteAvailable(
        community.linkedCharacterId ?? (community._id as mongoose.Types.ObjectId),
        now,
      );
    }

    if (resolved?.linkedCharacter) {
      await ccgCharacterIdentityService.reconcileCommunityById(communityId);
    }

    const updated = (await this.list()).find((row) => row.id === String(communityId));
    if (!updated) throw new CcgCommunityError(404, "community_character_not_found", "Community character not found");
    return updated;
  }

  async remove(id: string): Promise<Record<string, unknown>> {
    return this.update(id, { active: false });
  }

  async refreshDueRenders(limit = 250): Promise<{ candidates: number; refreshed: number; retained: number; failed: number }> {
    const now = new Date();
    const rows = await CcgCommunityCharacter.find({
      active: true,
      $or: [
        { renderAssetId: null },
        { nextRenderRefreshAt: null },
        { nextRenderRefreshAt: { $lte: now } },
      ],
    })
      .sort({ nextRenderRefreshAt: 1, updatedAt: 1 })
      .limit(Math.max(1, Math.min(limit, 1000)));
    let refreshed = 0;
    let retained = 0;
    let failed = 0;

    for (const row of rows) {
      const assetCharacterId = row.linkedCharacterId ?? (row._id as mongoose.Types.ObjectId);
      try {
        const refreshedAt = new Date();
        let stored = !row.renderAssetId
          ? await characterRenderStorageService.ingestExistingSource(assetCharacterId, row.renderUrl, refreshedAt)
          : null;
        let media = null;
        if (!stored) {
          media = await blizzardService.getCharacterMedia(row.name, row.realmSlug, row.region);
          if (!media.mainRawUrl) throw new Error("Blizzard media response contained no full character render");
          stored = await characterRenderStorageService.ingest(assetCharacterId, media.mainRawUrl, refreshedAt);
        }
        if (media) row.avatarUrl = media.avatarUrl;
        row.renderUrl = stored.url;
        row.renderAssetId = stored.assetId;
        row.nextRenderRefreshAt = new Date(refreshedAt.getTime() + CCG_MEDIA_REFRESH_MS);
        row.renderFit = stored.fit;
        await row.save();
        if (row.cardId) {
          await CcgCard.collection.updateOne(
            { _id: row.cardId, communityCharacterId: row._id, sourcePartition: "community-admin" },
            {
              $set: {
                avatarUrl: row.avatarUrl,
                renderUrl: stored.url,
                renderAssetId: stored.assetId,
                renderFit: stored.fit,
                mediaCapturedAt: refreshedAt,
              },
            },
          );
        }
        try {
          await ccgCardAvailabilityService.noteAvailable(assetCharacterId, refreshedAt);
        } catch (availabilityError) {
          logger.error(`[CCG/Community] Failed to restore card availability for ${row._id}:`, availabilityError);
        }
        refreshed += 1;
      } catch (error) {
        const statusMatch = (error instanceof Error ? error.message : String(error)).match(/status (\d{3})/i);
        if (statusMatch?.[1] === "404") {
          row.nextRenderRefreshAt = new Date(Date.now() + CCG_MEDIA_REFRESH_MS);
          await row.save();
          try {
            await ccgCardAvailabilityService.noteNotFound(assetCharacterId, new Date());
          } catch (availabilityError) {
            logger.error(`[CCG/Community] Failed to update card availability for ${row._id}:`, availabilityError);
          }
          retained += 1;
        } else {
          failed += 1;
          logger.error(`[CCG/Community] Failed to validate render for ${row._id}:`, error);
        }
      }
    }
    if (refreshed > 0) await cacheService.invalidatePattern(/^ccg:/);
    return { candidates: rows.length, refreshed, retained, failed };
  }
}

export default new CcgCommunityService();
