"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import Image from "next/image";
import coinImage from "../../../public/figurines/world/coin.webp";
import { playFigurineCue, unlockFigurineAudio } from "@/lib/figurine-audio";
import type { FigurineCue } from "@/lib/figurine-reveal";
import type { FigurineQuality, MachineItem } from "@/lib/figurine-collection";
import { LuSparkles } from "react-icons/lu";
import Portrait from "./Portrait";
import styles from "./reward-layer.module.css";

// Every coin the player earns arrives the same way, wherever it came from: the coins burst out of
// their source, hang in the middle of the screen until tapped, then fly one by one into the wallet,
// which counts each as it lands. Small earnings inside a panel skip the hang and fly straight in.
// The coins are already granted when this plays: the wallet only holds them back until they land.
export type RewardPoint = { x: number; y: number };
type Payout = {
  id: number; coins: number; left: number; origin: RewardPoint | null; present: boolean;
  title?: string; note?: string; hint?: string; card?: ReactNode; cue?: FigurineCue; onDone?: () => void;
};
const EMPTY: readonly Payout[] = [];
let nextId = 1, held = 0, queue: readonly Payout[] = EMPTY, wallet: HTMLElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const settle = (payout: Payout) => {
  held -= payout.left; payout.left = 0;
  queue = queue.filter((entry) => entry !== payout); emit();
  payout.onDone?.();
};
const land = (payout: Payout, amount: number) => { const paid = Math.min(amount, payout.left); payout.left -= paid; held -= paid; emit(); };

// `held` says the wallet is already holding these coins back (see holdCoins).
type Options = { origin?: RewardPoint | null; title?: string; note?: string; hint?: string; cue?: FigurineCue; held?: boolean; onDone?: () => void };
// Coins granted now but shown later (the chest is still opening, the furnace still burning): the
// wallet keeps them back from this moment, until they are presented or released.
export function holdCoins(coins: number) { held += coins; emit(); }
export function releaseCoins(coins: number) { held = Math.max(0, held - coins); emit(); }
// Coins shown in the middle of the screen until the player collects them.
export function presentCoins(coins: number, options: Options = {}) { enqueue({ coins, present: true, ...options }); }
// Coins that fly straight from `origin` to the wallet.
export function flyCoins(coins: number, origin: RewardPoint | null, onDone?: () => void) { enqueue({ coins, present: false, origin, onDone }); }
// A prize that is not coins (a figure, a boost), shown the same way and dismissed by a tap.
export function presentPrize(card: ReactNode, options: Options = {}) { enqueue({ coins: 0, present: true, card, ...options }); }
function enqueue({ coins, present, origin = null, held: holding = false, ...rest }: Options & { coins: number; present: boolean; card?: ReactNode }) {
  if (coins <= 0 && !rest.card) { rest.onDone?.(); return; }
  if (!holding) held += coins;
  queue = [...queue, { id: nextId++, coins, left: coins, origin, present, ...rest }]; emit();
}
// The centre of an element, for a reward that starts from a button or a card.
export const pointOf = (element: Element | null): RewardPoint | null => {
  const rect = element?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
};

// The wallet: its count runs behind the balance by the coins still in the air.
export function Wallet({ balance, label, title, className, icon }: { balance: number; label: string; title: string; className: string; icon: RefObject<HTMLImageElement | null> }) {
  const waiting = useSyncExternalStore(subscribe, () => held, () => 0);
  return <div className={className} role="status" title={title} ref={(element) => { wallet = element; return () => { if (wallet === element) wallet = null; }; }}>
    <Image ref={icon} src={coinImage} width={48} height={48} alt="" />
    <span><b>{Math.max(0, balance - waiting)}</b><small>{label}</small></span>
  </div>;
}

