import crypto from "crypto";
import fetch from "node-fetch";
import mongoose from "mongoose";
import TwitchBotAuth, { ITwitchBotAuth } from "../models/TwitchBotAuth";
import logger from "../utils/logger";

interface TwitchBotTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string[];
  token_type?: string;
}

interface TwitchHelixUserResponse {
  data: Array<{
    id: string;
    login: string;
    display_name: string;
  }>;
}

interface TwitchFollowedChannelsResponse {
  total?: number;
  data: Array<{
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    followed_at: string;
  }>;
  pagination?: {
    cursor?: string;
  };
}

export interface TwitchBotAccessToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  obtainmentTimestamp: number;
}

export interface TwitchBotRefreshedAccessToken {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  obtainmentTimestamp?: number;
}

export interface TwitchBotAuthStatus {
  enabled: boolean;
  connected: boolean;
  redirectUri: string;
  scopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  tokenExpiresAt?: Date;
  connectedAt?: Date;
  connectedByUsername?: string;
  twitchUserId?: string;
  twitchLogin?: string;
  twitchDisplayName?: string;
  lastRefreshAt?: Date;
  lastRefreshError?: string;
  lastVerifiedAt?: Date;
  lastVerifiedError?: string;
}

export interface TwitchBotFollowedChannel {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  followedAt: string;
}

export interface TwitchBotFollowsStatus {
  enabled: boolean;
  connected: boolean;
  requiredScope: string;
  hasRequiredScope: boolean;
  total: number;
  channels: TwitchBotFollowedChannel[];
  fetchedAt?: Date;
}

const FOLLOWED_CHANNELS_SCOPE = "user:read:follows";

class TwitchBotAuthService {
  private readonly stateTtlMs = 10 * 60 * 1000;
  private readonly authStates = new Map<string, { adminUserId: string; expiresAt: Date }>();
  private activeRefresh: Promise<ITwitchBotAuth> | null = null;

  private get clientId(): string {
    return process.env.TWITCH_CLIENT_ID || "";
  }

  private get clientSecret(): string {
    return process.env.TWITCH_CLIENT_SECRET || "";
  }

  private get redirectUri(): string {
    if (process.env.TWITCH_BOT_REDIRECT_URI) {
      return process.env.TWITCH_BOT_REDIRECT_URI;
    }

    return process.env.NODE_ENV === "production"
      ? "https://suomiwow.vaarattu.tv/api/admin/twitch-bot/callback"
      : "http://localhost:3001/api/admin/twitch-bot/callback";
  }

  getScopes(): string[] {
    const configured = (process.env.TWITCH_BOT_SCOPES || "")
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    return Array.from(new Set([...configured, "chat:read", "chat:edit", FOLLOWED_CHANNELS_SCOPE]));
  }

