import Guild, { IRaidProgress } from "../models/Guild";
import type { PipelineStage, Types } from "mongoose";

export interface BossPredictionPhaseCount {
  phase: string;
  count: number;
}

export interface BossPredictionSample {
  kills: number;
  pullCount: number;
  phaseCounts: BossPredictionPhaseCount[];
}

export interface BossPredictionTarget {
  pullCount: number;
  bestPercent: number;
  phaseCounts: BossPredictionPhaseCount[];
}

export interface BossKillPrediction {
  estimatedKillPull: number;
  estimatedRemainingPulls: number;
  killedGuilds: number;
  progressingGuilds: number;
  medianKillPull: number | null;
  confidence: "low" | "medium" | "high";
  usedPhaseData: boolean;
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

const normalizePullCount = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
};

const getPhaseRank = (phase: string): number | null => {
  const match = /^([PI])(\d+)$/i.exec(phase.trim());
  if (!match) {
    return null;
  }

  const phaseNumber = Number(match[2]);
  if (!Number.isInteger(phaseNumber) || phaseNumber <= 0) {
    return null;
  }

  return phaseNumber * 2 - (match[1].toUpperCase() === "P" ? 1 : 0);
};

const calculatePhaseDepth = (phaseCounts: BossPredictionPhaseCount[], minimumRank: number, maximumRank: number): number | null => {
  if (maximumRank <= minimumRank) {
    return null;
  }

  let weightedDepth = 0;
  let totalCount = 0;

  for (const phaseCount of phaseCounts) {
    const rank = getPhaseRank(phaseCount.phase);
    if (rank === null || !Number.isFinite(phaseCount.count) || phaseCount.count <= 0) {
      continue;
    }

    const count = Math.floor(phaseCount.count);
    weightedDepth += count * ((rank - minimumRank) / (maximumRank - minimumRank));
    totalCount += count;
  }

  return totalCount > 0 ? weightedDepth / totalCount : null;
};

const getPhaseAdjustment = (
  target: BossPredictionTarget,
  peers: BossPredictionSample[],
): { factor: number; usedPhaseData: boolean } => {
  const ranks = [target, ...peers].flatMap((sample) => sample.phaseCounts.map((phaseCount) => getPhaseRank(phaseCount.phase))).filter((rank): rank is number => rank !== null);
  if (ranks.length === 0) {
    return { factor: 1, usedPhaseData: false };
  }

  const minimumRank = Math.min(...ranks);
  const maximumRank = Math.max(...ranks);
  const targetDepth = calculatePhaseDepth(target.phaseCounts, minimumRank, maximumRank);
  const peerDepths = peers
    .map((peer) => calculatePhaseDepth(peer.phaseCounts, minimumRank, maximumRank))
    .filter((depth): depth is number => depth !== null);
  const referenceDepth = median(peerDepths);

  if (targetDepth === null || referenceDepth === null) {
    return { factor: 1, usedPhaseData: false };
  }

  return {
    factor: clamp((referenceDepth + 0.1) / (targetDepth + 0.1), 0.75, 1.25),
    usedPhaseData: true,
  };
};

export const estimateBossKillPull = (target: BossPredictionTarget, rawPeers: BossPredictionSample[]): BossKillPrediction | null => {
  const targetPulls = normalizePullCount(target.pullCount);
  if (targetPulls === null) {
    return null;
  }

  const peers = rawPeers.flatMap((peer) => {
    const pullCount = normalizePullCount(peer.pullCount);
    return pullCount === null
      ? []
      : [
          {
            kills: Number.isFinite(peer.kills) ? peer.kills : 0,
            pullCount,
            phaseCounts: Array.isArray(peer.phaseCounts) ? peer.phaseCounts : [],
          },
        ];
  });
  const killedPeers = peers.filter((peer) => peer.kills > 0);
  const progressingPeers = peers.filter((peer) => peer.kills <= 0);
  const laterKillRemaining = killedPeers.filter((peer) => peer.pullCount > targetPulls).map((peer) => peer.pullCount - targetPulls);
  const killedPullMedian = median(killedPeers.map((peer) => peer.pullCount));
  const activeFloor = median(progressingPeers.filter((peer) => peer.pullCount > targetPulls).map((peer) => peer.pullCount - targetPulls + 1));

  let peerRemaining = median(laterKillRemaining);
  if (peerRemaining === null && killedPullMedian !== null) {
    peerRemaining = Math.max(1, Math.round(killedPullMedian * 0.15));
  }
  if (activeFloor !== null) {
    peerRemaining = Math.max(peerRemaining || 1, activeFloor);
  }

  const bestPercent = clamp(Number.isFinite(target.bestPercent) ? target.bestPercent : 100, 0, 100);
  const learnedFraction = clamp(1 - bestPercent / 100, 0.1, 0.95);
  const bestPullRemaining = Math.max(1, targetPulls / learnedFraction - targetPulls);

  let rawRemaining: number;
  if (killedPeers.length > 0 && peerRemaining !== null) {
    const boundedBestPullRemaining = clamp(bestPullRemaining, peerRemaining * 0.5, peerRemaining * 2);
    rawRemaining = peerRemaining * 0.75 + boundedBestPullRemaining * 0.25;
  } else {
    rawRemaining = Math.max(bestPullRemaining, activeFloor || 0, 1);
  }

  const phaseAdjustment = getPhaseAdjustment(target, peers);
  const estimatedRemainingPulls = Math.ceil(Math.max(1, rawRemaining * phaseAdjustment.factor));
  const killedGuilds = killedPeers.length;
  const comparableKilledGuilds = laterKillRemaining.length;

  return {
    estimatedKillPull: targetPulls + estimatedRemainingPulls,
    estimatedRemainingPulls,
    killedGuilds,
    progressingGuilds: progressingPeers.length,
    medianKillPull: killedPullMedian,
    confidence: comparableKilledGuilds >= 10 ? "high" : comparableKilledGuilds >= 3 ? "medium" : "low",
    usedPhaseData: phaseAdjustment.usedPhaseData,
  };
};

class BossKillPredictionService {
  async findMostRecentlyPulledBoss(targetGuildId: Types.ObjectId, raidIds: number[]): Promise<MostRecentlyPulledBoss | null> {
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
      { $match: { "progress.raidId": { $in: raidIds } } },
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
