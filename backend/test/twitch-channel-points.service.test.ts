import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import TwitchChannelPointsAuth from "../src/models/TwitchChannelPointsAuth";
import TwitchCcgOverlayEvent from "../src/models/TwitchCcgOverlayEvent";
import TwitchCcgRedemption from "../src/models/TwitchCcgRedemption";
import User from "../src/models/User";
import twitchChannelPointsService, {
  isTwitchChannelPointsRewardEnabled,
  resolveTwitchChannelPointsRewardKind,
  verifyTwitchEventSubSignature,
} from "../src/services/twitch-channel-points.service";
import twitchCcgRewardService, {
  getTwitchCcgCardRevealCount,
  getTwitchCcgPackGrantCount,
  isTwitchCcgRevealEnabled,
} from "../src/services/twitch-ccg-reward.service";
import ccgService from "../src/services/ccg.service";

test("verifies Twitch EventSub HMAC signatures and rejects tampering", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const messageId = "message-123";
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const rawBody = JSON.stringify({ subscription: { type: "test" }, event: { id: "redemption-1" } });
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex")}`;

  assert.equal(verifyTwitchEventSubSignature(secret, messageId, timestamp, rawBody, signature, now), true);
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, timestamp, `${rawBody} `, signature, now), false);
  assert.equal(verifyTwitchEventSubSignature(secret, "different-message", timestamp, rawBody, signature, now), false);
});

test("rejects stale, future, and invalid EventSub timestamps", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const messageId = "message-123";
  const rawBody = "{}";
  const now = Date.now();
  const sign = (timestamp: string) =>
    `sha256=${crypto.createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex")}`;

  const stale = new Date(now - 10 * 60 * 1000 - 1).toISOString();
  const future = new Date(now + 10 * 60 * 1000 + 1).toISOString();
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, stale, rawBody, sign(stale), now), false);
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, future, rawBody, sign(future), now), false);
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, "not-a-date", rawBody, sign("not-a-date"), now), false);
});

test("routes pack and card EventSub subscriptions independently", () => {
  const auth = {
    broadcasterUserId: "broadcaster-1",
    rewardId: "packs-1",
    tenPackRewardId: "packs-10",
    cardRewardId: "card-1",
  };
  const subscription = (rewardId: string, broadcasterUserId = "broadcaster-1") => ({
    type: "channel.channel_points_custom_reward_redemption.add",
    condition: { broadcaster_user_id: broadcasterUserId, reward_id: rewardId },
  });

  assert.equal(resolveTwitchChannelPointsRewardKind(auth, subscription("packs-1")), "packs");
  assert.equal(resolveTwitchChannelPointsRewardKind(auth, subscription("packs-10")), "packs_10");
  assert.equal(resolveTwitchChannelPointsRewardKind(auth, subscription("card-1")), "card_reveal");
  assert.equal(resolveTwitchChannelPointsRewardKind(auth, subscription("other")), null);
  assert.equal(resolveTwitchChannelPointsRewardKind(auth, subscription("card-1", "other-broadcaster")), null);
});

test("applies each reward kill switch independently", () => {
  const auth = { enabled: true, tenPackRewardEnabled: false, cardRewardEnabled: false };
  assert.equal(isTwitchChannelPointsRewardEnabled(auth, "packs"), true);
  assert.equal(isTwitchChannelPointsRewardEnabled(auth, "packs_10"), false);
  assert.equal(isTwitchChannelPointsRewardEnabled(auth, "card_reveal"), false);

  auth.enabled = false;
  auth.tenPackRewardEnabled = true;
  assert.equal(isTwitchChannelPointsRewardEnabled(auth, "packs"), false);
  assert.equal(isTwitchChannelPointsRewardEnabled(auth, "packs_10"), true);

  auth.tenPackRewardEnabled = false;
  auth.cardRewardEnabled = true;
  assert.equal(isTwitchChannelPointsRewardEnabled(auth, "packs_10"), false);
  assert.equal(isTwitchChannelPointsRewardEnabled(auth, "card_reveal"), true);
});

test("grants the configured number of packs for each pack reward", () => {
  assert.equal(getTwitchCcgPackGrantCount("packs"), 2);
  assert.equal(getTwitchCcgPackGrantCount("packs_10"), 20);
});

