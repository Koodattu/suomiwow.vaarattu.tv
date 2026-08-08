"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { CcgAdminUserSort, CcgAdminUsersResponse } from "@/types";

const paginationButton =
  "min-h-10 rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition-[background-color,scale] duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

export default function CcgAdminUsers() {
  const t = useTranslations("admin.ccg.users");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<CcgAdminUserSort>("packOpenings");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<CcgAdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  useEffect(() => {
    let cancelled = false;
    void api.getAdminCcgUsers({ page, limit, sort, direction })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [direction, limit, page, sort, t]);

  const beginLoad = () => {
    setLoading(true);
    setError(null);
  };

  const changeSort = (field: CcgAdminUserSort) => {
    beginLoad();
    setPage(1);
    if (sort === field) {
      setDirection((current) => current === "desc" ? "asc" : "desc");
      return;
    }
    setSort(field);
    setDirection("desc");
  };

  const sortIndicator = (field: CcgAdminUserSort) => sort === field ? (direction === "desc" ? "↓" : "↑") : "↕";
  const ariaSort = (field: CcgAdminUserSort): "ascending" | "descending" | "none" => sort === field ? (direction === "desc" ? "descending" : "ascending") : "none";
  const total = data?.pagination.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  if (loading && !data) {
    return (
      <section className="space-y-4" aria-label={t("loading")}>
        <div className="h-16 animate-pulse rounded-lg bg-gray-800" />
        <div className="h-72 animate-pulse rounded-lg bg-gray-800" />
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="ccg-admin-users-title" aria-busy={loading}>
      <div>
        <h3 id="ccg-admin-users-title" className="text-xl font-bold text-white text-balance">{t("title")}</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>
      </div>

      {error ? <div className="rounded-lg bg-red-950/50 p-4 text-sm text-red-200 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.3)]" role="alert">{error}</div> : null}

      <div className="overflow-hidden rounded-lg bg-gray-800/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="overflow-x-auto">
          <table className="min-w-[780px] w-full">
            <thead className="bg-gray-950/65">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">{t("user")}</th>
                <th scope="col" aria-sort={ariaSort("packOpenings")} className="px-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                    onClick={() => changeSort("packOpenings")}
                    aria-label={t("sortBy", { column: t("packsOpened") })}
                  >
                    {t("packsOpened")} <span aria-hidden="true">{sortIndicator("packOpenings")}</span>
                  </button>
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">{t("leaderboardScore")}</th>
                <th scope="col" aria-sort={ariaSort("channelPointsUsed")} className="px-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                    onClick={() => changeSort("channelPointsUsed")}
                    aria-label={t("sortBy", { column: t("channelPointsUsed") })}
                  >
                    {t("channelPointsUsed")} <span aria-hidden="true">{sortIndicator("channelPointsUsed")}</span>
                  </button>
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">{t("timesRedeemed")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {data?.users.map((user) => {
                const name = user.displayName ?? (user.ownerType === "guest" ? t("guest") : t("unknownAccount"));
                const twitchName = user.twitchDisplayName && user.twitchDisplayName !== name ? user.twitchDisplayName : null;
                return (
                  <tr key={`${user.ownerType}:${user.id}`} className="hover:bg-white/[0.035]">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-white">{name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.ownerType === "user" ? "bg-cyan-950 text-cyan-200" : "bg-gray-700 text-gray-300"}`}>
                          {t(user.ownerType === "user" ? "signedIn" : "guest")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        <span className="font-mono">{t("identifier", { id: user.idPrefix })}</span>
                        {twitchName ? <span> · {t("twitchName", { name: twitchName })}</span> : null}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-white">{numberFormatter.format(user.packOpenings)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-200">
                      {user.leaderboardScore === null ? "—" : numberFormatter.format(user.leaderboardScore)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-purple-200">{numberFormatter.format(user.channelPointsUsed)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-300">{numberFormatter.format(user.timesRedeemed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data?.users.length === 0 ? <p className="px-4 py-10 text-center text-sm text-gray-400">{t("empty")}</p> : null}

        <div className="flex flex-col gap-3 bg-gray-950/55 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm tabular-nums text-gray-400">{t("showing", { from, to, total })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-10 items-center gap-2 text-sm text-gray-400">
              {t("rowsPerPage")}
              <select
                value={limit}
                onChange={(event) => {
                  beginLoad();
                  setLimit(Number(event.target.value));
                  setPage(1);
                }}
                className="min-h-10 rounded-md border border-white/10 bg-gray-900 px-2 text-sm text-white outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/15"
              >
                {[25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button type="button" className={paginationButton} onClick={() => { beginLoad(); setPage((current) => Math.max(1, current - 1)); }} disabled={loading || page <= 1}>
              {t("previous")}
            </button>
            <button type="button" className={paginationButton} onClick={() => { beginLoad(); setPage((current) => current + 1); }} disabled={loading || !data || page >= data.pagination.totalPages}>
              {t("next")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
