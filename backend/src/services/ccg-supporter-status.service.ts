import mongoose, { ClientSession } from "mongoose";
import CcgSupporterCreator from "../models/CcgSupporterCreator";
import CcgSupporterGrant from "../models/CcgSupporterGrant";
import CcgSupporterEvent from "../models/CcgSupporterEvent";
import CcgSupporterLimit from "../models/CcgSupporterLimit";
import CcgJobLock from "../models/CcgJobLock";
import { randomUUID } from "crypto";
import User from "../models/User";
import { CcgSupporterError, supporterGrants, supporterMonth } from "../utils/ccg-supporter";
import logger from "../utils/logger";
import twitchChannelPointsService from "./twitch-channel-points.service";

export async function supporterLimit(key: string, limit: number, windowMs: number, now = new Date(), session?: ClientSession): Promise<void> {
  const window = Math.floor(now.getTime() / windowMs);
  const expiresAt = new Date((window + 1) * windowMs);
  if (session) {
    // Charge only when the surrounding operation commits; avoid duplicate-key errors inside a transaction.
    await CcgSupporterLimit.updateOne({ key: `${key}:${window}` }, { $setOnInsert: { count: 0, expiresAt } }, { upsert: true, session });
    const charged = await CcgSupporterLimit.findOneAndUpdate({ key: `${key}:${window}`, count: { $lt: limit } }, { $inc: { count: 1 } }, { session });
    if (!charged) throw new CcgSupporterError(429, "rate_limited", expiresAt);
    return;
  }
  try {
    await CcgSupporterLimit.findOneAndUpdate(
      { key: `${key}:${window}`, count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true },
    );
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      // A competing first request may have inserted this window while our upsert waited.
      const retry = await CcgSupporterLimit.findOneAndUpdate({ key: `${key}:${window}`, count: { $lt: limit } }, { $inc: { count: 1 } });
      if (retry) return;
      throw new CcgSupporterError(429, "rate_limited", expiresAt);
    }
    throw error;
  }
}

