"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { foreverApi, ForeverBoard } from "@/lib/forever-api";
import { CharacterForm, classColor, Faction, ForeverUpdated, ForeverErrorMessage, Portrait, StreamerLink, UpdateStatus } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

const filterFields = ["race", "className", "faction", "ruleset"] as const;
export default function ForeverLeveling() {
  const t = useTranslations("forever");
  const [filters, setFilters] = useState({ race: "", className: "", faction: "", ruleset: "" }), [page, setPage] = useState(1);
  const board = useQuery({ queryKey: ["forever", "leveling", filters, page],
    queryFn: () => foreverApi<ForeverBoard>(`forever/leveling?${new URLSearchParams({ ...filters, page: String(page) })}`), refetchInterval: 60_000 });
  const data = board.data;
  const showStreams = data?.characters.some((character) => character.twitchChannel) ?? false;
  return <div className={styles.world}><div className={`${styles.shell} ${styles.levelingShell}`}>
    <header className={`${styles.header} ${styles.levelingHeader}`}>
      <div className={styles.heading}>
        <Link href="/forever" className={styles.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <div><h1 className={styles.title}>{t("title")}</h1>
          <div className={styles.headerMeta}>{data ? <><span><strong>{data.total}</strong> {t("charactersShort")}</span>{data.pending > 0 && <span>{t("waitingCount", { count: data.pending })}</span>}<UpdateStatus worker={data.worker} enabled={data.enabled} /></> : <span>{t("loading")}</span>}</div>
        </div>
      </div>
      <CharacterForm compact />
    </header>
    <section className={styles.board} aria-label={t("title")} aria-busy={board.isPending}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {filterFields.map((field) => <label className={styles.filter} key={field}><span>{t(field)}</span>
            <select className={styles.select} value={filters[field]} onChange={(event) => { setFilters({ ...filters, [field]: event.target.value }); setPage(1); }}>
              <option value="">{t("all")}</option>
              {Array.from(new Set([...(data?.filterOptions?.[field] || []), ...(filters[field] ? [filters[field]] : [])])).map((value) => <option key={value} value={value}>{field === "faction" && ["Horde", "Alliance"].includes(value) ? t(`factions.${value.toLowerCase()}`) : value}</option>)}
            </select>
          </label>)}
        </div>
        {Object.values(filters).some(Boolean) && <button className={`${styles.button} ${styles.quietButton}`} onClick={() => { setFilters({ race: "", className: "", faction: "", ruleset: "" }); setPage(1); }}>{t("clearFilters")}</button>}
      </div>
      {board.error && <ForeverErrorMessage error={board.error} />}
      <div className={styles.tableScroll} role="region" aria-label={t("tableScroll")} tabIndex={0}>
        <table className={styles.table}>
          <thead><tr>
            <th scope="col" className={styles.characterCell}>{t("character")}</th><th scope="col" className={styles.levelCell}>{t("level")}</th>
            <th scope="col">{t("race")}</th><th scope="col">{t("className")}</th><th scope="col">{t("guild")}</th>
            <th scope="col">{t("faction")}</th><th scope="col">{t("ruleset")}</th><th scope="col">{t("checked")}</th>
            {showStreams && <th scope="col">{t("stream")}</th>}
          </tr></thead>
          <tbody>{board.isPending ? Array.from({ length: 6 }, (_, i) => <tr key={i} aria-hidden="true"><td colSpan={showStreams ? 9 : 8} className={styles.loading} /></tr>) : data?.characters.map((character) => <tr key={character._id}>
            <td className={styles.characterCell}>
              <Link className={styles.identity} href={`/forever/characters/${character._id}`}><Portrait character={character} /><span className={styles.name} style={{ color: classColor(character.className) }}>{character.name}</span></Link>
            </td>
            <td className={styles.levelCell}><span className={styles.level}>{character.level}</span></td>
            <td className={styles.attribute}>{character.race || "—"}</td>
            <td className={styles.attribute} style={{ color: classColor(character.className) }}>{character.className || "—"}</td>
            <td><span className={styles.guild}>{character.guild?.name ? `‹${character.guild.name}›` : "—"}</span></td>
            <td><Faction name={character.faction} /></td><td className={styles.attribute}>{character.ruleset || "—"}</td>
            <td><span className={styles.checked}><ForeverUpdated value={character.lastFetchedAt} /></span>{character.errorCode && <span className={styles.retry}>{t("retrying")}</span>}</td>
            {showStreams && <td className={styles.streamCell}><StreamerLink character={character} /></td>}
          </tr>)}</tbody>
        </table>
      </div>
      {data?.characters.length === 0 && <div className={styles.empty}><h2>{t(Object.values(filters).some(Boolean) ? "noMatches" : "emptyTitle")}</h2>{!Object.values(filters).some(Boolean) && <p>{t("emptyDescription")}</p>}</div>}
      <footer className={styles.boardFoot}>
        <span>{t("rankingShort")}</span>
        {data && data.total > data.pageSize && <nav className={styles.pagination} aria-label={t("pagination")}><button className={styles.button} disabled={page === 1} onClick={() => setPage(page - 1)} aria-label={t("previous")}>←</button><span>{t("page", { page })}</span><button className={styles.button} disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)} aria-label={t("next")}>→</button></nav>}
      </footer>
    </section>
  </div></div>;
}
