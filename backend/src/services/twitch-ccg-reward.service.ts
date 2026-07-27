/// <reference path="../types/express-session.d.ts" />

import { randomUUID } from "crypto";
import "express-session";
import mongoose from "mongoose";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgPackCredit from "../models/CcgPackCredit";
import TwitchCcgOverlayEvent from "../models/TwitchCcgOverlayEvent";
import TwitchCcgRedemption, {
  ITwitchCcgRedemption,
  TwitchCcgAssignedCard,
  TwitchCcgRewardKind,
} from "../models/TwitchCcgRedemption";
import User from "../models/User";
import logger from "../utils/logger";
import ccgService, { CcgExternalCardAward } from "./ccg.service";

const OVERLAY_EVENT_LIFETIME_MS = 15 * 60 * 1000;
const OVERLAY_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
  rewardKind: TwitchCcgRewardKind;
  redeemedAt: Date;
}

type RewardDeliveryCounts = {
  grants: { pending: number; granted: number; failed: number };
  chat: { pending: number; sent: number; failed: number; expired: number; sent24h: number };
};

export interface TwitchCcgRewardCounts extends RewardDeliveryCounts {
  assignments: { pending: number; assigned: number; failed: number };
  byReward: Record<TwitchCcgRewardKind, RewardDeliveryCounts>;
}

function asExternalAward(card: TwitchCcgAssignedCard): CcgExternalCardAward {
  return {
    cardId: card.cardId,
    setId: card.setId,
    characterId: card.characterId,
    snapshotVersion: card.snapshotVersion,
    finish: card.finish,
    artVariant: card.artVariant,
    tierGrade: card.tierGrade,
    poolVersion: card.poolVersion,
  };
}

