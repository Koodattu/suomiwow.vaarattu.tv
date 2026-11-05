"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNow, useTranslations } from "next-intl";
import { foreverApi, foreverCharacterPath, formatForeverDate, type ForeverAdminData, type ForeverGuild } from "@/lib/forever-api";
import { buttonClass, CharacterForm, classColor, controlClass, ForeverDate, ForeverErrorMessage, ForeverUpdated, Portrait, StreamerLink, TwitchEditor, WorkerStatus } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

function RetryButton({ lastAttemptAt, disabled, onClick }: { lastAttemptAt?: string; disabled: boolean; onClick: () => void }) {
  const t = useTranslations("forever.admin"), now = useNow({ updateInterval: 15_000 });
  const availableAt = Date.parse(lastAttemptAt || "") + 5 * 60_000;
  const minutes = Math.max(0, Math.ceil((availableAt - now.getTime()) / 60_000)) || 0;
  return <button className={buttonClass} disabled={disabled || minutes > 0} onClick={onClick}
    title={minutes ? t("retryAvailable", { date: formatForeverDate(new Date(availableAt).toISOString()) }) : undefined}>
    {minutes ? t("retryIn", { count: minutes }) : t("retryNow")}
  </button>;
}

function FetchState({ errorCode, failures }: { errorCode?: string; failures?: number }) {
  const t = useTranslations("forever.admin");
  if (!errorCode) return null;
  const key = ["upstream_error", "not_found", "unavailable", "invalid_data", "identity_mismatch", "stale_data"].includes(errorCode) ? errorCode : "unavailable";
  return <span className={styles.adminError} title={errorCode}>{t(`fetchErrors.${key}`)}{failures ? <small>{t("attempts", { count: failures })}</small> : null}</span>;
}

function Pagination({ page, total, onChange, disabled }: { page: number; total: number; onChange: (page: number) => void; disabled: boolean }) {
  const t = useTranslations("forever");
  if (total <= 50 && page === 1) return null;
  return <div className={styles.boardFoot}><span>{t("admin.results", { count: total })}</span><div className={styles.pagination}>
    <button className={buttonClass} disabled={disabled || page === 1} onClick={() => onChange(page - 1)}>{t("previous")}</button>
    <span>{t("page", { page })}</span><button className={buttonClass} disabled={disabled || page * 50 >= total} onClick={() => onChange(page + 1)}>{t("next")}</button>
  </div></div>;
}

