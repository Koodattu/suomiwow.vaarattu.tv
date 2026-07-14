import Guild, { IRaidProgress } from "../models/Guild";
import type { Types } from "mongoose";

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
  confidence: "low" | "medium" | "high";
  usedPhaseData: boolean;
}

export interface MostRecentlyPulledBoss {
  raidId: number;
  difficulty: IRaidProgress["difficulty"];
  bossId: number;
}

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
      { $unwind: { path: "$progress.bosses.pullHistory", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            raidId: "$progress.raidId",
            difficulty: "$progress.difficulty",
            bossId: "$progress.bosses.bossId",
          },
          latestPullAt: { $max: "$progress.bosses.pullHistory.timestamp" },
        },
      },
      { $match: { latestPullAt: { $type: "date" } } },
      { $sort: { latestPullAt: -1 } },
      { $limit: 1 },
      {
        $project: {
          _id: 0,
          raidId: "$_id.raidId",
          difficulty: "$_id.difficulty",
          bossId: "$_id.bossId",
        },
      },
    ]);

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
      { $unwind: { path: "$progress.bosses.pullHistory", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            guildId: "$_id",
            phase: { $ifNull: ["$progress.bosses.pullHistory.phase", ""] },
          },
          kills: { $first: "$progress.bosses.kills" },
          pullCount: { $first: "$progress.bosses.pullCount" },
          phasePulls: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.guildId",
          kills: { $first: "$kills" },
          pullCount: { $first: "$pullCount" },
          phaseCounts: { $push: { phase: "$_id.phase", count: "$phasePulls" } },
        },
      },
      {
        $project: {
          _id: 0,
          guildId: "$_id",
          kills: 1,
          pullCount: 1,
          phaseCounts: {
            $filter: {
              input: "$phaseCounts",
              as: "phaseCount",
              cond: { $ne: ["$$phaseCount.phase", ""] },
            },
          },
        },
      },
    ]);
  }
}

export default new BossKillPredictionService();
