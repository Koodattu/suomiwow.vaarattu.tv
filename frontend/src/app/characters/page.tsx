"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCharacterMechanics, useCharacterMechanicsOptions, useCharacterRankingOptions, useBosses, useCharacterRankings, useMythicPlusOptions } from "@/lib/queries";
import { RankingTableWrapper, type RankingFilters } from "@/components/RankingTableWrapper";
import CharacterRankingsRaidPartitionSelector, { type CharacterRankingsSelection } from "@/components/CharacterRankingsRaidPartitionSelector";
import MythicPlusLeaderboard, { type MythicPlusLeaderboardFilters } from "@/components/MythicPlusLeaderboard";
import { getAllClasses } from "@/lib/utils";

type Filters = RankingFilters & {
  zoneId?: number;
  limit?: number;
  scoreType?: "combined" | "survival";
};

type CharacterTab = "rankings" | "mechanics" | "combined" | "mythic-plus";

const CHARACTER_TABS: Array<{
  id: CharacterTab;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "rankings",
    label: "Rankings",
    title: "Character Rankings",
    description: "Select a raid or a specific patch partition.",
  },
  {
    id: "mechanics",
    label: "Mechanics",
    title: "Mechanics",
    description: "Mechanics percentile by raid.",
  },
  {
    id: "combined",
    label: "Combined",
    title: "Combined Score",
    description: "Combined parse and mechanics percentile by raid.",
  },
  {
    id: "mythic-plus",
    label: "Mythic+",
    title: "Mythic+ Leaderboard",
    description: "Season score and highest dungeon keys by character.",
  },
];

const DEFAULT_MYTHIC_PLUS_FILTERS: MythicPlusLeaderboardFilters = {
  bucket: "all",
  dungeonSort: "score",
  page: 1,
  limit: 50,
};

const DEFAULT_RANKING_FILTERS: Filters = {
  limit: 100,
  metric: "dps",
  page: 1,
};

type ReadableSearchParams = Pick<URLSearchParams, "get">;

