import { createHash, randomUUID } from "crypto";
import mongoose from "mongoose";
import {
  CCG_CONFIGURED_SETS,
  CCG_COMMUNITY_SET,
  CCG_ENABLE_MIN_ELIGIBLE_CHARACTERS,
  CCG_ENABLE_MIN_MEDIA_COVERAGE,
  CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS,
  CCG_ELIGIBILITY_VERSION,
  CCG_GRADING_VERSION,
  CCG_PACK_RULE_VERSION,
  CCG_POOL_VERSION,
  CCG_REGULAR_TIER_GRADES,
  CCG_THEME_VERSION,
  CCG_TIER_GRADES,
  CcgConfiguredSet,
  CcgTierGrade,
} from "../config/ccg";
import {
  COMPLETE_CCG_SCORE_FILTER,
  MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
  MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY,
} from "../config/character-eligibility";
import CcgCard, { ICcgCard } from "../models/CcgCard";
import CcgCommunityCharacter from "../models/CcgCommunityCharacter";
import CcgJobLock from "../models/CcgJobLock";
import CcgPackPool from "../models/CcgPackPool";
import CcgPublicationCandidate from "../models/CcgPublicationCandidate";
import CcgSet, { ICcgSet } from "../models/CcgSet";
import Character from "../models/Character";
import CharacterMedia, { CharacterMediaStatus } from "../models/CharacterMedia";
import { CharacterRenderFit } from "../models/CharacterRenderAsset";
import CharacterMythicPlusSeasonScore from "../models/CharacterMythicPlusSeasonScore";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import { gradeForPercentile, resolveCardCrop } from "../utils/ccg-random";
import { buildCcgCardSearchCandidates } from "../utils/ccg-card-search";
import { createCharacterCollectorKey } from "../utils/ccg-identity";
import { CcgReadinessBlocker, evaluateCcgReadiness } from "../utils/ccg-readiness";
import {
  CcgSnapshotPreviewDisposition,
  CcgSnapshotPreviewSummary,
  getCcgSnapshotPreviewDisposition,
  nextCcgCardSnapshotVersion,
  shouldPublishCcgCardSnapshot,
  summarizeCcgSnapshotPreview,
} from "../utils/ccg-card-snapshot";
import { getHelsinkiDateKey } from "../utils/helsinki-time";
import logger from "../utils/logger";
import {
  CharacterRaidParticipationSummary,
  getCharacterRaidParticipationSummaries,
} from "./character-raid-guild.service";
import characterContinuityService from "./character-continuity.service";
import characterMediaService from "./character-media.service";
import characterRenderStorageService from "./character-render-storage.service";

type SnapshotPayload = {
  wclCanonicalCharacterId: number | null;
  name: string;
  realm: string;
  region: string;
  guildId: mongoose.Types.ObjectId | null;
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
  mythicReportCount: number;
  totalKills: number;
  performanceSnapshotAt: Date;
  sourcePartition: string;
  snapshotRank: number;
};

type TierEntryRow = SnapshotPayload & { characterId: mongoose.Types.ObjectId };

type CcgContinuityContext = {
  memberIdsByRootId: Map<string, mongoose.Types.ObjectId[]>;
  rootIdByMemberId: Map<string, string>;
  allMemberIds: mongoose.Types.ObjectId[];
};

type CcgMediaRow = {
  characterId: mongoose.Types.ObjectId;
  avatarUrl?: string | null;
  renderAssetId?: mongoose.Types.ObjectId | null;
  renderAssetExpiresAt?: Date | null;
  renderFit?: CharacterRenderFit | null;
  fetchedAt?: Date | null;
  status: CharacterMediaStatus;
  attemptCount: number;
  nextAttemptAt?: Date | null;
  lastErrorCode?: string | null;
  lastError?: string | null;
};

function hasStoredRender(media: CcgMediaRow | null | undefined, now = new Date()): boolean {
  return Boolean(
    media?.status === "available"
    && media.renderAssetId
    && media.renderAssetExpiresAt
    && media.renderAssetExpiresAt > now,
  );
}

type CcgCollectionGuildSource = {
  guildId?: mongoose.Types.ObjectId | null;
  guildName?: string | null;
  guildRealm?: string | null;
};

export type CcgSnapshotSetPreview = CcgSnapshotPreviewSummary & {
  setId: string;
  zoneId: number;
  slug: string;
  raidName: string;
  mode: "current" | "legacy";
  characters: Array<{
    characterId: string;
    name: string;
    realm: string;
    region: string;
    disposition: Exclude<CcgSnapshotPreviewDisposition, "unchanged">;
    previousTierGrade: CcgTierGrade | null;
    nextTierGrade: CcgTierGrade;
    mediaStatus: CharacterMediaStatus | "untracked" | "render_missing";
    attemptCount: number;
    nextAttemptAt: Date | null;
    lastErrorCode: string | null;
    lastError: string | null;
  }>;
};

export type CcgNextSnapshotPreview = {
  calculatedAt: Date;
  sets: CcgSnapshotSetPreview[];
  totals: Omit<CcgSnapshotPreviewSummary, "gradeDistribution">;
};

export function buildCcgCollectionGuilds(cards: ReadonlyArray<CcgCollectionGuildSource>): Array<{
  guildId: mongoose.Types.ObjectId;
  name: string;
  realm: string;
}> {
  const guilds = new Map<string, { guildId: mongoose.Types.ObjectId; name: string; realm: string }>();
  for (const card of cards) {
    if (!card.guildId || !card.guildName || !card.guildRealm) continue;
    const id = String(card.guildId);
    if (!guilds.has(id)) guilds.set(id, { guildId: card.guildId, name: card.guildName, realm: card.guildRealm });
  }
  return [...guilds.values()].sort((left, right) => left.name.localeCompare(right.name) || left.realm.localeCompare(right.realm));
}

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
  activationRevision: string;
  replacesCurrentSets: Array<{ id: string; raidName: string; mythicPlusSeason: string }>;
  readyToEnable: boolean;
  blockers: CcgReadinessBlocker[];
  thresholds: {
    eligible: number;
    mediaReady: number;
    mediaCoverage: number;
  };
  checkedAt: Date;
};

