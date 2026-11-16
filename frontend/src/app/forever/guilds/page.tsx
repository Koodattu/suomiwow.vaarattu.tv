"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { GuildHeader, GuildPagination, guildPageSize } from "@/components/forever/ForeverGuildShared";
import { Faction, ForeverUpdated, ForeverErrorMessage } from "@/components/forever/ForeverShared";
import { foreverApi } from "@/lib/forever-api";
import { emptyGuildFilters, filterForeverGuilds, guildDirectoryQuery, readGuildDirectoryQuery, guildSorts, type GuildSort, type PublicForeverGuild } from "@/lib/forever-guilds";
import world from "@/components/forever/forever.module.css";
import styles from "@/components/forever/guilds.module.css";

function GuildDirectory() {
  const t = useTranslations("forever"), locale = useLocale(), params = useSearchParams();
  const state = useMemo(() => readGuildDirectoryQuery(params), [params]);
  const results = useRef<HTMLDivElement>(null), restored = useRef(false);
  const query = useQuery({
    queryKey: ["forever", "guilds"],
    queryFn: ({ signal }) => foreverApi<{ guilds: PublicForeverGuild[] }>("forever/guilds", "GET", undefined, signal),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const guilds = useMemo(() => filterForeverGuilds(query.data?.guilds ?? [], state, state.sort, locale), [query.data, state, locale]);
  const currentPage = Math.min(state.page, Math.max(1, Math.ceil(guilds.length / guildPageSize)));
  const filtered = !!(state.search || state.faction || state.ruleset);
  const directoryQuery = guildDirectoryQuery({ ...state, page: currentPage });
  useEffect(() => {
    if (!query.data || restored.current) return;
    restored.current = true;
    const row = document.getElementById(window.location.hash.slice(1));
    row?.scrollIntoView({ block: "center" });
    row?.focus({ preventScroll: true });
  }, [query.data]);
  function update(values: Partial<typeof state>, push = false) {
    const current = readGuildDirectoryQuery(new URLSearchParams(window.location.search));
    const next = guildDirectoryQuery({ ...current, page: 1, ...values });
    window.history[push ? "pushState" : "replaceState"](null, "", `/forever/guilds${next}`);
  }
  function changePage(page: number) {
    update({ page }, true);
    results.current?.scrollIntoView({ block: "start" });
    results.current?.focus({ preventScroll: true });
  }
  return <section className={styles.directory} aria-label={t("guilds.title")}>
    <div className={styles.directoryControls}>
      <div className={styles.search}>
        <div className={styles.searchHeading}><label htmlFor="forever-guild-search">{t("guilds.search")}</label>
          {query.data && <span className={styles.guildCount} role="status">{t(filtered ? "guilds.count" : "guilds.totalCount", { count: guilds.length, total: query.data.guilds.length })}</span>}
        </div>
        <input id="forever-guild-search" className={world.input} type="search" maxLength={100} value={state.search} onChange={event => update({ search: event.target.value })} />
      </div>
      {(["ruleset", "faction"] as const).map(field => <label key={field}>{t(field)}
        <select className={world.select} value={state[field]} onChange={event => update({ [field]: event.target.value })}>
          <option value="">{t(field === "ruleset" ? "allRulesets" : "guilds.allFactions")}</option>
          {[...new Set([...(query.data?.guilds ?? []).map(guild => guild[field] || "unknown"), ...(state[field] ? [state[field]] : [])])].sort().map(value =>
            <option key={value} value={value}>{value === "unknown" ? t("statistics.unknown") : field === "faction" && ["Horde", "Alliance"].includes(value) ? t(`factions.${value.toLowerCase()}`) : value}</option>)}
        </select>
      </label>)}
      <label>{t("guilds.sort")}<select className={world.select} value={state.sort} onChange={event => update({ sort: event.target.value as GuildSort })}>
        {guildSorts.map(value => <option key={value} value={value}>{t(`guilds.sorts.${value}`)}</option>)}
      </select></label>
    </div>
    {query.error && <div className={styles.error}><ForeverErrorMessage error={query.error} /><button className={world.button} disabled={query.isFetching} onClick={() => void query.refetch()}>{t(query.isFetching ? "loading" : "progress.tryAgain")}</button></div>}
    {query.isPending && <p className={world.empty} role="status">{t("loading")}</p>}
    {query.data && <div className={styles.directoryResults} ref={results} tabIndex={-1}>
      {guilds.length > 0 && (filtered || guilds.length > guildPageSize) && <div className={styles.resultsBar}>
        {filtered && <button className={styles.reset} onClick={() => update(emptyGuildFilters)}>{t("clearFilters")}</button>}
        <GuildPagination page={currentPage} total={guilds.length} onPage={changePage} />
      </div>}
      {guilds.length ? <>
        <div className={styles.columnHeadings} aria-hidden="true"><span>{t("guild")}</span><span>{t("ruleset")}</span><span>{t("faction")}</span><span className={styles.memberCount}>{t("guilds.members")}</span><span>{t("checked")}</span><span /></div>
        <ul className={styles.guildList}>
          {guilds.slice((currentPage - 1) * guildPageSize, currentPage * guildPageSize).map(guild => <li key={guild._id}>
            <Link id={`guild-${guild._id}`} className={styles.guildRow} href={`/forever/guilds/${guild._id}${directoryQuery}`}>
              <span className={styles.guildIdentity}><strong>{guild.name}</strong></span>
              <span className={styles.guildRuleset}><span className="sr-only">{t("ruleset")}: </span>{guild.ruleset || t("statistics.unknown")}</span>
              <span className={styles.guildFaction}><span className="sr-only">{t("faction")}: </span>{guild.faction ? <Faction name={guild.faction} /> : t("statistics.unknown")}</span>
              <span className={styles.memberCount}><strong>{guild.lastFetchedAt ? guild.rosterCount.toLocaleString(locale) : "—"}</strong><span className="sr-only"> {t("guilds.members")}</span><span className={styles.mobileLabel} aria-hidden="true">{t("guilds.members")}</span></span>
              <span className={styles.guildUpdated}>{guild.lastFetchedAt ? <><span className="sr-only">{t("checked")} </span><span className={styles.mobileLabel} aria-hidden="true">{t("checked")} </span><ForeverUpdated value={guild.lastFetchedAt} /></> : t("guilds.awaitingRosterShort")}</span>
              <span className={styles.rowArrow} aria-hidden="true">→</span>
            </Link>
          </li>)}
        </ul>
        {guilds.length > guildPageSize && <div className={styles.bottomPages}><GuildPagination page={currentPage} total={guilds.length} onPage={changePage} /></div>}
      </> : <div className={styles.empty}><h2>{t(filtered ? "guilds.noMatches" : "guilds.empty")}</h2>
        {filtered && <button className={world.button} onClick={() => update(emptyGuildFilters)}>{t("clearFilters")}</button>}
      </div>}
    </div>}
  </section>;
}

export default function ForeverGuildsPage() {
  const t = useTranslations("forever");
  return <div className={world.world}><div className={world.shell}>
    <GuildHeader />
    <Suspense fallback={<p className={world.empty} role="status">{t("loading")}</p>}><GuildDirectory /></Suspense>
  </div></div>;
}
