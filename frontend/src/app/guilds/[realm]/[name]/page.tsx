"use client";

import { use, useEffect, useState, useCallback, useRef, Fragment, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Guild, RaidProgressSummary, RaidInfo, Boss, RaidSchedule, GuildRaidCharactersResponse } from "@/types";
import { api } from "@/lib/api";
import { useGuildSummaryByRealmName, useRaids, useGuildEventsByRealmName } from "@/lib/queries";
import { buildRaidOrderIndex, compareRaidsByListOrder } from "@/lib/raid-priority";
import {
  formatTime,
  formatPercent,
  getIconUrl,
  formatPhaseDisplay,
  getWorldRankColor,
  getBestWorldRank,
  getLeaderboardRankColor,
  getRaiderIOGuildUrl,
  getTierLetter,
  getTierBgColor,
  getEffectiveProgress,
  findOfficialProgressForRaid,
  getClassInfoById,
  getAllClasses,
  formatRealmName,
} from "@/lib/utils";
import RaidDetailModal from "@/components/RaidDetailModal";
import GuildCrest from "@/components/GuildCrest";
import HorizontalEventsFeed from "@/components/HorizontalEventsFeed";
import LatestReportsFeed from "@/components/LatestReportsFeed";
import GuildProfileHighlights from "@/components/GuildProfileHighlights";
import IconImage from "@/components/IconImage";
import { useHorseRaceMode } from "@/lib/horse-race-preferences";
import { getUmaImageLabel, isUmaImage } from "@/lib/uma-images";

interface PageProps {
  params: Promise<{ realm: string; name: string }>;
}

