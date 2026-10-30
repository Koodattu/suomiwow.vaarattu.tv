"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { getFigurineAudioSettings, setFigurineAudioSettings, unlockFigurineAudio, type FigurineAudioSettings } from "@/lib/figurine-audio";
import styles from "../figurine-lab/figurine-lab.module.css";

// Saved settings as an external store: read once on the client, none during server rendering.
const listeners = new Set<() => void>();
let current: FigurineAudioSettings | null = null;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const readSettings = () => (current ??= getFigurineAudioSettings());
const save = (next: Partial<FigurineAudioSettings>) => { current = setFigurineAudioSettings(next); listeners.forEach((listener) => listener()); };

// A quiet speaker button that opens sound settings: everything, and the figures' voice lines apart.
export default function SoundMenu() {
  const t = useTranslations("figurineLab");
  const settings = useSyncExternalStore(subscribe, readSettings, () => null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    // Captured first, so Escape closes the panel without also stepping back in the world.
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    window.addEventListener("pointerdown", outside, true); window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape, true); };
  }, [open]);
  const update = (next: Partial<FigurineAudioSettings>) => { unlockFigurineAudio(); save(next); };
  const silent = settings ? settings.muted || settings.volume === 0 : false;

  return <div ref={root} className={styles.soundMenu}>
    <button type="button" className={styles.soundButton} aria-expanded={open} aria-controls={panelId} onClick={() => { unlockFigurineAudio(); setOpen(!open); }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />{silent ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}</svg>
      <span>{t("soundMenu")}</span>
    </button>
    {open && settings && <div id={panelId} className={styles.soundPanel} role="group" aria-label={t("soundMenu")}>
      <SoundRow label={t("soundAll")} on={!settings.muted} volume={settings.volume} volumeLabel={t("soundVolume", { name: t("soundAll") })}
        onToggle={() => update({ muted: !settings.muted })} onVolume={(volume) => update({ volume, muted: false })} />
      <SoundRow label={t("soundQuips")} on={!settings.quipsMuted} volume={settings.quipVolume} volumeLabel={t("soundVolume", { name: t("soundQuips") })} dimmed={settings.muted}
        onToggle={() => update({ quipsMuted: !settings.quipsMuted })} onVolume={(quipVolume) => update({ quipVolume, quipsMuted: false })} />
    </div>}
  </div>;
}

function SoundRow({ label, on, volume, volumeLabel, dimmed = false, onToggle, onVolume }: { label: string; on: boolean; volume: number; volumeLabel: string; dimmed?: boolean; onToggle: () => void; onVolume: (volume: number) => void }) {
  return <div className={styles.soundRow} data-off={!on || dimmed}>
    <span>{label}</span>
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={styles.soundSwitch} onClick={onToggle} />
    <input type="range" min={0} max={100} step={1} value={Math.round(volume * 100)} aria-label={volumeLabel} aria-valuetext={`${Math.round(volume * 100)} %`}
      onChange={(event) => onVolume(Number(event.target.value) / 100)} />
  </div>;
}
