import crypto from "crypto";
import mongoose from "mongoose";
import fetch from "node-fetch";
import TwitchChannelPointsAuth, { ITwitchChannelPointsAuth } from "../models/TwitchChannelPointsAuth";
import TwitchCcgOverlayEvent from "../models/TwitchCcgOverlayEvent";
import { TwitchCcgRewardKind } from "../models/TwitchCcgRedemption";
import logger from "../utils/logger";
import twitchCcgRewardService, { TwitchCcgRewardCounts } from "./twitch-ccg-reward.service";

const AUTH_KEY = "global";
const REDEMPTION_SCOPE = "channel:read:redemptions";
const SUBSCRIPTION_TYPE = "channel.channel_points_custom_reward_redemption.add";

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string[];
  token_type?: string;
}

interface TwitchUserResponse {
  data: Array<{ id: string; login: string; display_name: string }>;
}

export interface TwitchCustomReward {
  id: string;
  title: string;
  cost: number;
  isEnabled: boolean;
  isPaused: boolean;
  isInStock: boolean;
  skipsRequestQueue: boolean;
}

interface TwitchCustomRewardsResponse {
  data: Array<{
    id: string;
    title: string;
    cost: number;
    is_enabled: boolean;
    is_paused: boolean;
    is_in_stock: boolean;
    should_redemptions_skip_request_queue: boolean;
  }>;
}

interface TwitchEventSubSubscription {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: { broadcaster_user_id?: string; reward_id?: string };
  transport: { method: string; callback?: string };
  created_at: string;
}

interface TwitchEventSubResponse {
  data: TwitchEventSubSubscription[];
  pagination?: { cursor?: string };
}

export interface TwitchChannelPointsStatus {
  enabled: boolean;
  connected: boolean;
  expectedBroadcasterLogin: string;
  redirectUri: string;
  callbackUrl: string;
  scopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  broadcasterUserId?: string;
  broadcasterLogin?: string;
  broadcasterDisplayName?: string;
  connectedAt?: Date;
  connectedByUsername?: string;
  tokenExpiresAt?: Date;
  rewardEnabled: boolean;
  rewardId?: string;
  rewardTitle?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  subscriptionCreatedAt?: Date;
  lastNotificationAt?: Date;
  lastRefreshAt?: Date;
  lastRefreshError?: string;
  lastVerifiedAt?: Date;
  lastVerifiedError?: string;
  lastError?: string;
  deliveries: TwitchCcgRewardCounts;
  rewards: Record<TwitchCcgRewardKind, TwitchChannelPointsRewardStatus>;
  overlay: {
    configured: boolean;
    lastSeenAt?: Date;
    queued: number;
    leased: number;
    played: number;
    expired: number;
  };
}

export interface TwitchChannelPointsRewardStatus {
  enabled: boolean;
  rewardId?: string;
  rewardTitle?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  subscriptionCreatedAt?: Date;
  lastNotificationAt?: Date;
  lastError?: string;
}

export interface TwitchEventSubWebhookResult {
  status: number;
  body?: string;
  contentType?: string;
}

interface EventSubPayload {
  challenge?: string;
  subscription?: TwitchEventSubSubscription;
  event?: {
    id?: string;
    broadcaster_user_id?: string;
    broadcaster_user_login?: string;
    user_id?: string;
    user_login?: string;
    user_name?: string;
    status?: string;
    redeemed_at?: string;
    reward?: { id?: string; title?: string; cost?: number };
  };
}

export class TwitchChannelPointsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwitchChannelPointsValidationError";
  }
}

