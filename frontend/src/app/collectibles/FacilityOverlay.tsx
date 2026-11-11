"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import { useTranslations } from "next-intl";
import { LuArrowLeftRight, LuBadgePercent, LuBell, LuCrown, LuGift, LuHammer, LuRecycle, LuScrollText, LuTrophy, LuX } from "react-icons/lu";
import type { FigurineCollection, FigurineRecords, QuestPeriod } from "@/lib/figurine-collection";
import type { PreviewAction, PreviewState } from "@/lib/figurine-community-preview";
import type { OverlayStation } from "@/lib/figurine-facility-views";
import { playFigurineCue } from "@/lib/figurine-audio";
import type { MachinePanel, PanelActions, PanelSeries } from "./WorldPanels";
import { HeaderSlot } from "./FacilityParts";
import TradingPost, { type TradingState } from "./TradingPost";
import { Fame, Feed, Rankings } from "./Honours";
import Mailbox from "./Mailbox";
import Quests from "./Quests";
import Workshop from "./Workshop";
import styles from "./facility-overlay.module.css";

type Props = {
  view: Exclude<OverlayStation, "wheel">; collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[];
  machine?: MachinePanel; away?: boolean; trading: TradingState; actions: PanelActions; preview: PreviewState; dispatch: Dispatch<PreviewAction>; onClose: () => void;
};
const ICONS = { merchant: LuBadgePercent, recycler: LuRecycle, forge: LuHammer, quests: LuScrollText, trading: LuArrowLeftRight, mail: LuGift, feed: LuBell, fame: LuCrown, leaderboard: LuTrophy };
// What these show is invented for now, and says so.
const SAMPLE = ["trading", "mail", "feed", "fame", "leaderboard"];

// One frame holds every facility, in the middle of the dimmed world: each has its own material and
// size (see the stylesheet),
// and none resizes while it is open. What is inside lays out to the frame and scrolls in its own
// columns.
export default function FacilityOverlay(props: Props) {
  const { view, onClose } = props;
  const t = useTranslations("figurineLab.world"), p = useTranslations("figurineLab.world.overlays");
  const title = useRef<HTMLHeadingElement>(null), [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); playFigurineCue("open"); return () => { playFigurineCue("close"); }; }, [view]);
  const Icon = ICONS[view], workshop = view === "recycler" || view === "forge";
  const complete = props.series.some(entry => entry.released && entry.keys.length && entry.keys.every(key => props.collection[key]));
  return <div className={styles.layer} data-facility={view} data-away={props.away || undefined} inert={props.away}>
    <aside className={styles.panel} aria-labelledby="facility-title" key={view}>
      <header className={styles.header}>
        <span className={styles.emblem}><Icon aria-hidden="true" /></span>
        <h2 id="facility-title" ref={title} tabIndex={-1}>{t(`stations.${view}`)}</h2>
        {SAMPLE.includes(view) && <span className={styles.sample} title={p("preview")}>{p("sample")}</span>}
        <div className={styles.headerExtra} ref={setSlot} />
        <button className={styles.iconButton} type="button" onClick={onClose} aria-label={t("close")}><LuX /></button>
      </header>
      <HeaderSlot.Provider value={slot}>
        <div className={styles.body}>
          {view === "quests" && <Quests records={props.records} complete={complete} actions={props.actions} />}
          {(view === "trading" || view === "merchant") && <TradingPost npc={view === "merchant"} trading={props.trading} collection={props.collection} balance={props.records.boons.coins} />}
          {workshop && props.machine && <Workshop machine={props.machine} />}
          {view === "mail" && <Mailbox preview={props.preview} dispatch={props.dispatch} />}
          {view === "feed" && <Feed preview={props.preview} dispatch={props.dispatch} records={props.records} now={props.actions.now} />}
          {view === "fame" && <Fame />}
          {view === "leaderboard" && <Rankings collection={props.collection} records={props.records} />}
        </div>
      </HeaderSlot.Provider>
    </aside>
  </div>;
}

export function nextTurn(period: QuestPeriod, now: Date) {
  if (period === "daily") return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === "weekly") return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8 - (now.getDay() || 7));
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
