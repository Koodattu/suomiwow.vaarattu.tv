"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { foreverApi, ForeverBoard } from "@/lib/forever-api";
import { CharacterForm, classColor, Faction, ForeverDate, ForeverErrorMessage, Portrait, UpdateStatus } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

export default function ForeverLeveling() {
  const t = useTranslations("forever");
  const [region, setRegion] = useState("eu"), [ruleset, setRuleset] = useState(""), [page, setPage] = useState(1);
  const board = useQuery({ queryKey: ["forever", "leveling", region, ruleset, page],
    queryFn: () => foreverApi<ForeverBoard>(`forever/leveling?${new URLSearchParams({ region, ruleset, page: String(page) })}`), refetchInterval: 60_000 });
  const data = board.data;
  return <div className={styles.world}><div className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <Link href="/forever" className={styles.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <div><h1 className={styles.title}>{t("title")}</h1>
          <div className={styles.headerMeta}>{data ? <><span><strong>{data.total}</strong> {t("charactersShort")}</span>{data.pending > 0 && <span>{t("waitingCount", { count: data.pending })}</span>}</> : <span>{t("loading")}</span>}</div>
        </div>
      </div>
      {data && <UpdateStatus worker={data.worker} enabled={data.enabled} />}
    </header>
    <div className={styles.columns}>
      <section className={styles.board} aria-label={t("title")} aria-busy={board.isPending}>
        <div className={styles.toolbar}>
          <div className={styles.filters}>
            <label className={styles.filter}><span>{t("region")}</span><select className={styles.select} value={region} onChange={(event) => { setRegion(event.target.value); setPage(1); }}><option value="eu">{t("eu")}</option><option value="us">{t("us")}</option></select></label>
            <label className={styles.filter}><span>{t("ruleset")}</span><select className={styles.select} value={ruleset} onChange={(event) => { setRuleset(event.target.value); setPage(1); }}><option value="">{t("allRulesets")}</option>{data?.rulesets.map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
        </div>
        {board.error && <ForeverErrorMessage error={board.error} />}
        <table className={styles.table}>
          <thead><tr>
            <th scope="col" className={styles.characterCell}>{t("character")}</th><th scope="col" className={styles.guildColumn}>{t("guild")}</th>
            <th scope="col" className={styles.rulesetColumn}>{t("ruleset")}</th><th scope="col" className={styles.levelCell}>{t("level")}</th><th scope="col" className={styles.checkedColumn}>{t("checked")}</th>
          </tr></thead>
          <tbody>{board.isPending ? Array.from({ length: 6 }, (_, i) => <tr key={i} aria-hidden="true"><td colSpan={5} className={styles.loading} /></tr>) : data?.characters.map((character) => <tr key={character._id}>
            <td className={styles.characterCell}>
              <Link className={styles.identity} href={`/forever/characters/${character._id}`}>
                <Portrait character={character} />
                <span className={styles.identityText}><span className={styles.name} style={{ color: classColor(character.className) }}>{character.name}</span>
                  <span className={styles.raceClass}>{character.race} {character.className}</span>
                  <span className={styles.mobileMeta}>{character.guild?.name ? `‹${character.guild.name}› · ` : ""}{character.ruleset}</span>
                  {character.errorCode && <span className={`${styles.mobileMeta} ${styles.retry}`}>{t("retrying")}</span>}
                </span>
              </Link>
            </td>
            <td className={styles.guildColumn}><span className={styles.guild}>{character.guild?.name ? `‹${character.guild.name}›` : "—"}</span></td>
            <td className={styles.rulesetColumn}><span className={styles.mode}>{character.ruleset}</span><Faction name={character.faction} /></td>
            <td className={styles.levelCell}><span className={styles.level}>{character.level}</span><span className={styles.cap}>/ 60</span></td>
            <td className={styles.checkedColumn}><span className={styles.checked}><ForeverDate value={character.lastFetchedAt} compact /></span>{character.errorCode && <span className={styles.retry}>{t("retrying")}</span>}</td>
          </tr>)}</tbody>
        </table>
        {data?.characters.length === 0 && <div className={styles.empty}><h2>{t("emptyTitle")}</h2><p>{t("emptyDescription")}</p></div>}
        <footer className={styles.boardFoot}>
          <span>{t("rankingShort")}</span>
          {data && data.total > data.pageSize && <nav className={styles.pagination} aria-label={t("pagination")}><button className={styles.button} disabled={page === 1} onClick={() => setPage(page - 1)} aria-label={t("previous")}>←</button><span>{t("page", { page })}</span><button className={styles.button} disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)} aria-label={t("next")}>→</button></nav>}
        </footer>
      </section>
      <aside className={styles.aside}>
        <CharacterForm />
        <details className={styles.asideNote}><summary>{t("aboutTracking")}</summary><p>{t("trackingNote")}</p></details>
      </aside>
    </div>
  </div></div>;
}
