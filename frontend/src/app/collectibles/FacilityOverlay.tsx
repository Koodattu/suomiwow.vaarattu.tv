"use client";

import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LuArrowLeftRight, LuBadgePercent, LuHammer, LuRecycle, LuCheck, LuChevronRight, LuCoins, LuCrown, LuFerrisWheel, LuGift, LuHeart, LuMail, LuScrollText, LuSend, LuSparkles, LuTrophy, LuX } from "react-icons/lu";
import { canSpin, questBoard, type FigurineCollection, type FigurineRecords, type QuestPeriod } from "@/lib/figurine-collection";
import { findFigure } from "@/lib/figurine-series";
import { PREVIEW_FEED, PREVIEW_FIGURES, PREVIEW_GIFTS, PREVIEW_HONOURS, matchesPreviewQuality, previewRankings, type PreviewAction, type PreviewState, type RankMetric } from "@/lib/figurine-community-preview";
import type { OverlayStation } from "@/lib/figurine-facility-views";
import type { MachinePanel, PanelActions, PanelSeries } from "./WorldPanels";
import TradingPost, { type TradingState } from "./TradingPost";
import Workshop from "./Workshop";
import Portrait from "./Portrait";
import styles from "./facility-overlay.module.css";

type Props = {
  view: OverlayStation; collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[];
  machine?: MachinePanel; away?: boolean; trading: TradingState; actions: PanelActions; preview: PreviewState; dispatch: Dispatch<PreviewAction>; onClose: () => void;
};
const ICONS = { merchant: LuBadgePercent, recycler: LuRecycle, forge: LuHammer, quests: LuScrollText, wheel: LuFerrisWheel, trading: LuArrowLeftRight, mail: LuGift, feed: LuSparkles, fame: LuCrown, leaderboard: LuTrophy };

export default function FacilityOverlay(props: Props) {
  const { view, onClose } = props;
  const t = useTranslations("figurineLab.world"), p = useTranslations("figurineLab.world.overlays");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [view]);
  const Icon = ICONS[view], workshop = view === "recycler" || view === "forge", community = ["mail", "feed", "fame", "leaderboard"].includes(view);
  return <div className={styles.layer} data-facility={view} data-away={props.away || undefined} inert={props.away}>
    <aside className={styles.panel} aria-labelledby="facility-title" key={view}>
      <header className={styles.header}>
        <span className={styles.emblem}><Icon aria-hidden="true" /></span>
        <div><span className={styles.eyebrow}>{p(workshop ? "workshopLabel" : view === "trading" ? "community" : community ? "community" : "dailyActivities")}</span><h2 id="facility-title" ref={title} tabIndex={-1}>{t(`stations.${view}`)}</h2></div>
        <button className={styles.iconButton} type="button" onClick={onClose} aria-label={t("close")}><LuX /></button>
      </header>
      <div className={styles.body}>
        {community && <p className={styles.previewNote}>{p("preview")}</p>}
        {view === "quests" && <Quests {...props} />}
        {view === "wheel" && <Wheel {...props} />}
        {(view === "trading" || view === "merchant") && <TradingPost npc={view === "merchant"} trading={props.trading} collection={props.collection} balance={props.records.boons.coins} />}
        {workshop && props.machine && <Workshop machine={props.machine} />}
        {view === "mail" && <Gifts {...props} />}
        {view === "feed" && <Feed {...props} />}
        {view === "fame" && <Fame />}
        {view === "leaderboard" && <Rankings {...props} />}
      </div>
    </aside>
  </div>;
}

