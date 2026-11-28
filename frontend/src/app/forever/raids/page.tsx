"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import ForeverHeader from "@/components/forever/ForeverHeader";
import { ForeverDate, ForeverErrorMessage } from "@/components/forever/ForeverShared";
import { guildPath, KillFeed, ProgressBar } from "@/components/forever/ForeverRaidParts";
import { foreverApi, type ForeverRaids } from "@/lib/forever-api";
import world from "@/components/forever/forever.module.css";
import styles from "@/components/forever/boards.module.css";

export default function ForeverRaidsPage() {
  const t = useTranslations("forever");
  const query = useQuery({ queryKey: ["forever", "raids"], queryFn: ({ signal }) => foreverApi<ForeverRaids>("forever/raids", "GET", undefined, signal),
    staleTime: 30_000, refetchInterval: 60_000 });
  const data = query.data;
  const active = data?.raids.filter(raid => raid.guilds.length) ?? [];
  return <div className={world.world}><div className={world.shell}>
    <ForeverHeader title={t("raids.title")} current="raids" />
    <p className={styles.intro}>{t("raids.intro")}<small>{t("raids.method")}</small></p>
    {query.error && <div className={styles.heading}><ForeverErrorMessage error={query.error} />
      <button className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>}
    {query.isPending && <p className={styles.quiet} role="status">{t("loading")}</p>}
    {data && <>
      <section aria-labelledby="forever-raid-progress">
        <div className={styles.heading}><h2 id="forever-raid-progress">{t("raids.progress")}</h2>
          <small>{t("raids.summary", { kills: data.groupKills, characters: data.trackedCharacters })}</small></div>
        {active.length ? <div className={styles.raids}>{active.map(raid => <article key={raid.instance} className={styles.raid}>
          <h3>{raid.instance}<small>{t("raids.bossCount", { count: raid.bosses })}</small></h3>
          <ol>{raid.guilds.map((row, index) => <li key={row.guild.slug} className={styles.progressRow}>
            <span>{index + 1}</span>
            <details>
              <summary><Link href={guildPath(row.guild)}>{row.guild.name}</Link></summary>
              <ol>{row.bosses.map(boss => <li key={boss.boss}><span>{boss.boss}</span><ForeverDate value={boss.firstKillAt} /></li>)}</ol>
            </details>
            <ProgressBar killed={row.killed} total={raid.bosses} />
          </li>)}</ol>
        </article>)}</div> : <>
          <p className={styles.quiet}>{t("raids.noKills")}</p>
          <ul className={styles.upcoming} aria-label={t("raids.upcoming")}>{data.raids.map(raid => <li key={raid.instance}>{raid.instance}</li>)}</ul>
        </>}
      </section>
      <section className={styles.section} aria-labelledby="forever-recent-kills">
        <div className={styles.heading}><h2 id="forever-recent-kills">{t("raids.recent")}</h2></div>
        <KillFeed kills={data.recent} />
      </section>
    </>}
  </div></div>;
}
