"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { CcgAdminSnapshotPreview, CcgAdminSnapshotPreviewCounts, CcgAdminSnapshotSetPreview, CcgRegularTierGrade } from "@/types";

type PreviewCharacter = CcgAdminSnapshotSetPreview["characters"][number];
type AvailabilityCharacter = CcgAdminSnapshotPreview["availability"]["characters"][number];
type OutcomeFilter = "all" | "will_add" | "will_update" | "missing_media";
type RunAction = "snapshot" | "publication";

const grades: readonly CcgRegularTierGrade[] = ["S", "A", "B", "C", "D", "E", "F"];
const calculateButton =
  "min-h-10 rounded-md bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition-[background-color,scale] duration-150 ease-out hover:bg-cyan-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const runButton =
  "min-h-10 rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,scale] duration-150 ease-out hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const publishButton =
  "min-h-10 rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white transition-[background-color,scale] duration-150 ease-out hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "min-h-10 rounded-md bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition-[background-color,scale] duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const filterButton =
  "min-h-10 rounded-md px-3 py-2 text-left transition-[background-color,color,box-shadow,scale] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96]";

function isMissingMedia(character: PreviewCharacter): boolean {
  return character.disposition.startsWith("blocked_");
}

function matchesOutcome(character: PreviewCharacter, filter: OutcomeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "will_add") return character.disposition === "new_character";
  if (filter === "will_update") {
    return character.disposition === "rarity_change"
      || character.disposition === "identity_change"
      || character.disposition === "mythic_plus_score_added";
  }
  return isMissingMedia(character);
}

function getCharacterHref(character: Pick<PreviewCharacter, "name" | "realm" | "classID">): string {
  return `/characters/${encodeURIComponent(character.realm)}/${encodeURIComponent(character.name)}?class=${encodeURIComponent(String(character.classID))}`;
}

function openCharacterProfile(character: Pick<PreviewCharacter, "name" | "realm" | "classID">): void {
  window.open(getCharacterHref(character), "_blank", "noopener,noreferrer");
}

