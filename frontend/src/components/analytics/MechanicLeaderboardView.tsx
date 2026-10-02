"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Label, Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions } from "@headlessui/react";
import { FaArrowLeft, FaArrowRight, FaArrowRotateLeft, FaCheck, FaChevronDown, FaMagnifyingGlass } from "react-icons/fa6";
import IconImage from "@/components/IconImage";
import { useDebouncedSearchQuery } from "@/features/fun/useFunGameSearch";
import { useAvoidableDamage, useAvoidableMechanicOptions } from "@/lib/queries";
import { formatSpecName, getClassInfoById, getSpecIconUrl } from "@/lib/utils";
import type { MechanicFilters, MechanicRole } from "@/types/avoidable-damage";

const CLASS_COLORS: Record<string, string> = {
  "Death Knight": "#C41E3A", Druid: "#FF7C0A", Hunter: "#AAD372", Mage: "#3FC7EB", Monk: "#00FF98", Paladin: "#F48CBA",
  Priest: "#FFFFFF", Rogue: "#FFF468", Shaman: "#0070DD", Warlock: "#8788EE", Warrior: "#C69B6D", "Demon Hunter": "#A330C9", Evoker: "#33937F",
};
const selectStyle = "h-11 w-full min-w-0 rounded-md border border-gray-700 bg-gray-900 px-2.5 text-xs text-gray-100 focus:outline-none focus-visible:border-gray-500 focus-visible:ring-1 focus-visible:ring-gray-500";
const labelStyle = "flex min-w-0 flex-col gap-1 text-[11px] font-medium text-gray-400";
const ROLES: MechanicRole[] = ["dps", "healer", "tank"];
const roleIcon = (role: MechanicRole) => `roleicon_${role === "dps" ? "damage" : role}.png`;