// What a prize shows in place of a number: the figure won, or the boost.
export function FigurePrize({ figure, name, detail }: { figure: MachineItem; name: string; detail: string }) {
  return <span className={styles.prize} data-quality={figure.quality}><span className={styles.prizePicture}><Portrait figureKey={figure.key} quality={figure.quality} /></span><strong>{name}</strong><span>{detail}</span></span>;
}
export function BoostPrize({ quality, name, detail }: { quality: FigurineQuality; name: string; detail: string }) {
  return <span className={styles.prize} data-quality={quality}><span className={styles.prizeBoost}><LuSparkles aria-hidden="true" /></span><strong>{name}</strong><span>{detail}</span></span>;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_COINS = 12;
// Where each coin hangs, about the cluster's centre: rows of up to five, each row centred.
function slots(count: number, size: number): RewardPoint[] {
  const rows = count <= 5 ? 1 : count <= 10 ? 2 : 3, perRow = Math.ceil(count / rows), step = size * 1.12;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow), inRow = Math.min(perRow, count - row * perRow);
    return { x: (index % perRow - (inRow - 1) / 2) * step, y: (row - (rows - 1) / 2) * step * 0.92 };
  });
}
function makeCoin(layer: HTMLElement, size: number) {
  const coin = document.createElement("div"), image = document.createElement("img");
  coin.className = styles.coin; coin.style.width = coin.style.height = `${size}px`; coin.style.margin = `${-size / 2}px`;
  image.src = coinImage.src; image.alt = ""; image.draggable = false;
  coin.append(image); layer.append(coin);
  return coin;
}
const at = ({ x, y }: RewardPoint, scale = 1, turn = 0) => `translate(${x}px, ${y}px) scale(${scale}) rotate(${turn}deg)`;
function bumpWallet() {
  wallet?.animate([{ transform: "scale(1)", filter: "brightness(1)" }, { transform: reducedMotion() ? "scale(1)" : "scale(1.14)", filter: "brightness(1.6)", offset: 0.3 }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: 320, easing: "ease-out" });
}
// One coin from where it is to the wallet, on a bent path; resolves as it lands.
function toWallet(coin: HTMLElement, from: RewardPoint, size: number, delay: number) {
  const rect = wallet?.querySelector("img")?.getBoundingClientRect();
  const to = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth - 60, y: 44 };
  const bend = (Math.random() - 0.5) * 0.5, middle = { x: from.x + (to.x - from.x) * 0.45 - (to.y - from.y) * bend, y: from.y + (to.y - from.y) * 0.45 + (to.x - from.x) * bend };
  const flight = coin.animate([
    { transform: at(from), easing: "cubic-bezier(.3, 0, .6, 1)" },
    { transform: at(middle, 1.12, 140), offset: 0.42, easing: "cubic-bezier(.5, 0, .9, .6)" },
    { transform: at(to, (rect?.width ?? 44) / size * 0.9, 360) },
  ], { duration: 520, delay, fill: "both" });
  return flight.finished.then(() => { coin.remove(); });
}
// Each coin lands a little higher than the last, so a long payout climbs.
const landSound = (index: number) => playFigurineCue("coin", { intensity: 0.85, rate: Math.min(1.7, 1 + index * 0.055) });

