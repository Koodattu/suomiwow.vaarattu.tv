"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions } from "@headlessui/react";
import { FaArrowLeft, FaArrowUpRightFromSquare, FaCheck, FaChevronDown, FaCrosshairs } from "react-icons/fa6";
import IconImage from "@/components/IconImage";
import { useAvoidableDamage, useAvoidableMechanicOptions } from "@/lib/queries";
import { getClassInfoById } from "@/lib/utils";
import type { MechanicFilters, MechanicRole } from "@/types/avoidable-damage";

const CLASS_COLORS: Record<string, string> = {
  "Death Knight": "#C41E3A", Druid: "#FF7C0A", Hunter: "#AAD372", Mage: "#3FC7EB", Monk: "#00FF98", Paladin: "#F48CBA",
  Priest: "#FFFFFF", Rogue: "#FFF468", Shaman: "#0070DD", Warlock: "#8788EE", Warrior: "#C69B6D", "Demon Hunter": "#A330C9", Evoker: "#33937F",
};
const selectStyle = "mt-2 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400";
const ROLES: MechanicRole[] = ["dps", "healer", "tank"];

export default function MechanicLeaderboardView() {
  const t = useTranslations("mechanicLeaderboard");
  const locale = useLocale();
  const options = useAvoidableMechanicOptions();
  const [raid, setRaid] = useState("");
  const [mechanicKey, setMechanicKey] = useState("");
  const [guildId, setGuildId] = useState("");
  const [outcome, setOutcome] = useState<MechanicFilters["outcome"]>("all");
  const [sort, setSort] = useState<MechanicFilters["sort"]>("damage");
  const [order, setOrder] = useState<MechanicFilters["order"]>("desc");
  const [roles, setRoles] = useState<MechanicRole[]>(ROLES);
  const [minPulls, setMinPulls] = useState(0);
  const [page, setPage] = useState(1);
  const selectedRaid = raid || String(options.data?.mechanics[0]?.zoneId ?? "");
  const mechanics = options.data?.mechanics.filter((entry) => String(entry.zoneId) === selectedRaid) ?? [];
  const selected = mechanics.find((entry) => entry.key === mechanicKey) ?? mechanics[0];
  const board = useAvoidableDamage({ mechanic: selected?.key ?? "", guildId: guildId || undefined, outcome, sort, order, roles, minPulls, page });
  const number = (value: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const compact = (value: number) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(value);
  const data = board.data;
  const coverage = data?.coverage;
  const knownPulls = coverage ? coverage.fetched + coverage.pending + coverage.failed + coverage.archived + coverage.unavailable : 0;
  const raids = options.data?.raids.slice().sort((a, b) => b.id - a.id) ?? [];
  const error = options.isError || board.isError;
  const changeSort = (value: MechanicFilters["sort"]) => {
    setOrder(sort === value && order === "desc" ? "asc" : "desc");
    setSort(value);
    setPage(1);
  };
  const sortDirection = order === "asc" ? "ascending" : "descending";
  const sortArrow = order === "asc" ? " ↑" : " ↓";

  return (
    <main className="min-h-[calc(100vh-5rem)] px-4 py-8 text-gray-100 md:px-6 md:py-12">
      <div className="mx-auto max-w-6xl">
        <Link href="/analytics" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"><FaArrowLeft aria-hidden="true" />{t("back")}</Link>
        <div className="mt-7 flex items-start gap-4">
          <span className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-rose-300"><FaCrosshairs className="h-7 w-7" aria-hidden="true" /></span>
          <div><p className="text-xs font-semibold uppercase tracking-widest text-rose-300">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-bold md:text-4xl">{t("title")}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">{t("description")}</p></div>
        </div>

        <section aria-label={t("filters")} className="mt-8 grid gap-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-gray-400">{t("raid")}
            <select className={selectStyle} value={selectedRaid} disabled={!raids.length} onChange={(event) => { setRaid(event.target.value); setMechanicKey(""); setPage(1); }}>
              {raids.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-400">{t("mechanic")}
            <select className={selectStyle} value={selected?.key ?? ""} disabled={!mechanics.length} onChange={(event) => { setMechanicKey(event.target.value); setPage(1); }}>
              {mechanics.map((entry) => <option key={entry.key} value={entry.key}>{entry.boss} · {entry.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-400">{t("guild")}
            <select className={selectStyle} value={guildId} onChange={(event) => { setGuildId(event.target.value); setPage(1); }}>
              <option value="">{t("allGuilds")}</option>
              {options.data?.guilds.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.realm}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-400">{t("pulls")}
            <select className={selectStyle} value={outcome} onChange={(event) => { setOutcome(event.target.value as MechanicFilters["outcome"]); setPage(1); }}>
              <option value="all">{t("allPulls")}</option><option value="kills">{t("kills")}</option><option value="wipes">{t("wipes")}</option>
            </select>
          </label>
          <Listbox value={roles} onChange={(values: MechanicRole[]) => { setRoles(ROLES.filter((role) => values.includes(role))); setPage(1); }} multiple>
            <div className="relative text-xs font-medium text-gray-400">
              <ListboxLabel>{t("roles")}</ListboxLabel>
              <ListboxButton className={`${selectStyle} flex items-center justify-between gap-2 text-left`}>
                <span className="truncate">{roles.length === ROLES.length ? t("allRoles") : roles.length ? roles.map((role) => t(`role.${role}`)).join(", ") : t("noRoles")}</span>
                <FaChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              </ListboxButton>
              <ListboxOptions className="absolute z-20 mt-1 w-full rounded-md border border-gray-700 bg-gray-900 p-1 text-sm text-gray-100 shadow-xl focus:outline-none">
                {ROLES.map((role) => <ListboxOption key={role} value={role} className="flex cursor-pointer items-center gap-3 rounded px-3 py-2.5 data-focus:bg-gray-800">
                  {({ selected: checked }) => <><span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-rose-400 bg-rose-400 text-gray-950" : "border-gray-500"}`} aria-hidden="true">{checked && <FaCheck className="h-3 w-3" />}</span>{t(`role.${role}`)}</>}
                </ListboxOption>)}
              </ListboxOptions>
            </div>
          </Listbox>
          <label className="text-xs font-medium text-gray-400">{t("minimumPulls")}
            <select className={selectStyle} value={minPulls} onChange={(event) => { setMinPulls(Number(event.target.value)); setPage(1); }}>
              <option value={0}>{t("anyPullCount")}</option>
              {[10, 25, 50, 100].map((count) => <option key={count} value={count}>{t("atLeastPulls", { count })}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-400">{t("sortBy")}
            <select className={selectStyle} value={sort} onChange={(event) => { setSort(event.target.value as MechanicFilters["sort"]); setPage(1); }}>
              <option value="damage">{t("damage")}</option><option value="hits">{t("hits")}</option><option value="hitsPerPull">{t("hitsPerPull")}</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-400">{t("sortOrder")}
            <select className={selectStyle} value={order} onChange={(event) => { setOrder(event.target.value as MechanicFilters["order"]); setPage(1); }}>
              <option value="desc">{t("descending")}</option><option value="asc">{t("ascending")}</option>
            </select>
          </label>
        </section>

        {error ? <div role="alert" className="mt-6 rounded-lg border border-red-900 bg-red-950/20 p-6 text-sm"><p>{t("error")}</p><button className="mt-3 rounded border border-red-700 px-4 py-2 hover:bg-red-900/30" onClick={() => { void options.refetch(); void board.refetch(); }}>{t("retry")}</button></div> :
          options.isPending || (selected && board.isPending) ? <div role="status" className="mt-6 animate-pulse rounded-lg border border-gray-800 p-12 text-center text-gray-400">{t("loading")}</div> :
          !selected ? <p className="mt-6 rounded-lg border border-gray-800 p-8 text-gray-400">{t("noMechanics")}</p> : data && <>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3"><IconImage key={selected.icon} iconFilename={selected.icon} alt="" width={40} height={40} className="rounded border border-gray-700" /><div><h2 className="font-semibold">{selected.name}</h2><p className="mt-1 text-xs text-gray-400">{selected.boss} · {t("mythic")}</p></div></div>
              <div className="flex items-center gap-3 text-xs text-gray-400"><span role="status">{board.isFetching ? t("updating") : ""}</span><p>{t("coverage", { count: number(coverage?.fetched ?? 0), total: number(knownPulls) })}</p></div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[{ label: t("damage"), value: compact(data.totals.damage) }, { label: t("hits"), value: number(data.totals.hits) }, { label: t("players"), value: number(data.totals.players) }].map((stat) => <div key={stat.label} className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-4"><p className="text-xs text-gray-400">{stat.label}</p><p className="mt-2 text-xl font-semibold tabular-nums md:text-2xl">{stat.value}</p></div>)}
            </div>

            {data.rows.length === 0 ? <div className="mt-5 rounded-lg border border-gray-800 p-10 text-center"><h3 className="font-semibold">{t("empty")}</h3><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-gray-400">{t("emptyHint")}</p></div> : <div aria-busy={board.isFetching} className={`mt-5 overflow-x-auto rounded-lg border border-gray-800 ${board.isPlaceholderData ? "opacity-60" : ""}`}>
              <table className="relative w-full min-w-[760px] border-collapse text-sm tabular-nums">
                <caption className="sr-only">{t("tableCaption", { boss: selected.boss, mechanic: selected.name })}</caption>
                <thead className="bg-gray-800/80 text-xs text-gray-300"><tr>
                  <th scope="col" className="px-3 py-3 text-left">#</th><th scope="col" className="px-3 py-3 text-left">{t("name")}</th>
                  <th scope="col" aria-sort={sort === "damage" ? sortDirection : "none"} className="w-[36%] px-3 py-3 text-right"><button className={sort === "damage" ? "text-white" : "hover:text-white"} onClick={() => changeSort("damage")}>{t("damage")}{sort === "damage" ? sortArrow : ""}</button></th>
                  <th scope="col" aria-sort={sort === "hits" ? sortDirection : "none"} className="px-3 py-3 text-right"><button className={sort === "hits" ? "text-white" : "hover:text-white"} onClick={() => changeSort("hits")}>{t("hits")}{sort === "hits" ? sortArrow : ""}</button></th>
                  <th scope="col" className="px-3 py-3 text-right">{t("pulls")}</th>
                  <th scope="col" aria-sort={sort === "hitsPerPull" ? sortDirection : "none"} className="whitespace-nowrap px-3 py-3 text-right"><button className={sort === "hitsPerPull" ? "text-white" : "hover:text-white"} onClick={() => changeSort("hitsPerPull")}>{t("hitsPerPull")}{sort === "hitsPerPull" ? sortArrow : ""}</button></th>
                  <th scope="col" className="px-3 py-3"><span className="sr-only">{t("log")}</span></th>
                </tr></thead>
                <tbody>{data.rows.map((row, index) => {
                  const classInfo = getClassInfoById(row.classId);
                  const color = CLASS_COLORS[classInfo.name] ?? "#9CA3AF";
                  const share = data.totals.damage ? row.damage / data.totals.damage * 100 : 0;
                  const bar = data.totals.maxDamage ? row.damage / data.totals.maxDamage * 100 : 0;
                  const log = `https://www.warcraftlogs.com/reports/${encodeURIComponent(row.reportCode)}#fight=${row.fightId}&type=damage-taken&source=${row.actorId}&filter=${encodeURIComponent(`ability.id IN (${selected.damageSpellIds.join(",")})`)}`;
                  return <tr key={row.key} className="border-t border-gray-800/80 odd:bg-gray-950/40 even:bg-gray-900/50 hover:bg-gray-800/60">
                    <td className="px-3 py-3 text-xs text-gray-500">{(data.page - 1) * data.limit + index + 1}</td>
                    <td className="px-3 py-2"><div className="flex items-center gap-2.5"><IconImage iconFilename={classInfo.iconUrl} alt="" width={24} height={24} className="rounded" /><div><span className="font-medium" style={{ color }}>{row.name}</span><p className="mt-0.5 text-[11px] text-gray-500">{row.guildName} · {row.realm}</p></div></div></td>
                    <td className="px-3 py-2"><div className="relative flex h-7 items-center justify-between gap-3 overflow-hidden rounded-sm px-2"><span aria-hidden="true" className="absolute inset-y-0 left-0 opacity-35" style={{ width: `${bar}%`, backgroundColor: color }} /><span className="relative text-xs text-gray-300">{number(share, 2)}%</span><span className="relative font-medium" title={number(row.damage)}>{compact(row.damage)}</span></div></td>
                    <td className="px-3 py-2 text-right" title={t("hitBreakdown", { direct: number(row.directHits), ticks: number(row.ticks) })}>{number(row.hits)}</td>
                    <td className="px-3 py-2 text-right text-gray-400">{number(row.pulls)}</td>
                    <td className="px-3 py-2 text-right">{number(row.hitsPerPull, 2)}</td>
                    <td className="px-3 py-2"><a href={log} target="_blank" rel="noopener noreferrer" className="inline-flex p-2 text-gray-500 hover:text-white" aria-label={t("openLog", { name: row.name })} title={t("logHint")}><FaArrowUpRightFromSquare aria-hidden="true" /></a></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}

            {data.totalPages > 1 && <nav aria-label={t("pagination")} className="mt-4 flex items-center justify-end gap-4 text-sm"><button disabled={page <= 1 || board.isPlaceholderData} className="rounded border border-gray-700 px-3 py-2 hover:bg-gray-800 disabled:opacity-40" onClick={() => setPage(page - 1)}>{t("previous")}</button><span className="text-gray-400">{t("page", { page: data.page, total: data.totalPages })}</span><button disabled={page >= data.totalPages || board.isPlaceholderData} className="rounded border border-gray-700 px-3 py-2 hover:bg-gray-800 disabled:opacity-40" onClick={() => setPage(page + 1)}>{t("next")}</button></nav>}
            <details className="mt-6 rounded-lg border border-gray-800 px-4 py-3 text-xs leading-6 text-gray-400"><summary className="cursor-pointer font-medium text-gray-300">{t("about")}</summary><p className="mt-3">{t("measurement")}</p><p className="mt-2">{t("scope")}</p><p className="mt-2">{t("roleScope")}</p><p className="mt-2">{t("missing", { pending: number(coverage?.pending ?? 0), failed: number(coverage?.failed ?? 0), unavailable: number((coverage?.archived ?? 0) + (coverage?.unavailable ?? 0)), duplicate: number(coverage?.duplicate ?? 0) })}</p><p className="mt-2">{t("nightly")}{data.updatedAt && ` · ${t("updated", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.updatedAt)) })}`}</p></details>
          </>}
      </div>
    </main>
  );
}
