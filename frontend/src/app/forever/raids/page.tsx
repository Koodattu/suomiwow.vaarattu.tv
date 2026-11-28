"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import ForeverHeader from "@/components/forever/ForeverHeader";
import { ForeverErrorMessage } from "@/components/forever/ForeverShared";
import { BossCredit, guildPath, KillFeed, KillTime, RaidMeta, RaidPips } from "@/components/forever/ForeverRaidParts";
import { foreverApi, type ForeverRaidProgress, type ForeverRaids } from "@/lib/forever-api";
import world from "@/components/forever/forever.module.css";
import styles from "@/components/forever/boards.module.css";

function RaidCard({ raid }: { raid: ForeverRaidProgress }) {
  const t = useTranslations("forever.raids");
  const headingId = `raid-${raid.key}`;
  return <article className={styles.raidCard} aria-labelledby={headingId} data-raid={raid.key}>
    <header className={styles.raidBanner}>
      <div>
        <h3 id={headingId}>{raid.instance}</h3>
        <RaidMeta raid={raid} />
      </div>
      {raid.firstClear && <p className={styles.firstClear}><span>{raid.bosses.length === 1 ? t("firstKill") : t("firstClear")}</span>
        <BossCredit credit={raid.firstClear} /></p>}
    </header>
    <div className={styles.raidBody}>
      <section aria-label={t("bossList")}>
        <h4 className={styles.raidSubheading}>{t("bossList")}</h4>
        <ol className={styles.bossList}>{raid.bosses.map((boss, index) => <li key={`${boss.name}-${index}`} data-killed={boss.first ? true : undefined}>
          <span className={styles.bossNo}>{index + 1}</span>
          <span className={styles.bossName}>{boss.name || t("unknownBoss")}</span>
          <BossCredit credit={boss.first} />
        </li>)}</ol>
        {!raid.legacy && !raid.discovered && raid.bosses.length > 1 && <p className={styles.footnote}>{t("orderNote")}</p>}
      </section>
      <section aria-label={t("standings")}>
        <h4 className={styles.raidSubheading}>{t("standings")}</h4>
        {raid.guilds.length ? <ol className={styles.standings}>{raid.guilds.map((row, index) => {
          const killed = new Set(row.bosses.map(entry => entry.name));
          return <li key={row.guild.slug}>
            <span className={styles.rank} data-medal={index < 3 ? index + 1 : undefined}>{index + 1}</span>
            <div className={styles.standingGuild}>
              <Link href={guildPath(row.guild)}>{row.guild.name}</Link>
              <small>{row.clearedAt ? <>{t("cleared")} <KillTime at={row.clearedAt} approximate={false} /></>
                : <>{t("latestProgress")} <KillTime at={row.reachedAt} approximate={row.approximate} /></>}</small>
            </div>
            <RaidPips killed={raid.bosses.map(boss => killed.has(boss.name))} total={raid.bossCount} />
          </li>;
        })}</ol> : <p className={styles.quiet}>{t("noGuilds")}</p>}
      </section>
    </div>
  </article>;
}

export default function ForeverRaidsPage() {
  const t = useTranslations("forever");
  const query = useQuery({ queryKey: ["forever", "raids"], queryFn: ({ signal }) => foreverApi<ForeverRaids>("forever/raids", "GET", undefined, signal),
    staleTime: 30_000, refetchInterval: 60_000 });
  const data = query.data;
  return <div className={world.world}><div className={world.shell}>
    <ForeverHeader title={t("raids.title")} current="raids" />
    <div className={styles.pageIntro}>
      <p>{t("raids.intro")}</p>
      <details className={styles.method}><summary>{t("raids.methodTitle")}</summary><p>{t("raids.method")}</p><p>{t("raids.methodCriteria")}</p></details>
    </div>
    {query.error && <div className={styles.heading}><ForeverErrorMessage error={query.error} />
      <button className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>}
    {query.isPending && <p className={styles.quiet} role="status">{t("loading")}</p>}
    {data && <>
      <div className={styles.raidList}>{data.raids.map(raid => <RaidCard key={raid.key} raid={raid} />)}</div>
      <section className={styles.section} aria-labelledby="forever-recent-kills">
        <div className={styles.heading}><h2 id="forever-recent-kills">{t("raids.recent")}</h2>
          <small>{t("raids.summary", { kills: data.groupKills, characters: data.trackedCharacters })}</small></div>
        <KillFeed kills={data.recent} />
      </section>
    </>}
  </div></div>;
}
