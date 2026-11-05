"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { foreverCharacterPath, foreverRace, foreverRouteIdentity } from "@/lib/forever-api";
import { CharacterDetails, useForeverCharacter } from "@/components/forever/ForeverCharacterDetails";
import { classColor, Faction, ForeverErrorMessage, Portrait, StreamerLink } from "@/components/forever/ForeverShared";
import styles from "@/components/forever/forever.module.css";

export default function ForeverCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: segment } = use(params), t = useTranslations("forever"), router = useRouter();
  const id = foreverRouteIdentity(segment);
  const query = useForeverCharacter(id), character = query.data;
  useEffect(() => {
    if (character?.region === "eu" && id !== character.slug) router.replace(foreverCharacterPath(character), { scroll: false });
  }, [character, id, router]);
  return <div className={styles.world}><div className={`${styles.shell} ${styles.characterShell}`}>
    <Link className={styles.backToBoard} href="/forever/leveling">← {t("progress.backToBoard")}</Link>
    {query.isPending && <p className={styles.detailsLoading} role="status">{t("loading")}</p>}
    {query.error && <ForeverErrorMessage error={query.error} />}
    {character && <>
      <header className={styles.characterHeader}>
        <div className={styles.identity}><Portrait character={character} /><div><h1 style={{ color: classColor(character.className) }}>{character.name || character.slug}</h1><p className={styles.raceClass}>{foreverRace(character.race)} {character.className}</p></div></div>
        <div className={styles.characterMeta}><span className={styles.guild}>{character.guild?.name ? `‹${character.guild.name}›` : ""}</span><Faction name={character.faction} /><span>{character.ruleset}</span><StreamerLink character={character} /></div>
        <strong className={styles.level} aria-label={t("levelValue", { level: character.level || 0 })}>{character.level || "—"}</strong>
      </header>
      <section className={styles.board} aria-label={t("history")}><CharacterDetails key={character._id} character={character} showCharacterLink={false} /></section>
    </>}
  </div></div>;
}
