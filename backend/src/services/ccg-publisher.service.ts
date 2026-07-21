import { randomUUID } from "crypto";
import mongoose from "mongoose";
import {
  CCG_CONFIGURED_SETS,
  CCG_ENABLE_MIN_ELIGIBLE_CHARACTERS,
  CCG_ENABLE_MIN_MEDIA_COVERAGE,
  CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS,
  CCG_ELIGIBILITY_VERSION,
  CCG_GRADING_VERSION,
  CCG_PACK_RULE_VERSION,
  CCG_POOL_VERSION,
  CCG_THEME_VERSION,
  CCG_TIER_GRADES,
  CcgConfiguredSet,
  CcgTierGrade,
} from "../config/ccg";
import { MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY } from "../config/character-eligibility";
import CcgCard from "../models/CcgCard";
import CcgJobLock from "../models/CcgJobLock";
import CcgPackPool from "../models/CcgPackPool";
import CcgPublicationCandidate from "../models/CcgPublicationCandidate";
import CcgSet, { ICcgSet } from "../models/CcgSet";
import CharacterMedia from "../models/CharacterMedia";
import CharacterMythicPlusSeasonScore from "../models/CharacterMythicPlusSeasonScore";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import { gradeForPercentile, resolveCardCrop } from "../utils/ccg-random";
import { CcgReadinessBlocker, evaluateCcgReadiness } from "../utils/ccg-readiness";
import { getHelsinkiDateKey } from "../utils/helsinki-time";
import logger from "../utils/logger";
import { getPrimaryCharacterRaidGuilds } from "./character-raid-guild.service";
import characterMediaService from "./character-media.service";

type SnapshotPayload = {
  wclCanonicalCharacterId: number | null;
  name: string;
  realm: string;
  region: string;
  guildName: string | null;
  guildRealm: string | null;
  classID: number;
  specName: string;
  role: "dps" | "healer" | "tank";
  metric: "dps" | "hps";
  itemLevel: number;
  parseScore: number;
  survivalScore: number;
  combinedScore: number;
  mythicPlusScore: number | null;
  pulls: number;
  deaths: number;
  reportCount: number;
  totalKills: number;
  performanceSnapshotAt: Date;
  sourcePartition: string;
  snapshotRank: number;
};

type TierEntryRow = SnapshotPayload & { characterId: mongoose.Types.ObjectId };

export type CcgSetReadiness = {
  configured: CcgConfiguredSet;
  setId: string | null;
  state: "draft" | "current" | "legacy" | "locked";
  enabledAt: Date | null;
  targetMode: "current" | "legacy";
  eligible: number;
  mediaReady: number;
  mediaCoverage: number;
  published: number;
  poolCards: number;
  readyToEnable: boolean;
  blockers: CcgReadinessBlocker[];
  thresholds: {
    eligible: number;
    mediaReady: number;
    mediaCoverage: number;
  };
  checkedAt: Date;
};

export class CcgPublisherError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcgPublisherError";
  }
}

class CcgPublisherService {
  private configuredAt = 0;
  private configuredPromise: Promise<void> | null = null;

  async ensureConfiguredSets(): Promise<ICcgSet[]> {
    if (Date.now() - this.configuredAt >= 5 * 60 * 1000) {
      if (!this.configuredPromise) {
        this.configuredPromise = this.upsertConfiguredSets().finally(() => {
          this.configuredPromise = null;
        });
      }
      await this.configuredPromise;
    }
    return CcgSet.find({ zoneId: { $in: CCG_CONFIGURED_SETS.map((set) => set.zoneId) } }).sort({ zoneId: 1 });
  }