  isEnabled(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  createAuthorizationUrl(adminUserId: string): string {
    if (!this.isEnabled()) {
      throw new Error("Twitch OAuth credentials are not configured");
    }

    const state = crypto.randomBytes(32).toString("hex");
    this.authStates.set(state, {
      adminUserId,
      expiresAt: new Date(Date.now() + this.stateTtlMs),
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: this.getScopes().join(" "),
      state,
      force_verify: "true",
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  validateState(state: string, adminUserId: string): boolean {
    const stored = this.authStates.get(state);
    if (!stored) return false;

    this.authStates.delete(state);

    if (stored.expiresAt.getTime() < Date.now()) {
      return false;
    }

    return stored.adminUserId === adminUserId;
  }

  async exchangeCodeAndStore(
    code: string,
    adminUser: { _id: mongoose.Types.ObjectId | string; discord?: { username?: string } },
  ): Promise<ITwitchBotAuth> {
    const tokens = await this.exchangeCode(code);
    if (!tokens.refresh_token) {
      throw new Error("Twitch OAuth did not return a refresh token");
    }

    const now = Date.now();
    const twitchUser = await this.getUserInfo(tokens.access_token);
    const auth = await TwitchBotAuth.findOneAndUpdate(
      { key: "global" },
      {
        $set: {
          key: "global",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenType: tokens.token_type,
          scope: tokens.scope || this.getScopes(),
          expiresIn: tokens.expires_in,
          obtainmentTimestamp: now,
          tokenExpiresAt: new Date(now + tokens.expires_in * 1000 - 60 * 1000),
          twitchUserId: twitchUser.id,
          twitchLogin: twitchUser.login,
          twitchDisplayName: twitchUser.display_name,
          connectedAt: new Date(),
          connectedByUserId: new mongoose.Types.ObjectId(adminUser._id.toString()),
          connectedByUsername: adminUser.discord?.username,
          lastRefreshError: undefined,
          lastVerifiedAt: new Date(),
          lastVerifiedError: undefined,
        },
      },
      { upsert: true, new: true },
    );

    return auth;
  }

  async getStatus(): Promise<TwitchBotAuthStatus> {
    const auth = await TwitchBotAuth.findOne({ key: "global" }).lean();
    const requiredScopes = this.getScopes();
    const scopes = auth?.scope?.length ? auth.scope : requiredScopes;

    return {
      enabled: this.isEnabled(),
      connected: Boolean(auth?.refreshToken),
      redirectUri: this.redirectUri,
      scopes,
      requiredScopes,
      missingScopes: auth?.refreshToken ? requiredScopes.filter((scope) => !scopes.includes(scope)) : [],
      tokenExpiresAt: auth?.tokenExpiresAt,
      connectedAt: auth?.connectedAt,
      connectedByUsername: auth?.connectedByUsername,
      twitchUserId: auth?.twitchUserId,
      twitchLogin: auth?.twitchLogin,
      twitchDisplayName: auth?.twitchDisplayName,
      lastRefreshAt: auth?.lastRefreshAt,
      lastRefreshError: auth?.lastRefreshError,
      lastVerifiedAt: auth?.lastVerifiedAt,
      lastVerifiedError: auth?.lastVerifiedError,
    };
  }

  async hasConnectedBot(): Promise<boolean> {
    return Boolean(await TwitchBotAuth.exists({ key: "global", refreshToken: { $exists: true, $ne: "" } }));
  }

  async disconnect(): Promise<void> {
    await TwitchBotAuth.deleteOne({ key: "global" });
  }

  async getBotLogin(): Promise<string | null> {
    const auth = await TwitchBotAuth.findOne({ key: "global" }).select("twitchLogin").lean();
    return auth?.twitchLogin || null;
  }

  async getFollowedChannels(maxChannels = 1000): Promise<TwitchBotFollowsStatus> {
    const auth = await TwitchBotAuth.findOne({ key: "global" });
    if (!auth?.refreshToken) {
      return {
        enabled: this.isEnabled(),
        connected: false,
        requiredScope: FOLLOWED_CHANNELS_SCOPE,
        hasRequiredScope: false,
        total: 0,
        channels: [],
      };
    }

    if (!auth.scope?.includes(FOLLOWED_CHANNELS_SCOPE)) {
      return {
        enabled: this.isEnabled(),
        connected: true,
        requiredScope: FOLLOWED_CHANNELS_SCOPE,
        hasRequiredScope: false,
        total: 0,
        channels: [],
      };
    }

    const twitchUserId = auth.twitchUserId || (await this.verifyCurrentUser(auth)).id;
    const accessToken = await this.getAccessToken();
    const channels: TwitchBotFollowedChannel[] = [];
    let cursor: string | undefined;
    let total = 0;

    do {
      const first = Math.min(100, Math.max(1, maxChannels - channels.length));
      const params = new URLSearchParams({
        user_id: twitchUserId,
        first: first.toString(),
      });
      if (cursor) {
        params.set("after", cursor);
      }

      logger.info(`[API REQUEST] TwitchBotAuthService.getFollowedChannels - GET https://api.twitch.tv/helix/channels/followed?${params.toString()}`);
      const response = await fetch(`https://api.twitch.tv/helix/channels/followed?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-ID": this.clientId,
        },
      });

      if (!response.ok) {
        throw new Error(`Twitch followed channels request failed: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as TwitchFollowedChannelsResponse;
      total = typeof payload.total === "number" ? payload.total : Math.max(total, channels.length + payload.data.length);
      channels.push(
        ...payload.data.map((channel) => ({
          broadcasterId: channel.broadcaster_id,
          broadcasterLogin: channel.broadcaster_login,
          broadcasterName: channel.broadcaster_name,
          followedAt: channel.followed_at,
        })),
      );
      cursor = payload.pagination?.cursor;
    } while (cursor && channels.length < maxChannels);

    return {
      enabled: this.isEnabled(),
      connected: true,
      requiredScope: FOLLOWED_CHANNELS_SCOPE,
      hasRequiredScope: true,
      total,
      channels,
      fetchedAt: new Date(),
    };
  }

  async getAccessToken(): Promise<string> {
    const auth = await TwitchBotAuth.findOne({ key: "global" });
    if (!auth?.refreshToken) {
      throw new Error("Twitch bot OAuth is not connected");
    }

    if (auth.accessToken && auth.tokenExpiresAt.getTime() > Date.now() + 60 * 1000) {
      return auth.accessToken;
    }

    const refreshed = await this.refreshAccessToken(auth);
    return refreshed.accessToken;
  }

  async getTwurpleTokenData(): Promise<TwitchBotAccessToken> {
    const auth = await TwitchBotAuth.findOne({ key: "global" });
    if (!auth?.refreshToken) {
      throw new Error("Twitch bot OAuth is not connected");
    }

    return {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresIn: auth.expiresIn,
      obtainmentTimestamp: auth.obtainmentTimestamp,
    };
  }

  async persistRefreshedToken(userId: string, tokenData: TwitchBotRefreshedAccessToken): Promise<void> {
    const existing = await TwitchBotAuth.findOne({ key: "global" }).select("refreshToken").lean();
    const refreshToken = tokenData.refreshToken || existing?.refreshToken;
    if (!refreshToken) {
      throw new Error("Twitch token refresh did not include a refresh token");
    }

    const expiresIn = typeof tokenData.expiresIn === "number" ? tokenData.expiresIn : 0;
    const obtainmentTimestamp = typeof tokenData.obtainmentTimestamp === "number" ? tokenData.obtainmentTimestamp : Date.now();
    const tokenExpiresAt = new Date(obtainmentTimestamp + expiresIn * 1000 - 60 * 1000);
    await TwitchBotAuth.updateOne(
      { key: "global" },
      {
        $set: {
          accessToken: tokenData.accessToken,
          refreshToken,
          expiresIn,
          obtainmentTimestamp,
          tokenExpiresAt,
          twitchUserId: userId,
          lastRefreshAt: new Date(),
          lastRefreshError: undefined,
        },
      },
    );
  }

  async verifyCurrentUser(authDocument?: ITwitchBotAuth): Promise<{ id: string; login: string; displayName: string }> {
    const auth = authDocument || (await TwitchBotAuth.findOne({ key: "global" }));
    if (!auth) {
      throw new Error("Twitch bot OAuth is not connected");
    }

    const accessToken = await this.getAccessToken();
    const twitchUser = await this.getUserInfo(accessToken);

    auth.twitchUserId = twitchUser.id;
    auth.twitchLogin = twitchUser.login;
    auth.twitchDisplayName = twitchUser.display_name;
    auth.lastVerifiedAt = new Date();
    auth.lastVerifiedError = undefined;
    await auth.save();

    return {
      id: twitchUser.id,
      login: twitchUser.login,
      displayName: twitchUser.display_name,
    };
  }

  private async exchangeCode(code: string): Promise<TwitchBotTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });

    logger.info("[API REQUEST] TwitchBotAuthService.exchangeCode - POST https://id.twitch.tv/oauth2/token");
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Twitch OAuth token exchange failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as TwitchBotTokenResponse;
  }

  private async refreshAccessToken(auth: ITwitchBotAuth): Promise<ITwitchBotAuth> {
    if (this.activeRefresh) {
      return this.activeRefresh;
    }

    this.activeRefresh = this.performRefresh(auth).finally(() => {
      this.activeRefresh = null;
    });

    return this.activeRefresh;
  }

  private async performRefresh(auth: ITwitchBotAuth): Promise<ITwitchBotAuth> {
    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
      });

      logger.info("[API REQUEST] TwitchBotAuthService.refreshAccessToken - POST https://id.twitch.tv/oauth2/token");
      const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`Twitch OAuth token refresh failed: ${response.status} ${response.statusText}`);
      }

      const tokens = (await response.json()) as TwitchBotTokenResponse;
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

  private async getUserInfo(accessToken: string): Promise<TwitchHelixUserResponse["data"][0]> {
    logger.info("[API REQUEST] TwitchBotAuthService.getUserInfo - GET https://api.twitch.tv/helix/users");
    const response = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-ID": this.clientId,
      },
    });

    if (!response.ok) {
      const error = `Twitch user verification failed: ${response.status} ${response.statusText}`;
      await this.markVerificationFailure(error);
      throw new Error(error);
    }

    const data = (await response.json()) as TwitchHelixUserResponse;
    const user = data.data[0];
    if (!user) {
      const error = "Twitch user verification did not return a user";
      await this.markVerificationFailure(error);
      throw new Error(error);
    }

    return user;
  }

  private async markVerificationFailure(error: string): Promise<void> {
    await TwitchBotAuth.updateOne(
      { key: "global" },
      {
        $set: {
          lastVerifiedAt: new Date(),
          lastVerifiedError: error,
        },
      },
    );
  }
}

export default new TwitchBotAuthService();
