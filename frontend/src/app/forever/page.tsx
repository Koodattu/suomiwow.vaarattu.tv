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
const metrics = [
  { field: "characters", label: "analytics.tracked", to: "leveling" },
  { field: "guilds", label: "guilds.title", to: "guilds" },
  { field: "levelsGained24h", label: "analytics.levelsGained24h", to: "analytics" },
] as const;
const destinations = [
  { to: "leveling", title: "title", description: "hubDescription", icon: FiFlag },
  { to: "analytics", title: "analytics.title", description: "analytics.hubDescription", icon: FiBarChart2 },
  { to: "namegame", title: "namegame.title", description: "namegame.description", icon: FiSmile },
  { to: "guilds", title: "guilds.title", description: "guilds.description", icon: FiUsers },
] as const;

export default function ForeverHub() {
  const t = useTranslations("forever"), format = useFormatter();
  const query = useQuery({ queryKey: ["forever", "hub"], queryFn: ({ signal }) =>
    foreverApi<Hub>("forever/hub", "GET", undefined, signal), staleTime: 15_000, refetchInterval: 30_000 });
  const data = query.data;
  return <div className={world.world}><div className={styles.shell}>
    <header className={styles.hero}>
      <div className={styles.intro}>
        <h1>{t("brand")}</h1>
        <p>{t("hub.intro")}</p>
        <ForeverHubSearch />
      </div>
      <Image className={styles.crest} src="/forever-logo.png" alt="" width={1353} height={1162} sizes="(max-width: 640px) 56px, 180px" />
    </header>
    <section aria-labelledby="forever-today">
      <div className={styles.heading}><h2 id="forever-today">{t("hub.today")}</h2>
        {data && <small>{t("checked")} <ForeverDate value={data.generatedAt} /></small>}
      </div>
      {query.isError && <div className={styles.error}><ForeverErrorMessage error={query.error} />
        <button type="button" className={world.button} onClick={() => void query.refetch()}>{t("progress.tryAgain")}</button></div>}
      {!data && !query.isError && <p role="status" className={styles.quiet}>{t("loading")}</p>}
      {data && <ul className={styles.stats}>{metrics.map(({ field, label, to }) =>
        <li key={field}><Link href={`/forever/${to}`}>
          <strong>{format.number(data[field])}</strong><span>{t(label)} <FiArrowRight aria-hidden="true" /></span>
        </Link></li>)}</ul>}
    </section>
    {data && <section aria-labelledby="forever-milestones">
      <div className={styles.heading}><h2 id="forever-milestones">{t("hub.milestones")}</h2></div>
      {data.milestones.length ? <ul className={styles.milestones}>{data.milestones.map(character =>
        <li key={character.slug}><Link href={foreverCharacterPath(character.slug)}>
          <Portrait character={character} />
          <div><strong style={{ color: classColor(character.className) }}>{character.name}</strong>
            <small>{t("hub.observed")} <ForeverDate value={character.observedAt} compact /></small></div>
        </Link></li>)}</ul> : <p className={styles.quiet}>{t("hub.noMilestones")}</p>}
    </section>}
    <nav aria-labelledby="forever-explore">
      <div className={styles.heading}><h2 id="forever-explore">{t("hub.explore")}</h2></div>
      <ul className={styles.shortcuts}>{destinations.map(({ to, title, description, icon: Icon }) =>
        <li key={to}><Link href={`/forever/${to}`}>
          <div><Icon aria-hidden="true" /><strong>{t(title)}</strong><FiArrowRight aria-hidden="true" /></div>
          <p>{to === "namegame" && data?.featuredName ? t("hub.topName", { name: data.featuredName }) : t(description)}</p>
        </Link></li>)}</ul>
    </nav>
  </div></div>;
}