export function verifyTwitchEventSubSignature(
  secret: string,
  messageId: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  now = Date.now(),
): boolean {
  const messageTime = new Date(timestamp).getTime();
  if (!Number.isFinite(messageTime) || Math.abs(now - messageTime) > 10 * 60 * 1000) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function resolveTwitchChannelPointsRewardKind(
  auth: Pick<ITwitchChannelPointsAuth, "broadcasterUserId" | "rewardId" | "tenPackRewardId" | "cardRewardId">,
  subscription?: Pick<TwitchEventSubSubscription, "type" | "condition">,
): TwitchCcgRewardKind | null {
  if (
    subscription?.type !== SUBSCRIPTION_TYPE ||
    subscription.condition?.broadcaster_user_id !== auth.broadcasterUserId
  ) return null;
  if (auth.rewardId && subscription.condition.reward_id === auth.rewardId) return "packs";
  if (auth.tenPackRewardId && subscription.condition.reward_id === auth.tenPackRewardId) return "packs_10";
  if (auth.cardRewardId && subscription.condition.reward_id === auth.cardRewardId) return "card_reveal";
  return null;
}

export function isTwitchChannelPointsRewardEnabled(
  auth: Pick<ITwitchChannelPointsAuth, "enabled" | "tenPackRewardEnabled" | "cardRewardEnabled">,
  rewardKind: TwitchCcgRewardKind,
): boolean {
  if (rewardKind === "packs") return auth.enabled;
  if (rewardKind === "packs_10") return auth.tenPackRewardEnabled;
  return auth.cardRewardEnabled;
}

class TwitchChannelPointsService {
  private readonly stateTtlMs = 10 * 60 * 1000;
  private readonly authStates = new Map<string, { adminUserId: string; expiresAt: Date }>();
  private activeRefresh: Promise<ITwitchChannelPointsAuth> | null = null;

  private get clientId(): string {
    return process.env.TWITCH_CLIENT_ID || "";
  }

  private get clientSecret(): string {
    return process.env.TWITCH_CLIENT_SECRET || "";
  }

  private get redirectUri(): string {
    if (process.env.TWITCH_CHANNEL_POINTS_REDIRECT_URI) return process.env.TWITCH_CHANNEL_POINTS_REDIRECT_URI;
    return process.env.NODE_ENV === "production"
      ? "https://suomiwow.vaarattu.tv/api/admin/twitch-channel-points/callback"
      : "http://localhost:3001/api/admin/twitch-channel-points/callback";
  }

  private get callbackUrl(): string {
    if (process.env.TWITCH_CHANNEL_POINTS_EVENTSUB_CALLBACK_URL) return process.env.TWITCH_CHANNEL_POINTS_EVENTSUB_CALLBACK_URL;
    return process.env.NODE_ENV === "production"
      ? "https://suomiwow.vaarattu.tv/api/twitch/eventsub/channel-points"
      : "http://localhost:3001/api/twitch/eventsub/channel-points";
  }

  getExpectedBroadcasterLogin(): string {
    return (process.env.TWITCH_CHANNEL_POINTS_BROADCASTER_LOGIN || "vaarattu").trim().toLowerCase();
  }

  getHomeChannel(): string {
    return (process.env.TWITCH_BOT_HOME_CHANNEL || this.getExpectedBroadcasterLogin()).trim().replace(/^#/, "").toLowerCase();
  }

  isEnabled(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  createAuthorizationUrl(adminUserId: string): string {
    if (!this.isEnabled()) throw new Error("Twitch OAuth credentials are not configured");
    const state = crypto.randomBytes(32).toString("hex");
    this.authStates.set(state, { adminUserId, expiresAt: new Date(Date.now() + this.stateTtlMs) });
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: REDEMPTION_SCOPE,
      state,
      force_verify: "true",
    });
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  validateState(state: string, adminUserId: string): boolean {
    const stored = this.authStates.get(state);
    if (!stored) return false;
    this.authStates.delete(state);
    return stored.expiresAt.getTime() >= Date.now() && stored.adminUserId === adminUserId;
  }

  async exchangeCodeAndStore(
    code: string,
    adminUser: { _id: mongoose.Types.ObjectId | string; discord?: { username?: string } },
  ): Promise<ITwitchChannelPointsAuth> {
    const tokens = await this.exchangeCode(code);
    if (!tokens.refresh_token) throw new Error("Twitch OAuth did not return a refresh token");
    const user = await this.getUserInfo(tokens.access_token);
    if (user.login.toLowerCase() !== this.getExpectedBroadcasterLogin()) {
      throw new TwitchChannelPointsValidationError(
        `Connect the ${this.getExpectedBroadcasterLogin()} broadcaster account, not ${user.login}`,
      );
    }

    const now = Date.now();
    return TwitchChannelPointsAuth.findOneAndUpdate(
      { key: AUTH_KEY },
      {
        $set: {
          key: AUTH_KEY,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenType: tokens.token_type,
          scope: tokens.scope || [REDEMPTION_SCOPE],
          expiresIn: tokens.expires_in,
          obtainmentTimestamp: now,
          tokenExpiresAt: new Date(now + tokens.expires_in * 1000 - 60 * 1000),
          broadcasterUserId: user.id,
          broadcasterLogin: user.login,
          broadcasterDisplayName: user.display_name,
          connectedAt: new Date(),
          connectedByUserId: new mongoose.Types.ObjectId(adminUser._id.toString()),
          connectedByUsername: adminUser.discord?.username,
          lastRefreshError: undefined,
          lastVerifiedAt: new Date(),
          lastVerifiedError: undefined,
          lastError: undefined,
        },
        $setOnInsert: {
          enabled: false,
          webhookSecret: crypto.randomBytes(32).toString("hex"),
        },
      },
      { upsert: true, new: true },
    );
  }

  async getStatus(): Promise<TwitchChannelPointsStatus> {
    const [auth, deliveries, overlayCounts] = await Promise.all([
      TwitchChannelPointsAuth.findOne({ key: AUTH_KEY }).lean(),
      twitchCcgRewardService.getCounts(),
      TwitchCcgOverlayEvent.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    const scopes = auth?.scope || [];
    const overlay = new Map(overlayCounts.map((entry) => [entry._id, entry.count]));
    const packReward: TwitchChannelPointsRewardStatus = {
      enabled: Boolean(auth?.enabled),
      rewardId: auth?.rewardId,
      rewardTitle: auth?.rewardTitle,
      subscriptionId: auth?.subscriptionId,
      subscriptionStatus: auth?.subscriptionStatus,
      subscriptionCreatedAt: auth?.subscriptionCreatedAt,
      lastNotificationAt: auth?.lastNotificationAt,
      lastError: auth?.lastError,
    };
    const tenPackReward: TwitchChannelPointsRewardStatus = {
      enabled: Boolean(auth?.tenPackRewardEnabled),
      rewardId: auth?.tenPackRewardId,
      rewardTitle: auth?.tenPackRewardTitle,
      subscriptionId: auth?.tenPackSubscriptionId,
      subscriptionStatus: auth?.tenPackSubscriptionStatus,
      subscriptionCreatedAt: auth?.tenPackSubscriptionCreatedAt,
      lastNotificationAt: auth?.tenPackLastNotificationAt,
      lastError: auth?.tenPackLastError,
    };
    const cardReward: TwitchChannelPointsRewardStatus = {
      enabled: Boolean(auth?.cardRewardEnabled),
      rewardId: auth?.cardRewardId,
      rewardTitle: auth?.cardRewardTitle,
      subscriptionId: auth?.cardSubscriptionId,
      subscriptionStatus: auth?.cardSubscriptionStatus,
      subscriptionCreatedAt: auth?.cardSubscriptionCreatedAt,
      lastNotificationAt: auth?.cardLastNotificationAt,
      lastError: auth?.cardLastError,
    };
    return {
      enabled: this.isEnabled(),
      connected: Boolean(auth?.refreshToken),
      expectedBroadcasterLogin: this.getExpectedBroadcasterLogin(),
      redirectUri: this.redirectUri,
      callbackUrl: this.callbackUrl,
      scopes,
      requiredScopes: [REDEMPTION_SCOPE],
      missingScopes: auth?.refreshToken && !scopes.includes(REDEMPTION_SCOPE) ? [REDEMPTION_SCOPE] : [],
      broadcasterUserId: auth?.broadcasterUserId,
      broadcasterLogin: auth?.broadcasterLogin,
      broadcasterDisplayName: auth?.broadcasterDisplayName,
      connectedAt: auth?.connectedAt,
      connectedByUsername: auth?.connectedByUsername,
      tokenExpiresAt: auth?.tokenExpiresAt,
      rewardEnabled: Boolean(auth?.enabled),
      rewardId: auth?.rewardId,
      rewardTitle: auth?.rewardTitle,
      subscriptionId: auth?.subscriptionId,
      subscriptionStatus: auth?.subscriptionStatus,
      subscriptionCreatedAt: auth?.subscriptionCreatedAt,
      lastNotificationAt: auth?.lastNotificationAt,
      lastRefreshAt: auth?.lastRefreshAt,
      lastRefreshError: auth?.lastRefreshError,
      lastVerifiedAt: auth?.lastVerifiedAt,
      lastVerifiedError: auth?.lastVerifiedError,
      lastError: auth?.lastError,
      deliveries,
      rewards: { packs: packReward, packs_10: tenPackReward, card_reveal: cardReward },
      overlay: {
        configured: Boolean(auth?.overlayTokenHash),
        lastSeenAt: auth?.overlayLastSeenAt,
        queued: overlay.get("queued") || 0,
        leased: overlay.get("leased") || 0,
        played: overlay.get("played") || 0,
        expired: overlay.get("expired") || 0,
      },
    };
  }

  async getRewards(): Promise<TwitchCustomReward[]> {
    const auth = await this.requireAuth();
    const accessToken = await this.getAccessToken();
    const params = new URLSearchParams({ broadcaster_id: auth.broadcasterUserId });
    const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Client-ID": this.clientId },
    });
    if (!response.ok) throw new Error(`Twitch custom rewards request failed: ${response.status} ${response.statusText}`);
    const payload = (await response.json()) as TwitchCustomRewardsResponse;
    return payload.data.map((reward) => ({
      id: reward.id,
      title: reward.title,
      cost: reward.cost,
      isEnabled: reward.is_enabled,
      isPaused: reward.is_paused,
      isInStock: reward.is_in_stock,
      skipsRequestQueue: reward.should_redemptions_skip_request_queue,
    }));
  }

  async updateSettings(input: { rewardKind?: unknown; enabled?: unknown; rewardTitle?: unknown }): Promise<TwitchChannelPointsStatus> {
    const rewardKind = input.rewardKind;
    if (rewardKind !== "packs" && rewardKind !== "packs_10" && rewardKind !== "card_reveal") {
      throw new TwitchChannelPointsValidationError("Reward kind must be packs, packs_10, or card_reveal");
    }
    if (typeof input.enabled !== "boolean") throw new TwitchChannelPointsValidationError("Enabled must be true or false");
    const auth = await this.requireAuth();
    const isCard = rewardKind === "card_reveal";
    const isTenPack = rewardKind === "packs_10";
    const previousSubscriptionId = isCard
      ? auth.cardSubscriptionId
      : isTenPack
        ? auth.tenPackSubscriptionId
        : auth.subscriptionId;

    if (!input.enabled) {
      await TwitchChannelPointsAuth.updateOne(
        { key: AUTH_KEY },
        isCard
          ? { $set: { cardRewardEnabled: false, cardSubscriptionStatus: "disabled" }, $unset: { cardSubscriptionId: 1, cardLastError: 1 } }
          : isTenPack
            ? { $set: { tenPackRewardEnabled: false, tenPackSubscriptionStatus: "disabled" }, $unset: { tenPackSubscriptionId: 1, tenPackLastError: 1 } }
            : { $set: { enabled: false, subscriptionStatus: "disabled" }, $unset: { subscriptionId: 1, lastError: 1 } },
      );
      if (isCard) await twitchCcgRewardService.expireOverlayQueue();
      await this.deleteSubscription(previousSubscriptionId).catch((error) =>
        logger.warn(`Failed to delete Twitch ${rewardKind} EventSub subscription while disabling:`, error),
      );
      return this.getStatus();
    }

    const rewardTitle = typeof input.rewardTitle === "string" ? input.rewardTitle.trim() : "";
    if (!rewardTitle) throw new TwitchChannelPointsValidationError("Choose a channel points reward");
    const rewards = await this.getRewards();
    const reward = rewards.find((candidate) => candidate.title.toLowerCase() === rewardTitle.toLowerCase());
    if (!reward) throw new TwitchChannelPointsValidationError(`No reward named "${rewardTitle}" exists on ${auth.broadcasterLogin}`);
    if (!reward.isEnabled || reward.isPaused || !reward.isInStock) {
      throw new TwitchChannelPointsValidationError("The selected reward must be enabled, available, and not paused");
    }
    if (!reward.skipsRequestQueue) {
      throw new TwitchChannelPointsValidationError('Enable "Skip Reward Requests Queue" for this reward in Twitch before activating it');
    }
    const otherRewardIds = [
      ...(isCard ? [] : [auth.cardRewardId]),
      ...(isTenPack ? [] : [auth.tenPackRewardId]),
      ...(!isCard && !isTenPack ? [] : [auth.rewardId]),
    ].filter(Boolean);
    if (otherRewardIds.includes(reward.id)) {
      throw new TwitchChannelPointsValidationError("Each CCG grant must use a different Twitch reward");
    }
    if (isCard) await twitchCcgRewardService.expireOverlayQueue();

    await TwitchChannelPointsAuth.updateOne(
      { key: AUTH_KEY },
      isCard
        ? {
            $set: {
              cardRewardEnabled: true,
              cardRewardId: reward.id,
              cardRewardTitle: reward.title,
              cardSubscriptionStatus: "creating",
            },
            $unset: { cardSubscriptionId: 1, cardLastError: 1 },
          }
        : isTenPack
          ? {
              $set: {
                tenPackRewardEnabled: true,
                tenPackRewardId: reward.id,
                tenPackRewardTitle: reward.title,
                tenPackSubscriptionStatus: "creating",
              },
              $unset: { tenPackSubscriptionId: 1, tenPackLastError: 1 },
            }
          : {
            $set: { enabled: true, rewardId: reward.id, rewardTitle: reward.title, subscriptionStatus: "creating" },
            $unset: { subscriptionId: 1, lastError: 1 },
          },
    );

    try {
      await this.deleteSubscription(previousSubscriptionId);
      await this.deleteMatchingSubscriptions(auth.broadcasterUserId, reward.id);
      const subscription = await this.createSubscription(auth, reward.id);
      await TwitchChannelPointsAuth.updateOne(
        isCard
          ? { key: AUTH_KEY, cardSubscriptionStatus: { $ne: "enabled" } }
          : isTenPack
            ? { key: AUTH_KEY, tenPackSubscriptionStatus: { $ne: "enabled" } }
            : { key: AUTH_KEY, subscriptionStatus: { $ne: "enabled" } },
        isCard
          ? {
              $set: {
                cardSubscriptionId: subscription.id,
                cardSubscriptionStatus: subscription.status,
                cardSubscriptionCreatedAt: new Date(subscription.created_at),
              },
            }
          : isTenPack
            ? {
                $set: {
                  tenPackSubscriptionId: subscription.id,
                  tenPackSubscriptionStatus: subscription.status,
                  tenPackSubscriptionCreatedAt: new Date(subscription.created_at),
                },
              }
            : {
              $set: {
                subscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                subscriptionCreatedAt: new Date(subscription.created_at),
              },
            },
      );
    } catch (error) {
      await TwitchChannelPointsAuth.updateOne(
        { key: AUTH_KEY },
          isCard
            ? { $set: { cardSubscriptionStatus: "failed", cardLastError: error instanceof Error ? error.message : String(error) } }
            : isTenPack
              ? { $set: { tenPackSubscriptionStatus: "failed", tenPackLastError: error instanceof Error ? error.message : String(error) } }
              : { $set: { subscriptionStatus: "failed", lastError: error instanceof Error ? error.message : String(error) } },
      );
      throw error;
    }
    return this.getStatus();
  }

  async getEnabledRewardKinds(): Promise<TwitchCcgRewardKind[]> {
    const auth = await TwitchChannelPointsAuth.findOne({ key: AUTH_KEY }).select("enabled tenPackRewardEnabled cardRewardEnabled").lean();
    return [
      ...(auth?.enabled ? (["packs"] as const) : []),
      ...(auth?.tenPackRewardEnabled ? (["packs_10"] as const) : []),
      ...(auth?.cardRewardEnabled ? (["card_reveal"] as const) : []),
    ];
  }

  async rotateOverlayToken(): Promise<{ overlayUrl: string; createdAt: Date }> {
    await this.requireAuth();
    const token = crypto.randomBytes(32).toString("base64url");
    const createdAt = new Date();
    await TwitchChannelPointsAuth.updateOne(
      { key: AUTH_KEY },
      { $set: { overlayTokenHash: crypto.createHash("sha256").update(token).digest("hex"), overlayTokenCreatedAt: createdAt } },
    );
    const frontendUrl = process.env.NODE_ENV === "production" ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
    return { overlayUrl: `${frontendUrl}/ccg/overlay#token=${token}`, createdAt };
  }

  async createOverlayTest(): Promise<void> {
    const auth = await this.requireAuth();
    if (!auth.cardRewardEnabled) throw new TwitchChannelPointsValidationError("Enable the card reveal reward before testing the overlay");
    if (!auth.overlayTokenHash) throw new TwitchChannelPointsValidationError("Generate an OBS overlay URL before testing the overlay");
    await twitchCcgRewardService.createTestOverlayEvent();
  }

  async verifyCurrentUser(): Promise<{ id: string; login: string; displayName: string }> {
    const auth = await this.requireAuth();
    try {
      const accessToken = await this.getAccessToken();
      const user = await this.getUserInfo(accessToken);
      if (user.login.toLowerCase() !== this.getExpectedBroadcasterLogin()) {
        throw new TwitchChannelPointsValidationError(`Connected account is ${user.login}; expected ${this.getExpectedBroadcasterLogin()}`);
      }
      auth.broadcasterUserId = user.id;
      auth.broadcasterLogin = user.login;
      auth.broadcasterDisplayName = user.display_name;
      auth.lastVerifiedAt = new Date();
      auth.lastVerifiedError = undefined;
      await auth.save();
      return { id: user.id, login: user.login, displayName: user.display_name };
    } catch (error) {
      auth.lastVerifiedAt = new Date();
      auth.lastVerifiedError = error instanceof Error ? error.message : String(error);
      await auth.save();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const auth = await TwitchChannelPointsAuth.findOne({ key: AUTH_KEY });
    await Promise.all(
      [auth?.subscriptionId, auth?.tenPackSubscriptionId, auth?.cardSubscriptionId].map((subscriptionId) =>
        this.deleteSubscription(subscriptionId).catch((error) => logger.warn("Failed to delete Twitch EventSub subscription while disconnecting:", error)),
      ),
    );
    await twitchCcgRewardService.expireOverlayQueue();
    await TwitchChannelPointsAuth.deleteOne({ key: AUTH_KEY });
  }

  async handleWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<TwitchEventSubWebhookResult> {
    const auth = await TwitchChannelPointsAuth.findOne({ key: AUTH_KEY });
    if (!auth) return { status: 404 };

    const messageId = this.readHeader(headers, "twitch-eventsub-message-id");
    const timestamp = this.readHeader(headers, "twitch-eventsub-message-timestamp");
    const signature = this.readHeader(headers, "twitch-eventsub-message-signature");
    const messageType = this.readHeader(headers, "twitch-eventsub-message-type");
    if (!messageId || !timestamp || !signature || !messageType || !rawBody) return { status: 400 };
    if (!verifyTwitchEventSubSignature(auth.webhookSecret, messageId, timestamp, rawBody, signature)) return { status: 403 };

    let payload: EventSubPayload;
    try {
      payload = JSON.parse(rawBody) as EventSubPayload;
    } catch {
      return { status: 400 };
    }
    const rewardKind = resolveTwitchChannelPointsRewardKind(auth, payload.subscription);
    if (!rewardKind) return { status: 403 };
    const rewardEnabled = isTwitchChannelPointsRewardEnabled(auth, rewardKind);
    if (!rewardEnabled && messageType === "notification") return { status: 204 };
    if (!rewardEnabled) return { status: 403 };

    if (messageType === "webhook_callback_verification") {
      if (!payload.challenge) return { status: 400 };
      if (rewardKind === "card_reveal") {
        auth.cardSubscriptionId = payload.subscription?.id;
        auth.cardSubscriptionStatus = "enabled";
        auth.cardSubscriptionCreatedAt = payload.subscription?.created_at ? new Date(payload.subscription.created_at) : new Date();
      } else if (rewardKind === "packs_10") {
        auth.tenPackSubscriptionId = payload.subscription?.id;
        auth.tenPackSubscriptionStatus = "enabled";
        auth.tenPackSubscriptionCreatedAt = payload.subscription?.created_at ? new Date(payload.subscription.created_at) : new Date();
      } else {
        auth.subscriptionId = payload.subscription?.id;
        auth.subscriptionStatus = "enabled";
        auth.subscriptionCreatedAt = payload.subscription?.created_at ? new Date(payload.subscription.created_at) : new Date();
      }
      await auth.save();
      return { status: 200, body: payload.challenge, contentType: "text/plain" };
    }

    if (messageType === "revocation") {
      const status = payload.subscription?.status || "revoked";
      if (rewardKind === "card_reveal") {
        auth.cardSubscriptionStatus = status;
        auth.cardLastError = `Twitch revoked the EventSub subscription: ${status}`;
      } else if (rewardKind === "packs_10") {
        auth.tenPackSubscriptionStatus = status;
        auth.tenPackLastError = `Twitch revoked the EventSub subscription: ${status}`;
      } else {
        auth.subscriptionStatus = status;
        auth.lastError = `Twitch revoked the EventSub subscription: ${status}`;
      }
      await auth.save();
      return { status: 204 };
    }

    if (messageType !== "notification" || !payload.event) return { status: 400 };
    const event = payload.event;
    if (
      !event.id ||
      !event.user_id ||
      !event.user_login ||
      !event.reward?.id ||
      !event.reward.title ||
      typeof event.reward.cost !== "number" ||
      !event.redeemed_at ||
      event.reward.id !== (
        rewardKind === "packs"
          ? auth.rewardId
          : rewardKind === "packs_10"
            ? auth.tenPackRewardId
            : auth.cardRewardId
      )
    ) {
      return { status: 400 };
    }

    const redemption = await twitchCcgRewardService.recordRedemption({
      redemptionId: event.id,
      eventMessageId: messageId,
      broadcasterId: event.broadcaster_user_id || auth.broadcasterUserId,
      broadcasterLogin: event.broadcaster_user_login || auth.broadcasterLogin,
      twitchUserId: event.user_id,
      twitchUserLogin: event.user_login,
      twitchUserDisplayName: event.user_name || event.user_login,
      rewardId: event.reward.id,
      rewardTitle: event.reward.title,
      rewardCost: event.reward.cost,
      rewardKind,
      redeemedAt: new Date(event.redeemed_at),
    });
    if (rewardKind === "card_reveal") {
      auth.cardLastNotificationAt = new Date();
      auth.cardSubscriptionStatus = payload.subscription?.status || auth.cardSubscriptionStatus;
      auth.cardLastError = undefined;
      void twitchCcgRewardService.processCardRedemption(redemption._id);
    } else if (rewardKind === "packs_10") {
      auth.tenPackLastNotificationAt = new Date();
      auth.tenPackSubscriptionStatus = payload.subscription?.status || auth.tenPackSubscriptionStatus;
      auth.tenPackLastError = undefined;
    } else {
      auth.lastNotificationAt = new Date();
      auth.subscriptionStatus = payload.subscription?.status || auth.subscriptionStatus;
      auth.lastError = undefined;
    }
    if (rewardKind !== "card_reveal") {
      void twitchCcgRewardService.processPackRedemption(redemption._id, event.user_id);
    }
    await auth.save();
    return { status: 204 };
  }

  private readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private async requireAuth(): Promise<ITwitchChannelPointsAuth> {
    const auth = await TwitchChannelPointsAuth.findOne({ key: AUTH_KEY });
    if (!auth?.refreshToken) throw new Error("Twitch channel points broadcaster is not connected");
    return auth;
  }

  private async getAccessToken(): Promise<string> {
    const auth = await this.requireAuth();
    if (auth.accessToken && auth.tokenExpiresAt.getTime() > Date.now() + 60 * 1000) return auth.accessToken;
    if (this.activeRefresh) return (await this.activeRefresh).accessToken;
    this.activeRefresh = this.refreshAccessToken(auth).finally(() => {
      this.activeRefresh = null;
    });
    return (await this.activeRefresh).accessToken;
  }

  private async exchangeCode(code: string): Promise<TwitchTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!response.ok) throw new Error(`Twitch OAuth token exchange failed: ${response.status} ${response.statusText}`);
    return (await response.json()) as TwitchTokenResponse;
  }

  private async refreshAccessToken(auth: ITwitchChannelPointsAuth): Promise<ITwitchChannelPointsAuth> {
    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
      });
      const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!response.ok) throw new Error(`Twitch token refresh failed: ${response.status} ${response.statusText}`);
      const tokens = (await response.json()) as TwitchTokenResponse;
      const now = Date.now();
      auth.accessToken = tokens.access_token;
      auth.refreshToken = tokens.refresh_token || auth.refreshToken;
      auth.tokenType = tokens.token_type || auth.tokenType;
      auth.scope = tokens.scope || auth.scope;
      auth.expiresIn = tokens.expires_in;
      auth.obtainmentTimestamp = now;
      auth.tokenExpiresAt = new Date(now + tokens.expires_in * 1000 - 60 * 1000);
      auth.lastRefreshAt = new Date();
      auth.lastRefreshError = undefined;
      await auth.save();
      return auth;
    } catch (error) {
      auth.lastRefreshError = error instanceof Error ? error.message : String(error);
      await auth.save();
      throw error;
    }
  }

  private async getUserInfo(accessToken: string): Promise<TwitchUserResponse["data"][0]> {
    const response = await fetch("https://api.twitch.tv/helix/users", {
      headers: { Authorization: `Bearer ${accessToken}`, "Client-ID": this.clientId },
    });
    if (!response.ok) throw new Error(`Twitch user verification failed: ${response.status} ${response.statusText}`);
    const payload = (await response.json()) as TwitchUserResponse;
    if (!payload.data[0]) throw new Error("Twitch user verification did not return a user");
    return payload.data[0];
  }

  private async getAppAccessToken(): Promise<string> {
    const params = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: "client_credentials" });
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!response.ok) throw new Error(`Twitch app token request failed: ${response.status} ${response.statusText}`);
    return ((await response.json()) as TwitchTokenResponse).access_token;
  }

  private async createSubscription(auth: ITwitchChannelPointsAuth, rewardId: string): Promise<TwitchEventSubSubscription> {
    const appToken = await this.getAppAccessToken();
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${appToken}`, "Client-ID": this.clientId, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: SUBSCRIPTION_TYPE,
        version: "1",
        condition: { broadcaster_user_id: auth.broadcasterUserId, reward_id: rewardId },
        transport: { method: "webhook", callback: this.callbackUrl, secret: auth.webhookSecret },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Twitch EventSub subscription failed: ${response.status} ${detail || response.statusText}`);
    }
    const payload = (await response.json()) as TwitchEventSubResponse;
    if (!payload.data[0]) throw new Error("Twitch EventSub subscription did not return a subscription");
    return payload.data[0];
  }

  private async deleteMatchingSubscriptions(broadcasterUserId: string, rewardId: string): Promise<void> {
    const appToken = await this.getAppAccessToken();
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ type: SUBSCRIPTION_TYPE });
      if (cursor) params.set("after", cursor);
      const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${appToken}`, "Client-ID": this.clientId },
      });
      if (!response.ok) throw new Error(`Twitch EventSub list failed: ${response.status} ${response.statusText}`);
      const payload = (await response.json()) as TwitchEventSubResponse;
      for (const subscription of payload.data) {
        if (subscription.condition.broadcaster_user_id === broadcasterUserId && subscription.condition.reward_id === rewardId) {
          if (subscription.transport.callback !== this.callbackUrl) {
            throw new Error("This Twitch app already has an EventSub subscription for that reward at another callback; use a separate Twitch Client ID for this project");
          }
          await this.deleteSubscriptionWithToken(subscription.id, appToken);
        }
      }
      cursor = payload.pagination?.cursor;
    } while (cursor);
  }

  private async deleteSubscription(subscriptionId?: string): Promise<void> {
    if (!subscriptionId || !this.isEnabled()) return;
    await this.deleteSubscriptionWithToken(subscriptionId, await this.getAppAccessToken());
  }

  private async deleteSubscriptionWithToken(subscriptionId: string, appToken: string): Promise<void> {
    const params = new URLSearchParams({ id: subscriptionId });
    const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?${params.toString()}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${appToken}`, "Client-ID": this.clientId },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Twitch EventSub delete failed: ${response.status} ${response.statusText}`);
    }
  }
}

export default new TwitchChannelPointsService();
