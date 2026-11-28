"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { FiArrowRight, FiBarChart2, FiFlag, FiSmile, FiUsers } from "react-icons/fi";
import { foreverApi, foreverCharacterPath } from "@/lib/forever-api";
import { classColor, ForeverDate, ForeverErrorMessage, Portrait } from "@/components/forever/ForeverShared";
import ForeverHubSearch from "@/components/forever/ForeverHubSearch";
import styles from "@/components/forever/hub.module.css";
import world from "@/components/forever/forever.module.css";

type Hub = {
  generatedAt: string; characters: number; guilds: number; levelsGained24h: number; featuredName: string | null;
  milestones: { name: string; slug: string; className?: string; avatarUrl?: string | null; observedAt: string }[];
};
const destinations = [
  { to: "leveling", title: "title", description: "hubDescription", icon: FiFlag, field: "characters", unit: "hub.trackedUnit" },
  { to: "guilds", title: "guilds.title", description: "guilds.description", icon: FiUsers, field: "guilds", unit: "hub.guildUnit" },
  { to: "analytics", title: "analytics.title", description: "analytics.hubDescription", icon: FiBarChart2, field: "levelsGained24h", unit: "hub.levelsUnit" },
  { to: "namegame", title: "namegame.title", description: "namegame.description", icon: FiSmile, field: null, unit: null },
] as const;

export default function ForeverHub() {
  const t = useTranslations("forever"), format = useFormatter();
  const query = useQuery({ queryKey: ["forever", "hub"], queryFn: ({ signal }) =>
    foreverApi<Hub>("forever/hub", "GET", undefined, signal), staleTime: 15_000, refetchInterval: 30_000 });
  const data = query.data;
  return <div className={world.world}><div className={styles.shell}>
    <header className={styles.hero}>
      <div className={styles.intro}>
        <Image className={styles.crest} src="/forever-logo.png" alt="" width={1353} height={1162} sizes="56px" priority />
        <div><h1>{t("brand")}</h1><p>{t("hub.intro")}</p></div>
      </div>
      <ForeverHubSearch />
    </header>

    <nav aria-labelledby="forever-explore">
      <div className={styles.heading}><h2 id="forever-explore">{t("hub.explore")}</h2>
        {data && <small>{t("checked")} <ForeverDate value={data.generatedAt} /></small>}
      </div>
      {query.isError && <div className={styles.error}><ForeverErrorMessage error={query.error} />
        <button type="button" className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>}
      <ul className={styles.shortcuts}>{destinations.map(({ to, title, description, icon: Icon, field, unit }) =>
        <li key={to}><Link href={`/forever/${to}`}>
          <div className={styles.cardTitle}><Icon aria-hidden="true" /><strong>{t(title)}</strong><FiArrowRight aria-hidden="true" /></div>
          <p>{t(description)}</p>
          <div className={styles.metric}>{field && unit
            ? <><strong>{data ? format.number(data[field]) : "—"}</strong><span>{t(unit, { count: data?.[field] ?? 0 })}</span></>
            : data?.featuredName
              ? <><span>{t("hub.topNameLabel")}</span><strong className={styles.metricName}>{data.featuredName}</strong></>
              : <strong>—</strong>}
          </div>
        </Link></li>)}</ul>
    </nav>

    <section aria-labelledby="forever-milestones">
      <div className={styles.heading}><h2 id="forever-milestones">{t("hub.milestones")}</h2>
        <Link className={styles.more} href="/forever/leveling">{t("hub.leaderboard")} <FiArrowRight aria-hidden="true" /></Link>
      </div>
      {!data && !query.isError && <p role="status" className={styles.quiet}>{t("loading")}</p>}
      {data && (data.milestones.length ? <ul className={styles.milestones}>{data.milestones.map(character =>
        <li key={character.slug}><Link href={foreverCharacterPath(character.slug)}>
          <Portrait character={character} />
          <div><strong style={{ color: classColor(character.className) }}>{character.name}</strong>
            <small>{t("hub.observed")} <ForeverDate value={character.observedAt} compact /></small></div>
        </Link></li>)}</ul> : <p className={styles.quiet}>{t("hub.noMilestones")}</p>)}
    </section>
  </div></div>;
}
