"use client";

import { useTranslations } from "next-intl";
import { LuArrowLeftRight, LuBadgePercent, LuBell, LuCrown, LuFerrisWheel, LuGift, LuHammer, LuPackageOpen, LuRecycle, LuScrollText, LuTrophy } from "react-icons/lu";
import type { District, Station } from "@/lib/figurine-world";
import { OverviewBack } from "./OverviewHud";
import styles from "./district-hud.module.css";

const ICONS: Partial<Record<Station, typeof LuGift>> = { crate: LuPackageOpen, quests: LuScrollText, wheel: LuFerrisWheel, recycler: LuRecycle, forge: LuHammer, trading: LuArrowLeftRight, mail: LuGift, merchant: LuBadgePercent, feed: LuBell, fame: LuCrown, leaderboard: LuTrophy };
export type DistrictOption = { station: Station; status: string; ready?: boolean };

// A district from the square: its name, and a card for each station with how it stands right now.
// Each card and its station in the world light up together.
export default function DistrictHud({ district, options, hovered, onOpen, onHover, onBack }: {
  district: District; options: DistrictOption[]; hovered: Station | District | null;
  onOpen: (station: Station) => void; onHover: (station: Station | null) => void; onBack: () => void;
}) {
  const t = useTranslations("figurineLab.world");
  return <>
    <h1 className={styles.title}>{t(`overview.labels.${district}`)}</h1>
    <nav className={styles.bar} aria-label={t(`overview.labels.${district}`)}>
      <OverviewBack inline onBack={onBack} />
      <div className={styles.options}>{options.map(({ station, status, ready }) => {
        const Icon = ICONS[station]!;
        return <button key={station} type="button" className={styles.option} data-ready={ready || undefined} data-highlighted={hovered === station || undefined}
          onClick={() => onOpen(station)} onPointerEnter={(event) => { if (event.pointerType !== "touch") onHover(station); }} onPointerLeave={() => onHover(null)} onFocus={() => onHover(station)} onBlur={() => onHover(null)}>
          <span className={styles.medal}><Icon aria-hidden="true" /></span>
          <span className={styles.text}><b>{t(`stations.${station}`)}</b><small>{status}</small></span>
        </button>;
      })}</div>
    </nav>
  </>;
}
