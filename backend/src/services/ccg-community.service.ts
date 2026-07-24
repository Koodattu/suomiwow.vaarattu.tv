import mongoose from "mongoose";
import { CLASSES } from "../config/classes";
import { CCG_COMMUNITY_SET, CCG_GRADING_VERSION, CCG_POOL_VERSION, CCG_THEME_VERSION, CCG_TIER_GRADES, CcgTierGrade } from "../config/ccg";
import CcgCard from "../models/CcgCard";
import CcgCommunityCharacter from "../models/CcgCommunityCharacter";
import CcgSet from "../models/CcgSet";
import Character from "../models/Character";
import Guild from "../models/Guild";
import { createCharacterCollectorKey, createWowCharacterIdentityKey } from "../utils/ccg-identity";
import { resolveCardCrop } from "../utils/ccg-random";
import { resolveRole } from "../utils/spec";
import blizzardService from "./blizzard.service";
import ccgPublisherService from "./ccg-publisher.service";

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
  tierGrade: CcgTierGrade;
  createdBy: mongoose.Types.ObjectId;
};

function requiredSlug(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CcgCommunityError(400, `invalid_${field}`, `${field} is required`);
  return value.trim().toLowerCase();
}

class CcgCommunityService {
  async list(): Promise<Array<Record<string, unknown>>> {
    const rows = await CcgCommunityCharacter.find().sort({ createdAt: -1 }).lean();
    return rows.map((row) => ({
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
      linkedCharacterId: row.linkedCharacterId ? String(row.linkedCharacterId) : null,
      renderUrl: row.renderUrl,
      createdAt: row.createdAt,
    }));
  }

  async create(input: CreateCommunityCharacterInput): Promise<Record<string, unknown>> {
    const name = requiredSlug(input.name, "name");
    const realmSlug = requiredSlug(input.realmSlug, "realm");
    const region = requiredSlug(input.region, "region");
    if (!new Set(["eu", "us", "kr", "tw"]).has(region)) throw new CcgCommunityError(400, "invalid_region", "Unsupported Blizzard region");
    if (!CCG_TIER_GRADES.includes(input.tierGrade)) throw new CcgCommunityError(400, "invalid_rarity", "A valid card rarity is required");

    const identityKey = createWowCharacterIdentityKey(region, realmSlug, name);
    if (await CcgCommunityCharacter.exists({ identityKey })) {
      throw new CcgCommunityError(409, "community_character_exists", "This character is already in the Community set");
    }

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

    const linkedCharacter = await Character.findOne({
      name: profile.name,
      realm: { $in: [profile.realm.name, profile.realm.slug] },
      region,
    }).collation({ locale: "en", strength: 2 }).lean();
    const guildName = linkedCharacter?.guildName ?? profile.guild?.name ?? null;
    const guildRealm = linkedCharacter?.guildRealm ?? profile.guild?.realm?.name ?? (guildName ? profile.realm.name : null);
    const guild = guildName && guildRealm
      ? await Guild.findOne({ name: guildName, realm: guildRealm, region }).collation({ locale: "en", strength: 2 }).select("_id").lean()
      : null;
    const existingCard = linkedCharacter
      ? await CcgCard.findOne({ characterId: linkedCharacter._id }).select("collectorKey").sort({ publishedAt: -1 }).lean()
      : null;
    const collectorKey = existingCard?.collectorKey
      ?? (linkedCharacter ? createCharacterCollectorKey(linkedCharacter._id) : identityKey);

    await ccgPublisherService.ensureConfiguredSets();
    const set = await CcgSet.findOne({ zoneId: CCG_COMMUNITY_SET.zoneId });
    if (!set) throw new CcgCommunityError(503, "community_set_unavailable", "The Community set is not available");
    const sourceId = linkedCharacter?._id ?? new mongoose.Types.ObjectId();
    const now = new Date();
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
      tierGrade: input.tierGrade,
      avatarUrl: media.avatarUrl,
      renderUrl: media.mainRawUrl,
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
      combinedScore: 0,
      mythicPlusScore: null,
      tierGrade: input.tierGrade,
      avatarUrl: media.avatarUrl,
      renderUrl: media.mainRawUrl,
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
          { new: true, session },
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
}

export default new CcgCommunityService();
