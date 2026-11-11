"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import Image from "next/image";
import { LuSparkles } from "react-icons/lu";
import coinImage from "../../../public/figurines/world/coin.webp";
import { playFigurineCue, unlockFigurineAudio } from "@/lib/figurine-audio";
import type { FigurineCue } from "@/lib/figurine-reveal";
import type { FigurineQuality, MachineItem } from "@/lib/figurine-collection";
import { MAX_REWARD_COINS, rewardCoinLayout } from "@/lib/figurine-chest";
import Portrait from "./Portrait";
import styles from "./reward-layer.module.css";

// Every coin the player earns ends the same way: it flies into the wallet, which counts it as it
// lands. A reward that plays out in the world (the chest, the wheel, a prize catch, the recycler)
// is shown by the world itself: its coins fly out of where they came from and hang before the
// camera. This layer makes the moment of it around them: the world darkens, a fan of light turns
// behind the coins, a jingle plays, the count stands under them, and a tap sends them on. Coins earned
// inside a panel (a quest claim, a sale) are this layer's own: they pop out where they were earned
// and fly straight to the wallet. The coins are already granted when any of this plays: the wallet
// only holds its count back until each lands.
export type RewardPoint = { x: number; y: number };
type Payout = {
  id: number; coins: number; left: number; origin: RewardPoint | null; present: boolean; landed: number;
  title?: string; note?: string; hint?: string; card?: ReactNode; cue?: FigurineCue; onCollect?: () => void; onDone?: () => void;
};
const EMPTY: readonly Payout[] = [];
let nextId = 1, held = 0, queue: readonly Payout[] = EMPTY, wallet: HTMLElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const settle = (payout: Payout) => {
  if (!queue.includes(payout)) return;
  held -= payout.left; payout.left = 0;
  queue = queue.filter((entry) => entry !== payout); emit();
  payout.onDone?.();
};
const land = (payout: Payout, amount: number) => { const paid = Math.min(amount, payout.left); payout.left -= paid; held -= paid; emit(); };

// `held` says the wallet is already holding these coins back (see holdCoins); `onCollect` sends the
// world's coins on their way to the wallet when the player taps.
type Options = { title?: string; note?: string; hint?: string; cue?: FigurineCue; held?: boolean; onCollect?: () => void; onDone?: () => void };
// Coins granted now but shown later (the chest is still opening, the furnace still burning): the
// wallet keeps them back from this moment, until they are presented or released.
export function holdCoins(coins: number) { held += coins; emit(); }
export function releaseCoins(coins: number) { held = Math.max(0, held - coins); emit(); }
// Coins the world is holding before the camera, until the player collects them.
export function presentCoins(coins: number, options: Options = {}) { enqueue({ coins, present: true, ...options }); }
// One of the world's coins has reached the wallet.
export function coinLanded() {
  const payout = queue.find((entry) => entry.present && !entry.card);
  if (!payout) return;
  const shown = Math.min(payout.coins, MAX_REWARD_COINS), share = Math.ceil(payout.left / Math.max(1, shown - payout.landed));
  landSound(payout.landed); bumpWallet(); land(payout, share);
  if (++payout.landed >= shown) settle(payout);
}
// Coins that fly straight from `origin` to the wallet.
export function flyCoins(coins: number, origin: RewardPoint | null, onDone?: () => void) { enqueue({ coins, present: false, origin, onDone }); }
// A prize that is not coins (a figure, a boost), shown on a card and dismissed by a tap.
export function presentPrize(card: ReactNode, options: Options = {}) { enqueue({ coins: 0, present: true, card, ...options }); }
function enqueue({ coins, present, origin = null, held: holding = false, ...rest }: Options & { coins: number; present: boolean; origin?: RewardPoint | null; card?: ReactNode }) {
  if (coins <= 0 && !rest.card) { rest.onDone?.(); return; }
  if (!holding) held += coins;
  queue = [...queue, { id: nextId++, coins, left: coins, landed: 0, origin, present, ...rest }]; emit();
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
function bumpWallet() {
  wallet?.animate([{ transform: "scale(1)", filter: "brightness(1)" }, { transform: reducedMotion() ? "scale(1)" : "scale(1.14)", filter: "brightness(1.6)", offset: 0.3 }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: 320, easing: "ease-out" });
}
// Each coin lands a little higher than the last, so a long payout climbs.
const landSound = (index: number) => playFigurineCue("coin", { intensity: 0.85, rate: Math.min(1.5, 1 + index * 0.045) });
function makeCoin(layer: HTMLElement, size: number) {
  const coin = document.createElement("div"), image = document.createElement("img");
  coin.className = styles.coin; coin.style.width = coin.style.height = `${size}px`; coin.style.margin = `${-size / 2}px`;
  image.src = coinImage.src; image.alt = ""; image.draggable = false;
  coin.append(image); layer.append(coin);
  return coin;
}
// One coin from `from` to the wallet along a single curve, slow to leave and slow to arrive, turning
// as it goes. The whole path is one animation, so nothing in it can jump.
function toWallet(coin: HTMLElement, from: RewardPoint, size: number, delay: number) {
  const rect = wallet?.querySelector("img")?.getBoundingClientRect();
  const to = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth - 60, y: 44 };
  const bend = (Math.random() - 0.5) * 0.7, control = { x: (from.x + to.x) / 2 - (to.y - from.y) * bend, y: (from.y + to.y) / 2 + (to.x - from.x) * bend - 40 };
  const end = (rect?.width ?? 44) / size * 0.85, steps = 30;
  const frames = Array.from({ length: steps + 1 }, (_, index) => {
    const time = index / steps, k = time * time * (3 - 2 * time), u = 1 - k;
    const x = u * u * from.x + 2 * u * k * control.x + k * k * to.x, y = u * u * from.y + 2 * u * k * control.y + k * k * to.y;
    return { transform: `translate(${x}px, ${y}px) scale(${1 + (end - 1) * k * k})` };
  });
  coin.dataset.flying = "true";
  return coin.animate(frames, { duration: 760, delay, easing: "linear", fill: "both" }).finished.then(() => { coin.remove(); });
}