export default function RewardLayer({ collect, tapToCollect }: { collect: string; tapToCollect: string }) {
  const entries = useSyncExternalStore(subscribe, () => queue, () => EMPTY);
  const current = entries.find((entry) => entry.present) ?? null;
  const layer = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false), [leaving, setLeaving] = useState(false);
  const dismiss = useRef<() => void>(() => {});
  // Anything still unpaid when the world goes away is simply in the wallet.
  useEffect(() => () => { held = 0; queue = EMPTY; emit(); }, []);

  // Straight flights: a quick pop where they were earned, then to the wallet.
  const flown = useRef(new Set<number>());
  useEffect(() => {
    const host = layer.current;
    if (!host) return;
    for (const payout of entries) {
      if (payout.present || flown.current.has(payout.id)) continue;
      flown.current.add(payout.id);
      const count = Math.min(payout.coins, MAX_COINS), origin = payout.origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      if (reducedMotion()) { landSound(0); bumpWallet(); settle(payout); continue; }
      const size = window.innerWidth < 700 ? 34 : 40;
      playFigurineCue(count > 2 ? "coinsFew" : "coin", { intensity: 0.7 });
      let landed = 0;
      for (let index = 0; index < count; index++) {
        const coin = makeCoin(host, size), angle = Math.random() * Math.PI * 2, reach = 26 + Math.random() * 34;
        const popped = { x: origin.x + Math.cos(angle) * reach, y: origin.y + Math.sin(angle) * reach - 18 };
        const share = Math.floor(payout.coins / count) + (index < payout.coins % count ? 1 : 0);
        void coin.animate([{ transform: at(origin, 0.3), opacity: 0 }, { transform: at(popped, 1), opacity: 1 }], { duration: 220, delay: index * 35, easing: "cubic-bezier(.2, .9, .3, 1.3)", fill: "both" }).finished
          .then(() => toWallet(coin, popped, size, 90 + index * 45))
          .then(() => { landSound(landed); bumpWallet(); land(payout, share); if (++landed === count) settle(payout); })
          .catch(() => { coin.remove(); });
      }
    }
  }, [entries]);

  // A presentation: burst out, hang, and on a tap fly to the wallet.
  const currentId = current?.id;
  useEffect(() => {
    const host = layer.current, payout = queue.find((entry) => entry.id === currentId);
    if (!host || !payout) return;
    setShown(false); setLeaving(false);
    const reduced = reducedMotion(), phone = window.innerWidth < 700;
    const count = Math.min(payout.coins, MAX_COINS), size = phone ? (count > 8 ? 46 : 54) : count > 5 ? 64 : 76;
    const centre = { x: window.innerWidth / 2, y: window.innerHeight * (payout.card ? 0.4 : 0.4) };
    const origin = payout.origin ?? { x: centre.x, y: centre.y + 120 };
    const places = slots(count, size).map((slot) => ({ x: centre.x + slot.x, y: centre.y + slot.y }));
    const coins = places.map(() => makeCoin(host, size));
    // The words sit just under the cluster, however many rows it has.
    host.style.setProperty("--half", `${Math.max(0, ...slots(count, size).map((slot) => slot.y)) + size / 2}px`);
    const timers: number[] = [];
    let alive = true, collecting = false;
    if (payout.cue) playFigurineCue(payout.cue);
    if (count) playFigurineCue(count > 2 ? "coins" : count > 1 ? "coinsFew" : "coin");
    coins.forEach((coin, index) => {
      const place = places[index], arc = { x: (origin.x + place.x) / 2 + (Math.random() - 0.5) * 120, y: Math.min(origin.y, place.y) - 70 - Math.random() * 90 };
      coin.animate(reduced ? [{ transform: at(place), opacity: 0 }, { transform: at(place), opacity: 1 }] : [
        { transform: at(origin, 0.2, -200), opacity: 0, easing: "cubic-bezier(.2, .7, .4, 1)" },
        { transform: at(arc, 0.9, -60), opacity: 1, offset: 0.5, easing: "cubic-bezier(.4, 0, .5, 1)" },
        { transform: at(place, 1.12, 8), offset: 0.86 },
        { transform: at(place, 1, 0), opacity: 1 },
      ], { duration: reduced ? 200 : 680, delay: reduced ? 0 : index * 60, fill: "both" });
      // Once in place a coin bobs on its own beat until collected.
      timers.push(window.setTimeout(() => { coin.dataset.idle = "true"; coin.style.setProperty("--beat", `${-index * 0.23}s`); }, reduced ? 0 : 680 + index * 60));
    });
    timers.push(window.setTimeout(() => { if (alive) setShown(true); }, reduced ? 0 : 420 + count * 60));
    dismiss.current = () => {
      if (collecting || !alive) return;
      collecting = true; setLeaving(true);
      unlockFigurineAudio();
      if (!count) { playFigurineCue("swish", { intensity: 0.7 }); timers.push(window.setTimeout(() => settle(payout), 260)); return; }
      if (reduced) { coins.forEach((coin) => coin.remove()); landSound(0); bumpWallet(); settle(payout); return; }
      playFigurineCue("swish");
      let landed = 0;
      coins.forEach((coin, index) => {
        coin.dataset.idle = "false";
        const share = Math.floor(payout.coins / count) + (index < payout.coins % count ? 1 : 0);
        void toWallet(coin, places[index], size, index * 70).then(() => { landSound(landed); bumpWallet(); land(payout, share); if (++landed === count) settle(payout); }).catch(() => undefined);
      });
    };
    return () => { alive = false; timers.forEach((timer) => window.clearTimeout(timer)); coins.forEach((coin) => { coin.getAnimations().forEach((animation) => animation.cancel()); coin.remove(); }); dismiss.current = () => {}; };
  }, [currentId]);
  // The keyboard collects too, before the world's own keys see the press.
  useEffect(() => {
    if (currentId === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); dismiss.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [currentId]);

  return <div className={styles.layer} ref={layer} data-active={!!current || undefined}>
    {current && <button type="button" className={styles.backdrop} data-leaving={leaving || undefined} data-prize={current.card ? "true" : undefined} onClick={() => dismiss.current()} aria-label={collect} autoFocus>
      <span className={styles.rays} aria-hidden="true" />
      <span className={styles.text} data-shown={shown || undefined} role="status">
        {current.title && <small>{current.title}</small>}
        {current.card ?? <b>+{current.coins}</b>}
        {current.note && <em>{current.note}</em>}
        <i>{current.hint ?? tapToCollect}</i>
      </span>
    </button>}
  </div>;
}
