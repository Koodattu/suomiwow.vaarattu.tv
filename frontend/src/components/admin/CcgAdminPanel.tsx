"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import CcgCardStudio from "@/components/admin/CcgCardStudio";
import CcgAlternativeArtManager from "@/components/admin/CcgAlternativeArtManager";
import CcgCommunityManager from "@/components/admin/CcgCommunityManager";
import CcgRedeemCodeManager from "@/components/admin/CcgRedeemCodeManager";
import { api } from "@/lib/api";
import type { CcgAdminSetReadiness, CcgAdminSetStatus, CcgAdminStatusResponse } from "@/types";

const secondaryButton =
  "min-h-10 rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition-transform duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "min-h-10 rounded-md bg-amber-600 px-3 py-2 text-sm font-bold text-white transition-transform duration-150 ease-out hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
function readinessMinimum(readiness: CcgAdminSetReadiness, blocker: CcgAdminSetReadiness["blockers"][number]): number {
  if (blocker === "eligible_population") return readiness.thresholds.eligible;
  if (blocker === "media_ready") return readiness.thresholds.mediaReady;
  if (blocker === "media_coverage") return Math.round(readiness.thresholds.mediaCoverage * 100);
  return 0;
}

export default function CcgAdminPanel() {
  const t = useTranslations("admin.ccg");
  const locale = useLocale();
  const [status, setStatus] = useState<CcgAdminStatusResponse | null>(null);
  const [readiness, setReadiness] = useState<Record<number, CcgAdminSetReadiness>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingZone, setCheckingZone] = useState<number | null>(null);
  const [enablingZone, setEnablingZone] = useState<number | null>(null);
  const [confirmingZone, setConfirmingZone] = useState<number | null>(null);
  const [forcingZone, setForcingZone] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<"studio" | "alternativeArt" | "redeemCodes" | "community" | "sets">("studio");
  const handleError = useCallback((message: string) => {
    setError(message);
    setNotice(null);
  }, []);
  const handleNotice = useCallback((message: string) => {
    setNotice(message);
    setError(null);
  }, []);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.getAdminCcgStatus());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("retry"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const checkReadiness = async (set: CcgAdminSetStatus) => {
    setCheckingZone(set.zoneId);
    setError(null);
    setNotice(null);
    try {
      const result = await api.previewAdminCcgSet(set.zoneId);
      setReadiness((current) => ({ ...current, [set.zoneId]: result }));
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : t("retry"));
    } finally {
      setCheckingZone(null);
    }
  };

  const enableSet = async (set: CcgAdminSetStatus, force: boolean) => {
    setEnablingZone(set.zoneId);
    setError(null);
    setNotice(null);
    try {
      const result = await api.enableAdminCcgSet(set.zoneId, force);
      const messages = [t("enableSuccess", { raid: set.raidName, count: result.publication.totalCards })];
      if (result.movedToLegacy > 0) messages.push(t("movedToLegacy", { count: result.movedToLegacy }));
      setNotice(messages.join(" "));
      setReadiness((current) => ({ ...current, [set.zoneId]: result.readiness }));
      setConfirmingZone(null);
      setForcingZone(null);
      setStatus(await api.getAdminCcgStatus());
    } catch (enableError) {
      setError(enableError instanceof Error ? enableError.message : t("retry"));
    } finally {
      setEnablingZone(null);
    }
  };

  if (loading && !status) {
    return (
      <div className="space-y-4" aria-label={t("loading")}>
        <div className="h-24 animate-pulse rounded-lg bg-gray-800" />
        <div className="h-52 animate-pulse rounded-lg bg-gray-800" />
        <div className="h-52 animate-pulse rounded-lg bg-gray-800" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-lg bg-red-950/50 p-5 text-red-200 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.3)]" role="alert">
        <p>{error}</p>
        <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void loadStatus()}>{t("retry")}</button>
      </div>
    );
  }

  const enabledCount = status.sets.filter((set) => set.availability === "enabled").length;
  const candidateCount = status.sets.length - enabledCount;

  return (
    <section className="space-y-6" aria-labelledby="ccg-admin-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="ccg-admin-title" className="text-2xl font-bold text-white text-balance">{t("title")}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>
        </div>
        <button type="button" className={secondaryButton} onClick={() => void loadStatus()} disabled={loading}>
          {t("refresh")}
        </button>
      </div>

      {error ? <div className="rounded-lg bg-red-950/50 p-4 text-sm text-red-200 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.3)]" role="alert">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-950/45 p-4 text-sm text-emerald-200 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.28)]" role="status">{notice}</div> : null}

      <nav className="flex flex-wrap gap-2 border-b border-white/8 pb-3" aria-label={t("sections.label")}>
        {(["studio", "alternativeArt", "redeemCodes", "community", "sets"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSection(value)}
            className={`min-h-10 rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${section === value ? "bg-cyan-950/80 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,.28)]" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}
            aria-current={section === value ? "page" : undefined}
          >
            {t(`sections.${value}`)}
            {value === "community" ? <span className="ml-2 tabular-nums text-gray-500">{status.community.characters.filter((character) => character.active).length}</span> : null}
          </button>
        ))}
      </nav>

      {section === "studio" ? <CcgCardStudio /> : null}
      {section === "alternativeArt" ? (
        <CcgAlternativeArtManager
          onError={handleError}
          onNotice={handleNotice}
        />
      ) : null}
      {section === "redeemCodes" ? <CcgRedeemCodeManager onError={handleError} onNotice={handleNotice} /> : null}
      {section === "community" ? (
        <CcgCommunityManager
          characters={status.community.characters}
          onChanged={async () => setStatus(await api.getAdminCcgStatus())}
          onError={handleError}
          onNotice={handleNotice}
        />
      ) : null}

      {section === "sets" ? <>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [t("enabledSets"), enabledCount],
            [t("candidateSets"), candidateCount],
            [t("publishedCards"), status.totals.cards],
            [t("packOpenings"), status.totals.openings],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-gray-800/75 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
              <dt className="text-xs font-medium text-gray-400">{label}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="space-y-3">
        {status.sets.length === 0 ? (
          <div className="rounded-lg bg-gray-800/70 p-6 text-center text-sm text-gray-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">{t("noCandidates")}</div>
        ) : status.sets.map((set) => {
          const row = readiness[set.zoneId];
          const isChecking = checkingZone === set.zoneId;
          const isEnabling = enablingZone === set.zoneId;
          const isEnabled = set.availability === "enabled";
          return (
            <article key={set.zoneId} className="overflow-hidden rounded-lg bg-gray-800/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                <div
                  className="h-16 w-full shrink-0 rounded-md bg-cover bg-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] lg:w-28"
                  style={{ backgroundImage: `linear-gradient(rgba(3,7,18,.18),rgba(3,7,18,.55)),url("${set.backgroundPath}")` }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-white">{set.raidName}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isEnabled ? "bg-emerald-950 text-emerald-300" : "bg-gray-700 text-white"}`}>
                      {t(isEnabled ? "enabled" : "candidate")}
                    </span>
                    <span className="rounded-full bg-gray-950/70 px-2 py-0.5 text-xs text-gray-300">
                      {t(set.targetMode === "current" ? "targetCurrent" : "targetLegacy")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">{set.expansionName} · {t("cards", { count: set.cardCount })} · {t("wave", { count: set.publicationWave })}</p>
                  {set.enabledAt ? <p className="mt-1 text-xs text-emerald-300">{t("enabledAt", { date: dateFormatter.format(new Date(set.enabledAt)) })}</p> : null}
                </div>
                {!isEnabled ? (
                  <button type="button" className={secondaryButton} onClick={() => void checkReadiness(set)} disabled={isChecking || isEnabling}>
                    {isChecking ? t("checking") : t("checkReadiness")}
                  </button>
                ) : null}
              </div>

              {row && !isEnabled ? (
                <div className="bg-gray-950/45 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <strong className={row.readyToEnable ? "text-emerald-300" : "text-amber-300"}>{t(row.readyToEnable ? "ready" : "notReady")}</strong>
                    <span className="text-xs text-gray-500">{dateFormatter.format(new Date(row.checkedAt))}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-gray-500">{t("eligible")}</dt><dd className="mt-0.5 font-semibold tabular-nums text-white">{row.eligible}</dd></div>
                    <div><dt className="text-gray-500">{t("mediaReady")}</dt><dd className="mt-0.5 font-semibold tabular-nums text-white">{row.mediaReady}</dd></div>
                    <div><dt className="text-gray-500">{t("mediaCoverage")}</dt><dd className="mt-0.5 font-semibold tabular-nums text-white">{Math.round(row.mediaCoverage * 100)}%</dd></div>
                    <div><dt className="text-gray-500">{t("published")}</dt><dd className="mt-0.5 font-semibold tabular-nums text-white">{row.published}</dd></div>
                  </dl>
                  {row.blockers.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm text-amber-200">
                      {row.blockers.map((blocker) => <li key={blocker}>• {t(`blockers.${blocker}`, { minimum: readinessMinimum(row, blocker) })}</li>)}
                    </ul>
                  ) : null}
                  {confirmingZone !== set.zoneId ? (
                    <button
                      type="button"
                      className={`${primaryButton} mt-4`}
                      onClick={() => {
                        setConfirmingZone(set.zoneId);
                        setForcingZone(row.readyToEnable ? null : set.zoneId);
                      }}
                    >
                      {t(row.readyToEnable ? "enable" : "forceEnable")}
                    </button>
                  ) : null}
                  {confirmingZone === set.zoneId ? (
                    <div className="mt-4 rounded-lg bg-amber-950/40 p-4 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)]" role="alert">
                      <p className="text-sm leading-6 text-amber-100">
                        {t(forcingZone === set.zoneId ? "forceEnableWarning" : "enableWarning", { raid: set.raidName })}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className={primaryButton} onClick={() => void enableSet(set, forcingZone === set.zoneId)} disabled={isEnabling}>
                          {isEnabling ? t("enabling") : t(forcingZone === set.zoneId ? "confirmForceEnable" : "confirmEnable")}
                        </button>
                        <button
                          type="button"
                          className={secondaryButton}
                          onClick={() => {
                            setConfirmingZone(null);
                            setForcingZone(null);
                          }}
                          disabled={isEnabling}
                        >
                          {t("cancel")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <details className="rounded-lg bg-gray-800/55 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
        <summary className="min-h-10 cursor-pointer font-semibold text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400">
          {t("excludedTitle")} <span className="ml-1 tabular-nums text-gray-500">({status.excludedRaids.length})</span>
        </summary>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{t("excludedBody")}</p>
        {status.excludedRaids.length > 0 ? (
          <ul className="mt-3 divide-y divide-white/5">
            {status.excludedRaids.map((raid) => (
              <li key={raid.zoneId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-gray-200">{raid.raidName} <span className="font-normal text-gray-500">· {raid.expansionName}</span></span>
                <span className="rounded-full bg-gray-950/70 px-2 py-0.5 text-xs text-gray-400">{t("excluded")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-gray-500">{t("excludedEmpty")}</p>}
      </details>
      </> : null}
    </section>
  );
}
