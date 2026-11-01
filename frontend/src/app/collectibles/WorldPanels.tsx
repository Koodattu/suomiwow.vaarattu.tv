"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { DAILY_CATCHES, FISH, acquiredId, bestQuality, canSpin, crateReward, crateState, dailyCatchesLeft, fishOf, questBoard, type Catch, type FigurineCollection, type FigurineQuality, type FigurineRecords, type MachineItem, type QuestPeriod, type Reward } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import type { Station } from "@/lib/figurine-world";
import type { CastResult } from "@/lib/figurine-facilities";
import Portrait from "./Portrait";
import CollectionCatalogue, { type CatalogueActions } from "./CollectionCatalogue";
import styles from "./world-panels.module.css";

// The world's panels: what a station offers once the camera is there. Lists are images (baked
// portrait sheets), so they stay quick however many figures and series there are; the world stays
// in view beside or above them. Stations not open yet show what they will do.
export type PanelSeries = { id: string; number: string; released: boolean; hidden?: boolean; keys: string[] };
export type MachinePanel = { kind: "recycler" | "forge"; slots: MachineItem[]; groups: (MachineItem & { spare: number })[]; onPick: (item: MachineItem) => void; onClear: () => void };
// What a station's last action brought, shown once its animation has played.
export type PanelResult = { station: "crate"; day: number; reward: Reward } | { station: "wheel"; reward: Reward; figure?: MachineItem }
  | { station: "pond"; caught: Catch; figure?: MachineItem } | { station: "pond"; missed: Exclude<CastResult, "caught"> };
// Where the line is: being cast, waiting (nibbles come and go), or bitten.
export type LinePhase = "cast" | "wait" | "bite";
// The daily stations' actions, and whether one is playing now.
export type PanelActions = {
  busy: boolean; result: PanelResult | null; now: Date; line: LinePhase | null;
  onCrate: () => void; onSpin: () => void; onCast: () => void; onHook: () => void; onClaim: (id: string) => void;
};
type Props = CatalogueActions & {
  view: Station; collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[];
  onClose: () => void; machine?: MachinePanel; actions: PanelActions;
};
// Each fish's colour in the log, after its game model.
const FISH_COLOR: Record<string, string> = {
  smallfish: "#7fc65a", mudsnapper: "#e39a5a", catfish: "#b9c8a4", blackmouth: "#6b8fd0", firefin: "#e2683a",
  deviate: "#9a7ae0", yellowtail: "#e8c060", eel: "#4a8fe0", salmon: "#e8a0a8", mightfish: "#79b04a", boot: "#8a6a48",
};

export default function WorldPanel(props: Props) {
  const t = useTranslations("figurineLab.world");
  const { view, onClose, machine } = props;
  if (view === "shop") return null;
  const title = machine ? t(`picker.${machine.kind}`) : t(`stations.${view as Exclude<Station, "shop" | "recycler" | "forge">}`);
  return <aside className={styles.panel} data-wide={view === "gallery" ? "catalogue" : undefined} aria-label={title}>
    <header className={styles.head}>
      <h2>{title}</h2>
      <button type="button" className={styles.close} onClick={onClose} aria-label={t("close")}>×</button>
    </header>
    {view === "gallery" ? <CollectionCatalogue {...props} />
      : <div className={styles.body}>{machine ? <MachinePicker {...props} machine={machine} /> : <Station {...props} />}</div>}
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

// A reward in words: boxes banked, a boost, a figure.
function useRewardText() {
  const t = useTranslations("figurineLab");
  return (reward: Reward, figure?: MachineItem) => [
    reward.boxes ? t("world.rewards.boxes", { count: reward.boxes }) : null,
    reward.boost ? t("world.rewards.boost", { quality: t(`quality.${reward.boost}`) }) : null,
    figure ? t("world.rewards.figure", { name: findFigure(figure.key)?.character.name ?? "" }) : null,
  ].filter(Boolean).join(" · ");
}
// When each period turns over: local midnight, next Monday, the first of next month.
function nextTurn(period: QuestPeriod, now: Date) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === "daily") return midnight;
  if (period === "weekly") return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8 - (now.getDay() || 7));
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
// What an action brought, as a card with a figure's portrait when one came.
function ResultCard({ children, figure, tone }: { children: ReactNode; figure?: MachineItem; tone?: "miss" | FigurineQuality }) {
  return <div className={styles.result} data-tone={tone}>
    {figure && <Portrait figureKey={figure.key} quality={figure.quality} className={styles.resultPortrait} />}
    <div>{children}</div>
  </div>;
}