  private async upsertConfiguredSets(): Promise<void> {
    await Promise.all(
      CCG_CONFIGURED_SETS.map((configured) =>
        CcgSet.findOneAndUpdate(
          { zoneId: configured.zoneId },
          {
            $set: {
              slug: configured.slug,
              raidName: configured.raidName,
              expansionName: configured.expansionName,
              mythicPlusSeason: configured.mythicPlusSeason,
              themeKey: configured.themeKey,
              themeVersion: CCG_THEME_VERSION,
              theme: { mark: configured.mark, accent: configured.accent, glow: configured.glow },
              backgroundPath: configured.backgroundPath,
              backgroundSafeCrop: configured.crop,
              eligibilityVersion: CCG_ELIGIBILITY_VERSION,
              gradingVersion: CCG_GRADING_VERSION,
              packRuleVersion: CCG_PACK_RULE_VERSION,
            },
            $setOnInsert: {
              state: "draft",
              enabledAt: null,
              enabledBy: null,
              opensAt: null,
              publicationWave: 0,
              cardCount: 0,
            },
          },
          { upsert: true, new: true },
        ),
      ),
    );
    await CcgSet.updateMany(
      { zoneId: { $in: CCG_CONFIGURED_SETS.map((set) => set.zoneId) }, enabledAt: null, state: { $ne: "draft" } },
      { $set: { state: "draft", opensAt: null, closesAt: null } },
    );
    this.configuredAt = Date.now();
  }

  async buildSnapshot(zoneId: number): Promise<{
    snapshotKey: string;
    candidates: number;
    ready: number;
    missingMedia: number;
    gradeDistribution: Record<string, number>;
  }> {
    const configured = CCG_CONFIGURED_SETS.find((set) => set.zoneId === zoneId);
    if (!configured) throw new Error(`CCG set is not configured for raid ${zoneId}`);
    const owner = await this.acquireLock(`snapshot:${zoneId}`, 90 * 60 * 1000);
    if (!owner) throw new Error(`A CCG snapshot for raid ${zoneId} is already running`);

    try {
      await this.ensureConfiguredSets();
      const set = await CcgSet.findOne({ zoneId });
      if (!set) throw new Error(`CCG set ${zoneId} could not be initialized`);
      const snapshotKey = `${set.slug}:${getHelsinkiDateKey()}`;
      const entries = await CharacterTierListEntry.find({
        scope: "global",
        zoneId,
        pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
        reportCount: { $gte: 3 },
        survivalScore: { $ne: null },
      })
        .sort({ score: -1, parseScore: -1, reportCount: -1, wclCanonicalCharacterId: 1, characterKey: 1 })
        .lean();

      if (entries.length === 0) throw new Error(`No complete character tier-list population is available for raid ${zoneId}`);

      const characterIds = entries.map((entry) => entry.characterId);
      const [guilds, mediaRows, mythicPlusRows] = await Promise.all([
        getPrimaryCharacterRaidGuilds(zoneId, characterIds),
        CharacterMedia.find({ characterId: { $in: characterIds }, status: "available" }).lean(),
        CharacterMythicPlusSeasonScore.find({ characterId: { $in: characterIds }, season: set.mythicPlusSeason })
          .select("characterId scores.all fetchedAt")
          .lean(),
      ]);
      const mediaByCharacter = new Map(mediaRows.map((row) => [String(row.characterId), row]));
      const mythicPlusByCharacter = new Map(mythicPlusRows.map((row) => [String(row.characterId), row.scores.all]));
      const now = new Date();
      const gradeDistribution: Record<string, number> = Object.fromEntries(CCG_TIER_GRADES.map((grade) => [grade, 0]));
      const operations = entries.map((entry, index) => {
        const characterId = String(entry.characterId);
        const guild = guilds.get(characterId);
        const tierGrade = gradeForPercentile(index, entries.length);
        const media = mediaByCharacter.get(characterId);
        gradeDistribution[tierGrade] += 1;
        const payload: SnapshotPayload = {
          wclCanonicalCharacterId: entry.wclCanonicalCharacterId ?? null,
          name: entry.name,
          realm: entry.realm,
          region: entry.region,
          guildName: guild?.name ?? null,
          guildRealm: guild?.realm ?? null,
          classID: entry.classID,
          specName: entry.bestSpecName ?? entry.specName,
          role: entry.role,
          metric: entry.metric,
          itemLevel: entry.ilvl,
          parseScore: entry.parseScore,
          survivalScore: entry.survivalScore as number,
          combinedScore: entry.score,
          mythicPlusScore: mythicPlusByCharacter.get(characterId) ?? null,
          pulls: entry.pulls,
          deaths: entry.deaths,
          reportCount: entry.reportCount,
          totalKills: entry.totalKills,
          performanceSnapshotAt: now,
          sourcePartition: `character-tier-list:${zoneId}:global`,
          snapshotRank: index + 1,
        };
        return {
          updateOne: {
            filter: { snapshotKey, characterId: entry.characterId },
            update: {
              $set: {
                setId: set._id,
                payload,
                tierGrade,
                status: media?.mainRawUrl ? ("ready" as const) : ("missing_media" as const),
              },
            },
            upsert: true,
          },
        };
      });

      await CcgPublicationCandidate.bulkWrite(operations, { ordered: false });
      await CcgPublicationCandidate.deleteMany({ snapshotKey, characterId: { $nin: characterIds } });
      await CcgSet.updateOne({ _id: set._id }, { $set: { lastSnapshotAt: now } });

      const missing = entries.filter((entry) => !mediaByCharacter.get(String(entry.characterId))?.mainRawUrl);
      await characterMediaService.enqueueCharacters(missing.slice(0, 2000).map((entry) => entry.characterId));

      return {
        snapshotKey,
        candidates: entries.length,
        ready: entries.length - missing.length,
        missingMedia: missing.length,
        gradeDistribution,
      };
    } finally {
      await this.releaseLock(`snapshot:${zoneId}`, owner);
    }
  }

