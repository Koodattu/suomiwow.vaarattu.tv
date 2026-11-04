"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LuArrowRight, LuHammer, LuPackageOpen, LuPlus, LuRecycle, LuX } from "react-icons/lu";
import { findFigure } from "@/lib/figurine-series";
import type { MachinePanel } from "./WorldPanels";
import Portrait from "./Portrait";
import styles from "./facility-overlay.module.css";

export default function Workshop({ machine }: { machine: MachinePanel }) {
  const t = useTranslations("figurineLab.world.overlays.workshop"), common = useTranslations("figurineLab");
  const [quality, setQuality] = useState("all");
  const forge = machine.kind === "forge", Icon = forge ? LuHammer : LuRecycle;
  const ready = machine.outcome.kind === "box" || machine.outcome.kind === "upgrade";
  const groups = machine.groups.filter(item => quality === "all" || item.quality === quality);
  const outcome = machine.outcome;
  const detail = outcome.kind === "keep" ? common("machineKeep") : outcome.kind === "mismatch" ? common("forgeMismatch")
    : outcome.kind === "upgrade" ? `${findFigure(outcome.key)?.character.name} · ${common(`quality.${outcome.quality}`)}`
      : outcome.kind === "box" ? common("machineBox") : t(forge ? "forgeRecipe" : "recycleRecipe");
  return <>
    <div className={styles.intro}><p>{t(forge ? "forgeBody" : "recycleBody")}</p><span className={styles.pill}>{t("loaded", { count: machine.slots.length })}</span></div>
    <div className={styles.recipe}>
      <div className={styles.slots}>{[0, 1, 2].map(index => { const item = machine.slots[index]; return <button type="button" key={index} className={styles.slot} disabled={!item || machine.busy} onClick={() => machine.onRemove(index)} aria-label={item ? t("remove", { name: findFigure(item.key)?.character.name ?? "" }) : t("slot", { number: index + 1 })}>
        {item ? <><Portrait figureKey={item.key} quality={item.quality} /><LuX className={styles.removeSlot} /></> : <><LuPlus /><span>{index + 1}</span></>}
      </button>; })}</div><LuArrowRight className={styles.recipeArrow} /><div className={styles.workshopResult}>{outcome.kind === "upgrade" ? <Portrait figureKey={outcome.key} quality={outcome.quality} /> : forge ? <LuHammer /> : <LuPackageOpen />}<span>{t(forge ? "upgrade" : "newBox")}</span></div>
    </div>
    <div className={styles.workshopAction}><div><b>{machine.busy ? t("working") : detail}</b><small>{t(forge ? "forgeProtection" : "recycleProtection")}</small></div><button type="button" className={styles.primary} disabled={machine.busy || !ready} onClick={machine.onRun}><Icon />{t(machine.busy ? "working" : forge ? "forge" : "recycle")}</button></div>
    <div className={styles.toolbar}><h3 className={styles.sectionTitle}>{t("yourFigures")}</h3><label className={styles.filter}><span>{common("world.overlays.quality")}</span><select value={quality} onChange={event => setQuality(event.target.value)}>{["all", "standard", "golden", "galaxy"].map(item => <option key={item} value={item}>{item === "all" ? common("world.overlays.all") : common(`quality.${item}`)}</option>)}</select></label></div>
    {groups.length ? <div className={styles.workshopGrid}>{groups.map(item => <button type="button" key={`${item.key}:${item.quality}`} className={styles.workshopFigure} disabled={machine.busy || item.spare < (forge ? 3 : 1) || (!forge && machine.slots.length === 3)} onClick={() => machine.onPick(item)}><Portrait figureKey={item.key} quality={item.quality} /><b>{findFigure(item.key)?.character.name}</b><span>{common(`quality.${item.quality}`)} · ×{item.spare}</span></button>)}</div>
      : <div className={styles.empty}><Icon /><p>{common(forge ? "forgeEmpty" : "machineEmpty")}</p></div>}
    {!!machine.slots.length && <button type="button" className={styles.secondary} disabled={machine.busy} onClick={machine.onClear}><LuX />{common("world.picker.clear")}</button>}
  </>;
}
