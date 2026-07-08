"use client";

import { useEffect, useMemo, useState } from "react";
import { useCharacterMechanics, useCharacterMechanicsOptions, useCharacterRankingOptions, useBosses, useCharacterRankings } from "@/lib/queries";
import { RankingTableWrapper } from "@/components/RankingTableWrapper";
import CharacterRankingsRaidPartitionSelector, { type CharacterRankingsSelection } from "@/components/CharacterRankingsRaidPartitionSelector";
import MythicPlusLeaderboard from "@/components/MythicPlusLeaderboard";

type Filters = {
  zoneId?: number;
  encounterId?: number;
  classId?: number | null;
  specName?: string | null;
  metric?: "dps" | "hps";
  page?: number;
  limit?: number;
  partition?: number | null;
  characterName?: string | null;
  guildName?: string | null;
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
    description: "Survival score by raid.",
  },
  {
    id: "combined",
    label: "Combined",
    title: "Combined Score",
    description: "Combined parse and survival score by raid.",
  },
  {
    id: "mythic-plus",
    label: "Mythic+",
    title: "Mythic+ Leaderboard",
    description: "Season score and highest dungeon keys by character.",
  },
];

function buildQuery(filters: Filters) {
  const sp = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default function CharacterRankingsPage() {
  const [activeTab, setActiveTab] = useState<CharacterTab>("rankings");
  const [selectedRaidPartition, setSelectedRaidPartition] = useState<CharacterRankingsSelection | null>(null);
  const [filters, setFilters] = useState<Filters>({
    limit: 100,
    page: 1,
  });

  // ─── React Query hooks ───────────────────────────────────────────────────────

  const isMechanicsBackedTab = activeTab === "mechanics" || activeTab === "combined";
  const isMythicPlusTab = activeTab === "mythic-plus";
  const activeTabConfig = CHARACTER_TABS.find((tab) => tab.id === activeTab) ?? CHARACTER_TABS[0];
  const { data: rankingOptionsData, isLoading: rankingOptionsLoading, error: rankingOptionsError } = useCharacterRankingOptions();
  const { data: mechanicsOptionsData, isLoading: mechanicsOptionsLoading, error: mechanicsOptionsError } = useCharacterMechanicsOptions();
  const optionsData = isMechanicsBackedTab ? (mechanicsOptionsData ?? rankingOptionsData) : rankingOptionsData;
  const optionsLoading = isMythicPlusTab ? false : isMechanicsBackedTab ? mechanicsOptionsLoading && !rankingOptionsData : rankingOptionsLoading;
  const optionsError = isMythicPlusTab ? null : isMechanicsBackedTab ? (mechanicsOptionsError ?? rankingOptionsError) : rankingOptionsError;
  const { data: bosses = [] } = useBosses(selectedRaidPartition?.zoneId ?? null);

  const queryFilters = useMemo<Filters>(() => {
    if (!isMechanicsBackedTab) return filters;
    const scoreType: Filters["scoreType"] = activeTab === "mechanics" ? "survival" : "combined";
    return { ...filters, partition: undefined, scoreType };
  }, [activeTab, filters, isMechanicsBackedTab]);
  const queryString = useMemo(() => buildQuery(queryFilters), [queryFilters]);
  const rankingsEnabled = activeTab === "rankings" && !!filters.zoneId;
  const mechanicsEnabled = isMechanicsBackedTab && !!filters.zoneId;
  const { data: rankingsData, isLoading: rankingsLoading, error: rankingsError } = useCharacterRankings(queryString, rankingsEnabled);
  const { data: mechanicsData, isLoading: mechanicsLoading, error: mechanicsError } = useCharacterMechanics(queryString, mechanicsEnabled);

  // ─── Derived state ───────────────────────────────────────────────────────────

  const raidOptions = optionsData?.raids ?? [];
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

  // ─── Initialize selection from options ────────────────────────────────────────

  useEffect(() => {
    if (!optionsData) return;
    if (selectedRaidPartition && raidOptions.some((raid) => raid.id === selectedRaidPartition.zoneId)) return;

    const defaultSelection: CharacterRankingsSelection = {
      zoneId: optionsData.defaultSelection.zoneId,
      partition: optionsData.defaultSelection.partition,
    };

    setSelectedRaidPartition(defaultSelection);
    setFilters((prev) => ({
      ...prev,
      zoneId: defaultSelection.zoneId,
      partition: isMechanicsBackedTab ? undefined : defaultSelection.partition,
      page: 1,
    }));
  }, [isMechanicsBackedTab, optionsData, raidOptions, selectedRaidPartition]);

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  const handleRaidPartitionChange = (selection: CharacterRankingsSelection) => {
    setSelectedRaidPartition(selection);
    setFilters((prev) => ({
      ...prev,
      zoneId: selection.zoneId,
      partition: isMechanicsBackedTab ? undefined : selection.partition,
      encounterId: undefined,
      page: 1,
    }));
  };

  const handleTabChange = (tab: CharacterTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setFilters((prev) => ({
      ...prev,
      partition: tab === "rankings" ? (selectedRaidPartition?.partition ?? null) : undefined,
      encounterId: undefined,
      page: 1,
    }));
  };

  return (
    <div className="container mx-auto px-3 md:px-4 max-w-full md:max-w-[95%] lg:max-w-[90%] py-6">
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white">{activeTabConfig.title}</h1>
          <p className="text-gray-500 text-sm">{activeTabConfig.description}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end lg:ml-auto">
          <div className="inline-flex self-start rounded-md bg-gray-900/80 p-1 ring-1 ring-white/10 sm:self-auto">
            {CHARACTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`min-h-10 rounded px-4 py-2 text-sm font-semibold transition-[background-color,color,transform] active:scale-[0.96] ${
                  activeTab === tab.id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {!isMythicPlusTab ? (
            <CharacterRankingsRaidPartitionSelector
              raids={raidOptions}
              selected={selectedRaidPartition}
              onChange={handleRaidPartitionChange}
              label={isMechanicsBackedTab ? "Raid" : undefined}
              showPartitions={!isMechanicsBackedTab}
            />
          ) : null}
        </div>
      </div>

      {isMythicPlusTab ? (
        <MythicPlusLeaderboard />
      ) : (
        <RankingTableWrapper
          key={`${activeTab}-${selectedRaidPartition?.zoneId ?? "none"}`}
          data={rows}
          bosses={bosses}
          variant={activeTab}
          partitionOptions={[]}
          showPartitionSelector={false}
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
