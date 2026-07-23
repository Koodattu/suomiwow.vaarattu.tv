import {
  GuildListItem,
  GuildDirectoryItem,
  Guild,
  GuildSummary,
  Event,
  EventsResponse,
  EventFilters,
  RaidInfo,
  Raid,
  Boss,
  RaidDates,
  RaidProgress,
  GuildBossProgressResponse,
  GuildSchedule,
  RaidingTodayResponse,
  LiveStreamer,
  TierList,
  OverallTierListResponse,
  RaidTierListResponse,
  TierListRaidInfo,
  CharacterTierListRaidInfo,
  CharacterTierListResponse,
  CharacterTierListRole,
  CustomCharacterTierListResponse,
  SaveCustomCharacterTierListInput,
  SharedCharacterTierListResponse,
  AnalyticsOverview,
  AnalyticsHourly,
  AnalyticsDaily,
  AnalyticsEndpoint,
  AnalyticsStatusCode,
  AnalyticsRecent,
  AnalyticsRealtime,
  AnalyticsPeakHours,
  AnalyticsTrends,
  AnalyticsSlowEndpoint,
  AnalyticsErrors,
  AuthUser,
  UserProfile,
  StreamerSettings,
  DiscordBotStatus,
  DiscordGuildsResponse,
  DiscordIntegrationsResponse,
  DiscordIntegrationSettings,
  UpdateDiscordIntegrationInput,
  WoWCharacter,
  AdminUsersResponse,
  AdminUserPickemsResponse,
  AdminGuildsResponse,
  AdminTwitchStreamsResponse,
  AdminUserStats,
  AdminGuildStats,
  AdminOverview,
  AdminCharactersResponse,
  AdminCharacterStats,
  TaskLogsResponse,
  TaskLogsLatestResponse,
  HomePageData,
  PickemSummary,
  PickemDetails,
  PickemPrediction,
  GuildRanking,
  GuestPickemImportResult,
  SimpleGuild,
  AdminPickemsResponse,
  AdminPickem,
  CreatePickemInput,
  UpdatePickemInput,
  BossPullHistoryResponse,
  RaidAnalytics,
  RaidBossProgressionComparison,
  RaidAnalyticsListItem,
  GuildNetworkMeta,
  GuildNetworkUniverse,
  CharacterRankingRow,
  CharacterRankingsFilterOptionsResponse,
  MythicPlusLeaderboardResponse,
  MythicPlusOptionsResponse,
  CharacterSearchResponse,
  GlobalSearchResponse,
  GuildRaidCharactersResponse,
  CharacterProfileLookupResponse,
  CharacterAccountResponse,
  CharacterRaidReportsResponse,
  RateLimitResponse,
  RateLimitStatus,
  WarcraftLogsUserAuthStatus,
  WarcraftLogsUserReportProbeResponse,
  TwitchChatBotStatus,
  TwitchBotFollowsResponse,
  TwitchBotSettings,
  DeathEventsResetResponse,
  ProcessingQueueStatsResponse,
  ProcessingQueueResponse,
  ProcessingQueueErrorsResponse,
  ProcessingStatus,
  ProcessorStatus,
  QueueItem,
  ErrorType,
  TriggerResponse,
  MythicPlusCrawlerStatusResponse,
  MythicPlusCrawlerTriggerResponse,
  CharacterRankingBackfillStatusResponse,
  CharacterRankingBackfillTriggerResponse,
  CharacterRankingLeaderboardRebuildTriggerResponse,
  CharacterRankingMythicEvidenceCleanupResponse,
  CharacterAchievementBackfillStatusResponse,
  CharacterAchievementBackfillTriggerResponse,
  CharacterAccountGroupRebuildResponse,
  AdminGuildDetail,
  VerifyReportsResponse,
  QueueRescanResponse,
  CreateGuildInput,
  CreateGuildResponse,
  DeleteGuildPreviewResponse,
  DeleteGuildResponse,
  UpdateGuildInput,
  UpdateGuildResponse,
  ToggleGuildRaidExclusionResponse,
  DeleteCharacterResponse,
  DeleteCharacterRankingsPreviewResponse,
  DeleteCharacterRankingsResponse,
  UserPickemEntry,
  AdminRaidOption,
  AdminGuildReportsResponse,
  AdminDeleteReportResponse,
  AdminImportReportResponse,
  RaidCompare,
  BossPredictionResponse,
  CcgCatalogResponse,
  CcgCollectionResponse,
  CcgGuildsResponse,
  CcgMode,
  CcgOpening,
  CcgSession,
  CcgSet,
  CcgAdminEnableResponse,
  CcgAdminSetReadiness,
  CcgAdminStatusResponse,
} from "@/types";

// For client-side: use NEXT_PUBLIC_API_URL (browser requests)
// For server-side: use API_URL (internal Docker network)
const getApiUrl = () => {
  if (typeof window === "undefined") {
    // Server-side: use internal Docker network
    return process.env.API_URL || "http://localhost:3001";
  }
  // Client-side: use public URL
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
};

const API_URL = getApiUrl();

