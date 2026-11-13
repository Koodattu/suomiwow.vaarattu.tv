"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import { foreverRace, ForeverBoard, formatForeverDate } from "@/lib/forever-api";
import { emptyForeverFilters as emptyFilters, foreverLevelingOptions } from "@/lib/forever-leveling-query";
import { getRankColor } from "@/lib/utils";
import { CharacterDetailsLoader } from "@/components/forever/ForeverCharacterDetails";
import ForeverPopulation, { ForeverBoardSummary } from "@/components/forever/ForeverPopulation";
import ForeverNav from "@/components/forever/ForeverNav";
import { CharacterForm, classColor, Faction, ForeverUpdated, ForeverErrorMessage, Portrait, StreamerLink } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

const filterFields = ["guild", "race", "className", "faction", "ruleset"] as const;
function subscribeNarrow(callback: () => void) {
  const media = window.matchMedia("(max-width: 1100px)");
  media.addEventListener("change", callback); return () => media.removeEventListener("change", callback);
}
export default function ForeverLeveling({ initialData, now }: { initialData?: ForeverBoard; now: string }) {
  const locale = useLocale();
  // Relative update ages and LIVE badges must start from the same server/client clock.
  return <NextIntlClientProvider locale={locale} now={new Date(now)} timeZone="Europe/Helsinki">
    <ForeverLevelingBoard initialData={initialData} />
  </NextIntlClientProvider>;
}

