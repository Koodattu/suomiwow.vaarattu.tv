"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { guildDirectoryQuery, readGuildDirectoryQuery } from "@/lib/forever-guilds";
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
export function GuildDirectoryBackLink({ id }: { id: string }) {
  const t = useTranslations("forever"), params = useSearchParams();
  const href = `/forever/guilds${guildDirectoryQuery(readGuildDirectoryQuery(params))}#guild-${encodeURIComponent(id)}`;
  return <Link className={world.backToBoard} href={href}>← {t("guilds.back")}</Link>;
}

export function GuildPagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const t = useTranslations("forever");
  if (total <= guildPageSize) return null;
  return <nav className={`${world.pagination} ${styles.pagination}`} aria-label={t("guilds.pages")}>
    <button className={world.button} disabled={page === 1} onClick={() => onPage(page - 1)}>{t("previous")}</button>
    <span>{t("guilds.pageOf", { page, total: Math.ceil(total / guildPageSize) })}</span>
    <button className={world.button} disabled={page * guildPageSize >= total} onClick={() => onPage(page + 1)}>{t("next")}</button>
  </nav>;
}
