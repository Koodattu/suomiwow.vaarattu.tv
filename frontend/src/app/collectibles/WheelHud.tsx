"use client";

import { useFormatter, useTranslations } from "next-intl";
import { LuFerrisWheel, LuSparkles } from "react-icons/lu";
import { findFigure } from "@/lib/figurine-series";
import type { PanelResult } from "./WorldPanels";
import { Coin } from "./FacilityParts";
import { OverviewBack } from "./OverviewHud";
import Portrait from "./Portrait";
import controls from "./pond-hud.module.css";
import styles from "./chest-hud.module.css";

const PRIZES = ["coin1", "coin2", "coin3", "golden", "galaxy", "figure"] as const;

// The wheel stays in full view: what it can land on, and one big button, over the world.
export default function WheelHud({ ready, busy, turn, now, result, onSpin, onDismiss, onBack }: {
  ready: boolean; busy: boolean; turn: Date; now: Date; result: Extract<PanelResult, { station: "wheel" }> | null;
  onSpin: () => void; onDismiss: () => void; onBack: () => void;
}) {
  const t = useTranslations("figurineLab.world.wheel"), p = useTranslations("figurineLab.world.overlays"), common = useTranslations("figurineLab"), format = useFormatter();
  const won = result && (result.reward.coins ? common("world.rewards.coins", { count: result.reward.coins }) : result.figure ? findFigure(result.figure.key)?.character.name : result.reward.boost ? common("world.rewards.boost", { quality: common(`quality.${result.reward.boost}`) }) : "");
  return <>
    <div className={styles.title}><h1>{common("world.stations.wheel")}</h1></div>
    {result ? <>
      <button type="button" className={controls.catchDismiss} onClick={onDismiss} aria-label={common("world.crate.dismissReward")} />
      <div className={`${controls.banner} ${styles.wheelBanner}`} data-quality={result.figure?.quality} role="status">
        {result.figure && <span className={controls.bannerPortrait}><Portrait figureKey={result.figure.key} quality={result.figure.quality} /></span>}
        <div><small>{t("wonLabel")}</small><b>{won}</b><span>{common("world.crate.dismissReward")}</span></div>
      </div>
    </> : <div className={styles.reward}>{ready || busy ? <ul className={styles.prizes}>{PRIZES.map(prize => <li key={prize} data-prize={prize}>{prize.startsWith("coin") ? <Coin size={18} /> : <LuSparkles aria-hidden="true" />}{t(`prizes.${prize}`)}</li>)}</ul>
      : <small>{t("next", { time: format.relativeTime(turn, now) })}</small>}</div>}
    <nav className={controls.bar} aria-label={common("world.stations.wheel")}>
      <div className={controls.left}><OverviewBack inline onBack={onBack} /></div>
      <button type="button" className={`${controls.action} ${styles.action}`} disabled={busy || !ready} onClick={onSpin}><LuFerrisWheel className={controls.glyph} aria-hidden="true" />{busy ? t("spinning") : ready ? t("spin") : p("wheel.used")}</button>
      <div className={controls.right} />
    </nav>
  </>;
}
