"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LuArrowLeftRight, LuArrowRight, LuCheck, LuHandshake, LuRefreshCw, LuX } from "react-icons/lu";
import { dayKey, exchangeTrade, spendCoin, type FigurineCollection } from "@/lib/figurine-collection";
import { canAffordTrade, dailyDeals, PLAYER_OFFERS, tradeKind, type TradeAsset, type TradeKind, type TradeOffer } from "@/lib/figurine-trading";
import { findFigure } from "@/lib/figurine-series";
import { playFigurineCue } from "@/lib/figurine-audio";
import { Action, Chips, Coin, Coins, Empty, HeaderExtra } from "./FacilityParts";
import { flyCoins, pointOf } from "./RewardLayer";
import Portrait from "./Portrait";
import frame from "./facility-overlay.module.css";
import styles from "./trade.module.css";

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

// One side of a trade: the figure's portrait and name, or a stack of coins.
function Asset({ asset, lacking = false }: { asset: TradeAsset; lacking?: boolean }) {
  const t = useTranslations("figurineLab");
  return asset.kind === "coins" ? <span className={styles.asset} data-kind="coins" data-lacking={lacking || undefined}><span className={styles.assetPicture}><Coin size={44} /></span><b>{t("world.rewards.coins", { count: asset.amount })}</b></span>
    : <span className={styles.asset} data-quality={asset.quality} data-lacking={lacking || undefined}><span className={styles.assetPicture}><Portrait figureKey={asset.key} quality={asset.quality} /></span><b>{findFigure(asset.key)?.character.name}</b>{asset.quality !== "standard" && <small>{t(`quality.${asset.quality}`)}</small>}</span>;
}
// A trade goes through: the deal's own sound, and any coins it paid fly from where they were shown.
function settle(offer: TradeOffer, from: Element | null) {
  playFigurineCue("trade");
  if (offer.receive.kind === "coins") flyCoins(offer.receive.amount, pointOf(from));
}

export default function TradingPost({ npc, ...props }: TradeProps & { npc: boolean }) {
  return npc ? <Deals {...props} /> : <Market {...props} />;
}

// The merchant's table: three trade windows side by side, each filling its share of the table and
// settled on the spot. A deal is armed by one tap and confirmed by a second, so a stray tap never
// trades.
function Deals({ trading, collection, balance }: TradeProps) {
  const t = useTranslations("figurineLab.world.overlays.market");
  const [armed, setArmed] = useState<string | null>(null);
  const done = new Set(trading.completed.map(item => item.id));
  const refresh = () => { if (trading.onRefresh()) { setArmed(null); playFigurineCue("paper"); } else playFigurineCue("deny"); };
  return <>
    <HeaderExtra><button type="button" className={frame.secondary} disabled={balance < 1} onClick={refresh}><LuRefreshCw />{t("refresh")}<Coins count={1} size={16} /></button></HeaderExtra>
    <div className={styles.deals}>{trading.deals.map(offer => {
      const kind = tradeKind(offer), sold = done.has(offer.id), affordable = canAffordTrade(offer.give, balance, collection);
      return <article key={offer.id} className={styles.deal} data-kind={kind} data-sold={sold || undefined} data-armed={armed === offer.id || undefined}>
        <span className={styles.kind}>{t(kind)}</span>
        <div className={styles.sides}>
          <div className={styles.side}><small>{t("give")}</small><Asset asset={offer.give} lacking={!affordable && !sold} /></div>
          <LuArrowRight className={styles.arrow} aria-hidden="true" />
          <div className={styles.side} data-get="true"><small>{t("receive")}</small><Asset asset={offer.receive} /></div>
        </div>
        <div className={styles.dealActions}>{sold ? <span className={frame.stamp}><LuCheck />{t("completed")}</span>
          : armed === offer.id ? <><Action onClick={(event) => { const card = event.currentTarget.closest("article"); const ok = trading.onTrade(offer.id); setArmed(null); if (ok) settle(offer, card?.querySelector("[data-get]") ?? null); else playFigurineCue("deny"); }}><LuHandshake />{t("confirmAction")}</Action><button type="button" className={frame.secondary} onClick={() => { playFigurineCue("pick"); setArmed(null); }} aria-label={t("cancel")}><LuX /></button></>
            : <Action disabled={!affordable} onClick={() => { playFigurineCue("place"); setArmed(offer.id); }}>{affordable ? t("trade") : t(offer.give.kind === "coins" ? "missingCoins" : "missingFigure")}</Action>}</div>
      </article>;
    })}</div>
  </>;
}

