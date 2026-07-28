import { randomUUID } from "crypto";
import mongoose from "mongoose";
import {
  CCG_TIER_GRADES,
  CcgFinish,
  CcgTierGrade,
  getCcgPackFinishOrder,
} from "../config/ccg";
import CcgCard from "../models/CcgCard";
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
} from "../utils/ccg-leaderboard";
import discordService from "./discord.service";

const LEADERBOARD_LOCK_KEY = "ccg-leaderboard-refresh-v1";
const LEADERBOARD_LOCK_MS = 15 * 60 * 1000;
const WRITE_BATCH_SIZE = 500;

type SeriesRow = {
  ownerId: mongoose.Types.ObjectId;
  setId: mongoose.Types.ObjectId;
  firstAcquiredAt: Date;
  unlockedSnapshotVersions: number[];
  finishes: Array<{ finish: CcgFinish }>;
  cards: Array<{ tierGrade: CcgTierGrade }>;
};

type MutableScore = {
  userId: mongoose.Types.ObjectId;
  firstCollectedAt: Date;
  cardsOwned: number;
  snapshotsOwned: number;
  finishesOwned: number;
  premiumFinishesOwned: number;
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

export type CcgLeaderboardRefreshResult = {
  refreshed: boolean;
  participants: number;
  calculatedAt: Date | null;
};

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

  async getUser(userId: mongoose.Types.ObjectId): Promise<ICcgLeaderboardEntry | null> {
    await this.ensureInitialized();
    return CcgLeaderboardEntry.findOne({ userId, scoreVersion: CCG_COLLECTION_SCORE_VERSION });
  }

  async refresh(): Promise<CcgLeaderboardRefreshResult> {
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
      return {
        refreshed: false,
        participants: await CcgLeaderboardEntry.countDocuments({ scoreVersion: CCG_COLLECTION_SCORE_VERSION }),
        calculatedAt: null,
      };
    }

    try {
      const sets = await CcgSet.find({ enabledAt: { $ne: null }, cardCount: { $gt: 0 } })
        .select("_id kind customFinish cardCount")
        .lean();
      const setById = new Map(sets.map((set) => [String(set._id), set]));
      const scores = new Map<string, MutableScore>();
      const cursor = CcgSeriesOwnership.aggregate<SeriesRow>([
        { $match: { ownerType: "user", setId: { $in: sets.map((set) => set._id) } } },
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
              { $project: { _id: 0, tierGrade: 1 } },
            ],
            as: "cards",
          },
        },
        { $match: { "finishes.0": { $exists: true }, "cards.0": { $exists: true } } },
        { $project: { _id: 0, ownerId: 1, setId: 1, firstAcquiredAt: 1, unlockedSnapshotVersions: 1, finishes: 1, cards: 1 } },
      ]).allowDiskUse(true).cursor({ batchSize: 500 });

      for await (const row of cursor) {
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
        score.completedCards += seriesScore.allFinishesOwned ? 1 : 0;
        score.breakdown.collection += CCG_SERIES_BASE_POINTS;
        score.breakdown.rarity += seriesScore.rarityPoints;
        score.breakdown.finishes += seriesScore.finishPoints;
        score.breakdown.completedCards += seriesScore.allFinishesPoints;
        score.setCounts.set(String(row.setId), (score.setCounts.get(String(row.setId)) ?? 0) + 1);
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
      const calculatedAt = new Date();
      const entries = Array.from(scores.values())
        .flatMap((score) => {
          const user = userById.get(String(score.userId));
          if (!user) return [];
          const totalScore = Object.values(score.breakdown).reduce((total, points) => total + points, 0);
          return [{ score, user, totalScore }];
        })
        .sort((left, right) => (
          right.totalScore - left.totalScore
          || right.score.cardsOwned - left.score.cardsOwned
          || right.score.finishesOwned - left.score.finishesOwned
          || left.score.firstCollectedAt.getTime() - right.score.firstCollectedAt.getTime()
          || String(left.score.userId).localeCompare(String(right.score.userId))
        ));

      for (let offset = 0; offset < entries.length; offset += WRITE_BATCH_SIZE) {
        const batch = entries.slice(offset, offset + WRITE_BATCH_SIZE);
        await CcgLeaderboardEntry.bulkWrite(batch.map(({ score, user, totalScore }, index) => ({
          updateOne: {
            filter: { userId: score.userId },
            update: {
              $set: {
                rank: offset + index + 1,
                username: user.discord.username,
                avatarUrl: discordService.getAvatarUrl(user.discord.id, user.discord.avatar),
                score: totalScore,
                cardsOwned: score.cardsOwned,
                snapshotsOwned: score.snapshotsOwned,
                finishesOwned: score.finishesOwned,
                premiumFinishesOwned: score.premiumFinishesOwned,
                completedCards: score.completedCards,
                completedSets: score.completedSets,
                breakdown: score.breakdown,
                scoreVersion: CCG_COLLECTION_SCORE_VERSION,
                calculatedAt,
              },
            },
            upsert: true,
          },
        })), { ordered: false });
      }
      await CcgLeaderboardEntry.deleteMany({ calculatedAt: { $ne: calculatedAt } });
      return { refreshed: true, participants: entries.length, calculatedAt };
    } finally {
      await CcgJobLock.deleteOne({ key: LEADERBOARD_LOCK_KEY, owner: lockOwner });
    }
  }
}

export default new CcgLeaderboardService();
