import fetch from "node-fetch";
import { CCG_MEDIA_API_CONCURRENCY } from "../config/ccg";
import { Achievement, BossIcon, RaidIcon, AuthToken, AchievementUpdateLog, GuildCrestEmblem, GuildCrestBorder } from "../models/Achievement";
import Raid from "../models/Raid";
import logger from "../utils/logger";
import AsyncSemaphore from "../utils/async-semaphore";
import iconCacheService from "./icon-cache.service";

interface BlizzardTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  sub: string;
}

interface BlizzardAchievementIndex {
  _links: {
    self: {
      href: string;
    };
  };
  achievements: Array<{
    key: {
      href: string;
    };
    name: string;
    id: number;
  }>;
}

interface BlizzardAchievementMedia {
  _links: {
    self: {
      href: string;
    };
  };
  assets: Array<{
    key: string;
    value: string;
    file_data_id: number;
  }>;
  id: number;
}

const BLIZZARD_REQUEST_TIMEOUT_MS = 30_000;

export interface BlizzardCharacterMedia {
  avatarUrl: string | null;
  insetUrl: string | null;
  mainRawUrl: string | null;
}

export interface BlizzardCharacterProfile {
  id: number;
  name: string;
  realm: { name: string; slug: string };
  character_class: { id: number; name: string };
  active_spec: { id: number; name: string };
  guild?: { name: string; realm?: { name: string; slug: string } };
  level: number;
}

interface BlizzardCharacterMediaResponse {
  assets?: Array<{
    key?: string;
    value?: string;
  }>;
}

interface BlizzardGuildCrestIndex {
  _links: {
    self: {
      href: string;
    };
  };
  emblems: Array<{
    id: number;
    media: {
      key: {
        href: string;
      };
      id: number;
    };
  }>;
  borders: Array<{
    id: number;
    media: {
      key: {
        href: string;
      };
      id: number;
    };
  }>;
}

interface BlizzardGuildCrestMedia {
  _links: {
    self: {
      href: string;
    };
  };
  assets: Array<{
    key: string;
    value: string;
  }>;
  id: number;
}

interface BlizzardGuildData {
  _links: {
    self: {
      href: string;
    };
  };
  id: number;
  name: string;
  faction: {
    type: string;
    name: string;
  };
  achievement_points: number;
  member_count: number;
  realm: {
    key: {
      href: string;
    };
    name: string;
    id: number;
    slug: string;
  };
  crest: {
    emblem: {
      id: number;
      media: {
        key: {
          href: string;
        };
        id: number;
      };
      color: {
        id: number;
        rgba: {
          r: number;
          g: number;
          b: number;
          a: number;
        };
      };
    };
    border: {
      id: number;
      media: {
        key: {
          href: string;
        };
        id: number;
      };
      color: {
        id: number;
        rgba: {
          r: number;
          g: number;
          b: number;
          a: number;
        };
      };
    };
    background: {
      color: {
        id: number;
        rgba: {
          r: number;
          g: number;
          b: number;
          a: number;
        };
      };
    };
  };
  roster: {
    href: string;
  };
  achievements: {
    href: string;
  };
  created_timestamp: number;
  activity: {
    href: string;
  };
  name_search: string;
}