function getPositiveInteger(params: ReadableSearchParams, name: string): number | undefined {
  const value = Number(params.get(name));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function getTrimmedParam(params: ReadableSearchParams, name: string, maxLength = 64): string | null {
  const value = params.get(name)?.trim().slice(0, maxLength) ?? "";
  return value || null;
}

function getClassFilters(params: ReadableSearchParams) {
  const requestedClassId = getPositiveInteger(params, "class");
  const selectedClass = requestedClassId ? getAllClasses().find((classInfo) => classInfo.id === requestedClassId) : null;
  const requestedSpec = getTrimmedParam(params, "spec", 40);
  const specName = selectedClass?.specs.some((spec) => spec.name === requestedSpec) ? requestedSpec : null;

  return {
    classId: selectedClass?.id ?? null,
    specName,
  };
}

function getRankingUrlState(params: ReadableSearchParams) {
  const zoneId = getPositiveInteger(params, "raid");
  const partition = zoneId ? (getPositiveInteger(params, "patch") ?? null) : null;
  const classFilters = getClassFilters(params);

  return {
    selection: zoneId ? { zoneId, partition } satisfies CharacterRankingsSelection : null,
    filters: {
      ...DEFAULT_RANKING_FILTERS,
      ...classFilters,
      zoneId,
      partition,
      encounterId: getPositiveInteger(params, "boss"),
      metric: params.get("role") === "hps" ? "hps" : "dps",
      characterName: getTrimmedParam(params, "character"),
      guildName: getTrimmedParam(params, "guild"),
      page: getPositiveInteger(params, "page") ?? 1,
    } satisfies Filters,
  };
}

function getMythicPlusUrlState(params: ReadableSearchParams): MythicPlusLeaderboardFilters {
  const requestedRole = params.get("role");
  const bucket = requestedRole === "dps" || requestedRole === "healer" || requestedRole === "tank" ? requestedRole : "all";
  const classFilters = getClassFilters(params);
  const dungeonId = getPositiveInteger(params, "dungeon") ?? null;

  return {
    ...DEFAULT_MYTHIC_PLUS_FILTERS,
    ...classFilters,
    season: getTrimmedParam(params, "season", 80),
    bucket,
    dungeonId,
    dungeonSort: dungeonId && params.get("sort") === "level" ? "level" : "score",
    search: getTrimmedParam(params, "search"),
    page: getPositiveInteger(params, "page") ?? 1,
  };
}

function buildCharactersUrl(
  tab: CharacterTab,
  filters: Filters,
  selectedRaidPartition: CharacterRankingsSelection | null,
  mythicPlusFilters: MythicPlusLeaderboardFilters,
) {
  const params = new URLSearchParams();
  params.set("tab", tab);

  if (tab === "mythic-plus") {
    if (mythicPlusFilters.season) params.set("season", mythicPlusFilters.season);
    if (mythicPlusFilters.bucket !== "all") params.set("role", mythicPlusFilters.bucket);
    if (mythicPlusFilters.dungeonId) params.set("dungeon", String(mythicPlusFilters.dungeonId));
    if (mythicPlusFilters.dungeonId && mythicPlusFilters.dungeonSort !== "score") params.set("sort", mythicPlusFilters.dungeonSort);
    if (mythicPlusFilters.classId) params.set("class", String(mythicPlusFilters.classId));
    if (mythicPlusFilters.specName) params.set("spec", mythicPlusFilters.specName);
    if (mythicPlusFilters.search) params.set("search", mythicPlusFilters.search);
    if (mythicPlusFilters.page > 1) params.set("page", String(mythicPlusFilters.page));
  } else {
    const zoneId = selectedRaidPartition?.zoneId ?? filters.zoneId;
    if (zoneId) params.set("raid", String(zoneId));
    if (selectedRaidPartition?.partition) params.set("patch", String(selectedRaidPartition.partition));
    if (filters.encounterId) params.set("boss", String(filters.encounterId));
    if (filters.classId) params.set("class", String(filters.classId));
    if (filters.specName) params.set("spec", filters.specName);
    if (filters.metric === "hps") params.set("role", "hps");
    if (filters.characterName) params.set("character", filters.characterName);
    if (filters.guildName) params.set("guild", filters.guildName);
    if ((filters.page ?? 1) > 1) params.set("page", String(filters.page));
  }

  return `?${params.toString()}`;
}

function getCharacterTab(value: string | null): CharacterTab {
  return CHARACTER_TABS.some((tab) => tab.id === value) ? (value as CharacterTab) : "rankings";
}

function buildQuery(filters: Filters) {
  const sp = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function CharacterRankingsContent() {
  const searchParamsKey = useSearchParams().toString();
  return <CharacterRankingsState key={searchParamsKey} searchParamsKey={searchParamsKey} />;
}

function CharacterRankingsState({ searchParamsKey }: { searchParamsKey: string }) {
  const searchParams = useMemo(() => new URLSearchParams(searchParamsKey), [searchParamsKey]);
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("characterRankingsPage");
  const activeTab = getCharacterTab(searchParams.get("tab"));
  const [selectedRaidPartition, setSelectedRaidPartition] = useState<CharacterRankingsSelection | null>(() => getRankingUrlState(searchParams).selection);
  const [filters, setFilters] = useState<Filters>(() => getRankingUrlState(searchParams).filters);
  const [mythicPlusFilters, setMythicPlusFilters] = useState<MythicPlusLeaderboardFilters>(() => getMythicPlusUrlState(searchParams));

  // ─── React Query hooks ───────────────────────────────────────────────────────

  const isMechanicsBackedTab = activeTab === "mechanics" || activeTab === "combined";
  const isMythicPlusTab = activeTab === "mythic-plus";
  const activeTabConfig = CHARACTER_TABS.find((tab) => tab.id === activeTab) ?? CHARACTER_TABS[0];
  const { data: rankingOptionsData, isLoading: rankingOptionsLoading, error: rankingOptionsError } = useCharacterRankingOptions(!isMythicPlusTab);
  const { data: mechanicsOptionsData, isLoading: mechanicsOptionsLoading, error: mechanicsOptionsError } = useCharacterMechanicsOptions(isMechanicsBackedTab);
  const { data: mythicPlusOptions, isLoading: mythicPlusOptionsLoading, error: mythicPlusOptionsError } = useMythicPlusOptions(isMythicPlusTab);
  const optionsData = isMechanicsBackedTab ? (mechanicsOptionsData ?? rankingOptionsData) : rankingOptionsData;
  const optionsLoading = isMythicPlusTab ? false : isMechanicsBackedTab ? mechanicsOptionsLoading && !rankingOptionsData : rankingOptionsLoading;
  const optionsError = isMythicPlusTab ? null : isMechanicsBackedTab ? (mechanicsOptionsError ?? rankingOptionsError) : rankingOptionsError;
  const raidOptions = useMemo(() => optionsData?.raids ?? [], [optionsData]);
  const defaultRaidSelection = useMemo<CharacterRankingsSelection | null>(() => {
    if (!optionsData) return null;
    return {
      zoneId: optionsData.defaultSelection.zoneId,
      partition: optionsData.defaultSelection.partition,
    };
  }, [optionsData]);
  const resolvedRaidSelection = useMemo<CharacterRankingsSelection | null>(() => {
    if (!optionsData) return selectedRaidPartition;
    const selectedRaid = selectedRaidPartition ? raidOptions.find((raid) => raid.id === selectedRaidPartition.zoneId) : null;
    const partitionIsAvailable =
      selectedRaidPartition?.partition === null || !!selectedRaid?.partitions.some((partition) => partition.id === selectedRaidPartition?.partition);
    return selectedRaid && partitionIsAvailable ? selectedRaidPartition : defaultRaidSelection;
  }, [defaultRaidSelection, optionsData, raidOptions, selectedRaidPartition]);
  const resolvedFilters = useMemo<Filters>(() => {
    if (!resolvedRaidSelection) return filters;
    const raidChanged = filters.zoneId !== resolvedRaidSelection.zoneId;
    return {
      ...filters,
      zoneId: resolvedRaidSelection.zoneId,
      partition: resolvedRaidSelection.partition,
      encounterId: raidChanged ? undefined : filters.encounterId,
      page: raidChanged ? 1 : filters.page,
    };
  }, [filters, resolvedRaidSelection]);
  const defaultMythicPlusSeason = useMemo(() => {
    if (!mythicPlusOptions) return null;
    return mythicPlusOptions.seasons.find((season) => season.slug === mythicPlusOptions.defaultSelection.season)?.slug ?? mythicPlusOptions.seasons[0]?.slug ?? null;
  }, [mythicPlusOptions]);
  const resolvedMythicPlusFilters = useMemo<MythicPlusLeaderboardFilters>(() => {
    if (!mythicPlusOptions) return mythicPlusFilters;
    const selectedSeason = mythicPlusOptions.seasons.find((season) => season.slug === mythicPlusFilters.season);
    const season = selectedSeason?.slug ?? defaultMythicPlusSeason;
    const dungeonIsAvailable = !!mythicPlusFilters.dungeonId && !!selectedSeason?.dungeons.some((dungeon) => dungeon.id === mythicPlusFilters.dungeonId);
    const dungeonId = dungeonIsAvailable ? mythicPlusFilters.dungeonId : null;
    return {
      ...mythicPlusFilters,
      season,
      dungeonId,
      dungeonSort: dungeonId ? mythicPlusFilters.dungeonSort : "score",
      page: selectedSeason ? mythicPlusFilters.page : 1,
    };
  }, [defaultMythicPlusSeason, mythicPlusFilters, mythicPlusOptions]);
  const { data: bosses = [] } = useBosses(isMythicPlusTab ? null : (resolvedRaidSelection?.zoneId ?? null));

  const queryFilters = useMemo<Filters>(() => {
    if (!isMechanicsBackedTab) return resolvedFilters;
    const scoreType: Filters["scoreType"] = activeTab === "mechanics" ? "survival" : "combined";
    return { ...resolvedFilters, partition: undefined, scoreType };
  }, [activeTab, isMechanicsBackedTab, resolvedFilters]);
  const queryString = useMemo(() => buildQuery(queryFilters), [queryFilters]);
  const rankingsEnabled = activeTab === "rankings" && !!resolvedFilters.zoneId;
  const mechanicsEnabled = isMechanicsBackedTab && !!resolvedFilters.zoneId;
  const { data: rankingsData, isLoading: rankingsLoading, error: rankingsError } = useCharacterRankings(queryString, rankingsEnabled);
  const { data: mechanicsData, isLoading: mechanicsLoading, error: mechanicsError } = useCharacterMechanics(queryString, mechanicsEnabled);

  // ─── Derived state ───────────────────────────────────────────────────────────

  const activeData = isMechanicsBackedTab ? mechanicsData : rankingsData;
  const rows = activeData?.data ?? [];
  const pagination = activeData?.pagination ?? {
    totalItems: 0,
    totalRankedItems: 0,
    totalPages: 0,
    currentPage: 1,
    pageSize: 100,
  };
  const loading = optionsLoading || (isMechanicsBackedTab ? mechanicsLoading : rankingsLoading);
  const error = optionsError?.message ?? (isMechanicsBackedTab ? mechanicsError?.message : rankingsError?.message) ?? null;

  const hasResettableRankingState =
    (!!resolvedRaidSelection &&
      !!defaultRaidSelection &&
      (resolvedRaidSelection.zoneId !== defaultRaidSelection.zoneId ||
        (activeTab === "rankings" && resolvedRaidSelection.partition !== defaultRaidSelection.partition))) ||
      !!resolvedFilters.encounterId ||
      !!resolvedFilters.classId ||
      !!resolvedFilters.specName ||
      resolvedFilters.metric === "hps" ||
      !!resolvedFilters.characterName ||
      !!resolvedFilters.guildName ||
      (resolvedFilters.page ?? 1) > 1;
  const hasResettableMythicPlusState =
    (!!resolvedMythicPlusFilters.season && !!defaultMythicPlusSeason && resolvedMythicPlusFilters.season !== defaultMythicPlusSeason) ||
    resolvedMythicPlusFilters.bucket !== "all" ||
    !!resolvedMythicPlusFilters.dungeonId ||
    resolvedMythicPlusFilters.dungeonSort !== "score" ||
    !!resolvedMythicPlusFilters.classId ||
    !!resolvedMythicPlusFilters.specName ||
    !!resolvedMythicPlusFilters.search ||
    resolvedMythicPlusFilters.page > 1;
  const canResetContext = isMythicPlusTab
    ? !!defaultMythicPlusSeason && resolvedMythicPlusFilters.season !== defaultMythicPlusSeason
    : !!defaultRaidSelection &&
      !!resolvedRaidSelection &&
      (resolvedRaidSelection.zoneId !== defaultRaidSelection.zoneId ||
        (activeTab === "rankings" && resolvedRaidSelection.partition !== defaultRaidSelection.partition));
  const canResetAll = isMythicPlusTab ? hasResettableMythicPlusState : hasResettableRankingState;

  useEffect(() => {
    const nextUrl = buildCharactersUrl(activeTab, resolvedFilters, resolvedRaidSelection, resolvedMythicPlusFilters);
    const nextSearchParamsKey = nextUrl.slice(1);
    if (nextSearchParamsKey === searchParamsKey) return;

    router.replace(`${pathname}${nextUrl}`, { scroll: false });
  }, [activeTab, pathname, resolvedFilters, resolvedMythicPlusFilters, resolvedRaidSelection, router, searchParamsKey]);

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  const handleRaidPartitionChange = (selection: CharacterRankingsSelection) => {
    setSelectedRaidPartition(selection);
    setFilters((prev) => ({
      ...prev,
      zoneId: selection.zoneId,
      partition: selection.partition,
      encounterId: undefined,
      page: 1,
    }));
  };

  const handleMythicPlusFiltersChange = (patch: Partial<MythicPlusLeaderboardFilters>) => {
    setMythicPlusFilters((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  };

  const resetRaidSelection = useCallback(() => {
    if (!defaultRaidSelection) return;
    setSelectedRaidPartition(defaultRaidSelection);
    setFilters((prev) => ({
      ...prev,
      zoneId: defaultRaidSelection.zoneId,
      partition: defaultRaidSelection.partition,
      encounterId: undefined,
      page: 1,
    }));
  }, [defaultRaidSelection]);

  const resetSeasonSelection = useCallback(() => {
    if (!defaultMythicPlusSeason) return;
    setMythicPlusFilters((prev) => ({ ...prev, season: defaultMythicPlusSeason, dungeonId: null, dungeonSort: "score", page: 1 }));
  }, [defaultMythicPlusSeason]);

  const resetAllFilters = useCallback(() => {
    if (isMythicPlusTab) {
      setMythicPlusFilters({ ...DEFAULT_MYTHIC_PLUS_FILTERS, season: defaultMythicPlusSeason });
      return;
    }

    setSelectedRaidPartition(defaultRaidSelection);
    setFilters({
      ...DEFAULT_RANKING_FILTERS,
      zoneId: defaultRaidSelection?.zoneId,
      partition: defaultRaidSelection?.partition ?? null,
    });
  }, [defaultMythicPlusSeason, defaultRaidSelection, isMythicPlusTab]);

  return (
    <div className="container mx-auto px-3 md:px-4 max-w-full md:max-w-[95%] lg:max-w-[90%] py-6">
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white">{activeTabConfig.title}</h1>
          <p className="text-gray-500 text-sm">{activeTabConfig.description}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end lg:ml-auto">
          <div className="inline-flex self-start rounded-md bg-gray-900/80 p-1 ring-1 ring-white/10 sm:self-auto">
            {CHARACTER_TABS.map((tab) => {
              return (
                <Link
                  key={tab.id}
                  href={buildCharactersUrl(tab.id, resolvedFilters, resolvedRaidSelection, resolvedMythicPlusFilters)}
                  scroll={false}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  className={`flex min-h-10 items-center rounded px-3 py-2 text-sm font-semibold transition-[background-color,color,transform] active:scale-[0.96] sm:px-4 ${
                    activeTab === tab.id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
          {isMythicPlusTab ? (
            <div className="w-full sm:w-auto">
              <label htmlFor="mythic-plus-season-select" className="mb-1 block text-xs text-gray-400">
                {t("season")}
              </label>
              <select
                id="mythic-plus-season-select"
                value={resolvedMythicPlusFilters.season ?? ""}
                disabled={mythicPlusOptionsLoading || !mythicPlusOptions?.seasons.length}
                onChange={(event) => handleMythicPlusFiltersChange({ season: event.target.value || null, dungeonId: null, dungeonSort: "score" })}
                className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[220px]"
              >
                {mythicPlusOptions?.seasons.map((season) => (
                  <option key={season.slug} value={season.slug}>
                    {season.shortName || season.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <CharacterRankingsRaidPartitionSelector
              raids={raidOptions}
              selected={resolvedRaidSelection}
              onChange={handleRaidPartitionChange}
              label={isMechanicsBackedTab ? "Raid" : undefined}
              showPartitions={!isMechanicsBackedTab}
            />
          )}
          {canResetContext ? (
            <button
              type="button"
              onClick={isMythicPlusTab ? resetSeasonSelection : resetRaidSelection}
              aria-label={isMythicPlusTab ? t("resetSeason") : t("resetRaid")}
              title={isMythicPlusTab ? t("resetSeason") : t("resetRaid")}
              className="inline-flex min-h-10 w-9 shrink-0 items-center justify-center self-end rounded-md border border-red-500/30 bg-red-950/20 text-xl leading-none text-red-300 transition-colors hover:bg-red-950/50 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              ×
            </button>
          ) : null}
          {canResetAll ? (
            <button
              type="button"
              onClick={resetAllFilters}
              className="min-h-10 shrink-0 self-end rounded-md border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-950/50 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {t("resetAll")}
            </button>
          ) : null}
        </div>
      </div>

      {isMythicPlusTab ? (
        <MythicPlusLeaderboard
          filters={resolvedMythicPlusFilters}
          onFiltersChange={handleMythicPlusFiltersChange}
          options={mythicPlusOptions}
          optionsLoading={mythicPlusOptionsLoading}
          optionsError={mythicPlusOptionsError}
        />
      ) : (
        <RankingTableWrapper
          key={`${activeTab}-${resolvedRaidSelection?.zoneId ?? "none"}-${resolvedFilters.characterName ?? ""}-${resolvedFilters.guildName ?? ""}`}
          data={rows}
          bosses={bosses}
          variant={activeTab}
          partitionOptions={[]}
          showPartitionSelector={false}
          filters={resolvedFilters}
          loading={loading}
          error={error}
          pagination={pagination}
          onFiltersChange={(newFilters) => {
            setFilters((prev) => ({ ...prev, ...newFilters }));
          }}
        />
      )}
    </div>
  );
}

export default function CharacterRankingsPage() {
  return (
    <Suspense fallback={null}>
      <CharacterRankingsContent />
    </Suspense>
  );
}
