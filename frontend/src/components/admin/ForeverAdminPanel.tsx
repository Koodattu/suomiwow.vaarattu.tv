"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { foreverApi, ForeverAdminData, ForeverGuild } from "@/lib/forever-api";
import { buttonClass, CharacterForm, classColor, controlClass, ForeverDate, ForeverErrorMessage, Portrait, WorkerStatus } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

export default function ForeverAdminPanel() {
  const t = useTranslations("forever"), client = useQueryClient();
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [guildId, setGuildId] = useState<string | null>(null), [filter, setFilter] = useState("pending");
  const [characterPage, setCharacterPage] = useState(1), [guildPage, setGuildPage] = useState(1);
  const overview = useQuery({ queryKey: ["forever", "admin", filter, characterPage, guildPage], queryFn: () => foreverApi<ForeverAdminData>(`admin/forever?${new URLSearchParams({ status: filter, characterPage: String(characterPage), guildPage: String(guildPage) })}`), refetchInterval: 30_000 });
  const guild = useQuery({ queryKey: ["forever", "admin", "guild", guildId], queryFn: () => foreverApi<ForeverGuild>(`admin/forever/guilds/${guildId}`), enabled: !!guildId, refetchInterval: 30_000 });
  const refresh = () => void client.invalidateQueries({ queryKey: ["forever"] });
  async function act(path: string, method: string, body?: unknown) {
    setError(null); setBusy(true);
    try { await foreverApi(`admin/forever/${path}`, method, body); await client.invalidateQueries({ queryKey: ["forever"] }); }
    catch (caught) { setError(caught); } finally { setBusy(false); }
  }
  const data = overview.data;
  return <div className="space-y-6">
    <div className={styles.adminTop}>
    <header className="space-y-3"><h2 className={styles.title}>{t("adminTitle")}</h2><Link className={buttonClass} href="/forever/leveling">{t("viewLeaderboard")}</Link></header>
    <CharacterForm admin onAdded={refresh} />
    </div>
    {(error != null || overview.error) && <ForeverErrorMessage error={error || overview.error} />}
    {overview.isPending && <p role="status">{t("loading")}</p>}
    {data && <>
      <WorkerStatus worker={data.worker} enabled={data.enabled} />
      <div className={styles.adminGrid}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold text-white">{t("characters")}</h3><label className="text-sm text-slate-400">{t("status")} <select className={controlClass} value={filter} onChange={(event) => { setFilter(event.target.value); setCharacterPage(1); }}>{["pending", "tracked", "paused", "rejected", "all"].map((status) => <option value={status} key={status}>{t(`statuses.${status}`)}</option>)}</select></label></div>
        <div className="overflow-x-auto rounded-xl border border-slate-700"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-slate-400"><tr>{["character", "status", "checked", "actions"].map((key) => <th key={key} scope="col" className="px-4 py-3">{t(key)}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-800">{data.characters.filter((character) => filter === "all" || character.status === filter).map((character) => <tr key={character._id}>
            <td className="px-4 py-3"><div className={styles.identity}><Portrait character={character} /><div><span className="font-medium" style={{ color: classColor(character.className) }}>{character.name || character.slug}</span><p className="text-xs text-slate-400">{character.region.toUpperCase()}{character.level ? ` · ${t("levelValue", { level: character.level })}` : ""}</p><a className="text-xs text-amber-300 hover:underline" target="_blank" rel="noreferrer" href={`https://worldofwarcraft.blizzard.com/en-gb/forever/${character.region}/armory/character/${encodeURIComponent(character.slug)}`}>{t("openArmory")}</a></div></div></td>
            <td className="px-4 py-3 text-slate-300">{t(`statuses.${character.status}`)}{character.errorCode && <p className="mt-1 text-xs text-amber-200">{t("retrying")} · {character.errorCode}</p>}</td>
            <td className="px-4 py-3 text-xs text-slate-400"><ForeverDate value={character.lastFetchedAt} /><p className="mt-1">{t("nextCheck")}: <ForeverDate value={character.nextFetchAt} /></p></td>
            <td className="px-4 py-3"><div className="flex flex-wrap gap-2">
              {character.status !== "tracked" && <button className={buttonClass} disabled={busy} onClick={() => void act(`characters/${character._id}`, "PATCH", { status: "tracked" })}>{t("approveCharacter")}</button>}
              {character.status === "tracked" && <><button className={buttonClass} disabled={busy} onClick={() => void act(`characters/${character._id}`, "PATCH", { status: "paused" })}>{t("pause")}</button><button className={buttonClass} disabled={busy} onClick={() => void act(`characters/${character._id}/refresh`, "POST")}>{t("refresh")}</button></>}
              {character.status === "pending" && <button className={buttonClass} disabled={busy} onClick={() => void act(`characters/${character._id}`, "PATCH", { status: "rejected" })}>{t("reject")}</button>}
            </div></td>
          </tr>)}</tbody></table></div>
        {!data.characters.some((character) => filter === "all" || character.status === filter) && <p className="py-4 text-center text-slate-400">{t("noCharacters")}</p>}
        <div className="flex items-center justify-between"><button className={buttonClass} disabled={characterPage === 1} onClick={() => setCharacterPage(characterPage - 1)}>{t("previous")}</button><span className="text-sm text-slate-400">{t("page", { page: characterPage })}</span><button className={buttonClass} disabled={characterPage * 50 >= data.totalCharacters} onClick={() => setCharacterPage(characterPage + 1)}>{t("next")}</button></div>
      </section>
      <section className="space-y-4"><h3 className="text-xl font-semibold text-white">{t("discoveredGuilds")}</h3><p className="text-sm text-slate-400">{t("guildApprovalNote")}</p>
        {!data.guilds.length && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">{t("noGuilds")}</p>}
        <div className="grid gap-3">{data.guilds.map((entry) => <div key={entry._id} className="rounded border border-stone-700 bg-stone-900/30 p-4">
          <h4 className="font-semibold text-white">{entry.name} <span className="text-xs text-slate-400">{entry.region.toUpperCase()}</span></h4><p className="mt-1 text-sm text-slate-400">{t(`statuses.${entry.status}`)} · <ForeverDate value={entry.lastFetchedAt} /></p>
          {entry.errorCode && <p className="mt-1 text-sm text-amber-200">{t("retrying")} · {entry.errorCode}</p>}
          <div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} onClick={() => setGuildId(entry._id)}>{t("previewRoster")}</button>{entry.status !== "approved" ? <button className={buttonClass} disabled={busy} onClick={() => void act(`guilds/${entry._id}`, "PATCH", { status: "approved" })}>{t("approveGuild")}</button> : <button className={buttonClass} disabled={busy} onClick={() => void act(`guilds/${entry._id}`, "PATCH", { status: "paused" })}>{t("pauseGuild")}</button>}<button className={buttonClass} disabled={busy || entry.status === "paused"} onClick={() => void act(`guilds/${entry._id}/refresh`, "POST")}>{t("refresh")}</button></div>
        </div>)}</div>
        <div className="flex items-center justify-between"><button className={buttonClass} disabled={guildPage === 1} onClick={() => setGuildPage(guildPage - 1)}>{t("previous")}</button><span className="text-sm text-slate-400">{t("page", { page: guildPage })}</span><button className={buttonClass} disabled={guildPage * 50 >= data.totalGuilds} onClick={() => setGuildPage(guildPage + 1)}>{t("next")}</button></div>
        {guildId && <div className="rounded-xl border border-amber-700/60 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between gap-3"><h4 className="text-lg font-semibold text-white">{guild.data?.name || t("previewRoster")}</h4><button className={buttonClass} onClick={() => setGuildId(null)}>{t("close")}</button></div>
          {guild.isPending && <p role="status">{t("loading")}</p>}{guild.error && <ForeverErrorMessage error={guild.error} />}
          {guild.data && <><p className="mt-2 text-sm text-slate-400">{t("rosterCount", { count: guild.data.roster?.length || 0 })} · <ForeverDate value={guild.data.lastFetchedAt} /></p><ul className="mt-4 grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2">{guild.data.roster?.map((member) => <li key={member.slug} className="flex justify-between gap-3 border-b border-slate-800 py-2 text-sm"><span>{member.name}<span className="block text-xs text-slate-400">{member.className}</span></span><span className="text-amber-200">{member.level}</span></li>)}</ul>{!guild.data.lastFetchedAt && <p className="mt-3 text-slate-400">{t("awaitingRoster")}</p>}</>}
        </div>}
      </section>
      </div>
    </>}
  </div>;
}