class CcgSupporterStatusService {
  async ensureCreator(userId: mongoose.Types.ObjectId | string) {
    try {
      return await CcgSupporterCreator.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, returnDocument: "after" });
    } catch (error) {
      if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) return CcgSupporterCreator.findOne({ userId }).orFail();
      throw error;
    }
  }

  async connect(userId: string, twitchUserId: string, session: ClientSession) {
    const creator = await CcgSupporterCreator.findOne({ userId }).session(session);
    if (creator?.twitchUserId && creator.twitchUserId !== twitchUserId) throw new CcgSupporterError(409, "account_bound");
    if (await CcgSupporterCreator.exists({ twitchUserId, userId: { $ne: new mongoose.Types.ObjectId(userId) } }).session(session)) {
      throw new CcgSupporterError(409, "account_bound");
    }
    if (creator?.trackingEnabled) return;
    const now = new Date();
    await CcgSupporterCreator.findOneAndUpdate({ userId }, {
      $set: { twitchUserId, trackingEnabled: true, connectedSince: now, nextCheckAt: now,
        checkLeaseUntil: new Date(0), nextManualCheckAt: new Date(0) },
      $inc: { connectionRevision: 1 },
      ...(creator ? {} : { $setOnInsert: { userId, trackingStartedAt: now } }),
    }, { upsert: true, session });
    if (creator && !creator.trackingStartedAt) await CcgSupporterCreator.updateOne({ _id: creator._id }, { $set: { trackingStartedAt: now } }, { session });
  }

  async disconnect(userId: string, session: ClientSession) {
    await CcgSupporterCreator.updateOne({ userId }, {
      $set: { trackingEnabled: false, connectedSince: null, checkLeaseUntil: new Date(0) },
      $inc: { connectionRevision: 1 },
    }, { session });
  }

  async initializeExistingLink(userId: string) {
    await this.ensureCreator(userId);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const user = await User.findById(userId).session(session);
        if (!user?.twitch) return;
        // Serialize lazy enrollment against disconnect/reconnect on the User document.
        await User.updateOne({ _id: userId, "twitch.id": user.twitch.id }, { $inc: { __v: 1 } }, { session });
        await this.connect(userId, user.twitch.id, session);
      });
    } finally { await session.endSession(); }
  }

  async observe(creatorId: mongoose.Types.ObjectId, revision: number, broadcasterId: string,
    following: boolean | null, subscribed: boolean | null, tier: string | null, observedAt: Date, eventId?: mongoose.Types.ObjectId) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const creator = await CcgSupporterCreator.findOne({ _id: creatorId, trackingEnabled: true, connectionRevision: revision,
          connectedSince: { $lte: observedAt } }).session(session);
        if (!creator?.twitchUserId) {
          if (eventId) await CcgSupporterEvent.updateOne({ _id: eventId }, { $set: { processed: true } }, { session });
          return;
        }
        // A signed subscription-end event also proves support in its observed month.
        const subscriptionEvidence = subscribed || Boolean(eventId);
        const previousFirstMonth = creator.firstSubscriberMonth;
        if (subscriptionEvidence && (!creator.firstSubscriberMonth || supporterMonth(observedAt) < creator.firstSubscriberMonth)) {
          creator.firstSubscriberMonth = supporterMonth(observedAt);
        }
        let amount = 0;
        const grants = supporterGrants(following, subscriptionEvidence, creator.firstSubscriberMonth ?? null, observedAt);
        if (previousFirstMonth && creator.firstSubscriberMonth! < previousFirstMonth) {
          grants.push({ kind: "monthly", period: previousFirstMonth, amount: 1 });
        }
        for (const grant of grants) {
          const result = await CcgSupporterGrant.updateOne(
            { broadcasterId, twitchUserId: creator.twitchUserId, kind: grant.kind, period: grant.period },
            { $setOnInsert: { creatorId, amount: grant.amount, observedAt } }, { upsert: true, session });
          if (result.upsertedCount) amount += grant.amount;
        }
        creator.earnedSlots += amount;
        if (!creator.statusObservedAt || observedAt >= creator.statusObservedAt) {
          creator.statusObservedAt = observedAt;
          if (following !== null) creator.following = following;
          if (subscribed !== null) { creator.subscribed = subscribed; creator.tier = tier; }
          // A subscription event does not verify the follower status or finish the scheduled full check.
          if (!eventId) {
            creator.checkedAt = observedAt;
            creator.checkedMonth = supporterMonth(observedAt);
            creator.checkError = null;
            creator.nextCheckAt = new Date(observedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
          }
        }
        await creator.save({ session });
        if (eventId) await CcgSupporterEvent.updateOne({ _id: eventId }, { $set: { processed: true } }, { session });
      });
    } finally { await session.endSession(); }
  }

  async refresh(userId: string, force = false) {
    const now = new Date();
    const existing = await CcgSupporterCreator.findOne({ userId });
    if (!existing?.trackingEnabled || !existing.twitchUserId) return;
    if (!force && existing.checkedAt && now.getTime() - existing.checkedAt.getTime() < 15 * 60 * 1000
      && existing.checkedMonth === supporterMonth(now)) return;
    const creator = await CcgSupporterCreator.findOneAndUpdate({ _id: existing._id, trackingEnabled: true,
      checkLeaseUntil: { $lte: now }, nextManualCheckAt: { $lte: now } },
    { $set: { checkLeaseUntil: new Date(now.getTime() + 60_000), nextManualCheckAt: new Date(now.getTime() + 60_000),
      attemptMonth: supporterMonth(now) } }, { returnDocument: "after" });
    if (!creator) {
      if (force) throw new CcgSupporterError(429, "rate_limited", existing.nextManualCheckAt);
      return;
    }
    try {
      let credentials = await twitchChannelPointsService.getSupporterCredentials();
      const read = async (endpoint: string): Promise<Array<{ tier?: string }>> => {
        const params = new URLSearchParams({ broadcaster_id: credentials.broadcasterId, user_id: creator.twitchUserId! });
        let response = await fetch(`https://api.twitch.tv/helix/${endpoint}?${params}`, {
          headers: { Authorization: `Bearer ${credentials.accessToken}`, "Client-ID": credentials.clientId }, signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 401) {
          credentials = await twitchChannelPointsService.getSupporterCredentials(true);
          response = await fetch(`https://api.twitch.tv/helix/${endpoint}?${params}`, {
            headers: { Authorization: `Bearer ${credentials.accessToken}`, "Client-ID": credentials.clientId }, signal: AbortSignal.timeout(10_000),
          });
        }
        if (!response.ok) throw new CcgSupporterError(503, "status_unavailable");
        const payload = await response.json() as { data?: Array<{ tier?: string }> };
        if (!Array.isArray(payload.data)) throw new CcgSupporterError(503, "status_unavailable");
        return payload.data;
      };
      // Sequential requests avoid racing refresh-token rotation on an expired broadcaster token.
      const followers = await read("channels/followers");
      const subscribers = await read("subscriptions");
      await this.observe(creator._id, creator.connectionRevision, credentials.broadcasterId,
        followers.length > 0, subscribers.length > 0, subscribers[0]?.tier ?? null, new Date());
    } catch (error) {
      const code = error instanceof CcgSupporterError ? error.code : "status_unavailable";
      await CcgSupporterCreator.updateOne({ _id: creator._id, connectionRevision: creator.connectionRevision, checkLeaseUntil: creator.checkLeaseUntil }, {
        $set: { checkError: code, nextCheckAt: new Date(Date.now() + 15 * 60 * 1000) },
      });
      logger.warn(`[CCG/Supporter] Status check failed (${code})`);
      if (force) throw new CcgSupporterError(503, code);
    } finally {
      await CcgSupporterCreator.updateOne({ _id: creator._id, connectionRevision: creator.connectionRevision, checkLeaseUntil: creator.checkLeaseUntil }, { $set: { checkLeaseUntil: new Date(0) } });
    }
  }

  async recordEvent(messageId: string, broadcasterId: string, twitchUserId: string, subscribed: boolean, tier: string | null, observedAt: Date) {
    const creator = await CcgSupporterCreator.findOne({ twitchUserId, trackingEnabled: true, connectedSince: { $lte: observedAt } });
    if (!creator) return;
    const event = await CcgSupporterEvent.findOneAndUpdate({ messageId }, { $setOnInsert: {
      creatorId: creator._id, broadcasterId, connectionRevision: creator.connectionRevision, subscribed, tier, observedAt,
    } }, { upsert: true, returnDocument: "after" });
    if (event && !event.processed) await this.observe(event.creatorId, event.connectionRevision, event.broadcasterId,
      null, event.subscribed, event.tier ?? null, event.observedAt, event._id);
  }

  async reconcile() {
    const owner = randomUUID();
    const lockKey = "ccg-supporter-reconcile";
    await CcgJobLock.deleteOne({ key: lockKey, expiresAt: { $lte: new Date() } });
    try { await CcgJobLock.create({ key: lockKey, owner, expiresAt: new Date(Date.now() + 180_000) }); }
    catch (error) { if ((error as { code?: number }).code === 11000) return; throw error; }
    try { await this.reconcileBatch(); }
    finally { await CcgJobLock.deleteOne({ key: lockKey, owner }); }
  }

  private async reconcileBatch() {
    const deadline = Date.now() + 45_000;
    await twitchChannelPointsService.ensureSupporterSubscriptions();
    const now = new Date();
    const month = supporterMonth(now);
    const events = await CcgSupporterEvent.find({ processed: false }).sort({ observedAt: 1 }).limit(50);
    for (const event of events) await this.observe(event.creatorId, event.connectionRevision, event.broadcasterId,
      null, event.subscribed, event.tier ?? null, event.observedAt, event._id);
    const creators = await CcgSupporterCreator.find({ trackingEnabled: true, checkLeaseUntil: { $lte: now },
      $or: [{ nextCheckAt: { $lte: now } }, { attemptMonth: { $ne: month } }],
    }).sort({ nextCheckAt: 1 }).limit(50).select("userId");
    for (const creator of creators) {
      if (Date.now() >= deadline) break;
      await this.refresh(String(creator.userId));
    }
  }
}

export default new CcgSupporterStatusService();
