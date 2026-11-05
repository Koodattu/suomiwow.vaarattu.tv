"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LuArrowLeftRight, LuBadgePercent, LuBell, LuCheck, LuCrown, LuGift, LuHammer, LuRecycle, LuScrollText, LuSend, LuSparkles, LuTrophy, LuX } from "react-icons/lu";
import { questBoard, type FigurineCollection, type FigurineRecords, type QuestPeriod } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { PREVIEW_FEED, PREVIEW_FIGURES, PREVIEW_GIFTS, PREVIEW_HONOURS, matchesPreviewQuality, previewRankings, type PreviewAction, type PreviewState, type RankMetric } from "@/lib/figurine-community-preview";
import type { OverlayStation } from "@/lib/figurine-facility-views";
import type { MachinePanel, PanelActions, PanelSeries } from "./WorldPanels";
import { Action, Chips, Coins, Empty, HeaderExtra, HeaderSlot, useToast } from "./FacilityParts";
import TradingPost, { type TradingState } from "./TradingPost";
import Workshop from "./Workshop";
import Portrait from "./Portrait";
import styles from "./facility-overlay.module.css";

type Props = {
  view: Exclude<OverlayStation, "wheel">; collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[];
  machine?: MachinePanel; away?: boolean; trading: TradingState; actions: PanelActions; preview: PreviewState; dispatch: Dispatch<PreviewAction>; onClose: () => void;
};
const ICONS = { merchant: LuBadgePercent, recycler: LuRecycle, forge: LuHammer, quests: LuScrollText, trading: LuArrowLeftRight, mail: LuGift, feed: LuBell, fame: LuCrown, leaderboard: LuTrophy };
// What these show is invented for now, and says so.
const SAMPLE = ["trading", "mail", "feed", "fame", "leaderboard"];