export default function RewardLayer({ collect, tapToCollect }: { collect: string; tapToCollect: string }) {
  const entries = useSyncExternalStore(subscribe, () => queue, () => EMPTY);
  const current = entries.find((entry) => entry.present) ?? null;
  const layer = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const dismiss = useRef<() => void>(() => {});
  // Anything still unpaid when the world goes away is simply in the wallet.
  useEffect(() => () => { held = 0; queue = EMPTY; emit(); }, []);

  // A panel's own coins: they pop out where they were earned, then fly to the wallet one by one.
  const flown = useRef(new Set<number>());
  useEffect(() => {
    const host = layer.current;
    if (!host) return;
    for (const payout of entries) {
      if (payout.present || flown.current.has(payout.id)) continue;
      flown.current.add(payout.id);
      const count = Math.min(payout.coins, MAX_REWARD_COINS), origin = payout.origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      if (reducedMotion()) { landSound(0); bumpWallet(); settle(payout); continue; }
      const size = window.innerWidth < 700 ? 46 : 56;
      playFigurineCue(count > 2 ? "coinsFew" : "coin", { intensity: 0.7 });
      let landed = 0;
      for (let index = 0; index < count; index++) {
        const coin = makeCoin(host, size), angle = -Math.PI / 2 + (index - (count - 1) / 2) * 0.55 + (Math.random() - 0.5) * 0.3, reach = size * (0.9 + Math.random() * 0.5);
        const popped = { x: origin.x + Math.cos(angle) * reach, y: origin.y + Math.sin(angle) * reach };
        const share = Math.floor(payout.coins / count) + (index < payout.coins % count ? 1 : 0);
        void coin.animate([{ transform: `translate(${origin.x}px, ${origin.y}px) scale(.2)`, opacity: 0 }, { transform: `translate(${popped.x}px, ${popped.y}px) scale(1)`, opacity: 1 }], { duration: 380, delay: index * 50, easing: "cubic-bezier(.2, .9, .3, 1.25)", fill: "both" }).finished
          .then(() => toWallet(coin, popped, size, 160 + index * 70))
          .then(() => { landSound(landed); bumpWallet(); land(payout, share); if (++landed === count) settle(payout); })
          .catch(() => { coin.remove(); });
      }
    }
  }, [entries]);

  // A presentation waits for the tap. The world's coins then fly on their own and report each
  // landing; a card simply leaves.
  const currentId = current?.id;
  useEffect(() => {
    const payout = queue.find((entry) => entry.id === currentId);
    if (!payout) return;
    setLeaving(false);
    const timers: number[] = [];
    let collecting = false;
    // A prize has its own fanfare; coins arrive to a jingle, a sparkle and their own ring.
    playFigurineCue(payout.cue ?? "winSmall");
    if (!payout.card) {
      playFigurineCue("sparkle", { intensity: 0.6 });
      playFigurineCue(payout.coins > 2 ? "coins" : payout.coins > 1 ? "coinsFew" : "coin", { intensity: 0.7 });
      // The light and the darkness leave a clear round for the coins, and the words sit just under
      // them, however many rows of them there are.
      const { size, slots } = rewardCoinLayout(Math.min(payout.coins, MAX_REWARD_COINS)), aspect = window.innerWidth / window.innerHeight;
      const coin = 0.75 * 0.67 * Math.min(1, aspect / 0.8) * size / (2 * 3 * Math.tan(Math.PI / 10)) * window.innerHeight;
      const across = Math.max(...slots.map((slot) => Math.abs(slot.x))) + 0.5, up = Math.max(...slots.map((slot) => Math.abs(slot.y))) + 0.5;
      layer.current?.style.setProperty("--half", `${up * coin}px`);
      layer.current?.style.setProperty("--clear", `${Math.hypot(across, up) * coin + 10}px`);
    }
    dismiss.current = () => {
      if (collecting) return;
      collecting = true; setLeaving(true);
      unlockFigurineAudio(); playFigurineCue("swish", { intensity: payout.card ? 0.7 : 1 });
      if (payout.card || !payout.onCollect) { timers.push(window.setTimeout(() => settle(payout), 260)); return; }
      payout.onCollect();
      // Should the world's coins never report in (the view changed under them), the wallet still gets its due.
      timers.push(window.setTimeout(() => settle(payout), 4000));
    };
    return () => { timers.forEach((timer) => window.clearTimeout(timer)); dismiss.current = () => {}; };
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
      <span className={styles.text} role="status">
        {current.title && <small>{current.title}</small>}
        {current.card ?? <b>+{current.coins}</b>}
        {current.note && <em>{current.note}</em>}
        <i>{current.hint ?? tapToCollect}</i>
      </span>
    </button>}
  </div>;
}
