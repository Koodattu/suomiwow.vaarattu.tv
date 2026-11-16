"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { GuildHeader, GuildPagination, guildPageSize } from "@/components/forever/ForeverGuildShared";
import { Faction, ForeverDate, ForeverErrorMessage } from "@/components/forever/ForeverShared";
import { foreverApi } from "@/lib/forever-api";
import { emptyGuildFilters, filterForeverGuilds, guildSorts, type GuildSort, type PublicForeverGuild } from "@/lib/forever-guilds";
import world from "@/components/forever/forever.module.css";
import styles from "@/components/forever/guilds.module.css";

export default function ForeverGuildsPage() {
  const t = useTranslations("forever"), locale = useLocale();
  const [filters, setFilters] = useState(emptyGuildFilters), [sort, setSort] = useState<GuildSort>("sizeDesc"), [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["forever", "guilds"],
    queryFn: ({ signal }) => foreverApi<{ guilds: PublicForeverGuild[] }>("forever/guilds", "GET", undefined, signal),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const guilds = useMemo(() => filterForeverGuilds(query.data?.guilds ?? [], filters, sort, locale), [query.data, filters, sort, locale]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(guilds.length / guildPageSize)));
  const filtered = Object.values(filters).some(Boolean);
  const setFilter = (field: keyof typeof filters, value: string) => { setFilters({ ...filters, [field]: value }); setPage(1); };
  return <div className={world.world}><div className={world.shell}>
    <GuildHeader />
    <p className={styles.intro}>{t("guilds.description")}</p>
    <section className={world.board} aria-label={t("guilds.title")}>
      <div className={styles.controls}>
        <label className={styles.search}>{t("guilds.search")}<input className={world.input} type="search" maxLength={100} value={filters.search} onChange={event => setFilter("search", event.target.value)} /></label>
        {(["ruleset", "faction"] as const).map(field => <label key={field}>{t(field)}
          <select className={world.select} value={filters[field]} onChange={event => setFilter(field, event.target.value)}>
            <option value="">{t("all")}</option>
            {[...new Set([...(query.data?.guilds ?? []).map(guild => guild[field] || "unknown"), ...(filters[field] ? [filters[field]] : [])])].sort().map(value =>
              <option key={value} value={value}>{value === "unknown" ? t("statistics.unknown") : field === "faction" ? t(`factions.${value.toLowerCase()}`) : value}</option>)}
          </select>
        </label>)}
        <label>{t("guilds.sort")}<select className={world.select} value={sort} onChange={event => { setSort(event.target.value as GuildSort); setPage(1); }}>
          {guildSorts.map(value => <option key={value} value={value}>{t(`guilds.sorts.${value}`)}</option>)}
        </select></label>
        {filtered && <button className={world.button} onClick={() => { setFilters(emptyGuildFilters); setPage(1); }}>{t("clearFilters")}</button>}
      </div>
      {query.error && <div className={styles.error}><ForeverErrorMessage error={query.error} /><button className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>}
      {query.isPending && <p className={world.empty} role="status">{t("loading")}</p>}
      {query.data && <>
        <div className={styles.resultCount} role="status">{t("guilds.count", { count: guilds.length, total: query.data.guilds.length })}</div>
        {guilds.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label={t("guilds.tableScroll")}>
          <table className={`${world.table} ${styles.table}`}>
            <thead><tr>{["guild", "ruleset", "faction", "guilds.members", "checked"].map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
            <tbody>{guilds.slice((currentPage - 1) * guildPageSize, currentPage * guildPageSize).map(guild => <tr key={guild._id}>
              <td><Link className={styles.guildLink} href={`/forever/guilds/${guild._id}`}>{guild.name}<span aria-hidden="true"> →</span></Link><span className={styles.meta}>{t(guild.region === "eu" ? "eu" : "us")}</span></td>
              <td>{guild.ruleset || t("statistics.unknown")}</td>
              <td>{guild.faction ? <Faction name={guild.faction} /> : t("statistics.unknown")}</td>
              <td className={styles.number}>{guild.lastFetchedAt ? guild.rosterCount.toLocaleString(locale) : "—"}</td>
              <td className={world.checked}>{guild.lastFetchedAt ? <ForeverDate value={guild.lastFetchedAt} /> : t("guilds.awaitingRoster")}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className={world.empty}>{t(filtered ? "guilds.noMatches" : "guilds.empty")}</p>}
        <div className={world.boardFoot}><span>{t("guilds.classificationNote")}</span><GuildPagination page={currentPage} total={guilds.length} onPage={setPage} /></div>
      </>}
    </section>
  </div></div>;
}
