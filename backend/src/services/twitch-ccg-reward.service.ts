import mongoose from "mongoose";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgPackCredit from "../models/CcgPackCredit";
import TwitchCcgRedemption, { ITwitchCcgRedemption } from "../models/TwitchCcgRedemption";
import User from "../models/User";
import logger from "../utils/logger";

export interface TwitchRedemptionInput {
  redemptionId: string;
  eventMessageId: string;
  broadcasterId: string;
  broadcasterLogin: string;
  twitchUserId: string;
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  redeemedAt: Date;
}

export interface TwitchCcgRewardCounts {
  grants: { pending: number; granted: number; failed: number };
  chat: { pending: number; sent: number; failed: number; expired: number; sent24h: number };
}

class TwitchCcgRewardService {
  async recordRedemption(input: TwitchRedemptionInput): Promise<ITwitchCcgRedemption> {
    const now = new Date();
    await TwitchCcgRedemption.updateOne(
      { redemptionId: input.redemptionId },
      {
        $setOnInsert: {
          ...input,
          receivedAt: now,
          grantStatus: "pending",
          grantAttempts: 0,
          grantNextAttemptAt: now,
          chatStatus: "pending",
          chatAttempts: 0,
          chatNextAttemptAt: now,
          chatExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true },
    );

    const redemption = await TwitchCcgRedemption.findOne({ redemptionId: input.redemptionId });
    if (!redemption) {
      throw new Error("Failed to persist Twitch redemption");
    }
    return redemption;
  }

  async grantPendingForTwitchUser(twitchUserId: string, respectBackoff = false): Promise<number> {
    const user = await User.findOne({ "twitch.id": twitchUserId }).select("_id").lean();
    if (!user) {
      return 0;
    }

    const redemptions = await TwitchCcgRedemption.find({
      twitchUserId,
      grantStatus: { $in: ["pending", "failed"] },
      ...(respectBackoff ? { grantNextAttemptAt: { $lte: new Date() } } : {}),
    })
      .sort({ redeemedAt: 1 })
      .limit(100)
      .select("_id");

    let granted = 0;
    for (const redemption of redemptions) {
      if (await this.grantRedemption(redemption._id, user._id)) {
        granted += 1;
      }
    }
    return granted;
  }

  async retryLinkedPending(limit = 25): Promise<number> {
    const twitchUsers = await TwitchCcgRedemption.aggregate<{ _id: string }>([
      { $match: { grantStatus: { $in: ["pending", "failed"] }, grantNextAttemptAt: { $lte: new Date() } } },
      { $lookup: { from: User.collection.name, localField: "twitchUserId", foreignField: "twitch.id", as: "linkedUsers" } },
      { $match: { "linkedUsers.0": { $exists: true } } },
      { $group: { _id: "$twitchUserId" } },
      { $limit: limit },
    ]);

    let granted = 0;
    for (const twitchUser of twitchUsers) {
      granted += await this.grantPendingForTwitchUser(twitchUser._id, true);
    }
    return granted;
  }

  async getCounts(): Promise<TwitchCcgRewardCounts> {
    const [grantCounts, chatCounts, sent24h] = await Promise.all([
      TwitchCcgRedemption.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$grantStatus", count: { $sum: 1 } } }]),
      TwitchCcgRedemption.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$chatStatus", count: { $sum: 1 } } }]),
      TwitchCcgRedemption.countDocuments({ chatStatus: "sent", chatSentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    ]);
    const grants = new Map(grantCounts.map((entry) => [entry._id, entry.count]));
    const chat = new Map(chatCounts.map((entry) => [entry._id, entry.count]));

    return {
      grants: {
        pending: grants.get("pending") || 0,
        granted: grants.get("granted") || 0,
        failed: grants.get("failed") || 0,
      },
      chat: {
        pending: chat.get("pending") || 0,
        sent: chat.get("sent") || 0,
        failed: chat.get("failed") || 0,
        expired: chat.get("expired") || 0,
        sent24h,
      },
    };
  }

  private async grantRedemption(redemptionId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId): Promise<boolean> {
    const session = await mongoose.startSession();
    let didGrant = false;
    try {
      await session.withTransaction(async () => {
        const redemption = await TwitchCcgRedemption.findOne({
          _id: redemptionId,
          grantStatus: { $in: ["pending", "failed"] },
        }).session(session);
        if (!redemption) {
          return;
        }

        const linkedUser = await User.findOne({ _id: userId, "twitch.id": redemption.twitchUserId }).session(session).select("_id");
        if (!linkedUser) {
          return;
        }

        for (const mode of ["current", "legacy"] as const) {
          await CcgPackCredit.updateOne(
            { ownerId: userId, sourceKey: `twitch-redemption:${redemption.redemptionId}:${mode}` },
            {
              $setOnInsert: {
                ownerId: userId,
                mode,
                source: "twitch_reward",
                sourceKey: `twitch-redemption:${redemption.redemptionId}:${mode}`,
                remaining: 1,
              },
            },
            { upsert: true, session },
          );
        }

        await CcgLedgerEntry.updateOne(
          { ownerType: "user", ownerId: userId, idempotencyKey: `twitch-redemption:${redemption.redemptionId}` },
          {
            $setOnInsert: {
              ownerType: "user",
              ownerId: userId,
              action: "twitch_reward",
              mode: null,
              idempotencyKey: `twitch-redemption:${redemption.redemptionId}`,
              amount: 2,
              metadata: {
                twitchUserId: redemption.twitchUserId,
                twitchUserLogin: redemption.twitchUserLogin,
                rewardId: redemption.rewardId,
                rewardTitle: redemption.rewardTitle,
                currentPacks: 1,
                legacyPacks: 1,
              },
            },
          },
          { upsert: true, session },
        );

        redemption.grantStatus = "granted";
        redemption.grantedUserId = userId;
        redemption.grantedAt = new Date();
        redemption.grantAttempts += 1;
        redemption.grantNextAttemptAt = new Date();
        redemption.grantLastError = undefined;
        await redemption.save({ session });
        didGrant = true;
      });
      return didGrant;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await TwitchCcgRedemption.findById(redemptionId).select("grantAttempts").lean();
      const attempts = (failed?.grantAttempts || 0) + 1;
      await TwitchCcgRedemption.updateOne(
        { _id: redemptionId, grantStatus: { $ne: "granted" } },
        {
          $set: {
            grantStatus: "failed",
            grantLastError: message,
            grantNextAttemptAt: new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000)),
          },
          $inc: { grantAttempts: 1 },
        },
      ).catch((updateError) => logger.error("Failed to record Twitch CCG grant failure:", updateError));
      logger.error(`[TwitchChannelPoints] Failed to grant redemption ${redemptionId}:`, error);
      return false;
    } finally {
      await session.endSession();
    }
  }
}

export default new TwitchCcgRewardService();