export default function CcgSnapshotPreview() {
  const t = useTranslations("admin.ccg.snapshotPreview");
  const locale = useLocale();
  const [preview, setPreview] = useState<CcgAdminSnapshotPreview | null>(null);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<RunAction | null>(null);
  const [activeRun, setActiveRun] = useState<RunAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const compactDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }),
    [locale],
  );
  const selectedSet = useMemo(
    () => preview?.sets.find((set) => set.setId === selectedSetId) ?? preview?.sets[0] ?? null,
    [preview, selectedSetId],
  );
  const outcomeCounts = useMemo(() => {
    const characters = selectedSet?.characters ?? [];
    return {
      all: characters.length,
      will_add: characters.filter((character) => character.disposition === "new_character").length,
      will_update: characters.filter((character) => (
        character.disposition === "rarity_change"
        || character.disposition === "identity_change"
        || character.disposition === "mythic_plus_score_added"
      )).length,
      missing_media: characters.filter(isMissingMedia).length,
    } satisfies Record<OutcomeFilter, number>;
  }, [selectedSet]);
  const visibleCharacters = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    const priority: Record<PreviewCharacter["disposition"], number> = {
      new_character: 0,
      rarity_change: 1,
      identity_change: 2,
      mythic_plus_score_added: 3,
      blocked_new_character: 4,
      blocked_rarity_change: 5,
      blocked_identity_change: 6,
      blocked_mythic_plus_score_added: 7,
    };
    return (selectedSet?.characters ?? [])
      .filter((character) => matchesOutcome(character, outcomeFilter))
      .filter((character) => !query || `${character.name} ${character.realm} ${character.region} ${character.guildName ?? ""} ${character.guildRealm ?? ""}`.toLocaleLowerCase(locale).includes(query))
      .sort((left, right) => priority[left.disposition] - priority[right.disposition]
        || left.name.localeCompare(right.name, locale)
        || left.realm.localeCompare(right.realm, locale));
  }, [locale, outcomeFilter, search, selectedSet]);

  const calculate = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const nextPreview = await api.getAdminCcgSnapshotPreview();
      setPreview(nextPreview);
      setSelectedSetId((current) => nextPreview.sets.some((set) => set.setId === current) ? current : nextPreview.sets[0]?.setId ?? "");
    } catch (calculationError) {
      setError(calculationError instanceof Error ? calculationError.message : t("error"));
    } finally {
      setLoading(false);
    }
  };

  const startSnapshotRun = async () => {
    setActiveRun("snapshot");
    setError(null);
    setNotice(null);
    try {
      await api.triggerAdminCcgSnapshots();
      setConfirmingAction(null);
      setNotice(t("runStarted"));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t("runError"));
    } finally {
      setActiveRun(null);
    }
  };

  const startPublicationRun = async () => {
    setActiveRun("publication");
    setError(null);
    setNotice(null);
    try {
      await api.triggerAdminCcgPublication();
      setConfirmingAction(null);
      setNotice(t("publishStarted"));
    } catch (publicationError) {
      setError(publicationError instanceof Error ? publicationError.message : t("publishError"));
    } finally {
      setActiveRun(null);
    }
  };

  const metrics = (counts: CcgAdminSnapshotPreviewCounts) => [
    { key: "eligible", value: counts.eligibleCharacters },
    { key: "newCharacters", value: counts.newCharacters },
    { key: "rarityChanges", value: counts.rarityChanges },
    { key: "identityChanges", value: counts.identityChanges },
    { key: "mythicPlusScoreAdds", value: counts.mythicPlusScoreAdds },
    { key: "blocked", value: counts.blockedByMissingMedia },
    { key: "unchanged", value: counts.unchangedCharacters },
  ] as const;
  const outcomeFilters: readonly OutcomeFilter[] = ["all", "will_add", "will_update", "missing_media"];

  return (
    <section className="space-y-5" aria-labelledby="ccg-snapshot-preview-title" aria-busy={loading || activeRun !== null}>
      <div className="flex flex-col gap-4 rounded-lg bg-gray-800/70 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="ccg-snapshot-preview-title" className="text-xl font-bold text-balance text-white">{t("title")}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-pretty text-gray-400">{t("description")}</p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-pretty text-cyan-200/70">{t("readOnly")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <button type="button" className={calculateButton} onClick={() => void calculate()} disabled={loading || activeRun !== null}>
            {loading ? t("calculating") : t(preview ? "recalculate" : "calculate")}
          </button>
          <button
            type="button"
            className={runButton}
            onClick={() => setConfirmingAction("snapshot")}
            disabled={loading || activeRun !== null || confirmingAction !== null}
          >
            {activeRun === "snapshot" ? t("runStarting") : t("run")}
          </button>
          <button
            type="button"
            className={publishButton}
            onClick={() => setConfirmingAction("publication")}
            disabled={loading || activeRun !== null || confirmingAction !== null}
          >
            {activeRun === "publication" ? t("publishStarting") : t("publish")}
          </button>
        </div>
      </div>

      {confirmingAction ? (
        <div className="rounded-lg bg-amber-950/40 p-4 text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)]">
          <h3 className="font-bold text-balance">{t(confirmingAction === "snapshot" ? "runConfirmTitle" : "publishConfirmTitle")}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-pretty text-amber-100/85">
            {t(confirmingAction === "snapshot" ? "runConfirmDescription" : "publishConfirmDescription")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={confirmingAction === "snapshot" ? runButton : publishButton}
              onClick={() => void (confirmingAction === "snapshot" ? startSnapshotRun() : startPublicationRun())}
              disabled={activeRun !== null}
            >
              {activeRun
                ? t(confirmingAction === "snapshot" ? "runStarting" : "publishStarting")
                : t(confirmingAction === "snapshot" ? "runConfirm" : "publishConfirm")}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setConfirmingAction(null)} disabled={activeRun !== null}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg bg-red-950/50 p-4 text-sm text-red-200 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.3)]" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg bg-emerald-950/45 p-4 text-sm text-emerald-200 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.28)]" role="status">
          {notice}
        </div>
      ) : null}

      {loading && !preview ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label={t("calculating")}>
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-lg bg-gray-800" />)}
        </div>
      ) : null}

      {preview ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-balance text-white">{t("totalsTitle")}</h3>
            <p className="text-xs tabular-nums text-gray-500">{t("calculatedAt", { date: dateFormatter.format(new Date(preview.calculatedAt)) })}</p>
          </div>

          <dl className={`grid grid-cols-2 gap-3 lg:grid-cols-5 ${loading ? "opacity-70" : "opacity-100"}`}>
            {metrics(preview.totals).map(({ key, value }) => (
              <div key={key} className="rounded-lg bg-gray-800/75 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
                <dt className="text-xs font-medium text-gray-400">{t(`metrics.${key}`)}</dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{value}</dd>
              </div>
            ))}
          </dl>

          {preview.totals.blockedByMissingMedia > 0 ? (
            <p className="rounded-lg bg-amber-950/35 p-4 text-sm leading-6 text-pretty text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.22)]">
              {t("mediaWarning", {
                blocked: preview.totals.blockedByMissingMedia,
                missing: preview.totals.missingMedia,
              })}
            </p>
          ) : null}

          {preview.sets.length === 0 ? (
            <div className="rounded-lg bg-gray-800/70 p-6 text-center text-sm text-gray-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              {t("empty")}
            </div>
          ) : (
            <>
              <section className="overflow-hidden rounded-lg bg-gray-900/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" aria-labelledby="ccg-raid-overview-title">
                <div className="px-4 py-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
                  <h3 id="ccg-raid-overview-title" className="font-bold text-balance text-white">{t("raidOverview.title")}</h3>
                  <p className="mt-0.5 text-xs text-pretty text-gray-500">{t("raidOverview.description")}</p>
                </div>
                <div className="max-h-[26rem] overflow-auto">
                  <table className="w-full min-w-[46rem] text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-gray-950/95 text-gray-500 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-semibold">{t("raidOverview.raid")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("metrics.eligible")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("metrics.newCharacters")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("metrics.rarityChanges")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("metrics.identityChanges")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("metrics.mythicPlusScoreAdds")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("metrics.blocked")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("metrics.unchanged")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {preview.sets.map((set) => {
                        const selected = selectedSet?.setId === set.setId;
                        return (
                          <tr key={set.setId} className={selected ? "bg-cyan-950/35" : "hover:bg-white/[0.025]"}>
                            <td className="p-1.5">
                              <button
                                type="button"
                                className="flex min-h-10 w-full items-center rounded-md px-2 text-left font-semibold text-white transition-[background-color,scale] duration-150 ease-out hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 active:scale-[0.96]"
                                onClick={() => {
                                  setSelectedSetId(set.setId);
                                  setOutcomeFilter("all");
                                  setSearch("");
                                }}
                                aria-pressed={selected}
                              >
                                <span className="truncate">{set.raidName}</span>
                                <span className={`ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${set.mode === "current" ? "bg-cyan-950 text-cyan-300" : "bg-gray-800 text-gray-400"}`}>
                                  {t(`modes.${set.mode}`)}
                                </span>
                              </button>
                            </td>
                            {[set.eligibleCharacters, set.newCharacters, set.rarityChanges, set.identityChanges, set.mythicPlusScoreAdds, set.blockedByMissingMedia, set.unchangedCharacters].map((value, index) => (
                              <td key={index} className="px-3 py-2 text-right font-medium tabular-nums text-gray-300">{value}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedSet ? (
                <section className="overflow-hidden rounded-xl bg-gray-900/70 p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" aria-labelledby="ccg-character-changes-title">
                  <div className="rounded-lg bg-gray-800/55 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 id="ccg-character-changes-title" className="font-bold text-balance text-white">
                          {t("characterList.title", { raid: selectedSet.raidName })}
                        </h3>
                        <p className="mt-1 text-xs text-pretty text-gray-500">{t("characterList.description")}</p>
                      </div>
                      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-400 sm:min-w-72">
                        {t("characterList.raidFilter")}
                        <select
                          className="min-h-10 rounded-md bg-gray-950 px-3 text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                          value={selectedSet.setId}
                          onChange={(event) => {
                            setSelectedSetId(event.target.value);
                            setOutcomeFilter("all");
                            setSearch("");
                          }}
                        >
                          {preview.sets.map((set) => <option key={set.setId} value={set.setId}>{set.raidName} · {t(`modes.${set.mode}`)}</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={t("characterList.outcomeFilter")}>
                      {outcomeFilters.map((filter) => {
                        const selected = outcomeFilter === filter;
                        return (
                          <button
                            key={filter}
                            type="button"
                            className={`${filterButton} ${selected ? "bg-cyan-950/80 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.28)]" : "bg-gray-950/55 text-gray-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] hover:bg-gray-900 hover:text-white"}`}
                            onClick={() => setOutcomeFilter(filter)}
                            aria-pressed={selected}
                          >
                            <span className="block text-xs font-semibold">{t(`filters.${filter}`)}</span>
                            <span className="mt-0.5 block text-lg font-bold tabular-nums">{outcomeCounts[filter]}</span>
                          </button>
                        );
                      })}
                    </div>

                    <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-400 sm:max-w-sm">
                      {t("characterList.searchLabel")}
                      <input
                        type="search"
                        className="min-h-10 rounded-md bg-gray-950 px-3 text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] placeholder:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("characterList.searchPlaceholder")}
                      />
                    </label>
                  </div>

                  <div className="mt-2 overflow-hidden rounded-lg bg-gray-950/45">
                    <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-gray-500 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
                      <span>{t("characterList.results")}</span>
                      <span className="font-semibold tabular-nums text-gray-300">{visibleCharacters.length} / {outcomeCounts[outcomeFilter]}</span>
                    </div>
                    {visibleCharacters.length > 0 ? (
                      <div className="max-h-[38rem] overflow-auto">
                        <table className="w-full min-w-[68rem] table-fixed text-left text-xs">
                          <thead className="sticky top-0 z-10 bg-gray-950/95 text-gray-500 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                            <tr>
                              <th scope="col" className="w-[20%] px-3 py-2 font-semibold">{t("characterList.character")}</th>
                              <th scope="col" className="w-[17%] px-3 py-2 font-semibold">{t("characterList.guild")}</th>
                              <th scope="col" className="w-[18%] px-3 py-2 font-semibold">{t("characterList.result")}</th>
                              <th scope="col" className="w-[9%] px-3 py-2 font-semibold">{t("characterList.rarity")}</th>
                              <th scope="col" className="w-[18%] px-3 py-2 font-semibold">{t("characterList.media")}</th>
                              <th scope="col" className="w-[18%] px-3 py-2 font-semibold">{t("characterList.error")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {visibleCharacters.map((character) => {
                              const blocked = isMissingMedia(character);
                              return (
                                <tr
                                  key={character.characterId}
                                  className="cursor-pointer text-gray-300 transition-colors hover:bg-white/[0.04]"
                                  onClick={() => openCharacterProfile(character)}
                                >
                                  <td className="truncate px-3 py-0" title={`${character.name}-${character.realm} (${character.region.toUpperCase()})`}>
                                    <Link
                                      href={getCharacterHref(character)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex min-h-10 max-w-full items-center overflow-hidden text-white underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <span className="shrink-0 font-semibold">{character.name}</span>
                                      <span className="truncate text-gray-500"> · {character.realm} · {character.region.toUpperCase()}</span>
                                    </Link>
                                  </td>
                                  <td className="truncate px-3 py-2" title={character.guildName ? `${character.guildName} · ${character.guildRealm ?? ""}` : undefined}>
                                    {character.guildName ? (
                                      <>
                                        <span className="font-medium text-gray-200">{character.guildName}</span>
                                        {character.guildRealm ? <span className="text-gray-500"> · {character.guildRealm}</span> : null}
                                      </>
                                    ) : <span className="text-gray-600">—</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex rounded-full px-2 py-1 font-semibold ${blocked ? "bg-amber-950/70 text-amber-200" : character.disposition === "new_character" ? "bg-emerald-950/70 text-emerald-200" : "bg-cyan-950/70 text-cyan-200"}`}>
                                      {t(`dispositions.${character.disposition}`)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-semibold tabular-nums text-white">
                                    {character.previousTierGrade ?? "—"} → {character.nextTierGrade}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`font-medium ${blocked ? "text-amber-200" : "text-emerald-200"}`}>{t(`mediaStatuses.${character.mediaStatus}`)}</span>
                                    {blocked ? <span className="text-gray-600"> · {t("characterList.attempts", { count: character.attemptCount })}</span> : null}
                                    {blocked && character.nextAttemptAt ? (
                                      <span className="block tabular-nums text-[10px] text-gray-600">
                                        {t("characterList.nextAttempt", { date: compactDateFormatter.format(new Date(character.nextAttemptAt)) })}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td
                                    className="px-3 py-2 font-mono text-[11px] text-gray-500"
                                    title={[character.lastErrorCode, character.lastError].filter(Boolean).join(": ") || undefined}
                                  >
                                    <span className="block truncate">{character.lastErrorCode ?? (blocked ? t("characterList.noError") : "—")}</span>
                                    {character.lastError ? <span className="block truncate font-sans text-[10px] text-gray-600">{character.lastError}</span> : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="px-4 py-10 text-center text-sm text-pretty text-gray-500">
                        {selectedSet.characters.length === 0 ? t("characterList.noChanges") : t("characterList.noMatches")}
                      </p>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-950/40 px-4 py-3" aria-label={t("gradeDistribution")}>
                    <span className="mr-1 text-xs font-medium text-gray-500">{t("gradeDistribution")}</span>
                    {grades.map((grade) => (
                      <span key={grade} className="rounded-full bg-gray-900 px-2 py-1 text-xs font-semibold tabular-nums text-gray-300">
                        {grade} {selectedSet.gradeDistribution[grade]}
                      </span>
                    ))}
                    <span className="ml-auto text-xs tabular-nums text-gray-500">{t("mediaCoverage", { ready: selectedSet.mediaReady, eligible: selectedSet.eligibleCharacters })}</span>
                  </div>
                </section>
              ) : null}

              <section className="overflow-hidden rounded-xl bg-gray-900/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" aria-labelledby="ccg-availability-preview-title">
                <div className="p-5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
                  <h3 id="ccg-availability-preview-title" className="font-bold text-balance text-white">{t("availabilityPreview.title")}</h3>
                  <p className="mt-1 max-w-4xl text-xs leading-5 text-pretty text-gray-500">{t("availabilityPreview.description")}</p>
                  <dl className="mt-4 grid max-w-xl grid-cols-2 gap-3">
                    <div className="rounded-lg bg-amber-950/35 p-3 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.18)]">
                      <dt className="text-xs font-medium text-amber-200/75">{t("availabilityPreview.archivedWithoutRender")}</dt>
                      <dd className="mt-1 text-xl font-bold tabular-nums text-amber-100">{preview.availability.archivedWithoutRender}</dd>
                    </div>
                    <div className="rounded-lg bg-emerald-950/35 p-3 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.18)]">
                      <dt className="text-xs font-medium text-emerald-200/75">{t("availabilityPreview.restoreWithStoredRender")}</dt>
                      <dd className="mt-1 text-xl font-bold tabular-nums text-emerald-100">{preview.availability.restoreWithStoredRender}</dd>
                    </div>
                  </dl>
                </div>
                {preview.availability.characters.length > 0 ? (
                  <div className="max-h-[32rem] overflow-auto">
                    <table className="w-full min-w-[64rem] table-fixed text-left text-xs">
                      <thead className="sticky top-0 z-10 bg-gray-950/95 text-gray-500 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                        <tr>
                          <th scope="col" className="w-[24%] px-4 py-2 font-semibold">{t("characterList.character")}</th>
                          <th scope="col" className="w-[20%] px-4 py-2 font-semibold">{t("characterList.guild")}</th>
                          <th scope="col" className="w-[23%] px-4 py-2 font-semibold">{t("availabilityPreview.result")}</th>
                          <th scope="col" className="w-[21%] px-4 py-2 font-semibold">{t("availabilityPreview.raidSets")}</th>
                          <th scope="col" className="w-[12%] px-4 py-2 font-semibold">{t("availabilityPreview.lastCheck")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {preview.availability.characters.map((character: AvailabilityCharacter) => (
                          <tr
                            key={character.characterId}
                            className="cursor-pointer text-gray-300 transition-colors hover:bg-white/[0.04]"
                            onClick={() => openCharacterProfile(character)}
                          >
                            <td className="truncate px-4 py-0" title={`${character.name}-${character.realm} (${character.region.toUpperCase()})`}>
                              <Link
                                href={getCharacterHref(character)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-10 max-w-full items-center overflow-hidden text-white underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <span className="shrink-0 font-semibold">{character.name}</span>
                                <span className="truncate text-gray-500"> · {character.realm} · {character.region.toUpperCase()}</span>
                              </Link>
                            </td>
                            <td className="truncate px-4 py-3" title={character.guildName ? `${character.guildName} · ${character.guildRealm ?? ""}` : undefined}>
                              {character.guildName ? (
                                <>
                                  <span className="font-medium text-gray-200">{character.guildName}</span>
                                  {character.guildRealm ? <span className="text-gray-500"> · {character.guildRealm}</span> : null}
                                </>
                              ) : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full px-2 py-1 font-semibold ${character.disposition === "archived_without_render" ? "bg-amber-950/70 text-amber-200" : "bg-emerald-950/70 text-emerald-200"}`}>
                                {t(`availabilityPreview.dispositions.${character.disposition}`)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-400">
                              {character.raidNames.join(" · ")}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-gray-500">
                              {character.lastNotFoundAt ? compactDateFormatter.format(new Date(character.lastNotFoundAt)) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-5 py-8 text-center text-sm text-pretty text-gray-500">{t("availabilityPreview.noCandidates")}</p>
                )}
              </section>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