export class BlizzardApiClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly oauthUrl = "https://oauth.battle.net/token";
  private readonly regionApiUrls: { [key: string]: string } = {
    us: "https://us.api.blizzard.com",
    eu: "https://eu.api.blizzard.com",
    kr: "https://kr.api.blizzard.com",
    tw: "https://tw.api.blizzard.com",
  };
  private readonly apiBaseUrl = "https://us.api.blizzard.com";
  private readonly namespace = "static-us";
  private readonly locale = "en_US";
  private readonly characterMediaRequests = new AsyncSemaphore(CCG_MEDIA_API_CONCURRENCY);

  // In-memory cache for ongoing requests to prevent duplicates
  private readonly pendingBossIconRequests = new Map<string, Promise<string | null>>();
  private readonly pendingRaidIconRequests = new Map<string, Promise<string | null>>();

  constructor() {
    this.clientId = process.env.BLIZZARD_CLIENT_ID!;
    this.clientSecret = process.env.BLIZZARD_CLIENT_SECRET!;

    if (!this.clientId || !this.clientSecret) {
      throw new Error("Blizzard API credentials not found in environment variables");
    }
  }

  /**
   * Get a valid access token, fetching a new one if necessary
   */
  private async getAccessToken(): Promise<string> {
    try {
      // Check if we have a valid token in the database
      const existingToken = await AuthToken.findOne({ service: "blizzard" });

      if (existingToken && existingToken.expiresAt > new Date()) {
        return existingToken.accessToken;
      }

      // Fetch a new token
      logger.info("Fetching new Blizzard OAuth token...");

      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

      logger.info(`[API REQUEST] POST ${this.oauthUrl}`);
      const response = await fetch(this.oauthUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(BLIZZARD_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Blizzard token: ${response.statusText}`);
      }

      const data = (await response.json()) as BlizzardTokenResponse;
      const { access_token, token_type, expires_in } = data;

      // Calculate expiration time (subtract 60 seconds for safety buffer)
      const expiresAt = new Date(Date.now() + (expires_in - 60) * 1000);

      // Store in database (upsert to replace existing token)
      await AuthToken.findOneAndUpdate(
        { service: "blizzard" },
        {
          service: "blizzard",
          accessToken: access_token,
          tokenType: token_type,
          expiresAt,
        },
        { upsert: true, returnDocument: "after" },
      );

      logger.info(`✅ New Blizzard token acquired, expires at: ${expiresAt.toISOString()}`);
      return access_token;
    } catch (error: any) {
      logger.error("Error fetching Blizzard access token:", error.message);
      throw new Error("Failed to obtain Blizzard API access token");
    }
  }

  /**
   * Make an authenticated API call to Blizzard with exponential backoff retry
   */
  private async makeAuthenticatedRequest<T>(url: string, retryCount = 0, maxRetries = 25): Promise<T> {
    const token = await this.getAccessToken();

    try {
      logger.info(`[API REQUEST] BlizzardService.makeAuthenticatedRequest - GET ${url}`);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(BLIZZARD_REQUEST_TIMEOUT_MS),
      });

      // Handle rate limiting with exponential backoff
      if (response.status === 429) {
        if (retryCount >= maxRetries) {
          throw new Error(`Max retries (${maxRetries}) reached for rate limited request`);
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const waitTime = Math.pow(2, retryCount) * 1000;
        logger.info(`⏳ Rate limited (429). Retrying in ${waitTime / 1000}s... (attempt ${retryCount + 1}/${maxRetries})`);

        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.makeAuthenticatedRequest<T>(url, retryCount + 1, maxRetries);
      }

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error: any) {
      // If it's a retry error, throw it directly
      if (error.message.includes("Max retries")) {
        throw error;
      }
      logger.error(`Error making authenticated request to ${url}:`, error.message);
      throw new Error(`Blizzard API request failed: ${error.message}`);
    }
  }

  /**
   * Fetch all achievements from Blizzard API and store them
   */
  public async updateAchievements(): Promise<void> {
    try {
      logger.info("📋 Fetching achievements from Blizzard API...");
      const url = `${this.apiBaseUrl}/data/wow/achievement/index?namespace=${this.namespace}&locale=${this.locale}`;
      const achievementIndex = await this.makeAuthenticatedRequest<BlizzardAchievementIndex>(url);

      logger.info(`📋 Found ${achievementIndex.achievements.length} achievements to process`);

      // Use bulk operations for better performance
      const bulkOps = achievementIndex.achievements.map((achievement) => ({
        updateOne: {
          filter: { id: achievement.id },
          update: {
            $set: {
              id: achievement.id,
              name: achievement.name,
              href: achievement.key.href,
              lastUpdated: new Date(),
            },
          },
          upsert: true,
        },
      }));

      if (bulkOps.length > 0) {
        await Achievement.bulkWrite(bulkOps);
        logger.info(`✅ Successfully updated ${bulkOps.length} achievements`);
      }

      // Update the log
      await AchievementUpdateLog.findOneAndUpdate(
        {},
        {
          lastFullUpdate: new Date(),
          $inc: { attemptCount: 1 },
        },
        { upsert: true },
      );

      logger.info("✅ Achievement update completed successfully");
    } catch (error: any) {
      logger.error("Error updating achievements:", error.message);
      throw new Error(`Failed to update achievements: ${error.message}`);
    }
  }

  /**
   * Escape a string for use in a RegExp
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Strip leading articles ("The", "A", "An") from a name
   */
  private stripLeadingArticle(name: string): string {
    return name.replace(/^(the|a|an)\s+/i, "").trim();
  }

  /**
   * Get significant words from a name (length > 3, not common stop words)
   */
  private getSignificantWords(name: string): string[] {
    const stopWords = new Set(["the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "with"]);
    return name.split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w.toLowerCase()));
  }

  /**
   * Try to find an achievement matching a specific regex pattern.
   * Returns the achievement if found, null otherwise.
   */
  private async tryAchievementMatch(pattern: RegExp): Promise<{ id: number; name: string } | null> {
    const achievement = await Achievement.findOne({ name: { $regex: pattern } });
    if (achievement) {
      return { id: achievement.id, name: achievement.name };
    }
    return null;
  }

  /**
   * Find achievement by boss name using a multi-phase matching strategy.
   *
   * Matching phases (in order of confidence):
   * 1. Exact "Mythic: {name}" match (with and without article prefix)
   * 2. Boss name as substring within "Mythic:" achievements only
   * 3. Name without first word as substring in "Mythic:" achievements
   *    (handles variants like "Felhounds of Sargeras" → "Mythic: Hounds of Sargeras")
   * 4. Individual significant words as exact "Mythic: {word}" match
   *    (handles abbreviated achievements like "The Defense of Eonar" → "Mythic: Eonar")
   * 5. Individual significant words as substring within "Mythic:" achievements
   * 6. Fallback: full name as substring in any achievement (no "Mythic:" requirement)
   */
  public async findAchievementByBossName(bossName: string): Promise<{ id: number; name: string } | null> {
    try {
      const normalized = this.stripLeadingArticle(bossName);

      // Build candidate names for exact and substring matching
      const candidates = [...new Set([bossName, normalized])];

      // Handle comma-separated names: "Rashok, the Elder" → also try "Rashok"
      if (bossName.includes(",")) {
        const beforeComma = bossName.split(",")[0].trim();
        const beforeCommaStripped = this.stripLeadingArticle(beforeComma);
        candidates.push(beforeComma);
        if (beforeCommaStripped !== beforeComma) {
          candidates.push(beforeCommaStripped);
        }
      }

      // Deduplicate candidates
      const uniqueCandidates = [...new Set(candidates)];

      // --- Phase 1: Exact "Mythic: {candidate}" match ---
      for (const candidate of uniqueCandidates) {
        const escaped = this.escapeRegex(candidate);
        const match = await this.tryAchievementMatch(new RegExp(`^Mythic: ${escaped}$`, "i"));
        if (match) {
          logger.info(`✅ Boss icon match (exact mythic): "${bossName}" -> "${match.name}"`);
          return match;
        }
      }

      // --- Phase 2: Candidate as substring within "Mythic:" achievements ---
      for (const candidate of uniqueCandidates) {
        const escaped = this.escapeRegex(candidate);
        const match = await this.tryAchievementMatch(new RegExp(`^Mythic:.*${escaped}`, "i"));
        if (match) {
          logger.info(`✅ Boss icon match (mythic substring): "${bossName}" -> "${match.name}"`);
          return match;
        }
      }

      // --- Phase 3: Try without first word (handles name variants) ---
      // Example: "Felhounds of Sargeras" → "of Sargeras" → matches "Mythic: Hounds of Sargeras"
      const normalizedWords = normalized.split(/\s+/);
      if (normalizedWords.length > 1) {
        const withoutFirst = normalizedWords.slice(1).join(" ");
        if (withoutFirst.length > 3) {
          const escaped = this.escapeRegex(withoutFirst);
          const match = await this.tryAchievementMatch(new RegExp(`^Mythic:.*${escaped}`, "i"));
          if (match) {
            logger.info(`✅ Boss icon match (mythic without first word): "${bossName}" -> "${match.name}"`);
            return match;
          }
        }
      }

      // --- Phase 4: Individual significant words as exact "Mythic: {word}" match ---
      // Example: "The Defense of Eonar" → words ["Defense", "Eonar"] → "Mythic: Eonar"
      const significantWords = this.getSignificantWords(normalized);
      // Sort longest first for most specific match
      significantWords.sort((a, b) => b.length - a.length);

      for (const word of significantWords) {
        const escaped = this.escapeRegex(word);
        const match = await this.tryAchievementMatch(new RegExp(`^Mythic: ${escaped}$`, "i"));
        if (match) {
          logger.info(`✅ Boss icon match (mythic exact word): "${bossName}" -> "${match.name}"`);
          return match;
        }
      }

      // --- Phase 5: Significant words as substring within "Mythic:" achievements ---
      for (const word of significantWords) {
        const escaped = this.escapeRegex(word);
        const match = await this.tryAchievementMatch(new RegExp(`^Mythic:.*\\b${escaped}\\b`, "i"));
        if (match) {
          logger.info(`✅ Boss icon match (mythic word boundary): "${bossName}" -> "${match.name}"`);
          return match;
        }
      }

      // --- Phase 6: Fallback - full name as substring in any achievement ---
      for (const candidate of uniqueCandidates) {
        const escaped = this.escapeRegex(candidate);
        const match = await this.tryAchievementMatch(new RegExp(escaped, "i"));
        if (match) {
          logger.info(`✅ Boss icon match (fallback substring): "${bossName}" -> "${match.name}"`);
          return match;
        }
      }

      logger.info(`⚠️  No achievement found for boss: "${bossName}"`);
      return null;
    } catch (error: any) {
      logger.error(`Error finding achievement for boss "${bossName}":`, error.message);
      return null;
    }
  }

  /**
   * Hardcoded raid name → achievement name overrides for cases where
   * the API raid name is completely different from the achievement name.
   */
  private static readonly RAID_ACHIEVEMENT_OVERRIDES: Record<string, string> = {
    "VS / DR / MQD": "March on Quel'Danas",
  };

  /**
   * Hardcoded raid name -> local icon filename overrides for raids without
   * achievement media.
   */
  private static readonly RAID_ICON_FILENAME_OVERRIDES: Record<string, string> = {
    Sporefall: "inv_achievement_raid_fungarian.jpg",
  };

  /**
   * Find achievement by raid name match (looks for raid achievements)
   */
  public async findAchievementByRaidName(raidName: string): Promise<{ id: number; name: string } | null> {
    try {
      // Check hardcoded overrides first
      const override = BlizzardApiClient.RAID_ACHIEVEMENT_OVERRIDES[raidName];
      if (override) {
        const escapedOverride = this.escapeRegex(override);
        const achievement = await Achievement.findOne({
          name: { $regex: new RegExp(escapedOverride, "i") },
        });
        if (achievement) {
          logger.info(`✅ Found achievement using override: "${raidName}" -> "${achievement.name}"`);
          return { id: achievement.id, name: achievement.name };
        }
      }

      // Try to find achievement that contains the raid name
      // Raid achievements typically have the raid name in them
      const escapedRaidName = raidName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // First try exact match
      let achievement = await Achievement.findOne({
        name: { $regex: new RegExp(`^${escapedRaidName}$`, "i") },
      });

      if (achievement) {
        return { id: achievement.id, name: achievement.name };
      }

      // Try partial match
      achievement = await Achievement.findOne({
        name: { $regex: new RegExp(escapedRaidName, "i") },
      });

      if (achievement) {
        return { id: achievement.id, name: achievement.name };
      }

      // Try fuzzy matching with "first word + raider" pattern
      // Example: "Hellfire Citadel" -> "Hellfire Raider"
      const firstWord = raidName.split(" ")[0].trim();
      if (firstWord && firstWord.length > 3) {
        // Only try if first word is substantial
        const raiderPattern = `${firstWord} Raider`;
        const escapedRaiderPattern = raiderPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        achievement = await Achievement.findOne({
          name: { $regex: new RegExp(`^${escapedRaiderPattern}$`, "i") },
        });

        if (achievement) {
          logger.info(`✅ Found achievement using raider pattern: "${raidName}" -> "${achievement.name}"`);
          return { id: achievement.id, name: achievement.name };
        }

        achievement = await Achievement.findOne({
          name: { $regex: new RegExp(escapedRaiderPattern, "i") },
        });

        if (achievement) {
          logger.info(`✅ Found achievement using raider pattern: "${raidName}" -> "${achievement.name}"`);
          return { id: achievement.id, name: achievement.name };
        }
      }

      logger.info(`⚠️  No achievement found for raid: "${raidName}"`);
      return null;
    } catch (error: any) {
      logger.error(`Error finding achievement for raid "${raidName}":`, error.message);
      return null;
    }
  }

  /**
   * Fetch achievement media (icon) by achievement ID
   */
  public async getAchievementMedia(achievementId: number): Promise<string | null> {
    try {
      const url = `${this.apiBaseUrl}/data/wow/media/achievement/${achievementId}?namespace=${this.namespace}&locale=${this.locale}`;
      const media = await this.makeAuthenticatedRequest<BlizzardAchievementMedia>(url);

      const iconAsset = media.assets.find((asset) => asset.key === "icon");
      if (!iconAsset) {
        logger.info(`⚠️  No icon found for achievement ${achievementId}`);
        return null;
      }

      return iconAsset.value;
    } catch (error: any) {
      logger.error(`Error fetching media for achievement ${achievementId}:`, error.message);
      return null;
    }
  }

  public async getCharacterMedia(characterName: string, realmSlug: string, region: string): Promise<BlizzardCharacterMedia> {
    return this.characterMediaRequests.run(async () => {
      const regionLower = region.toLowerCase();
      const apiUrl = this.regionApiUrls[regionLower];
      if (!apiUrl) throw new Error(`Unsupported Blizzard region: ${region}`);

      const nameSlug = encodeURIComponent(characterName.toLowerCase());
      const normalizedRealmSlug = encodeURIComponent(realmSlug.toLowerCase());
      const namespace = `profile-${regionLower}`;
      const url = `${apiUrl}/profile/wow/character/${normalizedRealmSlug}/${nameSlug}/character-media?namespace=${namespace}&locale=${this.locale}`;
      const response = await this.makeAuthenticatedRequest<BlizzardCharacterMediaResponse>(url, 0, 5);
      const assets = new Map((response.assets ?? []).map((asset) => [asset.key, asset.value]));

      return {
        avatarUrl: assets.get("avatar") ?? null,
        insetUrl: assets.get("inset") ?? null,
        mainRawUrl: assets.get("main-raw") ?? assets.get("main") ?? null,
      };
    });
  }

  public async getCharacterProfile(characterName: string, realmSlug: string, region: string): Promise<BlizzardCharacterProfile> {
    const regionLower = region.toLowerCase();
    const apiUrl = this.regionApiUrls[regionLower];
    if (!apiUrl) throw new Error(`Unsupported Blizzard region: ${region}`);

    const nameSlug = encodeURIComponent(characterName.toLowerCase());
    const normalizedRealmSlug = encodeURIComponent(realmSlug.toLowerCase());
    const namespace = `profile-${regionLower}`;
    const url = `${apiUrl}/profile/wow/character/${normalizedRealmSlug}/${nameSlug}?namespace=${namespace}&locale=${this.locale}`;
    return this.makeAuthenticatedRequest<BlizzardCharacterProfile>(url, 0, 5);
  }

  /**
   * Get boss icon URL by boss name (main entry point)
   */
  public async getBossIconUrl(bossName: string): Promise<string | null> {
    // Check if there's already a pending request for this boss name
    if (this.pendingBossIconRequests.has(bossName)) {
      logger.info(`⏳ Waiting for existing request for boss: ${bossName}`);
      return this.pendingBossIconRequests.get(bossName)!;
    }

    // Create a new promise for this boss name
    const promise = this._fetchBossIconUrl(bossName);
    this.pendingBossIconRequests.set(bossName, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up the pending request when done
      this.pendingBossIconRequests.delete(bossName);
    }
  }

  /**
   * Internal method to actually fetch the boss icon URL
   */
  private async _fetchBossIconUrl(bossName: string): Promise<string | null> {
    try {
      // Check if we already have the icon cached
      const cachedIcon = await BossIcon.findOne({ bossName });
      if (cachedIcon) {
        logger.info(`✅ Found cached icon for boss: ${bossName}`);
        return cachedIcon.iconUrl;
      }

      // Find the achievement for this boss
      const achievement = await this.findAchievementByBossName(bossName);
      if (!achievement) {
        return null;
      }

      // Get the icon from the achievement media (Blizzard URL)
      const blizzardIconUrl = await this.getAchievementMedia(achievement.id);
      if (!blizzardIconUrl) {
        return null;
      }

      // Download and cache the icon locally (returns filename only)
      const iconFilename = await iconCacheService.downloadAndCacheIcon(blizzardIconUrl);

      // Cache the result using upsert to avoid race conditions
      await BossIcon.findOneAndUpdate(
        { bossName },
        {
          bossName,
          blizzardIconUrl,
          iconUrl: iconFilename, // Store just the filename
          achievementId: achievement.id,
          lastUpdated: new Date(),
        },
        { upsert: true, returnDocument: "after" },
      );

      logger.info(`✅ Cached new icon for boss: ${bossName} -> ${iconFilename}`);
      return iconFilename;
    } catch (error: any) {
      logger.error(`Error getting boss icon for "${bossName}":`, error.message);
      return null;
    }
  }

  /**
   * Get raid icon URL by raid name (main entry point)
   */
  public async getRaidIconUrl(raidName: string): Promise<string | null> {
    // Check if there's already a pending request for this raid name
    if (this.pendingRaidIconRequests.has(raidName)) {
      logger.info(`⏳ Waiting for existing request for raid: ${raidName}`);
      return this.pendingRaidIconRequests.get(raidName)!;
    }

    // Create a new promise for this raid name
    const promise = this._fetchRaidIconUrl(raidName);
    this.pendingRaidIconRequests.set(raidName, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up the pending request when done
      this.pendingRaidIconRequests.delete(raidName);
    }
  }

  /**
   * Internal method to actually fetch the raid icon URL
   */
  private async _fetchRaidIconUrl(raidName: string): Promise<string | null> {
    try {
      const iconFilenameOverride = BlizzardApiClient.RAID_ICON_FILENAME_OVERRIDES[raidName];
      if (iconFilenameOverride) {
        await RaidIcon.findOneAndUpdate(
          { raidName },
          {
            raidName,
            blizzardIconUrl: `manual:${iconFilenameOverride}`,
            iconUrl: iconFilenameOverride,
            achievementId: 0,
            lastUpdated: new Date(),
          },
          { upsert: true, returnDocument: "after" },
        );

        logger.info(`✅ Found manual icon override for raid: ${raidName} -> ${iconFilenameOverride}`);
        return iconFilenameOverride;
      }

      // Check if we already have the icon cached
      const cachedIcon = await RaidIcon.findOne({ raidName });
      if (cachedIcon) {
        logger.info(`✅ Found cached icon for raid: ${raidName}`);
        return cachedIcon.iconUrl;
      }

      // Find the achievement for this raid
      const achievement = await this.findAchievementByRaidName(raidName);
      if (!achievement) {
        return null;
      }

      // Get the icon from the achievement media (Blizzard URL)
      const blizzardIconUrl = await this.getAchievementMedia(achievement.id);
      if (!blizzardIconUrl) {
        return null;
      }

      // Download and cache the icon locally (returns filename only)
      const iconFilename = await iconCacheService.downloadAndCacheIcon(blizzardIconUrl);

      // Cache the result using upsert to avoid race conditions
      await RaidIcon.findOneAndUpdate(
        { raidName },
        {
          raidName,
          blizzardIconUrl,
          iconUrl: iconFilename, // Store just the filename
          achievementId: achievement.id,
          lastUpdated: new Date(),
        },
        { upsert: true, returnDocument: "after" },
      );

      logger.info(`✅ Cached new icon for raid: ${raidName} -> ${iconFilename}`);
      return iconFilename;
    } catch (error: any) {
      logger.error(`Error getting raid icon for "${raidName}":`, error.message);
      return null;
    }
  }

  /**
   * Batch fetch boss icons for multiple boss names (deduplicates automatically)
   * Processes sequentially with small delays to avoid rate limiting
   */
  public async getBossIconUrls(bossNames: string[]): Promise<Map<string, string | null>> {
    // Deduplicate boss names
    const uniqueBossNames = [...new Set(bossNames)];

    if (uniqueBossNames.length < bossNames.length) {
      logger.info(`🔄 Deduplicated ${bossNames.length} boss names to ${uniqueBossNames.length} unique names`);
    }

    const results = new Map<string, string | null>();

    // Process sequentially with small delays to avoid rate limiting
    for (let i = 0; i < uniqueBossNames.length; i++) {
      const bossName = uniqueBossNames[i];
      const iconUrl = await this.getBossIconUrl(bossName);
      results.set(bossName, iconUrl);

      // Add a small delay between requests (except for the last one)
      if (i < uniqueBossNames.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay
      }
    }

    return results;
  }

  /**
   * Batch fetch raid icons for multiple raid names (deduplicates automatically)
   * Processes sequentially with small delays to avoid rate limiting
   */
  public async getRaidIconUrls(raidNames: string[]): Promise<Map<string, string | null>> {
    // Deduplicate raid names
    const uniqueRaidNames = [...new Set(raidNames)];

    if (uniqueRaidNames.length < raidNames.length) {
      logger.info(`🔄 Deduplicated ${raidNames.length} raid names to ${uniqueRaidNames.length} unique names`);
    }

    const results = new Map<string, string | null>();

    // Process sequentially with small delays to avoid rate limiting
    for (let i = 0; i < uniqueRaidNames.length; i++) {
      const raidName = uniqueRaidNames[i];
      const iconUrl = await this.getRaidIconUrl(raidName);
      results.set(raidName, iconUrl);

      // Add a small delay between requests (except for the last one)
      if (i < uniqueRaidNames.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay
      }
    }

    return results;
  }

  /**
   * Check whether a cached BossIcon match looks correct.
   * A match is suspicious if the achievement name doesn't contain the boss name
   * (or a recognizable portion of it) in a "Mythic:" pattern.
   */
  private isBossIconMatchSuspicious(bossName: string, achievementName: string): boolean {
    const lower = achievementName.toLowerCase();

    // If the achievement starts with "Mythic:" and contains the full boss name, it's fine
    const normalizedBoss = this.stripLeadingArticle(bossName).toLowerCase();
    if (lower.startsWith("mythic:") && lower.includes(normalizedBoss)) {
      return false;
    }

    // If it starts with "Mythic:" and ALL significant words from the boss name appear, it's plausible
    // Requiring ALL words prevents false positives like "Imperator" matching "Imperator's Fall"
    // when the boss is actually "Imperator Averzian"
    const significantWords = this.getSignificantWords(normalizedBoss);
    if (lower.startsWith("mythic:") && significantWords.length > 0) {
      const mythicPart = lower.slice(7).trim();
      const allMatch = significantWords.every((word) => {
        const wordRegex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, "i");
        return wordRegex.test(mythicPart);
      });
      if (allMatch) {
        return false;
      }
    }

    // Achievement doesn't look like a correct Mythic: match for this boss
    return true;
  }

  /**
   * Retry matching for bosses with missing or suspicious icon matches.
   * Scans all raids, finds bosses with missing iconUrl or where the cached
   * BossIcon match looks incorrect, and re-runs the matching algorithm.
   * Updates both the BossIcon cache and the Raid document.
   */
  public async retryMissingBossIcons(): Promise<void> {
    try {
      const raids = await Raid.find({});
      const bossesToRetry: { raidId: number; raidName: string; bossName: string; reason: string }[] = [];

      for (const raid of raids) {
        for (const boss of raid.bosses) {
          if (!boss.iconUrl) {
            bossesToRetry.push({ raidId: raid.id, raidName: raid.name, bossName: boss.name, reason: "missing" });
            continue;
          }

          // Check if the existing cached match looks suspicious
          const cached = await BossIcon.findOne({ bossName: boss.name });
          if (!cached) {
            // Boss has an iconUrl in Raid doc but no BossIcon entry — orphaned state, needs re-evaluation
            bossesToRetry.push({
              raidId: raid.id,
              raidName: raid.name,
              bossName: boss.name,
              reason: "orphaned (iconUrl set but no BossIcon cache entry)",
            });
            continue;
          }

          // Validate the cached match against the achievement name
          const achievement = await Achievement.findOne({ id: cached.achievementId });
          if (!achievement) {
            bossesToRetry.push({
              raidId: raid.id,
              raidName: raid.name,
              bossName: boss.name,
              reason: `achievement ${cached.achievementId} not found in DB`,
            });
            continue;
          }

          if (this.isBossIconMatchSuspicious(boss.name, achievement.name)) {
            bossesToRetry.push({
              raidId: raid.id,
              raidName: raid.name,
              bossName: boss.name,
              reason: `suspicious match: "${achievement.name}"`,
            });
          }
        }
      }

      if (bossesToRetry.length === 0) {
        logger.info("✅ All boss icons look correct, no re-matching needed");
        return;
      }

      logger.info(`🔄 Found ${bossesToRetry.length} boss icons to re-evaluate...`);
      let matched = 0;

      for (const { raidId, raidName, bossName, reason } of bossesToRetry) {
        logger.info(`🔄 Re-evaluating: "${bossName}" (${raidName}) — reason: ${reason}`);

        // Delete the old BossIcon cache entry so the algorithm runs fresh
        await BossIcon.deleteOne({ bossName });

        const iconUrl = await this.getBossIconUrl(bossName);

        if (iconUrl) {
          // Update the boss iconUrl in the Raid document
          await Raid.updateOne({ id: raidId, "bosses.name": bossName }, { $set: { "bosses.$.iconUrl": iconUrl } });
          matched++;
          logger.info(`✅ Re-matched boss icon: "${bossName}" (${raidName}) -> ${iconUrl}`);
        } else {
          // Clear the bad iconUrl from the Raid document too
          await Raid.updateOne({ id: raidId, "bosses.name": bossName }, { $unset: { "bosses.$.iconUrl": "" } });
          logger.info(`⚠️  Still no match for boss: "${bossName}" (${raidName})`);
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      logger.info(`🔄 Boss icon re-matching complete: ${matched}/${bossesToRetry.length} resolved`);
    } catch (error: any) {
      logger.error("Error retrying missing boss icons:", error.message);
    }
  }

  /**
   * Initialize achievements if none exist
   */
  public async initializeIfNeeded(): Promise<void> {
    try {
      const count = await Achievement.countDocuments();
      if (count === 0) {
        logger.info("🚀 No achievements found, performing initial fetch...");
        await this.updateAchievements();
      } else {
        logger.info(`✅ Found ${count} achievements in database`);
      }

      // Also initialize guild crest components
      const emblemCount = await GuildCrestEmblem.countDocuments();
      const borderCount = await GuildCrestBorder.countDocuments();
      if (emblemCount === 0 || borderCount === 0) {
        logger.info("🚀 Guild crest components not cached, performing initial fetch...");
        await this.cacheGuildCrestComponents();
      } else {
        logger.info(`✅ Found ${emblemCount} emblems and ${borderCount} borders in database`);
      }
    } catch (error: any) {
      logger.error("Error during Blizzard API initialization:", error.message);
      // Don't throw here, as this is initialization and shouldn't block startup
    }
  }

  /**
   * Cache all guild crest components (emblems and borders)
   * This is called on startup to download and cache all crest images
   */
  public async cacheGuildCrestComponents(): Promise<void> {
    try {
      logger.info("🎨 Fetching guild crest index from Blizzard API...");

      // We'll use EU region for the crest index (crests are the same across regions)
      const region = "eu";
      const namespace = `static-${region}`;
      const apiUrl = this.regionApiUrls[region];
      const url = `${apiUrl}/data/wow/guild-crest/index?namespace=${namespace}&locale=${this.locale}`;

      const crestIndex = await this.makeAuthenticatedRequest<BlizzardGuildCrestIndex>(url);

      logger.info(`🎨 Found ${crestIndex.emblems.length} emblems and ${crestIndex.borders.length} borders`);

      // Process emblems
      let emblemsFetched = 0;
      for (const emblem of crestIndex.emblems) {
        // Check if we already have this emblem cached
        const existing = await GuildCrestEmblem.findOne({ id: emblem.id });
        if (existing) {
          logger.info(`✅ Emblem ${emblem.id} already cached, skipping...`);
          continue;
        }

        // Fetch the media URL for this emblem
        const mediaUrl = emblem.media.key.href;
        const media = await this.makeAuthenticatedRequest<BlizzardGuildCrestMedia>(mediaUrl);

        const imageAsset = media.assets.find((asset) => asset.key === "image");
        if (!imageAsset) {
          logger.warn(`⚠️  No image found for emblem ${emblem.id}`);
          continue;
        }

        // Download and cache the image
        const imageName = await iconCacheService.downloadAndCacheIcon(imageAsset.value);

        // Store in database
        await GuildCrestEmblem.create({
          id: emblem.id,
          imageName,
          blizzardIconUrl: imageAsset.value,
          lastUpdated: new Date(),
        });

        emblemsFetched++;
        logger.info(`✅ Cached emblem ${emblem.id} -> ${imageName}`);

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Process borders
      let bordersFetched = 0;
      for (const border of crestIndex.borders) {
        // Check if we already have this border cached
        const existing = await GuildCrestBorder.findOne({ id: border.id });
        if (existing) {
          logger.info(`✅ Border ${border.id} already cached, skipping...`);
          continue;
        }

        // Fetch the media URL for this border
        const mediaUrl = border.media.key.href;
        const media = await this.makeAuthenticatedRequest<BlizzardGuildCrestMedia>(mediaUrl);

        const imageAsset = media.assets.find((asset) => asset.key === "image");
        if (!imageAsset) {
          logger.warn(`⚠️  No image found for border ${border.id}`);
          continue;
        }

        // Download and cache the image
        const imageName = await iconCacheService.downloadAndCacheIcon(imageAsset.value);

        // Store in database
        await GuildCrestBorder.create({
          id: border.id,
          imageName,
          blizzardIconUrl: imageAsset.value,
          lastUpdated: new Date(),
        });

        bordersFetched++;
        logger.info(`✅ Cached border ${border.id} -> ${imageName}`);

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      logger.info(`✅ Guild crest caching completed: ${emblemsFetched} new emblems, ${bordersFetched} new borders`);
    } catch (error: any) {
      logger.error("Error caching guild crest components:", error.message);
      throw new Error(`Failed to cache guild crest components: ${error.message}`);
    }
  }

  /**
   * Fetch a specific crest component if it's missing from cache
   */
  private async fetchMissingCrestComponent(type: "emblem" | "border", id: number): Promise<string | null> {
    try {
      logger.info(`🔍 Fetching missing ${type} ${id}...`);

      const region = "eu";
      const namespace = `static-${region}`;
      const apiUrl = this.regionApiUrls[region];
      const url = `${apiUrl}/data/wow/media/guild-crest/${type}/${id}?namespace=${namespace}&locale=${this.locale}`;

      const media = await this.makeAuthenticatedRequest<BlizzardGuildCrestMedia>(url);

      const imageAsset = media.assets.find((asset) => asset.key === "image");
      if (!imageAsset) {
        logger.warn(`⚠️  No image found for ${type} ${id}`);
        return null;
      }

      // Download and cache the image
      const imageName = await iconCacheService.downloadAndCacheIcon(imageAsset.value);

      // Store in database
      if (type === "emblem") {
        await GuildCrestEmblem.create({
          id,
          imageName,
          blizzardIconUrl: imageAsset.value,
          lastUpdated: new Date(),
        });
      } else {
        await GuildCrestBorder.create({
          id,
          imageName,
          blizzardIconUrl: imageAsset.value,
          lastUpdated: new Date(),
        });
      }

      logger.info(`✅ Cached ${type} ${id} -> ${imageName}`);
      return imageName;
    } catch (error: any) {
      logger.error(`Error fetching ${type} ${id}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch guild data from Blizzard API
   */
  public async getGuildData(
    guildName: string,
    realmSlug: string,
    region: string,
  ): Promise<{
    crest: {
      emblem: { id: number; imageName: string; color: { r: number; g: number; b: number; a: number } };
      border: { id: number; imageName: string; color: { r: number; g: number; b: number; a: number } };
      background: { color: { r: number; g: number; b: number; a: number } };
    };
    faction?: string;
  } | null> {
    try {
      // Normalize region to lowercase
      const regionLower = region.toLowerCase();

      // Create guild name slug (replace spaces with dashes, lowercase)
      const guildSlug = guildName.toLowerCase().replace(/\s+/g, "-");

      // Build the URL
      const namespace = `profile-${regionLower}`;
      const apiUrl = this.regionApiUrls[regionLower] || this.apiBaseUrl;
      const url = `${apiUrl}/data/wow/guild/${realmSlug}/${encodeURIComponent(guildSlug)}?namespace=${namespace}&locale=${this.locale}`;

      logger.info(`🔍 Fetching guild data for ${guildName} - ${realmSlug} (${regionLower})...`);
      const guildData = await this.makeAuthenticatedRequest<BlizzardGuildData>(url);

      // Get emblem image name (check cache or fetch if missing)
      let emblemImageName: string | null = null;
      const cachedEmblem = await GuildCrestEmblem.findOne({ id: guildData.crest.emblem.id });
      if (cachedEmblem) {
        emblemImageName = cachedEmblem.imageName;
      } else {
        emblemImageName = await this.fetchMissingCrestComponent("emblem", guildData.crest.emblem.id);
      }

      // Get border image name (check cache or fetch if missing)
      let borderImageName: string | null = null;
      const cachedBorder = await GuildCrestBorder.findOne({ id: guildData.crest.border.id });
      if (cachedBorder) {
        borderImageName = cachedBorder.imageName;
      } else {
        borderImageName = await this.fetchMissingCrestComponent("border", guildData.crest.border.id);
      }

      if (!emblemImageName || !borderImageName) {
        logger.error(`⚠️  Failed to get crest images for guild ${guildName}`);
        return null;
      }

      return {
        crest: {
          emblem: {
            id: guildData.crest.emblem.id,
            imageName: emblemImageName,
            color: guildData.crest.emblem.color.rgba,
          },
          border: {
            id: guildData.crest.border.id,
            imageName: borderImageName,
            color: guildData.crest.border.color.rgba,
          },
          background: {
            color: guildData.crest.background.color.rgba,
          },
        },
        faction: guildData.faction.type,
      };
    } catch (error: any) {
      logger.error(`Error fetching guild data for ${guildName} - ${realmSlug}:`, error.message);
      return null;
    }
  }
}

export default new BlizzardApiClient();
