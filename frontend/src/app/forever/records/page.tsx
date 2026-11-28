"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import ForeverHeader from "@/components/forever/ForeverHeader";
import { classColor, ForeverErrorMessage, Portrait } from "@/components/forever/ForeverShared";
import { foreverApi, foreverCharacterPath, foreverRecordBoards, type ForeverRecordBoard, type ForeverRecordsPage } from "@/lib/forever-api";
import world from "@/components/forever/forever.module.css";
import guildStyles from "@/components/forever/guilds.module.css";
import styles from "@/components/forever/boards.module.css";

const filterKeys = ["className", "guild", "ruleset", "faction"] as const;

function RecordsBoard() {
  const t = useTranslations("forever"), format = useFormatter();
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const requested = params.get("board") as ForeverRecordBoard | null;
  const board: ForeverRecordBoard = requested && foreverRecordBoards.includes(requested) ? requested : "itemLevel";
  const filters = Object.fromEntries(filterKeys.map(key => [key, params.get(key) || ""])) as Record<typeof filterKeys[number], string>;
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const search = new URLSearchParams({ board, page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
  const query = useQuery({
    queryKey: ["forever", "records", search.toString()],
    queryFn: ({ signal }) => foreverApi<ForeverRecordsPage>(`forever/records?${search}`, "GET", undefined, signal),
    staleTime: 30_000, placeholderData: keepPreviousData,
  });
  const href = (values: Record<string, string | number>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) { if (value === "" || value === 1 && key === "page") next.delete(key); else next.set(key, String(value)); }
    const text = next.toString();
    return text ? `${pathname}?${text}` : pathname;
  };
  const update = (values: Record<string, string | number>) => router.replace(href({ page: 1, ...values }), { scroll: false });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const value = (amount: number) => board === "itemLevel" ? format.number(amount, { maximumFractionDigits: 1 }) : format.number(amount);
  return <>
    <nav className={styles.tabs} aria-label={t("records.board")}>{foreverRecordBoards.map(key =>
      <Link key={key} href={href({ board: key, page: 1 })} scroll={false} aria-current={key === board ? "page" : undefined}>{t(`records.boards.${key}`)}</Link>)}
    </nav>
    {board === "itemLevel" && <p className={styles.intro}><small>{t("records.itemLevelNote")}</small></p>}
    <section className={world.board} aria-label={t(`records.boards.${board}`)}>
      <div className={guildStyles.controls}>
        <label>{t("className")}<select className={world.select} value={filters.className} onChange={event => update({ className: event.target.value })}>
          <option value="">{t("records.allClasses")}</option>{data?.filterOptions.className.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>{t("guild")}<select className={world.select} value={filters.guild} onChange={event => update({ guild: event.target.value })}>
          <option value="">{t("records.allGuilds")}</option>{data?.filterOptions.guild.map(guild => <option key={guild.slug} value={guild.slug}>{guild.name}</option>)}</select></label>
        <label>{t("ruleset")}<select className={world.select} value={filters.ruleset} onChange={event => update({ ruleset: event.target.value })}>
          <option value="">{t("allRulesets")}</option>{data?.filterOptions.ruleset.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>{t("faction")}<select className={world.select} value={filters.faction} onChange={event => update({ faction: event.target.value })}>
          <option value="">{t("records.allFactions")}</option>{data?.filterOptions.faction.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        {Object.values(filters).some(Boolean) && <button className={world.button} onClick={() => update({ className: "", guild: "", ruleset: "", faction: "" })}>{t("clearFilters")}</button>}
      </div>
      {query.error && <div className={guildStyles.error}><ForeverErrorMessage error={query.error} /></div>}
      {query.isPending && <p className={world.empty} role="status">{t("loading")}</p>}
      {data && <>
        <div className={guildStyles.resultCount} role="status">{t("records.count", { count: data.total, total: data.ranked })}</div>
        {data.rows.length ? <ol className={styles.rows}>{data.rows.map(row => <li key={row.id} className={styles.row}>
          <span className={styles.rank}>{row.rank}</span>
          <div className={styles.who}><Portrait character={{ avatarUrl: row.avatarUrl, className: row.className ?? undefined }} />
            <div><Link href={foreverCharacterPath({ slug: row.slug, region: row.region, _id: row.id })} style={{ color: classColor(row.className ?? undefined) }}>{row.name}</Link>
              <small>{t("levelValue", { level: row.level ?? "—" })} · {row.className}</small></div></div>
          <div className={styles.guildCell}>{row.guild ? `‹${row.guild.name}›` : "—"}<small>{row.ruleset}</small></div>
          <div className={styles.value}>{value(row.values[board] ?? 0)}
            {board === "itemLevel" && row.itemLevelUnknown ? <small>{t("profile.itemLevelPartial", { count: row.itemLevelUnknown })}</small> : null}</div>
        </li>)}</ol> : <p className={world.empty}>{t("records.empty")}</p>}
        {pages > 1 && <div className={world.boardFoot}><span /><nav className={world.pagination} aria-label={t("records.pages")}>
          <button className={world.button} disabled={data.page <= 1} onClick={() => router.replace(href({ page: data.page - 1 }), { scroll: false })}>{t("previous")}</button>
          <span>{t("page", { page: data.page })} / {pages}</span>
          <button className={world.button} disabled={data.page >= pages} onClick={() => router.replace(href({ page: data.page + 1 }), { scroll: false })}>{t("next")}</button>
        </nav></div>}
      </>}
    </section>
  </>;
}

export default function ForeverRecordsPage() {
  const t = useTranslations("forever");
  return <div className={world.world}><div className={world.shell}>
    <ForeverHeader title={t("records.title")} current="records" />
    <p className={styles.intro}>{t("records.intro")}</p>
    <Suspense fallback={<p className={styles.quiet}>{t("loading")}</p>}><RecordsBoard /></Suspense>
  </div></div>;
}
