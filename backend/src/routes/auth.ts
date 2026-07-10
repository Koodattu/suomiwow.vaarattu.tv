import { Router, Request, Response } from "express";
import crypto from "crypto";
import discordService from "../services/discord.service";
import twitchAuthService from "../services/twitch-auth.service";
import battlenetAuthService from "../services/battlenet-auth.service";
import logger from "../utils/logger";
import User, { IUser } from "../models/User";
import Pickem from "../models/Pickem";
import Guild from "../models/Guild";
import cacheService from "../services/cache.service";

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const router = Router();

const STREAMER_UPDATE_COOLDOWN_MS = 10 * 1000;
const streamerUpdateTimestamps = new Map<string, number>();

interface EligibleStreamerGuild {
  id: string;
  name: string;
  realm: string;
  region: string;
  parent_guild?: string;
}

/**
 * Helper function to get authenticated user from session
 */
async function getAuthenticatedUser(req: Request): Promise<IUser | null> {
  const userId = req.session.userId;
  if (!userId) {
    return null;
  }
  return discordService.getUserFromSession(userId);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getEligibleStreamerGuilds(user: IUser): Promise<EligibleStreamerGuild[]> {
  if (!user.twitch || !user.battlenet) {
    return [];
  }

  const selectedGuildPairs = user.battlenet.characters
    .filter((character) => character.selected && !character.inactive && character.guild)
    .map((character) => ({
      name: character.guild!.trim(),
      realm: (character.guildRealm || character.realm).trim(),
    }))
    .filter((pair) => pair.name.length > 0 && pair.realm.length > 0);

  const uniquePairs = Array.from(new Map(selectedGuildPairs.map((pair) => [`${pair.name.toLowerCase()}-${pair.realm.toLowerCase()}`, pair])).values());

  if (uniquePairs.length === 0) {
    return [];
  }

  const guilds = await Guild.find({
    $or: uniquePairs.map((pair) => ({
      realm: { $regex: new RegExp(`^${escapeRegex(pair.realm)}$`, "i") },
      $or: [
        { name: { $regex: new RegExp(`^${escapeRegex(pair.name)}$`, "i") } },
        { parent_guild: { $regex: new RegExp(`^${escapeRegex(pair.name)}$`, "i") } },
      ],
    })),
  })
    .select("_id name realm region parent_guild")
    .lean();

  return guilds.map((guild: any) => ({
    id: guild._id.toString(),
    name: guild.name,
    realm: guild.realm,
    region: guild.region,
    parent_guild: guild.parent_guild,
  }));
}

async function getSelectedStreamerGuildId(userId: string, eligibleGuilds: EligibleStreamerGuild[]): Promise<string | null> {
  const activeGuilds = await Guild.find({ "streamers.managedByUserId": userId }).select("_id").lean();
  if (activeGuilds.length === 0) {
    return null;
  }

  const eligibleIds = new Set(eligibleGuilds.map((guild) => guild.id));
  const selectedGuild = activeGuilds.find((guild: any) => eligibleIds.has(guild._id.toString()));
  return selectedGuild ? selectedGuild._id.toString() : null;
}

async function invalidateStreamerGuildCaches(guilds: EligibleStreamerGuild[]): Promise<void> {
  const uniqueGuilds = Array.from(new Map(guilds.map((guild) => [guild.id, guild])).values());

  await Promise.all(uniqueGuilds.map((guild) => cacheService.invalidateGuildSpecificCaches(guild.realm, guild.name)));
  cacheService.refreshCurrentRaidCaches().catch((error) => {
    logger.warn("Failed to refresh current raid caches after streamer update:", error);
  });
}

function toEligibleStreamerGuild(guild: any): EligibleStreamerGuild {
  return {
    id: guild._id.toString(),
    name: guild.name,
    realm: guild.realm,
    region: guild.region,
    parent_guild: guild.parent_guild,
  };
}

async function removeUserStreamerClaims(userId: string, exceptGuildId?: string): Promise<EligibleStreamerGuild[]> {
  const filter: Record<string, unknown> = { "streamers.managedByUserId": userId };
  if (exceptGuildId) {
    filter._id = { $ne: exceptGuildId };
  }

  const affectedGuilds = await Guild.find(filter).select("_id name realm region parent_guild").lean();
  if (affectedGuilds.length === 0) {
    return [];
  }

  // User-only associations can be removed. For overlapping admin/user
  // associations, remove only the user's claim and leave the admin pin intact.
  await Guild.updateMany(filter, {
    $pull: { streamers: { managedByUserId: userId, adminManaged: false } },
  });
  await Guild.updateMany(
    filter,
    { $unset: { "streamers.$[streamer].managedByUserId": "" } },
    { arrayFilters: [{ "streamer.managedByUserId": userId }] },
  );

  return affectedGuilds.map(toEligibleStreamerGuild);
}

async function clearUserStreamerClaims(userId: string): Promise<void> {
  const affectedGuilds = await removeUserStreamerClaims(userId);
  if (affectedGuilds.length > 0) {
    await invalidateStreamerGuildCaches(affectedGuilds);
  }
}

async function addUserStreamerClaim(guildId: string, channelName: string, userId: string): Promise<void> {
  const claimExisting = () =>
    Guild.updateOne(
      { _id: guildId, "streamers.channelName": channelName },
      { $set: { "streamers.$[streamer].managedByUserId": userId } },
      { arrayFilters: [{ "streamer.channelName": channelName }] },
    );

  const existingResult = await claimExisting();
  if (existingResult.matchedCount > 0) {
    return;
  }

  const addResult = await Guild.updateOne(
    { _id: guildId, "streamers.channelName": { $ne: channelName } },
    {
      $push: {
        streamers: {
          channelName,
          adminManaged: false,
          managedByUserId: userId,
          isLive: false,
          isPlayingWoW: false,
        },
      },
    },
  );

  // An admin may have added the same channel between the first lookup and the
  // push. Attach the user's claim to that entry instead of creating a duplicate.
  if (addResult.matchedCount === 0) {
    await claimExisting();
  }
}

async function updateUserStreamerGuild(user: IUser, guildId: string | null): Promise<{ selectedGuildId: string | null; eligibleGuilds: EligibleStreamerGuild[] }> {
  if (!user.twitch) {
    throw new Error("Twitch account is required");
  }

  if (!user.battlenet) {
    throw new Error("Battle.net account is required");
  }

  const channelName = user.twitch.login.trim().toLowerCase();
  const userId = user._id.toString();
  const eligibleGuilds = await getEligibleStreamerGuilds(user);
  const targetGuild = guildId ? eligibleGuilds.find((guild) => guild.id === guildId) : null;

  if (guildId && !targetGuild) {
    throw new Error("You must select a tracked guild from one of your selected characters");
  }

  const affectedGuilds = await removeUserStreamerClaims(userId, guildId || undefined);

  if (guildId) {
    await addUserStreamerClaim(guildId, channelName, userId);
  }

  await invalidateStreamerGuildCaches([
    ...affectedGuilds,
    ...(targetGuild ? [targetGuild] : []),
  ]);

  return {
    selectedGuildId: guildId,
    eligibleGuilds,
  };
}

async function sanitizeUserStreamerGuild(user: IUser): Promise<void> {
  if (!user.twitch) {
    return;
  }

  const userId = user._id.toString();

  if (!user.battlenet) {
    await clearUserStreamerClaims(userId);
    return;
  }

  const eligibleGuilds = await getEligibleStreamerGuilds(user);
  const activeGuilds = await Guild.find({ "streamers.managedByUserId": userId }).select("_id name realm region parent_guild").lean();
  if (activeGuilds.length === 0) {
    return;
  }

  const eligibleIds = new Set(eligibleGuilds.map((guild) => guild.id));
  const selectedGuild = activeGuilds.find((guild: any) => eligibleIds.has(guild._id.toString()));

  if (!selectedGuild) {
    await clearUserStreamerClaims(userId);
    return;
  }

  const affectedGuilds = await removeUserStreamerClaims(userId, selectedGuild._id.toString());
  if (affectedGuilds.length > 0) {
    await invalidateStreamerGuildCaches(affectedGuilds);
  }
}

// State store for OAuth state validation (prevents CSRF)
// In production, consider using Redis for distributed state
const stateStore: Map<string, { userId: string; expiresAt: Date }> = new Map();

// Clean up expired states periodically
setInterval(
  () => {
    const now = new Date();
    for (const [state, data] of stateStore.entries()) {
      if (data.expiresAt < now) {
        stateStore.delete(state);
      }
    }
  },
  5 * 60 * 1000,
); // Clean up every 5 minutes

/**
 * Generate a secure state token for OAuth flow
 */
function generateState(userId: string): string {
  const state = crypto.randomBytes(32).toString("hex");
  stateStore.set(state, {
    userId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  });
  return state;
}

/**
 * Validate and consume a state token
 */
function validateState(state: string): string | null {
  const data = stateStore.get(state);
  if (!data) return null;
  if (data.expiresAt < new Date()) {
    stateStore.delete(state);
    return null;
  }
  stateStore.delete(state); // Consume the state
  return data.userId;
}

// Get Discord OAuth authorization URL
router.get("/discord/login", (req: Request, res: Response) => {
  try {
    const authUrl = discordService.getAuthorizationUrl();
    res.json({ url: authUrl });
  } catch (error) {
    logger.error("Error generating Discord auth URL:", error);
    res.status(500).json({ error: "Failed to generate authorization URL" });
  }
});

// Get Discord OAuth authorization URL for bot server management
router.get("/discord/guilds/login", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const state = generateState(user._id.toString());
    const authUrl = discordService.getAuthorizationUrl({
      scope: "identify guilds",
      state,
      prompt: "consent",
    });

    res.json({ url: authUrl });
  } catch (error) {
    logger.error("Error generating Discord guild authorization URL:", error);
    res.status(500).json({ error: "Failed to generate authorization URL" });
  }
});

