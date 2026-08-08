import { PipelineStage } from "mongoose";
import CcgAnalyticsParticipant from "../models/CcgAnalyticsParticipant";
import CcgLeaderboardEntry from "../models/CcgLeaderboardEntry";
import TwitchCcgRedemption from "../models/TwitchCcgRedemption";
import User from "../models/User";
import { CCG_COLLECTION_SCORE_VERSION } from "../utils/ccg-leaderboard";

export type CcgAdminUserSort = "packOpenings" | "channelPointsUsed";
export type CcgAdminUserSortDirection = "asc" | "desc";

export interface CcgAdminUsersOptions {
  page: number;
  limit: number;
  sort: CcgAdminUserSort;
  direction: CcgAdminUserSortDirection;
}

export interface CcgAdminUserRow {
  id: string;
  idPrefix: string;
  ownerType: "user" | "guest";
  displayName: string | null;
  twitchDisplayName: string | null;
  packOpenings: number;
  leaderboardScore: number | null;
  channelPointsUsed: number;
  timesRedeemed: number;
}

export interface CcgAdminUsersResponse {
  users: CcgAdminUserRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  sort: {
    field: CcgAdminUserSort;
    direction: CcgAdminUserSortDirection;
  };
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = typeof candidate === "string" ? Number.parseInt(candidate, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseCcgAdminUsersOptions(query: Record<string, unknown>): CcgAdminUsersOptions {
  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(100, parsePositiveInteger(query.limit, 25));
  const sort: CcgAdminUserSort = query.sort === "channelPointsUsed" ? "channelPointsUsed" : "packOpenings";
  const direction: CcgAdminUserSortDirection = query.direction === "asc" ? "asc" : "desc";
  return { page, limit, sort, direction };
}

function buildIdentityStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: User.collection.name,
        let: { ownerId: "$ownerId", ownerType: "$ownerType" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$$ownerType", "user"] },
                  { $eq: ["$_id", "$$ownerId"] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              discordUsername: "$discord.username",
              twitchUserId: "$twitch.id",
              twitchDisplayName: "$twitch.displayName",
            },
          },
        ],
        as: "account",
      },
    },
    { $set: { account: { $arrayElemAt: ["$account", 0] } } },
    {
      $lookup: {
        from: TwitchCcgRedemption.collection.name,
        let: {
          ownerId: "$ownerId",
          ownerType: "$ownerType",
          twitchUserId: "$account.twitchUserId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$$ownerType", "user"] },
                  {
                    $or: [
                      { $eq: ["$grantedUserId", "$$ownerId"] },
                      {
                        $and: [
                          { $ne: [{ $ifNull: ["$$twitchUserId", null] }, null] },
                          { $eq: ["$twitchUserId", "$$twitchUserId"] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              channelPointsUsed: { $sum: "$rewardCost" },
              timesRedeemed: { $sum: 1 },
            },
          },
        ],
        as: "redemptionStats",
      },
    },
    {
      $set: {
        channelPointsUsed: { $ifNull: [{ $arrayElemAt: ["$redemptionStats.channelPointsUsed", 0] }, 0] },
        timesRedeemed: { $ifNull: [{ $arrayElemAt: ["$redemptionStats.timesRedeemed", 0] }, 0] },
      },
    },
  ];
}

function buildLeaderboardStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: CcgLeaderboardEntry.collection.name,
        let: { ownerId: "$ownerId", ownerType: "$ownerType" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$$ownerType", "user"] },
                  { $eq: ["$userId", "$$ownerId"] },
                  { $eq: ["$scoreVersion", CCG_COLLECTION_SCORE_VERSION] },
                ],
              },
            },
          },
          { $project: { _id: 0, score: 1 } },
        ],
        as: "leaderboardEntry",
      },
    },
    {
      $set: {
        leaderboardScore: {
          $cond: [
            { $eq: ["$ownerType", "guest"] },
            0,
            { $ifNull: [{ $arrayElemAt: ["$leaderboardEntry.score", 0] }, null] },
          ],
        },
      },
    },
  ];
}

export function buildCcgAdminUsersPipeline(options: CcgAdminUsersOptions): PipelineStage[] {
  const direction = options.direction === "asc" ? 1 : -1;
  const ownerKeyDirection = options.sort === "packOpenings" ? -direction as 1 | -1 : 1;
  const sortStage: PipelineStage.Sort = {
    $sort: { [options.sort]: direction, ownerKey: ownerKeyDirection },
  };
  const pageStages: PipelineStage[] = [
    { $skip: (options.page - 1) * options.limit },
    { $limit: options.limit },
  ];
  const identityStages = buildIdentityStages();
  const leaderboardStages = buildLeaderboardStages();
  const projectionStage: PipelineStage.Project = {
    $project: {
      _id: 0,
      id: { $toString: "$ownerId" },
      idPrefix: { $substrBytes: [{ $toString: "$ownerId" }, 0, 8] },
      ownerType: 1,
      displayName: {
        $cond: [
          { $eq: ["$ownerType", "user"] },
          { $ifNull: ["$account.discordUsername", "$account.twitchDisplayName"] },
          null,
        ],
      },
      twitchDisplayName: { $ifNull: ["$account.twitchDisplayName", null] },
      packOpenings: 1,
      leaderboardScore: 1,
      channelPointsUsed: 1,
      timesRedeemed: 1,
    },
  };

  if (options.sort === "packOpenings") {
    // The compound participant index can page pack totals before the more expensive identity lookups.
    return [sortStage, ...pageStages, ...identityStages, ...leaderboardStages, projectionStage];
  }
  return [...identityStages, sortStage, ...pageStages, ...leaderboardStages, projectionStage];
}

export async function listCcgAdminUsers(options: CcgAdminUsersOptions): Promise<CcgAdminUsersResponse> {
  const [users, total] = await Promise.all([
    CcgAnalyticsParticipant.aggregate<CcgAdminUserRow>(buildCcgAdminUsersPipeline(options))
      .allowDiskUse(true)
      .exec(),
    CcgAnalyticsParticipant.countDocuments(),
  ]);

  return {
    users,
    pagination: {
      page: options.page,
      limit: options.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / options.limit)),
    },
    sort: { field: options.sort, direction: options.direction },
  };
}
