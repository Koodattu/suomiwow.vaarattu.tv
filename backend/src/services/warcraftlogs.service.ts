import fetch from "node-fetch";
import logger from "../utils/logger";
import { GUILDS_DEV, GUILDS_PROD, TrackedGuild } from "../config/guilds";
import rateLimitService, { WCLRateLimitData } from "./rate-limit.service";
import wclUserAuthService from "./warcraftlogs-user-auth.service";
import { resolveSpecByBlizzardSpecId } from "../utils/spec";

interface WCLAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

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
  private updateRateLimitFromResponse(rateLimitData: WCLRateLimitData | undefined): void {
    if (rateLimitData) {
      rateLimitService.updateFromResponse(rateLimitData);
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

  async query<T>(query: string, variables?: any, retryOnGatewayTimeout: boolean = false, serverErrorRetries: number = 0): Promise<T> {
    return this.queryEndpoint<T>("client", query, variables, retryOnGatewayTimeout, serverErrorRetries);
  }

  async queryUser<T>(query: string, variables?: any, retryOnGatewayTimeout: boolean = false, serverErrorRetries: number = 0): Promise<T> {
    return this.queryEndpoint<T>("user", query, variables, retryOnGatewayTimeout, serverErrorRetries);
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
      return this.queryEndpoint<T>(endpoint, query, variables, retryOnGatewayTimeout, serverErrorRetries); // Retry the request
    }

    // Handle gateway timeouts with infinite retry (only for initial fetch)
    if (retryOnGatewayTimeout && (response.status === 504 || response.statusText === "Gateway Time-out")) {
      logger.warn(`⚠️  Gateway timeout from WCL API! Retrying in 15 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait 15 seconds
      return this.queryEndpoint<T>(endpoint, query, variables, retryOnGatewayTimeout, serverErrorRetries); // Retry the request
    }

    if (response.status >= 500 && response.status < 600 && serverErrorRetries > 0) {
      const waitTime = (4 - serverErrorRetries) * 2000;
      logger.warn(`⚠️  WCL API ${response.status} ${response.statusText}; retrying in ${waitTime}ms (${serverErrorRetries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.queryEndpoint<T>(endpoint, query, variables, retryOnGatewayTimeout, serverErrorRetries - 1);
    }

    if (!response.ok) {
      throw new Error(`WCL API request failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as any;

    // Update global rate limit tracking from response
    if (result.data?.rateLimitData) {
      this.updateRateLimitFromResponse(result.data.rateLimitData);
    }

    if (result.errors) {
      throw new Error(`WCL GraphQL error: ${JSON.stringify(result.errors)}`);
    }

    return result.data as T;
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
  async getReportByCodeAllDifficulties(reportCode: string, options: { includeRankedCharacters?: boolean; forceUserEndpoint?: boolean } = {}) {
    const query = `
      query($reportCode: String!, $includeRankedCharacters: Boolean!) {
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
    };

    if (options.forceUserEndpoint) {
      logger.info(`[API REQUEST] WarcraftLogsService.getReportByCodeAllDifficulties - POST https://www.warcraftlogs.com/api/v2/user (forced, report: ${reportCode})`);
      return this.queryUser<any>(query, variables);
    }

    try {
      logger.info(`[API REQUEST] WarcraftLogsService.getReportByCodeAllDifficulties - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode})`);
      return await this.query<any>(query, variables);
    } catch (error) {
      if (!this.shouldRetryReportWithUserEndpoint(error)) {
        throw error;
      }

      if (!(await this.hasUserAuthConnected())) {
        throw error;
      }

      try {
        logger.info(`[API REQUEST] WarcraftLogsService.getReportByCodeAllDifficulties - POST https://www.warcraftlogs.com/api/v2/user (user-auth retry, report: ${reportCode})`);
        return await this.queryUser<any>(query, variables);
      } catch (userError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const userMessage = userError instanceof Error ? userError.message : String(userError);
        throw new Error(`${originalMessage}; WCL /user retry failed: ${userMessage}`);
      }
    }
  }

  async getReportRankingsCharacters(reportCode: string, difficulty = 5): Promise<
    Array<{
      name: string;
      className: string;
      specName?: string;
      specNames: string[];
      server: {
        name: string;
        region: string;
      };
      fightIds: number[];
    }>
  > {
    logger.info(`[API REQUEST] WarcraftLogsService.getReportRankingsCharacters - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode}, difficulty: ${difficulty})`);
    const query = `
      query($reportCode: String!, $difficulty: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
        reportData {
          report(code: $reportCode) {
            rankings(compare: Rankings, timeframe: Historical, difficulty: $difficulty)
          }
        }
      }
    `;

    const result = await this.query<any>(query, { reportCode, difficulty }, false, 2);
    const rankingRows = Array.isArray(result?.reportData?.report?.rankings?.data) ? result.reportData.report.rankings.data : [];
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

  /**
   * Fetch characters who participated in a specific fight
   * Used for leaderboard character discovery
   */
  async getFightCharacters(reportCode: string, fightId: number) {
    const query = `
      query($reportCode: String!, $fightId: Int!) {
        rateLimitData {
          limitPerHour
          pointsSpentThisHour
          pointsResetIn
        }
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
            fights(fightIDs: [$fightId]) {
              id
              encounterID
              name
              difficulty
              kill
            }
          }
        }
      }
    `;

    const variables = {
      reportCode,
      fightId,
    };

    const result = await this.query<any>(query, variables);

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
    options: { forceUserEndpoint?: boolean; includeCombatantInfo?: boolean } = {},
  ) {
    // Use maximum API limit to fetch all deaths
    const queryLimit = 10000;

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
            ${options.includeCombatantInfo ? `
            combatantInfoEvents: events(
              fightIDs: $fightIds,
              dataType: CombatantInfo,
              hostilityType: Friendlies,
              limit: $limit
            ) {
              data
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
      return this.queryUser<any>(query, variables);
    }

    try {
      logger.info(`[API REQUEST] WarcraftLogsService.getDeathEventsForReport - POST https://www.warcraftlogs.com/api/v2/client (report: ${reportCode}, ${fightIds.length} fights)`);
      return await this.query<any>(query, variables);
    } catch (error) {
      if (!this.shouldRetryReportWithUserEndpoint(error)) {
        throw error;
      }

      if (!(await this.hasUserAuthConnected())) {
        throw error;
      }

      try {
        logger.info(`[API REQUEST] WarcraftLogsService.getDeathEventsForReport - POST https://www.warcraftlogs.com/api/v2/user (user-auth retry, report: ${reportCode}, ${fightIds.length} fights)`);
        return await this.queryUser<any>(query, variables);
      } catch (userError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const userMessage = userError instanceof Error ? userError.message : String(userError);
        throw new Error(`${originalMessage}; WCL /user retry failed: ${userMessage}`);
      }
    }
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

  /** Parse each player's exact specialization from CombatantInfo events, grouped by fight. */
  parseCombatantInfoByFight(reportData: any, actors: any[]) {
    const events = reportData?.combatantInfoEvents?.data;
    if (!Array.isArray(events)) return new Map<number, Array<{ name: string; server: string; specID: number; specName: string }>>();

    const actorMap = new Map<number, { name: string; server: string }>();
    for (const actor of actors ?? []) {
      if (typeof actor?.id !== "number" || !actor?.name) continue;
      actorMap.set(actor.id, { name: actor.name, server: actor.server || "Unknown" });
    }

    const combatantsByFight = new Map<number, Map<number, { name: string; server: string; specID: number; specName: string }>>();
    for (const event of events) {
      if (typeof event?.fight !== "number" || typeof event?.sourceID !== "number" || typeof event?.specID !== "number") continue;
      const actor = actorMap.get(event.sourceID);
      const spec = resolveSpecByBlizzardSpecId(event.specID);
      if (!actor) continue;
      if (!spec) throw new Error(`Unsupported Blizzard specialization ID in WCL CombatantInfo: ${event.specID}`);

      if (!combatantsByFight.has(event.fight)) combatantsByFight.set(event.fight, new Map());
      combatantsByFight.get(event.fight)!.set(event.sourceID, {
        ...actor,
        specID: spec.specID,
        specName: spec.specName,
      });
    }

    return new Map(Array.from(combatantsByFight, ([fightId, combatants]) => [fightId, Array.from(combatants.values())]));
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
