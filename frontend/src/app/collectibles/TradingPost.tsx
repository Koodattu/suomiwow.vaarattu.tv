"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LuArrowLeftRight, LuCheck, LuCoins, LuRefreshCw } from "react-icons/lu";
import { dayKey, exchangeTrade, spendCoin, type FigurineCollection } from "@/lib/figurine-collection";
import { canAffordTrade, dailyDeals, PLAYER_OFFERS, type TradeAsset, type TradeOffer } from "@/lib/figurine-trading";
import { findFigure } from "@/lib/figurine-series";
import Portrait from "./Portrait";
import styles from "./facility-overlay.module.css";

// Shared across both facilities; navigating away never restores a purchased listing.
export function useTradingPost(now: Date) {
  const [state, setState] = useState({ day: dayKey(now), refresh: 0, completed: [] as TradeOffer[] });
  const current = useRef(state);
  const day = dayKey(now), refresh = state.day === day ? state.refresh : 0;
  const deals = dailyDeals(day, refresh);
  return {
    deals, completed: state.completed,
    onTrade: (id: string) => {
      const latest = current.current;
      const offer = [...PLAYER_OFFERS, ...dailyDeals(day, latest.day === day ? latest.refresh : 0)].find(item => item.id === id);
      if (!offer || latest.completed.some(item => item.id === id) || !exchangeTrade(offer.give, offer.receive)) return false;
      current.current = { ...latest, completed: [offer, ...latest.completed] };
      setState(current.current);
      return true;
    },
    onRefresh: () => {
      if (!spendCoin()) return false;
      const latest = current.current;
      current.current = { ...latest, day, refresh: (latest.day === day ? latest.refresh : 0) + 1 };
      setState(current.current);
      return true;
    },
  };
}
export type TradingState = ReturnType<typeof useTradingPost>;

function Asset({ asset }: { asset: TradeAsset }) {
  const t = useTranslations("figurineLab");
  return asset.kind === "coins" ? <div className={styles.tradeCoins}><LuCoins /><b>{t("world.rewards.coins", { count: asset.amount })}</b></div>
    : <div className={styles.figure} data-quality={asset.quality}><Portrait figureKey={asset.key} quality={asset.quality} /><div><b>{findFigure(asset.key)?.character.name}</b><small>{t(`quality.${asset.quality}`)}</small></div></div>;
}
export default function TradingPost({ npc, trading, collection, balance }: { npc: boolean; trading: TradingState; collection: FigurineCollection; balance: number }) {
  const t = useTranslations("figurineLab.world.overlays.market"), common = useTranslations("figurineLab.world.overlays");
  const [filter, setFilter] = useState("all"), [history, setHistory] = useState(false), [review, setReview] = useState<string | null>(null), [notice, setNotice] = useState("");
  const completed = new Set(trading.completed.map(item => item.id));
  const available = npc ? trading.deals : PLAYER_OFFERS;
  const offers = (history ? trading.completed.filter(item => npc ? !item.id.startsWith("player-") : item.id.startsWith("player-")) : available)
    .filter(item => npc || history || !completed.has(item.id)).filter(item => filter === "all" || (filter === "buy" ? item.receive.kind === "figure" : item.receive.kind === "coins"));
  return <>
    <div className={styles.intro}><p>{t(npc ? "dealsBody" : "tradingBody")}</p><span className={styles.pill}><LuCoins />{balance}</span></div>
    <div className={styles.toolbar}><div className={styles.tabs}>{[false, true].map(value => <button type="button" key={String(value)} aria-pressed={history === value} onClick={() => { setHistory(value); setReview(null); }}>{t(value ? "history" : "offers")}</button>)}</div>
      {npc ? <button type="button" className={styles.secondary} disabled={balance < 1} onClick={() => { if (trading.onRefresh()) { setReview(null); setHistory(false); setNotice(t("refreshed")); } }}><LuRefreshCw />{t("refresh")}<span className={styles.coinReward}><LuCoins />1</span></button>
        : <label className={styles.filter}><span>{t("show")}</span><select value={filter} onChange={event => { setFilter(event.target.value); setReview(null); }}>{["all", "buy", "sell"].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>}
    </div>
    <p className={styles.status} role="status">{notice}</p>
    <div className={npc ? styles.dealsGrid : styles.marketList}>{offers.map(offer => {
      const done = completed.has(offer.id), affordable = canAffordTrade(offer.give, balance, collection);
      return <article className={styles.marketOffer} key={offer.id} data-review={review === offer.id}>
        <header><span className={styles.avatar}>{npc ? <LuCoins /> : offer.collector[0]}</span><b>{npc ? t("merchant") : offer.collector}</b>{npc && <span className={styles.bargain}>{t("goodDeal")}</span>}</header>
        <div className={styles.exchange}><div><small>{t("receive")}</small><Asset asset={offer.receive} /></div><LuArrowLeftRight aria-hidden="true" /><div><small>{t("give")}</small><Asset asset={offer.give} /></div></div>
        {done ? <span className={styles.success}><LuCheck />{t("completed")}</span> : review === offer.id ? <div className={styles.confirm}><p>{t("confirm")}</p><button type="button" className={styles.primary} disabled={!affordable} onClick={() => { const ok = trading.onTrade(offer.id); setReview(null); setNotice(t(ok ? "success" : "unavailable")); }}>{t("confirmAction")}</button><button type="button" className={styles.secondary} onClick={() => setReview(null)}>{common("cancel")}</button></div>
          : <button type="button" className={styles.secondary} disabled={!affordable} onClick={() => setReview(offer.id)}>{t(affordable ? "review" : offer.give.kind === "coins" ? "missingCoins" : "missingFigure")}</button>}
      </article>;
    })}</div>
    {!offers.length && <div className={styles.empty}><LuArrowLeftRight /><p>{t("empty")}</p></div>}
    <p className={styles.footnote}>{t(npc ? "dailyNote" : "preview")}</p>
  </>;
}