// Discord OAuth callback
router.get("/discord/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const oauthError = typeof req.query.error === "string" ? req.query.error : null;
    const callbackState = typeof state === "string" && state.length > 0 ? state : null;
    const hasState = Boolean(callbackState);

    if (oauthError) {
      return res.redirect(getFrontendUrl() + (hasState ? `/profile/discord?error=${encodeURIComponent(oauthError)}` : `?error=${encodeURIComponent(oauthError)}`));
    }

    if (!code || typeof code !== "string") {
      logger.warn("Discord callback missing code parameter");
      return res.redirect(getFrontendUrl() + (hasState ? "/profile/discord?error=missing_code" : "?error=missing_code"));
    }

    // Exchange code for tokens
    const tokens = await discordService.exchangeCode(code);

    // Get user info from Discord
    const discordUser = await discordService.getUserInfo(tokens.access_token);

    let redirectPath = "/profile";
    if (callbackState) {
      const expectedUserId = validateState(callbackState);
      if (!expectedUserId) {
        logger.warn("Discord guild authorization callback invalid or expired state");
        return res.redirect(getFrontendUrl() + "/profile/discord?error=invalid_state");
      }

      const expectedUser = await discordService.getUserFromSession(expectedUserId);
      if (!expectedUser) {
        logger.warn(`Discord guild authorization callback user not found: ${expectedUserId}`);
        return res.redirect(getFrontendUrl() + "/profile/discord?error=session_expired");
      }

      if (discordUser.id !== expectedUser.discord.id) {
        logger.warn(`Discord guild authorization account mismatch: expected ${expectedUser.discord.id}, got ${discordUser.id}`);
        return res.redirect(getFrontendUrl() + "/profile/discord?error=discord_user_mismatch");
      }

      redirectPath = "/profile/discord?connected=guilds";
    }

    // Find or create user in database
    const user = await discordService.findOrCreateUser(discordUser, tokens);

    // Store user ID in session (managed by express-session)
    req.session.userId = user._id.toString();

    logger.info(`Discord OAuth: Session created for user ${user.discord.username} (${user._id})`);

    // Save session and redirect
    req.session.save((err) => {
      if (err) {
        logger.error("Error saving session:", err);
        return res.redirect(getFrontendUrl() + "?error=session_error");
      }
      logger.info(`Session saved successfully, redirecting to ${redirectPath}. Session ID: ${req.sessionID}`);
      res.redirect(getFrontendUrl() + redirectPath);
    });
  } catch (error) {
    logger.error("Error in Discord OAuth callback:", error);
    res.redirect(getFrontendUrl() + "?error=auth_failed");
  }
});