function Station({ view, collection, records, series, actions }: Props) {
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
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const until = (period: QuestPeriod) => format.relativeTime(nextTurn(period, now), now);
  if (view === "crate") {
    const state = crateState(records, now), done = state.ready ? state.day - 1 : state.day;
    return <>
      <p className={styles.note}>{t("world.crate.body")}</p>
      <ol className={styles.track} style={{ "--done": done / 6 } as CSSProperties}>{Array.from({ length: 7 }, (_, index) => {
        const day = index + 1;
        return <li key={day} data-done={day <= done} data-today={state.ready && day === state.day} data-final={day === 7}>
          <span className={styles.coin}>{day <= done ? "✓" : day === 7 ? "★" : day}</span>
          <small>{day === 7 ? t("world.crate.day7") : t("world.crate.day", { day })}</small>
        </li>;
      })}</ol>
      {shown?.station === "crate" && <ResultCard tone={shown.reward.boost}><b>{t("world.crate.got", { day: shown.day, reward: rewardText(shown.reward) })}</b></ResultCard>}
      {state.ready
        ? <button type="button" className={styles.cta} disabled={busy} onClick={actions.onCrate}>{t("world.crate.open")}<span>{rewardText(crateReward(state.day))}</span></button>
        : <p className={styles.wait}>{t("world.crate.next", { day: state.day >= 7 ? 1 : state.day + 1, time: until("daily") })}</p>}
      <Boons records={records} />
    </>;
  }
  if (view === "wheel") {
    const ready = canSpin(records, now);
    return <>
      <p className={styles.note}>{t("world.wheel.body")}</p>
      <ul className={styles.prizes}>{(["box1", "box2", "box3", "golden", "galaxy", "figure"] as const).map((prize) => <li key={prize} data-prize={prize}><i />{t(`world.wheel.prizes.${prize}`)}</li>)}</ul>
      {shown?.station === "wheel" && <ResultCard figure={shown.figure} tone={shown.reward.boost ?? shown.figure?.quality}><span>{t("world.wheel.wonLabel")}</span><b>{rewardText(shown.reward, shown.figure)}</b></ResultCard>}
      {ready ? <button type="button" className={styles.cta} disabled={busy} onClick={actions.onSpin}>{t("world.wheel.spin")}<span>{t("world.wheel.free")}</span></button>
        : <p className={styles.wait}>{busy ? t("world.wheel.spinning") : t("world.wheel.next", { time: until("daily") })}</p>}
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
    const board = questBoard(records, complete, now), ready = board.filter((quest) => quest.done && !quest.claimed).length;
    return <>
      <p className={styles.note}>{t("world.quests.body")}</p>
      {ready > 0 && <p className={styles.ready}>{t("world.quests.ready", { count: ready })}</p>}
      {(["daily", "weekly", "monthly"] as const).map((period) => <section key={period} className={styles.quests}>
        <header><h3>{t(`world.quests.${period}`)}</h3><span>{t("world.quests.resets", { time: until(period) })}</span></header>
        {board.filter((quest) => quest.period === period).map((quest) => <div key={quest.id} className={styles.quest} data-done={quest.done} data-claimed={quest.claimed}>
          <div className={styles.questText}>
            <span>{t(`world.quests.items.${quest.id}`)}</span>
            <span className={styles.bar}><i style={{ width: `${quest.progress / quest.goal * 100}%` }} /></span>
            <small>{quest.progress}/{quest.goal}</small>
          </div>
          {quest.claimed ? <em className={styles.claimed}>✓ {t("world.quests.claimed")}</em>
            : quest.done ? <button type="button" className={styles.claim} onClick={() => actions.onClaim(quest.id)}>{t("world.quests.claim")}<span>{t("world.quests.reward", { count: quest.reward })}</span></button>
            : <span className={styles.rewardChip}>{t("world.quests.reward", { count: quest.reward })}</span>}
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
  if (view === "pond") return <Pond records={records} actions={actions} shown={shown?.station === "pond" ? shown : null} />;
  return <><p className={styles.note}>{t("world.trading.body")}</p>{soon}</>;
}

// The fishing pond: what the line is doing and what to do about it, the day's three prize
// catches, what came up last, and the log of every kind caught.
function Pond({ records, actions, shown }: { records: FigurineRecords; actions: PanelActions; shown: Extract<PanelResult, { station: "pond" }> | null }) {
  const t = useTranslations("figurineLab");
  const { line, now } = actions, left = dailyCatchesLeft(records, now);
  const caughtToday = DAILY_CATCHES.length - left;
  const prize = (reward: Reward) => reward.figure ? "figure" : "box";
  return <>
    <div className={styles.line} data-phase={line ?? "idle"} aria-live="polite">
      <b>{t(`world.pond.phase.${line ?? "idle"}`)}</b>
      <span>{t(`world.pond.how.${line ?? "idle"}`)}</span>
    </div>
    {line ? <button type="button" className={styles.cta} data-strike={line === "bite"} disabled={line === "cast"} onClick={actions.onHook}>{t("world.pond.strike")}</button>
      : <button type="button" className={styles.cta} disabled={actions.busy} onClick={actions.onCast}>{t(shown ? "world.pond.castAgain" : "world.pond.cast")}</button>}
    {shown && ("missed" in shown
      ? <ResultCard tone="miss"><b>{t(`world.pond.${shown.missed}`)}</b></ResultCard>
      : shown.caught.kind === "daily"
        ? <ResultCard figure={shown.figure}><span>{t("world.pond.prizeCatch")}</span><b>{shown.figure ? t("world.rewards.figure", { name: findFigure(shown.figure.key)?.character.name ?? "" }) : t("world.rewards.boxes", { count: shown.caught.reward.boxes ?? 1 })}</b></ResultCard>
        : <ResultCard tone={shown.caught.quality}>
          <span className={styles.fishName}><i style={{ "--fish": FISH_COLOR[shown.caught.fish] } as CSSProperties} />{fishOf(shown.caught.fish)?.name}</span>
          <b>{t("world.pond.weight", { weight: shown.caught.weight })}{shown.caught.quality !== "standard" && <em data-quality={shown.caught.quality}> · {t(`quality.${shown.caught.quality}`)}</em>}</b>
          {(shown.caught.first || shown.caught.best) && <small>{t(shown.caught.first ? "world.pond.newKind" : "world.pond.best")}</small>}
        </ResultCard>)}
    <section className={styles.prizeCatches}>
      <h3>{t("world.pond.prizes")}</h3>
      <ol>{DAILY_CATCHES.map((reward, index) => <li key={index} data-done={index < caughtToday} data-next={index === caughtToday}>
        <span>{index < caughtToday ? "✓" : prize(reward) === "figure" ? "?" : "▣"}</span>{t(`world.pond.prize.${prize(reward)}`)}
      </li>)}</ol>
      {left === 0 && <p className={styles.meta}>{t("world.pond.prizesDone")}</p>}
    </section>
    <section className={styles.fishLog}>
      <h3>{t("world.pond.log")} <span>{FISH.filter((entry) => records.fish[entry.id]).length}/{FISH.length}</span></h3>
      <ul>{FISH.map((entry) => {
        const log = records.fish[entry.id];
        return <li key={entry.id} data-caught={!!log}>
          <i style={{ "--fish": log ? FISH_COLOR[entry.id] : "#3a3f48" } as CSSProperties} />
          <span>{log ? entry.name : "???"}</span>
          {log && <small>×{log.count} · {t("world.pond.weight", { weight: log.best })}{log.golden > 0 && <em data-quality="golden"> ★{log.golden}</em>}{log.galaxy > 0 && <em data-quality="galaxy"> ✦{log.galaxy}</em>}</small>}
        </li>;
      })}</ul>
    </section>
  </>;
}

function Boons({ records }: { records: FigurineRecords }) {
  const t = useTranslations("figurineLab");
  if (!records.boons.boxes && !records.boons.boost) return null;
  return <p className={styles.boons}>
    {records.boons.boxes > 0 && <span>{t("world.rewards.banked", { count: records.boons.boxes })}</span>}
    {records.boons.boost && <span data-quality={records.boons.boost}>{t("world.rewards.boostNext", { quality: t(`quality.${records.boons.boost}`) })}</span>}
  </p>;
}
