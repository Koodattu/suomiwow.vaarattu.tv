"use client";

import { useTranslations } from "next-intl";
import { LuArrowLeftRight, LuCalendarCheck, LuChevronLeft, LuFish, LuHammer, LuLibrary, LuPackageOpen, LuStore, LuTrophy } from "react-icons/lu";
import { districtOf, isStation, type District, type Station, type WorldView } from "@/lib/figurine-world";
import styles from "./overview-hud.module.css";

type Tile = "shop" | "pond" | "gallery" | District;
const LEFT: readonly Tile[] = ["shop", "pond", "fair", "yard"], RIGHT: readonly Tile[] = ["gallery", "market", "honours"];
const ICONS = { shop: LuStore, pond: LuFish, gallery: LuLibrary, fair: LuCalendarCheck, yard: LuHammer, market: LuArrowLeftRight, honours: LuTrophy };

export default function OverviewHud({ onNavigate, onHover, hovered, alerts }: {
  onNavigate: (view: WorldView) => void;
  onHover: (view: Tile | "opening" | null) => void;
  hovered: Station | District | null;
  alerts: Partial<Record<Tile, boolean>>;
}) {
  const t = useTranslations("figurineLab");
  const lit = hovered && isStation(hovered) ? districtOf(hovered) ?? hovered : hovered;
  const linked = (view: Tile | "opening") => ({
    onPointerEnter: () => onHover(view), onPointerLeave: () => onHover(null),
    onFocus: () => onHover(view), onBlur: () => onHover(null),
    onClick: () => { onHover(null); onNavigate(view); },
  });
  const tile = (view: Tile) => {
    const Icon = ICONS[view];
    return <button key={view} type="button" className={styles.tile} data-tile={view} data-highlighted={lit === view} data-alert={alerts[view] || undefined} {...linked(view)}><Icon aria-hidden="true" /><span>{t(`world.overview.labels.${view}`)}</span></button>;
  };
  return <>
    <div className={styles.fade} aria-hidden="true" />
    <nav className={styles.bar} aria-label={t("world.overview.facilities")}>
      <div className={styles.wing}>{LEFT.map(tile)}</div>
      <button type="button" className={styles.opening} {...linked("opening")}><LuPackageOpen aria-hidden="true" /><span>{t("world.overview.openBoxes")}</span><small>{t("world.overview.boxCost")}</small></button>
      <div className={styles.wing}>{RIGHT.map(tile)}</div>
    </nav>
  </>;
}

export function OverviewBack({ onBack, disabled = false, inline = false }: { onBack: () => void; disabled?: boolean; inline?: boolean }) {
  const t = useTranslations("figurineLab.world.overview");
  return <button type="button" className={styles.back} data-inline={inline} disabled={disabled} onClick={onBack} aria-label={t("back")}><LuChevronLeft aria-hidden="true" /><span>{t("back")}</span></button>;
}