// Get current user (minimal auth check - used on every page load)
router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    logger.info(`GET /me request - Session ID: ${req.sessionID}, User ID in session: ${userId || "none"}`);

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await discordService.getUserFromSession(userId);

    if (!user) {
      logger.warn(`Session exists but user not found in DB: ${userId}`);
      return res.status(401).json({ error: "Session expired" });
    }

    // Minimal response for auth check - only essential data
    const response = {
      discord: {
        username: user.discord.username,
        avatarUrl: discordService.getAvatarUrl(user.discord.id, user.discord.avatar),
      },
      isAdmin: discordService.isAdmin(user.discord.username),
    };

    res.json(response);
  } catch (error) {
    logger.error("Error getting current user:", error);
    res.status(500).json({ error: "Failed to get user info" });
  }
});

// Get full user profile (used on profile page)
router.get("/profile", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await discordService.getUserFromSession(userId);

    if (!user) {
      logger.warn(`Session exists but user not found in DB: ${userId}`);
      return res.status(401).json({ error: "Session expired" });
    }

    // Build full profile response
    const response: Record<string, unknown> = {
      discord: {
        username: user.discord.username,
        avatarUrl: discordService.getAvatarUrl(user.discord.id, user.discord.avatar),
      },
      isAdmin: discordService.isAdmin(user.discord.username),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };

    // Include Twitch info if connected
    if (user.twitch) {
      response.twitch = {
        displayName: user.twitch.displayName,
        profileImageUrl: user.twitch.profileImageUrl,
        connectedAt: user.twitch.connectedAt,
      };
    }

    // Include Battle.net info if connected
    if (user.battlenet) {
      // Only return selected characters with minimal fields
      const selectedCharacters = user.battlenet.characters
        .filter((c) => c.selected)
        .map((c) => ({
          name: c.name,
          realm: c.realm,
          class: c.class,
          race: c.race,
          level: c.level,
          faction: c.faction,
          guild: c.guild,
          selected: c.selected,
          inactive: c.inactive,
        }));

      response.battlenet = {
        battletag: user.battlenet.battletag,
        connectedAt: user.battlenet.connectedAt,
        characters: selectedCharacters,
        lastCharacterSync: user.battlenet.lastCharacterSync,
      };
    }

    res.json(response);
  } catch (error) {
    logger.error("Error getting user profile:", error);
    res.status(500).json({ error: "Failed to get user profile" });
  }
});

