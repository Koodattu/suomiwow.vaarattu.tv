"use client";

import { useFormatter, useTranslations } from "next-intl";
import { LuFerrisWheel } from "react-icons/lu";
import { WHEEL } from "@/lib/figurine-collection";
import { Coin } from "./FacilityParts";
import { OverviewBack } from "./OverviewHud";
import controls from "./pond-hud.module.css";
import styles from "./chest-hud.module.css";

// The wheel's eight segments in order, as the reel under it shows them.
export const WHEEL_PRIZES = WHEEL.map(({ prize }) => "boost" in prize ? prize.boost : "figure" in prize ? "figure" as const : `coin${prize.coins}` as const);

// The wheel stays in full view. Under it runs a reel of its eight segments that follows the real
// wheel peg by peg: whichever is under the pointer is lit, and the one it stops on stays lit.
export default function WheelHud({ ready, busy, turn, now, at, onSpin, onBack }: {
  ready: boolean; busy: boolean; turn: Date; now: Date; at: number | null; onSpin: () => void; onBack: () => void;
}) {
  const t = useTranslations("figurineLab.world.wheel"), common = useTranslations("figurineLab"), format = useFormatter();
  return <>
    <div className={styles.title}><h1>{common("world.stations.wheel")}</h1></div>
    <div className={styles.reward}>
      <ol className={styles.reel} data-spinning={busy || undefined} data-spent={!ready && !busy && at === null || undefined}>{WHEEL_PRIZES.map((prize, index) =>
        <li key={index} data-prize={prize} data-at={at === index || undefined} data-won={at === index && !busy || undefined} title={t(`prizes.${prize}`)}>
          {prize === "figure" ? "?" : prize === "golden" ? "★" : prize === "galaxy" ? "✦" : <><Coin size={16} />{prize.slice(4)}</>}
        </li>)}</ol>
      <p className={styles.reelName} aria-live="polite">{at !== null ? t(`prizes.${WHEEL_PRIZES[at]}`) : !ready && !busy ? t("next", { time: format.relativeTime(turn, now) }) : " "}</p>
    </div>
    <nav className={controls.bar} aria-label={common("world.stations.wheel")}>
      <div className={controls.left}><OverviewBack inline onBack={onBack} /></div>
      <button type="button" className={`${controls.action} ${styles.action}`} data-ready={ready && !busy || undefined} disabled={busy || !ready} onClick={onSpin}><LuFerrisWheel className={controls.glyph} aria-hidden="true" />{busy ? t("spinning") : ready ? t("spin") : common("world.overlays.wheel.used")}</button>
      <div className={controls.right} />
    </nav>
  </>;
}
