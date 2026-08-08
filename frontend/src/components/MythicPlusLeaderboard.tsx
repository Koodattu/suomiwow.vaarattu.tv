"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import IconImage from "@/components/IconImage";
import { api } from "@/lib/api";
import { useMythicPlusLeaderboard } from "@/lib/queries";
import { formatRealmName, formatSpecName, getAllClasses, getClassInfoById, getGuildProfileUrl, getSpecIconUrl } from "@/lib/utils";
import type { ClassInfo, GlobalSearchResult, MythicPlusDungeonOption, MythicPlusLeaderboardRow, MythicPlusOptionsResponse, MythicPlusScoreBucket } from "@/types";

export type MythicPlusLeaderboardFilters = {
  season?: string | null;
  bucket: MythicPlusScoreBucket;
  dungeonId?: number | null;
  dungeonSort: "score" | "level";
  classId?: number | null;
  specName?: string | null;
  characterName?: string | null;
  characterRealm?: string | null;
  guildName?: string | null;
  guildRealm?: string | null;
  page: number;
  limit: number;
};

interface MythicPlusLeaderboardProps {
  filters: MythicPlusLeaderboardFilters;
  onFiltersChange: (patch: Partial<MythicPlusLeaderboardFilters>) => void;
  options?: MythicPlusOptionsResponse;
  optionsLoading: boolean;
  optionsError: Error | null;
}

const BUCKET_OPTIONS: Array<{ value: MythicPlusScoreBucket; label: string }> = [
  { value: "all", label: "Overall" },
  { value: "dps", label: "DPS" },
  { value: "healer", label: "Healer" },
  { value: "tank", label: "Tank" },
];