const KINDS = ["all", "buy", "sell", "swap"] as const;
// The players' exchange. The trade table lies across the top: what you give on the left, what you
// get on the right, the other collector and the handshake between. Under it, the offers on the
// board; picking one lays it on the table to accept or decline.
function Market({ trading, collection, balance }: TradeProps) {
  const t = useTranslations("figurineLab.world.overlays.market");
  const [filter, setFilter] = useState<"all" | TradeKind>("all"), [picked, setPicked] = useState<string | null>(null);
  const done = new Set(trading.completed.map(item => item.id));
  const open = PLAYER_OFFERS.filter(item => !done.has(item.id));
  const offers = open.filter(item => filter === "all" || tradeKind(item) === filter);
  const offer = open.find(item => item.id === picked) ?? null, getSide = useRef<HTMLDivElement>(null);
  const accept = () => {
    if (!offer) return;
    if (trading.onTrade(offer.id)) settle(offer, getSide.current); else playFigurineCue("deny");
    setPicked(null);
  };
  const pick = (item: TradeOffer, affordable: boolean) => {
    if (!affordable) { playFigurineCue("deny"); return; }
    playFigurineCue(picked === item.id ? "pick" : "place"); setPicked(picked === item.id ? null : item.id);
  };
  return <div className={styles.market}>
    <section className={styles.table} data-open={!!offer} aria-live="polite">
      <div className={styles.pane}><small>{t("give")}</small>{offer ? <Asset asset={offer.give} /> : <span className={styles.slotEmpty} />}</div>
      <div className={styles.between}>
        {offer ? <>
          <h3><i>{offer.collector[0]}</i>{offer.collector}</h3>
          <LuArrowLeftRight className={styles.arrow} aria-hidden="true" />
          <Action onClick={accept}><LuHandshake />{t("confirmAction")}</Action>
          <Action secondary onClick={() => { playFigurineCue("pick"); setPicked(null); }}>{t("cancel")}</Action>
        </> : <><LuHandshake className={styles.idle} aria-hidden="true" /><p>{t("pick")}</p></>}
      </div>
      <div className={styles.pane} data-get="true" ref={getSide}><small>{t("receive")}</small>{offer ? <Asset asset={offer.receive} /> : <span className={styles.slotEmpty} />}</div>
    </section>
    <div className={styles.marketBoard}>
      <Chips values={KINDS} value={filter} onChange={value => { playFigurineCue("pick"); setFilter(value); setPicked(null); }} label={value => t(value)} count={value => value === "all" ? open.length : open.filter(item => tradeKind(item) === value).length} />
      {offers.length ? <div className={`${styles.offerGrid} ${frame.scroll}`}>{offers.map(item => {
        const affordable = canAffordTrade(item.give, balance, collection);
        return <button key={item.id} type="button" className={styles.offer} data-kind={tradeKind(item)} aria-pressed={picked === item.id} aria-disabled={!affordable} onClick={() => pick(item, affordable)}>
          <span className={styles.offerSeller}><i>{item.collector[0]}</i>{item.collector}<em>{affordable ? t(tradeKind(item)) : t(item.give.kind === "coins" ? "missingCoins" : "missingFigure")}</em></span>
          <span className={styles.offerSides}><Asset asset={item.give} lacking={!affordable} /><LuArrowRight aria-hidden="true" /><Asset asset={item.receive} /></span>
        </button>;
      })}</div> : <Empty icon={<LuArrowLeftRight />} text={t("empty")} />}
    </div>
  </div>;
}
