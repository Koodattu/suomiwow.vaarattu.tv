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
  chat: { pending: number; sent: number; skipped: number; failed: number; expired: number; sent24h: number };
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

export function twitchCcgRewardKindMatch(kinds: readonly TwitchCcgRewardKind[]): Record<string, unknown> {
  if (kinds.length === 3) return {};
  const clauses: Record<string, unknown>[] = [];
  if (kinds.includes("packs")) clauses.push({ $or: [{ rewardKind: "packs" }, { rewardKind: { $exists: false } }] });
  if (kinds.includes("packs_10")) clauses.push({ rewardKind: "packs_10" });
  if (kinds.includes("card_reveal")) clauses.push({ rewardKind: "card_reveal" });
  if (clauses.length === 0) return { _id: { $exists: false } };
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

export function getTwitchCcgPackGrantCount(rewardKind: TwitchCcgRewardKind): number {
  return rewardKind === "packs_10" ? 10 : 1;
}

export function getTwitchCcgCardRevealCount(rewardKind: TwitchCcgRewardKind): number {
  return rewardKind === "packs_10" ? 2 : 1;
}

export function isTwitchCcgRevealEnabled(auth: {
  enabled?: boolean;
  tenPackRewardEnabled?: boolean;
  cardRewardEnabled?: boolean;
} | null | undefined): boolean {
  return Boolean(auth?.enabled || auth?.tenPackRewardEnabled || auth?.cardRewardEnabled);
}

function getAssignedCards(redemption: ITwitchCcgRedemption): CcgExternalCardAward[] {
  if (redemption.assignedCards?.length) return redemption.assignedCards.map(asExternalAward);
  return redemption.assignedCard ? [asExternalAward(redemption.assignedCard)] : [];
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
          assignmentStatus: "pending",
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

  async processPackRedemption(redemptionId: mongoose.Types.ObjectId, twitchUserId: string): Promise<boolean> {
    void twitchUserId;
    return this.processCardRedemption(redemptionId);
  }

  async processCardRedemption(redemptionId: mongoose.Types.ObjectId | string): Promise<boolean> {
    const session = await mongoose.startSession();
    let assigned = false;
    try {
      await session.withTransaction(async () => {
        const redemption = await TwitchCcgRedemption.findOne({
          _id: redemptionId,
          $or: [
            { assignmentStatus: { $in: ["pending", "failed"] } },
            { assignmentStatus: "not_applicable", grantStatus: { $in: ["pending", "failed"] } },
          ],
        }).session(session);
        if (!redemption) return;

        const linkedUser = await User.findOne({ "twitch.id": redemption.twitchUserId }).select("_id").session(session);
        const awards: CcgExternalCardAward[] = [];
        for (let index = 0; index < getTwitchCcgCardRevealCount(redemption.rewardKind); index += 1) {
          const award = await ccgService.rollExternalSingleCard(session, linkedUser?._id);
          awards.push(award);
          if (linkedUser) await ccgService.grantExternalCard(linkedUser._id, award, session);
        }
        const now = new Date();
        redemption.assignedCard = awards[0];
        redemption.assignedCards = awards;
        redemption.assignmentStatus = "assigned";
        redemption.assignmentAttempts += 1;
        redemption.assignmentNextAttemptAt = now;
        redemption.assignmentLastError = undefined;

        if (linkedUser) await this.grantReward(redemption, linkedUser._id, awards, session, true);

        for (const [index, award] of awards.entries()) {
          const sourceKey = index === 0
            ? `redemption:${redemption.redemptionId}`
            : `redemption:${redemption.redemptionId}:${index + 1}`;
          await TwitchCcgOverlayEvent.updateOne(
            { sourceKey },
            {
              $setOnInsert: {
                sourceKey,
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
        }
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

  async retryCardAssignments(
    kinds: readonly TwitchCcgRewardKind[] = ["packs", "packs_10", "card_reveal"],
    limit = 25,
  ): Promise<number> {
    const due = await TwitchCcgRedemption.find({
      assignmentNextAttemptAt: { $lte: new Date() },
      ...twitchCcgRewardKindMatch(kinds),
      $or: [
        { assignmentStatus: { $in: ["pending", "failed"] } },
        { assignmentStatus: "not_applicable", grantStatus: { $in: ["pending", "failed"] } },
      ],
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
    kinds: readonly TwitchCcgRewardKind[] = ["packs", "packs_10", "card_reveal"],
  ): Promise<number> {
    const user = await User.findOne({ "twitch.id": twitchUserId }).select("_id").lean();
    if (!user) return 0;

    const redemptions = await TwitchCcgRedemption.find({
      twitchUserId,
      grantStatus: { $in: ["pending", "failed"] },
      ...twitchCcgRewardKindMatch(kinds),
      ...(respectBackoff ? { grantNextAttemptAt: { $lte: new Date() } } : {}),
    }).sort({ redeemedAt: 1 }).limit(100).select("_id rewardKind assignmentStatus");

    let granted = 0;
    for (const redemption of redemptions) {
      if (redemption.assignmentStatus !== "assigned") {
        if (await this.processCardRedemption(redemption._id)) {
          granted += 1;
          continue;
        }
      }
      if (await this.grantRedemption(redemption._id, user._id)) granted += 1;
    }
    return granted;
  }

  async retryLinkedPending(
    kinds: readonly TwitchCcgRewardKind[] = ["packs", "packs_10", "card_reveal"],
    limit = 25,
  ): Promise<number> {
    const twitchUsers = await TwitchCcgRedemption.aggregate<{ _id: string }>([
      {
        $match: {
          grantStatus: { $in: ["pending", "failed"] },
          grantNextAttemptAt: { $lte: new Date() },
          ...twitchCcgRewardKindMatch(kinds),
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
        { $match: { assignmentStatus: { $ne: "not_applicable" } } },
        { $group: { _id: "$assignmentStatus", count: { $sum: 1 } } },
      ]),
    ]);

    const blank = (): RewardDeliveryCounts => ({
      grants: { pending: 0, granted: 0, failed: 0 },
      chat: { pending: 0, sent: 0, skipped: 0, failed: 0, expired: 0, sent24h: 0 },
    });
    const byReward: Record<TwitchCcgRewardKind, RewardDeliveryCounts> = {
      packs: blank(),
      packs_10: blank(),
      card_reveal: blank(),
    };
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
        pending: byReward.packs.grants.pending + byReward.packs_10.grants.pending + byReward.card_reveal.grants.pending,
        granted: byReward.packs.grants.granted + byReward.packs_10.grants.granted + byReward.card_reveal.grants.granted,
        failed: byReward.packs.grants.failed + byReward.packs_10.grants.failed + byReward.card_reveal.grants.failed,
      },
      chat: (["packs", "packs_10", "card_reveal"] as const).reduce(
        (total, kind) => ({
          pending: total.pending + byReward[kind].chat.pending,
          sent: total.sent + byReward[kind].chat.sent,
          skipped: total.skipped + byReward[kind].chat.skipped,
          failed: total.failed + byReward[kind].chat.failed,
          expired: total.expired + byReward[kind].chat.expired,
          sent24h: total.sent24h + byReward[kind].chat.sent24h,
        }),
        { pending: 0, sent: 0, skipped: 0, failed: 0, expired: 0, sent24h: 0 },
      ),
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

        const awards = getAssignedCards(redemption);
        if (
          redemption.assignmentStatus !== "assigned"
          || awards.length !== getTwitchCcgCardRevealCount(redemption.rewardKind)
        ) return;
        await this.grantReward(redemption, userId, awards, session);
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

  private async grantReward(
    redemption: ITwitchCcgRedemption,
    userId: mongoose.Types.ObjectId,
    awards: CcgExternalCardAward[],
    session: mongoose.ClientSession,
    cardsAlreadyGranted = false,
  ): Promise<void> {
    const idempotencyKey = `twitch-redemption:${redemption.redemptionId}`;
    const ledger = await CcgLedgerEntry.findOne({ ownerType: "user", ownerId: userId, idempotencyKey })
      .session(session)
      .select("_id");
    if (!ledger) {
      if (!cardsAlreadyGranted) {
        for (const award of awards) await ccgService.grantExternalCard(userId, award, session);
      }

      const packCount = redemption.rewardKind === "card_reveal"
        ? 0
        : getTwitchCcgPackGrantCount(redemption.rewardKind);
      if (packCount > 0) {
        for (const mode of ["current", "legacy"] as const) {
          await CcgPackCredit.updateOne(
            { ownerId: userId, sourceKey: `${idempotencyKey}:${mode}` },
            {
              $setOnInsert: {
                ownerId: userId,
                mode,
                source: "twitch_reward",
                sourceKey: `${idempotencyKey}:${mode}`,
                remaining: packCount,
              },
            },
            { upsert: true, session },
          );
        }
      }

      await CcgLedgerEntry.create(
        [{
          ownerType: "user",
          ownerId: userId,
          action: "twitch_reward",
          mode: null,
          idempotencyKey,
          amount: packCount > 0 ? packCount * 2 : awards.length,
          metadata: {
            rewardKind: redemption.rewardKind,
            twitchUserId: redemption.twitchUserId,
            twitchUserLogin: redemption.twitchUserLogin,
            rewardId: redemption.rewardId,
            rewardTitle: redemption.rewardTitle,
            currentPacks: packCount,
            legacyPacks: packCount,
            ...(redemption.rewardKind === "card_reveal" && awards[0]
              ? {
                  cardId: String(awards[0].cardId),
                  finish: awards[0].finish,
                  artVariant: awards[0].artVariant,
                }
              : {}),
            cards: awards.map((award) => ({
              cardId: String(award.cardId),
              finish: award.finish,
              artVariant: award.artVariant,
            })),
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
