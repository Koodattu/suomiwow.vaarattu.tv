"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { CcgAdminSnapshotPreview, CcgAdminSnapshotPreviewCounts, CcgTierGrade } from "@/types";

const grades: readonly CcgTierGrade[] = ["S", "A", "B", "C", "D", "E", "F"];
const calculateButton =
  "min-h-10 rounded-md bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition-transform duration-150 ease-out hover:bg-cyan-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

export default function CcgSnapshotPreview() {
  const t = useTranslations("admin.ccg.snapshotPreview");
  const locale = useLocale();
  const [preview, setPreview] = useState<CcgAdminSnapshotPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const compactDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }),
    [locale],
  );
  const blockedCharacters = useMemo(
    () => preview?.sets.flatMap((set) => set.blockedCharacters.map((character) => ({
      ...character,
      setId: set.setId,
      raidName: set.raidName,
      mode: set.mode,
    }))) ?? [],
    [preview],
  );

  const calculate = async () => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.getAdminCcgSnapshotPreview());
    } catch (calculationError) {
      setError(calculationError instanceof Error ? calculationError.message : t("error"));
    } finally {
      setLoading(false);
    }
  };

  const metrics = (counts: CcgAdminSnapshotPreviewCounts) => [
    { key: "eligible", value: counts.eligibleCharacters },
    { key: "projected", value: counts.projectedSnapshots },
    { key: "newCharacters", value: counts.newCharacters },
    { key: "rarityChanges", value: counts.rarityChanges },
    { key: "unchanged", value: counts.unchangedCharacters },
    { key: "blocked", value: counts.blockedByMissingMedia },
  ] as const;

  return (
    <section className="space-y-5" aria-labelledby="ccg-snapshot-preview-title" aria-busy={loading}>
      <div className="flex flex-col gap-4 rounded-lg bg-gray-800/70 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="ccg-snapshot-preview-title" className="text-xl font-bold text-balance text-white">{t("title")}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-pretty text-gray-400">{t("description")}</p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-pretty text-cyan-200/70">{t("readOnly")}</p>
        </div>
        <button type="button" className={`${calculateButton} shrink-0`} onClick={() => void calculate()} disabled={loading}>
          {loading ? t("calculating") : t(preview ? "recalculate" : "calculate")}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-950/50 p-4 text-sm text-red-200 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.3)]" role="alert">
          {error}
        </div>
      ) : null}

      {loading && !preview ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label={t("calculating")}>
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-lg bg-gray-800" />)}
        </div>
      ) : null}

      {preview ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-balance text-white">{t("totalsTitle")}</h3>
            <p className="text-xs tabular-nums text-gray-500">{t("calculatedAt", { date: dateFormatter.format(new Date(preview.calculatedAt)) })}</p>
          </div>

          <dl className={`grid grid-cols-2 gap-3 lg:grid-cols-3 ${loading ? "opacity-70" : "opacity-100"}`}>
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

          {blockedCharacters.length > 0 ? (
            <section className="overflow-hidden rounded-lg bg-gray-900/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" aria-labelledby="ccg-blocked-characters-title">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
                <div>
                  <h3 id="ccg-blocked-characters-title" className="font-bold text-balance text-white">
                    {t("blockedList.title")} <span className="ml-1 tabular-nums text-amber-300">{blockedCharacters.length}</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-pretty text-gray-500">{t("blockedList.description")}</p>
                </div>
              </div>
              <div className="max-h-[34rem] overflow-auto">
                <table className="w-full min-w-[64rem] table-fixed text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-gray-950/95 text-gray-500 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                    <tr>
                      <th scope="col" className="w-[21%] px-3 py-2 font-semibold">{t("blockedList.character")}</th>
                      <th scope="col" className="w-[20%] px-3 py-2 font-semibold">{t("blockedList.raid")}</th>
                      <th scope="col" className="w-[13%] px-3 py-2 font-semibold">{t("blockedList.change")}</th>
                      <th scope="col" className="w-[9%] px-3 py-2 font-semibold">{t("blockedList.rarity")}</th>
                      <th scope="col" className="w-[17%] px-3 py-2 font-semibold">{t("blockedList.media")}</th>
                      <th scope="col" className="w-[20%] px-3 py-2 font-semibold">{t("blockedList.error")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {blockedCharacters.map((character) => (
                      <tr key={`${character.setId}:${character.characterId}`} className="text-gray-300">
                        <td className="truncate px-3 py-2" title={`${character.name}-${character.realm} (${character.region.toUpperCase()})`}>
                          <span className="font-semibold text-white">{character.name}</span>
                          <span className="text-gray-500"> · {character.realm} · {character.region.toUpperCase()}</span>
                        </td>
                        <td className="truncate px-3 py-2" title={character.raidName}>
                          {character.raidName}
                          <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${character.mode === "current" ? "bg-cyan-950 text-cyan-300" : "bg-gray-800 text-gray-400"}`}>
                            {t(`modes.${character.mode}`)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-400">{t(`outcomes.${character.outcome}`)}</td>
                        <td className="px-3 py-2 font-semibold tabular-nums text-white">
                          {character.previousTierGrade ?? "—"} → {character.nextTierGrade}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-amber-200">{t(`mediaStatuses.${character.mediaStatus}`)}</span>
                          <span className="text-gray-600"> · {t("blockedList.attempts", { count: character.attemptCount })}</span>
                          {character.nextAttemptAt ? (
                            <span className="block tabular-nums text-[10px] text-gray-600">
                              {t("blockedList.nextAttempt", { date: compactDateFormatter.format(new Date(character.nextAttemptAt)) })}
                            </span>
                          ) : null}
                        </td>
                        <td
                          className="px-3 py-2 font-mono text-[11px] text-gray-500"
                          title={[character.lastErrorCode, character.lastError].filter(Boolean).join(": ") || undefined}
                        >
                          <span className="block truncate">{character.lastErrorCode ?? t("blockedList.noError")}</span>
                          {character.lastError ? <span className="block truncate font-sans text-[10px] text-gray-600">{character.lastError}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {preview.sets.length === 0 ? (
            <div className="rounded-lg bg-gray-800/70 p-6 text-center text-sm text-gray-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              {t("empty")}
            </div>
          ) : (
            <div className="space-y-3">
              {preview.sets.map((set) => (
                <article key={set.setId} className="rounded-lg bg-gray-800/65 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="font-bold text-white">
                      {set.raidName}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${set.mode === "current" ? "bg-cyan-950 text-cyan-300" : "bg-gray-950 text-gray-400"}`}>
                        {t(`modes.${set.mode}`)}
                      </span>
                    </h4>
                    <span className="text-xs tabular-nums text-gray-500">{t("mediaCoverage", { ready: set.mediaReady, eligible: set.eligibleCharacters })}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                    {metrics(set).map(({ key, value }) => (
                      <div key={key}>
                        <dt className="text-xs text-gray-500">{t(`metrics.${key}`)}</dt>
                        <dd className="mt-0.5 font-semibold tabular-nums text-gray-100">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center gap-2" aria-label={t("gradeDistribution")}>
                    <span className="mr-1 text-xs font-medium text-gray-500">{t("gradeDistribution")}</span>
                    {grades.map((grade) => (
                      <span key={grade} className="rounded-full bg-gray-950/65 px-2 py-1 text-xs font-semibold tabular-nums text-gray-300">
                        {grade} {set.gradeDistribution[grade]}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
