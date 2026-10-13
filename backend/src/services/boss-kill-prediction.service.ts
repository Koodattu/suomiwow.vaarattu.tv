import Guild, { IPullHistoryEntry, IRaidProgress } from "../models/Guild";
import type { PipelineStage, Types } from "mongoose";
import { resolveFightProgress } from "../utils/fight-progress";

export interface BossPredictionPhaseCount {
  phase: string;
  count: number;
}

export interface BossPredictionSample {
  kills: number;
  pullCount: number;
  phaseCounts: BossPredictionPhaseCount[];
  pullHistory?: BossPredictionPull[];
}

export type BossPredictionPull = Pick<IPullHistoryEntry, "pullNumber" | "fightPercentage" | "bossPercentage" | "isKill">;

export interface BossPredictionTarget {
  pullCount: number;
  bestPercent: number;
  phaseCounts: BossPredictionPhaseCount[];
  pullHistory?: BossPredictionPull[];
}

export interface BossKillPrediction {
  estimatedKillPull: number;
  estimatedRemainingPulls: number;
  optimisticKillPull: number;
  pessimisticKillPull: number;
  killedGuilds: number;
  progressingGuilds: number;
  medianKillPull: number | null;
  confidence: "low" | "medium" | "high";
  usedPhaseData: boolean;
  method: "similar_progress" | "pull_count";
  matchedGuilds: number;
  usedRecentConsistency: boolean;
}

export interface MostRecentlyPulledBoss {
  raidId: number;
  difficulty: IRaidProgress["difficulty"];
  bossId: number;
}

export type BossPredictionUnavailableReason = "guild_or_boss_not_found" | "boss_not_progressing";

export type GuildBossPredictionResult =
  | {
      available: false;
      reason: BossPredictionUnavailableReason;
    }
  | {
      available: true;
      boss: {
        id: number;
        name: string;
        raidName: string;
        difficulty: IRaidProgress["difficulty"];
      };
      estimate: {
        killPull: number;
        remainingPulls: number;
        optimisticKillPull: number;
        pessimisticKillPull: number;
        confidence: BossKillPrediction["confidence"];
      };
      facts: {
        currentPulls: number;
        bestPercent: number;
        phaseCounts: BossPredictionPhaseCount[];
        killedGuilds: number;
        progressingGuilds: number;
        medianKillPull: number | null;
        usedPhaseData: boolean;
        method: BossKillPrediction["method"];
        matchedGuilds: number;
        usedRecentConsistency: boolean;
      };
    };

interface BossPredictionQuery {
  targetGuildId: Types.ObjectId;
  raidId: number;
  difficulty: IRaidProgress["difficulty"];
  bossId: number;
  target: Omit<BossPredictionTarget, "phaseCounts">;
}

interface AggregatedBossPredictionSample extends BossPredictionSample {
  guildId: Types.ObjectId;
}

interface AggregatedGuildBossTarget extends AggregatedBossPredictionSample {
  guildName: string;
  raidName: string;
  bossName: string;
  bestPercent: number;
}

const PREDICTION_QUERY_TIMEOUT_MS = 10_000;

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const quantile = (values: number[], fraction: number): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
};

const normalizePullCount = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
};

const RECENT_PULL_WINDOW = 5;
const MINIMUM_MATCHED_GUILDS = 3;

// Missing/zero wipe percentages are not evidence of a near-kill. Preserve gaps
// so that an old good pull cannot masquerade as recent consistency.
const getProgressHistory = (sample: { pullCount: number; pullHistory?: BossPredictionPull[] }) =>
  (sample.pullHistory || [])
    .filter((pull) => Number.isInteger(pull.pullNumber) && pull.pullNumber > 0 && pull.pullNumber <= sample.pullCount)
    .sort((a, b) => a.pullNumber - b.pullNumber);

const recentMedian = (history: BossPredictionPull[], end: number): number | null => {
  const recent = history.slice(Math.max(0, end - RECENT_PULL_WINDOW + 1), end + 1);
  if (recent.length !== RECENT_PULL_WINDOW) return null;
  const percentages: number[] = [];
  for (let index = 0; index < recent.length; index += 1) {
    const pull = recent[index];
    if (pull.isKill || (index > 0 && pull.pullNumber !== recent[index - 1].pullNumber + 1)) return null;
    const percentage = resolveFightProgress(pull).percentage;
    if (percentage === null) return null;
    percentages.push(percentage);
  }
  return median(percentages);
};

