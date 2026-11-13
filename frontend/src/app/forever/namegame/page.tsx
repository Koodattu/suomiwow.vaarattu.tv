"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import ForeverNav from "@/components/forever/ForeverNav";
import { ForeverErrorMessage } from "@/components/forever/ForeverShared";
import { foreverApi } from "@/lib/forever-api";
import world from "@/components/forever/forever.module.css";
import styles from "./namegame.module.css";

interface NamegameBoard {
  names: { name: string; category: string; score: number }[];
  categories: string[]; total: number; page: number; pageSize: number;
}

export default function NamegamePage() {
  const t = useTranslations("forever");
  const [category, setCategory] = useState(""), [page, setPage] = useState(1);
  const board = useQuery({
    queryKey: ["forever", "namegame", category, page],
    queryFn: ({ signal }) => foreverApi<NamegameBoard>(`forever/namegame?page=${page}${category ? "&category=" + encodeURIComponent(category) : ""}`, "GET", undefined, signal),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const data = board.data;
  return <div className={world.world}><div className={world.shell}>
    <header className={styles.header}>
      <div className={world.heading}>
        <Link href="/forever" className={world.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <h1 className={world.title}>{t("namegame.title")}</h1>
      </div>
      <ForeverNav current="namegame" />
    </header>
    <div className={styles.controls}>
      <label className={world.filter}>{t("namegame.category")}
        <select className={world.select} value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}>
          <option value="">{t("namegame.all")}</option>
          {(data?.categories ?? (category ? [category] : [])).map(value => <option key={value} value={value}>{t(`namegame.categories.${value}`)}</option>)}
        </select>
      </label>
      {data && <span>{t("namegame.count", { count: data.total })}</span>}
    </div>
    {board.error && <div className={styles.error}><ForeverErrorMessage error={board.error} /><button className={world.button} onClick={() => void board.refetch()}>{t("progress.tryAgain")}</button></div>}
    {board.isPending && <p className={world.empty} role="status">{t("loading")}</p>}
    {data && <>
      {data.names.length ? <ol className={styles.grid} start={(page - 1) * data.pageSize + 1} aria-label={t("namegame.title")}>
        {data.names.map((entry, i) => <li key={i} className={styles.card}>
          <div><strong>{entry.name}</strong><span>{t(`namegame.categories.${entry.category}`)}</span></div>
          <b aria-label={t("namegame.points", { score: entry.score })}>{entry.score}</b>
        </li>)}
      </ol> : <p className={world.empty}>{t(category ? "namegame.emptyCategory" : "namegame.empty")}</p>}
      {(page > 1 || page * data.pageSize < data.total) && <nav className={styles.pages} aria-label={t("namegame.pages")}>
        <button className={world.button} disabled={page === 1} onClick={() => setPage(page - 1)}>{t("previous")}</button>
        <span>{t("page", { page })}</span>
        <button className={world.button} disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>{t("next")}</button>
      </nav>}
    </>}
  </div></div>;
}