export default function ForeverAdminPanel() {
  const t = useTranslations("forever"), client = useQueryClient();
  const [view, setView] = useState<"characters" | "guilds">("characters");
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all"), [health, setHealth] = useState("all"), [search, setSearch] = useState("");
  const [guildFilter, setGuildFilter] = useState("all"), [guildSearch, setGuildSearch] = useState(""), [rosterSearch, setRosterSearch] = useState("");
  const [characterPage, setCharacterPage] = useState(1), [guildPage, setGuildPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]), [guildId, setGuildId] = useState<string | null>(null);
  const params = new URLSearchParams({ status: filter, health, search, guildStatus: guildFilter, guildSearch, characterPage: String(characterPage), guildPage: String(guildPage) });
  const overview = useQuery({ queryKey: ["forever", "admin", params.toString()], queryFn: () => foreverApi<ForeverAdminData>(`admin/forever?${params}`), refetchInterval: 30_000 });
  const data = overview.data, activeGuildId = guildId || data?.guilds[0]?._id;
  const guild = useQuery({ queryKey: ["forever", "admin", "guild", activeGuildId], queryFn: () => foreverApi<ForeverGuild>(`admin/forever/guilds/${activeGuildId}`), enabled: view === "guilds" && !!activeGuildId, refetchInterval: 30_000 });
  const refresh = () => void client.invalidateQueries({ queryKey: ["forever"] });
  async function act(path: string, method: string, body?: unknown) {
    setError(null); setNotice(""); setBusy(true);
    try {
      const result = await foreverApi<{ updated?: number; skipped?: number }>(`admin/forever/${path}`, method, body);
      setNotice(result.updated === undefined ? t("admin.saved") : t("admin.result", { count: result.updated, skipped: result.skipped || 0 }));
      setSelected([]); await client.invalidateQueries({ queryKey: ["forever"] });
    } catch (caught) { setError(caught); } finally { setBusy(false); }
  }
  const selectedVisible = data?.characters.filter((character) => selected.includes(character._id)) || [];
  const bulk = (action: string) => void act("characters/bulk", "POST", { ids: selectedVisible.map((character) => character._id), action });
  const changeCharacterPage = (page: number) => { setCharacterPage(page); setSelected([]); };
  const total = (counts?: Record<string, number>) => Object.values(counts || {}).reduce((sum, count) => sum + count, 0);
  const activeGuild = guild.data;
  const members = activeGuild?.roster?.filter((member) => `${member.name} ${member.className}`.toLocaleLowerCase().includes(rosterSearch.toLocaleLowerCase())) || [];

  return <div className={styles.adminPanel}>
    <div className={styles.adminTop}>
      <header><h2 className={styles.title}>{t("adminTitle")}</h2><div className={styles.headerMeta}><Link href="/forever/leveling">{t("viewLeaderboard")} ↗</Link><button className={styles.adminTextButton} onClick={refresh} disabled={overview.isFetching}>{t("admin.reload")}</button></div></header>
      <CharacterForm admin onAdded={refresh} />
    </div>
    <div className={styles.adminNavigation}>
      <div className={styles.adminTabs} role="group" aria-label={t("admin.sections")}>
        <button aria-pressed={view === "characters"} onClick={() => { setView("characters"); setNotice(""); }}>{t("characters")} <b>{total(data?.characterCounts)}</b></button>
        <button aria-pressed={view === "guilds"} onClick={() => { setView("guilds"); setNotice(""); }}>{t("discoveredGuilds")} <b>{total(data?.guildCounts)}</b></button>
      </div>
      {data && <WorkerStatus worker={data.worker} enabled={data.enabled} />}
    </div>
    {(error != null || overview.error) && <ForeverErrorMessage error={error || overview.error} />}
    {notice && <p className={styles.adminNotice} role="status">{notice}</p>}

    {view === "characters" ? <section className={styles.board} aria-label={t("characters")} aria-busy={overview.isFetching}>
      <div className={styles.toolbar}>
        <label className={styles.adminSearch}>{t("admin.searchCharacters")}<input className={styles.input} type="search" maxLength={100} value={search} onChange={(event) => { setSearch(event.target.value); changeCharacterPage(1); }} placeholder={t("admin.searchHint")} /></label>
        <div className={styles.adminFilters}>
          <label>{t("status")}<select className={controlClass} value={filter} onChange={(event) => { setFilter(event.target.value); changeCharacterPage(1); }}>{["all", "pending", "tracked", "paused", "rejected"].map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}{data ? ` (${status === "all" ? total(data.characterCounts) : data.characterCounts[status] || 0})` : ""}</option>)}</select></label>
          <label>{t("admin.fetchStatus")}<select className={controlClass} value={health} onChange={(event) => { setHealth(event.target.value); changeCharacterPage(1); }}>{["all", "errors", "unfetched"].map((value) => <option key={value} value={value}>{t(`admin.health.${value}`)}</option>)}</select></label>
        </div>
      </div>
      {selectedVisible.length > 0 && <div className={styles.adminBulk} role="group" aria-label={t("admin.bulkActions")}>
        <strong>{t("admin.selected", { count: selectedVisible.length })}</strong>
        <button className={buttonClass} disabled={busy || !selectedVisible.some((c) => c.status !== "tracked")} onClick={() => bulk("tracked")}>{t("approveCharacter")}</button>
        <button className={buttonClass} disabled={busy || !selectedVisible.some((c) => c.status === "tracked")} onClick={() => bulk("paused")}>{t("pause")}</button>
        <button className={buttonClass} disabled={busy || !selectedVisible.some((c) => c.status === "tracked")} onClick={() => bulk("retry")}>{t("admin.retrySelected")}</button>
        <button className={buttonClass} disabled={busy || !selectedVisible.some((c) => c.status === "pending")} onClick={() => bulk("rejected")}>{t("reject")}</button>
        <button className={styles.adminTextButton} disabled={busy} onClick={() => setSelected([])}>{t("admin.clearSelection")}</button>
      </div>}
      {overview.isPending ? <p className={styles.empty} role="status">{t("loading")}</p> : <>
        <div className={styles.tableScroll} role="region" tabIndex={0} aria-label={t("characters")}><table className={`${styles.table} ${styles.adminTable}`}><thead><tr>
          <th><input type="checkbox" aria-label={t("admin.selectPage")} disabled={busy || !data?.characters.length} checked={!!data?.characters.length && selectedVisible.length === data.characters.length}
            ref={(node) => { if (node) node.indeterminate = selectedVisible.length > 0 && selectedVisible.length < (data?.characters.length || 0); }}
            onChange={(event) => setSelected(event.target.checked ? data?.characters.map((c) => c._id) || [] : [])} /></th>
          {["character", "guild", "status", "checked", "actions"].map((key) => <th key={key} scope="col">{t(key)}</th>)}
        </tr></thead><tbody>{data?.characters.map((character) => <tr key={character._id} data-selected={selected.includes(character._id)}>
          <td><input type="checkbox" aria-label={t("admin.selectCharacter", { name: character.name || character.slug })} disabled={busy} checked={selected.includes(character._id)} onChange={(event) => setSelected(event.target.checked ? [...selected, character._id] : selected.filter((id) => id !== character._id))} /></td>
          <td><div className={styles.identity}><Portrait character={character} /><div>
            {character.status === "tracked" ? <Link className={styles.name} style={{ color: classColor(character.className) }} href={foreverCharacterPath(character)}>{character.name || character.slug}</Link> : <span className={styles.name} style={{ color: classColor(character.className) }}>{character.name || character.slug}</span>}
            <span className={styles.raceClass}>{[character.level, character.race, character.className].filter(Boolean).join(" · ")}</span>
            <a className={styles.adminLink} target="_blank" rel="noreferrer" href={`https://worldofwarcraft.blizzard.com/en-gb/forever/${character.region}/armory/character/${encodeURIComponent(character.slug)}`}>{t("openArmory")}</a>
          </div></div><StreamerLink character={character} /><TwitchEditor key={`${character._id}-${character.twitchChannel || ""}`} character={character} onSaved={refresh} /></td>
          <td className={styles.guild}>{character.guild?.name || "—"}</td>
          <td><span className={styles.adminStatus} data-status={character.status}>{t(`statuses.${character.status}`)}</span><FetchState errorCode={character.errorCode} failures={character.failures} /></td>
          <td className={styles.checked}><ForeverUpdated value={character.lastFetchedAt} /><span className={styles.adminSecondary}>{t("nextCheck")}<br /><ForeverDate value={character.status === "tracked" ? character.nextFetchAt : undefined} /></span></td>
          <td><div className={styles.adminActions}>
            {character.status !== "tracked" && <button className={buttonClass} disabled={busy} onClick={() => void act(`characters/${character._id}`, "PATCH", { status: "tracked" })}>{t("approveCharacter")}</button>}
            {character.status === "tracked" && <><RetryButton lastAttemptAt={character.lastAttemptAt} disabled={busy} onClick={() => void act(`characters/${character._id}/refresh`, "POST")} /><button className={`${buttonClass} ${styles.quietButton}`} disabled={busy} onClick={() => void act(`characters/${character._id}`, "PATCH", { status: "paused" })}>{t("pause")}</button></>}
            {character.status === "pending" && <button className={`${buttonClass} ${styles.quietButton}`} disabled={busy} onClick={() => void act(`characters/${character._id}`, "PATCH", { status: "rejected" })}>{t("reject")}</button>}
          </div></td>
        </tr>)}</tbody></table></div>
        {!data?.characters.length && <p className={styles.empty}>{t("noCharacters")}</p>}
        <Pagination page={characterPage} total={data?.totalCharacters || 0} onChange={changeCharacterPage} disabled={busy} />
      </>}
    </section> : <section aria-label={t("discoveredGuilds")}>
      <div className={styles.adminGuildToolbar}>
        <label className={styles.adminSearch}>{t("admin.searchGuilds")}<input className={styles.input} type="search" maxLength={100} value={guildSearch} onChange={(event) => { setGuildSearch(event.target.value); setGuildPage(1); setGuildId(null); setRosterSearch(""); }} /></label>
        <label className={styles.adminFilter}>{t("status")}<select className={controlClass} value={guildFilter} onChange={(event) => { setGuildFilter(event.target.value); setGuildPage(1); setGuildId(null); }}>{["all", "pending", "approved", "paused"].map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}</select></label>
      </div>
      {overview.isPending ? <p role="status">{t("loading")}</p> : <div className={styles.adminGuildGrid}>
        <div><div className={styles.adminGuildList}>{data?.guilds.map((entry) => <button className={styles.adminGuildChoice} key={entry._id} aria-pressed={activeGuildId === entry._id} onClick={() => { setGuildId(entry._id); setRosterSearch(""); }}>
          <strong>{entry.name}</strong><span>{t(`statuses.${entry.status}`)} · {entry.lastFetchedAt ? t("rosterCount", { count: entry.rosterCount || 0 }) : t("admin.rosterNotLoaded")}</span><FetchState errorCode={entry.errorCode} /></button>)}</div>
          {!data?.guilds.length && <p className={styles.empty}>{t("admin.noGuildMatches")}</p>}
          <Pagination page={guildPage} total={data?.totalGuilds || 0} onChange={(page) => { setGuildPage(page); setGuildId(null); }} disabled={busy} />
        </div>
        {activeGuildId && <div className={styles.adminInspector} aria-busy={guild.isFetching}>
          {guild.isPending && <p role="status">{t("loading")}</p>}{guild.error && <ForeverErrorMessage error={guild.error} />}
          {activeGuild && <>
            <div className={styles.adminInspectorHeading}><div><h3>{activeGuild.name}</h3><span className={styles.adminStatus} data-status={activeGuild.status}>{t(`statuses.${activeGuild.status}`)}</span></div><a className={styles.adminLink} target="_blank" rel="noreferrer" href={`https://worldofwarcraft.blizzard.com/en-gb/forever/${activeGuild.region}/armory/guild/${encodeURIComponent(activeGuild.slug)}`}>{t("openArmory")}</a></div>
            <div className={styles.adminFacts}>
              <div><span>{t("admin.members")}</span><strong>{activeGuild.lastFetchedAt ? activeGuild.roster?.length || 0 : "—"}</strong></div>
              <div><span>{t("checked")}</span><ForeverUpdated value={activeGuild.lastFetchedAt} /></div>
              <div><span>{t("admin.lastAttempt")}</span><ForeverDate value={activeGuild.lastAttemptAt} /></div>
              <div><span>{t("nextCheck")}</span><ForeverDate value={activeGuild.status === "paused" ? undefined : activeGuild.nextFetchAt} /></div>
            </div>
            <FetchState errorCode={activeGuild.errorCode} failures={activeGuild.failures} />
            <div className={styles.adminInspectorActions}>
              {activeGuild.status !== "approved" ? <button className={buttonClass} disabled={busy} onClick={() => void act(`guilds/${activeGuild._id}`, "PATCH", { status: "approved" })}>{t("approveGuild")}</button> : <button className={buttonClass} disabled={busy} onClick={() => void act(`guilds/${activeGuild._id}`, "PATCH", { status: "paused" })}>{t("pauseGuild")}</button>}
              {activeGuild.status === "pending" && <button className={`${buttonClass} ${styles.quietButton}`} disabled={busy} onClick={() => void act(`guilds/${activeGuild._id}`, "PATCH", { status: "paused" })}>{t("pauseGuild")}</button>}
              <RetryButton lastAttemptAt={activeGuild.lastAttemptAt} disabled={busy || activeGuild.status === "paused"} onClick={() => void act(`guilds/${activeGuild._id}/refresh`, "POST")} />
            </div>
            <p className={styles.adminHelp}>{t("guildApprovalNote")}</p>
            {activeGuild.lastFetchedAt ? <>
              <label className={styles.adminSearch}>{t("admin.searchRoster")}<input className={styles.input} type="search" value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} /></label>
              <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t("previewRoster")}><table className={`${styles.table} ${styles.rosterTable}`}><thead><tr>{["character", "className", "level", "status"].map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead><tbody>
                {members.map((member) => <tr key={member.slug}><td><a className={styles.adminLink} style={{ color: classColor(member.className) }} href={`https://worldofwarcraft.blizzard.com/en-gb/forever/${member.region}/armory/character/${encodeURIComponent(member.slug)}`} target="_blank" rel="noreferrer">{member.name} ↗</a></td><td style={{ color: classColor(member.className) }}>{member.className}</td><td>{member.level}</td><td>{member.trackingStatus && member.trackingStatus !== "untracked" ? t(`statuses.${member.trackingStatus}`) : t("admin.untracked")}</td></tr>)}
              </tbody></table></div>{!members.length && <p className={styles.adminHelp}>{t("admin.noRosterMatches")}</p>}
            </> : <p className={styles.adminEmptyRoster}>{t(activeGuild.errorCode ? "admin.rosterUnavailable" : "awaitingRoster")}</p>}
          </>}
        </div>}
      </div>}
    </section>}
    <p className={styles.adminHelp}>{t("admin.retryHelp")}</p>
  </div>;
}
