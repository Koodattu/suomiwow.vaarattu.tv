import { randomUUID } from "crypto";
import mongoose from "mongoose";
import {
  CCG_CONFIGURED_SETS,
  CCG_FINISH_ORDER,
  CCG_TIER_GRADES,
  CcgCustomFinish,
  CcgFinish,
  CcgSetKind,
  CcgTierGrade,
  getCcgPackFinishOrder,
} from "../config/ccg";
import CcgCard, { CcgCardAvailabilityStatus } from "../models/CcgCard";
import CcgJobLock from "../models/CcgJobLock";
import CcgLeaderboardEntry, { ICcgLeaderboardEntry } from "../models/CcgLeaderboardEntry";
import CcgOwnership from "../models/CcgOwnership";
import CcgSeriesOwnership from "../models/CcgSeriesOwnership";
import CcgSet from "../models/CcgSet";
import User from "../models/User";
import {
  CCG_COLLECTION_SCORE_VERSION,
  CCG_COMPLETE_SET_POINTS_PER_CARD,
  CCG_SERIES_BASE_POINTS,
  scoreCcgSeries,
  uniqueCcgLeaderboardFinishes,
} from "../utils/ccg-leaderboard";
import logger from "../utils/logger";
import discordService from "./discord.service";

const LEADERBOARD_LOCK_KEY = "ccg-leaderboard-refresh-v1";
const LEADERBOARD_LOCK_MS = 15 * 60 * 1000;
const INCREMENTAL_LOOKBACK_MS = 5 * 60 * 1000;
const WRITE_BATCH_SIZE = 500;

export type CcgLeaderboardRefreshMode = "full" | "incremental";

type EnabledSet = {
  _id: mongoose.Types.ObjectId;
  kind: CcgSetKind;
  customFinish?: { key?: CcgCustomFinish | null } | null;
  cardCount: number;
};

type SeriesRow = {
  ownerId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  firstAcquiredAt: Date;
  unlockedSnapshotVersions: number[];
  finishes: Array<{ finish: CcgFinish }>;
  cards: Array<{ tierGrade: CcgTierGrade; availabilityStatus?: CcgCardAvailabilityStatus | null }>;
};

type MutableScore = {
  userId: mongoose.Types.ObjectId;
  firstCollectedAt: Date;
  cardsOwned: number;
  snapshotsOwned: number;
  finishesOwned: number;
  premiumFinishesOwned: number;
  finishCounts: Record<CcgFinish, number>;
  completedCards: number;
  completedSets: number;
  setCounts: Map<string, number>;
  breakdown: {
    collection: number;
    rarity: number;
    finishes: number;
    completedCards: number;
    completedSets: number;
  };
};

type LeaderboardEntryData = {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatarUrl: string;
  score: number;
  cardsOwned: number;
  snapshotsOwned: number;
  finishesOwned: number;
  premiumFinishesOwned: number;
  finishCounts: Record<CcgFinish, number>;
  completedCards: number;
  completedSets: number;
  firstCollectedAt: Date;
  breakdown: MutableScore["breakdown"];
};

export type CcgLeaderboardRefreshResult = {
  refreshed: boolean;
  mode: CcgLeaderboardRefreshMode;
  participants: number;
  changedCollectors: number;
  seriesScanned: number;
  durationMs: number;
  calculatedAt: Date | null;
};

export type CcgLeaderboardRefreshStart =
  | { started: false }
  | { started: true; completion: Promise<CcgLeaderboardRefreshResult> };

export type CcgLeaderboardRecordMetric = "uniqueCards" | "finishes" | "completedSets";

export type CcgLeaderboardRecordEntry = {
  rank: number;
  username: string;
  avatarUrl: string;
  value: number;
};

