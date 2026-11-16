"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import ForeverNav from "./ForeverNav";
import world from "./forever.module.css";
import styles from "./guilds.module.css";

export function GuildHeader({ name }: { name?: string }) {
  const t = useTranslations("forever");
  return <header className={styles.header}>
    <div className={world.heading}>
      <Link href="/forever" className={world.wordmark} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
      <h1 className={`${world.title} ${styles.title}`}>{name || t("guilds.title")}</h1>
    </div>
    <ForeverNav current="guilds" />
  </header>;
}

export const guildPageSize = 50;
export function GuildPagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const t = useTranslations("forever");
  if (total <= guildPageSize) return null;
  return <nav className={world.pagination} aria-label={t("guilds.pages")}>
    <button className={world.button} disabled={page === 1} onClick={() => onPage(page - 1)}>{t("previous")}</button>
    <span>{t("page", { page })}</span>
    <button className={world.button} disabled={page * guildPageSize >= total} onClick={() => onPage(page + 1)}>{t("next")}</button>
  </nav>;
}
