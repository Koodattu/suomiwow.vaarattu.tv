"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  TwitchChannelBotSettings,
  TwitchChatAuditDirection,
  TwitchChatAuditKind,
  TwitchChatAuditResponse,
} from "@/types";

const AUDIT_KIND_OPTIONS: Array<{ value: TwitchChatAuditKind; label: string }> = [
  { value: "command", label: "Commands" },
  { value: "mention", label: "Mentions / replies" },
  { value: "command_reply", label: "Command replies" },
  { value: "progress_alert", label: "Progress alerts" },
  { value: "join_announcement", label: "Join announcements" },
  { value: "reward", label: "Reward messages" },
  { value: "system_reply", label: "System replies" },
];

const formatDate = (value?: string): string => (value ? new Date(value).toLocaleString() : "Never");
const formatKind = (kind: TwitchChatAuditKind): string => AUDIT_KIND_OPTIONS.find((option) => option.value === kind)?.label || kind;

export default function TwitchChatAuditPanel() {
  const [channels, setChannels] = useState<TwitchChannelBotSettings[]>([]);
  const [audit, setAudit] = useState<TwitchChatAuditResponse | null>(null);
  const [channelFilter, setChannelFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"" | TwitchChatAuditDirection>("");
  const [kindFilter, setKindFilter] = useState<"" | TwitchChatAuditKind>("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    const response = await api.getAdminTwitchChannelBotSettings();
    setChannels(response.channels);
  }, []);

  const loadAudit = useCallback(async () => {
    const response = await api.getAdminTwitchChatAudit({
      channel: channelFilter || undefined,
      direction: directionFilter || undefined,
      kind: kindFilter || undefined,
      page,
      limit: 50,
    });
    setAudit(response);
  }, [channelFilter, directionFilter, kindFilter, page]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([loadChannels(), loadAudit()])
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load Twitch chat controls"))
      .finally(() => setLoading(false));
  }, [loadAudit, loadChannels]);

  const changeFilter = (change: () => void) => {
    setPage(1);
    change();
  };

  const updateChannel = async (
    channel: TwitchChannelBotSettings,
    key: "alertsEnabled" | "commandsEnabled" | "joinAnnouncementEnabled",
    value: boolean,
  ) => {
    setSavingChannel(channel.channelName);
    setError(null);
    try {
      const updated = await api.updateAdminTwitchChannelBotSettings(channel.channelName, { [key]: value });
      setChannels((current) => current.map((item) => (item.channelName === updated.channelName ? updated : item)));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : `Failed to update #${channel.channelName}`);
    } finally {
      setSavingChannel(null);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadChannels(), loadAudit()]);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh Twitch chat controls");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gray-800 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Channel message controls</h3>
            <p className="mt-1 text-sm text-gray-400">
              Broadcasters can change progress alerts with !alerts &lt;on|off&gt;. Admins can control every message category here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="min-h-10 rounded bg-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-600 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && <div className="mt-4 rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</div>}

        <div className="mt-4 overflow-x-auto rounded border border-gray-700">
          <table className="min-w-full divide-y divide-gray-700 text-sm">
            <thead className="bg-gray-900/80 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Progress alerts</th>
                <th className="px-4 py-3">Command replies</th>
                <th className="px-4 py-3">Join message</th>
                <th className="px-4 py-3">Last join message</th>
                <th className="px-4 py-3">Changed by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900/40">
              {channels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">No tracked Twitch channels.</td>
                </tr>
              ) : (
                channels.map((channel) => {
                  const saving = savingChannel === channel.channelName;
                  return (
                    <tr key={channel.channelName}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-purple-300">#{channel.channelName}</td>
                      {(["alertsEnabled", "commandsEnabled", "joinAnnouncementEnabled"] as const).map((key) => (
                        <td key={key} className="px-4 py-3">
                          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-gray-300">
                            <input
                              type="checkbox"
                              checked={channel[key]}
                              disabled={saving}
                              onChange={(event) => void updateChannel(channel, key, event.target.checked)}
                              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500 disabled:opacity-50"
                            />
                            {channel[key] ? "On" : "Off"}
                          </label>
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-4 py-3 text-gray-400">{formatDate(channel.lastJoinAnnouncementAt)}</td>
                      <td className="px-4 py-3 text-gray-400">{channel.updatedBy || "Defaults"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg bg-gray-800 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Chat audit</h3>
            <p className="mt-1 text-sm text-gray-400">Bot messages, commands, mentions, send failures, users, and channels in one timeline.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs text-gray-400">
              Channel
              <select
                value={channelFilter}
                onChange={(event) => changeFilter(() => setChannelFilter(event.target.value))}
                className="mt-1 min-h-10 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              >
                <option value="">All channels</option>
                {channels.map((channel) => <option key={channel.channelName} value={channel.channelName}>#{channel.channelName}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-400">
              Direction
              <select
                value={directionFilter}
                onChange={(event) => changeFilter(() => setDirectionFilter(event.target.value as "" | TwitchChatAuditDirection))}
                className="mt-1 min-h-10 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              >
                <option value="">Both</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </label>
            <label className="text-xs text-gray-400">
              Type
              <select
                value={kindFilter}
                onChange={(event) => changeFilter(() => setKindFilter(event.target.value as "" | TwitchChatAuditKind))}
                className="mt-1 min-h-10 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              >
                <option value="">All types</option>
                {AUDIT_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded border border-gray-700">
          <table className="min-w-full divide-y divide-gray-700 text-sm">
            <thead className="bg-gray-900/80 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Direction / type</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900/40">
              {!audit || audit.events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">{loading ? "Loading audit..." : "No matching audit events."}</td>
                </tr>
              ) : (
                audit.events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-400">{formatDate(event.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-purple-300">#{event.channelName}</td>
                    <td className="px-4 py-3">
                      <span className={event.direction === "inbound" ? "text-blue-300" : "text-green-300"}>{event.direction}</span>
                      <span className="block text-xs text-gray-500">{formatKind(event.kind)}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{event.userDisplayName || event.userName || "Bot"}</td>
                    <td className="max-w-xl px-4 py-3 text-gray-200 break-words">
                      {event.message}
                      {event.error && <span className="mt-1 block text-xs text-red-300">{event.error}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-400">{event.commandOutcome || event.deliveryStatus}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {audit && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-gray-400">
            <span>{audit.pagination.total} events · page {audit.pagination.page} of {audit.pagination.totalPages}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
                className="min-h-9 rounded bg-gray-700 px-3 py-2 text-gray-100 hover:bg-gray-600 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(audit.pagination.totalPages, current + 1))}
                disabled={page >= audit.pagination.totalPages || loading}
                className="min-h-9 rounded bg-gray-700 px-3 py-2 text-gray-100 hover:bg-gray-600 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