const getMatchedRemaining = (target: BossPredictionTarget, peers: BossPredictionSample[]) => {
  const targetHistory = getProgressHistory(target);
  const targetRecent = targetHistory[targetHistory.length - 1]?.pullNumber === target.pullCount
    ? recentMedian(targetHistory, targetHistory.length - 1)
    : null;
  const remaining: number[] = [];
  for (const peer of peers) {
    const history = getProgressHistory(peer);
    const kill = history.find((pull) => pull.isKill);
    // An actual first-kill record is required, rather than assuming the stored
    // total is complete. Only pre-kill states may serve as comparisons.
    if (!kill || kill.pullNumber !== peer.pullCount) continue;
    let best = 100;
    for (let index = 0; index < history.length; index += 1) {
      const pull = history[index];
      if (pull.pullNumber >= kill.pullNumber) break;
      const percentage = resolveFightProgress(pull).percentage;
      if (percentage === null) continue;
      best = Math.min(best, percentage);
      if (best > target.bestPercent) continue;
      if (targetRecent !== null) {
        const peerRecent = recentMedian(history, index);
        if (peerRecent === null || peerRecent > targetRecent) continue;
      }
      // One observation per guild: pulls from first reaching at least this
      // best progress and recent consistency until its first kill.
      remaining.push(kill.pullNumber - pull.pullNumber);
      break;
    }
  }
  return { remaining, usedRecentConsistency: targetRecent !== null };
};

export const estimateBossKillPull = (target: BossPredictionTarget, rawPeers: BossPredictionSample[]): BossKillPrediction | null => {
  const targetPulls = normalizePullCount(target.pullCount);
  if (targetPulls === null) return null;

  const peers = rawPeers.flatMap((peer) => {
    const pullCount = normalizePullCount(peer.pullCount);
    return pullCount === null ? [] : [{ ...peer, pullCount, kills: Number.isFinite(peer.kills) ? peer.kills : 0 }];
  });
  const killedPeers = peers.filter((peer) => peer.kills > 0);
  const killedPullMedian = median(killedPeers.map((peer) => peer.pullCount));
  const validBest = Number.isFinite(target.bestPercent) && target.bestPercent > 0 && target.bestPercent <= 100;
  const bestPercent = validBest ? target.bestPercent : 100;
  const matched = validBest
    ? getMatchedRemaining({ ...target, pullCount: targetPulls, bestPercent }, killedPeers)
    : { remaining: [], usedRecentConsistency: false };
  const useHistory = matched.remaining.length >= MINIMUM_MATCHED_GUILDS;

  // Unfinished peers are counted for context only. Their lower bounds are not
  // a minimum for a different guild, and their eventual kill times are unknown.
  const learnedFraction = clamp(1 - bestPercent / 100, 0.1, 0.95);
  const bestPullRemaining = Math.max(1, targetPulls / learnedFraction - targetPulls);
  const laterKillRemaining = killedPeers.filter((peer) => peer.pullCount > targetPulls).map((peer) => peer.pullCount - targetPulls);
  const peerRemaining = median(laterKillRemaining)
    ?? (killedPullMedian === null ? null : Math.max(1, killedPullMedian * 0.15));
  const fallbackRemaining = peerRemaining === null ? bestPullRemaining : peerRemaining * 0.75 + bestPullRemaining * 0.25;
  const estimatedRemainingPulls = Math.ceil(useHistory ? median(matched.remaining)! : fallbackRemaining);

  // These are descriptive peer quartiles (or a deliberately rough fallback),
  // not calibrated probability bounds. Never infer confidence from sample size.
  const optimisticRemaining = useHistory
    ? quantile(matched.remaining, 0.25)!
    : Math.max(1, Math.floor(estimatedRemainingPulls * 0.5));
  const pessimisticRemaining = useHistory
    ? quantile(matched.remaining, 0.75)!
    : Math.ceil(estimatedRemainingPulls * 1.5);

  return {
    estimatedKillPull: targetPulls + estimatedRemainingPulls,
    estimatedRemainingPulls,
    optimisticKillPull: targetPulls + optimisticRemaining,
    pessimisticKillPull: targetPulls + pessimisticRemaining,
    killedGuilds: killedPeers.length,
    progressingGuilds: peers.length - killedPeers.length,
    medianKillPull: killedPullMedian,
    confidence: "low",
    usedPhaseData: false,
    method: useHistory ? "similar_progress" : "pull_count",
    matchedGuilds: matched.remaining.length,
    usedRecentConsistency: useHistory && matched.usedRecentConsistency,
  };
};

