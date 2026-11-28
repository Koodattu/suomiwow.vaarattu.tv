"use client";

import Image from "next/image";
import { useId, type CSSProperties } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { formatForeverDate, type ForeverBossKill, type ForeverGearItem, type ForeverProfile, type ForeverRecordKey } from "@/lib/forever-api";
import { ForeverDate } from "./ForeverShared";
import { KillTime, raidStatus, RaidPips } from "./ForeverRaidParts";
import styles from "./profile.module.css";

// Blizzard's quality colours, with rare and epic lifted slightly for small text on the dark board.
const qualityColors: Record<string, string> = {
  POOR: "#9d9d9d", COMMON: "#f2f2f2", UNCOMMON: "#1eff00", RARE: "#3d9bff", EPIC: "#b773f5",
  LEGENDARY: "#ff8000", ARTIFACT: "#e6cc80", HEIRLOOM: "#00ccff",
};
export const qualityColor = (quality?: string) => qualityColors[quality ?? ""] ?? "#f2f2f2";
const LEFT = ["head", "neck", "shoulder", "back", "chest", "shirt", "tabard", "wrist"];
const RIGHT = ["hand", "waist", "leg", "foot", "leftFinger", "rightFinger", "leftTrinket", "rightTrinket"];
const WEAPONS = ["weapon", "offhand", "ranged"];

function GearSlot({ item, align }: { item?: ForeverGearItem; align: "left" | "right" | "center" }) {
  const t = useTranslations("forever.profile"), tooltip = useId();
  if (!item) return <li className={styles.slot} data-align={align} data-empty="true">
    <span className={styles.slotIcon} aria-hidden="true" /><span className={styles.slotText}><small>{t("emptySlot")}</small></span>
  </li>;
  return <li className={styles.slot} data-align={align} tabIndex={0} aria-describedby={tooltip} style={{ "--quality": qualityColor(item.quality) } as CSSProperties}>
    <span className={styles.slotIcon}>{item.icon && <Image src={item.icon} alt="" width={40} height={40} unoptimized />}</span>
    <span className={styles.slotText}>
      <strong>{item.name}</strong>
      <small>{[item.itemLevel != null ? t("itemLevelShort", { level: item.itemLevel }) : null, item.subclass].filter(Boolean).join(" · ")}</small>
    </span>
    <span role="tooltip" id={tooltip} className={styles.tooltip}>
      <strong>{item.name}</strong>
      {item.itemLevel != null && <span className={styles.tooltipLevel}>{t("itemLevelShort", { level: item.itemLevel })}</span>}
      {item.lines.map((line, index) => <span key={index}>{line}</span>)}
      {item.set && <span className={styles.tooltipSet}>{t("set", { name: item.set })}</span>}
      {item.requiredLevel ? <span>{t("requires", { level: item.requiredLevel })}</span> : null}
    </span>
  </li>;
}

export function ProfileGear({ profile }: { profile: ForeverProfile }) {
  const t = useTranslations("forever.profile");
  const bySlot = new Map(profile.gear.map(item => [item.slot, item]));
  if (!profile.gear.length) return <p className={styles.empty}>{t("noGear")}</p>;
  return <div className={styles.paperdoll}>
    <ul className={styles.column} aria-label={t("gear")}>{LEFT.map(slot => <GearSlot key={slot} item={bySlot.get(slot)} align="left" />)}</ul>
    <div className={styles.render} aria-hidden="true">
      {profile.renderUrl && <Image src={profile.renderUrl} alt="" width={800} height={800} unoptimized />}
    </div>
    <ul className={styles.column}>{RIGHT.map(slot => <GearSlot key={slot} item={bySlot.get(slot)} align="right" />)}</ul>
    <ul className={styles.weapons}>{WEAPONS.map(slot => <GearSlot key={slot} item={bySlot.get(slot)} align="center" />)}</ul>
  </div>;
}

export function ProfileTalents({ profile }: { profile: ForeverProfile }) {
  const t = useTranslations("forever.profile");
  const spent = profile.specs.reduce((sum, spec) => sum + spec.points, 0);
  if (!profile.specs.length || !spent) return <p className={styles.empty}>{t("noTalents")}</p>;
  return <>
    <p className={styles.treeSplit}>{profile.specs.map(spec => spec.points).join(" / ")}</p>
    <div className={styles.trees}>{profile.specs.map(spec => <section key={spec.name} className={styles.tree} data-empty={spec.points === 0 || undefined}>
      <h4>{spec.icon && <Image src={spec.icon} alt="" width={24} height={24} unoptimized />}<span>{spec.name}</span><small>{t("points", { count: spec.points })}</small></h4>
      {spec.talents.length > 0 && <ul>{spec.talents.map(talent => <li key={talent.id} title={`${talent.name} (${talent.rank})`}>
        {talent.icon ? <Image src={talent.icon} alt="" width={32} height={32} unoptimized /> : <span className={styles.talentFallback} />}
        <b aria-hidden="true">{talent.rank}</b><span className="sr-only">{talent.name} {talent.rank}</span>
      </li>)}</ul>}
    </section>)}</div>
  </>;
}

export function ProfileProfessions({ profile }: { profile: ForeverProfile }) {
  const t = useTranslations("forever.profile");
  if (!profile.professions.length) return <p className={styles.empty}>{t("noProfessions")}</p>;
  return <ul className={styles.professions}>{profile.professions.map(profession => <li key={profession.name}>
    {profession.icon && <Image src={profession.icon} alt="" width={28} height={28} unoptimized />}
    <div><span>{profession.name}</span><strong>{profession.skill} / {profession.max}</strong>
      <meter min={0} max={profession.max} value={profession.skill} aria-label={profession.name} /></div>
  </li>)}</ul>;
}

