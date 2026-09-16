import logger from "../utils/logger";
import User, { IUser } from "../models/User";

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name?: string;
}

// Note: Sessions are now managed by express-session with MongoDB store
// No need for in-memory session storage

class DiscordService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId = process.env.DISCORD_CLIENT_ID || "";
    this.clientSecret = process.env.DISCORD_CLIENT_SECRET || "";

    // Determine redirect URI based on environment
    const isProd = process.env.NODE_ENV === "production";
    this.redirectUri = isProd ? "https://suomiwow.vaarattu.tv/api/auth/discord/callback" : "http://localhost:3001/api/auth/discord/callback";

    if (!this.clientId || !this.clientSecret) {
      logger.warn("Discord OAuth credentials not configured");
    } else {
      logger.info(`Discord OAuth configured with redirect URI: ${this.redirectUri}`);
    }
  }

  /**
   * Get the Discord OAuth authorization URL
   */
  getAuthorizationUrl(options: { scope?: string; state?: string; prompt?: string } = {}): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: options.scope ?? "identify",
    });

    if (options.state) {
      params.set("state", options.state);
    }

    if (options.prompt) {
      params.set("prompt", options.prompt);
    }

    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<DiscordTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });

    logger.info(`[API REQUEST] POST https://discord.com/api/oauth2/token`);
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to exchange Discord code:", error);
      throw new Error("Failed to exchange authorization code");
    }

    return response.json() as Promise<DiscordTokenResponse>;
  }

  /**
   * Get Discord user info using access token
   */
  async getUserInfo(accessToken: string): Promise<DiscordUserResponse> {
    logger.info(`[API REQUEST] GET https://discord.com/api/users/@me`);
    const response = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to get Discord user info:", error);
      throw new Error("Failed to get user info");
    }

    return response.json() as Promise<DiscordUserResponse>;
  }

  /**
   * Find or create user from Discord OAuth
   */
  async findOrCreateUser(discordUser: DiscordUserResponse, tokens: DiscordTokenResponse): Promise<IUser> {
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    let user = await User.findOne({ "discord.id": discordUser.id });

    if (user) {
      // Update existing user
      user.discord.username = discordUser.username;
      user.discord.discriminator = discordUser.discriminator;
      user.discord.avatar = discordUser.avatar;
      user.discord.accessToken = tokens.access_token;
      user.discord.refreshToken = tokens.refresh_token;
      user.discord.tokenExpiresAt = tokenExpiresAt;
      user.discord.scope = tokens.scope;
      user.lastLoginAt = new Date();
      await user.save();
      logger.info(`User logged in: ${discordUser.username} (${discordUser.id})`);
    } else {
      // Create new user
      user = await User.create({
        discord: {
          id: discordUser.id,
          username: discordUser.username,
          discriminator: discordUser.discriminator,
          avatar: discordUser.avatar,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt,
          scope: tokens.scope,
        },
        lastLoginAt: new Date(),
      });
      logger.info(`New user created: ${discordUser.username} (${discordUser.id})`);
    }

    if (user.twitch) {
      void import("./ccg-supporter-status.service").then(async ({ default: supporter }) => {
        await supporter.initializeExistingLink(String(user._id));
        await supporter.refresh(String(user._id));
      }).catch(() => logger.warn("[CCG/Supporter] Login verification will retry"));
    }
    return user;
  }

  /**
   * Get user from session (session is managed by express-session)
   */
  async getUserFromSession(userId: string): Promise<IUser | null> {
    return User.findById(userId);
  }

  /**
   * Get Discord avatar URL
   */
  getAvatarUrl(discordId: string, avatarHash: string | null): string {
    if (!avatarHash) {
      // Default avatar based on user ID
      const defaultIndex = parseInt(discordId) % 5;
      return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
    }
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
  }

  /**
   * Check if a Discord username is an admin
   */
  isAdmin(discordUsername: string): boolean {
    const adminNames = process.env.ADMIN_DISCORD_NAMES || "";
    if (!adminNames) return false;
    const adminList = adminNames.split(",").map((name) => name.trim().toLowerCase());
    return adminList.includes(discordUsername.toLowerCase());
  }
}

export default new DiscordService();