export default function MechanicLeaderboardView() {
  const t = useTranslations("mechanicLeaderboard");
  const locale = useLocale();
  const router = useRouter();
  const options = useAvoidableMechanicOptions();
  const [mechanicKey, setMechanicKey] = useState("");
  const [guildId, setGuildId] = useState("");
  const [guildSearch, setGuildSearch] = useState("");
  const [characterSearch, setCharacterSearch] = useState("");
  const search = useDebouncedSearchQuery(characterSearch);
  const [sort, setSort] = useState<MechanicFilters["sort"]>("damage");
  const [order, setOrder] = useState<MechanicFilters["order"]>("desc");
  const [roles, setRoles] = useState<MechanicRole[]>(ROLES);
  const [minPulls, setMinPulls] = useState(10);
  const [page, setPage] = useState(1);
  const mechanics = options.data?.mechanics ?? [];
  const selected = mechanics.find((entry) => entry.key === mechanicKey) ?? mechanics[0];
  const selectedRaid = options.data?.raids.find((entry) => entry.id === selected?.zoneId);
  const guilds = options.data?.guilds.filter((entry) => selected && entry.mechanicKeys?.includes(selected.key)) ?? [];
  const selectedGuild = guilds.find((entry) => entry.id === guildId);
  const filteredGuilds = guilds.filter((entry) => entry.name.toLocaleLowerCase(locale).includes(guildSearch.trim().toLocaleLowerCase(locale)));
  const board = useAvoidableDamage({ mechanic: selected?.key ?? "", guildId: selectedGuild?.id, outcome: "all", sort, order, roles, minPulls, page,
    search: search.trimmedQuery ? search.debouncedQuery : undefined });
  const searchPending = Boolean(search.trimmedQuery) && !search.isCurrent;
  const number = (value: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const compact = (value: number) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(value);
  const data = board.data;
  const coverage = data?.coverage;
  const raids = options.data?.raids.slice().sort((a, b) => b.id - a.id) ?? [];
  const error = options.isError || board.isError;
  const changeSort = (value: MechanicFilters["sort"]) => {
    setOrder(sort === value && order === "desc" ? "asc" : "desc");
    setSort(value);
    setPage(1);
  };
  const sortDirection = order === "asc" ? "ascending" : "descending";
  const sortArrow = order === "asc" ? " ↑" : " ↓";
  const hasChanges = selected?.key !== mechanics[0]?.key || Boolean(selectedGuild) || roles.length !== ROLES.length ||
    minPulls !== 10 || sort !== "damage" || order !== "desc" || Boolean(characterSearch) || page !== 1;
  const resetFilters = () => {
    setMechanicKey("");
    setGuildId("");
    setGuildSearch("");
    setCharacterSearch("");
    setRoles(ROLES);
    setMinPulls(10);
    setSort("damage");
    setOrder("desc");
    setPage(1);
  };

  return (
    <main className="min-h-[calc(100vh-5rem)] px-4 py-4 text-gray-100 md:px-6 md:py-5">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-bold sm:text-2xl">{t("title")}</h1>
            {data && <span className="text-xs tabular-nums text-gray-400">{t("playerCount", { count: data.totals.players })}</span>}
            <span role="status" className="text-xs text-gray-500">{(board.isFetching || searchPending) && data ? t("updating") : ""}</span>
          </div>
          <Link href="/analytics" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white"><FaArrowLeft aria-hidden="true" />{t("back")}</Link>
        </header>

        <section aria-label={t("filters")} className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.15fr)_7.25rem_7.5rem_minmax(0,1fr)]">
          <Listbox value={selected?.key ?? ""} onChange={(key: string) => {
            setMechanicKey(key);
            if (!selectedGuild?.mechanicKeys.includes(key)) setGuildId("");
            setGuildSearch("");
            setPage(1);
          }} disabled={!mechanics.length}>
            <div className={`relative col-span-2 lg:col-span-1 ${labelStyle}`}>
              <ListboxLabel>{t("mechanic")}</ListboxLabel>
              <ListboxButton className={`${selectStyle} flex items-center gap-2 text-left`} title={selected ? `${selectedRaid?.name ?? ""} · ${selected.boss} · ${selected.name}` : undefined}>
                {selected ? <>
                  <IconImage key={selectedRaid?.iconUrl} iconFilename={selectedRaid?.iconUrl} alt="" width={28} height={28} className="shrink-0 rounded" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] leading-4 text-gray-400">{selectedRaid?.name}</span>
                    <span className="flex min-w-0 items-center gap-1.5 leading-4">
                      <IconImage key={selected.bossIcon} iconFilename={selected.bossIcon} alt="" width={16} height={16} className="shrink-0 rounded-sm" />
                      <span className="truncate">{selected.boss}</span>
                      <span aria-hidden="true" className="text-gray-600">·</span>
                      <IconImage key={selected.icon} iconFilename={selected.icon} alt="" width={16} height={16} className="shrink-0 rounded-sm" />
                      <span className="truncate font-semibold">{selected.name}</span>
                    </span>
                  </span>
                </> : <span className="flex-1 truncate">{t(options.isPending ? "loading" : "noMechanics")}</span>}
                <FaChevronDown className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
              </ListboxButton>
              <ListboxOptions className="absolute top-full z-30 mt-1 max-h-[min(24rem,65vh)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 text-sm text-gray-100 shadow-xl focus:outline-none">
                {raids.map((raid) => <div key={raid.id} role="group" aria-labelledby={`mechanic-raid-${raid.id}`}>
                  <div id={`mechanic-raid-${raid.id}`} className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-700/60 bg-gray-800 px-3 py-2 text-xs font-medium text-gray-300">
                    <IconImage iconFilename={raid.iconUrl} alt="" width={20} height={20} className="shrink-0 rounded" />
                    <span className="min-w-0 flex-1 truncate">{raid.name}</span>
                    <span className="text-[10px] text-gray-500">{raid.expansion}</span>
                  </div>
                  {mechanics.filter((entry) => entry.zoneId === raid.id).map((entry) => <ListboxOption key={entry.key} value={entry.key} className="group flex cursor-pointer items-center gap-2.5 px-3 py-2.5 data-focus:bg-gray-800 data-selected:bg-gray-800/60">
                    {({ selected: checked }) => <>
                      <IconImage iconFilename={entry.bossIcon} alt="" width={28} height={28} className="shrink-0 rounded" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-gray-400">{entry.boss}</span>
                        <span className="mt-0.5 flex items-center gap-1.5"><IconImage iconFilename={entry.icon} alt="" width={16} height={16} className="shrink-0 rounded-sm" /><span className="truncate">{entry.name}</span></span>
                      </span>
                      {checked && <FaCheck className="h-3 w-3 shrink-0 text-gray-200" aria-hidden="true" />}
                    </>}
                  </ListboxOption>)}
                </div>)}
              </ListboxOptions>
            </div>
          </Listbox>
          <Combobox value={selectedGuild?.id ?? ""} onChange={(id: string | null) => { setGuildId(id ?? ""); setGuildSearch(""); setPage(1); }} onClose={() => setGuildSearch("")} immediate>
            <div className={`relative col-span-2 lg:col-span-1 ${labelStyle}`}>
              <Label>{t("guild")}</Label>
              <div className="relative">
                <FaMagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                <ComboboxInput className={`${selectStyle} pl-8 pr-8`} autoComplete="off" placeholder={t("searchGuilds")} title={t("searchGuilds")}
                  displayValue={(id: string) => guilds.find((entry) => entry.id === id)?.name ?? t("allGuilds")}
                  onChange={(event) => setGuildSearch(event.target.value)} onFocus={(event) => event.target.select()} />
                <ComboboxButton aria-label={t("searchGuilds")} className="absolute inset-y-0 right-0 rounded-r-md px-2.5 text-gray-400 focus:outline-none focus-visible:outline-1 focus-visible:outline-gray-500"><FaChevronDown className="h-3 w-3" aria-hidden="true" /></ComboboxButton>
              </div>
              <ComboboxOptions className="absolute top-full z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-700 bg-gray-900 p-1 text-sm text-gray-100 shadow-xl focus:outline-none">
                <ComboboxOption value="" className="flex cursor-pointer items-center justify-between gap-2 rounded px-3 py-2.5 data-focus:bg-gray-800">
                  {({ selected: checked }) => <>{t("allGuilds")}{checked && <FaCheck className="h-3 w-3 shrink-0 text-gray-200" aria-hidden="true" />}</>}
                </ComboboxOption>
                {filteredGuilds.map((guild) => <ComboboxOption key={guild.id} value={guild.id} className="flex cursor-pointer items-center justify-between gap-2 rounded px-3 py-2.5 data-focus:bg-gray-800">
                  {({ selected: checked }) => <><span className="min-w-0 truncate">{guild.name}</span>{checked && <FaCheck className="h-3 w-3 shrink-0 text-gray-200" aria-hidden="true" />}</>}
                </ComboboxOption>)}
                {filteredGuilds.length === 0 && <p role="status" className="px-3 py-2.5 text-xs text-gray-400">{t("noGuilds")}</p>}
              </ComboboxOptions>
            </div>
          </Combobox>
          <Listbox value={roles} onChange={(values: MechanicRole[]) => { setRoles(ROLES.filter((role) => values.includes(role))); setPage(1); }} multiple>
            <div className={`relative ${labelStyle}`}>
              <ListboxLabel>{t("roles")}</ListboxLabel>
              <ListboxButton className={`${selectStyle} flex items-center justify-between gap-2 text-left`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  {roles.map((role) => <span key={role} title={t(`role.${role}`)} className="shrink-0"><IconImage iconFilename={roleIcon(role)} alt="" width={20} height={20} /></span>)}
                  <span className={roles.length > 1 ? "sr-only" : "truncate"}>{roles.length === ROLES.length ? t("allRoles") : roles.length ? roles.map((role) => t(`role.${role}`)).join(", ") : t("noRoles")}</span>
                </span>
                <FaChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              </ListboxButton>
              <ListboxOptions className="absolute top-full z-20 mt-1 min-w-full whitespace-nowrap rounded-md border border-gray-700 bg-gray-900 p-1 text-sm text-gray-100 shadow-xl focus:outline-none">
                {ROLES.map((role) => <ListboxOption key={role} value={role} className="flex cursor-pointer items-center gap-3 rounded px-3 py-2.5 data-focus:bg-gray-800">
                  {({ selected: checked }) => <><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-gray-300 bg-gray-300 text-gray-950" : "border-gray-500"}`} aria-hidden="true">{checked && <FaCheck className="h-3 w-3" />}</span><IconImage iconFilename={roleIcon(role)} alt="" width={20} height={20} className="shrink-0" />{t(`role.${role}`)}</>}
                </ListboxOption>)}
              </ListboxOptions>
            </div>
          </Listbox>
          <label className={labelStyle}>{t("minimumPulls")}
            <select className={selectStyle} value={minPulls} onChange={(event) => { setMinPulls(Number(event.target.value)); setPage(1); }}>
              {[10, 25, 50, 100].map((count) => <option key={count} value={count}>{t("atLeastPulls", { count })}</option>)}
            </select>
          </label>
          <div className={`col-span-2 lg:col-span-1 ${labelStyle}`}>
            <label htmlFor="mechanic-character-search">{t("character")}</label>
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <FaMagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                <input id="mechanic-character-search" type="search" value={characterSearch} maxLength={60} autoComplete="off" spellCheck={false}
                  placeholder={t("searchCharacters")} className={`${selectStyle} pl-8`}
                  onChange={(event) => { setCharacterSearch(event.target.value); setPage(1); }} />
              </div>
              {hasChanges && <button type="button" onClick={resetFilters} aria-label={t("reset")} title={t("reset")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-red-400 hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-1 focus-visible:outline-gray-500">
                <FaArrowRotateLeft className="h-4 w-4" aria-hidden="true" />
              </button>}
            </div>
          </div>
        </section>

        {error ? <div role="alert" className="mt-6 rounded-lg border border-red-900 bg-red-950/20 p-6 text-sm"><p>{t("error")}</p><button className="mt-3 rounded border border-red-700 px-4 py-2 hover:bg-red-900/30" onClick={() => { void options.refetch(); void board.refetch(); }}>{t("retry")}</button></div> :
          options.isPending || (selected && board.isPending) ? <div role="status" className="mt-6 animate-pulse rounded-lg border border-gray-800 p-12 text-center text-gray-400">{t("loading")}</div> :
          !selected ? <p className="mt-6 rounded-lg border border-gray-800 p-8 text-gray-400">{t("noMechanics")}</p> : data && <>
            {data.rows.length === 0 ? <div className="mt-4 rounded-lg border border-gray-800 p-10 text-center"><h3 className="font-semibold">{t("empty")}</h3><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-gray-400">{t("emptyHint")}</p></div> : <div aria-busy={board.isFetching} className={`mt-4 overflow-x-auto rounded-lg border border-gray-800 ${board.isPlaceholderData ? "opacity-60" : ""}`}>
              <table className="relative w-full min-w-[760px] border-collapse text-sm tabular-nums">
                <caption className="sr-only">{t("tableCaption", { boss: selected.boss, mechanic: selected.name })}</caption>
                <thead className="bg-gray-800/80 text-xs text-gray-300"><tr>
                  <th scope="col" className="px-3 py-3 text-left">#</th><th scope="col" className="px-3 py-3 text-left">{t("name")}</th>
                  <th scope="col" aria-sort={sort === "damage" ? sortDirection : "none"} className="w-[36%] px-3 py-3 text-right"><button className={sort === "damage" ? "text-white" : "hover:text-white"} onClick={() => changeSort("damage")}>{t("damage")}{sort === "damage" ? sortArrow : ""}</button></th>
                  <th scope="col" aria-sort={sort === "hits" ? sortDirection : "none"} className="px-3 py-3 text-right"><button className={sort === "hits" ? "text-white" : "hover:text-white"} onClick={() => changeSort("hits")}>{t("hits")}{sort === "hits" ? sortArrow : ""}</button></th>
                  <th scope="col" className="px-3 py-3 text-right">{t("pulls")}</th>
                  <th scope="col" aria-sort={sort === "hitsPerPull" ? sortDirection : "none"} className="whitespace-nowrap px-3 py-3 text-right"><button className={sort === "hitsPerPull" ? "text-white" : "hover:text-white"} onClick={() => changeSort("hitsPerPull")}>{t("hitsPerPull")}{sort === "hitsPerPull" ? sortArrow : ""}</button></th>
                  <th scope="col" className="px-3 py-3"><span className="sr-only">{t("character")}</span></th>
                </tr></thead>
                <tbody>{data.rows.map((row, index) => {
                  const classInfo = getClassInfoById(row.classId);
                  const icon = row.specName ? getSpecIconUrl(row.classId, row.specName) : classInfo.iconUrl;
                  const color = CLASS_COLORS[classInfo.name] ?? "#9CA3AF";
                  const share = data.totals.damage ? row.damage / data.totals.damage * 100 : 0;
                  const bar = data.totals.maxDamage ? row.damage / data.totals.maxDamage * 100 : 0;
                  const characterHref = `/characters/${encodeURIComponent(row.realm)}/${encodeURIComponent(row.name)}?class=${row.classId}`;
                  return <tr key={row.key} className="cursor-pointer border-t border-gray-800/80 odd:bg-gray-950/40 even:bg-gray-900/50 hover:bg-gray-800/60 focus-within:bg-gray-800/60" onClick={(event) => {
                    if (event.defaultPrevented || (event.target as HTMLElement).closest("a") || window.getSelection()?.toString()) return;
                    if (event.ctrlKey || event.metaKey || event.shiftKey) window.open(characterHref, "_blank", "noopener,noreferrer");
                    else router.push(characterHref);
                  }}>
                    <td className="px-3 py-3 text-xs text-gray-500">{(data.page - 1) * data.limit + index + 1}</td>
                    <td className="px-3 py-2"><div className="flex items-center gap-2.5"><span title={row.specName ? t("specHint", { spec: formatSpecName(row.specName) }) : classInfo.name}><IconImage key={icon} iconFilename={icon} alt="" width={24} height={24} className="rounded" /></span><div><Link href={characterHref} prefetch={false} className="font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-gray-400" style={{ color }} aria-label={t("openCharacter", { name: row.name })}>{row.name}</Link><p className="mt-0.5 text-[11px] text-gray-500">{row.guildName}</p></div></div></td>
                    <td className="px-3 py-2"><div className="relative flex h-7 items-center justify-between gap-3 overflow-hidden rounded-sm px-2"><span aria-hidden="true" className="absolute inset-y-0 left-0 opacity-35" style={{ width: `${bar}%`, backgroundColor: color }} /><span className="relative text-xs text-gray-300">{number(share, 2)}%</span><span className="relative font-medium" title={number(row.damage)}>{compact(row.damage)}</span></div></td>
                    <td className="px-3 py-2 text-right" title={t("hitBreakdown", { direct: number(row.directHits), ticks: number(row.ticks) })}>{number(row.hits)}</td>
                    <td className="px-3 py-2 text-right text-gray-400">{number(row.pulls)}</td>
                    <td className="px-3 py-2 text-right">{number(row.hitsPerPull, 2)}</td>
                    <td className="px-3 py-2"><Link href={characterHref} prefetch={false} tabIndex={-1} className="inline-flex p-2 text-gray-500 hover:text-white" aria-label={t("openCharacter", { name: row.name })} title={t("openCharacter", { name: row.name })}><FaArrowRight aria-hidden="true" /></Link></td>
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
