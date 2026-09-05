"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, getAdminReportOverrides, updateAdminReportOverride } from "@/lib/api";
import type { AdminGuild, AdminReport, AdminReportOverride, AdminReportOverrideAction } from "@/types";

export default function ReportOverridesPanel({ guildId, reports, onChanged }: {
  guildId: string;
  reports: AdminReport[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("admin.reportOverrides");
  const [rules, setRules] = useState<AdminReportOverride[]>([]);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"assign" | "exclude">("assign");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<AdminGuild[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAdminReportOverrides(guildId).then((data) => {
      if (!cancelled) setRules(data);
    }).catch(() => { if (!cancelled) setError(t("loadFailed")); });
    return () => { cancelled = true; };
  }, [guildId, reports, t]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.getAdminGuilds(1, 20, search.trim() || undefined).then((data) => {
        if (!cancelled) setCandidates(data.guilds.filter((guild) => guild.id !== guildId));
      }).catch(() => { if (!cancelled) setError(t("searchFailed")); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [guildId, search, t]);

  async function change(nextAction: AdminReportOverrideAction, reportCode: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await updateAdminReportOverride(guildId, {
        action: nextAction,
        reportCode,
        ...(nextAction === "assign" ? { targetGuildId: target } : {}),
        reason,
      });
      setMessage(result.warnings.length ? t("refreshWarning") : t(`success.${nextAction}`));
      setCode("");
      setReason("");
      setRules(await getAdminReportOverrides(guildId));
      await onChanged();
    } catch (failure) {
      const errorCode = (failure as { code?: string }).code;
      setError(errorCode && t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : t("changeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
      <h4 className="mb-2 font-medium text-white">{t("title")}</h4>
      <p className="mb-3 text-sm text-gray-300">{t("description")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void change(action, code); }} className="space-y-2">
        <label className="block text-sm text-gray-300">
          {t("report")}
          <input value={code} onChange={(event) => setCode(event.target.value)} required disabled={busy}
            list="report-override-codes" placeholder={t("report")} className="mt-1 block w-full rounded border border-gray-600 bg-gray-700 p-2 text-white" />
        </label>
        <datalist id="report-override-codes">
          {reports.map((report) => <option key={report.code} value={report.code}>{new Date(report.startTime).toLocaleDateString()}</option>)}
        </datalist>
        <label className="block text-sm text-gray-300">
          {t("action")}
          <select value={action} onChange={(event) => setAction(event.target.value as "assign" | "exclude")} disabled={busy}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-700 p-2 text-white">
            <option value="assign">{t("move")}</option>
            <option value="exclude">{t("exclude")}</option>
          </select>
        </label>
        {action === "assign" && <>
          <label className="block text-sm text-gray-300">
            {t("search")}
            <input value={search} onChange={(event) => { setSearch(event.target.value); setTarget(""); }} disabled={busy}
              className="mt-1 block w-full rounded border border-gray-600 bg-gray-700 p-2 text-white" />
          </label>
          <label className="block text-sm text-gray-300">
            {t("destination")}
            <select value={target} onChange={(event) => setTarget(event.target.value)} required disabled={busy}
              className="mt-1 block w-full rounded border border-gray-600 bg-gray-700 p-2 text-white">
              <option value="">{t("chooseGuild")}</option>
              {candidates.map((guild) => <option key={guild.id} value={guild.id}>{guild.name} · {guild.realm} · {guild.region}</option>)}
            </select>
          </label>
        </>}
        <label className="block text-sm text-gray-300">
          {t("reason")}
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={busy}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-700 p-2 text-white" />
        </label>
        <button type="submit" disabled={busy || !code.trim() || (action === "assign" && !target)}
          className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50">
          {busy ? t("saving") : t(action === "assign" ? "move" : "exclude")}
        </button>
      </form>
      {message && <p role="status" className="mt-2 text-sm text-amber-300">{message}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      <h5 className="mt-4 text-sm font-medium text-white">{t("rules")}</h5>
      <p className="mt-1 text-xs text-gray-400">{t("restoreHelp")}</p>
      {rules.length === 0 && <p className="mt-2 text-sm text-gray-400">{t("noRules")}</p>}
      <ul className="mt-2 space-y-2">
        {rules.map((rule) => {
          const exclusion = rule.exclusions.find((entry) => entry.guildId === guildId);
          return <li key={rule._id} className="rounded border border-gray-700 p-2 text-sm text-gray-300">
            <a href={`https://www.warcraftlogs.com/reports/${rule.code}`} target="_blank" rel="noopener noreferrer" className="text-amber-400">{rule.code}</a>
            {rule.assignment?.guildId && <div>
              {t("assignedTo", { guild: rule.assignment.guildId.name })}
              {rule.assignment.reason && <span> · {rule.assignment.reason}</span>}
              {rule.assignment.guildId._id === guildId && <button disabled={busy} onClick={() => void change("clear_assignment", rule.code)} className="ml-2 underline disabled:opacity-50">{t("release")}</button>}
            </div>}
            {exclusion && <div>
              {t("excluded")}{exclusion.reason && <span> · {exclusion.reason}</span>}
              <button disabled={busy} onClick={() => void change("restore", rule.code)} className="ml-2 underline disabled:opacity-50">{t("restore")}</button>
            </div>}
          </li>;
        })}
      </ul>
    </section>
  );
}
