import fetch from "node-fetch";
import logger from "../utils/logger";
import { GUILDS_DEV, GUILDS_PROD, TrackedGuild } from "../config/guilds";
import rateLimitService, { WCLRateLimitData } from "./rate-limit.service";
import wclUserAuthService from "./warcraftlogs-user-auth.service";
import { resolveSpecByBlizzardSpecId, slugifySpecName } from "../utils/spec";

interface WCLAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

type FightDetailFetchOptions = {
  forceUserEndpoint?: boolean;
  includeCombatantInfo?: boolean;
  includeDeathEvents?: boolean;
};

type WclQueryTrackingOptions = {
  estimatedPoints?: number;
  sampleRateLimit?: boolean;
};

export type FightRosterParticipant = {
  name: string;
  server: string;
  specID: number | null;
  specName: string | null;
  role: "dps" | "healer" | "tank" | null;
  source: "combatant_info" | "player_details";
};

export type FightRosterResult = {
  participants: FightRosterParticipant[];
  status: "fetched" | "partial" | "failed";
  source: "combatant_info" | "player_details" | "mixed" | null;
  rosterComplete: boolean;
  knownSpecCount: number;
  error?: string;
};

type PlayerDetailsCount = {
  name: string;
  server: string;
  role: "dps" | "healer" | "tank";
  specName: string;
  count: number;
};

type PlayerDetailsFightResult = {
  participants: FightRosterParticipant[];
  error?: string;
};

export type ReportRankingCharacter = {
  name: string;
  className: string;
  specName?: string;
  specNames: string[];
  server: {
    name: string;
    region: string;
  };
  fightIds: number[];
};