function ForeverLevelingBoard({ initialData }: { initialData?: ForeverBoard }) {
  const t = useTranslations("forever");
  const [filters, setFilters] = useState(emptyFilters), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.search), 180);
    return () => clearTimeout(timer);
  }, [filters.search]);
  const queryFilters = useMemo(() => ({ ...filters, search }), [filters, search]);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia("(max-width: 1100px)").matches, () => false);
  const isFirstPage = page === 1 && !Object.values(queryFilters).some(Boolean);
  const board = useQuery({ ...foreverLevelingOptions(queryFilters, page),
    enabled: search === filters.search,
    initialData: isFirstPage ? initialData : undefined,
    initialDataUpdatedAt: isFirstPage && initialData?.generatedAt ? Date.parse(initialData.generatedAt) : undefined,
    placeholderData: keepPreviousData });
  const data = board.data;
  useEffect(() => {
    if (!data || board.isPlaceholderData || search !== filters.search) return;
    if (page * data.pageSize < data.total) void queryClient.prefetchQuery(foreverLevelingOptions(queryFilters, page + 1));
    if (page > 1) void queryClient.prefetchQuery(foreverLevelingOptions(queryFilters, page - 1));
  }, [data, board.isPlaceholderData, search, filters.search, page, queryClient, queryFilters]);
  const showStreams = data?.characters.some((character) => character.twitchChannel) ?? false;
  const columnCount = showStreams ? 12 : 11;
  const selected = data?.characters.find((character) => character._id === selectedId);
  const toggle = (id: string) => setSelectedId((current) => current === id ? null : id);
  return <div className={`${styles.world} ${styles.levelingWorld}`}>
    <header className={`${styles.header} ${styles.levelingHeader}`}>
      <div className={styles.heading}>
        <Link href="/forever" className={styles.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <h1 className={styles.title}>{t("title")}</h1>
        <ForeverNav current="leveling" />
      </div>
      <ForeverPopulation statistics={data?.statistics} total={data?.total || 0} loading={board.isPending} />
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
          <label className={styles.filter}><span>{t("stream")}</span>
            <select className={styles.select} value={filters.twitch} onChange={(event) => { setFilters({ ...filters, twitch: event.target.value }); setPage(1); setSelectedId(null); }}>
              <option value="">{t("all")}</option>
              <option value="only">{t("twitchOnly")}</option>
            </select>
          </label>
        </div>
        <ForeverBoardSummary statistics={data?.statistics} total={data?.total} filtered={Object.values(filters).some(Boolean)} />
        <div className={styles.boardSearch}>
          <input className={styles.input} type="search" maxLength={100} aria-label={t("searchCharacters")} placeholder={t("searchCharacters")} value={filters.search} onChange={(event) => { setFilters({ ...filters, search: event.target.value }); setPage(1); setSelectedId(null); }} />
          {Object.values(filters).some(Boolean) && <button className={`${styles.button} ${styles.quietButton}`} onClick={() => { setFilters(emptyFilters); setPage(1); setSelectedId(null); }}>{t("clearFilters")}</button>}
        </div>
      </div>
      {board.error && <ForeverErrorMessage error={board.error} />}
      <div className={styles.tableScroll} role="region" aria-label={t("tableScroll")} tabIndex={0}>
        <table className={styles.table}>
          <thead><tr>
            <th scope="col" className={styles.rankCell}>{t("rank")}</th>
            <th scope="col" className={styles.characterCell}>{t("character")}</th><th scope="col" className={styles.levelCell}>{t("level")}</th>
            <th scope="col" className={styles.finishCell}><span className="sr-only">{t("finishTime")}</span></th>
            <th scope="col">{t("race")}</th><th scope="col">{t("className")}</th><th scope="col">{t("guild")}</th>
            <th scope="col">{t("faction")}</th><th scope="col">{t("ruleset")}</th><th scope="col">{t("checked")}</th>
            {showStreams && <th scope="col">{t("stream")}</th>}<th scope="col" className={styles.expandCell}><span className="sr-only">{t("actions")}</span></th>
          </tr></thead>
          <tbody>{board.isPending ? Array.from({ length: 6 }, (_, i) => <tr key={i} aria-hidden="true"><td colSpan={columnCount} className={styles.loading} /></tr>) : data?.characters.map((character) => {
            const finishAt = character.level === 60 && (character.estimatedLevel60At ?? character.lastLevelAt);
            const source = finishAt ? t(character.estimatedLevel60At ? "progress.legacyEstimate" : "progress.firstSeen60") : undefined;
            return <Fragment key={character._id}><tr className={styles.expandableRow} data-expanded={selectedId === character._id} onClick={(event) => {
            if ((event.target as HTMLElement).closest("a,button,input,select")) return;
            event.currentTarget.querySelector<HTMLButtonElement>("button[data-character-toggle]")?.focus(); toggle(character._id);
          }}>
            <td className={styles.rankCell} style={character.rank ? getRankColor(character.rank, data.totalRanked) : undefined}>{character.rank ?? "—"}</td>
            <td className={styles.characterCell}>
              <button data-character-toggle className={`${styles.identity} ${styles.characterToggle}`} aria-expanded={selectedId === character._id} aria-controls={`forever-details-${character._id}`} onClick={() => toggle(character._id)}>
                <Portrait character={character} /><span className={styles.name} style={{ color: classColor(character.className) }}>{character.name}</span>
              </button>
            </td>
            <td className={styles.levelCell}><span className={styles.level}>{character.level}</span></td>
            <td className={styles.finishCell}>
              {finishAt && <time dateTime={finishAt} title={source}><span className="sr-only">{source} </span>{formatForeverDate(finishAt, "stacked")}</time>}
            </td>
            <td className={styles.attribute}>{foreverRace(character.race)}</td>
            <td className={styles.attribute} style={{ color: classColor(character.className) }}>{character.className || "—"}</td>
            <td><span className={styles.guild}>{character.guild?.name ? `‹${character.guild.name}›` : "—"}</span></td>
            <td><Faction name={character.faction} /></td><td className={styles.attribute}>{character.ruleset || "—"}</td>
            <td><span className={styles.checked}><ForeverUpdated value={character.lastFetchedAt} /></span>{character.errorCode && <span className={styles.retry}>{t("retrying")}</span>}</td>
            {showStreams && <td className={styles.streamCell}><StreamerLink character={character} /></td>}
            <td className={styles.expandCell}><button className={styles.expandButton} aria-label={t("progress.characterDetails", { name: character.name || character.slug })} aria-expanded={selectedId === character._id} aria-controls={`forever-details-${character._id}`} onClick={() => toggle(character._id)}>{selectedId === character._id ? "−" : "+"}</button></td>
          </tr>{selectedId === character._id && !narrow && <tr className={styles.expandedRow}><td colSpan={columnCount}>
            <section className={styles.expandedPanel} id={`forever-details-${character._id}`} aria-label={t("progress.characterDetails", { name: character.name || character.slug })}>
              <button className={`${styles.button} ${styles.detailClose}`} onClick={() => { setSelectedId(null); document.querySelector<HTMLButtonElement>(`button[aria-controls="forever-details-${character._id}"]`)?.focus(); }} aria-label={t("close")}>× {t("close")}</button>
              <CharacterDetailsLoader identity={character.region === "eu" ? character.slug : character._id} />
            </section>
          </td></tr>}</Fragment>;
          })}</tbody>
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
