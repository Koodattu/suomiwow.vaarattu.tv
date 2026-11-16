"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import ForeverNav from "@/components/forever/ForeverNav";
import { ForeverErrorMessage } from "@/components/forever/ForeverShared";
import { namegameOptions, namegameOverviewOptions } from "@/lib/forever-namegame-query";
import world from "@/components/forever/forever.module.css";
import styles from "./namegame.module.css";

function NamegameOverview() {
  const t = useTranslations("forever"), client = useQueryClient();
  const overview = useQuery(namegameOverviewOptions()), data = overview.data;
  return <>
    <div className={styles.summary}><span role="status">{data ? t("namegame.count", { count: data.total }) : overview.isPending ? t("loading") : ""}</span><span>{t("namegame.scoring")}</span></div>
    {overview.error && <div className={styles.error}><ForeverErrorMessage error={overview.error} /><button className={world.button} onClick={() => void overview.refetch()}>{t("progress.tryAgain")}</button></div>}
    {overview.isPending && <div className={styles.boards} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <div key={i} className={styles.previewSkeleton} />)}</div>}
    {data && (data.total ? <div className={styles.boards}>
      {data.boards.map(board => {
        const title = t(board.category ? `namegame.categories.${board.category}` : "namegame.overall");
        const href = board.category ? `/forever/namegame?category=${board.category}` : "/forever/namegame?view=all";
        const prefetch = () => void client.prefetchQuery(namegameOptions({ category: board.category, search: "", sort: "score-desc" }, 1));
        return <section key={board.category} className={styles.preview} aria-label={title}>
          <header className={styles.previewHeader}><h2>{title}</h2><span>{t("namegame.count", { count: board.total })}</span></header>
          {board.names.length ? <ol aria-label={title}>{board.names.map(entry => <li key={entry.rank} className={styles.row}>
            <span className={styles.rank} aria-label={t("namegame.rank", { rank: entry.rank })}>{entry.rank}</span>
            <div className={styles.identity}><strong>{entry.name}</strong></div>
            <b className={styles.score} aria-label={t("namegame.points", { score: entry.score })}>{entry.score}</b>
          </li>)}</ol> : <p className={styles.previewEmpty}>{t("namegame.emptyCategory")}</p>}
          <Link className={`${world.button} ${world.quietButton} ${styles.viewAll}`} href={href} onMouseEnter={prefetch} onFocus={prefetch} aria-label={t("namegame.viewCategory", { category: title })}>{t("namegame.viewAll")} <span aria-hidden="true">→</span></Link>
        </section>;
      })}
    </div> : <p className={world.empty}>{t("namegame.empty")}</p>)}
  </>;
}