test("adds one reveal to the single-pack reward and two to the ten-pack reward", () => {
  assert.equal(getTwitchCcgCardRevealCount("packs"), 1);
  assert.equal(getTwitchCcgCardRevealCount("packs_10"), 2);
  assert.equal(getTwitchCcgCardRevealCount("card_reveal"), 1);
});

test("keeps the reveal overlay enabled while any CCG reward is enabled", () => {
  assert.equal(isTwitchCcgRevealEnabled(undefined), false);
  assert.equal(isTwitchCcgRevealEnabled({}), false);
  assert.equal(isTwitchCcgRevealEnabled({ enabled: true }), true);
  assert.equal(isTwitchCcgRevealEnabled({ tenPackRewardEnabled: true }), true);
  assert.equal(isTwitchCcgRevealEnabled({ cardRewardEnabled: true }), true);
});

test("processes pack redemptions through the card reveal path", async () => {
  const redemptionId = new mongoose.Types.ObjectId();
  const service = twitchCcgRewardService as any;
  const originalProcessCardRedemption = service.processCardRedemption;
  let grantedRedemptionId: mongoose.Types.ObjectId | undefined;

  try {
    service.processCardRedemption = async (nextRedemptionId: mongoose.Types.ObjectId) => {
      grantedRedemptionId = nextRedemptionId;
      return true;
    };

    assert.equal(await twitchCcgRewardService.processPackRedemption(redemptionId, "twitch-user-1"), true);
    assert.equal(grantedRedemptionId, redemptionId);
  } finally {
    service.processCardRedemption = originalProcessCardRedemption;
  }
});

test("assigns and queues two cards from the ten-pack reveal for the same linked user", async () => {
  const service = twitchCcgRewardService as any;
  const userId = new mongoose.Types.ObjectId();
  const redemptionId = new mongoose.Types.ObjectId();
  const originalStartSession = mongoose.startSession;
  const originalRedemptionFindOne = TwitchCcgRedemption.findOne;
  const originalUserFindOne = User.findOne;
  const originalRollExternalSingleCard = ccgService.rollExternalSingleCard;
  const originalGrantExternalCard = ccgService.grantExternalCard;
  const originalOverlayUpdateOne = TwitchCcgOverlayEvent.updateOne;
  const originalGrantReward = service.grantReward;
  const rollUserIds: string[] = [];
  const grantUserIds: string[] = [];
  const overlaySourceKeys: string[] = [];
  const awards = [0, 1].map((index) => ({
    cardId: new mongoose.Types.ObjectId(),
    setId: new mongoose.Types.ObjectId(),
    characterId: new mongoose.Types.ObjectId(),
    snapshotVersion: index + 1,
    finish: "standard" as const,
    artVariant: "standard" as const,
    tierGrade: "A" as const,
    poolVersion: `pool-${index + 1}`,
  }));
  const redemption: any = {
    _id: redemptionId,
    redemptionId: "ten-pack-redemption",
    twitchUserId: "twitch-user-1",
    twitchUserLogin: "viewer",
    twitchUserDisplayName: "Viewer",
    rewardKind: "packs_10",
    assignmentStatus: "pending",
    assignmentAttempts: 0,
    save: async () => undefined,
  };
  const session = {
    withTransaction: async (callback: () => Promise<void>) => callback(),
    endSession: async () => undefined,
  };

  try {
    (mongoose as any).startSession = async () => session;
    (TwitchCcgRedemption as any).findOne = () => ({ session: async () => redemption });
    (User as any).findOne = () => ({ select: () => ({ session: async () => ({ _id: userId }) }) });
    (ccgService as any).rollExternalSingleCard = async (_session: unknown, nextUserId: mongoose.Types.ObjectId) => {
      rollUserIds.push(String(nextUserId));
      return awards[rollUserIds.length - 1];
    };
    (ccgService as any).grantExternalCard = async (nextUserId: mongoose.Types.ObjectId) => {
      grantUserIds.push(String(nextUserId));
    };
    (TwitchCcgOverlayEvent as any).updateOne = async (filter: { sourceKey: string }) => {
      overlaySourceKeys.push(filter.sourceKey);
    };
    service.grantReward = async (
      nextRedemption: typeof redemption,
      nextUserId: mongoose.Types.ObjectId,
      nextAwards: typeof awards,
      _session: unknown,
      cardsAlreadyGranted: boolean,
    ) => {
      assert.equal(nextRedemption, redemption);
      assert.equal(String(nextUserId), String(userId));
      assert.deepEqual(nextAwards, awards);
      assert.equal(cardsAlreadyGranted, true);
    };

    assert.equal(await twitchCcgRewardService.processCardRedemption(redemptionId), true);
    assert.deepEqual(rollUserIds, [String(userId), String(userId)]);
    assert.deepEqual(grantUserIds, [String(userId), String(userId)]);
    assert.deepEqual(redemption.assignedCards, awards);
    assert.equal(redemption.assignedCard, awards[0]);
    assert.equal(redemption.assignmentStatus, "assigned");
    assert.deepEqual(overlaySourceKeys, ["redemption:ten-pack-redemption", "redemption:ten-pack-redemption:2"]);
  } finally {
    (mongoose as any).startSession = originalStartSession;
    (TwitchCcgRedemption as any).findOne = originalRedemptionFindOne;
    (User as any).findOne = originalUserFindOne;
    (ccgService as any).rollExternalSingleCard = originalRollExternalSingleCard;
    (ccgService as any).grantExternalCard = originalGrantExternalCard;
    (TwitchCcgOverlayEvent as any).updateOne = originalOverlayUpdateOne;
    service.grantReward = originalGrantReward;
  }
});

