"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { QUALITIES, SHOWCASE_SLOTS, acquiredId, bestQuality, copiesOf, showcaseFigure, type FigurineCollection, type FigurineQuality, type FigurineRecords, type MachineItem } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { portraitStyle } from "@/lib/figurine-portraits";
import type { Station } from "@/lib/figurine-world";
import styles from "./world-panels.module.css";

// The world's panels: what a station offers once the camera is there. Lists are images (baked
// portrait sheets), so they stay quick however many figures and series there are; the world stays
// in view beside or above them. Stations not open yet show what they will do.
export type PanelSeries = { id: string; number: string; released: boolean; hidden?: boolean; keys: string[] };
export type MachinePanel = { kind: "recycler" | "forge"; slots: MachineItem[]; groups: (MachineItem & { spare: number })[]; onPick: (item: MachineItem) => void; onClear: () => void };
type Props = {
  view: Station; collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[];
  onClose: () => void; onInspect: (key: string, quality: FigurineQuality) => void; onShowcase: (slot: number, item: MachineItem | null) => void;
  machine?: MachinePanel;
};

// A figure's baked portrait, finished like its quality: gold toned, or a nebula through its outline.
export function Portrait({ figureKey, quality, locked = false, className }: { figureKey: string; quality?: FigurineQuality | null; locked?: boolean; className?: string }) {
  const found = findFigure(figureKey);
  if (!found) return <span className={`${styles.portrait} ${className ?? ""}`} />;
  const sprite = portraitStyle(found.series.id, found.series.characters.indexOf(found.character), found.series.characters.length);
  const vars = { ...sprite, "--sprite": sprite.backgroundImage, "--size": sprite.backgroundSize, "--pos": sprite.backgroundPosition } as CSSProperties;
  return <span className={`${styles.portrait} ${className ?? ""}`} style={vars} data-quality={locked ? undefined : quality ?? undefined} data-locked={locked} role="img" aria-label={found.character.name} />;
}

export default function WorldPanel(props: Props) {
  const t = useTranslations("figurineLab.world");
  const { view, onClose, machine } = props;
  if (view === "shop") return null;
  const title = machine ? t(`picker.${machine.kind}`) : t(`stations.${view as Exclude<Station, "shop" | "recycler" | "forge">}`);
  return <aside className={styles.panel} data-wide={view === "gallery"} aria-label={title}>
    <header className={styles.head}>
      <h2>{title}</h2>
      <button type="button" className={styles.close} onClick={onClose} aria-label={t("close")}>×</button>
    </header>
    <div className={styles.body}>
      {machine ? <MachinePicker {...props} machine={machine} />
        : view === "gallery" ? <CollectionPanel {...props} />
        : <Placeholder {...props} />}
    </div>
  </aside>;
}

function SeriesChips({ series, value, onChange, all }: { series: PanelSeries[]; value: string | null; onChange: (id: string | null) => void; all?: string }) {
  const t = useTranslations("figurineLab");
  return <div className={styles.chips} role="tablist">
    {all && <button type="button" role="tab" aria-selected={value === null} onClick={() => onChange(null)}>{all}</button>}
    {series.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={value === entry.id} data-upcoming={!entry.released} data-secret={entry.hidden} onClick={() => onChange(entry.id)}>
      {entry.hidden ? "★ " : ""}{t("seriesName", { number: entry.number })}
    </button>)}
  </div>;
}