async function buildApiError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = (await response.json()) as { error?: string };
    return new Error(data.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

export const api = {
  // Home page endpoint - returns all data for the home page in a single request
  async getHomeData(): Promise<HomePageData> {
    const response = await fetch(`${API_URL}/api/home`);
    if (!response.ok) throw new Error("Failed to fetch home page data");
    return response.json();
  },

  // Guild endpoints
  async getGuilds(raidId: number): Promise<GuildListItem[]> {
    const response = await fetch(`${API_URL}/api/progress?raidId=${raidId}`);
    if (!response.ok) throw new Error("Failed to fetch guilds");
    return response.json();
  },

  async getGuildBossProgress(guildId: string, raidId: number): Promise<RaidProgress[]> {
    const response = await fetch(`${API_URL}/api/guilds/${guildId}/raids/${raidId}/bosses`);
    if (!response.ok) throw new Error("Failed to fetch guild boss progress");
    return response.json();
  },

  async getGuildBossProgressByRealmName(realm: string, name: string, raidId: number): Promise<GuildBossProgressResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/bosses`);
    if (!response.ok) throw new Error("Failed to fetch guild boss progress");
    return response.json();
  },

  async getGuildRaidCharactersByRealmName(realm: string, name: string, raidId: number): Promise<GuildRaidCharactersResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/characters`);
    if (!response.ok) throw new Error("Failed to fetch guild raid characters");
    return response.json();
  },

  async getCharacterProfileByRealmName(realm: string, name: string, classId?: number): Promise<CharacterProfileLookupResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const params = new URLSearchParams();
    if (classId !== undefined) params.set("class", String(classId));
    const query = params.toString();
    const response = await fetch(`${API_URL}/api/characters/${encodedRealm}/${encodedName}${query ? `?${query}` : ""}`);
    if (!response.ok) throw new Error("Failed to fetch character profile");
    return response.json();
  },

  async getCharacterRaidReportsByRealmName(realm: string, name: string, raidId: number, guildId: string, classId?: number): Promise<CharacterRaidReportsResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const encodedGuildId = encodeURIComponent(guildId);
    const params = new URLSearchParams();
    if (classId !== undefined) params.set("class", String(classId));
    const query = params.toString();
    const response = await fetch(`${API_URL}/api/characters/${encodedRealm}/${encodedName}/raids/${raidId}/guilds/${encodedGuildId}/reports${query ? `?${query}` : ""}`);
    if (!response.ok) throw new Error("Failed to fetch character raid reports");
    return response.json();
  },

  async getCcgSession(): Promise<CcgSession> {
    const response = await fetch(`${API_URL}/api/ccg/session`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "Failed to load the card vault");
    return response.json();
  },

  async getCcgSets(): Promise<{ sets: CcgSet[] }> {
    const response = await fetch(`${API_URL}/api/ccg/sets`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "Failed to load card sets");
    return response.json();
  },

  async getCcgCatalog(
    setSlug: string,
    options: { page?: number; limit?: number; owned?: "all" | "owned" | "missing"; grade?: string; guild?: string } = {},
  ): Promise<CcgCatalogResponse> {
    const params = new URLSearchParams();
    if (options.page) params.set("page", String(options.page));
    if (options.limit) params.set("limit", String(options.limit));
    if (options.owned && options.owned !== "all") params.set("owned", options.owned);
    if (options.grade) params.set("grade", options.grade);
    if (options.guild) params.set("guild", options.guild);
    const response = await fetch(`${API_URL}/api/ccg/sets/${encodeURIComponent(setSlug)}/catalog?${params}`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "Failed to open this binder");
    return response.json();
  },

  async getCcgSetGuilds(setSlug: string): Promise<CcgGuildsResponse> {
    const response = await fetch(`${API_URL}/api/ccg/sets/${encodeURIComponent(setSlug)}/guilds`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "Failed to load guild binders");
    return response.json();
  },

  async getCcgCollection(options: { page?: number; limit?: number; set?: string; grade?: string; finish?: string; search?: string; guild?: string } = {}): Promise<CcgCollectionResponse> {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    const response = await fetch(`${API_URL}/api/ccg/collection?${params}`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "Failed to load your collection");
    return response.json();
  },

  async openCcgPack(input: { mode: CcgMode; idempotencyKey: string; setId?: string }): Promise<CcgOpening> {
    const response = await fetch(`${API_URL}/api/ccg/packs/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) throw await buildApiError(response, "The pack could not be opened");
    return response.json();
  },

  async getCcgOpening(openingId: string): Promise<CcgOpening> {
    const response = await fetch(`${API_URL}/api/ccg/openings/${encodeURIComponent(openingId)}`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "The pack opening could not be recovered");
    return response.json();
  },

  async getAdminCcgStatus(): Promise<CcgAdminStatusResponse> {
    const response = await fetch(`${API_URL}/api/admin/ccg/status`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "Failed to load CCG administration");
    return response.json();
  },

  async previewAdminCcgSet(zoneId: number): Promise<CcgAdminSetReadiness> {
    const response = await fetch(`${API_URL}/api/admin/ccg/sets/${zoneId}/preview`, { credentials: "include" });
    if (!response.ok) throw await buildApiError(response, "Failed to check CCG readiness");
    return response.json();
  },

  async enableAdminCcgSet(zoneId: number): Promise<CcgAdminEnableResponse> {
    const response = await fetch(`${API_URL}/api/admin/ccg/sets/${zoneId}/enable`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw await buildApiError(response, "Failed to enable this CCG raid");
    return response.json();
  },

  async claimCcgGuest(idempotencyKey: string): Promise<{
    claimed: boolean;
    alreadyClaimed: boolean;
    cards: { current: number; legacy: number };
    conversionPacks: number;
  }> {
    const response = await fetch(`${API_URL}/api/ccg/guest/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idempotencyKey }),
    });
    if (!response.ok) throw await buildApiError(response, "Today's guest cards could not be claimed");
    return response.json();
  },

  async getCharacterAccount(slug: string): Promise<CharacterAccountResponse> {
    const encodedSlug = encodeURIComponent(slug);
    const response = await fetch(`${API_URL}/api/accounts/${encodedSlug}`);
    if (!response.ok) throw new Error("Failed to fetch account");
    return response.json();
  },

  async searchCharacters(query: string, limit = 10): Promise<CharacterSearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    const response = await fetch(`${API_URL}/api/characters/search?${params}`);
    if (!response.ok) throw new Error("Failed to search characters");
    return response.json();
  },

  async searchSite(query: string, limit = 5): Promise<GlobalSearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    const response = await fetch(`${API_URL}/api/search?${params}`);
    if (!response.ok) throw new Error("Failed to search site");
    return response.json();
  },

  async getBossPullHistory(realm: string, name: string, raidId: number, bossId: number, difficulty: "mythic" | "heroic"): Promise<BossPullHistoryResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/bosses/${bossId}/pull-history?difficulty=${difficulty}`);
    if (!response.ok) throw new Error("Failed to fetch boss pull history");
    return response.json();
  },

  async getBossPrediction(realm: string, name: string, raidId: number, bossId: number, difficulty: "mythic" | "heroic"): Promise<BossPredictionResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/bosses/${bossId}/prediction?difficulty=${difficulty}`);
    if (!response.ok) throw new Error("Failed to fetch boss prediction");
    return response.json();
  },

  async getGuild(id: string): Promise<Guild> {
    const response = await fetch(`${API_URL}/api/guilds/${id}`);
    if (!response.ok) throw new Error("Failed to fetch guild");
    return response.json();
  },

  async getGuildSummary(id: string): Promise<GuildSummary> {
    const response = await fetch(`${API_URL}/api/guilds/${id}/summary`, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch guild summary");
    return response.json();
  },

  async getGuildSummaryByRealmName(realm: string, name: string): Promise<GuildSummary> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/guilds/${encodedRealm}/${encodedName}/summary`, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch guild summary");
    return response.json();
  },

  async getGuildFullProfile(id: string): Promise<Guild> {
    const response = await fetch(`${API_URL}/api/guilds/${id}/profile`);
    if (!response.ok) throw new Error("Failed to fetch guild profile");
    return response.json();
  },

  async getGuildList(): Promise<GuildDirectoryItem[]> {
    const response = await fetch(`${API_URL}/api/guilds/list`, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch guild list");
    return response.json();
  },

  async getHorseRaceUmaReservations(): Promise<string[]> {
    const response = await fetch(`${API_URL}/api/guilds/horse-race-uma-reservations`);
    if (!response.ok) throw new Error("Failed to fetch horse race Uma reservations");
    return response.json();
  },

  async getGuildSchedules(): Promise<GuildSchedule[]> {
    const response = await fetch(`${API_URL}/api/guilds/schedules`);
    if (!response.ok) throw new Error("Failed to fetch guild schedules");
    return response.json();
  },

  async getRaidingToday(): Promise<RaidingTodayResponse> {
    const response = await fetch(`${API_URL}/api/guilds/raiding-today`);
    if (!response.ok) throw new Error("Failed to fetch guilds raiding today");
    return response.json();
  },

  async getLiveStreamers(): Promise<LiveStreamer[]> {
    const response = await fetch(`${API_URL}/api/guilds/live-streamers`);
    if (!response.ok) throw new Error("Failed to fetch live streamers");
    return response.json();
  },

  async refreshGuild(id: string): Promise<{ message: string; guild: Guild }> {
    const response = await fetch(`${API_URL}/api/guilds/${id}/refresh`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to refresh guild");
    return response.json();
  },

  // Event endpoints
  async getEvents(limit: number = 50): Promise<Event[]> {
    const response = await fetch(`${API_URL}/api/events?limit=${limit}`);
    if (!response.ok) throw new Error("Failed to fetch events");
    const data = await response.json();
    // Support both old (array) and new (paginated) response formats
    return Array.isArray(data) ? data : data.events;
  },

  async getEventsPaginated(page: number = 1, limit: number = 50, filters?: EventFilters): Promise<EventsResponse> {
    const params = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (filters?.types && filters.types.length > 0) {
      params.set("types", filters.types.join(","));
    }
    if (filters?.difficulties && filters.difficulties.length > 0) {
      params.set("difficulties", filters.difficulties.join(","));
    }
    if (filters?.guildName) {
      params.set("guildName", filters.guildName);
    }
    const response = await fetch(`${API_URL}/api/events?${params.toString()}`);
    if (!response.ok) throw new Error("Failed to fetch events");
    const data = await response.json();
    // If old format (array), convert to new format
    if (Array.isArray(data)) {
      return {
        events: data,
        pagination: {
          page: 1,
          limit: data.length,
          totalPages: 1,
          totalCount: data.length,
        },
      };
    }
    return data;
  },

  async getGuildEvents(guildId: string, limit: number = 50): Promise<Event[]> {
    const response = await fetch(`${API_URL}/api/events/guild/${guildId}?limit=${limit}`);
    if (!response.ok) throw new Error("Failed to fetch guild events");
    const data = await response.json();
    // Support both old (array) and new (paginated) response formats
    return Array.isArray(data) ? data : data.events;
  },

  async getGuildEventsByRealmName(realm: string, name: string, limit: number = 50): Promise<Event[]> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/events/guild/${encodedRealm}/${encodedName}?limit=${limit}`);
    if (!response.ok) throw new Error("Failed to fetch guild events");
    const data = await response.json();
    // Support both old (array) and new (paginated) response formats
    return Array.isArray(data) ? data : data.events;
  },

  // Raid endpoints
  async getRaids(): Promise<RaidInfo[]> {
    const response = await fetch(`${API_URL}/api/raids`);
    if (!response.ok) throw new Error("Failed to fetch raids");
    return response.json();
  },

  async getRaid(raidId: number): Promise<Raid> {
    const response = await fetch(`${API_URL}/api/raids/${raidId}`);
    if (!response.ok) throw new Error("Failed to fetch raid");
    return response.json();
  },

  async getBosses(raidId: number): Promise<Boss[]> {
    const response = await fetch(`${API_URL}/api/raids/${raidId}/bosses`);
    if (!response.ok) throw new Error("Failed to fetch raid bosses");
    return response.json();
  },

  async getRaidDates(raidId: number): Promise<RaidDates> {
    const response = await fetch(`${API_URL}/api/raids/${raidId}/dates`);
    if (!response.ok) throw new Error("Failed to fetch raid dates");
    return response.json();
  },

  // Tier list endpoints

  // Get full tier list (overall + all raids) - use sparingly, prefer specific endpoints
  async getTierList(): Promise<TierList> {
    const response = await fetch(`${API_URL}/api/tierlists`);
    if (!response.ok) throw new Error("Failed to fetch tier list");
    return response.json();
  },

  // Get overall tier list only (without per-raid data)
  async getOverallTierList(): Promise<OverallTierListResponse> {
    const response = await fetch(`${API_URL}/api/tierlists?type=overall`);
    if (!response.ok) throw new Error("Failed to fetch overall tier list");
    return response.json();
  },

  // Get tier list for a specific raid
  async getTierListForRaid(raidId: number): Promise<RaidTierListResponse> {
    const response = await fetch(`${API_URL}/api/tierlists?raidId=${raidId}`);
    if (!response.ok) throw new Error("Failed to fetch tier list for raid");
    return response.json();
  },

  // Get available raids that have tier list data
  async getTierListRaids(): Promise<TierListRaidInfo[]> {
    const response = await fetch(`${API_URL}/api/tierlists/raids`);
    if (!response.ok) throw new Error("Failed to fetch tier list raids");
    return response.json();
  },

  async getCharacterTierListRaids(): Promise<CharacterTierListRaidInfo[]> {
    const response = await fetch(`${API_URL}/api/character-tierlists/raids?v=6`);
    if (!response.ok) throw new Error("Failed to fetch character tier list raids");
    return response.json();
  },

  async getGlobalCharacterTierList(
    raidId: number,
    filters: { minReports?: number; role?: CharacterTierListRole | null; classId?: number | null; limit?: number | "all" } = {},
  ): Promise<CharacterTierListResponse> {
    const params = new URLSearchParams();
    if (filters.minReports !== undefined) params.set("minReports", String(filters.minReports));
    if (filters.role) params.set("role", filters.role);
    if (filters.classId) params.set("classId", String(filters.classId));
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));

    const query = params.toString();
    const response = await fetch(`${API_URL}/api/character-tierlists/raids/${raidId}${query ? `?${query}` : ""}`);
    if (!response.ok) throw new Error("Failed to fetch character tier list");
    return response.json();
  },

  async getGuildCharacterTierList(
    realm: string,
    name: string,
    raidId: number,
    filters: { minReports?: number; role?: CharacterTierListRole | null; classId?: number | null; limit?: number | "all" } = {},
  ): Promise<CharacterTierListResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const params = new URLSearchParams();
    if (filters.minReports !== undefined) params.set("minReports", String(filters.minReports));
    if (filters.role) params.set("role", filters.role);
    if (filters.classId) params.set("classId", String(filters.classId));
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));

    const query = params.toString();
    const response = await fetch(`${API_URL}/api/character-tierlists/guilds/${encodedRealm}/${encodedName}/raids/${raidId}${query ? `?${query}` : ""}`);
    if (!response.ok) throw new Error("Failed to fetch guild character tier list");
    return response.json();
  },

  async getCustomCharacterTierList(realm: string, name: string, raidId: number): Promise<CustomCharacterTierListResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/character-tierlists/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/custom`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch custom character tier list");
    return response.json();
  },

  async saveCustomCharacterTierList(realm: string, name: string, raidId: number, input: SaveCustomCharacterTierListInput): Promise<CustomCharacterTierListResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/character-tierlists/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/custom`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to save custom character tier list");
    }
    return response.json();
  },

  async deleteCustomCharacterTierList(realm: string, name: string, raidId: number): Promise<CustomCharacterTierListResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/character-tierlists/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/custom`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to reset custom character tier list");
    }
    return response.json();
  },

  async createSharedCharacterTierList(realm: string, name: string, raidId: number, input: SaveCustomCharacterTierListInput): Promise<SharedCharacterTierListResponse> {
    const encodedRealm = encodeURIComponent(realm);
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_URL}/api/character-tierlists/guilds/${encodedRealm}/${encodedName}/raids/${raidId}/shared`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to share character tier list");
    }
    return response.json();
  },

  async getSharedCharacterTierList(shareId: string): Promise<SharedCharacterTierListResponse> {
    const response = await fetch(`${API_URL}/api/character-tierlists/shared/${encodeURIComponent(shareId)}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch shared character tier list");
    return response.json();
  },

  async updateSharedCharacterTierList(shareId: string, input: SaveCustomCharacterTierListInput): Promise<SharedCharacterTierListResponse> {
    const response = await fetch(`${API_URL}/api/character-tierlists/shared/${encodeURIComponent(shareId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to update shared character tier list");
    }
    return response.json();
  },

  // Analytics endpoints
  async getAnalyticsOverview(): Promise<AnalyticsOverview> {
    const response = await fetch(`${API_URL}/api/analytics/overview`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch analytics overview");
    return response.json();
  },

  async getAnalyticsHourly(days: number = 7): Promise<AnalyticsHourly[]> {
    const response = await fetch(`${API_URL}/api/analytics/hourly?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch hourly analytics");
    return response.json();
  },

  async getAnalyticsDaily(days: number = 30): Promise<AnalyticsDaily[]> {
    const response = await fetch(`${API_URL}/api/analytics/daily?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch daily analytics");
    return response.json();
  },

  async getAnalyticsEndpoints(days: number = 7): Promise<AnalyticsEndpoint[]> {
    const response = await fetch(`${API_URL}/api/analytics/endpoints?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch endpoint analytics");
    return response.json();
  },

  async getAnalyticsStatusCodes(days: number = 7): Promise<AnalyticsStatusCode[]> {
    const response = await fetch(`${API_URL}/api/analytics/status-codes?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch status code analytics");
    return response.json();
  },

  async getAnalyticsRecent(limit: number = 100): Promise<AnalyticsRecent[]> {
    const response = await fetch(`${API_URL}/api/analytics/recent?limit=${limit}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch recent requests");
    return response.json();
  },

  async getAnalyticsRealtime(): Promise<AnalyticsRealtime> {
    const response = await fetch(`${API_URL}/api/analytics/realtime`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch realtime analytics");
    return response.json();
  },

  async getAnalyticsPeakHours(days: number = 7): Promise<AnalyticsPeakHours> {
    const response = await fetch(`${API_URL}/api/analytics/peak-hours?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch peak hours analytics");
    return response.json();
  },

  async getAnalyticsTrends(): Promise<AnalyticsTrends> {
    const response = await fetch(`${API_URL}/api/analytics/trends`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch analytics trends");
    return response.json();
  },

  async getAnalyticsSlowEndpoints(days: number = 7): Promise<AnalyticsSlowEndpoint[]> {
    const response = await fetch(`${API_URL}/api/analytics/slow-endpoints?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch slow endpoints");
    return response.json();
  },

  async getAnalyticsErrors(days: number = 7): Promise<AnalyticsErrors> {
    const response = await fetch(`${API_URL}/api/analytics/errors?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch error analytics");
    return response.json();
  },

  // Auth endpoints
  async getDiscordLoginUrl(): Promise<{ url: string }> {
    const response = await fetch(`${API_URL}/api/auth/discord/login`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to get Discord login URL");
    return response.json();
  },

  async getDiscordGuildsLoginUrl(): Promise<{ url: string }> {
    const response = await fetch(`${API_URL}/api/auth/discord/guilds/login`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to get Discord server authorization URL");
    return response.json();
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        credentials: "include",
      });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Failed to get current user");
      return response.json();
    } catch {
      return null;
    }
  },

  async getProfile(): Promise<UserProfile | null> {
    try {
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        credentials: "include",
      });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Failed to get user profile");
      return response.json();
    } catch {
      return null;
    }
  },

  async logout(): Promise<void> {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  },

  async getMyPickems(): Promise<UserPickemEntry[]> {
    const response = await fetch(`${API_URL}/api/auth/me/pickems`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch user pickems");
    return response.json();
  },

  async deleteMyAccount(): Promise<void> {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to delete account");
  },

  async getStreamerSettings(): Promise<StreamerSettings> {
    const response = await fetch(`${API_URL}/api/auth/me/streamer-settings`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch streamer settings");
    return response.json();
  },

  async updateStreamerSettings(guildId: string | null): Promise<StreamerSettings & { success: boolean }> {
    const response = await fetch(`${API_URL}/api/auth/me/streamer-settings`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ guildId }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Failed to update streamer settings" }));
      throw new Error(errorData.error || "Failed to update streamer settings");
    }
    return response.json();
  },

  async getDiscordBotStatus(): Promise<DiscordBotStatus> {
    const response = await fetch(`${API_URL}/api/discord/status`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch Discord bot status");
    return response.json();
  },

  async getDiscordManageableGuilds(): Promise<DiscordGuildsResponse> {
    const response = await fetch(`${API_URL}/api/discord/guilds`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch Discord servers");
    return response.json();
  },

  async getDiscordIntegrations(): Promise<DiscordIntegrationsResponse> {
    const response = await fetch(`${API_URL}/api/discord/integrations`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch Discord bot integrations");
    return response.json();
  },

  async getDiscordInstallUrl(guildId?: string): Promise<{ url: string }> {
    const params = new URLSearchParams();
    if (guildId) params.set("guildId", guildId);
    const response = await fetch(`${API_URL}/api/discord/install-url${params.toString() ? `?${params.toString()}` : ""}`, {
      credentials: "include",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Failed to create Discord install URL" }));
      throw new Error(errorData.error || "Failed to create Discord install URL");
    }
    return response.json();
  },

  async getDiscordIntegrationSettings(guildId: string): Promise<DiscordIntegrationSettings> {
    const response = await fetch(`${API_URL}/api/discord/integrations/${guildId}/settings`, {
      credentials: "include",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Failed to fetch Discord integration settings" }));
      throw new Error(errorData.error || "Failed to fetch Discord integration settings");
    }
    return response.json();
  },

  async updateDiscordIntegrationSettings(guildId: string, input: UpdateDiscordIntegrationInput): Promise<DiscordIntegrationSettings["integration"]> {
    const response = await fetch(`${API_URL}/api/discord/integrations/${guildId}/settings`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Failed to update Discord integration settings" }));
      throw new Error(errorData.error || "Failed to update Discord integration settings");
    }
    const data = await response.json();
    return data.integration;
  },

  async sendDiscordTestMessage(guildId: string): Promise<{ success: boolean; messageId: string }> {
    const response = await fetch(`${API_URL}/api/discord/integrations/${guildId}/test-message`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Failed to send Discord test message" }));
      throw new Error(errorData.error || "Failed to send Discord test message");
    }
    return response.json();
  },

  async uninstallDiscordIntegration(guildId: string): Promise<{ integration: DiscordIntegrationSettings["integration"] }> {
    const response = await fetch(`${API_URL}/api/discord/integrations/${guildId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Failed to uninstall Discord bot" }));
      throw new Error(errorData.error || "Failed to uninstall Discord bot");
    }
    return response.json();
  },

  // Twitch account connection
  async getTwitchConnectUrl(): Promise<{ url: string }> {
    const response = await fetch(`${API_URL}/api/auth/twitch/connect`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to get Twitch connect URL");
    return response.json();
  },

  async disconnectTwitch(): Promise<void> {
    const response = await fetch(`${API_URL}/api/auth/twitch/disconnect`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to disconnect Twitch");
  },

  // Battle.net account connection
  async getBattleNetConnectUrl(): Promise<{ url: string }> {
    const response = await fetch(`${API_URL}/api/auth/battlenet/connect`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to get Battle.net connect URL");
    return response.json();
  },

  async disconnectBattleNet(): Promise<void> {
    const response = await fetch(`${API_URL}/api/auth/battlenet/disconnect`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to disconnect Battle.net");
  },

  async getAllWoWCharacters(): Promise<{ characters: WoWCharacter[] }> {
    const response = await fetch(`${API_URL}/api/auth/battlenet/characters`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch WoW characters");
    return response.json();
  },

  async updateCharacterSelection(characterIds: number[]): Promise<{ characters: WoWCharacter[] }> {
    const response = await fetch(`${API_URL}/api/auth/battlenet/characters`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ characterIds }),
    });
    if (!response.ok) throw new Error("Failed to update character selection");
    return response.json();
  },

  async refreshWoWCharacters(): Promise<{ characters: WoWCharacter[] }> {
    const response = await fetch(`${API_URL}/api/auth/battlenet/characters/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Failed to refresh characters" }));
      const error: any = new Error(errorData.error || "Failed to refresh characters");
      error.response = { data: errorData };
      throw error;
    }
    return response.json();
  },

  // Admin endpoints (requires admin authentication)
  async getAdminOverview(): Promise<AdminOverview> {
    const response = await fetch(`${API_URL}/api/admin/overview`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch admin overview");
    return response.json();
  },

  async getAdminUsers(page: number = 1, limit: number = 20): Promise<AdminUsersResponse> {
    const response = await fetch(`${API_URL}/api/admin/users?page=${page}&limit=${limit}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch users");
    return response.json();
  },

  async getAdminUserPickems(userId: string): Promise<AdminUserPickemsResponse> {
    const response = await fetch(`${API_URL}/api/admin/users/${userId}/pickems`, {
      credentials: "include",
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error("User not found");
      throw new Error("Failed to fetch user pickems");
    }
    return response.json();
  },

  async getAdminUserStats(): Promise<AdminUserStats> {
    const response = await fetch(`${API_URL}/api/admin/users/stats`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch user stats");
    return response.json();
  },

  async getAdminGuilds(page: number = 1, limit: number = 20, search?: string): Promise<AdminGuildsResponse> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (search) params.append("search", search);

    const response = await fetch(`${API_URL}/api/admin/guilds?${params}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch guilds");
    return response.json();
  },

  async getAdminGuildStats(): Promise<AdminGuildStats> {
    const response = await fetch(`${API_URL}/api/admin/guilds/stats`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch guild stats");
    return response.json();
  },

  async getAdminTwitchStreams(): Promise<AdminTwitchStreamsResponse> {
    const response = await fetch(`${API_URL}/api/admin/twitch-streams`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch tracked Twitch streams");
    return response.json();
  },

  async createAdminGuild(input: CreateGuildInput): Promise<CreateGuildResponse> {
    const response = await fetch(`${API_URL}/api/admin/guilds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create guild");
    }
    return response.json();
  },

  async getAdminGuildDeletePreview(guildId: string): Promise<DeleteGuildPreviewResponse> {
    const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/delete-preview`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch deletion preview");
    return response.json();
  },

  async deleteAdminGuild(guildId: string): Promise<DeleteGuildResponse> {
    const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}?confirm=true`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete guild");
    }
    return response.json();
  },

  async updateAdminGuild(guildId: string, input: UpdateGuildInput): Promise<UpdateGuildResponse> {
    const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to update guild");
    }
    return response.json();
  },

  async removeAdminGuildStreamer(guildId: string, channelName: string): Promise<void> {
    const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/streamers/${encodeURIComponent(channelName)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to remove guild streamer");
    }
  },

  async toggleGuildRaidExclusion(guildId: string, raidId: number, excluded: boolean): Promise<ToggleGuildRaidExclusionResponse> {
    const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/excluded-raids`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ raidId, excluded }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to toggle raid exclusion");
    }
    return response.json();
  },

  async deleteAdminCharacter(characterId: string): Promise<DeleteCharacterResponse> {
    const response = await fetch(`${API_URL}/api/admin/characters/${characterId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete character");
    }
    return response.json();
  },

  async getAdminCharacterRankingsDeletePreview(zoneId: number, partition: number): Promise<DeleteCharacterRankingsPreviewResponse> {
    const response = await fetch(`${API_URL}/api/admin/character-rankings/delete-preview?zoneId=${zoneId}&partition=${partition}`, { credentials: "include" });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to fetch deletion preview");
    }
    return response.json();
  },

  async deleteAdminCharacterRankings(zoneId: number, partition: number): Promise<DeleteCharacterRankingsResponse> {
    const response = await fetch(`${API_URL}/api/admin/character-rankings?zoneId=${zoneId}&partition=${partition}&confirm=true`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete character rankings");
    }
    return response.json();
  },

  async getAdminAnalyticsOverview(): Promise<AnalyticsOverview> {
    const response = await fetch(`${API_URL}/api/admin/analytics/overview`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch analytics overview");
    return response.json();
  },

  async getAdminAnalyticsDaily(days: number = 30): Promise<AnalyticsDaily[]> {
    const response = await fetch(`${API_URL}/api/admin/analytics/daily?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch daily analytics");
    return response.json();
  },

  async getAdminAnalyticsEndpoints(days: number = 7): Promise<AnalyticsEndpoint[]> {
    const response = await fetch(`${API_URL}/api/admin/analytics/endpoints?days=${days}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch endpoint analytics");
    return response.json();
  },

  async getAdminAnalyticsRealtime(): Promise<AnalyticsRealtime> {
    const response = await fetch(`${API_URL}/api/admin/analytics/realtime`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch realtime analytics");
    return response.json();
  },

  // Pickems endpoints
  async getPickems(): Promise<PickemSummary[]> {
    const response = await fetch(`${API_URL}/api/pickems`);
    if (!response.ok) throw new Error("Failed to fetch pickems");
    return response.json();
  },

  async getPickemsGuilds(): Promise<SimpleGuild[]> {
    const response = await fetch(`${API_URL}/api/pickems/guilds`);
    if (!response.ok) throw new Error("Failed to fetch guilds for pickems");
    return response.json();
  },

  async getPickemsRwfGuilds(): Promise<SimpleGuild[]> {
    const response = await fetch(`${API_URL}/api/pickems/guilds/rwf`);
    if (!response.ok) throw new Error("Failed to fetch RWF guilds for pickems");
    return response.json();
  },

  async getPickemDetails(pickemId: string): Promise<PickemDetails> {
    const response = await fetch(`${API_URL}/api/pickems/${pickemId}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch pickem details");
    return response.json();
  },

  async getPickemReferenceRankings(pickemId: string, raidId: number): Promise<GuildRanking[]> {
    const response = await fetch(`${API_URL}/api/pickems/${encodeURIComponent(pickemId)}/reference-rankings?raidId=${raidId}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to fetch reference rankings");
    }
    return response.json();
  },

  async submitPickemPredictions(pickemId: string, predictions: PickemPrediction[]): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_URL}/api/pickems/${pickemId}/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ predictions }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to submit predictions");
    }
    return response.json();
  },

  async importGuestPickemPredictions(pickemId: string, predictions: PickemPrediction[]): Promise<GuestPickemImportResult> {
    const response = await fetch(`${API_URL}/api/pickems/${pickemId}/import-guest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ predictions }),
    });

    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string; code?: string };
    if (response.ok) {
      return {
        status: "imported",
        message: body.message,
      };
    }

    if (body.code === "PICKEM_ALREADY_SUBMITTED") {
      return { status: "already_exists" };
    }

    if (body.code === "PICKEM_FINALIZED" || body.code === "VOTING_NOT_OPEN" || body.code === "PICKEM_NOT_FOUND") {
      return { status: "voting_closed" };
    }

    throw new Error(body.error || "Failed to import guest predictions");
  },

  // Admin Pickem endpoints
  async getAdminPickems(): Promise<AdminPickemsResponse> {
    const response = await fetch(`${API_URL}/api/admin/pickems`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch pickems");
    return response.json();
  },

  async getAdminPickem(pickemId: string): Promise<AdminPickem> {
    const response = await fetch(`${API_URL}/api/admin/pickems/${pickemId}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch pickem");
    return response.json();
  },

  async createAdminPickem(input: CreatePickemInput): Promise<AdminPickem> {
    const response = await fetch(`${API_URL}/api/admin/pickems`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create pickem");
    }
    return response.json();
  },

  async updateAdminPickem(pickemId: string, input: UpdatePickemInput): Promise<AdminPickem> {
    const response = await fetch(`${API_URL}/api/admin/pickems/${pickemId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to update pickem");
    }
    return response.json();
  },

  async deleteAdminPickem(pickemId: string): Promise<{ success: boolean; message: string; affectedUsers: number }> {
    const response = await fetch(`${API_URL}/api/admin/pickems/${pickemId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete pickem");
    }
    return response.json();
  },

  async toggleAdminPickem(pickemId: string): Promise<AdminPickem> {
    const response = await fetch(`${API_URL}/api/admin/pickems/${pickemId}/toggle`, {
      method: "PATCH",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to toggle pickem");
    }
    return response.json();
  },

  async finalizeRwfPickem(pickemId: string, finalRankings: string[]): Promise<{ success: boolean; pickem: AdminPickem }> {
    const response = await fetch(`${API_URL}/api/admin/pickems/${pickemId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ finalRankings }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to finalize pickem");
    }
    return response.json();
  },

  async finalizeRegularPickem(pickemId: string): Promise<{ success: boolean; pickem: AdminPickem }> {
    const response = await fetch(`${API_URL}/api/admin/pickems/${pickemId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to finalize pickem");
    }
    return response.json();
  },

  async unfinalizePickem(pickemId: string): Promise<{ success: boolean; pickem: AdminPickem }> {
    const response = await fetch(`${API_URL}/api/admin/pickems/${pickemId}/unfinalize`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to unfinalize pickem");
    }
    return response.json();
  },

  async getCharacterRankings(queryString = ""): Promise<{
    data: CharacterRankingRow[];
    pagination: {
      totalItems: number;
      totalRankedItems: number;
      totalPages: number;
      currentPage: number;
      pageSize: number;
    };
  }> {
    const response = await fetch(`${API_URL}/api/character-rankings${queryString}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to fetch character rankings");
    }
    return response.json();
  },

  async getCharacterMechanics(queryString = ""): Promise<{
    data: CharacterRankingRow[];
    pagination: {
      totalItems: number;
      totalRankedItems: number;
      totalPages: number;
      currentPage: number;
      pageSize: number;
    };
  }> {
    const response = await fetch(`${API_URL}/api/character-mechanics${queryString}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to fetch character mechanics");
    }
    return response.json();
  },

  async getCharacterRankingOptions(): Promise<CharacterRankingsFilterOptionsResponse> {
    const response = await fetch(`${API_URL}/api/character-rankings/options`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to fetch character ranking options");
    }
    return response.json();
  },

  async getCharacterMechanicsOptions(): Promise<CharacterRankingsFilterOptionsResponse> {
    const response = await fetch(`${API_URL}/api/character-mechanics/options`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to fetch character mechanics options");
    }
    return response.json();
  },

  async getMythicPlusOptions(): Promise<MythicPlusOptionsResponse> {
    const response = await fetch(`${API_URL}/api/mythic-plus/options`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to fetch Mythic+ options");
    }
    return response.json();
  },

  async getMythicPlusLeaderboard(queryString = ""): Promise<MythicPlusLeaderboardResponse> {
    const response = await fetch(`${API_URL}/api/mythic-plus${queryString}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to fetch Mythic+ leaderboard");
    }
    return response.json();
  },

  // ============================================================================
  // RAID ANALYTICS
  // ============================================================================

  async getRaidAnalyticsRaids(): Promise<RaidAnalyticsListItem[]> {
    const response = await fetch(`${API_URL}/api/raid-analytics/raids`);
    if (!response.ok) {
      throw new Error("Failed to fetch raid analytics raids");
    }
    return response.json();
  },

  async getRaidAnalytics(raidId: number): Promise<RaidAnalytics> {
    const response = await fetch(`${API_URL}/api/raid-analytics/${raidId}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("No analytics available for this raid");
      }
      throw new Error("Failed to fetch raid analytics");
    }
    return response.json();
  },

  async getAllRaidAnalytics(): Promise<RaidAnalytics[]> {
    const response = await fetch(`${API_URL}/api/raid-analytics/all`);
    if (!response.ok) {
      throw new Error("Failed to fetch all raid analytics");
    }
    return response.json();
  },

  async getRaidBossProgressionComparison(): Promise<RaidBossProgressionComparison> {
    const response = await fetch(`${API_URL}/api/raid-analytics/boss-progression`);
    if (!response.ok) {
      throw new Error("Failed to fetch raid boss progression comparison");
    }
    return response.json();
  },

  // ============================================================================
  // GUILD NETWORK ANALYTICS
  // ============================================================================

  getGuildNetworkUniverseUrl(): string {
    return `${API_URL}/api/guild-network/universe`;
  },

  getGuildNetworkMovementUrlTemplate(): string {
    return `${API_URL}/api/guild-network/raids/{raidId}/movement`;
  },

  async getGuildNetworkMeta(): Promise<GuildNetworkMeta> {
    const response = await fetch(`${API_URL}/api/guild-network/meta`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Guild network snapshot has not been built yet");
      }
      throw new Error("Failed to fetch guild network metadata");
    }
    return response.json();
  },

  async getGuildNetworkUniverse(): Promise<GuildNetworkUniverse> {
    const response = await fetch(`${API_URL}/api/guild-network/universe`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Guild network snapshot has not been built yet");
      }
      throw new Error("Failed to fetch guild network universe");
    }
    return response.json();
  },

  // ============================================================================
  // RAID COMPARE
  // ============================================================================

  async getRaidCompare(raidId: number): Promise<RaidCompare> {
    const response = await fetch(`${API_URL}/api/compare/${raidId}`);
    if (!response.ok) {
      throw new Error("Failed to fetch raid compare data");
    }
    return response.json();
  },

  // ============================================================================
  // RATE LIMIT & PROCESSING QUEUE (Admin)
  // ============================================================================

  async getAdminRateLimitStatus(): Promise<RateLimitResponse> {
    const response = await fetch(`${API_URL}/api/admin/rate-limit`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch rate limit status");
    return response.json();
  },

  async setAdminRateLimitPause(paused: boolean): Promise<{ success: boolean; isPaused: boolean; status: RateLimitStatus }> {
    const response = await fetch(`${API_URL}/api/admin/rate-limit/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ paused }),
    });
    if (!response.ok) throw new Error("Failed to toggle rate limit pause");
    return response.json();
  },

  async getAdminWarcraftLogsUserAuthStatus(): Promise<WarcraftLogsUserAuthStatus> {
    const response = await fetch(`${API_URL}/api/admin/wcl-user/status`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch WCL user auth status");
    return response.json();
  },

  async getAdminWarcraftLogsUserAuthUrl(): Promise<{ url: string }> {
    const response = await fetch(`${API_URL}/api/admin/wcl-user/authorize`, {
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to create WCL user authorization URL");
    return data;
  },

  async verifyAdminWarcraftLogsUserAuth(): Promise<{ success: boolean; user: { id: number; name: string }; status?: Partial<WarcraftLogsUserAuthStatus> }> {
    const response = await fetch(`${API_URL}/api/admin/wcl-user/verify`, {
      method: "POST",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to verify WCL user authorization");
    return data;
  },

  async probeAdminWarcraftLogsUserReport(reportCode: string): Promise<WarcraftLogsUserReportProbeResponse> {
    const response = await fetch(`${API_URL}/api/admin/wcl-user/probe-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ reportCode }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to probe WCL report access");
    return data;
  },

  async disconnectAdminWarcraftLogsUserAuth(): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_URL}/api/admin/wcl-user`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to disconnect WCL user authorization");
    return data;
  },

  async getAdminTwitchBotStatus(): Promise<TwitchChatBotStatus> {
    const response = await fetch(`${API_URL}/api/admin/twitch-bot/status`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch Twitch bot status");
    return response.json();
  },

  async updateAdminTwitchBotSettings(settings: TwitchBotSettings): Promise<TwitchBotSettings> {
    const response = await fetch(`${API_URL}/api/admin/twitch-bot/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(settings),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to update Twitch bot settings");
    return data;
  },

  async getAdminTwitchBotFollows(): Promise<TwitchBotFollowsResponse> {
    const response = await fetch(`${API_URL}/api/admin/twitch-bot/follows`, {
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to fetch Twitch bot followed channels");
    return data;
  },

  async getAdminTwitchBotAuthUrl(): Promise<{ url: string }> {
    const response = await fetch(`${API_URL}/api/admin/twitch-bot/authorize`, {
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to create Twitch bot authorization URL");
    return data;
  },

  async verifyAdminTwitchBotAuth(): Promise<{ success: boolean; user: { id: string; login: string; displayName: string }; status?: Partial<TwitchChatBotStatus> }> {
    const response = await fetch(`${API_URL}/api/admin/twitch-bot/verify`, {
      method: "POST",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to verify Twitch bot authorization");
    return data;
  },

  async disconnectAdminTwitchBotAuth(): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_URL}/api/admin/twitch-bot`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to disconnect Twitch bot authorization");
    return data;
  },

  async resetAdminFailedArchivedDeathEvents(statuses: Array<"failed" | "archived"> = ["failed", "archived"], queue = true): Promise<DeathEventsResetResponse> {
    const response = await fetch(`${API_URL}/api/admin/death-events/reset-failed-archived`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ statuses, queue }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to reset death event fetches");
    return data;
  },

  async getAdminProcessingQueueStats(): Promise<ProcessingQueueStatsResponse> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/stats`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch processing queue stats");
    return response.json();
  },

  async getAdminCharacterRankingBackfillStatus(): Promise<CharacterRankingBackfillStatusResponse> {
    const response = await fetch(`${API_URL}/api/admin/character-ranking-backfill/status`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch character ranking backfill status");
    return response.json();
  },

  async getAdminCharacterAchievementBackfillStatus(): Promise<CharacterAchievementBackfillStatusResponse> {
    const response = await fetch(`${API_URL}/api/admin/character-achievement-backfill/status`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch character achievement backfill status");
    return response.json();
  },

  async getAdminMythicPlusCrawlerStatus(): Promise<MythicPlusCrawlerStatusResponse> {
    const response = await fetch(`${API_URL}/api/admin/mythic-plus-crawler/status`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch Mythic+ crawler status");
    return response.json();
  },

  async getAdminProcessingQueue(page: number = 1, limit: number = 20, status?: ProcessingStatus): Promise<ProcessingQueueResponse> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (status) params.append("status", status);

    const response = await fetch(`${API_URL}/api/admin/processing-queue?${params}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch processing queue");
    return response.json();
  },

  async setAdminProcessingQueuePauseAll(paused: boolean): Promise<{ success: boolean; processor: ProcessorStatus }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/pause-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ paused }),
    });
    if (!response.ok) throw new Error("Failed to toggle processing queue pause");
    return response.json();
  },

  async pauseAdminProcessingQueueGuild(guildId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/${guildId}/pause`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to pause guild processing");
    return response.json();
  },

  async resumeAdminProcessingQueueGuild(guildId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/${guildId}/resume`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to resume guild processing");
    return response.json();
  },

  async retryAdminProcessingQueueGuild(guildId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/${guildId}/retry`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to retry guild processing");
    return response.json();
  },

  async removeAdminProcessingQueueGuild(guildId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/${guildId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to remove guild from processing queue");
    return response.json();
  },

  async queueAdminGuildForProcessing(guildId: string, priority?: number): Promise<{ success: boolean; queueItem: QueueItem }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/queue-guild`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ guildId, priority }),
    });
    if (!response.ok) throw new Error("Failed to queue guild for processing");
    return response.json();
  },

  async getAdminProcessingQueueErrors(page: number = 1, limit: number = 20, errorType?: ErrorType): Promise<ProcessingQueueErrorsResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    if (errorType) {
      params.append("errorType", errorType);
    }

    const response = await fetch(`${API_URL}/api/admin/processing-queue/errors?${params}`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to fetch processing queue errors");
    }

    return response.json();
  },

  async clearAdminProcessingQueueCompleted(): Promise<{
    success: boolean;
    deletedCount: number;
    message: string;
  }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/clear-completed`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to clear completed guilds");
    return response.json();
  },

  async clearAdminProcessingQueueAll(): Promise<{
    success: boolean;
    deletedCount: number;
    message: string;
  }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/clear-all`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to clear processing queue");
    return response.json();
  },

  async clearAdminProcessingQueueErrors(action: "reset" | "remove" = "reset"): Promise<{
    success: boolean;
    deletedCount?: number;
    modifiedCount?: number;
    message: string;
  }> {
    const response = await fetch(`${API_URL}/api/admin/processing-queue/clear-errors?action=${action}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to clear errors");
    return response.json();
  },

  async getAdminCharacters(page = 1, limit = 50, search?: string): Promise<AdminCharactersResponse> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (search) params.append("search", search);
    const response = await fetch(`${API_URL}/api/admin/characters?${params}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch characters");
    return response.json();
  },

  async getAdminCharacterStats(): Promise<AdminCharacterStats> {
    const response = await fetch(`${API_URL}/api/admin/characters/stats`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch character stats");
    return response.json();
  },

  // ============================================================================
  // TASK LOGS (Admin)
  // ============================================================================

  async getAdminTaskLogs(limit: number = 50): Promise<TaskLogsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    const response = await fetch(`${API_URL}/api/admin/task-logs?${params}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch task logs");
    return response.json();
  },

  async getAdminTaskLogsLatest(): Promise<TaskLogsLatestResponse> {
    const response = await fetch(`${API_URL}/api/admin/task-logs/latest`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch latest task statuses");
    return response.json();
  },
};

// ==================== Admin Trigger Functions ====================

export async function triggerRefreshCharacterRankings(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/refresh-character-rankings`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger character rankings refresh");
  return response.json();
}

export async function triggerSyncRaidsFromWCL(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/sync-raids-from-wcl`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger raid sync from WarcraftLogs");
  return response.json();
}

export async function triggerCalculateAllStatistics(raidId?: number, scope: "all" | "current" = "current"): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/calculate-all-statistics`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raidId, scope }),
  });
  if (!response.ok) throw new Error("Failed to trigger statistics calculation");
  return response.json();
}

export async function triggerCalculateTierLists(raidId?: number, scope: "all" | "current" = "current"): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/calculate-tier-lists`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raidId, scope }),
  });
  if (!response.ok) throw new Error("Failed to trigger tier list calculation");
  return response.json();
}

export async function triggerCheckTwitchStreams(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/check-twitch-streams`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger Twitch stream check");
  return response.json();
}

export async function triggerTwitchBotReconnect(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/twitch-bot/reconnect`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to reconnect Twitch bot");
  return response.json();
}

export async function triggerTwitchBotReconcile(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/twitch-bot/reconcile`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to reconcile Twitch bot channels");
  return response.json();
}

export async function triggerBackfillFightVods(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/backfill-fight-vods`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger best-pull VOD backfill");
  return response.json();
}

export async function triggerUpdateWorldRanks(raidId?: number, scope: "all" | "current" = "current"): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/update-world-ranks`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raidId, scope }),
  });
  if (!response.ok) throw new Error("Failed to trigger world ranks update");
  return response.json();
}