type CcgActivationState = {
  fromSets: Array<{
    _id: mongoose.Types.ObjectId;
    raidName: string;
    mythicPlusSeason: string;
  }>;
  revision: string;
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
  private cardSnapshotIndexesPromise: Promise<void> | null = null;
  private collectionGuildsPromise: Promise<void> | null = null;
  private collectionCharactersPromise: Promise<void> | null = null;

  private async loadContinuityContext(
    characterIds: readonly (mongoose.Types.ObjectId | string)[],
  ): Promise<CcgContinuityContext> {
    const graph = await characterContinuityService.getGraph();
    const memberIdsByRootId = new Map<string, mongoose.Types.ObjectId[]>();
    const rootIdByMemberId = new Map<string, string>();

    for (const characterId of characterIds) {
      const rootId = graph.resolveRoot(characterId);
      if (memberIdsByRootId.has(rootId)) continue;
      const memberIds = graph.getMemberIds(rootId).map((memberId) => new mongoose.Types.ObjectId(memberId));
      memberIdsByRootId.set(rootId, memberIds);
      for (const memberId of memberIds) rootIdByMemberId.set(String(memberId), rootId);
    }

    return {
      memberIdsByRootId,
      rootIdByMemberId,
      allMemberIds: Array.from(
        new Map(
          Array.from(memberIdsByRootId.values())
            .flat()
            .map((characterId) => [String(characterId), characterId]),
        ).values(),
      ),
    };
  }

  private async loadContinuityMedia(context: CcgContinuityContext): Promise<Map<string, CcgMediaRow>> {
    if (context.allMemberIds.length === 0) return new Map();
    const rows = await CharacterMedia.find({ characterId: { $in: context.allMemberIds } }).lean<CcgMediaRow[]>();
    const mediaByMemberId = new Map(rows.map((row) => [String(row.characterId), row]));
    const mediaByRootId = new Map<string, CcgMediaRow>();

    for (const [rootId, memberIds] of context.memberIdsByRootId) {
      const rootMedia = mediaByMemberId.get(rootId);
      const availableMedia = memberIds
        .map((memberId) => mediaByMemberId.get(String(memberId)))
        .find((row) => hasStoredRender(row));
      const selected = hasStoredRender(rootMedia)
        ? rootMedia
        : availableMedia ?? rootMedia ?? memberIds.map((memberId) => mediaByMemberId.get(String(memberId))).find(Boolean);
      if (selected) mediaByRootId.set(rootId, selected);
    }

    return mediaByRootId;
  }

  private async loadMythicPlusScoresByCharacter(
    context: CcgContinuityContext,
    season: string,
  ): Promise<Map<string, number | null>> {
    if (context.allMemberIds.length === 0) return new Map();
    const rows = await CharacterMythicPlusSeasonScore.find({
      characterId: { $in: context.allMemberIds },
      season,
      identityStatus: { $ne: "stale" },
    })
      .select("characterId scores.all")
      .lean();
    const scoresByCharacter = new Map<string, number | null>();

    for (const row of rows) {
      const rootId = context.rootIdByMemberId.get(String(row.characterId)) ?? String(row.characterId);
      const score = row.scores.all > 0 ? row.scores.all : null;
      const current = scoresByCharacter.get(rootId) ?? null;
      if (score !== null && (current === null || score > current)) scoresByCharacter.set(rootId, score);
      else if (!scoresByCharacter.has(rootId)) scoresByCharacter.set(rootId, null);
    }

    return scoresByCharacter;
  }

  private async getActivationState(configured: CcgConfiguredSet, session?: mongoose.ClientSession): Promise<CcgActivationState> {
    const currentSetsQuery = CcgSet.find({
      state: "current",
      enabledAt: { $ne: null },
      mythicPlusSeason: { $ne: configured.mythicPlusSeason },
    })
      .select("_id raidName mythicPlusSeason")
      .sort({ zoneId: 1 })
      .lean();
    if (session) currentSetsQuery.session(session);
    const fromSets = await currentSetsQuery;
    const revision = createHash("sha256")
      .update(JSON.stringify({
        targetZoneId: configured.zoneId,
        targetSeason: configured.mythicPlusSeason,
        fromSetIds: fromSets.map((set) => String(set._id)),
      }))
      .digest("hex")
      .slice(0, 24);
    return { fromSets, revision };
  }

  private async ensureCardSnapshotIndexes(): Promise<void> {
    if (!this.cardSnapshotIndexesPromise) {
      this.cardSnapshotIndexesPromise = (async () => {
        await CcgCard.collection.createIndex(
          { setId: 1, characterId: 1, snapshotVersion: 1 },
          { unique: true, name: "ccg_card_character_snapshot_version" },
        );
        await CcgCard.collection.createIndex(
          { setId: 1, setNumber: 1, snapshotVersion: 1 },
          { unique: true, name: "ccg_card_set_number_snapshot_version" },
        );

        const indexes = await CcgCard.collection.indexes();
        const legacyKeys = new Set([
          JSON.stringify({ setId: 1, characterId: 1 }),
          JSON.stringify({ setId: 1, setNumber: 1 }),
        ]);
        for (const index of indexes) {
          if (index.unique && index.name && legacyKeys.has(JSON.stringify(index.key))) {
            await CcgCard.collection.dropIndex(index.name);
          }
        }
      })().catch((error) => {
        this.cardSnapshotIndexesPromise = null;
        throw error;
      });
    }
    await this.cardSnapshotIndexesPromise;
  }

  async ensureConfiguredSets(): Promise<ICcgSet[]> {
    if (Date.now() - this.configuredAt >= 5 * 60 * 1000) {
      if (!this.configuredPromise) {
        this.configuredPromise = this.upsertConfiguredSets().finally(() => {
          this.configuredPromise = null;
        });
      }
      await this.configuredPromise;
    }
    return CcgSet.find({ zoneId: { $in: [...CCG_CONFIGURED_SETS.map((set) => set.zoneId), CCG_COMMUNITY_SET.zoneId] } }).sort({ zoneId: 1 });
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
              kind: "raid",
              themeKey: configured.themeKey,
              themeVersion: CCG_THEME_VERSION,
              theme: { mark: configured.mark, accent: configured.accent, glow: configured.glow },
              customFinish: configured.customFinish ?? null,
              backgroundPath: configured.backgroundPath,
              packArtOffsetX: configured.packArtOffsetX ?? 50,
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
          { upsert: true, returnDocument: "after" },
        ),
      ),
    );
    await CcgSet.findOneAndUpdate(
      { zoneId: CCG_COMMUNITY_SET.zoneId },
      {
        $set: {
          slug: CCG_COMMUNITY_SET.slug,
          raidName: CCG_COMMUNITY_SET.raidName,
          expansionName: CCG_COMMUNITY_SET.expansionName,
          mythicPlusSeason: CCG_COMMUNITY_SET.mythicPlusSeason,
          state: CCG_COMMUNITY_SET.state,
          kind: "community",
          themeKey: CCG_COMMUNITY_SET.themeKey,
          themeVersion: CCG_THEME_VERSION,
          theme: { mark: CCG_COMMUNITY_SET.mark, accent: CCG_COMMUNITY_SET.accent, glow: CCG_COMMUNITY_SET.glow },
          customFinish: null,
          backgroundPath: CCG_COMMUNITY_SET.backgroundPath,
          packArtOffsetX: 50,
          backgroundSafeCrop: CCG_COMMUNITY_SET.crop,
          eligibilityVersion: "community-admin-v1",
          gradingVersion: CCG_GRADING_VERSION,
          packRuleVersion: CCG_PACK_RULE_VERSION,
        },
        $setOnInsert: {
          enabledAt: new Date(),
          enabledBy: null,
          opensAt: new Date(),
          publicationWave: 0,
          cardCount: 0,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    await CcgSet.updateOne(
      { zoneId: CCG_COMMUNITY_SET.zoneId, enabledAt: null },
      { $set: { enabledAt: new Date(), opensAt: new Date() } },
    );
    await CcgSet.updateMany(
      { zoneId: { $in: CCG_CONFIGURED_SETS.map((set) => set.zoneId) }, enabledAt: null, state: { $ne: "draft" } },
      { $set: { state: "draft", opensAt: null, closesAt: null } },
    );
    const configuredZoneIds = [...CCG_CONFIGURED_SETS.map((set) => set.zoneId), CCG_COMMUNITY_SET.zoneId];
    const unconfiguredSets = await CcgSet.find({ zoneId: { $nin: configuredZoneIds } }).select("_id").lean();
    if (unconfiguredSets.length > 0) {
      const unconfiguredSetIds = unconfiguredSets.map((set) => set._id);
      await Promise.all([
        CcgSet.updateMany(
          { _id: { $in: unconfiguredSetIds } },
          { $set: { state: "locked", enabledAt: null, opensAt: null } },
        ),
        CcgPackPool.updateMany({ setId: { $in: unconfiguredSetIds } }, { $set: { active: false } }),
      ]);
    }
    this.configuredAt = Date.now();
  }

  private async loadSnapshotPopulation(zoneId: number, options: { ensureConfigured?: boolean; allowEmpty?: boolean } = {}) {
    const configured = CCG_CONFIGURED_SETS.find((set) => set.zoneId === zoneId);
    if (!configured) throw new Error(`CCG set is not configured for raid ${zoneId}`);
    if (options.ensureConfigured !== false) await this.ensureConfiguredSets();
    const set = await CcgSet.findOne({ zoneId });
    if (!set) throw new Error(`CCG set ${zoneId} could not be initialized`);

    const entryFilter: Record<string, unknown> = {
      scope: "global",
      zoneId,
      pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
      ...COMPLETE_CCG_SCORE_FILTER,
    };
    const rankedEntries = await CharacterTierListEntry.find(entryFilter)
      .sort({ score: -1, parseScore: -1, mythicReportCount: -1, reportCount: -1, wclCanonicalCharacterId: 1, characterKey: 1 })
      .lean();
    const continuity = await this.loadContinuityContext(rankedEntries.map((entry) => entry.characterId));
    const [rootCharacters, participationByMember] = await Promise.all([
      Character.find({ _id: { $in: [...continuity.memberIdsByRootId.keys()] } })
        .select("_id wclCanonicalCharacterId name realm region classID")
        .lean(),
      getCharacterRaidParticipationSummaries(
        zoneId,
        continuity.allMemberIds,
      ),
    ]);
    const rootCharacterById = new Map(rootCharacters.map((character) => [String(character._id), character]));
    const representativeEntryByRootId = new Map<string, (typeof rankedEntries)[number]>();
    for (const entry of rankedEntries) {
      const rootId = continuity.rootIdByMemberId.get(String(entry.characterId)) ?? String(entry.characterId);
      if (!representativeEntryByRootId.has(rootId)) representativeEntryByRootId.set(rootId, entry);
    }

    const participationByCharacter = new Map<string, CharacterRaidParticipationSummary>();
    for (const [rootId, memberIds] of continuity.memberIdsByRootId) {
      const summaries = memberIds
        .map((memberId) => participationByMember.get(String(memberId)))
        .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
      if (summaries.length === 0) continue;
      const representativeEntry = representativeEntryByRootId.get(rootId);
      const preferredGuild = participationByMember.get(String(representativeEntry?.characterId ?? ""))?.guild
        ?? summaries
          .slice()
          .sort((left, right) => right.mythicReportCount - left.mythicReportCount || right.reportCount - left.reportCount)[0].guild;
      participationByCharacter.set(rootId, {
        guild: preferredGuild,
        reportCount: summaries.reduce((total, summary) => total + summary.reportCount, 0),
        mythicReportCount: summaries.reduce((total, summary) => total + summary.mythicReportCount, 0),
      });
    }

    const entries = Array.from(representativeEntryByRootId, ([rootId, entry]) => {
      const rootCharacter = rootCharacterById.get(rootId);
      return {
        ...entry,
        characterId: rootCharacter?._id ?? new mongoose.Types.ObjectId(rootId),
        characterKey: rootCharacter
          ? `canonical:${rootCharacter.wclCanonicalCharacterId}:${rootCharacter.classID}`
          : entry.characterKey,
        wclCanonicalCharacterId: rootCharacter?.wclCanonicalCharacterId ?? entry.wclCanonicalCharacterId,
        name: rootCharacter?.name ?? entry.name,
        realm: rootCharacter?.realm ?? entry.realm,
        region: rootCharacter?.region ?? entry.region,
        classID: rootCharacter?.classID ?? entry.classID,
      };
    })
      .filter(
        (entry) =>
          (participationByCharacter.get(String(entry.characterId))?.mythicReportCount ?? 0) >=
          MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
      )
      .sort((left, right) => {
        const scoreDiff = right.score - left.score;
        if (scoreDiff !== 0) return scoreDiff;

        const parseScoreDiff = right.parseScore - left.parseScore;
        if (parseScoreDiff !== 0) return parseScoreDiff;

        const leftParticipation = participationByCharacter.get(String(left.characterId));
        const rightParticipation = participationByCharacter.get(String(right.characterId));
        const mythicReportDiff = (rightParticipation?.mythicReportCount ?? 0) - (leftParticipation?.mythicReportCount ?? 0);
        if (mythicReportDiff !== 0) return mythicReportDiff;

        const reportDiff = (rightParticipation?.reportCount ?? 0) - (leftParticipation?.reportCount ?? 0);
        if (reportDiff !== 0) return reportDiff;

        const canonicalIdDiff = (left.wclCanonicalCharacterId ?? Number.MAX_SAFE_INTEGER) - (right.wclCanonicalCharacterId ?? Number.MAX_SAFE_INTEGER);
        if (canonicalIdDiff !== 0) return canonicalIdDiff;

        return left.characterKey.localeCompare(right.characterKey);
      });
    if (entries.length === 0 && options.allowEmpty !== true) {
      throw new Error(`No complete character tier-list population is available for raid ${zoneId}`);
    }

    return {
      configured,
      set,
      entries: entries.map((entry, index) => ({ entry, tierGrade: gradeForPercentile(index, entries.length) })),
      participationByCharacter,
      continuity,
      characterIds: entries.map((entry) => entry.characterId),
    };
  }

  async previewNextSnapshots(): Promise<CcgNextSnapshotPreview> {
    const enabledSets = await CcgSet.find({
      kind: "raid",
      state: { $in: ["current", "legacy"] },
      enabledAt: { $ne: null },
      cardCount: { $gt: 0 },
    }).sort({ zoneId: -1 });
    const sets: CcgSnapshotSetPreview[] = [];

    for (const enabledSet of enabledSets) {
      const { configured, set, entries, continuity } = await this.loadSnapshotPopulation(enabledSet.zoneId, { ensureConfigured: false });
      const [mediaByCharacter, mythicPlusByCharacter, existingCards] = await Promise.all([
        this.loadContinuityMedia(continuity),
        this.loadMythicPlusScoresByCharacter(continuity, configured.mythicPlusSeason),
        CcgCard.find({ setId: set._id, characterId: { $in: continuity.allMemberIds } })
          .sort({ snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 })
          .select("characterId tierGrade classID specName role metric mythicPlusScore")
          .lean(),
      ]);
      const latestCardByCharacter = new Map<
        string,
        {
          characterId: string;
          tierGrade: CcgTierGrade;
          classID: number;
          specName: string;
          role: "dps" | "healer" | "tank";
          metric: "dps" | "hps";
          mythicPlusScore: number | null;
        }
      >();
      for (const card of existingCards) {
        const characterId = continuity.rootIdByMemberId.get(String(card.characterId)) ?? String(card.characterId);
        if (!latestCardByCharacter.has(characterId)) {
          latestCardByCharacter.set(characterId, {
            characterId,
            tierGrade: card.tierGrade,
            classID: card.classID,
            specName: card.specName,
            role: card.role,
            metric: card.metric,
            mythicPlusScore: card.mythicPlusScore ?? null,
          });
        }
      }
      const candidates = entries.map(({ entry, tierGrade }) => {
        const media = mediaByCharacter.get(String(entry.characterId));
        return {
          characterId: String(entry.characterId),
          tierGrade,
          classID: entry.classID,
          specName: entry.bestSpecName ?? entry.specName,
          role: entry.role,
          metric: entry.metric,
          mythicPlusScore: mythicPlusByCharacter.get(String(entry.characterId)) ?? null,
          hasMedia: hasStoredRender(media),
        };
      });
      const summary = summarizeCcgSnapshotPreview(candidates, [...latestCardByCharacter.values()]);
      const characters = entries.flatMap(({ entry, tierGrade }) => {
        const characterId = String(entry.characterId);
        const media = mediaByCharacter.get(characterId);
        const latestCard = latestCardByCharacter.get(characterId);
        const disposition = getCcgSnapshotPreviewDisposition(
          latestCard,
          {
            tierGrade,
            classID: entry.classID,
            specName: entry.bestSpecName ?? entry.specName,
            role: entry.role,
            mythicPlusScore: mythicPlusByCharacter.get(characterId) ?? null,
          },
          hasStoredRender(media),
        );
        if (disposition === "unchanged") return [];
        return [{
          characterId,
          name: entry.name,
          realm: entry.realm,
          region: entry.region,
          disposition,
          previousTierGrade: latestCard?.tierGrade ?? null,
          nextTierGrade: tierGrade,
          mediaStatus: !media
            ? ("untracked" as const)
            : media.status === "available" && !hasStoredRender(media)
              ? ("render_missing" as const)
              : media.status,
          attemptCount: media?.attemptCount ?? 0,
          nextAttemptAt: media?.nextAttemptAt ?? null,
          lastErrorCode: media?.lastErrorCode ?? null,
          lastError: media?.lastError ?? null,
        }];
      });
      sets.push({
        setId: String(set._id),
        zoneId: set.zoneId,
        slug: set.slug,
        raidName: set.raidName,
        mode: set.state === "current" ? "current" : "legacy",
        characters,
        ...summary,
      });
    }

    const calculatedAt = new Date();
    return {
      calculatedAt,
      sets,
      totals: sets.reduce<Omit<CcgSnapshotPreviewSummary, "gradeDistribution">>(
        (totals, set) => ({
          eligibleCharacters: totals.eligibleCharacters + set.eligibleCharacters,
          projectedSnapshots: totals.projectedSnapshots + set.projectedSnapshots,
          newCharacters: totals.newCharacters + set.newCharacters,
          rarityChanges: totals.rarityChanges + set.rarityChanges,
          identityChanges: totals.identityChanges + set.identityChanges,
          mythicPlusScoreAdds: totals.mythicPlusScoreAdds + set.mythicPlusScoreAdds,
          unchangedCharacters: totals.unchangedCharacters + set.unchangedCharacters,
          blockedByMissingMedia: totals.blockedByMissingMedia + set.blockedByMissingMedia,
          mediaReady: totals.mediaReady + set.mediaReady,
          missingMedia: totals.missingMedia + set.missingMedia,
        }),
        {
          eligibleCharacters: 0,
          projectedSnapshots: 0,
          newCharacters: 0,
          rarityChanges: 0,
          identityChanges: 0,
          mythicPlusScoreAdds: 0,
          unchangedCharacters: 0,
          blockedByMissingMedia: 0,
          mediaReady: 0,
          missingMedia: 0,
        },
      ),
    };
  }

  async buildSnapshot(zoneId: number): Promise<{
    snapshotKey: string;
    candidates: number;
    ready: number;
    missingMedia: number;
    gradeDistribution: Record<string, number>;
  }> {
    const owner = await this.acquireLock(`snapshot:${zoneId}`, 90 * 60 * 1000);
    if (!owner) throw new Error(`A CCG snapshot for raid ${zoneId} is already running`);

    try {
      const { configured, set, entries, participationByCharacter, continuity, characterIds } = await this.loadSnapshotPopulation(zoneId);
      const snapshotKey = `${set.slug}:${getHelsinkiDateKey()}`;
      const [mediaByCharacter, mythicPlusByCharacter] = await Promise.all([
        this.loadContinuityMedia(continuity),
        this.loadMythicPlusScoresByCharacter(continuity, configured.mythicPlusSeason),
      ]);
      const now = new Date();
      const gradeDistribution: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
      const operations = entries.map(({ entry, tierGrade }, index) => {
        const characterId = String(entry.characterId);
        const participation = participationByCharacter.get(characterId)!;
        const guild = participation.guild;
        const media = mediaByCharacter.get(characterId);
        gradeDistribution[tierGrade] += 1;
        const payload: SnapshotPayload = {
          wclCanonicalCharacterId: entry.wclCanonicalCharacterId ?? null,
          name: entry.name,
          realm: entry.realm,
          region: entry.region,
          guildId: guild?.id ?? null,
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
          reportCount: participation.reportCount,
          mythicReportCount: participation.mythicReportCount,
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
                status: hasStoredRender(media) ? ("ready" as const) : ("missing_media" as const),
              },
            },
            upsert: true,
          },
        };
      });

      await CcgPublicationCandidate.bulkWrite(operations, { ordered: false });
      await CcgPublicationCandidate.deleteMany({ snapshotKey, characterId: { $nin: characterIds } });
      await CcgSet.updateOne({ _id: set._id }, { $set: { lastSnapshotAt: now } });

      const missing = entries.filter(({ entry }) => !hasStoredRender(mediaByCharacter.get(String(entry.characterId))));
      await characterMediaService.enqueueCharacters(missing.slice(0, 2000).map(({ entry }) => entry.characterId));

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

  async publishLatestWave(setSlug: string): Promise<{ snapshotKey: string; published: number; unchanged: number; totalCards: number; poolVersion: string }> {
    const set = await CcgSet.findOne({ slug: setSlug });
    if (!set) throw new Error(`Unknown CCG set: ${setSlug}`);
    if (!new Set(["current", "legacy", "draft"]).has(set.state)) throw new Error(`CCG set ${set.slug} is locked`);
    const owner = await this.acquireLock(`publish:${set._id}`, 90 * 60 * 1000);
    if (!owner) throw new Error(`A CCG publication for ${set.slug} is already running`);

    try {
      await this.ensureCardSnapshotIndexes();
      const latest = await CcgPublicationCandidate.findOne({ setId: set._id })
        .sort({ "payload.performanceSnapshotAt": -1, createdAt: -1 })
        .select("snapshotKey")
        .lean();
      if (!latest) throw new Error(`No CCG snapshot is available for ${set.slug}`);
      const candidates = await CcgPublicationCandidate.find({
        setId: set._id,
        snapshotKey: latest.snapshotKey,
        status: { $nin: ["published", "unchanged"] },
      })
        .sort({ "payload.snapshotRank": 1 })
        .lean();
      const continuity = await this.loadContinuityContext(candidates.map((candidate) => candidate.characterId));
      const existingCards = await CcgCard.find({
        setId: set._id,
        characterId: { $in: continuity.allMemberIds },
      })
        .sort({ snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 })
        .lean();
      const latestCardByCharacter = new Map<string, (typeof existingCards)[number]>();
      for (const card of existingCards) {
        const characterId = continuity.rootIdByMemberId.get(String(card.characterId)) ?? String(card.characterId);
        if (!latestCardByCharacter.has(characterId)) latestCardByCharacter.set(characterId, card);
      }
      const shouldPublish = (candidate: (typeof candidates)[number]) => {
        const rootId = continuity.rootIdByMemberId.get(String(candidate.characterId)) ?? String(candidate.characterId);
        const payload = candidate.payload as SnapshotPayload;
        return shouldPublishCcgCardSnapshot(latestCardByCharacter.get(rootId), {
          tierGrade: candidate.tierGrade,
          classID: payload.classID,
          specName: payload.specName,
          role: payload.role,
          mythicPlusScore: payload.mythicPlusScore,
        });
      };
      const unchanged = candidates.filter((candidate) => !shouldPublish(candidate));
      const publishable = candidates.filter(shouldPublish);
      const mediaByCharacter = await this.loadContinuityMedia(continuity);
      const ready = publishable.filter((candidate) => {
        const rootId = continuity.rootIdByMemberId.get(String(candidate.characterId)) ?? String(candidate.characterId);
        return hasStoredRender(mediaByCharacter.get(rootId));
      });
      const maximum = await CcgCard.findOne({ setId: set._id }).sort({ setNumber: -1 }).select("setNumber").lean();
      let nextSetNumber = (maximum?.setNumber ?? 0) + 1;
      const wave = set.publicationWave + 1;
      const now = new Date();
      const docs = ready.map((candidate) => {
        const payload = candidate.payload as SnapshotPayload;
        const rootId = continuity.rootIdByMemberId.get(String(candidate.characterId)) ?? String(candidate.characterId);
        const rootCharacterId = new mongoose.Types.ObjectId(rootId);
        const media = mediaByCharacter.get(rootId)!;
        const previousCard = latestCardByCharacter.get(rootId);
        const cardCharacterId = rootCharacterId;
        const collectorKey = createCharacterCollectorKey(rootCharacterId);
        return {
          setId: set._id,
          setNumber: previousCard?.setNumber ?? nextSetNumber++,
          snapshotVersion: nextCcgCardSnapshotVersion(previousCard),
          snapshotKey: candidate.snapshotKey,
          supersedesCardId: previousCard?._id ?? null,
          characterId: cardCharacterId,
          collectorKey,
          wclCanonicalCharacterId: payload.wclCanonicalCharacterId,
          name: payload.name,
          realm: payload.realm,
          region: payload.region,
          guildId: payload.guildId,
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
          renderUrl: characterRenderStorageService.getPublicUrl(media.renderAssetId!),
          renderAssetId: media.renderAssetId,
          renderFit: media.renderFit ?? null,
          backgroundCrop: resolveCardCrop(`${set.slug}:${rootId}`, set.backgroundSafeCrop),
          pulls: payload.pulls,
          deaths: payload.deaths,
          reportCount: payload.reportCount,
          mythicReportCount: payload.mythicReportCount,
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
      if (unchanged.length > 0) {
        await CcgPublicationCandidate.updateMany(
          { _id: { $in: unchanged.map((candidate) => candidate._id) } },
          { $set: { status: "unchanged" } },
        );
      }

      const poolVersion = `${CCG_POOL_VERSION}-${wave}`;
      await this.rebuildPool(set._id, poolVersion);
      const totalCards = (await CcgCard.distinct("characterId", {
        setId: set._id,
        availabilityStatus: { $ne: "archived" },
      })).length;
      await CcgSet.updateOne(
        { _id: set._id },
        { $set: { publicationWave: wave, cardCount: totalCards, lastPublishedAt: now } },
      );
      return { snapshotKey: latest.snapshotKey, published: docs.length, unchanged: unchanged.length, totalCards, poolVersion };
    } finally {
      await this.releaseLock(`publish:${set._id}`, owner);
    }
  }

  async ensureCollectionGuildsMaterialized(setIds: mongoose.Types.ObjectId[]): Promise<void> {
    if (setIds.length === 0) return;
    if (this.collectionGuildsPromise) {
      await this.collectionGuildsPromise;
      return this.ensureCollectionGuildsMaterialized(setIds);
    }

    this.collectionGuildsPromise = (async () => {
      const sets = await CcgSet.find({
        _id: { $in: setIds },
        collectionGuildsBuiltAt: null,
      }).select("_id cardCount kind").lean();
      if (sets.length === 0) return;

      const missingSetIds = sets.map((set) => set._id);
      const pools = await CcgPackPool.find({ setId: { $in: missingSetIds }, active: true })
        .select("setId buckets.cardIds")
        .sort({ updatedAt: -1 })
        .lean();
      const poolBySet = new Map<string, (typeof pools)[number]>();
      for (const pool of pools) {
        const setId = String(pool.setId);
        if (!poolBySet.has(setId)) poolBySet.set(setId, pool);
      }

      const pooledCardIds = pools.flatMap((pool) => pool.buckets.flatMap((bucket) => bucket.cardIds));
      const pooledCards = pooledCardIds.length > 0
        ? await CcgCard.find({ _id: { $in: pooledCardIds } }).select("setId guildId guildName guildRealm").lean()
        : [];
      const cardsBySet = new Map<string, CcgCollectionGuildSource[]>();
      for (const card of pooledCards) {
        const setId = String(card.setId);
        const cards = cardsBySet.get(setId) ?? [];
        cards.push(card);
        cardsBySet.set(setId, cards);
      }

      for (const set of sets) {
        const setId = String(set._id);
        if (set.cardCount === 0) continue;
        if (set.kind === "community") {
          const communityCards = await CcgCard.find({ setId: set._id }).select("guildId guildName guildRealm").lean();
          cardsBySet.set(setId, communityCards);
          continue;
        }
        if (poolBySet.has(setId)) continue;
        const latestCards = await CcgCard.aggregate<CcgCollectionGuildSource>([
          { $match: { setId: set._id } },
          { $sort: { snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 } },
          { $group: { _id: "$characterId", card: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$card" } },
          { $project: { guildId: 1, guildName: 1, guildRealm: 1 } },
        ]);
        cardsBySet.set(setId, latestCards);
      }

      const builtAt = new Date();
      await CcgSet.bulkWrite(sets.map((set) => ({
        updateOne: {
          filter: { _id: set._id, collectionGuildsBuiltAt: null },
          update: {
            $set: {
              collectionGuilds: buildCcgCollectionGuilds(cardsBySet.get(String(set._id)) ?? []),
              collectionGuildsBuiltAt: builtAt,
            },
          },
        },
      })));
    })().finally(() => {
      this.collectionGuildsPromise = null;
    });

    await this.collectionGuildsPromise;
  }

  private async buildCollectionCharacters(
    setId: mongoose.Types.ObjectId,
    session?: mongoose.ClientSession,
  ): Promise<NonNullable<ICcgSet["collectionCharacters"]>> {
    const cardsQuery = CcgCard.find({ setId })
      .select("_id characterId collectorKey name realm classID guildName publishedAt")
      .lean();
    if (session) cardsQuery.session(session);
    const cards = await cardsQuery;
    const continuityGraph = await characterContinuityService.getGraph();
    const canonicalCharacterIdByCharacterId = new Map<string, mongoose.Types.ObjectId>();
    for (const card of cards) {
      canonicalCharacterIdByCharacterId.set(
        String(card.characterId),
        new mongoose.Types.ObjectId(continuityGraph.resolveRoot(card.characterId)),
      );
    }
    const rootCharacterIds = [...new Map(
      [...canonicalCharacterIdByCharacterId.values()].map((id) => [String(id), id]),
    ).values()];
    const charactersQuery = Character.find({ _id: { $in: rootCharacterIds } }).select("_id name").lean();
    if (session) charactersQuery.session(session);
    const characters = await charactersQuery;
    const currentNameByRootId = new Map(characters.map((character) => [String(character._id), character.name]));
    const currentNameByCharacterId = new Map<string, string>();
    for (const [characterId, rootId] of canonicalCharacterIdByCharacterId) {
      const currentName = currentNameByRootId.get(String(rootId));
      if (currentName) currentNameByCharacterId.set(characterId, currentName);
    }
    return buildCcgCardSearchCandidates(cards, currentNameByCharacterId, canonicalCharacterIdByCharacterId).map((candidate) => ({
      collectorKey: candidate.collectorKey,
      characterId: candidate.characterId,
      name: candidate.name,
      realm: candidate.realm,
      classID: candidate.classID,
      publishedAt: candidate.publishedAt,
      searchText: candidate.characterSearchText,
    }));
  }

  async ensureCollectionCharactersMaterialized(setIds: mongoose.Types.ObjectId[]): Promise<void> {
    if (setIds.length === 0) return;
    if (this.collectionCharactersPromise) {
      await this.collectionCharactersPromise;
      return this.ensureCollectionCharactersMaterialized(setIds);
    }

    this.collectionCharactersPromise = (async () => {
      const sets = await CcgSet.find({
        _id: { $in: setIds },
        collectionCharactersBuiltAt: null,
      }).select("_id").lean();
      if (sets.length === 0) return;

      for (const set of sets) {
        const collectionCharacters = await this.buildCollectionCharacters(set._id);
        await CcgSet.updateOne(
          { _id: set._id, collectionCharactersBuiltAt: null },
          { $set: { collectionCharacters, collectionCharactersBuiltAt: new Date() } },
        );
      }
    })().finally(() => {
      this.collectionCharactersPromise = null;
    });

    await this.collectionCharactersPromise;
  }

  async rebuildPool(setId: mongoose.Types.ObjectId, version?: string, existingSession?: mongoose.ClientSession): Promise<string> {
    const set = await CcgSet.findById(setId).session(existingSession ?? null).lean();
    if (!set) throw new Error("CCG set not found");
    const cardFilter: Record<string, unknown> = { setId, availabilityStatus: { $ne: "archived" } };
    if (set.kind === "community") {
      const activeCharacters = await CcgCommunityCharacter.find({ active: { $ne: false } })
        .select("_id")
        .session(existingSession ?? null)
        .lean();
      cardFilter.communityCharacterId = { $in: activeCharacters.map((character) => character._id) };
    }
    const latestCards = CcgCard.aggregate<Pick<ICcgCard, "_id" | "tierGrade" | "setNumber" | "guildId" | "guildName" | "guildRealm">>([
      { $match: cardFilter },
      { $sort: { snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 } },
      { $group: { _id: "$characterId", card: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$card" } },
      { $sort: { setNumber: 1 } },
      { $project: { _id: 1, tierGrade: 1, setNumber: 1, guildId: 1, guildName: 1, guildRealm: 1 } },
    ]);
    if (existingSession) latestCards.session(existingSession);
    const cards = await latestCards;
    const poolVersion = version ?? `${CCG_POOL_VERSION}-${set.publicationWave}`;
    const poolGrades = set.kind === "community" ? CCG_TIER_GRADES : CCG_REGULAR_TIER_GRADES;
    const buckets = poolGrades.map((grade) => ({
      grade,
      cardIds: cards.filter((card) => card.tierGrade === grade).map((card) => card._id),
    }));
    let collectionGuildCards: ReadonlyArray<CcgCollectionGuildSource> = cards;
    if (set.kind === "community") {
      const communityCards = CcgCard.find({ setId }).select("guildId guildName guildRealm").lean();
      if (existingSession) communityCards.session(existingSession);
      collectionGuildCards = await communityCards;
    }
    const collectionGuilds = buildCcgCollectionGuilds(collectionGuildCards);
    const collectionCharacters = await this.buildCollectionCharacters(setId, existingSession);
    const writePool = async (session: mongoose.ClientSession) => {
      await CcgPackPool.updateMany({ setId, active: true }, { $set: { active: false } }, { session });
      await CcgPackPool.findOneAndUpdate(
        { setId, version: poolVersion },
        { $set: { active: true, buckets, totalCards: cards.length } },
        { upsert: true, returnDocument: "after", session },
      );
      await CcgSet.updateOne(
        { _id: setId },
        {
          $set: {
            cardCount: cards.length,
            collectionGuilds,
            collectionGuildsBuiltAt: new Date(),
            collectionCharacters,
            collectionCharactersBuiltAt: new Date(),
          },
        },
        { session },
      );
    };
    if (existingSession) {
      await writePool(existingSession);
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => writePool(session));
      } finally {
        await session.endSession();
      }
    }
    return poolVersion;
  }

  async preview(zoneId: number): Promise<CcgSetReadiness> {
    const configured = CCG_CONFIGURED_SETS.find((set) => set.zoneId === zoneId);
    if (!configured) throw new Error(`CCG set is not configured for raid ${zoneId}`);
    const set = await CcgSet.findOne({ zoneId }).lean();
    const activation = await this.getActivationState(configured);
    const population = await this.loadSnapshotPopulation(zoneId, { allowEmpty: true });
    const [published, mediaByCharacter, pool] = await Promise.all([
      set ? CcgCard.distinct("characterId", { setId: set._id }).then((characterIds) => characterIds.length) : 0,
      this.loadContinuityMedia(population.continuity),
      set ? CcgPackPool.findOne({ setId: set._id, active: true }).select("totalCards").lean() : null,
    ]);
    const eligible = population.characterIds.length;
    const mediaReady = population.characterIds.filter((characterId) => hasStoredRender(mediaByCharacter.get(String(characterId)))).length;
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
      activationRevision: activation.revision,
      replacesCurrentSets: configured.state === "current"
        ? activation.fromSets.map((currentSet) => ({
            id: String(currentSet._id),
            raidName: currentSet.raidName,
            mythicPlusSeason: currentSet.mythicPlusSeason,
          }))
        : [],
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

  async enableSet(zoneId: number, enabledBy: mongoose.Types.ObjectId, options: { force?: boolean; expectedRevision?: string } = {}): Promise<{
    readiness: CcgSetReadiness;
    publication: { snapshotKey: string; published: number; unchanged: number; totalCards: number; poolVersion: string };
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
      if (!options.expectedRevision || options.expectedRevision !== before.activationRevision) {
        throw new CcgPublisherError(409, "activation_preview_stale", "The active CCG raid state changed. Refresh the readiness preview before enabling this raid");
      }
      if (!before.readyToEnable && !options.force) {
        throw new CcgPublisherError(409, "set_not_ready", `${configured.raidName} does not meet the CCG readiness requirements`);
      }

      await this.buildSnapshot(zoneId);
      const publication = await this.publishLatestWave(configured.slug);
      const minimumPublishedCards = options.force ? 1 : CCG_ENABLE_MIN_MEDIA_READY_CHARACTERS;
      if (publication.totalCards < minimumPublishedCards) {
        throw new CcgPublisherError(409, "published_pool_too_small", `${configured.raidName} does not have enough publishable cards`);
      }

      const session = await mongoose.startSession();
      let movedToLegacy = 0;
      try {
        await session.withTransaction(async () => {
          movedToLegacy = 0;
          const target = await CcgSet.findOne({ zoneId, state: "draft", enabledAt: null }).session(session);
          if (!target) throw new CcgPublisherError(409, "set_activation_conflict", `${configured.raidName} can no longer be enabled`);
          const activation = await this.getActivationState(configured, session);
          if (activation.revision !== options.expectedRevision) {
            throw new CcgPublisherError(409, "activation_preview_stale", "The active CCG raid state changed. Refresh the readiness preview before enabling this raid");
          }
          const now = new Date();
          if (configured.state === "current") {
            if (activation.fromSets.length > 0) {
              const moved = await CcgSet.updateMany(
                { _id: { $in: activation.fromSets.map((set) => set._id) }, state: "current", enabledAt: { $ne: null } },
                { $set: { state: "legacy", closesAt: now } },
                { session },
              );
              if (moved.modifiedCount !== activation.fromSets.length) {
                throw new CcgPublisherError(409, "set_activation_conflict", "The active CCG raids changed during activation");
              }
              movedToLegacy = moved.modifiedCount;
            }
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

  async getEnabledRaidSets(): Promise<ICcgSet[]> {
    await this.ensureConfiguredSets();
    return CcgSet.find({
      kind: "raid",
      state: { $in: ["current", "legacy"] },
      enabledAt: { $ne: null },
      cardCount: { $gt: 0 },
    }).sort({ state: 1, zoneId: -1 });
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
