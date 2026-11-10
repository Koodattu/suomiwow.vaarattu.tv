"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LuArrowRight, LuHammer, LuPlus, LuRecycle, LuTrash2 } from "react-icons/lu";
import type { FigurineQuality } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { playFigurineCue } from "@/lib/figurine-audio";
import type { MachinePanel } from "./WorldPanels";
import { Action, Chips, Coin, Empty } from "./FacilityParts";
import Portrait from "./Portrait";
import frame from "./facility-overlay.module.css";
import styles from "./workshop.module.css";

const FINISHES = ["all", "standard", "golden", "galaxy"] as const;

// The workbench stands beside its machine: three slots that lead to what they make, one big
// button, and under them the tray of figures to load. A tap loads a figure, a tap on a slot takes
// it back, and running sends the cards from the slots into the machine itself.
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
  const detail = machine.busy ? t("working") : outcome.kind === "keep" ? common("machineKeep") : outcome.kind === "mismatch" ? common("forgeMismatch")
    : outcome.kind === "upgrade" ? `${findFigure(outcome.key)?.character.name} · ${common(`quality.${outcome.quality}`)}`
      : outcome.kind === "coin" ? t("newCoin") : t(forge ? "forgeRecipe" : "recycleRecipe");
  return <div className={styles.workshop} data-kind={machine.kind}>
    <section className={styles.bench} data-ready={ready || undefined}>
      <div className={styles.recipe}>
        {[0, 1, 2].map(index => { const item = machine.slots[index]; return <button type="button" key={index} ref={(element) => { slots.current[index] = element; }} className={styles.slot} data-filled={!!item} data-quality={item?.quality} disabled={!item || machine.busy} onClick={() => { playFigurineCue("pick"); machine.onRemove(index); }} aria-label={item ? t("remove", { name: findFigure(item.key)?.character.name ?? "" }) : t("slot", { number: index + 1 })}>
          {item ? <Portrait figureKey={item.key} quality={item.quality} /> : <LuPlus aria-hidden="true" />}
        </button>; })}
        <LuArrowRight className={styles.arrow} aria-hidden="true" />
        <div className={styles.result} data-quality={outcome.kind === "upgrade" ? outcome.quality : undefined}>{outcome.kind === "upgrade" ? <Portrait figureKey={outcome.key} quality={outcome.quality} /> : forge ? <LuHammer aria-hidden="true" /> : <Coin size={ready ? 58 : 44} />}</div>
      </div>
      <p className={styles.detail} aria-live="polite"><b>{detail}</b><small>{t(forge ? "forgeProtection" : "recycleProtection")}</small></p>
      <div className={styles.actions}>
        <Action disabled={machine.busy || !ready} onClick={run}><Icon />{t(forge ? "forge" : "recycle")}</Action>
        <button type="button" className={frame.secondary} disabled={machine.busy || !machine.slots.length} onClick={() => { playFigurineCue("pick"); machine.onClear(); }} aria-label={common("world.picker.clear")} title={common("world.picker.clear")}><LuTrash2 /></button>
      </div>
    </section>
    <section className={styles.tray}>
      <Chips values={FINISHES} value={finish} onChange={value => { playFigurineCue("pick"); setFinish(value); }} label={value => value === "all" ? common("world.overlays.all") : common(`quality.${value}`)} count={value => value === "all" ? machine.groups.length : machine.groups.filter(item => item.quality === value).length} />
      {groups.length ? <div className={`${styles.trayGrid} ${frame.scroll}`}>{groups.map(item => <button type="button" key={`${item.key}:${item.quality}`} className={styles.trayFigure} data-quality={item.quality} disabled={machine.busy || item.spare < (forge ? 3 : 1) || (!forge && machine.slots.length === 3)} onClick={() => { playFigurineCue("place"); machine.onPick(item); }}>
        <Portrait figureKey={item.key} quality={item.quality} /><b>{findFigure(item.key)?.character.name}</b><span className={frame.copies}>×{item.spare}</span>
      </button>)}</div> : <Empty icon={<Icon />} text={common(forge ? "forgeEmpty" : "machineEmpty")} />}
    </section>
  </div>;
}