// Every facility shares one frame of one size, so moving between them, or within one, never
// resizes it. What is inside lays out to the frame and scrolls in its own columns.
export default function FacilityOverlay(props: Props) {
  const { view, onClose } = props;
  const t = useTranslations("figurineLab.world"), p = useTranslations("figurineLab.world.overlays");
  const title = useRef<HTMLHeadingElement>(null), [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [view]);
  const Icon = ICONS[view];
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
          {view === "quests" && <Quests {...props} />}
          {(view === "trading" || view === "merchant") && <TradingPost npc={view === "merchant"} trading={props.trading} collection={props.collection} balance={props.records.boons.coins} />}
          {(view === "recycler" || view === "forge") && props.machine && <Workshop machine={props.machine} />}
          {view === "mail" && <Gifts {...props} />}
          {view === "feed" && <Feed {...props} />}
          {view === "fame" && <Fame />}
          {view === "leaderboard" && <Rankings {...props} />}
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

// All three boards side by side.
function Quests({ records, collection, series, actions }: Props) {
  const t = useTranslations("figurineLab.world.quests"), format = useFormatter();
  const complete = series.some(entry => entry.released && entry.keys.length && entry.keys.every(key => collection[key]));
  const board = questBoard(records, complete, actions.now), ready = board.filter(quest => quest.done && !quest.claimed);
  return <>
    {ready.length > 1 && <HeaderExtra><Action onClick={() => ready.forEach(quest => actions.onClaim(quest.id))}>{t("claimAll")}<Coins count={ready.reduce((sum, quest) => sum + quest.reward, 0)} size={18} /></Action></HeaderExtra>}
    <div className={styles.questBoard}>{(["daily", "weekly", "monthly"] as const).map(period => <section key={period} className={styles.questColumn}>
      <header><h3>{t(period)}</h3><small>{t("resets", { time: format.relativeTime(nextTurn(period, actions.now), actions.now) })}</small></header>
      <ul>{board.filter(quest => quest.period === period).map(quest => <li key={quest.id} className={styles.quest} data-state={quest.claimed ? "claimed" : quest.done ? "ready" : undefined}>
        <div className={styles.questTop}><b>{t(`items.${quest.id}`)}</b><Coins count={quest.reward} size={22} /></div>
        <div className={styles.questFoot}>{quest.claimed ? <span className={styles.stamp}><LuCheck />{t("claimed")}</span>
          : quest.done ? <Action onClick={() => actions.onClaim(quest.id)}>{t("claim")}</Action>
            : <><div className={styles.progress} role="progressbar" aria-label={t(`items.${quest.id}`)} aria-valuenow={quest.progress} aria-valuemin={0} aria-valuemax={quest.goal}><i style={{ width: `${quest.progress / quest.goal * 100}%` }} /></div><span className={styles.count}>{quest.progress}/{quest.goal}</span></>}</div>
      </li>)}</ul>
    </section>)}</div>
  </>;
}

function SampleFigure({ index }: { index: number }) {
  const t = useTranslations("figurineLab"), item = PREVIEW_FIGURES[index];
  return <div className={styles.sampleFigure} data-quality={item.quality}><Portrait figureKey={item.key} quality={item.quality} /><div><b>{findFigure(item.key)?.character.name}</b><small>{t(`quality.${item.quality}`)}</small></div></div>;
}

// The mailbox and the writing desk, both open at once.
function Gifts({ preview, dispatch }: Props) {
  const t = useTranslations("figurineLab.world.overlays.gifts"), common = useTranslations("figurineLab.world.mail");
  const [recipient, setRecipient] = useState(""), [message, setMessage] = useState(""), [figure, setFigure] = useState(0), [toast, notify] = useToast();
  const send = () => {
    if (!recipient.trim() || !preview.inventory[figure]) return;
    dispatch({ type: "send", recipient, figure, message }); notify(t("sentNotice", { name: recipient.trim() })); setRecipient(""); setMessage("");
  };
  return <div className={styles.gifts}>
    <section className={styles.mailbox}>
      <h3>{t("inbox")}</h3>
      <div className={styles.giftGrid}>{PREVIEW_GIFTS.map(gift => {
        const opened = preview.claimed.includes(gift.id);
        return <article key={gift.id} className={styles.gift} data-open={opened}>
          {opened ? <SampleFigure index={gift.figure} /> : <span className={styles.present}><LuGift aria-hidden="true" /></span>}
          <small>{t("from", { name: gift.collector })}</small>
          <p>“{t(`notes.${gift.note}`)}”</p>
          {opened ? <span className={styles.stamp}><LuCheck />{t("claimed")}</span> : <Action onClick={() => { dispatch({ type: "claim", id: gift.id }); notify(t("claimedNotice")); }}><LuGift />{t("claim")}</Action>}
        </article>;
      })}</div>
      {!!preview.sent.length && <><h3>{t("sent")}</h3><ul className={styles.sentList}>{preview.sent.map(gift => <li key={gift.id}><Portrait figureKey={PREVIEW_FIGURES[gift.figure].key} quality={PREVIEW_FIGURES[gift.figure].quality} /><div><b>{t("to", { name: gift.recipient })}</b>{gift.message && <small>“{gift.message}”</small>}</div><LuCheck aria-hidden="true" /></li>)}</ul></>}
    </section>
    <form className={styles.desk} onSubmit={event => { event.preventDefault(); send(); }}>
      <h3>{t("send")}</h3>
      <div className={styles.giftPicker} role="radiogroup" aria-label={common("figure")}>{PREVIEW_FIGURES.map((item, index) => <button key={index} type="button" role="radio" aria-checked={figure === index} data-quality={item.quality} disabled={!preview.inventory[index]} onClick={() => setFigure(index)} title={findFigure(item.key)?.character.name}>
        <Portrait figureKey={item.key} quality={item.quality} /><span className={styles.copies}>×{preview.inventory[index]}</span>
      </button>)}</div>
      <label>{common("recipient")}<input required maxLength={40} value={recipient} onChange={event => setRecipient(event.target.value)} placeholder={t("recipientPlaceholder")} autoComplete="off" /></label>
      <label>{common("message")}<textarea rows={3} maxLength={240} value={message} onChange={event => setMessage(event.target.value)} placeholder={common("messagePlaceholder")} /></label>
      <Action type="submit" disabled={!recipient.trim() || !preview.inventory[figure]}><LuSend />{t("sendAction")}</Action>
    </form>
    {toast}
  </div>;
}

// The town's finds beside the player's own.
function Feed({ preview, dispatch, records, actions }: Props) {
  const t = useTranslations("figurineLab.world.overlays.feed"), common = useTranslations("figurineLab"), format = useFormatter();
  const [filter, setFilter] = useState<"all" | "galaxy" | "golden">("all");
  return <div className={styles.feedLayout}>
    <section className={styles.feedMain}>
      <Chips values={["all", "galaxy", "golden"] as const} value={filter} onChange={setFilter} label={value => value === "all" ? t("all") : common(`quality.${value}`)} />
      <div className={styles.feedGrid}>{PREVIEW_FEED.filter(entry => matchesPreviewQuality(entry.figure, filter)).map(entry => {
        const item = PREVIEW_FIGURES[entry.figure], cheered = preview.cheers.includes(entry.id);
        return <article key={entry.id} className={styles.find} data-quality={item.quality}>
          <Portrait figureKey={item.key} quality={item.quality} />
          <div>
            <h3>{findFigure(item.key)?.character.name}</h3>
            <span className={styles.finish}>{common(`quality.${item.quality}`)}</span>
            <small>{entry.collector} · {common(`world.feed.${entry.source}`)} · {t("minutes", { count: entry.minutes })}</small>
            <button type="button" className={styles.cheer} aria-pressed={cheered} onClick={() => dispatch({ type: "cheer", id: entry.id })}><LuBell aria-hidden="true" />{t("cheer")}<b>{entry.cheers + Number(cheered)}</b></button>
          </div>
        </article>;
      })}</div>
    </section>
    <section className={styles.feedSide}>
      <h3>{t("mine")}</h3>
      {records.feed.length ? <ul className={styles.ownFinds}>{records.feed.map((pull, index) => <li key={`${pull.at}-${index}`} data-quality={pull.quality}><Portrait figureKey={pull.key} quality={pull.quality} /><div><b>{findFigure(pull.key)?.character.name}</b><small>{common(`quality.${pull.quality}`)} · {format.relativeTime(new Date(pull.at), actions.now)}</small></div></li>)}</ul> : <Empty icon={<LuSparkles />} text={common("world.feed.empty")} />}
    </section>
  </div>;
}

// A niche for each first.
function Fame() {
  const t = useTranslations("figurineLab.world.overlays.fame"), common = useTranslations("figurineLab.world.fame"), format = useFormatter();
  return <div className={styles.fame}>{PREVIEW_HONOURS.map(honour => <article key={honour.id} className={styles.niche} data-vacant={!honour.collector}>
    <h3>{common(`items.${honour.id}`)}</h3>
    {honour.collector ? <>
      <div className={styles.nichePicture}><Portrait figureKey={PREVIEW_FIGURES[honour.figure].key} quality={PREVIEW_FIGURES[honour.figure].quality} /></div>
      <b>{honour.collector}</b>
      <time dateTime={honour.date!}>{format.dateTime(new Date(honour.date!), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</time>
    </> : <><div className={styles.nichePicture}><LuCrown aria-hidden="true" /></div><b>{t("waiting")}</b></>}
  </article>)}</div>;
}

// A board per measure, each tile showing the player's own count; the player stands in the list too.
function Rankings({ collection, records }: Props) {
  const t = useTranslations("figurineLab.world.overlays.ranks"), common = useTranslations("figurineLab.world.leaderboard"), format = useFormatter();
  const [metric, setMetric] = useState<RankMetric>("unique");
  const owned = Object.values(collection), countOf = (measure: RankMetric) => measure === "unique" ? owned.length : measure === "opened" ? records.stats.opened : owned.filter(item => item[measure]).length;
  const ranking = previewRankings(metric), mine = countOf(metric), place = 1 + ranking.filter(collector => collector[metric] > mine).length;
  return <div className={styles.ranks}>
    <div className={styles.metrics}>{(["unique", "galaxy", "golden", "opened"] as const).map(measure => <button key={measure} type="button" aria-pressed={measure === metric} onClick={() => setMetric(measure)}><small>{common(`items.${measure}`)}</small><b>{format.number(countOf(measure))}</b></button>)}</div>
    <div className={styles.podium}>{[ranking[1], ranking[0], ranking[2]].map(collector => {
      const rank = ranking.indexOf(collector) + 1, figure = PREVIEW_FIGURES[collector.avatar];
      return <article key={collector.name} data-place={rank}>
        <Portrait figureKey={figure.key} quality={figure.quality} />
        <b>{collector.name}</b>
        <div className={styles.step}>{rank === 1 ? <LuCrown aria-label="1" /> : <span>{rank}</span>}<strong>{format.number(collector[metric])}</strong></div>
      </article>;
    })}</div>
    <ol className={styles.rankList}>
      {ranking.slice(3).map((collector, index) => <li key={collector.name}><span>{index + 4}</span><Portrait className={styles.rankPicture} figureKey={PREVIEW_FIGURES[collector.avatar].key} quality={PREVIEW_FIGURES[collector.avatar].quality} /><b>{collector.name}</b><strong>{format.number(collector[metric])}</strong></li>)}
      <li data-you="true"><span><LuTrophy aria-hidden="true" />{place}</span><b>{t("you")}</b><strong>{format.number(mine)}</strong></li>
    </ol>
  </div>;
}