function rewardKindMatch(kinds: readonly TwitchCcgRewardKind[]): Record<string, unknown> {
  if (kinds.includes("packs") && kinds.includes("card_reveal")) return {};
  if (kinds.includes("packs")) return { $or: [{ rewardKind: "packs" }, { rewardKind: { $exists: false } }] };
  if (kinds.includes("card_reveal")) return { rewardKind: "card_reveal" };
  return { _id: { $exists: false } };
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
          assignmentStatus: input.rewardKind === "card_reveal" ? "pending" : "not_applicable",
          assignmentAttempts: 0,
          assignmentNextAttemptAt: now,
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
    if (!redemption) throw new Error("Failed to persist Twitch redemption");
    return redemption;
  }

  async processCardRedemption(redemptionId: mongoose.Types.ObjectId | string): Promise<boolean> {
    const session = await mongoose.startSession();
    let assigned = false;
    try {
      await session.withTransaction(async () => {
        const redemption = await TwitchCcgRedemption.findOne({
          _id: redemptionId,
          rewardKind: "card_reveal",
          assignmentStatus: { $in: ["pending", "failed"] },
        }).session(session);
        if (!redemption) return;

        const award = await ccgService.rollExternalSingleCard(session);
        const now = new Date();
        redemption.assignedCard = award;
        redemption.assignmentStatus = "assigned";
        redemption.assignmentAttempts += 1;
        redemption.assignmentNextAttemptAt = now;
        redemption.assignmentLastError = undefined;

        const linkedUser = await User.findOne({ "twitch.id": redemption.twitchUserId }).select("_id").session(session);
        if (linkedUser) await this.grantCard(redemption, linkedUser._id, award, session);

        await TwitchCcgOverlayEvent.updateOne(
          { sourceKey: `redemption:${redemption.redemptionId}` },
          {
            $setOnInsert: {
              sourceKey: `redemption:${redemption.redemptionId}`,
              source: "redemption",
              redemptionId: redemption._id,
              twitchUserLogin: redemption.twitchUserLogin,
              twitchUserDisplayName: redemption.twitchUserDisplayName,
              cardId: award.cardId,
              finish: award.finish,
              artVariant: award.artVariant,
              tierGrade: award.tierGrade,
              status: "queued",
              attempts: 0,
              expiresAt: new Date(now.getTime() + OVERLAY_EVENT_LIFETIME_MS),
              deleteAt: new Date(now.getTime() + OVERLAY_EVENT_RETENTION_MS),
            },
          },
          { upsert: true, session },
        );
        await redemption.save({ session });
        assigned = true;
      });
      return assigned;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await TwitchCcgRedemption.findById(redemptionId).select("assignmentAttempts").lean();
      const attempts = (failed?.assignmentAttempts || 0) + 1;
      await TwitchCcgRedemption.updateOne(
        { _id: redemptionId, assignmentStatus: { $ne: "assigned" } },
        {
          $set: {
            assignmentStatus: "failed",
            assignmentLastError: message,
            assignmentNextAttemptAt: new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000)),
          },
          $inc: { assignmentAttempts: 1 },
        },
      ).catch((updateError) => logger.error("Failed to record Twitch card assignment failure:", updateError));
      logger.error(`[TwitchChannelPoints] Failed to assign card for redemption ${redemptionId}:`, error);
      return false;
    } finally {
      await session.endSession();
    }
  }

  async createTestOverlayEvent(displayName = "Overlay test"): Promise<void> {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const award = await ccgService.rollExternalSingleCard(session);
        const now = new Date();
        await TwitchCcgOverlayEvent.create(
          [{
            sourceKey: `test:${randomUUID()}`,
            source: "test",
            twitchUserLogin: "overlay_test",
            twitchUserDisplayName: displayName,
            cardId: award.cardId,
            finish: award.finish,
            artVariant: award.artVariant,
            tierGrade: award.tierGrade,
            status: "queued",
            attempts: 0,
            expiresAt: new Date(now.getTime() + OVERLAY_EVENT_LIFETIME_MS),
            deleteAt: new Date(now.getTime() + OVERLAY_EVENT_RETENTION_MS),
          }],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async expireOverlayQueue(): Promise<void> {
    await TwitchCcgOverlayEvent.updateMany(
      { status: { $in: ["queued", "leased"] } },
      { $set: { status: "expired", leaseId: undefined, leaseUntil: undefined } },
    );
  }

  async retryCardAssignments(limit = 25): Promise<number> {
    const due = await TwitchCcgRedemption.find({
      rewardKind: "card_reveal",
      assignmentStatus: { $in: ["pending", "failed"] },
      assignmentNextAttemptAt: { $lte: new Date() },
    }).sort({ redeemedAt: 1 }).limit(limit).select("_id");
    let completed = 0;
    for (const redemption of due) {
      if (await this.processCardRedemption(redemption._id)) completed += 1;
    }
    return completed;
  }

  async grantPendingForTwitchUser(
    twitchUserId: string,
    respectBackoff = false,
    kinds: readonly TwitchCcgRewardKind[] = ["packs", "card_reveal"],
  ): Promise<number> {
    const user = await User.findOne({ "twitch.id": twitchUserId }).select("_id").lean();
    if (!user) return 0;

    const redemptions = await TwitchCcgRedemption.find({
      twitchUserId,
      grantStatus: { $in: ["pending", "failed"] },
      ...rewardKindMatch(kinds),
      ...(respectBackoff ? { grantNextAttemptAt: { $lte: new Date() } } : {}),
    }).sort({ redeemedAt: 1 }).limit(100).select("_id rewardKind assignmentStatus");

    let granted = 0;
    for (const redemption of redemptions) {
      if (redemption.rewardKind === "card_reveal" && redemption.assignmentStatus !== "assigned") {
        await this.processCardRedemption(redemption._id);
      }
      if (await this.grantRedemption(redemption._id, user._id)) granted += 1;
    }
    return granted;
  }

  async retryLinkedPending(
    kinds: readonly TwitchCcgRewardKind[] = ["packs", "card_reveal"],
    limit = 25,
  ): Promise<number> {
    const twitchUsers = await TwitchCcgRedemption.aggregate<{ _id: string }>([
      {
        $match: {
          grantStatus: { $in: ["pending", "failed"] },
          grantNextAttemptAt: { $lte: new Date() },
          ...rewardKindMatch(kinds),
        },
      },
      { $lookup: { from: User.collection.name, localField: "twitchUserId", foreignField: "twitch.id", as: "linkedUsers" } },
      { $match: { "linkedUsers.0": { $exists: true } } },
      { $group: { _id: "$twitchUserId" } },
      { $limit: limit },
    ]);

    let granted = 0;
    for (const twitchUser of twitchUsers) granted += await this.grantPendingForTwitchUser(twitchUser._id, true, kinds);
    return granted;
  }

  async getCounts(): Promise<TwitchCcgRewardCounts> {
    const [grantCounts, chatCounts, sent24hCounts, assignmentCounts] = await Promise.all([
      TwitchCcgRedemption.aggregate<{ _id: { kind: TwitchCcgRewardKind; status: string }; count: number }>([
        { $group: { _id: { kind: { $ifNull: ["$rewardKind", "packs"] }, status: "$grantStatus" }, count: { $sum: 1 } } },
      ]),
      TwitchCcgRedemption.aggregate<{ _id: { kind: TwitchCcgRewardKind; status: string }; count: number }>([
        { $group: { _id: { kind: { $ifNull: ["$rewardKind", "packs"] }, status: "$chatStatus" }, count: { $sum: 1 } } },
      ]),
      TwitchCcgRedemption.aggregate<{ _id: TwitchCcgRewardKind; count: number }>([
        { $match: { chatStatus: "sent", chatSentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $ifNull: ["$rewardKind", "packs"] }, count: { $sum: 1 } } },
      ]),
      TwitchCcgRedemption.aggregate<{ _id: string; count: number }>([
        { $match: { rewardKind: "card_reveal" } },
        { $group: { _id: "$assignmentStatus", count: { $sum: 1 } } },
      ]),
    ]);

    const blank = (): RewardDeliveryCounts => ({
      grants: { pending: 0, granted: 0, failed: 0 },
      chat: { pending: 0, sent: 0, failed: 0, expired: 0, sent24h: 0 },
    });
    const byReward: Record<TwitchCcgRewardKind, RewardDeliveryCounts> = { packs: blank(), card_reveal: blank() };
    for (const row of grantCounts) {
      const target = byReward[row._id.kind]?.grants;
      if (target && row._id.status in target) target[row._id.status as keyof typeof target] = row.count;
    }
    for (const row of chatCounts) {
      const target = byReward[row._id.kind]?.chat;
      if (target && row._id.status in target) target[row._id.status as keyof Omit<typeof target, "sent24h">] = row.count;
    }
    for (const row of sent24hCounts) byReward[row._id].chat.sent24h = row.count;

    const assignments = new Map(assignmentCounts.map((entry) => [entry._id, entry.count]));
    return {
      grants: {
        pending: byReward.packs.grants.pending + byReward.card_reveal.grants.pending,
        granted: byReward.packs.grants.granted + byReward.card_reveal.grants.granted,
        failed: byReward.packs.grants.failed + byReward.card_reveal.grants.failed,
      },
      chat: {
        pending: byReward.packs.chat.pending + byReward.card_reveal.chat.pending,
        sent: byReward.packs.chat.sent + byReward.card_reveal.chat.sent,
        failed: byReward.packs.chat.failed + byReward.card_reveal.chat.failed,
        expired: byReward.packs.chat.expired + byReward.card_reveal.chat.expired,
        sent24h: byReward.packs.chat.sent24h + byReward.card_reveal.chat.sent24h,
      },
      assignments: {
        pending: assignments.get("pending") || 0,
        assigned: assignments.get("assigned") || 0,
        failed: assignments.get("failed") || 0,
      },
      byReward,
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
        if (!redemption) return;

        const linkedUser = await User.findOne({ _id: userId, "twitch.id": redemption.twitchUserId }).session(session).select("_id");
        if (!linkedUser) return;

        if (redemption.rewardKind === "card_reveal") {
          if (!redemption.assignedCard || redemption.assignmentStatus !== "assigned") return;
          await this.grantCard(redemption, userId, asExternalAward(redemption.assignedCard), session);
        } else {
          await this.grantPacks(redemption, userId, session);
        }
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

  private async grantPacks(
    redemption: ITwitchCcgRedemption,
    userId: mongoose.Types.ObjectId,
    session: mongoose.ClientSession,
  ): Promise<void> {
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
            rewardKind: "packs",
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
    this.markGranted(redemption, userId);
  }

  private async grantCard(
    redemption: ITwitchCcgRedemption,
    userId: mongoose.Types.ObjectId,
    award: CcgExternalCardAward,
    session: mongoose.ClientSession,
  ): Promise<void> {
    const ledger = await CcgLedgerEntry.findOne({
      ownerType: "user",
      ownerId: userId,
      idempotencyKey: `twitch-redemption:${redemption.redemptionId}`,
    }).session(session).select("_id");
    if (!ledger) {
      await ccgService.grantExternalCard(userId, award, session);
      await CcgLedgerEntry.create(
        [{
          ownerType: "user",
          ownerId: userId,
          action: "twitch_reward",
          mode: null,
          idempotencyKey: `twitch-redemption:${redemption.redemptionId}`,
          amount: 1,
          metadata: {
            rewardKind: "card_reveal",
            twitchUserId: redemption.twitchUserId,
            twitchUserLogin: redemption.twitchUserLogin,
            rewardId: redemption.rewardId,
            rewardTitle: redemption.rewardTitle,
            cardId: String(award.cardId),
            finish: award.finish,
            artVariant: award.artVariant,
          },
        }],
        { session },
      );
    }
    this.markGranted(redemption, userId);
  }

  private markGranted(redemption: ITwitchCcgRedemption, userId: mongoose.Types.ObjectId): void {
    redemption.grantStatus = "granted";
    redemption.grantedUserId = userId;
    redemption.grantedAt = new Date();
    redemption.grantAttempts += 1;
    redemption.grantNextAttemptAt = new Date();
    redemption.grantLastError = undefined;
  }
}

export default new TwitchCcgRewardService();