export type CcgLeaderboardRecordBoard =
  | {
      key: CcgLeaderboardRecordMetric;
      kind: "metric";
      metric: CcgLeaderboardRecordMetric;
      entries: CcgLeaderboardRecordEntry[];
    }
  | {
      key: `finish:${CcgFinish}`;
      kind: "finish";
      finish: CcgFinish;
      raidName: string | null;
      entries: CcgLeaderboardRecordEntry[];
    };

export type CcgLeaderboardRecords = {
  calculatedAt: Date | null;
  boards: CcgLeaderboardRecordBoard[];
};

type RecordCandidate = {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatarUrl: string;
  score: number;
  cardsOwned: number;
  finishesOwned: number;
  completedSets: number;
  finishCounts: Record<CcgFinish, number>;
  firstCollectedAt: Date;
  calculatedAt: Date;
};

function emptyFinishCounts(): Record<CcgFinish, number> {
  return Object.fromEntries(CCG_FINISH_ORDER.map((finish) => [finish, 0])) as Record<CcgFinish, number>;
}

export function isCcgSeriesEligibleForSetCompletion(
  cards: ReadonlyArray<{ availabilityStatus?: CcgCardAvailabilityStatus | null }>,
): boolean {
  return cards.some((card) => (card.availabilityStatus ?? "active") !== "archived");
}

function topRecordEntries(
  candidates: readonly RecordCandidate[],
  valueFor: (candidate: RecordCandidate) => number,
): CcgLeaderboardRecordEntry[] {
  return candidates
    .map((candidate) => ({ candidate, value: valueFor(candidate) }))
    .filter(({ value }) => value > 0)
    .sort((left, right) => (
      right.value - left.value
      || right.candidate.score - left.candidate.score
      || left.candidate.firstCollectedAt.getTime() - right.candidate.firstCollectedAt.getTime()
      || String(left.candidate.userId).localeCompare(String(right.candidate.userId))
    ))
    .slice(0, 3)
    .map(({ candidate, value }, index) => ({
      rank: index + 1,
      username: candidate.username,
      avatarUrl: candidate.avatarUrl,
      value,
    }));
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}

class CcgLeaderboardService {
  private initializationPromise: Promise<void> | null = null;

  async ensureInitialized(): Promise<void> {
    if (await CcgLeaderboardEntry.exists({ scoreVersion: CCG_COLLECTION_SCORE_VERSION })) return;
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.refresh().then(() => undefined).finally(() => {
      this.initializationPromise = null;
    });
    return this.initializationPromise;
  }

  async list(limit = 25): Promise<ICcgLeaderboardEntry[]> {
    await this.ensureInitialized();
    return CcgLeaderboardEntry.find({ scoreVersion: CCG_COLLECTION_SCORE_VERSION })
      .sort({ rank: 1 })
      .limit(Math.min(100, Math.max(1, limit)));
  }

  async getUserIfReady(userId: mongoose.Types.ObjectId): Promise<ICcgLeaderboardEntry | null> {
    return CcgLeaderboardEntry.findOne({ userId, scoreVersion: CCG_COLLECTION_SCORE_VERSION });
  }

  async getPublicEntryIfReady(entryId: mongoose.Types.ObjectId): Promise<ICcgLeaderboardEntry | null> {
    return CcgLeaderboardEntry.findOne({
      _id: entryId,
      scoreVersion: CCG_COLLECTION_SCORE_VERSION,
      rank: { $lte: 100 },
    });
  }

