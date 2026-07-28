import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import TwitchChannelPointsAuth from "../src/models/TwitchChannelPointsAuth";
import User from "../src/models/User";
import twitchChannelPointsService, {
  isTwitchChannelPointsRewardEnabled,
  resolveTwitchChannelPointsRewardKind,
  verifyTwitchEventSubSignature,
} from "../src/services/twitch-channel-points.service";
import twitchCcgRewardService, { getTwitchCcgPackGrantCount } from "../src/services/twitch-ccg-reward.service";

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
  assert.equal(getTwitchCcgPackGrantCount("packs"), 1);
  assert.equal(getTwitchCcgPackGrantCount("packs_10"), 10);
});

test("immediately processes a pack redemption for a linked Twitch user", async () => {
  const redemptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const service = twitchCcgRewardService as any;
  const originalUserFindOne = User.findOne;
  const originalGrantRedemption = service.grantRedemption;
  let grantedRedemptionId: mongoose.Types.ObjectId | undefined;
  let grantedUserId: mongoose.Types.ObjectId | undefined;

  try {
    (User as any).findOne = (filter: Record<string, string>) => {
      assert.deepEqual(filter, { "twitch.id": "twitch-user-1" });
      return { select: () => ({ lean: async () => ({ _id: userId }) }) };
    };
    service.grantRedemption = async (nextRedemptionId: mongoose.Types.ObjectId, nextUserId: mongoose.Types.ObjectId) => {
      grantedRedemptionId = nextRedemptionId;
      grantedUserId = nextUserId;
      return true;
    };

    assert.equal(await twitchCcgRewardService.processPackRedemption(redemptionId, "twitch-user-1"), true);
    assert.equal(grantedRedemptionId, redemptionId);
    assert.equal(grantedUserId, userId);
  } finally {
    (User as any).findOne = originalUserFindOne;
    service.grantRedemption = originalGrantRedemption;
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
