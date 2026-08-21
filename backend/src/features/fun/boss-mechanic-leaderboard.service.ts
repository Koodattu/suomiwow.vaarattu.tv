import type { Types } from "mongoose";
import BossMechanicLeaderboardEntry from "../../models/BossMechanicLeaderboardEntry";
import type { IUser } from "../../models/User";
import discordService from "../../services/discord.service";
import {
  isBossMechanicDifficulty,
  type BossMechanicDifficulty,
  type BossMechanicLeaderboardResponse,
  type BossMechanicScoreInput,
} from "./fun-game.types";

const LEADERBOARD_LIMIT = 20;
const DIFFICULTY_RANK: Record<BossMechanicDifficulty, number> = {
  normal: 1,
  heroic: 2,
  mythic: 3,
};
const MAX_TIME_LEFT_MS: Record<BossMechanicDifficulty, number> = {
  normal: 20_000,
  heroic: 10_000,
  mythic: 10_000,
};

type RankedScore = Pick<BossMechanicScoreInput, "difficulty" | "pulls" | "timeLeftMs"> & { difficultyRank: number };

export function sanitizeBossMechanicScoreInput(value: unknown): BossMechanicScoreInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!isBossMechanicDifficulty(input.difficulty)) return null;
  if (!Number.isInteger(input.pulls) || (input.pulls as number) < 1 || (input.pulls as number) > 10_000) return null;
  if (!Number.isInteger(input.timeLeftMs) || (input.timeLeftMs as number) < 0 || (input.timeLeftMs as number) > MAX_TIME_LEFT_MS[input.difficulty]) return null;
  if (typeof input.team !== "string") return null;
  const team = input.team.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!team) return null;
  return {
    difficulty: input.difficulty,
    pulls: input.pulls as number,
    timeLeftMs: input.timeLeftMs as number,
    team,
  };
}

export function isBossMechanicScoreBetter(candidate: RankedScore, current: RankedScore): boolean {
  if (candidate.difficultyRank !== current.difficultyRank) return candidate.difficultyRank > current.difficultyRank;
  if (candidate.timeLeftMs !== current.timeLeftMs) return candidate.timeLeftMs > current.timeLeftMs;
  return candidate.pulls < current.pulls;
}

export async function loadBossMechanicLeaderboard(): Promise<BossMechanicLeaderboardResponse> {
  const rows = await BossMechanicLeaderboardEntry.find({})
    .sort({ difficultyRank: -1, timeLeftMs: -1, pulls: 1, updatedAt: 1 })
    .limit(LEADERBOARD_LIMIT)
    .lean();

  return {
    entries: rows.map((row, index) => ({
      id: row._id.toString(),
      rank: index + 1,
      username: row.username,
      avatarUrl: row.avatarUrl,
      difficulty: row.difficulty,
      pulls: row.pulls,
      timeLeftMs: row.timeLeftMs,
      team: row.team,
    })),
  };
}

export async function submitBossMechanicScore(user: IUser, input: BossMechanicScoreInput): Promise<BossMechanicLeaderboardResponse> {
  const userId = user._id as Types.ObjectId;
  const candidate = { ...input, difficultyRank: DIFFICULTY_RANK[input.difficulty] };
  const existing = await BossMechanicLeaderboardEntry.findOne({ userId }).lean();
  const identity = {
    username: user.discord.username.trim().slice(0, 64),
    avatarUrl: discordService.getAvatarUrl(user.discord.id, user.discord.avatar).slice(0, 512),
  };

  if (!existing || isBossMechanicScoreBetter(candidate, existing)) {
    await BossMechanicLeaderboardEntry.findOneAndUpdate(
      { userId },
      { $set: { ...identity, ...candidate }, $setOnInsert: { userId } },
      { upsert: true, runValidators: true },
    );
  } else {
    await BossMechanicLeaderboardEntry.updateOne({ userId }, { $set: identity }, { runValidators: true });
  }

  return loadBossMechanicLeaderboard();
}
