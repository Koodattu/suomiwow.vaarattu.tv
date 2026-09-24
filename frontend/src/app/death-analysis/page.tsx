"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBosses, useCharacterSearch, useRaids } from "@/lib/queries";
import { formatRealmName, getClassInfoById } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import DeathTimeline from "@/components/DeathTimeline";
import { deathTimeLabel as time } from "@/lib/death-timeline";

const fieldClass = "mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-gray-100 focus:border-amber-400 focus:outline-none";
const eventColumns = [
  { label: "date", sort: "date" }, { label: "outcome", sort: "isKill" },
  { label: "deathTime", sort: "deathTime" }, { label: "deathPercent", sort: "deathPercent" },
  { label: "pullDuration", sort: "duration" }, { label: "deathOrder", sort: "order" },
  { label: "phase", sort: "phase" },
] as const;

function DeathAnalysis() {
  const t = useTranslations("deathAnalysis");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const name = params.get("name") ?? "";
  const realm = params.get("realm") ?? "";
  const classId = params.get("class") ?? "";
  const zoneId = Number(params.get("zoneId")) || null;
  const encounterId = params.get("encounterId") ?? "";
  const difficulty = params.get("difficulty") ?? "5";
  const outcome = params.get("outcome") ?? "all";
  const view = params.get("view") === "records" ? "records" : "timeline";
  const orderFilter = params.get("orderFilter") ?? "all";
  const timingFilter = params.get("timingFilter") ?? "all";
  const phaseFilter = params.get("phaseFilter") ?? "all";
  const sortBy = params.get("sortBy") ?? "date";
  const sortDirection = params.get("sortDirection") ?? "desc";
  const { data: raids = [], error: raidsError, refetch: refetchRaids } = useRaids();
  const { data: bosses = [], error: bossesError, refetch: refetchBosses } = useBosses(zoneId);
  const searchResult = useCharacterSearch(debouncedSearch, debouncedSearch.length >= 2);
  const ready = !!(name && realm && classId && zoneId && encounterId);
  const scopeQuery = new URLSearchParams({ zoneId: String(zoneId ?? ""), encounterId, class: classId, region: params.get("region") ?? "eu", difficulty, outcome }).toString();
  const eventQuery = new URLSearchParams({ orderFilter, timingFilter, phaseFilter, sortBy, sortDirection, page: params.get("page") ?? "1" }).toString();
  const query = `${scopeQuery}&${eventQuery}`;
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["character-deaths", realm, name, scopeQuery, eventQuery],
    queryFn: ({ signal }) => api.getCharacterDeaths(realm, name, query, signal),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === realm && previousQuery.queryKey[2] === name && previousQuery.queryKey[3] === scopeQuery ? previous : undefined,
    enabled: ready,
    staleTime: 60_000,
  });
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (["name", "realm", "class", "zoneId", "encounterId", "difficulty", "outcome"].some((key) => key in values)) {
      for (const key of ["phaseFilter", "session", "cluster", "pull", "death"]) next.delete(key);
    }
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.push(`/death-analysis?${next}`, { scroll: false });
  };
  const boss = bosses.find((entry) => String(entry.id) === encounterId);
  const summary = data?.summary;

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/characters" className="text-xs text-slate-400 hover:text-white">← {t("characters")}</Link>
          <h1 className="mt-2 text-xl font-semibold text-white">{t("title")}</h1>
        </div>
        {name && <div className="flex min-w-0 items-center gap-3">
          <IconImage iconFilename={getClassInfoById(Number(classId)).iconUrl} alt="" width={36} height={36} className="rounded-md" />
          <div><div className="font-semibold text-white">{name}</div><div className="text-xs text-slate-400">{formatRealmName(realm)}</div></div>
          {boss && <><span className="mx-1 text-slate-500">/</span><IconImage iconFilename={boss.iconUrl} alt="" width={36} height={36} className="rounded-md" /><div className="min-w-0"><div className="text-sm font-medium text-slate-100">{boss.name}</div><div className="text-xs text-slate-400">{t(difficulty === "5" ? "mythic" : difficulty === "4" ? "heroic" : "normal")}</div></div></>}
        </div>}
      </header>
      <details open={!ready} className="mb-5 border-y border-slate-800 py-2">
        <summary className="cursor-pointer py-2 text-sm text-slate-300 hover:text-white">{ready ? t("changeSelection") : t("chooseFilters")}</summary>
      <section aria-label={t("filters")} className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="text-sm text-gray-300" htmlFor="death-character">{t("character")}</label>
          <input id="death-character" className={fieldClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} autoComplete="off" />
          {name && <p className="mt-2 break-words text-sm text-amber-300">{name} · {formatRealmName(realm)}</p>}
          {search.trim().length >= 2 && (
            <div className="mt-2 space-y-1 rounded-lg border border-gray-700 bg-gray-950 p-2" aria-live="polite">
              {searchResult.isFetching || search.trim() !== debouncedSearch ? <p className="text-sm text-gray-400">{t("loading")}</p> : searchResult.error ? <p className="text-sm text-red-300">{t("error")}</p> : searchResult.data?.characters.length ? searchResult.data.characters.map((character) => (
                <button key={`${character.region}:${character.realm}:${character.name}:${character.classID}`} type="button" className="w-full rounded px-2 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 focus:bg-gray-800" onClick={() => {
                  update({ name: character.name, realm: character.realm, class: String(character.classID), region: character.region });
                  setSearch("");
                }}>{character.name} · {formatRealmName(character.realm)}{character.guild ? ` · ${character.guild.name}` : ""}</button>
              )) : <p className="text-sm text-gray-400">{t("noCharacters")}</p>}
            </div>
          )}
        </div>
        <label className="text-sm text-gray-300">{t("raid")}<select className={fieldClass} value={zoneId ?? ""} onChange={(event) => update({ zoneId: event.target.value, encounterId: "" })}>
          <option value="">{t("selectRaid")}</option>{raids.map((raid) => <option key={raid.id} value={raid.id}>{raid.name}</option>)}
        </select></label>
        <label className="text-sm text-gray-300">{t("boss")}<select className={fieldClass} value={encounterId} disabled={!zoneId} onChange={(event) => update({ encounterId: event.target.value })}>
          <option value="">{t("selectBoss")}</option>{bosses.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></label>
        <label className="text-sm text-gray-300">{t("difficulty")}<select className={fieldClass} value={difficulty} onChange={(event) => update({ difficulty: event.target.value })}>
          <option value="5">{t("mythic")}</option><option value="4">{t("heroic")}</option><option value="3">{t("normal")}</option>
        </select></label>
        <label className="text-sm text-gray-300">{t("outcome")}<select className={fieldClass} value={outcome} onChange={(event) => update({ outcome: event.target.value })}>
          <option value="all">{t("allPulls")}</option><option value="wipes">{t("wipes")}</option><option value="kills">{t("kills")}</option>
        </select></label>
      </section>

      </details>
      {(error || raidsError || bossesError) && <div role="alert" className="my-6 flex flex-wrap items-center gap-4 text-sm text-rose-300"><span>{t("error")}</span><button type="button" className="rounded border border-slate-600 px-3 py-2 text-slate-100" onClick={() => { if (raidsError) void refetchRaids(); if (bossesError) void refetchBosses(); if (error) void refetch(); }}>{t("retry")}</button></div>}
      {!ready && <p className="py-16 text-center text-slate-300">{t("chooseFilters")}</p>}
      {ready && isLoading && <div role="status" className="space-y-4 py-5"><p className="text-sm text-slate-300">{t("loading")}</p><div className="h-10 rounded bg-slate-900 motion-safe:animate-pulse" /><div className="h-96 rounded bg-slate-900 motion-safe:animate-pulse" /></div>}
      {ready && data && summary && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm">
            <dl aria-label={t("summary")} className="flex flex-wrap gap-x-6 gap-y-2 text-slate-300">
              <div className="flex gap-2"><dd className="font-semibold tabular-nums text-white">{summary.pulls}</dd><dt>{t("confirmedPulls")}</dt></div>
              <div className="flex gap-2"><dd className="font-semibold tabular-nums text-rose-300">{summary.deaths}</dd><dt>{t("deaths")}</dt></div>
              <div className="flex gap-2"><dd className="font-semibold tabular-nums text-emerald-300">{summary.survivedPulls}</dd><dt>{t("survivedPulls")}</dt></div>
              <div className="flex gap-2"><dd className="font-semibold tabular-nums text-white">{summary.averageFirstDeathTime === null ? "—" : time(summary.averageFirstDeathTime)}</dd><dt>{t("averageFirstDeathShort")}</dt></div>
            </dl>
            <details className="max-w-2xl text-xs leading-relaxed text-slate-300"><summary className="cursor-pointer py-2">{t("coverageShort", { count: summary.evaluatedPulls, total: summary.pulls })} · {t("aboutData")}</summary><p className="mt-2">{t("coverage", { evaluated: summary.evaluatedPulls, total: summary.pulls, unconfirmed: summary.unconfirmedPulls })}</p><p className="mt-2">{t("rawNote", { count: summary.firstThreePulls })}</p><p className="mt-2">{t("causeDescription")}</p></details>
          </div>
          <div className="flex gap-5 border-b border-slate-800" role="group" aria-label={t("analysisView")}>
            {(["timeline", "records"] as const).map((value) => <button type="button" key={value} aria-pressed={view === value} onClick={() => update({ view: value })} className={"min-h-11 border-b-2 px-1 text-sm font-medium transition-colors motion-reduce:transition-none " + (view === value ? "border-amber-300 text-amber-200" : "border-transparent text-slate-300 hover:text-white")}>{t(value)}</button>)}
          </div>
          {view === "timeline" ? <DeathTimeline pulls={data.timeline} name={name} update={update} /> : (
          <section aria-busy={isFetching} className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/60">
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">{t("eventsTitle")}</h2>
                <button type="button" className="text-sm text-amber-300 hover:underline disabled:opacity-40" disabled={orderFilter === "all" && timingFilter === "all" && phaseFilter === "all" && sortBy === "date" && sortDirection === "desc"} onClick={() => update({ orderFilter: "", timingFilter: "", phaseFilter: "", sortBy: "", sortDirection: "" })}>{t("resetTable")}</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm text-gray-300">{t("deathOrder")}<select className={fieldClass} value={orderFilter} onChange={(event) => update({ orderFilter: event.target.value })}>
                  <option value="all">{t("allOrders")}</option><option value="first">{t("firstDeath")}</option><option value="firstThree">{t("firstThree")}</option><option value="later">{t("afterFirstThree")}</option><option value="unknown">{t("unknown")}</option>
                </select></label>
                <label className="text-sm text-gray-300">{t("timingFilter")}<select className={fieldClass} value={timingFilter} onChange={(event) => update({ timingFilter: event.target.value })}>
                  <option value="all">{t("allTimings")}</option>{[0, 1, 2, 3].map((quarter) => <option key={quarter} value={quarter}>{t("timingRange", { from: quarter * 25, to: (quarter + 1) * 25 })}</option>)}
                </select></label>
                <label className="text-sm text-gray-300">{t("phase")}<select className={fieldClass} value={phaseFilter} onChange={(event) => update({ phaseFilter: event.target.value })}>
                  <option value="all">{t("allPhases")}</option>
                  {data.eventOptions.phases.map((phase) => <option key={phase} value={`phase:${phase}`}>{phase}</option>)}
                  {(data.eventOptions.hasUnknownPhase || phaseFilter === "unknown") && <option value="unknown">{t("unknown")}</option>}
                  {phaseFilter.startsWith("phase:") && !data.eventOptions.phases.includes(phaseFilter.slice(6)) && <option value={phaseFilter}>{phaseFilter.slice(6)}</option>}
                </select></label>
              </div>
              <p className="text-sm text-gray-400" role="status">{isFetching ? t("loading") : t("matchingDeaths", { count: data.pagination.totalItems, total: summary.deaths })}</p>
              <p className="text-xs text-gray-500">{t("tableFiltersNote")}</p>
            </div>
            {!data.events.length ? <p className="px-5 pb-6 text-gray-400">{summary.deaths ? t("noMatchingDeaths") : summary.evaluatedPulls ? t("noDeaths") : t("noData")}</p> : (
              <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="border-y border-gray-800 bg-gray-950/50 text-gray-400"><tr>{eventColumns.map((column) => <th key={column.sort} scope="col" aria-sort={sortBy === column.sort ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className="px-5 py-3 font-medium">
                  <button type="button" className="flex items-center gap-2 rounded py-1 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-400" onClick={() => update({ sortBy: column.sort, sortDirection: sortBy === column.sort ? sortDirection === "asc" ? "desc" : "asc" : column.sort === "date" ? "desc" : "asc" })}>
                    {t(column.label)} <span aria-hidden="true" className={sortBy === column.sort ? "text-amber-300" : "text-gray-600"}>{sortBy === column.sort ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span>
                  </button>
                </th>)}<th scope="col" className="px-5 py-3 font-medium">{t("log")}</th></tr></thead>
                <tbody>{data.events.map((event, index) => <tr key={`${event.reportCode}:${event.fightId}:${index}`} className="border-b border-gray-800/60 text-gray-300">
                  <td className="px-5 py-3">{new Date(event.date).toLocaleDateString(locale)}</td>
                  <td className="px-5 py-3">{event.isKill ? t("kill") : t("wipe")}</td>
                  <td className="px-5 py-3 font-medium tabular-nums text-white">{time(event.deathTime)}</td>
                  <td className="px-5 py-3 tabular-nums">{Math.round(event.deathPercent)}%</td>
                  <td className="px-5 py-3 tabular-nums">{time(event.duration)}</td>
                  <td className="px-5 py-3">{event.order === null ? "—" : `#${event.order}`}</td>
                  <td className="px-5 py-3">{event.phase ?? "—"}</td>
                  <td className="px-5 py-3"><a href={`https://www.warcraftlogs.com/reports/${encodeURIComponent(event.reportCode)}#fight=${event.fightId}&type=deaths`} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline">{t("openLog")} ↗</a></td>
                </tr>)}</tbody>
              </table></div>
            )}
            {data.pagination.totalPages > 1 && <nav aria-label={t("pagination")} className="flex items-center justify-between gap-4 p-5 text-sm text-gray-300">
              <button type="button" className="rounded border border-gray-700 px-3 py-2 disabled:opacity-30" disabled={isFetching || data.pagination.currentPage <= 1} onClick={() => update({ page: String(data.pagination.currentPage - 1) })}>{t("previous")}</button>
              <span>{t("page", { page: data.pagination.currentPage, total: data.pagination.totalPages })}</span>
              <button type="button" className="rounded border border-gray-700 px-3 py-2 disabled:opacity-30" disabled={isFetching || data.pagination.currentPage >= data.pagination.totalPages} onClick={() => update({ page: String(data.pagination.currentPage + 1) })}>{t("next")}</button>
            </nav>}
          </section>
          )}
        </>
      )}
    </main>
  );
}

export default function DeathAnalysisPage() {
  return <Suspense><DeathAnalysis /></Suspense>;
}
