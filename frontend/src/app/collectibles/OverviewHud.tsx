"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LuArrowLeftRight, LuChartNoAxesColumnIncreasing, LuChevronLeft, LuChevronUp, LuFerrisWheel, LuFish, LuGift, LuHammer, LuLibrary, LuMail, LuPackageOpen, LuRecycle, LuScrollText, LuSparkles, LuStore, LuTrophy, LuUsers } from "react-icons/lu";
import type { Station, WorldView } from "@/lib/figurine-world";
import styles from "./overview-hud.module.css";

const LEFT = ["shop", "gallery", "pond", "crate", "wheel", "quests"] as const;
const RIGHT = ["recycler", "forge", "trading", "mail", "feed", "fame", "leaderboard"] as const;
const GROUPS = {
  community: ["trading", "mail", "feed", "fame", "leaderboard"],
  play: ["pond", "crate", "wheel", "quests"],
  collection: ["gallery", "shop"],
  craft: ["recycler", "forge"],
} as const;
type Group = keyof typeof GROUPS;
const GROUP_ICONS = { community: LuUsers, play: LuFish, collection: LuLibrary, craft: LuHammer };
const ICONS = { shop: LuStore, gallery: LuLibrary, pond: LuFish, crate: LuGift, wheel: LuFerrisWheel, quests: LuScrollText, recycler: LuRecycle, forge: LuHammer, trading: LuArrowLeftRight, mail: LuMail, feed: LuSparkles, fame: LuTrophy, leaderboard: LuChartNoAxesColumnIncreasing };

export default function OverviewHud({ onNavigate, onHover, hovered }: {
  onNavigate: (view: WorldView) => void;
  onHover: (view: Station | "opening" | null) => void;
  hovered: Station | null;
}) {
  const t = useTranslations("figurineLab");
  const bar = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<Group | null>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1101px)");
    const collapse = () => { if (desktop.matches) { setExpanded(null); onHover(null); } };
    desktop.addEventListener("change", collapse);
    return () => desktop.removeEventListener("change", collapse);
  }, [onHover]);
  const close = () => { setExpanded(null); onHover(null); };
  const linked = (view: Station | "opening") => ({
    onPointerEnter: () => onHover(view), onPointerLeave: () => onHover(null),
    onFocus: () => onHover(view), onBlur: () => onHover(null),
    onClick: () => { close(); onNavigate(view); },
  });
  const facility = (view: Station) => {
    const Icon = ICONS[view];
    const label = t(`world.overview.labels.${view}`);
    return <button key={view} type="button" className={styles.facility} data-highlighted={hovered === view} {...linked(view)}><Icon aria-hidden="true" /><span>{label}</span></button>;
  };
  const group = (name: Group) => {
    const Icon = GROUP_ICONS[name], open = expanded === name;
    return <div key={name} className={styles.group} data-group={name}>
      <button id={`facility-toggle-${name}`} type="button" className={styles.groupToggle} aria-expanded={open} aria-controls={`facilities-${name}`} onClick={() => { onHover(null); setExpanded(open ? null : name); }}>
        <Icon aria-hidden="true" /><span>{t(`world.overview.groups.${name}`)}</span><LuChevronUp className={styles.chevron} aria-hidden="true" />
      </button>
      <div id={`facilities-${name}`} className={styles.popup} data-open={open} inert={!open} aria-hidden={!open} role="region" aria-labelledby={`facility-toggle-${name}`}>{GROUPS[name].map(facility)}</div>
    </div>;
  };
  return <>
    <div className={styles.fade} aria-hidden="true" />
    {expanded && <button type="button" tabIndex={-1} className={styles.dismiss} aria-label={t("world.close")} onClick={close} />}
    <nav ref={bar} className={styles.bar} aria-label={t("world.overview.facilities")} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        bar.current?.querySelector<HTMLButtonElement>(`#facility-toggle-${expanded}`)?.focus();
        close();
      }
    }}>
    <div className={styles.wing}>{LEFT.map(facility)}</div>
    {group("community")}{group("play")}
    <button type="button" className={styles.opening} {...linked("opening")}><LuPackageOpen aria-hidden="true" /><span>{t("world.overview.openBoxes")}</span><small>{t("world.overview.boxCost")}</small></button>
    {group("collection")}{group("craft")}
    <div className={styles.wing}>{RIGHT.map(facility)}</div>
  </nav>
  </>;
}

export function OverviewBack({ onBack, disabled = false, inline = false }: { onBack: () => void; disabled?: boolean; inline?: boolean }) {
  const t = useTranslations("figurineLab.world.overview");
  return <button type="button" className={styles.back} data-inline={inline} disabled={disabled} onClick={onBack}><LuChevronLeft aria-hidden="true" />{t("back")}</button>;
}
