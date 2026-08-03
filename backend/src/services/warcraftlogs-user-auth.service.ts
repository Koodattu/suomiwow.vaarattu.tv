import crypto from "crypto";
import fetch from "node-fetch";
import mongoose from "mongoose";
import WarcraftLogsUserAuth, { IWarcraftLogsUserAuth } from "../models/WarcraftLogsUserAuth";
import logger from "../utils/logger";

interface WCLUserTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface WCLCurrentUserResponse {
  rateLimitData?: {
    limitPerHour: number;
    pointsSpentThisHour: number;
    pointsResetIn: number;
  };
  userData?: {
    currentUser?: {
      id: number;
      name: string;
    };
  };
}

export interface WarcraftLogsUserAuthStatus {
  enabled: boolean;
  connected: boolean;
  redirectUri: string;
  tokenExpiresAt?: Date;
  connectedAt?: Date;
  connectedByUsername?: string;
  wclUserId?: number;
  wclUserName?: string;
  scope?: string;
  lastRefreshAt?: Date;
  lastRefreshError?: string;
  lastVerifiedAt?: Date;
  lastVerifiedError?: string;
}

class WarcraftLogsUserAuthService {
  private readonly stateTtlMs = 10 * 60 * 1000;
  private readonly authStates = new Map<string, { adminUserId: string; expiresAt: Date }>();
  private activeRefresh: Promise<IWarcraftLogsUserAuth> | null = null;

  private get clientId(): string {
    return process.env.WCL_OAUTH_CLIENT_ID || process.env.WCL_CLIENT_ID || "";
  }

  private get clientSecret(): string {
    return process.env.WCL_OAUTH_CLIENT_SECRET || process.env.WCL_CLIENT_SECRET || "";
  }

  private get redirectUri(): string {
    if (process.env.WCL_OAUTH_REDIRECT_URI) {
      return process.env.WCL_OAUTH_REDIRECT_URI;
    }

    return process.env.NODE_ENV === "production"
      ? "https://suomiwow.vaarattu.tv/api/admin/wcl-user/callback"
      : "http://localhost:3001/api/admin/wcl-user/callback";
  }