export async function triggerCalculateRaidAnalytics(raidId?: number, scope: "all" | "current" = "current"): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/calculate-raid-analytics`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raidId, scope }),
  });
  if (!response.ok) throw new Error("Failed to trigger raid analytics calculation");
  return response.json();
}

export async function getAdminRaids(): Promise<{ raids: AdminRaidOption[] }> {
  const response = await fetch(`${API_URL}/api/admin/raids`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch admin raids");
  return response.json();
}

export async function triggerUpdateActiveGuilds(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/update-active-guilds`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger active guilds update");
  return response.json();
}

export async function triggerUpdateInactiveGuilds(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/update-inactive-guilds`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger inactive guilds update");
  return response.json();
}

export async function triggerUpdateAllGuilds(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/update-all-guilds`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger all guilds update");
  return response.json();
}

export async function triggerRefetchRecentReports(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/refetch-recent-reports`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger recent reports refetch");
  return response.json();
}

export async function triggerUpdateGuildCrests(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/update-guild-crests`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger guild crests update");
  return response.json();
}

export async function triggerRescanDeathEvents(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rescan-death-events`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger death events rescan");
  return response.json();
}

export async function triggerRescanCharacters(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rescan-characters`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger character rescan");
  return response.json();
}

export async function triggerBackfillReportCharacters(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/backfill-report-characters`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger report character backfill");
  return response.json();
}

export async function triggerBackfillCharacterRankings(refreshCandidates = false): Promise<CharacterRankingBackfillTriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/backfill-character-rankings`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshCandidates }),
  });
  if (!response.ok) throw new Error("Failed to trigger character ranking backfill");
  return response.json();
}