function Tabs<T extends string>({ values, value, onChange, label }: { values: readonly T[]; value: T; onChange: (value: T) => void; label: (value: T) => string }) {
  return <div className={styles.tabs}>{values.map(item => <button key={item} type="button" aria-pressed={item === value} onClick={() => onChange(item)}>{label(item)}</button>)}</div>;
}
function Action({ children, onClick, disabled = false, secondary = false, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; secondary?: boolean; type?: "button" | "submit" }) {
  return <button type={type} className={secondary ? styles.secondary : styles.primary} disabled={disabled} onClick={onClick}>{children}</button>;
}
function SampleFigure({ index, compact = false }: { index: number; compact?: boolean }) {
  const t = useTranslations("figurineLab"), item = PREVIEW_FIGURES[index];
  return <div className={styles.figure} data-quality={item.quality} data-compact={compact}>
    <Portrait figureKey={item.key} quality={item.quality} />
    <div><b>{findFigure(item.key)?.character.name}</b><small>{t(`quality.${item.quality}`)}</small></div>
  </div>;
}
function nextTurn(period: QuestPeriod, now: Date) {
  if (period === "daily") return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === "weekly") return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8 - (now.getDay() || 7));
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
function Quests({ records, collection, series, actions }: Props) {
  const t = useTranslations("figurineLab.world.quests"), p = useTranslations("figurineLab.world.overlays"), format = useFormatter();
  const [period, setPeriod] = useState<QuestPeriod>("daily");
  const complete = series.some(entry => entry.released && entry.keys.length && entry.keys.every(key => collection[key]));
  const board = questBoard(records, complete, actions.now), quests = board.filter(quest => quest.period === period);
  const ready = board.filter(quest => quest.done && !quest.claimed).length;
  return <>
    <div className={styles.intro}><p>{t("body")}</p><span className={styles.pill}><LuCoins />{ready ? t("ready", { count: ready }) : p("quests.keepGoing")}</span></div>
    <Tabs values={["daily", "weekly", "monthly"] as const} value={period} onChange={setPeriod} label={value => t(value)} />
    <div className={styles.sectionLine}><span>{p("quests.completed", { count: quests.filter(q => q.claimed).length, total: quests.length })}</span><span>{t("resets", { time: format.relativeTime(nextTurn(period, actions.now), actions.now) })}</span></div>
    <div className={styles.questGrid}>{quests.map(quest => <article key={quest.id} className={styles.quest} data-complete={quest.done}>
      <div className={styles.questTop}><span className={styles.questSeal}>{quest.claimed ? <LuCheck /> : <LuScrollText />}</span><b>{t(`items.${quest.id}`)}</b><span className={styles.coinReward}><LuCoins />{quest.reward}</span></div>
      <div className={styles.progress} role="progressbar" aria-label={t(`items.${quest.id}`)} aria-valuenow={quest.progress} aria-valuemin={0} aria-valuemax={quest.goal}><i style={{ width: `${quest.progress / quest.goal * 100}%` }} /></div>
      <div className={styles.questFooter}><span>{quest.progress} / {quest.goal}</span>{quest.claimed ? <span><LuCheck /> {t("claimed")}</span> : quest.done ? <Action onClick={() => actions.onClaim(quest.id)}>{t("claim")} <LuChevronRight /></Action> : <span>{p("quests.inProgress")}</span>}</div>
    </article>)}</div>
  </>;
}
function Wheel({ records, actions }: Props) {
  const t = useTranslations("figurineLab.world.wheel"), p = useTranslations("figurineLab.world.overlays"), common = useTranslations("figurineLab"), format = useFormatter();
  const ready = canSpin(records, actions.now), result = actions.result?.station === "wheel" && !actions.busy ? actions.result : null;
  return <>
    <div className={styles.intro}><p>{t("body")}</p><span className={styles.pill}><LuGift />{p("wheel.noCost")}</span></div>
    {!result && <div className={styles.prizeGrid}>{(["coin1", "coin2", "coin3", "golden", "galaxy", "figure"] as const).map(prize => <div key={prize} data-prize={prize}>{prize.startsWith("coin") ? <LuCoins /> : <LuSparkles />}<span>{t(`prizes.${prize}`)}</span></div>)}</div>}
    <div className={styles.rewardSlot} aria-live="polite">{result && <div className={styles.rewardResult}>
      {result.figure ? <Portrait figureKey={result.figure.key} quality={result.figure.quality} /> : <LuGift />}
      <div><small>{t("wonLabel")}</small><b>{result.reward.coins ? common("world.rewards.coins", { count: result.reward.coins }) : result.figure ? findFigure(result.figure.key)?.character.name : result.reward.boost ? common("world.rewards.boost", { quality: common(`quality.${result.reward.boost}`) }) : ""}</b></div>
    </div>}</div>
    <Action disabled={actions.busy || !ready} onClick={actions.onSpin}><LuFerrisWheel />{actions.busy ? t("spinning") : ready ? t("spin") : p("wheel.used")}</Action>
    {!ready && !actions.busy && <p className={styles.footnote}>{t("next", { time: format.relativeTime(nextTurn("daily", actions.now), actions.now) })}</p>}
  </>;
}