function CollectionPanel({ collection, records, series, onInspect, onShowcase }: Props) {
  const t = useTranslations("figurineLab");
  const format = useFormatter();
  const [tab, setTab] = useState<"figures" | "showcase">("figures");
  const [seriesId, setSeriesId] = useState<string>(series.find((entry) => entry.released)?.id ?? series[0]?.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<MachineItem | null>(null);
  const shown = series.find((entry) => entry.id === seriesId) ?? series[0];
  const figure = selected ? findFigure(selected) : null;
  const best = selected ? bestQuality(collection[selected]) : null;
  const spotOf = (key: string) => records.showcase.findIndex((entry) => entry?.key === key);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const got = shown ? shown.keys.filter((key) => collection[key]).length : 0;

  return <>
    <div className={styles.tabs} role="tablist">
      {(["figures", "showcase"] as const).map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => { setTab(name); setPlacing(null); }}>{t(`world.collection.${name}`)}</button>)}
    </div>
    {tab === "figures" ? <>
      <SeriesChips series={series} value={seriesId} onChange={(id) => { if (id) { setSeriesId(id); setSelected(null); } }} />
      {shown && !shown.released ? <p className={styles.note}>{t("world.collection.upcoming", { number: shown.number })}</p> : <>
        <p className={styles.meta}>{shown?.hidden ? `${t("world.collection.secret")} · ` : ""}{t("world.collection.owned", { got, total: shown?.keys.length ?? 0 })}</p>
        <div className={styles.grid}>
          {shown?.keys.map((key) => {
            const owned = bestQuality(collection[key]);
            return <button key={key} type="button" className={styles.card} aria-pressed={selected === key} onClick={() => setSelected(key)}>
              <Portrait figureKey={key} quality={owned} locked={!owned} />
              <span className={styles.name}>{owned ? findFigure(key)?.character.name : "?"}</span>
              {owned && <span className={styles.count}>×{copiesOf(collection[key])}</span>}
              {spotOf(key) >= 0 && <span className={styles.spot}>{spotOf(key) + 1}</span>}
            </button>;
          })}
        </div>
        {figure && selected && <div className={styles.detail}>
          <Portrait figureKey={selected} quality={best} locked={!best} className={styles.detailPortrait} />
          <div>
            <h3>{best ? figure.character.name : t("world.collection.locked")}</h3>
            {best ? <>
              <ul className={styles.qualities}>
                {QUALITIES.filter((quality) => collection[selected]?.[quality]).map((quality) => <li key={quality} data-quality={quality}>
                  <b>{t(`quality.${quality}`)} ×{collection[selected]![quality]}</b>
                  {records.acquired[acquiredId(selected, quality)] && <span>{t("world.collection.acquired", { date: date(records.acquired[acquiredId(selected, quality)]) })}</span>}
                </li>)}
              </ul>
              <div className={styles.actions}>
                <button type="button" onClick={() => onInspect(selected, best)}>{t("world.collection.inspect")}</button>
                {spotOf(selected) >= 0
                  ? <button type="button" onClick={() => onShowcase(spotOf(selected), null)}>{t("world.collection.remove")} ({spotOf(selected) + 1})</button>
                  : <button type="button" onClick={() => { setPlacing({ key: selected, quality: best }); setTab("showcase"); }}>{t("world.collection.place")}</button>}
              </div>
            </> : null}
          </div>
        </div>}
      </>}
    </> : <>
      <p className={styles.note}>{placing ? t("world.collection.pickSpot", { name: findFigure(placing.key)?.character.name ?? "" }) : t("world.collection.showcaseHint")}</p>
      <div className={styles.showcase}>
        {Array.from({ length: SHOWCASE_SLOTS }, (_, slot) => {
          const entry = showcaseFigure(records.showcase[slot], collection);
          return <button key={slot} type="button" className={styles.slot} data-placing={!!placing} onClick={() => {
            if (placing) { onShowcase(slot, placing); setPlacing(null); }
            else if (entry) { setTab("figures"); setSeriesId(entry.key.split(":")[0]); setSelected(entry.key); }
          }}>
            {entry ? <Portrait figureKey={entry.key} quality={entry.quality} /> : <span className={styles.empty}>{t("world.collection.emptySpot")}</span>}
            <span className={styles.slotNumber}>{slot + 1}</span>
          </button>;
        })}
      </div>
    </>}
  </>;
}

function MachinePicker({ machine, series }: Props & { machine: MachinePanel }) {
  const t = useTranslations("figurineLab");
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const groups = machine.groups.filter((group) => !seriesId || group.key.startsWith(`${seriesId}:`));
  const used = new Set(machine.groups.map((group) => group.key.split(":")[0]));
  return <>
    <div className={styles.machineHead}>
      <span>{t("world.picker.loaded", { count: machine.slots.length })}</span>
      {machine.slots.length > 0 && <button type="button" onClick={machine.onClear}>{t("world.picker.clear")}</button>}
    </div>
    {used.size > 1 && <SeriesChips series={series.filter((entry) => used.has(entry.id))} value={seriesId} onChange={setSeriesId} all={t("world.picker.all")} />}
    {groups.length ? <div className={styles.grid} data-dense>
      {groups.map((group) => <button key={`${group.key}|${group.quality}`} type="button" className={styles.card} disabled={group.spare < 1} onClick={() => machine.onPick(group)}>
        <Portrait figureKey={group.key} quality={group.quality} />
        <span className={styles.name}>{findFigure(group.key)?.character.name}</span>
        <span className={styles.count} data-quality={group.quality}>{t("world.picker.spare", { count: group.spare })}</span>
      </button>)}
    </div> : <p className={styles.note}>{t(machine.kind === "forge" ? "forgeEmpty" : "machineEmpty")}</p>}
  </>;
}