export async function triggerBackfillCharacterAchievements(refreshCandidates = false, refreshAll = false): Promise<CharacterAchievementBackfillTriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/backfill-character-achievements`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshCandidates, refreshAll }),
  });
  if (!response.ok) throw new Error("Failed to trigger character achievement backfill");
  return response.json();
}

export async function triggerBackfillMythicPlusHistorical(): Promise<MythicPlusCrawlerTriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/crawl-mythic-plus`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "historical" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Failed to trigger Mythic+ historical backfill");
  return data;
}

export async function triggerRefreshMythicPlusCurrentSeason(): Promise<MythicPlusCrawlerTriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/crawl-mythic-plus`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "current" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Failed to trigger Mythic+ current season refresh");
  return data;
}

export async function triggerRebuildCharacterAccountGroups(): Promise<CharacterAccountGroupRebuildResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rebuild-character-account-groups`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to rebuild character account groups");
  return response.json();
}

export async function triggerRebuildGuildNetworkSnapshot(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rebuild-guild-network`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger guild network snapshot rebuild");
  return response.json();
}

export async function triggerRebuildCharacterRankingLeaderboards(): Promise<CharacterRankingLeaderboardRebuildTriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rebuild-character-ranking-leaderboards`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger character ranking leaderboard rebuild");
  return response.json();
}