const WEEK_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CLASS_COLORS: Record<string, string> = {
  "Death Knight": "#C41E3A",
  "Demon Hunter": "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

type CharacterSortKey = "name" | "realm" | "class" | "reportCount" | "firstSeenAt" | "lastSeenAt";
type SortDirection = "asc" | "desc";

type CharacterSort = {
  key: CharacterSortKey;
  direction: SortDirection;
};

function formatScheduleHour(hour: number): string {
  const totalMinutes = Math.round(hour * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function formatOptionalTime(seconds?: number | null) {
  return seconds && seconds > 0 ? formatTime(seconds) : "-";
}

function formatShortDate(value?: string | Date | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function getClassColor(className: string) {
  return CLASS_COLORS[className] ?? "#D1D5DB";
}

function StackedTimeValue({ primary, secondary }: { primary?: number | null; secondary?: number | null }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <div>{formatOptionalTime(primary)}</div>
      <div className="mt-0.5 text-[10px] text-gray-500">({formatOptionalTime(secondary)})</div>
    </div>
  );
}

function hasDifficultyProgressData(progress?: RaidProgressSummary | null) {
  return (
    !!progress &&
    ((progress.currentBossPulls ?? 0) > 0 ||
      (progress.bestPullPercent ?? 0) > 0 ||
      !!progress.bestPullPhase?.displayString ||
      (progress.totalTimeSpent ?? 0) > 0 ||
      (progress.totalCombatTimeSpent ?? 0) > 0 ||
      (progress.progressRaidTimeSpent ?? 0) > 0 ||
      (progress.totalRaidTimeSpent ?? 0) > 0)
  );
}

function getRaidTimeMetrics(mythicProgress: RaidProgressSummary | null, heroicProgress: RaidProgressSummary | null, combineDifficulties: boolean) {
  if (combineDifficulties) {
    return {
      progressTime: (mythicProgress?.totalTimeSpent || 0) + (heroicProgress?.totalTimeSpent || 0),
      totalTime: (mythicProgress?.totalCombatTimeSpent || 0) + (heroicProgress?.totalCombatTimeSpent || 0),
      progressRaidTime: (mythicProgress?.progressRaidTimeSpent || 0) + (heroicProgress?.progressRaidTimeSpent || 0),
      totalRaidTime: (mythicProgress?.totalRaidTimeSpent || 0) + (heroicProgress?.totalRaidTimeSpent || 0),
    };
  }

  const effectiveProgress = hasDifficultyProgressData(mythicProgress) ? mythicProgress : heroicProgress;

  return {
    progressTime: effectiveProgress?.totalTimeSpent || 0,
    totalTime: effectiveProgress?.totalCombatTimeSpent || 0,
    progressRaidTime: effectiveProgress?.progressRaidTimeSpent || 0,
    totalRaidTime: effectiveProgress?.totalRaidTimeSpent || 0,
  };
}

function TableToggle({ checked, onChange, label, ariaLabel }: { checked: boolean; onChange: () => void; label: string; ariaLabel: string }) {
  return (
    <div className="flex items-center gap-1 md:gap-2">
      <button
        onClick={onChange}
        className={`relative inline-flex h-4 md:h-5 w-7 md:w-9 items-center rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-gray-700"}`}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className={`inline-block h-2.5 md:h-3 w-2.5 md:w-3 transform rounded-full bg-white transition-transform ${checked ? "translate-x-4 md:translate-x-5" : "translate-x-0.5 md:translate-x-1"}`} />
      </button>
      <span className="text-[10px] md:text-xs text-gray-400 font-normal whitespace-nowrap" title={ariaLabel}>
        {label}
      </span>
    </div>
  );
}

function getSortedRaidScheduleDays(raidSchedule?: RaidSchedule) {
  if (!raidSchedule?.days?.length) return [];

  return [...raidSchedule.days].sort((a, b) => {
    const aIndex = WEEK_ORDER.indexOf(a.day);
    const bIndex = WEEK_ORDER.indexOf(b.day);
    return (aIndex === -1 ? WEEK_ORDER.length : aIndex) - (bIndex === -1 ? WEEK_ORDER.length : bIndex);
  });
}

function RaidScheduleBadges({ raidSchedule, variant, className = "" }: { raidSchedule?: RaidSchedule; variant: "mobile" | "desktop"; className?: string }) {
  const days = getSortedRaidScheduleDays(raidSchedule);
  if (days.length === 0) return null;

  return (
    <div className={`flex flex-wrap ${variant === "mobile" ? "gap-1 text-[10px]" : "gap-1.5 md:gap-2"} ${className}`}>
      {days.map((day, index) => {
        const dayLabel = variant === "mobile" ? day.day.substring(0, 2) : day.day.substring(0, 3);
        const timeRange = `${formatScheduleHour(day.startHour)}-${formatScheduleHour(day.endHour)}`;

        return (
          <span
            key={`${day.day}-${day.startHour}-${day.endHour}-${index}`}
            className={
              variant === "mobile"
                ? "rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-gray-300"
                : "rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-300"
            }
            title={`${day.day} ${timeRange}`}
          >
            {dayLabel} {timeRange}
          </span>
        );
      })}
    </div>
  );
}

export default function GuildProfilePage({ params }: PageProps) {
  const resolvedParams = use(params);
  const t = useTranslations("guildProfilePage");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isClosingModalRef = useRef(false);

  // Decode URL parameters
  const realm = decodeURIComponent(resolvedParams.realm);
  const name = decodeURIComponent(resolvedParams.name);

  // React Query hooks for initial data
  const { data: guildSummary, isLoading: isLoadingGuildSummary, error: guildSummaryError } = useGuildSummaryByRealmName(realm, name);
  const { mode: horseRaceMode } = useHorseRaceMode();

  const { data: raids = [], isLoading: isLoadingRaids, error: raidsError } = useRaids();

  const { data: events = [] } = useGuildEventsByRealmName(realm, name, 4);

  // Combined loading/error states
  const loading = isLoadingGuildSummary || isLoadingRaids;
  const error = guildSummaryError || raidsError;

  // Modal-related state (kept as local state - imperative on-demand fetching)
  const [selectedGuildDetail, setSelectedGuildDetail] = useState<Guild | null>(null);
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const [bossesForSelectedRaid, setBossesForSelectedRaid] = useState<Boss[]>([]);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [showAllRaids, setShowAllRaids] = useState(false);
  const [combineHeroicMythicTimes, setCombineHeroicMythicTimes] = useState(false);
  const [selectedCharacterRaid, setSelectedCharacterRaid] = useState<RaidInfo | null>(null);
  const [raidCharacters, setRaidCharacters] = useState<GuildRaidCharactersResponse | null>(null);
  const [raidCharactersLoading, setRaidCharactersLoading] = useState(false);
  const [raidCharactersError, setRaidCharactersError] = useState<string | null>(null);
  const [characterSearch, setCharacterSearch] = useState("");
  const [selectedCharacterClassId, setSelectedCharacterClassId] = useState<number | null>(null);
  const [characterSort, setCharacterSort] = useState<CharacterSort>({ key: "reportCount", direction: "desc" });
  const [isCharacterClassFilterOpen, setIsCharacterClassFilterOpen] = useState(false);
  const characterClassFilterRef = useRef<HTMLDivElement | null>(null);

  // Hover state for clickable areas
  const [hoveredRaidInfoRow, setHoveredRaidInfoRow] = useState<number | null>(null);
  const [hoveredRaidProgressRow, setHoveredRaidProgressRow] = useState<number | null>(null);

  const characterClassCounts = useMemo(() => {
    const counts = new Map<number, number>();
    raidCharacters?.characters.forEach((character) => {
      counts.set(character.classID, (counts.get(character.classID) ?? 0) + 1);
    });
    return counts;
  }, [raidCharacters]);

  const characterClassOptions = useMemo(() => {
    return getAllClasses()
      .map((classInfo) => ({
        ...classInfo,
        count: characterClassCounts.get(classInfo.id) ?? 0,
      }))
      .filter((classInfo) => classInfo.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [characterClassCounts]);

  const filteredRaidCharacters = useMemo(() => {
    const search = characterSearch.trim().toLowerCase();
    const characters = raidCharacters?.characters ?? [];

    return [...characters]
      .filter((character) => {
        if (selectedCharacterClassId !== null && character.classID !== selectedCharacterClassId) return false;
        if (!search) return true;
        return character.name.toLowerCase().includes(search);
      })
      .sort((a, b) => {
        let comparison = 0;

        if (characterSort.key === "reportCount") {
          comparison = a.reportCount - b.reportCount;
        } else if (characterSort.key === "firstSeenAt" || characterSort.key === "lastSeenAt") {
          comparison = new Date(a[characterSort.key]).getTime() - new Date(b[characterSort.key]).getTime();
        } else if (characterSort.key === "class") {
          comparison = getClassInfoById(a.classID).name.localeCompare(getClassInfoById(b.classID).name);
        } else if (characterSort.key === "realm") {
          comparison = formatRealmName(a.realm).localeCompare(formatRealmName(b.realm));
        } else {
          comparison = a.name.localeCompare(b.name);
        }

        return characterSort.direction === "asc" ? comparison : -comparison;
      });
  }, [characterSearch, characterSort, raidCharacters, selectedCharacterClassId]);

  const selectedCharacterClass = selectedCharacterClassId === null ? null : getClassInfoById(selectedCharacterClassId);

  const handleCharacterSort = useCallback((key: CharacterSortKey) => {
    setCharacterSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const renderCharacterSortHeader = useCallback(
    (key: CharacterSortKey, label: string, align: "left" | "right" = "left") => {
      const isActive = characterSort.key === key;
      return (
        <button
          type="button"
          onClick={() => handleCharacterSort(key)}
          className={`inline-flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-400 transition-colors hover:text-white ${
            align === "right" ? "justify-end text-right" : "justify-start text-left"
          }`}
        >
          <span>{label}</span>
          <span className={isActive ? "text-blue-300" : "text-gray-600"}>{isActive ? (characterSort.direction === "asc" ? "^" : "v") : "-"}</span>
        </button>
      );
    },
    [characterSort.direction, characterSort.key, handleCharacterSort],
  );

  useEffect(() => {
    if (!isCharacterClassFilterOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (characterClassFilterRef.current?.contains(event.target as Node)) return;
      setIsCharacterClassFilterOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isCharacterClassFilterOpen]);

  // Scroll to top when component mounts (when navigating to a new guild)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [realm, name]);

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

  // Mark initial load complete once all queries have resolved
  useEffect(() => {
    if (!loading && guildSummary && !initialLoadComplete) {
      // Check URL for raid ID parameter
      const raidIdParam = searchParams.get("raidid");
      if (raidIdParam) {
        const raidId = parseInt(raidIdParam, 10);
        if (!isNaN(raidId)) {
          setSelectedRaidId(raidId);
        }
      }
      setInitialLoadComplete(true);
    }
  }, [loading, guildSummary, initialLoadComplete, searchParams]);

  // Handle raid click - open modal immediately with loading state, then fetch data
  const handleRaidClick = useCallback(
    async (raidId: number) => {
      if (!guildSummary) return;

      // Open modal immediately with minimal data
      const minimalGuild: Guild = {
        _id: guildSummary._id,
        name: guildSummary.name,
        realm: guildSummary.realm,
        region: guildSummary.region,
        faction: guildSummary.faction,
        warcraftlogsId: guildSummary.warcraftlogsId,
        crest: guildSummary.crest,
        parent_guild: guildSummary.parent_guild,
        isCurrentlyRaiding: guildSummary.isCurrentlyRaiding,
        lastFetched: guildSummary.lastFetched,
        streamers: guildSummary.streamers,
        progress: [],
      };

      setModalError(null);
      setSelectedGuildDetail(minimalGuild);
      setBossesForSelectedRaid([]);
      setSelectedRaidId(raidId);
      updateURL(raidId);
      setModalLoading(true);

      try {
        const [bossProgressResponse, bosses] = await Promise.all([api.getGuildBossProgressByRealmName(realm, name, raidId), api.getBosses(raidId)]);

        setSelectedGuildDetail({
          ...minimalGuild,
          progress: bossProgressResponse.progress,
          worldRankHistory: bossProgressResponse.worldRankHistory,
        });
        setBossesForSelectedRaid(bosses);
        setModalLoading(false);
      } catch (err) {
        console.error("Error fetching raid details:", err);
        setModalError("Failed to load raid details.");
        setModalLoading(false);
      }
    },
    [guildSummary, realm, name, updateURL],
  );

  const handleRaidCharactersClick = useCallback(
    async (raid: RaidInfo) => {
      setSelectedCharacterRaid(raid);
      setRaidCharacters(null);
      setRaidCharactersError(null);
      setCharacterSearch("");
      setSelectedCharacterClassId(null);
      setCharacterSort({ key: "reportCount", direction: "desc" });
      setIsCharacterClassFilterOpen(false);
      setRaidCharactersLoading(true);

      try {
        const response = await api.getGuildRaidCharactersByRealmName(realm, name, raid.id);
        setRaidCharacters(response);
      } catch (err) {
        console.error("Error fetching raid characters:", err);
        setRaidCharactersError("Failed to load raid characters.");
      } finally {
        setRaidCharactersLoading(false);
      }
    },
    [realm, name],
  );

  const handleCloseCharactersModal = useCallback(() => {
    setSelectedCharacterRaid(null);
    setRaidCharacters(null);
    setRaidCharactersLoading(false);
    setRaidCharactersError(null);
    setCharacterSearch("");
    setSelectedCharacterClassId(null);
    setCharacterSort({ key: "reportCount", direction: "desc" });
    setIsCharacterClassFilterOpen(false);
  }, []);

  const handleCharacterNavigate = useCallback(
    (characterRealm: string, characterName: string, classID: number) => {
      router.push(`/characters/${encodeURIComponent(characterRealm)}/${encodeURIComponent(characterName)}?class=${encodeURIComponent(String(classID))}`);
    },
    [router],
  );

  const handleRaidTierListNavigate = useCallback(
    (raidId: number) => {
      router.push(`/guilds/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/raids/${raidId}/tierlist`);
    },
    [name, realm, router],
  );

  // Handle raid info click - navigate to main page with raid selected
  const handleRaidInfoClick = useCallback(
    (raidId: number) => {
      router.push(`/progress/?raidid=${raidId}`);
    },
    [router],
  );

  // Handle raid selection from URL parameter after initial load
  useEffect(() => {
    if (!initialLoadComplete || !guildSummary || !selectedRaidId || selectedGuildDetail) return;

    // Only open raid detail if there's a raidid in URL AND we don't have details loaded
    // AND we're not in the process of closing the modal
    if (!isClosingModalRef.current) {
      handleRaidClick(selectedRaidId);
    }

    // Reset the closing flag after the effect runs
    if (isClosingModalRef.current) {
      isClosingModalRef.current = false;
    }
  }, [initialLoadComplete, guildSummary, selectedRaidId, selectedGuildDetail, handleRaidClick]);

  // Handle closing raid detail modal
  const handleCloseModal = useCallback(() => {
    isClosingModalRef.current = true;
    setSelectedGuildDetail(null);
    setSelectedRaidId(null);
    setBossesForSelectedRaid([]);
    setModalLoading(false);
    updateURL(null);
  }, [updateURL]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">⚔️</div>
          <div className="text-white text-xl">Loading guild profile...</div>
        </div>
      </div>
    );
  }

  if (error || !guildSummary) {
    const errorMessage = error instanceof Error ? error.message : "Guild not found";
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">{errorMessage}</div>
          <button onClick={() => router.push("/guilds")} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            Back to Guilds
          </button>
        </div>
      </div>
    );
  }

  const profileUmaImage = horseRaceMode === "uma" && isUmaImage(guildSummary.horseRaceUmaImage) ? guildSummary.horseRaceUmaImage : null;
  const renderGuildProfileImage = (size: number, className: string) =>
    profileUmaImage ? (
      <img src={`/uma_full/${profileUmaImage}`} alt={`${guildSummary.name} ${getUmaImageLabel(profileUmaImage)}`} className={`${className} object-contain`} />
    ) : (
      <GuildCrest crest={guildSummary.crest} faction={guildSummary.faction} size={size} className={className} drawFactionCircle={true} />
    );

  // Group progress by expansion and consolidate raid data
  const raidOrderIndex = buildRaidOrderIndex(raids);
  const progressByExpansion = new Map<
    string,
    {
      raid: RaidInfo;
      mythicProgress: RaidProgressSummary | null;
      heroicProgress: RaidProgressSummary | null;
    }[]
  >();

  // First, get all unique raids
  const uniqueRaids = new Map<number, RaidInfo>();
  raids.forEach((raid) => {
    uniqueRaids.set(raid.id, raid);
  });

  // Group progress by expansion
  uniqueRaids.forEach((raid) => {
    const mythicProgress = guildSummary.progress.find((p) => p.raidId === raid.id && p.difficulty === "mythic") || null;
    const heroicProgress = guildSummary.progress.find((p) => p.raidId === raid.id && p.difficulty === "heroic") || null;

    // Include raids based on showAllRaids toggle
    const hasProgress = mythicProgress || heroicProgress;
    if (showAllRaids || hasProgress) {
      if (!progressByExpansion.has(raid.expansion)) {
        progressByExpansion.set(raid.expansion, []);
      }

      progressByExpansion.get(raid.expansion)!.push({
        raid,
        mythicProgress,
        heroicProgress,
      });
    }
  });

  // Sort expansions by the prioritized raid order
  const sortedExpansions = Array.from(progressByExpansion.entries()).sort((a, b) => {
    const aBestIndex = Math.min(...a[1].map((entry) => raidOrderIndex.get(entry.raid.id) ?? Number.MAX_SAFE_INTEGER));
    const bBestIndex = Math.min(...b[1].map((entry) => raidOrderIndex.get(entry.raid.id) ?? Number.MAX_SAFE_INTEGER));
    return aBestIndex - bBestIndex;
  });

  // Sort raids within each expansion by priority
  sortedExpansions.forEach(([, raids]) => {
    raids.sort((a, b) => compareRaidsByListOrder(a.raid, b.raid, raidOrderIndex));
  });

  return (
    <main className="min-h-screen text-white">
      <div className="container mx-auto px-2 md:px-4 max-w-full md:max-w-[90%] lg:max-w-[75%]">
        {/* Modal error banner */}
        {modalError && <div className="mb-3 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">{modalError}</div>}

        {/* Guild Header */}
        <div className={`mb-3 ${guildSummary.isCurrentlyRaiding ? "border-l-4 border-l-green-500 pl-2 md:pl-4" : ""}`}>
          {/* Mobile: Compact row layout */}
          <div className="md:hidden">
            <div className="flex items-center gap-2 mb-2">
              {renderGuildProfileImage(128, "shrink-0 w-12 h-12")}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 flex-wrap">
                  <h1 className="text-xl font-bold text-white truncate">{guildSummary.name}</h1>
                  {guildSummary.parent_guild && <span className="text-gray-400 text-sm">({guildSummary.parent_guild})</span>}
                  {guildSummary.isCurrentlyRaiding && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-green-900/50 text-green-300">Live</span>}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>{guildSummary.realm}</span>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    {guildSummary.warcraftlogsId && (
                      <a
                        href={`https://www.warcraftlogs.com/guild/id/${guildSummary.warcraftlogsId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:opacity-80"
                        title="WCL"
                      >
                        <Image src="/wcl-logo.png" alt="WCL" width={20} height={20} className="w-5 h-5 object-contain" />
                      </a>
                    )}
                    <a
                      href={getRaiderIOGuildUrl(guildSummary.region, guildSummary.realm, guildSummary.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:opacity-80"
                      title="RIO"
                    >
                      <Image src="/raiderio-logo.png" alt="RIO" width={20} height={20} className="w-5 h-5 object-contain" />
                    </a>
                  </div>
                </div>
                <RaidScheduleBadges raidSchedule={guildSummary.raidSchedule} variant="mobile" className="mt-1" />
              </div>
            </div>
            {/* Tier Scores - Mobile Compact */}
            {guildSummary.tierScores && guildSummary.tierScores.overall && (
              <div className="flex items-center gap-1.5 text-[10px] mb-2">
                <div className="flex items-center border border-gray-600 rounded overflow-hidden">
                  <span className="bg-gray-700 px-1 py-0.5 text-gray-300 font-medium">Overall</span>
                  <span className={`px-1.5 py-0.5 font-bold text-gray-900 ${getTierBgColor(getTierLetter(guildSummary.tierScores.overall.overallScore))}`}>
                    {getTierLetter(guildSummary.tierScores.overall.overallScore)}
                  </span>
                </div>
                <div className="flex items-center border border-gray-600 rounded overflow-hidden">
                  <span className="bg-gray-700 px-1 py-0.5 text-gray-300 font-medium">Spd</span>
                  <span className={`px-1.5 py-0.5 font-bold text-gray-900 ${getTierBgColor(getTierLetter(guildSummary.tierScores.overall.speedScore))}`}>
                    {getTierLetter(guildSummary.tierScores.overall.speedScore)}
                  </span>
                </div>
                <div className="flex items-center border border-gray-600 rounded overflow-hidden">
                  <span className="bg-gray-700 px-1 py-0.5 text-gray-300 font-medium">Eff</span>
                  <span className={`px-1.5 py-0.5 font-bold text-gray-900 ${getTierBgColor(getTierLetter(guildSummary.tierScores.overall.efficiencyScore))}`}>
                    {getTierLetter(guildSummary.tierScores.overall.efficiencyScore)}
                  </span>
                </div>
              </div>
            )}
            {/* Streamers - Mobile */}
            {guildSummary.streamers && guildSummary.streamers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {guildSummary.streamers.map((streamer) => (
                  <a
                    key={streamer.channelName}
                    href={`https://www.twitch.tv/${streamer.channelName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${streamer.isLive ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300"}`}
                  >
                    <Image src="/twitch-logo.png" alt="" width={12} height={12} className="w-3 h-3" />
                    {streamer.channelName}
                    {streamer.isLive && <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Desktop layout */}
          <div className="hidden md:block">
            <div className="flex flex-row items-start gap-3 mb-3">
              {renderGuildProfileImage(128, "shrink-0 w-32 h-32")}
              <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h1 className="text-2xl md:text-5xl font-bold text-white">
                      {guildSummary.name}
                      {guildSummary.parent_guild && <span className="text-gray-400 font-normal"> ({guildSummary.parent_guild})</span>}
                    </h1>
                    {guildSummary.warcraftlogsId && (
                      <a
                        href={`https://www.warcraftlogs.com/guild/id/${guildSummary.warcraftlogsId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-8 h-8 md:w-10 md:h-10 hover:opacity-80 transition-opacity"
                        title="View on Warcraft Logs"
                      >
                        <Image src="/wcl-logo.png" alt="WCL" width={40} height={40} className="w-full h-full object-contain" />
                      </a>
                    )}
                    <a
                      href={getRaiderIOGuildUrl(guildSummary.region, guildSummary.realm, guildSummary.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-8 h-8 md:w-10 md:h-10 hover:opacity-80 transition-opacity"
                      title="View on Raider.IO"
                    >
                      <Image src="/raiderio-logo.png" alt="Raider.IO" width={40} height={40} className="w-full h-full object-contain" />
                    </a>
                    {guildSummary.isCurrentlyRaiding && <span className="text-xs md:text-sm px-2 md:px-3 py-1 rounded font-semibold bg-green-900/50 text-green-300">Raiding</span>}
                  </div>
                  <div className="text-xl md:text-3xl text-gray-400">{guildSummary.realm}</div>
                  {guildSummary.lastFetched && <div className="mt-0.5 text-xs leading-none text-gray-500">Last Updated: {new Date(guildSummary.lastFetched).toLocaleString("fi-FI")}</div>}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2 pt-2">
                  {guildSummary.streamers && guildSummary.streamers.length > 0 && (
                    <div className="flex max-w-full flex-wrap justify-end gap-2">
                      {guildSummary.streamers.map((streamer) => (
                        <a
                          key={streamer.channelName}
                          href={`https://www.twitch.tv/${streamer.channelName}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                            streamer.isLive
                              ? "bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/40"
                              : "bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
                          }`}
                          title={streamer.isLive ? `${streamer.channelName} is live!` : `Visit ${streamer.channelName} on Twitch`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                          </svg>
                          <span className="max-w-24 truncate">{streamer.channelName}</span>
                          {streamer.isLive && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>}
                        </a>
                      ))}
                    </div>
                  )}
                  {guildSummary.tierScores && guildSummary.tierScores.overall && (
                    <div className="flex items-center justify-end gap-2 text-xs">
                      <div className="flex items-center border border-gray-600 rounded overflow-hidden">
                        <span className="bg-gray-700 px-2 py-1 text-gray-300 font-medium">Overall</span>
                        <span className={`px-2 py-1 font-bold text-gray-900 ${getTierBgColor(getTierLetter(guildSummary.tierScores.overall.overallScore))}`}>
                          {getTierLetter(guildSummary.tierScores.overall.overallScore)}
                        </span>
                      </div>
                      <div className="flex items-center border border-gray-600 rounded overflow-hidden">
                        <span className="bg-gray-700 px-2 py-1 text-gray-300 font-medium">Speed</span>
                        <span className={`px-2 py-1 font-bold text-gray-900 ${getTierBgColor(getTierLetter(guildSummary.tierScores.overall.speedScore))}`}>
                          {getTierLetter(guildSummary.tierScores.overall.speedScore)}
                        </span>
                      </div>
                      <div className="flex items-center border border-gray-600 rounded overflow-hidden">
                        <span className="bg-gray-700 px-2 py-1 text-gray-300 font-medium">Efficiency</span>
                        <span className={`px-2 py-1 font-bold text-gray-900 ${getTierBgColor(getTierLetter(guildSummary.tierScores.overall.efficiencyScore))}`}>
                          {getTierLetter(guildSummary.tierScores.overall.efficiencyScore)}
                        </span>
                      </div>
                    </div>
                  )}
                  <RaidScheduleBadges raidSchedule={guildSummary.raidSchedule} variant="desktop" className="justify-end" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Guild Events Feed */}
        {events.length > 0 && (
          <div className="mb-4">
            <HorizontalEventsFeed events={events} />
          </div>
        )}

        <LatestReportsFeed reports={guildSummary.latestReports ?? []} />
        <GuildProfileHighlights highlights={guildSummary.profileHighlights} />

        {/* Progress Table */}
        {guildSummary.progress.length > 0 ? (
          <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
            {/* Mobile Card View */}
            <div className="md:hidden">
              {/* Mobile Header with Toggle */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/50">
                <span className="text-xs font-semibold text-gray-300">Raid Progress</span>
                <div className="flex items-center gap-2">
                  <TableToggle checked={showAllRaids} onChange={() => setShowAllRaids(!showAllRaids)} label="All" ariaLabel="Show all raids" />
                  <TableToggle
                    checked={combineHeroicMythicTimes}
                    onChange={() => setCombineHeroicMythicTimes(!combineHeroicMythicTimes)}
                    label="M+H"
                    ariaLabel="Combine heroic and mythic times"
                  />
                </div>
              </div>
              {/* Mobile Raid Cards */}
              <div className="p-2 space-y-2">
                {sortedExpansions.map(([expansion, raidEntries]) => {
                  const expansionIconPath = expansion.toLowerCase().replace(/\s+/g, "-");
                  return (
                    <div key={`mobile-expansion-${expansion}`}>
                      {/* Expansion Header */}
                      <div className="flex items-center gap-2 py-1.5 mb-1">
                        <span className="text-xs font-bold text-gray-400">{expansion}</span>
                        <Image src={`/expansions/${expansionIconPath}.png`} alt={`${expansion} icon`} height={16} width={24} />
                      </div>
                      {/* Raid Cards */}
                      {raidEntries.map(({ raid, mythicProgress, heroicProgress }) => {
                        const iconUrl = getIconUrl(raid.iconUrl);
                        const { progressTime, totalTime, progressRaidTime, totalRaidTime } = getRaidTimeMetrics(mythicProgress, heroicProgress, combineHeroicMythicTimes);
                        const currentBossPulls = mythicProgress?.currentBossPulls || 0;
                        const bestProgress = mythicProgress?.bestPullPhase?.displayString
                          ? formatPhaseDisplay(mythicProgress.bestPullPhase.displayString)
                          : mythicProgress && mythicProgress.bestPullPercent < 100
                            ? formatPercent(mythicProgress.bestPullPercent)
                            : null;
                        const guildRank = mythicProgress?.guildRank || heroicProgress?.guildRank;
                        const worldRank = getBestWorldRank(mythicProgress) || getBestWorldRank(heroicProgress);
                        const hasProgress = mythicProgress || heroicProgress;
                        const official = findOfficialProgressForRaid(guildSummary.officialProgress, raid.slug, raid.rioSlug);
                        const mythicDisplay = getEffectiveProgress(mythicProgress, official, "mythic");
                        const heroicDisplay = getEffectiveProgress(heroicProgress, official, "heroic");

                        return (
                          <div key={`mobile-raid-${raid.id}`} className={`rounded-lg mb-1.5 bg-gray-800/50 border border-gray-700/50 ${!hasProgress ? "opacity-40" : ""}`}>
                            <div className="flex items-center">
                              {/* Left side: Raid Info - navigates to raid page */}
                              <div
                                className="flex items-center gap-2 flex-1 min-w-0 p-2 cursor-pointer active:bg-gray-700/50 rounded-l-lg"
                                onClick={() => handleRaidInfoClick(raid.id)}
                              >
                                {iconUrl && <Image src={iconUrl} alt="Raid icon" width={28} height={28} className="rounded shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold text-white truncate">{raid.name}</div>
                                  <div className="flex items-center gap-2 text-[10px]">
                                    {guildRank && <span className={`font-semibold ${getLeaderboardRankColor(guildRank)}`}>#{guildRank}</span>}
                                    {worldRank && <span style={{ color: getWorldRankColor(worldRank) }}>W{worldRank}</span>}
                                  </div>
                                </div>
                              </div>
                              {/* Right side: Progress Stats - opens modal */}
                              <div
                                className={`flex items-center gap-2 shrink-0 text-xs p-2 border-l border-gray-600 rounded-r-lg ${
                                  hasProgress ? "cursor-pointer active:bg-gray-700/50" : "cursor-not-allowed"
                                }`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                              >
                                <div className="text-center">
                                  <div className="text-orange-500 font-semibold">
                                    {mythicDisplay.text}
                                    {mythicDisplay.isOfficial && <span className="text-[8px] text-orange-400/60">*</span>}
                                  </div>
                                  <div className="text-[9px] text-gray-500">M</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-purple-500 font-semibold">
                                    {heroicDisplay.text}
                                    {heroicDisplay.isOfficial && <span className="text-[8px] text-purple-400/60">*</span>}
                                  </div>
                                  <div className="text-[9px] text-gray-500">H</div>
                                </div>
                                {progressTime > 0 || totalTime > 0 || progressRaidTime > 0 || totalRaidTime > 0 ? (
                                  <>
                                    <div className="text-center">
                                      <div className="text-gray-300">
                                        <StackedTimeValue primary={progressTime} secondary={progressRaidTime} />
                                      </div>
                                      <div className="text-[9px] text-gray-500">Progress</div>
                                    </div>
                                    <div className="text-center">
                                      <div className="text-gray-300">
                                        <StackedTimeValue primary={totalTime} secondary={totalRaidTime} />
                                      </div>
                                      <div className="text-[9px] text-gray-500">Total</div>
                                    </div>
                                  </>
                                ) : (
                                  (currentBossPulls > 0 || bestProgress) && (
                                    <div className="text-center">
                                      <div className="text-gray-300">{currentBossPulls > 0 ? currentBossPulls : bestProgress || "-"}</div>
                                      <div className="text-[9px] text-gray-500">{currentBossPulls > 0 ? "pulls" : "best"}</div>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-t border-gray-700/50 px-2 py-2">
                              <button
                                type="button"
                                onClick={() => handleRaidCharactersClick(raid)}
                                className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-gray-700 px-3 text-xs font-semibold text-gray-100 transition-colors hover:bg-gray-600 active:scale-[0.99]"
                              >
                                {t("characters")}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRaidTierListNavigate(raid.id)}
                                className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-blue-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-600 active:scale-[0.99]"
                              >
                                {t("tierList")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse min-w-[720px]">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/50">
                    <th className="px-2 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-semibold text-gray-300">
                      <div className="flex items-center gap-2 md:gap-3">
                        <span>Raid</span>
                        <div className="flex items-center gap-2 md:gap-3">
                          <TableToggle checked={showAllRaids} onChange={() => setShowAllRaids(!showAllRaids)} label="All" ariaLabel="Show all raids" />
                          <TableToggle
                            checked={combineHeroicMythicTimes}
                            onChange={() => setCombineHeroicMythicTimes(!combineHeroicMythicTimes)}
                            label="M+H"
                            ariaLabel="Combine heroic and mythic times"
                          />
                        </div>
                      </div>
                    </th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-300">Rank</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-300">World</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-orange-500 border-l-2 border-gray-700">M</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-purple-500">H</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-300">Progress</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-300">Total</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-300">Pulls</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-300">%</th>
                    <th className="px-2 md:px-4 py-2 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-300">Characters</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedExpansions.map(([expansion, raidEntries]) => {
                    const expansionIconPath = expansion.toLowerCase().replace(/\s+/g, "-");

                    return (
                      <Fragment key={`expansion-${expansion}`}>
                        {/* Expansion Separator Row */}
                        <tr className="bg-gray-800/70 border-b border-gray-700">
                          <td colSpan={3} className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-gray-300">{expansion}</span>
                              <Image src={`/expansions/${expansionIconPath}.png`} alt={`${expansion} icon`} height={20} width={32} />
                            </div>
                          </td>
                          <td colSpan={7} className="px-4 py-2 border-l-2 border-gray-700"></td>
                        </tr>

                        {/* Raid Rows */}
                        {raidEntries.map(({ raid, mythicProgress, heroicProgress }) => {
                          const iconUrl = getIconUrl(raid.iconUrl);
                          const { progressTime, totalTime, progressRaidTime, totalRaidTime } = getRaidTimeMetrics(mythicProgress, heroicProgress, combineHeroicMythicTimes);
                          const currentBossPulls = mythicProgress?.currentBossPulls || 0;
                          const bestProgress = mythicProgress?.bestPullPhase?.displayString
                            ? formatPhaseDisplay(mythicProgress.bestPullPhase.displayString)
                            : mythicProgress && mythicProgress.bestPullPercent < 100
                              ? formatPercent(mythicProgress.bestPullPercent)
                              : "-";

                          // Get guild rank - prefer mythic, fall back to heroic
                          const guildRank = mythicProgress?.guildRank || heroicProgress?.guildRank;

                          // Get world rank - best of WCL and Raider.IO, prefer mythic over heroic
                          const worldRank = getBestWorldRank(mythicProgress) || getBestWorldRank(heroicProgress);

                          // Check if this raid has any progress
                          const hasProgress = mythicProgress || heroicProgress;

                          // Official progress from Raider.IO
                          const official = findOfficialProgressForRaid(guildSummary.officialProgress, raid.slug, raid.rioSlug);
                          const mythicDisplay = getEffectiveProgress(mythicProgress, official, "mythic");
                          const heroicDisplay = getEffectiveProgress(heroicProgress, official, "heroic");

                          return (
                            <tr key={raid.id} className="border-b border-gray-800">
                              {/* First clickable area: Raid Name, Rank, World Rank */}
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 cursor-pointer transition-colors ${hoveredRaidInfoRow === raid.id ? "bg-gray-700/45" : ""} ${
                                  !hasProgress ? "opacity-40" : ""
                                }`}
                                onClick={() => handleRaidInfoClick(raid.id)}
                                onMouseEnter={() => setHoveredRaidInfoRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidInfoRow(null)}
                              >
                                <div className="flex items-center gap-2 md:gap-3">
                                  {iconUrl && <Image src={iconUrl} alt="Raid icon" width={24} height={24} className="rounded w-5 h-5 md:w-6 md:h-6" />}
                                  <span className="font-semibold text-white text-xs md:text-base">{raid.name}</span>
                                </div>
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-base cursor-pointer transition-colors ${
                                  hoveredRaidInfoRow === raid.id ? "bg-gray-700/45" : ""
                                } ${!hasProgress ? "opacity-40" : ""}`}
                                onClick={() => handleRaidInfoClick(raid.id)}
                                onMouseEnter={() => setHoveredRaidInfoRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidInfoRow(null)}
                              >
                                {guildRank ? <span className={`font-semibold ${getLeaderboardRankColor(guildRank)}`}>{guildRank}</span> : <span className="text-gray-500">-</span>}
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-base cursor-pointer transition-colors ${
                                  hoveredRaidInfoRow === raid.id ? "bg-gray-700/45" : ""
                                } ${!hasProgress ? "opacity-40" : ""}`}
                                onClick={() => handleRaidInfoClick(raid.id)}
                                onMouseEnter={() => setHoveredRaidInfoRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidInfoRow(null)}
                              >
                                {worldRank ? (
                                  <span className="font-semibold" style={{ color: getWorldRankColor(worldRank) }}>
                                    {worldRank}
                                  </span>
                                ) : (
                                  <span className="text-gray-500">-</span>
                                )}
                              </td>

                              {/* Second clickable area: Raid Progress columns */}
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-base transition-colors border-l-2 border-gray-700 ${
                                  hoveredRaidProgressRow === raid.id ? "bg-gray-700/45" : ""
                                } ${hasProgress ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                                onMouseEnter={() => hasProgress && setHoveredRaidProgressRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidProgressRow(null)}
                              >
                                <span className="text-orange-500 font-semibold">
                                  {mythicDisplay.text}
                                  {mythicDisplay.isOfficial && <span className="text-[10px] text-orange-400/60 ml-0.5">*</span>}
                                </span>
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-base transition-colors ${
                                  hoveredRaidProgressRow === raid.id ? "bg-gray-700/45" : ""
                                } ${hasProgress ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                                onMouseEnter={() => hasProgress && setHoveredRaidProgressRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidProgressRow(null)}
                              >
                                <span className="text-purple-500 font-semibold">
                                  {heroicDisplay.text}
                                  {heroicDisplay.isOfficial && <span className="text-[10px] text-purple-400/60 ml-0.5">*</span>}
                                </span>
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-[10px] md:text-sm text-gray-300 transition-colors ${
                                  hoveredRaidProgressRow === raid.id ? "bg-gray-700/45" : ""
                                } ${hasProgress ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                                onMouseEnter={() => hasProgress && setHoveredRaidProgressRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidProgressRow(null)}
                              >
                                <StackedTimeValue primary={progressTime} secondary={progressRaidTime} />
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-[10px] md:text-sm text-gray-300 transition-colors ${
                                  hoveredRaidProgressRow === raid.id ? "bg-gray-700/45" : ""
                                } ${hasProgress ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                                onMouseEnter={() => hasProgress && setHoveredRaidProgressRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidProgressRow(null)}
                              >
                                <StackedTimeValue primary={totalTime} secondary={totalRaidTime} />
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-[10px] md:text-sm text-gray-300 transition-colors ${
                                  hoveredRaidProgressRow === raid.id ? "bg-gray-700/45" : ""
                                } ${hasProgress ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                                onMouseEnter={() => hasProgress && setHoveredRaidProgressRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidProgressRow(null)}
                              >
                                {currentBossPulls > 0 ? currentBossPulls : "-"}
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center text-[10px] md:text-sm text-gray-300 transition-colors ${
                                  hoveredRaidProgressRow === raid.id ? "bg-gray-700/45" : ""
                                } ${hasProgress ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                                onMouseEnter={() => hasProgress && setHoveredRaidProgressRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidProgressRow(null)}
                              >
                                {bestProgress}
                              </td>
                              <td
                                className={`px-2 md:px-4 py-2 md:py-3 text-center transition-colors ${
                                  hoveredRaidProgressRow === raid.id ? "bg-gray-700/45" : ""
                                } ${hasProgress ? "cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
                                onClick={() => hasProgress && handleRaidClick(raid.id)}
                                onMouseEnter={() => hasProgress && setHoveredRaidProgressRow(raid.id)}
                                onMouseLeave={() => setHoveredRaidProgressRow(null)}
                              >
                                <div className="flex justify-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleRaidCharactersClick(raid);
                                    }}
                                    className="inline-flex min-h-10 items-center justify-center rounded-md bg-blue-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-600 active:scale-[0.98]"
                                  >
                                    {t("view")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleRaidTierListNavigate(raid.id);
                                    }}
                                    className="inline-flex min-h-10 items-center justify-center rounded-md bg-blue-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-600 active:scale-[0.98]"
                                  >
                                    {t("tierList")}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 bg-gray-900 rounded-lg border border-gray-700">No progress data available for this guild yet.</div>
        )}

        {/* Raid Characters Modal */}
        {selectedCharacterRaid && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={handleCloseCharactersModal}>
            <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-4 py-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selectedCharacterRaid.name} Characters</h2>
                  <p className="text-sm text-gray-400">
                    {guildSummary.name} - {filteredRaidCharacters.length}
                    {raidCharacters ? ` of ${raidCharacters.characters.length}` : ""} characters
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCloseCharactersModal}
                  className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-gray-800 text-gray-200 transition-colors hover:bg-gray-700"
                  aria-label="Close characters dialog"
                >
                  x
                </button>
              </div>

              {raidCharacters?.characters.length ? (
                <div className="border-b border-gray-800 bg-gray-900/95 px-4 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
                      <input
                        type="search"
                        value={characterSearch}
                        onChange={(event) => setCharacterSearch(event.target.value)}
                        placeholder="Search character"
                        className="min-h-10 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-500 focus:border-blue-500 md:max-w-xs"
                      />

                      <div ref={characterClassFilterRef} className="relative w-full md:w-64">
                        <button
                          type="button"
                          onClick={() => setIsCharacterClassFilterOpen((isOpen) => !isOpen)}
                          className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md bg-gray-800 px-3 text-left text-sm font-semibold text-gray-100 shadow-md transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {selectedCharacterClass ? (
                              <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded">
                                <IconImage iconFilename={selectedCharacterClass.iconUrl} alt={selectedCharacterClass.name} fill style={{ objectFit: "cover" }} />
                              </span>
                            ) : null}
                            <span className="truncate">{selectedCharacterClass?.name ?? "All classes"}</span>
                          </span>
                          <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                            {selectedCharacterClassId === null ? raidCharacters.characters.length : (characterClassCounts.get(selectedCharacterClassId) ?? 0)}
                          </span>
                        </button>

                        {isCharacterClassFilterOpen ? (
                          <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md bg-gray-800 py-1 text-sm shadow-xl ring-1 ring-black/40">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCharacterClassId(null);
                                setIsCharacterClassFilterOpen(false);
                              }}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-semibold text-gray-200 hover:bg-blue-600 hover:text-white"
                            >
                              <span>All classes</span>
                              <span className="text-xs tabular-nums">{raidCharacters.characters.length}</span>
                            </button>
                            {characterClassOptions.map((classInfo) => (
                              <button
                                key={classInfo.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCharacterClassId(classInfo.id);
                                  setIsCharacterClassFilterOpen(false);
                                }}
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-semibold text-gray-200 hover:bg-blue-600 hover:text-white"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded">
                                    <IconImage iconFilename={`${classInfo.iconUrl}.jpg`} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
                                  </span>
                                  <span className="truncate" style={{ color: getClassColor(classInfo.name) }}>
                                    {classInfo.name}
                                  </span>
                                </span>
                                <span className="text-xs tabular-nums">{classInfo.count}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {(characterSearch || selectedCharacterClassId !== null) && (
                      <button
                        type="button"
                        onClick={() => {
                          setCharacterSearch("");
                          setSelectedCharacterClassId(null);
                        }}
                        className="min-h-10 rounded-md bg-gray-800 px-3 text-sm font-semibold text-gray-200 transition-colors hover:bg-gray-700"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="max-h-[70vh] overflow-y-auto">
                {raidCharactersLoading ? (
                  <div className="px-4 py-10 text-center text-gray-300">Loading characters...</div>
                ) : raidCharactersError ? (
                  <div className="px-4 py-10 text-center text-red-300">{raidCharactersError}</div>
                ) : raidCharacters?.characters.length ? (
                  filteredRaidCharacters.length ? (
                    <table className="w-full min-w-[820px] border-collapse">
                      <thead className="sticky top-0 z-10 bg-gray-900 shadow-[0_1px_0_rgba(55,65,81,1)]">
                        <tr>
                          <th className="px-4 py-3">{renderCharacterSortHeader("name", "Character")}</th>
                          <th className="px-4 py-3">{renderCharacterSortHeader("realm", "Realm")}</th>
                          <th className="px-4 py-3">{renderCharacterSortHeader("class", "Class")}</th>
                          <th className="px-4 py-3">{renderCharacterSortHeader("reportCount", "Reports", "right")}</th>
                          <th className="px-4 py-3">{renderCharacterSortHeader("firstSeenAt", "First Seen")}</th>
                          <th className="px-4 py-3">{renderCharacterSortHeader("lastSeenAt", "Last Seen")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRaidCharacters.map((character) => {
                          const classInfo = getClassInfoById(character.classID);
                          return (
                            <tr
                              key={`${character.wclCanonicalCharacterId}-${character.region}-${character.realm}-${character.name}-${character.classID}`}
                              onClick={() => handleCharacterNavigate(character.realm, character.name, character.classID)}
                              className="group cursor-pointer border-b border-gray-800/80 transition-colors last:border-0 hover:bg-blue-950/40"
                            >
                              <td className="px-4 py-3">
                                <span className="font-semibold text-blue-300 transition-colors group-hover:text-blue-200">{character.name}</span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-400">{formatRealmName(character.realm)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2 text-sm">
                                  <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded">
                                    <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
                                  </div>
                                  <span className="font-bold" style={{ color: getClassColor(classInfo.name) }}>
                                    {classInfo.name}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-200">{character.reportCount}</td>
                              <td className="px-4 py-3 text-sm tabular-nums text-gray-400">{formatShortDate(character.firstSeenAt)}</td>
                              <td className="px-4 py-3 text-sm tabular-nums text-gray-400">{formatShortDate(character.lastSeenAt)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-4 py-10 text-center text-gray-400">No characters match the current filters.</div>
                  )
                ) : (
                  <div className="px-4 py-10 text-center text-gray-400">No characters have been calculated for this guild and raid yet.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Raid Detail Modal */}
        {selectedGuildDetail && selectedRaidId && (
          <RaidDetailModal
            guild={selectedGuildDetail}
            onClose={handleCloseModal}
            selectedRaidId={selectedRaidId}
            raids={raids}
            bosses={bossesForSelectedRaid}
            loading={modalLoading}
          />
        )}
      </div>
    </main>
  );
}