// Stations not open yet: what they will do, and a look at it with what this session already knows.
function Placeholder({ view, collection, records, series }: Props) {
  const t = useTranslations("figurineLab");
  const format = useFormatter();
  const owned = Object.keys(collection);
  const count = (quality: FigurineQuality) => owned.filter((key) => collection[key][quality]).length;
  const complete = useMemo(() => series.some((entry) => entry.released && entry.keys.length && entry.keys.every((key) => collection[key])), [series, collection]);
  const soon = <button type="button" className={styles.primary} disabled>{t("comingSoon")}</button>;
  const firstAt = (quality: FigurineQuality) => Object.entries(records.acquired).filter(([id]) => id.endsWith(`|${quality}`)).map(([, at]) => at).sort()[0];
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  if (view === "crate") return <>
    <p className={styles.note}>{t("world.crate.body")}</p>
    <ol className={styles.streak}>{Array.from({ length: 7 }, (_, day) => <li key={day} data-today={day === 0}>{t("world.crate.day", { day: day + 1 })}</li>)}</ol>
    {soon}
  </>;
  if (view === "wheel") return <>
    <p className={styles.note}>{t("world.wheel.body")}</p>
    <ul className={styles.prizes}>{(["box", "double", "golden", "galaxy", "surprise"] as const).map((prize) => <li key={prize} data-prize={prize}>{t(`world.wheel.prizes.${prize}`)}</li>)}</ul>
    {soon}
  </>;
  if (view === "mail") return <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
    <p className={styles.note}>{t("world.mail.body")}</p>
    <label>{t("world.mail.figure")}<select defaultValue=""><option value="" disabled>{t("world.mail.choose")}</option>{owned.map((key) => <option key={key} value={key}>{findFigure(key)?.character.name ?? key}</option>)}</select></label>
    <label>{t("world.mail.recipient")}<input placeholder={t("world.mail.recipientPlaceholder")} /></label>
    <label>{t("world.mail.message")}<textarea rows={3} placeholder={t("world.mail.messagePlaceholder")} /></label>
    <button type="submit" className={styles.primary} disabled>{t("world.mail.send")} · {t("comingSoon")}</button>
  </form>;
  if (view === "quests") {
    const { opened, recycled, tradedUp } = records.stats;
    const galaxy = count("galaxy") > 0 ? 1 : 0;
    const quests = {
      daily: [["open3", opened, 3, 1], ["recycle1", recycled, 1, 1], ["tradeUp1", tradedUp, 1, 1]],
      weekly: [["open20", opened, 20, 3], ["recycle5", recycled, 5, 2], ["tradeUp3", tradedUp, 3, 2]],
      monthly: [["open60", opened, 60, 8], ["galaxy", galaxy, 1, 5], ["series", complete ? 1 : 0, 1, 5]],
    } as const;
    return <>
      <p className={styles.note}>{t("world.quests.body")}</p>
      {(Object.keys(quests) as (keyof typeof quests)[]).map((period) => <section key={period} className={styles.quests}>
        <h3>{t(`world.quests.${period}`)}</h3>
        {quests[period].map(([id, progress, goal, reward]) => <div key={id} className={styles.quest}>
          <span>{t(`world.quests.items.${id}`)}</span>
          <span className={styles.bar}><i style={{ width: `${Math.min(1, progress / goal) * 100}%` }} /></span>
          <small>{Math.min(progress, goal)}/{goal} · {t("world.quests.reward", { count: reward })}</small>
        </div>)}
      </section>)}
      {soon}
    </>;
  }
  if (view === "feed") return <>
    <p className={styles.note}>{t("world.feed.body")}</p>
    {records.feed.length ? <ul className={styles.feed}>{records.feed.map((pull) => <li key={`${pull.at}|${pull.key}`}>
      <Portrait figureKey={pull.key} quality={pull.quality} className={styles.feedPortrait} />
      <div><b>{findFigure(pull.key)?.character.name}</b><span data-quality={pull.quality}>{t(`quality.${pull.quality}`)}</span>
        <small>{t("world.feed.you")} · {t(pull.source === "forge" ? "world.feed.fromForge" : "world.feed.fromBox")} · {format.relativeTime(new Date(pull.at))}</small></div>
    </li>)}</ul> : <p className={styles.meta}>{t("world.feed.empty")}</p>}
  </>;
  if (view === "fame") {
    const secret = series.find((entry) => entry.hidden && entry.keys.some((key) => collection[key]));
    const firstSecret = secret ? secret.keys.map((key) => records.acquired[acquiredId(key, bestQuality(collection[key]) ?? "standard")]).filter(Boolean).sort()[0] : undefined;
    const items: [string, string | undefined][] = [["galaxy", firstAt("galaxy")], ["complete", undefined], ["secret", firstSecret], ["goldenSeries", undefined]];
    return <>
      <p className={styles.note}>{t("world.fame.body")}</p>
      <ul className={styles.board}>{items.map(([id, at]) => <li key={id}><span>{t(`world.fame.items.${id}`)}</span><b>{at ? t("world.fame.yours", { date: date(at) }) : t("world.fame.unclaimed")}</b></li>)}</ul>
      <p className={styles.meta}>{t("world.fame.signIn")}</p>
    </>;
  }
  if (view === "leaderboard") return <>
    <p className={styles.note}>{t("world.leaderboard.body")}</p>
    <ul className={styles.board}>{([["unique", owned.length], ["galaxy", count("galaxy")], ["golden", count("golden")], ["opened", records.stats.opened]] as const).map(([id, value]) =>
      <li key={id}><span>{t(`world.leaderboard.items.${id}`)}</span><b>{t("world.leaderboard.you")} · {value}</b></li>)}</ul>
    <p className={styles.meta}>{t("world.leaderboard.signIn")}</p>
  </>;
  if (view === "pond") return <><p className={styles.note}>{t("world.pond.body")}</p><button type="button" className={styles.primary} disabled>{t("world.pond.cast")} · {t("comingSoon")}</button></>;
  return <><p className={styles.note}>{t("world.trading.body")}</p>{soon}</>;
}
