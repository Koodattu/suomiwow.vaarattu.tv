"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { usePickemReferenceRankings, usePickemsGuilds, useRaids } from "@/lib/queries";
import {
  clearGuestPickemDraft,
  getGuestPickemDraftStorageKey,
  GuestPickemDraft,
  readGuestPickemDraft,
  saveGuestPickemDraft,
  setGuestPickemPendingImport,
} from "@/lib/pickem-guest-drafts";
import { useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { PickemSummary, PickemDetails, PickemPrediction, SimpleGuild, LeaderboardEntry, GuildRanking, PrizeConfig } from "@/types";
import { Combobox } from "@headlessui/react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PickemStatistics } from "@/components/PickemStatistics";

// Guild autocomplete using Headless UI Combobox
function GuildAutocomplete({
  value,
  onChange,
  guilds,
  placeholder,
  disabled,
  excludeGuilds = [],
}: {
  value: { guildName: string; realm: string } | null;
  onChange: (guild: { guildName: string; realm: string } | null) => void;
  guilds: SimpleGuild[];
  placeholder: string;
  disabled?: boolean;
  excludeGuilds?: { guildName: string; realm: string }[];
}) {
  const [query, setQuery] = useState("");

  const excludeSet = useMemo(() => new Set(excludeGuilds.map((g) => `${g.guildName}-${g.realm}`)), [excludeGuilds]);

  const filteredGuilds = useMemo(() => {
    if (query === "") {
      return guilds.filter((g) => !excludeSet.has(`${g.name}-${g.realm}`)).slice(0, 50);
    }

    const searchTerm = query.toLowerCase();
    return guilds
      .filter((g) => {
        const key = `${g.name}-${g.realm}`;
        const matches = g.name.toLowerCase().includes(searchTerm) || g.realm.toLowerCase().includes(searchTerm) || `${g.name} - ${g.realm}`.toLowerCase().includes(searchTerm);
        return matches && !excludeSet.has(key);
      })
      .slice(0, 50);
  }, [query, guilds, excludeSet]);

  const handleChange = (selectedGuild: SimpleGuild | null) => {
    if (selectedGuild) {
      onChange({ guildName: selectedGuild.name, realm: selectedGuild.realm });
      setQuery("");
    } else {
      onChange(null);
      setQuery("");
    }
  };

  const comboboxValue = useMemo(() => {
    if (!value) return null;
    return guilds.find((g) => g.name === value.guildName && g.realm === value.realm) || null;
  }, [value, guilds]);

  return (
    <Combobox value={comboboxValue} onChange={handleChange} disabled={disabled} immediate>
      <div className="relative w-full">
        <Combobox.Input
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed pr-8"
          displayValue={(guild: SimpleGuild | null) => (guild ? (guild.realm !== "RWF" ? `${guild.name} - ${guild.realm}` : guild.name) : "")}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => handleChange(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white z-10"
            aria-label="Clear selection"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        <Combobox.Options
          anchor="bottom start"
          className="w-[--input-width] bg-gray-800 border border-gray-600 rounded-md shadow-xl max-h-60 overflow-auto empty:invisible [--anchor-gap:4px] z-50"
        >
          {filteredGuilds.length === 0 && query !== "" ? (
            <div className="px-3 py-2 text-gray-400 text-sm">No guilds found</div>
          ) : (
            filteredGuilds.map((guild) => (
              <Combobox.Option key={`${guild.name}-${guild.realm}`} value={guild} className="cursor-pointer">
                {({ focus, selected }) => (
                  <div className={`px-3 py-2 text-white ${focus ? "bg-gray-700" : ""} ${selected ? "font-semibold" : ""}`}>
                    <span className="font-medium">{guild.name}</span>
                    {guild.realm !== "RWF" && <span className="text-gray-400 ml-2">- {guild.realm}</span>}
                  </div>
                )}
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </div>
    </Combobox>
  );
}

function GuildRankingsTable({ rankings, cutoffRank }: { rankings: GuildRanking[]; cutoffRank?: number }) {
  const t = useTranslations("pickemsPage");

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700 text-xs">
            <th className="text-left py-1.5 px-2">#</th>
            <th className="text-left py-1.5 px-2">{t("guild")}</th>
            <th className="text-right py-1.5 px-2">{t("progress")}</th>
          </tr>
        </thead>
        <tbody>
          {rankings.slice(0, 15).map((guild) => (
            <tr
              key={`${guild.name}-${guild.realm}`}
              className={`border-b ${guild.rank === cutoffRank ? "border-b-2 border-blue-500/60" : "border-gray-700/50"} ${guild.isComplete ? "bg-green-900/20" : ""}`}
            >
              <td className="py-1.5 px-2 text-gray-300 font-medium text-xs">{guild.rank}</td>
              <td className="py-1.5 px-2">
                <div className="min-w-0">
                  <span className="text-white font-medium block truncate text-sm leading-tight">{guild.name}</span>
                  <span className="text-gray-500 text-xs block truncate leading-tight">{guild.realm}</span>
                </div>
              </td>
              <td className="py-1.5 px-2 text-right whitespace-nowrap">
                <span className={`text-xs ${guild.isComplete ? "text-green-400" : "text-gray-300"}`}>
                  {guild.bossesKilled}/{guild.totalBosses}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SPOREFALL_RAID_ID = 50;

function HistoricalGuildRankings({ pickemId }: { pickemId: string }) {
  const t = useTranslations("pickemsPage");
  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const { data: raids = [], isLoading: raidsLoading, error: raidsError, refetch: refetchRaids } = useRaids();
  const referenceRaids = useMemo(() => raids.filter((raid) => raid.id !== SPOREFALL_RAID_ID && (!raid.isCurrent || raid.isPrimary)), [raids]);
  const selectedRaidIndex = referenceRaids.findIndex((raid) => raid.id === selectedRaidId);
  const olderRaid = selectedRaidIndex >= 0 ? referenceRaids[selectedRaidIndex + 1] : undefined;
  const newerRaid = selectedRaidIndex > 0 ? referenceRaids[selectedRaidIndex - 1] : undefined;

  useEffect(() => {
    setSelectedRaidId((currentRaidId) => {
      if (currentRaidId !== null && referenceRaids.some((raid) => raid.id === currentRaidId)) {
        return currentRaidId;
      }
      return referenceRaids[0]?.id ?? null;
    });
  }, [referenceRaids]);

  const {
    data: rankings = [],
    isLoading: rankingsLoading,
    error: rankingsError,
    refetch: refetchRankings,
  } = usePickemReferenceRankings(pickemId, selectedRaidId);

  if (raidsLoading) {
    return <div className="h-16 rounded-md bg-gray-700/50 animate-pulse motion-reduce:animate-none" aria-label={t("historicalRankingsLoading")} />;
  }

  if (raidsError) {
    return (
      <div className="rounded-md bg-red-950/40 px-3 py-3 text-sm text-red-200" role="alert">
        <p>{t("historicalRaidsLoadFailed")}</p>
        <button type="button" onClick={() => void refetchRaids()} className="mt-2 font-medium text-red-100 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
          {t("retry")}
        </button>
      </div>
    );
  }

  if (referenceRaids.length === 0) {
    return <p className="rounded-md bg-gray-900/50 px-3 py-4 text-sm text-gray-300">{t("noHistoricalRaids")}</p>;
  }

  return (
    <div>
      <label htmlFor={`pickem-reference-raid-${pickemId}`} className="mb-1.5 block text-xs font-medium text-gray-300">
        {t("historicalRaidLabel")}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => olderRaid && setSelectedRaidId(olderRaid.id)}
          disabled={!olderRaid}
          aria-label={t("olderRaid")}
          title={t("olderRaid")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-700 text-gray-200 transition-[background-color,color,transform] duration-150 hover:bg-gray-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-gray-700 disabled:active:scale-100"
        >
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m12.5 15-5-5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <select
          id={`pickem-reference-raid-${pickemId}`}
          value={selectedRaidId ?? ""}
          onChange={(event) => setSelectedRaidId(Number(event.target.value))}
          className="min-w-0 flex-1 rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {referenceRaids.map((raid) => (
            <option key={raid.id} value={raid.id}>
              {raid.name} — {raid.expansion}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => newerRaid && setSelectedRaidId(newerRaid.id)}
          disabled={!newerRaid}
          aria-label={t("newerRaid")}
          title={t("newerRaid")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-700 text-gray-200 transition-[background-color,color,transform] duration-150 hover:bg-gray-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-gray-700 disabled:active:scale-100"
        >
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m7.5 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-400">{t("historicalRankingsHelp")}</p>

      <div className="mt-3" aria-busy={rankingsLoading}>
        {rankingsLoading ? (
          <div className="space-y-1.5" role="status">
            <span className="sr-only">{t("historicalRankingsLoading")}</span>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-9 rounded bg-gray-700/50 animate-pulse motion-reduce:animate-none" />
            ))}
          </div>
        ) : rankingsError ? (
          <div className="rounded-md bg-red-950/40 px-3 py-3 text-sm text-red-200" role="alert">
            <p>{t("historicalRankingsLoadFailed")}</p>
            <button
              type="button"
              onClick={() => void refetchRankings()}
              className="mt-2 font-medium text-red-100 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
            >
              {t("retry")}
            </button>
          </div>
        ) : rankings.length === 0 ? (
          <p className="rounded-md bg-gray-900/50 px-3 py-4 text-sm text-gray-300">{t("historicalRankingsEmpty")}</p>
        ) : (
          <GuildRankingsTable rankings={rankings} />
        )}
      </div>
    </div>
  );
}

// Sortable prediction item component
interface SortableItemData {
  id: string;
  position: number;
  prediction: PickemPrediction | null;
}

function SortablePredictionItem({
  data,
  guilds,
  disabled,
  excludeGuilds,
  onChange,
  droppingIndex,
}: {
  data: SortableItemData;
  guilds: SimpleGuild[];
  disabled: boolean;
  excludeGuilds: { guildName: string; realm: string }[];
  onChange: (position: number, guild: { guildName: string; realm: string } | null) => void;
  droppingIndex: number | null;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: data.id,
    disabled: disabled || !data.prediction,
  });

  const isDropping = droppingIndex === data.position - 1;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
    zIndex: isDragging || isDropping ? 1000 : undefined,
    position: isDragging || isDropping ? "relative" : undefined,
    willChange: "transform",
  };

  return (
    <div
      ref={setNodeRef}
      style={style as React.CSSProperties}
      className={`flex pr-2 items-stretch gap-2 bg-gray-800 rounded-lg border ${isDragging ? "" : "transition-all"} ${
        isDragging ? "border-blue-500 shadow-2xl bg-gray-750" : "border-gray-700 hover:border-gray-600"
      } ${!disabled && data.prediction ? "hover:bg-gray-750" : ""}`}
    >
      <div className="flex items-center pl-3 py-2">
        <span className="w-8 h-8 flex items-center justify-center bg-gray-700 rounded-full text-white font-bold text-sm shrink-0">{data.position}</span>
      </div>

      <div className="flex-1 py-2 min-w-0">
        <GuildAutocomplete
          value={
            data.prediction
              ? {
                  guildName: data.prediction.guildName,
                  realm: data.prediction.realm,
                }
              : null
          }
          onChange={(guild) => onChange(data.position, guild)}
          guilds={guilds}
          placeholder="Search and select a guild..."
          disabled={disabled}
          excludeGuilds={excludeGuilds}
        />
      </div>

      {!disabled && data.prediction && (
        <div className="flex items-center">
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            className="text-gray-500 hover:text-white cursor-grab active:cursor-grabbing touch-none transition-colors rounded hover:bg-gray-700 w-12 h-8 flex items-center justify-center"
            title="Drag to reorder"
            aria-label="Drag to reorder"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// Helper: get prize for a specific place
function getPrizeForPlace(prizeConfig: PrizeConfig, place: number): number {
  const tier = prizeConfig.distribution.find((d) => d.place === place);
  if (!tier) return 0;
  return Math.round((prizeConfig.goldPool * tier.percentage) / 100);
}

// Compute tie-aware ranks and split prizes for tied users.
// Users with the same totalPoints share the same rank and split
// the combined prize money for the positions they occupy.
function computeLeaderboardRanksAndPrizes(leaderboard: LeaderboardEntry[], prizeConfig: PrizeConfig | undefined, prizeEnabled: boolean): { rank: number; prize: number }[] {
  const result: { rank: number; prize: number }[] = [];
  let i = 0;
  while (i < leaderboard.length) {
    // Find the group of users tied at the same totalPoints
    let j = i;
    while (j < leaderboard.length && leaderboard[j].totalPoints === leaderboard[i].totalPoints) {
      j++;
    }
    const tiedCount = j - i;
    const rank = i + 1; // all tied users share this rank

    // Sum the prizes for positions i+1 through j (the positions this tied group occupies)
    let combinedPrize = 0;
    if (prizeEnabled && prizeConfig) {
      for (let pos = i + 1; pos <= j; pos++) {
        combinedPrize += getPrizeForPlace(prizeConfig, pos);
      }
    }
    const splitPrize = tiedCount > 0 ? Math.round(combinedPrize / tiedCount) : 0;

    for (let k = i; k < j; k++) {
      result.push({ rank, prize: splitPrize });
    }
    i = j;
  }
  return result;
}

// Prize pool display banner component
function PrizePoolBanner({ prizeConfig }: { prizeConfig: PrizeConfig }) {
  if (!prizeConfig.enabled || prizeConfig.goldPool <= 0) return null;

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="bg-linear-to-r from-amber-900/30 via-yellow-900/20 to-amber-900/30 rounded-lg p-4 border border-amber-700/40">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🏆</span>
        <span className="text-amber-300 font-bold text-base">Prize Pool: {prizeConfig.goldPool.toLocaleString()} gold</span>
      </div>
      {prizeConfig.distribution.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {prizeConfig.distribution.slice(0, 5).map((d, i) => {
            const amount = Math.round((prizeConfig.goldPool * d.percentage) / 100);
            return (
              <span key={d.place} className="text-amber-200/80">
                {medals[i] || `#${d.place}`} {d.percentage}% ({amount.toLocaleString()}g)
              </span>
            );
          })}
        </div>
      )}
      {prizeConfig.description && <p className="text-amber-200/60 text-xs mt-2">{prizeConfig.description}</p>}
    </div>
  );
}

// Custom Pickem Selector component with "All Pickems" option
function PickemSelector({
  pickems,
  selectedId,
  onSelect,
  getTimeRemaining,
}: {
  pickems: PickemSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  getTimeRemaining: (endDate: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("pickemsPage");

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedPickem = pickems.find((p) => p.id === selectedId);

  const getStatusInfo = (pickem: PickemSummary) => {
    const now = new Date();
    const start = new Date(pickem.votingStart);
    const end = new Date(pickem.votingEnd);

    if (now < start) {
      return { status: t("votingNotStarted"), color: "text-gray-400", bgColor: "bg-gray-700" };
    } else if (now <= end) {
      return { status: getTimeRemaining(pickem.votingEnd), color: "text-green-400", bgColor: "bg-green-900/30" };
    } else if (pickem.finalized) {
      return { status: t("finalized"), color: "text-emerald-400", bgColor: "bg-emerald-900/20" };
    } else {
      return { status: t("awaitingResults"), color: "text-amber-400", bgColor: "bg-amber-900/20" };
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label htmlFor="pickem-select" className="text-xs text-gray-400 mb-1 block">
        {t("selectPickem")}
      </label>
      <button
        id="pickem-select"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-3 min-w-[350px] justify-between hover:bg-gray-750 transition-colors w-full"
      >
        {selectedPickem ? (
          <div className="flex flex-col items-start gap-1 flex-1">
            <span className="font-semibold">{selectedPickem.name}</span>
            <span className={`text-xs ${getStatusInfo(selectedPickem).color}`}>{getStatusInfo(selectedPickem).status}</span>
          </div>
        ) : selectedId ? (
          <div className="flex flex-col items-start gap-1 flex-1">
            <span className="font-semibold">{selectedId}</span>
            <span className="text-xs text-gray-400">Loading pickem</span>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-1 flex-1">
            <span className="font-semibold">All Pickems</span>
            <span className="text-xs text-gray-400">Browse all available pickems</span>
          </div>
        )}
        <svg className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-96 overflow-y-auto">
          {/* All Pickems option */}
          <button
            onClick={() => {
              onSelect(null);
              setIsOpen(false);
            }}
            className={`w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors flex items-center justify-between border-b border-gray-700 ${
              selectedId === null ? "bg-gray-700" : ""
            }`}
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">All Pickems</span>
              <span className="text-xs text-gray-400">View all pickems overview</span>
            </div>
          </button>

          {pickems.map((pickem) => {
            const statusInfo = getStatusInfo(pickem);
            return (
              <button
                key={pickem.id}
                onClick={() => {
                  onSelect(pickem.id);
                  setIsOpen(false);
                }}
                className={`w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors flex items-center justify-between ${pickem.id === selectedId ? "bg-gray-700" : ""} ${
                  statusInfo.bgColor
                }`}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{pickem.name}</span>
                  <span className={`text-xs ${statusInfo.color}`}>{statusInfo.status}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Points display with color coding
function PointsBadge({ points }: { points: number }) {
  let bgColor = "bg-gray-600";
  if (points === 10) bgColor = "bg-green-600";
  else if (points >= 6) bgColor = "bg-yellow-600";
  else if (points >= 2) bgColor = "bg-orange-600";
  else if (points === 0) bgColor = "bg-red-600";

  return <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded ${bgColor} text-white`}>{points}</span>;
}

// Landing page card for a single pickem
function PickemCard({ pickem, getTimeRemaining, onClick }: { pickem: PickemSummary; getTimeRemaining: (endDate: string) => string; onClick: () => void }) {
  const now = new Date();
  const start = new Date(pickem.votingStart);
  const end = new Date(pickem.votingEnd);

  const isUpcoming = now < start;
  const isActive = now >= start && now <= end;
  const hasEnded = now > end;

  const prizeEnabled = pickem.prizeConfig?.enabled && (pickem.prizeConfig?.goldPool ?? 0) > 0;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left cursor-pointer bg-gray-800 rounded-xl border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20 group overflow-hidden ${
        isActive ? "border-emerald-700/60 hover:border-emerald-600/80" : "border-gray-700 hover:border-gray-600"
      }`}
    >
      <div className="p-5">
        {/* Header: name + type badge */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-white font-semibold text-lg leading-tight group-hover:text-blue-300 transition-colors">{pickem.name}</h3>
          <span
            className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
              pickem.type === "rwf" ? "bg-purple-900/60 text-purple-300 border border-purple-700/50" : "bg-blue-900/60 text-blue-300 border border-blue-700/50"
            }`}
          >
            {pickem.type === "rwf" ? "RWF" : "Regular"}
          </span>
        </div>

        {/* Status line */}
        <div className="flex items-center gap-2 mb-3">
          {isActive && (
            <>
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-sm font-medium">Voting Open</span>
              <span className="text-gray-500 text-xs ml-auto">{getTimeRemaining(pickem.votingEnd)}</span>
            </>
          )}
          {isUpcoming && (
            <>
              <div className="w-2 h-2 rounded-full bg-blue-400" />
              <span className="text-blue-400 text-sm font-medium">Upcoming</span>
              <span className="text-gray-500 text-xs ml-auto">Starts {new Date(pickem.votingStart).toLocaleDateString()}</span>
            </>
          )}
          {hasEnded && (
            <>
              {pickem.finalized ? (
                <>
                  <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-emerald-400 text-sm font-medium">Finalized</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-amber-400 text-sm font-medium">Awaiting Results</span>
                </>
              )}
            </>
          )}
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Top {pickem.guildCount} guilds</span>
          {isActive && <span className="text-emerald-400/80 font-medium">Vote now →</span>}
        </div>
      </div>

      {/* Prize section */}
      {prizeEnabled && pickem.prizeConfig && (
        <div className="px-5 py-3 bg-linear-to-r from-amber-900/20 to-yellow-900/10 border-t border-amber-800/30">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm">🏆</span>
            <span className="text-amber-300 font-semibold text-sm">{pickem.prizeConfig.goldPool.toLocaleString()} gold</span>
          </div>
          {pickem.prizeConfig.distribution.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-amber-200/60">
              {pickem.prizeConfig.distribution.slice(0, 3).map((d, i) => {
                const amount = Math.round((pickem.prizeConfig!.goldPool * d.percentage) / 100);
                return (
                  <span key={d.place}>
                    {medals[i] || `#${d.place}`} {amount.toLocaleString()}g
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// Landing page view showing all pickems in a grid, split by lifecycle phase
function PickemsLandingView({
  pickems,
  getTimeRemaining,
  onSelectPickem,
}: {
  pickems: PickemSummary[];
  getTimeRemaining: (endDate: string) => string;
  onSelectPickem: (id: string) => void;
}) {
  const now = new Date();

  // Phase 1: Voting still open (including upcoming)
  const activePickems = pickems.filter((p) => {
    const end = new Date(p.votingEnd);
    return now <= end;
  });

  // Phase 2: Voting closed but not yet finalized
  const awaitingResultsPickems = pickems.filter((p) => {
    const end = new Date(p.votingEnd);
    return now > end && !p.finalized;
  });

  // Phase 3: Finalized — split into recent (< 6 months) and archived (>= 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const completedPickems = pickems.filter((p) => {
    return p.finalized && (!p.finalizedAt || new Date(p.finalizedAt) >= sixMonthsAgo);
  });

  const archivedPickems = pickems.filter((p) => {
    return p.finalized && p.finalizedAt && new Date(p.finalizedAt) < sixMonthsAgo;
  });

  const currentSections = [
    {
      id: "active",
      title: "Active Pickems",
      titleClassName: "text-white",
      icon: <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />,
      pickems: activePickems,
    },
    {
      id: "awaiting-results",
      title: "Awaiting Results",
      titleClassName: "text-amber-400",
      icon: <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />,
      pickems: awaitingResultsPickems,
    },
    {
      id: "completed",
      title: "Completed",
      titleClassName: "text-gray-400",
      icon: (
        <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ),
      pickems: completedPickems,
    },
  ];

  // Single-card lifecycle sections share a row; phases with multiple cards stay grouped.
  const singletonCurrentSections = currentSections.filter((section) => section.pickems.length === 1);
  const shouldShareSingletonRows = singletonCurrentSections.length >= 2;
  const sharedCurrentSections = shouldShareSingletonRows ? singletonCurrentSections : [];
  const standaloneCurrentSections = currentSections.filter((section) => section.pickems.length > 0 && (!shouldShareSingletonRows || section.pickems.length > 1));

  const renderPickemCard = (pickem: PickemSummary) => <PickemCard key={pickem.id} pickem={pickem} getTimeRemaining={getTimeRemaining} onClick={() => onSelectPickem(pickem.id)} />;

  return (
    <div className="space-y-8">
      {sharedCurrentSections.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span>Current Pickems</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sharedCurrentSections.map((section) => (
              <div key={section.id} className="space-y-3">
                <h3 className={`text-sm font-semibold flex items-center gap-2 ${section.titleClassName}`}>
                  {section.icon}
                  {section.title}
                </h3>
                {renderPickemCard(section.pickems[0])}
              </div>
            ))}
          </div>
        </section>
      )}

      {standaloneCurrentSections.map((section) => (
        <section key={section.id}>
          <h2 className={`text-lg font-semibold mb-4 flex items-center gap-2 ${section.titleClassName}`}>
            {section.icon}
            {section.title}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{section.pickems.map(renderPickemCard)}</div>
        </section>
      ))}

      {archivedPickems.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-500 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            Archive
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {archivedPickems.map((p) => (
              <PickemCard key={p.id} pickem={p} getTimeRemaining={getTimeRemaining} onClick={() => onSelectPickem(p.id)} />
            ))}
          </div>
        </section>
      )}

      {pickems.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">No pickems available yet.</p>
        </div>
      )}
    </div>
  );
}

function getUrlPickemId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("pickem");
}

type PredictionSource = "empty" | "server" | "guest";
type GuestDraftNotice = "saved" | "storage_error" | "existing" | "closed" | null;

function placePredictions(predictions: PickemPrediction[], guildCount: number): (PickemPrediction | null)[] {
  const placedPredictions: (PickemPrediction | null)[] = Array(guildCount).fill(null);
  predictions.forEach((prediction) => {
    if (prediction.position >= 1 && prediction.position <= guildCount) {
      placedPredictions[prediction.position - 1] = prediction;
    }
  });
  return placedPredictions;
}

export default function PickemsPage() {
  const t = useTranslations("pickemsPage");
  const router = useRouter();
  const { user, isLoading: authLoading, login } = useAuth();

  const [pickems, setPickems] = useState<PickemSummary[]>([]);
  const [selectedPickemId, setSelectedPickemId] = useState<string | null>(null);
  const [pickemDetails, setPickemDetails] = useState<PickemDetails | null>(null);

  const [predictions, setPredictions] = useState<(PickemPrediction | null)[]>([]);
  const [predictionSource, setPredictionSource] = useState<PredictionSource>("empty");
  const [guestDraft, setGuestDraft] = useState<GuestPickemDraft | null>(null);
  const [guestDraftNotice, setGuestDraftNotice] = useState<GuestDraftNotice>(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showScoringInfo, setShowScoringInfo] = useState(false);
  const [droppingIndex, setDroppingIndex] = useState<number | null>(null);
  const automaticImportAttemptRef = useRef<string | null>(null);
  const selectedPickemIdRef = useRef<string | null>(null);

  const raidType = pickems.find((p) => p.id === selectedPickemId)?.type === "rwf" ? "rwf" : "overall";
  const { data: guildsData = [] } = usePickemsGuilds(raidType);

  useEffect(() => {
    const syncSelectedPickemFromUrl = () => {
      const nextPickemId = getUrlPickemId();
      selectedPickemIdRef.current = nextPickemId;
      setSelectedPickemId(nextPickemId);
      setPickemDetails(null);
      setDetailsLoading(nextPickemId !== null);
      setPredictions([]);
      setPredictionSource("empty");
      setGuestDraft(null);
      setGuestDraftNotice(null);
      automaticImportAttemptRef.current = null;
      setSubmitting(false);
      setError(null);
      setSuccessMessage(null);
    };

    syncSelectedPickemFromUrl();
    window.addEventListener("popstate", syncSelectedPickemFromUrl);

    return () => window.removeEventListener("popstate", syncSelectedPickemFromUrl);
  }, []);

  const hydratePickemDetails = useCallback((details: PickemDetails) => {
    setPickemDetails(details);

    const guildCount = details.guildCount || 10;
    const storedGuestDraft = readGuestPickemDraft(details.id, guildCount);

    if (details.userPredictions && details.userPredictions.length > 0) {
      setPredictions(placePredictions(details.userPredictions, guildCount));
      setPredictionSource("server");

      if (storedGuestDraft?.pendingImport) {
        const resolvedDraft = setGuestPickemPendingImport(details.id, guildCount, false);
        setGuestDraft(resolvedDraft);
        setGuestDraftNotice("existing");
      } else {
        setGuestDraft(storedGuestDraft);
      }
      return;
    }

    if (storedGuestDraft) {
      setPredictions(storedGuestDraft.predictions);
      setPredictionSource("guest");
      setGuestDraft(storedGuestDraft);
      return;
    }

    setPredictions(Array(guildCount).fill(null));
    setPredictionSource("empty");
    setGuestDraft(null);
  }, []);

  const handlePickemSelect = useCallback(
    (id: string | null) => {
      selectedPickemIdRef.current = id;
      setSelectedPickemId(id);
      setPickemDetails(null);
      setDetailsLoading(id !== null);
      setPredictions([]);
      setPredictionSource("empty");
      setGuestDraft(null);
      setGuestDraftNotice(null);
      automaticImportAttemptRef.current = null;
      setSubmitting(false);
      setError(null);
      setSuccessMessage(null);
      router.push(id ? `/pickems?pickem=${encodeURIComponent(id)}` : "/pickems");
    },
    [router],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Fetch pickems list on mount — do NOT auto-select first pickem
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const pickemsData = await api.getPickems();
        setPickems(pickemsData);
      } catch (err) {
        setError("Failed to load pickems");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Fetch pickem details when selection changes
  useEffect(() => {
    if (!selectedPickemId) {
      setPickemDetails(null);
      setDetailsLoading(false);
      return;
    }

    const requestedPickemId = selectedPickemId;
    let cancelled = false;

    const fetchDetails = async () => {
      try {
        setDetailsLoading(true);
        setPickemDetails(null);
        setError(null);
        const details = await api.getPickemDetails(requestedPickemId);
        if (cancelled || selectedPickemIdRef.current !== requestedPickemId || details.id !== requestedPickemId) return;
        hydratePickemDetails(details);
      } catch (err) {
        if (cancelled || selectedPickemIdRef.current !== requestedPickemId) return;
        setPickemDetails(null);
        setPredictions([]);
        setError("Failed to load pickem details");
        console.error(err);
      } finally {
        if (cancelled || selectedPickemIdRef.current !== requestedPickemId) return;
        setDetailsLoading(false);
      }
    };

    void fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedPickemId, user, hydratePickemDetails]);

  useEffect(() => {
    if (!selectedPickemId || !pickemDetails || predictionSource === "server") return;

    const requestedPickemId = selectedPickemId;
    const guildCount = pickemDetails.guildCount || 10;
    const storageKey = getGuestPickemDraftStorageKey(requestedPickemId);

    const syncGuestDraft = (event: StorageEvent) => {
      if (event.key !== storageKey || selectedPickemIdRef.current !== requestedPickemId) return;

      const storedGuestDraft = readGuestPickemDraft(requestedPickemId, guildCount);
      setGuestDraft(storedGuestDraft);

      if (storedGuestDraft) {
        setPredictions(storedGuestDraft.predictions);
        setPredictionSource("guest");
      } else {
        setPredictions(Array(guildCount).fill(null));
        setPredictionSource("empty");
      }
    };

    window.addEventListener("storage", syncGuestDraft);
    return () => window.removeEventListener("storage", syncGuestDraft);
  }, [selectedPickemId, pickemDetails, predictionSource]);

  const persistGuestPredictions = useCallback(
    (nextPredictions: (PickemPrediction | null)[]) => {
      if (!selectedPickemId || !pickemDetails) return;

      const savedDraft = saveGuestPickemDraft(selectedPickemId, pickemDetails.guildCount || 10, nextPredictions);
      if (!savedDraft) {
        setGuestDraftNotice("storage_error");
        return;
      }

      setGuestDraft(savedDraft);
      setPredictionSource("guest");
      setGuestDraftNotice("saved");
    },
    [selectedPickemId, pickemDetails],
  );

  // Handle prediction change (unified for both regular and RWF)
  const handlePredictionChange = useCallback(
    (position: number, guild: { guildName: string; realm: string } | null) => {
      const newPredictions = [...predictions];
      if (guild) {
        newPredictions[position - 1] = {
          guildName: guild.guildName,
          realm: guild.realm,
          position,
        };
      } else {
        newPredictions[position - 1] = null;
      }

      setPredictions(newPredictions);
      if (!user || predictionSource === "guest") {
        persistGuestPredictions(newPredictions);
      }
      setError(null);
      setSuccessMessage(null);
    },
    [predictions, user, predictionSource, persistGuestPredictions],
  );

  // Handle drag end with dnd-kit
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = predictions.findIndex((_, idx) => `prediction-${idx}` === active.id);
      const newIndex = predictions.findIndex((_, idx) => `prediction-${idx}` === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      setDroppingIndex(newIndex);
      setTimeout(() => setDroppingIndex(null), 150);

      const newPredictions = arrayMove(predictions, oldIndex, newIndex).map((prediction, index) => {
        if (prediction) {
          return { ...prediction, position: index + 1 };
        }
        return null;
      });

      setPredictions(newPredictions);
      if (!user || predictionSource === "guest") {
        persistGuestPredictions(newPredictions);
      }
      setError(null);
      setSuccessMessage(null);
    }
  };

  const getCompletePredictions = useCallback((): PickemPrediction[] | null => {
    if (!pickemDetails) return null;
    const guildCount = pickemDetails.guildCount || 10;
    const filledPredictions = predictions.filter((p): p is PickemPrediction => p !== null);

    if (filledPredictions.length !== guildCount) {
      setError(t("fillAllPositions", { count: guildCount }));
      return null;
    }

    const guildKeys = new Set<string>();
    for (const pred of filledPredictions) {
      const key = `${pred.guildName}\u0000${pred.realm}`;
      if (guildKeys.has(key)) {
        setError(t("duplicateGuild", { guild: pred.guildName }));
        return null;
      }
      guildKeys.add(key);
    }

    return filledPredictions;
  }, [pickemDetails, predictions, t]);

  const refreshSelectedPickemDetails = useCallback(async () => {
    if (!selectedPickemId) return;
    const requestedPickemId = selectedPickemId;
    const details = await api.getPickemDetails(requestedPickemId);
    if (selectedPickemIdRef.current !== requestedPickemId || details.id !== requestedPickemId) return;
    hydratePickemDetails(details);
  }, [selectedPickemId, hydratePickemDetails]);

  const importGuestPredictions = useCallback(async () => {
    if (!selectedPickemId || !pickemDetails || pickemDetails.id !== selectedPickemId) return;
    const requestedPickemId = selectedPickemId;
    const guildCount = pickemDetails.guildCount || 10;
    const filledPredictions = getCompletePredictions();
    if (!filledPredictions) {
      const resolvedDraft = setGuestPickemPendingImport(requestedPickemId, guildCount, false);
      if (selectedPickemIdRef.current === requestedPickemId) {
        setGuestDraft(resolvedDraft);
      }
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const result = await api.importGuestPickemPredictions(requestedPickemId, filledPredictions);

      if (result.status === "imported") {
        clearGuestPickemDraft(requestedPickemId);
        if (selectedPickemIdRef.current !== requestedPickemId) return;

        setGuestDraft(null);
        setGuestDraftNotice(null);
        setSuccessMessage(t("guestImportSuccess"));
        try {
          await refreshSelectedPickemDetails();
        } catch (refreshError) {
          console.error("Guest predictions were imported, but Pickem details could not be refreshed:", refreshError);
          if (selectedPickemIdRef.current === requestedPickemId) {
            setPredictionSource("server");
          }
        }
        return;
      }

      const resolvedDraft = setGuestPickemPendingImport(requestedPickemId, guildCount, false);
      if (selectedPickemIdRef.current !== requestedPickemId) return;

      setGuestDraft(resolvedDraft);

      if (result.status === "already_exists") {
        setGuestDraftNotice("existing");
        try {
          await refreshSelectedPickemDetails();
        } catch (refreshError) {
          console.error("Account predictions were preserved, but Pickem details could not be refreshed:", refreshError);
        }
      } else {
        setGuestDraftNotice("closed");
      }
    } catch (err) {
      const resolvedDraft = setGuestPickemPendingImport(requestedPickemId, guildCount, false);
      if (selectedPickemIdRef.current !== requestedPickemId) return;

      setGuestDraft(resolvedDraft);
      setError(err instanceof Error ? err.message : t("guestImportFailed"));
    } finally {
      if (selectedPickemIdRef.current === requestedPickemId) {
        setSubmitting(false);
      }
    }
  }, [selectedPickemId, pickemDetails, getCompletePredictions, refreshSelectedPickemDetails, t]);

  useEffect(() => {
    if (!user || !selectedPickemId || !pickemDetails || predictionSource !== "guest" || !guestDraft?.pendingImport) {
      return;
    }

    const attemptKey = `${user.discord.username}\u0000${selectedPickemId}\u0000${guestDraft.updatedAt}`;
    if (automaticImportAttemptRef.current === attemptKey) {
      return;
    }
    automaticImportAttemptRef.current = attemptKey;

    if (!pickemDetails.isVotingOpen) {
      const resolvedDraft = setGuestPickemPendingImport(selectedPickemId, pickemDetails.guildCount || 10, false);
      setGuestDraft(resolvedDraft);
      setGuestDraftNotice("closed");
      return;
    }

    void importGuestPredictions();
  }, [user, selectedPickemId, pickemDetails, predictionSource, guestDraft, importGuestPredictions]);

  const handleGuestLogin = async () => {
    if (!selectedPickemId || !pickemDetails) return;
    const filledPredictions = getCompletePredictions();
    if (!filledPredictions) return;

    const pendingDraft = saveGuestPickemDraft(selectedPickemId, pickemDetails.guildCount || 10, filledPredictions, { pendingImport: true });
    if (!pendingDraft) {
      setGuestDraftNotice("storage_error");
      return;
    }

    setGuestDraft(pendingDraft);
    setPredictionSource("guest");
    await login(`/pickems?pickem=${encodeURIComponent(selectedPickemId)}`);
  };

  // Submit or update account predictions.
  const handleSubmit = async () => {
    if (!selectedPickemId || !pickemDetails || pickemDetails.id !== selectedPickemId) return;

    if (predictionSource === "guest") {
      await importGuestPredictions();
      return;
    }

    const requestedPickemId = selectedPickemId;
    const filledPredictions = getCompletePredictions();
    if (!filledPredictions) return;

    try {
      setSubmitting(true);
      setError(null);
      const result = await api.submitPickemPredictions(requestedPickemId, filledPredictions);
      if (selectedPickemIdRef.current !== requestedPickemId) return;

      setSuccessMessage(result.message);
      setTimeout(() => {
        if (selectedPickemIdRef.current === requestedPickemId) {
          setSuccessMessage(null);
        }
      }, 3000);
      await refreshSelectedPickemDetails();
    } catch (err) {
      if (selectedPickemIdRef.current !== requestedPickemId) return;
      setError(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      if (selectedPickemIdRef.current === requestedPickemId) {
        setSubmitting(false);
      }
    }
  };

  const getTimeRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return "Voting ended";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  const sortedGuilds = useMemo(() => {
    return [...guildsData].sort((a, b) => a.name.localeCompare(b.name));
  }, [guildsData]);

  const getExcludedGuilds = useCallback(
    (currentPosition: number) => {
      return predictions.filter((p, idx) => p !== null && idx !== currentPosition - 1).map((p) => ({ guildName: p!.guildName, realm: p!.realm }));
    },
    [predictions],
  );

  // Get scoring config from the current pickem (or defaults)
  const scoringConfig = useMemo(() => {
    return (
      pickemDetails?.scoringConfig ?? {
        exactMatch: 10,
        offByOne: 8,
        offByTwo: 6,
        offByThree: 4,
        offByFour: 2,
        offByFiveOrMore: 0,
      }
    );
  }, [pickemDetails]);

  // Whether this is an unfinalized RWF pickem (scores should show as pending)
  const isUnfinalizedRwf = pickemDetails?.type === "rwf" && !pickemDetails?.finalized;
  const rankingsPending = pickemDetails?.rankingsPending ?? false;
  const scoresPending = isUnfinalizedRwf || rankingsPending;

  // Prize config helpers for detail view
  const detailPrizeEnabled = pickemDetails?.prizeConfig?.enabled && (pickemDetails?.prizeConfig?.goldPool ?? 0) > 0;

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (pickems.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-6">{t("title")}</h1>
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">{t("noPickems")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4 pb-8">
      {/* Pickem Selector */}
      <div className="mb-6">
        <PickemSelector pickems={pickems} selectedId={selectedPickemId} onSelect={handlePickemSelect} getTimeRemaining={getTimeRemaining} />
      </div>

      {/* Route: Landing vs Detail */}
      {selectedPickemId === null ? (
        <PickemsLandingView pickems={pickems} getTimeRemaining={getTimeRemaining} onSelectPickem={handlePickemSelect} />
      ) : detailsLoading ? (
        <div className="flex justify-center items-center min-h-[300px]">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : pickemDetails ? (
        <div className="space-y-4">
          {/* Top Banners - ranking status and/or Prize Pool as wide banners */}
          {(pickemDetails.type === "rwf" || rankingsPending || detailPrizeEnabled) && (
            <div className="flex flex-col sm:flex-row gap-3">
              {rankingsPending && (
                <div className="flex-1 rounded-lg px-4 py-3 border border-amber-700/50 bg-amber-950/30 flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-amber-400" />
                  <div className="min-w-0">
                    <span className="font-semibold text-sm text-amber-200">{t("rankingsPendingTitle")}</span>
                    <p className="text-xs text-gray-300 mt-0.5">{t("rankingsPendingDescription")}</p>
                  </div>
                </div>
              )}

              {/* RWF Status Banner */}
              {pickemDetails.type === "rwf" && (
                <div
                  className={`flex-1 rounded-lg px-4 py-3 border flex items-center gap-3 ${pickemDetails.finalized ? "bg-emerald-900/20 border-emerald-700/50" : "bg-purple-900/20 border-purple-700/50"}`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${pickemDetails.finalized ? "bg-emerald-400" : "bg-purple-400 animate-pulse"}`} />
                  <div className="min-w-0">
                    <span className={`font-semibold text-sm ${pickemDetails.finalized ? "text-emerald-300" : "text-purple-300"}`}>
                      {pickemDetails.finalized ? "Race Finished — Results Finalized" : "Race in Progress"}
                    </span>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {pickemDetails.finalized ? "Final rankings have been set. Scores are calculated." : "Scores will be calculated when the race ends and results are finalized."}
                    </p>
                  </div>
                </div>
              )}

              {/* Prize Pool Banner */}
              {detailPrizeEnabled && pickemDetails.prizeConfig && (
                <div className="flex-1 rounded-lg px-4 py-3 border border-amber-700/40 bg-linear-to-r from-amber-900/30 via-yellow-900/20 to-amber-900/30 flex items-center gap-3">
                  <span className="text-lg shrink-0">🏆</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-amber-300 font-semibold text-sm">Prize Pool: {pickemDetails.prizeConfig.goldPool.toLocaleString()} gold</span>
                    {pickemDetails.prizeConfig.distribution.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-amber-200/70 mt-0.5">
                        {pickemDetails.prizeConfig.distribution.slice(0, 5).map((d, i) => {
                          const medals = ["🥇", "🥈", "🥉"];
                          const amount = Math.round((pickemDetails.prizeConfig!.goldPool * d.percentage) / 100);
                          return (
                            <span key={d.place}>
                              {medals[i] || `#${d.place}`} {d.percentage}% ({amount.toLocaleString()}g)
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main Content Grid - 3 columns for regular or finalized RWF, 2 for unfinalized RWF */}
          <div
            className={`grid grid-cols-1 gap-4 ${pickemDetails.type !== "rwf" || (pickemDetails.type === "rwf" && pickemDetails.finalized) ? "xl:grid-cols-[1fr_minmax(280px,340px)_1fr]" : "lg:grid-cols-2"}`}
          >
            {/* Column 1: Prediction Form */}
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <h3 className="text-base font-semibold text-white mb-3">{t("yourPredictions")}</h3>

                {!user && !authLoading && (
                  <div className="mb-3 rounded-lg border border-blue-700/60 bg-blue-950/40 p-3">
                    <p className="text-sm font-semibold text-blue-200">{t("guestModeTitle")}</p>
                    <p className="mt-1 text-sm text-blue-100/80">{pickemDetails.isVotingOpen ? t("guestModeDescription") : t("guestModeClosed")}</p>
                  </div>
                )}

                {user && predictionSource === "guest" && pickemDetails.isVotingOpen && (
                  <div className="mb-3 rounded-lg border border-amber-700/60 bg-amber-950/35 p-3">
                    <p className="text-sm font-semibold text-amber-200">{t("guestDraftReadyTitle")}</p>
                    <p className="mt-1 text-sm text-amber-100/80">{t("guestDraftReadyDescription")}</p>
                  </div>
                )}

                {guestDraftNotice === "existing" && (
                  <div className="mb-3 rounded-lg border border-amber-700/60 bg-amber-950/35 p-3" role="status">
                    <p className="text-sm text-amber-100">{t("guestImportExisting")}</p>
                  </div>
                )}

                {(guestDraftNotice === "closed" || (user && predictionSource === "guest" && !pickemDetails.isVotingOpen)) && (
                  <div className="mb-3 rounded-lg border border-amber-700/60 bg-amber-950/35 p-3" role="status">
                    <p className="text-sm text-amber-100">{t("guestImportClosed")}</p>
                  </div>
                )}

                {guestDraftNotice === "storage_error" && (
                  <div className="mb-3 rounded-lg border border-red-700/60 bg-red-950/40 p-3" role="alert">
                    <p className="text-sm text-red-200">{t("guestStorageFailed")}</p>
                  </div>
                )}

                {error && (
                  <div className="mb-3 p-2.5 bg-red-900/50 border border-red-700 rounded-md">
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                )}

                {/* Unified prediction UI: autocomplete + drag-and-drop for both regular and RWF */}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={Array.from({ length: pickemDetails.guildCount || 10 }, (_, i) => `prediction-${i}`)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {Array.from({ length: pickemDetails.guildCount || 10 }, (_, i) => {
                        const position = i + 1;
                        const itemData: SortableItemData = {
                          id: `prediction-${i}`,
                          position,
                          prediction: predictions[i],
                        };
                        return (
                          <SortablePredictionItem
                            key={`prediction-${i}`}
                            data={itemData}
                            guilds={sortedGuilds}
                            disabled={!pickemDetails.isVotingOpen || submitting}
                            excludeGuilds={getExcludedGuilds(position)}
                            onChange={handlePredictionChange}
                            droppingIndex={droppingIndex}
                          />
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>

                {predictionSource === "guest" && guestDraft && guestDraftNotice === "saved" && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-emerald-300" role="status">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                    {t("guestDraftSaved")}
                  </p>
                )}

                {!authLoading &&
                  pickemDetails.isVotingOpen &&
                  (successMessage ? (
                    <div className="mt-4 w-full px-4 py-3 bg-green-800/60 border border-green-600 rounded-md text-center">
                      <p className="text-green-300 text-sm font-medium">{successMessage}</p>
                    </div>
                  ) : !user ? (
                    <button
                      onClick={handleGuestLogin}
                      disabled={submitting}
                      className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800 disabled:cursor-not-allowed disabled:bg-gray-600"
                    >
                      {t("guestLoginAndSubmit")}
                    </button>
                  ) : (
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="mt-4 w-full rounded-md bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800 disabled:cursor-not-allowed disabled:bg-gray-600"
                    >
                      {submitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          {predictionSource === "guest" ? t("guestImporting") : t("submitting")}
                        </span>
                      ) : (
                        t(predictionSource === "guest" ? "guestImportButton" : "submitPredictions")
                      )}
                    </button>
                  ))}
              </div>
            </div>

            {/* Column 2: Current Guild Rankings - Only for regular pickems */}
            {pickemDetails.type !== "rwf" && (
              <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 self-start">
                <h3 className="text-base font-semibold text-white mb-2">{t("currentRankings")}</h3>
                {rankingsPending ? (
                  <HistoricalGuildRankings key={pickemDetails.id} pickemId={pickemDetails.id} />
                ) : (
                  <GuildRankingsTable rankings={pickemDetails.guildRankings} cutoffRank={pickemDetails.guildCount} />
                )}
              </div>
            )}

            {/* Column 2 for finalized RWF: Final Rankings (Top 10) */}
            {pickemDetails.type === "rwf" && pickemDetails.finalized && pickemDetails.guildRankings.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 self-start">
                <h3 className="text-base font-semibold text-white mb-2">Final Rankings</h3>
                <p className="text-xs text-gray-400 mb-2">Top {pickemDetails.guildRankings.length} — used for scoring</p>
                <div className="space-y-1">
                  {pickemDetails.guildRankings.map((guild) => {
                    const medals = ["🥇", "🥈", "🥉"];
                    const isPredicted = pickemDetails.userPredictions?.some((p) => p.guildName === guild.name);
                    return (
                      <div
                        key={`${guild.name}-${guild.realm}`}
                        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg ${
                          guild.rank <= pickemDetails.guildCount ? "bg-gray-700/60" : "bg-gray-700/30"
                        } ${isPredicted ? "ring-1 ring-blue-500/40" : ""}`}
                      >
                        <span className="w-7 text-center shrink-0">
                          {guild.rank <= 3 ? <span className="text-base">{medals[guild.rank - 1]}</span> : <span className="text-xs font-bold text-gray-400">{guild.rank}</span>}
                        </span>
                        <span className={`text-sm font-medium truncate ${guild.rank <= pickemDetails.guildCount ? "text-white" : "text-gray-400"}`}>{guild.name}</span>
                        {isPredicted && <span className="ml-auto text-xs text-blue-400 shrink-0">picked</span>}
                      </div>
                    );
                  })}
                </div>
                {pickemDetails.guildRankings.length > pickemDetails.guildCount && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <p className="text-xs text-gray-500">
                      Guilds ranked {pickemDetails.guildCount + 1}–{pickemDetails.guildRankings.length} still award partial points for nearby predictions.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Column 3 (or 2 for unfinalized RWF): Leaderboard */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 self-start">
              {/* Scoring Info */}
              <div className="bg-gray-750 rounded-lg overflow-hidden border border-gray-700 mb-3">
                <button
                  onClick={() => setShowScoringInfo(!showScoringInfo)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-gray-700 transition-colors"
                >
                  <span className="text-sm font-semibold text-gray-300">{t("scoringSystem")}</span>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${showScoringInfo ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showScoringInfo && (
                  <div className="px-4 pb-3 text-xs text-gray-400 space-y-1.5 border-t border-gray-700 pt-3">
                    {scoringConfig.exactMatch > 0 && (
                      <p>
                        • <strong className="text-green-400">{scoringConfig.exactMatch} pts:</strong> Exact match
                      </p>
                    )}
                    {scoringConfig.offByOne > 0 && (
                      <p>
                        • <strong className="text-yellow-400">{scoringConfig.offByOne} pts:</strong> ±1 position
                      </p>
                    )}
                    {scoringConfig.offByTwo > 0 && (
                      <p>
                        • <strong className="text-orange-400">{scoringConfig.offByTwo} pts:</strong> ±2 positions
                      </p>
                    )}
                    {scoringConfig.offByThree > 0 && (
                      <p>
                        • <strong className="text-orange-500">{scoringConfig.offByThree} pts:</strong> ±3 positions
                      </p>
                    )}
                    {scoringConfig.offByFour > 0 && (
                      <p>
                        • <strong className="text-red-400">{scoringConfig.offByFour} pts:</strong> ±4 positions
                      </p>
                    )}
                    <p>
                      • <strong className="text-gray-500">{scoringConfig.offByFiveOrMore} pts:</strong> 5+ off or not in top{" "}
                      {pickemDetails?.finalRankingsCount || pickemDetails?.guildCount || 10}
                    </p>
                    {pickemDetails?.type === "rwf" && (pickemDetails?.finalRankingsCount || 0) > pickemDetails.guildCount && (
                      <p className="mt-2 text-blue-400 text-xs">
                        You predict {pickemDetails.guildCount} guilds, but scoring uses the top {pickemDetails.finalRankingsCount} finalized rankings — nearby misses still earn
                        points.
                      </p>
                    )}
                    {isUnfinalizedRwf && <p className="mt-2 text-purple-400 font-medium">RWF scores are calculated when the race ends and admin finalizes the results.</p>}
                    {rankingsPending && <p className="mt-2 text-amber-300 font-medium">{t("scoresPending")}</p>}
                  </div>
                )}
              </div>
              <a href="/pickems-rules" className="block text-xs text-blue-400 hover:text-blue-300 transition-colors mb-3">
                {t("viewFullRules")} →
              </a>
              <h3 className="text-base font-semibold text-white mb-3">{t("leaderboard")}</h3>
              {pickemDetails.leaderboard.length === 0 ? (
                <p className="text-gray-400 text-sm">{t("noParticipants")}</p>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const ranksAndPrizes = computeLeaderboardRanksAndPrizes(pickemDetails.leaderboard, pickemDetails.prizeConfig, !!detailPrizeEnabled);
                    return pickemDetails.leaderboard.map((entry, index) => {
                      const { rank, prize } = ranksAndPrizes[index];

                      return (
                        <div
                          key={entry.username}
                          className={`rounded-lg ${
                            scoresPending
                              ? "bg-gray-700/30"
                              : rank === 1
                                ? "bg-yellow-900/30 border border-yellow-700/50"
                                : rank === 2
                                  ? "bg-gray-700/50 border border-gray-600/50"
                                  : rank === 3
                                    ? "bg-orange-900/30 border border-orange-700/50"
                                    : "bg-gray-700/30"
                          }`}
                        >
                          <details className="group">
                            <summary className="p-2.5 cursor-pointer list-none hover:bg-gray-700/20 rounded-lg transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-400 w-5 shrink-0">{scoresPending ? "—" : rank}</span>
                                <img src={entry.avatarUrl} alt={entry.username} className="w-6 h-6 rounded-full shrink-0" />
                                <span className="text-white font-medium truncate text-sm flex-1 min-w-0">{entry.username}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {detailPrizeEnabled && prize > 0 && !scoresPending && (
                                    <span className="text-amber-400 text-xs font-semibold bg-amber-900/30 px-1.5 py-0.5 rounded">🪙 {prize.toLocaleString()}g</span>
                                  )}
                                  <span className={`text-base font-bold ${scoresPending ? "text-gray-500" : "text-blue-400"}`}>
                                    {scoresPending ? "—" : entry.totalPoints}
                                  </span>
                                </div>
                              </div>
                            </summary>
                            <div className="px-2.5 pb-2.5 pt-1 grid grid-cols-1 gap-0.5 text-xs border-t border-gray-700/50 mt-1.5">
                              {entry.predictions.map((pred) => (
                                <div key={`${pred.guildName}-${pred.predictedRank}`} className="flex items-center gap-1 text-gray-300 py-0.5 min-w-0">
                                  <span className="text-gray-500 shrink-0">#{pred.predictedRank}:</span>
                                  <span className="truncate flex-1">{pred.guildName}</span>
                                  {!scoresPending && <PointsBadge points={pred.points} />}
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Prediction statistics are public after voting closes and available to admins earlier. */}
          {pickemDetails.predictionDetailsVisible && pickemDetails.leaderboard.length >= 2 && (
            <PickemStatistics leaderboard={pickemDetails.leaderboard} guildCount={pickemDetails.guildCount || 10} type={pickemDetails.type} />
          )}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg p-8 text-center border border-gray-700">
          <p className="text-gray-300 font-medium">{error || "Pickem unavailable"}</p>
          <button onClick={() => handlePickemSelect(null)} className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors">
            View all pickems
          </button>
        </div>
      )}
    </div>
  );
}
