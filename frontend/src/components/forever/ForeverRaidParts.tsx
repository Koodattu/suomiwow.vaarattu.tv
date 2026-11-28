"use client";

import Link from "next/link";
import { useNow, useTranslations } from "next-intl";
import { foreverCharacterPath, formatForeverDate, type ForeverBossCredit, type ForeverKillEvent, type ForeverRaidProgress } from "@/lib/forever-api";
import { classColor, ForeverDate } from "./ForeverShared";
import styles from "./boards.module.css";

const SHOWN = 12;
export const guildPath = (guild: { id: string | null; slug: string }) => `/forever/guilds/${encodeURIComponent(guild.id ?? guild.slug)}`;

/** One pip per boss, filled in Blizzard's listing order for the bosses killed. */
export function RaidPips({ killed, total }: { killed: boolean[] | number; total: number }) {
  const t = useTranslations("forever.raids");
  const filled = typeof killed === "number" ? Array.from({ length: total }, (_, index) => index < killed) : killed;
  const count = filled.filter(Boolean).length;
  return <span className={styles.pips} role="img" aria-label={t("bosses", { killed: count, total })}>
    <span className={styles.pipRow} aria-hidden="true">{filled.map((on, index) => <i key={index} data-on={on || undefined} />)}</span>
    <b>{t("bosses", { killed: count, total })}</b>
  </span>;
}

/** An exact kill time, or the profile check that first showed the boss ("≈"). */
export function KillTime({ at, approximate, after, compact = false }: { at: string; approximate: boolean; after?: string | null; compact?: boolean }) {
  const t = useTranslations("forever.raids");
  if (!approximate) return <ForeverDate value={at} compact={compact} />;
  return <span className={styles.approximate} title={after ? t("approximateBetween", { after: formatForeverDate(after), at: formatForeverDate(at) }) : t("approximate")}>
    ≈ <ForeverDate value={at} compact={compact} />
  </span>;
}

export function BossCredit({ credit }: { credit: ForeverBossCredit | null }) {
  const t = useTranslations("forever.raids");
  if (!credit) return <span className={styles.muted}>{t("notKilled")}</span>;
  return <span className={styles.credit}><Link href={guildPath(credit.guild)}>‹{credit.guild.name}›</Link>
    <KillTime at={credit.at} approximate={credit.approximate} /></span>;
}

export function raidStatus(raid: Pick<ForeverRaidProgress, "opensAt">, now: number) {
  return raid.opensAt && Date.parse(`${raid.opensAt}T00:00:00Z`) > now ? "upcoming" : "open";
}

export function RaidMeta({ raid }: { raid: Pick<ForeverRaidProgress, "size" | "bossCount" | "opensAt" | "legacy" | "discovered"> }) {
  const t = useTranslations("forever.raids"), now = useNow({ updateInterval: 60_000 });
  const parts = [raid.size ? t("players", { count: raid.size }) : null, t("bossCount", { count: raid.bossCount }),
    raid.discovered ? t("discovered") : raid.legacy ? t("legacy") : null].filter(Boolean);
  return <p className={styles.raidMeta}>
    <span>{parts.join(" · ")}</span>
    {raid.opensAt && raidStatus(raid, now.getTime()) === "upcoming" && <span className={styles.status}>{t("opens", { date: formatForeverDate(`${raid.opensAt}T09:00:00Z`).split(" ")[0] })}</span>}
  </p>;
}

export function KillFeed({ kills }: { kills: ForeverKillEvent[] }) {
  const t = useTranslations("forever.raids");
  if (!kills.length) return <p className={styles.quiet}>{t("noRecent")}</p>;
  return <ol className={styles.feed}>{kills.map(kill => <li key={`${kill.instance}/${kill.boss}/${kill.at}`} className={styles.kill} data-raid={kill.raid || undefined}>
    <ForeverDate value={kill.at} />
    <div>
      <strong>{kill.clear ? t("fullClear") : kill.boss}<small>{kill.instance}</small></strong>{" "}
      {kill.guild ? <Link className={styles.guildLink} href={guildPath(kill.guild)}>‹{kill.guild.name}›</Link> : <span className={styles.muted}>{t("unassigned")}</span>}
    </div>
    <p className={styles.participants}>
      {kill.participants.slice(0, SHOWN).map(player => <Link key={player.id} href={foreverCharacterPath({ ...player, region: "eu", _id: player.id })}
        style={{ color: classColor(player.className ?? undefined) }}>{player.name}</Link>)}
      {kill.participants.length > SHOWN && <span>{t("more", { count: kill.participants.length - SHOWN })}</span>}
    </p>
  </li>)}</ol>;
}
