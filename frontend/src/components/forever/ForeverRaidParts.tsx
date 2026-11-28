"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { foreverCharacterPath, type ForeverKillEvent } from "@/lib/forever-api";
import { classColor, ForeverDate } from "./ForeverShared";
import styles from "./boards.module.css";

const SHOWN = 12;
export const guildPath = (guild: { id: string | null; slug: string }) => `/forever/guilds/${encodeURIComponent(guild.id ?? guild.slug)}`;

export function KillFeed({ kills }: { kills: ForeverKillEvent[] }) {
  const t = useTranslations("forever.raids");
  if (!kills.length) return <p className={styles.quiet}>{t("noRecent")}</p>;
  return <ol className={styles.feed}>{kills.map(kill => <li key={`${kill.instance}/${kill.boss}/${kill.at}`} className={styles.kill} data-raid={kill.raid || undefined}>
    <ForeverDate value={kill.at} />
    <div>
      <strong>{kill.boss}<small>{kill.instance}</small></strong>{" "}
      {kill.guild ? <Link className={styles.guildLink} href={guildPath(kill.guild)}>‹{kill.guild.name}›</Link> : <span className={styles.quiet}>{t("unassigned")}</span>}
    </div>
    <p className={styles.participants}>
      {kill.participants.slice(0, SHOWN).map(player => <Link key={player.id} href={foreverCharacterPath({ ...player, region: "eu", _id: player.id })}
        style={{ color: classColor(player.className ?? undefined) }}>{player.name}</Link>)}
      {kill.participants.length > SHOWN && <span>{t("more", { count: kill.participants.length - SHOWN })}</span>}
    </p>
  </li>)}</ol>;
}

export function ProgressBar({ killed, total }: { killed: number; total: number }) {
  const t = useTranslations("forever.raids");
  return <span className={styles.bar}>{t("bosses", { killed, total })}<meter min={0} max={total} value={killed} aria-hidden="true" /></span>;
}
