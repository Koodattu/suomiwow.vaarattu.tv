import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CcgActivityFilter, CcgBootstrapResponse, CcgCollectionSort, CharacterTierListRole, EventFilters } from "@/types";

const LIVE_STATUS_STALE_TIME = 15 * 60 * 1000;
const LIVE_STATUS_REFETCH_INTERVAL = 15 * 60 * 1000;
const CCG_BOOTSTRAP_QUERY_KEY = ["ccg", "bootstrap"] as const;

export type CharacterTierListQueryFilters = {
  minReports?: number;
  role?: CharacterTierListRole | null;
  classId?: number | null;
  limit?: number | "all";
};

// Query Key Factory
// Centralized query keys for cache management and invalidation.

export const queryKeys = {
  home: ["home"] as const,
  guilds: {
    list: ["guilds", "list"] as const,
    byRaid: (raidId: number) => ["guilds", "byRaid", raidId] as const,
    detail: (id: string) => ["guilds", "detail", id] as const,
    summary: (id: string) => ["guilds", "summary", id] as const,
    summaryByRealmName: (realm: string, name: string) => ["guilds", "summary", realm, name] as const,
    profile: (id: string) => ["guilds", "profile", id] as const,
    horseRaceUmaReservations: ["guilds", "horseRaceUmaReservations"] as const,
    bossProgress: (realm: string, name: string, raidId: number) => ["guilds", "bossProgress", realm, name, raidId] as const,
    bossPullHistory: (realm: string, name: string, raidId: number, bossId: number, difficulty: string) =>
      ["guilds", "bossPullHistory", realm, name, raidId, bossId, difficulty] as const,
    bossPrediction: (realm: string, name: string, raidId: number, bossId: number, difficulty: string) =>
      ["guilds", "bossPrediction", realm, name, raidId, bossId, difficulty] as const,
    schedules: ["guilds", "schedules"] as const,
    raidingToday: ["guilds", "raidingToday"] as const,
    liveStreamers: ["guilds", "liveStreamers"] as const,
  },
  events: {
    list: (limit: number) => ["events", "list", limit] as const,
    paginated: (page: number, limit: number, filters?: EventFilters) => ["events", "paginated", page, limit, filters] as const,
    guild: (guildId: string, limit: number) => ["events", "guild", guildId, limit] as const,
    guildByRealmName: (realm: string, name: string, limit: number) => ["events", "guildByRealmName", realm, name, limit] as const,
  },
  raids: {
    all: ["raids"] as const,
    detail: (raidId: number) => ["raids", "detail", raidId] as const,
    bosses: (raidId: number) => ["raids", "bosses", raidId] as const,
    dates: (raidId: number) => ["raids", "dates", raidId] as const,
  },
  tierLists: {
    overall: ["tierLists", "overall"] as const,
    forRaid: (raidId: number) => ["tierLists", "forRaid", raidId] as const,
    raids: ["tierLists", "raids"] as const,
  },
  characterTierLists: {
    raids: ["characterTierLists", "raids"] as const,
    global: (raidId: number, filters: CharacterTierListQueryFilters) => ["characterTierLists", "global", raidId, filters] as const,
    guild: (realm: string, name: string, raidId: number, filters: CharacterTierListQueryFilters) => ["characterTierLists", "guild", realm, name, raidId, filters] as const,
    custom: (realm: string, name: string, raidId: number) => ["characterTierLists", "custom", realm, name, raidId] as const,
    shared: (shareId: string) => ["characterTierLists", "shared", shareId] as const,
  },
  pickems: {
    list: ["pickems", "list"] as const,
    guilds: ["pickems", "guilds"] as const,
    rwfGuilds: ["pickems", "rwfGuilds"] as const,
    referenceRankings: (pickemId: string, raidId: number) => ["pickems", "referenceRankings", pickemId, raidId] as const,
  },
  characterRankings: {
    options: ["characterRankings", "options"] as const,
    list: (query: string) => ["characterRankings", "list", query] as const,
  },
  characterMechanics: {
    options: ["characterMechanics", "options"] as const,
    list: (query: string) => ["characterMechanics", "list", query] as const,
  },
  mythicPlus: {
    options: ["mythicPlus", "options"] as const,
    leaderboard: (query: string) => ["mythicPlus", "leaderboard", query] as const,
  },
  characters: {
    search: (query: string) => ["characters", "search", query] as const,
  },
  raidAnalytics: {
    raids: ["raidAnalytics", "raids"] as const,
    detail: (raidId: number) => ["raidAnalytics", "detail", raidId] as const,
    all: ["raidAnalytics", "all"] as const,
    bossProgression: ["raidAnalytics", "bossProgression"] as const,
  },
  guildNetwork: {
    meta: ["guildNetwork", "meta"] as const,
  },
  compare: {
    raid: (raidId: number) => ["compare", "raid", raidId] as const,
  },
  ccg: {
    analytics: ["ccg", "analytics"] as const,
    bootstrap: CCG_BOOTSTRAP_QUERY_KEY,
    session: CCG_BOOTSTRAP_QUERY_KEY,
    sets: CCG_BOOTSTRAP_QUERY_KEY,
    catalog: (setSlug: string | undefined, page: number, owned: string, grade: string, guildId: string, characterId: string, finish: string, sort: string, limit: number) => ["ccg", "catalog", setSlug ?? "all", page, owned, grade, guildId, characterId, finish, sort, limit] as const,
    featured: (setSlug: string) => ["ccg", "featured", setSlug] as const,
    guilds: (setSlug?: string) => ["ccg", "guilds", setSlug ?? "all"] as const,
    characterSearch: (search: string) => ["ccg", "characterSearch", search] as const,
    collection: (options: Record<string, unknown>) => ["ccg", "collection", options] as const,
    opening: (openingId: string) => ["ccg", "opening", openingId] as const,
    activity: (filter: CcgActivityFilter) => ["ccg", "activity", 6, filter] as const,
  },
} as const;