function buildQuery(filters: MythicPlusLeaderboardFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function formatScore(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatRunTime(ms?: number | null) {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type DungeonRunSummary = MythicPlusLeaderboardRow["dungeonRuns"][number];

function CharacterCell({ row }: { row: MythicPlusLeaderboardRow }) {
  const classInfo = getClassInfoById(row.character.classID);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} width={24} height={24} className="h-6 w-6 shrink-0 rounded" />
      <div className="min-w-0">
        <Link href={`/characters/${encodeURIComponent(row.character.realm)}/${encodeURIComponent(row.character.name)}?class=${row.character.classID}`} className="truncate font-semibold text-gray-100 hover:text-blue-300">
          {row.character.name}
        </Link>
        <div className="truncate text-xs text-gray-500">{formatRealmName(row.character.realm)}</div>
      </div>
    </div>
  );
}

function DungeonHeader({ dungeon }: { dungeon: MythicPlusDungeonOption }) {
  return (
    <div className="mx-auto flex min-w-[80px] flex-col items-center gap-1" title={`${dungeon.name} highest key`} aria-label={`${dungeon.name} highest key`}>
      <IconImage iconFilename={dungeon.iconUrl ?? undefined} alt="" width={24} height={24} className="h-6 w-6 rounded object-cover ring-1 ring-white/10" />
      <span className="max-w-[86px] truncate text-[11px] font-semibold leading-tight text-gray-300">{dungeon.shortName || dungeon.name}</span>
    </div>
  );
}

function DungeonCell({ run, dungeon }: { run: DungeonRunSummary | null; dungeon: MythicPlusDungeonOption }) {
  if (!run) return <span className="text-gray-700">-</span>;

  return (
    <span className="inline-flex min-w-[80px] flex-col items-center justify-center gap-0.5 tabular-nums" title={`${dungeon.name}: +${run.mythicLevel}, ${formatScore(run.score)} score`}>
      <span className="font-bold text-gray-100">+{run.mythicLevel}</span>
      <span className="text-[11px] font-semibold leading-none text-cyan-300">{formatScore(run.score)}</span>
    </span>
  );
}

function MythicPlusSearch({
  selectedCharacter,
  selectedGuild,
  onSelect,
  onClear,
}: {
  selectedCharacter: Pick<GlobalSearchResult, "name" | "realm" | "type"> | null;
  selectedGuild: Pick<GlobalSearchResult, "name" | "realm" | "type"> | null;
  onSelect: (result: GlobalSearchResult) => void;
  onClear: (type: GlobalSearchResult["type"]) => void;
}) {
  const t = useTranslations("characterRankingsPage");
  const tNavigation = useTranslations("navigation");
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const trimmedQuery = query.trim();
  const showResults = isFocused && trimmedQuery.length > 0;

  useEffect(() => {
    if (!isFocused || trimmedQuery.length < 2) return;

    let isActiveRequest = true;
    const controller = new AbortController();

    const timeoutId = window.setTimeout(() => {
      api
        .searchSite(trimmedQuery, 8, controller.signal, true)
        .then((data) => {
          if (!isActiveRequest) return;
          setResults(data.results);
          setActiveResultIndex(-1);
        })
        .catch(() => {
          if (!isActiveRequest) return;
          setResults([]);
          setHasError(true);
        })
        .finally(() => {
          if (!isActiveRequest) return;
          setIsLoading(false);
        });
    }, 180);

    return () => {
      isActiveRequest = false;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [isFocused, trimmedQuery]);

  const selectResult = (result: GlobalSearchResult) => {
    onSelect(result);
    setQuery("");
    setResults([]);
    setActiveResultIndex(-1);
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }

    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setActiveResultIndex((current) => (current + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActiveResultIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
      return;
    }

    if (event.key !== "Enter" || results.length === 0) return;
    event.preventDefault();
    selectResult(results[activeResultIndex] ?? results[0]);
  };

  return (
    <div className="relative min-w-[240px] flex-[2_1_360px]">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onFocus={() => {
          setIsFocused(true);
          if (trimmedQuery.length >= 2) {
            setIsLoading(true);
            setHasError(false);
          }
        }}
        onBlur={() => setIsFocused(false)}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          setActiveResultIndex(-1);
          if (value.trim().length < 2) {
            setResults([]);
            setIsLoading(false);
            setHasError(false);
          } else {
            setIsLoading(true);
            setHasError(false);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={t("mythicPlusSearchPlaceholder")}
        role="combobox"
        aria-autocomplete="list"
        aria-controls="mythic-plus-search-results"
        aria-expanded={showResults}
        aria-activedescendant={activeResultIndex >= 0 ? `mythic-plus-search-result-${activeResultIndex}` : undefined}
        autoComplete="off"
        className="min-h-10 w-full rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-white shadow-md outline-none ring-1 ring-white/5 transition-shadow placeholder:text-gray-400 focus:ring-2 focus:ring-emerald-500/70"
      />

      {(selectedCharacter || selectedGuild) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {[selectedCharacter, selectedGuild].filter((result): result is NonNullable<typeof result> => result !== null).map((result) => (
            <button
              key={`${result.type}:${result.realm}:${result.name}`}
              type="button"
              onClick={() => onClear(result.type)}
              title={result.type === "character" ? t("clearCharacterFilter") : t("clearGuildFilter")}
              className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold shadow-sm shadow-black/25 ring-1 transition-[background-color,color,transform] active:scale-[0.96] ${
                result.type === "character"
                  ? "bg-blue-500/15 text-blue-100 ring-blue-400/25 hover:bg-blue-500/25"
                  : "bg-orange-500/15 text-orange-100 ring-orange-400/25 hover:bg-orange-500/25"
              }`}
            >
              <span className="max-w-[240px] truncate">{result.name} - {formatRealmName(result.realm)}</span>
              <span aria-hidden="true" className="text-base leading-none">×</span>
            </button>
          ))}
        </div>
      )}

      {showResults && (
        <div className="absolute inset-x-0 top-11 z-40 overflow-hidden rounded-md bg-gray-950/95 p-1 shadow-2xl shadow-black/50 ring-1 ring-white/10">
          <div id="mythic-plus-search-results" role={results.length > 0 ? "listbox" : undefined} className="max-h-80 overflow-y-auto">
            {trimmedQuery.length < 2 ? (
              <div className="px-3 py-2.5 text-sm text-gray-500">{tNavigation("searchMinCharacters")}</div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-400">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" aria-hidden="true" />
                {tNavigation("searching")}
              </div>
            ) : hasError ? (
              <div className="px-3 py-2.5 text-sm text-red-300">{tNavigation("searchError")}</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2.5 text-sm text-gray-500">{tNavigation("noSearchResults")}</div>
            ) : (
              results.map((result, index) => (
                <button
                  key={`${result.type}:${result.realm}:${result.name}`}
                  id={`mythic-plus-search-result-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeResultIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveResultIndex(index)}
                  onClick={() => selectResult(result)}
                  className={`flex min-h-10 w-full items-center justify-between gap-3 rounded px-3 py-2.5 text-left text-sm transition-[background-color,color,transform] hover:bg-white/10 active:scale-[0.96] ${
                    activeResultIndex === index ? "bg-white/10" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {result.type === "character" && result.classID ? (
                      <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded shadow-sm shadow-black/30 ring-1 ring-white/10">
                        <IconImage iconFilename={getClassInfoById(result.classID).iconUrl} alt="" fill style={{ objectFit: "cover" }} />
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-gray-100">{result.name} - {formatRealmName(result.realm)}</span>
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${result.type === "guild" ? "bg-orange-500/20 text-orange-200" : "bg-blue-500/20 text-blue-200"}`}>
                    {result.type === "guild" ? tNavigation("guildType") : tNavigation("characterType")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClassSpecFilters({
  selectedClassId,
  selectedSpecName,
  onClassChange,
  onSpecChange,
}: {
  selectedClassId?: number | null;
  selectedSpecName?: string | null;
  onClassChange: (classId: number | null) => void;
  onSpecChange: (specName: string | null) => void;
}) {
  const t = useTranslations("characterRankingsPage");
  const classes = getAllClasses();
  const selectedClass = selectedClassId ? classes.find((classInfo) => classInfo.id === selectedClassId) : null;

  return (
    <>
      <select
        value={selectedClassId ?? ""}
        onChange={(event) => {
          const value = event.target.value ? Number(event.target.value) : null;
          onClassChange(value);
          onSpecChange(null);
        }}
        className="min-h-10 min-w-[150px] rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">{t("allClasses")}</option>
        {classes.map((classInfo: ClassInfo) => (
          <option key={classInfo.id} value={classInfo.id}>
            {classInfo.name}
          </option>
        ))}
      </select>

      <select
        value={selectedSpecName ?? ""}
        disabled={!selectedClass}
        onChange={(event) => onSpecChange(event.target.value || null)}
        className="min-h-10 min-w-[150px] rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">{selectedClass ? t("allSpecs") : t("selectClassFirst")}</option>
        {selectedClass?.specs.map((spec) => (
          <option key={spec.name} value={spec.name}>
            {formatSpecName(spec.name)}
          </option>
        ))}
      </select>
    </>
  );
}

export default function MythicPlusLeaderboard({ filters, onFiltersChange: updateFilters, options, optionsLoading, optionsError }: MythicPlusLeaderboardProps) {
  const t = useTranslations("characterRankingsPage");
  const selectedSeason = options?.seasons.find((season) => season.slug === filters.season) ?? options?.seasons[0] ?? null;
  const selectedDungeon = selectedSeason?.dungeons.find((dungeon) => dungeon.id === filters.dungeonId) ?? null;
  const queryString = useMemo(() => buildQuery(filters), [filters]);
  const leaderboardEnabled = !!filters.season;
  const { data, isLoading: leaderboardLoading, isFetching: leaderboardFetching, error: leaderboardError } = useMythicPlusLeaderboard(queryString, leaderboardEnabled);
  const rows = data?.data ?? [];
  const pagination = data?.pagination;
  const loading = optionsLoading || leaderboardLoading;
  const error = optionsError?.message ?? leaderboardError?.message ?? null;
  const dungeonColumns = selectedSeason?.dungeons ?? [];
  const tableColumnCount = selectedDungeon ? 7 : 5 + dungeonColumns.length;
  const tableMinWidth = selectedDungeon ? 980 : Math.max(1100, 780 + dungeonColumns.length * 96);

  const page = pagination?.currentPage ?? filters.page;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-md border border-red-500/40 bg-red-950/30 px-4 py-3 text-red-200">{error}</div> : null}

      <div className="flex flex-wrap gap-3">
        <MythicPlusSearch
          selectedCharacter={filters.characterName && filters.characterRealm ? { type: "character", name: filters.characterName, realm: filters.characterRealm } : null}
          selectedGuild={filters.guildName && filters.guildRealm ? { type: "guild", name: filters.guildName, realm: filters.guildRealm } : null}
          onSelect={(result) => {
            if (result.type === "character") {
              updateFilters({ characterName: result.name, characterRealm: result.realm });
            } else {
              updateFilters({ guildName: result.name, guildRealm: result.realm });
            }
          }}
          onClear={(type) => {
            if (type === "character") {
              updateFilters({ characterName: null, characterRealm: null });
            } else {
              updateFilters({ guildName: null, guildRealm: null });
            }
          }}
        />
        <select
          value={filters.bucket}
          onChange={(event) => updateFilters({ bucket: event.target.value as MythicPlusScoreBucket })}
          className="min-h-10 min-w-[130px] rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {BUCKET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={filters.dungeonId ?? ""}
          onChange={(event) => updateFilters({ dungeonId: event.target.value ? Number(event.target.value) : null })}
          className="min-h-10 min-w-[190px] rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Overall score</option>
          {selectedSeason?.dungeons.map((dungeon) => (
            <option key={dungeon.id} value={dungeon.id}>
              {dungeon.shortName || dungeon.name}
            </option>
          ))}
        </select>
        {selectedDungeon ? (
          <select
            value={filters.dungeonSort}
            onChange={(event) => updateFilters({ dungeonSort: event.target.value as "score" | "level" })}
            className="min-h-10 min-w-[130px] rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="score">By score</option>
            <option value="level">By key</option>
          </select>
        ) : null}
        <ClassSpecFilters
          selectedClassId={filters.classId}
          selectedSpecName={filters.specName}
          onClassChange={(classId) => updateFilters({ classId, specName: null })}
          onSpecChange={(specName) => updateFilters({ specName })}
        />
        {leaderboardFetching && !leaderboardLoading ? (
          <div className="flex min-h-10 items-center gap-2 px-2 text-sm font-medium text-gray-400" aria-live="polite">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" aria-hidden="true" />
            {t("updating")}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto border border-gray-700">
        <table className="w-full border-collapse text-xs md:text-sm" style={{ minWidth: tableMinWidth }}>
          <thead>
            <tr className="border-b border-gray-700 bg-gray-900 text-center font-semibold text-gray-200">
              <th className="w-16 border-r border-gray-700 px-3 py-3">Rank</th>
              <th className="border-r border-gray-700 px-3 py-3 text-left">Character</th>
              <th className="border-r border-gray-700 px-3 py-3">Guild</th>
              <th className="border-r border-gray-700 px-3 py-3">Score</th>
              <th className="border-r border-gray-700 px-3 py-3">Best spec</th>
              {selectedDungeon ? (
                <>
                  <th className="border-r border-gray-700 px-3 py-3">Highest key</th>
                  <th className="border-r border-gray-700 px-3 py-3">Time</th>
                </>
              ) : (
                dungeonColumns.map((dungeon) => (
                  <th key={dungeon.id} className="border-r border-gray-700 px-2 py-3">
                    <DungeonHeader dungeon={dungeon} />
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className={`border-b border-gray-800 ${rowIndex % 2 === 0 ? "bg-gray-950" : "bg-gray-900"}`}>
                  <td colSpan={tableColumnCount} className="px-3 py-3">
                    <div className="h-5 w-full animate-pulse rounded bg-gray-800" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={tableColumnCount} className="px-4 py-8 text-center font-semibold text-gray-400">
                  No Mythic+ data has been fetched for this view.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const run = row.run ?? null;
                const dungeonRunById = new Map(row.dungeonRuns.map((dungeonRun) => [dungeonRun.dungeonId, dungeonRun]));
                return (
                  <tr key={`${row.character.id}-${row.season}-${row.rank}`} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800 ${rowIndex % 2 === 0 ? "bg-gray-950" : "bg-gray-900"}`}>
                    <td className="border-r border-gray-700 px-3 py-3 text-center font-bold tabular-nums text-gray-100">{row.rank}</td>
                    <td className="border-r border-gray-700 px-3 py-3">
                      <CharacterCell row={row} />
                    </td>
                    <td className="border-r border-gray-700 px-3 py-3 text-center">
                      {row.character.guild?.name && row.character.guild.realm ? (
                        <Link href={getGuildProfileUrl(row.character.guild.realm, row.character.guild.name)} className="font-semibold text-gray-200 hover:text-blue-300">
                          {row.character.guild.name}
                        </Link>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="border-r border-gray-700 px-3 py-3 text-center font-bold tabular-nums text-cyan-300">{formatScore(row.score.value)}</td>
                    <td className="border-r border-gray-700 px-3 py-3 text-center">
                      {row.bestSpec?.name ? (
                        <span className="inline-flex items-center justify-center gap-1.5">
                          <IconImage iconFilename={row.bestSpec.slug ? getSpecIconUrl(row.character.classID, row.bestSpec.slug) : undefined} alt={row.bestSpec.name} width={18} height={18} className="h-[18px] w-[18px] rounded" />
                          <span>{row.bestSpec.name}</span>
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    {selectedDungeon ? (
                      <>
                        <td className="border-r border-gray-700 px-3 py-3 text-center font-bold tabular-nums text-gray-100">{run ? `+${run.mythicLevel}` : "-"}</td>
                        <td className="border-r border-gray-700 px-3 py-3 text-center font-semibold tabular-nums text-gray-300">{formatRunTime(run?.clearTimeMs)}</td>
                      </>
                    ) : (
                      dungeonColumns.map((dungeon) => (
                        <td key={dungeon.id} className="border-r border-gray-700 px-2 py-2 text-center">
                          <DungeonCell run={dungeonRunById.get(dungeon.id) ?? null} dungeon={dungeon} />
                        </td>
                      ))
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <div className="flex flex-col items-center justify-between gap-3 px-2 py-2 text-sm text-gray-400 sm:flex-row">
          <div>
            Page {page} of {totalPages} ({pagination.totalItems} total)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => updateFilters({ page: page - 1 })}
              disabled={page <= 1}
              className="rounded-md bg-gray-800 px-3 py-2 font-semibold text-gray-200 transition-colors hover:enabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => updateFilters({ page: page + 1 })}
              disabled={page >= totalPages}
              className="rounded-md bg-gray-800 px-3 py-2 font-semibold text-gray-200 transition-colors hover:enabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