function NamegameBoard() {
  const t = useTranslations("forever"), params = useSearchParams(), client = useQueryClient();
  const category = params.get("category") || "", search = params.get("search") || "", sort = params.get("sort") || "score-desc";
  const pageParam = params.get("page") || "1", page = /^[1-9]\d{0,6}$/.test(pageParam) ? Number(pageParam) : 1;
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const filters = useMemo(() => ({ category, search: debouncedSearch, sort }), [category, debouncedSearch, sort]);
  const board = useQuery({ ...namegameOptions(filters, page), enabled: search === debouncedSearch, placeholderData: keepPreviousData });
  const data = board.data, updating = board.isFetching || search !== debouncedSearch;
  const currentPage = data?.page || page, pageCount = Math.ceil((data?.total || 0) / (data?.pageSize || 48));
  const pageNumbers = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])].filter(value => value > 0 && value <= pageCount).sort((a, b) => a - b);
  useEffect(() => {
    if (data && !board.isPlaceholderData && search === debouncedSearch && data.page * data.pageSize < data.total) {
      void client.prefetchQuery(namegameOptions(filters, data.page + 1));
    }
  }, [data, board.isPlaceholderData, search, debouncedSearch, client, filters]);
  function updateQuery(values: Record<string, string>, push = false) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (!value || (key === "page" && value === "1") || (key === "sort" && value === "score-desc")) next.delete(key);
      else next.set(key, value);
    }
    if (!next.has("category")) next.set("view", "all");
    window.history[push ? "pushState" : "replaceState"](null, "", `${window.location.pathname}${next.size ? `?${next}` : ""}`);
  }
  function changePage(value: number) {
    updateQuery({ page: String(value) }, true);
    results.current?.scrollIntoView({ block: "start" });
    results.current?.focus({ preventScroll: true });
  }
  const reset = () => updateQuery({ search: "", sort: "score-desc", page: "1" });
  const title = t(category ? `namegame.categories.${category}` : "namegame.overall");
  return <>
    <div className={styles.boardHeading}><Link href="/forever/namegame" className={styles.backLink}>← {t("namegame.leaderboards")}</Link><h2>{title}</h2></div>
    <div className={styles.controls}>
      <label className={`${world.filter} ${styles.search}`}><span>{t("namegame.search")}</span>
        <input className={world.input} type="search" maxLength={100} value={search} placeholder={t("namegame.searchPlaceholder")} onChange={event => updateQuery({ search: event.target.value, page: "1" })} />
      </label>
      <label className={world.filter}>{t("namegame.sort")}
        <select className={world.select} value={sort} onChange={event => updateQuery({ sort: event.target.value, page: "1" }, true)}>
          {["score-desc", "score-asc", "name"].map(value => <option key={value} value={value}>{t(`namegame.sorts.${value}`)}</option>)}
        </select>
      </label>
      {(search || sort !== "score-desc") && <button className={`${world.button} ${world.quietButton}`} onClick={reset}>{t("clearFilters")}</button>}
    </div>
    <div ref={results} tabIndex={-1} className={styles.results}>
      <div className={styles.summary}>
        <span role="status" aria-live="polite">{updating ? t("loading") : data ? t("namegame.range", { start: data.total ? (data.page - 1) * data.pageSize + 1 : 0, end: Math.min(data.page * data.pageSize, data.total), count: data.total }) : ""}</span>
        <span>{t("namegame.scoring")}</span>
      </div>
      {board.error && <div className={styles.error}><ForeverErrorMessage error={board.error} /><button className={world.button} onClick={() => void board.refetch()}>{t("progress.tryAgain")}</button></div>}
      {board.isPending && <div className={styles.grid} aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <div key={i} className={styles.skeleton} />)}</div>}
      {data && <div aria-busy={updating}>
        {data.names.length ? <ol className={styles.grid} aria-label={t("namegame.title")}>
          {data.names.map(entry => <li key={entry.rank} className={styles.row}>
            <span className={styles.rank} aria-label={t("namegame.rank", { rank: entry.rank })}>{entry.rank}</span>
            <div className={styles.identity}><strong>{entry.name}</strong></div>
            <b className={styles.score} aria-label={t("namegame.points", { score: entry.score })}>{entry.score}</b>
          </li>)}
        </ol> : <div className={styles.empty}><p>{t(search ? "namegame.noMatches" : category ? "namegame.emptyCategory" : "namegame.empty")}</p>{search && <button className={world.button} onClick={reset}>{t("clearFilters")}</button>}</div>}
        {pageCount > 1 && <nav className={styles.pages} aria-label={t("namegame.pages")}>
          <button className={world.button} disabled={currentPage === 1 || board.isPlaceholderData || search !== debouncedSearch} onClick={() => changePage(currentPage - 1)} aria-label={t("previous")}>←</button>
          {pageNumbers.map((value, index) => <Fragment key={value}>
            {index > 0 && value - pageNumbers[index - 1] > 1 && <span aria-hidden="true">…</span>}
            <button className={`${world.button} ${styles.pageButton}`} aria-label={t("page", { page: value })} aria-current={currentPage === value ? "page" : undefined} disabled={board.isPlaceholderData || search !== debouncedSearch} onClick={() => changePage(value)}>{value}</button>
          </Fragment>)}
          <button className={world.button} disabled={currentPage >= pageCount || board.isPlaceholderData || search !== debouncedSearch} onClick={() => changePage(currentPage + 1)} aria-label={t("next")}>→</button>
        </nav>}
      </div>}
    </div>
  </>;
}

function NamegameView() {
  const params = useSearchParams();
  const expanded = params.get("view") === "all" || ["category", "search", "sort", "page"].some(key => params.has(key));
  return expanded ? <NamegameBoard /> : <NamegameOverview />;
}

export default function NamegamePage() {
  const t = useTranslations("forever");
  return <div className={world.world}><div className={world.shell}>
    <header className={styles.header}>
      <div className={world.heading}>
        <Link href="/forever" className={world.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <h1 className={world.title}>{t("namegame.title")}</h1>
      </div>
      <ForeverNav current="namegame" />
    </header>
    <Suspense fallback={<p className={world.empty} role="status">{t("loading")}</p>}><NamegameView /></Suspense>
  </div></div>;
}