  isEnabled(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  createAuthorizationUrl(adminUserId: string): string {
    if (!this.isEnabled()) {
      throw new Error("WCL OAuth credentials are not configured");
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
      state,
    });

    const scope = process.env.WCL_OAUTH_SCOPE || process.env.WCL_OAUTH_SCOPES;
    if (scope) {
      params.set("scope", scope);
    }

    return `https://www.warcraftlogs.com/oauth/authorize?${params.toString()}`;
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
  ): Promise<IWarcraftLogsUserAuth> {
    const tokens = await this.exchangeCode(code);
    if (!tokens.refresh_token) {
      throw new Error("WCL OAuth did not return a refresh token");
    }

    const auth = await WarcraftLogsUserAuth.findOneAndUpdate(
      { key: "global" },
      {
        $set: {
          key: "global",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenType: tokens.token_type,
          scope: tokens.scope,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000 - 60 * 1000),
          connectedAt: new Date(),
          connectedByUserId: new mongoose.Types.ObjectId(adminUser._id.toString()),
          connectedByUsername: adminUser.discord?.username,
          lastRefreshError: undefined,
          lastVerifiedError: undefined,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    try {
      await this.verifyCurrentUser(auth);
    } catch (error) {
      logger.warn("[WCLUserAuth] Connected token, but current user verification failed:", error);
    }

    return auth;
  }

  async getStatus(): Promise<WarcraftLogsUserAuthStatus> {
    const auth = await WarcraftLogsUserAuth.findOne({ key: "global" }).lean();

    return {
      enabled: this.isEnabled(),
      connected: Boolean(auth?.refreshToken),
      redirectUri: this.redirectUri,
      tokenExpiresAt: auth?.tokenExpiresAt,
      connectedAt: auth?.connectedAt,
      connectedByUsername: auth?.connectedByUsername,
      wclUserId: auth?.wclUserId,
      wclUserName: auth?.wclUserName,
      scope: auth?.scope,
      lastRefreshAt: auth?.lastRefreshAt,
      lastRefreshError: auth?.lastRefreshError,
      lastVerifiedAt: auth?.lastVerifiedAt,
      lastVerifiedError: auth?.lastVerifiedError,
    };
  }

  async hasConnectedUser(): Promise<boolean> {
    return Boolean(await WarcraftLogsUserAuth.exists({ key: "global", refreshToken: { $exists: true, $ne: "" } }));
  }

  async disconnect(): Promise<void> {
    await WarcraftLogsUserAuth.deleteOne({ key: "global" });
  }

  async getAccessToken(): Promise<string> {
    const auth = await WarcraftLogsUserAuth.findOne({ key: "global" });
    if (!auth?.refreshToken) {
      throw new Error("WCL user OAuth is not connected");
    }

    if (auth.accessToken && auth.tokenExpiresAt.getTime() > Date.now() + 60 * 1000) {
      return auth.accessToken;
    }

    const refreshed = await this.refreshAccessToken(auth);
    return refreshed.accessToken;
  }

  async verifyCurrentUser(authDocument?: IWarcraftLogsUserAuth): Promise<{ id: number; name: string }> {
    const auth = authDocument || (await WarcraftLogsUserAuth.findOne({ key: "global" }));
    if (!auth) {
      throw new Error("WCL user OAuth is not connected");
    }

    const accessToken = await this.getAccessToken();
    const query = `
      query {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        userData {
          currentUser {
            id
            name
          }
        }
      }
    `;

    logger.info("[API REQUEST] WarcraftLogsUserAuthService.verifyCurrentUser - POST https://www.warcraftlogs.com/api/v2/user");
    const response = await fetch("https://www.warcraftlogs.com/api/v2/user", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const error = `WCL user verification failed: ${response.status} ${response.statusText}`;
      await this.markVerificationFailure(auth, error);
      throw new Error(error);
    }

    const result = (await response.json()) as { data?: WCLCurrentUserResponse; errors?: unknown };
    if (result.errors) {
      const error = `WCL user verification GraphQL error: ${JSON.stringify(result.errors)}`;
      await this.markVerificationFailure(auth, error);
      throw new Error(error);
    }

    const user = result.data?.userData?.currentUser;
    if (!user) {
      const error = "WCL user verification did not return currentUser";
      await this.markVerificationFailure(auth, error);
      throw new Error(error);
    }

    auth.wclUserId = user.id;
    auth.wclUserName = user.name;
    auth.lastVerifiedAt = new Date();
    auth.lastVerifiedError = undefined;
    await auth.save();

    return user;
  }

  private async exchangeCode(code: string): Promise<WCLUserTokenResponse> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });

    logger.info("[API REQUEST] POST https://www.warcraftlogs.com/oauth/token (authorization_code)");
    const response = await fetch("https://www.warcraftlogs.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("[WCLUserAuth] Failed to exchange authorization code:", error);
      throw new Error("Failed to exchange WCL authorization code");
    }

    return response.json() as Promise<WCLUserTokenResponse>;
  }

  private async refreshAccessToken(auth: IWarcraftLogsUserAuth): Promise<IWarcraftLogsUserAuth> {
    if (this.activeRefresh) {
      return this.activeRefresh;
    }

    this.activeRefresh = this.performRefresh(auth).finally(() => {
      this.activeRefresh = null;
    });

    return this.activeRefresh;
  }

  private async performRefresh(auth: IWarcraftLogsUserAuth): Promise<IWarcraftLogsUserAuth> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
    });

    logger.info("[API REQUEST] POST https://www.warcraftlogs.com/oauth/token (refresh_token)");
    const response = await fetch("https://www.warcraftlogs.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      auth.lastRefreshError = `WCL user token refresh failed: ${response.status} ${response.statusText}`;
      await auth.save();
      logger.error("[WCLUserAuth] Failed to refresh user token:", error);
      throw new Error(auth.lastRefreshError);
    }

    const tokens = (await response.json()) as WCLUserTokenResponse;
    auth.accessToken = tokens.access_token;
    if (tokens.refresh_token) {
      auth.refreshToken = tokens.refresh_token;
    }
    auth.tokenType = tokens.token_type || auth.tokenType;
    auth.scope = tokens.scope || auth.scope;
    auth.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000 - 60 * 1000);
    auth.lastRefreshAt = new Date();
    auth.lastRefreshError = undefined;
    await auth.save();

    return auth;
  }

  private async markVerificationFailure(auth: IWarcraftLogsUserAuth, error: string): Promise<void> {
    auth.lastVerifiedAt = new Date();
    auth.lastVerifiedError = error;
    await auth.save();
  }
}

export default new WarcraftLogsUserAuthService();