  async publishLatestWave(setSlug: string): Promise<{ snapshotKey: string; published: number; totalCards: number; poolVersion: string }> {
    const set = await CcgSet.findOne({ slug: setSlug });
    if (!set) throw new Error(`Unknown CCG set: ${setSlug}`);
    if (!new Set(["current", "legacy", "draft"]).has(set.state)) throw new Error(`CCG set ${set.slug} is locked`);
    const owner = await this.acquireLock(`publish:${set._id}`, 90 * 60 * 1000);
    if (!owner) throw new Error(`A CCG publication for ${set.slug} is already running`);

    try {
      const latest = await CcgPublicationCandidate.findOne({ setId: set._id }).sort({ createdAt: -1 }).select("snapshotKey").lean();
      if (!latest) throw new Error(`No CCG snapshot is available for ${set.slug}`);
      const candidates = await CcgPublicationCandidate.find({ setId: set._id, snapshotKey: latest.snapshotKey, status: { $ne: "published" } })
        .sort({ "payload.snapshotRank": 1 })
        .lean();
      const existingCharacterIds = new Set((await CcgCard.distinct("characterId", { setId: set._id })).map(String));
      const unpublished = candidates.filter((candidate) => !existingCharacterIds.has(String(candidate.characterId)));
      const mediaRows = await CharacterMedia.find({
        characterId: { $in: unpublished.map((candidate) => candidate.characterId) },
        status: "available",
        mainRawUrl: { $ne: null },
      }).lean();
      const mediaByCharacter = new Map(mediaRows.map((row) => [String(row.characterId), row]));
      const ready = unpublished.filter((candidate) => mediaByCharacter.get(String(candidate.characterId))?.mainRawUrl);
      const maximum = await CcgCard.findOne({ setId: set._id }).sort({ setNumber: -1 }).select("setNumber").lean();
      const wave = set.publicationWave + 1;
      const now = new Date();
      const docs = ready.map((candidate, index) => {
        const payload = candidate.payload as SnapshotPayload;
        const media = mediaByCharacter.get(String(candidate.characterId))!;
        return {
          setId: set._id,
          setNumber: (maximum?.setNumber ?? 0) + index + 1,
          characterId: candidate.characterId,
          wclCanonicalCharacterId: payload.wclCanonicalCharacterId,
          name: payload.name,
          realm: payload.realm,
          region: payload.region,
          guildName: payload.guildName,
          guildRealm: payload.guildRealm,
          classID: payload.classID,
          specName: payload.specName,
          role: payload.role,
          metric: payload.metric,
          itemLevel: payload.itemLevel,
          parseScore: payload.parseScore,
          survivalScore: payload.survivalScore,
          combinedScore: payload.combinedScore,
          mythicPlusScore: payload.mythicPlusScore,
          tierGrade: candidate.tierGrade,
          avatarUrl: media.avatarUrl ?? null,
          renderUrl: media.mainRawUrl ?? null,
          backgroundCrop: resolveCardCrop(`${set.slug}:${candidate.characterId}`, set.backgroundSafeCrop),
          pulls: payload.pulls,
          deaths: payload.deaths,
          reportCount: payload.reportCount,
          totalKills: payload.totalKills,
          performanceSnapshotAt: payload.performanceSnapshotAt,
          mediaCapturedAt: media.fetchedAt ?? null,
          sourcePartition: payload.sourcePartition,
          publicationWave: wave,
          gradingVersion: set.gradingVersion,
          eligibilityVersion: set.eligibilityVersion,
          themeVersion: set.themeVersion,
          publishedAt: now,
        };
      });

      if (docs.length > 0) {
        const inserted = await CcgCard.insertMany(docs, { ordered: true });
        await CcgPublicationCandidate.updateMany(
          { _id: { $in: ready.map((candidate) => candidate._id) } },
          { $set: { status: "published" } },
        );
        if (inserted.length !== docs.length) throw new Error("CCG publication inserted an incomplete wave");
      }

      const totalCards = await CcgCard.countDocuments({ setId: set._id });
      const poolVersion = `${CCG_POOL_VERSION}-${wave}`;
      await this.rebuildPool(set._id, poolVersion);
      await CcgSet.updateOne(
        { _id: set._id },
        { $set: { publicationWave: wave, cardCount: totalCards, lastPublishedAt: now } },
      );
      return { snapshotKey: latest.snapshotKey, published: docs.length, totalCards, poolVersion };
    } finally {
      await this.releaseLock(`publish:${set._id}`, owner);
    }
  }

