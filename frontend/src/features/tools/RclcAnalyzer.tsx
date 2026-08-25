"use client";

import Link from "next/link";
import { Fragment, useDeferredValue, useMemo, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  getDateGapInDays,
  parseRclcExport,
  RclcParseError,
  type RclcParseErrorCode,
  type RclcRecord,
} from "@/lib/rclc";

const PAGE_SIZE = 75;
const RAID_BREAK_DAYS = 28;

const CLASS_COLORS: Record<string, string> = {
  DEATHKNIGHT: "#c41e3a",
  DEMONHUNTER: "#a330c9",
  DRUID: "#ff7c0a",
  EVOKER: "#33937f",
  HUNTER: "#aad372",
  MAGE: "#3fc7eb",
  MONK: "#00ff98",
  PALADIN: "#f48cba",
  PRIEST: "#ffffff",
  ROGUE: "#fff468",
  SHAMAN: "#0070dd",
  WARLOCK: "#8788ee",
  WARRIOR: "#c69b6d",
};

type SortMode = "date-desc" | "date-asc" | "raid" | "player";
type ImportErrorCode = RclcParseErrorCode | "read-failed";

type CountEntry = {
  label: string;
  count: number;
};

function rankValues(records: RclcRecord[], getValue: (record: RclcRecord) => string, collator: Intl.Collator) {
  const counts = new Map<string, number>();

  records.forEach((record) => {
    const value = getValue(record);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return Array.from(counts, ([label, count]) => ({ label, count })).sort(
    (first, second) => second.count - first.count || collator.compare(first.label, second.label),
  );
}

function toggleSelection(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function MultiSelectFilter({
  label,
  allLabel,
  selectedCountLabel,
  searchPlaceholder,
  clearLabel,
  noOptionsLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  selectedCountLabel: string;
  searchPlaceholder: string;
  clearLabel: string;
  noOptionsLabel: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [optionSearch, setOptionSearch] = useState("");
  const normalizedSearch = optionSearch.trim().toLocaleLowerCase();
  const visibleOptions = normalizedSearch
    ? options.filter((option) => option.toLocaleLowerCase().includes(normalizedSearch))
    : options;
  const summary = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0] : selectedCountLabel;

  return (
    <div className="min-w-0 text-xs font-bold text-slate-400">
      <span>{label}</span>
      <details className="group relative mt-1.5">
        <summary aria-label={`${label}: ${summary}`} className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-900 px-3 text-sm font-medium text-white outline-none transition-colors hover:border-white/20 focus-visible:border-cyan-400/60 [&::-webkit-details-marker]:hidden">
          <span className="truncate">{summary}</span>
          <span className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-lg border border-white/10 bg-slate-950 p-2 shadow-2xl shadow-black/50">
          <input
            type="search"
            value={optionSearch}
            onChange={(event) => setOptionSearch(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="min-h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm font-medium text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
          />
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              aria-label={`${clearLabel}: ${label}`}
              className="mt-2 min-h-9 w-full cursor-pointer rounded-md px-3 text-left text-xs font-black text-cyan-300 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
            >
              {clearLabel}
            </button>
          ) : null}
          <div className="mt-1 max-h-64 overflow-y-auto overscroll-contain">
            {visibleOptions.length > 0 ? visibleOptions.map((option) => (
              <label key={option} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => onChange(toggleSelection(selected, option))}
                  className="size-4 shrink-0 accent-cyan-500"
                />
                <span className="min-w-0 truncate">{option}</span>
              </label>
            )) : (
              <p className="px-3 py-4 text-center text-xs text-slate-600">{noOptionsLabel}</p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

function DistributionList({
  title,
  entries,
  total,
  selected,
  emptyLabel,
  limit = 8,
  onSelect,
}: {
  title: string;
  entries: CountEntry[];
  total: number;
  selected: string[];
  emptyLabel: string;
  limit?: number;
  onSelect: (value: string) => void;
}) {
  const visibleEntries = entries.slice(0, limit);
  const maximum = visibleEntries[0]?.count ?? 1;

  return (
    <section className="rounded-xl border border-white/10 bg-slate-950/55 p-4 sm:p-5">
      <h2 className="text-lg font-black text-white">{title}</h2>

      {visibleEntries.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {visibleEntries.map((entry, index) => (
            <li key={entry.label}>
              <button
                type="button"
                onClick={() => onSelect(entry.label)}
                aria-pressed={selected.includes(entry.label)}
                className={`group relative flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
                  selected.includes(entry.label)
                    ? "bg-cyan-500/15 text-cyan-100 ring-cyan-300/35"
                    : "bg-white/[0.035] text-slate-200 ring-white/5 hover:bg-white/[0.07] hover:ring-white/15"
                }`}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-cyan-400/[0.07] transition-[width]"
                  style={{ width: `${(entry.count / maximum) * 100}%` }}
                  aria-hidden="true"
                />
                <span className="relative w-5 shrink-0 text-xs font-black text-slate-500">{index + 1}</span>
                <span className="relative min-w-0 flex-1 truncate text-sm font-bold">{entry.label}</span>
                <span className="relative shrink-0 text-sm font-black tabular-nums text-slate-300">{entry.count}</span>
                <span className="relative w-11 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {total > 0 ? `${Math.round((entry.count / total) * 100)}%` : "0%"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 rounded-lg bg-white/[0.03] px-3 py-6 text-center text-sm text-slate-500">{emptyLabel}</p>
      )}
    </section>
  );
}

export default function RclcAnalyzer() {
  const t = useTranslations("tools.rclc");
  const locale = useLocale();
  const collator = useMemo(() => new Intl.Collator(locale, { sensitivity: "base", numeric: true }), [locale]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    [locale],
  );

  const [records, setRecords] = useState<RclcRecord[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [skippedRows, setSkippedRows] = useState(0);
  const [importError, setImportError] = useState<ImportErrorCode | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [raidFilters, setRaidFilters] = useState<string[]>([]);
  const [difficultyFilters, setDifficultyFilters] = useState<string[]>([]);
  const [playerFilters, setPlayerFilters] = useState<string[]>([]);
  const [responseFilters, setResponseFilters] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [page, setPage] = useState(1);

  const resetFilters = () => {
    setSearch("");
    setRaidFilters([]);
    setDifficultyFilters([]);
    setPlayerFilters([]);
    setResponseFilters([]);
    setFromDate("");
    setToDate("");
    setSortMode("date-desc");
    setPage(1);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setImportError(null);

    try {
      const result = parseRclcExport(await file.text());
      setRecords(result.records);
      setFileName(file.name);
      setSkippedRows(result.skipped);
      resetFilters();
    } catch (error) {
      setImportError(error instanceof RclcParseError ? error.code : "read-failed");
    } finally {
      setIsParsing(false);
      input.value = "";
    }
  };

  const clearImport = () => {
    setRecords(null);
    setFileName("");
    setSkippedRows(0);
    setImportError(null);
    resetFilters();
  };

  const raidOptions = useMemo(
    () => Array.from(new Set((records ?? []).map((record) => record.instanceName).filter(Boolean))).sort(collator.compare),
    [collator, records],
  );
  const difficultyOptions = useMemo(
    () => Array.from(new Set((records ?? []).map((record) => record.difficulty).filter(Boolean))).sort(collator.compare),
    [collator, records],
  );
  const playerOptions = useMemo(
    () => Array.from(new Set((records ?? []).map((record) => record.player))).sort(collator.compare),
    [collator, records],
  );
  const responseOptions = useMemo(
    () => Array.from(new Set((records ?? []).map((record) => record.response).filter(Boolean))).sort(collator.compare),
    [collator, records],
  );
  const dateBounds = useMemo(() => {
    const dates = (records ?? []).map((record) => record.dateKey).sort();
    return { minimum: dates[0] ?? "", maximum: dates.at(-1) ?? "" };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLocaleLowerCase(locale);
    const selectedRaids = new Set(raidFilters);
    const selectedDifficulties = new Set(difficultyFilters);
    const selectedPlayers = new Set(playerFilters);
    const selectedResponses = new Set(responseFilters);

    return (records ?? []).filter((record) => {
      if (selectedRaids.size > 0 && !selectedRaids.has(record.instanceName)) return false;
      if (selectedDifficulties.size > 0 && !selectedDifficulties.has(record.difficulty)) return false;
      if (selectedPlayers.size > 0 && !selectedPlayers.has(record.player)) return false;
      if (selectedResponses.size > 0 && !selectedResponses.has(record.response)) return false;
      if (fromDate && record.dateKey < fromDate) return false;
      if (toDate && record.dateKey > toDate) return false;

      if (normalizedSearch) {
        const searchable = `${record.player}\n${record.itemName}\n${record.boss}\n${record.instanceName}\n${record.difficulty}\n${record.response}`.toLocaleLowerCase(locale);
        if (!searchable.includes(normalizedSearch)) return false;
      }

      return true;
    });
  }, [deferredSearch, difficultyFilters, fromDate, locale, playerFilters, raidFilters, records, responseFilters, toDate]);

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((first, second) => {
      if (sortMode === "date-desc") return second.timestamp - first.timestamp || second.sourceIndex - first.sourceIndex;
      if (sortMode === "date-asc") return first.timestamp - second.timestamp || first.sourceIndex - second.sourceIndex;
      if (sortMode === "raid") {
        return collator.compare(first.instanceName, second.instanceName)
          || collator.compare(first.difficulty, second.difficulty)
          || second.timestamp - first.timestamp
          || collator.compare(first.player, second.player);
      }
      return collator.compare(first.player, second.player) || second.timestamp - first.timestamp || collator.compare(first.itemName, second.itemName);
    });
  }, [collator, filteredRecords, sortMode]);

  const recipientRanking = useMemo(() => rankValues(filteredRecords, (record) => record.player, collator), [collator, filteredRecords]);
  const responseRanking = useMemo(() => rankValues(filteredRecords, (record) => record.response, collator), [collator, filteredRecords]);
  const uniqueRaidCount = useMemo(() => new Set(filteredRecords.map((record) => record.instanceName).filter(Boolean)).size, [filteredRecords]);
  const dateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filteredRecords.forEach((record) => counts.set(record.dateKey, (counts.get(record.dateKey) ?? 0) + 1));
    return counts;
  }, [filteredRecords]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRecords = sortedRecords.slice(pageStart, pageStart + PAGE_SIZE);
  const isDateGrouped = raidFilters.length === 0 && (sortMode === "date-desc" || sortMode === "date-asc");
  const hasActiveFilters = Boolean(search || raidFilters.length || difficultyFilters.length || playerFilters.length || responseFilters.length || fromDate || toDate || sortMode !== "date-desc");
  const topRecipient = recipientRanking[0] ?? null;

  const formatDate = (dateKey: string) => dateFormatter.format(new Date(`${dateKey}T00:00:00Z`));
  const selectPlayer = (player: string) => {
    setPlayerFilters((current) => toggleSelection(current, player));
    setPage(1);
  };
  const selectResponse = (response: string) => {
    setResponseFilters((current) => toggleSelection(current, response));
    setPage(1);
  };
  const selectRaid = (raid: string) => {
    setRaidFilters((current) => toggleSelection(current, raid));
    setPage(1);
  };
  const selectDifficulty = (difficulty: string) => {
    setDifficultyFilters((current) => toggleSelection(current, difficulty));
    setPage(1);
  };

  return (
    <main className="min-h-[70vh] bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.09),transparent_30%),linear-gradient(to_bottom,#080d18,#0f172a)] px-3 py-6 text-white sm:px-4 sm:py-9">
      <div className="mx-auto max-w-7xl">
        <Link href="/tools" className="inline-flex min-h-10 items-center text-sm font-bold text-cyan-200 transition-colors hover:text-white">
          <span className="mr-2" aria-hidden="true">←</span> {t("back")}
        </Link>

        <h1 className="mt-2 text-balance text-3xl font-black tracking-[-0.025em] sm:text-5xl">{t("title")}</h1>

        <section className="mt-6 rounded-xl border border-dashed border-cyan-300/25 bg-slate-950/50 p-4 sm:p-5" aria-labelledby="rclc-import-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="rclc-import-title" className="font-black text-white">{records ? t("importAnotherTitle") : t("importTitle")}</h2>
              <p className="mt-1 text-sm leading-5 text-slate-400">
                {records
                  ? t("importedSummary", { fileName, count: numberFormatter.format(records.length) })
                  : t("importDescription")}
              </p>
              {records && skippedRows > 0 ? (
                <p className="mt-1 text-xs text-amber-300/80">{t("skippedRows", { count: numberFormatter.format(skippedRows) })}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <label
                htmlFor="rclc-file-input"
                className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-cyan-600 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-cyan-500 ${isParsing ? "cursor-wait opacity-60" : "cursor-pointer"}`}
              >
                {isParsing ? t("parsing") : records ? t("replaceFile") : t("chooseFile")}
              </label>
              <input
                id="rclc-file-input"
                type="file"
                accept=".json,.txt,application/json,text/plain"
                disabled={isParsing}
                onChange={handleFileChange}
                className="sr-only"
              />
              {records ? (
                <button
                  type="button"
                  onClick={clearImport}
                  className="min-h-11 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {t("clearData")}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {importError ? (
          <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {t(`errors.${importError}`)}
          </p>
        ) : null}

        {records ? (
          <>
            <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("summaryTitle")}>
              <div className="rounded-xl border border-white/8 bg-white/[0.035] p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("awards")}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{numberFormatter.format(filteredRecords.length)}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.035] p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("characters")}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{numberFormatter.format(recipientRanking.length)}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.035] p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("raids")}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{numberFormatter.format(uniqueRaidCount)}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-cyan-300/15 bg-cyan-400/[0.055] p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-cyan-200/55">{t("topRecipient")}</p>
                {topRecipient ? (
                  <button type="button" onClick={() => selectPlayer(topRecipient.label)} className="mt-1 block max-w-full cursor-pointer truncate text-left text-lg font-black text-cyan-100 hover:text-white">
                    {topRecipient.label} <span className="text-sm text-cyan-300/65">· {numberFormatter.format(topRecipient.count)}</span>
                  </button>
                ) : (
                  <p className="mt-1 text-lg font-black text-slate-500">—</p>
                )}
              </div>
            </section>

            <section className="mt-6 rounded-xl border border-white/10 bg-slate-950/55 p-4 sm:p-5" aria-labelledby="rclc-filters-title">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 id="rclc-filters-title" className="text-lg font-black">{t("filtersTitle")}</h2>
                  <p className="mt-1 text-xs text-slate-500">{t("filtersDescription")}</p>
                </div>
                <button
                  type="button"
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  className="min-h-10 cursor-pointer rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-slate-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {t("clearFilters")}
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="text-xs font-bold text-slate-400">
                  {t("searchLabel")}
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                    placeholder={t("searchPlaceholder")}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm font-medium text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-400/60"
                  />
                </label>
                <MultiSelectFilter
                  label={t("raidLabel")}
                  allLabel={t("allRaids")}
                  selectedCountLabel={t("selectedCount", { count: raidFilters.length })}
                  searchPlaceholder={t("filterOptionsPlaceholder")}
                  clearLabel={t("clearSelection")}
                  noOptionsLabel={t("noFilterOptions")}
                  options={raidOptions}
                  selected={raidFilters}
                  onChange={(values) => { setRaidFilters(values); setPage(1); }}
                />
                <MultiSelectFilter
                  label={t("difficultyLabel")}
                  allLabel={t("allDifficulties")}
                  selectedCountLabel={t("selectedCount", { count: difficultyFilters.length })}
                  searchPlaceholder={t("filterOptionsPlaceholder")}
                  clearLabel={t("clearSelection")}
                  noOptionsLabel={t("noFilterOptions")}
                  options={difficultyOptions}
                  selected={difficultyFilters}
                  onChange={(values) => { setDifficultyFilters(values); setPage(1); }}
                />
                <MultiSelectFilter
                  label={t("playerLabel")}
                  allLabel={t("allPlayers")}
                  selectedCountLabel={t("selectedCount", { count: playerFilters.length })}
                  searchPlaceholder={t("filterOptionsPlaceholder")}
                  clearLabel={t("clearSelection")}
                  noOptionsLabel={t("noFilterOptions")}
                  options={playerOptions}
                  selected={playerFilters}
                  onChange={(values) => { setPlayerFilters(values); setPage(1); }}
                />
                <MultiSelectFilter
                  label={t("responseLabel")}
                  allLabel={t("allResponses")}
                  selectedCountLabel={t("selectedCount", { count: responseFilters.length })}
                  searchPlaceholder={t("filterOptionsPlaceholder")}
                  clearLabel={t("clearSelection")}
                  noOptionsLabel={t("noFilterOptions")}
                  options={responseOptions}
                  selected={responseFilters}
                  onChange={(values) => { setResponseFilters(values); setPage(1); }}
                />
                <label className="text-xs font-bold text-slate-400">
                  {t("fromDate")}
                  <input
                    type="date"
                    value={fromDate}
                    min={dateBounds.minimum}
                    max={toDate || dateBounds.maximum}
                    onChange={(event) => { setFromDate(event.target.value); setPage(1); }}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm font-medium text-white outline-none transition-colors focus:border-cyan-400/60"
                  />
                </label>
                <label className="text-xs font-bold text-slate-400">
                  {t("toDate")}
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate || dateBounds.minimum}
                    max={dateBounds.maximum}
                    onChange={(event) => { setToDate(event.target.value); setPage(1); }}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm font-medium text-white outline-none transition-colors focus:border-cyan-400/60"
                  />
                </label>
                <label className="text-xs font-bold text-slate-400 sm:col-span-2 xl:col-span-1">
                  {t("sortLabel")}
                  <select
                    value={sortMode}
                    onChange={(event) => { setSortMode(event.target.value as SortMode); setPage(1); }}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm font-medium text-white outline-none transition-colors focus:border-cyan-400/60"
                  >
                    <option value="date-desc">{t("sortDateNewest")}</option>
                    <option value="date-asc">{t("sortDateOldest")}</option>
                    <option value="raid">{t("sortRaid")}</option>
                    <option value="player">{t("sortPlayer")}</option>
                  </select>
                </label>
              </div>
            </section>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <DistributionList
                title={t("recipientRankingTitle")}
                entries={recipientRanking}
                total={filteredRecords.length}
                selected={playerFilters}
                emptyLabel={t("noMatchingData")}
                limit={20}
                onSelect={selectPlayer}
              />
              <DistributionList
                title={t("responseRankingTitle")}
                entries={responseRanking}
                total={filteredRecords.length}
                selected={responseFilters}
                emptyLabel={t("noMatchingData")}
                onSelect={selectResponse}
              />
            </div>

            <section className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-slate-950/55" aria-labelledby="rclc-table-title">
              <div className="flex flex-col gap-1 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6 sm:px-5">
                <div>
                  <h2 id="rclc-table-title" className="text-lg font-black">{t("lootTableTitle")}</h2>
                  {isDateGrouped ? <p className="mt-1 text-xs leading-5 text-slate-500">{t("dateGroupingDescription", { days: RAID_BREAK_DAYS })}</p> : null}
                </div>
                <p className="text-xs tabular-nums text-slate-400">
                  {sortedRecords.length > 0
                    ? t("showingRows", {
                        from: numberFormatter.format(pageStart + 1),
                        to: numberFormatter.format(Math.min(pageStart + PAGE_SIZE, sortedRecords.length)),
                        total: numberFormatter.format(sortedRecords.length),
                      })
                    : t("showingRows", { from: "0", to: "0", total: "0" })}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <caption className="sr-only">{t("lootTableCaption")}</caption>
                  <thead className="bg-slate-900/90 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="w-36 px-4 py-3 font-black">{t("columnDate")}</th>
                      <th scope="col" className="w-52 px-4 py-3 font-black">{t("columnPlayer")}</th>
                      <th scope="col" className="px-4 py-3 font-black">{t("columnItem")}</th>
                      <th scope="col" className="w-40 px-4 py-3 font-black">{t("columnResponse")}</th>
                      <th scope="col" className="w-[28rem] px-4 py-3 font-black">{t("columnRaid")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRecords.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-sm font-bold text-slate-500">{t("noMatchingData")}</td>
                      </tr>
                    ) : (
                      pageRecords.map((record, index) => {
                        const absoluteIndex = pageStart + index;
                        const previous = absoluteIndex > 0 ? sortedRecords[absoluteIndex - 1] : null;
                        const startsDateGroup = isDateGrouped && (index === 0 || previous?.dateKey !== record.dateKey);
                        const gapDays = previous && previous.dateKey !== record.dateKey ? getDateGapInDays(previous.dateKey, record.dateKey) : 0;

                        return (
                          <Fragment key={`${record.id}-${record.sourceIndex}`}>
                            {startsDateGroup && gapDays >= RAID_BREAK_DAYS ? (
                              <tr className="border-y border-amber-300/15 bg-amber-400/[0.045]">
                                <td colSpan={5} className="px-4 py-2 text-center text-xs font-black uppercase tracking-[0.13em] text-amber-200/70">
                                  {t("raidBreak", { days: gapDays })}
                                </td>
                              </tr>
                            ) : null}
                            {startsDateGroup ? (
                              <tr className="border-y border-cyan-300/10 bg-cyan-400/[0.045]">
                                <th scope="rowgroup" colSpan={5} className="px-4 py-2.5 text-sm font-black text-cyan-100">
                                  {formatDate(record.dateKey)}
                                  <span className="ml-2 text-xs font-medium text-cyan-300/55">{t("itemsOnDate", { count: dateCounts.get(record.dateKey) ?? 0 })}</span>
                                </th>
                              </tr>
                            ) : null}
                            <tr className="border-b border-white/[0.065] text-slate-300 transition-colors hover:bg-white/[0.035]">
                              <td className="px-4 py-3 align-top tabular-nums">
                                <span className="block font-bold text-slate-200">{formatDate(record.dateKey)}</span>
                                <span className="mt-0.5 block text-xs text-slate-500">{record.time || "—"}</span>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <button type="button" onClick={() => selectPlayer(record.player)} className="inline-flex max-w-full cursor-pointer items-center gap-2 font-bold text-slate-200 hover:text-cyan-200">
                                  <span className="size-2.5 shrink-0 rounded-full ring-1 ring-white/20" style={{ backgroundColor: CLASS_COLORS[record.className] ?? "#64748b" }} aria-hidden="true" />
                                  <span className="truncate">{record.player}</span>
                                </button>
                                {record.className ? <span className="mt-1 block text-[11px] font-bold text-slate-600">{record.className}</span> : null}
                              </td>
                              <td className="px-4 py-3 align-top">
                                <span className="font-bold text-white">{record.itemName}</span>
                                <span className="mt-1 block text-xs text-slate-500">
                                  {[record.equipLocation, record.itemType, record.itemId ? `#${record.itemId}` : ""].filter(Boolean).join(" · ")}
                                </span>
                                {record.note ? <span className="mt-1 block max-w-lg truncate text-xs italic text-slate-500">“{record.note}”</span> : null}
                              </td>
                              <td className="px-4 py-3 align-top">
                                {record.response ? (
                                  <button type="button" onClick={() => selectResponse(record.response)} className="cursor-pointer rounded-full bg-violet-400/10 px-2.5 py-1 text-xs font-black text-violet-200 ring-1 ring-violet-300/15 hover:bg-violet-400/20">
                                    {record.response}
                                  </button>
                                ) : <span className="text-slate-600">—</span>}
                              </td>
                              <td className="px-4 py-3 align-top">
                                {record.instanceName ? (
                                  <button type="button" onClick={() => selectRaid(record.instanceName)} className="cursor-pointer text-left font-bold text-slate-200 hover:text-cyan-200">
                                    {record.instanceName}
                                  </button>
                                ) : <span className="text-slate-600">—</span>}
                                {record.difficulty ? (
                                  <button type="button" onClick={() => selectDifficulty(record.difficulty)} className="mt-1.5 block cursor-pointer rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-black text-amber-200 ring-1 ring-amber-300/15 hover:bg-amber-400/20">
                                    {record.difficulty}
                                  </button>
                                ) : null}
                                {record.boss ? <span className="mt-1 block text-xs text-slate-500">{record.boss}</span> : null}
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 ? (
                <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 px-4 py-4 sm:flex-row sm:px-5">
                  <p className="text-xs tabular-nums text-slate-500">{t("pageCount", { page, total: totalPages })}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="min-h-10 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {t("previousPage")}
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      className="min-h-10 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {t("nextPage")}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