// Home

export function useHomeData() {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: () => api.getHomeData(),
    refetchInterval: 60 * 1000, // Auto-refresh every 1 minute
  });
}

// Guilds

export function useGuilds(raidId?: number, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.guilds.byRaid(raidId!),
    queryFn: () => api.getGuilds(raidId!),
    enabled: enabled && raidId !== undefined && raidId > 0,
    refetchInterval: 60 * 1000,
  });
}

export function useGuildList() {
  return useQuery({
    queryKey: queryKeys.guilds.list,
    queryFn: () => api.getGuildList(),
    staleTime: LIVE_STATUS_STALE_TIME,
    refetchInterval: LIVE_STATUS_REFETCH_INTERVAL,
    refetchOnWindowFocus: true,
  });
}

export function useHorseRaceUmaReservations() {
  return useQuery({
    queryKey: queryKeys.guilds.horseRaceUmaReservations,
    queryFn: () => api.getHorseRaceUmaReservations(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useGuildSummaryByRealmName(realm: string, name: string) {
  return useQuery({
    queryKey: queryKeys.guilds.summaryByRealmName(realm, name),
    queryFn: () => api.getGuildSummaryByRealmName(realm, name),
    enabled: !!realm && !!name,
    staleTime: LIVE_STATUS_STALE_TIME,
    refetchInterval: LIVE_STATUS_REFETCH_INTERVAL,
    refetchOnWindowFocus: true,
  });
}

export function useGuildBossProgress(realm: string, name: string, raidId: number) {
  return useQuery({
    queryKey: queryKeys.guilds.bossProgress(realm, name, raidId),
    queryFn: () => api.getGuildBossProgressByRealmName(realm, name, raidId),
    enabled: !!realm && !!name && raidId > 0,
  });
}

export function useBossPullHistory(realm: string, name: string, raidId: number, bossId: number, difficulty: "mythic" | "heroic") {
  return useQuery({
    queryKey: queryKeys.guilds.bossPullHistory(realm, name, raidId, bossId, difficulty),
    queryFn: () => api.getBossPullHistory(realm, name, raidId, bossId, difficulty),
    enabled: !!realm && !!name && raidId > 0 && bossId > 0,
  });
}

export function useBossPrediction(realm: string, name: string, raidId: number, bossId: number, difficulty: "mythic" | "heroic") {
  return useQuery({
    queryKey: queryKeys.guilds.bossPrediction(realm, name, raidId, bossId, difficulty),
    queryFn: () => api.getBossPrediction(realm, name, raidId, bossId, difficulty),
    enabled: !!realm && !!name && raidId > 0 && bossId > 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useGuildSchedules() {
  return useQuery({
    queryKey: queryKeys.guilds.schedules,
    queryFn: () => api.getGuildSchedules(),
    staleTime: 5 * 60 * 1000, // Schedules are slow-changing
  });
}

export function useRaidingToday() {
  return useQuery({
    queryKey: queryKeys.guilds.raidingToday,
    queryFn: () => api.getRaidingToday(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}

export function useLiveStreamers() {
  return useQuery({
    queryKey: queryKeys.guilds.liveStreamers,
    queryFn: () => api.getLiveStreamers(),
    refetchInterval: 60 * 1000, // Auto-refresh every minute
  });
}

// Events

export function useEventsPaginated(page: number, limit: number = 50, filters?: EventFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.events.paginated(page, limit, filters),
    queryFn: () => api.getEventsPaginated(page, limit, filters),
    enabled,
    refetchInterval: page === 1 ? 30 * 1000 : undefined, // Auto-refresh first page every 30s
  });
}

export function useEvents(limit: number = 50) {
  return useQuery({
    queryKey: queryKeys.events.list(limit),
    queryFn: () => api.getEvents(limit),
  });
}

export function useGuildEventsByRealmName(realm: string, name: string, limit: number = 50) {
  return useQuery({
    queryKey: queryKeys.events.guildByRealmName(realm, name, limit),
    queryFn: () => api.getGuildEventsByRealmName(realm, name, limit),
    enabled: !!realm && !!name,
  });
}

// Raids

export function useRaids() {
  return useQuery({
    queryKey: queryKeys.raids.all,
    queryFn: () => api.getRaids(),
    staleTime: 10 * 60 * 1000, // Raids list is very slow-changing
  });
}

export function useBosses(raidId: number | null) {
  return useQuery({
    queryKey: queryKeys.raids.bosses(raidId!),
    queryFn: () => api.getBosses(raidId!),
    enabled: raidId !== null && raidId > 0,
    staleTime: 10 * 60 * 1000, // Boss list is very slow-changing
  });
}

export function useRaidDates(raidId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.raids.dates(raidId!),
    queryFn: () => api.getRaidDates(raidId!),
    enabled: enabled && raidId !== null && raidId > 0,
  });
}

// Tier Lists

export function useTierListRaids() {
  return useQuery({
    queryKey: queryKeys.tierLists.raids,
    queryFn: () => api.getTierListRaids(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useOverallTierList(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.tierLists.overall,
    queryFn: () => api.getOverallTierList(),
    enabled,
  });
}

export function useTierListForRaid(raidId: number | null) {
  return useQuery({
    queryKey: queryKeys.tierLists.forRaid(raidId!),
    queryFn: () => api.getTierListForRaid(raidId!),
    enabled: raidId !== null && raidId > 0,
  });
}

export function useCharacterTierListRaids() {
  return useQuery({
    queryKey: queryKeys.characterTierLists.raids,
    queryFn: () => api.getCharacterTierListRaids(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useGlobalCharacterTierList(raidId: number | null, filters: CharacterTierListQueryFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.characterTierLists.global(raidId!, filters),
    queryFn: () => api.getGlobalCharacterTierList(raidId!, filters),
    enabled: enabled && raidId !== null && raidId > 0,
  });
}

export function useGuildCharacterTierList(realm: string, name: string, raidId: number | null, filters: CharacterTierListQueryFilters, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.characterTierLists.guild(realm, name, raidId!, filters),
    queryFn: () => api.getGuildCharacterTierList(realm, name, raidId!, filters),
    enabled: enabled && !!realm && !!name && raidId !== null && raidId > 0,
  });
}

export function useCustomCharacterTierList(realm: string, name: string, raidId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.characterTierLists.custom(realm, name, raidId!),
    queryFn: () => api.getCustomCharacterTierList(realm, name, raidId!),
    enabled: enabled && !!realm && !!name && raidId !== null && raidId > 0,
  });
}

export function useSharedCharacterTierList(shareId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.characterTierLists.shared(shareId ?? ""),
    queryFn: () => api.getSharedCharacterTierList(shareId!),
    enabled: enabled && !!shareId,
  });
}

// Pickems

export function usePickems() {
  return useQuery({
    queryKey: queryKeys.pickems.list,
    queryFn: () => api.getPickems(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function usePickemsGuilds(raidType: string) {
  return useQuery({
    queryKey: raidType === "overall" ? queryKeys.pickems.guilds : queryKeys.pickems.rwfGuilds,
    queryFn: () => (raidType === "overall" ? api.getPickemsGuilds() : api.getPickemsRwfGuilds()),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePickemReferenceRankings(pickemId: string, raidId: number | null) {
  return useQuery({
    queryKey: queryKeys.pickems.referenceRankings(pickemId, raidId!),
    queryFn: () => api.getPickemReferenceRankings(pickemId, raidId!),
    enabled: !!pickemId && raidId !== null,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

// Character Rankings

export function useCharacterRankingOptions() {
  return useQuery({
    queryKey: queryKeys.characterRankings.options,
    queryFn: () => api.getCharacterRankingOptions(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCharacterRankings(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.characterRankings.list(query),
    queryFn: () => api.getCharacterRankings(query),
    enabled,
  });
}

export function useCharacterMechanicsOptions() {
  return useQuery({
    queryKey: queryKeys.characterMechanics.options,
    queryFn: () => api.getCharacterMechanicsOptions(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCharacterMechanics(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.characterMechanics.list(query),
    queryFn: () => api.getCharacterMechanics(query),
    enabled,
  });
}

export function useMythicPlusOptions(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.mythicPlus.options,
    queryFn: () => api.getMythicPlusOptions(),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
}

export function useMythicPlusLeaderboard(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.mythicPlus.leaderboard(query),
    queryFn: () => api.getMythicPlusLeaderboard(query),
    enabled,
  });
}

export function useCharacterSearch(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.characters.search(query),
    queryFn: () => api.searchCharacters(query, 10),
    enabled,
    staleTime: 60 * 1000,
  });
}

// Raid Analytics

export function useRaidAnalyticsRaids() {
  return useQuery({
    queryKey: queryKeys.raidAnalytics.raids,
    queryFn: () => api.getRaidAnalyticsRaids(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRaidAnalytics(raidId: number | null) {
  return useQuery({
    queryKey: queryKeys.raidAnalytics.detail(raidId!),
    queryFn: () => api.getRaidAnalytics(raidId!),
    enabled: raidId !== null && raidId > 0,
  });
}

export function useAllRaidAnalytics(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.raidAnalytics.all,
    queryFn: () => api.getAllRaidAnalytics(),
    enabled,
  });
}

export function useRaidBossProgressionComparison(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.raidAnalytics.bossProgression,
    queryFn: () => api.getRaidBossProgressionComparison(),
    enabled,
  });
}

export function useGuildNetworkMeta() {
  return useQuery({
    queryKey: queryKeys.guildNetwork.meta,
    queryFn: () => api.getGuildNetworkMeta(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Compare

export function useRaidCompare(raidId: number | null) {
  return useQuery({
    queryKey: queryKeys.compare.raid(raidId!),
    queryFn: () => api.getRaidCompare(raidId!),
    enabled: raidId !== null && raidId > 0,
  });
}

export function useCcgSession(enabled = true) {
  return useQuery({
    queryKey: queryKeys.ccg.session,
    queryFn: () => api.getCcgBootstrap(),
    select: (bootstrap: CcgBootstrapResponse) => bootstrap.session,
    enabled,
    staleTime: 15 * 1000,
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      if (!session) return false;
      const nextRecharge = (["current", "legacy"] as const)
        .filter((mode) => session.packs[mode].totalRemaining < session.recharge[mode].cap)
        .map((mode) => new Date(session.recharge[mode].nextAt).getTime());
      if (nextRecharge.length === 0) return false;
      return Math.max(1_000, Math.min(...nextRecharge) - Date.now() + 1_000);
    },
  });
}

export function useCcgAnalytics() {
  return useQuery({
    queryKey: queryKeys.ccg.analytics,
    queryFn: () => api.getCcgAnalytics(),
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}

export function useCcgSets(enabled = true) {
  return useQuery({
    queryKey: queryKeys.ccg.sets,
    queryFn: () => api.getCcgBootstrap(),
    select: (bootstrap: CcgBootstrapResponse) => ({ sets: bootstrap.sets }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCcgCatalog(setSlug: string | undefined, page: number, owned: "all" | "owned" | "missing", grade: string, guildId = "", characterId = "", finish = "", sort: CcgCollectionSort | "" = "", enabled = true, limit = 9) {
  return useQuery({
    queryKey: queryKeys.ccg.catalog(setSlug, page, owned, grade, guildId, characterId, finish, sort, limit),
    queryFn: () => api.getCcgCatalog(setSlug, { page, limit, owned, grade: grade || undefined, guild: guildId || undefined, character: characterId || undefined, finish: finish || undefined, sort: sort || undefined }),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useCcgFeaturedCard(setSlug: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ccg.featured(setSlug),
    queryFn: () => api.getCcgFeaturedCard(setSlug),
    enabled: enabled && Boolean(setSlug),
    staleTime: 60 * 60 * 1000,
  });
}

export function useCcgCollectionGuilds(setSlug?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ccg.guilds(setSlug),
    queryFn: () => api.getCcgCollectionGuilds(setSlug),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCcgCollectionCharacterSearch(search: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ccg.characterSearch(search),
    queryFn: () => api.searchCcgCollectionCharacters(search, 10),
    enabled: enabled && search.length >= 2,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCcgCollection(options: { page?: number; limit?: number; set?: string; grade?: string; finish?: string; search?: string; guild?: string; character?: string; sort?: CcgCollectionSort; alternative?: boolean }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ccg.collection(options),
    queryFn: () => api.getCcgCollection(options),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useCcgOpening(openingId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ccg.opening(openingId),
    queryFn: () => api.getCcgOpening(openingId),
    enabled: enabled && Boolean(openingId),
    staleTime: Infinity,
  });
}

export function useCcgActivity(filter: CcgActivityFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.ccg.activity(filter),
    queryFn: ({ pageParam }) => api.getCcgActivity({
      filter,
      cursor: pageParam ?? undefined,
      limit: 20,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