  async listRecords(): Promise<CcgLeaderboardRecords> {
    await this.ensureInitialized();
    const [candidates, finishSets] = await Promise.all([
      CcgLeaderboardEntry.find({ scoreVersion: CCG_COLLECTION_SCORE_VERSION })
        .select("userId username avatarUrl score cardsOwned finishesOwned completedSets finishCounts firstCollectedAt calculatedAt")
        .lean<RecordCandidate[]>(),
      CcgSet.find({
        enabledAt: { $ne: null },
        cardCount: { $gt: 0 },
        kind: "raid",
        "customFinish.key": { $exists: true },
      })
        .select("raidName customFinish zoneId")
        .sort({ zoneId: -1 })
        .lean<Array<{ raidName: string; customFinish?: { key?: CcgCustomFinish | null } | null }>>(),
    ]);
    const calculatedAt = candidates.reduce<Date | null>((latest, candidate) => (
      !latest || candidate.calculatedAt > latest ? candidate.calculatedAt : latest
    ), null);
    const configuredRaidNameByFinish = new Map<CcgFinish, string>(
      CCG_CONFIGURED_SETS.flatMap((set) => (
        set.customFinish ? [[set.customFinish.key, set.raidName]] : []
      )),
    );
    const boards: CcgLeaderboardRecordBoard[] = [
      {
        key: "uniqueCards",
        kind: "metric",
        metric: "uniqueCards",
        entries: topRecordEntries(candidates, (candidate) => candidate.cardsOwned),
      },
      {
        key: "finishes",
        kind: "metric",
        metric: "finishes",
        entries: topRecordEntries(candidates, (candidate) => candidate.finishesOwned),
      },
      {
        key: "completedSets",
        kind: "metric",
        metric: "completedSets",
        entries: topRecordEntries(candidates, (candidate) => candidate.completedSets),
      },
      ...(["negative", "astral", "toxic"] as const).map<CcgLeaderboardRecordBoard>((finish) => ({
        key: `finish:${finish}`,
        kind: "finish",
        finish,
        raidName: configuredRaidNameByFinish.get(finish) ?? null,
        entries: topRecordEntries(candidates, (candidate) => candidate.finishCounts?.[finish] ?? 0),
      })),
    ];
    const seenFinishes = new Set<CcgFinish>(["negative", "astral", "toxic"]);
    for (const set of finishSets) {
      const finish = set.customFinish?.key;
      if (!finish || seenFinishes.has(finish)) continue;
      seenFinishes.add(finish);
      boards.push({
        key: `finish:${finish}`,
        kind: "finish",
        finish,
        raidName: set.raidName,
        entries: topRecordEntries(candidates, (candidate) => candidate.finishCounts?.[finish] ?? 0),
      });
    }
    return { calculatedAt, boards };
  }

  async refresh(requestedMode: CcgLeaderboardRefreshMode = "full"): Promise<CcgLeaderboardRefreshResult> {
    const refreshStartedMs = Date.now();
    const start = await this.startRefresh(requestedMode, refreshStartedMs);
    if (start.started) return start.completion;
    return {
      refreshed: false,
      mode: requestedMode,
      participants: await CcgLeaderboardEntry.countDocuments({ scoreVersion: CCG_COLLECTION_SCORE_VERSION }),
      changedCollectors: 0,
      seriesScanned: 0,
      durationMs: Date.now() - refreshStartedMs,
      calculatedAt: null,
    };
  }

