"use client";

import { use, useEffect, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import ForeverHeader from "@/components/forever/ForeverHeader";
import { foreverCharacterPath, foreverRace, foreverRouteIdentity, type ForeverCharacter } from "@/lib/forever-api";
import { CharacterDetails, useForeverCharacter } from "@/components/forever/ForeverCharacterDetails";
import { classColor, Faction, ForeverDate, ForeverErrorMessage, Portrait, StreamerLink } from "@/components/forever/ForeverShared";
import { ProfileAchievements, ProfileBossKills, ProfileGear, ProfileProfessions, ProfileRecords, ProfileTalents } from "@/components/forever/ForeverProfile";
import styles from "@/components/forever/forever.module.css";
import profileStyles from "@/components/forever/profile.module.css";

function Hero({ character }: { character: ForeverCharacter }) {
  const t = useTranslations("forever"), format = useFormatter();
  const profile = character.profile;
  const stats = [
    { label: t("profile.itemLevel"), value: profile?.itemLevel ? format.number(profile.itemLevel.average, { maximumFractionDigits: 1 }) : null,
      note: profile?.itemLevel?.unknown ? t("profile.itemLevelPartial", { count: profile.itemLevel.unknown }) : null },
    { label: t("profile.epicsEquipped"), value: profile?.records ? format.number(profile.records.epicsEquipped ?? 0) : null },
    { label: t("profile.honorableKills"), value: profile?.honorableKills != null ? format.number(profile.honorableKills) : null,
      note: profile?.pvpRank ? t("profile.pvpRank", { rank: profile.pvpRank }) : null },
    { label: t("profile.achievements"), value: profile?.statsFetchedAt ? format.number(profile.achievementCount) : null },
  ];
  return <header className={profileStyles.hero} style={{ "--class-color": classColor(character.className) } as CSSProperties}>
    <div className={profileStyles.identity}>
      <Portrait character={character} />
      <div>
        <h2 style={{ color: classColor(character.className) }}>{character.name || character.slug}</h2>
        <p>{t("profile.level", { level: character.level ?? "—" })} · {foreverRace(character.race)} {character.className}</p>
        <div className={profileStyles.meta}>
          {character.guild?.name && <Link href={`/forever/guilds/${encodeURIComponent(character.guild.slug)}`}>‹{character.guild.name}›</Link>}
          <Faction name={character.faction} />{character.ruleset && <span>{character.ruleset}</span>}<StreamerLink character={character} />
        </div>
      </div>
    </div>
    <dl className={profileStyles.heroStats}>{stats.map(stat => <div key={stat.label}>
      <dt>{stat.label}</dt><dd>{stat.value ?? "—"}</dd>{stat.note && <small>{stat.note}</small>}
    </div>)}</dl>
    {profile && <p className={profileStyles.sources}>
      <span>{t("profile.armoryData")} <ForeverDate value={profile.armoryFetchedAt} /></span>
      <span>{t("profile.statsData")} <ForeverDate value={profile.statsFetchedAt} /></span>
    </p>}
  </header>;
}

export default function ForeverCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: segment } = use(params), t = useTranslations("forever"), router = useRouter();
  const id = foreverRouteIdentity(segment);
  const query = useForeverCharacter(id), character = query.data;
  useEffect(() => {
    if (character?.region === "eu" && id !== character.slug) router.replace(foreverCharacterPath(character), { scroll: false });
  }, [character, id, router]);
  const profile = character?.profile;
  const journey = character && <section className={`${profileStyles.panel} ${profileStyles.wide}`} aria-labelledby="forever-journey">
    <h3 id="forever-journey">{t("profile.journey")}</h3>
    <div className={styles.board}><CharacterDetails key={character._id} character={character} showCharacterLink={false} /></div>
  </section>;
  return <div className={styles.world}><div className={styles.shell}>
    <ForeverHeader title={character?.name || t("profile.title")} current="leveling" />
    <Link className={styles.backToBoard} href="/forever/leveling">← {t("progress.backToBoard")}</Link>
    {query.isPending && <p className={styles.detailsLoading} role="status">{t("loading")}</p>}
    {query.error && <ForeverErrorMessage error={query.error} />}
    {character && <>
      <Hero character={character} />
      <div className={profileStyles.grid}>
        {character.level !== 60 && journey}
        {!profile && <p className={`${profileStyles.panel} ${profileStyles.wide} ${profileStyles.empty}`}>{t("profile.noProfile")}</p>}
        {profile && <>
          <section className={`${profileStyles.panel} ${profileStyles.wide}`} aria-labelledby="forever-gear">
            <h3 id="forever-gear" className={profileStyles.panelHeading}>{t("profile.gear")}
              {profile.itemLevel && <small>{t("profile.itemLevel")} {profile.itemLevel.average}</small>}</h3>
            <ProfileGear profile={profile} />
          </section>
          <section className={profileStyles.panel} aria-labelledby="forever-talents"><h3 id="forever-talents">{t("profile.talents")}</h3><ProfileTalents profile={profile} /></section>
          <section className={profileStyles.panel} aria-labelledby="forever-professions"><h3 id="forever-professions">{t("profile.professions")}</h3><ProfileProfessions profile={profile} /></section>
          <section className={profileStyles.panel} aria-labelledby="forever-achievements"><h3 id="forever-achievements">{t("profile.recentAchievements")}</h3><ProfileAchievements profile={profile} /></section>
          <section className={`${profileStyles.panel} ${profileStyles.wide}`} aria-labelledby="forever-records"><h3 id="forever-records">{t("profile.records")}</h3><ProfileRecords profile={profile} /></section>
          <section className={`${profileStyles.panel} ${profileStyles.wide}`} aria-labelledby="forever-kills"><h3 id="forever-kills">{t("profile.bossKills")}</h3><ProfileBossKills profile={profile} /></section>
        </>}
        {character.level === 60 && journey}
      </div>
    </>}
  </div></div>;
}