// Logout
router.post("/logout", (req: Request, res: Response) => {
  try {
    // Destroy the session
    req.session.destroy((err) => {
      if (err) {
        logger.error("Error destroying session:", err);
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.json({ success: true });
    });
  } catch (error) {
    logger.error("Error logging out:", error);
    res.status(500).json({ error: "Failed to logout" });
  }
});

// ============================================================
// TWITCH ACCOUNT CONNECTION ROUTES
// ============================================================

// Get Twitch OAuth authorization URL (requires authentication)
router.get("/twitch/connect", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!twitchAuthService.isEnabled()) {
      return res.status(503).json({ error: "Twitch integration not configured" });
    }

    const state = generateState(user._id.toString());
    const authUrl = twitchAuthService.getAuthorizationUrl(user._id.toString(), state);
    res.json({ url: authUrl });
  } catch (error) {
    logger.error("Error generating Twitch auth URL:", error);
    res.status(500).json({ error: "Failed to generate authorization URL" });
  }
});

// Twitch OAuth callback
router.get("/twitch/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      logger.warn("Twitch callback missing code parameter");
      return res.redirect(getFrontendUrl() + "/profile?error=missing_code");
    }

    if (!state || typeof state !== "string") {
      logger.warn("Twitch callback missing state parameter");
      return res.redirect(getFrontendUrl() + "/profile?error=invalid_state");
    }

    // Validate state and get user ID
    const userId = validateState(state);
    if (!userId) {
      logger.warn("Twitch callback invalid or expired state");
      return res.redirect(getFrontendUrl() + "/profile?error=invalid_state");
    }

    // Exchange code for tokens
    const tokens = await twitchAuthService.exchangeCode(code);

    // Get Twitch user info
    const twitchUser = await twitchAuthService.getUserInfo(tokens.access_token);

    // Connect Twitch account to user
    await twitchAuthService.connectTwitchAccount(userId, twitchUser, tokens);

    res.redirect(getFrontendUrl() + "/profile?connected=twitch");
  } catch (error) {
    logger.error("Error in Twitch OAuth callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("already connected")) {
      res.redirect(getFrontendUrl() + "/profile?error=twitch_already_linked");
    } else {
      res.redirect(getFrontendUrl() + "/profile?error=twitch_failed");
    }
  }
});