  async startRefresh(
    requestedMode: CcgLeaderboardRefreshMode = "full",
    refreshStartedMs = Date.now(),
  ): Promise<CcgLeaderboardRefreshStart> {
    const lockOwner = randomUUID();
    const now = new Date();
    await CcgJobLock.deleteOne({ key: LEADERBOARD_LOCK_KEY, expiresAt: { $lte: now } });
    try {
      await CcgJobLock.create({
        key: LEADERBOARD_LOCK_KEY,
        owner: lockOwner,
        expiresAt: new Date(now.getTime() + LEADERBOARD_LOCK_MS),
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return { started: false };
    }

    return {
      started: true,
      completion: this.runRefresh(requestedMode, refreshStartedMs, lockOwner),
    };
  }

  private async runRefresh(
    requestedMode: CcgLeaderboardRefreshMode,
    refreshStartedMs: number,
    lockOwner: string,
  ): Promise<CcgLeaderboardRefreshResult> {
    const lockHeartbeat = setInterval(() => {
      void CcgJobLock.updateOne(
        { key: LEADERBOARD_LOCK_KEY, owner: lockOwner },
        { $set: { expiresAt: new Date(Date.now() + LEADERBOARD_LOCK_MS) } },
      ).then((result) => {
        if (result.matchedCount === 0) logger.warn("[CCG/Leaderboard] Refresh lock was lost while the build was running");
      }).catch((error) => logger.error("[CCG/Leaderboard] Failed to renew refresh lock:", error));
    }, LEADERBOARD_LOCK_MS / 3);
    lockHeartbeat.unref();
    try {
      const sets = await CcgSet.find({ enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
        .select("_id kind customFinish cardCount")
        .lean<EnabledSet[]>();
      const sourceThroughAt = new Date();
      let mode = requestedMode;
      let ownerIds: mongoose.Types.ObjectId[] | undefined;

      if (mode === "incremental") {
        const oldestEntry = await CcgLeaderboardEntry.findOne({ scoreVersion: CCG_COLLECTION_SCORE_VERSION })
          .sort({ calculatedAt: 1 })
          .select("calculatedAt")
          .lean<{ calculatedAt: Date } | null>();
        if (!oldestEntry) {
          mode = "full";
        } else {
          const dirtySince = new Date(oldestEntry.calculatedAt.getTime() - INCREMENTAL_LOOKBACK_MS);
          ownerIds = (await CcgSeriesOwnership.distinct("ownerId", {
            ownerType: "user",
            lastAcquiredAt: { $gt: dirtySince, $lte: sourceThroughAt },
          })).map((ownerId) => new mongoose.Types.ObjectId(String(ownerId)));
        }
      }

      if (mode === "incremental" && ownerIds?.length === 0) {
        const update = await CcgLeaderboardEntry.updateMany(
          { scoreVersion: CCG_COLLECTION_SCORE_VERSION },
          { $set: { calculatedAt: sourceThroughAt } },
        );
        return {
          refreshed: true,
          mode,
          participants: update.matchedCount,
          changedCollectors: 0,
          seriesScanned: 0,
          durationMs: Date.now() - refreshStartedMs,
          calculatedAt: sourceThroughAt,
        };
      }

      const calculated = await this.calculateEntries(sets, ownerIds);
      let entries = calculated.entries;

      if (mode === "incremental" && ownerIds) {
        const existingEntries = await CcgLeaderboardEntry.find({ scoreVersion: CCG_COLLECTION_SCORE_VERSION })
          .select("userId username avatarUrl score cardsOwned snapshotsOwned finishesOwned premiumFinishesOwned finishCounts completedCards completedSets firstCollectedAt calculatedAt breakdown")
          .lean<Array<Omit<LeaderboardEntryData, "firstCollectedAt"> & { firstCollectedAt?: Date; calculatedAt: Date }>>();
        const entriesByUser = new Map<string, LeaderboardEntryData>(existingEntries.map((entry) => {
          const { calculatedAt, ...entryData } = entry;
          return [String(entry.userId), {
            ...entryData,
            firstCollectedAt: entry.firstCollectedAt ?? calculatedAt,
          }];
        }));
        for (const ownerId of ownerIds) entriesByUser.delete(String(ownerId));
        for (const entry of entries) entriesByUser.set(String(entry.userId), entry);
        entries = Array.from(entriesByUser.values());
      }

      entries.sort(compareLeaderboardEntries);
      await this.writeEntries(entries, sourceThroughAt);

      if (mode === "full") {
        await CcgLeaderboardEntry.deleteMany({ calculatedAt: { $ne: sourceThroughAt } });
      } else if (ownerIds) {
        const calculatedOwnerIds = new Set(calculated.entries.map((entry) => String(entry.userId)));
        const missingOwnerIds = ownerIds.filter((ownerId) => !calculatedOwnerIds.has(String(ownerId)));
        if (missingOwnerIds.length > 0) {
          await CcgLeaderboardEntry.deleteMany({
            scoreVersion: CCG_COLLECTION_SCORE_VERSION,
            userId: { $in: missingOwnerIds },
          });
        }
      }

      return {
        refreshed: true,
        mode,
        participants: entries.length,
        changedCollectors: mode === "full" ? entries.length : ownerIds?.length ?? 0,
        seriesScanned: calculated.seriesScanned,
        durationMs: Date.now() - refreshStartedMs,
        calculatedAt: sourceThroughAt,
      };
    } finally {
      clearInterval(lockHeartbeat);
      await CcgJobLock.deleteOne({ key: LEADERBOARD_LOCK_KEY, owner: lockOwner });
    }
  }

  private async calculateEntries(
    sets: EnabledSet[],
    ownerIds?: mongoose.Types.ObjectId[],
  ): Promise<{ entries: LeaderboardEntryData[]; seriesScanned: number }> {
    const setById = new Map(sets.map((set) => [String(set._id), set]));
    const scores = new Map<string, MutableScore>();
    const seriesMatch: Record<string, unknown> = {
      ownerType: "user",
      setId: { $in: sets.map((set) => set._id) },
    };
    if (ownerIds) seriesMatch.ownerId = { $in: ownerIds };
    const cursor = CcgSeriesOwnership.aggregate<SeriesRow>([
      { $match: seriesMatch },
      {
        $lookup: {
          from: CcgOwnership.collection.name,
          let: { ownerId: "$ownerId", setId: "$setId", characterId: "$characterId" },
          pipeline: [
            {
              $match: {
                ownerType: "user",
                $expr: {
                  $and: [
                    { $eq: ["$ownerId", "$$ownerId"] },
                    { $eq: ["$setId", "$$setId"] },
                    { $eq: ["$characterId", "$$characterId"] },
                  ],
                },
              },
            },
            { $project: { _id: 0, finish: 1 } },
          ],
          as: "finishes",
        },
      },
      {
        $lookup: {
          from: CcgCard.collection.name,
          let: { setId: "$setId", characterId: "$characterId", versions: "$unlockedSnapshotVersions" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$setId", "$$setId"] },
                    { $eq: ["$characterId", "$$characterId"] },
                    { $in: ["$snapshotVersion", "$$versions"] },
                  ],
                },
              },
            },
            { $project: { _id: 0, tierGrade: 1, availabilityStatus: { $ifNull: ["$availabilityStatus", "active"] } } },
          ],
          as: "cards",
        },
      },
      { $match: { "finishes.0": { $exists: true }, "cards.0": { $exists: true } } },
      { $project: { _id: 0, ownerId: 1, setId: 1, firstAcquiredAt: 1, unlockedSnapshotVersions: 1, finishes: 1, cards: 1 } },
    ]).allowDiskUse(true).cursor({ batchSize: 500 });

    let seriesScanned = 0;
    for await (const row of cursor) {
      seriesScanned += 1;
      const set = setById.get(String(row.setId));
      if (!set) continue;
      const userKey = String(row.ownerId);
      const score = scores.get(userKey) ?? {
        userId: row.ownerId,
        firstCollectedAt: row.firstAcquiredAt,
        cardsOwned: 0,
        snapshotsOwned: 0,
        finishesOwned: 0,
        premiumFinishesOwned: 0,
        finishCounts: emptyFinishCounts(),
        completedCards: 0,
        completedSets: 0,
        setCounts: new Map<string, number>(),
        breakdown: { collection: 0, rarity: 0, finishes: 0, completedCards: 0, completedSets: 0 },
      };
      const requiredFinishes = getCcgPackFinishOrder(set.kind, set.customFinish?.key ?? null);
      const seriesScore = scoreCcgSeries(
        row.cards.map((card: { tierGrade: CcgTierGrade }) => CCG_TIER_GRADES.includes(card.tierGrade) ? card.tierGrade : "F"),
        row.finishes.map((finish: { finish: CcgFinish }) => finish.finish),
        requiredFinishes,
      );
      score.firstCollectedAt = row.firstAcquiredAt < score.firstCollectedAt ? row.firstAcquiredAt : score.firstCollectedAt;
      score.cardsOwned += 1;
      score.snapshotsOwned += new Set(row.unlockedSnapshotVersions).size;
      score.finishesOwned += seriesScore.finishesOwned;
      score.premiumFinishesOwned += seriesScore.premiumFinishesOwned;
      for (const finish of uniqueCcgLeaderboardFinishes(row.finishes.map((item: { finish: CcgFinish }) => item.finish))) {
        score.finishCounts[finish] += 1;
      }
      score.completedCards += seriesScore.allFinishesOwned ? 1 : 0;
      score.breakdown.collection += CCG_SERIES_BASE_POINTS;
      score.breakdown.rarity += seriesScore.rarityPoints;
      score.breakdown.finishes += seriesScore.finishPoints;
      score.breakdown.completedCards += seriesScore.allFinishesPoints;
      if (isCcgSeriesEligibleForSetCompletion(row.cards)) {
        score.setCounts.set(String(row.setId), (score.setCounts.get(String(row.setId)) ?? 0) + 1);
      }
      scores.set(userKey, score);
    }

    for (const score of scores.values()) {
      for (const [setId, count] of score.setCounts) {
        const cardCount = setById.get(setId)?.cardCount ?? 0;
        if (cardCount > 0 && count >= cardCount) {
          score.completedSets += 1;
          score.breakdown.completedSets += cardCount * CCG_COMPLETE_SET_POINTS_PER_CARD;
        }
      }
    }

    const users = await User.find({ _id: { $in: Array.from(scores.values(), (score) => score.userId) } })
      .select("discord.id discord.username discord.avatar")
      .lean();
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const entries = Array.from(scores.values()).flatMap<LeaderboardEntryData>((score) => {
      const user = userById.get(String(score.userId));
      if (!user) return [];
      return [{
        userId: score.userId,
        username: user.discord.username,
        avatarUrl: discordService.getAvatarUrl(user.discord.id, user.discord.avatar),
        score: Object.values(score.breakdown).reduce((total, points) => total + points, 0),
        cardsOwned: score.cardsOwned,
        snapshotsOwned: score.snapshotsOwned,
        finishesOwned: score.finishesOwned,
        premiumFinishesOwned: score.premiumFinishesOwned,
        finishCounts: score.finishCounts,
        completedCards: score.completedCards,
        completedSets: score.completedSets,
        firstCollectedAt: score.firstCollectedAt,
        breakdown: score.breakdown,
      }];
    });
    return { entries, seriesScanned };
  }

  private async writeEntries(entries: LeaderboardEntryData[], calculatedAt: Date): Promise<void> {
    for (let offset = 0; offset < entries.length; offset += WRITE_BATCH_SIZE) {
      const batch = entries.slice(offset, offset + WRITE_BATCH_SIZE);
      await CcgLeaderboardEntry.bulkWrite(batch.map((entry, index) => ({
        updateOne: {
          filter: { userId: entry.userId },
          update: {
            $set: {
              ...entry,
              rank: offset + index + 1,
              scoreVersion: CCG_COLLECTION_SCORE_VERSION,
              calculatedAt,
            },
          },
          upsert: true,
        },
      })), { ordered: false });
    }
  }
}

function compareLeaderboardEntries(left: LeaderboardEntryData, right: LeaderboardEntryData): number {
  return right.score - left.score
    || right.cardsOwned - left.cardsOwned
    || right.finishesOwned - left.finishesOwned
    || left.firstCollectedAt.getTime() - right.firstCollectedAt.getTime()
    || String(left.userId).localeCompare(String(right.userId));
}

export default new CcgLeaderboardService();
