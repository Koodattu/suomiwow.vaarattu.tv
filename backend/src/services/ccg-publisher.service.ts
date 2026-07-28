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
  CCG_INITIAL_PACKS,
  CCG_PACK_RULE_VERSION,
  CCG_PACK_STORAGE_CAPS,
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
import CcgPackBalance from "../models/CcgPackBalance";
import CcgPackCredit from "../models/CcgPackCredit";
import CcgPackPool from "../models/CcgPackPool";
import CcgPublicationCandidate from "../models/CcgPublicationCandidate";
import CcgRollover from "../models/CcgRollover";
import CcgSet, { ICcgSet } from "../models/CcgSet";
import Character from "../models/Character";
import CharacterMedia, { CharacterMediaStatus } from "../models/CharacterMedia";
import CharacterMythicPlusSeasonScore from "../models/CharacterMythicPlusSeasonScore";
import CharacterTierListEntry from "../models/CharacterTierListEntry";
import { gradeForPercentile, resolveCardCrop } from "../utils/ccg-random";
import { buildCcgCardSearchCandidates } from "../utils/ccg-card-search";
import { createCharacterCollectorKey, createWowCharacterIdentityKey } from "../utils/ccg-identity";
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
import { getCharacterRaidParticipationSummaries } from "./character-raid-guild.service";
import characterMediaService from "./character-media.service";

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
  rollover: CcgRolloverPreview;
  readyToEnable: boolean;
  blockers: CcgReadinessBlocker[];
  thresholds: {
    eligible: number;
    mediaReady: number;
    mediaCoverage: number;
  };
  checkedAt: Date;
};

export type CcgRolloverPreview = {
  required: boolean;
  fromSets: Array<{ id: string; raidName: string; mythicPlusSeason: string }>;
  balanceOwners: { users: number; guests: number; total: number };
  storedCurrentPacks: { regular: number; bonus: number; total: number };
  newCurrentPacks: { users: number; guests: number; total: number };
};

