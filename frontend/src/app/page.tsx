"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { GuildListItem, Guild, Boss } from "@/types";
import { api } from "@/lib/api";
import { useHomeData, useEventsPaginated, useGuilds, useRaidDates, useHorseRaceUmaReservations } from "@/lib/queries";
import { useEventFiltersFromLocalStorage } from "@/lib/useEventFilters";
import { useHomePagePreferences } from "@/lib/homepage-preferences";
import GuildTable from "@/components/GuildTable";
import IntegratedRaidSelector from "@/components/IntegratedRaidSelector";
import HorizontalEventsFeed from "@/components/HorizontalEventsFeed";
import FeaturedStreamers from "@/components/FeaturedStreamers";
import HorseRace from "@/components/HorseRace";
import HomeHighlights from "@/components/HomeHighlights";
import RaidDetailModal from "@/components/RaidDetailModal";
import RaidingTodayStrip from "@/components/RaidingTodayStrip";

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Modal state for raid detail
  const [selectedGuildDetail, setSelectedGuildDetail] = useState<Guild | null>(null);
  const [bossesForSelectedRaid, setBossesForSelectedRaid] = useState<Boss[]>([]);

  // Track whether we've initialized selectedRaidId from URL/data
  const hasInitializedRaid = useRef(false);

  // ─── React Query hooks ──────────────────────────────────────────────────────
  const { data: homeData, isLoading: homeLoading, error: homeError } = useHomeData();
  const raids = homeData?.raids ?? [];
  const homeRaidId = homeData?.raid.id ?? null;
  const primaryRaidId = raids.find((raid) => raid.isPrimary)?.id ?? homeRaidId ?? raids[0]?.id ?? null;
  const { showEvents, showLivestreams, showHighlights, showRaidingToday } = useHomePagePreferences();
  const eventFilters = useEventFiltersFromLocalStorage();
  const { data: eventsData, error: eventsError } = useEventsPaginated(1, 5, eventFilters, showEvents);
  const events = eventsData?.events ?? homeData?.events ?? [];
  const useHomeGuilds = selectedRaidId !== null && selectedRaidId === homeRaidId;
  const { data: guildsData = [], error: guildsError } = useGuilds(selectedRaidId ?? undefined, !useHomeGuilds);
  const guilds = useHomeGuilds ? (homeData?.guilds ?? []) : guildsData;
  const { data: reservedUmaImages = [] } = useHorseRaceUmaReservations();
  const useHomeRaidDates = selectedRaidId !== null && selectedRaidId === homeRaidId;
  const { data: raidDatesData, error: raidDatesError } = useRaidDates(selectedRaidId, !useHomeRaidDates);
  const raidDates = useHomeRaidDates ? (homeData?.dates ?? null) : raidDatesData;

  // Combined loading/error state
  const loading = homeLoading;
  const queryError = homeError || eventsError || guildsError || raidDatesError;
  const error = queryError ? "Failed to load data. Make sure the backend server is running." : modalError;

  // ─── Initialize selectedRaidId from URL params or first raid ────────────────
  useEffect(() => {
    if (hasInitializedRaid.current || raids.length === 0) return;
    hasInitializedRaid.current = true;

    const raidIdParam = searchParams.get("raidid");
    let raidToSelect: number | null = null;

    if (raidIdParam) {
      const raidId = parseInt(raidIdParam, 10);
      if (!isNaN(raidId) && raids.some((r) => r.id === raidId)) {
        raidToSelect = raidId;
      }
    }

    if (!raidToSelect) {
      raidToSelect = primaryRaidId;
    }

    if (!raidToSelect) return;

    setSelectedRaidId(raidToSelect);

    // Update URL if raid was auto-selected (not from URL param)
    if (!raidIdParam) {
      const params = new URLSearchParams();
      params.set("raidid", raidToSelect.toString());
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [raids, primaryRaidId, searchParams, pathname, router]);

  // Helper function to update URL with query parameters
  const updateURL = useCallback(
    (raidId: number | null) => {
      const params = new URLSearchParams();
      if (raidId) params.set("raidid", raidId.toString());

      const queryString = params.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl, { scroll: false });
    },
    [pathname, router],
  );

  // Handle guild click - navigate to guild profile page
  const handleGuildClick = useCallback(
    (guild: GuildListItem) => {
      const encodedRealm = encodeURIComponent(guild.realm);
      const encodedName = encodeURIComponent(guild.name);
      router.push(`/guilds/${encodedRealm}/${encodedName}`);
    },
    [router],
  );

  // Handle raid progress click - open raid detail modal
  const handleRaidProgressClick = useCallback(
    async (guild: GuildListItem) => {
      if (!selectedRaidId) return;

      // Open modal immediately with empty progress
      const placeholderGuild: Guild = {
        _id: guild._id,
        name: guild.name,
        realm: guild.realm,
        region: guild.region,
        faction: guild.faction,
        warcraftlogsId: guild.warcraftlogsId,
        crest: guild.crest,
        parent_guild: guild.parent_guild,
        isCurrentlyRaiding: guild.isCurrentlyRaiding,
        lastFetched: guild.lastFetched,
        streamers: guild.streamers,
        raidSchedule: guild.raidSchedule,
        progress: [],
      };

      setModalError(null);
      setSelectedGuildDetail(placeholderGuild);
      setModalLoading(true);

      try {
        const [bossProgressResponse, bosses] = await Promise.all([api.getGuildBossProgressByRealmName(guild.realm, guild.name, selectedRaidId), api.getBosses(selectedRaidId)]);

        setSelectedGuildDetail({
          ...placeholderGuild,
          progress: bossProgressResponse.progress,
          worldRankHistory: bossProgressResponse.worldRankHistory,
        });
        setBossesForSelectedRaid(bosses);
      } catch (err) {
        console.error("Error fetching raid details:", err);
        setModalError("Failed to load raid details.");
      } finally {
        setModalLoading(false);
      }
    },
    [selectedRaidId],
  );

  // Handle closing raid detail modal
  const handleCloseModal = useCallback(() => {
    setSelectedGuildDetail(null);
    setBossesForSelectedRaid([]);
    setModalError(null);
    setModalLoading(false);
  }, []);

  // Handle raid selection change
  const handleRaidSelect = useCallback(
    (raidId: number) => {
      setSelectedRaidId(raidId);
      updateURL(raidId);
    },
    [updateURL],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">⚔️</div>
          <div className="text-white text-xl">Loading guild data...</div>
        </div>
      </div>
    );
  }

  return (
    <main className="text-white min-h-screen">
      {/* Events Feed - full width */}
      {showEvents && events.length > 0 && (
        <div className="px-3 md:px-4 mb-2">
          <HorizontalEventsFeed events={events} />
        </div>
      )}

      <HorseRace guilds={guilds} selectedRaidId={selectedRaidId} currentRaidId={primaryRaidId} reservedUmaImages={reservedUmaImages} />

      <div className="container mx-auto px-3 md:px-4 max-w-full md:max-w-[95%] lg:max-w-[85%] pb-8">
        {error && <div className="bg-red-900/20 border border-red-700 text-red-300 px-4 rounded-lg mb-8">{error}</div>}

        {/* Integrated Raid Selector + Guild Leaderboard */}
        <div>
          {showHighlights && <HomeHighlights />}
          {showLivestreams && <FeaturedStreamers />}
          {showRaidingToday && <RaidingTodayStrip />}
          {raids.length > 0 && <IntegratedRaidSelector raids={raids} selectedRaidId={selectedRaidId} onRaidSelect={handleRaidSelect} raidDates={raidDates ?? null} />}
          <GuildTable guilds={guilds} onGuildClick={handleGuildClick} onRaidProgressClick={handleRaidProgressClick} selectedRaidId={selectedRaidId} />
        </div>

        {/* Raid Detail Modal */}
        {selectedGuildDetail && selectedRaidId && (
          <RaidDetailModal
            guild={selectedGuildDetail}
            onClose={handleCloseModal}
            selectedRaidId={selectedRaidId}
            raids={raids}
            bosses={bossesForSelectedRaid}
            isCurrentRaid={Boolean(raids.find((raid) => raid.id === selectedRaidId)?.isCurrent)}
            loading={modalLoading}
          />
        )}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-4">⚔️</div>
            <div className="text-white text-xl">Loading guild data...</div>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
