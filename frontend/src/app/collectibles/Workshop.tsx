"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LuArrowRight, LuHammer, LuPlus, LuRecycle, LuX } from "react-icons/lu";
import type { FigurineQuality } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import type { MachinePanel } from "./WorldPanels";
import { Action, Chips, Coin, Empty } from "./FacilityParts";
import Portrait from "./Portrait";
import styles from "./facility-overlay.module.css";

const FINISHES = ["all", "standard", "golden", "galaxy"] as const;

// The bench and the tray side by side: three slots leading to what they make, and the figures to load.
export default function Workshop({ machine }: { machine: MachinePanel }) {
  const t = useTranslations("figurineLab.world.overlays.workshop"), common = useTranslations("figurineLab");
  const [finish, setFinish] = useState<"all" | FigurineQuality>("all");
  const slots = useRef<(HTMLButtonElement | null)[]>([]);
  // The machine takes over from these slots: its cards fly out from exactly where they are.
  const run = () => machine.onRun(slots.current.flatMap((slot) => {
    if (!slot) return [];
    const { left, top, width, height } = slot.getBoundingClientRect();
    return [{ x: 2 * (left + width / 2) / window.innerWidth - 1, y: 1 - 2 * (top + height / 2) / window.innerHeight, width: 2 * width / window.innerWidth }];
  }));
  const forge = machine.kind === "forge", Icon = forge ? LuHammer : LuRecycle;
  const outcome = machine.outcome, ready = outcome.kind === "coin" || outcome.kind === "upgrade";
  const groups = machine.groups.filter(item => finish === "all" || item.quality === finish);
  const detail = outcome.kind === "keep" ? common("machineKeep") : outcome.kind === "mismatch" ? common("forgeMismatch")
    : outcome.kind === "upgrade" ? `${findFigure(outcome.key)?.character.name} · ${common(`quality.${outcome.quality}`)}`
      : outcome.kind === "coin" ? t("newCoin") : t(forge ? "forgeRecipe" : "recycleRecipe");
  return <div className={styles.workshop}>
    <section className={styles.bench} data-ready={ready}>
      <div className={styles.recipe}>
        <div className={styles.slots}>{[0, 1, 2].map(index => { const item = machine.slots[index]; return <button type="button" key={index} ref={(element) => { slots.current[index] = element; }} className={styles.slot} data-filled={!!item} disabled={!item || machine.busy} onClick={() => machine.onRemove(index)} aria-label={item ? t("remove", { name: findFigure(item.key)?.character.name ?? "" }) : t("slot", { number: index + 1 })}>
          {item ? <><Portrait figureKey={item.key} quality={item.quality} /><LuX className={styles.removeSlot} /></> : <LuPlus />}
        </button>; })}</div>
        <LuArrowRight className={styles.recipeArrow} aria-hidden="true" />
        <div className={styles.result}>{outcome.kind === "upgrade" ? <Portrait figureKey={outcome.key} quality={outcome.quality} /> : forge ? <LuHammer aria-hidden="true" /> : <Coin size={ready ? 76 : 56} />}</div>
      </div>
      <div className={styles.benchText}><b>{machine.busy ? t("working") : detail}</b><small>{t(forge ? "forgeProtection" : "recycleProtection")}</small></div>
      <div className={styles.benchActions}>
        <Action disabled={machine.busy || !ready} onClick={run}><Icon />{t(machine.busy ? "working" : forge ? "forge" : "recycle")}</Action>
        <button type="button" className={styles.secondary} disabled={machine.busy || !machine.slots.length} onClick={machine.onClear} aria-label={common("world.picker.clear")} title={common("world.picker.clear")}><LuX /></button>
      </div>
    </section>
    <section className={styles.tray}>
      <Chips values={FINISHES} value={finish} onChange={setFinish} label={value => value === "all" ? common("world.overlays.all") : common(`quality.${value}`)} count={value => value === "all" ? machine.groups.length : machine.groups.filter(item => item.quality === value).length} />
      {groups.length ? <div className={styles.trayGrid}>{groups.map(item => <button type="button" key={`${item.key}:${item.quality}`} className={styles.trayFigure} data-quality={item.quality} disabled={machine.busy || item.spare < (forge ? 3 : 1) || (!forge && machine.slots.length === 3)} onClick={() => machine.onPick(item)}>
        <Portrait figureKey={item.key} quality={item.quality} /><b>{findFigure(item.key)?.character.name}</b><span className={styles.copies}>×{item.spare}</span>
      </button>)}</div> : <Empty icon={<Icon />} text={common(forge ? "forgeEmpty" : "machineEmpty")} />}
    </section>
  </div>;
}
