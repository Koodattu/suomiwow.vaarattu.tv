"use client";

import { use, useEffect, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import ForeverHeader from "@/components/forever/ForeverHeader";
import { foreverCharacterPath, foreverRace, foreverRouteIdentity, type ForeverCharacter } from "@/lib/forever-api";
import { CharacterDetails, useForeverCharacter } from "@/components/forever/ForeverCharacterDetails";
import { classColor, Faction, ForeverDate, ForeverErrorMessage, Portrait, StreamerLink } from "@/components/forever/ForeverShared";
import { ProfileAchievements, ProfileBossKills, ProfileGear, ProfileProfessions, ProfileRaids, ProfileRecords, ProfileTalents } from "@/components/forever/ForeverProfile";
import styles from "@/components/forever/forever.module.css";
import profileStyles from "@/components/forever/profile.module.css";

/** The Armory-style stage: identity and key numbers above the gear around the character render. */
function Stage({ character }: { character: ForeverCharacter }) {
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
  return <section className={profileStyles.stage} style={{ "--class-color": classColor(character.className) } as CSSProperties} aria-labelledby="forever-character-name">
    <header className={profileStyles.stageHeader}>
      <div className={profileStyles.identity}>
        <Portrait character={character} />
        <div>
          <h2 id="forever-character-name" style={{ color: classColor(character.className) }}>{character.name || character.slug}</h2>
          <p><strong>{character.level ?? "—"}</strong> {foreverRace(character.race)} {character.className}</p>
          <div className={profileStyles.meta}>
            {character.guild?.name && <Link href={`/forever/guilds/${encodeURIComponent(character.guild.slug)}`}>‹{character.guild.name}›</Link>}
            <Faction name={character.faction} />{character.ruleset && <span>{character.ruleset}</span>}<StreamerLink character={character} />
          </div>
        </div>
      </div>
      <dl className={profileStyles.heroStats}>{stats.map(stat => <div key={stat.label}>
        <dt>{stat.label}</dt><dd>{stat.value ?? "—"}</dd>{stat.note && <small>{stat.note}</small>}
      </div>)}</dl>
    </header>
    {profile ? <ProfileGear profile={profile} /> : <p className={profileStyles.empty}>{t("profile.noProfile")}</p>}
    {profile && <p className={profileStyles.sources}>
      <span>{t("profile.armoryData")} <ForeverDate value={profile.armoryFetchedAt} /></span>
      <span>{t("profile.statsData")} <ForeverDate value={profile.statsFetchedAt} /></span>
    </p>}
  </section>;
}

export default function ForeverCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: segment } = use(params), t = useTranslations("forever"), router = useRouter();
  const id = foreverRouteIdentity(segment);
  const query = useForeverCharacter(id), character = query.data;
  useEffect(() => {
    if (character?.region === "eu" && id !== character.slug) router.replace(foreverCharacterPath(character), { scroll: false });
  }, [character, id, router]);
  const profile = character?.profile;
  const capped = character?.level === 60;
  const sections = [
    ...(!capped ? [["journey", t("profile.journey")]] : []),
    ...(profile ? [["raids", t("profile.raids")], ["talents", t("profile.talents")], ["professions", t("profile.professions")],
      ["achievements", t("profile.recentAchievements")], ["records", t("profile.records")], ["kills", t("profile.bossKills")]] : []),
    ...(capped ? [["journey", t("profile.journey")]] : []),
  ];
  // The progress chart carries its own "Journey to 60" heading.
  const journey = character && <section id="forever-journey" className={`${profileStyles.panel} ${profileStyles.wide}`} aria-label={t("profile.journey")}>
    <div className={styles.board}><CharacterDetails key={character._id} character={character} showCharacterLink={false} /></div>
  </section>;
  return <div className={styles.world}><div className={styles.shell}>
    <ForeverHeader title={character?.name || t("profile.title")} current="leveling" />
    <Link className={styles.backToBoard} href="/forever/leveling">← {t("progress.backToBoard")}</Link>
    {query.isPending && <p className={styles.detailsLoading} role="status">{t("loading")}</p>}
    {query.error && <ForeverErrorMessage error={query.error} />}
    {character && <>
      <Stage character={character} />
      {sections.length > 1 && <nav className={profileStyles.sectionNav} aria-label={t("profile.sections")}>
        {sections.map(([key, label]) => <a key={key} href={`#forever-${key}`}>{label}</a>)}
      </nav>}
      <div className={profileStyles.grid}>
        {!capped && journey}
        {profile && <>
          <section id="forever-raids" className={`${profileStyles.panel} ${profileStyles.wide}`} aria-labelledby="forever-raids-heading">
            <h3 id="forever-raids-heading">{t("profile.raids")}</h3><ProfileRaids profile={profile} /></section>
          <section id="forever-talents" className={profileStyles.panel} aria-labelledby="forever-talents-heading"><h3 id="forever-talents-heading">{t("profile.talents")}</h3><ProfileTalents profile={profile} /></section>
          <section id="forever-professions" className={profileStyles.panel} aria-labelledby="forever-professions-heading"><h3 id="forever-professions-heading">{t("profile.professions")}</h3><ProfileProfessions profile={profile} /></section>
          <section id="forever-achievements" className={profileStyles.panel} aria-labelledby="forever-achievements-heading"><h3 id="forever-achievements-heading">{t("profile.recentAchievements")}</h3><ProfileAchievements profile={profile} /></section>
          <section id="forever-records" className={`${profileStyles.panel} ${profileStyles.wide}`} aria-labelledby="forever-records-heading"><h3 id="forever-records-heading">{t("profile.records")}</h3><ProfileRecords profile={profile} /></section>
          <section id="forever-kills" className={`${profileStyles.panel} ${profileStyles.wide}`} aria-labelledby="forever-kills-heading"><h3 id="forever-kills-heading">{t("profile.bossKills")}</h3><ProfileBossKills profile={profile} /></section>
        </>}
        {capped && journey}
      </div>
    </>}
  </div></div>;
}