  async rebuildPool(setId: mongoose.Types.ObjectId, version?: string): Promise<string> {
    const set = await CcgSet.findById(setId).lean();
    if (!set) throw new Error("CCG set not found");
    const cards = await CcgCard.find({ setId }).select("_id tierGrade").sort({ setNumber: 1 }).lean();
    const poolVersion = version ?? `${CCG_POOL_VERSION}-${set.publicationWave}`;
    const buckets = CCG_TIER_GRADES.map((grade) => ({
      grade,
      cardIds: cards.filter((card) => card.tierGrade === grade).map((card) => card._id),
    }));
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await CcgPackPool.updateMany({ setId, active: true }, { $set: { active: false } }, { session });
        await CcgPackPool.findOneAndUpdate(
          { setId, version: poolVersion },
          { $set: { active: true, buckets, totalCards: cards.length } },
          { upsert: true, new: true, session },
        );
      });
    } finally {
      await session.endSession();
    }
    return poolVersion;
  }

  async preview(zoneId: number): Promise<CcgSetReadiness> {
    const configured = CCG_CONFIGURED_SETS.find((set) => set.zoneId === zoneId);
    if (!configured) throw new Error(`CCG set is not configured for raid ${zoneId}`);
    const set = await CcgSet.findOne({ zoneId }).lean();
    const entries = await CharacterTierListEntry.find({
      scope: "global",
      zoneId,
      pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
      reportCount: { $gte: 3 },
      survivalScore: { $ne: null },
    })
      .select("characterId")
      .lean();
    const ids = entries.map((entry) => entry.characterId);
    const [published, mediaReady, pool] = await Promise.all([
      set ? CcgCard.countDocuments({ setId: set._id }) : 0,
      CharacterMedia.countDocuments({ characterId: { $in: ids }, status: "available", mainRawUrl: { $ne: null } }),
      set ? CcgPackPool.findOne({ setId: set._id, active: true }).select("totalCards").lean() : null,
    ]);
    const eligible = entries.length;
    const evaluation = evaluateCcgReadiness({ eligible, mediaReady, enabled: Boolean(set?.enabledAt) });
    return {
      configured,
      setId: set ? String(set._id) : null,
      state: set?.state ?? "draft",
      enabledAt: set?.enabledAt ?? null,
      targetMode: configured.state === "current" ? "current" : "legacy",
      eligible,
      mediaReady,
      mediaCoverage: evaluation.mediaCoverage,
      published,
      poolCards: pool?.totalCards ?? 0,
      readyToEnable: evaluation.readyToEnable,
      blockers: evaluation.blockers,
      thresholds: {
        eligible: CCG_ENABLE_MIN_ELIGIBLE_CHARACTERS,
        mediaReady: CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS,
        mediaCoverage: CCG_ENABLE_MIN_MEDIA_COVERAGE,
      },
      checkedAt: new Date(),
    };
  }

  async enableSet(zoneId: number, enabledBy: mongoose.Types.ObjectId): Promise<{
    readiness: CcgSetReadiness;
    publication: { snapshotKey: string; published: number; totalCards: number; poolVersion: string };
    movedToLegacy: number;
  }> {
    const configured = CCG_CONFIGURED_SETS.find((set) => set.zoneId === zoneId);
    if (!configured) throw new CcgPublisherError(404, "set_not_configured", `Raid ${zoneId} is not configured for CCG`);
    const lockOwner = await this.acquireLock("set-activation", 2 * 60 * 60 * 1000);
    if (!lockOwner) throw new CcgPublisherError(409, "activation_in_progress", "Another CCG raid is being enabled");

    try {
      await this.ensureConfiguredSets();
      const before = await this.preview(zoneId);
      if (before.enabledAt) throw new CcgPublisherError(409, "set_already_enabled", `${configured.raidName} is already enabled`);
      if (!before.readyToEnable) throw new CcgPublisherError(409, "set_not_ready", `${configured.raidName} does not meet the CCG readiness requirements`);

      await this.buildSnapshot(zoneId);
      const publication = await this.publishLatestWave(configured.slug);
      if (publication.totalCards < CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS) {
        throw new CcgPublisherError(409, "published_pool_too_small", `${configured.raidName} does not have enough publishable cards`);
      }

      const session = await mongoose.startSession();
      let movedToLegacy = 0;
      try {
        await session.withTransaction(async () => {
          const target = await CcgSet.findOne({ zoneId, state: "draft", enabledAt: null }).session(session);
          if (!target) throw new CcgPublisherError(409, "set_activation_conflict", `${configured.raidName} can no longer be enabled`);
          const now = new Date();
          if (configured.state === "current") {
            const moved = await CcgSet.updateMany(
              {
                _id: { $ne: target._id },
                state: "current",
                enabledAt: { $ne: null },
                mythicPlusSeason: { $ne: target.mythicPlusSeason },
              },
              { $set: { state: "legacy", closesAt: now } },
              { session },
            );
            movedToLegacy = moved.modifiedCount;
          }
          target.state = configured.state === "current" ? "current" : "legacy";
          target.enabledAt = now;
          target.enabledBy = enabledBy;
          target.opensAt = now;
          target.closesAt = null;
          await target.save({ session });
        });
      } finally {
        await session.endSession();
      }

      return { readiness: await this.preview(zoneId), publication, movedToLegacy };
    } finally {
      await this.releaseLock("set-activation", lockOwner);
    }
  }

  async getEnabledCurrentSets(): Promise<ICcgSet[]> {
    await this.ensureConfiguredSets();
    return CcgSet.find({ state: "current", enabledAt: { $ne: null }, cardCount: { $gt: 0 } }).sort({ zoneId: 1 });
  }

  private async acquireLock(key: string, durationMs: number): Promise<string | null> {
    const owner = randomUUID();
    const now = new Date();
    await CcgJobLock.deleteOne({ key, expiresAt: { $lte: now } });
    try {
      await CcgJobLock.create({ key, owner, expiresAt: new Date(now.getTime() + durationMs) });
      return owner;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return null;
      throw error;
    }
  }

  private async releaseLock(key: string, owner: string): Promise<void> {
    await CcgJobLock.deleteOne({ key, owner }).catch((error) => logger.error(`[CCG] Failed to release ${key}:`, error));
  }
}

export default new CcgPublisherService();