type CcgActivationState = {
  fromSets: Array<{
    _id: mongoose.Types.ObjectId;
    raidName: string;
    mythicPlusSeason: string;
  }>;
  latestRolloverSequence: number;
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

  private async getActivationState(configured: CcgConfiguredSet, session?: mongoose.ClientSession): Promise<CcgActivationState> {
    const currentSetsQuery = CcgSet.find({
      state: "current",
      enabledAt: { $ne: null },
      mythicPlusSeason: { $ne: configured.mythicPlusSeason },
    })
      .select("_id raidName mythicPlusSeason")
      .sort({ zoneId: 1 })
      .lean();
    const latestRolloverQuery = CcgRollover.findOne({}).select("sequence").sort({ sequence: -1 }).lean();
    if (session) {
      currentSetsQuery.session(session);
      latestRolloverQuery.session(session);
    }
    const [fromSets, latestRollover] = await Promise.all([currentSetsQuery, latestRolloverQuery]);
    const latestRolloverSequence = latestRollover?.sequence ?? 0;
    const revision = createHash("sha256")
      .update(JSON.stringify({
        targetZoneId: configured.zoneId,
        targetSeason: configured.mythicPlusSeason,
        fromSetIds: fromSets.map((set) => String(set._id)),
        latestRolloverSequence,
      }))
      .digest("hex")
      .slice(0, 24);
    return { fromSets, latestRolloverSequence, revision };
  }

  private async getRolloverPreview(configured: CcgConfiguredSet, activation: CcgActivationState): Promise<CcgRolloverPreview> {
    if (configured.state !== "current" || activation.fromSets.length === 0) {
      return {
        required: false,
        fromSets: [],
        balanceOwners: { users: 0, guests: 0, total: 0 },
        storedCurrentPacks: { regular: 0, bonus: 0, total: 0 },
        newCurrentPacks: { users: 0, guests: 0, total: 0 },
      };
    }

    const [balanceRows, creditRows] = await Promise.all([
      CcgPackBalance.aggregate<{ _id: "user" | "guest"; owners: number; currentRemaining: number }>([
        {
          $match: {
            $or: [
              { ownerType: "user" },
              { ownerType: "guest", expiresAt: { $gt: new Date() } },
            ],
          },
        },
        {
          $group: {
            _id: "$ownerType",
            owners: { $sum: 1 },
            currentRemaining: { $sum: "$currentRemaining" },
          },
        },
      ]),
      CcgPackCredit.aggregate<{ _id: null; remaining: number }>([
        { $match: { mode: "current", remaining: { $gt: 0 } } },
        { $group: { _id: null, remaining: { $sum: "$remaining" } } },
      ]),
    ]);
    const users = balanceRows.find((row) => row._id === "user")?.owners ?? 0;
    const guests = balanceRows.find((row) => row._id === "guest")?.owners ?? 0;
    const regular = balanceRows.reduce((total, row) => total + row.currentRemaining, 0);
    const bonus = creditRows[0]?.remaining ?? 0;
    const userPacks = users * CCG_PACK_STORAGE_CAPS.current;
    const guestPacks = guests * CCG_INITIAL_PACKS.guest.current;

    return {
      required: true,
      fromSets: activation.fromSets.map((set) => ({
        id: String(set._id),
        raidName: set.raidName,
        mythicPlusSeason: set.mythicPlusSeason,
      })),
      balanceOwners: { users, guests, total: users + guests },
      storedCurrentPacks: { regular, bonus, total: regular + bonus },
      newCurrentPacks: { users: userPacks, guests: guestPacks, total: userPacks + guestPacks },
    };
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
          { upsert: true, new: true },
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
      { upsert: true, new: true },
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

  private async loadSnapshotPopulation(zoneId: number, options: { ensureConfigured?: boolean } = {}) {
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
    const participationByCharacter = await getCharacterRaidParticipationSummaries(
      zoneId,
      rankedEntries.map((entry) => entry.characterId),
    );
    const entries = rankedEntries
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
    if (entries.length === 0) throw new Error(`No complete character tier-list population is available for raid ${zoneId}`);

    return {
      configured,
      set,
      entries: entries.map((entry, index) => ({ entry, tierGrade: gradeForPercentile(index, entries.length) })),
      participationByCharacter,
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
      const { set, entries, characterIds } = await this.loadSnapshotPopulation(enabledSet.zoneId, { ensureConfigured: false });
      const [mediaRows, existingCards] = await Promise.all([
        CharacterMedia.find({ characterId: { $in: characterIds } })
          .select("characterId mainRawUrl status attemptCount nextAttemptAt lastErrorCode lastError")
          .lean(),
        CcgCard.find({ setId: set._id, characterId: { $in: characterIds } })
          .sort({ snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 })
          .select("characterId tierGrade")
          .lean(),
      ]);
      const mediaByCharacter = new Map(mediaRows.map((row) => [String(row.characterId), row]));
      const latestCardByCharacter = new Map<string, { characterId: string; tierGrade: CcgTierGrade }>();
      for (const card of existingCards) {
        const characterId = String(card.characterId);
        if (!latestCardByCharacter.has(characterId)) {
          latestCardByCharacter.set(characterId, { characterId, tierGrade: card.tierGrade });
        }
      }
      const candidates = entries.map(({ entry, tierGrade }) => {
        const media = mediaByCharacter.get(String(entry.characterId));
        return {
          characterId: String(entry.characterId),
          tierGrade,
          hasMedia: media?.status === "available" && Boolean(media.mainRawUrl),
        };
      });
      const summary = summarizeCcgSnapshotPreview(candidates, [...latestCardByCharacter.values()]);
      const characters = entries.flatMap(({ entry, tierGrade }) => {
        const characterId = String(entry.characterId);
        const media = mediaByCharacter.get(characterId);
        const latestCard = latestCardByCharacter.get(characterId);
        const disposition = getCcgSnapshotPreviewDisposition(
          latestCard,
          tierGrade,
          media?.status === "available" && Boolean(media.mainRawUrl),
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
            : media.status === "available" && !media.mainRawUrl
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
      const { configured, set, entries, participationByCharacter, characterIds } = await this.loadSnapshotPopulation(zoneId);
      const snapshotKey = `${set.slug}:${getHelsinkiDateKey()}`;
      const [mediaRows, mythicPlusRows] = await Promise.all([
        CharacterMedia.find({ characterId: { $in: characterIds }, status: "available" }).lean(),
        CharacterMythicPlusSeasonScore.find({ characterId: { $in: characterIds }, season: configured.mythicPlusSeason })
          .select("characterId scores.all fetchedAt")
          .lean(),
      ]);
      const mediaByCharacter = new Map(mediaRows.map((row) => [String(row.characterId), row]));
      const mythicPlusByCharacter = new Map(
        mythicPlusRows.map((row) => [String(row.characterId), row.scores.all > 0 ? row.scores.all : null]),
      );
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

      const missing = entries.filter(({ entry }) => !mediaByCharacter.get(String(entry.characterId))?.mainRawUrl);
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
      const existingCards = await CcgCard.find({
        setId: set._id,
        characterId: { $in: candidates.map((candidate) => candidate.characterId) },
      })
        .sort({ snapshotVersion: -1, performanceSnapshotAt: -1, publishedAt: -1, _id: -1 })
        .lean();
      const latestCardByCharacter = new Map<string, (typeof existingCards)[number]>();
      for (const card of existingCards) {
        const characterId = String(card.characterId);
        if (!latestCardByCharacter.has(characterId)) latestCardByCharacter.set(characterId, card);
      }
      const unchanged = candidates.filter((candidate) => (
        !shouldPublishCcgCardSnapshot(latestCardByCharacter.get(String(candidate.characterId)), candidate.tierGrade)
      ));
      const publishable = candidates.filter((candidate) => (
        shouldPublishCcgCardSnapshot(latestCardByCharacter.get(String(candidate.characterId)), candidate.tierGrade)
      ));
      const mediaRows = await CharacterMedia.find({
        characterId: { $in: publishable.map((candidate) => candidate.characterId) },
        status: "available",
        mainRawUrl: { $ne: null },
      }).lean();
      const mediaByCharacter = new Map(mediaRows.map((row) => [String(row.characterId), row]));
      const ready = publishable.filter((candidate) => mediaByCharacter.get(String(candidate.characterId))?.mainRawUrl);
      const communityCharacters = await CcgCommunityCharacter.find()
        .select("collectorKey identityKey linkedCharacterId")
        .lean();
      const communityCollectorByCharacter = new Map(
        communityCharacters
          .filter((row) => row.linkedCharacterId)
          .map((row) => [String(row.linkedCharacterId), row.collectorKey]),
      );
      const communityCollectorByIdentity = new Map(communityCharacters.map((row) => [row.identityKey, row.collectorKey]));
      const maximum = await CcgCard.findOne({ setId: set._id }).sort({ setNumber: -1 }).select("setNumber").lean();
      let nextSetNumber = (maximum?.setNumber ?? 0) + 1;
      const wave = set.publicationWave + 1;
      const now = new Date();
      const docs = ready.map((candidate) => {
        const payload = candidate.payload as SnapshotPayload;
        const media = mediaByCharacter.get(String(candidate.characterId))!;
        const previousCard = latestCardByCharacter.get(String(candidate.characterId));
        const collectorKey = previousCard?.collectorKey
          ?? communityCollectorByCharacter.get(String(candidate.characterId))
          ?? communityCollectorByIdentity.get(createWowCharacterIdentityKey(payload.region, payload.realm, payload.name))
          ?? createCharacterCollectorKey(candidate.characterId);
        return {
          setId: set._id,
          setNumber: previousCard?.setNumber ?? nextSetNumber++,
          snapshotVersion: nextCcgCardSnapshotVersion(previousCard),
          snapshotKey: candidate.snapshotKey,
          supersedesCardId: previousCard?._id ?? null,
          characterId: candidate.characterId,
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
          renderUrl: media.mainRawUrl ?? null,
          backgroundCrop: resolveCardCrop(`${set.slug}:${candidate.characterId}`, set.backgroundSafeCrop),
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
      const totalCards = (await CcgCard.distinct("characterId", { setId: set._id })).length;
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
    const characterIds = Array.from(new Set(cards.map((card) => String(card.characterId))))
      .map((id) => new mongoose.Types.ObjectId(id));
    const charactersQuery = Character.find({ _id: { $in: characterIds } }).select("_id name").lean();
    if (session) charactersQuery.session(session);
    const characters = await charactersQuery;
    const currentNameByCharacterId = new Map(characters.map((character) => [String(character._id), character.name]));
    return buildCcgCardSearchCandidates(cards, currentNameByCharacterId).map((candidate) => ({
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
    const cardFilter: Record<string, unknown> = { setId };
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
        { upsert: true, new: true, session },
      );
      await CcgSet.updateOne(
        { _id: setId },
        {
          $set: {
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
    const rankedEntries = await CharacterTierListEntry.find({
      scope: "global",
      zoneId,
      pulls: { $gte: MIN_CHARACTER_RAID_PULLS_FOR_RANKING_ELIGIBILITY },
      ...COMPLETE_CCG_SCORE_FILTER,
    })
      .select("characterId")
      .lean();
    const participationByCharacter = await getCharacterRaidParticipationSummaries(
      zoneId,
      rankedEntries.map((entry) => entry.characterId),
    );
    const ids = rankedEntries
      .filter(
        (entry) => (participationByCharacter.get(String(entry.characterId))?.mythicReportCount ?? 0) >= MIN_CHARACTER_RAID_MYTHIC_REPORTS_FOR_CCG_ELIGIBILITY,
      )
      .map((entry) => entry.characterId);
    const [published, mediaReady, pool] = await Promise.all([
      set ? CcgCard.distinct("characterId", { setId: set._id }).then((characterIds) => characterIds.length) : 0,
      CharacterMedia.countDocuments({ characterId: { $in: ids }, status: "available", mainRawUrl: { $ne: null } }),
      set ? CcgPackPool.findOne({ setId: set._id, active: true }).select("totalCards").lean() : null,
    ]);
    const eligible = ids.length;
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
      rollover: await this.getRolloverPreview(configured, activation),
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
    rollover: { sequence: number; effectiveAt: Date; fromSetIds: string[] } | null;
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
      let activatedRollover: { sequence: number; effectiveAt: Date; fromSetIds: string[] } | null = null;
      try {
        await session.withTransaction(async () => {
          movedToLegacy = 0;
          activatedRollover = null;
          const target = await CcgSet.findOne({ zoneId, state: "draft", enabledAt: null }).session(session);
          if (!target) throw new CcgPublisherError(409, "set_activation_conflict", `${configured.raidName} can no longer be enabled`);
          const activation = await this.getActivationState(configured, session);
          if (activation.revision !== options.expectedRevision) {
            throw new CcgPublisherError(409, "activation_preview_stale", "The active CCG raid state changed. Refresh the readiness preview before enabling this raid");
          }
          const now = new Date();
          if (configured.state === "current") {
            if (activation.fromSets.length > 0) {
              const sequence = activation.latestRolloverSequence + 1;
              const [rollover] = await CcgRollover.create(
                [{
                  sequence,
                  fromSetIds: activation.fromSets.map((set) => set._id),
                  fromSeasons: Array.from(new Set(activation.fromSets.map((set) => set.mythicPlusSeason))),
                  toSetId: target._id,
                  toSeason: target.mythicPlusSeason,
                  effectiveAt: now,
                  activatedBy: enabledBy,
                  userCurrentPacks: CCG_PACK_STORAGE_CAPS.current,
                  guestCurrentPacks: CCG_INITIAL_PACKS.guest.current,
                }],
                { session },
              );
              const moved = await CcgSet.updateMany(
                { _id: { $in: activation.fromSets.map((set) => set._id) }, state: "current", enabledAt: { $ne: null } },
                { $set: { state: "legacy", closesAt: now } },
                { session },
              );
              if (moved.modifiedCount !== activation.fromSets.length) {
                throw new CcgPublisherError(409, "set_activation_conflict", "The active CCG raids changed during activation");
              }
              movedToLegacy = moved.modifiedCount;
              activatedRollover = {
                sequence: rollover.sequence,
                effectiveAt: rollover.effectiveAt,
                fromSetIds: rollover.fromSetIds.map(String),
              };
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

      return { readiness: await this.preview(zoneId), publication, movedToLegacy, rollover: activatedRollover };
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