export async function triggerRebuildCharacterMechanicsLeaderboards(raidId?: number, scope: "all" | "current" = "current"): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rebuild-character-mechanics-leaderboards`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raidId, scope }),
  });
  if (!response.ok) throw new Error("Failed to trigger character mechanics leaderboard rebuild");
  return response.json();
}

export async function triggerRebuildCharacterTierLists(raidId?: number, scope: "all" | "current" = "current"): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rebuild-character-tier-lists`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raidId, scope }),
  });
  if (!response.ok) throw new Error("Failed to trigger character tier list rebuild");
  return response.json();
}

export async function triggerPruneCharacterRankingsWithoutMythicEvidence(): Promise<CharacterRankingMythicEvidenceCleanupResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/prune-character-rankings-without-mythic-evidence`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to prune character rankings without Mythic evidence");
  return response.json();
}

export async function triggerRebuildCharacterRaidParticipations(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/rebuild-character-raid-participations`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger character raid data rebuild");
  return response.json();
}

export async function triggerUpdateRaiderIOGuilds(): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/trigger/update-raiderio-guilds`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger Raider.IO guilds update");
  return response.json();
}

// ==================== Admin Guild Management Functions ====================

export async function getAdminGuildDetail(guildId: string): Promise<AdminGuildDetail> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch guild details");
  return response.json();
}

export async function recalculateGuildStats(guildId: string): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/recalculate-stats`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger guild stats recalculation");
  return response.json();
}

