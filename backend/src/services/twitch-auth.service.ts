import logger from "../utils/logger";
import User, { IUser, ITwitchAccount } from "../models/User";
import twitchCcgRewardService from "./twitch-ccg-reward.service";

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string[];
  token_type: string;
}

interface TwitchUserResponse {
  data: Array<{
    id: string;
    login: string;
    display_name: string;
    type: string;
    broadcaster_type: string;
    description: string;
    profile_image_url: string;
    offline_image_url: string;
    view_count: number;
    created_at: string;
  }>;
}

class TwitchAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID || "";
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET || "";

    // Determine redirect URI based on environment
    const isProd = process.env.NODE_ENV === "production";
    this.redirectUri = isProd ? "https://suomiwow.vaarattu.tv/api/auth/twitch/callback" : "http://localhost:3001/api/auth/twitch/callback";

    if (!this.clientId || !this.clientSecret) {
      logger.warn("Twitch OAuth credentials not configured for user authentication");
    } else {
      logger.info(`Twitch OAuth configured with redirect URI: ${this.redirectUri}`);
    }
  }

  /**
   * Check if Twitch OAuth is enabled
   */
  isEnabled(): boolean {
    return this.clientId !== "" && this.clientSecret !== "";
  }

  /**
   * Get the Twitch OAuth authorization URL for connecting account
   * Uses state parameter to prevent CSRF and include user ID
   */
  getAuthorizationUrl(userId: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "user:read:email", // Minimal scope - just identity
      state: state, // Includes encrypted userId for security
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<TwitchTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });

    logger.info(`[API REQUEST] POST https://id.twitch.tv/oauth2/token`);
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to exchange Twitch code:", error);
      throw new Error("Failed to exchange authorization code");
    }

    return response.json() as Promise<TwitchTokenResponse>;
  }

  /**
   * Get Twitch user info using access token
   */
  async getUserInfo(accessToken: string): Promise<TwitchUserResponse["data"][0]> {
    logger.info(`[API REQUEST] GET https://api.twitch.tv/helix/users`);
    const response = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-ID": this.clientId,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to get Twitch user info:", error);
      throw new Error("Failed to get user info");
    }

    const data = (await response.json()) as TwitchUserResponse;
    if (!data.data || data.data.length === 0) {
      throw new Error("No user data returned from Twitch");
    }

    return data.data[0];
  }

  /**
   * Connect Twitch account to existing user
   */
  async connectTwitchAccount(userId: string, twitchUser: TwitchUserResponse["data"][0], tokens: TwitchTokenResponse): Promise<IUser> {
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Check if this Twitch account is already connected to another user
    const existingUser = await User.findOne({ "twitch.id": twitchUser.id });
    if (existingUser && existingUser._id.toString() !== userId) {
      throw new Error("This Twitch account is already connected to another user");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Update user with Twitch account
    user.twitch = {
      id: twitchUser.id,
      login: twitchUser.login,
      displayName: twitchUser.display_name,
      profileImageUrl: twitchUser.profile_image_url || null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt,
      connectedAt: new Date(),
    };

    await user.save();
    logger.info(`Twitch account connected: ${twitchUser.display_name} (${twitchUser.id}) to user ${userId}`);

    try {
      const granted = await twitchCcgRewardService.grantPendingForTwitchUser(twitchUser.id);
      if (granted > 0) logger.info(`Granted ${granted} pending Twitch CCG reward(s) to user ${userId}`);
    } catch (error) {
      logger.error(`Failed to process pending Twitch CCG rewards after linking user ${userId}:`, error);
    }

    return user;
  }

  /**
   * Disconnect Twitch account from user
   */
  async disconnectTwitchAccount(userId: string): Promise<IUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.twitch) {
      throw new Error("No Twitch account connected");
    }

    const twitchLogin = user.twitch.login;
    user.twitch = undefined;
    await user.save();

    logger.info(`Twitch account disconnected: ${twitchLogin} from user ${userId}`);
    return user;
  }

  /**
   * Revoke Twitch access token (optional cleanup)
   */
  async revokeToken(accessToken: string): Promise<void> {
    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        token: accessToken,
      });

      logger.info(`[API REQUEST] POST https://id.twitch.tv/oauth2/revoke`);
      await fetch("https://id.twitch.tv/oauth2/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
    } catch (error) {
      // Token revocation is optional, don't fail if it doesn't work
      logger.warn("Failed to revoke Twitch token:", error);
    }
  }
}

export default new TwitchAuthService();