function Gifts({ preview, dispatch }: Props) {
  const t = useTranslations("figurineLab.world.overlays.gifts"), p = useTranslations("figurineLab.world.overlays"), common = useTranslations("figurineLab.world.mail");
  const [tab, setTab] = useState<"inbox" | "send" | "sent">("inbox"), [recipient, setRecipient] = useState(""), [message, setMessage] = useState(""), [figure, setFigure] = useState(0), [notice, setNotice] = useState("");
  return <>
    <Tabs values={["inbox", "send", "sent"] as const} value={tab} onChange={setTab} label={value => t(value)} />
    <p className={styles.status} role="status">{notice}</p>
    {tab === "inbox" && <div className={styles.giftGrid}>{PREVIEW_GIFTS.map(gift => <article key={gift.id} className={styles.giftCard}>
      <span className={styles.eyebrow}><LuMail />{t("from", { name: gift.collector })}</span><SampleFigure index={gift.figure} compact /><p className={styles.giftNote}>“{t(`notes.${gift.note}`)}”</p>
      <Action disabled={preview.claimed.includes(gift.id)} onClick={() => { dispatch({ type: "claim", id: gift.id }); setNotice(t("claimedNotice")); }}>{preview.claimed.includes(gift.id) ? <LuCheck /> : <LuGift />}{t(preview.claimed.includes(gift.id) ? "claimed" : "claim")}</Action>
    </article>)}</div>}
    {tab === "send" && <form className={styles.sendForm} onSubmit={event => { event.preventDefault(); if (!recipient.trim() || !preview.inventory[figure]) return; dispatch({ type: "send", recipient, figure, message }); setNotice(t("sentNotice", { name: recipient.trim() })); setRecipient(""); setMessage(""); setTab("sent"); }}>
      <div className={styles.giftSelection}><SampleFigure index={figure} /><label>{common("figure")}<select value={figure} onChange={event => setFigure(Number(event.target.value))}>{PREVIEW_FIGURES.map((item, index) => <option key={index} value={index} disabled={!preview.inventory[index]}>{findFigure(item.key)?.character.name} · ×{preview.inventory[index]}</option>)}</select></label><small>{p("sampleInventory", { count: preview.inventory[figure] })}</small></div>
      <div className={styles.fields}><label>{common("recipient")}<input required maxLength={40} value={recipient} onChange={event => setRecipient(event.target.value)} placeholder={t("recipientPlaceholder")} autoComplete="off" /></label><label>{common("message")}<textarea rows={4} maxLength={240} value={message} onChange={event => setMessage(event.target.value)} placeholder={common("messagePlaceholder")} /></label><span className={styles.counter}>{message.length} / 240</span><Action type="submit" disabled={!recipient.trim() || !preview.inventory[figure]}><LuSend />{t("sendAction")}</Action></div>
    </form>}
    {tab === "sent" && (preview.sent.length ? <div className={styles.giftGrid}>{preview.sent.map(gift => <article key={gift.id} className={styles.giftCard}><span className={styles.eyebrow}>{t("to", { name: gift.recipient })}</span><SampleFigure index={gift.figure} compact />{gift.message && <p className={styles.giftNote}>“{gift.message}”</p>}<span className={styles.success}><LuCheck />{t("delivered")}</span></article>)}</div> : <Empty icon={<LuSend />} text={t("empty")} />)}
  </>;
}
function Feed({ preview, dispatch, records, actions }: Props) {
  const t = useTranslations("figurineLab.world.overlays.feed"), common = useTranslations("figurineLab"), format = useFormatter();
  const [filter, setFilter] = useState<"all" | "galaxy" | "golden" | "mine">("all");
  return <>
    <Tabs values={["all", "galaxy", "golden", "mine"] as const} value={filter} onChange={setFilter} label={value => value === "galaxy" || value === "golden" ? common(`quality.${value}`) : t(value)} />
    {filter === "mine" ? records.feed.length ? <div className={styles.feed}>{records.feed.map((pull, index) => <article key={`${pull.at}-${index}`} className={styles.feedItem}><Portrait figureKey={pull.key} quality={pull.quality} /><div><span className={styles.eyebrow}>{common("world.feed.you")}</span><h3>{findFigure(pull.key)?.character.name}</h3><p>{common(`quality.${pull.quality}`)} · {format.relativeTime(new Date(pull.at), actions.now)}</p></div></article>)}</div> : <Empty icon={<LuSparkles />} text={common("world.feed.empty")} /> : <div className={styles.feed}>{PREVIEW_FEED.filter(entry => matchesPreviewQuality(entry.figure, filter)).map(entry => {
      const item = PREVIEW_FIGURES[entry.figure], cheered = preview.cheers.includes(entry.id);
      return <article key={entry.id} className={styles.feedItem} data-quality={item.quality}><Portrait figureKey={item.key} quality={item.quality} /><div><span className={styles.eyebrow}>{entry.collector} <span>· {t("minutes", { count: entry.minutes })}</span></span><h3>{findFigure(item.key)?.character.name}</h3><p><span>{common(`quality.${item.quality}`)}</span> · {common(`world.feed.${entry.source}`)}</p><button type="button" className={styles.cheer} aria-pressed={cheered} onClick={() => dispatch({ type: "cheer", id: entry.id })}><LuHeart />{t("cheer")} <b>{entry.cheers + Number(cheered)}</b></button></div></article>;
    })}</div>}
  </>;
}
function Fame() {
  const t = useTranslations("figurineLab.world.overlays.fame"), common = useTranslations("figurineLab.world.fame"), format = useFormatter();
  return <>
    <div className={styles.honourIntro}><LuCrown /><div><h3>{t("title")}</h3><p>{t("body")}</p></div></div>
    <div className={styles.honourGrid}>{PREVIEW_HONOURS.map((honour, index) => <article key={honour.id} className={styles.honour} data-unclaimed={!honour.collector}>
      <span className={styles.honourNumber}>{String(index + 1).padStart(2, "0")}</span><LuTrophy className={styles.trophy} /><h3>{common(`items.${honour.id}`)}</h3>
      {honour.collector ? <><Portrait figureKey={PREVIEW_FIGURES[honour.figure].key} quality={PREVIEW_FIGURES[honour.figure].quality} /><b>{honour.collector}</b><time dateTime={honour.date!}>{format.dateTime(new Date(honour.date!), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</time></> : <div className={styles.vacant}><LuCrown /><b>{t("waiting")}</b><span>{t("next")}</span></div>}
    </article>)}</div>
  </>;
}
function Rankings({ collection, records }: Props) {
  const t = useTranslations("figurineLab.world.overlays.ranks"), common = useTranslations("figurineLab.world.leaderboard"), format = useFormatter();
  const [metric, setMetric] = useState<RankMetric>("unique");
  const ranking = previewRankings(metric), owned = Object.values(collection), mine = metric === "unique" ? owned.length : metric === "opened" ? records.stats.opened : owned.filter(item => item[metric]).length;
  return <>
    <div className={styles.intro}><p>{t("body")}</p><span className={styles.pill}><LuTrophy />{t("allTime")}</span></div>
    <Tabs values={["unique", "galaxy", "golden", "opened"] as const} value={metric} onChange={setMetric} label={value => common(`items.${value}`)} />
    <div className={styles.podium}>{[ranking[1], ranking[0], ranking[2]].map(collector => <article key={collector.name} data-place={ranking.indexOf(collector) + 1}>
      <span className={styles.place}>{ranking.indexOf(collector) === 0 ? <LuCrown /> : ranking.indexOf(collector) + 1}</span><Portrait figureKey={PREVIEW_FIGURES[collector.avatar].key} quality={PREVIEW_FIGURES[collector.avatar].quality} /><b>{collector.name}</b><strong>{format.number(collector[metric])}</strong>
    </article>)}</div>
    <ol className={styles.rankList} start={4}>{ranking.slice(3).map((collector, index) => <li key={collector.name}><span>{index + 4}</span><span className={styles.avatar}>{collector.name[0]}</span><b>{collector.name}</b><strong>{format.number(collector[metric])}</strong></li>)}</ol>
    <div className={styles.yourRank}><div><b>{t("yourCollection")}</b><span>{t("separate")}</span></div><strong>{format.number(mine)}</strong></div>
  </>;
}
function Empty({ icon, text }: { icon: ReactNode; text: string }) { return <div className={styles.empty}>{icon}<p>{text}</p></div>; }
