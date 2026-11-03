"use client";

import { useTranslations } from "next-intl";
import { LuArrowLeftRight, LuChartNoAxesColumnIncreasing, LuChevronLeft, LuFerrisWheel, LuFish, LuGift, LuHammer, LuLibrary, LuMail, LuPackageOpen, LuRecycle, LuScrollText, LuSparkles, LuStore, LuTrophy } from "react-icons/lu";
import type { Station, WorldView } from "@/lib/figurine-world";
import styles from "./overview-hud.module.css";

const LEFT = ["shop", "gallery", "pond", "crate", "wheel", "quests"] as const;
const RIGHT = ["recycler", "forge", "trading", "mail", "feed", "fame", "leaderboard"] as const;
const ICONS = { shop: LuStore, gallery: LuLibrary, pond: LuFish, crate: LuGift, wheel: LuFerrisWheel, quests: LuScrollText, recycler: LuRecycle, forge: LuHammer, trading: LuArrowLeftRight, mail: LuMail, feed: LuSparkles, fame: LuTrophy, leaderboard: LuChartNoAxesColumnIncreasing };

export default function OverviewHud({ onNavigate, onHover, hovered }: {
  onNavigate: (view: WorldView) => void;
  onHover: (view: Station | "opening" | null) => void;
  hovered: Station | null;
}) {
  const t = useTranslations("figurineLab");
  const linked = (view: Station | "opening") => ({
    onPointerEnter: () => onHover(view), onPointerLeave: () => onHover(null),
    onFocus: () => onHover(view), onBlur: () => onHover(null),
    onClick: () => onNavigate(view),
  });
  const facility = (view: Station) => {
    const Icon = ICONS[view];
    const label = t(`world.overview.labels.${view}`);
    return <button key={view} type="button" className={styles.facility} data-highlighted={hovered === view} {...linked(view)}><Icon aria-hidden="true" /><span>{label}</span></button>;
  };
  return <nav className={styles.bar} aria-label={t("world.overview.facilities")}>
    <div className={styles.wing}>{LEFT.map(facility)}</div>
    <button type="button" className={styles.opening} {...linked("opening")}><LuPackageOpen aria-hidden="true" /><span>{t("world.overview.openBoxes")}</span><small>{t("world.overview.boxCost")}</small></button>
    <div className={styles.wing}>{RIGHT.map(facility)}</div>
  </nav>;
}

export function OverviewBack({ onBack, disabled }: { onBack: () => void; disabled: boolean }) {
  const t = useTranslations("figurineLab.world.overview");
  return <button type="button" className={styles.back} disabled={disabled} onClick={onBack}><LuChevronLeft aria-hidden="true" />{t("back")}</button>;
}