export async function updateGuildWorldRanks(guildId: string): Promise<TriggerResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/update-world-ranks`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to trigger guild world ranks update");
  return response.json();
}

export async function queueGuildRescan(guildId: string): Promise<QueueRescanResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/queue-rescan`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to queue guild for rescan");
  }
  return response.json();
}

export async function queueGuildRescanDeaths(guildId: string): Promise<QueueRescanResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/queue-rescan-deaths`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to queue guild for death events rescan");
  }
  return response.json();
}

export async function queueGuildRescanCharacters(guildId: string): Promise<QueueRescanResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/queue-rescan-characters`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to queue guild for character rescan");
  }
  return response.json();
}

export async function queueGuildBackfillReportCharacters(guildId: string): Promise<QueueRescanResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/queue-backfill-report-characters`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to queue guild for report character backfill");
  }
  return response.json();
}

export async function verifyGuildReports(guildId: string): Promise<VerifyReportsResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/verify-reports`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to verify guild reports");
  return response.json();
}

export async function getAdminGuildReports(guildId: string): Promise<AdminGuildReportsResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/reports`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch guild reports");
  return response.json();
}

export async function importAdminGuildReport(guildId: string, reportCode: string): Promise<AdminImportReportResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/reports/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reportCode }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to import report");
  }
  return response.json();
}

export async function deleteAdminReport(guildId: string, reportId: string): Promise<AdminDeleteReportResponse> {
  const response = await fetch(`${API_URL}/api/admin/guilds/${guildId}/reports/${reportId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to delete report");
  }
  return response.json();
}