class WarcraftLogsService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private zonesCache: any = null;
  private zonesCacheTime: number = 0;
  private readonly ZONES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Minimum delay between requests to avoid bursting
  private readonly REQUEST_DELAY_MS = 100;
  private readonly NETWORK_RETRY_ATTEMPTS = 3;
  private readonly NETWORK_RETRY_BASE_DELAY_MS = 1000;
  private readonly FIGHT_DETAILS_FIGHT_ID_BATCH_SIZE = 100;
  private readonly PLAYER_DETAILS_FIGHT_ID_BATCH_SIZE = 20;
  private rateLimitProbe: Promise<void> | null = null;
  private lastRateLimitProbeAttemptAt = 0;

  private async authenticate(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    logger.info("Authenticating with Warcraft Logs API...");

    const clientId = process.env.WCL_CLIENT_ID;
    const clientSecret = process.env.WCL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("WCL credentials not configured");
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    logger.info(`[API REQUEST] POST https://www.warcraftlogs.com/oauth/token`);
    const response = await this.fetchWithNetworkRetry("https://www.warcraftlogs.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }, "authentication");

    if (!response.ok) {
      throw new Error(`WCL authentication failed: ${response.statusText}`);
    }

    const data = (await response.json()) as WCLAuthResponse;

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000 - 60000; // Refresh 1 min early

    logger.info("WCL authenticated successfully");

    return this.accessToken;
  }

  /**
   * Add a small delay between requests to avoid bursting.
   * Rate limit tracking is now handled globally by rateLimitService.
   */
  private async requestDelay(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.REQUEST_DELAY_MS));
  }

  /**
   * Update the global rate limit service with data from API response
   */
  private async updateRateLimitFromResponse(rateLimitData: WCLRateLimitData | undefined): Promise<void> {
    if (rateLimitData) {
      await rateLimitService.updateFromResponse(rateLimitData);
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message || error.name;
    }

    return String(error);
  }

  private isRetryableNetworkError(error: unknown): boolean {
    const candidate = error as { code?: unknown; cause?: { code?: unknown }; name?: unknown; message?: unknown };
    const code = typeof candidate?.code === "string" ? candidate.code : typeof candidate?.cause?.code === "string" ? candidate.cause.code : undefined;

    if (
      code &&
      ["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "EPIPE", "ERR_SOCKET_CONNECTION_TIMEOUT"].includes(code)
    ) {
      return true;
    }

    if (candidate?.name === "FetchError" || candidate?.name === "AbortError") {
      return true;
    }

    return /request to .* failed|network timeout|socket hang up|client network socket disconnected|tls/i.test(String(candidate?.message || ""));
  }

  private async fetchWithNetworkRetry(url: string, options: Parameters<typeof fetch>[1], context: string): ReturnType<typeof fetch> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.NETWORK_RETRY_ATTEMPTS) {
      try {
        return await fetch(url, options);
      } catch (error) {
        lastError = error;

        if (!this.isRetryableNetworkError(error) || attempt === this.NETWORK_RETRY_ATTEMPTS) {
          break;
        }

        const waitTime = this.NETWORK_RETRY_BASE_DELAY_MS * 2 ** attempt;
        const retriesLeft = this.NETWORK_RETRY_ATTEMPTS - attempt;
        logger.warn(`WCL ${context} network request failed: ${this.formatError(error)}; retrying in ${waitTime}ms (${retriesLeft} retries left)`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        attempt++;
      }
    }

    if (this.isRetryableNetworkError(lastError)) {
      throw new Error(`WCL ${context} network request failed after ${this.NETWORK_RETRY_ATTEMPTS + 1} attempts: ${this.formatError(lastError)}`);
    }

    throw lastError instanceof Error ? lastError : new Error(this.formatError(lastError));
  }

  getPrimaryGuildInfo(character: any): {
    guildName: string | null;
    guildRealm: string | null;
  } {
    const primaryGuild = character?.guilds?.[0];

    if (!primaryGuild?.name || !primaryGuild?.server?.slug) {
      return { guildName: null, guildRealm: null };
    }

    return {
      guildName: primaryGuild.name,
      guildRealm: primaryGuild.server.slug,
    };
  }

  async query<T>(
    query: string,
    variables?: any,
    retryOnGatewayTimeout: boolean = false,
    serverErrorRetries: number = 0,
    tracking: WclQueryTrackingOptions = {},
  ): Promise<T> {
    return this.queryEndpoint<T>("client", query, variables, retryOnGatewayTimeout, serverErrorRetries, tracking);
  }

  async queryUser<T>(
    query: string,
    variables?: any,
    retryOnGatewayTimeout: boolean = false,
    serverErrorRetries: number = 0,
    tracking: WclQueryTrackingOptions = {},
  ): Promise<T> {
    return this.queryEndpoint<T>("user", query, variables, retryOnGatewayTimeout, serverErrorRetries, tracking);
  }

  async hasUserAuthConnected(): Promise<boolean> {
    return wclUserAuthService.hasConnectedUser();
  }

  private async queryEndpoint<T>(
    endpoint: "client" | "user",
    query: string,
    variables?: any,
    retryOnGatewayTimeout: boolean = false,
    serverErrorRetries: number = 0,
    tracking: WclQueryTrackingOptions = {},
  ): Promise<T> {
    // Add delay between requests to avoid bursting
    await this.requestDelay();

    const token = endpoint === "client" ? await this.authenticate() : await wclUserAuthService.getAccessToken();

    const response = await this.fetchWithNetworkRetry(`https://www.warcraftlogs.com/api/v2/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    }, `${endpoint} API`);

    // Handle rate limiting with retry
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default to 60s if not specified
      logger.warn(`⚠️  Rate limited by WCL API! Waiting ${Math.floor(waitTime / 1000)}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.queryEndpoint<T>(endpoint, query, variables, retryOnGatewayTimeout, serverErrorRetries, tracking); // Retry the request
    }

    // Handle gateway timeouts with infinite retry (only for initial fetch)
    if (retryOnGatewayTimeout && (response.status === 504 || response.statusText === "Gateway Time-out")) {
      logger.warn(`⚠️  Gateway timeout from WCL API! Retrying in 15 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait 15 seconds
      return this.queryEndpoint<T>(endpoint, query, variables, retryOnGatewayTimeout, serverErrorRetries, tracking); // Retry the request
    }

    if (response.status >= 500 && response.status < 600 && serverErrorRetries > 0) {
      const waitTime = (4 - serverErrorRetries) * 2000;
      logger.warn(`⚠️  WCL API ${response.status} ${response.statusText}; retrying in ${waitTime}ms (${serverErrorRetries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.queryEndpoint<T>(endpoint, query, variables, retryOnGatewayTimeout, serverErrorRetries - 1, tracking);
    }

    if (!response.ok) {
      throw new Error(`WCL API request failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as any;

    // Update global rate limit tracking from response
    if (result.data?.rateLimitData) {
      await this.updateRateLimitFromResponse(result.data.rateLimitData);
    } else if (tracking.estimatedPoints) {
      await rateLimitService.recordEstimatedUsage(tracking.estimatedPoints);
    }

    if (result.errors) {
      throw new Error(`WCL GraphQL error: ${JSON.stringify(result.errors)}`);
    }

    if (tracking.sampleRateLimit && rateLimitService.shouldProbeApiState()) {
      await this.maybeProbeRateLimit(endpoint);
    }

    return result.data as T;
  }

  private async maybeProbeRateLimit(endpoint: "client" | "user"): Promise<void> {
    if (this.rateLimitProbe) return this.rateLimitProbe;
    if (Date.now() - this.lastRateLimitProbeAttemptAt < 30_000) return;

    this.lastRateLimitProbeAttemptAt = Date.now();
    this.rateLimitProbe = this.probeRateLimit(endpoint).finally(() => {
      this.rateLimitProbe = null;
    });
    return this.rateLimitProbe;
  }

  private async probeRateLimit(endpoint: "client" | "user"): Promise<void> {
    try {
      await this.requestDelay();
      const token = endpoint === "client" ? await this.authenticate() : await wclUserAuthService.getAccessToken();
      const query = `
        query {
          rateLimitData {
            limitPerHour
            pointsSpentThisHour
            pointsResetIn
          }
        }
      `;
      const response = await this.fetchWithNetworkRetry(`https://www.warcraftlogs.com/api/v2/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }, `${endpoint} rate-limit probe`);
      if (!response.ok) {
        logger.warn(`[RateLimit] WCL probe failed: ${response.status} ${response.statusText}`);
        return;
      }

      const result = (await response.json()) as { data?: { rateLimitData?: WCLRateLimitData }; errors?: unknown };
      if (result.errors || !result.data?.rateLimitData) {
        logger.warn(`[RateLimit] WCL probe returned no usable rate-limit data`);
        return;
      }

      // A standalone rateLimitData resolver can report the value immediately
      // before its own one-point charge, so keep tracking conservative.
      await this.updateRateLimitFromResponse({
        ...result.data.rateLimitData,
        pointsSpentThisHour: result.data.rateLimitData.pointsSpentThisHour + 1,
      });
    } catch (error) {
      logger.warn(`[RateLimit] WCL probe failed; retaining conservative local estimate: ${this.formatError(error)}`);
    }
  }

  private shouldRetryReportWithUserEndpoint(error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return (
      (errorMessage.includes("This report has been archived") && errorMessage.includes("/user API endpoint")) ||
      errorMessage.includes("You do not have permission to view this report")
    );
  }

  // Get guild reports without zone filter to see all available reports
  async getGuildReportsAll(guildName: string, serverSlug: string, serverRegion: string, limit: number = 10) {
    logger.info(`[API REQUEST] WarcraftLogsService.getGuildReportsAll - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug})`);
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!, $limit: Int!) {
        reportData {
          reports(guildName: $guildName, guildServerSlug: $serverSlug, guildServerRegion: $serverRegion, limit: $limit) {
            data {
              code
              title
              startTime
              endTime
              zone {
                id
                name
              }
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
      limit,
    };

    return this.query<any>(query, variables);
  }

  // Get guild reports with full fight data - NO zone filter (for initial fetch)
  // This fetches all reports across all content (raids, dungeons, etc.)
  async getGuildReportsWithFights(guildName: string, serverSlug: string, serverRegion: string, limit: number = 10, page: number = 1, retryOnGatewayTimeout: boolean = false) {
    logger.info(`[API REQUEST] WarcraftLogsService.getGuildReportsWithFights - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug}, page: ${page})`);
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!, $limit: Int!, $page: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        guildData {
          guild(name: $guildName, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            faction {
              name
            }
          }
        }
        reportData {
          reports(guildName: $guildName, guildServerSlug: $serverSlug, guildServerRegion: $serverRegion, limit: $limit, page: $page) {
            data {
              code
              startTime
              endTime
              zone {
                id
                name
              }
              phases {
                encounterID
                separatesWipes
                phases {
                  id
                  name
                  isIntermission
                }
              }
              fights(killType: Encounters) {
                id
                encounterID
                name
                difficulty
                kill
                bossPercentage
                fightPercentage
                startTime
                endTime
                phaseTransitions {
                  id
                  startTime
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
      limit,
      page,
    };

    return this.query<any>(query, variables, retryOnGatewayTimeout);
  }

  // Lightweight check for new reports - only fetches codes and timestamps, no fights data
  // This is much cheaper (uses fewer points) than fetching full report data
  async checkForNewReports(guildName: string, serverSlug: string, serverRegion: string, zoneId: number, limit: number = 5) {
    logger.info(`[API REQUEST] WarcraftLogsService.checkForNewReports - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug}, zone: ${zoneId})`);
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!, $zoneId: Int!, $limit: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        reportData {
          reports(guildName: $guildName, guildServerSlug: $serverSlug, guildServerRegion: $serverRegion, zoneID: $zoneId, limit: $limit) {
            data {
              code
              startTime
              endTime
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
      zoneId,
      limit,
    };

    return this.query<any>(query, variables);
  }

  // Get recent reports for a guild WITHOUT filtering by zone
  // This ensures we catch all reports even if WCL tags them with a different zone
  async getRecentReports(guildName: string, serverSlug: string, serverRegion: string, limit: number = 3) {
    logger.info(`[API REQUEST] WarcraftLogsService.getRecentReports - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug})`);
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!, $limit: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        reportData {
          reports(guildName: $guildName, guildServerSlug: $serverSlug, guildServerRegion: $serverRegion, limit: $limit) {
            data {
              code
              startTime
              endTime
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
      limit,
    };

    return this.query<any>(query, variables);
  }

  // Get a single report by code with all fight details
  async getReportByCode(reportCode: string, difficultyId: number) {
    logger.info(`[API REQUEST] WarcraftLogsService.getReportByCode - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode})`);
    const query = `
      query($reportCode: String!, $difficulty: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        reportData {
          report(code: $reportCode) {
            code
            startTime
            endTime
            fights(difficulty: $difficulty, killType: Encounters) {
              id
              encounterID
              name
              kill
              bossPercentage
              fightPercentage
              startTime
              endTime
            }
          }
        }
      }
    `;

    const variables = {
      reportCode,
      difficulty: difficultyId,
    };

    return this.query<any>(query, variables);
  }

  // Get a single report by code with fights - ALL difficulties (not filtered)
  async getReportByCodeAllDifficulties(
    reportCode: string,
    options: { includeRankedCharacters?: boolean; includeRankings?: boolean; rankingsDifficulty?: number; forceUserEndpoint?: boolean } = {},
  ) {
    const rateLimitField = options.includeRankings ? "" : `
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
    `;
    const query = `
      query($reportCode: String!, $includeRankedCharacters: Boolean!, $includeRankings: Boolean!, $rankingsDifficulty: Int!) {
        ${rateLimitField}
        reportData {
          report(code: $reportCode) {
            code
            startTime
            endTime
            masterData @include(if: $includeRankedCharacters) {
              actors(type: "Player") {
                id
                name
                server
                subType
              }
            }
            rankedCharacters @include(if: $includeRankedCharacters) {
              canonicalID
              name
              classID
              hidden
              server {
                slug
                region {
                  slug
                }
              }
              guilds {
                name
                server {
                  slug
                  region {
                    slug
                  }
                }
              }
            }
            rankings(compare: Rankings, timeframe: Historical, difficulty: $rankingsDifficulty) @include(if: $includeRankings)
            phases {
              encounterID
              separatesWipes
              phases {
                id
                name
                isIntermission
              }
            }
            fights(killType: Encounters) {
              id
              encounterID
              name
              difficulty
              kill
              bossPercentage
              fightPercentage
              startTime
              endTime
              phaseTransitions {
                id
                startTime
              }
            }
          }
        }
      }
    `;

    const variables = {
      reportCode,
      includeRankedCharacters: options.includeRankedCharacters === true,
      includeRankings: options.includeRankings === true,
      rankingsDifficulty: options.rankingsDifficulty ?? 5,
    };
    const tracking = options.includeRankings ? { estimatedPoints: 5, sampleRateLimit: true } : {};

    if (options.forceUserEndpoint) {
      logger.info(`[API REQUEST] WarcraftLogsService.getReportByCodeAllDifficulties - POST https://www.warcraftlogs.com/api/v2/user (forced, report: ${reportCode})`);
      return this.queryUser<any>(query, variables, false, 0, tracking);
    }

    try {
      logger.info(`[API REQUEST] WarcraftLogsService.getReportByCodeAllDifficulties - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode})`);
      return await this.query<any>(query, variables, false, 0, tracking);
    } catch (error) {
      if (!this.shouldRetryReportWithUserEndpoint(error)) {
        throw error;
      }

      if (!(await this.hasUserAuthConnected())) {
        throw error;
      }

      try {
        logger.info(`[API REQUEST] WarcraftLogsService.getReportByCodeAllDifficulties - POST https://www.warcraftlogs.com/api/v2/user (user-auth retry, report: ${reportCode})`);
        return await this.queryUser<any>(query, variables, false, 0, tracking);
      } catch (userError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const userMessage = userError instanceof Error ? userError.message : String(userError);
        throw new Error(`${originalMessage}; WCL /user retry failed: ${userMessage}`);
      }
    }
  }

  async getReportRankingsCharacters(reportCode: string, difficulty = 5): Promise<ReportRankingCharacter[]> {
    logger.info(`[API REQUEST] WarcraftLogsService.getReportRankingsCharacters - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode}, difficulty: ${difficulty})`);
    const query = `
      query($reportCode: String!, $difficulty: Int!) {
        reportData {
          report(code: $reportCode) {
            rankings(compare: Rankings, timeframe: Historical, difficulty: $difficulty)
          }
        }
      }
    `;

    const result = await this.query<any>(query, { reportCode, difficulty }, false, 2, { estimatedPoints: 5, sampleRateLimit: true });
    return this.parseReportRankingsCharacters(result?.reportData?.report?.rankings);
  }

  parseReportRankingsCharacters(rankings: any): ReportRankingCharacter[] {
    const rankingRows = Array.isArray(rankings?.data) ? rankings.data : [];
    const getStringValue = (value: any): string | undefined => {
      if (typeof value === "string") return value;
      if (typeof value?.slug === "string") return value.slug;
      if (typeof value?.name === "string") return value.name;
      return undefined;
    };
    const charactersByKey = new Map<
      string,
      {
        name: string;
        className: string;
        specName?: string;
        specNames: Set<string>;
        server: {
          name: string;
          region: string;
        };
        fightIds: Set<number>;
      }
    >();

    for (const row of rankingRows) {
      const fightId = typeof row?.fightID === "number" ? row.fightID : undefined;
      const roleGroups = row?.roles && typeof row.roles === "object" ? Object.values(row.roles) : [];

      for (const roleGroup of roleGroups as any[]) {
        const roleCharacters = Array.isArray(roleGroup?.characters) ? roleGroup.characters : [];

        for (const character of roleCharacters) {
          const name = getStringValue(character?.name);
          const className = getStringValue(character?.class ?? character?.className);
          const specName = getStringValue(character?.spec);
          const serverName = getStringValue(character?.server?.name);
          const serverRegion = getStringValue(character?.server?.region);

          if (!name || !className || !serverName || !serverRegion) continue;

          const key = `${String(serverRegion).toLowerCase()}:${String(serverName).toLowerCase()}:${String(name).toLowerCase()}:${String(className).toLowerCase()}`;
          const existing = charactersByKey.get(key);
          if (existing) {
            if (fightId !== undefined) existing.fightIds.add(fightId);
            if (specName) existing.specNames.add(specName);
            continue;
          }

          charactersByKey.set(key, {
            name,
            className,
            specName,
            specNames: new Set(specName ? [specName] : []),
            server: {
              name: serverName,
              region: serverRegion,
            },
            fightIds: new Set(fightId !== undefined ? [fightId] : []),
          });
        }
      }
    }

    return Array.from(charactersByKey.values()).map((character) => ({
      ...character,
      specNames: Array.from(character.specNames).sort(),
      fightIds: Array.from(character.fightIds).sort((a, b) => a - b),
    }));
  }

  // Get guild info and recent reports for a specific raid - ALL difficulties (not filtered)
  // Note: Limit kept low (10) to avoid WCL query complexity limits when fetching phase data
  async getGuildReportsAllDifficulties(guildName: string, serverSlug: string, serverRegion: string, zoneId: number, limit: number = 10, page: number = 1) {
    logger.info(
      `[API REQUEST] WarcraftLogsService.getGuildReportsAllDifficulties - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug}, zone: ${zoneId}, page: ${page})`,
    );
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!, $zoneId: Int!, $limit: Int!, $page: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        guildData {
          guild(name: $guildName, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            faction {
              name
            }
          }
        }
        reportData {
          reports(guildName: $guildName, guildServerSlug: $serverSlug, guildServerRegion: $serverRegion, zoneID: $zoneId, limit: $limit, page: $page) {
            data {
              code
              startTime
              endTime
              phases {
                encounterID
                separatesWipes
                phases {
                  id
                  name
                  isIntermission
                }
              }
              fights(killType: Encounters) {
                id
                encounterID
                name
                difficulty
                kill
                bossPercentage
                fightPercentage
                startTime
                endTime
                phaseTransitions {
                  id
                  startTime
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
      zoneId,
      limit,
      page,
    };

    return this.query<any>(query, variables);
  }

  // Get zone (raid) information - with caching
  async getGuildReports(guildName: string, serverSlug: string, serverRegion: string, zoneId: number, difficultyId: number, limit: number = 50, page: number = 1) {
    logger.info(
      `[API REQUEST] WarcraftLogsService.getGuildReports - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug}, zone: ${zoneId}, page: ${page})`,
    );
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!, $zoneId: Int!, $limit: Int!, $difficulty: Int!, $page: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        guildData {
          guild(name: $guildName, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            faction {
              name
            }
          }
        }
        reportData {
          reports(guildName: $guildName, guildServerSlug: $serverSlug, guildServerRegion: $serverRegion, zoneID: $zoneId, limit: $limit, page: $page) {
            data {
              code
              startTime
              endTime
              fights(difficulty: $difficulty, killType: Encounters) {
                id
                encounterID
                name
                kill
                bossPercentage
                fightPercentage
                startTime
                endTime
              }
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
      zoneId,
      limit,
      difficulty: difficultyId,
      page,
    };

    return this.query<any>(query, variables);
  }

  // Get zone (raid) information with encounters - NOT using cache since encounters needed
  async getZone(zoneId: number) {
    // Don't use cache here because we need detailed encounter data
    // The getZones() cache only has id and name, not encounters

    logger.info(`[API REQUEST] WarcraftLogsService.getZone - POST https://www.warcraftlogs.com/api/v2/client (zone: ${zoneId})`);
    // Fetch fresh data with encounters
    const query = `
      query($zoneId: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        worldData {
          zone(id: $zoneId) {
            id
            name
            expansion {
              id
              name
            }
            encounters {
              id
              name
            }
            partitions {
              id
              name
            }
          }
        }
      }
    `;

    return this.query<any>(query, { zoneId });
  }

  // Get all available zones - with caching
  async getZones() {
    // Check cache first
    const now = Date.now();
    if (this.zonesCache && now - this.zonesCacheTime < this.ZONES_CACHE_TTL) {
      logger.info("Using cached zones data");
      return { worldData: { zones: this.zonesCache } };
    }

    logger.info("Fetching fresh zones data...");
    logger.info(`[API REQUEST] WarcraftLogsService.getZones - POST https://www.warcraftlogs.com/api/v2/client`);
    const query = `
      query {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        worldData {
          zones {
            id
            name
          }
        }
      }
    `;

    const result = await this.query<any>(query);

    // Cache the zones data
    if (result.worldData?.zones) {
      this.zonesCache = result.worldData.zones;
      this.zonesCacheTime = now;
      logger.info(`Cached ${this.zonesCache.length} zones`);
    }

    return result;
  }

  /**
   * Determines which phase a fight ended in and creates display string
   */
  determinePhaseInfo(
    fight: any,
    encounterPhases: any[],
  ): {
    lastPhase?: { phaseId: number; phaseName: string; isIntermission: boolean };
    allPhases: Array<{
      phaseId: number;
      phaseName: string;
      isIntermission: boolean;
    }>;
    progressDisplay: string;
  } {
    const result: {
      lastPhase?: {
        phaseId: number;
        phaseName: string;
        isIntermission: boolean;
      };
      allPhases: Array<{
        phaseId: number;
        phaseName: string;
        isIntermission: boolean;
      }>;
      progressDisplay: string;
    } = {
      allPhases: [],
      progressDisplay: "",
    };

    // Find phase metadata for this encounter
    const encounterMeta = encounterPhases?.find((ep: any) => ep.encounterID === fight.encounterID);

    if (!encounterMeta?.phases || encounterMeta.phases.length === 0) {
      // No phase data available, use simple display
      if (fight.bossPercentage !== undefined && fight.bossPercentage !== null) {
        result.progressDisplay = `${fight.bossPercentage.toFixed(1)}%`;
      } else if (fight.fightPercentage !== undefined) {
        result.progressDisplay = `${fight.fightPercentage.toFixed(1)}% overall`;
      }
      return result;
    }

    // Build phase map for lookup
    const phaseMap = new Map<number, { phaseId: number; phaseName: string; isIntermission: boolean }>();
    encounterMeta.phases.forEach((p: any) => {
      phaseMap.set(p.id, {
        phaseId: p.id,
        phaseName: p.name,
        isIntermission: p.isIntermission || false,
      });
    });

    // Determine which phases occurred
    if (fight.phaseTransitions && fight.phaseTransitions.length > 0) {
      // Sort transitions by time
      const transitions = [...fight.phaseTransitions].sort((a: any, b: any) => a.startTime - b.startTime);

      // Build all phases that occurred
      transitions.forEach((trans: any) => {
        const phaseInfo = phaseMap.get(trans.id);
        if (phaseInfo) {
          result.allPhases.push(phaseInfo);
        }
      });

      // Last phase is the one active at fight end
      const lastTransition = transitions[transitions.length - 1];
      result.lastPhase = phaseMap.get(lastTransition.id);
    } else {
      // No transitions recorded, assume Phase 1
      result.lastPhase = phaseMap.get(1) || {
        phaseId: 1,
        phaseName: "Phase 1",
        isIntermission: false,
      };
      result.allPhases.push(result.lastPhase);
    }

    // Create display string
    const bossHealth = fight.bossPercentage?.toFixed(1) || "?";
    const phaseName = result.lastPhase?.phaseName || "Unknown";

    // Format phase name for display (shorten if needed)
    let phaseDisplay = phaseName;
    if (phaseName.toLowerCase().includes("phase")) {
      // "Phase 3" -> "P3"
      phaseDisplay = phaseName.replace(/phase\s*/i, "P");
    } else if (phaseName.toLowerCase().includes("intermission")) {
      // "Intermission 1" -> "I1", "Intermission One" -> "I1", etc.
      const wordToNumber: { [key: string]: string } = {
        one: "1",
        two: "2",
        three: "3",
      };
      const match = phaseName.match(/intermission\s*(\d+|one|two|three)/i);
      if (match) {
        let num = match[1];
        if (isNaN(Number(num))) {
          num = wordToNumber[num.toLowerCase()] || "1";
        }
        phaseDisplay = `I${num}`;
      } else {
        phaseDisplay = "I1";
      }
    }

    result.progressDisplay = `${bossHealth}% ${phaseDisplay}`;

    return result;
  }

  /**
   * Fetch guild zone rankings for a specific zone
   * Returns world progress ranking (always uses highest difficulty - Mythic)
   */
  async getGuildZoneRanking(guildName: string, serverSlug: string, serverRegion: string, zoneId: number) {
    logger.info(`[API REQUEST] WarcraftLogsService.getGuildZoneRanking - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug}, zone: ${zoneId})`);
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!, $zoneId: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        guildData {
          guild(name: $guildName, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            name
            id
            zoneRanking(zoneId: $zoneId) {
              progress {
                worldRank {
                  number
                  color
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
      zoneId,
    };

    return this.query<any>(query, variables);
  }

  /** Fetch the report-level ranked character list used for discovery. */
  async getReportCharacters(reportCode: string) {
    const query = `
      query($reportCode: String!) {
        reportData {
          report(code: $reportCode) {
            rankedCharacters {
              canonicalID
              name
              classID
              hidden
              server {
                slug
                region {
                  slug
                }
              }
              guilds {
                name
                server {
                  slug
                  region {
                    slug
                  }
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      reportCode,
    };

    const result = await this.query<any>(query, variables, false, 2, { estimatedPoints: 2, sampleRateLimit: true });

    // Get tracked guilds based on environment
    const trackedGuilds = process.env.NODE_ENV === "production" ? GUILDS_PROD : GUILDS_DEV;

    // Filter rankedCharacters to only include those in tracked guilds
    if (result?.reportData?.report?.rankedCharacters) {
      result.reportData.report.rankedCharacters = result.reportData.report.rankedCharacters.filter((character: any) => {
        // Check if the character belongs to any tracked guild or parent guild of tracked teams
        return character.guilds?.some((guild: any) => {
          return trackedGuilds.some((trackedGuild: TrackedGuild) => {
            // Check direct guild match
            const directMatch =
              guild.name.toLowerCase() === trackedGuild.name.toLowerCase() &&
              guild.server.slug.toLowerCase() === trackedGuild.realm.toLowerCase() &&
              guild.server.region.slug.toLowerCase() === trackedGuild.region.toLowerCase();

            // Check if character's guild is the parent guild of a tracked team
            const parentMatch =
              trackedGuild.parent_guild &&
              guild.name.toLowerCase() === trackedGuild.parent_guild.toLowerCase() &&
              guild.server.slug.toLowerCase() === trackedGuild.realm.toLowerCase() &&
              guild.server.region.slug.toLowerCase() === trackedGuild.region.toLowerCase();

            return directMatch || parentMatch;
          });
        });
      });
    }

    return result;
  }

  async getFightCharacters(reportCode: string, _fightId: number) {
    return this.getReportCharacters(reportCode);
  }

  /**
   * Fetch guild details including WarcraftLogs guild ID
   * This should only be called once during initial fetch
   */
  async getGuildDetails(guildName: string, serverSlug: string, serverRegion: string) {
    logger.info(`[API REQUEST] WarcraftLogsService.getGuildDetails - POST https://www.warcraftlogs.com/api/v2/client (guild: ${guildName}-${serverSlug})`);
    const query = `
      query($guildName: String!, $serverSlug: String!, $serverRegion: String!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        guildData {
          guild(name: $guildName, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            id
            name
            faction {
              name
            }
          }
        }
      }
    `;

    const variables = {
      guildName,
      serverSlug,
      serverRegion,
    };

    return this.query<any>(query, variables);
  }

  /**
   * Fetch death events for a specific fight
   * Returns all player deaths with character name, server, and timestamps
   */
  async getDeathEventsForFight(reportCode: string, fightId: number) {
    // Use maximum API limit to fetch all deaths
    const queryLimit = 10000;

    logger.info(`[API REQUEST] WarcraftLogsService.getDeathEventsForFight - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode}, fight: ${fightId})`);
    const query = `
      query($reportCode: String!, $fightIds: [Int]!, $limit: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        reportData {
          report(code: $reportCode) {
            code
            startTime
            masterData {
              actors(type: "Player") {
                id
                name
                server
              }
            }
            events(
              fightIDs: $fightIds,
              dataType: Deaths,
              hostilityType: Friendlies,
              limit: $limit
            ) {
              data
            }
          }
        }
      }
    `;

    const variables = {
      reportCode,
      fightIds: [fightId],
      limit: queryLimit,
    };

    return this.query<any>(query, variables);
  }

  /**
   * Fetch death events for multiple fights in a report (more efficient)
   * Returns all deaths grouped by fight ID
   */
  async getDeathEventsForReport(
    reportCode: string,
    fightIds: number[],
    options: FightDetailFetchOptions = {},
  ) {
    const uniqueFightIds = Array.from(new Set(fightIds));
    if (uniqueFightIds.length === 0) {
      throw new Error(`Cannot fetch fight details for WCL report ${reportCode} without fight IDs`);
    }

    const responses: any[] = [];
    for (let index = 0; index < uniqueFightIds.length; index += this.FIGHT_DETAILS_FIGHT_ID_BATCH_SIZE) {
      const batch = uniqueFightIds.slice(index, index + this.FIGHT_DETAILS_FIGHT_ID_BATCH_SIZE);
      responses.push(await this.getDeathEventsForReportBatch(reportCode, batch, options));
    }

    const response = this.mergeFightDetailResponses(responses, options);
    if (options.includeCombatantInfo) {
      await this.attachFightRosters(reportCode, uniqueFightIds, response, options);
    }
    return response;
  }

  private async attachFightRosters(
    reportCode: string,
    fightIds: number[],
    response: any,
    options: FightDetailFetchOptions,
  ): Promise<void> {
    const report = response?.reportData?.report;
    if (!report) return;

    const rawRosters = this.parseRawCombatantInfoByFight(report, report.masterData?.actors ?? []);
    const rosters: Record<string, FightRosterResult> = {};
    const fallbackFightIds = fightIds.filter((fightId) => {
      const participants = rawRosters.get(fightId) ?? [];
      return participants.length === 0 || participants.some((participant) => !participant.specName);
    });
    const fallbackByFight = await this.getPlayerDetailsRostersForFights(
      reportCode,
      fallbackFightIds,
      options.forceUserEndpoint === true,
    );

    for (const fightId of fightIds) {
      const rawParticipants = rawRosters.get(fightId) ?? [];
      const rawNeedsFallback = rawParticipants.length === 0 || rawParticipants.some((participant) => !participant.specName);
      const fallbackResult = rawNeedsFallback ? fallbackByFight.get(fightId) : undefined;
      const fallbackParticipants = fallbackResult?.participants ?? [];
      const fallbackError = fallbackResult?.error;

      const participants = this.mergeFightRosterParticipants(rawParticipants, fallbackParticipants);
      const knownSpecCount = participants.filter((participant) => Boolean(participant.specName)).length;
      const rosterComplete = participants.length > 0;
      const source = rawParticipants.length > 0 && fallbackParticipants.length > 0
        ? "mixed"
        : fallbackParticipants.length > 0
          ? "player_details"
          : rawParticipants.length > 0
            ? "combatant_info"
            : null;

      rosters[String(fightId)] = {
        participants,
        status: !rosterComplete ? "failed" : knownSpecCount === participants.length ? "fetched" : "partial",
        source,
        rosterComplete,
        knownSpecCount,
        ...(fallbackError && !rosterComplete ? { error: fallbackError } : {}),
      };
    }

    report.fightRosters = rosters;
  }

  private async getPlayerDetailsRostersForFights(
    reportCode: string,
    fightIds: number[],
    forceUserEndpoint: boolean,
  ): Promise<Map<number, PlayerDetailsFightResult>> {
    const results = new Map<number, PlayerDetailsFightResult>();

    for (let index = 0; index < fightIds.length; index += this.PLAYER_DETAILS_FIGHT_ID_BATCH_SIZE) {
      const chunk = fightIds.slice(index, index + this.PLAYER_DETAILS_FIGHT_ID_BATCH_SIZE);
      if (chunk.length === 1) {
        await this.fetchSinglePlayerDetailsRoster(reportCode, chunk[0], forceUserEndpoint, results);
        continue;
      }

      let groupedResponse: any;
      try {
        groupedResponse = await this.getPlayerDetailsForFights(reportCode, chunk, forceUserEndpoint);
      } catch (error) {
        logger.warn(`[FightRoster] grouped playerDetails fallback failed for report ${reportCode}, ${chunk.length} fights: ${this.formatError(error)}`);
        for (const fightId of chunk) {
          await this.fetchSinglePlayerDetailsRoster(reportCode, fightId, forceUserEndpoint, results);
        }
        continue;
      }

      const groupedCounts = this.parsePlayerDetailsCounts(groupedResponse);
      const stableRoster = this.playerDetailsCountsToRoster(groupedCounts, chunk.length);
      if (stableRoster) {
        for (const fightId of chunk) results.set(fightId, { participants: stableRoster.map((participant) => ({ ...participant })) });
        continue;
      }

      const individualCounts: PlayerDetailsCount[][] = [];
      let allIndividualsSucceeded = true;
      for (const fightId of chunk.slice(0, -1)) {
        try {
          const response = await this.getPlayerDetailsForFights(reportCode, [fightId], forceUserEndpoint);
          const participants = this.parsePlayerDetailsRoster(response);
          const counts = this.parsePlayerDetailsCounts(response);
          individualCounts.push(counts);
          results.set(fightId, { participants });
        } catch (error) {
          allIndividualsSucceeded = false;
          const message = this.formatError(error);
          results.set(fightId, { participants: [], error: message });
          logger.warn(`[FightRoster] playerDetails fallback failed for report ${reportCode}, fight ${fightId}: ${message}`);
        }
      }

      const omittedFightId = chunk[chunk.length - 1];
      const derivedRoster = allIndividualsSucceeded
        ? this.derivePlayerDetailsRoster(groupedCounts, individualCounts)
        : null;
      if (derivedRoster) {
        results.set(omittedFightId, { participants: derivedRoster });
      } else {
        await this.fetchSinglePlayerDetailsRoster(reportCode, omittedFightId, forceUserEndpoint, results);
      }
    }

    return results;
  }

  private async fetchSinglePlayerDetailsRoster(
    reportCode: string,
    fightId: number,
    forceUserEndpoint: boolean,
    results: Map<number, PlayerDetailsFightResult>,
  ): Promise<void> {
    try {
      const response = await this.getPlayerDetailsForFights(reportCode, [fightId], forceUserEndpoint);
      results.set(fightId, { participants: this.parsePlayerDetailsRoster(response) });
    } catch (error) {
      const message = this.formatError(error);
      results.set(fightId, { participants: [], error: message });
      logger.warn(`[FightRoster] playerDetails fallback failed for report ${reportCode}, fight ${fightId}: ${message}`);
    }
  }

  private async getPlayerDetailsForFights(reportCode: string, fightIds: number[], forceUserEndpoint: boolean): Promise<any> {
    const query = `
      query($reportCode: String!, $fightIds: [Int]!) {
        reportData {
          report(code: $reportCode) {
            playerDetails(fightIDs: $fightIds)
          }
        }
      }
    `;
    const variables = { reportCode, fightIds };
    const tracking = { estimatedPoints: 2, sampleRateLimit: true };

    if (forceUserEndpoint) {
      logger.info(`[API REQUEST] WarcraftLogsService.getPlayerDetailsForFights - POST https://www.warcraftlogs.com/api/v2/user (forced, report: ${reportCode}, fights: ${fightIds.length})`);
      return this.queryUser<any>(query, variables, false, 0, tracking);
    }

    try {
      logger.info(`[API REQUEST] WarcraftLogsService.getPlayerDetailsForFights - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode}, fights: ${fightIds.length})`);
      return await this.query<any>(query, variables, false, 0, tracking);
    } catch (error) {
      if (!this.shouldRetryReportWithUserEndpoint(error) || !(await this.hasUserAuthConnected())) throw error;
      logger.info(`[API REQUEST] WarcraftLogsService.getPlayerDetailsForFights - POST https://www.warcraftlogs.com/api/v2/user (user-auth retry, report: ${reportCode}, fights: ${fightIds.length})`);
      return this.queryUser<any>(query, variables, false, 0, tracking);
    }
  }

  private async getDeathEventsForReportBatch(
    reportCode: string,
    fightIds: number[],
    options: FightDetailFetchOptions,
  ): Promise<any> {
    // Use maximum API limit to fetch all deaths
    const queryLimit = 10000;
    const combineDeathsAndCombatants = options.includeDeathEvents !== false && options.includeCombatantInfo === true;
    const estimatedPoints = combineDeathsAndCombatants ? 3 : 2;

    const query = `
      query($reportCode: String!, $fightIds: [Int]!, $limit: Int!) {
        reportData {
          report(code: $reportCode) {
            code
            startTime
            masterData {
              actors(type: "Player") {
                id
                name
                server
              }
            }
            ${combineDeathsAndCombatants ? `
            combinedFightEvents: events(
              fightIDs: $fightIds,
              dataType: All,
              hostilityType: Friendlies,
              filterExpression: "(type = \\\"death\\\" AND target.type = \\\"Player\\\") OR type = \\\"combatantinfo\\\"",
              limit: $limit
            ) {
              data
              nextPageTimestamp
            }
            ` : options.includeDeathEvents === false ? "" : `
            events(
              fightIDs: $fightIds,
              dataType: Deaths,
              hostilityType: Friendlies,
              limit: $limit
            ) {
              data
              nextPageTimestamp
            }
            `}
            ${options.includeCombatantInfo && !combineDeathsAndCombatants ? `
            combatantInfoEvents: events(
              fightIDs: $fightIds,
              dataType: CombatantInfo,
              hostilityType: Friendlies,
              limit: $limit
            ) {
              data
              nextPageTimestamp
            }
            ` : ""}
          }
        }
      }
    `;

    const variables = {
      reportCode,
      fightIds,
      limit: queryLimit,
    };

    if (options.forceUserEndpoint) {
      logger.info(`[API REQUEST] WarcraftLogsService.getDeathEventsForReport - POST https://www.warcraftlogs.com/api/v2/user (forced, report: ${reportCode}, ${fightIds.length} fights)`);
      const response = await this.queryUser<any>(query, variables, false, 0, { estimatedPoints, sampleRateLimit: true });
      this.normalizeCombinedFightDetailEvents(response, combineDeathsAndCombatants);
      return this.ensureCompleteFightDetailBatch(reportCode, fightIds, options, response);
    }

    try {
      logger.info(`[API REQUEST] WarcraftLogsService.getDeathEventsForReport - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode}, ${fightIds.length} fights)`);
      const response = await this.query<any>(query, variables, false, 0, { estimatedPoints, sampleRateLimit: true });
      this.normalizeCombinedFightDetailEvents(response, combineDeathsAndCombatants);
      return this.ensureCompleteFightDetailBatch(reportCode, fightIds, options, response);
    } catch (error) {
      if (!this.shouldRetryReportWithUserEndpoint(error)) {
        throw error;
      }

      if (!(await this.hasUserAuthConnected())) {
        throw error;
      }

      try {
        logger.info(`[API REQUEST] WarcraftLogsService.getDeathEventsForReport - POST https://www.warcraftlogs.com/api/v2/user (user-auth retry, report: ${reportCode}, ${fightIds.length} fights)`);
        const response = await this.queryUser<any>(query, variables, false, 0, { estimatedPoints, sampleRateLimit: true });
        this.normalizeCombinedFightDetailEvents(response, combineDeathsAndCombatants);
        return this.ensureCompleteFightDetailBatch(reportCode, fightIds, options, response);
      } catch (userError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const userMessage = userError instanceof Error ? userError.message : String(userError);
        throw new Error(`${originalMessage}; WCL /user retry failed: ${userMessage}`);
      }
    }
  }

  private normalizeCombinedFightDetailEvents(response: any, combined: boolean): void {
    if (!combined) return;
    const report = response?.reportData?.report;
    const combinedEvents = report?.combinedFightEvents;
    if (!combinedEvents) return;

    const events = Array.isArray(combinedEvents.data) ? combinedEvents.data : [];
    report.events = {
      data: events.filter((event: any) => event?.type === "death"),
      nextPageTimestamp: combinedEvents.nextPageTimestamp ?? null,
    };
    report.combatantInfoEvents = {
      data: events.filter((event: any) => event?.type === "combatantinfo"),
      nextPageTimestamp: combinedEvents.nextPageTimestamp ?? null,
    };
    delete report.combinedFightEvents;
  }

  private async ensureCompleteFightDetailBatch(
    reportCode: string,
    fightIds: number[],
    options: FightDetailFetchOptions,
    response: any,
  ): Promise<any> {
    const report = response?.reportData?.report;
    if (!report) return response;

    const deathsTruncated = options.includeDeathEvents !== false && report.events?.nextPageTimestamp != null;
    const combatantsTruncated = options.includeCombatantInfo && report.combatantInfoEvents?.nextPageTimestamp != null;
    if (!deathsTruncated && !combatantsTruncated) return response;

    if (fightIds.length === 1) {
      throw new Error(`WCL fight detail response exceeded 10,000 events for report ${reportCode}, fight ${fightIds[0]}`);
    }

    const midpoint = Math.ceil(fightIds.length / 2);
    logger.warn(
      `WCL fight detail response was truncated for report ${reportCode}; retrying ${fightIds.length} fights as smaller batches`,
    );
    const left = await this.getDeathEventsForReportBatch(reportCode, fightIds.slice(0, midpoint), options);
    const right = await this.getDeathEventsForReportBatch(reportCode, fightIds.slice(midpoint), options);
    return this.mergeFightDetailResponses([left, right], options);
  }

  private mergeFightDetailResponses(responses: any[], options: FightDetailFetchOptions): any {
    if (responses.length === 1) return responses[0];

    const reports = responses.map((response) => response?.reportData?.report);
    if (reports.some((report) => !report)) {
      throw new Error("WCL returned an incomplete report while fetching fight details in batches");
    }

    const firstResponse = responses[0];
    const lastResponse = responses[responses.length - 1];
    const firstReport = reports[0];
    const actorsById = new Map<number, any>();
    for (const report of reports) {
      for (const actor of report.masterData?.actors ?? []) {
        if (typeof actor?.id === "number") actorsById.set(actor.id, actor);
      }
    }

    const mergedReport: any = {
      ...firstReport,
      masterData: {
        ...firstReport.masterData,
        actors: Array.from(actorsById.values()),
      },
    };

    if (options.includeDeathEvents !== false) {
      mergedReport.events = {
        ...firstReport.events,
        data: reports.flatMap((report) => report.events?.data ?? []),
        nextPageTimestamp: null,
      };
    }

    if (options.includeCombatantInfo) {
      mergedReport.combatantInfoEvents = {
        ...firstReport.combatantInfoEvents,
        data: reports.flatMap((report) => report.combatantInfoEvents?.data ?? []),
        nextPageTimestamp: null,
      };
    }

    return {
      ...firstResponse,
      rateLimitData: lastResponse.rateLimitData ?? firstResponse.rateLimitData,
      reportData: {
        ...firstResponse.reportData,
        report: mergedReport,
      },
    };
  }

  /**
   * Parse death events from WCL response and group by fight
   * Death events contain: timestamp, type: "death", targetID (the player who died), fight
   */
  parseDeathEventsByFight(deathEventsData: any, actors: any[], fights: any[]) {
    if (!deathEventsData?.events?.data) {
      return new Map();
    }

    const events = JSON.parse(JSON.stringify(deathEventsData.events.data));

    // Create a map of actor IDs to actor info
    const actorMap = new Map();
    if (actors) {
      for (const actor of actors) {
        actorMap.set(actor.id, { name: actor.name, server: actor.server });
      }
    }

    // Create a map of fight IDs to fight start times
    const fightMap = new Map();
    if (fights) {
      for (const fight of fights) {
        fightMap.set(fight.id, fight.startTime);
      }
    }

    // Group deaths by fight ID
    const deathsByFight = new Map<number, any[]>();

    for (const event of events) {
      if (event.type === "death" && event.targetID && event.fight) {
        const actor = actorMap.get(event.targetID);
        const fightStartTime = fightMap.get(event.fight);

        if (actor && fightStartTime !== undefined) {
          if (!deathsByFight.has(event.fight)) {
            deathsByFight.set(event.fight, []);
          }

          deathsByFight.get(event.fight)!.push({
            name: actor.name,
            server: actor.server || "Unknown",
            timestamp: event.timestamp, // Absolute timestamp relative to report start
            deathTime: event.timestamp - fightStartTime, // Time relative to fight start
          });
        }
      }
    }

    // Sort each fight's deaths by timestamp (chronological order)
    for (const [fightId, deaths] of deathsByFight.entries()) {
      deaths.sort((a, b) => a.timestamp - b.timestamp);
    }

    return deathsByFight;
  }

  parseFightRostersByFight(reportData: any, actors: any[]): Map<number, FightRosterResult> {
    const attachedRosters = reportData?.fightRosters;
    if (attachedRosters && typeof attachedRosters === "object") {
      return new Map(
        Object.entries(attachedRosters)
          .map(([fightId, roster]) => [Number(fightId), roster as FightRosterResult] as const)
          .filter(([fightId]) => Number.isFinite(fightId)),
      );
    }

    return new Map(
      Array.from(this.parseRawCombatantInfoByFight(reportData, actors), ([fightId, participants]) => {
        const knownSpecCount = participants.filter((participant) => Boolean(participant.specName)).length;
        return [fightId, {
          participants,
          status: knownSpecCount === participants.length ? "fetched" : "partial",
          source: "combatant_info",
          rosterComplete: participants.length > 0,
          knownSpecCount,
        } satisfies FightRosterResult];
      }),
    );
  }

  /** Parse each player's specialization evidence, grouped by fight. */
  parseCombatantInfoByFight(reportData: any, actors: any[]) {
    return new Map(
      Array.from(this.parseFightRostersByFight(reportData, actors), ([fightId, roster]) => [fightId, roster.participants]),
    );
  }

  private parseRawCombatantInfoByFight(reportData: any, actors: any[]): Map<number, FightRosterParticipant[]> {
    const events = reportData?.combatantInfoEvents?.data;
    if (!Array.isArray(events)) return new Map<number, FightRosterParticipant[]>();

    const actorMap = new Map<number, { name: string; server: string }>();
    for (const actor of actors ?? []) {
      if (typeof actor?.id !== "number" || !actor?.name) continue;
      actorMap.set(actor.id, { name: actor.name, server: actor.server || "Unknown" });
    }

    const combatantsByFight = new Map<number, Map<number, FightRosterParticipant>>();
    for (const event of events) {
      if (typeof event?.fight !== "number" || typeof event?.sourceID !== "number" || typeof event?.specID !== "number") continue;
      const actor = actorMap.get(event.sourceID);
      const spec = resolveSpecByBlizzardSpecId(event.specID);
      if (!actor) continue;

      if (!combatantsByFight.has(event.fight)) combatantsByFight.set(event.fight, new Map());
      combatantsByFight.get(event.fight)!.set(event.sourceID, {
        ...actor,
        specID: spec?.specID ?? event.specID,
        specName: spec?.specName ?? null,
        role: null,
        source: "combatant_info",
      });
    }

    return new Map(Array.from(combatantsByFight, ([fightId, combatants]) => [fightId, Array.from(combatants.values())]));
  }

  parsePlayerDetailsRoster(response: any): FightRosterParticipant[] {
    const playerDetails = this.getPlayerDetailsPayload(response);
    if (!playerDetails || typeof playerDetails !== "object") return [];

    const roleGroups: Array<["healers" | "dps" | "tanks", "healer" | "dps" | "tank"]> = [
      ["healers", "healer"],
      ["dps", "dps"],
      ["tanks", "tank"],
    ];
    const participants = new Map<string, FightRosterParticipant>();

    for (const [groupName, role] of roleGroups) {
      const rows = Array.isArray(playerDetails[groupName]) ? playerDetails[groupName] : [];
      for (const row of rows) {
        if (!row?.name) continue;
        const specs = (Array.isArray(row.specs) ? row.specs : [])
          .filter((entry: any) => typeof entry?.spec === "string" && entry.spec.trim())
          .map((entry: any) => ({ specName: slugifySpecName(entry.spec.trim()), count: Number(entry.count) || 0 }))
          .sort((left: any, right: any) => right.count - left.count || left.specName.localeCompare(right.specName));
        const specName = specs.length === 1 || (specs[0]?.count ?? 0) > (specs[1]?.count ?? -1) ? specs[0]?.specName ?? null : null;
        const server = typeof row.server === "string" && row.server.trim() ? row.server.trim() : "Unknown";
        const key = this.getRosterIdentityKey(row.name, server);
        participants.set(key, {
          name: row.name,
          server,
          specID: null,
          specName,
          role,
          source: "player_details",
        });
      }
    }

    return Array.from(participants.values());
  }

  private getPlayerDetailsPayload(response: any): any {
    return response?.reportData?.report?.playerDetails?.data?.playerDetails
      ?? response?.reportData?.report?.playerDetails?.playerDetails
      ?? response?.playerDetails?.data?.playerDetails
      ?? response?.data?.playerDetails
      ?? response?.playerDetails;
  }

  private parsePlayerDetailsCounts(response: any): PlayerDetailsCount[] {
    const playerDetails = this.getPlayerDetailsPayload(response);
    if (!playerDetails || typeof playerDetails !== "object") return [];

    const roleGroups: Array<["healers" | "dps" | "tanks", "healer" | "dps" | "tank"]> = [
      ["healers", "healer"],
      ["dps", "dps"],
      ["tanks", "tank"],
    ];
    const counts = new Map<string, PlayerDetailsCount>();

    for (const [groupName, role] of roleGroups) {
      const rows = Array.isArray(playerDetails[groupName]) ? playerDetails[groupName] : [];
      for (const row of rows) {
        if (!row?.name) continue;
        const server = typeof row.server === "string" && row.server.trim() ? row.server.trim() : "Unknown";
        const specs = Array.isArray(row.specs) ? row.specs : [];
        for (const spec of specs) {
          if (typeof spec?.spec !== "string" || !spec.spec.trim()) continue;
          const count = Number(spec.count);
          if (!Number.isFinite(count) || count <= 0) continue;
          const specName = slugifySpecName(spec.spec.trim());
          const key = `${this.getRosterIdentityKey(row.name, server)}|${role}|${specName}`;
          const existing = counts.get(key);
          counts.set(key, {
            name: row.name,
            server,
            role,
            specName,
            count: (existing?.count ?? 0) + count,
          });
        }
      }
    }

    return Array.from(counts.values());
  }

  private playerDetailsCountsToRoster(counts: PlayerDetailsCount[], expectedCount: number): FightRosterParticipant[] | null {
    if (counts.length === 0 || expectedCount <= 0) return null;

    const byPlayer = new Map<string, PlayerDetailsCount[]>();
    for (const count of counts) {
      const key = this.getRosterIdentityKey(count.name, count.server);
      const entries = byPlayer.get(key) ?? [];
      entries.push(count);
      byPlayer.set(key, entries);
    }

    const participants: FightRosterParticipant[] = [];
    for (const entries of byPlayer.values()) {
      if (entries.length !== 1 || entries[0].count !== expectedCount) return null;
      const entry = entries[0];
      participants.push({
        name: entry.name,
        server: entry.server,
        specID: null,
        specName: entry.specName,
        role: entry.role,
        source: "player_details",
      });
    }
    return participants;
  }

  private derivePlayerDetailsRoster(
    groupedCounts: PlayerDetailsCount[],
    individualCounts: PlayerDetailsCount[][],
  ): FightRosterParticipant[] | null {
    if (groupedCounts.length === 0) return null;

    const remaining = new Map<string, PlayerDetailsCount>();
    const toCountKey = (entry: PlayerDetailsCount) => `${this.getRosterIdentityKey(entry.name, entry.server)}|${entry.role}|${entry.specName}`;
    for (const entry of groupedCounts) remaining.set(toCountKey(entry), { ...entry });

    for (const counts of individualCounts) {
      if (counts.length === 0) return null;
      for (const entry of counts) {
        const key = toCountKey(entry);
        const aggregate = remaining.get(key);
        if (!aggregate || aggregate.count < entry.count) return null;
        aggregate.count -= entry.count;
      }
    }

    return this.playerDetailsCountsToRoster(
      Array.from(remaining.values()).filter((entry) => entry.count > 0),
      1,
    );
  }

  private mergeFightRosterParticipants(
    rawParticipants: FightRosterParticipant[],
    fallbackParticipants: FightRosterParticipant[],
  ): FightRosterParticipant[] {
    if (fallbackParticipants.length === 0) return rawParticipants;
    if (rawParticipants.length === 0) return fallbackParticipants;

    const merged = new Map(fallbackParticipants.map((participant) => [this.getRosterIdentityKey(participant.name, participant.server), participant]));
    for (const raw of rawParticipants) {
      const exactKey = this.getRosterIdentityKey(raw.name, raw.server);
      let existingKey = exactKey;
      let existing = merged.get(existingKey);
      if (!existing) {
        const nameKey = this.normalizeRosterIdentityPart(raw.name);
        const nameMatches = Array.from(merged.entries()).filter(([, participant]) => this.normalizeRosterIdentityPart(participant.name) === nameKey);
        if (nameMatches.length === 1) [existingKey, existing] = nameMatches[0];
      }
      merged.set(existingKey, {
        ...(existing ?? raw),
        ...raw,
        specID: raw.specID ?? existing?.specID ?? null,
        specName: raw.specName ?? existing?.specName ?? null,
        role: existing?.role ?? raw.role ?? null,
        source: raw.specName ? "combatant_info" : existing?.source ?? raw.source,
      });
    }
    return Array.from(merged.values());
  }

  private getRosterIdentityKey(name: string, server: string): string {
    return `${this.normalizeRosterIdentityPart(name)}|${this.normalizeRosterIdentityPart(server)}`;
  }

  private normalizeRosterIdentityPart(value: string): string {
    return String(value ?? "").toLowerCase().replace(/['`\-\s]/g, "");
  }

  /**
   * Parse death events from WCL response
   * Death events contain: timestamp, type: "death", sourceID (the player who died)
   */
  parseDeathEvents(deathEventsData: any, actors: any[], fightStartTime: number) {
    if (!deathEventsData?.events?.data) {
      return [];
    }

    const events = JSON.parse(JSON.stringify(deathEventsData.events.data));

    // Create a map of actor IDs to actor info
    const actorMap = new Map();
    if (actors) {
      for (const actor of actors) {
        actorMap.set(actor.id, { name: actor.name, server: actor.server });
      }
    }

    // Parse death events
    const deaths = [];
    for (const event of events) {
      if (event.type === "death" && event.targetID) {
        const actor = actorMap.get(event.targetID);
        if (actor) {
          deaths.push({
            name: actor.name,
            server: actor.server || "Unknown",
            timestamp: event.timestamp, // Absolute timestamp relative to report start
            deathTime: event.timestamp - fightStartTime, // Time relative to fight start
          });
        }
      }
    }

    // Sort by timestamp (chronological order)
    deaths.sort((a, b) => a.timestamp - b.timestamp);

    // Keep only the first N deaths
    return deaths;
  }
}

export default new WarcraftLogsService();