// Disconnect Twitch account
router.post("/twitch/disconnect", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Optionally revoke token before disconnecting
    if (user.twitch?.accessToken) {
      await twitchAuthService.revokeToken(user.twitch.accessToken);
    }

    await twitchAuthService.disconnectTwitchAccount(user._id.toString());
    await clearUserStreamerClaims(user._id.toString());
    res.json({ success: true });
  } catch (error) {
    logger.error("Error disconnecting Twitch:", error);
    res.status(500).json({ error: "Failed to disconnect Twitch account" });
  }
});

// ============================================================
// BATTLE.NET ACCOUNT CONNECTION ROUTES
// ============================================================

// Get Battle.net OAuth authorization URL (requires authentication)
router.get("/battlenet/connect", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!battlenetAuthService.isEnabled()) {
      return res.status(503).json({ error: "Battle.net integration not configured" });
    }

    const state = generateState(user._id.toString());
    const authUrl = battlenetAuthService.getAuthorizationUrl(user._id.toString(), state);
    res.json({ url: authUrl });
  } catch (error) {
    logger.error("Error generating Battle.net auth URL:", error);
    res.status(500).json({ error: "Failed to generate authorization URL" });
  }
});

// Battle.net OAuth callback
router.get("/battlenet/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      logger.warn("Battle.net callback missing code parameter");
      return res.redirect(getFrontendUrl() + "/profile?error=missing_code");
    }

    if (!state || typeof state !== "string") {
      logger.warn("Battle.net callback missing state parameter");
      return res.redirect(getFrontendUrl() + "/profile?error=invalid_state");
    }

    // Validate state and get user ID
    const userId = validateState(state);
    if (!userId) {
      logger.warn("Battle.net callback invalid or expired state");
      return res.redirect(getFrontendUrl() + "/profile?error=invalid_state");
    }

    // Exchange code for tokens
    const tokens = await battlenetAuthService.exchangeCode(code);

    // Get Battle.net user info
    const userInfo = await battlenetAuthService.getUserInfo(tokens.access_token);

    // Get WoW characters
    const characters = await battlenetAuthService.getWoWCharacters(tokens.access_token);

    // Connect Battle.net account to user
    await battlenetAuthService.connectBattleNetAccount(userId, userInfo, tokens, characters);

    res.redirect(getFrontendUrl() + "/profile?connected=battlenet");
  } catch (error) {
    logger.error("Error in Battle.net OAuth callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("already connected")) {
      res.redirect(getFrontendUrl() + "/profile?error=battlenet_already_linked");
    } else {
      res.redirect(getFrontendUrl() + "/profile?error=battlenet_failed");
    }
  }
});

// Disconnect Battle.net account
router.post("/battlenet/disconnect", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    await battlenetAuthService.disconnectBattleNetAccount(user._id.toString());
    await clearUserStreamerClaims(user._id.toString());
    res.json({ success: true });
  } catch (error) {
    logger.error("Error disconnecting Battle.net:", error);
    res.status(500).json({ error: "Failed to disconnect Battle.net account" });
  }
});

// Get all WoW characters (for character selection dialog)
router.get("/battlenet/characters", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!user.battlenet) {
      return res.status(400).json({ error: "No Battle.net account connected" });
    }

    // Return all characters with minimal fields (exclude realmSlug, guildRealm, guildRealmSlug)
    // Keep id for selection purposes
    const characters = user.battlenet.characters.map((c) => ({
      id: c.id,
      name: c.name,
      realm: c.realm,
      class: c.class,
      race: c.race,
      level: c.level,
      faction: c.faction,
      guild: c.guild,
      selected: c.selected,
      inactive: c.inactive,
    }));

    res.json({ characters });
  } catch (error) {
    logger.error("Error fetching characters:", error);
    res.status(500).json({ error: "Failed to fetch characters" });
  }
});

// Update WoW character selection
router.post("/battlenet/characters", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { characterIds } = req.body;
    if (!Array.isArray(characterIds)) {
      return res.status(400).json({ error: "characterIds must be an array" });
    }

    const updatedUser = await battlenetAuthService.updateCharacterSelection(user._id.toString(), characterIds);
    await sanitizeUserStreamerGuild(updatedUser);

    // Return only selected characters with minimal fields
    const selectedCharacters =
      updatedUser.battlenet?.characters
        .filter((c) => c.selected)
        .map((c) => ({
          name: c.name,
          realm: c.realm,
          class: c.class,
          race: c.race,
          level: c.level,
          faction: c.faction,
          guild: c.guild,
          selected: c.selected,
          inactive: c.inactive,
        })) || [];

    res.json({
      characters: selectedCharacters,
    });
  } catch (error) {
    logger.error("Error updating character selection:", error);
    res.status(500).json({ error: "Failed to update character selection" });
  }
});

