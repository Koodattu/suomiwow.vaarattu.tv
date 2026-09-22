import logger from "../utils/logger";
import User, { IUser, IWoWCharacter } from "../models/User";
import AsyncSemaphore from "../utils/async-semaphore";

export class BattleNetSyncError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
  }
}

interface BattleNetTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string; // Battle.net may not always return a refresh token
  scope: string;
  sub: string; // Battle.net account ID
}

interface BattleNetUserInfo {
  sub: string;
  id: number;
  battletag: string;
}

interface WoWCharacterFromAPI {
  character: {
    href: string;
  };
  protected_character: {
    href: string;
  };
  name: string;
  id: number;
  realm: {
    key: {
      href: string;
    };
    name: string;
    id: number;
    slug: string;
  };
  playable_class: {
    key: {
      href: string;
    };
    name: string;
    id: number;
  };
  playable_race: {
    key: {
      href: string;
    };
    name: string;
    id: number;
  };
  gender: {
    type: string;
    name: string;
  };
  faction: {
    type: "ALLIANCE" | "HORDE";
    name: string;
  };
  level: number;
}

interface ProtectedCharacterProfile {
  id: number;
  name: string;
  guild?: {
    key: {
      href: string;
    };
    name: string;
    id: number;
    realm: {
      key: {
        href: string;
      };
      name: string;
      id: number;
      slug: string;
    };
  };
}

interface WoWProfileSummary {
  _links: {
    self: { href: string };
    user: { href: string };
    profile: { href: string };
  };
  id: number;
  wow_accounts?: Array<{
    id: number;
    characters: WoWCharacterFromAPI[];
  }>;
}

class BattleNetAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private region: string = "eu"; // Default to EU for Finnish users
  private activeRefreshes: Map<string, Promise<IWoWCharacter[]>> = new Map(); // Track ongoing refreshes
  private characterRequests = new AsyncSemaphore(5);

  constructor() {
    this.clientId = process.env.BLIZZARD_CLIENT_ID || "";
    this.clientSecret = process.env.BLIZZARD_CLIENT_SECRET || "";

    // Determine redirect URI based on environment
    const isProd = process.env.NODE_ENV === "production";
    this.redirectUri = isProd ? "https://suomiwow.vaarattu.tv/api/auth/battlenet/callback" : "http://localhost:3001/api/auth/battlenet/callback";

    if (!this.clientId || !this.clientSecret) {
      logger.warn("Battle.net OAuth credentials not configured for user authentication");
    } else {
      logger.info(`Battle.net OAuth configured with redirect URI: ${this.redirectUri}`);
    }
  }

  /**
   * Check if Battle.net OAuth is enabled
   */
  isEnabled(): boolean {
    return this.clientId !== "" && this.clientSecret !== "";
  }

  /**
   * Get the Battle.net OAuth authorization URL for connecting account
   * Uses state parameter to prevent CSRF and include user ID
   */
  getAuthorizationUrl(userId: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid wow.profile", // OpenID for identity, wow.profile for WoW characters
      state: state, // Includes encrypted userId for security
    });

    // Use EU OAuth endpoint for Finnish users
    return `https://oauth.battle.net/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<BattleNetTokenResponse> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });

    logger.info(`[API REQUEST] POST https://oauth.battle.net/token`);
    const response = await fetch("https://oauth.battle.net/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to exchange Battle.net code:", error);
      throw new Error("Failed to exchange authorization code");
    }

    return response.json() as Promise<BattleNetTokenResponse>;
  }

  /**
   * Get Battle.net user info using access token
   */
  async getUserInfo(accessToken: string): Promise<BattleNetUserInfo> {
    logger.info(`[API REQUEST] GET https://oauth.battle.net/userinfo`);
    const response = await fetch("https://oauth.battle.net/userinfo", {
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to get Battle.net user info:", error);
      throw new Error("Failed to get user info");
    }

    return response.json() as Promise<BattleNetUserInfo>;
  }

  /**
   * Get protected character profile to fetch guild information
   */
  async getProtectedCharacterProfile(accessToken: string, realmId: number, characterId: number): Promise<ProtectedCharacterProfile | null> {
    const apiUrl = `https://${this.region}.api.blizzard.com/profile/user/wow/protected-character/${realmId}-${characterId}?namespace=profile-${this.region}&locale=en_US`;

    logger.info(`[API REQUEST] GET ${apiUrl}`);
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.warn(`Failed to get protected character profile for ${characterId}:`, error);
      return null;
    }

    return (await response.json()) as ProtectedCharacterProfile;
  }

  /**
   * Get WoW profile summary including all characters
   * @param accessToken - Battle.net access token
   * @param fetchGuilds - Whether to fetch guild information (default: false for fast initial load)
   */
  async getWoWCharacters(accessToken: string, fetchGuilds: boolean = false, minimumLevel = 60): Promise<IWoWCharacter[]> {
    const apiUrl = `https://${this.region}.api.blizzard.com/profile/user/wow?namespace=profile-${this.region}&locale=en_US`;

    logger.info(`[API REQUEST] GET ${apiUrl}`);
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new BattleNetSyncError("BATTLENET_RECONNECT_REQUIRED", 409, "Reconnect Battle.net to refresh your characters.");
      }
      throw new BattleNetSyncError("BATTLENET_UNAVAILABLE", 502, "Could not load characters from Battle.net. Please try again.");
    }

    const profile = (await response.json()) as WoWProfileSummary;

    // Extract characters from all WoW accounts
    const characters: IWoWCharacter[] = [];

    if (profile.wow_accounts) {
      for (const account of profile.wow_accounts) {
        if (account.characters) {
          for (const char of account.characters) {
            if (char.level >= minimumLevel) {
              // Optionally fetch guild information from protected character profile
              let guildName: string | undefined;
              if (fetchGuilds) {
                try {
                  const protectedProfile = await this.getProtectedCharacterProfile(accessToken, char.realm.id, char.id);
                  guildName = protectedProfile?.guild?.name;
                } catch (error) {
                  logger.warn(`Could not fetch guild for character ${char.name}: ${error}`);
                }
              }

              characters.push({
                id: char.id,
                ...(minimumLevel === 0 ? { realmId: char.realm.id } : {}),
                name: char.name,
                realm: char.realm.name,
                realmSlug: char.realm.slug,
                class: char.playable_class.name,
                race: char.playable_race.name,
                level: char.level,
                faction: char.faction.type,
                guild: guildName,
                selected: false, // Default to not selected
                inactive: false, // Default to active
              });
            }
          }
        }
      }
    }

    // Sort by level descending
    characters.sort((a, b) => b.level - a.level);

    logger.info(`Fetched ${characters.length} WoW characters (level ${minimumLevel}+)${fetchGuilds ? " with guild info" : ""}`);
    return characters;
  }

  /**
   * Enrich a single character with guild information from the API
   * @private
   */
  private async _enrichSingleCharacterWithGuild(char: IWoWCharacter, accessToken: string): Promise<boolean> {
    try {
      const apiUrl = `https://${this.region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(char.realmSlug)}/${encodeURIComponent(char.name.toLowerCase())}?namespace=profile-${this.region}&locale=en_US`;

      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const profile = (await response.json()) as ProtectedCharacterProfile;
        char.guildCheckedAt = new Date();
        if (profile.guild && profile.guild.name) {
          char.guild = profile.guild.name;
          char.guildRealm = profile.guild.realm?.name;
          char.guildRealmSlug = profile.guild.realm?.slug;
          char.inactive = false;
          logger.info(`Enriched ${char.name} with guild: ${profile.guild.name} (${profile.guild.realm?.name || "unknown realm"})`);
          return true;
        } else {
          // Character has no guild but is active
          char.inactive = false;
          char.guild = undefined;
          char.guildRealm = undefined;
          char.guildRealmSlug = undefined;
          return true;
        }
      } else if (response.status === 404) {
        // Character is inactive (not found in API)
        char.inactive = true;
        char.guildCheckedAt = new Date();
        char.guild = "inactive";
        char.guildRealm = undefined;
        char.guildRealmSlug = undefined;
        logger.info(`Marked ${char.name} as inactive (404 from API)`);
        return true;
      } else {
        logger.warn(`Failed to fetch profile for ${char.name} on ${char.realmSlug}: ${response.status}`);
        return false;
      }
    } catch (error) {
      logger.warn(`Failed to fetch guild for ${char.name}: ${error}`);
      return false;
    }
  }

  /**
   * Fetch guild information for existing characters
   * This can be run asynchronously after initial character fetch
   */
  async enrichCharactersWithGuilds(userId: string): Promise<void> {
    const user = await User.findById(userId);
    if (!user || !user.battlenet) {
      throw new Error("User or Battle.net account not found");
    }

    logger.info(`Starting async guild enrichment for ${user.battlenet.characters.length} characters`);
    let updated = 0;

    // Update each character with guild info using public character profile API
    for (const char of user.battlenet.characters) {
      const wasUpdated = await this._enrichSingleCharacterWithGuild(char, user.battlenet.accessToken);
      if (wasUpdated) updated++;

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    user.battlenet.lastCharacterSync = new Date();
    await user.save();
    logger.info(`Completed guild enrichment for user ${userId}: ${updated}/${user.battlenet.characters.length} characters updated with guild info`);
  }

  private async enrichRoster(characters: IWoWCharacter[], accessToken: string): Promise<void> {
    await Promise.all(characters.map((character) =>
      this.characterRequests.run(() => this._enrichSingleCharacterWithGuild(character, accessToken)),
    ));
  }

  /**
   * Connect Battle.net account to existing user
   */
  async connectBattleNetAccount(userId: string, userInfo: BattleNetUserInfo, tokens: BattleNetTokenResponse, characters: IWoWCharacter[]): Promise<IUser> {
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Check if this Battle.net account is already connected to another user
    const existingUser = await User.findOne({ "battlenet.id": userInfo.sub });
    if (existingUser && existingUser._id.toString() !== userId) {
      throw new Error("This Battle.net account is already connected to another user");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Reauthorizing the same account must preserve the user's choices.
    if (user.battlenet?.id === userInfo.sub) {
      const existing = new Map(user.battlenet.characters.map((character) => [character.id, character]));
      for (const character of characters) {
        const previous = existing.get(character.id);
        if (previous) {
          character.selected = previous.selected;
          character.guild = previous.guild;
          character.guildRealm = previous.guildRealm;
          character.guildRealmSlug = previous.guildRealmSlug;
          character.guildCheckedAt = previous.guildCheckedAt;
          character.inactive = previous.inactive;
        }
      }
    }

    await this.enrichRoster(characters, tokens.access_token);
    const syncedAt = new Date();

    // Update user with Battle.net account
    user.battlenet = {
      id: userInfo.sub,
      battletag: userInfo.battletag,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token, // May be undefined
      tokenExpiresAt,
      connectedAt: new Date(),
      characters,
      lastCharacterSync: syncedAt,
      rosterSyncedAt: syncedAt,
    };

    await user.save();
    logger.info(`Battle.net account connected: ${userInfo.battletag} with ${characters.length} characters to user ${userId}`);

    return user;
  }

  /**
   * Update character selection for a user
   */
  async updateCharacterSelection(userId: string, characterIds: number[]): Promise<IUser> {
    const user = await User.findOneAndUpdate(
      { _id: userId, "battlenet.id": { $exists: true } },
      {
        $set: {
          "battlenet.characters.$[selected].selected": true,
          "battlenet.characters.$[unselected].selected": false,
        },
      },
      {
        new: true,
        arrayFilters: [
          { "selected.id": { $in: characterIds } },
          { "unselected.id": { $nin: characterIds } },
        ],
      },
    );
    if (!user) throw new Error("No Battle.net account connected");
    logger.info(`Updated character selection for user ${userId}: ${characterIds.length} characters selected`);

    return user;
  }

  /**
   * Read the persisted roster, filling legacy or missing caches only once.
   */
  async getCharacters(userId: string): Promise<IWoWCharacter[]> {
    const user = await User.findById(userId);
    if (!user?.battlenet) throw new BattleNetSyncError("BATTLENET_RECONNECT_REQUIRED", 409, "Reconnect Battle.net to refresh your characters.");
    if (user.battlenet.rosterSyncedAt) return user.battlenet.characters;
    return this.refreshCharacters(userId);
  }

  /**
   * Refresh WoW characters for a user
   * This fetches characters and enriches them with guild info before returning
   */
  async refreshCharacters(userId: string): Promise<IWoWCharacter[]> {
    // Check if there's already an ongoing refresh for this user
    const existingRefresh = this.activeRefreshes.get(userId);
    if (existingRefresh) {
      logger.info(`Reusing ongoing refresh operation for user ${userId}`);
      return existingRefresh;
    }

    // Create the refresh promise
    const refreshPromise = this._doRefreshCharacters(userId);

    // Store it to prevent concurrent refreshes
    this.activeRefreshes.set(userId, refreshPromise);

    // Clean up when done (success or failure)
    refreshPromise
      .finally(() => {
        this.activeRefreshes.delete(userId);
      })
      .catch(() => {}); // Prevent unhandled rejection

    return refreshPromise;
  }

  /**
   * Internal method to actually perform the refresh
   */
  private async _doRefreshCharacters(userId: string): Promise<IWoWCharacter[]> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.battlenet) {
      throw new Error("No Battle.net account connected");
    }

    if (user.battlenet.tokenExpiresAt.getTime() <= Date.now()) {
      throw new BattleNetSyncError("BATTLENET_RECONNECT_REQUIRED", 409, "Reconnect Battle.net to refresh your characters.");
    }

    // Reuse a recent successful sync instead of reporting a failed refresh.
    if (user.battlenet.rosterSyncedAt && user.battlenet.lastCharacterSync) {
      const timeSinceLastSync = Date.now() - user.battlenet.lastCharacterSync.getTime();
      const minInterval = 30000; // 30 seconds
      if (timeSinceLastSync < minInterval) {
        return user.battlenet.characters;
      }
    }

    logger.info(`Starting character refresh for user ${userId}`);

    // Get fresh character list WITHOUT guild information (fast initial fetch)
    const characters = await this.getWoWCharacters(user.battlenet.accessToken, false, 0);

    const previousCharacters = new Map(user.battlenet.characters.map((character) => [character.id, character]));
    for (const char of characters) {
      const previous = previousCharacters.get(char.id);
      if (previous) {
        char.guild = previous.guild;
        char.guildRealm = previous.guildRealm;
        char.guildRealmSlug = previous.guildRealmSlug;
        char.guildCheckedAt = previous.guildCheckedAt;
        char.inactive = previous.inactive;
      }
    }

    await this.enrichRoster(characters, user.battlenet.accessToken);

    // Compare the current list when saving so concurrent selections are never lost.
    // The token guard also prevents an old sync from restoring a disconnected account.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await User.findById(userId);
      if (!current?.battlenet || current.battlenet.accessToken !== user.battlenet.accessToken) {
        throw new BattleNetSyncError("BATTLENET_ACCOUNT_CHANGED", 409, "Battle.net connection changed. Please try again.");
      }
      const selected = new Set(current.battlenet.characters.filter((character) => character.selected).map((character) => character.id));
      for (const character of characters) character.selected = selected.has(character.id);
      const updated = await User.findOneAndUpdate(
        { _id: userId, "battlenet.accessToken": user.battlenet.accessToken, "battlenet.characters": current.battlenet.characters },
        { $set: { "battlenet.characters": characters, "battlenet.lastCharacterSync": new Date(), "battlenet.rosterSyncedAt": new Date() } },
        { new: true },
      );
      if (updated?.battlenet) return updated.battlenet.characters;
    }
    throw new BattleNetSyncError("BATTLENET_ACCOUNT_CHANGED", 409, "Character selection changed. Please try again.");
  }

  /**
   * Disconnect Battle.net account from user
   */
  async disconnectBattleNetAccount(userId: string): Promise<IUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.battlenet) {
      throw new Error("No Battle.net account connected");
    }

    const battletag = user.battlenet.battletag;
    user.battlenet = undefined;
    await user.save();

    logger.info(`Battle.net account disconnected: ${battletag} from user ${userId}`);
    return user;
  }
}

export default new BattleNetAuthService();
