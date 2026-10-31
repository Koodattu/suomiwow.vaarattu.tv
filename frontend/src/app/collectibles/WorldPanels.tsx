"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { FISH, QUALITIES, SHOWCASE_SLOTS, acquiredId, bestQuality, canSpin, copiesOf, crateReward, crateState, dailyCatchReady, questBoard, showcaseFigure, type Catch, type FigurineCollection, type FigurineQuality, type FigurineRecords, type MachineItem, type Reward } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { portraitStyle } from "@/lib/figurine-portraits";
import type { Station } from "@/lib/figurine-world";
import styles from "./world-panels.module.css";

// The world's panels: what a station offers once the camera is there. Lists are images (baked
// portrait sheets), so they stay quick however many figures and series there are; the world stays
// in view beside or above them. Stations not open yet show what they will do.
export type PanelSeries = { id: string; number: string; released: boolean; hidden?: boolean; keys: string[] };
export type MachinePanel = { kind: "recycler" | "forge"; slots: MachineItem[]; groups: (MachineItem & { spare: number })[]; onPick: (item: MachineItem) => void; onClear: () => void };
// What a station's last action brought, shown once its animation has played.
export type PanelResult = { station: "crate"; day: number; reward: Reward } | { station: "wheel"; reward: Reward; figure?: MachineItem } | { station: "pond"; caught: Catch; figure?: MachineItem };
// The daily stations' actions, and whether one is playing now.
export type PanelActions = { busy: boolean; result: PanelResult | null; now: Date; onCrate: () => void; onSpin: () => void; onCast: () => void; onClaim: (id: string) => void };
type Props = {
  view: Station; collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[];
  onClose: () => void; onInspect: (key: string, quality: FigurineQuality) => void; onShowcase: (slot: number, item: MachineItem | null) => void;
  machine?: MachinePanel; actions: PanelActions;
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
// A reward in words: boxes banked, a boost, a figure.
function useRewardText() {
  const t = useTranslations("figurineLab");
  return (reward: Reward, figure?: MachineItem) => [
    reward.boxes ? t("world.rewards.boxes", { count: reward.boxes }) : null,
    reward.boost ? t("world.rewards.boost", { quality: t(`quality.${reward.boost}`) }) : null,
    figure ? t("world.rewards.figure", { name: findFigure(figure.key)?.character.name ?? "" }) : null,
  ].filter(Boolean).join(" · ");
}

function Placeholder({ view, collection, records, series, actions }: Props) {
  const rewardText = useRewardText();
  const { busy, result, now } = actions;
  const shown = result && result.station === view && !busy ? result : null;
  const t = useTranslations("figurineLab");
  const format = useFormatter();
  const owned = Object.keys(collection);
  const count = (quality: FigurineQuality) => owned.filter((key) => collection[key][quality]).length;
  const complete = useMemo(() => series.some((entry) => entry.released && entry.keys.length && entry.keys.every((key) => collection[key])), [series, collection]);
  const soon = <button type="button" className={styles.primary} disabled>{t("comingSoon")}</button>;
  const firstAt = (quality: FigurineQuality) => Object.entries(records.acquired).filter(([id]) => id.endsWith(`|${quality}`)).map(([, at]) => at).sort()[0];
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  if (view === "crate") {
    const state = crateState(records, now);
    return <>
      <p className={styles.note}>{t("world.crate.body")}</p>
      <ol className={styles.streak}>{Array.from({ length: 7 }, (_, index) => {
        const day = index + 1, opened = state.ready ? day < state.day : day <= state.day;
        return <li key={day} data-done={opened} data-today={state.ready && day === state.day}>{t("world.crate.day", { day })}{day === 7 && <small>{t("world.crate.day7")}</small>}</li>;
      })}</ol>
      {shown?.station === "crate" && <p className={styles.result}>{t("world.crate.got", { day: shown.day, reward: rewardText(shown.reward) })}</p>}
      {state.ready
        ? <button type="button" className={styles.primary} disabled={busy} onClick={actions.onCrate}>{t("world.crate.open")} · {rewardText(crateReward(state.day))}</button>
        : <p className={styles.meta}>{t("world.crate.opened", { day: state.day >= 7 ? 1 : state.day + 1 })}</p>}
      <Boons records={records} />
    </>;
  }
  if (view === "wheel") {
    const ready = canSpin(records, now);
    return <>
      <p className={styles.note}>{t("world.wheel.body")}</p>
      <ul className={styles.prizes}>{(["box1", "box2", "box3", "golden", "galaxy", "figure"] as const).map((prize) => <li key={prize} data-prize={prize}>{t(`world.wheel.prizes.${prize}`)}</li>)}</ul>
      {shown?.station === "wheel" && <p className={styles.result}>{t("world.wheel.won", { prize: rewardText(shown.reward, shown.figure) })}</p>}
      {ready ? <button type="button" className={styles.primary} disabled={busy} onClick={actions.onSpin}>{t("world.wheel.spin")}</button> : <p className={styles.meta}>{busy ? "…" : t("world.wheel.spun")}</p>}
      <Boons records={records} />
    </>;
  }
  if (view === "mail") return <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
    <p className={styles.note}>{t("world.mail.body")}</p>
    <label>{t("world.mail.figure")}<select defaultValue=""><option value="" disabled>{t("world.mail.choose")}</option>{owned.map((key) => <option key={key} value={key}>{findFigure(key)?.character.name ?? key}</option>)}</select></label>
    <label>{t("world.mail.recipient")}<input placeholder={t("world.mail.recipientPlaceholder")} /></label>
    <label>{t("world.mail.message")}<textarea rows={3} placeholder={t("world.mail.messagePlaceholder")} /></label>
    <button type="submit" className={styles.primary} disabled>{t("world.mail.send")} · {t("comingSoon")}</button>
  </form>;
  if (view === "quests") {
    const board = questBoard(records, complete, now);
    return <>
      <p className={styles.note}>{t("world.quests.body")}</p>
      {(["daily", "weekly", "monthly"] as const).map((period) => <section key={period} className={styles.quests}>
        <h3>{t(`world.quests.${period}`)}</h3>
        {board.filter((quest) => quest.period === period).map((quest) => <div key={quest.id} className={styles.quest} data-done={quest.done}>
          <span>{t(`world.quests.items.${quest.id}`)}</span>
          {quest.claimed ? <em className={styles.claimed}>{t("world.quests.claimed")}</em>
            : quest.done ? <button type="button" className={styles.claim} onClick={() => actions.onClaim(quest.id)}>{t("world.quests.claim")}</button>
            : <span className={styles.bar}><i style={{ width: `${quest.progress / quest.goal * 100}%` }} /></span>}
          <small>{quest.progress}/{quest.goal} · {t("world.quests.reward", { count: quest.reward })}</small>
        </div>)}
      </section>)}
      <Boons records={records} />
    </>;
  }
  if (view === "feed") return <>
    <p className={styles.note}>{t("world.feed.body")}</p>
    {records.feed.length ? <ul className={styles.feed}>{records.feed.map((pull) => <li key={`${pull.at}|${pull.key}`}>
      <Portrait figureKey={pull.key} quality={pull.quality} className={styles.feedPortrait} />
      <div><b>{findFigure(pull.key)?.character.name}</b><span data-quality={pull.quality}>{t(`quality.${pull.quality}`)}</span>
        <small>{t("world.feed.you")} · {t(`world.feed.${({ box: "fromBox", forge: "fromForge", wheel: "fromWheel", pond: "fromPond" } as const)[pull.source]}`)} · {format.relativeTime(new Date(pull.at))}</small></div>
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
  if (view === "pond") {
    const daily = dailyCatchReady(records, now);
    return <>
      <p className={styles.note}>{t("world.pond.body")}</p>
      {daily && <p className={styles.meta}>{t("world.pond.dailyReady")}</p>}
      {shown?.station === "pond" && <p className={styles.result}>{shown.caught.kind === "daily"
        ? t("world.pond.daily", { name: shown.figure ? findFigure(shown.figure.key)?.character.name ?? "" : "" })
        : <>{t("world.pond.fish", { name: FISH[shown.caught.fish].name, weight: shown.caught.weight })}{shown.caught.best && <b> · {t("world.pond.best")}</b>}</>}</p>}
      <button type="button" className={styles.primary} disabled={busy} onClick={actions.onCast}>{t(result?.station === "pond" ? "world.pond.castAgain" : "world.pond.cast")}</button>
      {records.stats.fish > 0 && <p className={styles.meta}>{records.catches.best > 0 ? t("world.pond.tally", { count: records.stats.fish, best: records.catches.best }) : t("world.pond.caught", { count: records.stats.fish })}</p>}
    </>;
  }
  return <><p className={styles.note}>{t("world.trading.body")}</p>{soon}</>;
}

function Boons({ records }: { records: FigurineRecords }) {
  const t = useTranslations("figurineLab");
  if (!records.boons.boxes && !records.boons.boost) return null;
  return <p className={styles.boons}>
    {records.boons.boxes > 0 && <span>{t("world.rewards.banked", { count: records.boons.boxes })}</span>}
    {records.boons.boost && <span data-quality={records.boons.boost}>{t("world.rewards.boostNext", { quality: t(`quality.${records.boons.boost}`) })}</span>}
  </p>;
}
