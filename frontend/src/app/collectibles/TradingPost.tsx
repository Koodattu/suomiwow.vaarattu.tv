"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LuArrowDown, LuArrowLeftRight, LuArrowRight, LuCheck, LuRefreshCw } from "react-icons/lu";
import { dayKey, exchangeTrade, spendCoin, type FigurineCollection } from "@/lib/figurine-collection";
import { canAffordTrade, dailyDeals, PLAYER_OFFERS, type TradeAsset, type TradeOffer } from "@/lib/figurine-trading";
import { findFigure } from "@/lib/figurine-series";
import { Action, Chips, Coin, Coins, Empty, HeaderExtra, useToast } from "./FacilityParts";
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
type TradeProps = { trading: TradingState; collection: FigurineCollection; balance: number };

// One side of a trade, as a tile: the figure's portrait and name, or a heap of coins.
function Asset({ asset }: { asset: TradeAsset }) {
  const t = useTranslations("figurineLab");
  return asset.kind === "coins" ? <div className={styles.asset}><span className={styles.assetCoins}><Coin size={46} /></span><b>{t("world.rewards.coins", { count: asset.amount })}</b></div>
    : <div className={styles.asset} data-quality={asset.quality}><Portrait figureKey={asset.key} quality={asset.quality} /><b>{findFigure(asset.key)?.character.name}</b>{asset.quality !== "standard" && <small>{t(`quality.${asset.quality}`)}</small>}</div>;
}
const assetName = (asset: TradeAsset) => asset.kind === "coins" ? String(asset.amount) : findFigure(asset.key)?.character.name;

export default function TradingPost({ npc, ...props }: TradeProps & { npc: boolean }) {
  return npc ? <Deals {...props} /> : <Market {...props} />;
}

// The merchant's stall: three wares across, each settled on its own card.
function Deals({ trading, collection, balance }: TradeProps) {
  const t = useTranslations("figurineLab.world.overlays.market"), common = useTranslations("figurineLab.world.overlays"), quality = useTranslations("figurineLab.quality");
  const [review, setReview] = useState<string | null>(null), [toast, notify] = useToast();
  const done = new Set(trading.completed.map(item => item.id));
  return <>
    <HeaderExtra><button type="button" className={styles.secondary} disabled={balance < 1} onClick={() => { if (trading.onRefresh()) { setReview(null); notify(t("refreshed")); } }}><LuRefreshCw />{t("refresh")}<Coins count={1} size={16} /></button></HeaderExtra>
    <div className={styles.stall}>{trading.deals.map(offer => {
      const selling = offer.receive.kind === "coins", ware = selling ? offer.give : offer.receive, price = selling ? offer.receive : offer.give;
      const sold = done.has(offer.id), affordable = canAffordTrade(offer.give, balance, collection);
      return <article key={offer.id} className={styles.ware} data-quality={ware.kind === "figure" ? ware.quality : undefined} data-sold={sold}>
        <span className={styles.wareKind}>{t(selling ? "sell" : "buy")}</span>
        <div className={styles.warePicture}>{ware.kind === "figure" && <Portrait figureKey={ware.key} quality={ware.quality} />}</div>
        <div className={styles.wareInfo}>
          <h3>{assetName(ware)}</h3>
          {ware.kind === "figure" && <small>{quality(ware.quality)}</small>}
          <div className={styles.price}><span>{t(selling ? "receive" : "give")}</span>{price.kind === "coins" ? <Coins count={price.amount} size={24} /> : <b>{assetName(price)}</b>}</div>
          <div className={styles.wareActions}>{sold ? <span className={styles.stamp}><LuCheck />{t("completed")}</span>
            : review === offer.id ? <><Action disabled={!affordable} onClick={() => { const ok = trading.onTrade(offer.id); setReview(null); notify(t(ok ? "success" : "unavailable")); }}>{t("confirmAction")}</Action><Action secondary onClick={() => setReview(null)}>{common("cancel")}</Action></>
              : <Action disabled={!affordable} onClick={() => setReview(offer.id)}>{t(affordable ? "review" : offer.give.kind === "coins" ? "missingCoins" : "missingFigure")}</Action>}</div>
        </div>
      </article>;
    })}</div>
    {toast}
  </>;
}

// The players' market: the offers on the board, and a trade window beside them for the one picked.
function Market({ trading, collection, balance }: TradeProps) {
  const t = useTranslations("figurineLab.world.overlays.market"), common = useTranslations("figurineLab.world.overlays");
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all"), [picked, setPicked] = useState<string | null>(null), [toast, notify] = useToast();
  const completed = trading.completed.filter(item => item.id.startsWith("player-")), done = new Set(completed.map(item => item.id));
  const open = PLAYER_OFFERS.filter(item => !done.has(item.id));
  const kind = (item: TradeOffer) => item.receive.kind === "figure" ? "buy" : "sell";
  const offers = open.filter(item => filter === "all" || kind(item) === filter);
  const offer = open.find(item => item.id === picked) ?? null;
  const confirm = () => { const ok = !!offer && trading.onTrade(offer.id); setPicked(null); notify(t(ok ? "success" : "unavailable")); };
  return <div className={styles.market}>
    <div className={styles.marketBoard}>
      <Chips values={["all", "buy", "sell"] as const} value={filter} onChange={value => { setFilter(value); setPicked(null); }} label={value => t(value)} count={value => value === "all" ? open.length : open.filter(item => kind(item) === value).length} />
      {offers.length ? <div className={styles.offerGrid}>{offers.map(item => {
        const affordable = canAffordTrade(item.give, balance, collection);
        return <button key={item.id} type="button" className={styles.offer} aria-pressed={picked === item.id} disabled={!affordable} onClick={() => setPicked(picked === item.id ? null : item.id)}>
          <span className={styles.offerSeller}><i>{item.collector[0]}</i>{item.collector}</span>
          <span className={styles.offerSides}><Asset asset={item.give} /><LuArrowRight aria-hidden="true" /><Asset asset={item.receive} /></span>
          {!affordable && <span className={styles.offerLack}>{t(item.give.kind === "coins" ? "missingCoins" : "missingFigure")}</span>}
        </button>;
      })}</div> : <Empty icon={<LuArrowLeftRight />} text={t("empty")} />}
    </div>
    <aside className={styles.tradeWindow} data-open={!!offer}>
      <div className={styles.slip}>{offer ? <>
        <h3>{offer.collector}</h3>
        <div className={styles.slipSide}><small>{t("give")}</small><Asset asset={offer.give} /></div>
        <LuArrowDown className={styles.slipArrow} aria-hidden="true" />
        <div className={styles.slipSide} data-get="true"><small>{t("receive")}</small><Asset asset={offer.receive} /></div>
        <div className={styles.slipActions}><Action onClick={confirm}>{t("confirmAction")}</Action><Action secondary onClick={() => setPicked(null)}>{common("cancel")}</Action></div>
      </> : <div className={styles.slipEmpty}><LuArrowLeftRight aria-hidden="true" /><p>{t("pick")}</p></div>}</div>
      {!!completed.length && <div className={styles.ledger}><h3>{t("history")}</h3><ul>{completed.map(item => <li key={item.id}><LuCheck aria-hidden="true" /><span>{assetName(item.receive.kind === "figure" ? item.receive : item.give)}</span><small>{item.collector}</small></li>)}</ul></div>}
    </aside>
    {toast}
  </div>;
}
