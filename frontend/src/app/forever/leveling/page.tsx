"use client";

import Link from "next/link";
import { Fragment, useState, useSyncExternalStore } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { foreverApi, foreverRace, ForeverBoard } from "@/lib/forever-api";
import { CharacterDetailsLoader } from "@/components/forever/ForeverCharacterDetails";
import ForeverPopulation from "@/components/forever/ForeverPopulation";
import { CharacterForm, classColor, Faction, ForeverUpdated, ForeverErrorMessage, Portrait, StreamerLink } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

const filterFields = ["guild", "race", "className", "faction", "ruleset"] as const;
const emptyFilters = { guild: "", race: "", className: "", faction: "", ruleset: "", search: "" };
function subscribeNarrow(callback: () => void) {
  const media = window.matchMedia("(max-width: 1100px)");
  media.addEventListener("change", callback); return () => media.removeEventListener("change", callback);
}
export default function ForeverLeveling() {
  const t = useTranslations("forever");
  const [filters, setFilters] = useState(emptyFilters), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState<string | null>(null);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia("(max-width: 1100px)").matches, () => false);
  const board = useQuery({ queryKey: ["forever", "leveling", filters, page],
    queryFn: () => foreverApi<ForeverBoard>(`forever/leveling?${new URLSearchParams({ ...filters, page: String(page) })}`), placeholderData: (previous) => previous, refetchInterval: 60_000 });
  const data = board.data;
  const showStreams = data?.characters.some((character) => character.twitchChannel) ?? false;
  const selected = data?.characters.find((character) => character._id === selectedId);
  const toggle = (id: string) => setSelectedId((current) => current === id ? null : id);
  return <div className={`${styles.world} ${styles.levelingWorld}`}>
    <header className={`${styles.header} ${styles.levelingHeader}`}>
      <div className={styles.heading}>
        <Link href="/forever" className={styles.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <div><h1 className={styles.title}>{t("title")}</h1>
          <div className={styles.headerMeta}>{data ? <span><strong>{data.total}</strong> {t("charactersShort")}</span> : <span>{t("loading")}</span>}</div>
        </div>
      </div>
      <ForeverPopulation statistics={data?.statistics} total={data?.total || 0} filtered={Object.values(filters).some(Boolean)} loading={board.isPending} />
      <CharacterForm compact />
    </header>
    <div className={`${styles.shell} ${styles.levelingShell}`}>
    <section className={styles.board} aria-label={t("title")} aria-busy={board.isFetching}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {filterFields.map((field) => <label className={styles.filter} key={field}><span>{t(field)}</span>
            <select className={styles.select} value={filters[field]} onChange={(event) => { setFilters({ ...filters, [field]: event.target.value }); setPage(1); setSelectedId(null); }}>
              <option value="">{t("all")}</option>
              {Array.from(new Set([...(data?.filterOptions?.[field] || []), ...(filters[field] ? [filters[field]] : [])])).map((value) => <option key={value} value={value}>{field === "faction" && ["Horde", "Alliance"].includes(value) ? t(`factions.${value.toLowerCase()}`) : value}</option>)}
            </select>
          </label>)}
        </div>
        <div className={styles.boardSearch}>
          <input className={styles.input} type="search" maxLength={100} aria-label={t("searchCharacters")} placeholder={t("searchCharacters")} value={filters.search} onChange={(event) => { setFilters({ ...filters, search: event.target.value }); setPage(1); setSelectedId(null); }} />
          {Object.values(filters).some(Boolean) && <button className={`${styles.button} ${styles.quietButton}`} onClick={() => { setFilters(emptyFilters); setPage(1); setSelectedId(null); }}>{t("clearFilters")}</button>}
        </div>
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
          <tbody>{board.isPending ? Array.from({ length: 6 }, (_, i) => <tr key={i} aria-hidden="true"><td colSpan={showStreams ? 9 : 8} className={styles.loading} /></tr>) : data?.characters.map((character) => <Fragment key={character._id}><tr className={styles.expandableRow} data-expanded={selectedId === character._id} onClick={(event) => {
            if ((event.target as HTMLElement).closest("a,button,input,select")) return;
            event.currentTarget.querySelector<HTMLButtonElement>("button[data-character-toggle]")?.focus(); toggle(character._id);
          }}>
            <td className={styles.characterCell}>
              <button data-character-toggle className={`${styles.identity} ${styles.characterToggle}`} aria-expanded={selectedId === character._id} aria-controls={`forever-details-${character._id}`} onClick={() => toggle(character._id)}>
                <Portrait character={character} /><span className={styles.name} style={{ color: classColor(character.className) }}>{character.name}</span><span className={styles.expandChevron} aria-hidden="true">{selectedId === character._id ? "−" : "+"}</span>
              </button>
            </td>
            <td className={styles.levelCell}><span className={styles.level}>{character.level}</span></td>
            <td className={styles.attribute}>{foreverRace(character.race)}</td>
            <td className={styles.attribute} style={{ color: classColor(character.className) }}>{character.className || "—"}</td>
            <td><span className={styles.guild}>{character.guild?.name ? `‹${character.guild.name}›` : "—"}</span></td>
            <td><Faction name={character.faction} /></td><td className={styles.attribute}>{character.ruleset || "—"}</td>
            <td><span className={styles.checked}><ForeverUpdated value={character.lastFetchedAt} /></span>{character.errorCode && <span className={styles.retry}>{t("retrying")}</span>}</td>
            {showStreams && <td className={styles.streamCell}><StreamerLink character={character} /></td>}
          </tr>{selectedId === character._id && !narrow && <tr className={styles.expandedRow}><td colSpan={showStreams ? 9 : 8}>
            <section className={styles.expandedPanel} id={`forever-details-${character._id}`} aria-label={t("progress.characterDetails", { name: character.name || character.slug })}>
              <button className={`${styles.button} ${styles.detailClose}`} onClick={() => { setSelectedId(null); document.querySelector<HTMLButtonElement>(`button[aria-controls="forever-details-${character._id}"]`)?.focus(); }} aria-label={t("close")}>× {t("close")}</button>
              <CharacterDetailsLoader identity={character.region === "eu" ? character.slug : character._id} />
            </section>
          </td></tr>}</Fragment>)}</tbody>
        </table>
      </div>
      {data?.characters.length === 0 && <div className={styles.empty}><h2>{t(Object.values(filters).some(Boolean) ? "noMatches" : "emptyTitle")}</h2>{!Object.values(filters).some(Boolean) && <p>{t("emptyDescription")}</p>}</div>}
      <footer className={styles.boardFoot}>
        <span>{t("rankingShort")}</span>
        {data && data.total > data.pageSize && <nav className={styles.pagination} aria-label={t("pagination")}><button className={styles.button} disabled={page === 1} onClick={() => { setPage(page - 1); setSelectedId(null); }} aria-label={t("previous")}>←</button><span>{t("page", { page })}</span><button className={styles.button} disabled={page * data.pageSize >= data.total} onClick={() => { setPage(page + 1); setSelectedId(null); }} aria-label={t("next")}>→</button></nav>}
      </footer>
    </section>
    {narrow && selected && <Dialog open onClose={() => setSelectedId(null)} className={styles.progressDialog}>
      <DialogBackdrop className={styles.progressBackdrop} />
      <div className={styles.progressDialogPosition}><DialogPanel id={`forever-details-${selected._id}`} className={styles.progressDialogPanel}>
        <div className={styles.progressDialogHeading}><div className={styles.identity}><Portrait character={selected} /><DialogTitle style={{ color: classColor(selected.className) }}>{selected.name || selected.slug}</DialogTitle></div><button data-autofocus className={styles.button} onClick={() => setSelectedId(null)} aria-label={t("close")}>× {t("close")}</button></div>
        <CharacterDetailsLoader identity={selected.region === "eu" ? selected.slug : selected._id} />
      </DialogPanel></div>
    </Dialog>}
  </div></div>;
}
