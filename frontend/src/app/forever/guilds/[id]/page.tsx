"use client";

import Link from "next/link";
import { Suspense, use, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { GuildDirectoryBackLink, GuildHeader, GuildPagination, guildPageSize } from "@/components/forever/ForeverGuildShared";
import { classColor, Faction, ForeverDate, ForeverErrorMessage } from "@/components/forever/ForeverShared";
import { foreverApi, foreverCharacterPath, foreverRace } from "@/lib/forever-api";
import { filterForeverRoster, rosterSorts, type RosterSort, type PublicForeverGuildDetail } from "@/lib/forever-guilds";
import world from "@/components/forever/forever.module.css";
import styles from "@/components/forever/guilds.module.css";

export default function ForeverGuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), t = useTranslations("forever"), locale = useLocale();
  const [search, setSearch] = useState(""), [sort, setSort] = useState<RosterSort>("levelDesc"), [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["forever", "guild", id],
    queryFn: ({ signal }) => foreverApi<PublicForeverGuildDetail>(`forever/guilds/${encodeURIComponent(id)}`, "GET", undefined, signal),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const guild = query.data;
  const roster = useMemo(() => filterForeverRoster(guild?.roster ?? [], search, sort, locale), [guild, search, sort, locale]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(roster.length / guildPageSize)));
  return <div className={world.world}><div className={world.shell}>
    <Suspense fallback={<Link className={world.backToBoard} href="/forever/guilds">← {t("guilds.back")}</Link>}><GuildDirectoryBackLink id={id} /></Suspense>
    <GuildHeader name={guild?.name} />
    {query.error && <div className={styles.error}><ForeverErrorMessage error={query.error} /><button className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>}
    {query.isPending && <p className={world.empty} role="status">{t("loading")}</p>}
    {guild && <>
      <dl className={styles.summary}>
        <div><dt>{t("guilds.members")}</dt><dd>{guild.lastFetchedAt ? guild.rosterCount.toLocaleString(locale) : "—"}</dd></div>
        <div><dt>{t("ruleset")}</dt><dd>{guild.ruleset || t("statistics.unknown")}</dd></div>
        <div><dt>{t("faction")}</dt><dd>{guild.faction ? <Faction name={guild.faction} /> : t("statistics.unknown")}</dd></div>
        <div><dt>{t("region")}</dt><dd>{t(guild.region === "eu" ? "eu" : "us")}</dd></div>
        <div><dt>{t("checked")}</dt><dd><ForeverDate value={guild.lastFetchedAt} /></dd></div>
      </dl>
      <div className={styles.rosterHeading}><h2>{t("guilds.roster")}</h2><a className={world.button} href={guild.armoryUrl} target="_blank" rel="noreferrer">{t("openArmory")}</a></div>
      <section className={world.board} aria-label={t("guilds.roster")}>
        <div className={styles.controls}>
          <label className={styles.search}>{t("guilds.searchRoster")}<input className={world.input} type="search" maxLength={100} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
          <label>{t("guilds.sort")}<select className={world.select} value={sort} onChange={event => { setSort(event.target.value as RosterSort); setPage(1); }}>
            {rosterSorts.map(value => <option key={value} value={value}>{t(`guilds.sorts.${value}`)}</option>)}
          </select></label>
          {search && <button className={world.button} onClick={() => { setSearch(""); setPage(1); }}>{t("clearFilters")}</button>}
        </div>
        <div className={styles.resultCount} role="status">{t("guilds.rosterCount", { count: roster.length, total: guild.rosterCount })}</div>
        {roster.length ? <div className={styles.scroll} tabIndex={0} role="region" aria-label={t("guilds.rosterScroll")}>
          <table className={`${world.table} ${styles.table}`}>
            <thead><tr>{["character", "level", "className", "race", "faction"].map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
            <tbody>{roster.slice((currentPage - 1) * guildPageSize, currentPage * guildPageSize).map(member => <tr key={`${member.region}/${member.slug}`}>
              <td style={{ color: classColor(member.className ?? undefined) }}>{member.characterId ?
                <Link className={styles.memberLink} href={foreverCharacterPath({ ...member, _id: member.characterId })}>{member.name}</Link> : member.name}
                {member.isOutdated && <span className={styles.meta}>{t("guilds.outdated")}</span>}</td>
              <td className={styles.number}>{member.level ?? "—"}</td><td>{member.className || "—"}</td><td>{foreverRace(member.race ?? undefined)}</td>
              <td>{member.faction ? <Faction name={member.faction} /> : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className={world.empty}>{t(search ? "guilds.noMembers" : guild.lastFetchedAt ? "guilds.emptyRoster" : "guilds.awaitingRoster")}</p>}
        <div className={world.boardFoot}><span>{t("guilds.rosterNote")}</span><GuildPagination page={currentPage} total={roster.length} onPage={setPage} /></div>
      </section>
    </>}
  </div></div>;
}