// Refresh WoW characters from Battle.net
router.post("/battlenet/characters/refresh", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const characters = await battlenetAuthService.refreshCharacters(user._id.toString());
    const updatedUser = await getAuthenticatedUser(req);
    if (updatedUser) {
      await sanitizeUserStreamerGuild(updatedUser);
    }

    res.json({ characters });
  } catch (error) {
    logger.error("Error refreshing characters:", error);
    res.status(500).json({ error: "Failed to refresh characters" });
  }
});

router.get("/me/streamer-settings", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const eligibleGuilds = await getEligibleStreamerGuilds(user);
    const selectedGuildId = user.twitch ? await getSelectedStreamerGuildId(user._id.toString(), eligibleGuilds) : null;

    res.json({
      selectedGuildId,
      eligibleGuilds,
      requirements: {
        hasTwitch: Boolean(user.twitch),
        hasBattleNet: Boolean(user.battlenet),
        hasSelectedCharacter: Boolean(user.battlenet?.characters.some((character) => character.selected)),
        hasEligibleGuild: eligibleGuilds.length > 0,
      },
    });
  } catch (error) {
    logger.error("Error fetching streamer settings:", error);
    res.status(500).json({ error: "Failed to fetch streamer settings" });
  }
});

router.post("/me/streamer-settings", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const now = Date.now();
    const userId = user._id.toString();
    const lastUpdateAt = streamerUpdateTimestamps.get(userId) || 0;
    const retryAfterMs = STREAMER_UPDATE_COOLDOWN_MS - (now - lastUpdateAt);

    if (retryAfterMs > 0) {
      return res.status(429).json({
        error: "Please wait before updating streamer settings again",
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      });
    }

    const { guildId } = req.body;
    if (guildId !== null && typeof guildId !== "string") {
      return res.status(400).json({ error: "guildId must be a guild id string or null" });
    }

    streamerUpdateTimestamps.set(userId, now);

    const result = await updateUserStreamerGuild(user, guildId);

    res.json({
      success: true,
      ...result,
      requirements: {
        hasTwitch: true,
        hasBattleNet: true,
        hasSelectedCharacter: Boolean(user.battlenet?.characters.some((character) => character.selected)),
        hasEligibleGuild: result.eligibleGuilds.length > 0,
      },
    });
  } catch (error) {
    logger.error("Error updating streamer settings:", error);
    const message = error instanceof Error ? error.message : "Failed to update streamer settings";
    const statusCode = message.includes("required") || message.includes("selected characters") ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

router.get("/me/pickems", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const pickemIds = user.pickems.map((entry) => entry.pickemId);
    const pickems = await Pickem.find({ pickemId: { $in: pickemIds } }).lean();
    const pickemMap = new Map(pickems.map((p) => [p.pickemId, p]));

    const result = user.pickems.map((entry) => {
      const pickem = pickemMap.get(entry.pickemId);
      return {
        pickemId: entry.pickemId,
        pickemName: pickem?.name ?? null,
        type: pickem?.type ?? null,
        predictions: entry.predictions.map((pred) => ({
          guildName: pred.guildName,
          realm: pred.realm,
          position: pred.position,
        })),
        submittedAt: entry.submittedAt,
        updatedAt: entry.updatedAt,
      };
    });

    res.json(result);
  } catch (error) {
    logger.error("Error fetching user pickems:", error);
    res.status(500).json({ error: "Failed to fetch pickems" });
  }
});

router.delete("/me", async (req: Request, res: Response) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    await clearUserStreamerClaims(user._id.toString());
    await User.deleteOne({ _id: user._id });

    req.session.destroy((err) => {
      if (err) {
        logger.error("Error destroying session after account deletion:", err);
        return res.status(500).json({ error: "Account deleted but session cleanup failed" });
      }
      res.json({ success: true });
    });
  } catch (error) {
    logger.error("Error deleting user account:", error);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

function getFrontendUrl(): string {
  const isProd = process.env.NODE_ENV === "production";
  return isProd ? "https://suomiwow.vaarattu.tv" : "http://localhost:3000";
}

export default router;
