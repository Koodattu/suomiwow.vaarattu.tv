"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAvoidableMechanicOptions } from "@/lib/queries";
import type { MechanicBackfillRequest, MechanicJobStatus } from "@/types/avoidable-damage";

export default function MechanicCollectionPanel() {
  const t = useTranslations("admin.mechanicCollection");
  const queryClient = useQueryClient();
  const [guildId, setGuildId] = useState("");
  const [raidId, setRaidId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [retryUnavailable, setRetryUnavailable] = useState(false);
  const options = useAvoidableMechanicOptions();
  const status = useQuery({
    queryKey: ["admin", "mechanic-collection", guildId],
    queryFn: ({ signal }) => api.getAdminMechanicCollection(guildId || undefined, signal),
    refetchInterval: 15_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "mechanic-collection"] });
  const run = useMutation({ mutationFn: (request: MechanicBackfillRequest) => api.queueAdminMechanicCollection(request),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["avoidable-damage", "leaderboard"] });
    } });
  const control = useMutation({
    mutationFn: ({ guild, id, status: jobStatus }: { guild: string; id: string; status: MechanicJobStatus }) => {
      if (jobStatus === "pending" || jobStatus === "in_progress") return api.pauseAdminProcessingQueueGuild(guild, id);
      if (jobStatus === "failed") return api.retryAdminProcessingQueueGuild(guild, id);
      return api.resumeAdminProcessingQueueGuild(guild, id);
    },
    onSuccess: refresh,
  });
  const mechanics = (options.data?.mechanics ?? []).filter((entry) => !raidId || entry.zoneId === Number(raidId));
  const raids = new Map(options.data?.raids.map((raid) => [raid.id, raid.name]) ?? []);
  const busy = run.isPending;
  const blocked = status.data && (status.data.processorPaused || status.data.buckets.client.isPaused || status.data.buckets.user.isPaused);
  const buttonClass = "rounded border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <details className="rounded-lg bg-gray-800">
      <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm text-white marker:text-gray-500 hover:bg-gray-700/40 focus-visible:outline-2 focus-visible:outline-cyan-500">
        <span className="font-medium">{t("title")}</span>{" "}
        {status.data ? <span className={`ml-3 text-xs ${status.data.counts.failed ? "text-red-300" : "text-gray-400"}`}>
          {t("compactStatus", { active: status.data.counts.pending + status.data.counts.in_progress, failed: status.data.counts.failed })}
        </span> : null}
      </summary>
      <div className="space-y-3 border-t border-gray-700 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-400">{t("description")}</p>
          <Link href="/analytics/mechanics" className="text-sm text-cyan-300 hover:underline">{t("viewLeaderboard")}</Link>
        </div>
        {options.isError || status.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-300">
            {t("loadError")}
            <button className={buttonClass} onClick={() => { void options.refetch(); void status.refetch(); }}>{t("refresh")}</button>
          </div>
        ) : null}
        {options.isPending ? <p className="text-sm text-gray-400">{t("loading")}</p> : options.data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-gray-300">
                {t("guild")}
                <select value={guildId} disabled={busy} onChange={(event) => { setGuildId(event.target.value); run.reset(); }} className="mt-1 w-full rounded border border-gray-600 bg-gray-900 p-2 text-white">
                  <option value="">{t("allGuilds")}</option>
                  {options.data.guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name} — {guild.realm}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-300">
                {t("raid")}
                <select value={raidId} disabled={busy} onChange={(event) => { setRaidId(event.target.value); setSelected([]); run.reset(); }} className="mt-1 w-full rounded border border-gray-600 bg-gray-900 p-2 text-white">
                  <option value="">{t("allRaids")}</option>
                  {options.data.raids.map((raid) => <option key={raid.id} value={raid.id}>{raid.name}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className={buttonClass} disabled={busy} onClick={() => setSelected(mechanics.map((entry) => entry.key))}>{t("selectVisible")}</button>
              <button className={buttonClass} disabled={busy || !selected.length} onClick={() => setSelected([])}>{t("clearSelection")}</button>
              <span className="text-sm text-gray-400">{t("selected", { count: selected.length })}</span>
            </div>
            <div className="max-h-64 overflow-auto rounded border border-gray-700">
              <table className="w-full min-w-[540px] text-sm">
                <thead className="sticky top-0 bg-gray-900 text-left text-gray-300">
                  <tr><th className="px-3 py-2">{t("mechanic")}</th><th className="px-3 py-2 text-right">{t("collected")}</th><th className="px-3 py-2 text-right">{t("pending")}</th><th className="px-3 py-2 text-right">{t("uncollected")}</th></tr>
                </thead>
                <tbody>
                  {mechanics.map((mechanic) => {
                    const coverage = status.data?.mechanics.find((entry) => entry.key === mechanic.key)?.coverage;
                    return (
                      <tr key={mechanic.key} className="border-t border-gray-700 hover:bg-gray-700/40">
                        <td className="px-3 py-2">
                          <label className="flex cursor-pointer items-start gap-3 text-gray-100">
                            <input type="checkbox" className="mt-1 accent-cyan-500" disabled={busy} checked={selected.includes(mechanic.key)} onChange={(event) => {
                              setSelected((keys) => event.target.checked ? [...keys, mechanic.key] : keys.filter((key) => key !== mechanic.key));
                            }} />
                            <span>{mechanic.boss} — {mechanic.name}<span className="block text-xs text-gray-400">{raids.get(mechanic.zoneId)}</span></span>
                          </label>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{coverage?.fetched ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-300">{coverage?.pending ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-300">{coverage ? coverage.failed + coverage.archived + coverage.unavailable : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input type="checkbox" className="mt-1 accent-cyan-500" checked={retryUnavailable} disabled={busy} onChange={(event) => setRetryUnavailable(event.target.checked)} />
              <span>{t("retryUnavailable")}</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button disabled={busy || !selected.length} onClick={() => run.mutate({ mechanicKeys: selected, guildId: guildId || undefined, retryUnavailable })}
                className="rounded bg-cyan-700 px-4 py-2 font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? t("queueing") : t("run", { count: selected.length })}
              </button>
              {run.isSuccess ? <p role="status" className="text-sm text-emerald-300">{run.data.queued ? t("queued", { count: run.data.queued, retried: run.data.retried }) : t("noEligibleGuilds")}</p> : null}
            </div>
            {run.isError || control.isError ? <p role="alert" className="text-sm text-red-300">{t("actionError")}</p> : null}
          </>
        ) : null}
        {status.data ? (
          <div className="space-y-2 border-t border-gray-700 pt-3 text-sm text-gray-300">
            {blocked ? <p className="text-amber-300">{t("waiting")}</p> : null}
            <p>{t("jobsSummary", { pending: status.data.counts.pending, running: status.data.counts.in_progress, paused: status.data.counts.paused, failed: status.data.counts.failed })}</p>
            <details>
              <summary className="cursor-pointer text-cyan-300">{t("recentJobs")}</summary>
              <ul className="mt-2 max-h-80 space-y-2 overflow-auto">
                {status.data.jobs.map((job) => (
                  <li key={job.id} className="rounded bg-gray-900/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{job.guildName} · {t(`status.${job.status}`)}</span>
                      {job.status !== "completed" ? <button disabled={control.isPending} className={buttonClass} onClick={() => control.mutate({ guild: job.guildId, id: job.id, status: job.status })}>
                        {job.status === "pending" || job.status === "in_progress" ? t("pause") : job.status === "failed" ? t("retryJob") : t("resume")}
                      </button> : null}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{job.mechanicKeys.map((key) => options.data?.mechanics.find((entry) => entry.key === key)).filter((entry) => !!entry).map((entry) => `${entry.boss} — ${entry.name}`).join(", ")}</p>
                    <p className="mt-1 text-xs tabular-nums text-gray-400">{t("progress", { reports: job.progress.reportsFetched, total: job.progress.totalReportsEstimate, pulls: job.progress.fightsSaved })}</p>
                    {job.lastError ? <p className="mt-1 text-xs text-red-300">{job.lastError}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer hover:text-gray-200">{t("collectionHelp")}</summary>
          <div className="mt-2 space-y-2">
            <p>{t("coverageHelp")}</p>
            <p>{t("retryHelp")}</p>
            <p>{t("budgetHelp")}</p>
            {status.data ? <p className="tabular-nums">{t("budgets", { client: status.data.buckets.client.percentUsed, user: status.data.buckets.user.percentUsed })}</p> : null}
          </div>
        </details>
      </div>
    </details>
  );
}