class BossKillPredictionService {
  async findMostRecentlyPulledBoss(targetGuildId: Types.ObjectId, raidIds: number[], difficulty?: IRaidProgress["difficulty"]): Promise<MostRecentlyPulledBoss | null> {
    if (raidIds.length === 0) {
      return null;
    }

    const bosses = await Guild.aggregate<MostRecentlyPulledBoss>([
      {
        $match: {
          _id: targetGuildId,
          progress: {
            $elemMatch: {
              raidId: { $in: raidIds },
              bosses: { $elemMatch: { kills: 0, pullCount: { $gt: 0 } } },
            },
          },
        },
      },
      { $unwind: "$progress" },
      { $match: { "progress.raidId": { $in: raidIds }, ...(difficulty ? { "progress.difficulty": difficulty } : {}) } },
      { $unwind: "$progress.bosses" },
      { $match: { "progress.bosses.kills": 0, "progress.bosses.pullCount": { $gt: 0 } } },
      {
        $project: {
          _id: 0,
          raidId: "$progress.raidId",
          difficulty: "$progress.difficulty",
          bossId: "$progress.bosses.bossId",
          latestPullAt: {
            $reduce: {
              input: { $ifNull: ["$progress.bosses.pullHistory", []] },
              initialValue: null,
              in: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $type: "$$this.timestamp" }, "date"] },
                      {
                        $or: [{ $eq: ["$$value", null] }, { $gt: ["$$this.timestamp", "$$value"] }],
                      },
                    ],
                  },
                  "$$this.timestamp",
                  "$$value",
                ],
              },
            },
          },
        },
      },
      { $match: { latestPullAt: { $type: "date" } } },
      { $sort: { latestPullAt: -1 } },
      { $limit: 1 },
    ], { maxTimeMS: PREDICTION_QUERY_TIMEOUT_MS });

    return bosses[0] || null;
  }

  async predict(query: BossPredictionQuery): Promise<BossKillPrediction | null> {
    const samples = await this.getSamples(query);
    const targetGuildId = String(query.targetGuildId);
    const targetSample = samples.find((sample) => String(sample.guildId) === targetGuildId);
    const peers = samples.filter((sample) => String(sample.guildId) !== targetGuildId);

    return estimateBossKillPull(
      {
        ...query.target,
        phaseCounts: targetSample?.phaseCounts || [],
        pullHistory: targetSample?.pullHistory,
      },
      peers,
    );
  }

  async predictForGuildBoss(
    realm: string,
    name: string,
    raidId: number,
    bossId: number,
    difficulty: IRaidProgress["difficulty"],
  ): Promise<GuildBossPredictionResult> {
    const target = await this.getGuildBossTarget(realm, name, raidId, bossId, difficulty);
    if (!target) {
      return { available: false, reason: "guild_or_boss_not_found" };
    }

    if (target.kills > 0 || target.pullCount <= 0) {
      return { available: false, reason: "boss_not_progressing" };
    }

    const samples = await this.getSamples({
      targetGuildId: target.guildId,
      raidId,
      difficulty,
      bossId,
      target: {
        pullCount: target.pullCount,
        bestPercent: target.bestPercent,
      },
    });
    const targetGuildId = String(target.guildId);
    const peers = samples.filter((sample) => String(sample.guildId) !== targetGuildId);
    const prediction = estimateBossKillPull(
      {
        pullCount: target.pullCount,
        bestPercent: target.bestPercent,
        phaseCounts: target.phaseCounts,
        pullHistory: target.pullHistory,
      },
      peers,
    );

    if (!prediction) {
      return { available: false, reason: "boss_not_progressing" };
    }

    return {
      available: true,
      boss: {
        id: bossId,
        name: target.bossName,
        raidName: target.raidName,
        difficulty,
      },
      estimate: {
        killPull: prediction.estimatedKillPull,
        remainingPulls: prediction.estimatedRemainingPulls,
        optimisticKillPull: prediction.optimisticKillPull,
        pessimisticKillPull: prediction.pessimisticKillPull,
        confidence: prediction.confidence,
      },
      facts: {
        currentPulls: target.pullCount,
        bestPercent: target.bestPercent,
        phaseCounts: target.phaseCounts,
        killedGuilds: prediction.killedGuilds,
        progressingGuilds: prediction.progressingGuilds,
        medianKillPull: prediction.medianKillPull,
        usedPhaseData: prediction.usedPhaseData,
        method: prediction.method,
        matchedGuilds: prediction.matchedGuilds,
        usedRecentConsistency: prediction.usedRecentConsistency,
      },
    };
  }

  private async getGuildBossTarget(
    realm: string,
    name: string,
    raidId: number,
    bossId: number,
    difficulty: IRaidProgress["difficulty"],
  ): Promise<AggregatedGuildBossTarget | null> {
    const targets = await Guild.aggregate<AggregatedGuildBossTarget>([
      {
        $match: {
          realm,
          name,
          excludedRaidIds: { $ne: raidId },
          progress: {
            $elemMatch: {
              raidId,
              difficulty,
              bosses: { $elemMatch: { bossId } },
            },
          },
        },
      },
      { $unwind: "$progress" },
      { $match: { "progress.raidId": raidId, "progress.difficulty": difficulty } },
      { $unwind: "$progress.bosses" },
      { $match: { "progress.bosses.bossId": bossId } },
      ...this.getBossSampleProjectionStages({
        guildName: "$name",
        raidName: "$progress.raidName",
        bossName: "$progress.bosses.bossName",
        bestPercent: "$progress.bosses.bestPercent",
      }),
      { $limit: 1 },
    ], { maxTimeMS: PREDICTION_QUERY_TIMEOUT_MS }).collation({ locale: "en", strength: 2 });

    return targets[0] || null;
  }

  private async getSamples(query: BossPredictionQuery): Promise<AggregatedBossPredictionSample[]> {
    const { targetGuildId, raidId, difficulty, bossId } = query;

    return Guild.aggregate<AggregatedBossPredictionSample>([
      {
        $match: {
          $or: [{ _id: targetGuildId }, { excludedRaidIds: { $ne: raidId } }],
          progress: {
            $elemMatch: {
              raidId,
              difficulty,
              bosses: { $elemMatch: { bossId, pullCount: { $gt: 0 } } },
            },
          },
        },
      },
      { $unwind: "$progress" },
      { $match: { "progress.raidId": raidId, "progress.difficulty": difficulty } },
      { $unwind: "$progress.bosses" },
      { $match: { "progress.bosses.bossId": bossId, "progress.bosses.pullCount": { $gt: 0 } } },
      ...this.getBossSampleProjectionStages(),
    ], { maxTimeMS: PREDICTION_QUERY_TIMEOUT_MS });
  }

  private getBossSampleProjectionStages(extraFields: Record<string, string> = {}): PipelineStage[] {
    return [
      {
        $set: {
          predictionPhaseNames: {
            $setUnion: [
              {
                $filter: {
                  input: {
                    $map: {
                      input: { $ifNull: ["$progress.bosses.pullHistory", []] },
                      as: "pull",
                      in: { $ifNull: ["$$pull.phase", ""] },
                    },
                  },
                  as: "phase",
                  cond: { $ne: ["$$phase", ""] },
                },
              },
              [],
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          guildId: "$_id",
          kills: "$progress.bosses.kills",
          pullCount: "$progress.bosses.pullCount",
          pullHistory: {
            $map: {
              input: { $ifNull: ["$progress.bosses.pullHistory", []] },
              as: "pull",
              in: {
                pullNumber: "$$pull.pullNumber",
                fightPercentage: "$$pull.fightPercentage",
                bossPercentage: "$$pull.bossPercentage",
                isKill: "$$pull.isKill",
              },
            },
          },
          phaseCounts: {
            $map: {
              input: "$predictionPhaseNames",
              as: "phase",
              in: {
                phase: "$$phase",
                count: {
                  $size: {
                    $filter: {
                      input: { $ifNull: ["$progress.bosses.pullHistory", []] },
                      as: "pull",
                      cond: { $eq: ["$$pull.phase", "$$phase"] },
                    },
                  },
                },
              },
            },
          },
          ...extraFields,
        },
      },
    ];
  }
}

export default new BossKillPredictionService();