const recordOrder: ForeverRecordKey[] = ["epicsEquipped", "epicsAcquired", "mounts", "exalted", "battlegroundsWon", "battlegroundsPlayed",
  "duelsWon", "duelsLost", "totalKills", "deathsFromPlayers", "dungeonsEntered", "raidsEntered"];
export function ProfileRecords({ profile }: { profile: ForeverProfile }) {
  const t = useTranslations("forever.profile"), format = useFormatter();
  if (!profile.records) return <p className={styles.empty}>{t("noStats")}</p>;
  return <dl className={styles.records}>{recordOrder.map(key => <div key={key}>
    <dt>{t(`recordLabels.${key}`)}</dt><dd>{format.number(profile.records?.[key] ?? 0)}</dd>
  </div>)}</dl>;
}

function KillTable({ rows }: { rows: ForeverBossKill[] }) {
  const t = useTranslations("forever.profile");
  const instances = [...new Set(rows.map(row => row.instance))];
  return <div className={styles.scroll}><table className={styles.kills}>
    <thead><tr><th scope="col">{t("instance")}</th><th scope="col">{t("boss")}</th><th scope="col">{t("killsHeader")}</th>
      <th scope="col">{t("firstKill")}</th><th scope="col">{t("lastKill")}</th></tr></thead>
    {instances.map(instance => {
      const bosses = rows.filter(row => row.instance === instance);
      return <tbody key={instance}>{bosses.map((row, index) => <tr key={row.boss}>
        {index === 0 && <th scope="rowgroup" rowSpan={bosses.length} className={styles.instance}>{instance}</th>}
        <th scope="row" className={styles.boss}>{row.boss}</th><td className={styles.count}>{row.count}</td>
        <td>{row.firstKillAt ? <ForeverDate value={row.firstKillAt} /> : <span className={styles.muted}>{t("beforeTracking")}</span>}</td>
        <td><ForeverDate value={row.lastKillAt} /></td>
      </tr>)}</tbody>;
    })}
  </table></div>;
}

export function ProfileBossKills({ profile }: { profile: ForeverProfile }) {
  const t = useTranslations("forever.profile");
  if (!profile.statsFetchedAt) return <p className={styles.empty}>{t("noStats")}</p>;
  if (!profile.bosses.length) return <p className={styles.empty}>{t("noBossKills")}</p>;
  const raids = profile.bosses.filter(row => row.raid), dungeons = profile.bosses.filter(row => !row.raid);
  return <>
    {raids.length > 0 && <><h3 className={styles.subheading}>{t("raidKills")}</h3><KillTable rows={raids} /></>}
    {dungeons.length > 0 && <><h3 className={styles.subheading}>{t("dungeonKills")}</h3><KillTable rows={dungeons} /></>}
  </>;
}

export function ProfileAchievements({ profile }: { profile: ForeverProfile }) {
  const t = useTranslations("forever.profile");
  if (!profile.statsFetchedAt) return <p className={styles.empty}>{t("noStats")}</p>;
  return <>
    <p className={styles.treeSplit}>{t("achievementCount", { count: profile.achievementCount })}</p>
    <ol className={styles.achievements}>{profile.achievements.slice(0, 12).map(achievement => <li key={achievement.id}>
      <span>{achievement.name}</span><ForeverDate value={achievement.completedAt} compact />
    </li>)}</ol>
  </>;
}

export function ProfileRaids({ profile }: { profile: ForeverProfile }) {
  const t = useTranslations("forever"), now = useNow({ updateInterval: 60_000 });
  return <div className={styles.raidCards}>{profile.raids.map(raid => { const entered = raid.bosses.some(boss => boss.killed); return <section key={raid.key} className={styles.raidCard} data-raid={raid.key} aria-label={raid.instance}>
    <header>
      <div><h4>{raid.instance}</h4>
        <small>{t("raids.players", { count: raid.size })}{raid.clearedAt ? <> · {t("profile.cleared")} <ForeverDate value={raid.clearedAt} /></> : null}</small></div>
      {raidStatus(raid, now.getTime()) === "upcoming" && !entered
        ? <span className={styles.status}>{t("raids.opens", { date: formatForeverDate(`${raid.opensAt}T09:00:00Z`).split(" ")[0] })}</span>
        : <RaidPips killed={raid.bosses.map(boss => boss.killed)} total={raid.bosses.length} />}
    </header>
    <ol>{raid.bosses.map(boss => <li key={boss.name} data-killed={boss.killed || undefined}>
      <span aria-hidden="true">{boss.killed ? "✓" : "·"}</span>
      <span>{boss.name}{boss.count > 1 ? <small> ×{boss.count}</small> : null}</span>
      <span>{boss.firstKillAt ? <ForeverDate value={boss.firstKillAt} compact />
        : boss.seenAt ? <KillTime at={boss.seenAt} approximate after={boss.seenAfter} compact />
        : boss.beforeTracking ? <span className={styles.muted}>{t("profile.beforeTracking")}</span>
        : entered ? <span className={styles.muted}>{t("profile.notKilledShort")}</span> : null}</span>
    </li>)}</ol>
  </section>; })}</div>;
}
