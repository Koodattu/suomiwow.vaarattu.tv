"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { foreverApi, ForeverCharacter } from "@/lib/forever-api";
import { classColor, Faction, ForeverDate, ForeverErrorMessage, Portrait } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

export default function ForeverCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), t = useTranslations("forever"), { user } = useAuth();
  const [busy, setBusy] = useState(false), [queued, setQueued] = useState(false), [error, setError] = useState<unknown>(null);
  const query = useQuery({ queryKey: ["forever", "character", id], queryFn: () => foreverApi<ForeverCharacter>(`forever/characters/${id}`), refetchInterval: 60_000 });
  const character = query.data;
  return <div className={styles.world}><div className={styles.shell}>
    <header className={styles.header}><Link className={styles.wordmark} href="/forever"><small>SuomiWoW</small><strong>Forever</strong></Link><Link className={`${styles.button} ${styles.quietButton}`} href="/forever/leveling">← {t("title")}</Link></header>
    {query.isPending && <p role="status">{t("loading")}</p>}
    {query.error && <ForeverErrorMessage error={query.error} />}
    {character && <div className={styles.profileGrid}>
      <section className={styles.profileCard}>
        <div className={styles.profileIdentity}><Portrait character={character} /><div><h1 style={{ color: classColor(character.className) }}>{character.name || character.slug}</h1><p className={styles.raceClass}>{character.race} {character.className}</p><Faction name={character.faction} /></div></div>
        <div className={styles.profileLevel}><div><span className={styles.level}>{character.level || "—"}</span><span className={styles.cap}>/ 60</span></div><div className="text-right"><p className={styles.guild}>{character.guild?.name ? `‹${character.guild.name}›` : "—"}</p><p className={styles.raceClass}>{character.region.toUpperCase()} · {character.ruleset}</p></div></div>
        {character.errorCode && <p className={styles.notice}>{t("retryNotice")}</p>}
        <div className={styles.profileActions}>
          <a className={styles.button} href={character.armoryUrl} target="_blank" rel="noreferrer">{t("openArmory")}</a>
          {user && <button className={`${styles.button} ${styles.quietButton}`} disabled={busy || queued} onClick={async () => {
            setBusy(true); setError(null); try { await foreverApi(`forever/characters/${id}/refresh`, "POST"); setQueued(true); await query.refetch(); } catch (caught) { setError(caught); } finally { setBusy(false); }
          }}>{t(queued ? "refreshQueued" : "refresh")}</button>}
        </div>
        {error != null && <ForeverErrorMessage error={error} />}
        <dl className={styles.profileFacts}>{([ ["checked", character.lastFetchedAt], ["sourceUpdated", character.sourceUpdatedAt], ["nextCheck", character.nextFetchAt] ] as const).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd><ForeverDate value={value} compact /></dd></div>)}</dl>
      </section>
      <section className={styles.board}>
        <h2 className={styles.sectionHeading}>{t("history")}</h2>
        {character.history?.length ? <ol className={styles.historyList}>{[...character.history].reverse().map((entry) => <li key={entry.level}><span className={styles.historyLevel} aria-label={t("levelValue", { level: entry.level })}>{entry.level}</span><div><strong>{t("levelValue", { level: entry.level })}</strong><p><ForeverDate value={entry.observedAt} compact /></p></div></li>)}</ol> : <p className={styles.empty}>{t("awaitingProfile")}</p>}
        <p className={styles.boardFoot}>{t("historyNote")}</p>
      </section>
    </div>}
  </div></div>;
}
