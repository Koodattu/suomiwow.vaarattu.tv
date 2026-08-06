"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { CcgAdminMediaStatus } from "@/types";

const secondaryButton =
  "min-h-10 rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition-transform duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "min-h-10 rounded-md bg-cyan-700 px-3 py-2 text-sm font-bold text-white shadow-[inset_0_0_0_1px_rgba(103,232,249,0.18)] transition-transform duration-150 ease-out hover:bg-cyan-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

type MediaAction = "discover" | "refresh" | "audit" | "recover" | "retry";

type Props = {
  initialStatus: CcgAdminMediaStatus;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export default function CcgMediaOperations({ initialStatus, onError, onNotice }: Props) {
  const t = useTranslations("admin.ccg.mediaOperations");
  const locale = useLocale();
  const [status, setStatus] = useState(initialStatus);
  const [activeAction, setActiveAction] = useState<MediaAction | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Helsinki" }),
    [locale],
  );
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const loadStatus = useCallback(async (reportError = false) => {
    try {
      setStatus(await api.getAdminCcgMediaStatus());
      setLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("statusLoadError");
      setLoadError(message);
      if (reportError) onError(message);
    }
  }, [onError, t]);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 10_000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  const runAction = async (action: MediaAction) => {
    if (action === "retry" && !window.confirm(t("retryConfirm"))) return;
    if (action === "audit" && !window.confirm(t("auditConfirm"))) return;
    setActiveAction(action);
    try {
      if (action === "discover") {
        const result = await api.discoverAdminCcgMedia();
        onNotice(t("discoverSuccess", { scanned: result.scanned, candidates: result.candidates, queued: result.queued }));
      } else if (action === "refresh") {
        const result = await api.refreshAdminCcgMedia();
        onNotice(t("refreshSuccess", result));
      } else if (action === "audit") {
        const result = await api.auditAdminCcgPreviouslySuccessfulMedia();
        onNotice(t("auditSuccess", result));
      } else if (action === "recover") {
        const result = await api.recoverAdminCcgMedia();
        onNotice(t("recoverSuccess", result));
      } else {
        const result = await api.retryAdminCcgMedia();
        onNotice(t("retrySuccess", result));
      }
      await loadStatus(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("actionError"));
    } finally {
      setActiveAction(null);
    }
  };

  const queue = (key: string) => status.queue[key] ?? 0;
  const queuedNow = queue("pending") + queue("processing") + queue("retry");
  const issues = queue("retry") + queue("failed") + queue("not_found");
  const discoveryBusy = status.discoveryRunning || status.lastDiscovery?.status === "running";
  const anyActionBusy = activeAction !== null;

  const summary = [
    [t("lastScanned"), status.lastDiscovery?.scanned],
    [t("lastQueued"), status.lastDiscovery?.queued],
    [t("queuedNow"), queuedNow],
    [t("rendersReady"), status.assets.active],
    [t("expiringSoon"), status.assets.expiringWithinSevenDays],
    [t("verificationPending"), status.cardSeries.verificationPending],
    [t("archivedCards"), status.cardSeries.archived],
    [t("issues"), issues],
  ] as const;
  const queueStates = ["pending", "processing", "retry", "completed", "not_found", "failed"] as const;

  return (
    <section className="space-y-5" aria-labelledby="ccg-media-title">
      <div className="rounded-xl bg-gray-900/70 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_18px_45px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 id="ccg-media-title" className="text-xl font-bold text-white text-balance">{t("title")}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>
            <p className="mt-1 text-xs text-gray-500">{t("schedule")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.processorRunning ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>
              {t(status.processorRunning ? "workerOnline" : "workerOffline")}
            </span>
            {discoveryBusy ? <span className="rounded-full bg-cyan-950 px-2.5 py-1 text-xs font-semibold text-cyan-200">{t("discoveryRunning")}</span> : null}
          </div>
        </div>

        {loadError ? <p className="mt-3 text-sm text-amber-300" role="status">{t("staleStatus")}</p> : null}

        <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          {summary.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-gray-950/55 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <dt className="text-xs font-medium text-gray-500">{label}</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-white">{value == null ? "—" : numberFormatter.format(value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-xl bg-gray-800/65 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <h4 className="font-bold text-white text-balance">{t("actionsTitle")}</h4>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(["discover", "refresh", "audit", "recover", "retry"] as const).map((action) => (
              <div key={action} className="rounded-lg bg-gray-950/45 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                <p className="min-h-12 text-sm leading-5 text-gray-400 text-pretty">{t(`${action}Description`)}</p>
                <button
                  type="button"
                  className={`${action === "discover" ? primaryButton : secondaryButton} mt-3 w-full`}
                  onClick={() => void runAction(action)}
                  disabled={anyActionBusy || (action === "discover" && discoveryBusy)}
                >
                  {activeAction === action ? t(`${action}Running`) : t(action)}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-gray-800/65 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-bold text-white text-balance">{t("queueTitle")}</h4>
            <button type="button" className={secondaryButton} onClick={() => void loadStatus(true)} disabled={anyActionBusy}>{t("refreshStatus")}</button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {queueStates.map((state) => (
              <div key={state} className="rounded-lg bg-gray-950/45 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                <dt className="text-xs font-medium text-gray-500">{t(`queue.${state}`)}</dt>
                <dd className="mt-1 text-lg font-bold tabular-nums text-white">{numberFormatter.format(queue(state))}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 text-sm text-gray-400">
            <p className="font-semibold text-gray-200">{t("lastDiscoveryTitle")}</p>
            {status.lastDiscovery ? (
              <p className="mt-1 leading-6">
                {t(`runStatus.${status.lastDiscovery.status}`)} · {dateFormatter.format(new Date(status.lastDiscovery.startedAt))}
                {status.lastDiscovery.durationMs != null ? ` · ${t("duration", { seconds: Math.round(status.lastDiscovery.durationMs / 1000) })}` : ""}
              </p>
            ) : <p className="mt-1">{t("noDiscovery")}</p>}
            {status.lastDiscovery?.error ? <p className="mt-2 text-red-300">{status.lastDiscovery.error}</p> : null}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-gray-800/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
        <div className="p-5">
          <h4 className="font-bold text-white text-balance">{t("recentIssuesTitle")}</h4>
          <p className="mt-1 text-sm text-gray-500 text-pretty">{t("recentIssuesDescription")}</p>
        </div>
        {status.recentFailures.length === 0 ? <p className="px-5 pb-5 text-sm text-gray-400">{t("noRecentIssues")}</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-950/45 text-xs text-gray-500">
                <tr><th className="px-5 py-3 font-semibold">{t("character")}</th><th className="px-5 py-3 font-semibold">{t("status")}</th><th className="px-5 py-3 font-semibold">{t("error")}</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {status.recentFailures.map((failure) => (
                  <tr key={failure.characterId}>
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-gray-200">{failure.name}<span className="font-normal text-gray-500">-{failure.realm}</span></td>
                    <td className="whitespace-nowrap px-5 py-3 text-gray-300">{t(`queue.${failure.status}`)}</td>
                    <td className="max-w-xl px-5 py-3 text-gray-400">{failure.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