test("starts pack processing when an EventSub notification is recorded", async () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const messageId = "message-pack-immediate";
  const timestamp = new Date().toISOString();
  const redemptionObjectId = new mongoose.Types.ObjectId();
  const payload = {
    subscription: {
      type: "channel.channel_points_custom_reward_redemption.add",
      status: "enabled",
      condition: { broadcaster_user_id: "broadcaster-1", reward_id: "packs-1" },
    },
    event: {
      id: "redemption-1",
      user_id: "twitch-user-1",
      user_login: "viewer",
      user_name: "Viewer",
      broadcaster_user_id: "broadcaster-1",
      broadcaster_user_login: "streamer",
      reward: { id: "packs-1", title: "Redeem packs", cost: 100 },
      redeemed_at: timestamp,
    },
  };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex")}`;
  const originalAuthFindOne = TwitchChannelPointsAuth.findOne;
  const originalRecordRedemption = twitchCcgRewardService.recordRedemption;
  const originalProcessPackRedemption = twitchCcgRewardService.processPackRedemption;
  let processed: { redemptionId: mongoose.Types.ObjectId; twitchUserId: string } | undefined;

  try {
    (TwitchChannelPointsAuth as any).findOne = async () => ({
      broadcasterUserId: "broadcaster-1",
      broadcasterLogin: "streamer",
      enabled: true,
      rewardId: "packs-1",
      webhookSecret: secret,
      save: async () => undefined,
    });
    (twitchCcgRewardService as any).recordRedemption = async () => ({ _id: redemptionObjectId });
    (twitchCcgRewardService as any).processPackRedemption = async (
      redemptionId: mongoose.Types.ObjectId,
      twitchUserId: string,
    ) => {
      processed = { redemptionId, twitchUserId };
      return true;
    };

    const result = await twitchChannelPointsService.handleWebhook({
      "twitch-eventsub-message-id": messageId,
      "twitch-eventsub-message-timestamp": timestamp,
      "twitch-eventsub-message-signature": signature,
      "twitch-eventsub-message-type": "notification",
    }, rawBody);

    assert.deepEqual(result, { status: 204 });
    assert.deepEqual(processed, { redemptionId: redemptionObjectId, twitchUserId: "twitch-user-1" });
  } finally {
    (TwitchChannelPointsAuth as any).findOne = originalAuthFindOne;
    (twitchCcgRewardService as any).recordRedemption = originalRecordRedemption;
    (twitchCcgRewardService as any).processPackRedemption = originalProcessPackRedemption;
  }
});
